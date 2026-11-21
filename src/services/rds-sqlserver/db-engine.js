'use strict';

/**
 * DB Engine - Gerencia múltiplas instâncias SQLite (uma por database lógico do SQL Server).
 *
 * Responsabilidades:
 * - Abrir/criar um arquivo <database>.db por database lógico, com WAL e foreign keys ativados.
 * - Ser o ÚNICO ponto de tradução de T-SQL: os chamadores repassam SQL bruto do cliente.
 * - Executar instruções (SELECT/DML/DDL), lotes com múltiplas instruções e transações.
 *
 * Erros de SQL são propagados sem conversão; a camada de API decide como mapeá-los
 * para BadRequestException/AWS-style errors.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../../utils/logger');
const catalogoSistema = require('./system-catalog');

class DbEngine {
  /**
   * @param {string} dataDir - Diretório onde os arquivos .db serão gravados
   * @param {{ translate: Function, splitBatches?: Function }|null} translator -
   *        Tradutor de T-SQL para SQLite. Quando nulo, a tradução é identidade.
   */
  constructor(dataDir, translator = null) {
    this.dataDir = dataDir;
    this.translator = translator;
    this.databases = new Map(); // dbName → instância better-sqlite3
    this.transactions = new Map(); // transactionId → { db, dbName, startedAt }
    this.isClosed = false;

    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  /**
   * Obtém (ou cria) a conexão SQLite de um database lógico.
   * Nomes reservados e caminhos relativos/absolutos são rejeitados para evitar
   * que um cliente SQL consiga gravar fora do diretório de dados.
   *
   * @param {string} dbName - Nome lógico do database
   * @returns {import('better-sqlite3').Database}
   */
  getOrCreateDatabase(dbName) {
    this._validarNomeDatabase(dbName);
    if (this.isClosed) {
      throw new Error('DbEngine foi fechado: não é possível abrir databases');
    }

    if (this.databases.has(dbName)) {
      return this.databases.get(dbName);
    }

    fs.mkdirSync(this.dataDir, { recursive: true });
    const dbPath = path.join(this.dataDir, `${dbName}.db`);
    const db = new Database(dbPath);

    // Otimizações aplicadas em toda conexão (inclusive ao reabrir um arquivo existente).
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Todo database recebe o catálogo do SQL Server: tabelas sys.* e funções
    // como SERVERPROPERTY, anexadas a partir do database master.
    catalogoSistema.instalar(db, {
      dataDir: this.dataDir,
      dbName,
      engine: this.translator && this.translator.engine,
      listarDatabases: () => this.listDatabases(),
      usuario: 'admin'
    });

    this.databases.set(dbName, db);
    logger.debug(`[RDS SQL Server DbEngine] Database '${dbName}' aberto/criado em ${dbPath}`);
    return db;
  }

  /**
   * Executa SQL T-SQL bruto em um database, traduzindo antes de qualquer detecção.
   *
   * @param {string} dbName - Database de destino
   * @param {string} sql - SQL bruto enviado pelo cliente (T-SQL)
   * @param {Array} params - Parâmetros ligados à instrução
   * @returns {{ type: string, rows: Array, columns: Array, changes: number, lastInsertRowid: number }}
   */
  execute(dbName, sql, params = []) {
    const db = this.getOrCreateDatabase(dbName);
    return this._executar(db, sql, params);
  }

  /**
   * Inicia uma transação no database informado.
   *
   * @param {string} dbName - Database de destino
   * @returns {string} UUID da transação
   */
  beginTransaction(dbName) {
    const db = this.getOrCreateDatabase(dbName);
    const transactionId = crypto.randomUUID();

    db.exec('BEGIN');
    this.transactions.set(transactionId, {
      db,
      dbName,
      startedAt: Date.now()
    });

    logger.debug(`[RDS SQL Server DbEngine] Transação ${transactionId} iniciada em '${dbName}'`);
    return transactionId;
  }

  /**
   * Executa SQL dentro de uma transação ativa (também passa pela tradução).
   *
   * @param {string} transactionId - UUID da transação
   * @param {string} sql - SQL T-SQL bruto
   * @param {Array} params - Parâmetros ligados à instrução
   */
  executeInTransaction(transactionId, sql, params = []) {
    const transacao = this._obterTransacao(transactionId);
    return this._executar(transacao.db, sql, params);
  }

  /**
   * Confirma uma transação ativa.
   *
   * @param {string} transactionId - UUID da transação
   */
  commit(transactionId) {
    const transacao = this._obterTransacao(transactionId);
    transacao.db.exec('COMMIT');
    this.transactions.delete(transactionId);
    logger.debug(`[RDS SQL Server DbEngine] Transação ${transactionId} confirmada`);
  }

  /**
   * Desfaz uma transação ativa.
   *
   * @param {string} transactionId - UUID da transação
   */
  rollback(transactionId) {
    const transacao = this._obterTransacao(transactionId);
    transacao.db.exec('ROLLBACK');
    this.transactions.delete(transactionId);
    logger.debug(`[RDS SQL Server DbEngine] Transação ${transactionId} desfeita`);
  }

  /**
   * Lista os databases de usuário existentes (nunca inclui metadata.db nem os
   * databases de sistema, que aparecem apenas em sys.databases).
   *
   * @returns {string[]} Nomes sem a extensão .db
   */
  listDatabases() {
    if (!fs.existsSync(this.dataDir)) {
      return [];
    }

    return fs.readdirSync(this.dataDir)
      .filter(arquivo => {
        if (!arquivo.endsWith('.db')) return false;
        const nome = arquivo.slice(0, -3).toLowerCase();
        return nome !== 'metadata' && !catalogoSistema.SISTEMA.includes(nome);
      })
      .map(arquivo => arquivo.slice(0, -3))
      .sort();
  }

  /**
   * Remove um database de usuário: fecha a conexão e apaga o arquivo.
   *
   * @param {string} dbName - Nome do database
   */
  dropDatabase(dbName) {
    this._validarNomeDatabase(dbName);

    if (this.databases.has(dbName)) {
      this.databases.get(dbName).close();
      this.databases.delete(dbName);
    }

    for (const [transactionId, transacao] of this.transactions) {
      if (transacao.dbName === dbName) {
        this.transactions.delete(transactionId);
      }
    }

    for (const arquivo of this._arquivosDoDatabase(dbName)) {
      const caminho = path.join(this.dataDir, arquivo);
      if (fs.existsSync(caminho)) {
        fs.unlinkSync(caminho);
      }
    }

    logger.debug(`[RDS SQL Server DbEngine] Database '${dbName}' removido`);
  }

  /**
   * Fecha todas as conexões. Idempotente.
   */
  close() {
    if (this.isClosed) return;
    this.isClosed = true;

    for (const [dbName, db] of this.databases) {
      try {
        db.close();
      } catch (err) {
        logger.debug(`[RDS SQL Server DbEngine] Erro ao fechar database '${dbName}': ${err.message}`);
      }
    }

    this.databases.clear();
    this.transactions.clear();
    logger.debug('[RDS SQL Server DbEngine] Todas as conexões foram fechadas');
  }

  /**
   * Fecha conexões e remove apenas arquivos de databases de usuário.
   * metadata.db (e seus arquivos WAL/SHM) são preservados.
   */
  reset() {
    this.close();

    if (fs.existsSync(this.dataDir)) {
      for (const arquivo of fs.readdirSync(this.dataDir)) {
        if (!this._ehArquivoDeUsuario(arquivo)) continue;

        try {
          fs.unlinkSync(path.join(this.dataDir, arquivo));
        } catch (err) {
          logger.debug(`[RDS SQL Server DbEngine] Erro ao remover '${arquivo}': ${err.message}`);
        }
      }
    }

    logger.debug('[RDS SQL Server DbEngine] Reset concluído (metadata.db preservado)');
  }

  /** @private */
  _obterTransacao(transactionId) {
    const transacao = this.transactions.get(transactionId);
    if (!transacao) {
      throw new Error(`Transação ${transactionId} não encontrada`);
    }
    return transacao;
  }

  /** @private */
  _validarNomeDatabase(dbName) {
    if (typeof dbName !== 'string' || dbName.trim() === '') {
      throw new Error('Nome de database inválido: informe um nome não vazio');
    }
    if (dbName !== dbName.trim()) {
      throw new Error(`Nome de database inválido: '${dbName}' possui espaços nas extremidades`);
    }
    if (dbName.toLowerCase() === 'metadata') {
      throw new Error("Nome de database 'metadata' é reservado para metadados");
    }
    if (
      dbName === '.' ||
      dbName.includes('/') ||
      dbName.includes('\\') ||
      dbName.includes('..') ||
      dbName.includes('\0') ||
      path.isAbsolute(dbName) ||
      path.basename(dbName) !== dbName
    ) {
      throw new Error(`Nome de database inválido: '${dbName}' não pode conter separadores de caminho`);
    }
    return dbName;
  }

  /** @private */
  _arquivosDoDatabase(dbName) {
    return [`${dbName}.db`, `${dbName}.db-wal`, `${dbName}.db-shm`];
  }

  /** @private */
  _ehArquivoDeUsuario(arquivo) {
    const base = arquivo.replace(/-wal$|-shm$/, '');
    if (!base.endsWith('.db')) return false;
    return base.slice(0, -3).toLowerCase() !== 'metadata';
  }

  /**
   * Tradução centralizada: o engine é o único ponto que conhece o tradutor.
   * @private
   */
  _traduzir(sql) {
    if (!this.translator || typeof this.translator.translate !== 'function') {
      return sql;
    }
    const traduzido = this.translator.translate(sql);
    return typeof traduzido === 'string' ? traduzido : sql;
  }

  /**
   * Divide um lote T-SQL em instruções executáveis individualmente.
   * O tradutor pode fornecer splitBatches(); caso contrário usamos uma divisão
   * simples por ';' (respeitando strings, identificadores e comentários) e por
   * linhas isoladas de 'GO'.
   * @private
   */
  _dividirEmInstrucoes(sql) {
    if (typeof sql !== 'string' || sql.trim() === '') return [];

    let partes;
    if (this.translator && typeof this.translator.splitBatches === 'function') {
      partes = this.translator.splitBatches(sql);
      if (!Array.isArray(partes)) partes = [sql];
      // splitBatches() separa apenas por GO. O SMO envia CREATE TABLE #tmp; SELECT ...
      // no mesmo lote; sem esta divisao o CREATE engole o SELECT e o resultado volta vazio.
      partes = partes.flatMap(parte => this._dividirPorPontoEVirgula(parte));
    } else {
      partes = this._dividirPorPontoEVirgula(sql)
        .flatMap(parte => this._dividirPorGo(parte));
    }

    return partes
      .filter(parte => typeof parte === 'string')
      .map(parte => parte.trim())
      .filter(parte => parte.length > 0 && !this._ehApenasComentario(parte));
  }

  /** @private */
  _ehApenasComentario(sql) {
    const semComentarios = sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim();
    return semComentarios === '';
  }

  /**
   * Divide por ';' ignorando pontos e vírgulas dentro de strings, identificadores
   * entre colchetes/crase/com aspas duplas e comentários.
   * @private
   */
  _dividirPorPontoEVirgula(sql) {
    const partes = [];
    let atual = '';
    let aspasSimples = false;
    let aspasDuplas = false;
    let crase = false;
    let colchetes = false;
    let comentarioLinha = false;
    let comentarioBloco = false;

    for (let i = 0; i < sql.length; i++) {
      const caractere = sql[i];
      const proximo = sql[i + 1];

      if (comentarioLinha) {
        atual += caractere;
        if (caractere === '\n') comentarioLinha = false;
        continue;
      }
      if (comentarioBloco) {
        atual += caractere;
        if (caractere === '*' && proximo === '/') {
          atual += proximo;
          i++;
          comentarioBloco = false;
        }
        continue;
      }
      if (aspasSimples || aspasDuplas || crase) {
        atual += caractere;
        const delimitador = aspasSimples ? "'" : aspasDuplas ? '"' : '`';
        if (caractere === delimitador) {
          if (proximo === delimitador) {
            atual += proximo;
            i++;
          } else if (aspasSimples) {
            aspasSimples = false;
          } else if (aspasDuplas) {
            aspasDuplas = false;
          } else {
            crase = false;
          }
        }
        continue;
      }
      if (colchetes) {
        atual += caractere;
        if (caractere === ']') colchetes = false;
        continue;
      }

      if (caractere === '-' && proximo === '-') {
        comentarioLinha = true;
        atual += caractere;
        continue;
      }
      if (caractere === '/' && proximo === '*') {
        comentarioBloco = true;
        atual += caractere;
        continue;
      }
      if (caractere === "'") {
        aspasSimples = true;
        atual += caractere;
        continue;
      }
      if (caractere === '"') {
        aspasDuplas = true;
        atual += caractere;
        continue;
      }
      if (caractere === '`') {
        crase = true;
        atual += caractere;
        continue;
      }
      if (caractere === '[') {
        colchetes = true;
        atual += caractere;
        continue;
      }
      if (caractere === ';') {
        partes.push(atual);
        atual = '';
        continue;
      }

      atual += caractere;
    }

    partes.push(atual);
    return partes;
  }

  /** @private */
  _dividirPorGo(parte) {
    const blocos = [];
    let bloco = '';

    for (const linha of parte.split(/\r?\n/)) {
      if (/^\s*GO\s*(?:--.*)?$/i.test(linha)) {
        if (bloco.trim()) blocos.push(bloco);
        bloco = '';
      } else {
        bloco += (bloco ? '\n' : '') + linha;
      }
    }
    if (bloco.trim()) blocos.push(bloco);
    return blocos;
  }

  /** @private */
  _temPlaceholders(sql) {
    const semStringsEComentarios = sql
      .replace(/'(?:''|[^'])*'/g, '')
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    return /(?:\?|(?::|@|\$)[A-Za-z_][A-Za-z0-9_]*)/.test(semStringsEComentarios);
  }

  /**
   * Executa o SQL traduzido, percorrendo todas as instruções do lote.
   * Regra de retorno: o primeiro SELECT encontrado prevalece; caso contrário,
   * retorna o último resultado DML (ou o último resultado disponível).
   * @private
   */
  _executar(db, sqlBruto, params = []) {
    let parametros = Array.isArray(params) ? params : params == null ? [] : [params];
    const restante = this._executarDdlDatabase(sqlBruto);
    let sqlTraduzido = this._traduzir(restante);
    if (parametros.length && this.translator && typeof this.translator.substituirParametros === 'function') {
      const substituidos = this.translator.substituirParametros(sqlTraduzido, parametros);
      if (substituidos && typeof substituidos === 'object' && !Array.isArray(substituidos)) {
        sqlTraduzido = substituidos.sql;
        parametros = substituidos.parametros;
      } else {
        sqlTraduzido = substituidos;
      }
    }
    const instrucoes = this._dividirEmInstrucoes(sqlTraduzido);
    if (instrucoes.length === 0) {
      return this._resultadoVazio('ddl');
    }
    const resultados = [];

    for (const instrucao of instrucoes) {
      const usarParametros = instrucoes.length === 1 || this._temPlaceholders(instrucao);
      try {
        resultados.push(this._executarInstrucao(db, instrucao, usarParametros ? parametros : []));
      } catch (erro) {
        throw this._traduzirErroSqlite(erro);
      }
    }

    const primeiroSelect = resultados.find(resultado => resultado.type === 'select');
    if (primeiroSelect) {
      this._aplicarTiposShim(sqlBruto, primeiroSelect);
      return primeiroSelect;
    }

    for (let i = resultados.length - 1; i >= 0; i--) {
      if (resultados[i].type === 'dml') return resultados[i];
    }
    return resultados[resultados.length - 1];
  }

  /**
   * CREATE/DROP DATABASE não existem no SQLite: cada database lógico é um
   * arquivo .db separado. Executamos o efeito diretamente no engine e removemos
   * a instrução do lote antes da tradução.
   * @private
   */
  _executarDdlDatabase(sqlBruto) {
    let restante = String(sqlBruto || '');
    const padrao = /\b(CREATE|DROP)\s+DATABASE\s+(IF\s+EXISTS\s+)?(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z_][\w]*))/gi;
    let correspondência;
    while ((correspondência = padrao.exec(restante)) !== null) {
      const acao = correspondência[1].toUpperCase();
      const seExistir = Boolean(correspondência[2]);
      const nome = correspondência[3] || correspondência[4] || correspondência[5];
      const inicioOpcoes = correspondência.index + correspondência[0].length;
      const fim = this._fimDeclaracaoDatabase(restante, inicioOpcoes);
      if (acao === 'CREATE') {
        if (this._databaseExiste(nome)) {
          throw this._erroTsql(1801, 3,
            `Database '${nome}' already exists. Choose a different database name.`);
        }
        const opcoes = this._opcoesCreateDatabase(restante.slice(inicioOpcoes, fim));
        this.getOrCreateDatabase(nome);
        this._sincronizarCatalogoDatabase(nome, true, opcoes);
      } else {
        if (catalogoSistema.SISTEMA.some((sistema) => sistema.toLowerCase() === nome.toLowerCase())) {
          throw this._erroTsql(1805, 1,
            `Cannot drop database "${nome}" because it is a system database.`);
        }
        if (!this._databaseExiste(nome)) {
          if (!seExistir) {
            throw this._erroTsql(911, 1,
              `Database '${nome}' does not exist. Make sure that the name is entered correctly.`);
          }
        } else {
          this._sincronizarCatalogoDatabase(nome, false);
          this.dropDatabase(nome);
        }
      }
      restante = restante.slice(0, correspondência.index) + restante.slice(fim);
      padrao.lastIndex = correspondência.index;
    }
    return restante;
  }

  /** Verifica se o database existe em disco ou ja esta aberto neste engine. @private */
  _databaseExiste(nome) {
    if (this.databases.has(nome)) return true;
    return fs.existsSync(path.join(this.dataDir, `${nome}.db`));
  }

  /** Cria um erro com numero/estado/classe do SQL Server para o token TDS. @private */
  _erroTsql(numero, state, mensagem) {
    const erro = new Error(mensagem);
    erro.number = numero;
    erro.state = state;
    erro.class = 16;
    return erro;
  }

  /**
   * O SQLite devolve `table X already exists` sem numero de erro; o cliente TDS
   * transformaria isso em 50000 e o SSMS nao apontaria o objeto duplicado.
   * @private
   */
  _traduzirErroSqlite(erro) {
    if (!erro || erro.number) return erro;
    const mensagem = String(erro.message || erro);
    const correspondencia = mensagem.match(/\b(?:table|view)\s+(.+?)\s+already exists\b/i);
    if (!correspondencia) return erro;

    let nome = correspondencia[1].trim();
    nome = nome.split('.').pop().replace(/^["'\[`]|["'\]`]$/g, '');
    return this._erroTsql(2714, 1,
      `There is already an object named '${nome}' in the database.`);
  }

  /**
   * Encontra o fim do statement CREATE/DROP DATABASE, ignorando ponto e virgula
   * dentro de literais e das especificacoes de arquivo entre parenteses.
   * @private
   */
  _fimDeclaracaoDatabase(sql, inicio) {
    let profundidade = 0;
    let aspas = false;
    let colchetes = false;

    for (let i = inicio; i < sql.length; i += 1) {
      const caractere = sql[i];
      if (aspas) {
        if (caractere === "'") {
          if (sql[i + 1] === "'") i += 1;
          else aspas = false;
        }
        continue;
      }
      if (colchetes) {
        if (caractere === ']') colchetes = false;
        continue;
      }
      if (caractere === "'") { aspas = true; continue; }
      if (caractere === '[') { colchetes = true; continue; }
      if (caractere === '(') { profundidade += 1; continue; }
      if (caractere === ')') { profundidade = Math.max(0, profundidade - 1); continue; }
      if (profundidade === 0 && caractere === ';') return i + 1;
      if (
        profundidade === 0 &&
        (i === inicio || /[\r\n]/.test(sql[i - 1])) &&
        /^GO(?:\s|--[^\r\n]*)?(?:\r?\n|$)/i.test(sql.slice(i))
      ) {
        return i;
      }
    }
    return sql.length;
  }

  /** Extrai as opcoes de CREATE DATABASE usadas pelo catalogo do SSMS. @private */
  _opcoesCreateDatabase(opcoes) {
    const resultado = {};
    const containment = /\bCONTAINMENT\s*=\s*(NONE|PARTIAL)\b/i.exec(opcoes);
    if (containment) resultado.containment = /partial/i.test(containment[1]) ? 1 : 0;

    const collation = /\bCOLLATE\s+([A-Za-z0-9_]+)/i.exec(opcoes);
    if (collation) resultado.collation_name = collation[1];

    const ledger = /\bLEDGER\s*=\s*(ON|OFF)\b/i.exec(opcoes);
    if (ledger) resultado.is_ledger_on = /on/i.test(ledger[1]) ? 1 : 0;

    return resultado;
  }

  /**
   * Mantém sys.databases atualizado em todos os databases já abertos.
   * @private
   */
  _sincronizarCatalogoDatabase(nome, presente, opcoes = {}) {
    const alvos = new Set([this.databases.get('master'), ...this.databases.values()].filter(Boolean));
    if (alvos.size === 0) return;

    const colunasPermitidas = new Set(['containment', 'collation_name', 'is_ledger_on']);
    const ajustes = Object.entries(opcoes)
      .filter(([coluna]) => colunasPermitidas.has(coluna))
      .map(([coluna, valor]) => [coluna, valor]);
    // O id precisa ser unico em todos os arquivos: cada database tem sua propria
    // copia de sys.databases e um id diferente para o mesmo nome quebraria joins.
    let proximo = 1;
    if (presente) {
      for (const alvo of alvos) {
        try {
          const maximo = Number(alvo.prepare('SELECT COALESCE(MAX(database_id), 0) AS maximo FROM sys.databases').get().maximo);
          proximo = Math.max(proximo, maximo + 1);
        } catch (erro) {
          logger.debug(`[RDS SQL Server DbEngine] Falha ao calcular database_id: ${erro.message}`);
        }
      }
    }
    for (const alvo of alvos) {
      try {
        if (presente) {
          alvo.prepare(`
            INSERT INTO sys.databases (name, database_id, state, state_desc, create_date)
            VALUES (?, ?, 0, 'ONLINE', ?)
            ON CONFLICT(name) DO UPDATE SET state = 0, state_desc = 'ONLINE'
          `).run(nome, proximo, new Date().toISOString());
          if (ajustes.length) {
            const conjuntos = ajustes.map(([coluna]) => `${coluna} = ?`).join(', ');
            alvo.prepare(`UPDATE sys.databases SET ${conjuntos} WHERE name = ?`)
              .run(...ajustes.map(([, valor]) => valor), nome);
          }
        } else {
          alvo.prepare('DELETE FROM sys.databases WHERE name = ?').run(nome);
        }
      } catch (erro) {
        logger.debug(`[RDS SQL Server DbEngine] Falha ao sincronizar catalogo de '${nome}': ${erro.message}`);
      }
    }
  }

  /**
   * Aplica os tipos TDS declarados pelos shims do SSMS/SMO nas colunas do
   * resultado. O SQLite não preserva o tipo de expressões calculadas, então
   * BIT/TINYINT precisam ser informados explicitamente para o cliente não
   * receber INT onde esperava Boolean/Byte.
   * @private
   */
  _aplicarTiposShim(sqlBruto, resultado) {
    if (!resultado || resultado.type !== 'select' || !Array.isArray(resultado.columns)) return;
    if (!this.translator || typeof this.translator.columnTypesFor !== 'function') return;

    const tipos = this.translator.columnTypesFor(sqlBruto);
    if (!tipos) return;

    resultado.columns = resultado.columns.map((coluna) => {
      const nome = coluna && coluna.name;
      const tipo = nome && tipos[nome];
      return tipo ? { ...coluna, type: tipo } : coluna;
    });
  }

  /**
   * O SQLite usa a propria expressao como nome de coluna quando o SELECT nao
   * tem alias; o SQL Server devolve nome vazio. Alem de semanticamente correto,
   * expressoes longas estouram o B_VARCHAR de 1 byte do TDS e fecham a conexao
   * do Microsoft.Data.SqlClient. Linhas afetadas viram arrays posicionais para
   * nao colidir quando ha mais de uma coluna sem alias.
   * @private
   */
  _normalizarColunasSemAlias(sql, columns, rows) {
    const originais = columns || [];
    const nomes = originais.map((coluna) => String((coluna && coluna.name) || ''));
    const sqlMaiusculo = String(sql || '').toUpperCase();
    const semAlias = nomes.map((nome) => {
      if (!nome || !/[\s(]/.test(nome)) return false;
      const alvo = nome.toUpperCase();
      return !(
        sqlMaiusculo.includes(`[${alvo}]`) ||
        sqlMaiusculo.includes(`"${alvo}"`) ||
        sqlMaiusculo.includes(`'${alvo}'`)
      );
    });

    if (!semAlias.some(Boolean)) return { columns: originais, rows };

    return {
      columns: originais.map((coluna, indice) => (
        semAlias[indice] ? { ...coluna, name: '' } : coluna
      )),
      rows: (rows || []).map((linha) => {
        if (Array.isArray(linha)) return linha;
        return nomes.map((nome) => (linha && nome ? linha[nome] : undefined));
      })
    };
  }

  /** @private */
  _executarInstrucao(db, sql, params) {
    const tipo = this._detectarTipo(sql);

    if (tipo === 'select') {
      const stmt = db.prepare(sql);
      // columns() precisa ser chamado antes de all() para preservar os metadados.
      const brutos = stmt.columns();
      const resultados = stmt.all(...params);
      const { columns, rows } = this._normalizarColunasSemAlias(sql, brutos, resultados);
      return { type: 'select', rows, columns, changes: 0, lastInsertRowid: 0 };
    }

    if (tipo === 'dml') {
      const stmt = db.prepare(sql);
      const resultado = stmt.run(...params);
      return {
        type: 'dml',
        rows: [],
        columns: [],
        changes: resultado.changes,
        lastInsertRowid: Number(resultado.lastInsertRowid)
      };
    }

    db.exec(sql);
    if (/^\s*(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|INDEX)\b/i.test(sql)) {
      catalogoSistema.sincronizarCatalogoDatabase(db);
    }
    return this._resultadoVazio('ddl');
  }

  /** @private */
  _detectarTipo(sql) {
    const upper = sql.trim().toUpperCase();
    if (/^(SELECT|PRAGMA|EXPLAIN|WITH)\b/.test(upper)) return 'select';
    if (/^(INSERT|UPDATE|DELETE|REPLACE)\b/.test(upper)) return 'dml';
    return 'ddl';
  }

  /** @private */
  _resultadoVazio(type) {
    return { type, rows: [], columns: [], changes: 0, lastInsertRowid: 0 };
  }
}

module.exports = { DbEngine };
