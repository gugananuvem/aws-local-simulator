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
      expect(resultado).toBe('DROP TABLE #tmp; SELECT 9 AS ok');
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
