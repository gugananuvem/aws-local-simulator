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
  });

  test('traduz variaveis de sistema e CONVERT sem a ajuda de shims', () => {
    const resultado = engine.execute('principal',
      "SELECT DB_NAME(1) AS db, @@TRANCOUNT AS tr, CONVERT(nvarchar(40), 'abc') AS texto"
    );
    expect(resultado.rows[0]).toEqual({ db: 'master', tr: 0, texto: 'abc' });
  });
});
