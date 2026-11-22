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
    // Corpo das funcoes escalares do usuario: db → Map<nomeMinusculo, avaliador>.
    this._funcoesUsuario = new Map();
    // Nomes ja registrados como UDF em cada conexao SQLite (nao ha API para remover).
    this._udfsRegistradas = new Map();
    // Conexao separada para avaliar o corpo das funcoes (usar a conexao de
    // consulta dentro de uma UDF causaria "database connection is busy").
    this._dbAvaliacao = null;
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
    // Funcoes criadas em execucoes anteriores precisam voltar a existir como
    // UDF SQLite ao reabrir o arquivo .db.
    for (const nome of catalogoSistema.listarFuncoes(db)) {
      const funcao = catalogoSistema.obterFuncao(db, nome);
      if (funcao) this._registrarFuncaoUsuario(db, funcao);
    }
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
    const alvo = this._resolverDatabaseQualificado(dbName, sql);
    const db = this.getOrCreateDatabase(alvo);
    this._validarEstadoDatabase(db, alvo, sql);
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
    this._validarEstadoDatabase(transacao.db, transacao.dbName, sql);
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

    if (this._dbAvaliacao) {
      try { this._dbAvaliacao.close(); } catch (_erro) { /* conexao em memoria */ }
      this._dbAvaliacao = null;
    }
    this.databases.clear();
    this.transactions.clear();
    this._funcoesUsuario.clear();
    this._udfsRegistradas.clear();
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
    this._resultadoRotina = null;
    let parametros = Array.isArray(params) ? params : params == null ? [] : [params];
    const restante = this._executarDdlDatabase(sqlBruto);
    const { restante: semDefaults, defaults } = this._executarDefaultsTabela(restante);
    const { restante: semForeignKeys, foreignKeys } = this._executarForeignKeysTabela(semDefaults);
    const semRotinas = this._executarDdlProcedures(semForeignKeys, db);
    const semFuncoes = this._executarDdlFunctions(semRotinas, db);
    let sqlTraduzido = this._traduzir(semFuncoes);
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
      this._criarTriggersDefaults(defaults, db);
      this._persistirForeignKeys(foreignKeys, db);
      if (this._resultadoRotina) {
        const resultado = this._resultadoRotina;
        this._resultadoRotina = null;
        return resultado;
      }
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

    this._criarTriggersDefaults(defaults, db);
    this._persistirForeignKeys(foreignKeys, db);

    const primeiroSelect = resultados.find(resultado => resultado.type === 'select');
    if (primeiroSelect) {
      this._aplicarTiposShim(sqlBruto, primeiroSelect);
      return this._normalizarDatasEmColunasNumericas(primeiroSelect);
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

  /**
   * ALTER TABLE ... ADD DEFAULT (...) FOR coluna nao existe no SQLite. Extrai
   * esses comandos do lote e devolve os dados para criar os triggers depois que
   * o CREATE TABLE correspondente tiver sido executado.
   * @private
   */
  _executarDefaultsTabela(sqlBruto) {
    let restante = String(sqlBruto || '');
    const defaults = [];
    const padrao = /\bALTER\s+TABLE\s+(?:(?:\[[^\]]+\]|"[^"]+"|\w+)\s*\.\s*)?(?:\[([^\]]+)\]|"([^"]+)"|(\w+))\s+ADD\s+DEFAULT\s*\((.+?)\)\s*FOR\s+(?:\[([^\]]+)\]|"([^"]+)"|(\w+))/gi;
    let correspondência;

    while ((correspondência = padrao.exec(restante)) !== null) {
      defaults.push({
        nomeTabela: correspondência[1] || correspondência[2] || correspondência[3],
        expressao: correspondência[4],
        nomeColuna: correspondência[5] || correspondência[6] || correspondência[7],
        expressaoTraduzida: String(this._traduzir(correspondência[4])).trim()
      });
      restante = restante.slice(0, correspondência.index)
        + restante.slice(correspondência.index + correspondência[0].length);
      padrao.lastIndex = correspondência.index;
    }

    return { restante, defaults };
  }

  /**
   * ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY nao existe no SQLite. Remove
   * o comando do lote e guarda a definicao para o catalogo sys.foreign_keys.
   * @private
   */
  _executarForeignKeysTabela(sqlBruto) {
    let restante = String(sqlBruto || '');
    const foreignKeys = [];
    const identificador = '(?:\\[[^\\]]+\\]|"[^"]+"|[A-Za-z_]\\w*)';
    const padrao = new RegExp(
      '\\bALTER\\s+TABLE\\s+(?:' + identificador + '\\s*\\.\\s*)*' +
      '(?<tabela>' + identificador + ')\\s+' +
      '(?:WITH\\s+(?:CHECK|NOCHECK)\\s+)?ADD\\s+' +
      '(?:CONSTRAINT\\s+(?<nome>' + identificador + ')\\s+)?' +
      'FOREIGN\\s+KEY\\s*\\(\\s*(?<coluna>' + identificador + ')\\s*\\)\\s+' +
      'REFERENCES\\s+(?:' + identificador + '\\s*\\.\\s*)*' +
      '(?<referenciada>' + identificador + ')\\s*\\(\\s*' +
      '(?<colunaRef>' + identificador + ')\\s*\\)',
      'gi'
    );
    const limpar = (valor) => String(valor || '')
      .replace(/^\[(.*)\]$/, '$1')
      .replace(/^"(.*)"$/, '$1');
    let correspondência;

    while ((correspondência = padrao.exec(restante)) !== null) {
      const grupos = correspondência.groups || {};
      const nomeTabela = limpar(grupos.tabela);
      const nomeColuna = limpar(grupos.coluna);
      const nome = limpar(grupos.nome) || `FK_${nomeTabela}_${nomeColuna}`;
      const chave = {
        nome,
        nomeTabela,
        nomeColuna,
        nomeReferenciada: limpar(grupos.referenciada),
        nomeColunaReferenciada: limpar(grupos.colunaRef)
      };
      foreignKeys.push(chave);

      restante = restante.slice(0, correspondência.index)
        + restante.slice(correspondência.index + correspondência[0].length);
      padrao.lastIndex = correspondência.index;
    }

    return { restante, foreignKeys };
  }

  /**
   * Persiste as FKs extraidas do lote e reconstrói o catálogo sys.foreign_keys.
   * Chamado depois que o CREATE TABLE das tabelas envolvidas foi executado, para
   * que a limpeza de FK órfãs da sincronização não remova a definição ainda.
   * @private
   */
  _persistirForeignKeys(foreignKeys, db) {
    if (!Array.isArray(foreignKeys) || foreignKeys.length === 0) return;
    const data = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const buscarObjeto = db.prepare('SELECT object_id FROM main.tables WHERE name = ?');
    const buscarColuna = db.prepare(
      'SELECT column_id FROM main.all_columns WHERE object_id = ? AND name = ?'
    );
    const buscarFk = db.prepare(
      'SELECT name FROM main.foreign_key_definitions WHERE name = ?'
    );

    for (const chave of foreignKeys) {
      // O SQLite aceita ALTER TABLE com WITH CHECK e uma constraint que nao
      // existe porque o comando e removido do lote. O SQL Server valida e
      // devolve os erros abaixo; sem isso o SSMS acha que a FK foi criada.
      const tabela = buscarObjeto.get(chave.nomeTabela);
      if (!tabela) {
        throw this._erroTsql(4902, 1,
          `Cannot find the object "dbo.${chave.nomeTabela}" because it does not exist or you do not have permissions.`);
      }
      const referenciada = buscarObjeto.get(chave.nomeReferenciada);
      if (!referenciada) {
        throw this._erroTsql(208, 1, `Invalid object name 'dbo.${chave.nomeReferenciada}'.`);
      }
      if (buscarFk.get(chave.nome)) {
        throw this._erroTsql(2714, 4,
          `There is already an object named '${chave.nome}' in the database.`);
      }
      if (!buscarColuna.get(tabela.object_id, chave.nomeColuna)) {
        throw this._erroTsql(207, 1, `Invalid column name '${chave.nomeColuna}'.`);
      }
      if (!buscarColuna.get(referenciada.object_id, chave.nomeColunaReferenciada)) {
        throw this._erroTsql(207, 1, `Invalid column name '${chave.nomeColunaReferenciada}'.`);
      }

      try {
        db.prepare(`
          INSERT OR REPLACE INTO main.foreign_key_definitions
            (name, table_name, column_name, referenced_table, referenced_column,
             create_date)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          chave.nome, chave.nomeTabela, chave.nomeColuna,
          chave.nomeReferenciada, chave.nomeColunaReferenciada, data
        );
      } catch (erro) {
        logger.debug(`[RDS SQL Server] Definicao de FK ignorada (${chave.nomeTabela}.${chave.nomeColuna}): ${erro.message}`);
      }
    }
    catalogoSistema.sincronizarCatalogoDatabase(db);
  }

  /**
   * Aplica os defaults extraidos como triggers AFTER INSERT e os registra no
   * catalogo do database para o SMO.
   * @private
   */
  _criarTriggersDefaults(defaults, db) {
    if (!Array.isArray(defaults) || defaults.length === 0) return;

    for (const { nomeTabela, nomeColuna, expressao, expressaoTraduzida } of defaults) {
      const tabelaSegura = nomeTabela.replace(/"/g, '""');
      const colunaSegura = nomeColuna.replace(/"/g, '""');
      const nomeDefault = `DF__${nomeTabela}__${nomeColuna}`;
      const nomeDefaultSeguro = nomeDefault.replace(/"/g, '""');

      try {
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS "${nomeDefaultSeguro}"
          AFTER INSERT ON "${tabelaSegura}"
          WHEN NEW."${colunaSegura}" IS NULL
          BEGIN
            UPDATE "${tabelaSegura}" SET "${colunaSegura}" = ${expressaoTraduzida}
            WHERE rowid = NEW.rowid;
          END
        `);
      } catch (erro) {
        logger.debug(`[RDS SQL Server] Trigger de default ignorado (${nomeTabela}.${nomeColuna}): ${erro.message}`);
      }

      const data = new Date().toISOString().slice(0, 19).replace('T', ' ');
      try {
        db.prepare(`
          INSERT OR REPLACE INTO main.default_definitions
            (table_name, column_name, name, definition, create_date)
          VALUES (?, ?, ?, ?, ?)
        `).run(nomeTabela, nomeColuna, nomeDefault, `(${expressao})`, data);
      } catch (erro) {
        logger.debug(`[RDS SQL Server] Definicao de default persistida ignorada (${nomeTabela}.${nomeColuna}): ${erro.message}`);
      }

      try {
        const objeto = db.prepare(
          "SELECT object_id FROM main.objects WHERE name = ? AND type = 'U'"
        ).get(nomeTabela);
        if (objeto) {
          const linhaColuna = db.prepare(
            'SELECT cid FROM pragma_table_info(?) WHERE name = ?'
          ).get(nomeTabela, nomeColuna);
          const parentColumnId = linhaColuna ? linhaColuna.cid + 1 : 1;
          const objectId = 900000000 + objeto.object_id * 1000 + parentColumnId;
          db.prepare(`
            INSERT OR REPLACE INTO main.default_constraints
              (name, object_id, parent_object_id, parent_column_id, create_date, modify_date, definition)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(nomeDefault, objectId, objeto.object_id, parentColumnId, data, data, `(${expressao})`);
          db.prepare(`
            INSERT OR REPLACE INTO main.objects
              (name, object_id, schema_id, principal_id, type, type_desc, create_date, parent_object_id)
            VALUES (?, ?, 1, 1, 'D', 'DEFAULT_CONSTRAINT', ?, ?)
          `).run(nomeDefault, objectId, data, objeto.object_id);
          db.prepare(
            'UPDATE main.all_columns SET default_object_id = ? WHERE object_id = ? AND column_id = ?'
          ).run(objectId, objeto.object_id, parentColumnId);
        }
      } catch (erro) {
        logger.debug(`[RDS SQL Server] Catalogo de default ignorado (${nomeTabela}.${nomeColuna}): ${erro.message}`);
      }
    }
  }

  /**
   * Procedures e a limpeza de historico de backup do script de DROP DATABASE
   * do SSMS não existem no SQLite. Executamos o efeito no catalogo e removemos
   * a instrução do lote antes da tradução.
   * @private
   */
  _executarDdlProcedures(sqlBruto, db) {
    let restante = String(sqlBruto || '');

    restante = restante.replace(
      /\bEXEC(?:UTE)?\s+(?:msdb\s*\.\s*(?:dbo\s*\.\s*)?)?sp_delete_database_backuphistory\b[^;]*/gi,
      ''
    );

    const nome = '(?:\\[[^\\]]+\\]|[A-Za-z_]\\w*)(?:\\s*\\.\\s*(?:\\[[^\\]]+\\]|[A-Za-z_]\\w*))?';
    const criacao = new RegExp(
      `\\b(CREATE|ALTER)\\s+(?:OR\\s+ALTER\\s+)?PROC(?:EDURE)?\\s+(${nome})([\\s\\S]*?)\\bAS\\b([\\s\\S]*)$`,
      'i'
    ).exec(restante);
    if (criacao) {
      catalogoSistema.criarProcedimento(db, {
        nome: criacao[2],
        definicao: criacao[0].trim().replace(/;+\s*$/, ''),
        corpo: criacao[4].trim().replace(/;+\s*$/, ''),
        parametros: this._parametrosProcedimento(criacao[3]),
        alterar: /^alter/i.test(criacao[1])
      });
      return restante.slice(0, criacao.index) + restante.slice(criacao.index + criacao[0].length);
    }

    const remocao = new RegExp(
      `\\bDROP\\s+PROC(?:EDURE)?\\s+(?:IF\\s+EXISTS\\s+)?(${nome})`,
      'i'
    ).exec(restante);
    if (remocao) {
      const trechoAteFim = restante.slice(remocao.index + remocao[0].length);
      const seExistir = /\bIF\s+EXISTS\b/i.test(remocao[0]);
      catalogoSistema.removerProcedimento(db, remocao[1], seExistir);
      return restante.slice(0, remocao.index) + trechoAteFim.replace(/^\s*;?/, '');
    }

    if ((this._nivelProcedimento || 0) >= 8) return restante;
    const execucao = /\bEXEC(?:UTE)?\s+(?:\[?dbo\]?\s*\.\s*)?(\[?[A-Za-z_][\w]*\]?)([\s\S]*)$/i.exec(restante);
    if (execucao && !/^(?:sp_|xp_)/i.test(execucao[1].replace(/\[|\]/g, ''))) {
      const procedimento = catalogoSistema.obterProcedimento(db, execucao[1]);
      if (procedimento) {
        const argumentos = this._argumentosExecProcedimento(execucao[2], procedimento.parametros);
        const declaracoes = procedimento.parametros.map((parametro, indice) => {
          const valor = argumentos[indice] || parametro.valorPadrao || 'NULL';
          return `DECLARE ${parametro.nome} ${parametro.tipo} = ${valor}`;
        });
        const corpo = [declaracoes.join('; '), procedimento.corpo || procedimento.definicao]
          .filter(Boolean)
          .join('; ');
        this._nivelProcedimento = (this._nivelProcedimento || 0) + 1;
        try {
          this._resultadoRotina = this._executar(db, corpo);
        } finally {
          this._nivelProcedimento -= 1;
        }
        return restante.slice(0, execucao.index) + restante.slice(execucao.index + execucao[0].length);
      }
    }

    return restante;
  }

  /**
   * Funcoes escalares tambem nao existem no SQLite. Registramos o corpo no
   * catalogo (para aparecer em sys.objects/sys.sql_modules) e uma UDF que
   * avalia o RETURN da funcao em uma conexao separada.
   * @private
   */
  _executarDdlFunctions(sqlBruto, db) {
    let restante = String(sqlBruto || '');
    const nome = '(?:\\[[^\\]]+\\]|[A-Za-z_]\\w*)(?:\\s*\\.\\s*(?:\\[[^\\]]+\\]|[A-Za-z_]\\w*))?';

    const criacao = new RegExp(
      `\\b(CREATE|ALTER)\\s+(?:OR\\s+ALTER\\s+)?FUNCTION\\s+(${nome})\\s*\\(([\\s\\S]*?)\\)\\s*RETURNS\\s+` +
      `([A-Za-z_][\\w]*(?:\\s*\\([^)]*\\))?)\\s+AS\\s+([\\s\\S]*)$`,
      'i'
    ).exec(restante);
    if (criacao) {
      const funcao = catalogoSistema.criarFuncao(db, {
        nome: criacao[2],
        definicao: criacao[0],
        corpo: this._limparCorpoRotina(criacao[5]),
        parametros: this._parametrosProcedimento(criacao[3]),
        tipoRetorno: criacao[4],
        alterar: /^alter/i.test(criacao[1])
      });
      this._registrarFuncaoUsuario(db, catalogoSistema.obterFuncao(db, funcao.nome));
      const rotulo = /^alter/i.test(criacao[1]) ? 'FunctionAltered' : 'FunctionCreated';
      return `${restante.slice(0, criacao.index)}SELECT 1 AS [${rotulo}]`;
    }

    const remocao = new RegExp(
      `\\bDROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(${nome})`,
      'i'
    ).exec(restante);
    if (remocao) {
      const seExistir = /\bIF\s+EXISTS\b/i.test(remocao[0]);
      const removida = catalogoSistema.removerFuncao(db, remocao[1], seExistir);
      const mapa = this._funcoesUsuario.get(db);
      if (mapa && removida) {
        const nomeSimples = String(remocao[1]).split('.').pop().trim().replace(/^\[|\]$/g, '');
        mapa.delete(nomeSimples.toLowerCase());
      }
      return `${restante.slice(0, remocao.index)}SELECT 1 AS [FunctionDropped]` +
        restante.slice(remocao.index + remocao[0].length);
    }

    return restante;
  }

  /** Remove BEGIN/END externo e ponto e virgula final do corpo da rotina. @private */
  _limparCorpoRotina(corpo) {
    return String(corpo || '')
      .trim()
      .replace(/^BEGIN\b/i, '')
      .replace(/\bEND\s*;?\s*$/i, '')
      .replace(/;+\s*$/, '')
      .trim();
  }

  /** Registra (ou atualiza) a UDF de uma funcao escalar do usuario. @private */
  _registrarFuncaoUsuario(db, funcao) {
    if (!funcao) return;
    const chave = funcao.nome.toLowerCase();
    let mapa = this._funcoesUsuario.get(db);
    if (!mapa) {
      mapa = new Map();
      this._funcoesUsuario.set(db, mapa);
    }
    let registradas = this._udfsRegistradas.get(db);
    if (!registradas) {
      registradas = new Set();
      this._udfsRegistradas.set(db, registradas);
    }

    mapa.set(chave, (argumentos) => this._avaliarFuncaoUsuario(funcao, argumentos));
    if (registradas.has(chave)) return;
    registradas.add(chave);
    db.function(chave, { deterministic: true, varargs: true }, (...argumentos) => {
      const avaliador = mapa.get(chave);
      if (!avaliador) throw new Error(`Invalid object name '${funcao.nome}'.`);
      return avaliador(argumentos);
    });
  }

  /** Devolve a conexao usada para avaliar corpos de funcoes do usuario. @private */
  _obterDatabaseAvaliacao() {
    if (!this._dbAvaliacao) {
      this._dbAvaliacao = new Database(':memory:');
      catalogoSistema.registrarFuncoesData(this._dbAvaliacao);
      const agora = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
      this._dbAvaliacao.function('GETDATE', agora);
      this._dbAvaliacao.function('SYSDATETIME', agora);
      this._dbAvaliacao.function('GETUTCDATE', agora);
      this._dbAvaliacao.function('NEWID', () => crypto.randomUUID());
    }
    return this._dbAvaliacao;
  }

  /**
   * Avalia uma funcao escalar simples: DECLARE/SET/SELECT de variaveis seguidos
   * de RETURN. Expressoes complexas (IF, WHILE, CURSOR) continuam fora do
   * subconjunto suportado.
   * @private
   */
  _avaliarFuncaoUsuario(funcao, argumentos) {
    const db = this._obterDatabaseAvaliacao();
    const variaveis = new Map();
    funcao.parametros.forEach((parametro, indice) => {
      const valor = argumentos[indice] == null ? parametro.valorPadrao : argumentos[indice];
      variaveis.set(String(parametro.nome).toLowerCase(), this._literalSql(valor));
    });

    let retorno = null;
    for (const instrucao of this._dividirInstrucoesFuncao(funcao.corpo || funcao.definicao)) {
      const texto = instrucao.trim();
      if (!texto) continue;
      let correspondencia = /^DECLARE\s+(@[A-Za-z_]\w*)(?:\s+[\w\s(),]+?)?(?:\s*=\s*([\s\S]*))?$/i.exec(texto);
      if (correspondencia) {
        const chave = correspondencia[1].toLowerCase();
        variaveis.set(
          chave,
          correspondencia[2] == null ? 'NULL' : this._substituirVariaveisFuncao(correspondencia[2], variaveis)
        );
        continue;
      }
      correspondencia = /^(?:SET|SELECT)\s+(@[A-Za-z_]\w*)\s*=\s*([\s\S]*)$/i.exec(texto);
      if (correspondencia) {
        variaveis.set(
          correspondencia[1].toLowerCase(),
          this._substituirVariaveisFuncao(correspondencia[2], variaveis)
        );
        continue;
      }
      correspondencia = /^RETURN\s+([\s\S]*)$/i.exec(texto);
      if (correspondencia) {
        retorno = this._substituirVariaveisFuncao(correspondencia[1], variaveis);
      }
    }
    if (retorno == null) return null;

    let expressao = retorno
      .replace(/\{\s*d\s*(['"])([\s\S]*?)\1\s*\}/gi, '$1$2$1')
      .replace(/\bN'/g, "'")
      .replace(/\b(DATEDIFF|DATEADD)\s*\(\s*([A-Za-z_]\w*)\s*,/gi, "$1('$2',");
    const linha = db.prepare(`SELECT ${expressao} AS [resultado]`).get();
    return linha ? linha.resultado : null;
  }

  /**
   * Divide o corpo da funcao em instrucoes. O T-SQL permite separar comandos
   * apenas por quebra de linha (sem ponto e virgula), entao cada linha que
   * comeca com um verbo T-SQL inicia uma instrucao.
   * @private
   */
  _dividirInstrucoesFuncao(corpo) {
    const limpo = String(corpo || '')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ');
    const instrucoes = [];
    let atual = '';
    for (const linha of limpo.split(/\r?\n/)) {
      const conteudo = linha.trim();
      if (!conteudo) continue;
      if (/^(?:DECLARE|SET|SELECT|RETURN|BEGIN|END|IF|WHILE)\b/i.test(conteudo) && atual.trim()) {
        instrucoes.push(atual.trim());
        atual = '';
      }
      atual += `${atual ? '\n' : ''}${conteudo}`;
    }
    if (atual.trim()) instrucoes.push(atual.trim());

    // Ainda pode haver mais de um comando na mesma linha, separado por ';'.
    return instrucoes.flatMap((instrucao) => {
      const partes = [];
      let parte = '';
      let aspas = null;
      let profundidade = 0;
      for (let i = 0; i < instrucao.length; i += 1) {
        const caractere = instrucao[i];
        if (aspas) {
          parte += caractere;
          if (caractere === aspas) {
            if (instrucao[i + 1] === aspas) { parte += instrucao[i + 1]; i += 1; } else { aspas = null; }
          }
          continue;
        }
        if (caractere === "'" || caractere === '"') { aspas = caractere; parte += caractere; continue; }
        if (caractere === '(') profundidade += 1;
        if (caractere === ')') profundidade -= 1;
        if (caractere === ';' && profundidade <= 0) {
          if (parte.trim()) partes.push(parte.trim());
          parte = '';
          continue;
        }
        parte += caractere;
      }
      if (parte.trim()) partes.push(parte.trim());
      return partes;
    });
  }

  /** Substitui @variaveis por expressoes SQLite, ignorando texto entre aspas. @private */
  _substituirVariaveisFuncao(texto, variaveis) {
    const mascara = ' '.repeat(texto.length).split('');
    let emString = false;
    for (let i = 0; i < texto.length; i += 1) {
      if (texto[i] === "'") { emString = !emString; continue; }
      if (!emString && texto[i] === '@') {
        const correspondencia = /^@[A-Za-z_]\w*/.exec(texto.slice(i));
        if (correspondencia) {
          const chave = correspondencia[0].toLowerCase();
          if (variaveis.has(chave)) {
            for (let j = 0; j < correspondencia[0].length; j += 1) mascara[i + j] = '*';
          }
          i += correspondencia[0].length - 1;
        }
      }
    }
    let resultado = '';
    let deslocamento = 0;
    for (;;) {
      const inicio = mascara.indexOf('*', deslocamento);
      if (inicio < 0) { resultado += texto.slice(deslocamento); break; }
      resultado += texto.slice(deslocamento, inicio);
      let fim = inicio;
      while (mascara[fim] === '*') fim += 1;
      const chave = texto.slice(inicio, fim).toLowerCase();
      resultado += variaveis.has(chave) ? `(${variaveis.get(chave)})` : texto.slice(inicio, fim);
      deslocamento = fim;
    }
    return resultado;
  }

  /** Converte um valor JS em literal SQL para avaliacao da funcao. @private */
  _literalSql(valor) {
    if (valor == null) return 'NULL';
    if (typeof valor === 'number' || typeof valor === 'bigint') return String(valor);
    if (typeof valor === 'boolean') return valor ? '1' : '0';
    if (valor instanceof Date) return `'${valor.toISOString().slice(0, 19).replace('T', ' ')}'`;
    return `'${String(valor).replace(/'/g, "''")}'`;
  }

  /** Extrai `@p INT = 1, @q VARCHAR(10) OUTPUT` da declaracao de procedure. @private */
  _parametrosProcedimento(cabecalho) {
    const texto = String(cabecalho || '').trim()
      .replace(/^\(/, '')
      .replace(/\)\s*$/, '')
      .trim();
    if (!texto) return [];
    return this._dividirPorVirgula(texto).map((trecho) => {
      const parametro = /^(@[A-Za-z_]\w*)\s+([A-Za-z_][\w]*(?:\s*\([^)]*\))?)([^=]*?)(?:\s*=\s*([\s\S]*?))?$/i.exec(trecho.trim());
      if (!parametro) return null;
      return {
        nome: parametro[1],
        tipo: parametro[2].replace(/\s+/g, ' '),
        isOutput: /\b(?:OUT|OUTPUT)\b/i.test(parametro[3] || ''),
        valorPadrao: parametro[4] == null ? null : parametro[4].trim()
      };
    }).filter(Boolean);
  }

  /** Separa argumentos de EXEC respeitando strings e parenteses. @private */
  _dividirPorVirgula(texto) {
    const partes = [];
    let atual = '';
    let profundidade = 0;
    let aspas = false;
    let colchetes = false;
    let crase = false;

    for (let i = 0; i < texto.length; i += 1) {
      const caractere = texto[i];
      if (aspas) {
        atual += caractere;
        if (caractere === "'") {
          if (texto[i + 1] === "'") { atual += texto[++i]; } else { aspas = false; }
        }
        continue;
      }
      if (colchetes || crase) {
        atual += caractere;
        if ((colchetes && caractere === ']') || (crase && caractere === '`')) {
          colchetes = false;
          crase = false;
        }
        continue;
      }
      if (caractere === "'") { aspas = true; atual += caractere; continue; }
      if (caractere === '[') { colchetes = true; atual += caractere; continue; }
      if (caractere === '`') { crase = true; atual += caractere; continue; }
      if (caractere === '(') profundidade += 1;
      if (caractere === ')') profundidade = Math.max(0, profundidade - 1);
      if (caractere === ',' && profundidade === 0) {
        partes.push(atual.trim());
        atual = '';
        continue;
      }
      atual += caractere;
    }
    if (atual.trim()) partes.push(atual.trim());
    return partes;
  }

  /** Converte `EXEC @p = 1, 2` em valores na ordem dos parametros. @private */
  _argumentosExecProcedimento(texto, parametros = []) {
    const valores = new Array(parametros.length).fill(null);
    let proximo = 0;
    this._dividirPorVirgula(String(texto || '').replace(/^\s*\(?/, '').replace(/\)\s*;?\s*$/, ''))
      .forEach((parte) => {
        let valor = parte.trim().replace(/\s+(?:OUT|OUTPUT)$/i, '');
        const nomeado = /^(@[A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(valor);
        if (nomeado) {
          const indice = parametros.findIndex(
            (parametro) => parametro.nome.toLowerCase() === nomeado[1].toLowerCase()
          );
          if (indice >= 0) valores[indice] = nomeado[2].trim();
          return;
        }
        if (proximo < parametros.length) valores[proximo] = valor;
        proximo += 1;
      });
    return valores;
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
    nome = nome.split('.').pop().replace(/^["'[`]|["'\]`]$/g, '');
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
            ON CONFLICT(name) DO UPDATE SET
              database_id = excluded.database_id,
              create_date = COALESCE(sys.databases.create_date, excluded.create_date)
          `).run(nome, proximo, new Date().toISOString());
          if (ajustes.length) {
            const conjuntos = ajustes.map(([coluna]) => `${coluna} = ?`).join(', ');
            alvo.prepare(`UPDATE sys.databases SET ${conjuntos} WHERE name = ?`)
              .run(...ajustes.map(([, valor]) => valor), nome);
          }
        } else {
          alvo.prepare('DELETE FROM sys.databases WHERE name = ?').run(nome);
          try {
            alvo.prepare('DELETE FROM sys.master_files WHERE name IN (?, ?)')
              .run(nome, `${nome}_log`);
          } catch (erro) {
            logger.debug(`[RDS SQL Server DbEngine] Falha ao limpar master_files de '${nome}': ${erro.message}`);
          }
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
   * Versoes anteriores gravaram datetime('now') como TEXTO em colunas INTEGER.
   * O TDS converte texto em coluna numerica para 0; normalizamos esse legado
   * para Unix timestamp para que consultas antigas tambem nao devolvam zero.
   * @private
   */
  _normalizarDatasEmColunasNumericas(resultado) {
    if (!resultado || resultado.type !== 'select' || !Array.isArray(resultado.columns)) {
      return resultado;
    }
    const indiceNumericos = resultado.columns
      .map((coluna, indice) => (
        /^(?:INT|INTEGER|BIGINT|SMALLINT|TINYINT)$/i.test(String((coluna && coluna.type) || ''))
          ? indice
          : -1
      ))
      .filter((indice) => indice >= 0);
    if (indiceNumericos.length === 0) return resultado;

    let alterou = false;
    const linhas = (resultado.rows || []).map((linha) => {
      if (!linha || typeof linha !== 'object') return linha;
      const copia = Array.isArray(linha) ? [...linha] : { ...linha };
      for (const indice of indiceNumericos) {
        const chave = Array.isArray(linha) ? indice : resultado.columns[indice].name;
        const valor = copia[chave];
        if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(valor)) {
          continue;
        }
        const sufixoFuso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(valor) ? '' : 'Z';
        const milissegundos = Date.parse(`${valor.replace(' ', 'T')}${sufixoFuso}`);
        if (!Number.isFinite(milissegundos)) continue;
        copia[chave] = Math.floor(milissegundos / 1000);
        alterou = true;
      }
      return copia;
    });
    return alterou ? { ...resultado, rows: linhas } : resultado;
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
    const alterDatabase = this._traduzirAlterDatabase(sql);
    if (alterDatabase) {
      this._aplicarAlterDatabase(db, alterDatabase);
      return this._resultadoVazio('ddl');
    }
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

  /**
   * Detecta consultas qualificadas como [db].dbo.obj ou [db].sys.obj e roteia
   * para o database indicado quando ele existe no simulador.
   * @private
   */
  _resolverDatabaseQualificado(dbNamePadrao, sqlBruto) {
    const sql = String(sqlBruto || '');
    const padrao = /(?:\[(?<b>[^\]]+)\]|"(?<q>[^"]+)"|(?<p>[A-Za-z_][\w$#@]*))\s*\.\s*(?:\[?(?:dbo|sys)\]?|"?(?:dbo|sys)"?)\s*\./gi;
    let m;
    while ((m = padrao.exec(sql)) !== null) {
      const nome = m.groups.b || m.groups.q || m.groups.p;
      if (!nome) continue;
      const lower = nome.toLowerCase();
      if (['master', 'msdb', 'tempdb', 'model'].includes(lower)) continue;
      if (lower === String(dbNamePadrao || '').toLowerCase()) return dbNamePadrao;
      if (this._databaseExiste(nome)) return nome;
    }
    return dbNamePadrao;
  }

  /**
   * Valida se o database pode executar a instrução conforme state/read_only.
   * @private
   */
  _validarEstadoDatabase(db, dbName, sql) {
    if (!db || !dbName) return;
    const nome = String(dbName);
    if (nome.toLowerCase() === 'master') return;
    let linha;
    try {
      linha = db.prepare('SELECT state, state_desc, is_read_only, name FROM sys.databases WHERE name = ?')
        .get(nome);
    } catch (_erro) {
      return; // catálogo ainda não pronto
    }
    if (!linha) return;
    const tipo = this._detectarTipo(String(sql || ''));
    const state = Number(linha.state);
    if (state === 6) {
      throw this._erroTsql(942, 1,
        `Database '${linha.name}' cannot be opened because it is offline.`);
    }
    if (state !== 0) {
      throw this._erroTsql(942, 1,
        `Database '${linha.name}' is not currently available (state: ${linha.state_desc || state}).`);
    }
    if (Number(linha.is_read_only) === 1 && tipo !== 'select') {
      throw this._erroTsql(3906, 1,
        `Failed to update database "${linha.name}" because the database is read-only.`);
    }
  }

  /**
   * Interpreta comandos ALTER DATABASE básicos usados pelo SSMS (Take Offline/Online).
   * @private
   */
  _traduzirAlterDatabase(sql) {
    // Remove comentários/literais apenas para casar o comando; ALTER DATABASE
    // não possui conteúdo sensível a mascaramento aqui.
    const mascarado = String(sql)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ')
      .replace(/'[^']*'/g, "''");
    const m = mascarado.match(
      /^\s*ALTER\s+DATABASE\s+(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z_][\w$#@]*))\s+SET\s+([\s\S]+)$/i
    );
    if (!m) return null;
    const nome = m[1] || m[2] || m[3];
    const corpo = m[4].replace(/;+\s*$/, '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (corpo === 'OFFLINE') return { nome, state: 6, stateDesc: 'OFFLINE' };
    if (corpo === 'ONLINE') return { nome, state: 0, stateDesc: 'ONLINE' };
    if (corpo === 'READ_ONLY' || corpo === 'READONLY') return { nome, isReadOnly: 1 };
    if (corpo === 'READ_WRITE' || corpo === 'READWRITE') return { nome, isReadOnly: 0 };
    if (corpo === 'SINGLE_USER' || corpo === 'RESTRICTED_USER' || corpo === 'MULTI_USER') {
      return { nome, somenteUserAccess: corpo };
    }
    return null;
  }

  /**
   * Aplica estado básico de database no catálogo sys.databases.
   * @private
   */
  _aplicarAlterDatabase(db, acao) {
    for (const alvo of this.databases.values()) {
      try {
        if (acao.state !== undefined) {
          alvo.prepare('UPDATE sys.databases SET state = ?, state_desc = ? WHERE name = ?')
            .run(acao.state, acao.stateDesc, acao.nome);
        }
        if (acao.isReadOnly !== undefined) {
          alvo.prepare('UPDATE sys.databases SET is_read_only = ? WHERE name = ?')
            .run(acao.isReadOnly, acao.nome);
        }
      } catch (_erro) { /* ignora banco sem catálogo carregado */ }
    }
    return true;
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
