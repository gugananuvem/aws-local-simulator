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
    containment TINYINT NOT NULL DEFAULT 0,
    source_database_id INT,
    is_fulltext_enabled BIT NOT NULL DEFAULT 0,
    user_access TINYINT NOT NULL DEFAULT 0,
    recovery_model TINYINT NOT NULL DEFAULT 1,
    recovery_model_desc TEXT NOT NULL DEFAULT 'FULL',
    is_read_only BIT NOT NULL DEFAULT 0,
    is_auto_close_on BIT NOT NULL DEFAULT 0,
    is_auto_shrink_on BIT NOT NULL DEFAULT 0,
    is_in_standby BIT NOT NULL DEFAULT 0,
    is_distributor BIT NOT NULL DEFAULT 0,
    is_source_of_replication BIT NOT NULL DEFAULT 0,
    is_cdc_enabled BIT NOT NULL DEFAULT 0,
    is_ledger_on BIT NOT NULL DEFAULT 0,
    is_remote_data_archive_enabled BIT NOT NULL DEFAULT 0,
    service_broker_guid TEXT
  );

  CREATE TABLE IF NOT EXISTS database_mirroring (
    database_id INTEGER NOT NULL PRIMARY KEY,
    mirroring_role TINYINT,
    mirroring_state TINYINT,
    mirroring_witness_state TINYINT,
    mirroring_guid TEXT
  );

  CREATE TABLE IF NOT EXISTS server_principal_credentials (
    principal_id INTEGER NOT NULL,
    credential_id INTEGER NOT NULL,
    PRIMARY KEY (principal_id, credential_id)
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
    create_date DATETIME DEFAULT '2023-01-01 00:00:00',
    modify_date DATETIME DEFAULT '2023-01-01 00:00:00',
    default_language_name TEXT DEFAULT 'us_english',
    default_database_name TEXT DEFAULT 'master',
    is_disabled BIT NOT NULL DEFAULT 0,
    is_fixed_role BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS server_role_members (
    role_principal_id INTEGER NOT NULL,
    member_principal_id INTEGER NOT NULL,
    PRIMARY KEY (role_principal_id, member_principal_id)
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

  CREATE TABLE IF NOT EXISTS syslanguages (
    name TEXT NOT NULL PRIMARY KEY,
    alias TEXT NOT NULL,
    langid SMALLINT NOT NULL DEFAULT 1033,
    lcid SMALLINT NOT NULL DEFAULT 1033
  );

  CREATE TABLE IF NOT EXISTS server_permissions (
    grantee_principal_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    state TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sql_logins (
    principal_id INTEGER NOT NULL PRIMARY KEY,
    is_expiration_checked BIT NOT NULL DEFAULT 0,
    is_policy_checked BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS backup_devices (
    name TEXT NOT NULL PRIMARY KEY,
    type TINYINT NOT NULL DEFAULT 2,
    physical_name TEXT
  );

  CREATE TABLE IF NOT EXISTS cryptographic_providers (
    name TEXT NOT NULL PRIMARY KEY,
    provider_id INT NOT NULL UNIQUE,
    is_enabled BIT NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS dm_cryptographic_provider_properties (
    provider_id INTEGER PRIMARY KEY,
    provider_version TEXT NOT NULL DEFAULT '1.0'
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

/**
 * Catalogo especifico de cada database: sys.tables, sys.all_views, sys.indexes,
 * sys.all_columns etc. No SQL Server essas views sao locais ao database; aqui
 * elas vivem no arquivo do proprio database e o tradutor reescreve `sys.<nome>`
 * para `main.<nome>` quando o objeto e local.
 */
const DDL_DATABASE = `
  CREATE TABLE IF NOT EXISTS schemas (
    name TEXT NOT NULL PRIMARY KEY,
    schema_id INTEGER NOT NULL UNIQUE,
    principal_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS database_principals (
    name TEXT NOT NULL PRIMARY KEY,
    principal_id INTEGER NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'S',
    sid BLOB,
    create_date DATETIME
  );

  CREATE TABLE IF NOT EXISTS objects (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    schema_id INTEGER NOT NULL DEFAULT 1,
    principal_id INTEGER DEFAULT 1,
    type TEXT NOT NULL,
    type_desc TEXT NOT NULL,
    create_date DATETIME,
    parent_object_id INTEGER,
    is_ms_shipped BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tables (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    schema_id INTEGER NOT NULL DEFAULT 1,
    principal_id INTEGER DEFAULT 1,
    create_date DATETIME,
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    is_memory_optimized BIT NOT NULL DEFAULT 0,
    is_remote_data_archive_enabled BIT NOT NULL DEFAULT 0,
    temporal_type TINYINT NOT NULL DEFAULT 0,
    ledger_type INT NOT NULL DEFAULT 0,
    is_filetable BIT NOT NULL DEFAULT 0,
    is_external BIT NOT NULL DEFAULT 0,
    is_node BIT NOT NULL DEFAULT 0,
    is_edge BIT NOT NULL DEFAULT 0,
    modify_date DATETIME,
    lob_data_space_id INTEGER NOT NULL DEFAULT 0,
    uses_ansi_nulls BIT NOT NULL DEFAULT 1,
    durability TINYINT NOT NULL DEFAULT 0,
    is_replicated BIT NOT NULL DEFAULT 0,
    lock_escalation TINYINT NOT NULL DEFAULT 0,
    history_table_id INTEGER,
    filestream_data_space_id INTEGER,
    is_dropped_ledger_table BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS all_views (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    schema_id INTEGER NOT NULL DEFAULT 1,
    principal_id INTEGER DEFAULT 1,
    type TEXT NOT NULL DEFAULT 'V',
    create_date DATETIME,
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    ledger_view_type TINYINT NOT NULL DEFAULT 0,
    is_dropped_ledger_view BIT NOT NULL DEFAULT 0,
    definition TEXT
  );

  CREATE TABLE IF NOT EXISTS synonyms (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    schema_id INTEGER NOT NULL DEFAULT 1,
    principal_id INTEGER DEFAULT 1,
    create_date DATETIME
  );

  CREATE TABLE IF NOT EXISTS indexes (
    name TEXT,
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    type TINYINT NOT NULL DEFAULT 0,
    type_desc TEXT NOT NULL DEFAULT 'HEAP',
    is_primary_key BIT NOT NULL DEFAULT 0,
    is_unique_constraint BIT NOT NULL DEFAULT 0,
    is_hypothetical BIT NOT NULL DEFAULT 0,
    is_disabled BIT NOT NULL DEFAULT 0,
    data_space_id INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (object_id, index_id)
  );

  CREATE TABLE IF NOT EXISTS data_spaces (
    data_space_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'ROWS_FILEGROUP'
  );

  CREATE TABLE IF NOT EXISTS types (
    name TEXT NOT NULL PRIMARY KEY,
    user_type_id INTEGER NOT NULL UNIQUE,
    system_type_id INTEGER NOT NULL,
    max_length INTEGER NOT NULL DEFAULT 8,
    precision TINYINT NOT NULL DEFAULT 18,
    scale TINYINT NOT NULL DEFAULT 0,
    is_user_defined BIT NOT NULL DEFAULT 0,
    schema_id INTEGER NOT NULL DEFAULT 4,
    is_assembly_type BIT NOT NULL DEFAULT 0,
    is_table_type BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS all_columns (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    column_id INTEGER NOT NULL,
    user_type_id INTEGER NOT NULL,
    system_type_id INTEGER NOT NULL,
    max_length INTEGER NOT NULL DEFAULT 8,
    precision TINYINT NOT NULL DEFAULT 18,
    scale TINYINT NOT NULL DEFAULT 0,
    is_nullable BIT NOT NULL DEFAULT 1,
    is_sparse BIT NOT NULL DEFAULT 0,
    is_identity BIT NOT NULL DEFAULT 0,
    is_computed BIT NOT NULL DEFAULT 0,
    collation_name TEXT,
    default_object_id INTEGER NOT NULL DEFAULT 0,
    rule_object_id INTEGER NOT NULL DEFAULT 0,
    xml_collection_id INTEGER NOT NULL DEFAULT 0,
    is_ansi_padded BIT NOT NULL DEFAULT 1,
    is_rowguidcol BIT NOT NULL DEFAULT 0,
    is_filestream BIT NOT NULL DEFAULT 0,
    is_column_set BIT NOT NULL DEFAULT 0,
    generated_always_type TINYINT NOT NULL DEFAULT 0,
    is_hidden BIT NOT NULL DEFAULT 0,
    is_dropped_ledger_column BIT NOT NULL DEFAULT 0,
    is_masked BIT NOT NULL DEFAULT 0,
    graph_type INTEGER NOT NULL DEFAULT 0,
    encryption_type INTEGER NOT NULL DEFAULT 0,
    encryption_algorithm_name TEXT,
    column_encryption_key_id INTEGER,
    is_xml_document BIT NOT NULL DEFAULT 0,
    PRIMARY KEY (object_id, column_id)
  );

  CREATE TABLE IF NOT EXISTS sql_modules (
    object_id INTEGER NOT NULL PRIMARY KEY,
    definition TEXT
  );

  CREATE TABLE IF NOT EXISTS system_sql_modules (
    object_id INTEGER NOT NULL PRIMARY KEY,
    definition TEXT
  );

  CREATE TABLE IF NOT EXISTS extended_properties (
    major_id INTEGER NOT NULL,
    minor_id INTEGER NOT NULL DEFAULT 0,
    class TINYINT NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS default_constraints (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    principal_id INTEGER DEFAULT 1,
    schema_id INTEGER NOT NULL DEFAULT 1,
    parent_object_id INTEGER NOT NULL,
    parent_column_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'D',
    type_desc TEXT NOT NULL DEFAULT 'DEFAULT_CONSTRAINT',
    create_date DATETIME,
    modify_date DATETIME,
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    definition TEXT
  );

  CREATE TABLE IF NOT EXISTS index_columns (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    index_column_id INTEGER NOT NULL,
    column_id INTEGER NOT NULL,
    is_included_column BIT NOT NULL DEFAULT 0,
    PRIMARY KEY (object_id, index_id, index_column_id)
  );

  CREATE TABLE IF NOT EXISTS computed_columns (
    object_id INTEGER NOT NULL,
    column_id INTEGER NOT NULL,
    is_persisted BIT NOT NULL DEFAULT 0,
    definition TEXT,
    PRIMARY KEY (object_id, column_id)
  );

  CREATE TABLE IF NOT EXISTS identity_columns (
    object_id INTEGER NOT NULL,
    column_id INTEGER NOT NULL,
    seed_value NUMERIC(38),
    increment_value NUMERIC(38),
    is_not_for_replication BIT NOT NULL DEFAULT 0,
    PRIMARY KEY (object_id, column_id)
  );

  CREATE TABLE IF NOT EXISTS foreign_key_columns (
    parent_object_id INTEGER NOT NULL,
    parent_column_id INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS column_encryption_keys (
    column_encryption_key_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS xml_schema_collections (
    xml_collection_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    schema_id INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS sensitivity_classifications (
    major_id INTEGER NOT NULL,
    minor_id INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    label_id INTEGER,
    information_type TEXT,
    information_type_id INTEGER,
    rank INTEGER
  );

  CREATE TABLE IF NOT EXISTS change_tracking_tables (
    object_id INTEGER NOT NULL PRIMARY KEY,
    is_track_columns_updated_on BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS filetables (
    object_id INTEGER NOT NULL PRIMARY KEY,
    directory_name TEXT,
    filename_collation_name TEXT,
    is_enabled BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS periods (
    object_id INTEGER NOT NULL,
    start_column_id INTEGER,
    end_column_id INTEGER,
    PRIMARY KEY (object_id)
  );

  CREATE TABLE IF NOT EXISTS remote_data_archive_tables (
    object_id INTEGER NOT NULL PRIMARY KEY,
    remote_table_name TEXT,
    filter_predicate TEXT,
    migration_state TINYINT NOT NULL DEFAULT 0,
    is_migration_paused BIT NOT NULL DEFAULT 0,
    migration_direction_desc TEXT
  );

  CREATE VIEW IF NOT EXISTS views AS SELECT * FROM all_views;
  CREATE VIEW IF NOT EXISTS columns AS SELECT * FROM all_columns;
`;

/** Tabelas criadas pelo proprio catalogo, que nao devem aparecer como objetos de usuario. */
const OBJETOS_DO_CATALOGO = new Set([
  'schemas', 'database_principals', 'objects', 'tables', 'all_views', 'views',
  'synonyms', 'indexes', 'data_spaces', 'types', 'all_columns', 'columns',
  'sql_modules', 'system_sql_modules', 'extended_properties',
  'default_constraints', 'index_columns', 'computed_columns', 'identity_columns',
  'foreign_key_columns', 'column_encryption_keys', 'xml_schema_collections',
  'sensitivity_classifications', 'change_tracking_tables', 'filetables',
  'periods', 'remote_data_archive_tables',
  'sysdac_instances', 'syspolicy_configuration'
]);

/** Mapeamento dos tipos SQLite para os tipos do catalogo sys.types. */
const TIPOS_SQL = Object.freeze({
  INT: ['int', 56, 56, 4, 10, 0],
  INTEGER: ['int', 56, 56, 4, 10, 0],
  BIGINT: ['bigint', 127, 127, 8, 19, 0],
  SMALLINT: ['smallint', 52, 52, 2, 5, 0],
  TINYINT: ['tinyint', 48, 48, 1, 3, 0],
  BIT: ['bit', 104, 104, 1, 1, 0],
  BOOLEAN: ['bit', 104, 104, 1, 1, 0],
  DATETIME: ['datetime', 61, 61, 8, 23, 3],
  DATE: ['date', 40, 40, 3, 10, 0],
  TIME: ['time', 41, 41, 5, 16, 7],
  VARCHAR: ['varchar', 167, 167, 8000, 0, 0],
  CHAR: ['char', 175, 175, 8000, 0, 0],
  TEXT: ['varchar', 167, 167, 8000, 0, 0],
  NVARCHAR: ['nvarchar', 231, 231, 8000, 0, 0],
  NCHAR: ['nchar', 239, 239, 8000, 0, 0],
  DECIMAL: ['decimal', 106, 106, 17, 18, 2],
  NUMERIC: ['numeric', 108, 108, 17, 18, 2],
  REAL: ['real', 59, 59, 4, 24, 0],
  FLOAT: ['float', 62, 62, 8, 53, 0],
  DOUBLE: ['float', 62, 62, 8, 53, 0],
  MONEY: ['money', 60, 60, 8, 19, 4],
  UNIQUEIDENTIFIER: ['uniqueidentifier', 36, 36, 16, 0, 0],
  XML: ['xml', 241, 241, 16, 0, 0],
  BLOB: ['varbinary', 165, 165, 8000, 0, 0]
});

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

  CREATE TABLE IF NOT EXISTS syspolicy_configuration (
    name TEXT NOT NULL PRIMARY KEY,
    current_value TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS syspolicy_system_health_state (
    policy_id INTEGER NOT NULL,
    target_query_expression_with_id TEXT NOT NULL,
    last_run_date DATETIME,
    state TINYINT NOT NULL DEFAULT 1,
    state_description TEXT NOT NULL DEFAULT 'Healthy'
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
 * Bancos criados por versoes anteriores nao tinham todas as colunas do
 * catalogo. O SQLite nao altera CREATE TABLE IF NOT EXISTS, entao cada coluna
 * ausente e adicionada explicitamente.
 * @private
 */
function migrarColunas(db, schema, tabela, definicoes) {
  const existentes = db.prepare(`PRAGMA ${schema}.table_info(${tabela})`)
    .all()
    .map((coluna) => coluna.name);
  for (const [nome, definicao] of definicoes) {
    if (!existentes.includes(nome)) {
      db.exec(`ALTER TABLE ${schema}.${tabela} ADD COLUMN ${nome} ${definicao}`);
    }
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
  const papeis = [
    'sysadmin', 'serveradmin', 'setupadmin', 'securityadmin', 'processadmin',
    'dbcreator', 'diskadmin', 'bulkadmin', 'public'
  ];
  const inserirPapel = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.server_principals
      (name, principal_id, type, is_fixed_role, create_date)
    VALUES (?, ?, 'R', 1, ?)
  `);
  papeis.forEach((papel, indice) => inserirPapel.run(papel, 1001 + indice, data));
  const inserirMembroPapel = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.server_role_members (role_principal_id, member_principal_id)
    VALUES (?, ?)
  `);
  for (const principalId of [1, 2]) {
    inserirMembroPapel.run(1001, principalId);
    inserirMembroPapel.run(1009, principalId);
  }
  db.prepare(`
    INSERT OR IGNORE INTO ${schema}.syslanguages (name, alias) VALUES ('us_english', 'English')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO ${schema}.sql_logins (principal_id) VALUES (1), (2)
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
 * Reconstrói as views de catalogo locais (sys.tables, sys.indexes, ...) a partir
 * do schema SQLite real do database atual.
 * @private
 */
function sincronizarCatalogoDatabase(db) {
  db.exec(DDL_DATABASE);
  migrarColunas(db, 'main', 'objects', [
    ['parent_object_id', 'INTEGER']
  ]);
  migrarColunas(db, 'main', 'tables', [
    ['modify_date', 'DATETIME'],
    ['lob_data_space_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['uses_ansi_nulls', 'BIT NOT NULL DEFAULT 1'],
    ['durability', 'TINYINT NOT NULL DEFAULT 0'],
    ['is_replicated', 'BIT NOT NULL DEFAULT 0'],
    ['lock_escalation', 'TINYINT NOT NULL DEFAULT 0'],
    ['history_table_id', 'INTEGER'],
    ['filestream_data_space_id', 'INTEGER'],
    ['is_dropped_ledger_table', 'BIT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'all_columns', [
    ['default_object_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['rule_object_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['xml_collection_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_ansi_padded', 'BIT NOT NULL DEFAULT 1'],
    ['is_rowguidcol', 'BIT NOT NULL DEFAULT 0'],
    ['is_filestream', 'BIT NOT NULL DEFAULT 0'],
    ['is_column_set', 'BIT NOT NULL DEFAULT 0'],
    ['generated_always_type', 'TINYINT NOT NULL DEFAULT 0'],
    ['is_hidden', 'BIT NOT NULL DEFAULT 0'],
    ['is_dropped_ledger_column', 'BIT NOT NULL DEFAULT 0'],
    ['is_masked', 'BIT NOT NULL DEFAULT 0'],
    ['graph_type', 'INTEGER NOT NULL DEFAULT 0'],
    ['encryption_type', 'INTEGER NOT NULL DEFAULT 0'],
    ['encryption_algorithm_name', 'TEXT'],
    ['column_encryption_key_id', 'INTEGER'],
    ['is_xml_document', 'BIT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'all_views', [
    ['is_dropped_ledger_view', 'BIT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'types', [
    ['schema_id', 'INTEGER NOT NULL DEFAULT 4'],
    ['is_assembly_type', 'BIT NOT NULL DEFAULT 0'],
    ['is_table_type', 'BIT NOT NULL DEFAULT 0']
  ]);

  const data = '2023-01-01 00:00:00';
  for (const tabela of [
    'objects', 'tables', 'all_views', 'synonyms', 'indexes', 'all_columns',
    'sql_modules', 'system_sql_modules', 'extended_properties',
    'default_constraints', 'index_columns', 'computed_columns', 'identity_columns',
    'foreign_key_columns', 'column_encryption_keys', 'xml_schema_collections',
    'sensitivity_classifications', 'change_tracking_tables', 'filetables',
    'periods', 'remote_data_archive_tables'
  ]) {
    db.exec(`DELETE FROM main.${tabela}`);
  }

  db.prepare(`INSERT OR IGNORE INTO main.schemas (name, schema_id, principal_id) VALUES ('dbo', 1, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO main.data_spaces (data_space_id, name) VALUES (1, 'PRIMARY')`).run();
  db.prepare(`
    INSERT OR IGNORE INTO main.database_principals (name, principal_id, type, create_date)
    VALUES ('dbo', 1, 'S', ?), ('guest', 2, 'S', ?)
  `).run(data, data);

  const inserirTipo = db.prepare(`
    INSERT OR IGNORE INTO main.types
      (name, user_type_id, system_type_id, max_length, precision, scale)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const tipos = new Map();
  Object.values(TIPOS_SQL).forEach((definicao) => {
    if (!tipos.has(definicao[0])) tipos.set(definicao[0], definicao);
  });
  for (const definicao of tipos.values()) inserirTipo.run(...definicao);

  const objetos = db.prepare(`
    SELECT rowid AS object_id, name, type, sql
    FROM main.sqlite_master
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
    ORDER BY rowid
  `).all().filter((objeto) => !OBJETOS_DO_CATALOGO.has(objeto.name));

  const inserirObjeto = db.prepare(`
    INSERT INTO main.objects
      (name, object_id, schema_id, principal_id, type, type_desc, create_date)
    VALUES (?, ?, 1, 1, ?, ?, ?)
  `);
  const inserirTabela = db.prepare(`
    INSERT INTO main.tables
      (name, object_id, schema_id, principal_id, create_date, modify_date,
       lob_data_space_id, uses_ansi_nulls, durability, lock_escalation)
    VALUES (?, ?, 1, 1, ?, ?, 1, 1, 0, 0)
  `);
  const inserirView = db.prepare(`
    INSERT INTO main.all_views
      (name, object_id, schema_id, principal_id, type, create_date, definition)
    VALUES (?, ?, 1, 1, 'V', ?, ?)
  `);
  const inserirColuna = db.prepare(`
    INSERT INTO main.all_columns
      (name, object_id, column_id, user_type_id, system_type_id, max_length,
       precision, scale, is_nullable, is_sparse, is_identity, is_computed,
       default_object_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)
  `);
  const inserirDefault = db.prepare(`
    INSERT INTO main.default_constraints
      (name, object_id, parent_object_id, parent_column_id, create_date,
       modify_date, definition)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const inserirObjetoDefault = db.prepare(`
    INSERT INTO main.objects
      (name, object_id, schema_id, principal_id, type, type_desc, create_date,
       parent_object_id)
    VALUES (?, ?, 1, 1, 'D', 'DEFAULT_CONSTRAINT', ?, ?)
  `);
  const inserirIndice = db.prepare(`
    INSERT INTO main.indexes
      (name, object_id, index_id, type, type_desc, is_primary_key,
       is_unique_constraint, is_hypothetical, is_disabled, data_space_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
  `);
  const inserirColunaIndice = db.prepare(`
    INSERT OR REPLACE INTO main.index_columns
      (object_id, index_id, index_column_id, column_id, is_included_column)
    VALUES (?, ?, ?, ?, 0)
  `);

  for (const objeto of objetos) {
    const ehTabela = objeto.type === 'table';
    inserirObjeto.run(
      objeto.name,
      objeto.object_id,
      ehTabela ? 'U' : 'V',
      ehTabela ? 'USER_TABLE' : 'VIEW',
      data
    );

    const nomeSeguro = String(objeto.name).replace(/"/g, '""');
    if (!ehTabela) {
      inserirView.run(objeto.name, objeto.object_id, data, objeto.sql || '');
      db.prepare('INSERT INTO main.sql_modules (object_id, definition) VALUES (?, ?)')
        .run(objeto.object_id, objeto.sql || '');
      continue;
    }

    inserirTabela.run(objeto.name, objeto.object_id, data, data);
    inserirIndice.run(null, objeto.object_id, 0, 0, 'HEAP', 0, 0);

    const colunas = db.prepare(`PRAGMA main.table_info("${nomeSeguro}")`).all();
    for (const coluna of colunas) {
      const declarado = String(coluna.type || '').split('(')[0].trim().toUpperCase();
      const definicao = TIPOS_SQL[declarado] || TIPOS_SQL.NVARCHAR;
      const possuiDefault = coluna.dflt_value != null;
      const defaultId = possuiDefault ? 900000000 + objeto.object_id * 1000 + coluna.cid : 0;
      inserirColuna.run(
        coluna.name,
        objeto.object_id,
        coluna.cid + 1,
        definicao[1],
        definicao[2],
        definicao[3],
        definicao[4],
        definicao[5],
        coluna.notnull || coluna.pk ? 0 : 1,
        coluna.pk ? 1 : 0,
        defaultId
      );
      if (possuiDefault) {
        const nomeDefault = `DF__${objeto.name}__${coluna.name}`;
        inserirDefault.run(
          nomeDefault,
          defaultId,
          objeto.object_id,
          coluna.cid + 1,
          data,
          data,
          coluna.dflt_value
        );
        inserirObjetoDefault.run(nomeDefault, defaultId, data, objeto.object_id);
      }
    }

    const indices = db.prepare(`PRAGMA main.index_list("${nomeSeguro}")`).all();
    for (const indice of indices) {
      const chavePrimaria = String(indice.origin || '').toLowerCase() === 'pk';
      const indexId = indice.seq + 2;
      inserirIndice.run(
        indice.name,
        objeto.object_id,
        indexId,
        2,
        'NONCLUSTERED',
        chavePrimaria ? 1 : 0,
        indice.unique && !chavePrimaria ? 1 : 0
      );

      const nomeIndiceSeguro = String(indice.name || '').replace(/"/g, '""');
      const colunasIndice = nomeIndiceSeguro
        ? db.prepare(`PRAGMA main.index_info("${nomeIndiceSeguro}")`).all()
        : [];
      colunasIndice.forEach((colunaIndice, posicao) => {
        inserirColunaIndice.run(
          objeto.object_id,
          indexId,
          posicao + 1,
          (colunaIndice.seqno || 0) + 1
        );
      });
    }
  }
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

  db.function('SCHEMA_NAME', (id) => (id == null || Number(id) === 1 ? 'dbo' : null));
  const objectProperty = (id, propriedade) => {
    const nome = String(propriedade || '').toLowerCase();
    if (nome === 'ownerid') return 1;
    if (nome === 'isindexed' || nome === 'isindexable') return 1;
    if (nome.startsWith('is')) return 0;
    return db.prepare('SELECT 1 AS existe FROM main.objects WHERE object_id = ?')
      .get(Number(id)) ? 1 : 0;
  };
  db.function('OBJECTPROPERTY', { varargs: true }, objectProperty);
  db.function('OBJECTPROPERTYEX', { varargs: true }, objectProperty);
  db.function('COLUMNPROPERTY', { varargs: true }, (_id, _coluna, propriedade) => {
    const nome = String(propriedade || '').toLowerCase();
    if (nome === 'isdeterministic' || nome === 'isprecise') return 1;
    return 0;
  });

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

  // COLLATIONPROPERTY e usado pelo SMO para preencher LCID/CodePage/ComparisonStyle.
  db.function('COLLATIONPROPERTY', { varargs: true }, (_colacao, propriedade) => {
    const chave = String(propriedade || '').toUpperCase();
    if (chave === 'LCID') return 1033;
    if (chave === 'CODEPAGE') return 1252;
    if (chave === 'COMPARISONSTYLE') return 196609;
    return null;
  });

  // O SMO chama essa funcao qualificada (msdb.dbo...) para saber se o
  // gerenciamento baseado em politicas esta habilitado.
  db.function('fn_syspolicy_is_automation_enabled', () => 1);

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

  db.function('LOGINPROPERTY', (nome, propriedade) => {
    const chave = String(propriedade || '').toUpperCase();
    if (chave === 'PASSWORDHASHALGORITHM') return 2;
    return 0;
  });

  // fn_varbintohexsubstring e usada pelo SMO para exibir o SID em hexadecimal.
  db.function('fn_varbintohexsubstring', { varargs: true }, (_usarBytes, sid) => {
    if (sid == null) return '';
    const hex = Buffer.isBuffer(sid) ? sid.toString('hex') : Buffer.from(String(sid)).toString('hex');
    return `0x${hex}`;
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

  const anexados = db.pragma('database_list', { simple: false })
    .map((item) => item.name);
  if (!anexados.includes('sys')) {
    throw new Error('Não foi possível anexar o catálogo de sistema (schema sys)');
  }
  if (!anexados.includes('msdb')) {
    const msdbPath = path.join(dataDir, 'msdb.db');
    const msdbSeguro = msdbPath.replace(/'/g, "''");
    db.exec(`ATTACH DATABASE '${msdbSeguro}' AS msdb`);
  }

  // O msdb e anexado em toda conexao: suas tabelas de politica precisam existir
  // mesmo quando a conexao atual aponta para outro database.
  db.exec(DDL_MSDB.replace(/CREATE TABLE IF NOT EXISTS /g, 'CREATE TABLE IF NOT EXISTS msdb.'));
  db.prepare(`
    INSERT OR IGNORE INTO msdb.syspolicy_configuration (name, current_value, description) VALUES
      ('Enabled', '1', 'Habilita a gerenciamento baseado em politicas'),
      ('HistoryRetentionInDays', '0', 'Dias de retencao do historico'),
      ('LogOnSuccess', '0', 'Registra ocorrencias bem-sucedidas')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO msdb.syspolicy_system_health_state
      (policy_id, target_query_expression_with_id, state_description)
    VALUES (1, 'Server[@ID=2]%', 'Healthy')
  `).run();

  criarTabelas(db, 'sys');
  migrarColunas(db, 'sys', 'databases', [
    ['catalog_collation_type', 'TINYINT NOT NULL DEFAULT 2'],
    ['catalog_collation_type_desc', "TEXT NOT NULL DEFAULT 'SQL_COLLATION'"],
    ['containment', 'TINYINT NOT NULL DEFAULT 0'],
    ['source_database_id', 'INT'],
    ['is_fulltext_enabled', 'BIT NOT NULL DEFAULT 0'],
    ['user_access', 'TINYINT NOT NULL DEFAULT 0'],
    ['is_ledger_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_remote_data_archive_enabled', 'BIT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'sys', 'syslanguages', [
    ['lcid', 'SMALLINT NOT NULL DEFAULT 1033']
  ]);
  migrarColunas(db, 'sys', 'server_principals', [
    ['create_date', "DATETIME DEFAULT '2023-01-01 00:00:00'"],
    ['modify_date', "DATETIME DEFAULT '2023-01-01 00:00:00'"],
    ['default_language_name', "TEXT DEFAULT 'us_english'"],
    ['default_database_name', "TEXT DEFAULT 'master'"],
    ['is_fixed_role', 'BIT NOT NULL DEFAULT 0']
  ]);
  const nomes = listarDatabases ? listarDatabases() : [];
  popularTabelas(db, 'sys', nomes);
  if (String(dbName || '').toLowerCase() === 'msdb') {
    db.exec(DDL_MSDB);
    db.prepare(`
      INSERT OR IGNORE INTO syspolicy_configuration (name, current_value, description) VALUES
        ('Enabled', '1', 'Habilita a gerenciamento baseado em politicas'),
        ('HistoryRetentionInDays', '0', 'Dias de retencao do historico'),
        ('LogOnSuccess', '0', 'Registra ocorrencias bem-sucedidas')
    `).run();
  }
  sincronizarCatalogoDatabase(db);
  registrarFuncoes(db, { dbName, engine, listarDatabases, usuario });
}

module.exports = { instalar, sincronizarCatalogoDatabase, MASTER, SISTEMA, EDICOES, VERSAO };
