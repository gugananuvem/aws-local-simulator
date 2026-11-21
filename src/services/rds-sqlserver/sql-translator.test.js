'use strict';

const SqlTranslator = require('./sql-translator');

describe('SqlTranslator - SQL Server (T-SQL) para SQLite', () => {
  const translator = new SqlTranslator();

  describe('exportação e construtor', () => {
    test('exporta a classe como padrão e como propriedade nomeada', () => {
      expect(typeof SqlTranslator).toBe('function');
      expect(SqlTranslator.SqlTranslator).toBe(SqlTranslator);
    });

    test.each([
      ['sqlserver-se'],
      ['sqlserver-web'],
      ['sqlserver-express'],
      ['SQLSERVER-SE']
    ])('aceita o engine %s', (engine) => {
      expect(() => new SqlTranslator(engine)).not.toThrow();
    });

    test('usa sqlserver-se como padrão', () => {
      expect(new SqlTranslator().engine).toBe('sqlserver-se');
    });

    test.each([['aurora-mysql'], ['mysql'], [''], [123], ['sqlserver']])(
      'rejeita o engine inválido %p com InvalidParameterValue',
      (engine) => {
        expect.assertions(2);
        try {
          new SqlTranslator(engine);
        } catch (erro) {
          expect(erro).toBeInstanceOf(Error);
          expect(erro.code).toBe('InvalidParameterValue');
        }
      }
    );
  });

  describe('imutabilidade', () => {
    test('não altera a string original', () => {
      const original = 'CREATE TABLE t (id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(50))';
      const copia = original.slice();
      const traduzido = translator.translate(original);
      expect(original).toBe(copia);
      expect(traduzido).not.toBe(original);
    });

    test.each([[null], [undefined], ['']])('devolve %p sem alteração', (entrada) => {
      expect(translator.translate(entrada)).toBe(entrada);
    });

    test('não faz nada quando não há conversão necessária', () => {
      expect(translator.translate('SELECT * FROM users WHERE id = 1')).toBe(
        'SELECT * FROM users WHERE id = 1'
      );
    });
  });

  describe('limpeza de comentários, whitespace e ruído', () => {
    test.each([
      [
        'remove comentário de linha',
        'SELECT 1 -- comentário\nFROM t',
        'SELECT 1 FROM t'
      ],
      [
        'remove comentário de bloco',
        'SELECT /* comentário\nmultilinha */ 1 FROM t',
        'SELECT 1 FROM t'
      ],
      [
        'colapsa whitespace',
        '  SELECT\t1\n  FROM   t  ',
        'SELECT 1 FROM t'
      ],
      [
        'remove SET NOCOUNT ON',
        'SET NOCOUNT ON; SELECT 1',
        'SELECT 1'
      ],
      [
        'remove SETs de sessao do SqlClient/SSMS',
        'SET ROWCOUNT 0 SET LOCK_TIMEOUT -1 SET QUERY_GOVERNOR_COST_LIMIT 0 ' +
          'SET DEADLOCK_PRIORITY NORMAL SET TRANSACTION ISOLATION LEVEL READ COMMITTED SELECT 1',
        'SELECT 1'
      ],
      [
        'remove ON [PRIMARY]',
        'CREATE TABLE t (id INT) ON [PRIMARY]',
        'CREATE TABLE t (id INTEGER)'
      ],
      [
        'remove GO do meio do lote',
        'SELECT 1\nGO\nSELECT 2',
        'SELECT 1 SELECT 2'
      ],
      [
        'remove o esquema dbo',
        'SELECT id FROM dbo.tabela',
        'SELECT id FROM tabela'
      ],
      [
        'remove o esquema dbo entre colchetes',
        'CREATE TABLE [dbo].[tabela] (id INT)',
        'CREATE TABLE [tabela] (id INTEGER)'
      ]
    ])('%s', (_nome, entrada, esperado) => {
      expect(translator.translate(entrada)).toBe(esperado);
    });

    test('não remove GO dentro de literal de texto', () => {
      expect(translator.translate("SELECT 'GO' AS texto FROM t")).toBe(
        "SELECT 'GO' AS texto FROM t"
      );
    });

    test('não remove dbo. dentro de literal de texto', () => {
      expect(translator.translate("SELECT 'dbo.t' AS texto FROM t")).toBe(
        "SELECT 'dbo.t' AS texto FROM t"
      );
    });
  });

  describe('splitBatches', () => {
    test.each([
      [
        'separa por GO em linhas distintas',
        'SELECT 1\nGO\nSELECT 2',
        ['SELECT 1', 'SELECT 2']
      ],
      [
        'separa por GO na mesma linha',
        'SELECT 1 GO SELECT 2',
        ['SELECT 1', 'SELECT 2']
      ],
      [
        'remove ponto e vírgula dos lotes',
        'SELECT 1; GO; SELECT 2;',
        ['SELECT 1', 'SELECT 2']
      ],
      [
        'ignora GO dentro de literal',
        "SELECT 'GO' AS x\nGO\nSELECT 2",
        ["SELECT 'GO' AS x", 'SELECT 2']
      ],
      [
        'ignora GO dentro de comentário',
        'SELECT 1 -- GO aqui\nGO\nSELECT 2',
        ['SELECT 1 -- GO aqui', 'SELECT 2']
      ],
      ['sem separador devolve um lote', 'SELECT 1', ['SELECT 1']],
      ['descarta lotes vazios', 'GO\n\nSELECT 1\nGO\n', ['SELECT 1']]
    ])('%s', (_nome, entrada, esperado) => {
      expect(translator.splitBatches(entrada)).toEqual(esperado);
    });

    test('devolve array vazio para entrada inválida', () => {
      expect(translator.splitBatches(null)).toEqual([]);
      expect(translator.splitBatches(undefined)).toEqual([]);
    });
  });

  describe('funções', () => {
    const NEWID =
      "lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)))";

    test.each([
      ['GETDATE()', "SELECT GETDATE()", "datetime('now')"],
      ['SYSDATETIME()', 'SELECT SYSDATETIME()', "datetime('now')"],
      ['CURRENT_TIMESTAMP', 'SELECT CURRENT_TIMESTAMP', "datetime('now')"],
      ['CURRENT_TIMESTAMP()', 'SELECT CURRENT_TIMESTAMP()', "datetime('now')"],
      ['NEWID()', 'SELECT NEWID()', NEWID],
      ['ISNULL(a,b)', "SELECT ISNULL(name, 'n/d') FROM t", "COALESCE(name, 'n/d')"],
      ['LEN(x)', 'SELECT LEN(name) FROM t', 'LENGTH(name)'],
      ['minúsculas', 'select getdate(), len(name) from t', "datetime('now')"]
    ])('traduz %s', (_nome, entrada, esperado) => {
      expect(translator.translate(entrada)).toContain(esperado);
    });

    test.each([
      ['dia literal negativo', 'SELECT DATEADD(day, -2, GETDATE())', "'-2 days'"],
      ['mês literal', 'SELECT DATEADD(mm, 1, Created) FROM t', "'+1 months'"],
      ['semana vira dias', 'SELECT DATEADD(week, 2, GETDATE())', "'+14 days'"],
      ['trimestre vira meses', 'SELECT DATEADD(quarter, 1, GETDATE())', "'+3 months'"],
      ['hora com expressão', 'SELECT DATEADD(hour, @h, GETDATE())', "' hours'"]
    ])('DATEADD: %s', (_nome, entrada, esperado) => {
      const resultado = translator.translate(entrada);
      expect(resultado).toContain('datetime(');
      expect(resultado).toContain(esperado);
    });

    test('não traduz funções dentro de literais ou identificadores entre colchetes', () => {
      const entrada = "SELECT 'GETDATE()', 'LEN(x)', 'NEWID()', [GETDATE()] FROM t";
      const resultado = translator.translate(entrada);
      expect(resultado).toContain("'GETDATE()'");
      expect(resultado).toContain("'LEN(x)'");
      expect(resultado).toContain("'NEWID()'");
      expect(resultado).toContain('[GETDATE()]');
      expect(resultado).not.toContain("datetime('now')");
    });
  });

  describe('TOP -> LIMIT', () => {
    test.each([
      ['TOP N', 'SELECT TOP 10 Id FROM t', 'SELECT Id FROM t LIMIT 10'],
      ['TOP (N)', 'SELECT TOP (10) Id FROM t', 'SELECT Id FROM t LIMIT 10'],
      ['TOP N PERCENT', 'SELECT TOP 10 PERCENT Id FROM t', 'SELECT Id FROM t LIMIT 10'],
      [
        'TOP com ORDER BY vai depois da ordenação',
        'SELECT TOP 5 Id FROM t ORDER BY Id DESC;',
        'SELECT Id FROM t ORDER BY Id DESC LIMIT 5'
      ],
      [
        'TOP com DISTINCT',
        'SELECT DISTINCT TOP 3 Id FROM t',
        'SELECT DISTINCT Id FROM t LIMIT 3'
      ],
      [
        'TOP dentro de CTE fica dentro da subconsulta',
        'WITH c AS (SELECT TOP 5 Id FROM t) SELECT * FROM c',
        'WITH c AS (SELECT Id FROM t LIMIT 5) SELECT * FROM c'
      ]
    ])('%s', (_nome, entrada, esperado) => {
      expect(translator.translate(entrada)).toBe(esperado);
    });
  });

  describe('IDENTITY -> AUTOINCREMENT', () => {
    test.each([
      [
        'INT existente não duplica INTEGER',
        'CREATE TABLE t (id INT IDENTITY(1,1) PRIMARY KEY)'
      ],
      [
        'INTEGER existente não duplica INTEGER',
        'CREATE TABLE t (id INTEGER IDENTITY(1,1) PRIMARY KEY)'
      ]
    ])('%s', (_nome, entrada) => {
      const resultado = translator.translate(entrada);
      expect(resultado).toContain('INTEGER PRIMARY KEY AUTOINCREMENT');
      expect(resultado).not.toMatch(/IDENTITY/i);
      expect(resultado.match(/\bINTEGER\b/g)).toHaveLength(1);
    });

    test('mantém PRIMARY KEY quando ela vem depois de NOT NULL', () => {
      const resultado = translator.translate(
        'CREATE TABLE t (id INT IDENTITY(1,1) NOT NULL PRIMARY KEY, name TEXT)'
      );
      expect(resultado).toContain('PRIMARY KEY AUTOINCREMENT');
      expect(resultado.match(/PRIMARY KEY/g)).toHaveLength(1);
    });

    test('cria PRIMARY KEY quando a coluna não a declara', () => {
      expect(translator.translate('CREATE TABLE t (id INT IDENTITY(1,1) NOT NULL)')).toContain(
        'INTEGER PRIMARY KEY AUTOINCREMENT'
      );
    });
  });

  describe('tipos de dados em DDL', () => {
    test('converte todos os tipos mapeados dentro de CREATE TABLE', () => {
      const entrada =
        'CREATE TABLE t (a NVARCHAR(50), b VARCHAR(MAX), c CHAR(2), d NCHAR(4), ' +
        'e TEXT, f UNIQUEIDENTIFIER, g XML, h BIT, i DATETIME, j DATETIME2, ' +
        'k SMALLDATETIME, l DATE, m TIME, n MONEY, o SMALLMONEY, p DECIMAL(10,2), ' +
        'q NUMERIC(8), r FLOAT, s REAL, u DOUBLE, v VARBINARY(MAX), w BINARY(8), ' +
        'x IMAGE, y BIGINT, z INT, aa SMALLINT, ab TINYINT)';
      const resultado = translator.translate(entrada);

      for (const tipo of [
        'NVARCHAR', 'VARCHAR', 'NCHAR', 'CHAR(', 'UNIQUEIDENTIFIER', 'XML',
        'DATETIME', 'SMALLDATETIME', 'DATE', 'TIME', 'MONEY', 'DECIMAL',
        'NUMERIC', 'FLOAT', 'DOUBLE', 'VARBINARY', 'BINARY(', 'IMAGE',
        'BIGINT', 'INT', 'SMALLINT', 'TINYINT', 'BIT'
      ]) {
        const escapado = tipo.replace('(', '\\(');
        const padrao = tipo.includes('(')
          ? new RegExp(escapado, 'i')
          : new RegExp(`\\b${escapado}\\b`, 'i');
        expect(resultado).not.toMatch(padrao);
      }
      for (const tipo of ['TEXT', 'INTEGER', 'REAL', 'BLOB']) {
        expect(resultado).toContain(tipo);
      }
    });

    test('converte tipos em ALTER TABLE', () => {
      expect(translator.translate('ALTER TABLE t ADD COLUMN flag BIT')).toBe(
        'ALTER TABLE t ADD COLUMN flag INTEGER'
      );
    });

    test.each([
      ['SELECT CAST(x AS INT) FROM t', 'INT'],
      ["INSERT INTO t (tipo) VALUES ('NVARCHAR')", 'NVARCHAR'],
      ['CREATE VIEW v AS SELECT CAST(x AS INT) AS n FROM t', 'INT']
    ])('não converte tipos fora de CREATE/ALTER TABLE: %s', (entrada, esperado) => {
      expect(translator.translate(entrada)).toContain(esperado);
    });

    test('não confunde datetime() com o tipo DATETIME', () => {
      const resultado = translator.translate(
        'CREATE TABLE t (created DATETIME DEFAULT GETDATE())'
      );
      expect(resultado).toContain("DEFAULT datetime('now')");
      expect(resultado).not.toContain("TEXT('now')");
    });
  });

  describe('CTE, VIEW e TRIGGER', () => {
    test('CTE passa pela tradução SQLite', () => {
      const resultado = translator.translate(
        'WITH c AS (SELECT GETDATE() AS agora FROM t) SELECT * FROM c'
      );
      expect(resultado).toContain('WITH c AS (');
      expect(resultado).toContain("datetime('now')");
    });

    test('CREATE VIEW tem o SQL interno traduzido', () => {
      expect(translator.translate('CREATE VIEW v AS SELECT GETDATE() AS agora FROM t')).toBe(
        "CREATE VIEW v AS SELECT datetime('now') AS agora FROM t"
      );
    });

    test('CREATE TRIGGER tem o SQL interno traduzido', () => {
      const resultado = translator.translate(
        'CREATE TRIGGER trg AFTER INSERT ON t BEGIN SELECT GETDATE(); END'
      );
      expect(resultado).toContain('CREATE TRIGGER');
      expect(resultado).toContain("datetime('now')");
    });
  });

  describe('MERGE', () => {
    test('converte MERGE simples em upsert do SQLite', () => {
      const resultado = translator.translate(
        'MERGE INTO Dest AS T USING Src AS S ON T.id = S.id ' +
          'WHEN MATCHED THEN UPDATE SET name = S.name, qtd = S.qtd ' +
          'WHEN NOT MATCHED THEN INSERT (id, name, qtd) VALUES (S.id, S.name, S.qtd);'
      );
      expect(resultado).toContain('INSERT INTO Dest (id, name, qtd)');
      expect(resultado).toContain('SELECT S.id, S.name, S.qtd FROM Src AS S');
      expect(resultado).toContain('ON CONFLICT (id) DO UPDATE SET');
      expect(resultado).toContain('name = excluded.name');
      expect(resultado).toContain('qtd = excluded.qtd');
      expect(resultado).not.toMatch(/MERGE|WHEN MATCHED/i);
    });
  });

  describe('UPDATE ... JOIN', () => {
    test('converte UPDATE com JOIN antes de SET', () => {
      const resultado = translator.translate(
        'UPDATE Users u JOIN Staging s ON u.id = s.id SET name = s.name WHERE s.flag = 1'
      );
      expect(resultado).toBe(
        'UPDATE Users SET name = s.name WHERE EXISTS ' +
          '(SELECT 1 FROM Staging s WHERE Users.id = s.id AND (s.flag = 1))'
      );
    });

    test('converte UPDATE com FROM ... JOIN depois de SET', () => {
      const resultado = translator.translate(
        'UPDATE u SET name = s.name FROM Users u JOIN Staging s ON u.id = s.id'
      );
      expect(resultado).toContain('UPDATE');
      expect(resultado).toContain('WHERE EXISTS (SELECT 1 FROM Staging s WHERE u.id = s.id)');
      expect(resultado).not.toMatch(/\bJOIN\b/i);
    });
  });

  describe('suporte procedural limitado', () => {
    test('remove DECLARE e substitui referências pelo literal', () => {
      const resultado = translator.translate(
        "DECLARE @name NVARCHAR(50) = 'João'; SELECT * FROM Users WHERE Name = @name"
      );
      expect(resultado).toBe("SELECT * FROM Users WHERE Name = ('João')");
    });

    test('resolve SET encadeado com variáveis declaradas', () => {
      const resultado = translator.translate(
        'DECLARE @id INT = 1; SET @id = @id + 1; SELECT @id'
      );
      expect(resultado).toBe('SELECT ((1) + 1)');
    });

    test('traduz função usada como valor de variável', () => {
      const resultado = translator.translate(
        'DECLARE @agora DATETIME = GETDATE(); SELECT @agora'
      );
      expect(resultado).toBe("SELECT (datetime('now'))");
    });

    test('não substitui @name de parâmetro sem DECLARE', () => {
      const entrada = 'SELECT * FROM t WHERE id = :id AND name = @name';
      expect(translator.translate(entrada)).toBe(entrada);
    });

    test('converte os parâmetros @_msparam_N do SFC em placeholders', () => {
      const entrada = 'SELECT dtb.name FROM master.sys.databases AS dtb WHERE (dtb.name=@_msparam_0)';
      expect(translator.translate(entrada)).toBe(
        'SELECT dtb.name FROM sys.databases AS dtb WHERE (dtb.name=?)'
      );
    });

    test('não substitui @name dentro de literal de texto', () => {
      expect(translator.translate("SELECT '@name' AS texto FROM t")).toBe(
        "SELECT '@name' AS texto FROM t"
      );
    });

    test('desembrulha IF EXISTS usado na inicialização de clientes', () => {
      const resultado = translator.translate(
        "IF EXISTS (SELECT 1 FROM sys.databases WHERE name = 'master') SELECT 7 AS ok"
      );
      expect(resultado).toBe('SELECT 7 AS ok');
    });

    test('desembrulha IF com condição entre parênteses', () => {
      const resultado = translator.translate(
        "IF (OBJECT_ID('tempdb..#tmp') IS NOT NULL) DROP TABLE #tmp; SELECT 9 AS ok"
      );
      expect(resultado).toBe('DROP TABLE _tmp_tmp; SELECT 9 AS ok');
    });

    test('converte DROP TABLE de temporarias do SMO em comandos SQLite validos', () => {
      const resultado = translator.translate(
        'drop table #tmp_db_ars drop table #tmp_db_ags drop table #tmp_sync_states'
      );
      expect(resultado).toBe(
        'DROP TABLE IF EXISTS _tmp_tmp_db_ars; ' +
        'DROP TABLE IF EXISTS _tmp_tmp_db_ags; ' +
        'DROP TABLE IF EXISTS _tmp_tmp_sync_states'
      );
    });

    test('desembrulha BEGIN TRY/CATCH mantendo apenas o TRY', () => {
      const resultado = translator.translate(
        'BEGIN TRY SELECT 1 AS ok END TRY BEGIN CATCH SELECT 2 AS erro END CATCH'
      );
      expect(resultado).toBe('SELECT 1 AS ok');
    });

    test('desembrulha EXEC sp_executesql com literal', () => {
      expect(translator.translate("EXEC sp_executesql N'SELECT 1 AS ok'")).toBe(
        'SELECT 1 AS ok'
      );
    });

    test('desembrulha EXEC sp_executesql com SQL vindo de variável', () => {
      const resultado = translator.translate(
        "DECLARE @sql NVARCHAR(100) = N'SELECT GETDATE() AS agora'; EXEC sp_executesql @sql"
      );
      expect(resultado).toBe("SELECT datetime('now') AS agora");
    });

    test('substitui o batch de descoberta de servidor do SSMS', () => {
      const resultado = translator.translate(
        'CREATE TABLE #SVer(ID int, Name sysname); ' +
          "INSERT #SVer EXEC master.dbo.xp_msver; " +
          "IF EXISTS (SELECT 1 FROM sys.all_objects WHERE name = 'dm_os_host_info') " +
          'BEGIN INSERT #SVer SELECT 1001, host_platform FROM sys.dm_os_host_info END; ' +
          "SELECT CAST(serverproperty(N'Servername') AS sysname) AS [Server_Name]; " +
          'DROP TABLE #SVer'
      );

      expect(resultado).toContain("'LOCAL' AS [Server_Name]");
      expect(resultado).toContain("'16.00.4035.2' AS [VersionString]");
      expect(resultado).not.toMatch(/xp_msver|sys\.all_objects|serverproperty/i);
    });

    test('substitui o batch de versao e protocolo do SSMS', () => {
      const resultado = translator.translate(
        'DECLARE @edition sysname;\r\n' +
          "SET @edition = cast(SERVERPROPERTY(N'EDITION') as sysname);\r\n" +
          "SELECT case when @edition = N'SQL Azure' then 2 else 1 end as 'DatabaseEngineType',\r\n" +
          "SERVERPROPERTY('EngineEdition') AS DatabaseEngineEdition,\r\n" +
          "SERVERPROPERTY('ProductVersion') AS ProductVersion,\r\n" +
          '@@MICROSOFTVERSION AS MicrosoftVersion;\r\n' +
          "select N'Windows' as host_platform\r\n" +
          "if @edition = N'SQL Azure' \r\n" +
          "  select 'TCP' as ConnectionProtocol\r\n" +
          'else\r\n' +
          "  exec ('select CONVERT(nvarchar(40),CONNECTIONPROPERTY(''net_transport'')) as ConnectionProtocol')"
      );

      expect(resultado).toBe(
        'SELECT 1 AS [DatabaseEngineType], 2 AS [DatabaseEngineEdition], ' +
          "'16.00.4035.2' AS [ProductVersion], 16 AS [MicrosoftVersion], " +
          "'Windows' AS [host_platform], 'TCP' AS [ConnectionProtocol]"
      );
    });

    test('substitui a verificacao de AlwaysOn do SMO', () => {
      const sql = [
        'DECLARE @alwayson INT',
        "EXECUTE @alwayson = master.dbo.xp_qv N'3641190370', @@SERVICENAME;",
        'SELECT ISNULL(@alwayson, -1) AS [AlwaysOn]'
      ].join('\n');

      expect(translator.translate(sql)).toBe('SELECT -1 AS [AlwaysOn]');
    });

    test('substitui consultas de catalogo e variaveis do SMO/SSMS', () => {
      expect(translator.translate(
        "IF (@@microsoftversion / 0x01000000) >= 9 AND ISNULL(IS_SRVROLEMEMBER(N'sysadmin'), 0) = 1 " +
          "BEGIN SELECT se.is_admin_endpoint AS N'AdminConnection', " +
          "(SELECT CAST(cfg.value AS bit) FROM sys.configurations AS cfg) AS N'SmoEnabled' " +
          'FROM sys.endpoints se END'
      )).toBe('SELECT CAST(0 AS BIT) AS [AdminConnection], CAST(1 AS BIT) AS [SmoEnabled]');

      // sys.databases e SERVERPROPERTY agora são objetos reais do catálogo.
      expect(translator.translate(
        'SELECT dtb.name AS [Name], dtb.state AS [State] FROM master.sys.databases dtb'
      )).toBe('SELECT dtb.name AS [Name], dtb.state AS [State] FROM sys.databases dtb');

      expect(translator.translate(
        "SELECT CAST(serverproperty(N'Servername') AS sysname) AS [Name]"
      )).toBe("SELECT CAST(serverproperty('Servername') AS TEXT) AS [Name]");

      expect(translator.translate('select @@trancount')).toBe('select 0');
    });

    test('substitui a verificacao de contained authentication do SSMS', () => {
      const resultado = translator.translate(
        'use [master];\r\n' +
          'if (db_id() = 1)\r\nbegin\r\n' +
          '-- contained auth is 0 when connected to master\r\n' +
          'select 0\r\nend\r\nelse\r\nbegin\r\n' +
          "exec('select case when authenticating_database_id = 1 then 0 else 1 end " +
          'from sys.dm_exec_sessions where session_id = @@SPID\')\r\n' +
          'end;use [master];'
      );

      expect(resultado).toBe('SELECT 0 AS [IsContainedAuthentication]');
    });

    test('repassa consultas de catalogo para as tabelas do master', () => {
      expect(translator.translate(
        'SELECT cfg.name AS [Name], cfg.configuration_id AS [Number], ' +
          'cfg.value AS [ConfigValue], cfg.is_dynamic AS [Dynamic], ' +
          'cfg.is_advanced AS [Advanced] FROM sys.configurations AS cfg'
      )).toContain('FROM sys.configurations AS cfg');

      expect(translator.columnTypesFor('SELECT * FROM sys.configurations')).toEqual({
        Dynamic: 'BIT',
        Advanced: 'BIT'
      });
    });

    test('repassa o bitmask de server roles para IS_SRVROLEMEMBER real', () => {
      expect(translator.translate(
        "select is_srvrolemember('sysadmin') * 1 + is_srvrolemember('serveradmin') * 2 " +
        "+ is_srvrolemember('setupadmin') * 4 + is_srvrolemember('securityadmin') * 8"
      )).toContain("is_srvrolemember('sysadmin')");
    });

    test('informa os tipos TDS esperados pelo SMO nos shims', () => {
      expect(translator.columnTypesFor(
        "IF (@@microsoftversion / 0x01000000) >= 9 AND ISNULL(IS_SRVROLEMEMBER(N'sysadmin'), 0) = 1 " +
        "BEGIN SELECT se.is_admin_endpoint AS N'AdminConnection', " +
        "CAST(cfg.value AS bit) AS N'SmoEnabled' FROM sys.endpoints se END"
      )).toEqual({ AdminConnection: 'BIT', SmoEnabled: 'BIT' });

      expect(translator.columnTypesFor(
        'SELECT dtb.name AS [Name], dtb.state AS [State] FROM master.sys.databases dtb'
      )).toMatchObject({ State: 'TINYINT' });

      expect(translator.columnTypesFor("SELECT 'x' AS [Name]")).toBeNull();
    });

    test('informa BIT nas colunas Boolean do PolicyStore do DMF', () => {
      expect(translator.columnTypesFor(
        "SELECT 'PolicyStore[@Name=' AS [Urn], " +
          "CAST((SELECT current_value FROM msdb.dbo.syspolicy_configuration " +
          "WHERE name = 'Enabled') AS bit) AS [Enabled], " +
          "CAST((SELECT current_value FROM msdb.dbo.syspolicy_configuration " +
          "WHERE name = 'LogOnSuccess') AS bit) AS [LogOnSuccess]"
      )).toEqual({
        Urn: 'TEXT',
        Name: 'TEXT',
        Enabled: 'BIT',
        HistoryRetentionInDays: 'INT',
        LogOnSuccess: 'BIT'
      });

      expect(translator.columnTypesFor('SELECT 1 AS [PolicyHealthState]')).toEqual({
        PolicyHealthState: 'INT'
      });
    });

    test('expande o batch de versao do SSMS em tres resultsets', () => {
      const lotes = translator.expandirResultSets(
        'DECLARE @edition sysname; ' +
          "SET @edition = cast(SERVERPROPERTY(N'EDITION') as sysname); " +
          "SELECT case when @edition = N'SQL Azure' then 2 else 1 end as 'DatabaseEngineType', " +
          '@@MICROSOFTVERSION AS MicrosoftVersion; ' +
          "select N'Windows' as host_platform " +
          "exec ('select CONNECTIONPROPERTY(''net_transport'') as ConnectionProtocol')"
      );

      expect(lotes).toHaveLength(3);
      expect(lotes[0]).toContain('1 AS [DatabaseEngineType]');
      expect(lotes[0]).toContain('16 AS [MicrosoftVersion]');
      expect(lotes[1]).toBe("SELECT 'Windows' AS [host_platform]");
      expect(lotes[2]).toBe("SELECT 'TCP' AS [ConnectionProtocol]");
      expect(translator.expandirResultSets('SELECT 1')).toBeNull();
    });

    test('substitui o batch de descoberta de propriedades do servidor', () => {
      const sql = [
        'declare @MasterPath nvarchar(512)',
        "select @MasterPath=substring(physical_name, 1, len(physical_name) - charindex('\\', reverse(physical_name))) from master.sys.database_files where name=N'master'",
        "exec master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'SOFTWARE\\Microsoft\\MSSQLServer\\Setup', N'SQLPath', @SmoRoot OUTPUT",
        "SELECT CAST(case when 'a' <> 'A' then 1 else 0 end AS bit) AS [IsCaseSensitive],",
        '@@MAX_PRECISION AS [MaxPrecision],',
        'CAST(FULLTEXTSERVICEPROPERTY(\'IsFullTextInstalled\') AS bit) AS [IsFullTextInstalled],',
        'CAST(SERVERPROPERTY(N\'IsSingleUser\') AS bit) AS [IsSingleUser],',
        'CAST(SERVERPROPERTY(N\'IsClustered\') AS bit) AS [IsClustered],',
        'SERVERPROPERTY(N\'ComputerNamePhysicalNetBIOS\') AS [ComputerNamePhysicalNetBIOS]'
      ].join('\n');

      const traduzido = translator.translate(sql);
      expect(traduzido).not.toMatch(/xp_instance_regread/i);
      expect(traduzido).toContain('AS [IsCaseSensitive]');
      expect(traduzido).toContain('AS [ComputerNamePhysicalNetBIOS]');
      expect(traduzido).toContain("'Standard Edition (64-bit)' AS [Edition]");
      expect(traduzido).not.toContain('AS [HostPlatform]');
      expect(traduzido).toContain('AS [IsPolyBaseInstalled]');
      expect(translator.columnTypesFor(sql)).toMatchObject({
        ResourceLastUpdateDateTime: 'DATETIME',
        IsCaseSensitive: 'BIT',
        IsFullTextInstalled: 'BIT',
        IsClustered: 'BIT',
        IsSingleUser: 'BIT'
      });
    });

    test('substitui a leitura de BrowserServiceAccount via xp_regread', () => {
      const sql = [
        'declare @HkeyLocal nvarchar(18)',
        'declare @BrowserServiceAccount nvarchar(512)',
        "exec master.sys.xp_regread @HkeyLocal, N'SYSTEM\\CurrentControlSet\\Services\\SQLBrowser', N'ObjectName', @BrowserServiceAccount OUTPUT",
        'SELECT ISNULL(@BrowserServiceAccount,N\'\') AS [BrowserServiceAccount]'
      ].join('\n');

      expect(translator.translate(sql)).toBe("SELECT '' AS [BrowserServiceAccount]");
    });

    test('substitui a leitura de BrowserStartMode via xp_regread', () => {
      const sql = [
        'declare @HkeyLocal nvarchar(18)',
        'declare @BrowserStartMode int',
        "exec master.sys.xp_regread @HkeyLocal, N'SYSTEM\\CurrentControlSet\\Services\\SQLBrowser', N'Start', @BrowserStartMode OUTPUT",
        'SELECT ISNULL(@BrowserStartMode,4) AS [BrowserStartMode]'
      ].join('\n');

      expect(translator.translate(sql)).toBe('SELECT 4 AS [BrowserStartMode]');
    });

    test('devolve valores das propriedades caras via xp_regread generico', () => {
      const sql = [
        'declare @ServiceInstanceId nvarchar(512)',
        "exec master.sys.xp_regread @HkeyLocal, @InstanceNamesRegPath, @@SERVICENAME, @ServiceInstanceId OUTPUT",
        'SELECT ISNULL(@ServiceInstanceId,N\'\') AS [ServiceInstanceId]'
      ].join('\n');

      expect(translator.translate(sql)).toBe("SELECT 'MSSQLSERVER' AS [ServiceInstanceId]");
    });

    test('devolve uma coluna so para o batch de ProcessorUsage do SMO', () => {
      const sql = [
        'create table #tempproc(value int)',
        'insert #tempproc exec msdb.sys.sp_getProcessorUsage',
        'create table #SVer(ID int, Name sysname, Internal_Value int, Value nvarchar(512))',
        'insert #SVer exec master.dbo.xp_msver',
        "SELECT case when OBJECT_ID(N'msdb.sys.sp_getProcessorUsage', N'P') is not null",
        'then (select top 1 value from #tempproc) else -1 end AS [ProcessorUsage]'
      ].join('\n');

      expect(translator.translate(sql)).toBe('SELECT 0 AS [ProcessorUsage]');
    });

    test('devolve uma coluna so para propriedades caras montadas em #SVer', () => {
      const sql = [
        'create table #SVer(ID int, Name sysname, Internal_Value int, Value nvarchar(512))',
        'insert #SVer exec master.dbo.xp_msver',
        'insert #SVer select t.* from sys.dm_os_host_info',
        "SELECT (select cast(cast(Value as numeric(19,4)) as int) from #SVer where Name = N'UsedStorageSizeMB') AS [UsedStorageSizeMB]",
        'drop table #SVer'
      ].join('\n');

      expect(translator.translate(sql)).toBe('SELECT 0 AS [UsedStorageSizeMB]');
      expect(translator.translate(sql.replace('UsedStorageSizeMB]\ndrop', 'HostPlatform]\ndrop')))
        .toBe("SELECT 'Windows' AS [HostPlatform]");
    });

    test('inclui Server_Status no batch de descoberta usado pelo SSMS 19', () => {
      const sql = [
        'create table #SVer(ID int, Name sysname, Internal_Value int, Value nvarchar(512))',
        'insert #SVer exec master.dbo.xp_msver',
        'SELECT',
        "CAST(serverproperty(N'Servername') AS sysname) AS [Server_Name],",
        "'Server[@Name=' + quotename(CAST(serverproperty(N'Servername') AS sysname), '''') + ']' AS [Server_Urn],",
        'CAST(null AS int) AS [Server_ServerType],',
        'CAST(0x0001 AS int) AS [Server_Status],',
        '0 AS [Server_IsContainedAuthentication],',
        '(@@microsoftversion / 0x1000000) & 0xff AS [VersionMajor],',
        '(@@microsoftversion / 0x10000) & 0xff AS [VersionMinor],',
        '@@microsoftversion & 0xffff AS [BuildNumber],',
        "CAST(SERVERPROPERTY('IsSingleUser') AS bit) AS [IsSingleUser],",
        "CAST(SERVERPROPERTY(N'Edition') AS sysname) AS [Edition],",
        "CAST(SERVERPROPERTY('EngineEdition') AS int) AS [EngineEdition],",
        "CAST(ISNULL(SERVERPROPERTY(N'IsXTPSupported'), 0) AS bit) AS [IsXTPSupported],",
        "SERVERPROPERTY(N'ProductVersion') AS [VersionString],",
        "(select Value from #SVer where Name = N'host_platform') AS [HostPlatform],",
        "CAST(FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') AS bit) AS [IsFullTextInstalled]",
        'drop table #SVer'
      ].join('\n');

      const traduzido = translator.translate(sql);
      expect(traduzido).toContain(
        'NULL AS [Server_ServerType], 1 AS [Server_Status], ' +
        '0 AS [Server_IsContainedAuthentication]'
      );
      expect(traduzido.match(/AS \[[A-Za-z_]+\]/g)).toHaveLength(15);
    });

    test('substitui leitura de propriedade via xp_instance_regread', () => {
      const sql = [
        'declare @ErrorLogSizeKb int',
        "exec master.dbo.xp_instance_regread @HkeyLocal, @InstanceRegPath, N'ErrorLogSizeInKb', @ErrorLogSizeKb OUTPUT",
        'SELECT ISNULL(@ErrorLogSizeKb, 0) AS [ErrorLogSizeKb]'
      ].join('\n');

      expect(translator.translate(sql)).toBe('SELECT 0 AS [ErrorLogSizeKb]');
    });

    test('usa colunas proprias no batch completo de propriedades do servidor', () => {
      const sql = [
        'declare @SmoAuditLevel int',
        "exec master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'SOFTWARE\\Microsoft\\MSSQLServer\\MSSQLServer', N'AuditLevel', @SmoAuditLevel OUTPUT",
        'select physical_name from master.sys.database_files where name=N\'master\'',
        'SELECT @SmoAuditLevel AS [AuditLevel],',
        'case when 1=1 then 1 else 0 end AS [PolicyHealthState],',
        'CAST(null AS int) AS [ServerType]'
      ].join('\n');

      const traduzido = translator.translate(sql);
      expect(traduzido).toContain('2 AS [AuditLevel]');
      expect(traduzido).toContain('0 AS [PolicyHealthState]');
      expect(traduzido).toContain('NULL AS [ServiceAccountSid]');
      expect(traduzido).toContain("'MSSQLSERVER' AS [ServiceName]");
      expect(traduzido).not.toContain('AS [HostPlatform]');
      expect(translator.columnTypesFor(sql)).toMatchObject({
        ResourceLastUpdateDateTime: 'DATETIME',
        IsCaseSensitive: 'BIT',
        NamedPipesEnabled: 'BIT',
        TcpEnabled: 'BIT',
        IsHadrEnabled: 'BIT',
        IsPolyBaseInstalled: 'BIT'
      });
    });

    test('remove prefixo N, normaliza CONVERT e variaveis de sistema', () => {
      expect(translator.translate("select SERVERPROPERTY(N'ProductLevel')")).toBe(
        "select SERVERPROPERTY('ProductLevel')"
      );
      expect(translator.translate(
        "SELECT CONVERT(nvarchar(40),CONNECTIONPROPERTY('net_transport')) AS [ConnectionProtocol]"
      )).toBe(
        "SELECT CONVERT('NVARCHAR',CONNECTIONPROPERTY('net_transport')) AS [ConnectionProtocol]"
      );
      expect(translator.translate('select @@SPID, @@MICROSOFTVERSION, @@TRANCOUNT')).toBe(
        'select 1, 268439491, 0'
      );
      expect(translator.translate('SELECT 0x1000000, CAST(0x0001 AS int)')).toBe(
        'SELECT 16777216, CAST(1 AS int)'
      );
      expect(translator.translate("SELECT '0xFF'")).toBe("SELECT '0xFF'");
      expect(translator.translate(
        "SELECT 'Server[@Name=' + quotename('LOCAL', '''') + ']' AS [Server_Urn]"
      )).toBe("SELECT 'Server[@Name=' || quotename('LOCAL', '''') || ']' AS [Server_Urn]");
      expect(translator.translate(
        "SELECT CAST(serverproperty('Servername') AS TEXT) AS [Server_Name], " +
          "'Server[@Name=' + quotename('LOCAL', '''') + ']' AS [Server_Urn]"
      )).toContain("'Server[@Name=' || quotename('LOCAL', '''') || ']'");
      expect(translator.translate(
        "select is_srvrolemember('sysadmin') * 1 + is_srvrolemember('serveradmin') * 2"
      )).toBe("select is_srvrolemember('sysadmin') * 1 + is_srvrolemember('serveradmin') * 2");
    });
  });

  describe('shims de conexão do SSMS/SMO', () => {
    test('remove o schema da funcao de politicas do msdb', () => {
      const entrada =
        'SELECT case when 1=msdb.dbo.fn_syspolicy_is_automation_enabled() ' +
        'then 1 else 0 end AS [PolicyHealthState]';
      const resultado = translator.translate(entrada);
      expect(resultado).toContain('1=fn_syspolicy_is_automation_enabled()');
      expect(resultado).not.toContain('msdb.fn_');
    });

    test('reduz o batch de grupos de disponibilidade ao SELECT final', () => {
      const entrada = [
        'declare @HasViewPermission int',
        "select @HasViewPermission = HAS_PERMS_BY_NAME(null, null, 'VIEW SERVER STATE')",
        'create table #tmp_db_ars (replica_id uniqueidentifier, group_id uniqueidentifier, replica_server_name sysname)',
        'create table #tmp_sync_states (database_id int, sync_state tinyint)',
        'if (@HasViewPermission = 1) begin insert into #tmp_db_ars select replica_id, group_id, replica_server_name from master.sys.availability_replicas end',
        'SELECT dtb.name AS [Database_Name], sync_state.sync_state FROM master.sys.databases AS dtb LEFT OUTER JOIN #tmp_sync_states AS sync_state ON dtb.database_id = sync_state.database_id',
        'drop table #tmp_db_ars',
        'drop table #tmp_sync_states'
      ].join('\r\n');

      const resultado = translator.translate(entrada);
      expect(resultado).not.toMatch(/\bIF\s*\(|\bBEGIN\b|\bEXEC\b/i);
      expect(resultado).toMatch(/CREATE TABLE IF NOT EXISTS _tmp_tmp_db_ars/i);
      expect(resultado).toMatch(/CREATE TABLE IF NOT EXISTS _tmp_tmp_sync_states/i);
      expect(resultado).toContain('AS [Database_Name]');
      expect(resultado).toContain('JOIN _tmp_tmp_sync_states AS sync_state');
      expect(resultado).toMatch(/drop table _tmp_tmp_db_ars\s*;\s*drop table _tmp_tmp_sync_states/i);
    });

    test('remove o bloco IF/EXECUTE de arquivamento remoto mantendo o SELECT', () => {
      const entrada = [
        'CREATE TABLE #tmp_extended_remote_data_archive_tables (object_id int not null)',
        "IF EXISTS(SELECT 1 FROM master.sys.syscolumns WHERE Name = N'remote_data_archive_migration_state')",
        "EXECUTE(N'INSERT INTO #tmp_extended_remote_data_archive_tables SELECT 1')",
        'SELECT tbl.name AS [Name] FROM sys.tables tbl'
      ].join('\r\n');

      const resultado = translator.translate(entrada);
      expect(resultado).toMatch(/CREATE TABLE IF NOT EXISTS _tmp_tmp_extended_remote_data_archive_tables/i);
      expect(resultado).toContain('SELECT tbl.name AS [Name]');
      expect(resultado).not.toMatch(/\bEXECUTE\b/i);
    });
  });

  describe('construtos não suportados', () => {
    test.each([
      [
        'MERGE com DELETE',
        'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE;',
        /MERGE não suportado/
      ],
      [
        'MERGE sem WHEN NOT MATCHED',
        'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET name = s.name;',
        /MERGE não suportado/
      ],
      [
        'MERGE com subconsulta no USING',
        'MERGE INTO t USING (SELECT * FROM s) AS src ON t.id = src.id ' +
          'WHEN MATCHED THEN UPDATE SET name = src.name ' +
          'WHEN NOT MATCHED THEN INSERT (id) VALUES (src.id)',
        /MERGE não suportado/
      ],
      [
        'UPDATE com dois JOINs',
        'UPDATE t JOIN a ON t.id = a.id JOIN b ON t.id = b.id SET x = 1',
        /UPDATE \.\.\. JOIN não suportado/
      ],
      [
        'UPDATE com LEFT JOIN',
        'UPDATE t LEFT JOIN a ON t.id = a.id SET x = 1',
        /UPDATE \.\.\. JOIN não suportado/
      ],
      [
        'UPDATE com JOIN sem ON',
        'UPDATE t JOIN a SET x = 1',
        /UPDATE \.\.\. JOIN não suportado/
      ],
      ['TOP fora de SELECT', 'UPDATE TOP (1) t SET x = 1', /TOP não suportado/],
      [
        'TOP WITH TIES',
        'SELECT TOP 1 WITH TIES Id FROM t ORDER BY Id',
        /TOP \.\.\. WITH TIES não suportado/
      ],
      [
        'IF',
        'DECLARE @x INT = 1 IF @x = 1 SELECT 1',
        /Blocos procedurais.*não suportados/
      ],
      ['WHILE', 'WHILE 1 = 1 SELECT 1', /Blocos procedurais.*não suportados/],
      ['BEGIN...END', 'BEGIN SELECT 1 END', /Blocos procedurais.*não suportados/],
      ['EXEC', 'EXEC proc_teste', /Blocos procedurais.*não suportados/]
    ])('%s lança BadRequestException', (_nome, entrada, mensagem) => {
      expect.assertions(2);
      try {
        translator.translate(entrada);
      } catch (erro) {
        expect(erro.code).toBe('BadRequestException');
        expect(erro.message).toMatch(mensagem);
      }
    });
  });
});
