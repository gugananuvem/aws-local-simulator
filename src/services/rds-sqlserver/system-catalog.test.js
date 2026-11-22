'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DbEngine } = require('./db-engine');
const { SqlTranslator } = require('./sql-translator');
const catalogoSistema = require('./system-catalog');

describe('Catálogo de sistema do SQL Server simulado', () => {
  let dataDir;
  let engine;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-sqlserver-sys-'));
    engine = new DbEngine(dataDir, new SqlTranslator('sqlserver-ee'));
  });

  afterEach(() => {
    if (engine) engine.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('cria sys.databases com master e databases de usuario', () => {
    engine.execute('principal', 'CREATE TABLE clientes (id INT)');

    const resultado = engine.execute('principal', 'SELECT name, state FROM sys.databases');
    const nomes = resultado.rows.map((linha) => linha.name);
    expect(nomes).toContain('master');
    expect(nomes).toContain('principal');
    expect(resultado.rows.every((linha) => linha.state === 0)).toBe(true);
    expect(nomes).toEqual(expect.arrayContaining(['master', 'tempdb', 'model', 'msdb']));
    expect(resultado.columns.find((coluna) => coluna.name === 'state').type).toBe('TINYINT');
  });

  test('DB_NAME() e DB_ID() sem argumento usam o database da conexao', () => {
    engine.execute('master', 'CREATE DATABASE BancoAtual');

    const atual = engine.execute('BancoAtual', 'SELECT DB_NAME() AS nome, DB_ID() AS id');
    const esperado = engine.execute('master', "SELECT DB_ID('BancoAtual') AS id");

    expect(atual.rows[0].nome).toBe('BancoAtual');
    expect(atual.rows[0].id).toBe(esperado.rows[0].id);
    expect(engine.execute('master', 'SELECT DB_NAME() AS nome').rows[0].nome).toBe('master');
  });

  test('expõe tabelas de recuperacao-uso consultadas pelo SMO apos CREATE DATABASE', () => {
    engine.execute('master', 'CREATE DATABASE BancoRecuperacao');

    const resultado = engine.execute('master', `
      SELECT d.name, drs.database_guid, drs.recovery_fork_guid,
             ctb.is_auto_cleanup_on, fsopt.is_filestream_enabled
      FROM master.sys.databases AS d
      LEFT JOIN sys.database_recovery_status AS drs ON drs.database_id = d.database_id
      LEFT JOIN sys.change_tracking_databases AS ctb ON ctb.database_id = d.database_id
      LEFT JOIN sys.database_filestream_options AS fsopt ON fsopt.database_id = d.database_id
      WHERE d.name = 'BancoRecuperacao'
    `);
    expect(resultado.rows).toHaveLength(1);
    expect(resultado.rows[0].database_guid).toMatch(/^[0-9a-f-]{36}$/);
    expect(resultado.rows[0].recovery_fork_guid).toBe(resultado.rows[0].database_guid);
    expect(resultado.rows[0].is_auto_cleanup_on).toBe(0);
    expect(resultado.rows[0].is_filestream_enabled).toBe(0);
  });

  test('sys.databases tem todas as opcoes lidas pelo SMO ao criar database', () => {
    const colunas = [
      'is_ansi_null_default_on', 'is_ansi_nulls_on', 'is_ansi_padding_on',
      'is_ansi_warnings_on', 'is_arithabort_on', 'is_cursor_close_on_commit_on',
      'is_concat_null_yields_null_on', 'is_numeric_roundabort_on',
      'is_quoted_identifier_on', 'is_recursive_triggers_on', 'is_nested_triggers_on',
      'is_db_chaining_on', 'is_auto_update_stats_async_on', 'is_date_correlation_on',
      'is_trustworthy_on', 'is_auto_create_stats_on', 'is_auto_update_stats_on',
      'is_parameterization_forced', 'is_read_committed_snapshot_on',
      'is_published', 'is_subscribed', 'is_merge_published',
      'is_local_cursor_default', 'page_verify_option', 'is_broker_enabled',
      'is_honor_broker_priority_on', 'is_encrypted', 'is_transform_noise_words_on',
      'default_language_lcid', 'default_language_name',
      'default_fulltext_language_lcid', 'default_fulltext_language_name',
      'delayed_durability', 'is_accelerated_database_recovery_on',
      'target_recovery_time_in_seconds', 'log_reuse_wait'
    ];

    const resultado = engine.execute('master',
      `SELECT ${colunas.join(', ')} FROM sys.databases WHERE name = 'master'`);
    expect(resultado.rows).toHaveLength(1);
    expect(resultado.rows[0].is_ansi_null_default_on).toBe(1);
    expect(resultado.rows[0].default_language_lcid).toBe(1033);

    const propriedades = engine.execute('master',
      "SELECT DATABASEPROPERTYEX('master', 'Updateability') AS u, " +
      "DATABASEPROPERTYEX('master', 'LastGoodCheckDbTime') AS d"
    ).rows[0];
    expect(propriedades.u).toBe('READ_WRITE');
    expect(propriedades.d).toBe('2023-01-01 00:00:00');
  });

  test('responde a consulta de permissoes do Table Designer', () => {
    const linha = engine.execute('principal',
      "SELECT user_name() AS usuario, @@MAX_PRECISION AS precisao, " +
      "is_member('db_owner') AS membro, permissions() AS permissoes, " +
      "DatabasePropertyEx(db_name(), N'collation') AS colacao, " +
      "SERVERPROPERTY('IsFullTextInstalled') AS fulltext, schema_name() AS schema_padrao"
    ).rows[0];
    expect(linha).toEqual({
      usuario: 'dbo',
      precisao: 38,
      membro: 1,
      permissoes: 2147483647,
      colacao: 'SQL_Latin1_General_CP1_CI_AS',
      fulltext: 0,
      schema_padrao: 'dbo'
    });
  });

  test('expõe sysobjects com o id usado pelo Table Designer', () => {
    engine.execute('principal', 'CREATE TABLE [dbo].[TB_TESTE_DESIGN] ([Id] INT NOT NULL)');

    const linha = engine.execute('principal',
      "select id from sysobjects where id = object_id(N'dbo.TB_TESTE_DESIGN')"
    ).rows[0];
    expect(linha.id).toBeGreaterThan(0);

    const objeto = engine.execute('principal',
      "SELECT name, xtype, type, parent_obj FROM sysobjects WHERE name = 'TB_TESTE_DESIGN'"
    ).rows[0];
    expect(objeto).toMatchObject({
      name: 'TB_TESTE_DESIGN',
      xtype: 'U',
      type: 'U',
      parent_obj: 0
    });

    const colunas = engine.execute('principal', `
      SELECT c.name, c.colid, t.name AS tipo
      FROM syscolumns c JOIN systypes t ON c.xtype = t.xtype
      WHERE c.id = object_id(N'dbo.TB_TESTE_DESIGN')
      ORDER BY c.colid
    `).rows;
    expect(colunas).toEqual([{ name: 'Id', colid: 1, tipo: 'int' }]);
  });

  test('expõe tabelas de particionamento e lock_escalation_desc ao designer', () => {
    engine.execute('principal', 'CREATE TABLE [dbo].[TB_TESTE_PART] ([Id] INT NOT NULL)');

    const particoes = engine.execute('principal', `
      select func.name, func.function_id, func.type, func.fanout,
             para.parameter_id, tp.name as type_name
      from sys.partition_functions func
      left outer join (sys.partition_parameters para join main.types tp
        on tp.user_type_id = para.system_type_id) on para.function_id = func.function_id
      order by func.function_id, para.parameter_id
    `).rows;
    expect(particoes).toEqual([]);

    const esquemas = engine.execute('principal', `
      select sch.name, sch.data_space_id, sch.function_id, dest.destination_id,
             fg.name as fg_name, fg.type
      from sys.partition_schemes sch
      inner join (sys.destination_data_spaces dest
        inner join sys.filegroups fg on fg.data_space_id = dest.data_space_id)
        on dest.partition_scheme_id = sch.data_space_id
      order by sch.data_space_id, dest.destination_id
    `).rows;
    expect(esquemas).toEqual([]);

    const tipos = engine.execute('principal', `
      select a.name as user_type_name, a.max_length, a.precision, a.scale,
             a.is_nullable, a.collation_name
      from sys.types a
      where a.system_type_id <> a.user_type_id and a.schema_id <> 4
      order by a.user_type_id
    `).rows;
    expect(tipos).toEqual([]);

    const tabela = engine.execute('principal',
      "SELECT lock_escalation_desc FROM main.tables WHERE name = 'TB_TESTE_PART'"
    ).rows[0];
    expect(tabela.lock_escalation_desc).toBe('TABLE');
  });

  test('carrega as colunas consultadas pelo script do Table Designer', () => {
    engine.execute(
      'principal',
      'CREATE TABLE [dbo].[TB_TESTE_COLUNAS] ([Id] INT NOT NULL, [Nome] NVARCHAR(50) NULL)'
    );

    const colunas = engine.execute('principal', `
      select col.name, col.column_id, st.name as DT_name, schema_name(st.schema_id) as DT_schema,
             col.max_length, col.precision, col.scale, bt.name as BT_name, col.collation_name,
             col.is_nullable, col.is_ansi_padded, col.is_rowguidcol, col.is_identity,
             case when(idc.column_id is null) then null else CONVERT(nvarchar(40), idc.seed_value) end,
             case when(idc.column_id is null) then null else CONVERT(nvarchar(40), idc.increment_value) end,
             CONVERT(bit, case when(cmc.column_id is null) then 0 else 1 end) as is_computed,
             convert(bit, ColumnProperty(col.object_id, col.name, N'IsIdNotForRepl')) as IsIdNotForRepl,
             col.is_replicated, col.is_non_sql_subscribed, col.is_merge_published,
             col.is_dts_replicated, col.rule_object_id, robj.name as Rul_name,
             schema_name(robj.schema_id) as Rul_schema, col.default_object_id,
             OBJECTPROPERTY(col.default_object_id, N'IsDefaultCnst') as is_defcnst,
             dobj.name as def_name, schema_name(dobj.schema_id) as def_schema,
             CONVERT(bit, case when (ftc.column_id is null) then 0 else 1 end) as is_FullTextCol,
             col_name(col.object_id, ftc.type_column_id) FT_type_column,
             ftc.language_id as FT_language_id,
             case when(cmc.column_id is null) then null else cmc.definition end as formular,
             case when(cmc.column_id is null) then null else cmc.is_persisted end as is_persisted,
             defCst.definition,
             COLUMNPROPERTY(col.object_id, col.name, 'IsDeterministic') as IsDeterministic,
             xmlcoll.name as xmlSchema_name, schema_name(xmlcoll.schema_id) as xmlSchema_schema,
             col.is_xml_document, col.is_sparse, col.is_column_set,
             CONVERT(bit, case when (ISNULL(ftc.statistical_semantics, 0) = 0) then 0 else 1 end) as is_StatisticalSemantics,
             col.is_filestream
      from sys.columns col
      left outer join sys.types st on st.user_type_id = col.user_type_id
      left outer join sys.types bt on bt.user_type_id = col.system_type_id
      left outer join sys.objects robj on robj.object_id = col.rule_object_id and robj.type = 'R'
      left outer join sys.objects dobj on dobj.object_id = col.default_object_id and dobj.type = 'D'
      left outer join sys.default_constraints defCst on defCst.parent_object_id = col.object_id and defCst.parent_column_id = col.column_id
      left outer join sys.identity_columns idc on idc.object_id = col.object_id and idc.column_id = col.column_id
      left outer join sys.computed_columns cmc on cmc.object_id = col.object_id and cmc.column_id = col.column_id
      left outer join sys.fulltext_index_columns ftc on ftc.object_id = col.object_id and ftc.column_id = col.column_id
      left outer join sys.xml_schema_collections xmlcoll on xmlcoll.xml_Collection_id = col.xml_Collection_id
      where col.object_id = object_id(N'dbo.TB_TESTE_COLUNAS')
      order by col.column_id
    `).rows;

    expect(colunas).toHaveLength(2);
    // O batch do designer tem expressoes sem alias, então o engine devolve
    // linhas posicionais para evitar colisao de nomes no TDS.
    expect(colunas[0].slice(0, 20)).toEqual([
      'Id', 1, 'int', 'sys', 4, 10, 0, 'int', null, 0, 1, 0, 0,
      null, null, 0, 0, 0, 0, 0
    ]);
    expect(colunas[1].slice(0, 20)).toEqual([
      'Nome', 2, 'nvarchar', 'sys', 100, 0, 0, 'nvarchar',
      null, 1, 1, 0, 0, null, null, 0, 0, 0, 0, 0
    ]);
  });

  test('carrega assembly_types e índices consultados pelo designer', () => {
    engine.execute(
      'principal',
      'CREATE TABLE [dbo].[TB_TESTE_INDICES] ([Id] INT NOT NULL, [Nome] NVARCHAR(50) NULL)'
    );

    const tiposAssembly = engine.execute('principal', `
      select a.name as user_type_name, schema_name(a.schema_id) as user_type_schema,
             a.max_length, a.precision, a.scale, s1.name as def_name, s2.name as rule_name,
             a.is_nullable, schema_name(s1.schema_id) as def_schema,
             schema_name(s2.schema_id) as rule_schema, a.collation_name,
             a.assembly_id, a.assembly_class, a.is_binary_ordered, a.is_fixed_length,
             a.user_type_id
      from (sys.assembly_types a inner join sys.assembly_types b on a.is_user_defined = 1)
      left outer join sys.objects s1 on s1.object_id = a.default_object_id and s1.type = 'D'
      left outer join sys.objects s2 on s2.object_id = a.rule_object_id and s2.type = 'R'
      order by a.user_type_id
    `).rows;
    expect(tiposAssembly).toEqual([]);

    const indices = engine.execute('principal', `
      select ind.name, dsp.name as space_name, ind.index_id, ind.type, ind.is_unique,
             ind.ignore_dup_key, ind.is_primary_key, ind.is_unique_constraint,
             ind.fill_factor, ind.is_padded, ind.is_disabled, ind.is_hypothetical,
             ind.allow_row_locks, ind.allow_page_locks,
             convert(bit, IndexProperty(ind.object_id, ind.name, N'IsFulltextKey')) as is_FulltextKey,
             sta.no_recompute, ind_col.index_column_id, col.name as column_nName,
             ind_col.key_ordinal, ind_col.is_descending_key, ind_col.is_included_column,
             ind_col.partition_ordinal, ind_col.column_id, ind.data_space_id,
             ind.has_filter, ind.filter_definition
      from sys.indexes ind
      left outer join sys.stats sta on sta.object_id = ind.object_id and sta.stats_id = ind.index_id
      left outer join (sys.index_columns ind_col inner join sys.columns col
        on col.object_id = ind_col.object_id and col.column_id = ind_col.column_id)
        on ind_col.object_id = ind.object_id and ind_col.index_id = ind.index_id
      left outer join sys.data_spaces dsp on dsp.data_space_id = ind.data_space_id
      where ind.object_id = object_id(N'dbo.TB_TESTE_INDICES')
        and ind.index_id >= 0 and ind.type <> 3 and ind.type <> 4
        and ind.is_hypothetical = 0
      order by ind.index_id, ind_col.key_ordinal
    `).rows;
    expect(indices.length).toBeGreaterThan(0);
    expect(indices[0]).toMatchObject({
      index_id: 0,
      type: 0,
      is_unique: 0,
      is_padded: 0,
      is_hypothetical: 0,
      allow_row_locks: 1,
      allow_page_locks: 1,
      has_filter: 0
    });
  });

  test('carrega índices XML e internal_tables consultados pelo designer', () => {
    engine.execute('principal', 'CREATE TABLE [dbo].[TB_TESTE_XML] ([Id] INT NOT NULL)');

    const indicesXml = engine.execute('principal', `
      select IndA.name, IndB.name as ref_name, IndA.using_xml_index_id, IndA.index_id,
             IndA.fill_factor, IndA.is_padded, IndA.is_disabled, IndA.is_hypothetical,
             IndA.allow_row_locks, IndA.allow_page_locks, IndA.secondary_type,
             st.no_recompute, ind_col.index_column_id, col.name as column_nName,
             ind_col.key_ordinal, ind_col.is_descending_key, ind_col.column_id
      from (sys.xml_indexes IndA left outer join sys.xml_indexes IndB
        on IndB.object_id = IndA.object_id and IndB.index_id = IndA.using_xml_index_id)
      inner join (sys.internal_tables IntT inner join sys.stats st
        on IntT.internal_type = 202 and st.object_id = IntT.object_id)
        on IntT.parent_id = IndA.object_id and st.name = IndA.name
      inner join sys.index_columns ind_col on ind_col.object_id = IndA.object_id
        and ind_col.index_id = IndA.index_id
      inner join sys.columns col on col.object_id = ind_col.object_id
        and col.column_id = ind_col.column_id
      where IndA.object_id = object_id(N'dbo.TB_TESTE_XML')
      order by IndA.index_id, ind_col.key_ordinal
    `).rows;
    expect(indicesXml).toEqual([]);
  });

  test('expõe as configurações lidas pelo SMO após CREATE DATABASE', () => {
    const configuracoes = engine.execute('master', `
      SELECT configuration_id, name, value_in_use FROM sys.configurations
      WHERE configuration_id IN (115, 124, 1126, 1127, 1555)
      ORDER BY configuration_id
    `).rows;
    expect(configuracoes).toEqual([
      { configuration_id: 115, name: 'max worker threads', value_in_use: 0 },
      { configuration_id: 124, name: 'default language', value_in_use: 0 },
      { configuration_id: 1126, name: 'default full-text language', value_in_use: 1033 },
      { configuration_id: 1127, name: 'full-text upgrade option', value_in_use: 0 },
      { configuration_id: 1555, name: 'remote data archive', value_in_use: 0 }
    ]);

    const fullText = engine.execute('master',
      "SELECT name FROM sys.fulltext_languages WHERE lcid = 1033").rows;
    expect(fullText).toEqual([{ name: 'English' }]);

    const escopo = engine.execute('principal', `
      SELECT name, configuration_id, value, value_for_secondary, is_value_default
      FROM sys.database_scoped_configurations ORDER BY name
    `).rows;
    expect(escopo).toEqual([
      { name: 'LEGACY_CARDINALITY_ESTIMATION', configuration_id: 18, value: 0, value_for_secondary: 2, is_value_default: 1 },
      { name: 'MAXDOP', configuration_id: 9, value: 0, value_for_secondary: 0, is_value_default: 1 },
      { name: 'PARAMETER_SNIFFING', configuration_id: 19, value: 1, value_for_secondary: 2, is_value_default: 1 },
      { name: 'QUERY_OPTIMIZER_HOTFIXES', configuration_id: 20, value: 0, value_for_secondary: 2, is_value_default: 1 }
    ]);
    expect(engine.execute('principal',
      "SELECT SQL_VARIANT_PROPERTY(value, 'BaseType') AS BaseType " +
      "FROM sys.database_scoped_configurations WHERE name = 'MAXDOP'").rows)
      .toEqual([{ BaseType: 'int' }]);
  });

  test('expõe database_query_store_options usada pelo script CREATE do database', () => {
    const opcoes = engine.execute('principal', `
      SELECT actual_state AS [ActualState], desired_state AS [DesiredState],
             query_capture_mode AS [QueryCaptureMode],
             max_storage_size_mb AS [MaxStorageSizeInMB]
      FROM sys.database_query_store_options
    `).rows;
    expect(opcoes.length).toBeGreaterThan(0);
    expect(opcoes[0]).toEqual({
      ActualState: 0,
      DesiredState: 0,
      QueryCaptureMode: 1,
      MaxStorageSizeInMB: 0
    });
  });

  test('expõe filegroups, database_files e master_files usados pela aba Filegroups', () => {
    const filegroups = engine.execute('principal', `
      SELECT g.name AS [Name], g.data_space_id AS [ID], g.is_default AS [IsDefault],
             g.type AS [FileGroupType]
      FROM sys.filegroups AS g
      WHERE CAST(cast(g.name as varbinary(256)) AS sysname) = 'PRIMARY'
    `).rows;
    expect(filegroups).toEqual([
      { Name: 'PRIMARY', ID: 1, IsDefault: 1, FileGroupType: 'FG' }
    ]);

    const arquivos = engine.execute('principal', `
      SELECT file_id, type, name, size, physical_name
      FROM sys.database_files ORDER BY file_id
    `).rows;
    expect(arquivos.map((arquivo) => arquivo.type)).toEqual([0, 1]);
    expect(arquivos[0].name).toBe('principal');
    expect(arquivos[1].name).toBe('principal_log');
    expect(arquivos[0].physical_name).toMatch(/principal\.mdf$/);

    const expandidos = engine.execute('principal', `
      SELECT s.size * CONVERT(float,8) AS [Size]
      FROM sys.database_files AS s WHERE (s.type = 1)
    `).rows;
    expect(expandidos[0].Size).toBe(65536);

    const mestres = engine.execute('principal',
      'SELECT database_id, name FROM sys.master_files ORDER BY database_id, file_id').rows;
    expect(mestres.map((arquivo) => arquivo.name)).toContain('principal');
  });

  test('expõe fn_helpcollations usada pela aba Options do New Database', () => {
    const resultado = engine.execute('master', `
      SELECT cl.name AS [Name], cl.description AS [Description],
             COLLATIONPROPERTY(cl.name, 'LCID') AS [LocaleID],
             COLLATIONPROPERTY(cl.name, 'CodePage') AS [CodePage],
             COLLATIONPROPERTY(cl.name, 'Version') AS [CollationVersion]
      FROM sys.fn_helpcollations() cl
      ORDER BY cl.name
    `);
    expect(resultado.rows.length).toBeGreaterThan(0);
    expect(resultado.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        Name: 'SQL_Latin1_General_CP1_CI_AS',
        LocaleID: 1033,
        CodePage: 1252,
        CollationVersion: 0
      })
    ]));
  });

  test('migra configurações de catálogos criados por versões anteriores', () => {
    engine.execute('master', 'SELECT 1 AS ok');
    engine.close();
    const bruto = new (require('better-sqlite3'))(':memory:');
    try {
      const master = path.join(dataDir, 'master.db').replace(/'/g, "''");
      bruto.exec(`ATTACH DATABASE '${master}' AS sys`);
      bruto.exec(`
        DELETE FROM sys.configurations WHERE name = 'nested triggers';
        UPDATE sys.configurations SET configuration_id = 148 WHERE name = 'default language';
        DELETE FROM sys.configurations WHERE name = 'default full-text language';
        DELETE FROM sys.database_scoped_configurations;
        DELETE FROM sys.fulltext_languages;
      `);
      bruto.exec('DETACH DATABASE sys');
    } finally {
      bruto.close();
    }

    engine = new DbEngine(dataDir, new SqlTranslator('sqlserver-ee'));
    const idioma = engine.execute('master',
      "SELECT configuration_id, value_in_use FROM sys.configurations WHERE name = 'default language'"
    ).rows;
    expect(idioma).toEqual([{ configuration_id: 124, value_in_use: 0 }]);

    const configuracoes = engine.execute('master', `
      SELECT configuration_id FROM sys.configurations
      WHERE configuration_id IN (115, 124, 1126, 1127, 1555)
      ORDER BY configuration_id
    `).rows;
    expect(configuracoes.map((linha) => linha.configuration_id)).toEqual([115, 124, 1126, 1127, 1555]);

    expect(engine.execute('master',
      "SELECT name FROM sys.fulltext_languages WHERE lcid = 1033").rows)
      .toEqual([{ name: 'English' }]);
    expect(engine.execute('principal',
      "SELECT value FROM sys.database_scoped_configurations WHERE name = 'MAXDOP'").rows)
      .toEqual([{ value: 0 }]);
  });

  test('aceita a forma master.sys.databases', () => {
    const resultado = engine.execute('principal', 'SELECT name FROM master.sys.databases');
    expect(resultado.rows.map((linha) => linha.name)).toContain('master');
  });

  test('expõe sys.dm_os_process_memory para o SMO', () => {
    const resultado = engine.execute('principal',
      'SELECT (SELECT physical_memory_in_use_kb FROM sys.dm_os_process_memory) AS [PhysicalMemoryUsageInKB]');
    expect(resultado.rows[0].PhysicalMemoryUsageInKB).toBe(8388608);
  });

  test('devolve caminhos padrao de dados e log para o New Database', () => {
    const caminhos = engine.execute('principal',
      "SELECT SERVERPROPERTY('InstanceDefaultDataPath') AS DefaultFile, " +
      "SERVERPROPERTY('InstanceDefaultLogPath') AS DefaultLog, " +
      "SERVERPROPERTY('PathSeparator') AS Separador"
    ).rows[0];

    expect(caminhos.DefaultFile)
      .toBe('C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA');
    expect(caminhos.DefaultLog).toBe(caminhos.DefaultFile);
    expect(caminhos.Separador).toBe('\\');
  });

  test('registra SERVERPROPERTY, CONNECTIONPROPERTY e IS_SRVROLEMEMBER', () => {
    const propriedades = engine.execute('principal',
      "SELECT SERVERPROPERTY('Edition') AS Edition, " +
      "SERVERPROPERTY('EngineEdition') AS EngineEdition, " +
      "SERVERPROPERTY('ProductVersion') AS ProductVersion, " +
      "SERVERPROPERTY('ProductLevel') AS ProductLevel"
    ).rows[0];

    expect(propriedades.Edition).toBe('Enterprise Edition (64-bit)');
    expect(propriedades.EngineEdition).toBe(3);
    expect(propriedades.ProductVersion).toBe('16.00.4035.2');
    expect(propriedades.ProductLevel).toBe('RTM');

    expect(engine.execute('principal', "SELECT CONNECTIONPROPERTY('net_transport') AS p").rows[0].p)
      .toBe('TCP');
    expect(engine.execute('principal', "SELECT IS_SRVROLEMEMBER('sysadmin') AS r").rows[0].r)
      .toBe(1);
    expect(engine.execute('principal', "SELECT IS_SRVROLEMEMBER('dbcreator') AS r").rows[0].r)
      .toBe(0);
    expect(engine.execute('principal',
      "SELECT HAS_DBACCESS('master') AS m, HAS_DBACCESS('principal') AS p, HAS_DBACCESS('msdb') AS s")
      .rows[0]).toEqual({ m: 1, p: 1, s: 1 });
    expect(engine.execute('principal', "SELECT QUOTENAME('LOCAL') AS q").rows[0].q)
      .toBe('[LOCAL]');
    expect(engine.execute('principal',
      "SELECT ISNULL(HAS_PERMS_BY_NAME(QUOTENAME(@DbName, ']'), 'DATABASE', 'VIEW DATABASE STATE'), -1) AS p",
      ['Ultrapoints2']).rows[0].p).toBe(1);
    expect(engine.execute('principal',
      "SELECT CAST(SERVERPROPERTY('ServerName') AS sysname) AS nome").rows[0].nome)
      .toBe('LOCAL');
    expect(engine.execute('principal',
      "SELECT 'Server[@Name=' + QUOTENAME(SERVERPROPERTY('ServerName'), '''') + ']' AS urn")
      .rows[0].urn).toBe("Server[@Name='LOCAL']");
    expect(engine.execute('principal',
      "SELECT FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') AS f").rows[0].f)
      .toBe(0);
    expect(engine.execute('principal',
      "SELECT OBJECT_ID('dbo.sysdac_instances') AS o, OBJECT_ID('clientes') AS c").rows[0].o)
      .toBeNull();
    expect(engine.execute('msdb',
      "SELECT OBJECT_ID('dbo.sysdac_instances') AS o").rows[0].o)
      .toBe(1001);
  });

  test('permite consultar objetos do msdb a partir de outro database', () => {
    engine.execute('msdb', 'SELECT 1 AS ok');

    const resultado = engine.execute('principal',
      "SELECT current_value FROM msdb.dbo.syspolicy_configuration WHERE name = 'Enabled'"
    );
    expect(resultado.rows).toEqual([{ current_value: '1' }]);
  });

  test('preserva tipos T-SQL, IDENTITY e nome da PK ao reconstruir o catalogo', () => {
    engine.execute('principal', [
      'CREATE TABLE [dbo].[TB001](',
      '[Id] [nvarchar](21) NOT NULL,',
      '[Cep] [varchar](11) NULL,',
      '[Valor] [decimal](18, 2) NULL,',
      '[Criado] [bigint] NULL,',
      'CONSTRAINT [PK_TB001] PRIMARY KEY CLUSTERED ([Id] ASC)',
      ')'
    ].join(' '));

    const tipos = engine.execute('principal',
      'SELECT c.name AS nome, t.name AS tipo, c.max_length AS tamanho, ' +
      'c.precision AS precisao, c.scale AS escala, c.is_identity AS identidade ' +
      'FROM sys.all_columns AS c INNER JOIN sys.types AS t ON t.user_type_id = c.user_type_id ' +
      "WHERE c.object_id = (SELECT object_id FROM sys.objects WHERE name = 'TB001') ORDER BY c.column_id"
    );
    expect(tipos.rows).toEqual([
      { nome: 'Id', tipo: 'nvarchar', tamanho: 42, precisao: 0, escala: 0, identidade: 0 },
      { nome: 'Cep', tipo: 'varchar', tamanho: 11, precisao: 0, escala: 0, identidade: 0 },
      { nome: 'Valor', tipo: 'decimal', tamanho: 17, precisao: 18, escala: 2, identidade: 0 },
      { nome: 'Criado', tipo: 'bigint', tamanho: 8, precisao: 19, escala: 0, identidade: 0 }
    ]);

    const pk = engine.execute('principal',
      'SELECT i.name AS nome, i.type_desc AS tipo, i.type AS codigo, i.index_id AS indice ' +
      "FROM sys.indexes AS i WHERE i.object_id = (SELECT object_id FROM sys.objects WHERE name = 'TB001') AND i.is_primary_key = 1"
    );
    expect(pk.rows).toEqual([{ nome: 'PK_TB001', tipo: 'CLUSTERED', codigo: 1, indice: 1 }]);

    const chaves = engine.execute('principal',
      "SELECT name FROM sys.key_constraints WHERE parent_object_id = (SELECT object_id FROM sys.objects WHERE name = 'TB001')"
    );
    expect(chaves.rows).toEqual([{ name: 'PK_TB001' }]);
  });

  test('registra seed/increment apenas nas colunas IDENTITY reais', () => {
    engine.execute('principal',
      'CREATE TABLE [dbo].[TB002] ([Id] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY, [Nome] [nvarchar](50) NULL)');

    const identidades = engine.execute('principal',
      'SELECT c.name AS nome, i.seed_value AS seed, i.increment_value AS incremento ' +
      'FROM sys.identity_columns AS i INNER JOIN sys.all_columns AS c ' +
      'ON c.object_id = i.object_id AND c.column_id = i.column_id ' +
      "WHERE i.object_id = (SELECT object_id FROM sys.objects WHERE name = 'TB002')"
    );
    expect(identidades.rows).toEqual([{ nome: 'Id', seed: 1, incremento: 1 }]);
  });

  test('publica tabelas e colunas do database em sys.tables e sys.all_columns', () => {
    engine.execute('principal', 'CREATE TABLE clientes (id INT NOT NULL, nome NVARCHAR(50))');

    const tabelas = engine.execute('principal', 'SELECT name, object_id FROM sys.tables');
    expect(tabelas.rows.map((linha) => linha.name)).toEqual(['clientes']);

    const colunas = engine.execute('principal',
      'SELECT c.name AS nome, t.name AS tipo FROM sys.all_columns AS c ' +
      'INNER JOIN sys.types AS t ON t.user_type_id = c.user_type_id ' +
      'WHERE c.object_id = ? ORDER BY c.column_id',
      [tabelas.rows[0].object_id]
    );
    expect(colunas.rows).toEqual([
      { nome: 'id', tipo: 'int' },
      { nome: 'nome', tipo: 'nvarchar' }
    ]);

    const tamanhos = engine.execute('principal',
      'SELECT name, max_length FROM sys.all_columns WHERE object_id = ? ORDER BY column_id',
      [tabelas.rows[0].object_id]
    );
    expect(tamanhos.rows).toEqual([
      { name: 'id', max_length: 4 },
      { name: 'nome', max_length: 100 }
    ]);

    const indices = engine.execute('principal',
      'SELECT index_id AS id, type_desc AS descricao FROM sys.indexes WHERE object_id = ?',
      [tabelas.rows[0].object_id]
    );
    expect(indices.rows).toEqual([{ id: 0, descricao: 'HEAP' }]);
  });

  test('expõe metadados de Always Encrypted como NULL para colunas comuns', () => {
    engine.execute('principal', 'CREATE TABLE clientes (id INT NOT NULL)');

    const coluna = engine.execute('principal',
      "SELECT encryption_type, encryption_algorithm_name, column_encryption_key_id " +
      "FROM sys.all_columns WHERE name = 'id'"
    );
    expect(coluna.rows).toEqual([{
      encryption_type: null,
      encryption_algorithm_name: null,
      column_encryption_key_id: null
    }]);

    const db = engine.getOrCreateDatabase('principal');
    const info = db.prepare('PRAGMA main.table_info(all_columns)').all()
      .find((campo) => campo.name === 'encryption_type');
    expect(info.notnull).toBe(0);
  });

  test('cria as tabelas de metadados consultadas ao gerar o CREATE da tabela', () => {
    const tabelas = [
      'external_tables', 'external_data_sources', 'external_file_formats',
      'partitions', 'masked_columns', 'filetable_system_defined_objects',
      'spatial_index_tessellations', 'spatial_indexes', 'hash_indexes',
      'xml_indexes', 'selective_xml_index_paths', 'stats', 'key_constraints',
      'check_constraints', 'foreign_keys',
      'fulltext_indexes', 'fulltext_catalogs', 'fulltext_stoplists',
      'registered_search_property_lists', 'fulltext_index_columns'
    ];
    for (const tabela of tabelas) {
      expect(() => engine.execute('principal', `SELECT * FROM sys.${tabela}`)).not.toThrow();
    }
  });

  test('expõe as colunas de foreign_key_columns exigidas pelo script de tabelas', () => {
    const colunas = engine.execute('principal',
      'SELECT constraint_column_id, constraint_object_id, parent_column_id, ' +
      'referenced_object_id, referenced_column_id FROM sys.foreign_key_columns'
    ).columns.map((coluna) => coluna.name);
    expect(colunas).toEqual([
      'constraint_column_id', 'constraint_object_id', 'parent_column_id',
      'referenced_object_id', 'referenced_column_id'
    ]);
  });

  test('expõe colunas de metadados exigidas pelo script de views do SMO 19', () => {
    engine.execute('principal', 'CREATE VIEW vw_teste AS SELECT 1 AS valor');

    const metadados = engine.execute('principal',
      "SELECT has_opaque_metadata, modify_date FROM sys.all_views WHERE name = 'vw_teste'"
    );
    expect(metadados.rows).toEqual([{
      has_opaque_metadata: 0,
      modify_date: '2023-01-01 00:00:00'
    }]);
    expect(() => engine.execute('principal', 'SELECT name FROM sys.stats')).not.toThrow();
    expect(() => engine.execute('principal',
      'SELECT k.object_id FROM sys.key_constraints AS k'
    )).not.toThrow();
  });

  test('expõe server_role_members, default_constraints e politicas do msdb', () => {
    const papeis = engine.execute('principal',
      "SELECT r.name AS papel, p.name AS membro FROM sys.server_role_members m " +
      'INNER JOIN sys.server_principals r ON r.principal_id = m.role_principal_id ' +
      'INNER JOIN sys.server_principals p ON p.principal_id = m.member_principal_id ' +
      "WHERE p.name = 'admin' ORDER BY r.name"
    );
    expect(papeis.rows.map((linha) => linha.papel)).toEqual(['public', 'sysadmin']);

    engine.execute('principal', 'CREATE TABLE com_default (id INT NOT NULL, ativo BIT NOT NULL DEFAULT 1)');
    const restricoes = engine.execute('principal',
      'SELECT c.name AS coluna, d.name AS restricao, d.definition AS definicao ' +
      'FROM sys.all_columns c INNER JOIN sys.default_constraints d ' +
      'ON d.object_id = c.default_object_id ' +
      'WHERE c.object_id = ?',
      [engine.execute('principal', "SELECT object_id FROM sys.tables WHERE name = 'com_default'").rows[0].object_id]
    );
    expect(restricoes.rows).toEqual([{
      coluna: 'ativo',
      restricao: 'DF__com_default__ativo',
      definicao: '1'
    }]);

    const saude = engine.execute('principal',
      "SELECT target_query_expression_with_id AS alvo FROM msdb.syspolicy_system_health_state WHERE target_query_expression_with_id LIKE 'Server%'"
    );
    expect(saude.rows).toEqual([{ alvo: 'Server[@ID=2]%' }]);
  });

  test('expõe propriedades de login usadas pelo SMO', () => {
    const resultado = engine.execute('principal',
      "SELECT log.name AS Name, LOGINPROPERTY(log.name, N'IsLocked') AS IsLocked, " +
      'sys.fn_varbintohexsubstring(0, log.sid, 1, 0) AS SidHexString ' +
      'FROM sys.server_principals AS log ' +
      'LEFT OUTER JOIN sys.syslanguages AS l ON l.name = log.default_language_name ' +
      "WHERE log.name = 'admin'"
    );
    expect(resultado.rows).toEqual([{
      Name: 'admin', IsLocked: 0, SidHexString: '0x02'
    }]);
  });

  test('expõe as views de sistema sys.tables e sys.objects no catalogo', () => {
    const sistemas = engine.execute('principal',
      "SELECT v.name AS Name, SCHEMA_NAME(v.schema_id) AS [Schema] " +
      'FROM sys.all_views v WHERE v.is_ms_shipped = 1 ORDER BY v.name'
    );
    const nomes = sistemas.rows.map((linha) => linha.Name);
    expect(nomes).toContain('tables');
    expect(nomes).toContain('objects');
    expect(nomes).toContain('columns');
    expect(sistemas.rows.every((linha) => linha.Schema === 'sys')).toBe(true);

    const viaSystemViews = engine.execute('principal',
      'SELECT name FROM sys.system_views WHERE name IN (?, ?) ORDER BY name',
      ['tables', 'objects']
    );
    expect(viaSystemViews.rows).toEqual([{ name: 'objects' }, { name: 'tables' }]);

    const colunas = engine.execute('principal',
      'SELECT c.name AS nome, t.name AS tipo FROM sys.all_columns c ' +
      'INNER JOIN sys.types t ON t.user_type_id = c.user_type_id ' +
      'WHERE c.object_id = (SELECT object_id FROM sys.all_views WHERE name = ?) ' +
      'ORDER BY c.column_id',
      ['tables']
    );
    expect(colunas.rows.map((linha) => linha.nome)).toEqual(
      expect.arrayContaining(['name', 'object_id', 'schema_id', 'is_ms_shipped'])
    );
    expect(colunas.rows.some((linha) => linha.tipo === 'int')).toBe(true);
  });

  test('expõe sys.syslanguages com lcid e a funcao de politicas do msdb', () => {
    const idiomas = engine.execute('principal',
      'SELECT s.name AS Name, s.alias AS Alias, s.lcid AS LocaleID, s.langid AS LangID ' +
      'FROM sys.syslanguages s ORDER BY s.name ASC'
    );
    expect(idiomas.rows).toEqual(expect.arrayContaining([{
      Name: 'us_english', Alias: 'English', LocaleID: 1033, LangID: 0
    }, {
      Name: 'Portuguese (Brazil)', Alias: 'Portuguese', LocaleID: 1046, LangID: 27
    }]));

    // O SSMS/SMO converte o RunValue de `sp_configure 'default language'` (0)
    // em LCID usando exatamente esta consulta antes de abrir o New Database.
    expect(engine.execute('principal',
      'SELECT lcid FROM sys.syslanguages WHERE langid = 0'
    ).rows).toEqual([{ lcid: 1033 }]);

    const automacao = engine.execute('principal',
      'SELECT fn_syspolicy_is_automation_enabled() AS habilitado'
    );
    expect(automacao.rows).toEqual([{ habilitado: 1 }]);
  });

  test('corrige langids antigos ao reabrir um database', () => {
    engine.execute('principal',
      "UPDATE sys.syslanguages SET langid = 1033 WHERE name = 'us_english'"
    );
    expect(engine.execute('principal',
      'SELECT lcid FROM sys.syslanguages WHERE langid = 0'
    ).rows).toEqual([]);
    engine.close();

    const engineReaberta = new DbEngine(dataDir, new SqlTranslator('sqlserver-ee'));
    try {
      expect(engineReaberta.execute('principal',
        'SELECT lcid FROM sys.syslanguages WHERE langid = 0'
      ).rows).toEqual([{ lcid: 1033 }]);
    } finally {
      engineReaberta.close();
    }
  });

  test('migra lcid de sys.syslanguages para INT', () => {
    const db = engine.getOrCreateDatabase('principal');
    db.exec(`
      ALTER TABLE sys.syslanguages RENAME TO syslanguages_antigo;
      CREATE TABLE sys.syslanguages (
        name TEXT NOT NULL PRIMARY KEY,
        alias TEXT NOT NULL,
        langid SMALLINT NOT NULL DEFAULT 0,
        lcid SMALLINT NOT NULL DEFAULT 1033
      );
      INSERT INTO sys.syslanguages (name, alias, langid, lcid)
        SELECT name, alias, langid, lcid FROM sys.syslanguages_antigo;
      DROP TABLE sys.syslanguages_antigo;
    `);
    engine.close();

    const reaberta = new DbEngine(dataDir, new SqlTranslator('sqlserver-ee'));
    try {
      const colunas = reaberta.getOrCreateDatabase('principal')
        .prepare('PRAGMA sys.table_info(syslanguages)').all();
      expect(colunas.find((coluna) => coluna.name === 'lcid').type).toBe('INT');
      expect(reaberta.execute('principal',
        'SELECT lcid FROM sys.syslanguages WHERE langid = 0'
      ).rows).toEqual([{ lcid: 1033 }]);
    } finally {
      reaberta.close();
    }
  });

  test('expõe sys.configurations com SMO e DMO habilitado', () => {
    const resultado = engine.execute('principal',
      'SELECT name, configuration_id AS id, value AS valor, ' +
      'is_dynamic AS dinamico FROM sys.configurations WHERE configuration_id = 16387'
    );

    expect(resultado.rows).toHaveLength(1);
    expect(resultado.rows[0]).toMatchObject({ name: 'SMO and DMO Enabled', id: 16387, valor: 1 });
    expect(resultado.columns.find((coluna) => coluna.name === 'dinamico').type).toBe('BIT');

    const agentes = engine.execute('principal',
      'SELECT value_in_use FROM sys.configurations WHERE configuration_id = 16384'
    );
    expect(agentes.rows).toEqual([{ value_in_use: 1 }]);
  });

  test('expõe sys.endpoints e as DMVs usadas pelo SMO', () => {
    const endpoints = engine.execute('principal',
      'SELECT name, is_admin_endpoint AS admin FROM sys.endpoints'
    );
    expect(endpoints.rows[0]).toMatchObject({ name: 'TSQL Default TCP', admin: 0 });

    const sessoes = engine.execute('principal',
      'SELECT authenticating_database_id AS auth FROM sys.dm_exec_sessions WHERE session_id = @@SPID'
    );
    expect(sessoes.rows[0].auth).toBe(1);
  });

  test('expõe colunas e tabelas de sistema consultadas pelo SMO', () => {
    const collation = engine.execute('principal',
      'SELECT catalog_collation_type AS tipo, catalog_collation_type_desc AS descricao ' +
      "FROM sys.databases WHERE name = 'master'"
    );
    expect(collation.rows).toEqual([{ tipo: 2, descricao: 'SQL_COLLATION' }]);

    const databases = engine.execute('principal',
      'SELECT name, containment AS contencao, is_fulltext_enabled AS fulltext, ' +
      'source_database_id AS origem, user_access AS acesso FROM sys.databases ' +
      "WHERE name = 'master'"
    );
    expect(databases.rows).toEqual([{
      name: 'master', contencao: 0, fulltext: 0, origem: null, acesso: 0
    }]);

    const logins = engine.execute('principal',
      'SELECT log.name AS Name, log.principal_id AS ID ' +
      'FROM sys.server_principals AS log ' +
      'LEFT OUTER JOIN master.sys.asymmetric_keys AS ak ON ak.sid = log.sid ' +
      'LEFT OUTER JOIN master.sys.certificates AS cert ON cert.sid = log.sid ' +
      'LEFT OUTER JOIN sys.credentials AS c ON c.credential_id = log.credential_id ' +
      "WHERE log.type in ('U', 'G', 'S', 'C', 'K', 'E', 'X') " +
      'ORDER BY Name ASC'
    );
    expect(logins.rows.map((linha) => linha.Name)).toEqual(['admin', 'sa']);

    const gatilhos = engine.execute('principal',
      'SELECT tr.name AS Name FROM master.sys.server_triggers AS tr ' +
      'LEFT OUTER JOIN master.sys.server_assembly_modules AS mod ON mod.object_id = tr.object_id ' +
      'LEFT OUTER JOIN sys.server_sql_modules AS ssmod ON ssmod.object_id = tr.object_id ' +
      'WHERE tr.parent_class = 100'
    );
    expect(gatilhos.rows).toEqual([]);

    const papeis = engine.execute('principal',
      'SELECT name, create_date AS criado, is_fixed_role AS fixo ' +
      "FROM sys.server_principals WHERE type = 'R' ORDER BY name"
    );
    expect(papeis.rows.map((linha) => linha.name)).toContain('sysadmin');
    expect(papeis.rows.every((linha) => linha.fixo === 1 && linha.criado)).toBe(true);

    const cripto = engine.execute('principal',
      'SELECT c.name FROM sys.cryptographic_providers AS c ' +
      'INNER JOIN sys.dm_cryptographic_provider_properties AS cp ON cp.provider_id = c.provider_id'
    );
    expect(cripto.rows).toEqual([]);

    const dispositivos = engine.execute('principal',
      'SELECT name FROM sys.backup_devices'
    );
    expect(dispositivos.rows).toEqual([]);
  });

  test('traduz variaveis de sistema e CONVERT sem a ajuda de shims', () => {
    const resultado = engine.execute('principal',
      "SELECT DB_NAME(1) AS db, @@TRANCOUNT AS tr, CONVERT(nvarchar(40), 'abc') AS texto"
    );
    expect(resultado.rows[0]).toEqual({ db: 'master', tr: 0, texto: 'abc' });
  });

  test('usa object_id positivo e corrige procedures legadas com id negativo', () => {
    engine.execute('principal', 'CREATE PROCEDURE ANTIGA AS SELECT 1 AS ok');
    const db = engine.getOrCreateDatabase('principal');
    const original = db.prepare(
      "SELECT object_id FROM main.procedures WHERE name = 'ANTIGA'"
    ).get().object_id;
    expect(original).toBeGreaterThan(0);

    for (const tabela of ['all_parameters', 'sql_modules', 'procedures', 'objects']) {
      db.prepare(`UPDATE main.${tabela} SET object_id = -999 WHERE object_id = ?`).run(original);
    }
    catalogoSistema.sincronizarCatalogoDatabase(db);

    const corrigido = db.prepare(
      "SELECT object_id FROM main.procedures WHERE name = 'ANTIGA'"
    ).get().object_id;
    expect(corrigido).toBeGreaterThan(0);
    expect(db.prepare('SELECT object_id FROM main.objects WHERE name = ?')
      .get('ANTIGA').object_id).toBe(corrigido);
    expect(db.prepare('SELECT object_id FROM main.sql_modules WHERE object_id = ?')
      .get(corrigido)).toBeDefined();
  });

  test('uniformiza CRLF no definition de procedures e funcoes', () => {
    engine.execute('principal', 'CREATE PROCEDURE QUEBRAS_PROC AS SELECT 1');
    engine.execute('principal',
      'CREATE FUNCTION QUEBRAS_FN (@v int) RETURNS int AS BEGIN\nRETURN @v\nEND'
    );
    const db = engine.getOrCreateDatabase('principal');
    for (const nome of ['QUEBRAS_PROC', 'QUEBRAS_FN']) {
      const registro = db.prepare(`
        SELECT m.definition FROM main.sql_modules AS m
        JOIN main.objects AS o ON o.object_id = m.object_id
        WHERE o.name = ?
      `).get(nome);
      const uniformizado = registro.definition.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
      expect(registro.definition).toBe(uniformizado);
    }
  });

  test('responde a consulta de procedures usada pelo SSMS', () => {
    engine.execute('principal', 'CREATE PROCEDURE TESTE AS SELECT 1 AS ok');

    const linhas = engine.execute('principal', `
      SELECT sp.name AS [Name], sp.object_id AS [ID], sp.modify_date AS [DateLastModified],
             ISNULL(ssp.name, N'') AS [Owner],
             CAST(ISNULL(OBJECTPROPERTYEX(sp.object_id, N'ExecIsAnsiNullsOn'), 0) AS bit) AS [AnsiNullsStatus],
             CAST(ISNULL(OBJECTPROPERTYEX(sp.object_id, N'ExecIsQuotedIdentOn'), 0) AS bit) AS [QuotedIdentifierStatus],
             SCHEMA_NAME(sp.schema_id) AS [Schema],
             CAST(CASE WHEN ISNULL(smsp.definition, ssmsp.definition) IS NULL
                  THEN 1 ELSE 0 END AS bit) AS [IsEncrypted],
             CAST(COALESCE(smsp.is_recompiled, ssmsp.is_recompiled) AS bit) AS [Recompile],
             case when amsp.object_id is null then N'' else asmblsp.name end AS [AssemblyName],
             case when amsp.object_id is null then N'' else amsp.assembly_class end AS [ClassName],
             case when amsp.object_id is null then N'' else amsp.assembly_method end AS [MethodName],
             case when amsp.object_id is null
                  then ISNULL(USER_NAME(smsp.execute_as_principal_id), N'')
                  else ISNULL(USER_NAME(amsp.execute_as_principal_id), N'') end AS [Contexto],
             CAST(COALESCE(spp.is_auto_executed, 0) AS bit) AS [Startup],
             ISNULL(sm.uses_native_compilation, 0) AS [IsNativelyCompiled]
      FROM sys.all_objects AS sp
      LEFT OUTER JOIN sys.database_principals AS ssp
        ON ssp.principal_id = ISNULL(sp.principal_id, (OBJECTPROPERTY(sp.object_id, 'OwnerId')))
      LEFT OUTER JOIN sys.sql_modules AS smsp ON smsp.object_id = sp.object_id
      LEFT OUTER JOIN sys.system_sql_modules AS ssmsp ON ssmsp.object_id = sp.object_id
      LEFT OUTER JOIN sys.assembly_modules AS amsp ON amsp.object_id = sp.object_id
      LEFT OUTER JOIN sys.assemblies AS asmblsp ON asmblsp.assembly_id = amsp.assembly_id
      LEFT OUTER JOIN sys.procedures AS spp ON spp.object_id = sp.object_id
      LEFT OUTER JOIN sys.all_sql_modules AS sm ON sm.object_id = sp.object_id
      WHERE (sp.type = 'P' OR sp.type = 'RF' OR sp.type = 'PC')
        AND sp.name = 'TESTE' AND SCHEMA_NAME(sp.schema_id) = 'dbo'
    `).rows;

    expect(linhas).toHaveLength(1);
    expect(linhas[0].Name).toBe('TESTE');
    expect(linhas[0].ID).toBeGreaterThan(0);
    expect(linhas[0].Schema).toBe('dbo');
    expect(linhas[0].AnsiNullsStatus).toBe(0);
    expect(linhas[0].QuotedIdentifierStatus).toBe(0);
    expect(linhas[0].IsEncrypted).toBe(0);
    expect(linhas[0].AssemblyName).toBe('');
    expect(linhas[0].Startup).toBe(0);
  });
});
