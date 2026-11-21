'use strict';

/**
 * Catálogo de sistema do SQL Server simulado.
 *
 * O database `master` contém as tabelas de sistema (`sys.databases`,
 * `sys.configurations`, `sys.endpoints`, ...) e as funções T-SQL
 * (`SERVERPROPERTY`, `IS_SRVROLEMEMBER`, ...). O arquivo do master é anexado
 * como schema `sys` em toda conexão, então `sys.databases` funciona
 * independentemente do database atual.
 *
 * Isso substitui a estratégia de interceptar consulta por consulta no tradutor:
 * o SMO passa a consultar objetos reais, com os tipos T-SQL corretos.
 */

const path = require('path');

/** Nome lógico do database que abriga as tabelas de sistema. */
const MASTER = 'master';

/** Databases de sistema de uma instância, na ordem dos database_id do SQL Server. */
const SISTEMA = [MASTER, 'tempdb', 'model', 'msdb'];

/** Objetos que existem no msdb de uma instância real do SQL Server. */
const OBJETOS_MSDB = new Set(['sysdac_instances']);

/** Edição de cada motor, no formato devolvido por SERVERPROPERTY('Edition'). */
const EDICOES = {
  'sqlserver-se': { edition: 'Standard Edition (64-bit)', engineEdition: 2 },
  'sqlserver-ex': { edition: 'Express Edition (64-bit)', engineEdition: 4 },
  'sqlserver-web': { edition: 'Web Edition (64-bit)', engineEdition: 2 },
  'sqlserver-ee': { edition: 'Enterprise Edition (64-bit)', engineEdition: 3 }
};

const VERSAO = '16.00.4035.2';

/**
 * DDL das tabelas de sistema. Os tipos T-SQL são preservados de propósito:
 * o SQLite aceita TINYINT/BIT como nomes de tipo e a camada TDS usa essa
 * declaração para escolher INTNTYPE de 1 byte / bit no COLMETADATA.
 */
const DDL_SISTEMA = `
  CREATE TABLE IF NOT EXISTS databases (
    name TEXT NOT NULL PRIMARY KEY,
    database_id INTEGER NOT NULL UNIQUE,
    state TINYINT NOT NULL DEFAULT 0,
    state_desc TEXT NOT NULL DEFAULT 'ONLINE',
    owner_sid BLOB,
    create_date DATETIME,
    compatibility_level INT NOT NULL DEFAULT 160,
    collation_name TEXT NOT NULL DEFAULT 'SQL_Latin1_General_CP1_CI_AS',
    catalog_collation_type TINYINT NOT NULL DEFAULT 2,
    catalog_collation_type_desc TEXT NOT NULL DEFAULT 'SQL_COLLATION',
    recovery_model TINYINT NOT NULL DEFAULT 1,
    recovery_model_desc TEXT NOT NULL DEFAULT 'FULL',
    is_read_only BIT NOT NULL DEFAULT 0,
    is_auto_close_on BIT NOT NULL DEFAULT 0,
    is_auto_shrink_on BIT NOT NULL DEFAULT 0,
    is_in_standby BIT NOT NULL DEFAULT 0,
    is_distributor BIT NOT NULL DEFAULT 0,
    is_source_of_replication BIT NOT NULL DEFAULT 0,
    is_cdc_enabled BIT NOT NULL DEFAULT 0,
    service_broker_guid TEXT
  );

  CREATE TABLE IF NOT EXISTS configurations (
    name TEXT NOT NULL PRIMARY KEY,
    configuration_id INT NOT NULL UNIQUE,
    minimum INT NOT NULL DEFAULT 0,
    maximum INT NOT NULL DEFAULT 1,
    value INT NOT NULL DEFAULT 0,
    value_in_use INT NOT NULL DEFAULT 0,
    description TEXT,
    is_dynamic BIT NOT NULL DEFAULT 1,
    is_advanced BIT NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS endpoints (
    name TEXT NOT NULL PRIMARY KEY,
    endpoint_id INT NOT NULL UNIQUE,
    is_admin_endpoint BIT NOT NULL DEFAULT 0,
    state TINYINT NOT NULL DEFAULT 0,
    state_desc TEXT NOT NULL DEFAULT 'STARTED',
    protocol_desc TEXT NOT NULL DEFAULT 'TCP',
    type_desc TEXT NOT NULL DEFAULT 'TSQL'
  );

  CREATE TABLE IF NOT EXISTS dm_exec_connections (
    session_id INT NOT NULL PRIMARY KEY,
    endpoint_id INT NOT NULL,
    protocol_type TEXT NOT NULL DEFAULT 'TCP',
    local_net_address TEXT NOT NULL DEFAULT '127.0.0.1',
    local_tcp_port INT NOT NULL DEFAULT 1433,
    client_net_address TEXT NOT NULL DEFAULT '127.0.0.1'
  );

  CREATE TABLE IF NOT EXISTS dm_exec_sessions (
    session_id INT NOT NULL PRIMARY KEY,
    authenticating_database_id INT NOT NULL DEFAULT 1,
    login_name TEXT NOT NULL DEFAULT 'admin',
    database_id INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'running'
  );

  CREATE TABLE IF NOT EXISTS server_principals (
    name TEXT NOT NULL PRIMARY KEY,
    principal_id INTEGER NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'S',
    sid BLOB,
    credential_id INTEGER,
    is_disabled BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS asymmetric_keys (
    name TEXT NOT NULL PRIMARY KEY,
    sid BLOB
  );

  CREATE TABLE IF NOT EXISTS certificates (
    name TEXT NOT NULL PRIMARY KEY,
    sid BLOB
  );

  CREATE TABLE IF NOT EXISTS credentials (
    credential_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS server_triggers (
    name TEXT NOT NULL PRIMARY KEY,
    object_id INTEGER NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'TR',
    parent_class INTEGER NOT NULL DEFAULT 100,
    is_ms_shipped BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS server_assembly_modules (
    object_id INTEGER PRIMARY KEY,
    assembly_id INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS server_sql_modules (
    object_id INTEGER PRIMARY KEY,
    definition TEXT
  );

  CREATE TABLE IF NOT EXISTS dm_os_process_memory (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    physical_memory_in_use_kb BIGINT NOT NULL DEFAULT 8388608,
    available_commit_limit_kb BIGINT NOT NULL DEFAULT 8388608,
    memory_utilization_percentage INT NOT NULL DEFAULT 50,
    page_fault_count BIGINT NOT NULL DEFAULT 0,
    process_physical_memory_low BIT NOT NULL DEFAULT 0,
    process_virtual_memory_low BIT NOT NULL DEFAULT 0
  );
`;

/** Tabela do msdb usada pelo SMO para detectar suporte a DAC. */
const DDL_MSDB = `
  CREATE TABLE IF NOT EXISTS sysdac_instances (
    instance_id INT NOT NULL PRIMARY KEY,
    instance_name TEXT NOT NULL,
    type_name TEXT NOT NULL,
    type_version TEXT NOT NULL,
    description TEXT,
    creator_name TEXT NOT NULL,
    create_time DATETIME NOT NULL,
    object_id INT NOT NULL
  );
`;

const CONFIGURACOES = [
  ['show advanced options', 16383, 0, 1, 0, 0, 'Show advanced options'],
  ['Agent XPs', 16384, 0, 1, 1, 1, 'Agent XPs enabled'],
  ['default language', 148, 0, 9999, 0, 0, 'default language'],
  ['max server memory (MB)', 1544, 16, 2147483647, 2147483647, 1, 'Maximum size of memory'],
  ['min server memory (MB)', 1543, 0, 2147483647, 0, 1, 'Minimum size of memory'],
  ['SMO and DMO Enabled', 16387, 0, 1, 1, 1, 'SMO and DMO enabled'],
  ['xp_cmdshell', 16390, 0, 1, 0, 1, 'Enable or disable command shell extensions'],
  ['Ad Hoc Distributed Queries', 1532, 0, 1, 0, 1, 'Ad hoc distributed queries'],
  ['clr enabled', 16391, 0, 1, 0, 1, 'CLR integration enabled']
];

/** @private */
function editionDoMotor(engine) {
  return EDICOES[String(engine || '').toLowerCase()] || EDICOES['sqlserver-se'];
}

/** @private */
function criarTabelas(db, schema) {
  db.exec(DDL_SISTEMA.replace(/CREATE TABLE IF NOT EXISTS /g, `CREATE TABLE IF NOT EXISTS ${schema}.`));
}

/**
 * Bancos criados por versoes anteriores nao tinham catalog_collation_type.
 * O SQLite nao altera CREATE TABLE IF NOT EXISTS, entao a coluna e adicionada
 * explicitamente quando falta.
 * @private
 */
function migrarColunas(db, schema) {
  const colunas = db.prepare(`PRAGMA ${schema}.table_info(databases)`)
    .all()
    .map((coluna) => coluna.name);
  if (!colunas.includes('catalog_collation_type')) {
    db.exec(`ALTER TABLE ${schema}.databases ADD COLUMN catalog_collation_type TINYINT NOT NULL DEFAULT 2`);
  }
  if (!colunas.includes('catalog_collation_type_desc')) {
    db.exec(`ALTER TABLE ${schema}.databases ADD COLUMN catalog_collation_type_desc TEXT NOT NULL DEFAULT 'SQL_COLLATION'`);
  }
}

/**
 * Popula as tabelas de sistema de forma idempotente, refletindo databases
 * criados/removidos desde a última conexão.
 * @private
 */
function popularTabelas(db, schema, nomesDatabases) {
  const nomes = Array.from(new Set([...SISTEMA, ...(nomesDatabases || [])]))
    .filter((nome) => typeof nome === 'string' && nome.length > 0);

  const inserirDatabase = db.prepare(`
    INSERT INTO ${schema}.databases (name, database_id, state, state_desc, create_date)
    VALUES (?, ?, 0, 'ONLINE', ?)
    ON CONFLICT(name) DO UPDATE SET state = 0, state_desc = 'ONLINE'
  `);
  const data = new Date().toISOString();
  let id = 1;
  for (const nome of nomes) {
    inserirDatabase.run(nome, id, data);
    id += 1;
  }

  const inserirConfiguracao = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.configurations
      (name, configuration_id, minimum, maximum, value, value_in_use, description, is_dynamic, is_advanced)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
  `);
  CONFIGURACOES.forEach((config) => inserirConfiguracao.run(...config));

  db.prepare(`
    INSERT OR IGNORE INTO ${schema}.server_principals (name, principal_id, type, sid)
    VALUES ('sa', 1, 'S', X'01'), ('admin', 2, 'S', X'02')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO ${schema}.endpoints (name, endpoint_id, protocol_desc, type_desc)
    VALUES ('TSQL Default TCP', 1, 'TCP', 'TSQL')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO ${schema}.dm_exec_connections (session_id, endpoint_id) VALUES (1, 1)
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO ${schema}.dm_exec_sessions
      (session_id, authenticating_database_id, database_id) VALUES (1, 1, 1)
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO ${schema}.dm_os_process_memory
      (id, physical_memory_in_use_kb) VALUES (1, 8388608)
  `).run();
}

/**
 * Registra as funções T-SQL usadas pelo SSMS/SMO em toda conexão SQLite.
 * @private
 */
function registrarFuncoes(db, { dbName, engine, listarDatabases, usuario = 'admin' }) {
  const edicao = editionDoMotor(engine);
  const ehMsdb = String(dbName || '').toLowerCase() === 'msdb';
  const databases = () => {
    const nomes = (listarDatabases ? listarDatabases() : [])
      .filter((nome) => !SISTEMA.some((item) => item.toLowerCase() === String(nome).toLowerCase()));
    return [...SISTEMA, ...nomes];
  };

  const propriedades = {
    EDITION: edicao.edition,
    ENGINEEDITION: edicao.engineEdition,
    PRODUCTVERSION: VERSAO,
    PRODUCTLEVEL: 'RTM',
    PRODUCTMAJORVERSION: 16,
    PRODUCTMINORVERSION: 0,
    MICROSOFTVERSION: 16,
    SERVERNAME: 'LOCAL',
    INSTANCENAME: null,
    COMPUTERNAMEPHYSICALNETBIOS: 'LOCAL',
    COLLATION: 'SQL_Latin1_General_CP1_CI_AS',
    LICENSETYPE: 'PER_CORE',
    ISSINGLEUSER: 0,
    ISXTPSUPPORTED: 0,
    ISFULLTEXTINSTALLED: 0,
    ISCONTAINEDAUTHENTICATION: 0,
    BUILTCLRVERSION: 'v4.0.30319'
  };

  db.function(
    'SERVERPROPERTY',
    { deterministic: false },
    (nome) => {
      const chave = String(nome == null ? '' : nome).toUpperCase();
      return chave in propriedades ? propriedades[chave] : null;
    }
  );

  const conexao = {
    NET_TRANSPORT: 'TCP',
    LOCAL_NET_ADDRESS: '127.0.0.1',
    LOCAL_TCP_PORT: 1433,
    CLIENT_NET_ADDRESS: '127.0.0.1',
    PROTOCOL_TYPE: 'TDS',
    ISMULTIPLEACTIVERESULTSETS: 0,
    SERVERNAME: 'LOCAL'
  };
  db.function(
    'CONNECTIONPROPERTY',
    { deterministic: false },
    (nome) => {
      const chave = String(nome == null ? '' : nome).toUpperCase();
      return chave in conexao ? conexao[chave] : null;
    }
  );

  db.function(
    'IS_SRVROLEMEMBER',
    { deterministic: false },
    (role) => (String(role || '').toLowerCase() === 'sysadmin' ? 1 : 0)
  );

  db.function('SUSER_SNAME', { varargs: true }, () => usuario);
  db.function('SUSER_ID', { varargs: true }, () => 1);
  db.function('ORIGINAL_LOGIN', { varargs: true }, () => usuario);
  db.function('IS_MEMBER', () => 0);

  // QUOTENAME usada pelo SMO para montar URN de objetos. Sem delimitador o
  // SQL Server usa colchetes, escapando ']' como ']]'.
  db.function('QUOTENAME', { varargs: true }, (valor, delimitador) => {
    if (valor == null) return null;
    const texto = String(valor);
    const delim = delimitador == null ? '[]' : String(delimitador);
    if (delim === "''" || delim === "'") return `'${texto.replace(/'/g, "''")}'`;
    if (delim === '""' || delim === '"') return `"${texto.replace(/"/g, '""')}"`;
    if (delim === '``' || delim === '`') return `\`${texto.replace(/`/g, '``')}\``;
    return `[${texto.replace(/\]/g, ']]')}]`;
  });

  db.function('FULLTEXTSERVICEPROPERTY', (nome) =>
    String(nome || '').toUpperCase() === 'ISFULLTEXTINSTALLED' ? 0 : null
  );

  // OBJECT_ID devolve null para objetos inexistentes (ex.: sysdac_instances,
  // usado pelo SMO para detectar DAC) e o rowid de sqlite_master para os
  // objetos reais do database atual.
  db.function('OBJECT_ID', { varargs: true }, (nome) => {
    if (nome == null) return null;
    const alvo = String(nome)
      .replace(/^dbo\./i, '')
      .replace(/\[/g, '')
      .replace(/\]/g, '')
      .toLowerCase();
    try {
      if (ehMsdb && OBJETOS_MSDB.has(alvo)) {
        return 1001;
      }
      const objeto = db.prepare(
        'SELECT rowid AS id FROM main.sqlite_master WHERE lower(name) = ?'
      ).get(alvo);
      return objeto ? objeto.id : null;
    } catch (_erro) {
      return null;
    }
  });

  db.function('DB_ID', { varargs: true }, (nome) => {
    if (nome == null) return 1;
    const indice = databases()
      .findIndex((item) => item.toLowerCase() === String(nome).toLowerCase());
    return indice < 0 ? null : indice + 1;
  });
  db.function('DB_NAME', { varargs: true }, (id) => {
    if (id == null) return MASTER;
    return databases()[Number(id) - 1] || null;
  });

  // HAS_DBACCESS é usado pelo SSMS para decidir quais nós do Object Explorer
  // mostrar. O administrador tem acesso a todos os databases existentes.
  db.function('HAS_DBACCESS', (nome) => {
    if (nome == null) return 0;
    const alvo = String(nome).toLowerCase();
    return databases().some((item) => item.toLowerCase() === alvo) ? 1 : 0;
  });

  // CONVERT(tipo, valor): o tradutor transforma o primeiro argumento (um tipo
  // T-SQL, não uma expressão) em string antes de chamar esta função.
  db.function('CONVERT', { deterministic: true }, (tipo, valor) => {
    const nome = String(tipo || '').toUpperCase();
    if (/INT|BIGINT|SMALLINT|TINYINT|BIT|DECIMAL|NUMERIC|FLOAT|MONEY|REAL/.test(nome)) {
      const numero = Number(valor);
      return Number.isFinite(numero) ? numero : 0;
    }
    return valor == null ? null : String(valor);
  });
}

/**
 * Prepara uma conexão SQLite recém-aberta com o catálogo do SQL Server.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ dataDir: string, dbName?: string, engine?: string, listarDatabases?: Function, usuario?: string }} contexto
 */
function instalar(db, { dataDir, dbName, engine, listarDatabases, usuario }) {
  const masterPath = path.join(dataDir, `${MASTER}.db`);
  const caminhoSeguro = masterPath.replace(/'/g, "''");
  db.exec(`ATTACH DATABASE '${caminhoSeguro}' AS sys`);

  const anexado = db.pragma('database_list', { simple: false })
    .some((item) => item.name === 'sys');
  if (!anexado) {
    throw new Error('Não foi possível anexar o catálogo de sistema (schema sys)');
  }

  criarTabelas(db, 'sys');
  migrarColunas(db, 'sys');
  const nomes = listarDatabases ? listarDatabases() : [];
  popularTabelas(db, 'sys', nomes);
  if (String(dbName || '').toLowerCase() === 'msdb') {
    db.exec(DDL_MSDB);
  }
  registrarFuncoes(db, { dbName, engine, listarDatabases, usuario });
}

module.exports = { instalar, MASTER, SISTEMA, EDICOES, VERSAO };
