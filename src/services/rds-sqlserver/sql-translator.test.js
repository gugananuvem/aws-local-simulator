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
        'remove CLUSTERED e WITH de PRIMARY KEY composta',
        'CREATE TABLE [dbo].[TB051] ([IdUsuario] [nvarchar](21) NOT NULL, ' +
          '[IDServico] [int] NOT NULL, CONSTRAINT [PK051] PRIMARY KEY CLUSTERED ' +
          '([IdUsuario] ASC, [IDServico] ASC) ' +
          'WITH (PAD_INDEX = OFF, IGNORE_DUP_KEY = OFF) ON [PRIMARY]) ON [PRIMARY]',
        'CREATE TABLE [TB051] ([IdUsuario] TEXT NOT NULL, [IDServico] INTEGER NOT NULL, ' +
          'CONSTRAINT [PK051] PRIMARY KEY ([IdUsuario] ASC, [IDServico] ASC))'
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
      [
        'INSERT com GETDATE()',
        'INSERT INTO t (d) VALUES(GETDATE())',
        'VALUES(unixepoch())'
      ],
      [
        'UPDATE com SYSDATETIME()',
        'UPDATE t SET d = SYSDATETIME() WHERE id = 1',
        'd = unixepoch()'
      ],
      [
        'INSERT com CURRENT_TIMESTAMP',
        'INSERT INTO t (d) VALUES(CURRENT_TIMESTAMP)',
        'VALUES(unixepoch())'
      ]
    ])('grava data/hora como número: %s', (_nome, entrada, esperado) => {
      const resultado = translator.translate(entrada);
      expect(resultado).toContain(esperado);
      expect(resultado).not.toContain("datetime('now')");
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

    test('aceita DROP TABLE IF EXISTS do SQL Server', () => {
      expect(translator.translate('DROP TABLE IF EXISTS dbo.clientes')).toBe(
        'DROP TABLE IF EXISTS clientes'
      );
    });

    test('reescreve fn_helpcollations() para a tabela do catalogo sys', () => {
      const resultado = translator.translate(
        'SELECT cl.name FROM sys.fn_helpcollations() cl ORDER BY cl.name'
      );
      expect(resultado).toBe(
        'SELECT cl.name FROM sys.fn_helpcollations cl ORDER BY cl.name'
      );
    });

    test('traz filegroups e database_files do catalogo local do database', () => {
      const resultado = translator.translate(
        'SELECT g.name FROM sys.filegroups g ' +
        'JOIN sys.database_files f ON f.data_space_id = g.data_space_id'
      );
      expect(resultado).toBe(
        'SELECT g.name FROM main.filegroups g ' +
        'JOIN main.database_files f ON f.data_space_id = g.data_space_id'
      );
    });

    test('preserva bytes em CAST AS varbinary usado pelo SMO', () => {
      const resultado = translator.translate(
        'SELECT CAST(cast(g.name as varbinary(256)) AS sysname) AS [Name] FROM sys.filegroups g'
      );
      expect(resultado).toContain('CAST(cast(g.name AS BLOB) AS TEXT) AS [Name]');
    });

    test('remove COLLATE database_default usado pelo catalogo de arquivos', () => {
      const resultado = translator.translate(
        'SELECT df.name collate database_default AS [Name], ' +
          'df.physical_name collate database_default AS [FileName] ' +
          'FROM sys.database_files AS df'
      );
      expect(resultado).toBe(
        'SELECT df.name AS [Name], df.physical_name AS [FileName] ' +
          'FROM main.database_files AS df'
      );
    });

    test('remove o EXEC de limpeza de backuphistory do script de DROP DATABASE', () => {
      expect(translator.translate(
        "EXEC msdb.dbo.sp_delete_database_backuphistory @database_name = N'Ultrapoints2'"
      )).toBe('');
    });

    test('aceita DDL de CREATE/ALTER/DROP PROCEDURE sem erro de sintaxe', () => {
      expect(translator.translate('CREATE PROCEDURE TESTE AS SELECT GETDATE()')).toBe(
        'SELECT 1 AS [ProcedureCreated]'
      );
      expect(translator.translate('ALTER PROCEDURE dbo.TESTE AS SELECT 1')).toBe(
        'SELECT 1 AS [ProcedureAltered]'
      );
      expect(translator.translate('DROP PROCEDURE IF EXISTS TESTE')).toBe(
        'SELECT 1 AS [ProcedureDropped]'
      );
    });

    test('informa os tipos TDS do catalogo de procedures', () => {
      expect(translator.columnTypesFor(
        'SELECT p.name, p.is_ms_shipped FROM sys.procedures p'
      )).toMatchObject({ IsMSShipped: 'BIT', IsSystemObject: 'BIT' });
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

      expect(translator.translate(
        "SELECT CAST(COALESCE(DATABASEPROPERTYEX('master', 'lastgoodcheckdbtime'), 0) AS datetime) AS [LastGoodCheckDbTime]"
      )).toContain('AS TEXT) AS [LastGoodCheckDbTime]');

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

    test('informa os tipos TDS da aba Filegroups do New Database', () => {
      const sql = [
        'SELECT CAST(g.is_default AS bit) AS [IsDefault],',
        'CAST(ISNULL(sum(gs.size), 0) AS float) AS [Size],',
        'CAST(g.is_autogrow_all_files AS bit) AS [AutogrowAllFiles],',
        'case when 1=1 then 1 else 0 end AS [PolicyHealthState]',
        'FROM master.sys.databases AS dtb, sys.filegroups AS g'
      ].join(' ');
      expect(translator.columnTypesFor(sql)).toMatchObject({
        IsDefault: 'BIT',
        Size: 'FLOAT',
        AutogrowAllFiles: 'BIT',
        PolicyHealthState: 'INT'
      });
    });

    test('declara FLOAT na query isolada de tamanho do log do New Database', () => {
      const sql = 'SELECT s.size * CONVERT(float,8) AS [Size] ' +
        'FROM sys.database_files AS s WHERE (s.type = 1)';
      expect(translator.columnTypesFor(sql)).toMatchObject({ Size: 'FLOAT' });
    });

    test('traduz CHARINDEX do T-SQL para instr do SQLite', () => {
      const sql =
        "SELECT case when CHARINDEX(N'_CS_', dtb.collation_name) > 0 then 1 else 0 end " +
        'AS [CaseSensitive] FROM master.sys.databases AS dtb';
      const traduzido = translator.translate(sql);
      expect(traduzido).toContain("instr(dtb.collation_name, '_CS_')");
      expect(traduzido).not.toMatch(/CHARINDEX/i);
    });

    test('substitui o batch de propriedades do database do SMO (#tempbackup)', () => {
      const sql = [
        'create table #tempbackup (database_name nvarchar(128), [type] char(1), backup_finish_date datetime)',
        "insert into #tempbackup select database_name, [type], max(backup_finish_date) from msdb..backupset where [type] = 'D' group by database_name, [type]",
        'create table #tmp_db_encryption_keys (database_id int)',
        'declare @HasViewPermission int',
        "select @HasViewPermission = HAS_PERMS_BY_NAME(null, null, 'VIEW SERVER STATE')",
        'if (@HasViewPermission = 1) begin insert into #tmp_db_encryption_keys select database_id from master.sys.dm_database_encryption_keys end',
        'SELECT dtb.name AS [Name] FROM master.sys.databases AS dtb WHERE (dtb.name=@_msparam_3)'
      ].join('\n');

      const traduzido = translator.translate(sql);
      expect(traduzido).toContain('AS [Name]');
      expect(traduzido).toContain('AS [IsDatabaseSnapshotBase]');
      expect(traduzido).toContain('AS [MirroringID]');
      expect(traduzido).toContain("'00000000-0000-0000-0000-000000000000'");
      expect(traduzido).not.toMatch(/#tempbackup/i);
      expect(traduzido).not.toMatch(/\bIF\b|\bBEGIN\b/i);
    });

    test('declara os tipos TDS das colunas que o SMO lê com cast específico', () => {
      const sql = [
        'create table #tempbackup (database_name nvarchar(128), backup_finish_date datetime)',
        'SELECT dtb.name AS [Name] FROM master.sys.databases AS dtb WHERE (dtb.name=@_msparam_3)'
      ].join(' ');
      expect(translator.columnTypesFor(sql)).toMatchObject({
        Size: 'FLOAT',
        IsDatabaseSnapshotBase: 'BIT',
        MirroringID: 'UNIQUEIDENTIFIER',
        CreateDate: 'DATETIME',
        IsSystemObject: 'BIT'
      });

      expect(
        translator.columnTypesFor("SELECT CAST(ISNULL(SERVERPROPERTY(N'IsXTPSupported'), 0) AS bit) AS [IsXTPSupported]")
      ).toEqual({ IsXTPSupported: 'BIT' });
      expect(
        translator.columnTypesFor('SELECT (select physical_memory_in_use_kb from sys.dm_os_process_memory) AS [PhysicalMemoryUsageInKB]')
      ).toEqual({ PhysicalMemoryUsageInKB: 'BIGINT' });
      expect(
        translator.columnTypesFor(
          'SELECT CAST(case when ((SELECT MAX(data_compression) FROM sys.partitions WHERE object_id = tbl.object_id) > 0) then 1 else 0 end AS bit) AS [HasCompressedPartitions] FROM sys.tables AS tbl'
        )
      ).toMatchObject({ HasCompressedPartitions: 'BIT' });
      expect(
        translator.columnTypesFor(
          'SELECT CAST(case when ((SELECT MAX(case when xml_compression = 1 then 1 else 0 end) FROM sys.partitions WHERE object_id = tbl.object_id) > 0) then 1 else 0 end AS bit) AS [HasXmlCompressedPartitions] FROM sys.tables AS tbl'
        )
      ).toEqual({ HasXmlCompressedPartitions: 'BIT' });
    });

    test('declara DOUBLE nas consultas auxiliares de tamanho do database', () => {
      const sql = [
        'SELECT (SELECT SUM(CAST(df.size as float)) FROM sys.database_files AS df WHERE df.type in (0,2,4)) AS [DbSize],',
        '(SELECT SUM(CAST(df.size as float)) FROM sys.database_files AS df WHERE df.type in (1,3)) AS [LogSize]'
      ].join(' ');
      expect(translator.columnTypesFor(sql)).toMatchObject({
        DbSize: 'FLOAT',
        LogSize: 'FLOAT'
      });

      expect(translator.columnTypesFor(
        'SELECT CAST(0 AS float) AS [SpaceAvailable] FROM master.sys.databases AS dtb WHERE (dtb.name=@_msparam_0)'
      )).toMatchObject({ SpaceAvailable: 'FLOAT' });
    });

    test('converte filtros nvarchar booleanos da consulta de procedures do SSMS', () => {
      const sql = [
        'SELECT sp.name AS [Name], ISNULL(sm.uses_native_compilation,0) AS [IsNativelyCompiled]',
        'FROM sys.all_objects AS sp',
        'LEFT OUTER JOIN sys.all_sql_modules AS sm ON sm.object_id = sp.object_id',
        'WHERE (sp.type = @_msparam_0)',
        'and(CAST(case when sp.is_ms_shipped = 1 then 1 else 0 end AS bit)=@_msparam_3',
        'and ISNULL(sm.uses_native_compilation,0)=@_msparam_4)'
      ].join(' ');

      const traduzido = translator.translate(sql);
      expect(traduzido).toContain('AS bit)=CAST(? AS INTEGER)');
      expect(traduzido).toContain('uses_native_compilation,0)=CAST(? AS INTEGER)');
      expect(traduzido.match(/CAST\(\? AS INTEGER\)/g)).toHaveLength(2);
    });

    test('traduz literais de data ODBC e remove o qualificador dbo. de funcoes', () => {
      const sql = "SELECT dbo.TOUNIX_TIMESTAMP({d '1970-01-01'}) AS ts";
      expect(translator.translate(sql)).toBe(
        "SELECT TOUNIX_TIMESTAMP('1970-01-01') AS ts"
      );
    });

    test('remove USE no meio do batch sem afetar o comando isolado', () => {
      expect(translator.translate('use [master];select 1 AS [ok]')).toBe(
        'select 1 AS [ok]'
      );
      expect(translator.translate('use [model]')).toBe('use [model]');
    });

    test('traduz dm_io_virtual_file_stats(default, default) como tabela', () => {
      const sql =
        'SELECT ISNULL(fs.num_of_writes, 0) AS [NumberOfDiskWrites] ' +
        'FROM sys.dm_io_virtual_file_stats(default, default) AS fs';
      const traduzido = translator.translate(sql);
      expect(traduzido).toContain('sys.dm_io_virtual_file_stats AS fs');
      expect(traduzido).not.toMatch(/dm_io_virtual_file_stats\s*\(/i);
      expect(translator.columnTypesFor(sql)).toEqual({ NumberOfDiskWrites: 'BIGINT' });
    });

    test('substitui o batch #tempspace de espaco livre em disco', () => {
      const sql = [
        'CREATE TABLE #tempspace (value BIGINT)',
        "IF (SERVERPROPERTY('EngineEdition') = 11) INSERT INTO #tempspace VALUES(-1)",
        "ELSE IF (OBJECT_ID(N'msdb.sys.sp_getVolumeFreeSpace', N'P')) is null INSERT INTO #tempspace VALUES(-1)",
        'SELECT TOP 1 value AS [freebytes] FROM #tempspace',
        'DROP TABLE #tempspace'
      ].join('\n');
      expect(translator.translate(sql)).toBe('SELECT -1 AS [freebytes]');
      expect(translator.columnTypesFor(sql)).toEqual({ freebytes: 'BIGINT' });
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

    test('substitui o batch enxuto de caminhos da aba Filegroups', () => {
      const sql = [
        'declare @MasterPath nvarchar(512)',
        'declare @LogPath nvarchar(512)',
        "declare @Slash varchar = convert(varchar, serverproperty('PathSeparator'))",
        "if (SERVERPROPERTY('EngineEdition') = 8)",
        'begin',
        'select @MasterPath=substring(physical_name, 1, 1) from master.sys.database_files where file_id = 1',
        'end',
        'else',
        'begin',
        "select @MasterPath=substring(physical_name, 1, 1) from master.sys.database_files where name=N'master'",
        "select @LogPath=substring(physical_name, 1, 1) from master.sys.database_files where name=N'mastlog'",
        'end',
        'SELECT @MasterPath AS [MasterDBPath], @LogPath AS [MasterDBLogPath]'
      ].join('\n');

      const traduzido = translator.translate(sql);
      expect(traduzido).toBe(
        "SELECT 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA' " +
          "AS [MasterDBPath], 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA' " +
          'AS [MasterDBLogPath]'
      );
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

    test('devolve todas as colunas do batch de Settings do SMO', () => {
      const sql = [
        'declare @SmoAuditLevel int',
        "exec master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\\Microsoft\\MSSQLServer\\MSSQLServer', N'AuditLevel', @SmoAuditLevel OUTPUT",
        'declare @NumErrorLogs int',
        "exec master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\\Microsoft\\MSSQLServer\\MSSQLServer', N'NumErrorLogs', @NumErrorLogs OUTPUT",
        'declare @SmoPerfMonMode int',
        "exec master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\\Microsoft\\MSSQLServer\\MSSQLServer', N'Performance', @SmoPerfMonMode OUTPUT",
        'SELECT',
        '@SmoAuditLevel AS [AuditLevel],',
        'ISNULL(@NumErrorLogs, -1) AS [NumberOfLogFiles],',
        "ISNULL(SERVERPROPERTY('instancedefaultdatapath'),'') AS [DefaultFile],",
        "SERVERPROPERTY('instancedefaultlogpath') AS [DefaultLog],",
        '@SmoPerfMonMode AS [PerfMonMode]'
      ].join('\n');

      const traduzido = translator.translate(sql);
      expect(traduzido).toContain('AS [AuditLevel]');
      expect(traduzido).toContain('AS [NumberOfLogFiles]');
      expect(traduzido).toContain('AS [DefaultFile]');
      expect(traduzido).toContain("'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA' AS [DefaultLog]");
      expect(traduzido).toContain('AS [PerfMonMode]');
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
    test('remove colchetes de nomes qualificados do catalogo', () => {
      expect(
        translator.translate('SELECT TOP (1000) * FROM [master].[sys].[all_objects]')
      ).toBe('SELECT * FROM main.all_objects LIMIT 1000');
    });

    test('remove o qualificador de database em nomes de tres partes', () => {
      expect(translator.translate('SELECT * FROM Ultrapoints2.dbo.TB000'))
        .toBe('SELECT * FROM TB000');
      expect(translator.translate('SELECT * FROM [Ultrapoints2].[dbo].[TB000]'))
        .toBe('SELECT * FROM [TB000]');
      expect(translator.translate('SELECT * FROM [Ultrapoints2].dbo.[TB000] AS t'))
        .toBe('SELECT * FROM [TB000] AS t');
      expect(translator.translate('SELECT * FROM LOCAL.Ultrapoints2.dbo.TB000'))
        .toBe('SELECT * FROM TB000');
      expect(translator.translate('SELECT * FROM [LOCAL].[Ultrapoints2].[dbo].[TB000]'))
        .toBe('SELECT * FROM [TB000]');
    });

    test('preserva databases de sistema qualificados', () => {
      expect(translator.translate('SELECT * FROM master.dbo.sysdatabases'))
        .toBe('SELECT * FROM master.sysdatabases');
      expect(translator.translate('SELECT * FROM msdb.dbo.syspolicy_configuration'))
        .toBe('SELECT * FROM msdb.syspolicy_configuration');
    });

    test('traduz sys.system_views e sys.all_objects para o catalogo local', () => {
      expect(translator.translate('SELECT name FROM sys.system_views')).toContain('FROM main.system_views');
      expect(translator.translate('SELECT name FROM sys.all_objects')).toContain('FROM main.all_objects');
    });

    test('traduz sys.numbered_procedures para o catalogo local', () => {
      expect(
        translator.translate('SELECT procedure_number FROM sys.numbered_procedures')
      ).toContain('FROM main.numbered_procedures');
      expect(translator.columnTypesFor(
        'SELECT nsp.procedure_number AS [Number] FROM sys.numbered_procedures AS nsp'
      )).toEqual({ Number: 'SMALLINT' });
      expect(translator.translate(
        'SELECT nsp.definition FROM sys.numbered_procedures AS nsp ' +
        'WHERE nsp.procedure_number = @_msparam_0'
      )).toContain('procedure_number = CAST(? AS INTEGER)');
    });

    test('remove o envelope BEGIN/END da lista de parametros de procedure numerada', () => {
      const sql = [
        'Begin',
        '  With mycte(object_id, procedure_number, name, parameter_id,',
        '    system_type_id, user_type_id, max_length, precision,',
        '    scale, is_output, is_cursor_ref, default_value)',
        '  as (select object_id, procedure_number, name, parameter_id,',
        '    system_type_id, user_type_id, max_length, precision,',
        '    scale, is_output, is_cursor_ref, null as default_value',
        '    FROM sys.numbered_procedure_parameters)',
        '',
        'SELECT param.parameter_id AS [ID], param.name AS [Name]',
        'FROM sys.all_objects AS sp',
        'INNER JOIN sys.numbered_procedures AS nsp ON nsp.object_id = sp.object_id',
        'INNER JOIN mycte AS param ON param.object_id = nsp.object_id',
        '  AND CAST(param.procedure_number AS int) = nsp.procedure_number',
        'WHERE nsp.procedure_number = @_msparam_0',
        'ORDER BY [ID] ASC',
        'end'
      ].join('\n');
      const traduzido = translator.translate(sql);
      expect(traduzido).not.toMatch(/\bbegin\b|\bend\b/i);
      expect(traduzido).toContain('main.all_parameters AS param');
      expect(traduzido).toContain('procedure_number = CAST(? AS INTEGER)');
    });

    test('preenche Text e BodyStartIndex ao gerar o script de procedure numerada', () => {
      const sql =
        'SELECT NULL AS [Text], NULL AS [BodyStartIndex], nsp.definition AS [Definition] ' +
        'FROM sys.numbered_procedures AS nsp WHERE nsp.procedure_number = @_msparam_0';
      const traduzido = translator.translate(sql);
      expect(traduzido).toContain('nsp.definition AS [Text]');
      expect(traduzido).toContain("instr(nsp.definition, 'BEGIN') - 1");
      expect(traduzido).not.toContain('NULL AS [Text]');
      expect(traduzido).not.toContain('NULL AS [BodyStartIndex]');
    });

    test('devolve opcoes do usuario como bit para o Script() de funcoes', () => {
      const sql =
        'declare @UserOption int ' +
        "select @UserOption=convert(int, c.value) from sys.configurations c where c.name='user options' " +
        'SELECT CAST(@UserOption & 1 AS bit) AS [DisableDefaultConstraintCheck], ' +
        'CAST(@UserOption & 16 AS bit) AS [AnsiNulls]';
      expect(translator.translate(sql)).toBe(
        'SELECT CAST(0 AS bit) AS [DisableDefaultConstraintCheck], ' +
        'CAST(0 AS bit) AS [AnsiNulls]'
      );
      expect(translator.columnTypesFor(sql)).toEqual(expect.objectContaining({
        AnsiNulls: 'BIT',
        QuotedIdentifier: 'BIT',
        DisableDefaultConstraintCheck: 'BIT'
      }));
    });

    test('converte is_output parametrico para INTEGER no script de funcoes', () => {
      const sql =
        'SELECT CAST(1 AS bit) AS [IsNativelyCompiled], ret_param.is_output ' +
        'FROM sys.all_objects AS udf WHERE ret_param.is_output = @_msparam_0';
      expect(translator.translate(sql)).toContain('is_output = CAST(? AS INTEGER)');
    });

    test('informa os tipos TDS esperados pelo SMO nas views de sistema', () => {
      expect(translator.columnTypesFor(
        'SELECT CAST(CASE WHEN 1=1 THEN 1 ELSE 0 END AS bit) AS [IsEncrypted] ' +
        'FROM sys.all_views v'
      )).toMatchObject({
        IsEncrypted: 'BIT',
        IsSchemaBound: 'BIT',
        HasClusteredIndex: 'BIT',
        ReturnsViewMetadata: 'BIT',
        HasAfterTrigger: 'BIT',
        HasNonClusteredIndex: 'BIT',
        DateLastModified: 'DATETIME',
        LedgerViewType: 'TINYINT',
        IsDroppedLedgerView: 'BIT',
        CreateDate: 'DATETIME'
      });
    });

    test('preenche [Text] da view para o SMO gerar o ALTER VIEW', () => {
      const sql = [
        'SELECT v.name AS [Name], NULL AS [Text],',
        'ISNULL(smv.definition, ssmv.definition) AS [Definition]',
        'FROM sys.all_views AS v',
        'LEFT OUTER JOIN sys.sql_modules AS smv ON smv.object_id = v.object_id',
        'LEFT OUTER JOIN sys.system_sql_modules AS ssmv ON ssmv.object_id = v.object_id'
      ].join(' ');
      expect(translator.translate(sql)).toContain(
        'COALESCE(smv.definition, ssmv.definition) AS [Text]'
      );
    });

    test('informa os tipos TDS das opcoes de Query Store no script do database', () => {
      expect(translator.columnTypesFor(
        'SELECT dqso.actual_state AS [ActualState], ' +
        'dqso.current_storage_size_mb AS [CurrentStorageSizeInMB], ' +
        'dqso.query_capture_mode AS [QueryCaptureMode] ' +
        'FROM sys.database_query_store_options AS dqso'
      )).toEqual(expect.objectContaining({
        ActualState: 'TINYINT',
        CurrentStorageSizeInMB: 'BIGINT',
        QueryCaptureMode: 'TINYINT'
      }));
    });

    test('informa os tipos TDS de check_constraints no script da tabela', () => {
      expect(translator.columnTypesFor(
        'SELECT cstr.name AS [Name], cstr.is_not_for_replication AS [NotForReplication], ' +
        '~cstr.is_not_trusted AS [IsChecked], ~cstr.is_disabled AS [IsEnabled], ' +
        'CAST(cstr.is_system_named AS bit) AS [IsSystemNamed] ' +
        'FROM sys.tables AS tbl INNER JOIN sys.check_constraints AS cstr ' +
        'ON cstr.parent_object_id = tbl.object_id'
      )).toEqual(expect.objectContaining({
        NotForReplication: 'BIT',
        IsChecked: 'BIT',
        IsEnabled: 'BIT',
        IsSystemNamed: 'BIT'
      }));
    });

    test('informa BIT e DATETIME nas colunas da lista de procedures e funcoes', () => {
      const sql =
        'SELECT sp.name AS [Name], ' +
        'CAST(CASE WHEN ISNULL(smsp.definition, ssmsp.definition) IS NULL THEN 1 ELSE 0 END AS bit) AS [IsEncrypted], ' +
        'ISNULL(sm.uses_native_compilation,0) AS [IsNativelyCompiled] ' +
        'FROM sys.all_objects AS sp';
      expect(translator.columnTypesFor(sql)).toEqual({
        IsEncrypted: 'BIT',
        IsNativelyCompiled: 'BIT',
        ImplementationType: 'INT',
        FunctionType: 'INT',
        CreateDate: 'DATETIME',
        IsSchemaOwned: 'BIT',
        IsSystemObject: 'BIT',
        AnsiNullsStatus: 'BIT',
        QuotedIdentifierStatus: 'BIT',
        IsSchemaBound: 'BIT',
        ReturnsNullOnNullInput: 'BIT',
        IsDeterministic: 'BIT',
        IsInlineable: 'BIT',
        Recompile: 'BIT',
        Startup: 'BIT',
        ForReplication: 'BIT',
        InlineType: 'TINYINT',
        XmlDocumentConstraint: 'TINYINT'
      });
    });

    test('converte o parametro de FunctionType da lista de funcoes para INTEGER', () => {
      const sql =
        "SELECT (case when 'FN' = udf.type then 1 else 0 end) AS [FunctionType], " +
        'ISNULL(sm.uses_native_compilation,0) AS [IsNativelyCompiled] ' +
        'FROM sys.all_objects AS udf ' +
        "WHERE (case when 'FN' = udf.type then 1 else 0 end)=@_msparam_0 " +
        'and CAST(case when udf.is_ms_shipped = 1 then 1 else 0 end AS bit)=@_msparam_1';
      const traduzido = translator.translate(sql);
      expect(traduzido).toContain('end)=CAST(? AS INTEGER)');
      expect(traduzido).toContain('AS bit)=CAST(? AS INTEGER)');
    });

    test('informa DECIMAL(38,0) nas colunas de identity do SMO', () => {
      expect(translator.columnTypesFor(
        'SELECT clmns.name AS [DataType], ' +
        'CAST(ISNULL(ic.seed_value,0) AS numeric(38)) AS [IdentitySeedAsDecimal], ' +
        'CAST(ISNULL(ic.increment_value,0) AS numeric(38)) AS [IdentityIncrementAsDecimal] ' +
        'FROM sys.tables AS tbl INNER JOIN sys.all_columns AS clmns ON clmns.object_id=tbl.object_id'
      )).toMatchObject({
        IdentitySeedAsDecimal: 'DECIMAL(38,0)',
        IdentityIncrementAsDecimal: 'DECIMAL(38,0)'
      });
    });

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

    test('remove o bloco IF/EXEC de retencao de dados mantendo o SELECT de Database', () => {
      const entrada = [
        'create table #temp_data_retention_property (db_id int not null, is_data_retention_enabled bit)',
        "if serverproperty('engineedition') = 9",
        "exec sp_executesql N'insert into #temp_data_retention_property " +
          "select dr_db.database_id, dr_db.is_data_retention_enabled from sys.databases dr_db'",
        'SELECT dtb.is_ansi_null_default_on AS [AnsiNullDefault], dtb.name AS [Name] ' +
          'FROM master.sys.databases AS dtb WHERE (dtb.name=@_msparam_0)',
        'drop table #temp_data_retention_property'
      ].join('\r\n');

      const resultado = translator.translate(entrada);
      expect(resultado).toMatch(/CREATE TABLE IF NOT EXISTS _tmp_temp_data_retention_property/i);
      expect(resultado).toContain('AS [AnsiNullDefault]');
      expect(resultado).not.toMatch(/\bEXEC\b|\bIF\s+serverproperty/i);
    });

    test('remove o batch de propriedades de tabela do SMO 19', () => {
      const entrada = [
        'create table #temp_data_retention_table_property (object_id int not null, data_retention_period int not null, data_retention_period_unit int not null, data_deletion_filter_column_name sysname not null)',
        "if serverproperty('engineedition') = 9",
        "exec sp_executesql N'insert into #temp_data_retention_table_property select dr_tbl.object_id from sys.tables dr_tbl'",
        'create table #external_data (object_id int not null)',
        'insert into #external_data select tbl.object_id from sys.tables tbl LEFT OUTER JOIN sys.external_tables AS et ON et.object_id = tbl.object_id',
        'create table #tmp_ledger_details (object_id int)',
        'create table #tmp_ledger_view_column_names (object_id int)',
        'INSERT INTO #tmp_ledger_view_column_names SELECT t_obj_id, [ledger_transaction_id_column_name] = MAX(CASE WHEN ledger_view_column_type = 1 THEN c_name ELSE NULL END) FROM ( SELECT t.object_id as t_obj_id FROM sys.tables as t CROSS APPLY ( SELECT 1 ) a ) as x GROUP BY x.t_obj_id',
        'SELECT CAST(case when ((SELECT MAX(data_compression) FROM sys.partitions WHERE object_id = tbl.object_id) > 0) then 1 else 0 end AS bit) AS [HasCompressedPartitions]',
        'FROM sys.tables AS tbl',
        'drop table #temp_data_retention_table_property'
      ].join('\r\n');

      const resultado = translator.translate(entrada);
      expect(resultado).toMatch(/CREATE TABLE IF NOT EXISTS _tmp_temp_data_retention_table_property/i);
      expect(resultado).toMatch(/CREATE TABLE IF NOT EXISTS _tmp_external_data/i);
      expect(resultado).not.toMatch(/\bEXEC\b|\bIF\s+serverproperty/i);
      expect(resultado).not.toMatch(/CROSS APPLY/i);
      expect(resultado).toMatch(/_tmp_tmp_ledger_view_column_names\s*\([^)]*\)\s*;\s*SELECT/i);
      expect(resultado).toContain('AS [HasCompressedPartitions]');
      expect(resultado).toContain('FROM main.partitions');
      expect(resultado).toContain('main.external_tables');
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
