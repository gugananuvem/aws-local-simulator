'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DbEngine } = require('./db-engine');
const { SqlTranslator } = require('./sql-translator');

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
      SELECT name, value, value_for_secondary FROM sys.database_scoped_configurations
      ORDER BY name
    `).rows;
    expect(escopo).toEqual([
      { name: 'LEGACY_CARDINALITY_ESTIMATION', value: 0, value_for_secondary: 2 },
      { name: 'MAXDOP', value: 0, value_for_secondary: 0 },
      { name: 'PARAMETER_SNIFFING', value: 1, value_for_secondary: 2 },
      { name: 'QUERY_OPTIMIZER_HOTFIXES', value: 0, value_for_secondary: 2 }
    ]);
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
      { nome: 'nome', tipo: 'varchar' }
    ]);

    const indices = engine.execute('principal',
      'SELECT index_id AS id, type_desc AS descricao FROM sys.indexes WHERE object_id = ?',
      [tabelas.rows[0].object_id]
    );
    expect(indices.rows).toEqual([{ id: 0, descricao: 'HEAP' }]);
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
});
