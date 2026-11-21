'use strict';

/**
 * Tradutor de SQL do SQL Server (T-SQL) para SQL compatível com SQLite.
 *
 * Responsabilidades:
 * - remover comentários, separadores de lote (GO) e ruído (SET NOCOUNT ON, ON [PRIMARY]);
 * - traduzir funções do T-SQL (GETDATE, NEWID, ISNULL, LEN, DATEADD);
 * - converter TOP em LIMIT, reposicionando-o após ORDER BY;
 * - converter IDENTITY em AUTOINCREMENT e tipos de dados em comandos DDL;
 * - traduzir MERGE simples e UPDATE ... JOIN simples;
 * - reconhecer o batch de descoberta de servidor do SSMS e devolver metadados sintéticos;
 * - remover DECLARE/SET e desembrulhar o subconjunto procedural usado por SSMS
 *   (IF com condição entre parênteses, TRY/CATCH e EXEC sp_executesql literal).
 *
 * IMPORTANTE: translate() nunca altera a string recebida. As substituições são
 * feitas sobre máscaras de mesmo tamanho, que ignoram literais de texto,
 * identificadores entre colchetes e comentários.
 */

const EXPRESSAO_NEWID =
  "lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)))";

// Tipos convertidos somente dentro de CREATE TABLE / ALTER TABLE.
// A ordem importa: formas mais específicas vêm primeiro.
const TIPOS_DDL = [
  [/\bNVARCHAR\s*\(\s*(?:\d+|MAX)\s*\)/i, 'TEXT'],
  [/\bVARCHAR\s*\(\s*(?:\d+|MAX)\s*\)/i, 'TEXT'],
  [/\bNCHAR\s*\(\s*\d+\s*\)/i, 'TEXT'],
  [/\bCHAR\s*\(\s*\d+\s*\)/i, 'TEXT'],
  [/\bUNIQUEIDENTIFIER\b/i, 'TEXT'],
  [/\bSYSNAME\b/i, 'TEXT'],
  [/\bXML\b/i, 'TEXT'],
  [/\bTEXT\b/i, 'TEXT'],
  [/\bSMALLDATETIME\b/i, 'TEXT'],
  [/\bDATETIME2\s*\(\s*\d+\s*\)/i, 'TEXT'],
  [/\bDATETIME2\b/i, 'TEXT'],
  [/\bDATETIME\b/i, 'TEXT'],
  [/\bDATE\b/i, 'TEXT'],
  [/\bTIME\s*\(\s*\d+\s*\)/i, 'TEXT'],
  [/\bTIME\b/i, 'TEXT'],
  [/\bSMALLMONEY\b/i, 'REAL'],
  [/\bMONEY\b/i, 'REAL'],
  [/\bDECIMAL\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\)/i, 'REAL'],
  [/\bNUMERIC\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\)/i, 'REAL'],
  [/\bDOUBLE\s+PRECISION\b/i, 'REAL'],
  [/\bDOUBLE\b/i, 'REAL'],
  [/\bFLOAT\b/i, 'REAL'],
  [/\bREAL\b/i, 'REAL'],
  [/\bVARBINARY\s*\(\s*(?:\d+|MAX)\s*\)/i, 'BLOB'],
  [/\bBINARY\s*\(\s*\d+\s*\)/i, 'BLOB'],
  [/\bIMAGE\b/i, 'BLOB'],
  [/\bBIGINT\b/i, 'INTEGER'],
  [/\bSMALLINT\b/i, 'INTEGER'],
  [/\bTINYINT\b/i, 'INTEGER'],
  [/\bINT\b/i, 'INTEGER'],
  [/\bBIT\b/i, 'INTEGER']
];

// Unidades aceitas por DATEADD e seus equivalentes em modificadores SQLite.
const UNIDADES_DATEADD = {
  year: { modificador: 'years', fator: 1 },
  yyyy: { modificador: 'years', fator: 1 },
  yy: { modificador: 'years', fator: 1 },
  quarter: { modificador: 'months', fator: 3 },
  qq: { modificador: 'months', fator: 3 },
  q: { modificador: 'months', fator: 3 },
  month: { modificador: 'months', fator: 1 },
  mm: { modificador: 'months', fator: 1 },
  m: { modificador: 'months', fator: 1 },
  dayofyear: { modificador: 'days', fator: 1 },
  dy: { modificador: 'days', fator: 1 },
  day: { modificador: 'days', fator: 1 },
  dd: { modificador: 'days', fator: 1 },
  d: { modificador: 'days', fator: 1 },
  week: { modificador: 'days', fator: 7 },
  wk: { modificador: 'days', fator: 7 },
  ww: { modificador: 'days', fator: 7 },
  weekday: { modificador: 'days', fator: 1 },
  dw: { modificador: 'days', fator: 1 },
  w: { modificador: 'days', fator: 1 },
  hour: { modificador: 'hours', fator: 1 },
  hh: { modificador: 'hours', fator: 1 },
  minute: { modificador: 'minutes', fator: 1 },
  mi: { modificador: 'minutes', fator: 1 },
  n: { modificador: 'minutes', fator: 1 },
  second: { modificador: 'seconds', fator: 1 },
  ss: { modificador: 'seconds', fator: 1 },
  s: { modificador: 'seconds', fator: 1 }
};

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class SqlTranslator {
  /**
   * @param {string} engine - motor do RDS, por exemplo 'sqlserver-se'.
   */
  constructor(engine = 'sqlserver-se') {
    if (typeof engine !== 'string' || !/^sqlserver-/i.test(engine)) {
      const erro = new Error(
        `Engine inválido: ${engine}. Use um valor iniciado com 'sqlserver-'.`
      );
      erro.code = 'InvalidParameterValue';
      throw erro;
    }
    this.engine = engine;
  }

  /**
   * Traduz uma instrução T-SQL para SQLite. Nunca muta a entrada.
   *
   * @param {string} sql
   * @returns {string}
   */
  translate(sql) {
    if (typeof sql !== 'string') {
      return sql;
    }

    let resultado = this._removerComentarios(sql);
    resultado = this.splitBatches(resultado).join(' ');
    resultado = this._normalizarWhitespace(resultado);
    resultado = this._traduzirMetadadosCliente(resultado);
    resultado = this._removerPrefixoN(resultado);
    resultado = this._traduzirParametrosSmo(resultado);
    resultado = this._removerRuido(resultado);
    resultado = this._removerEsquema(resultado);
    resultado = this._traduzirLiteraisHex(resultado);
    resultado = this._traduzirProcedural(resultado);
    resultado = this._traduzirVariaveisSistema(resultado);
    resultado = this._traduzirConcatenacao(resultado);
    resultado = this._traduzirMerge(resultado);
    resultado = this._traduzirUpdateJoin(resultado);
    resultado = this._traduzirFuncoes(resultado);
    resultado = this._traduzirTop(resultado);
    resultado = this._traduzirDdl(resultado);
    resultado = this._normalizarWhitespace(resultado);

    return resultado;
  }

  /**
   * Separa o SQL em lotes usando GO (fora de literais de texto e comentários).
   *
   * @param {string} sql
   * @returns {string[]}
   */
  splitBatches(sql) {
    if (typeof sql !== 'string') {
      return [];
    }

    const máscara = this._mascarar(sql);
    const código = máscara.code;
    const lotes = [];
    let início = 0;
    let correspondedência;
    const regex = /\bGO\b/gi;

    while ((correspondedência = regex.exec(código)) !== null) {
      const fimPalette = correspondedência.index + correspondedência[0].length;
      const caractereAntes =
        correspondedência.index === 0 ? '' : código[correspondedência.index - 1];
      const caractereDepois = fimPalette >= código.length ? '' : código[fimPalette];
      const limiteAntes = caractereAntes === '' || /[\s;]/.test(caractereAntes);
      const limiteDepois = caractereDepois === '' || /[\s;]/.test(caractereDepois);

      if (!limiteAntes || !limiteDepois) {
        continue;
      }

      lotes.push(sql.slice(início, correspondedência.index));
      início = fimPalette;
      // O ponto e vírgula depois de GO faz parte do separador, não do lote.
      while (início < sql.length && /[\s;]/.test(sql[início])) {
        início += 1;
      }
    }

    lotes.push(sql.slice(início));

    return lotes
      .map((lote) => lote.trim().replace(/;+\s*$/, '').trim())
      .filter((lote) => lote.length > 0);
  }

  /**
   * Constrói máscaras de mesmo tamanho do SQL original. `code` esconde textos,
   * identificadores entre colchetes/aspas e comentários; `noStrings` esconde
   * apenas textos e comentários (útil para ON [PRIMARY]).
   *
   * @private
   */
  _mascarar(sql) {
    let code = '';
    let noStrings = '';
    const tokens = [];
    let i = 0;

    while (i < sql.length) {
      const caractere = sql[i];

      if (caractere === "'") {
        const início = i;
        i += 1;
        while (i < sql.length) {
          if (sql[i] === "'" && sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          if (sql[i] === "'") {
            i += 1;
            break;
          }
          i += 1;
        }
        const espaço = ' '.repeat(i - início);
        code += espaço;
        noStrings += espaço;
        tokens.push({ tipo: 'texto', início, fim: i, valor: sql.slice(início, i) });
        continue;
      }

      if (caractere === '[' || caractere === '"') {
        const fecho = caractere === '[' ? ']' : '"';
        const início = i;
        i += 1;
        while (i < sql.length) {
          if (caractere === '[' && sql[i] === ']' && sql[i + 1] === ']') {
            i += 2;
            continue;
          }
          if (sql[i] === fecho) {
            i += 1;
            break;
          }
          i += 1;
        }
        const valor = sql.slice(início, i);
        code += ' '.repeat(valor.length);
        noStrings += valor;
        tokens.push({
          tipo: caractere === '[' ? 'colchete' : 'aspas',
          início,
          fim: i,
          valor
        });
        continue;
      }

      if (caractere === '-' && sql[i + 1] === '-') {
        const início = i;
        i += 2;
        while (i < sql.length && sql[i] !== '\n') {
          i += 1;
        }
        const espaço = ' '.repeat(i - início);
        code += espaço;
        noStrings += espaço;
        tokens.push({ tipo: 'comentario', início, fim: i, valor: sql.slice(início, i) });
        continue;
      }

      if (caractere === '/' && sql[i + 1] === '*') {
        const início = i;
        let profundidade = 1;
        i += 2;
        while (i < sql.length && profundidade > 0) {
          if (sql[i] === '/' && sql[i + 1] === '*') {
            profundidade += 1;
            i += 2;
            continue;
          }
          if (sql[i] === '*' && sql[i + 1] === '/') {
            profundidade -= 1;
            i += 2;
            continue;
          }
          i += 1;
        }
        const espaço = ' '.repeat(i - início);
        code += espaço;
        noStrings += espaço;
        tokens.push({ tipo: 'comentario', início, fim: i, valor: sql.slice(início, i) });
        continue;
      }

      const início = i;
      if (/[A-Za-z0-9_@#$]/.test(caractere)) {
        while (i < sql.length && /[A-Za-z0-9_@#$]/.test(sql[i])) {
          i += 1;
        }
      } else {
        i += 1;
      }
      const valor = sql.slice(início, i);
      code += valor;
      noStrings += valor;
      tokens.push({
        tipo: valor.startsWith('@') ? 'variavel' : /^\w/.test(valor) ? 'palavra' : 'pontuacao',
        início,
        fim: i,
        valor
      });
    }

    return { code, noStrings, tokens, sql };
  }

  /** Remove comentários preservando o restante da string. @private */
  _removerComentarios(sql) {
    const tokens = this._mascarar(sql).tokens.filter((token) => token.tipo === 'comentario');
    if (tokens.length === 0) {
      return sql;
    }
    let resultado = sql;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const token = tokens[i];
      resultado = resultado.slice(0, token.início) + resultado.slice(token.fim);
    }
    return resultado;
  }

  /** Colapsa espaços, tabulações e quebras de linha. @private */
  _normalizarWhitespace(sql) {
    return sql.replace(/\s+/g, ' ').trim();
  }

  /** Remove ruído de conexão específico do SQL Server/ODBC. @private */
  _removerRuido(sql) {
    // Clientes ODBC (sqlcmd, JDBC, tedious) enviam SETs de sessão antes da consulta.
    // Eles não têm equivalente no SQLite e devem desaparecer sem afetar `SET @var = ...`.
    const opcoesSessao = [
      'ANSI_DEFAULTS',
      'ANSI_NULL_DFLT_OFF',
      'ANSI_NULL_DFLT_ON',
      'ANSI_NULLS',
      'ANSI_PADDING',
      'ANSI_WARNINGS',
      'ARITHABORT',
      'ARITHIGNORE',
      'CONCAT_NULL_YIELDS_NULL',
      'CURSOR_CLOSE_ON_COMMIT',
      'FMTONLY',
      'FORCEPLAN',
      'IMPLICIT_TRANSACTIONS',
      'NOCOUNT',
      'NOEXEC',
      'NUMERIC_ROUNDABORT',
      'PARSEONLY',
      'QUOTED_IDENTIFIER',
      'REMOTE_PROC_TRANSACTIONS',
      'STATISTICS\\s+(?:IO|PROFILE|TIME|XML)',
      'TEXTSIZE',
      'XACT_ABORT'
    ].join('|');

    let resultado = this._substituirTodos(
      sql,
      `\\bSET\\s+(?:${opcoesSessao})\\s+(?:ON|OFF|-?\\d+)\\b`,
      () => ''
    );

    // Opções com valores textuais ou multinível enviadas pelo SqlClient/SSMS.
    resultado = this._substituirTodos(
      resultado,
      '\\bSET\\s+(?:ROWCOUNT|LOCK_TIMEOUT|QUERY_GOVERNOR_COST_LIMIT)\\s+-?\\d+\\b|' +
        '\\bSET\\s+DEADLOCK_PRIORITY\\s+(?:LOW|NORMAL|HIGH|-?\\d+)\\b|' +
        '\\bSET\\s+TRANSACTION\\s+ISOLATION\\s+LEVEL\\s+' +
        '(?:READ\\s+(?:UNCOMMITTED|COMMITTED|REPEATABLE|SNAPSHOT)|SERIALIZABLE)\\b',
      () => ''
    );

    return resultado;
  }

  /** Remove o prefixo `N` das literais Unicode (N'texto'). @private */
  _removerPrefixoN(sql) {
    return sql.replace(/\bN(?=')/gi, '');
  }

  /**
   * O SFC/SMO envia sp_executesql com parametros nomeados @_msparam_N. O SQLite
   * so entende placeholders posicionais, e o DbEngine ja recebe os valores.
   * @private
   */
  _traduzirParametrosSmo(sql) {
    return sql.replace(/@_msparam_\d+\b/gi, '?');
  }

  /**
   * Converte parametros nomeados (@p, @nome) em placeholders quando o chamador
   * informou valores ligados. A mascara preserva `@` dentro de textos e nomes.
   * @param {string} sql
   * @param {number} quantidade
   * @returns {string}
   */
  substituirParametros(sql, quantidade) {
    if (!quantidade || typeof sql !== 'string') return sql;
    const código = this._mascarar(sql).code;
    let resultado = '';
    let último = 0;
    const parametro = /@[A-Za-z_][\w]*/g;
    let correspondência;
    while ((correspondência = parametro.exec(código)) !== null) {
      resultado += sql.slice(último, correspondência.index) + '?';
      último = correspondência.index + correspondência[0].length;
    }
    return resultado + sql.slice(último);
  }

  /**
   * Converte literais hexadecimal (0x1000000) em decimais. O SQLite interpreta
   * 0x... como BLOB, o que faz calculos de versao e bitmask do SMO retornarem 0.
   * A mascara evita alterar digitos dentro de textos e identificadores.
   * @private
   */
  _traduzirLiteraisHex(sql) {
    const código = this._mascarar(sql).code;
    let resultado = '';
    let último = 0;
    const hexadecimal = /0x([0-9a-f]+)/gi;
    let correspondência;
    while ((correspondência = hexadecimal.exec(código)) !== null) {
      resultado += sql.slice(último, correspondência.index);
      resultado += String(parseInt(correspondência[1], 16));
      último = correspondência.index + correspondência[0].length;
    }
    return resultado + sql.slice(último);
  }

  /** Traduz as variáveis globais do T-SQL para literais SQLite. @private */
  _traduzirVariaveisSistema(sql) {
    return sql
      .replace(/@@MICROSOFTVERSION\b/gi, '268439491')
      .replace(/@@SPID\b/gi, '1')
      .replace(/@@TRANCOUNT\b/gi, '0')
      .replace(/@@VERSION\b/gi, "'16.00.4035.2'");
  }

  /**
   * Remove `dbo.` e normaliza `master.sys.` para `sys.` — no SQLite o catálogo
   * de sistema é um schema anexado, não um database qualificado.
   * @private
   */
  _removerEsquema(sql) {
    let resultado = this._substituirTodos(sql, '\\bmaster\\s*\\.\\s*sys\\s*\\.\\s*', () => 'sys.');
    resultado = this._substituirTodos(resultado, '\\bdbo\\s*\\.\\s*', () => '');

    const tokens = this._mascarar(resultado).tokens;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const token = tokens[i];
      if (!['colchete', 'aspas'].includes(token.tipo) || !/^(?:\[dbo\]|"dbo")$/i.test(token.valor)) {
        continue;
      }

      let proximo = token.fim;
      while (proximo < resultado.length && /\s/.test(resultado[proximo])) proximo += 1;
      if (resultado[proximo] !== '.') continue;

      proximo += 1;
      while (proximo < resultado.length && /\s/.test(resultado[proximo])) proximo += 1;
      resultado = resultado.slice(0, token.início) + resultado.slice(proximo);
    }

    return resultado;
  }

  /**
   * Aplica a primeira ocorrência de um padrão encontrado na máscara, devolvendo
   * uma nova string. A função de substituição recebe também os índices originais.
   * @private
   */
  _substituirTodos(sql, fonteRegex, substituir, usarNoStrings = false) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 500; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      const texto = usarNoStrings ? máscara.noStrings : máscara.code;
      const correspondência = new RegExp(fonteRegex, 'i').exec(texto);
      if (!correspondência) {
        break;
      }
      const início = correspondência.index;
      const fim = início + correspondência[0].length;
      const novo = substituir(
        correspondência,
        resultado.slice(início, fim),
        texto,
        início,
        fim
      );
      resultado = resultado.slice(0, início) + novo + resultado.slice(fim);
    }

    return resultado;
  }

  /** Encontra o parêntese que fecha o parêntese aberto em `abertura`. @private */
  _parenCorespondente(código, abertura) {
    let profundidade = 0;
    for (let i = abertura; i < código.length; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        profundidade -= 1;
        if (profundidade === 0) {
          return i;
        }
      }
    }
    return -1;
  }

  /** Divide o conteúdo entre parênteses em argumentos de nível superior. @private */
  _argumentos(código, abertura, fechamento) {
    const argumentos = [];
    let profundidade = 0;
    let início = abertura + 1;

    for (let i = abertura + 1; i < fechamento; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        profundidade -= 1;
      } else if (código[i] === ',' && profundidade === 0) {
        argumentos.push({ início, fim: i });
        início = i + 1;
      }
    }
    argumentos.push({ início, fim: fechamento });

    return argumentos;
  }

  /** Divide uma lista por vírgulas de nível superior. @private */
  _dividirLista(texto) {
    const máscara = this._mascarar(texto);
    const partes = [];
    let profundidade = 0;
    let início = 0;

    for (let i = 0; i < texto.length; i += 1) {
      if (máscara.code[i] === '(') {
        profundidade += 1;
      } else if (máscara.code[i] === ')') {
        profundidade -= 1;
      } else if (máscara.code[i] === ',' && profundidade === 0) {
        partes.push(texto.slice(início, i));
        início = i + 1;
      }
    }
    partes.push(texto.slice(início));

    return partes.map((parte) => parte.trim()).filter((parte) => parte.length > 0);
  }

  /** Intervalos das instruções separadas por ponto e vírgula de nível superior. @private */
  _segmentosInstrucoes(código) {
    const segmentos = [];
    let profundidade = 0;
    let início = 0;

    for (let i = 0; i < código.length; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        profundidade -= 1;
      } else if (código[i] === ';' && profundidade === 0) {
        segmentos.push({ início, fim: i + 1 });
        início = i + 1;
      }
    }
    if (início < código.length) {
      segmentos.push({ início, fim: código.length });
    }

    return segmentos;
  }

  /** Cria um erro com código BadRequestException e mensagem em português. @private */
  _badRequest(mensagem) {
    const erro = new Error(mensagem);
    erro.code = 'BadRequestException';
    return erro;
  }

  /**
   * Expande o batch de descoberta de versão do SSMS em lotes independentes.
   *
   * A consulta original devolve três conjuntos de resultado (versão/edição,
   * host_platform e ConnectionProtocol). A camada TDS separa result sets por
   * lote, então devolvemos um SELECT por lote — se tudo vier em um único
   * resultset, o SSMS falha com "Cannot find table 2" ao ligar ao servidor.
   *
   * @param {string} sql
   * @returns {string[]|null} lotes já prontos, ou null quando não é o padrão
   */
  expandirResultSets(sql) {
    if (typeof sql !== 'string') {
      return null;
    }

    const código = this._mascarar(sql).code;
    if (
      !/\bDECLARE\s+@edition\s+sysname\b/i.test(código) ||
      !/\bSERVERPROPERTY\b/i.test(código) ||
      !/\bCONNECTIONPROPERTY\b/i.test(sql) ||
      !/\bMICROSOFTVERSION\b/i.test(código)
    ) {
      return null;
    }

    return [
      'SELECT 1 AS [DatabaseEngineType], 2 AS [DatabaseEngineEdition], ' +
        "'16.00.4035.2' AS [ProductVersion], 16 AS [MicrosoftVersion]",
      "SELECT 'Windows' AS [host_platform]",
      "SELECT 'TCP' AS [ConnectionProtocol]"
    ];
  }

  /**
   * Tipos TDS que o SMO espera nas colunas dos shims acima. O SQLite descarta
   * o tipo declarado de expressões calculadas (CAST inclusive), então sem isso
   * colunas BIT/TINYINT chegam como INT e o Explorer falha com
   * "Specified cast is not valid" ao ler bools com GetBoolean().
   *
   * @param {string} sql SQL bruto recebido do cliente
   * @returns {Object<string,string>|null} mapa nome da coluna → tipo declarado
   */
  columnTypesFor(sql) {
    if (typeof sql !== 'string') return null;

    const código = this._mascarar(sql).code;

    // No SQL Server, IsSingleUser/IsXTPSupported/IsFullTextInstalled e
    // IsContainedAuthentication vêm de SERVERPROPERTY/CASE como INT — forçar
    // BIT aqui faria o SMO lançar "Specified cast is not valid" ao ler Int32.

    if (
      /\bIS_SRVROLEMEMBER\b/i.test(sql) &&
      /\bAdminConnection\b/i.test(sql) &&
      /\bSmoEnabled\b/i.test(sql)
    ) {
      return { AdminConnection: 'BIT', SmoEnabled: 'BIT' };
    }

    if (/^\s*SELECT\s+.*\bFROM\s+(?:master\.)?sys\.databases\s+\w+\s*;?\s*$/i.test(código)) {
      return { State: 'TINYINT' };
    }

    if (/\bFROM\s+(?:master\.)?sys\.configurations\b/i.test(código)) {
      return { Dynamic: 'BIT', Advanced: 'BIT' };
    }

    // Batch completo de propriedades do Server: colunas vindas de CAST AS bit.
    if (/\bSmoAuditLevel\b/i.test(sql) && /\bPolicyHealthState\b/i.test(sql)) {
      return {
        ResourceLastUpdateDateTime: 'DATETIME',
        IsCaseSensitive: 'BIT',
        IsFullTextInstalled: 'BIT',
        IsSingleUser: 'BIT',
        IsClustered: 'BIT',
        NamedPipesEnabled: 'BIT',
        TcpEnabled: 'BIT',
        IsHadrEnabled: 'BIT',
        IsPolyBaseInstalled: 'BIT'
      };
    }

    // Batch de descoberta do SMO: essas colunas vêm de CAST(... AS bit).
    if (/\bFULLTEXTSERVICEPROPERTY\b/i.test(sql) && /\bIsSingleUser\b/i.test(sql)) {
      return {
        ResourceLastUpdateDateTime: 'DATETIME',
        IsCaseSensitive: 'BIT',
        IsFullTextInstalled: 'BIT',
        IsClustered: 'BIT',
        IsSingleUser: 'BIT',
        IsXTPSupported: 'BIT'
      };
    }

    return null;
  }

  /**
   * Substitui o batch de descoberta de servidor enviado pelo SSMS ao conectar.
   * A consulta original usa xp_msver, tabelas de sistema e funções de servidor
   * que não existem no SQLite. Devolvemos um resultset com as mesmas colunas e
   * valores representativos do cluster simulado.
   * @private
   */
  _traduzirMetadadosCliente(sql) {
    const código = this._mascarar(sql).code;

    // Batch completo de propriedades do Server enviado pelo SMO. Ele tambem
    // usa xp_instance_regread e sys.database_files, mas espera colunas como
    // AuditLevel e PolicyHealthState. Devolver o resultset de Information aqui
    // faz o SMO converter os valores por posicao e estourar Int16/enum no
    // Server.Refresh(), que era o travamento do SSMS.
    if (/\bSmoAuditLevel\b/i.test(sql) && /\bPolicyHealthState\b/i.test(sql)) {
      const caminho = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL';
      const colunas = [
        '2 AS [AuditLevel]',
        '12 AS [NumberOfLogFiles]',
        '2 AS [LoginMode]',
        "'' AS [MailProfile]",
        `'${caminho}\\DATA' AS [BackupDirectory]`,
        '1000 AS [PerfMonMode]',
        `'${caminho}' AS [InstallDataDirectory]`,
        "'MSSQLSERVER' AS [ServiceName]",
        `'${caminho}\\Log' AS [ErrorLogPath]`,
        `'${caminho}\\' AS [RootDirectory]`,
        'CAST(0 AS BIT) AS [IsCaseSensitive]',
        '38 AS [MaxPrecision]',
        'CAST(0 AS BIT) AS [IsFullTextInstalled]',
        "'16.00.4035.2' AS [VersionString]",
        "'Standard Edition (64-bit)' AS [Edition]",
        "'RTM' AS [ProductLevel]",
        "'' AS [ProductUpdateLevel]",
        'CAST(0 AS BIT) AS [IsSingleUser]',
        '2 AS [EngineEdition]',
        "'SQL_Latin1_General_CP1_CI_AS' AS [Collation]",
        'CAST(0 AS BIT) AS [IsClustered]',
        "'LOCAL' AS [NetName]",
        "'LOCAL' AS [ComputerNamePhysicalNetBIOS]",
        '2 AS [ServiceStartMode]',
        `'${caminho}\\DATA' AS [MasterDBLogPath]`,
        `'${caminho}\\DATA' AS [MasterDBPath]`,
        `'${caminho}\\DATA' AS [DefaultFile]`,
        `'${caminho}\\DATA' AS [DefaultLog]`,
        "'16.00.4035.2' AS [ResourceVersionString]",
        "'2023-01-01T00:00:00' AS [ResourceLastUpdateDateTime]",
        '0 AS [CollationID]',
        '196609 AS [ComparisonStyle]',
        '1 AS [SqlCharSet]',
        "'ascii' AS [SqlCharSetName]",
        '52 AS [SqlSortOrder]',
        "'nocase_iso' AS [SqlSortOrderName]",
        "'v4.0.30319' AS [BuildClrVersionString]",
        "'' AS [ServiceAccount]",
        'CAST(0 AS BIT) AS [NamedPipesEnabled]',
        'CAST(1 AS BIT) AS [TcpEnabled]',
        "'' AS [InstallSharedDirectory]",
        "'' AS [SqlDomainGroup]",
        '0 AS [PolicyHealthState]',
        '0 AS [FilestreamLevel]',
        "'' AS [FilestreamShareName]",
        '-1 AS [TapeLoadWaitTime]',
        'CAST(0 AS BIT) AS [IsHadrEnabled]',
        '0 AS [HadrManagerStatus]',
        "'' AS [ClusterName]",
        '4 AS [ClusterQuorumType]',
        '3 AS [ClusterQuorumState]',
        'NULL AS [ServiceAccountSid]',
        'CAST(0 AS BIT) AS [IsPolyBaseInstalled]',
        "'LOCAL' AS [Name]",
        "'' AS [InstanceName]",
        '1 AS [Status]',
        "'\\' AS [PathSeparator]",
        '0 AS [IsContainedAuthentication]',
        'NULL AS [ServerType]'
      ];
      return `SELECT ${colunas.join(', ')}`;
    }

    // Batch de descoberta de propriedades do servidor feito pelo SMO durante a
    // conexao. xp_instance_regread e sys.database_files nao existem no
    // simulador, entao devolvemos as mesmas colunas com valores de uma
    // instancia local (collation case-insensitive, sem cluster e sem fulltext).
    if (/\bxp_instance_regread\b/i.test(código) && /\bdatabase_files\b/i.test(código)) {
      const caminho = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL';
      return (
        'SELECT CAST(0 AS BIT) AS [IsCaseSensitive], ' +
        '38 AS [MaxPrecision], ' +
        `'${caminho}\\Log' AS [ErrorLogPath], ` +
        `'${caminho}\\' AS [RootDirectory], ` +
        "'\\' AS [PathSeparator], " +
        'CAST(0 AS BIT) AS [IsFullTextInstalled], ' +
        `'${caminho}\\DATA' AS [MasterDBLogPath], ` +
        `'${caminho}\\DATA' AS [MasterDBPath], ` +
        "'16.00.4035.2' AS [VersionString], " +
        "'Standard Edition (64-bit)' AS [Edition], " +
        "'RTM' AS [ProductLevel], " +
        'CAST(0 AS BIT) AS [IsSingleUser], ' +
        '2 AS [EngineEdition], ' +
        "'SQL_Latin1_General_CP1_CI_AS' AS [Collation], " +
        "'LOCAL' AS [NetName], " +
        'CAST(0 AS BIT) AS [IsClustered], ' +
        "'16.00.4035.2' AS [ResourceVersionString], " +
        "'2023-01-01T00:00:00' AS [ResourceLastUpdateDateTime], " +
        '0 AS [CollationID], ' +
        '196609 AS [ComparisonStyle], ' +
        '1 AS [SqlCharSet], ' +
        "'ascii' AS [SqlCharSetName], " +
        '52 AS [SqlSortOrder], ' +
        "'nocase_iso' AS [SqlSortOrderName], " +
        "'v4.0.30319' AS [BuildClrVersionString], " +
        "'LOCAL' AS [ComputerNamePhysicalNetBIOS], " +
        'CAST(0 AS BIT) AS [IsPolyBaseInstalled]'
      );
    }

    // Propriedades caras do Server, lidas uma a uma via xp_regread/xp_instance_
    // regread ou montadas em #SVer a partir de xp_msver. O SMO emite um batch
    // por propriedade e espera exatamente uma coluna com o nome dela; devolver
    // o resultset de descoberta (14 colunas) faz o cliente ler por posicao e
    // falhar com NullReferenceException. Fica depois dos batches completos
    // acima para nao capturar suas colunas.
    const ehBatchSVer = /#SVer\b/i.test(sql) && /\bxp_msver\b/i.test(sql);
    if (/\b(?:xp_regread|xp_instance_regread)\b/i.test(sql) || ehBatchSVer) {
      const apelidos = [...sql.matchAll(/\bAS\s+\[([^\]]+)\]/gi)].map((m) => m[1]);
      const apelido = apelidos[apelidos.length - 1];
      if (apelido && /^[A-Za-z][A-Za-z0-9_]*$/.test(apelido)) {
        const valores = {
          BrowserServiceAccount: "''",
          BrowserStartMode: '4',
          ErrorLogSizeKb: '0',
          HardwareGeneration: "'Gen5'",
          HostDistribution: "'Windows'",
          HostPlatform: "'Windows'",
          HostRelease: "'10.0'",
          HostServicePackLevel: "''",
          HostSku: '0',
          Language: "'1033'",
          OSVersion: "'10.0'",
          PhysicalMemory: '8388608',
          PhysicalMemoryUsageInKB: '8388608',
          Platform: "'Windows'",
          ProcessorUsage: '0',
          Processors: '8',
          Product: "'Microsoft SQL Server'",
          ReservedStorageSizeMB: '0',
          ServiceInstanceId: "'MSSQLSERVER'",
          ServiceTier: "'Local'",
          UsedStorageSizeMB: '0',
          VersionMajor: '16',
          VersionMinor: '0'
        };
        const valor = valores[apelido];
        if (valor !== undefined || !ehBatchSVer) {
          return `SELECT ${valor || '0'} AS [${apelido}]`;
        }
      }
    }

    if (/\bxp_msver\b/i.test(código) && /#SVer\b/i.test(código)) {
      // O SSMS 19 inclui Server_Status nesse resultset; versoes antigas do SMO
      // nao incluem. O numero de colunas precisa bater exatamente com o SQL
      // original, senao o cliente falha ao ler o schema.
      const colunas = [
        "'LOCAL' AS [Server_Name]",
        "'Server[@Name=''LOCAL'']' AS [Server_Urn]",
        'NULL AS [Server_ServerType]'
      ];
      if (/\bServer_Status\b/i.test(sql)) colunas.push('1 AS [Server_Status]');
      colunas.push(
        '0 AS [Server_IsContainedAuthentication]',
        '16 AS [VersionMajor]',
        '0 AS [VersionMinor]',
        '4035 AS [BuildNumber]',
        '0 AS [IsSingleUser]',
        "'Standard Edition (64-bit)' AS [Edition]",
        '2 AS [EngineEdition]',
        '0 AS [IsXTPSupported]',
        "'16.00.4035.2' AS [VersionString]",
        "'Windows' AS [HostPlatform]",
        '0 AS [IsFullTextInstalled]'
      );
      return `SELECT ${colunas.join(', ')}`;
    }

    // Segundo batch de descoberta do SSMS: edição, versão e protocolo de conexão.
    if (
      /\bDECLARE\s+@edition\s+sysname\b/i.test(código) &&
      /\bSERVERPROPERTY\b/i.test(código) &&
      /\bCONNECTIONPROPERTY\b/i.test(sql) &&
      /\bMICROSOFTVERSION\b/i.test(código)
    ) {
      return (
        'SELECT 1 AS [DatabaseEngineType], ' +
        '2 AS [DatabaseEngineEdition], ' +
        "'16.00.4035.2' AS [ProductVersion], " +
        '16 AS [MicrosoftVersion], ' +
        "'Windows' AS [host_platform], " +
        "'TCP' AS [ConnectionProtocol]"
      );
    }

    // Verificação de AlwaysOn feita pelo SMO ao conectar. xp_qv é uma
    // stored procedure interna que não existe no simulador; -1/-0 indicam
    // "não é uma instância AlwaysOn" e evitam consultas de disponibilidade.
    if (/\bxp_qv\b/i.test(código) && /\bAlwaysOn\b/i.test(sql)) {
      return 'SELECT -1 AS [AlwaysOn]';
    }

    // Consulta de AdminConnection/SmoEnabled feita pelo SMO ao conectar.
    if (
      /\bIS_SRVROLEMEMBER\b/i.test(sql) &&
      /\bAdminConnection\b/i.test(sql) &&
      /\bSmoEnabled\b/i.test(sql)
    ) {
      // SmoEnabled=1 evita que o SSMS tente alterar sys.configurations para
      // habilitar SMO (a alteração não é suportada pelo simulador).
      return 'SELECT CAST(0 AS BIT) AS [AdminConnection], CAST(1 AS BIT) AS [SmoEnabled]';
    }

    // Verificação de contained authentication feita pelo SSMS ao abrir o master.
    if (
      /\bdb_id\s*\(\s*\)/i.test(código) &&
      /\bdm_exec_sessions\b/i.test(sql) &&
      /\bauthenticating_database_id\b/i.test(sql)
    ) {
      // db_id() = 1 é master; autenticação contida é sempre 0 no cluster simulado.
      return 'SELECT 0 AS [IsContainedAuthentication]';
    }

    // SERVERPROPERTY, CONNECTIONPROPERTY, IS_SRVROLEMEMBER, sys.databases e
    // sys.configurations agora existem de verdade no catálogo (system-catalog.js).
    return sql;
  }

  /**
   * Suporte procedural conservador: DECLARE/SET lineares e o subconjunto usado
   * por clientes como o SSMS durante a conexão (IF com condição entre
   * parênteses, BEGIN TRY/CATCH e EXEC sp_executesql com literal).
   * Loops e EXEC de procedures arbitrários continuam sendo rejeitados.
   * @private
   */
  _traduzirProcedural(sql) {
    const ehTrigger = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/i.test(this._mascarar(sql).code);
    let resultado = sql;

    if (!ehTrigger) {
      resultado = this._desembrulharTryCatch(resultado);
      resultado = this._desembrulharIfCondicional(resultado);
      resultado = this._desembrulharExecSql(resultado);
      this._validarProceduralResidual(resultado);
    }

    const variáveis = new Map();

    resultado = this._substituirTodos(
      resultado,
      '\\bDECLARE\\s+@(\\w+)\\s+[^=;]+(?:\\s*=\\s*([^;]+))?',
      (correspondência, original) => {
        const nome = `@${correspondência[1]}`;
        const sinal = original.indexOf('=');
        if (sinal >= 0) {
          let valor = original.slice(sinal + 1).trim();
          valor = this._resolverVariaveis(valor, variáveis);
          valor = this._traduzirFuncoes(valor);
          variáveis.set(nome, valor);
        }
        return '';
      }
    );

    resultado = this._substituirTodos(
      resultado,
      '\\bSET\\s+@(\\w+)\\s*=\\s*([^;]+)',
      (correspondência, original) => {
        const nome = `@${correspondência[1]}`;
        const sinal = original.indexOf('=');
        let valor = original.slice(sinal + 1).trim();
        valor = this._resolverVariaveis(valor, variáveis);
        valor = this._traduzirFuncoes(valor);
        variáveis.set(nome, valor);
        return '';
      }
    );

    resultado = this._resolverVariaveis(resultado, variáveis);

    if (!ehTrigger) {
      resultado = this._desembrulharExecSql(resultado);
      this._validarProceduralResidual(resultado);
    }

    // Remove ponto e vírgula órfão deixado por uma declaração no início do lote.
    return resultado.replace(/^(?:\s*;+\s*)+/, '');
  }

  /** Garante que nenhum construto procedural não suportado permaneça. @private */
  _validarProceduralResidual(sql) {
    const código = this._mascarar(sql).code.replace(
      /\bEXEC(?:UTE)?\s+(?:sys\.)?sp_executesql\b/gi,
      ' '
    );
    const restanteProcedural =
      /\b(?:IF|WHILE|GOTO|RETURN|THROW|RAISERROR|EXEC|EXECUTE)\b/i.test(código) ||
      /\bBEGIN\b(?!\s+TRAN(?:ACTION)?\b)/i.test(código);

    if (restanteProcedural) {
      throw this._badRequest(
        'Blocos procedurais T-SQL (IF, WHILE, BEGIN...END, EXEC) não suportados pelo tradutor SQL Server para SQLite.'
      );
    }
  }

  /** Remove BEGIN TRY/END TRY e descarta o bloco CATCH. @private */
  _desembrulharTryCatch(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      const código = this._mascarar(resultado).code;
      const inícioTry = /\bBEGIN\s+TRY\b/i.exec(código);
      if (!inícioTry) break;

      const afterTry = inícioTry.index + inícioTry[0].length;
      const fimTry = /\bEND\s+TRY\b/i.exec(código.slice(afterTry));
      if (!fimTry) break;
      const fimTryAbs = afterTry + fimTry.index;

      const inícioCatch = /\bBEGIN\s+CATCH\b/i.exec(código.slice(fimTryAbs + fimTry[0].length));
      if (!inícioCatch) break;
      const inícioCatchAbs = fimTryAbs + fimTry[0].length + inícioCatch.index;
      const afterCatch = inícioCatchAbs + inícioCatch[0].length;

      const fimCatch = /\bEND\s+CATCH\b/i.exec(código.slice(afterCatch));
      if (!fimCatch) break;
      const fimCatchAbs = afterCatch + fimCatch.index + fimCatch[0].length;

      const corpo = resultado.slice(afterTry, fimTryAbs).trim();
      resultado = resultado.slice(0, inícioTry.index) + corpo + resultado.slice(fimCatchAbs);
    }

    return resultado;
  }

  /**
   * Transforma IF (<condição>) <comando> e IF EXISTS (<consulta>) <comando>
   * no comando interno. Condições de metadados usadas por clientes são tratadas
   * como verdadeiras; IF com expressão simples permanece rejeitado.
   * @private
   */
  _desembrulharIfCondicional(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 50; tentativa += 1) {
      const código = this._mascarar(resultado).code;
      const condição = /\bIF\s+(?:EXISTS\s*)?\(/i.exec(código);
      if (!condição) break;

      const abertura = condição.index + condição[0].length - 1;
      const fechamento = this._parenCorespondente(código, abertura);
      if (fechamento < 0) break;

      let inícioCorpo = fechamento + 1;
      while (inícioCorpo < código.length && /\s/.test(código[inícioCorpo])) {
        inícioCorpo += 1;
      }

      const restante = código.slice(inícioCorpo);
      const bloco = /^BEGIN\b/i.exec(restante);
      let fimCorpo;

      if (bloco && !/^BEGIN\s+(?:TRY|CATCH|TRAN|TRANSACTION)\b/i.test(restante)) {
        const fimBloco = this._fimBlocoBeginEnd(código, inícioCorpo);
        if (fimBloco < 0) break;
        inícioCorpo += bloco[0].length;
        fimCorpo = fimBloco - 3;
      } else {
        fimCorpo = this._proximoPontoVirgula(código, inícioCorpo);
        if (fimCorpo < 0) fimCorpo = resultado.length;
      }

      const corpo = resultado.slice(inícioCorpo, fimCorpo).trim();
      resultado = resultado.slice(0, condição.index) + corpo + resultado.slice(fimCorpo);
    }

    return resultado;
  }

  /** Desembrulha EXEC/EXECUTE sp_executesql com SQL literal. @private */
  _desembrulharExecSql(sql) {
    return sql.replace(
      /\bEXEC(?:UTE)?\s+(?:sys\.)?sp_executesql\s*\(?\s*N?'((?:''|[^'])*)'\s*\)?(?:\s*,[^;]*)?/gi,
      (correspondência, texto) => texto.replace(/''/g, "'")
    );
  }

  /** Encontra o END que fecha o BEGIN em `inicio`. @private */
  _fimBlocoBeginEnd(código, inicio) {
    const regex = /\b(?:BEGIN|END)\b/gi;
    regex.lastIndex = inicio;
    let profundidade = 0;
    let correspondência;

    while ((correspondência = regex.exec(código)) !== null) {
      if (/^BEGIN$/i.test(correspondência[0])) {
        profundidade += 1;
      } else {
        profundidade -= 1;
        if (profundidade === 0) {
          return correspondência.index + correspondência[0].length;
        }
      }
    }

    return -1;
  }

  /** Encontra o próximo ponto e vírgula de nível superior. @private */
  _proximoPontoVirgula(código, inicio) {
    let profundidade = 0;

    for (let i = inicio; i < código.length; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')' && profundidade > 0) {
        profundidade -= 1;
      } else if (código[i] === ';' && profundidade === 0) {
        return i;
      }
    }

    return -1;
  }

  /** Substitui referências a variáveis já declaradas fora de literais. @private */
  _resolverVariaveis(sql, variáveis) {
    let resultado = sql;
    for (const [nome, valor] of variáveis) {
      resultado = this._substituirTodos(
        resultado,
        `${escaparRegex(nome)}\\b`,
        () => `(${valor})`
      );
    }
    return resultado;
  }

  /** Traduz funções escalares do T-SQL para equivalentes SQLite. @private */
  _traduzirFuncoes(sql) {
    let resultado = sql;

    for (let passada = 0; passada < 2; passada += 1) {
      resultado = this._substituirTodos(
        resultado,
        '\\b(?:GETDATE|SYSDATETIME)\\s*\\(\\s*\\)',
        () => "datetime('now')"
      );
      resultado = this._substituirTodos(
        resultado,
        '\\bCURRENT_TIMESTAMP\\b(?:\\s*\\(\\s*\\))?',
        () => "datetime('now')"
      );
      resultado = this._substituirTodos(
        resultado,
        '\\bNEWID\\s*\\(\\s*\\)',
        () => EXPRESSAO_NEWID
      );
      resultado = this._substituirTodos(resultado, '\\bISNULL\\s*\\(', () => 'COALESCE(');
      resultado = this._substituirTodos(resultado, '\\bLEN\\s*\\(', () => 'LENGTH(');
      // CONVERT(tipo(n), valor) → CONVERT('TIPO', valor). A função CONVERT é
      // registrada pelo catálogo de sistema; o tipo T-SQL não é expressão SQL.
      resultado = this._substituirTodos(
        resultado,
        '\\bCONVERT\\s*\\(\\s*(N?VARCHAR|N?CHAR|INT|INTEGER|BIGINT|SMALLINT|TINYINT|BIT|' +
          'DECIMAL|NUMERIC|FLOAT|REAL|DATETIME2|DATETIME|DATE|TIME|UNIQUEIDENTIFIER|' +
          'BINARY|VARBINARY|MONEY|SMALLMONEY|TEXT|XML)\\s*(?:\\([^()]*\\))?\\s*,',
        (correspondência) => `CONVERT('${correspondência[1].toUpperCase()}',`
      );
      // Tipos T-SQL cujo nome não contém CHAR/TEXT/BLOB/etc. recebem afinidade
      // NUMERIC no SQLite: CAST('LOCAL' AS sysname) devolve 0. Sem isso o URN
      // montado pelo SMO vira Server[@Name='0'] e a conexão falha.
      resultado = this._substituirTodos(
        resultado,
        '\\bAS\\s+(?:SYSNAME|UNIQUEIDENTIFIER|XML)\\b',
        () => 'AS TEXT'
      );
      resultado = this._traduzirDateAdd(resultado);
    }

    return resultado;
  }

  /**
   * Converte concatenação de strings do T-SQL (`+`) no operador `||` do SQLite.
   * Só troca o operador quando um dos lados é literal de texto; somas numéricas
   * (bitmask de server roles, por exemplo) continuam com `+`.
   * @private
   */
  _traduzirConcatenacao(sql) {
    const máscara = this._mascarar(sql);
    const código = máscara.code;
    const posicoes = [];

    for (let i = 0; i < código.length; i += 1) {
      if (código[i] !== '+') continue;

      const anterior = máscara.tokens
        .filter((token) => token.tipo === 'texto' && token.fim <= i)
        .sort((a, b) => b.fim - a.fim)[0];
      const posterior = máscara.tokens
        .filter((token) => token.tipo === 'texto' && token.início >= i + 1)
        .sort((a, b) => a.início - b.início)[0];
      const temTextoAntes = !!anterior && código.slice(anterior.fim, i).trim() === '';
      const temTextoDepois = !!posterior && código.slice(i + 1, posterior.início).trim() === '';
      if (!temTextoAntes && !temTextoDepois) continue;

      // Quando só o lado direito é literal, ainda precisamos garantir que
      // existe operando à esquerda (para não trocar um `+` unário).
      if (!temTextoAntes) {
        let antes = i - 1;
        while (antes >= 0 && /\s/.test(código[antes])) antes -= 1;
        if (antes < 0 || /[,(=+\-*/%&|^<>]/.test(código[antes])) continue;
      }

      posicoes.push(i);
    }

    let resultado = sql;
    for (let i = posicoes.length - 1; i >= 0; i -= 1) {
      resultado = resultado.slice(0, posicoes[i]) + '||' + resultado.slice(posicoes[i] + 1);
    }
    return resultado;
  }

  /** Converte DATEADD(unit, n, base) em datetime(base, modificador). @private */
  _traduzirDateAdd(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      const correspondência = /\bDATEADD\s*\(/i.exec(máscara.code);
      if (!correspondência) {
        break;
      }
      const abertura = correspondência.index + correspondência[0].length - 1;
      const fechamento = this._parenCorespondente(máscara.code, abertura);
      if (fechamento < 0) {
        break;
      }
      const argumentos = this._argumentos(máscara.code, abertura, fechamento);
      if (argumentos.length !== 3) {
        break;
      }
      const unidade = this._mascarar(máscara.code.slice(argumentos[0].início, argumentos[0].fim))
        .code.trim()
        .toLowerCase();
      const equivalente = UNIDADES_DATEADD[unidade];
      if (!equivalente) {
        break;
      }

      const quantidade = máscara.code
        .slice(argumentos[1].início, argumentos[1].fim)
        .trim();
      const quantidadeOriginal = resultado
        .slice(argumentos[1].início, argumentos[1].fim)
        .trim();
      const baseOriginal = resultado.slice(argumentos[2].início, argumentos[2].fim).trim();
      const base = this._traduzirFuncoes(baseOriginal);

      let modificador;
      if (/^[+-]?\d+$/.test(quantidade)) {
        const valor = parseInt(quantidade, 10) * equivalente.fator;
        modificador = `'${valor >= 0 ? '+' : '-'}${Math.abs(valor)} ${equivalente.modificador}'`;
      } else {
        const expressao =
          equivalente.fator === 1
            ? `(${quantidadeOriginal})`
            : `((${quantidadeOriginal}) * ${equivalente.fator})`;
        modificador = `printf('%+d', ${expressao}) || ' ${equivalente.modificador}'`;
      }

      const substituição = `datetime(${base}, ${modificador})`;
      resultado = resultado.slice(0, correspondência.index) + substituição + resultado.slice(fechamento + 1);
    }

    return resultado;
  }

  /** Converte TOP em LIMIT, posicionando-o no fim da consulta/subconsulta. @private */
  _traduzirTop(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      const correspondência = /\bTOP\s+(\(\s*(\d+)\s*\)|(\d+))(?:\s+PERCENT\b)?/i.exec(
        máscara.code
      );
      if (!correspondência) {
        break;
      }
      if (!/\bSELECT\b/i.test(máscara.code.slice(0, correspondência.index))) {
        throw this._badRequest('TOP não suportado fora de uma instrução SELECT.');
      }
      if (/\bWITH\s+TIES\b/i.test(máscara.code.slice(correspondência.index))) {
        throw this._badRequest('TOP ... WITH TIES não suportado pelo tradutor SQL Server para SQLite.');
      }

      const quantidade = correspondência[2] || correspondência[3];
      resultado =
        resultado.slice(0, correspondência.index) +
        resultado.slice(correspondência.index + correspondência[0].length);

      const novaMáscara = this._mascarar(resultado);
      const ponto = this._pontoInsercaoLimite(novaMáscara.code, correspondência.index);
      let fim = ponto;
      while (fim > correspondência.index && /\s/.test(resultado[fim - 1])) {
        fim -= 1;
      }
      resultado = resultado.slice(0, fim) + ` LIMIT ${quantidade}` + resultado.slice(fim);
    }

    return resultado;
  }

  /** Localiza o fim da SELECT que contém `posição` (parêntese ou ponto e vírgula). @private */
  _pontoInsercaoLimite(código, posição) {
    let profundidade = 0;
    for (let i = 0; i < posição; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        profundidade -= 1;
      }
    }
    const profundidadeBase = profundidade;

    for (let i = posição; i < código.length; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        if (profundidadeBase > 0 && profundidade === profundidadeBase) {
          return i;
        }
        profundidade -= 1;
      } else if (código[i] === ';' && profundidade === profundidadeBase) {
        return i;
      }
    }
    return código.length;
  }

  /** Traduz tipos e IDENTITY somente em CREATE TABLE / ALTER TABLE. @private */
  _traduzirDdl(sql) {
    const segmentos = this._segmentosInstrucoes(this._mascarar(sql).code);
    let resultado = sql;

    for (let i = segmentos.length - 1; i >= 0; i -= 1) {
      const { início, fim } = segmentos[i];
      const trecho = sql.slice(início, fim);
      if (!/\b(?:CREATE|ALTER)\s+TABLE\b/i.test(this._mascarar(trecho).code)) {
        continue;
      }
      let traduzido = this._traduzirTipos(trecho);
      traduzido = this._removerOnPrimary(traduzido);
      traduzido = this._traduzirIdentity(traduzido);
      resultado = resultado.slice(0, início) + traduzido + resultado.slice(fim);
    }

    return resultado;
  }

  /** Aplica a tabela de tipos ao trecho DDL informado. @private */
  _traduzirTipos(sql) {
    let resultado = sql;
    for (const [regex, tipo] of TIPOS_DDL) {
      // Tipos sem argumentos não devem casar com funções já traduzidas,
      // como datetime('now'), gerada a partir de GETDATE().
      const fonte = regex.source.includes('\\(')
        ? regex.source
        : `${regex.source}(?!\\s*\\()`;
      resultado = this._substituirTodos(resultado, fonte, () => tipo);
    }
    return resultado;
  }

  /** Remove a cláusula ON [PRIMARY] de um trecho DDL. @private */
  _removerOnPrimary(sql) {
    return this._substituirTodos(
      sql,
      '\\s+ON\\s+(?:\\[PRIMARY\\]|"PRIMARY"|PRIMARY)(?!\\w)',
      () => '',
      true
    );
  }

  /** Converte IDENTITY(1,1) em AUTOINCREMENT sem duplicar INTEGER/PRIMARY KEY. @private */
  _traduzirIdentity(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      const correspondência = /\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/i.exec(máscara.code);
      if (!correspondência) {
        break;
      }
      const limites = this._limitesColuna(máscara.code, correspondência.index);
      const códigoColuna = máscara.code.slice(limites.início, limites.fim);
      const temChave = /\bPRIMARY\s+KEY\b/i.test(códigoColuna);
      const temInteger = /\bINTEGER\b/i.test(códigoColuna);

      if (temChave) {
        const chave = /\bPRIMARY\s+KEY\b/i.exec(códigoColuna);
        const ponto = limites.início + chave.index + chave[0].length;
        resultado = resultado.slice(0, ponto) + ' AUTOINCREMENT' + resultado.slice(ponto);
        const novaMáscara = this._mascarar(resultado);
        const novamente = /\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/i.exec(novaMáscara.code);
        if (!novamente) {
          break;
        }
        resultado =
          resultado.slice(0, novamente.index) +
          resultado.slice(novamente.index + novamente[0].length);
        continue;
      }

      const substituição = temInteger
        ? 'PRIMARY KEY AUTOINCREMENT'
        : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      resultado =
        resultado.slice(0, correspondência.index) +
        substituição +
        resultado.slice(correspondência.index + correspondência[0].length);
    }

    return resultado;
  }

  /** Delimita a definição de coluna que contém `posição`. @private */
  _limitesColuna(código, posição) {
    let profundidade = 0;
    let início = 0;
    let aberturaTabela = -1;

    for (let i = 0; i < posição; i += 1) {
      const caractere = código[i];
      if (caractere === '(') {
        if (profundidade === 0) {
          aberturaTabela = i;
        }
        profundidade += 1;
      } else if (caractere === ')') {
        profundidade -= 1;
      } else if (caractere === ',' && profundidade === 1) {
        início = i + 1;
      }
    }
    if (aberturaTabela >= 0 && início < aberturaTabela) {
      início = aberturaTabela + 1;
    }

    let fim = código.length;
    for (let i = posição; i < código.length; i += 1) {
      const caractere = código[i];
      if (caractere === '(') {
        profundidade += 1;
      } else if (caractere === ')') {
        profundidade -= 1;
        if (profundidade === 0) {
          fim = i;
          break;
        }
      } else if (caractere === ',' && profundidade === 1) {
        fim = i;
        break;
      }
    }

    return { início, fim };
  }

  /** Converte MERGE simples em INSERT ... ON CONFLICT DO UPDATE. @private */
  _traduzirMerge(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      if (!/^\s*MERGE\b/i.test(máscara.code)) {
        break;
      }
      try {
        resultado = this._traduzirMergeUnico(resultado, máscara);
      } catch (erro) {
        if (erro.code === 'BadRequestException') {
          throw erro;
        }
        throw this._badRequest(`MERGE não suportado: ${erro.message}`);
      }
    }

    return resultado;
  }

  /** Traduz um único comando MERGE. @private */
  _traduzirMergeUnico(sql, máscara) {
    const código = máscara.code;
    const semTexto = máscara.noStrings;
    let posição = código.search(/\S/);
    const falhar = (detalhe) => {
      throw this._badRequest(`MERGE não suportado: ${detalhe}`);
    };

    const lerPalavras = (fonte) => {
      const encontrado = fonte.exec(código.slice(posição));
      if (!encontrado) {
        return null;
      }
      posição += encontrado[0].length;
      return encontrado;
    };

    if (!lerPalavras(/^MERGE(?:\s+INTO)?\s+/i)) {
      falhar('falta a cláusula MERGE INTO.');
    }

    const lerIdentificador = () => {
      const encontrado = /^(?:\[[^\]]+\]|\w+)(?:\s*\.\s*(?:\[[^\]]+\]|\w+))*/i.exec(
        semTexto.slice(posição)
      );
      if (!encontrado) {
        falhar('não foi possível identificar a tabela.');
      }
      const valor = sql.slice(posição, posição + encontrado[0].length);
      posição += encontrado[0].length;
      return valor;
    };

    const lerAlias = (palavraSeguinte) => {
      const encontrado = /^\s+(?:AS\s+)?([A-Za-z_]\w*)\b/i.exec(código.slice(posição));
      if (encontrado && encontrado[1].toUpperCase() !== palavraSeguinte) {
        posição += encontrado[0].length;
        return encontrado[1];
      }
      return null;
    };

    const destino = lerIdentificador();
    const aliasDestino = lerAlias('USING');
    if (!lerPalavras(/^\s+USING\s+/i)) {
      falhar('falta a cláusula USING.');
    }
    const origem = lerIdentificador();
    const aliasOrigem = lerAlias('ON');
    if (!lerPalavras(/^\s+ON\s+/i)) {
      falhar('falta a cláusula ON.');
    }

    const inícioOn = posição;
    const próximoWhen = /\s+WHEN\s+/i.exec(código.slice(posição));
    if (!próximoWhen) {
      falhar('falta a cláusula WHEN MATCHED.');
    }
    const fimOn = posição + próximoWhen.index;
    posição = fimOn + próximoWhen[0].length;
    const condiçãoOn = código.slice(inícioOn, fimOn);

    const colunasConflito = [];
    const partesOn = this._dividirPorE(condiçãoOn);
    for (const parte of partesOn) {
      const comparacao = /^\s*(?:(\w+)\.)?(\w+)\s*=\s*(?:(\w+)\.)?(\w+)\s*$/i.exec(parte);
      if (!comparacao) {
        falhar('a condição ON deve conter apenas igualdades simples.');
      }
      const esq = comparacao[1];
      const dir = comparacao[3];
      const alvos = [aliasDestino, aliasOrigem, this._ultimoSegmento(destino), this._ultimoSegmento(origem)]
        .filter(Boolean)
        .map((nome) => nome.toLowerCase());
      const ehDestino = (nome) => !!nome && alvos.includes(nome.toLowerCase());
      const ehOrigem = (nome) =>
        !!nome &&
        [aliasOrigem, this._ultimoSegmento(origem)].filter(Boolean).some(
          (candidate) => candidate.toLowerCase() === nome.toLowerCase()
        );

      if (ehDestino(esq) && ehOrigem(dir) && !ehOrigem(esq)) {
        colunasConflito.push(comparacao[2]);
      } else if (ehOrigem(esq) && ehDestino(dir) && !ehOrigem(dir)) {
        colunasConflito.push(comparacao[4]);
      } else {
        falhar('a condição ON deve ligar uma coluna de origem a uma coluna de destino.');
      }
    }
    if (colunasConflito.length === 0) {
      falhar('não foi possível determinar as colunas de conflito.');
    }

    const atualizacao = lerPalavras(/^MATCHED\s+THEN\s+UPDATE\s+SET\s+/i);
    if (!atualizacao) {
      falhar('é necessário WHEN MATCHED THEN UPDATE SET.');
    }
    const inícioSet = posição;
    const próximoWhenSet = /\s+WHEN\s+/i.exec(código.slice(posição));
    const pontoVirgula = código.indexOf(';', posição);
    const fimSet = próximoWhenSet
      ? posição + próximoWhenSet.index
      : pontoVirgula >= 0
        ? pontoVirgula
        : código.length;
    const atribuicoes = this._dividirLista(sql.slice(inícioSet, fimSet)).map((atribuição) => {
      const encontrado = /^(?:(?:\w+)\.)?(\w+)\s*=\s*([\s\S]+)$/i.exec(atribuição);
      if (!encontrado) {
        falhar('atribuição inválida em UPDATE SET.');
      }
      let expressao = encontrado[2].trim();
      expressao = this._trocarQualificador(
        expressao,
        aliasOrigem || this._ultimoSegmento(origem),
        'excluded'
      );
      expressao = this._trocarQualificador(expressao, aliasDestino, '');
      return `${encontrado[1]} = ${expressao}`;
    });
    if (atribuicoes.length === 0) {
      falhar('UPDATE SET está vazio.');
    }

    if (!próximoWhenSet) {
      falhar('falta WHEN NOT MATCHED THEN INSERT.');
    }
    posição = fimSet;
    if (!lerPalavras(/^\s*WHEN\s+/i)) {
      falhar('cláusula WHEN inválida após UPDATE SET.');
    }
    if (!lerPalavras(/^NOT\s+MATCHED(?:\s+BY\s+TARGET)?\s+THEN\s+INSERT\s*\(/i)) {
      falhar('somente WHEN NOT MATCHED THEN INSERT é suportado.');
    }
    const fechoColunas = this._parenCorespondente(código, posição - 1);
    if (fechoColunas < 0) {
      falhar('lista de colunas do INSERT está incompleta.');
    }
    const colunas = sql.slice(posição, fechoColunas).trim();
    posição = fechoColunas + 1;
    if (!lerPalavras(/^\s*VALUES\s*\(/i)) {
      falhar('falta a lista VALUES do INSERT.');
    }
    const fechoValores = this._parenCorespondente(código, posição - 1);
    if (fechoValores < 0) {
      falhar('lista VALUES está incompleta.');
    }
    const valores = sql.slice(posição, fechoValores).trim();
    posição = fechoValores + 1;
    if (código.slice(posição).replace(/[\s;]/g, '') !== '') {
      falhar('cláusulas adicionais após WHEN NOT MATCHED.');
    }

    const origemSql = aliasOrigem ? `${origem} AS ${aliasOrigem}` : origem;
    return (
      `INSERT INTO ${destino} (${colunas}) SELECT ${valores} FROM ${origemSql} WHERE 1=1 ` +
      `ON CONFLICT (${colunasConflito.join(', ')}) DO UPDATE SET ${atribuicoes.join(', ')}`
    );
  }

  /** Divide uma condição por AND usando a máscara para ignorar literais. @private */
  _dividirPorE(condição) {
    const máscara = this._mascarar(condição);
    const partes = [];
    const regex = /\s+AND\s+/gi;
    let encontrado;
    let início = 0;
    while ((encontrado = regex.exec(máscara.code)) !== null) {
      partes.push(condição.slice(início, encontrado.index));
      início = encontrado.index + encontrado[0].length;
    }
    partes.push(condição.slice(início));
    return partes.filter((parte) => parte.trim().length > 0);
  }

  /** Último segmento de um nome qualificado, sem colchetes. @private */
  _ultimoSegmento(nome) {
    return String(nome).replace(/[[\]]/g, '').split('.').pop().trim();
  }

  /** Substitui `alias.` por `substituto.` fora de literais e colchetes. @private */
  _trocarQualificador(sql, alias, substituto) {
    if (!alias) {
      return sql;
    }
    const prefijo = `(?<![\\w@])${escaparRegex(alias)}\\s*\\.\\s*`;
    const novo = substituto ? `${substituto}.` : '';
    return this._substituirTodos(sql, prefijo, () => novo);
  }

  /** Converte UPDATE ... JOIN simples em UPDATE ... WHERE EXISTS. @private */
  _traduzirUpdateJoin(sql) {
    const máscara = this._mascarar(sql);
    if (!/^\s*UPDATE\b/i.test(máscara.code)) {
      return sql;
    }
    const junções = (máscara.code.match(/\bJOIN\b/gi) || []).length;
    if (junções === 0) {
      return sql;
    }
    const falhar = (detalhe) => {
      throw this._badRequest(`UPDATE ... JOIN não suportado: ${detalhe}`);
    };
    if (
      junções !== 1 ||
      /\b(?:LEFT|RIGHT|FULL|CROSS|OUTER|APPLY)\b/i.test(máscara.code)
    ) {
      falhar('somente um JOIN interno simples é suportado.');
    }

    try {
      return this._traduzirUpdateJoinUnico(sql, máscara, falhar);
    } catch (erro) {
      if (erro.code === 'BadRequestException') {
        throw erro;
      }
      falhar(erro.message);
    }
  }

  /** Traduz um único UPDATE com JOIN. @private */
  _traduzirUpdateJoinUnico(sql, máscara, falhar) {
    const código = máscara.code;
    const início = /^\s*UPDATE\s+/i.exec(código)[0].length;
    const pontoVirgula = código.indexOf(';', início);
    const fim = pontoVirgula >= 0 ? pontoVirgula : código.length;
    const comPontoVirgula = /;\s*$/.test(sql.trim());

    const índiceDe = (regex, de) => {
      const encontrado = regex.exec(código.slice(de, fim));
      return encontrado ? de + encontrado.index : -1;
    };
    const índiceJoin = índiceDe(/\bJOIN\b/i, início);
    const índiceSet = índiceDe(/\bSET\b/i, início);
    const índiceWhere = índiceDe(/\bWHERE\b/i, início);
    if (índiceJoin < 0 || índiceSet < 0) {
      falhar('não foi possível localizar JOIN e SET.');
    }

    let alvo;
    let atribuições;
    let inícioOrigem;
    let fimCondição;
    let inícioAtribuições;
    let fimAtribuições;

    if (índiceSet < índiceJoin) {
      // Forma T-SQL: UPDATE alvo SET ... FROM ... JOIN origem ON ...
      alvo = sql.slice(início, índiceSet).trim().replace(/\s+INNER$/i, '');
      const índiceFrom = índiceDe(/\bFROM\b/i, índiceSet);
      if (índiceFrom < 0) {
        falhar('falta a cláusula FROM após SET.');
      }
      const marcaJoin = /\bJOIN\s+/i.exec(código.slice(índiceFrom, fim));
      if (!marcaJoin) {
        falhar('falta a cláusula JOIN após FROM.');
      }
      inícioAtribuições = índiceSet + /\bSET\s+/i.exec(código.slice(índiceSet, fim))[0].length;
      fimAtribuições = índiceFrom;
      atribuições = sql.slice(inícioAtribuições, fimAtribuições).trim();
      inícioOrigem = índiceFrom + marcaJoin.index + marcaJoin[0].length;
      fimCondição = índiceWhere >= 0 && índiceWhere > índiceJoin ? índiceWhere : fim;
    } else {
      // Forma: UPDATE alvo JOIN origem ON ... SET ... WHERE ...
      alvo = sql.slice(início, índiceJoin).trim().replace(/\s+INNER$/i, '');
      inícioOrigem = índiceJoin + /\bJOIN\s+/i.exec(código.slice(índiceJoin, fim))[0].length;
      fimCondição = índiceSet;
      inícioAtribuições = índiceSet + /\bSET\s+/i.exec(código.slice(índiceSet, fim))[0].length;
      fimAtribuições = índiceWhere >= 0 && índiceWhere > inícioAtribuições ? índiceWhere : fim;
      atribuições = sql.slice(inícioAtribuições, fimAtribuições).trim();
    }

    const marcaOn = /\bON\s+/i.exec(código.slice(inícioOrigem, fimCondição));
    if (!marcaOn) {
      falhar('falta a cláusula ON do JOIN.');
    }
    const origem = sql.slice(inícioOrigem, inícioOrigem + marcaOn.index).trim();
    const inícioCondição = inícioOrigem + marcaOn.index + marcaOn[0].length;
    let condição = sql.slice(inícioCondição, fimCondição).trim();

    let condiçãoWhere = '';
    if (índiceWhere >= 0 && índiceWhere > inícioAtribuições) {
      const marcaWhere = /\bWHERE\s+/i.exec(código.slice(índiceWhere, fim));
      condiçãoWhere = sql
        .slice(índiceWhere + marcaWhere[0].length, fim)
        .trim();
    }

    const palavrasAlvo = alvo.split(/\s+/);
    let aliasAlvo = null;
    let alvoSql = alvo;
    if (
      palavrasAlvo.length > 1 &&
      /^[A-Za-z_]\w*$/.test(palavrasAlvo[palavrasAlvo.length - 1])
    ) {
      aliasAlvo = palavrasAlvo[palavrasAlvo.length - 1];
      const comAs =
        palavrasAlvo[palavrasAlvo.length - 2].toUpperCase() === 'AS';
      alvoSql = palavrasAlvo.slice(0, palavrasAlvo.length - (comAs ? 2 : 1)).join(' ');
    }
    atribuições = this._trocarQualificador(atribuições, aliasAlvo, '');
    condição = this._trocarQualificador(condição, aliasAlvo, alvoSql);
    condiçãoWhere = this._trocarQualificador(condiçãoWhere, aliasAlvo, alvoSql);

    const filtro = condiçãoWhere ? ` AND (${condiçãoWhere})` : '';
    const resultado =
      `UPDATE ${alvoSql} SET ${atribuições} WHERE EXISTS ` +
      `(SELECT 1 FROM ${origem} WHERE ${condição}${filtro})`;
    return comPontoVirgula ? `${resultado};` : resultado;
  }
}

module.exports = SqlTranslator;
module.exports.SqlTranslator = SqlTranslator;
