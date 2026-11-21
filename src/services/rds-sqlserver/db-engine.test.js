'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DbEngine } = require('./db-engine');
const { SqlTranslator } = require('./sql-translator');

describe('DbEngine (RDS SQL Server)', () => {
  let dataDir;
  let engine;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-sqlserver-db-'));
    engine = new DbEngine(dataDir);
  });

  afterEach(() => {
    if (engine) engine.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('cria o diretório e o arquivo .db com WAL e foreign keys ativados', () => {
    const db = engine.getOrCreateDatabase('principal');

    expect(fs.existsSync(path.join(dataDir, 'principal.db'))).toBe(true);
    expect(engine.databases.has('principal')).toBe(true);
    expect(engine.getOrCreateDatabase('principal')).toBe(db);

    expect(String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase()).toBe('wal');
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
  });

  test('execute detecta SELECT, PRAGMA e WITH e devolve linhas com colunas', () => {
    const simples = engine.execute('principal', "SELECT 1 AS numero, 'ok' AS texto");
    expect(simples.type).toBe('select');
    expect(simples.rows).toEqual([{ numero: 1, texto: 'ok' }]);
    expect(simples.columns.map(coluna => coluna.name)).toEqual(['numero', 'texto']);
    expect(simples.changes).toBe(0);
    expect(simples.lastInsertRowid).toBe(0);

    const pragma = engine.execute('principal', 'PRAGMA journal_mode');
    expect(pragma.type).toBe('select');
    expect(String(pragma.rows[0].journal_mode).toLowerCase()).toBe('wal');

    const cte = engine.execute('principal', 'WITH dados AS (SELECT 7 AS n) SELECT n FROM dados');
    expect(cte.type).toBe('select');
    expect(cte.rows).toEqual([{ n: 7 }]);
  });

  test('execute detecta DDL e DML com contadores de alteração', () => {
    const ddl = engine.execute(
      'principal',
      'CREATE TABLE pessoas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT)'
    );
    expect(ddl).toEqual({ type: 'ddl', rows: [], columns: [], changes: 0, lastInsertRowid: 0 });

    const insert = engine.execute('principal', 'INSERT INTO pessoas (nome) VALUES (?)', ['Ana']);
    expect(insert.type).toBe('dml');
    expect(insert.rows).toEqual([]);
    expect(insert.columns).toEqual([]);
    expect(insert.changes).toBe(1);
    expect(insert.lastInsertRowid).toBe(1);

    const update = engine.execute('principal', "UPDATE pessoas SET nome = 'Bia' WHERE id = 1");
    expect(update.type).toBe('dml');
    expect(update.changes).toBe(1);

    const remove = engine.execute('principal', 'DELETE FROM pessoas WHERE id = 1');
    expect(remove.type).toBe('dml');
    expect(remove.changes).toBe(1);
  });

  test('traduz o SQL bruto antes de detectá-lo e executá-lo', () => {
    const chamadas = [];
    const tradutor = {
      translate(sql) {
        chamadas.push(sql);
        return sql.replace(/GETDATE\(\)/gi, "datetime('now')");
      }
    };
    const comTradutor = new DbEngine(dataDir, tradutor);

    try {
      const sqlBruto = 'SELECT GETDATE() AS agora';
      const resultado = comTradutor.execute('traduzido', sqlBruto);

      expect(chamadas).toEqual([sqlBruto]);
      expect(resultado.type).toBe('select');
      expect(resultado.rows[0].agora).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

      const transacao = comTradutor.beginTransaction('traduzido');
      comTradutor.executeInTransaction(transacao, sqlBruto);
      comTradutor.commit(transacao);
      expect(chamadas).toEqual([sqlBruto, sqlBruto]);
    } finally {
      comTradutor.close();
    }
  });

  test('converte parâmetros nomeados do RPC em placeholders ligados', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());

    try {
      const resultado = comTradutor.execute('parametros', 'SELECT @p AS valor', ['master']);
      expect(resultado.type).toBe('select');
      expect(resultado.rows).toEqual([{ valor: 'master' }]);

      const doSmo = comTradutor.execute(
        'parametros',
        'SELECT @_msparam_0 AS valor',
        ['msdb']
      );
      expect(doSmo.rows).toEqual([{ valor: 'msdb' }]);

      const repetido = comTradutor.execute(
        'parametros',
        'SELECT @dbname AS primeiro, @dbname AS segundo',
        ['master']
      );
      expect(repetido.rows).toEqual([{ primeiro: 'master', segundo: 'master' }]);
    } finally {
      comTradutor.close();
    }
  });

  test('CREATE/DROP DATABASE cria e remove o arquivo e atualiza sys.databases', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute('master', 'CREATE DATABASE NovoBanco');
      expect(comTradutor.listDatabases()).toContain('NovoBanco');
      const listagem = comTradutor.execute('master', "SELECT name FROM sys.databases WHERE name = 'NovoBanco'");
      expect(listagem.rows).toEqual([{ name: 'NovoBanco' }]);

      comTradutor.execute('master', 'DROP DATABASE NovoBanco');
      expect(comTradutor.listDatabases()).not.toContain('NovoBanco');
      const removido = comTradutor.execute('master', "SELECT name FROM sys.databases WHERE name = 'NovoBanco'");
      expect(removido.rows).toEqual([]);
    } finally {
      comTradutor.close();
    }
  });

  test('ignora a limpeza de backuphistory do script de DROP DATABASE', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute('master', 'CREATE DATABASE Historico');
      const limpeza = comTradutor.execute(
        'master',
        "EXEC msdb.dbo.sp_delete_database_backuphistory @database_name = N'Historico'"
      );
      expect(limpeza.type).toBe('ddl');
      comTradutor.execute('master', 'DROP DATABASE Historico');
      expect(comTradutor.listDatabases()).not.toContain('Historico');
    } finally {
      comTradutor.close();
    }
  });

  test('CREATE/EXEC/DROP PROCEDURE registra a rotina e executa o corpo', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute('principal', 'CREATE PROCEDURE TESTE AS SELECT GETDATE() AS agora');
      expect(comTradutor.execute('principal', 'SELECT name FROM sys.procedures').rows)
        .toEqual([{ name: 'TESTE' }]);
      const objeto = comTradutor.execute(
        'principal',
        "SELECT object_id FROM sys.procedures WHERE name = 'TESTE'"
      );
      expect(objeto.rows[0].object_id).toBeGreaterThan(0);

      const definicao = comTradutor.execute('principal', `
        SELECT m.definition FROM sys.sql_modules AS m
        JOIN sys.procedures AS p ON p.object_id = m.object_id
        WHERE p.name = 'TESTE'
      `).rows;
      expect(definicao[0].definition).toContain('GETDATE()');

      const executado = comTradutor.execute('principal', 'EXEC TESTE');
      expect(executado.type).toBe('select');
      expect(executado.rows[0].agora).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

      comTradutor.execute('principal', 'DROP PROCEDURE TESTE');
      expect(comTradutor.execute('principal', 'SELECT name FROM sys.procedures').rows)
        .toEqual([]);
    } finally {
      comTradutor.close();
    }
  });

  test('sys.numbered_procedures nao lista a procedure base ao abrir Modify no SSMS', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute('principal', 'CREATE PROCEDURE PROC_NUMERADA AS SELECT 1');
      const numeros = comTradutor.execute('principal', `
        SELECT nsp.procedure_number AS [Number]
        FROM sys.all_objects AS sp
        INNER JOIN sys.numbered_procedures AS nsp ON nsp.object_id = sp.object_id
        WHERE sp.name = 'PROC_NUMERADA'
      `).rows;
      expect(numeros).toEqual([]);
      const definicoes = comTradutor.execute('principal', `
        SELECT nsp.definition AS [Definition]
        FROM sys.numbered_procedures AS nsp WHERE nsp.name = 'PROC_NUMERADA'
      `).rows;
      expect(definicoes).toEqual([]);
      expect(comTradutor.execute('principal', `
        SELECT sm.definition AS [Definition]
        FROM sys.sql_modules AS sm
        JOIN sys.procedures AS p ON p.object_id = sm.object_id
        WHERE p.name = 'PROC_NUMERADA'
      `).rows[0].Definition).toContain('CREATE PROCEDURE');
      comTradutor.execute('principal', 'DROP PROCEDURE PROC_NUMERADA');
    } finally {
      comTradutor.close();
    }
  });

  test('EXEC de procedure com parametros nomeados e valorPadrao', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute(
        'principal',
        'CREATE PROCEDURE SOMA @a INT, @b INT = 4 AS SELECT @a + @b AS total'
      );
      expect(comTradutor.execute('principal', 'EXEC SOMA @b = 2, @a = 3').rows)
        .toEqual([{ total: 5 }]);
      expect(comTradutor.execute('principal', 'EXEC SOMA 10').rows)
        .toEqual([{ total: 14 }]);
    } finally {
      comTradutor.close();
    }
  });

  test('CREATE FUNCTION escalar registra o corpo e permite chamar a funcao', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    const criacao = [
      'CREATE FUNCTION [dbo].[TOUNIX_TIMESTAMP] (',
      '  @ctimestamp datetime',
      ')',
      'RETURNS integer',
      'AS',
      'BEGIN',
      '  declare @return integer',
      "  SELECT @return = DATEDIFF(SECOND,{d '1970-01-01'}, @ctimestamp)",
      '  return @return',
      'END'
    ].join('\r\n');
    try {
      expect(comTradutor.execute('principal', criacao).rows[0].FunctionCreated).toBe(1);
      expect(comTradutor.execute('principal',
        "SELECT name, type FROM sys.objects WHERE name = 'TOUNIX_TIMESTAMP'"
      ).rows).toEqual([{ name: 'TOUNIX_TIMESTAMP', type: 'FN' }]);

      const chamada = comTradutor.execute('principal',
        "SELECT dbo.TOUNIX_TIMESTAMP({d '1970-01-01 00:00:10'}) AS ts"
      );
      expect(chamada.rows).toEqual([{ ts: 10 }]);

      comTradutor.execute('principal', 'DROP FUNCTION [dbo].[TOUNIX_TIMESTAMP]');
      expect(comTradutor.execute('principal',
        "SELECT name FROM sys.objects WHERE name = 'TOUNIX_TIMESTAMP'"
      ).rows).toEqual([]);
      expect(() => comTradutor.execute('principal',
        "SELECT dbo.TOUNIX_TIMESTAMP({d '1970-01-01 00:00:10'}) AS ts"
      )).toThrow(/Invalid object name/);
    } finally {
      comTradutor.close();
    }
  });

  test('definition de funcao guarda o CREATE completo exigido pelo SMO', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute(
        'principal',
        'CREATE FUNCTION [dbo].[F_DEFINICAO] (@v int) RETURNS int AS BEGIN RETURN @v END'
      );
      const registro = comTradutor.execute('principal', `
        SELECT m.definition FROM sys.sql_modules AS m
        JOIN sys.objects AS o ON o.object_id = m.object_id
        WHERE o.name = 'F_DEFINICAO'
      `).rows[0];
      expect(registro.definition).toContain('CREATE FUNCTION [dbo].[F_DEFINICAO]');
      expect(registro.definition).toContain('RETURNS int');
      expect(comTradutor.execute('principal', 'SELECT dbo.F_DEFINICAO(7) AS v').rows)
        .toEqual([{ v: 7 }]);
      comTradutor.execute('principal', 'DROP FUNCTION [dbo].[F_DEFINICAO]');
    } finally {
      comTradutor.close();
    }
  });

  test('funcao escalar continua disponivel depois de reabrir o database', () => {
    const criacao = [
      'CREATE FUNCTION SEGUNDOS (@valor datetime) RETURNS integer AS',
      'BEGIN',
      '  DECLARE @ret integer',
      "  SELECT @ret = DATEDIFF(SECOND,{d '1970-01-01'}, @valor)",
      '  RETURN @ret',
      'END'
    ].join('\n');
    const primeiro = new DbEngine(dataDir, new SqlTranslator());
    try {
      primeiro.execute('principal', criacao);
    } finally {
      primeiro.close();
    }

    const segundo = new DbEngine(dataDir, new SqlTranslator());
    try {
      expect(segundo.execute('principal',
        "SELECT dbo.SEGUNDOS({d '1970-01-01 00:01:00'}) AS ts"
      ).rows).toEqual([{ ts: 60 }]);
    } finally {
      segundo.close();
    }
  });

  test('CREATE TABLE duplicado retorna o erro 2714 do SQL Server', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute('principal', 'CREATE TABLE clientes (id INT)');
      try {
        comTradutor.execute('principal', 'CREATE TABLE clientes (id INT)');
        throw new Error('CREATE TABLE duplicado deveria falhar');
      } catch (erro) {
        expect(erro.number).toBe(2714);
        expect(erro.state).toBe(1);
        expect(erro.class).toBe(16);
        expect(erro.message).toContain("There is already an object named 'clientes' in the database.");
      }

      const tabelas = comTradutor.execute('principal', 'SELECT name FROM sys.tables').rows;
      expect(tabelas).toEqual([{ name: 'clientes' }]);
    } finally {
      comTradutor.close();
    }
  });

  test('aceita o CREATE TABLE gerado pelo designer do SSMS', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute('principal', `CREATE TABLE [dbo].[TB000](
        [Id] [int] IDENTITY(1,1) NOT NULL,
        [IdUsuario] [nvarchar](21) NULL,
        [DataHora] [int] NOT NULL,
        [Acao] [text] NULL,
        CONSTRAINT [PKTB000] PRIMARY KEY CLUSTERED
        ([Id] ASC)WITH (PAD_INDEX = OFF, IGNORE_DUP_KEY = OFF) ON [PRIMARY]
        ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]`);

      comTradutor.execute('principal',
        "INSERT INTO TB000 (IdUsuario, DataHora, Acao) VALUES ('admin', 1, 'teste')");
      const linhas = comTradutor.execute('principal',
        'SELECT Id, IdUsuario, Acao FROM TB000').rows;
      expect(linhas).toEqual([{ Id: 1, IdUsuario: 'admin', Acao: 'teste' }]);
    } finally {
      comTradutor.close();
    }
  });

  test('lote de refresh do SSMS retorna os databases de usuario apos CREATE', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute('master', 'CREATE DATABASE Ultrapoints2');
      const resultado = comTradutor.execute(
        'master',
        "create table #tmp_sync_states (database_id int, sync_state tinyint); " +
        "SELECT dtb.name AS [Database_Name], dtb.state AS [Database_Status] " +
        "FROM master.sys.databases AS dtb " +
        "LEFT OUTER JOIN #tmp_sync_states AS sync_state ON dtb.database_id = sync_state.database_id " +
        "WHERE (CAST(case when dtb.name in ('master','model','msdb','tempdb') " +
        "then 1 else dtb.is_distributor end AS bit)=0 and " +
        "CAST(isnull(dtb.source_database_id, 0) AS bit)=0) " +
        "ORDER BY [Database_Name] ASC; drop table #tmp_sync_states"
      );

      expect(resultado.rows).toEqual([{ Database_Name: 'Ultrapoints2', Database_Status: 0 }]);
    } finally {
      comTradutor.close();
    }
  });

  test('DROP de database inexistente e CREATE duplicado retornam erro do SQL Server', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      try {
        comTradutor.execute('master', 'DROP DATABASE Inexistente');
        throw new Error('DROP DATABASE deveria falhar');
      } catch (erro) {
        expect(erro.number).toBe(911);
        expect(erro.message).toContain("Database 'Inexistente' does not exist");
      }

      comTradutor.execute('master', 'CREATE DATABASE Duplicado');
      try {
        comTradutor.execute('master', 'CREATE DATABASE Duplicado');
        throw new Error('CREATE DATABASE deveria falhar');
      } catch (erro) {
        expect(erro.number).toBe(1801);
        expect(erro.message).toContain("Database 'Duplicado' already exists");
      }

      try {
        comTradutor.execute('master', 'DROP DATABASE master');
        throw new Error('DROP DATABASE de sistema deveria falhar');
      } catch (erro) {
        expect(erro.number).toBe(1805);
        expect(erro.message).toContain('system database');
      }
      comTradutor.execute('master', 'DROP DATABASE IF EXISTS Inexistente');
      comTradutor.execute('master', 'DROP DATABASE IF EXISTS Duplicado');

      expect(comTradutor.listDatabases()).not.toContain('Duplicado');
    } finally {
      comTradutor.close();
    }
  });

  test('CREATE DATABASE do SMO com opcoes de arquivo e LEDGER', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      const sql = [
        'CREATE DATABASE [BancoSmO]',
        ' CONTAINMENT = NONE',
        " ON  PRIMARY ( NAME = N'BancoSmO', FILENAME = N'BancoSmO.mdf' , SIZE = 5120KB , FILEGROWTH = 10%)",
        " LOG ON ( NAME = N'BancoSmO_log', FILENAME = N'BancoSmO_log.ldf' , SIZE = 1024KB , FILEGROWTH = 10%)",
        ' WITH LEDGER = OFF',
        "; SELECT name, collation_name, containment, is_ledger_on FROM sys.databases WHERE name = 'BancoSmO'"
      ].join('\r\n');

      const resultado = comTradutor.execute('master', sql);
      expect(resultado.rows).toEqual([{
        name: 'BancoSmO',
        collation_name: 'SQL_Latin1_General_CP1_CI_AS',
        containment: 0,
        is_ledger_on: 0
      }]);
      expect(comTradutor.listDatabases()).toContain('BancoSmO');
    } finally {
      comTradutor.close();
    }
  });

  test('CREATE DATABASE nao consome o lote seguinte separado por GO', () => {
    const comTradutor = new DbEngine(dataDir, new SqlTranslator());
    try {
      comTradutor.execute('master', "CREATE DATABASE [BancoGo]\r\nGO\r\nSELECT name FROM sys.databases WHERE name = 'BancoGo'");
      expect(comTradutor.listDatabases()).toContain('BancoGo');
    } finally {
      comTradutor.close();
    }
  });

  test('usa splitBatches do tradutor e retorna o primeiro SELECT do lote', () => {
    const chamadas = [];
    const tradutor = {
      translate(sql) {
        chamadas.push(['translate', sql]);
        return sql;
      },
      splitBatches(sql) {
        chamadas.push(['splitBatches', sql]);
        return sql.split('|');
      }
    };
    const comTradutor = new DbEngine(dataDir, tradutor);

    try {
      const lote = 'CREATE TABLE t (n INTEGER)|INSERT INTO t VALUES (1)|INSERT INTO t VALUES (2)'
        + '|SELECT n FROM t ORDER BY n|SELECT 99 AS ignorado';
      const resultado = comTradutor.execute('lote', lote);

      expect(chamadas[0]).toEqual(['translate', lote]);
      expect(chamadas[1]).toEqual(['splitBatches', lote]);
      expect(resultado.type).toBe('select');
      expect(resultado.rows).toEqual([{ n: 1 }, { n: 2 }]);
      expect(resultado.columns.map(coluna => coluna.name)).toEqual(['n']);
    } finally {
      comTradutor.close();
    }
  });

  test('lote sem splitBatches respeita ; dentro de strings e GO isolado', () => {
    const resultado = engine.execute(
      'lote',
      "CREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT); INSERT INTO t (nome) VALUES ('A;B'); "
        + "SELECT id, nome FROM t;\nGO\nSELECT 99 AS ignorado"
    );

    expect(resultado.type).toBe('select');
    expect(resultado.rows).toEqual([{ id: 1, nome: 'A;B' }]);
  });

  test('lote sem SELECT retorna o último resultado DML relevante', () => {
    engine.execute('lote', 'CREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT)');
    const resultado = engine.execute(
      'lote',
      "INSERT INTO t (nome) VALUES ('Ana'); UPDATE t SET nome = 'Bia' WHERE nome = 'Ana'"
    );
    expect(resultado.type).toBe('dml');
    expect(resultado.changes).toBe(1);
  });

  test('transações confirmam e desfazem alterações via engine tradutor', () => {
    engine.execute('transacoes', 'CREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT)');

    const confirmada = engine.beginTransaction('transacoes');
    expect(typeof confirmada).toBe('string');
    expect(engine.transactions.has(confirmada)).toBe(true);
    engine.executeInTransaction(confirmada, "INSERT INTO t VALUES (1, 'Ana')");
    engine.commit(confirmada);
    expect(engine.execute('transacoes', 'SELECT COUNT(*) AS total FROM t').rows[0].total).toBe(1);

    const desfeita = engine.beginTransaction('transacoes');
    engine.executeInTransaction(desfeita, "INSERT INTO t VALUES (2, 'Bia')");
    engine.rollback(desfeita);
    expect(engine.execute('transacoes', 'SELECT COUNT(*) AS total FROM t').rows[0].total).toBe(1);
    expect(engine.transactions.size).toBe(0);
    expect(() => engine.commit(desfeita)).toThrow(/não encontrada/i);
  });

  test('listDatabases nunca inclui metadata.db', () => {
    fs.writeFileSync(path.join(dataDir, 'metadata.db'), 'metadados');
    engine.execute('clientes', 'SELECT 1 AS n');
    engine.execute('pedidos', 'SELECT 1 AS n');

    const databases = engine.listDatabases();
    expect(databases).toEqual(['clientes', 'pedidos']);
    expect(databases).not.toContain('metadata');
  });

  test('reset remove apenas databases de usuário e preserva metadata.db', () => {
    const metadataPath = path.join(dataDir, 'metadata.db');
    fs.writeFileSync(metadataPath, 'metadados');
    engine.execute('clientes', 'SELECT 1 AS n');
    engine.beginTransaction('clientes');

    engine.reset();

    expect(fs.existsSync(metadataPath)).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'clientes.db'))).toBe(false);
    expect(engine.databases.size).toBe(0);
    expect(engine.transactions.size).toBe(0);
    expect(engine.listDatabases()).not.toContain('clientes');
  });

  test('rejeita nome reservado e tentativas de path traversal', () => {
    const nomesInvalidos = [
      '../fora', '..\\fora', 'pasta/nome', 'pasta\\nome', '/absoluto',
      'C:\\tmp\\x', 'a..b', '', '   ', '.', '..'
    ];

    for (const nome of nomesInvalidos) {
      expect(() => engine.getOrCreateDatabase(nome)).toThrow(/inválido/i);
    }
    expect(() => engine.getOrCreateDatabase('metadata')).toThrow(/reservado/i);
    expect(() => engine.dropDatabase('metadata')).toThrow(/reservado/i);
    expect(engine.databases.size).toBe(0);
    expect(fs.existsSync(path.join(path.dirname(dataDir), 'fora.db'))).toBe(false);
  });

  test('dropDatabase fecha a conexão e apaga o arquivo', () => {
    engine.execute('temporario', 'SELECT 1 AS n');
    engine.dropDatabase('temporario');

    expect(engine.databases.has('temporario')).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'temporario.db'))).toBe(false);
    expect(engine.listDatabases()).not.toContain('temporario');
  });

  test('close é idempotente', () => {
    engine.execute('principal', 'SELECT 1 AS n');
    engine.close();
    expect(() => engine.close()).not.toThrow();
    expect(engine.databases.size).toBe(0);
  });

  test('erros de SQL são propagados sem conversão', () => {
    expect(() => engine.execute('principal', 'SELECT * FROM tabela_inexistente'))
      .toThrow(/no such table/i);
  });
});
