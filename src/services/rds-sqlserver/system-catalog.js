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

/** Diretorio padrao de dados/log usado pelo SSMS ao criar um database. */
const DIRETORIO_DADOS_PADRAO = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA';

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
    service_broker_guid TEXT,
    default_language_lcid INT NOT NULL DEFAULT 1033,
    default_language_name TEXT NOT NULL DEFAULT 'us_english',
    default_fulltext_language_lcid INT NOT NULL DEFAULT 1033,
    default_fulltext_language_name TEXT NOT NULL DEFAULT 'us_english',
    is_ansi_null_default_on BIT NOT NULL DEFAULT 1,
    is_ansi_nulls_on BIT NOT NULL DEFAULT 1,
    is_ansi_padding_on BIT NOT NULL DEFAULT 1,
    is_ansi_warnings_on BIT NOT NULL DEFAULT 1,
    is_arithabort_on BIT NOT NULL DEFAULT 1,
    is_concat_null_yields_null_on BIT NOT NULL DEFAULT 1,
    is_cursor_close_on_commit_on BIT NOT NULL DEFAULT 0,
    is_numeric_roundabort_on BIT NOT NULL DEFAULT 0,
    is_quoted_identifier_on BIT NOT NULL DEFAULT 1,
    is_recursive_triggers_on BIT NOT NULL DEFAULT 0,
    is_nested_triggers_on BIT NOT NULL DEFAULT 0,
    is_db_chaining_on BIT NOT NULL DEFAULT 0,
    is_auto_update_stats_async_on BIT NOT NULL DEFAULT 0,
    is_auto_create_stats_incremental_on BIT NOT NULL DEFAULT 0,
    is_date_correlation_on BIT NOT NULL DEFAULT 0,
    is_trustworthy_on BIT NOT NULL DEFAULT 0,
    is_parameterization_forced BIT NOT NULL DEFAULT 0,
    is_read_committed_snapshot_on BIT NOT NULL DEFAULT 0,
    snapshot_isolation_state TINYINT NOT NULL DEFAULT 0,
    is_published BIT NOT NULL DEFAULT 0,
    is_subscribed BIT NOT NULL DEFAULT 0,
    is_merge_published BIT NOT NULL DEFAULT 0,
    is_local_cursor_default BIT NOT NULL DEFAULT 0,
    page_verify_option TINYINT NOT NULL DEFAULT 2,
    is_broker_enabled BIT NOT NULL DEFAULT 0,
    is_honor_broker_priority_on BIT NOT NULL DEFAULT 0,
    is_encrypted BIT NOT NULL DEFAULT 0,
    is_auto_create_stats_on BIT NOT NULL DEFAULT 1,
    is_auto_update_stats_on BIT NOT NULL DEFAULT 1,
    is_transform_noise_words_on BIT NOT NULL DEFAULT 1,
    two_digit_year_cutoff INT NOT NULL DEFAULT 2049,
    delayed_durability TINYINT NOT NULL DEFAULT 0,
    is_accelerated_database_recovery_on BIT NOT NULL DEFAULT 0,
    target_recovery_time_in_seconds INT NOT NULL DEFAULT 60,
    log_reuse_wait TINYINT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS database_mirroring (
    database_id INTEGER NOT NULL PRIMARY KEY,
    mirroring_role TINYINT,
    mirroring_state TINYINT,
    mirroring_witness_state TINYINT,
    mirroring_guid TEXT,
    mirroring_partner_name TEXT,
    mirroring_partner_instance TEXT,
    mirroring_safety_level TINYINT,
    mirroring_safety_sequence INT,
    mirroring_failover_lsn TEXT,
    mirroring_connection_timeout INT,
    mirroring_redo_queue INT,
    mirroring_redo_queue_type TEXT,
    mirroring_end_of_log_lsn TEXT,
    mirroring_replication_lsn TEXT
  );

  CREATE TABLE IF NOT EXISTS database_recovery_status (
    database_id INTEGER NOT NULL PRIMARY KEY,
    last_log_backup_lsn TEXT,
    database_guid TEXT,
    recovery_fork_guid TEXT,
    fork_generation INTEGER NOT NULL DEFAULT 0,
    is_recovery_fork_generated BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS change_tracking_databases (
    database_id INTEGER NOT NULL PRIMARY KEY,
    is_auto_cleanup_on BIT NOT NULL DEFAULT 0,
    retention_period INTEGER NOT NULL DEFAULT 0,
    retention_period_units TINYINT NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS database_filestream_options (
    database_id INTEGER NOT NULL PRIMARY KEY,
    directory_name TEXT,
    is_filestream_enabled BIT NOT NULL DEFAULT 0,
    non_transacted_access TINYINT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS database_query_store_options (
    database_id INTEGER NOT NULL PRIMARY KEY,
    actual_state TINYINT NOT NULL DEFAULT 0,
    desired_state TINYINT NOT NULL DEFAULT 0,
    readonly_reason INTEGER NOT NULL DEFAULT 0,
    current_storage_size_mb BIGINT NOT NULL DEFAULT 0,
    max_storage_size_mb BIGINT NOT NULL DEFAULT 0,
    stale_query_threshold_days INTEGER NOT NULL DEFAULT 30,
    flush_interval_seconds INTEGER NOT NULL DEFAULT 900,
    interval_length_minutes INTEGER NOT NULL DEFAULT 60,
    query_capture_mode TINYINT NOT NULL DEFAULT 1,
    size_based_cleanup_mode TINYINT NOT NULL DEFAULT 1,
    max_plans_per_query INTEGER NOT NULL DEFAULT 200,
    wait_stats_capture_mode TINYINT NOT NULL DEFAULT 1,
    capture_policy_execution_count INTEGER NOT NULL DEFAULT 30,
    capture_policy_total_compile_cpu_time_ms BIGINT NOT NULL DEFAULT 1000,
    capture_policy_total_execution_cpu_time_ms BIGINT NOT NULL DEFAULT 100,
    capture_policy_stale_threshold_hours INTEGER NOT NULL DEFAULT 1
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

  -- O SMO le as configuracoes escopo de database apos CREATE DATABASE.
  CREATE TABLE IF NOT EXISTS database_scoped_configurations (
    name TEXT NOT NULL PRIMARY KEY,
    configuration_id INT NOT NULL DEFAULT 0,
    value INT NOT NULL DEFAULT 0,
    value_for_secondary INT NOT NULL DEFAULT 2,
    is_value_default BIT NOT NULL DEFAULT 1
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
    langid SMALLINT NOT NULL DEFAULT 0,
    lcid INT NOT NULL DEFAULT 1033
  );

  -- O SMO consulta sys.fulltext_languages ao atualizar as propriedades de um
  -- database recem-criado (configuration_id 1126). Sem a tabela, o Create falha
  -- com "no such table: sys.fulltext_languages".
  CREATE TABLE IF NOT EXISTS fulltext_languages (
    lcid INT NOT NULL PRIMARY KEY,
    language_id SMALLINT NOT NULL DEFAULT 0,
    name TEXT NOT NULL
  );

  -- O SMO usa fn_helpcollations() para preencher a aba Options do New Database.
  -- No SQLite nao ha table-valued functions, entao o tradutor reescreve a
  -- chamada para esta tabela do catalogo master.
  CREATE TABLE IF NOT EXISTS fn_helpcollations (
    name TEXT NOT NULL PRIMARY KEY,
    description TEXT NOT NULL DEFAULT 'SQL Server collation'
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

  -- sys.master_files e de instancia: uma linha por arquivo de cada database.
  -- O SMO a consulta na aba Filegroups do New Database.
  CREATE TABLE IF NOT EXISTS master_files (
    database_id INT NOT NULL,
    file_id INT NOT NULL,
    type TINYINT NOT NULL,
    name TEXT NOT NULL,
    physical_name TEXT,
    size INT NOT NULL DEFAULT 8192,
    max_size INT NOT NULL DEFAULT -1,
    growth INT NOT NULL DEFAULT 64,
    is_percent_growth BIT NOT NULL DEFAULT 0,
    is_media_read_only BIT NOT NULL DEFAULT 0,
    is_read_only BIT NOT NULL DEFAULT 0,
    state TINYINT NOT NULL DEFAULT 0,
    is_sparse BIT NOT NULL DEFAULT 0,
    data_space_id INT NOT NULL DEFAULT 1,
    drop_lsn BLOB,
    UNIQUE (database_id, file_id)
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

  -- O SMO consulta estas DMVs ao montar a pagina Filegroups do New Database.
  CREATE TABLE IF NOT EXISTS dm_io_virtual_file_stats (
    database_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    num_of_reads BIGINT NOT NULL DEFAULT 0,
    num_of_writes BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (database_id, file_id)
  );

  CREATE TABLE IF NOT EXISTS dm_db_file_space_usage (
    database_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    allocated_extent_page_count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (database_id, file_id)
  );

  -- O Table Designer consulta as funcoes/parametros de particionamento mesmo
  -- quando a tabela nao tem nenhuma. As tabelas existem vazias para que o
  -- LEFT JOIN do designer nao falhe com "no such table".
  CREATE TABLE IF NOT EXISTS partition_functions (
    function_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    type CHAR(2) NOT NULL DEFAULT 'R',
    fanout INTEGER NOT NULL DEFAULT 0,
    boundary_value_on_right BIT NOT NULL DEFAULT 0,
    create_date DATETIME,
    modify_date DATETIME
  );

  CREATE TABLE IF NOT EXISTS partition_parameters (
    function_id INTEGER NOT NULL,
    parameter_id INTEGER NOT NULL,
    system_type_id INTEGER NOT NULL DEFAULT 56,
    user_type_id INTEGER NOT NULL DEFAULT 56,
    max_length SMALLINT NOT NULL DEFAULT 4,
    precision TINYINT NOT NULL DEFAULT 10,
    scale TINYINT NOT NULL DEFAULT 0,
    collation_name TEXT,
    PRIMARY KEY (function_id, parameter_id)
  );

  CREATE TABLE IF NOT EXISTS partition_schemes (
    data_space_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    function_id INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS destination_data_spaces (
    partition_scheme_id INTEGER NOT NULL,
    destination_id INTEGER NOT NULL,
    data_space_id INTEGER NOT NULL,
    PRIMARY KEY (partition_scheme_id, destination_id)
  );

  -- O designer de indice XML faz INNER JOIN com sys.internal_tables mesmo
  -- quando a tabela nao tem indice XML. A tabela fica vazia no simulador.
  CREATE TABLE IF NOT EXISTS internal_tables (
    object_id INTEGER NOT NULL PRIMARY KEY,
    parent_id INTEGER NOT NULL,
    parent_minor_id INTEGER NOT NULL DEFAULT 0,
    internal_type INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    type CHAR(2) NOT NULL DEFAULT 'IT',
    type_desc TEXT NOT NULL DEFAULT 'INTERNAL_TABLE',
    is_ms_shipped BIT NOT NULL DEFAULT 1
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

  -- Arquivos e grupos de arquivo sao locais ao database (aba Filegroups do SMO).
  CREATE TABLE IF NOT EXISTS filegroups (
    name TEXT NOT NULL PRIMARY KEY,
    data_space_id INT NOT NULL UNIQUE,
    is_default BIT NOT NULL DEFAULT 0,
    is_read_only BIT NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'FG',
    is_autogrow_all_files BIT NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS database_files (
    file_id INT NOT NULL PRIMARY KEY,
    type TINYINT NOT NULL,
    name TEXT NOT NULL,
    physical_name TEXT,
    size INT NOT NULL DEFAULT 8192,
    max_size INT NOT NULL DEFAULT -1,
    growth INT NOT NULL DEFAULT 64,
    is_percent_growth BIT NOT NULL DEFAULT 0,
    is_media_read_only BIT NOT NULL DEFAULT 0,
    is_read_only BIT NOT NULL DEFAULT 0,
    state TINYINT NOT NULL DEFAULT 0,
    is_sparse BIT NOT NULL DEFAULT 0,
    data_space_id INT NOT NULL DEFAULT 1,
    drop_lsn BLOB
  );

  CREATE TABLE IF NOT EXISTS database_principals (
    name TEXT NOT NULL PRIMARY KEY,
    principal_id INTEGER NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'S',
    sid BLOB,
    create_date DATETIME,
    modify_date DATETIME DEFAULT '2023-01-01 00:00:00',
    authentication_type INT NOT NULL DEFAULT 0,
    default_schema_name TEXT DEFAULT 'dbo',
    default_language_lcid INT DEFAULT 1033,
    default_language_name TEXT DEFAULT 'us_english',
    state CHAR(2) DEFAULT 'G',
    is_disabled BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS objects (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    schema_id INTEGER NOT NULL DEFAULT 1,
    principal_id INTEGER DEFAULT 1,
    type TEXT NOT NULL,
    type_desc TEXT NOT NULL,
    create_date DATETIME,
    modify_date DATETIME,
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
    lock_escalation_desc TEXT NOT NULL DEFAULT 'TABLE',
    history_table_id INTEGER,
    filestream_data_space_id INTEGER,
    is_dropped_ledger_table BIT NOT NULL DEFAULT 0,
    ledger_view_id INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS all_views (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    schema_id INTEGER NOT NULL DEFAULT 1,
    principal_id INTEGER DEFAULT 1,
    type TEXT NOT NULL DEFAULT 'V',
    create_date DATETIME,
    modify_date DATETIME DEFAULT '2023-01-01 00:00:00',
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    ledger_view_type TINYINT NOT NULL DEFAULT 0,
    is_dropped_ledger_view BIT NOT NULL DEFAULT 0,
    has_opaque_metadata BIT NOT NULL DEFAULT 0,
    definition TEXT
  );

  CREATE TABLE IF NOT EXISTS synonyms (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    schema_id INTEGER NOT NULL DEFAULT 1,
    principal_id INTEGER DEFAULT 1,
    create_date DATETIME,
    base_object_name TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS all_parameters (
    object_id INTEGER NOT NULL,
    parameter_id INTEGER NOT NULL,
    name TEXT,
    user_type_id INTEGER NOT NULL DEFAULT 56,
    system_type_id INTEGER NOT NULL DEFAULT 56,
    max_length INTEGER NOT NULL DEFAULT -1,
    precision TINYINT NOT NULL DEFAULT 0,
    scale TINYINT NOT NULL DEFAULT 0,
    xml_collection_id INTEGER NOT NULL DEFAULT 0,
    is_xml_document BIT NOT NULL DEFAULT 0,
    is_output BIT NOT NULL DEFAULT 0,
    has_default_value BIT NOT NULL DEFAULT 0,
    default_value TEXT,
    is_readonly BIT NOT NULL DEFAULT 0,
    PRIMARY KEY (object_id, parameter_id)
  );

  CREATE VIEW IF NOT EXISTS parameters AS SELECT * FROM all_parameters;

  CREATE TABLE IF NOT EXISTS triggers (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    parent_class INTEGER NOT NULL DEFAULT 0,
    parent_id INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'TR',
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    is_disabled BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS procedures (
    name TEXT NOT NULL,
    object_id INTEGER NOT NULL PRIMARY KEY,
    schema_id INTEGER NOT NULL DEFAULT 1,
    principal_id INTEGER DEFAULT 1,
    create_date DATETIME,
    modify_date DATETIME,
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    is_published BIT NOT NULL DEFAULT 0,
    is_schema_published BIT NOT NULL DEFAULT 0,
    is_auto_executed BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS database_permissions (
    grantee_principal_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'G'
  );

  CREATE TABLE IF NOT EXISTS assemblies (
    assembly_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assembly_modules (
    object_id INTEGER NOT NULL PRIMARY KEY,
    assembly_id INTEGER,
    assembly_class TEXT,
    assembly_method TEXT,
    execute_as_principal_id INTEGER,
    null_on_null_input BIT NOT NULL DEFAULT 0
  );

  DROP VIEW IF EXISTS table_types;
  CREATE VIEW table_types AS
    SELECT name, user_type_id AS object_id, schema_id, schema_id AS principal_id,
           is_user_defined, 1 AS is_table_type,
           user_type_id AS type_table_object_id, 0 AS is_memory_optimized
    FROM types WHERE is_table_type = 1;

  -- O script de user-defined types do designer le colunas de assembly_types que
  -- nao existiam na view antiga. DROP/CREATE garante a atualizacao em databases
  -- ja abertos pelo simulador.
  DROP VIEW IF EXISTS assembly_types;
  CREATE VIEW assembly_types AS
    SELECT name, user_type_id AS object_id, schema_id, 1 AS assembly_id,
           is_user_defined, 1 AS is_assembly_type, max_length, precision,
           scale, is_nullable, default_object_id, rule_object_id,
           collation_name, '' AS assembly_class, 0 AS is_binary_ordered,
           0 AS is_fixed_length, user_type_id
    FROM types WHERE is_assembly_type = 1;

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
    is_unique BIT NOT NULL DEFAULT 0,
    fill_factor INTEGER NOT NULL DEFAULT 0,
    is_padded BIT NOT NULL DEFAULT 0,
    ignore_dup_key BIT NOT NULL DEFAULT 0,
    allow_row_locks BIT NOT NULL DEFAULT 1,
    allow_page_locks BIT NOT NULL DEFAULT 1,
    filter_definition TEXT,
    has_filter BIT NOT NULL DEFAULT 0,
    compression_delay INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (object_id, index_id)
  );

  -- Usada pelo SMO ao carregar propriedades de indices em qualquer database.
  CREATE TABLE IF NOT EXISTS index_resumable_operations (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    state TINYINT NOT NULL DEFAULT 2,
    PRIMARY KEY (object_id, index_id)
  );

  CREATE TABLE IF NOT EXISTS edge_constraints (
    name TEXT NOT NULL DEFAULT '',
    object_id INTEGER NOT NULL PRIMARY KEY,
    principal_id INTEGER DEFAULT 1,
    schema_id INTEGER NOT NULL DEFAULT 1,
    parent_object_id INTEGER NOT NULL,
    type CHAR(2) NOT NULL DEFAULT 'EC',
    type_desc TEXT NOT NULL DEFAULT 'EDGE_CONSTRAINT',
    create_date DATETIME DEFAULT '2023-01-01 00:00:00',
    modify_date DATETIME DEFAULT '2023-01-01 00:00:00',
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    is_published BIT NOT NULL DEFAULT 0,
    is_schema_published BIT NOT NULL DEFAULT 0
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
    is_table_type BIT NOT NULL DEFAULT 0,
    is_nullable BIT NOT NULL DEFAULT 1,
    default_object_id INTEGER NOT NULL DEFAULT 0,
    rule_object_id INTEGER NOT NULL DEFAULT 0,
    collation_name TEXT
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
    is_replicated BIT NOT NULL DEFAULT 0,
    is_non_sql_subscribed BIT NOT NULL DEFAULT 0,
    is_merge_published BIT NOT NULL DEFAULT 0,
    is_dts_replicated BIT NOT NULL DEFAULT 0,
    is_filestream BIT NOT NULL DEFAULT 0,
    is_column_set BIT NOT NULL DEFAULT 0,
    generated_always_type TINYINT NOT NULL DEFAULT 0,
    is_hidden BIT NOT NULL DEFAULT 0,
    is_dropped_ledger_column BIT NOT NULL DEFAULT 0,
    is_masked BIT NOT NULL DEFAULT 0,
    graph_type INTEGER NOT NULL DEFAULT 0,
    encryption_type INTEGER,
    encryption_algorithm_name TEXT,
    column_encryption_key_id INTEGER,
    is_xml_document BIT NOT NULL DEFAULT 0,
    PRIMARY KEY (object_id, column_id)
  );

  CREATE TABLE IF NOT EXISTS sql_modules (
    object_id INTEGER NOT NULL PRIMARY KEY,
    definition TEXT,
    is_recompiled BIT NOT NULL DEFAULT 0,
    execute_as_principal_id INTEGER,
    returns_type TEXT DEFAULT 'int',
    null_on_null_input BIT NOT NULL DEFAULT 1,
    inline_type TINYINT NOT NULL DEFAULT 0,
    is_inlineable BIT NOT NULL DEFAULT 0,
    corpo TEXT
  );

  CREATE TABLE IF NOT EXISTS system_sql_modules (
    object_id INTEGER NOT NULL PRIMARY KEY,
    definition TEXT,
    is_recompiled BIT NOT NULL DEFAULT 0,
    execute_as_principal_id INTEGER
  );

  DROP VIEW IF EXISTS all_sql_modules;
  CREATE VIEW all_sql_modules AS
    SELECT object_id, definition, 0 AS uses_native_compilation,
           0 AS inline_type, 0 AS is_inlineable
    FROM sql_modules;

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
    is_published BIT NOT NULL DEFAULT 0,
    is_schema_published BIT NOT NULL DEFAULT 0,
    definition TEXT,
    is_system_named BIT NOT NULL DEFAULT 1
  );

  -- ADD DEFAULT vira trigger SQLite, que nao aparece no DDL da tabela. Esta
  -- tabela guarda a definicao T-SQL para reconstruir sys.default_constraints
  -- sempre que o catalogo e sincronizado.
  CREATE TABLE IF NOT EXISTS default_definitions (
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    name TEXT NOT NULL,
    definition TEXT NOT NULL,
    create_date DATETIME,
    PRIMARY KEY (table_name, column_name)
  );

  -- ADD CONSTRAINT ... FOREIGN KEY nao altera o DDL do SQLite. Guardamos a
  -- definicao para reconstruir sys.foreign_keys a cada sincronizacao.
  CREATE TABLE IF NOT EXISTS foreign_key_definitions (
    name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    referenced_table TEXT NOT NULL,
    referenced_column TEXT NOT NULL,
    create_date DATETIME,
    PRIMARY KEY (name, table_name, column_name)
  );

  CREATE TABLE IF NOT EXISTS check_constraints (
    name TEXT NOT NULL DEFAULT '',
    object_id INTEGER NOT NULL PRIMARY KEY,
    principal_id INTEGER DEFAULT 1,
    schema_id INTEGER NOT NULL DEFAULT 1,
    parent_object_id INTEGER NOT NULL,
    type CHAR(2) NOT NULL DEFAULT 'C',
    type_desc TEXT NOT NULL DEFAULT 'CHECK_CONSTRAINT',
    create_date DATETIME DEFAULT '2023-01-01 00:00:00',
    modify_date DATETIME DEFAULT '2023-01-01 00:00:00',
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    is_published BIT NOT NULL DEFAULT 0,
    is_schema_published BIT NOT NULL DEFAULT 0,
    is_disabled BIT NOT NULL DEFAULT 0,
    is_not_for_replication BIT NOT NULL DEFAULT 0,
    is_not_trusted BIT NOT NULL DEFAULT 0,
    is_system_named BIT NOT NULL DEFAULT 1,
    uses_database_collation BIT NOT NULL DEFAULT 0,
    definition TEXT
  );

  -- Consultada pelo SMO ao carregar as propriedades de um indice.
  CREATE TABLE IF NOT EXISTS index_resumable_operations (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    state TINYINT NOT NULL DEFAULT 2,
    PRIMARY KEY (object_id, index_id)
  );

  -- Consultada pelo Object Explorer ao listar as edge constraints de uma tabela.
  CREATE TABLE IF NOT EXISTS edge_constraints (
    name TEXT NOT NULL DEFAULT '',
    object_id INTEGER NOT NULL PRIMARY KEY,
    principal_id INTEGER DEFAULT 1,
    schema_id INTEGER NOT NULL DEFAULT 1,
    parent_object_id INTEGER NOT NULL,
    type CHAR(2) NOT NULL DEFAULT 'EC',
    type_desc TEXT NOT NULL DEFAULT 'EDGE_CONSTRAINT',
    create_date DATETIME DEFAULT '2023-01-01 00:00:00',
    modify_date DATETIME DEFAULT '2023-01-01 00:00:00',
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    is_published BIT NOT NULL DEFAULT 0,
    is_schema_published BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS index_columns (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    index_column_id INTEGER NOT NULL,
    column_id INTEGER NOT NULL,
    is_included_column BIT NOT NULL DEFAULT 0,
    key_ordinal INTEGER NOT NULL DEFAULT 0,
    partition_ordinal INTEGER NOT NULL DEFAULT 0,
    is_descending_key BIT NOT NULL DEFAULT 0,
    column_store_order_ordinal INTEGER,
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

  CREATE TABLE IF NOT EXISTS foreign_keys (
    name TEXT NOT NULL DEFAULT '',
    object_id INTEGER NOT NULL PRIMARY KEY,
    principal_id INTEGER DEFAULT 1,
    schema_id INTEGER NOT NULL DEFAULT 1,
    parent_object_id INTEGER NOT NULL,
    type CHAR(2) NOT NULL DEFAULT 'F',
    type_desc TEXT NOT NULL DEFAULT 'FOREIGN_KEY_CONSTRAINT',
    create_date DATETIME DEFAULT '2023-01-01 00:00:00',
    modify_date DATETIME DEFAULT '2023-01-01 00:00:00',
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    is_published BIT NOT NULL DEFAULT 0,
    is_schema_published BIT NOT NULL DEFAULT 0,
    referenced_object_id INTEGER NOT NULL,
    key_index_id INTEGER NOT NULL DEFAULT 0,
    is_disabled BIT NOT NULL DEFAULT 0,
    is_not_for_replication BIT NOT NULL DEFAULT 0,
    is_not_trusted BIT NOT NULL DEFAULT 0,
    is_system_named BIT NOT NULL DEFAULT 1,
    delete_referential_action TINYINT NOT NULL DEFAULT 0,
    delete_referential_action_desc TEXT NOT NULL DEFAULT 'NO_ACTION',
    update_referential_action TINYINT NOT NULL DEFAULT 0,
    update_referential_action_desc TEXT NOT NULL DEFAULT 'NO_ACTION'
  );

  CREATE TABLE IF NOT EXISTS foreign_key_columns (
    constraint_object_id INTEGER NOT NULL,
    constraint_column_id INTEGER NOT NULL DEFAULT 1,
    parent_object_id INTEGER NOT NULL,
    parent_column_id INTEGER NOT NULL,
    referenced_object_id INTEGER NOT NULL,
    referenced_column_id INTEGER NOT NULL
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

  -- Tabelas de metadados de fontes externas. O simulador nao cria tabelas
  -- externas, mas o SMO 19 faz LEFT JOIN nelas ao gerar o CREATE de uma tabela.
  CREATE TABLE IF NOT EXISTS external_tables (
    object_id INTEGER NOT NULL PRIMARY KEY,
    data_source_id INTEGER,
    file_format_id INTEGER,
    location TEXT,
    reject_type TEXT,
    reject_value REAL,
    reject_sample_value REAL,
    sharding_col_id INTEGER,
    distribution_type INTEGER,
    remote_schema_name TEXT,
    remote_object_name TEXT
  );

  CREATE TABLE IF NOT EXISTS external_data_sources (
    data_source_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS external_file_formats (
    file_format_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT
  );

  -- Usado pelo SMO para calcular HasCompressedPartitions ao gerar o CREATE.
  CREATE TABLE IF NOT EXISTS partitions (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL DEFAULT 0,
    data_compression INTEGER NOT NULL DEFAULT 0,
    xml_compression BIT NOT NULL DEFAULT 0
  );

  -- O SMO le MaskingFunction ao listar colunas para gerar o CREATE da tabela.
  CREATE TABLE IF NOT EXISTS masked_columns (
    object_id INTEGER NOT NULL,
    column_id INTEGER NOT NULL,
    masking_function TEXT
  );

  CREATE TABLE IF NOT EXISTS filetable_system_defined_objects (
    object_id INTEGER NOT NULL PRIMARY KEY
  );

  -- Tabelas de metadados de ind consultadas pelo SMO ao gerar o CREATE da
  -- tabela. O simulador nao cria ind espaciais/XML/hash, mas elas precisam
  -- existir para os LEFT JOIN nao falharem.
  CREATE TABLE IF NOT EXISTS spatial_index_tessellations (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    bounding_box_xmin REAL NOT NULL DEFAULT 0,
    bounding_box_ymin REAL NOT NULL DEFAULT 0,
    bounding_box_xmax REAL NOT NULL DEFAULT 0,
    bounding_box_ymax REAL NOT NULL DEFAULT 0,
    cells_per_object INTEGER NOT NULL DEFAULT 0,
    level_1_grid INTEGER NOT NULL DEFAULT 0,
    level_2_grid INTEGER NOT NULL DEFAULT 0,
    level_3_grid INTEGER NOT NULL DEFAULT 0,
    level_4_grid INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS spatial_indexes (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    name TEXT,
    spatial_index_type INTEGER NOT NULL DEFAULT 0,
    fill_factor INTEGER NOT NULL DEFAULT 0,
    is_padded BIT NOT NULL DEFAULT 0,
    is_disabled BIT NOT NULL DEFAULT 0,
    is_hypothetical BIT NOT NULL DEFAULT 0,
    allow_row_locks BIT NOT NULL DEFAULT 1,
    allow_page_locks BIT NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS hash_indexes (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    bucket_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS xml_indexes (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    name TEXT,
    xml_index_type INTEGER NOT NULL DEFAULT 0,
    secondary_type TEXT,
    using_xml_index_id INTEGER,
    path_id INTEGER,
    fill_factor INTEGER NOT NULL DEFAULT 0,
    is_padded BIT NOT NULL DEFAULT 0,
    is_disabled BIT NOT NULL DEFAULT 0,
    is_hypothetical BIT NOT NULL DEFAULT 0,
    allow_row_locks BIT NOT NULL DEFAULT 1,
    allow_page_locks BIT NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS selective_xml_index_paths (
    object_id INTEGER NOT NULL,
    index_id INTEGER NOT NULL,
    path_id INTEGER NOT NULL,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS stats (
    name TEXT NOT NULL DEFAULT '',
    object_id INTEGER NOT NULL,
    stats_id INTEGER NOT NULL,
    no_recompute BIT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS key_constraints (
    name TEXT NOT NULL DEFAULT '',
    object_id INTEGER NOT NULL DEFAULT 0,
    principal_id INTEGER,
    schema_id INTEGER NOT NULL DEFAULT 1,
    parent_object_id INTEGER NOT NULL,
    unique_index_id INTEGER NOT NULL,
    type CHAR(2) NOT NULL DEFAULT 'PK',
    type_desc TEXT NOT NULL DEFAULT 'PRIMARY_KEY_CONSTRAINT',
    create_date DATETIME DEFAULT '2023-01-01 00:00:00',
    modify_date DATETIME DEFAULT '2023-01-01 00:00:00',
    is_ms_shipped BIT NOT NULL DEFAULT 0,
    is_published BIT NOT NULL DEFAULT 0,
    is_schema_published BIT NOT NULL DEFAULT 0,
    is_enforced BIT NOT NULL DEFAULT 1,
    is_system_named BIT NOT NULL DEFAULT 1
  );

  -- Metadados de full-text consultados pelo SMO ao gerar o script da tabela.
  CREATE TABLE IF NOT EXISTS fulltext_indexes (
    object_id INTEGER NOT NULL,
    unique_index_id INTEGER NOT NULL,
    fulltext_catalog_id INTEGER NOT NULL,
    data_space_id INTEGER NOT NULL DEFAULT 1,
    is_enabled BIT NOT NULL DEFAULT 1,
    change_tracking_state TEXT NOT NULL DEFAULT 'M',
    has_crawl_completed BIT NOT NULL DEFAULT 0,
    crawl_type TEXT NOT NULL DEFAULT '',
    crawl_start_date DATETIME,
    crawl_end_date DATETIME,
    incremental_timestamp TEXT,
    stoplist_id INTEGER,
    property_list_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS fulltext_catalogs (
    fulltext_catalog_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fulltext_stoplists (
    stoplist_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS registered_search_property_lists (
    property_list_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fulltext_index_columns (
    object_id INTEGER NOT NULL,
    column_id INTEGER NOT NULL,
    type_column_id INTEGER,
    language_id INTEGER NOT NULL DEFAULT 1033,
    statistical_semantics INTEGER NOT NULL DEFAULT 0
  );

  CREATE VIEW IF NOT EXISTS views AS SELECT * FROM all_views;
  CREATE VIEW IF NOT EXISTS columns AS SELECT * FROM all_columns;
  CREATE VIEW IF NOT EXISTS all_objects AS SELECT * FROM objects;
  -- O SSMS consulta sys.numbered_procedures ao abrir "Modify" de uma procedure.
  -- No SQL Server a view so lista procedures criadas com numero explicito (;2,
  -- ;3, ...); a procedure base (numero 1) nao aparece aqui. O simulador nao
  -- registra procedures numeradas, entao a view existe mas devolve zero linhas.
  -- Devolver a procedure base fazia o SMO gerar o CREATE PROCEDURE duas vezes.
  CREATE VIEW IF NOT EXISTS numbered_procedures AS
    SELECT o.object_id, CAST(1 AS SMALLINT) AS procedure_number, o.name, m.definition
    FROM all_objects AS o
    LEFT JOIN sql_modules AS m ON m.object_id = o.object_id
    WHERE 1 = 0;
  CREATE VIEW IF NOT EXISTS system_views AS SELECT * FROM all_views WHERE is_ms_shipped = 1;

  -- Tabela de compatibilidade usada pelo Table Designer (MS Visual Database
  -- Tools). O designer consulta "select id from sysobjects where id =
  -- object_id(N'dbo.TB001')" antes de carregar a grade; sem a view ele repete a
  -- consulta ate desistir e abre a tela em branco. OBJECT_ID() devolve o rowid
  -- de sqlite_master, o mesmo valor gravado em objects.object_id.
  DROP VIEW IF EXISTS sysobjects;
  CREATE VIEW sysobjects AS
    SELECT
      o.name AS name,
      o.object_id AS id,
      o.type AS xtype,
      o.type AS type,
      o.principal_id AS uid,
      IFNULL(o.parent_object_id, 0) AS parent_obj,
      o.create_date AS crdate,
      0 AS ftcatid,
      0 AS schema_ver,
      0 AS stats_schema_ver,
      0 AS userstat,
      0 AS sysstat,
      0 AS indexdel,
      o.modify_date AS refdate,
      0 AS version,
      0 AS deltrig,
      0 AS instrig,
      0 AS updtrig,
      0 AS seltrig,
      0 AS category,
      0 AS cache
    FROM objects o;

  -- Views de compatibilidade que o mesmo designer consulta para carregar
  -- colunas e tipos. Os nomes legados (syscolumns/systypes) continuaram vivos
  -- no provider VDT mesmo apos a migration para sys.* no SSMS 19.
  DROP VIEW IF EXISTS syscolumns;
  CREATE VIEW syscolumns AS
    SELECT
      c.name AS name,
      c.object_id AS id,
      c.column_id AS colid,
      c.user_type_id AS xtype,
      c.max_length AS length,
      c.precision AS xprec,
      c.scale AS xscale,
      c.is_nullable AS isnullable,
      c.default_object_id AS cdefault,
      c.rule_object_id AS domain,
      0 AS status,
      0 AS offset
    FROM all_columns c;

  DROP VIEW IF EXISTS systypes;
  CREATE VIEW systypes AS
    SELECT
      t.name AS name,
      t.user_type_id AS xtype,
      t.system_type_id AS type,
      t.max_length AS length,
      t.precision AS xprec,
      t.scale AS xscale,
      t.user_type_id AS usertype,
      1 AS variable,
      1 AS allownulls,
      t.is_user_defined AS isusertype
    FROM types t;

  -- O designer de views (VDT) ainda usa as tabelas legadas syscomments/sysusers
  -- e INFORMATION_SCHEMA.ROUTINES para localizar o texto e o dono da view.
  -- Os CASTs reproduzem os tipos reais do SQL Server (smallint e nvarchar(4000)):
  -- com "TEXT" como tipo declarado o VDT nao reconhece a coluna de texto e
  -- recarrega a view em loop, deixando a janela do designer em branco.
  DROP VIEW IF EXISTS syscomments;
  CREATE VIEW syscomments AS
    SELECT object_id AS id,
           CAST(1 AS SMALLINT) AS colid,
           -- sys.syscomments devolve 2 + 4 * criptografado; o VDT usa esse
           -- valor para montar o texto em chunks e recarrega em loop se for 1.
           CAST(2 AS SMALLINT) AS texttype,
           CAST(definition AS NVARCHAR(4000)) AS text
    FROM sql_modules;

  DROP VIEW IF EXISTS sysusers;
  CREATE VIEW sysusers AS
    SELECT principal_id AS uid, name
    FROM database_principals;

  DROP VIEW IF EXISTS routines;
  CREATE VIEW routines AS
    SELECT name AS SPECIFIC_NAME, '' AS DATA_TYPE
    FROM procedures;

  -- Tabela legada consultada pelo SSMS em Tasks > Take Offline/Detach.
  -- Mapeia a sessao simulada para as colunas minimas esperadas pelo SMO.
  DROP VIEW IF EXISTS sysprocesses;
  CREATE VIEW sysprocesses AS
    SELECT
      s.session_id AS spid,
      0 AS kpid,
      0 AS blocked,
      CAST(0x0000 AS BLOB) AS waittype,
      0 AS waittime,
      '' AS lastwaittype,
      '' AS waitresource,
      s.database_id AS dbid,
      1 AS uid,
      0 AS cpu,
      0 AS physical_io,
      0 AS memusage,
      '2023-01-01 00:00:00' AS login_time,
      '2023-01-01 00:00:00' AS last_batch,
      0 AS ecid,
      0 AS open_tran,
      s.status AS status,
      CAST(X'01' AS BLOB) AS sid,
      'localhost' AS hostname,
      'sqlcmd' AS program_name,
      '1' AS hostprocess,
      '' AS cmd,
      '' AS nt_domain,
      '' AS nt_username,
      '' AS net_address,
      'TCP' AS net_library,
      s.login_name AS loginame,
      CAST(X'' AS BLOB) AS context_info,
      CAST(X'' AS BLOB) AS sql_handle,
      0 AS stmt_start,
      0 AS stmt_end,
      0 AS request_id
    FROM dm_exec_sessions s;
`;

/** Tabelas criadas pelo proprio catalogo, que nao devem aparecer como objetos de usuario. */
const OBJETOS_DO_CATALOGO = new Set([
  'schemas', 'database_principals', 'objects', 'all_objects', 'tables', 'all_views',
  'views', 'system_views', 'synonyms', 'indexes', 'data_spaces', 'types',
  'filegroups', 'database_files', 'all_columns', 'columns',
  'sql_modules', 'system_sql_modules', 'all_sql_modules', 'extended_properties',
  'default_constraints', 'default_definitions', 'foreign_key_definitions', 'check_constraints', 'edge_constraints', 'index_resumable_operations', 'index_columns', 'computed_columns', 'identity_columns',
  'foreign_keys', 'foreign_key_columns', 'column_encryption_keys', 'xml_schema_collections',
  'sensitivity_classifications', 'change_tracking_tables', 'filetables',
  'periods', 'remote_data_archive_tables',
  'external_tables', 'external_data_sources', 'external_file_formats', 'partitions',
  'masked_columns', 'filetable_system_defined_objects',
  'spatial_index_tessellations', 'spatial_indexes', 'hash_indexes', 'xml_indexes',
  'selective_xml_index_paths', 'stats', 'key_constraints',
  'fulltext_indexes', 'fulltext_catalogs', 'fulltext_stoplists',
  'registered_search_property_lists', 'fulltext_index_columns',
  'all_parameters', 'parameters', 'procedures', 'numbered_procedures', 'triggers', 'database_permissions',
  'assemblies', 'assembly_modules', 'table_types', 'assembly_types',
  'sysdac_instances', 'syspolicy_configuration', 'sysobjects', 'syscolumns', 'systypes',
  'syscomments', 'sysusers', 'routines', 'sysprocesses',
  // Tabelas internas do catálogo/DMVs que não devem aparecer como objetos de usuário.
  'databases', 'database_mirroring', 'database_recovery_status', 'change_tracking_databases',
  'database_filestream_options', 'database_query_store_options', 'database_scoped_configurations',
  'dm_exec_connections', 'dm_exec_sessions', 'dm_os_process_memory', 'dm_db_file_space_usage',
  'dm_io_virtual_file_stats', 'dm_cryptographic_provider_properties',
  'endpoints', 'server_principals', 'server_role_members', 'server_permissions',
  'server_principal_credentials', 'sql_logins', 'server_triggers', 'server_assembly_modules',
  'server_sql_modules', 'configurations', 'master_files', 'backup_devices', 'certificates',
  'asymmetric_keys', 'credentials', 'cryptographic_providers', 'syslanguages', 'fn_helpcollations',
  'fulltext_languages', 'internal_tables', 'syspolicy_system_health_state',
  'partition_functions', 'partition_parameters', 'partition_schemes', 'destination_data_spaces',
  'msdb'
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
  SQL_VARIANT: ['sql_variant', 98, 98, 8016, 0, 0],
  XML: ['xml', 241, 241, 16, 0, 0],
  BLOB: ['varbinary', 165, 165, 8000, 0, 0],
  SYSNAME: ['nvarchar', 231, 231, 256, 0, 0],
  DATETIME2: ['datetime2', 43, 43, 8, 27, 7],
  SMALLDATETIME: ['smalldatetime', 35, 35, 4, 16, 0],
  SMALLMONEY: ['smallmoney', 122, 122, 4, 10, 4],
  VARBINARY: ['varbinary', 165, 165, 8000, 0, 0],
  BINARY: ['binary', 173, 173, 8000, 0, 0],
  IMAGE: ['image', 34, 34, 16, 0, 0]
});

/**
 * Reconstrói a definicao usada em sys.all_columns a partir do tipo T-SQL
 * original gravado pelo tradutor (ex.: NVARCHAR(21), DECIMAL(18, 2)).
 * @private
 */
function definicaoTsql(tipoOriginal) {
  const texto = String(tipoOriginal || '').trim().replace(/^\[|\]$/g, '');
  const casamento = /^([A-Za-z_][\w]*)\s*(?:\(\s*([^)]*)\s*\))?$/.exec(texto);
  const nome = casamento ? casamento[1].toUpperCase() : 'NVARCHAR';
  const args = casamento && casamento[2]
    ? casamento[2].split(',').map((valor) => valor.trim().toUpperCase())
    : [];
  const definicao = [...(TIPOS_SQL[nome] || TIPOS_SQL.TEXT)];
  const tamanho = args[0];

  if (tamanho === 'MAX') {
    definicao[3] = -1;
  } else if ((nome === 'NVARCHAR' || nome === 'NCHAR') && tamanho) {
    definicao[3] = Number(tamanho) * 2;
  } else if (['VARCHAR', 'CHAR', 'VARBINARY', 'BINARY'].includes(nome) && tamanho) {
    definicao[3] = Number(tamanho);
  }

  if ((nome === 'DECIMAL' || nome === 'NUMERIC') && tamanho) {
    definicao[4] = Number(tamanho) || definicao[4];
    definicao[5] = args[1] === undefined ? 0 : Number(args[1]);
  }
  if (nome === 'DATETIME2' && tamanho) definicao[5] = Number(tamanho);

  return definicao;
}

/** Separa a lista de colunas de um CREATE TABLE por virgulas de primeiro nivel. @private */
function dividirDefinicoes(texto) {
  const partes = [];
  let atual = '';
  let profundidade = 0;
  let delimitador = '';
  for (const caractere of texto) {
    if (delimitador) {
      atual += caractere;
      if ((delimitador === ']' && caractere === ']') || caractere === delimitador) delimitador = '';
      continue;
    }
    if (caractere === "'" || caractere === '"' || caractere === '`') {
      delimitador = caractere;
      atual += caractere;
      continue;
    }
    if (caractere === '[') {
      delimitador = ']';
      atual += caractere;
      continue;
    }
    if (caractere === '(') profundidade += 1;
    if (caractere === ')') profundidade -= 1;
    if (caractere === ',' && profundidade === 0) {
      partes.push(atual);
      atual = '';
      continue;
    }
    atual += caractere;
  }
  partes.push(atual);
  return partes;
}

/**
 * O PRAGMA table_info de uma view so devolve TEXT/INTEGER: o SQLite nao
 * preserva os tipos T-SQL da tabela base. Sem isso o SSMS mostra todas as
 * colunas da view como varchar(8000). Copiamos os tipos do catalogo da tabela
 * referenciada no SELECT, resolvendo tanto SELECT * quanto listas explicitas.
 * @private
 */
function resolverTiposColunasView(db, sql, colunasPragma) {
  const texto = String(sql || '');
  const selecao = /\bSELECT\s+([\s\S]*?)\s+FROM\s+(?:(?:\[([^\]]+)\]|"([^"]+)"|`([^`]+)`|([A-Za-z_][\w$#@]*))\s*\.\s*)?(?:\[([^\]]+)\]|"([^"]+)"|`([^`]+)`|([A-Za-z_][\w$#@]*))/i.exec(texto);
  if (!selecao) return null;

  // Grupos 2-5 sao o schema opcional; 6-9 sao o nome da tabela.
  const nomeTabela = selecao[6] || selecao[7] || selecao[8] || selecao[9];
  const tabela = db.prepare('SELECT object_id FROM main.objects WHERE name = ?').get(nomeTabela);
  if (!tabela) return null;

  const colunasBase = db.prepare(`
    SELECT name, user_type_id, system_type_id, max_length, precision, scale, is_nullable
    FROM main.all_columns WHERE object_id = ? ORDER BY column_id
  `).all(tabela.object_id);
  if (!colunasBase.length) return null;

  const lista = selecao[1].trim();
  let colunasSelecionadas;
  if (lista === '*') {
    colunasSelecionadas = colunasBase;
  } else {
    colunasSelecionadas = lista.split(',').map((parte) => {
      const nome = parte.trim().split(/\s+/).pop()
        .replace(/^\[([^\]]+)\]$/, '$1')
        .replace(/^"([^"]+)"$/, '$1')
        .replace(/^`([^`]+)`$/, '$1');
      return colunasBase.find((coluna) => coluna.name.toLowerCase() === nome.toLowerCase());
    }).filter(Boolean);
  }

  if (colunasSelecionadas.length !== colunasPragma.length) return null;
  return colunasSelecionadas;
}

/**
 * Extrai os tipos T-SQL originais, as colunas IDENTITY e a chave primaria do
 * DDL gravado no sqlite_master. O SQLite nao preserva essas informacoes.
 * @private
 */
function extrairMetadadosDdl(sql) {
  const resultado = { colunas: new Map(), pk: null };
  const texto = String(sql || '');
  const inicio = /\bCREATE\s+TABLE\b/i.exec(texto);
  if (!inicio) return resultado;

  let abertura = -1;
  let delimitador = '';
  for (let i = inicio.index + inicio[0].length; i < texto.length; i += 1) {
    const caractere = texto[i];
    if (delimitador) {
      if ((delimitador === ']' && caractere === ']') || caractere === delimitador) delimitador = '';
      continue;
    }
    if (caractere === "'" || caractere === '"' || caractere === '`') {
      delimitador = caractere;
      continue;
    }
    if (caractere === '[') {
      delimitador = ']';
      continue;
    }
    if (caractere === '(') {
      abertura = i;
      break;
    }
  }
  if (abertura < 0) return resultado;

  let profundidade = 0;
  let fechamento = -1;
  delimitador = '';
  for (let i = abertura; i < texto.length; i += 1) {
    const caractere = texto[i];
    if (delimitador) {
      if ((delimitador === ']' && caractere === ']') || caractere === delimitador) delimitador = '';
      continue;
    }
    if (caractere === "'" || caractere === '"' || caractere === '`') {
      delimitador = caractere;
      continue;
    }
    if (caractere === '[') {
      delimitador = ']';
      continue;
    }
    if (caractere === '(') profundidade += 1;
    else if (caractere === ')') {
      profundidade -= 1;
      if (profundidade === 0) {
        fechamento = i;
        break;
      }
    }
  }
  if (fechamento < 0) return resultado;

  for (const parte of dividirDefinicoes(texto.slice(abertura + 1, fechamento))) {
    const trecho = parte.trim();
    if (!trecho) continue;
    const marcador = /\/\*TSQL:([0-9A-Fa-f]+)\*\//.exec(trecho);
    const nomeColuna = /^\s*(?:\[([^\]]+)\]|"([^"]+)"|`([^`]+)`|([A-Za-z_][\w]*))/.exec(trecho);
    if (marcador && nomeColuna) {
      let tipoOriginal = '';
      try {
        tipoOriginal = Buffer.from(marcador[1], 'hex').toString('utf8');
      } catch {
        tipoOriginal = '';
      }
      const nome = nomeColuna[1] || nomeColuna[2] || nomeColuna[3] || nomeColuna[4];
      const marcadorIdentidade = /\/\*TSQLID:(\d+)_(\d+)\*\//i.exec(trecho);
      resultado.colunas.set(nome.toLowerCase(), {
        tipoOriginal,
        identidade: /\bAUTOINCREMENT\b/i.test(trecho),
        seed: marcadorIdentidade ? Number(marcadorIdentidade[1]) : 1,
        incremento: marcadorIdentidade ? Number(marcadorIdentidade[2]) : 1
      });
      if (/\bPRIMARY\s+KEY\b/i.test(trecho)) {
        resultado.pk = {
          nome: '',
          clusterizado: !/\bNONCLUSTERED\b/i.test(trecho),
          colunas: [nome]
        };
      }
      continue;
    }

    const colunasPk = /\bPRIMARY\s+KEY\s*(?:CLUSTERED|NONCLUSTERED)?\s*\(([^)]*)\)/i.exec(trecho);
    if (!colunasPk) continue;
    const nomeConstraint = /\bCONSTRAINT\s+(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z_][\w]*))/i.exec(trecho);
    resultado.pk = {
      nome: nomeConstraint ? (nomeConstraint[1] || nomeConstraint[2] || nomeConstraint[3]) : '',
      clusterizado: !/\bNONCLUSTERED\b/i.test(trecho),
      colunas: colunasPk[1]
        .split(',')
        .map((valor) => valor.trim()
          .replace(/\s+(?:ASC|DESC)\s*$/i, '')
          .trim()
          .replace(/^\[(.*)\]$/, '$1')
          .replace(/^"(.*)"$/, '$1')
          .trim())
    };
  }
  return resultado;
}

/**
 * Colunas compartilhadas pelas views de catalogo do schema sys. O SSMS usa
 * essa estrutura para montar a pasta "System Views" e as colunas de cada view.
 */
const COLUNAS_VIEW_SISTEMA = [
  ['name', 'NVARCHAR', 128],
  ['object_id', 'INT', 4],
  ['schema_id', 'INT', 4],
  ['principal_id', 'INT', 4],
  ['type', 'CHAR', 2],
  ['type_desc', 'NVARCHAR', 60],
  ['create_date', 'DATETIME', 8],
  ['modify_date', 'DATETIME', 8],
  ['is_ms_shipped', 'BIT', 1]
];

/** Views de sistema expostas no no "System Views" do Object Explorer. */
const VIEWS_DO_SISTEMA = Object.freeze({
  all_columns: [['column_id', 'INT', 4], ['user_type_id', 'INT', 4], ['max_length', 'SMALLINT', 2], ['is_nullable', 'BIT', 1]],
  all_objects: [['parent_object_id', 'INT', 4], ['is_ms_shipped', 'BIT', 1]],
  all_parameters: [['parameter_id', 'INT', 4], ['name', 'NVARCHAR', 128]],
  all_sql_modules: [['definition', 'NVARCHAR', 4000], ['uses_native_compilation', 'BIT', 1]],
  assemblies: [['assembly_id', 'INT', 4], ['clr_name', 'NVARCHAR', 4000]],
  assembly_modules: [
    ['assembly_id', 'INT', 4],
    ['assembly_class', 'NVARCHAR', 128],
    ['assembly_method', 'NVARCHAR', 128],
    ['execute_as_principal_id', 'INT', 4]
  ],
  assembly_types: [['assembly_id', 'INT', 4], ['is_user_defined', 'BIT', 1]],
  all_views: [['ledger_view_type', 'TINYINT', 1], ['is_dropped_ledger_view', 'BIT', 1]],
  check_constraints: [['parent_object_id', 'INT', 4], ['definition', 'NVARCHAR', 4000]],
  column_encryption_keys: [['encryption_algorithm_name', 'NVARCHAR', 128]],
  columns: [['column_id', 'INT', 4], ['user_type_id', 'INT', 4], ['max_length', 'SMALLINT', 2], ['is_nullable', 'BIT', 1]],
  computed_columns: [['column_id', 'INT', 4], ['definition', 'NVARCHAR', 4000]],
  database_principals: [['sid', 'BLOB', 8000], ['is_disabled', 'BIT', 1]],
  data_spaces: [['data_space_id', 'INT', 4], ['type', 'CHAR', 2]],
  database_permissions: [['grantee_principal_id', 'INT', 4], ['state', 'CHAR', 2]],
  default_constraints: [['parent_object_id', 'INT', 4], ['definition', 'NVARCHAR', 4000]],
  extended_properties: [['class', 'TINYINT', 1], ['major_id', 'INT', 4], ['minor_id', 'INT', 4], ['value', 'SQL_VARIANT', 8000]],
  filegroups: [['data_space_id', 'INT', 4], ['is_default', 'BIT', 1]],
  foreign_keys: [
    ['parent_object_id', 'INT', 4], ['referenced_object_id', 'INT', 4],
    ['object_id', 'INT', 4], ['key_index_id', 'INT', 4],
    ['is_disabled', 'BIT', 1], ['is_not_for_replication', 'BIT', 1],
    ['is_not_trusted', 'BIT', 1], ['is_system_named', 'BIT', 1],
    ['delete_referential_action', 'TINYINT', 1], ['update_referential_action', 'TINYINT', 1]
  ],
  foreign_key_columns: [
    ['constraint_object_id', 'INT', 4], ['constraint_column_id', 'INT', 4],
    ['parent_object_id', 'INT', 4], ['parent_column_id', 'INT', 4],
    ['referenced_object_id', 'INT', 4], ['referenced_column_id', 'INT', 4]
  ],
  functions: [['is_inlineable', 'BIT', 1]],
  identity_columns: [['column_id', 'INT', 4], ['seed_value', 'SQL_VARIANT', 8000]],
  indexes: [['index_id', 'INT', 4], ['type_desc', 'NVARCHAR', 60], ['is_primary_key', 'BIT', 1]],
  index_columns: [['index_id', 'INT', 4], ['column_id', 'INT', 4], ['key_ordinal', 'TINYINT', 1]],
  key_constraints: [['parent_object_id', 'INT', 4], ['type', 'CHAR', 2]],
  objects: [['parent_object_id', 'INT', 4], ['is_ms_shipped', 'BIT', 1]],
  partitions: [['partition_id', 'BIGINT', 8], ['index_id', 'INT', 4], ['rows', 'BIGINT', 8]],
  procedures: [['is_ms_shipped', 'BIT', 1], ['is_auto_executed', 'BIT', 1]],
  schemas: [['schema_id', 'INT', 4], ['principal_id', 'INT', 4]],
  server_principals: [['principal_id', 'INT', 4], ['is_disabled', 'BIT', 1]],
  sql_modules: [
    ['definition', 'NVARCHAR', 4000],
    ['is_recompiled', 'BIT', 1],
    ['execute_as_principal_id', 'INT', 4]
  ],
  synonyms: [['base_object_name', 'NVARCHAR', 1032]],
  table_types: [['is_table_type', 'BIT', 1], ['is_user_defined', 'BIT', 1]],
  system_sql_modules: [
    ['definition', 'NVARCHAR', 4000],
    ['is_recompiled', 'BIT', 1],
    ['execute_as_principal_id', 'INT', 4]
  ],
  tables: [['lob_data_space_id', 'INT', 4], ['temporal_type', 'TINYINT', 1], ['is_memory_optimized', 'BIT', 1]],
  triggers: [['parent_id', 'INT', 4], ['is_disabled', 'BIT', 1]],
  types: [['user_type_id', 'INT', 4], ['system_type_id', 'TINYINT', 1], ['max_length', 'SMALLINT', 2]],
  views: [['ledger_view_type', 'TINYINT', 1], ['is_dropped_ledger_view', 'BIT', 1]]
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

  -- Tabelas de backup/restore consultadas pelo SSMS (Tasks > Back Up/Restore).
  -- Mantidas vazias: o simulador não executa backup real, mas o SMO precisa
  -- que as consultas retornem esquema válido (resultado vazio) em vez de erro.
  CREATE TABLE IF NOT EXISTS backupset (
    backup_set_id INTEGER PRIMARY KEY,
    backup_set_uuid TEXT,
    media_set_id INTEGER,
    first_family_number INTEGER,
    first_media_number INTEGER,
    last_family_number INTEGER,
    last_media_number INTEGER,
    catalog_family_number INTEGER,
    catalog_media_number INTEGER,
    position INTEGER,
    expiration_date DATETIME,
    software_vendor_id INTEGER,
    name TEXT,
    description TEXT,
    user_name TEXT,
    software_major_version INTEGER,
    software_minor_version INTEGER,
    software_build_version INTEGER,
    time_zone INTEGER,
    mtf_minor_version INTEGER,
    first_lsn NUMERIC(25,0),
    last_lsn NUMERIC(25,0),
    checkpoint_lsn NUMERIC(25,0),
    database_backup_lsn NUMERIC(25,0),
    database_creation_date DATETIME,
    backup_start_date DATETIME,
    backup_finish_date DATETIME,
    type CHAR(1),
    sort_order INTEGER,
    code_page INTEGER,
    compatibility_level INTEGER,
    database_version INTEGER,
    backup_size NUMERIC(20,0),
    database_name TEXT,
    server_name TEXT,
    machine_name TEXT,
    flags INTEGER,
    unicode_locale INTEGER,
    unicode_compare_style INTEGER,
    collation_name TEXT,
    is_password_protected BIT DEFAULT 0,
    recovery_model TEXT,
    has_bulk_logged_data BIT DEFAULT 0,
    is_snapshot BIT DEFAULT 0,
    is_readonly BIT DEFAULT 0,
    is_single_user BIT DEFAULT 0,
    has_backup_checksums BIT DEFAULT 0,
    is_damaged BIT DEFAULT 0,
    begins_log_chain BIT DEFAULT 0,
    has_incomplete_metadata BIT DEFAULT 0,
    is_force_offline BIT DEFAULT 0,
    is_copy_only BIT DEFAULT 0,
    first_recovery_fork_guid TEXT,
    last_recovery_fork_guid TEXT,
    fork_point_lsn NUMERIC(25,0),
    database_guid TEXT,
    family_guid TEXT,
    differential_base_lsn NUMERIC(25,0),
    differential_base_guid TEXT,
    compressed_backup_size NUMERIC(20,0),
    key_algorithm TEXT,
    encryptor_thumbprint BLOB,
    encryptor_type TEXT
  );

  CREATE TABLE IF NOT EXISTS backupmediafamily (
    media_set_id INTEGER,
    family_sequence_number INTEGER,
    media_family_id TEXT,
    media_count INTEGER,
    logical_device_name TEXT,
    physical_device_name TEXT,
    device_type INTEGER,
    physical_block_size INTEGER,
    mirror INTEGER
  );

  CREATE TABLE IF NOT EXISTS backupmediaset (
    media_set_id INTEGER PRIMARY KEY,
    media_uuid TEXT,
    media_family_count INTEGER,
    name TEXT,
    description TEXT,
    software_name TEXT,
    software_vendor_id INTEGER,
    MTF_major_version INTEGER,
    mirror_count INTEGER,
    is_password_protected BIT DEFAULT 0,
    is_compressed BIT DEFAULT 0,
    is_encrypted BIT DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS restorehistory (
    restore_history_id INTEGER PRIMARY KEY,
    restore_date DATETIME,
    destination_database_name TEXT,
    user_name TEXT,
    backup_set_id INTEGER,
    restore_type CHAR(1),
    replace BIT DEFAULT 0,
    recovery BIT DEFAULT 0,
    restart BIT DEFAULT 0,
    stop_at DATETIME,
    device_count INTEGER,
    stop_at_mark_name TEXT,
    stop_before BIT DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS restorefile (
    restore_history_id INTEGER,
    file_number NUMERIC(10,0)
  );

  CREATE TABLE IF NOT EXISTS restorefilegroup (
    restore_history_id INTEGER,
    filegroup_name TEXT
  );
`;

// `langid` e um ID sequencial do Database Engine (us_english = 0), nao o LCID do Windows.
// O SSMS/SMO le `sp_configure 'default language'` (RunValue = 0) e procura esse langid
// em sys.syslanguages; se nao achar, o dialog New Database falha com
// "This language id is not present in sys.syslanguages catalog".
const IDIOMAS = [
  ['us_english', 'English', 0, 1033],
  ['German', 'German', 1, 1031],
  ['French', 'French', 2, 1036],
  ['Japanese', 'Japanese', 3, 1041],
  ['Spanish', 'Spanish', 5, 3082],
  ['Italian', 'Italian', 6, 1040],
  ['Portuguese', 'Portuguese', 9, 2070],
  ['Portuguese (Brazil)', 'Portuguese', 27, 1046],
  ['Chinese (Simplified)', 'Chinese', 30, 2052]
];

const CONFIGURACOES = [
  ['show advanced options', 16383, 0, 1, 0, 0, 'Show advanced options'],
  ['Agent XPs', 16384, 0, 1, 1, 1, 'Agent XPs enabled'],
  // O SMO le estas configuracoes apos CREATE DATABASE. Sem as linhas com ids
  // 115, 124, 1126, 1127 e 1555 o GetColumnData estoura IndexOutOfRange.
  ['max worker threads', 115, 128, 65535, 0, 0, 'Maximum worker threads'],
  ['default language', 124, 0, 9999, 0, 0, 'default language'],
  ['nested triggers', 148, 0, 1, 1, 1, 'Allow triggers to be invoked within triggers'],
  ['default full-text language', 1126, 0, 2147483647, 1033, 1033, 'default full-text language'],
  ['full-text upgrade option', 1127, 0, 2, 0, 0, 'full-text upgrade option'],
  ['remote data archive', 1555, 0, 1, 0, 0, 'Allow the use of the REMOTE_DATA_ARCHIVE data access for databases'],
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
 * `sys.syslanguages.lcid` e INT no SQL Server. Versoes anteriores do simulador
 * usavam SMALLINT, e o SMO ignora LocaleID quando a coluna TDS tem 2 bytes.
 * Recria a tabela preservando as linhas para corrigir databases ja existentes.
 * @private
 */
function migrarLcidParaInt(db, schema) {
  const coluna = db.prepare(`PRAGMA ${schema}.table_info(syslanguages)`)
    .all()
    .find((info) => info.name === 'lcid');
  if (!coluna || String(coluna.type).toUpperCase() === 'INT') return;

  db.exec(`DROP TABLE IF EXISTS ${schema}.syslanguages_legado`);
  db.exec(`ALTER TABLE ${schema}.syslanguages RENAME TO syslanguages_legado`);
  criarTabelas(db, schema);
  db.exec(`
    INSERT OR REPLACE INTO ${schema}.syslanguages (name, alias, langid, lcid)
    SELECT name, alias, langid, lcid FROM ${schema}.syslanguages_legado
  `);
  db.exec(`DROP TABLE ${schema}.syslanguages_legado`);
}

/**
 * Databases criados por versoes anteriores tinham `default language` com o id
 * errado (148) e nao tinham as configuracoes de full-text. O SMO le essas
 * linhas pelo configuration_id logo apos CREATE DATABASE.
 * @private
 */
function migrarConfiguracoes(db, schema) {
  db.exec(`
    UPDATE OR IGNORE ${schema}.configurations
      SET configuration_id = 124 WHERE name = 'default language' AND configuration_id <> 124;
    DELETE FROM ${schema}.configurations WHERE name = 'nested triggers';
  `);
  const inserir = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.configurations
      (name, configuration_id, minimum, maximum, value, value_in_use, description, is_dynamic, is_advanced)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
  `);
  CONFIGURACOES.forEach((config) => inserir.run(...config));
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
    ON CONFLICT(name) DO UPDATE SET
      database_id = excluded.database_id,
      create_date = COALESCE(sys.databases.create_date, excluded.create_date)
  `);
  const data = new Date().toISOString();
  // IDs ja atribuidos precisam ser preservados: um database pode aparecer em
  // posicoes diferentes da lista conforme novos databases sao criados.
  const existentes = new Map(
    db.prepare(`SELECT name, database_id FROM ${schema}.databases`).all()
      .map((linha) => [linha.name, linha.database_id])
  );
  let id = existentes.size
    ? Math.max(...existentes.values()) + 1
    : 1;
  const inserirRecuperacao = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.database_recovery_status
      (database_id, database_guid, recovery_fork_guid) VALUES (?, ?, ?)
  `);
  const inserirChangeTracking = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.change_tracking_databases (database_id) VALUES (?)
  `);
  const inserirFilestream = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.database_filestream_options (database_id) VALUES (?)
  `);
  const inserirQueryStore = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.database_query_store_options (database_id) VALUES (?)
  `);
  const inserirEstatisticaArquivo = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.dm_io_virtual_file_stats
      (database_id, file_id) VALUES (?, ?)
  `);
  const inserirUsoEspacoArquivo = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.dm_db_file_space_usage
      (database_id, file_id) VALUES (?, ?)
  `);
  for (const nome of nomes) {
    const atual = existentes.get(nome);
    const databaseId = atual === undefined ? id++ : atual;
    inserirDatabase.run(nome, databaseId, data);
    // GUIDs deterministicos por database_id: o SMO le RecoveryForkGuid e
    // DatabaseGuid logo apos criar um database e nao tolera coluna ausente.
    const guid = `00000000-0000-0000-0000-${String(databaseId).padStart(12, '0')}`;
    inserirRecuperacao.run(databaseId, guid, guid);
    inserirChangeTracking.run(databaseId);
    inserirFilestream.run(databaseId);
    inserirQueryStore.run(databaseId);
    for (const fileId of [1, 2]) {
      inserirEstatisticaArquivo.run(databaseId, fileId);
      inserirUsoEspacoArquivo.run(databaseId, fileId);
    }
  }

  const inserirConfiguracao = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.configurations
      (name, configuration_id, minimum, maximum, value, value_in_use, description, is_dynamic, is_advanced)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
  `);
  CONFIGURACOES.forEach((config) => inserirConfiguracao.run(...config));

  const inserirConfiguracaoEscopo = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.database_scoped_configurations
      (name, configuration_id, value, value_for_secondary, is_value_default)
    VALUES (?, ?, ?, ?, 1)
  `);
  [
    ['MAXDOP', 9, 0, 0],
    ['LEGACY_CARDINALITY_ESTIMATION', 18, 0, 2],
    ['PARAMETER_SNIFFING', 19, 1, 2],
    ['QUERY_OPTIMIZER_HOTFIXES', 20, 0, 2]
  ].forEach((config) => inserirConfiguracaoEscopo.run(...config));

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
  const inserirIdioma = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.syslanguages (name, alias, langid, lcid)
    VALUES (?, ?, ?, ?)
  `);
  // UPDATE tambem corrige databases antigos que tinham langid = lcid.
  const atualizarIdioma = db.prepare(`
    UPDATE ${schema}.syslanguages SET alias = ?, langid = ?, lcid = ? WHERE name = ?
  `);
  IDIOMAS.forEach((idioma) => {
    inserirIdioma.run(...idioma);
    atualizarIdioma.run(idioma[1], idioma[2], idioma[3], idioma[0]);
  });
  const inserirIdiomaFullText = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.fulltext_languages (lcid, language_id, name)
    VALUES (?, ?, ?)
  `);
  IDIOMAS.forEach((idioma) => inserirIdiomaFullText.run(idioma[3], idioma[2], idioma[1]));
  const inserirColacao = db.prepare(`
    INSERT OR IGNORE INTO ${schema}.fn_helpcollations (name, description)
    VALUES (?, ?)
  `);
  for (const nome of [
    'SQL_Latin1_General_CP1_CI_AS',
    'SQL_Latin1_General_CP1_CS_AS',
    'Latin1_General_CI_AS',
    'Latin1_General_CS_AS',
    'Latin1_General_BIN2'
  ]) {
    inserirColacao.run(nome, 'Windows collation, sort order 52, case-insensitive');
  }
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

/** Nome logico do database do arquivo SQLite atual. @private */
function nomeDatabaseLocal(db, dbName) {
  if (dbName) return String(dbName);
  try {
    const linha = db.prepare(
      "SELECT file AS arquivo FROM pragma_database_list WHERE name = 'main'"
    ).get();
    if (linha && linha.arquivo) return path.basename(linha.arquivo, '.db');
  } catch (_erro) {
    // Catalogos em memoria nao tem nome de arquivo.
  }
  return MASTER;
}

/**
 * Reconstrói as views de catalogo locais (sys.tables, sys.indexes, ...) a partir
 * do schema SQLite real do database atual.
 * @private
 */
function sincronizarCatalogoDatabase(db, dbName) {
  // A definicao da view pode mudar entre versoes; CREATE VIEW IF NOT EXISTS
  // nao substitui uma view antiga que devolvia a procedure base como numero 1.
  db.exec('DROP VIEW IF EXISTS main.numbered_procedures;');
  // Versoes anteriores gravavam encryption_type = 0 (NOT NULL). No SQL Server a
  // coluna e NULL quando a coluna nao usa Always Encrypted; com 0 o SMO entende
  // que ha criptografia e gera "ENCRYPTED WITH" em todas as colunas do CREATE.
  // A tabela e reconstruida pelo DDL abaixo e repopulada pela sincronizacao.
  const colunaEncryption = db.prepare('PRAGMA main.table_info(all_columns)')
    .all()
    .find((info) => info.name === 'encryption_type');
  if (colunaEncryption && colunaEncryption.notnull === 1) {
    db.exec('DROP TABLE IF EXISTS main.all_columns;');
  }
  db.exec(DDL_DATABASE);
  // databases antigos nao tem returns_type/corpo; a migracao precisa acontecer
  // antes de ler as funcoes salvas logo abaixo.
  migrarColunas(db, 'main', 'sql_modules', [
    ['returns_type', "TEXT DEFAULT 'int'"],
    ['corpo', 'TEXT']
  ]);

  // As tabelas objects/sql_modules/all_parameters sao reconstruidas abaixo.
  // Guarda as rotinas registradas para reinstalla-las depois da reconstrucao.
  const rotinasSalvas = db.prepare(`
    SELECT p.name, p.object_id, p.schema_id, p.principal_id, p.create_date,
           p.modify_date, p.is_ms_shipped, m.definition, m.corpo
    FROM main.procedures AS p
    LEFT JOIN main.sql_modules AS m ON m.object_id = p.object_id
  `).all();
  const parametrosSalvos = db.prepare(`
    SELECT a.* FROM main.all_parameters AS a
    INNER JOIN main.procedures AS p ON p.object_id = a.object_id
    ORDER BY a.object_id, a.parameter_id
  `).all();
  // Funcoes escalares tambem vivem em objects/sql_modules/all_parameters e
  // serao apagadas pela reconstrucao abaixo. Preservamos o corpo e os
  // parametros para reinstala-las no final.
  const funcoesSalvas = db.prepare(`
    SELECT o.object_id, o.name, o.schema_id, o.principal_id, o.create_date,
           o.modify_date, o.is_ms_shipped, m.definition, m.returns_type, m.corpo
    FROM main.objects AS o
    LEFT JOIN main.sql_modules AS m ON m.object_id = o.object_id
    WHERE o.type = 'FN'
  `).all();
  const parametrosFuncoesSalvos = db.prepare(`
    SELECT a.* FROM main.all_parameters AS a
    INNER JOIN main.objects AS o ON o.object_id = a.object_id AND o.type = 'FN'
    ORDER BY a.object_id, a.parameter_id
  `).all();

  const nomeDb = nomeDatabaseLocal(db, dbName);
  const diretorioDados = DIRETORIO_DADOS_PADRAO;
  const arquivoDados = path.join(diretorioDados, `${nomeDb}.mdf`);
  const arquivoLog = path.join(diretorioDados, `${nomeDb}_log.ldf`);

  db.prepare(`
    INSERT OR IGNORE INTO main.filegroups
      (name, data_space_id, is_default, is_read_only, type, is_autogrow_all_files)
    VALUES ('PRIMARY', 1, 1, 0, 'FG', 1)
  `).run();
  const inserirArquivo = db.prepare(`
    INSERT OR IGNORE INTO main.database_files
      (file_id, type, name, physical_name, size, max_size, growth,
       is_percent_growth, is_media_read_only, is_read_only, state, is_sparse, data_space_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  inserirArquivo.run(1, 0, nomeDb, arquivoDados, 8192, -1, 64, 0, 0, 0, 0, 0, 1);
  inserirArquivo.run(2, 1, `${nomeDb}_log`, arquivoLog, 8192, -1, 64, 0, 0, 0, 0, 0, 0);

  const linhaBanco = db.prepare('SELECT database_id FROM sys.databases WHERE name = ?').get(nomeDb);
  if (linhaBanco) {
    const inserirArquivoMestre = db.prepare(`
      INSERT OR IGNORE INTO sys.master_files
        (database_id, file_id, type, name, physical_name, size, max_size, growth,
         is_percent_growth, is_media_read_only, is_read_only, state, is_sparse, data_space_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    inserirArquivoMestre.run(
      linhaBanco.database_id, 1, 0, nomeDb, arquivoDados, 8192, -1, 64, 0, 0, 0, 0, 0, 1
    );
    inserirArquivoMestre.run(
      linhaBanco.database_id, 2, 1, `${nomeDb}_log`, arquivoLog, 8192, -1, 64, 0, 0, 0, 0, 0, 0
    );
  }

  migrarColunas(db, 'main', 'objects', [
    ['parent_object_id', 'INTEGER'],
    ['modify_date', 'DATETIME']
  ]);
  migrarColunas(db, 'main', 'tables', [
    ['modify_date', 'DATETIME'],
    ['lob_data_space_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['uses_ansi_nulls', 'BIT NOT NULL DEFAULT 1'],
    ['durability', 'TINYINT NOT NULL DEFAULT 0'],
    ['is_replicated', 'BIT NOT NULL DEFAULT 0'],
    ['lock_escalation', 'TINYINT NOT NULL DEFAULT 0'],
    ['lock_escalation_desc', "TEXT NOT NULL DEFAULT 'TABLE'"],
    ['history_table_id', 'INTEGER'],
    ['filestream_data_space_id', 'INTEGER'],
    ['is_dropped_ledger_table', 'BIT NOT NULL DEFAULT 0'],
    ['ledger_view_id', 'INTEGER NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'partitions', [
    ['xml_compression', 'BIT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'spatial_index_tessellations', [
    ['level_1_grid', 'INTEGER NOT NULL DEFAULT 0'],
    ['level_2_grid', 'INTEGER NOT NULL DEFAULT 0'],
    ['level_3_grid', 'INTEGER NOT NULL DEFAULT 0'],
    ['level_4_grid', 'INTEGER NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'spatial_indexes', [
    ['name', 'TEXT'],
    ['fill_factor', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_padded', 'BIT NOT NULL DEFAULT 0'],
    ['is_disabled', 'BIT NOT NULL DEFAULT 0'],
    ['is_hypothetical', 'BIT NOT NULL DEFAULT 0'],
    ['allow_row_locks', 'BIT NOT NULL DEFAULT 1'],
    ['allow_page_locks', 'BIT NOT NULL DEFAULT 1']
  ]);
  migrarColunas(db, 'main', 'xml_indexes', [
    ['name', 'TEXT'],
    ['fill_factor', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_padded', 'BIT NOT NULL DEFAULT 0'],
    ['is_disabled', 'BIT NOT NULL DEFAULT 0'],
    ['is_hypothetical', 'BIT NOT NULL DEFAULT 0'],
    ['allow_row_locks', 'BIT NOT NULL DEFAULT 1'],
    ['allow_page_locks', 'BIT NOT NULL DEFAULT 1']
  ]);
  migrarColunas(db, 'main', 'fulltext_indexes', [
    ['has_crawl_completed', 'BIT NOT NULL DEFAULT 0'],
    ['crawl_type', "TEXT NOT NULL DEFAULT ''"],
    ['crawl_start_date', 'DATETIME'],
    ['crawl_end_date', 'DATETIME'],
    ['incremental_timestamp', 'TEXT']
  ]);
  migrarColunas(db, 'main', 'index_columns', [
    ['key_ordinal', 'INTEGER NOT NULL DEFAULT 0'],
    ['partition_ordinal', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_descending_key', 'BIT NOT NULL DEFAULT 0'],
    ['column_store_order_ordinal', 'INTEGER']
  ]);
  migrarColunas(db, 'main', 'default_constraints', [
    ['is_published', 'BIT NOT NULL DEFAULT 0'],
    ['is_schema_published', 'BIT NOT NULL DEFAULT 0'],
    ['is_system_named', 'BIT NOT NULL DEFAULT 1']
  ]);
  migrarColunas(db, 'main', 'foreign_key_columns', [
    ['constraint_object_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['constraint_column_id', 'INTEGER NOT NULL DEFAULT 1'],
    ['referenced_object_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['referenced_column_id', 'INTEGER NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'indexes', [
    ['is_unique', 'BIT NOT NULL DEFAULT 0'],
    ['fill_factor', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_padded', 'BIT NOT NULL DEFAULT 0'],
    ['ignore_dup_key', 'BIT NOT NULL DEFAULT 0'],
    ['allow_row_locks', 'BIT NOT NULL DEFAULT 1'],
    ['allow_page_locks', 'BIT NOT NULL DEFAULT 1'],
    ['filter_definition', 'TEXT'],
    ['has_filter', 'BIT NOT NULL DEFAULT 0'],
    ['compression_delay', 'INTEGER NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'all_columns', [
    ['default_object_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['rule_object_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['xml_collection_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_ansi_padded', 'BIT NOT NULL DEFAULT 1'],
    ['is_rowguidcol', 'BIT NOT NULL DEFAULT 0'],
    ['is_replicated', 'BIT NOT NULL DEFAULT 0'],
    ['is_non_sql_subscribed', 'BIT NOT NULL DEFAULT 0'],
    ['is_merge_published', 'BIT NOT NULL DEFAULT 0'],
    ['is_dts_replicated', 'BIT NOT NULL DEFAULT 0'],
    ['is_filestream', 'BIT NOT NULL DEFAULT 0'],
    ['is_column_set', 'BIT NOT NULL DEFAULT 0'],
    ['generated_always_type', 'TINYINT NOT NULL DEFAULT 0'],
    ['is_hidden', 'BIT NOT NULL DEFAULT 0'],
    ['is_dropped_ledger_column', 'BIT NOT NULL DEFAULT 0'],
    ['is_masked', 'BIT NOT NULL DEFAULT 0'],
    ['graph_type', 'INTEGER NOT NULL DEFAULT 0'],
    ['encryption_algorithm_name', 'TEXT'],
    ['column_encryption_key_id', 'INTEGER'],
    ['is_xml_document', 'BIT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'all_views', [
    ['is_dropped_ledger_view', 'BIT NOT NULL DEFAULT 0'],
    ['has_opaque_metadata', 'BIT NOT NULL DEFAULT 0'],
    ['modify_date', "DATETIME DEFAULT '2023-01-01 00:00:00'"]
  ]);
  migrarColunas(db, 'main', 'types', [
    ['schema_id', 'INTEGER NOT NULL DEFAULT 4'],
    ['is_assembly_type', 'BIT NOT NULL DEFAULT 0'],
    ['is_table_type', 'BIT NOT NULL DEFAULT 0'],
    ['is_nullable', 'BIT NOT NULL DEFAULT 1'],
    ['default_object_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['rule_object_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['collation_name', 'TEXT']
  ]);
  migrarColunas(db, 'main', 'all_parameters', [
    ['has_default_value', 'BIT NOT NULL DEFAULT 0'],
    ['default_value', 'TEXT'],
    ['is_readonly', 'BIT NOT NULL DEFAULT 0'],
    ['system_type_id', 'INTEGER NOT NULL DEFAULT 56'],
    ['max_length', 'INTEGER NOT NULL DEFAULT -1'],
    ['precision', 'TINYINT NOT NULL DEFAULT 0'],
    ['scale', 'TINYINT NOT NULL DEFAULT 0'],
    ['xml_collection_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_xml_document', 'BIT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'procedures', [
    ['is_auto_executed', 'BIT NOT NULL DEFAULT 0']
  ]);
  for (const tabela of ['sql_modules', 'system_sql_modules']) {
    migrarColunas(db, 'main', tabela, [
      ['is_recompiled', 'BIT NOT NULL DEFAULT 0'],
      ['execute_as_principal_id', 'INTEGER']
    ]);
  }
  migrarColunas(db, 'main', 'sql_modules', [
    ['returns_type', "TEXT DEFAULT 'int'"],
    ['null_on_null_input', 'BIT NOT NULL DEFAULT 1'],
    ['inline_type', 'TINYINT NOT NULL DEFAULT 0'],
    ['is_inlineable', 'BIT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'assembly_modules', [
    ['null_on_null_input', 'BIT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'main', 'stats', [
    ['name', "TEXT NOT NULL DEFAULT ''"]
  ]);
  migrarColunas(db, 'main', 'key_constraints', [
    ['name', "TEXT NOT NULL DEFAULT ''"],
    ['object_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['principal_id', 'INTEGER'],
    ['schema_id', 'INTEGER NOT NULL DEFAULT 1'],
    ['type', "CHAR(2) NOT NULL DEFAULT 'PK'"],
    ['type_desc', "TEXT NOT NULL DEFAULT 'PRIMARY_KEY_CONSTRAINT'"],
    ['create_date', "DATETIME DEFAULT '2023-01-01 00:00:00'"],
    ['modify_date', "DATETIME DEFAULT '2023-01-01 00:00:00'"],
    ['is_ms_shipped', 'BIT NOT NULL DEFAULT 0'],
    ['is_published', 'BIT NOT NULL DEFAULT 0'],
    ['is_schema_published', 'BIT NOT NULL DEFAULT 0'],
    ['is_enforced', 'BIT NOT NULL DEFAULT 1'],
    ['is_system_named', 'BIT NOT NULL DEFAULT 1']
  ]);
  migrarColunas(db, 'main', 'synonyms', [
    ['base_object_name', "TEXT DEFAULT ''"]
  ]);
  migrarColunas(db, 'main', 'database_principals', [
    ['modify_date', "DATETIME DEFAULT '2023-01-01 00:00:00'"],
    ['authentication_type', 'INT NOT NULL DEFAULT 0'],
    ['default_schema_name', "TEXT DEFAULT 'dbo'"],
    ['default_language_lcid', 'INT DEFAULT 1033'],
    ['default_language_name', "TEXT DEFAULT 'us_english'"],
    ['state', "CHAR(2) DEFAULT 'G'"],
    ['is_disabled', 'BIT NOT NULL DEFAULT 0']
  ]);

  const data = '2023-01-01 00:00:00';

  // Defaults criados por ALTER TABLE ADD DEFAULT sobrevivem como triggers
  // SQLite. Versoes anteriores nao guardavam a definicao em tabela propria:
  // recuperamos o T-SQL a partir do trigger para nao perder os defaults ja
  // aplicados antes de existir `default_definitions`.
  const inserirDefaultPersistido = db.prepare(`
    INSERT OR IGNORE INTO main.default_definitions
      (table_name, column_name, name, definition, create_date)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const gatilho of db.prepare(`
    SELECT name, sql FROM main.sqlite_master
    WHERE type = 'trigger' AND name LIKE 'DF__%'
  `).all()) {
    const correspondencia = /AFTER\s+INSERT\s+ON\s+"([^"]+)"[\s\S]*?WHEN\s+NEW\."([^"]+)"\s+IS\s+NULL[\s\S]*?SET\s+"[^"]+"\s*=\s*([\s\S]*?)\s+WHERE\s+rowid/i.exec(
      String(gatilho.sql || '')
    );
    if (!correspondencia) continue;
    const expressao = String(correspondencia[3])
      .replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'getdate()')
      .replace(/\bunixepoch\s*\(\s*\)/gi, 'getdate()')
      .replace(/\[([A-Za-z_]\w*)\]\s*\(/g, '[DBO].[$1](');
    inserirDefaultPersistido.run(
      correspondencia[1],
      correspondencia[2],
      gatilho.name,
      `(${expressao})`,
      data
    );
  }

  const defaultsPersistentes = new Map(
    db.prepare('SELECT table_name, column_name, name, definition FROM main.default_definitions')
      .all()
      .map((linha) => [`${linha.table_name}\u0000${linha.column_name}`, linha])
  );
  const foreignKeysPersistentes = db.prepare(`
    SELECT name, table_name, column_name, referenced_table, referenced_column
    FROM main.foreign_key_definitions
  `).all();

  // MS_DiagramPane/MS_Description precisam sobreviver ao rebuild do catalogo.
  // O View Designer le o pane via sys.extended_properties; sem as linhas a
  // janela abre em branco. Guardamos o nome do objeto pelo cache anterior
  // (rowid do SQLite pode mudar se a view for recriada).
  const extendedPropertiesPersistentes = db.prepare(`
    SELECT major_id, minor_id, class, name, value FROM main.extended_properties
  `).all().map((propriedade) => ({
    ...propriedade,
    objectName: db.__objetosPorId && db.__objetosPorId.get(Number(propriedade.major_id))
  }));

  for (const tabela of [
    'objects', 'tables', 'all_views', 'synonyms', 'indexes', 'all_columns',
    'sql_modules', 'system_sql_modules', 'extended_properties',
    'default_constraints', 'check_constraints', 'edge_constraints', 'index_resumable_operations', 'index_columns', 'computed_columns', 'identity_columns',
    'foreign_keys', 'foreign_key_columns', 'column_encryption_keys', 'xml_schema_collections',
    'sensitivity_classifications', 'change_tracking_tables', 'filetables',
    'periods', 'remote_data_archive_tables',
    'external_tables', 'external_data_sources', 'external_file_formats', 'partitions',
    'masked_columns', 'filetable_system_defined_objects',
    'spatial_index_tessellations', 'spatial_indexes', 'hash_indexes', 'xml_indexes',
    'selective_xml_index_paths', 'stats', 'key_constraints',
    'fulltext_indexes', 'fulltext_catalogs', 'fulltext_stoplists',
    'registered_search_property_lists', 'fulltext_index_columns',
    'all_parameters', 'triggers', 'database_permissions', 'assemblies', 'assembly_modules'
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
  `).all().filter((objeto) => !OBJETOS_DO_CATALOGO.has(objeto.name) && !/^_tmp_/i.test(objeto.name));

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
  const inserirForeignKey = db.prepare(`
    INSERT INTO main.foreign_keys
      (name, object_id, parent_object_id, referenced_object_id, is_not_trusted,
       is_system_named)
    VALUES (?, ?, ?, ?, 0, 0)
  `);
  const inserirObjetoForeignKey = db.prepare(`
    INSERT INTO main.objects
      (name, object_id, schema_id, principal_id, type, type_desc, create_date,
       parent_object_id)
    VALUES (?, ?, 1, 1, 'F', 'FOREIGN_KEY_CONSTRAINT', ?, ?)
  `);
  const inserirColunaForeignKey = db.prepare(`
    INSERT INTO main.foreign_key_columns
      (constraint_object_id, constraint_column_id, parent_object_id,
       parent_column_id, referenced_object_id, referenced_column_id)
    VALUES (?, 1, ?, ?, ?, ?)
  `);
  const inserirIndice = db.prepare(`
    INSERT INTO main.indexes
      (name, object_id, index_id, type, type_desc, is_primary_key,
       is_unique_constraint, is_unique, is_hypothetical, is_disabled, data_space_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
  `);
  const inserirColunaIndice = db.prepare(`
    INSERT OR REPLACE INTO main.index_columns
      (object_id, index_id, index_column_id, column_id, is_included_column,
       key_ordinal, partition_ordinal)
    VALUES (?, ?, ?, ?, 0, ?, 0)
  `);
  const inserirKeyConstraint = db.prepare(`
    INSERT INTO main.key_constraints
      (name, object_id, parent_object_id, unique_index_id, type, type_desc, is_system_named)
    VALUES (?, ?, ?, ?, 'PK', 'PRIMARY_KEY_CONSTRAINT', ?)
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

      // O SMO carrega View.Columns a partir de sys.columns. Sem as colunas da
      // view o designer abre em branco, mesmo com o texto em syscomments.
      // PRAGMA table_info devolve as colunas derivadas da view no SQLite.
      db.prepare('DELETE FROM main.all_columns WHERE object_id = ?').run(objeto.object_id);
      let colunasView = [];
      try {
        colunasView = db.prepare(`PRAGMA main.table_info("${nomeSeguro}")`).all();
      } catch (_erro) {
        // View quebrada (dependência ausente/UDF indisponível): mantém o objeto
        // no catálogo, mas sem colunas inferidas para não bloquear a sincronização.
        colunasView = [];
      }
      const colunasBase = resolverTiposColunasView(db, objeto.sql, colunasView) || [];
      for (let indice = 0; indice < colunasView.length; indice += 1) {
        const coluna = colunasView[indice];
        const base = colunasBase[indice];
        const declarado = String(coluna.type || '').split('(')[0].trim().toUpperCase();
        const definicao = TIPOS_SQL[declarado] || TIPOS_SQL.NVARCHAR;
        inserirColuna.run(
          coluna.name,
          objeto.object_id,
          coluna.cid + 1,
          base ? base.user_type_id : definicao[1],
          base ? base.system_type_id : definicao[2],
          base ? base.max_length : definicao[3],
          base ? base.precision : definicao[4],
          base ? base.scale : definicao[5],
          base ? base.is_nullable : 1,
          0,
          0
        );
      }
      continue;
    }

    inserirTabela.run(objeto.name, objeto.object_id, data, data);

    const metadadosDdl = extrairMetadadosDdl(objeto.sql);
    // No SQL Server uma tabela tem HEAP (index_id = 0) ou um indice
    // clusterizado (index_id = 1), nunca os dois. Manter as duas linhas faz o
    // SMO escolher a linha do HEAP e gerar o CREATE sem a PRIMARY KEY.
    const pkDdlInicial = metadadosDdl.pk;
    if (!pkDdlInicial || !pkDdlInicial.clusterizado) {
      inserirIndice.run(null, objeto.object_id, 0, 0, 'HEAP', 0, 0, 0);
    }

    const inserirIdentidade = db.prepare(`
      INSERT OR REPLACE INTO main.identity_columns
        (object_id, column_id, seed_value, increment_value)
      VALUES (?, ?, ?, ?)
    `);

    const colunas = db.prepare(`PRAGMA main.table_info("${nomeSeguro}")`).all();
    for (const coluna of colunas) {
      const metadado = metadadosDdl.colunas.get(String(coluna.name).toLowerCase());
      const declarado = String(coluna.type || '').split('(')[0].trim().toUpperCase();
      const definicao = metadado && metadado.tipoOriginal
        ? definicaoTsql(metadado.tipoOriginal)
        : (TIPOS_SQL[declarado] || TIPOS_SQL.NVARCHAR);
      const ehIdentidade = Boolean(metadado && metadado.identidade);
      const defaultPersistido = defaultsPersistentes.get(`${objeto.name}\u0000${coluna.name}`);
      const definicaoDefault = defaultPersistido ? defaultPersistido.definition : coluna.dflt_value;
      const possuiDefault = definicaoDefault != null;
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
        ehIdentidade ? 1 : 0,
        defaultId
      );
      if (ehIdentidade) {
        inserirIdentidade.run(
          objeto.object_id,
          coluna.cid + 1,
          metadado.seed,
          metadado.incremento
        );
      }
      if (possuiDefault) {
        const nomeDefault = defaultPersistido
          ? defaultPersistido.name
          : `DF__${objeto.name}__${coluna.name}`;
        inserirDefault.run(
          nomeDefault,
          defaultId,
          objeto.object_id,
          coluna.cid + 1,
          data,
          data,
          definicaoDefault
        );
        inserirObjetoDefault.run(nomeDefault, defaultId, data, objeto.object_id);
      }
    }

    const pkDdl = metadadosDdl.pk;
    const indices = db.prepare(`PRAGMA main.index_list("${nomeSeguro}")`).all();
    let proximoIndexId = 2;
    let pkRegistrada = false;
    for (const indice of indices) {
      const chavePrimaria = String(indice.origin || '').toLowerCase() === 'pk';
      if (chavePrimaria) pkRegistrada = true;
      const nomeIndice = chavePrimaria
        ? (pkDdl && pkDdl.nome ? pkDdl.nome : `PK_${objeto.name}`)
        : indice.name;
      const tipoIndice = chavePrimaria && pkDdl && !pkDdl.clusterizado
        ? 'NONCLUSTERED'
        : (chavePrimaria ? 'CLUSTERED' : 'NONCLUSTERED');
      // No SQL Server o indice clusterizado tem sempre index_id = 1. O SMO
      // usa esse fato para montar PrimaryKey/IsClustered e gerar o script.
      const indexId = chavePrimaria && tipoIndice === 'CLUSTERED'
        ? 1
        : proximoIndexId++;
      // sys.indexes.type: 0 = HEAP, 1 = CLUSTERED, 2 = NONCLUSTERED.
      // O SMO deriva IndexType/IsClustered desse campo ao gerar o script.
      const tipoIndiceTsql = tipoIndice === 'CLUSTERED' ? 1 : 2;
      inserirIndice.run(
        nomeIndice,
        objeto.object_id,
        indexId,
        tipoIndiceTsql,
        tipoIndice,
        chavePrimaria ? 1 : 0,
        !chavePrimaria && indice.unique ? 1 : 0,
        chavePrimaria || indice.unique ? 1 : 0
      );
      if (chavePrimaria) {
        inserirKeyConstraint.run(
          nomeIndice,
          900000000 + objeto.object_id,
          objeto.object_id,
          indexId,
          // O nome sempre existe no catalogo (derivado da DDL ou sintetizado
          // como PK_<tabela>). Marca-lo como nao system-named faz o SMO emitir
          // CONSTRAINT [nome] no script CREATE.
          0
        );
      }

      const nomeIndiceSeguro = String(indice.name || '').replace(/"/g, '""');
      const colunasIndice = nomeIndiceSeguro
        ? db.prepare(`PRAGMA main.index_info("${nomeIndiceSeguro}")`).all()
        : [];
      colunasIndice.forEach((colunaIndice, posicao) => {
        inserirColunaIndice.run(
          objeto.object_id,
          indexId,
          posicao + 1,
          (colunaIndice.seqno || 0) + 1,
          posicao + 1
        );
      });
    }

    // PRIMARY KEY de INTEGER vira alias de rowid no SQLite e nao gera indice
    // fisico. Mesmo assim o catalogo SQL Server precisa do indice/cluster e da
    // constraint para o SMO listar Keys e gerar o script CREATE.
    if (pkDdl && !pkRegistrada) {
      const nomeIndice = pkDdl.nome || `PK_${objeto.name}`;
      const tipoIndice = pkDdl.clusterizado ? 'CLUSTERED' : 'NONCLUSTERED';
      const indexId = pkDdl.clusterizado ? 1 : proximoIndexId++;
      inserirIndice.run(
        nomeIndice,
        objeto.object_id,
        indexId,
        pkDdl.clusterizado ? 1 : 2,
        tipoIndice,
        1,
        0,
        1
      );
      inserirKeyConstraint.run(
        nomeIndice,
        900000000 + objeto.object_id,
        objeto.object_id,
        indexId,
        0
      );
      pkDdl.colunas.forEach((nomeColuna, posicao) => {
        const coluna = db.prepare(
          'SELECT column_id FROM main.all_columns WHERE object_id = ? AND name = ?'
        ).get(objeto.object_id, nomeColuna);
        if (coluna) {
          inserirColunaIndice.run(objeto.object_id, indexId, posicao + 1, coluna.column_id, posicao + 1);
        }
      });
    }
  }

  // ADD CONSTRAINT ... FOREIGN KEY nao muda o DDL do SQLite. Reinserimos as
  // definicoes persistidas no catalogo para que o SMO veja a dependencia.
  foreignKeysPersistentes.forEach((chave, indice) => {
    const tabela = db.prepare(
      'SELECT object_id FROM main.tables WHERE name = ?'
    ).get(chave.table_name);
    const referenciada = db.prepare(
      'SELECT object_id FROM main.tables WHERE name = ?'
    ).get(chave.referenced_table);
    if (!tabela || !referenciada) return;
    const coluna = db.prepare(
      'SELECT column_id FROM main.all_columns WHERE object_id = ? AND name = ?'
    ).get(tabela.object_id, chave.column_name);
    const colunaReferenciada = db.prepare(
      'SELECT column_id FROM main.all_columns WHERE object_id = ? AND name = ?'
    ).get(referenciada.object_id, chave.referenced_column);
    if (!coluna || !colunaReferenciada) return;

    const objectId = 910000000 + tabela.object_id * 1000 + indice;
    inserirForeignKey.run(
      chave.name, objectId, tabela.object_id, referenciada.object_id
    );
    inserirObjetoForeignKey.run(chave.name, objectId, data, tabela.object_id);
    inserirColunaForeignKey.run(
      objectId, tabela.object_id, coluna.column_id,
      referenciada.object_id, colunaReferenciada.column_id
    );
  });

  const inserirExtendedProperty = db.prepare(`
    INSERT INTO main.extended_properties (major_id, minor_id, class, name, value)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const propriedade of extendedPropertiesPersistentes) {
    let objectId = propriedade.objectName
      ? db.prepare('SELECT object_id FROM main.objects WHERE name = ?')
        .get(propriedade.objectName)?.object_id
      : null;
    if (objectId == null) objectId = propriedade.major_id;
    inserirExtendedProperty.run(
      objectId, propriedade.minor_id, propriedade.class,
      propriedade.name, propriedade.value
    );
  }

  // Views de sistema no schema sys: aparecem na pasta "System Views" do SSMS
  // e permitem inspecionar as colunas de cada catalogo com SELECT.
  db.prepare(`INSERT OR IGNORE INTO main.schemas (name, schema_id, principal_id) VALUES ('sys', 4, 4)`).run();
  const inserirViewSistema = db.prepare(`
    INSERT INTO main.all_views
      (name, object_id, schema_id, principal_id, type, create_date, is_ms_shipped, definition)
    VALUES (?, ?, 4, 4, 'V', ?, 1, ?)
  `);
  const inserirObjetoSistema = db.prepare(`
    INSERT INTO main.objects
      (name, object_id, schema_id, principal_id, type, type_desc, create_date, is_ms_shipped)
    VALUES (?, ?, 4, 4, 'V', 'VIEW', ?, 1)
  `);
  let objetoIdSistema = -1000;
  for (const [nome, colunasExtras] of Object.entries(VIEWS_DO_SISTEMA)) {
    const objectId = objetoIdSistema;
    objetoIdSistema -= 1;
    inserirViewSistema.run(nome, objectId, data, `CREATE VIEW sys.${nome} AS SELECT ...`);
    inserirObjetoSistema.run(nome, objectId, data);

    const colunas = new Map();
    for (const [nomeColuna, tipo, tamanho] of COLUNAS_VIEW_SISTEMA) {
      colunas.set(nomeColuna.toLowerCase(), [nomeColuna, tipo, tamanho]);
    }
    for (const [nomeColuna, tipo, tamanho] of colunasExtras) {
      colunas.set(nomeColuna.toLowerCase(), [nomeColuna, tipo, tamanho]);
    }
    let columnId = 1;
    for (const [nomeColuna, tipo, tamanho] of colunas.values()) {
      const definicao = TIPOS_SQL[tipo] || TIPOS_SQL.NVARCHAR;
      inserirColuna.run(
        nomeColuna,
        objectId,
        columnId,
        definicao[1],
        definicao[2],
        tamanho || definicao[3],
        definicao[4],
        definicao[5],
        1,
        0,
        0
      );
      columnId += 1;
    }
  }

  db.prepare(`
    DELETE FROM main.default_definitions
    WHERE table_name NOT IN (SELECT name FROM main.tables)
  `).run();
  db.prepare(`
    DELETE FROM main.foreign_key_definitions
    WHERE table_name NOT IN (SELECT name FROM main.tables)
       OR referenced_table NOT IN (SELECT name FROM main.tables)
  `).run();

  restaurarProcedimentos(db, rotinasSalvas, parametrosSalvos);
  restaurarFuncoes(db, funcoesSalvas, parametrosFuncoesSalvos);

  // Cache usado por OBJECT_ID/OBJECT_NAME. O better-sqlite3 nao permite
  // executar preparacoes dentro do callback de uma UDF ("database connection
  // is busy executing a query"), entao o catalogo e lido aqui, fora da UDF,
  // sempre que a sincronizacao roda (abertura e apos DDL).
  const objetosCatalogo = db.prepare('SELECT object_id, name FROM main.objects').all();
  db.__objetosPorNome = new Map(
    objetosCatalogo.map((objeto) => [objeto.name.toLowerCase(), objeto.object_id])
  );
  db.__objetosPorId = new Map(
    objetosCatalogo.map((objeto) => [objeto.object_id, objeto.name])
  );
  const colunasCatalogo = db.prepare(
    'SELECT object_id, column_id, name FROM main.all_columns'
  ).all();
  db.__colunasPorId = new Map(
    colunasCatalogo.map((coluna) => [`${coluna.object_id}:${coluna.column_id}`, coluna.name])
  );
}

/**
 * Registra funcoes T-SQL de data que nao existem no SQLite. Tambem e usado no
 * banco em memoria que avalia o corpo das funcoes escalares do usuario.
 * @private
 */
function registrarFuncoesData(db) {
  const paraData = (valor) => {
    if (valor instanceof Date) return valor;
    if (typeof valor === 'number') return new Date(valor);
    const texto = String(valor == null ? '' : valor).trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(texto) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(texto)) {
      return new Date(`${texto}Z`);
    }
    return new Date(texto);
  };
  const diaUtil = (data) => Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
  const ms = (unidade) => ({
    week: 7 * 86400000, hour: 3600000, minute: 60000, second: 1000, millisecond: 1
  }[unidade]);

  db.function('DATEDIFF', { deterministic: true }, (unidade, inicio, fim) => {
    const a = paraData(inicio);
    const b = paraData(fim);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    let u = String(unidade || '').toLowerCase();
    if (u === 'yy' || u === 'yyyy') u = 'year';
    if (u === 'qq' || u === 'q') u = 'quarter';
    if (u === 'mm' || u === 'm') u = 'month';
    if (u === 'wk' || u === 'ww') u = 'week';
    if (u === 'dd' || u === 'd') u = 'day';
    if (u === 'hh') u = 'hour';
    if (u === 'mi' || u === 'n') u = 'minute';
    if (u === 'ss' || u === 's') u = 'second';
    if (u === 'ms') u = 'millisecond';

    if (u === 'year') return b.getUTCFullYear() - a.getUTCFullYear();
    if (u === 'quarter') {
      return (b.getUTCFullYear() - a.getUTCFullYear()) * 4 +
        Math.floor(b.getUTCMonth() / 3) - Math.floor(a.getUTCMonth() / 3);
    }
    if (u === 'month') {
      return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
    }
    if (u === 'day') return Math.trunc((diaUtil(b) - diaUtil(a)) / 86400000);
    if (u === 'week') return Math.trunc((diaUtil(b) - diaUtil(a)) / (7 * 86400000));
    const fator = ms(u);
    return fator ? Math.trunc((b.getTime() - a.getTime()) / fator) : null;
  });
}

/**
 * Registra as funções T-SQL usadas pelo SSMS/SMO em toda conexão SQLite.
 * @private
 */
function registrarFuncoes(db, { dataDir, dbName, engine, listarDatabases, usuario = 'admin' }) {
  registrarFuncoesData(db);
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
    // O SSMS le essas duas propriedades com GetString() na aba Filegroups do
    // New Database. Sem elas o DefaultLog chega como DBNull e o SMO estoura
    // "Data is Null. This method or property cannot be called on Null values".
    INSTANCEDEFAULTDATAPATH: DIRETORIO_DADOS_PADRAO,
    INSTANCEDEFAULTLOGPATH: DIRETORIO_DADOS_PADRAO,
    PATHSEPARATOR: '\\',
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
  // O Table Designer recusa abrir em modo de edicao quando is_member('db_owner')
  // e 0. O usuario do simulador e o equivalente a dbo/sysadmin.
  db.function('IS_MEMBER', { varargs: true }, (role) =>
    ['db_owner', 'db_ddladmin'].includes(String(role || '').toLowerCase()) ? 1 : 0
  );
  // PERMISSIONS() e usada pelo Table Designer para decidir se a tabela pode
  // ser alterada. O usuario do simulador tem permissao total.
  db.function('PERMISSIONS', { varargs: true }, () => 2147483647);
  // HAS_PERMS_BY_NAME tambem e consultada pelo Table Designer (por exemplo
  // VIEW DATABASE STATE). O usuario do simulador tem permissao total.
  db.function('HAS_PERMS_BY_NAME', { varargs: true }, () => 1);

  // SCHEMA_NAME() sem argumentos devolve o schema padrao da sessao (dbo).
  db.function('SCHEMA_NAME', { varargs: true }, (...argumentos) => {
    const id = argumentos[0];
    if (id == null) return 'dbo';
    const identificador = Number(id);
    if (identificador === 4) return 'sys';
    return identificador === 1 ? 'dbo' : null;
  });
  // USER_NAME e usado pelo SSMS para resolver o principal de execucao das
  // procedures. Sem argumento, o SQL Server devolve o usuario atual (dbo).
  db.function('USER_NAME', { varargs: true }, (id) => {
    if (id == null) return 'dbo';
    return Number(id) === 1 || String(id).toLowerCase() === 'dbo' ? 'dbo' : null;
  });

  // Prepara a consulta uma unica vez: chamar db.prepare() de dentro de uma UDF
  // enquanto outra instrucao esta em execucao faz o better-sqlite3 lanocar
  // "This database connection is busy executing a query".
  let existeObjeto = null;
  try {
    existeObjeto = db.prepare('SELECT 1 AS existe FROM main.objects WHERE object_id = ?');
  } catch {
    existeObjeto = null;
  }
  const objectProperty = (id, propriedade) => {
    const nome = String(propriedade || '').toLowerCase();
    if (nome === 'ownerid') return 1;
    if (nome === 'isindexed' || nome === 'isindexable') return 1;
    if (nome.startsWith('is')) return 0;
    if (!existeObjeto) return 0;
    try {
      return existeObjeto.get(Number(id)) ? 1 : 0;
    } catch {
      return 0;
    }
  };
  db.function('OBJECTPROPERTY', { varargs: true }, objectProperty);
  db.function('OBJECTPROPERTYEX', { varargs: true }, objectProperty);
  // O SMO le INDEXPROPERTY ao gerar o CREATE de uma tabela. As propriedades
  // consultadas sao bitwise e nao alteram o script quando devolvem 0/1.
  db.function('INDEXPROPERTY', { varargs: true }, (_id, _indice, propriedade) => {
    const nome = String(propriedade || '').toLowerCase();
    if (nome === 'ispadindex' || nome === 'isoptimizedforsequentialkey') return 0;
    return 0;
  });
  db.function('COLUMNPROPERTY', { varargs: true }, (_id, _coluna, propriedade) => {
    const nome = String(propriedade || '').toLowerCase();
    if (nome === 'isdeterministic' || nome === 'isprecise') return 1;
    return 0;
  });
  // COL_NAME e usada pelo designer ao ler colunas de indice full-text. Como o
  // simulador nao registra esse tipo de indice, a funcao so precisa devolver o
  // nome quando a coluna existe no catalogo (mesmo cache de OBJECT_ID/NAME).
  db.function('COL_NAME', { varargs: true }, (id, coluna) => {
    if (id == null || coluna == null) return null;
    const cache = db.__colunasPorId;
    if (!cache) return null;
    return cache.get(`${Number(id)}:${Number(coluna)}`) || null;
  });
  // DATALENGTH e usada pelo designer de views para medir o texto do modulo.
  // syscomments.text e NVARCHAR, entao o SQL Server devolve 2 bytes por
  // caractere; devolver o tamanho UTF-8 faz o VDT calcular o buffer errado.
  db.function('DATALENGTH', { varargs: true }, (valor) => {
    if (valor == null) return 0;
    return Buffer.isBuffer(valor)
      ? valor.length
      : Buffer.byteLength(String(valor), 'utf16le');
  });

  // O SMO usa SQL_VARIANT_PROPERTY para decidir como formatar os valores das
  // configuracoes escopo de database (int). O VDT usa a mesma funcao nas
  // extended_properties: MS_DiagramPaneCount e int, MS_DiagramPane1 e nvarchar.
  // Devolver 'int' para texto faz o designer descartar o pane e abrir em branco.
  db.function('SQL_VARIANT_PROPERTY', { varargs: true }, (valor, propriedade) => {
    const prop = String(propriedade || '').toLowerCase();
    const texto = valor == null ? '' : String(valor);
    const numerico = /^-?\d+(?:\.\d+)?$/.test(texto);
    if (prop === 'basetype') return numerico ? 'int' : 'nvarchar';
    if (prop === 'maxlength') return numerico ? 4 : texto.length * 2;
    if (prop === 'precision') return numerico ? 10 : 0;
    if (prop === 'scale') return 0;
    return null;
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

  // DATABASEPROPERTYEX e usado pelo SMO durante a criacao de database para
  // determinar Updateability e a data do ultimo DBCC CHECKDB.
  const databasePropertyEx = (_nome, propriedade) => {
    const chave = String(propriedade || '').toLowerCase();
    if (chave === 'updateability') return 'READ_WRITE';
    if (chave === 'status') return 'ONLINE';
    if (chave === 'recovery') return 'FULL';
    if (chave === 'useraccess') return 'MULTI_USER';
    if (chave === 'collation') return 'SQL_Latin1_General_CP1_CI_AS';
    if (chave === 'lastgoodcheckdbtime') return '2023-01-01 00:00:00';
    if (chave === 'isfulltextenabled') return 0;
    return null;
  };
  db.function('DATABASEPROPERTYEX', { varargs: true }, databasePropertyEx);
  db.function('DATABASEPROPERTY', { varargs: true }, databasePropertyEx);

  // FILEPROPERTY e usado pelo SMO na aba Filegroups para calcular UsedSpace.
  db.function('FILEPROPERTY', { varargs: true }, (_nome, propriedade) => {
    return String(propriedade || '').toLowerCase() === 'spaceused' ? 1024 : null;
  });

  // COLLATIONPROPERTY e usado pelo SMO para preencher LCID/CodePage/ComparisonStyle.
  db.function('COLLATIONPROPERTY', { varargs: true }, (_colacao, propriedade) => {
    const chave = String(propriedade || '').toUpperCase();
    if (chave === 'LCID') return 1033;
    if (chave === 'CODEPAGE') return 1252;
    if (chave === 'COMPARISONSTYLE') return 196609;
    if (chave === 'VERSION') return 0;
    return null;
  });

  // O SMO chama essa funcao qualificada (msdb.dbo...) para saber se o
  // gerenciamento baseado em politicas esta habilitado.
  db.function('fn_syspolicy_is_automation_enabled', () => 1);

  // OBJECT_ID devolve null para objetos inexistentes (ex.: sysdac_instances,
  // usado pelo SMO para detectar DAC) e o object_id do catalogo para os objetos
  // reais do database atual. Le do cache montado na sincronizacao porque o
  // better-sqlite3 bloqueia consultas dentro da UDF.
  db.function('OBJECT_ID', { varargs: true }, (nome) => {
    if (nome == null) return null;
    // O VDT usa OBJECT_ID(N'[dbo].[VW001]'), com o schema entre colchetes.
    // Remover "dbo." antes dos colchetes deixava "dbo.VW001" como chave e a
    // funcao devolvia NULL: sem extended properties o designer abria em branco.
    // O Designer de Views qualifica os objetos como
    // OBJECT_ID(N'Ultrapoints2.dbo.TB001'). Sem remover o database o cache nao
    // encontra a coluna e a tabela aparece como <unknown> no CriteriaPane.
    const semColchetes = String(nome).replace(/\[([^\]]+)\]/g, '$1');
    const partes = semColchetes.split('.');
    const alvo = (partes.length >= 3
      ? partes[partes.length - 1]
      : semColchetes.replace(/^dbo\./i, '')).toLowerCase();
    if (ehMsdb && OBJETOS_MSDB.has(alvo)) return 1001;
    const cache = db.__objetosPorNome;
    return cache && cache.has(alvo) ? cache.get(alvo) : null;
  });

  // OBJECT_NAME e usado pelo SMO para montar o nome de procedures numeradas
  // ao gerar o script de "Modificar". Mesmo cache de OBJECT_ID (sentido inverso).
  db.function('OBJECT_NAME', { varargs: true }, (id) => {
    if (id == null) return null;
    const cache = db.__objetosPorId;
    return cache && cache.has(Number(id)) ? cache.get(Number(id)) : null;
  });

  const databaseIdPorNome = (nome) => {
    try {
      const linha = db.prepare('SELECT database_id FROM sys.databases WHERE lower(name) = lower(?)').get(String(nome));
      if (linha && linha.database_id != null) return Number(linha.database_id);
    } catch (err) {
      if (err && /busy/i.test(err.message || '')) {
        try {
          const Database = require('better-sqlite3');
          const masterDbPath = path.join(dataDir, `${MASTER}.db`);
          const tmp = new Database(masterDbPath, { readonly: true, fileMustExist: true });
          try {
            const linha = tmp.prepare('SELECT database_id FROM databases WHERE lower(name) = lower(?)').get(String(nome));
            if (linha && linha.database_id != null) return Number(linha.database_id);
          } finally {
            tmp.close();
          }
        } catch (_) { /* fallback abaixo */ }
      }
    }
    const indice = databases().findIndex((item) => item.toLowerCase() === String(nome).toLowerCase());
    return indice < 0 ? null : indice + 1;
  };
  const databaseNomePorId = (id) => {
    try {
      const linha = db.prepare('SELECT name FROM sys.databases WHERE database_id = ?').get(Number(id));
      if (linha && linha.name != null) return String(linha.name);
    } catch (err) {
      if (err && /busy/i.test(err.message || '')) {
        try {
          const Database = require('better-sqlite3');
          const masterDbPath = path.join(dataDir, `${MASTER}.db`);
          const tmp = new Database(masterDbPath, { readonly: true, fileMustExist: true });
          try {
            const linha = tmp.prepare('SELECT name FROM databases WHERE database_id = ?').get(Number(id));
            if (linha && linha.name != null) return String(linha.name);
          } finally {
            tmp.close();
          }
        } catch (_) { /* fallback abaixo */ }
      }
    }
    return databases()[Number(id) - 1] || null;
  };

  db.function('DB_ID', { varargs: true }, (nome) => {
    const alvo = nome == null ? dbName : nome;
    const id = databaseIdPorNome(alvo);
    if (id != null) return id;
    return nome == null ? 1 : null;
  });
  db.function('DB_NAME', { varargs: true }, (id) => {
    // Sem argumento, DB_NAME() devolve o database da conexao atual. O URN que
    // o SSMS monta para Stored Procedures usa essa funcao; devolver master
    // fazia a procedure ficar fora do no Ultrapoints2 no Object Explorer.
    if (id == null) return dbName || MASTER;
    return databaseNomePorId(id);
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
  migrarColunas(db, 'sys', 'internal_tables', [
    ['parent_minor_id', 'INTEGER NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'sys', 'database_filestream_options', [
    ['non_transacted_access', 'TINYINT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'sys', 'database_query_store_options', [
    ['actual_state', 'TINYINT NOT NULL DEFAULT 0'],
    ['desired_state', 'TINYINT NOT NULL DEFAULT 0'],
    ['readonly_reason', 'INTEGER NOT NULL DEFAULT 0'],
    ['current_storage_size_mb', 'BIGINT NOT NULL DEFAULT 0'],
    ['max_storage_size_mb', 'BIGINT NOT NULL DEFAULT 0'],
    ['stale_query_threshold_days', 'INTEGER NOT NULL DEFAULT 30'],
    ['flush_interval_seconds', 'INTEGER NOT NULL DEFAULT 900'],
    ['interval_length_minutes', 'INTEGER NOT NULL DEFAULT 60'],
    ['query_capture_mode', 'TINYINT NOT NULL DEFAULT 1'],
    ['size_based_cleanup_mode', 'TINYINT NOT NULL DEFAULT 1'],
    ['max_plans_per_query', 'INTEGER NOT NULL DEFAULT 200'],
    ['wait_stats_capture_mode', 'TINYINT NOT NULL DEFAULT 1'],
    ['capture_policy_execution_count', 'INTEGER NOT NULL DEFAULT 30'],
    ['capture_policy_total_compile_cpu_time_ms', 'BIGINT NOT NULL DEFAULT 1000'],
    ['capture_policy_total_execution_cpu_time_ms', 'BIGINT NOT NULL DEFAULT 100'],
    ['capture_policy_stale_threshold_hours', 'INTEGER NOT NULL DEFAULT 1']
  ]);
  migrarColunas(db, 'sys', 'database_scoped_configurations', [
    ['configuration_id', 'INT NOT NULL DEFAULT 0'],
    ['is_value_default', 'BIT NOT NULL DEFAULT 1']
  ]);
  migrarColunas(db, 'sys', 'databases', [
    ['catalog_collation_type', 'TINYINT NOT NULL DEFAULT 2'],
    ['catalog_collation_type_desc', "TEXT NOT NULL DEFAULT 'SQL_COLLATION'"],
    ['containment', 'TINYINT NOT NULL DEFAULT 0'],
    ['source_database_id', 'INT'],
    ['is_fulltext_enabled', 'BIT NOT NULL DEFAULT 0'],
    ['user_access', 'TINYINT NOT NULL DEFAULT 0'],
    ['is_ledger_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_remote_data_archive_enabled', 'BIT NOT NULL DEFAULT 0'],
    ['default_language_lcid', 'INT NOT NULL DEFAULT 1033'],
    ['default_language_name', "TEXT NOT NULL DEFAULT 'us_english'"],
    ['default_fulltext_language_lcid', 'INT NOT NULL DEFAULT 1033'],
    ['default_fulltext_language_name', "TEXT NOT NULL DEFAULT 'us_english'"],
    ['is_ansi_null_default_on', 'BIT NOT NULL DEFAULT 1'],
    ['is_ansi_nulls_on', 'BIT NOT NULL DEFAULT 1'],
    ['is_ansi_padding_on', 'BIT NOT NULL DEFAULT 1'],
    ['is_ansi_warnings_on', 'BIT NOT NULL DEFAULT 1'],
    ['is_arithabort_on', 'BIT NOT NULL DEFAULT 1'],
    ['is_concat_null_yields_null_on', 'BIT NOT NULL DEFAULT 1'],
    ['is_cursor_close_on_commit_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_numeric_roundabort_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_quoted_identifier_on', 'BIT NOT NULL DEFAULT 1'],
    ['is_recursive_triggers_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_nested_triggers_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_db_chaining_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_auto_update_stats_async_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_auto_create_stats_incremental_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_date_correlation_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_trustworthy_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_parameterization_forced', 'BIT NOT NULL DEFAULT 0'],
    ['is_read_committed_snapshot_on', 'BIT NOT NULL DEFAULT 0'],
    ['snapshot_isolation_state', 'TINYINT NOT NULL DEFAULT 0'],
    ['is_published', 'BIT NOT NULL DEFAULT 0'],
    ['is_subscribed', 'BIT NOT NULL DEFAULT 0'],
    ['is_merge_published', 'BIT NOT NULL DEFAULT 0'],
    ['is_local_cursor_default', 'BIT NOT NULL DEFAULT 0'],
    ['page_verify_option', 'TINYINT NOT NULL DEFAULT 2'],
    ['is_broker_enabled', 'BIT NOT NULL DEFAULT 0'],
    ['is_honor_broker_priority_on', 'BIT NOT NULL DEFAULT 0'],
    ['is_encrypted', 'BIT NOT NULL DEFAULT 0'],
    ['is_auto_create_stats_on', 'BIT NOT NULL DEFAULT 1'],
    ['is_auto_update_stats_on', 'BIT NOT NULL DEFAULT 1'],
    ['is_transform_noise_words_on', 'BIT NOT NULL DEFAULT 1'],
    ['two_digit_year_cutoff', 'INT NOT NULL DEFAULT 2049'],
    ['delayed_durability', 'TINYINT NOT NULL DEFAULT 0'],
    ['is_accelerated_database_recovery_on', 'BIT NOT NULL DEFAULT 0'],
    ['target_recovery_time_in_seconds', 'INT NOT NULL DEFAULT 60'],
    ['log_reuse_wait', 'TINYINT NOT NULL DEFAULT 0']
  ]);
  migrarColunas(db, 'sys', 'syslanguages', [
    ['lcid', 'INT NOT NULL DEFAULT 1033']
  ]);
  migrarLcidParaInt(db, 'sys');
  migrarConfiguracoes(db, 'sys');
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
  registrarFuncoes(db, { dataDir, dbName, engine, listarDatabases, usuario });
  sincronizarCatalogoDatabase(db, dbName);
}

/** @private */
function erroTsqlProcedimento(numero, state, mensagem) {
  const erro = new Error(mensagem);
  erro.number = numero;
  erro.state = state;
  erro.class = 16;
  return erro;
}

/** Remove a qualificação `dbo.` e os colchetes do nome da rotina. @private */
function nomeSimplesProcedimento(nome) {
  return String(nome || '')
    .split('.')
    .pop()
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^"|"$/g, '');
}

/** Proximo object_id positivo livre (objetos de sistema usam ids negativos). @private */
function proximoObjectIdUsuario(db) {
  const linha = db.prepare(`
    SELECT COALESCE(MAX(CASE WHEN object_id > 0 THEN object_id ELSE 0 END), 0) + 1 AS id
    FROM main.objects
  `).get();
  return Math.max(Number(linha && linha.id) || 1, 100);
}

/** Reinstala no catalogo as procedures preservadas antes da reconstrucao. @private */
function restaurarProcedimentos(db, rotinas, parametros) {
  if (!rotinas.length) return;
  const inserirObjeto = db.prepare(`
    INSERT INTO main.objects
      (name, object_id, schema_id, principal_id, type, type_desc, create_date, is_ms_shipped)
    VALUES (?, ?, ?, ?, 'P', 'SQL_STORED_PROCEDURE', ?, ?)
  `);
  const inserirModulo = db.prepare(`
    INSERT INTO main.sql_modules (object_id, definition, corpo) VALUES (?, ?, ?)
  `);
  const inserirParametro = db.prepare(`
    INSERT INTO main.all_parameters
      (object_id, parameter_id, name, user_type_id, is_output, has_default_value, default_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rotina of rotinas) {
    const objectId = rotina.object_id > 0 ? rotina.object_id : proximoObjectIdUsuario(db);
    db.prepare('UPDATE main.procedures SET object_id = ? WHERE object_id = ?')
      .run(objectId, rotina.object_id);
    db.prepare('DELETE FROM main.objects WHERE object_id = ?').run(objectId);
    db.prepare('DELETE FROM main.sql_modules WHERE object_id = ?').run(objectId);
    db.prepare('DELETE FROM main.all_parameters WHERE object_id = ?').run(objectId);
    inserirObjeto.run(
      rotina.name, objectId, rotina.schema_id || 1, rotina.principal_id || 1,
      rotina.create_date || dataHoraAtualSql(), rotina.is_ms_shipped || 0
    );
    const parametrosDaRotina = parametros.filter((parametro) =>
      parametro.object_id === rotina.object_id && Number(parametro.parameter_id) > 0
    );
    const corpoRotina = normalizarQuebrasCrLf(rotina.corpo == null
      ? extrairCorpoFuncao(rotina.definition)
      : rotina.corpo);
    const definicaoRotina = normalizarQuebrasCrLf(
      temCabecalhoProcedimento(rotina.definition)
        ? rotina.definition
        : montarDefinicaoProcedimento(db, {
            nome: rotina.name,
            parametros: parametrosDaRotina,
            corpo: corpoRotina
          })
    );
    inserirModulo.run(objectId, definicaoRotina || '', corpoRotina);
    parametros
      .filter((parametro) => parametro.object_id === rotina.object_id)
      .forEach((parametro) => inserirParametro.run(
        objectId,
        parametro.parameter_id,
        parametro.name,
        parametro.user_type_id,
        parametro.is_output,
        parametro.has_default_value,
        parametro.default_value
      ));
  }
}

/** Reinstala no catalogo as funcoes escalares preservadas na reconstrucao. @private */
function restaurarFuncoes(db, funcoes, parametros) {
  if (!funcoes.length) return;
  const inserirObjeto = db.prepare(`
    INSERT INTO main.objects
      (name, object_id, schema_id, principal_id, type, type_desc, create_date, is_ms_shipped)
    VALUES (?, ?, ?, ?, 'FN', 'SQL_SCALAR_FUNCTION', ?, ?)
  `);
  const inserirModulo = db.prepare(`
    INSERT INTO main.sql_modules (object_id, definition, returns_type, corpo)
    VALUES (?, ?, ?, ?)
  `);
  const inserirParametro = db.prepare(`
    INSERT INTO main.all_parameters
      (object_id, parameter_id, name, user_type_id, is_output, has_default_value, default_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const funcao of funcoes) {
    const objectId = funcao.object_id > 0 ? funcao.object_id : proximoObjectIdUsuario(db);
    db.prepare('DELETE FROM main.objects WHERE object_id = ?').run(objectId);
    db.prepare('DELETE FROM main.sql_modules WHERE object_id = ?').run(objectId);
    db.prepare('DELETE FROM main.all_parameters WHERE object_id = ?').run(objectId);
    inserirObjeto.run(
      funcao.name, objectId, funcao.schema_id || 1, funcao.principal_id || 1,
      funcao.create_date || dataHoraAtualSql(), funcao.is_ms_shipped || 0
    );
    const parametrosDaFuncao = parametros.filter((parametro) =>
      parametro.object_id === funcao.object_id && Number(parametro.parameter_id) > 0
    );
    const corpoFuncao = normalizarQuebrasCrLf(funcao.corpo == null
      ? extrairCorpoFuncao(funcao.definition)
      : funcao.corpo);
    const definicaoFuncao = normalizarQuebrasCrLf(
      temCabecalhoFuncao(funcao.definition)
        ? funcao.definition
        : montarDefinicaoFuncao(db, {
            nome: funcao.name,
            parametros: parametrosDaFuncao,
            tipoRetorno: funcao.returns_type,
            corpo: corpoFuncao
          })
    );
    inserirModulo.run(
      objectId,
      definicaoFuncao || '',
      funcao.returns_type || 'int',
      corpoFuncao
    );
    parametros
      .filter((parametro) => parametro.object_id === funcao.object_id)
      .forEach((parametro) => inserirParametro.run(
        objectId,
        parametro.parameter_id,
        parametro.name,
        parametro.user_type_id,
        parametro.is_output,
        parametro.has_default_value,
        parametro.default_value
      ));
    // Databases criados antes do suporte a scripting nao guardavam o
    // parametro de retorno (parameter_id = 0) exigido pelo SMO.
    if (!parametros.some((parametro) =>
      parametro.object_id === funcao.object_id && Number(parametro.parameter_id) === 0
    )) {
      const nomeTipo = String(funcao.returns_type || 'int').split('(')[0].trim();
      const tipo = db.prepare(`
        SELECT user_type_id, system_type_id, max_length, precision, scale
        FROM main.types WHERE name = ? COLLATE NOCASE
      `).get(nomeTipo);
      db.prepare(`
        INSERT INTO main.all_parameters
          (object_id, parameter_id, name, user_type_id, system_type_id,
           max_length, precision, scale, is_output)
        VALUES (?, 0, NULL, ?, ?, ?, ?, ?, 1)
      `).run(
        objectId,
        tipo ? tipo.user_type_id : 56,
        tipo ? tipo.system_type_id : 56,
        tipo && tipo.max_length != null ? tipo.max_length : -1,
        tipo ? tipo.precision : 0,
        tipo ? tipo.scale : 0
      );
    }
  }
}

function dataHoraAtualSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Uniformiza as quebras de linha em CRLF. O SSMS abre um dialogo de "Line
 * Ending" quando o texto gerado pelo SMO mistura LF e CRLF.
 * @private
 */
function normalizarQuebrasCrLf(texto) {
  if (typeof texto !== 'string') return texto;
  return texto.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
}

/** Verifica se o definition da procedure ja tem o cabecalho exigido pelo SMO. @private */
function temCabecalhoProcedimento(definicao) {
  return /\b(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\b/i.test(String(definicao || ''));
}

/** Monta um CREATE PROCEDURE completo para databases com definition so do corpo. @private */
function montarDefinicaoProcedimento(db, { nome, parametros = [], corpo = '' }) {
  const nomesTipos = new Map(
    db.prepare('SELECT user_type_id, name FROM main.types').all()
      .map((tipo) => [tipo.user_type_id, tipo.name])
  );
  const argumentos = parametros
    .filter((parametro) => Number(parametro.parameter_id) > 0)
    .map((parametro) => {
      const nomeTipo = parametro.tipo || nomesTipos.get(parametro.user_type_id) || 'int';
      const saida = parametro.is_output ? ' OUTPUT' : '';
      return `${parametro.name || `@p${parametro.parameter_id}`} ${nomeTipo}${saida}`;
    })
    .join(', ');
  const textoCorpo = String(corpo || '').trim();
  const corpoSql = /^BEGIN\b/i.test(textoCorpo) ? textoCorpo : `BEGIN\n${textoCorpo}\nEND`;
  return `CREATE PROCEDURE [dbo].[${nomeSimplesProcedimento(nome)}] ${argumentos}\nAS\n${corpoSql}`;
}

/**
 * Registra uma stored procedure no catalogo do database, tornando-a visivel
 * em sys.procedures/sys.objects e guardando o corpo em sys.sql_modules.
 */
function criarProcedimento(db, { nome, definicao, corpo, parametros = [], alterar = false }) {
  db.exec(DDL_DATABASE);
  const nomeProc = nomeSimplesProcedimento(nome);
  if (!nomeProc) throw erroTsqlProcedimento(102, 1, 'Incorrect syntax near PROCEDURE.');

  const existente = db.prepare(
    'SELECT object_id FROM main.procedures WHERE name = ? COLLATE NOCASE'
  ).get(nomeProc);
  if (alterar && !existente) {
    throw erroTsqlProcedimento(2812, 62, `Could not find stored procedure '${nomeProc}'.`);
  }
  if (!alterar && existente) {
    throw erroTsqlProcedimento(2714, 1, `There is already an object named '${nomeProc}' in the database.`);
  }

  const data = dataHoraAtualSql();
  const objectId = existente ? existente.object_id : proximoObjectIdUsuario(db);

  db.prepare('DELETE FROM main.all_parameters WHERE object_id = ?').run(objectId);
  db.prepare('DELETE FROM main.sql_modules WHERE object_id = ?').run(objectId);
  db.prepare('DELETE FROM main.procedures WHERE object_id = ?').run(objectId);
  db.prepare('DELETE FROM main.objects WHERE object_id = ?').run(objectId);

  db.prepare(`
    INSERT INTO main.objects
      (name, object_id, schema_id, principal_id, type, type_desc, create_date)
    VALUES (?, ?, 1, 1, 'P', 'SQL_STORED_PROCEDURE', ?)
  `).run(nomeProc, objectId, data);
  db.prepare(`
    INSERT INTO main.procedures
      (name, object_id, schema_id, principal_id, create_date, modify_date)
    VALUES (?, ?, 1, 1, ?, ?)
  `).run(nomeProc, objectId, data, data);
  const corpoProc = normalizarQuebrasCrLf(corpo == null ? extrairCorpoFuncao(definicao) : corpo);
  const definicaoProc = normalizarQuebrasCrLf(
    temCabecalhoProcedimento(definicao)
      ? String(definicao)
      : montarDefinicaoProcedimento(db, { nome: nomeProc, parametros, corpo: corpoProc })
  );
  db.prepare(`
    INSERT INTO main.sql_modules (object_id, definition, corpo) VALUES (?, ?, ?)
  `).run(objectId, definicaoProc, corpoProc);

  const inserirParametro = db.prepare(`
    INSERT INTO main.all_parameters
      (object_id, parameter_id, name, user_type_id, is_output, has_default_value, default_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  parametros.forEach((parametro, indice) => {
    const nomeTipo = String(parametro.tipo || 'int').split('(')[0].trim();
    const tipo = db.prepare(
      'SELECT user_type_id FROM main.types WHERE name = ? COLLATE NOCASE'
    ).get(nomeTipo);
    inserirParametro.run(
      objectId,
      indice + 1,
      parametro.nome,
      tipo ? tipo.user_type_id : 56,
      parametro.isOutput ? 1 : 0,
      parametro.valorPadrao == null ? 0 : 1,
      parametro.valorPadrao == null ? null : String(parametro.valorPadrao)
    );
  });

  return { nome: nomeProc, objectId };
}

/** Devolve o corpo e os parametros de uma procedure registrada. */
function obterProcedimento(db, nome) {
  db.exec(DDL_DATABASE);
  const linha = db.prepare(`
    SELECT p.object_id, p.name, m.definition, m.corpo
    FROM main.procedures AS p
    LEFT JOIN main.sql_modules AS m ON m.object_id = p.object_id
    WHERE p.name = ? COLLATE NOCASE
  `).get(nomeSimplesProcedimento(nome));
  if (!linha) return null;

  const nomesTipos = new Map(
    db.prepare('SELECT user_type_id, name FROM main.types').all()
      .map((tipo) => [tipo.user_type_id, tipo.name])
  );
  const parametros = db.prepare(`
    SELECT name, user_type_id, is_output, has_default_value, default_value
    FROM main.all_parameters WHERE object_id = ? ORDER BY parameter_id
  `).all(linha.object_id).map((parametro) => ({
    nome: parametro.name,
    tipo: nomesTipos.get(parametro.user_type_id) || 'int',
    isOutput: Boolean(parametro.is_output),
    valorPadrao: parametro.has_default_value ? parametro.default_value : null
  }));

  return {
    nome: linha.name,
    definicao: linha.definition || '',
    corpo: linha.corpo == null ? extrairCorpoFuncao(linha.definition) : linha.corpo,
    parametros
  };
}

/** Remove uma procedure do catalogo. */
function removerProcedimento(db, nome, seExistir = false) {
  db.exec(DDL_DATABASE);
  const nomeProc = nomeSimplesProcedimento(nome);
  const linha = db.prepare(
    'SELECT object_id FROM main.procedures WHERE name = ? COLLATE NOCASE'
  ).get(nomeProc);
  if (!linha) {
    if (seExistir) return false;
    throw erroTsqlProcedimento(2812, 62, `Could not find stored procedure '${nomeProc}'.`);
  }

  db.prepare('DELETE FROM main.all_parameters WHERE object_id = ?').run(linha.object_id);
  db.prepare('DELETE FROM main.sql_modules WHERE object_id = ?').run(linha.object_id);
  db.prepare('DELETE FROM main.procedures WHERE object_id = ?').run(linha.object_id);
  db.prepare('DELETE FROM main.objects WHERE object_id = ?').run(linha.object_id);
  return true;
}

/** Verifica se o definition gravado ja possui o cabecalho exigido pelo SMO. @private */
function temCabecalhoFuncao(definicao) {
  return /\b(?:CREATE|ALTER)\s+FUNCTION\b/i.test(String(definicao || ''));
}

/** Extrai somente o corpo executavel de um CREATE FUNCTION gravado no catalogo. @private */
function extrairCorpoFuncao(definicao) {
  const texto = String(definicao || '');
  if (!temCabecalhoFuncao(texto)) return texto;
  const parte = /\bAS\s+([\s\S]+)$/i.exec(texto);
  return parte ? parte[1].trim() : texto;
}

/**
 * Monta um CREATE FUNCTION completo para databases antigos que guardavam apenas
 * o corpo em sys.sql_modules.definition. O SMO exige o cabecalho para gerar o
 * script de "Modificar".
 * @private
 */
function montarDefinicaoFuncao(db, { nome, parametros = [], tipoRetorno = 'int', corpo = '' }) {
  const nomesTipos = new Map(
    db.prepare('SELECT user_type_id, name FROM main.types').all()
      .map((tipo) => [tipo.user_type_id, tipo.name])
  );
  const argumentos = parametros
    .filter((parametro) => Number(parametro.parameter_id) > 0)
    .map((parametro) => {
      const nomeTipo = parametro.tipo || nomesTipos.get(parametro.user_type_id) || 'int';
      return `${parametro.name || `@p${parametro.parameter_id}`} ${nomeTipo}`;
    })
    .join(', ');
  const textoCorpo = String(corpo || '').trim();
  const corpoSql = /^BEGIN\b/i.test(textoCorpo) ? textoCorpo : `BEGIN\n${textoCorpo}\nEND`;
  return `CREATE FUNCTION [dbo].[${nomeSimplesProcedimento(nome)}] (${argumentos})\n` +
    `RETURNS ${tipoRetorno || 'int'}\nAS\n${corpoSql}`;
}

/**
 * Registra uma funcao escalar do usuario em sys.objects/sys.sql_modules. O
 * corpo tambem e registrado como funcao SQLite pelo DbEngine.
 */
function criarFuncao(db, { nome, definicao, corpo, parametros = [], tipoRetorno = 'int', alterar = false }) {
  db.exec(DDL_DATABASE);
  const nomeFuncao = nomeSimplesProcedimento(nome);
  if (!nomeFuncao) throw erroTsqlProcedimento(102, 1, 'Incorrect syntax near FUNCTION.');

  const existente = db.prepare(`
    SELECT object_id FROM main.objects
    WHERE name = ? COLLATE NOCASE AND type = 'FN'
  `).get(nomeFuncao);
  if (alterar && !existente) {
    throw erroTsqlProcedimento(2812, 62, `Could not find function '${nomeFuncao}'.`);
  }
  if (!alterar && existente) {
    throw erroTsqlProcedimento(2714, 1, `There is already an object named '${nomeFuncao}' in the database.`);
  }

  const data = dataHoraAtualSql();
  const objectId = existente ? existente.object_id : proximoObjectIdUsuario(db);

  db.prepare('DELETE FROM main.all_parameters WHERE object_id = ?').run(objectId);
  db.prepare('DELETE FROM main.sql_modules WHERE object_id = ?').run(objectId);
  db.prepare('DELETE FROM main.objects WHERE object_id = ?').run(objectId);
  db.prepare(`
    INSERT INTO main.objects
      (name, object_id, schema_id, principal_id, type, type_desc, create_date)
    VALUES (?, ?, 1, 1, 'FN', 'SQL_SCALAR_FUNCTION', ?)
  `).run(nomeFuncao, objectId, data);
  const corpoFuncao = normalizarQuebrasCrLf(corpo == null ? extrairCorpoFuncao(definicao) : corpo);
  const definicaoFuncao = normalizarQuebrasCrLf(
    temCabecalhoFuncao(definicao)
      ? String(definicao)
      : montarDefinicaoFuncao(db, { nome: nomeFuncao, parametros, tipoRetorno, corpo: corpoFuncao })
  );
  db.prepare(`
    INSERT INTO main.sql_modules (object_id, definition, returns_type, corpo)
    VALUES (?, ?, ?, ?)
  `).run(objectId, definicaoFuncao, String(tipoRetorno || 'int'), corpoFuncao);

  const inserirParametro = db.prepare(`
    INSERT INTO main.all_parameters
      (object_id, parameter_id, name, user_type_id, is_output, has_default_value, default_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  parametros.forEach((parametro, indice) => {
    const nomeTipo = String(parametro.tipo || 'int').split('(')[0].trim();
    const tipo = db.prepare(
      'SELECT user_type_id FROM main.types WHERE name = ? COLLATE NOCASE'
    ).get(nomeTipo);
    inserirParametro.run(
      objectId,
      indice + 1,
      parametro.nome,
      tipo ? tipo.user_type_id : 56,
      0,
      parametro.valorPadrao == null ? 0 : 1,
      parametro.valorPadrao == null ? null : String(parametro.valorPadrao)
    );
  });

  // O SMO localiza o tipo de retorno de uma funcao escalar pelo parametro
  // com is_output = 1 (parameter_id = 0 em sys.parameters).
  const nomeTipoRetorno = String(tipoRetorno || 'int').split('(')[0].trim();
  const tipoRetornoLinha = db.prepare(
    'SELECT user_type_id, system_type_id, max_length, precision, scale FROM main.types WHERE name = ? COLLATE NOCASE'
  ).get(nomeTipoRetorno);
  db.prepare(`
    INSERT INTO main.all_parameters
      (object_id, parameter_id, name, user_type_id, system_type_id,
       max_length, precision, scale, is_output)
    VALUES (?, 0, NULL, ?, ?, ?, ?, ?, 1)
  `).run(
    objectId,
    tipoRetornoLinha ? tipoRetornoLinha.user_type_id : 56,
    tipoRetornoLinha ? tipoRetornoLinha.system_type_id : 56,
    tipoRetornoLinha && tipoRetornoLinha.max_length != null ? tipoRetornoLinha.max_length : -1,
    tipoRetornoLinha ? tipoRetornoLinha.precision : 0,
    tipoRetornoLinha ? tipoRetornoLinha.scale : 0
  );

  return { nome: nomeFuncao, objectId };
}

/** Devolve o corpo e os parametros de uma funcao escalar registrada. */
function obterFuncao(db, nome) {
  db.exec(DDL_DATABASE);
  const linha = db.prepare(`
    SELECT o.object_id, o.name, m.definition, m.corpo, m.returns_type
    FROM main.objects AS o
    LEFT JOIN main.sql_modules AS m ON m.object_id = o.object_id
    WHERE o.type = 'FN' AND o.name = ? COLLATE NOCASE
  `).get(nomeSimplesProcedimento(nome));
  if (!linha) return null;

  const nomesTipos = new Map(
    db.prepare('SELECT user_type_id, name FROM main.types').all()
      .map((tipo) => [tipo.user_type_id, tipo.name])
  );
  const parametros = db.prepare(`
    SELECT name, user_type_id, has_default_value, default_value
    FROM main.all_parameters
    WHERE object_id = ? AND parameter_id > 0
    ORDER BY parameter_id
  `).all(linha.object_id).map((parametro) => ({
    nome: parametro.name,
    tipo: nomesTipos.get(parametro.user_type_id) || 'int',
    valorPadrao: parametro.has_default_value ? parametro.default_value : null
  }));

  return {
    nome: linha.name,
    definicao: linha.definition || '',
    corpo: linha.corpo == null ? extrairCorpoFuncao(linha.definition) : linha.corpo,
    tipoRetorno: linha.returns_type || 'int',
    parametros
  };
}

/** Lista as funcoes escalares registradas no database (para restaurar as UDFs ao abrir). */
function listarFuncoes(db) {
  return db.prepare(`
    SELECT o.name FROM main.objects AS o
    WHERE o.type = 'FN' ORDER BY o.object_id
  `).all().map((linha) => linha.name);
}

/** Remove uma funcao escalar do catalogo. */
function removerFuncao(db, nome, seExistir = false) {
  db.exec(DDL_DATABASE);
  const linha = db.prepare(`
    SELECT object_id FROM main.objects
    WHERE type = 'FN' AND name = ? COLLATE NOCASE
  `).get(nomeSimplesProcedimento(nome));
  if (!linha) {
    if (seExistir) return false;
    throw erroTsqlProcedimento(2812, 62, `Could not find function '${nomeSimplesProcedimento(nome)}'.`);
  }
  db.prepare('DELETE FROM main.all_parameters WHERE object_id = ?').run(linha.object_id);
  db.prepare('DELETE FROM main.sql_modules WHERE object_id = ?').run(linha.object_id);
  db.prepare('DELETE FROM main.objects WHERE object_id = ?').run(linha.object_id);
  return true;
}

module.exports = {
  instalar,
  sincronizarCatalogoDatabase,
  registrarFuncoesData,
  criarProcedimento,
  obterProcedimento,
  removerProcedimento,
  criarFuncao,
  obterFuncao,
  listarFuncoes,
  removerFuncao,
  MASTER,
  SISTEMA,
  EDICOES,
  VERSAO
};
