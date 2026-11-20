'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DbEngine } = require('../db-engine');
const { DataApiHandler } = require('../data-api');
const SqlTranslator = require('../sql-translator');
const { RoutineService } = require('./index');
const { parseBody, parseCall, parseCreateRoutine, parseDropRoutine } = require('./routine-parser');
const { bindNamedValues } = require('./sql-bindings');

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('Aurora routines', () => {
  let dataDir;
  let dbEngine;
  let service;
  let dataApi;
  const dbName = 'routines_test';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-routines-test-'));
    dbEngine = new DbEngine(dataDir);
    service = new RoutineService(dbEngine);
    dataApi = new DataApiHandler(dbEngine, null, {
      getClusterByArn: () => ({
        DBClusterIdentifier: 'test-cluster',
        Engine: 'aurora-mysql',
        DatabaseName: dbName,
      }),
    }, logger);
    dataApi.routineService = service;
    dbEngine.execute(dbName, 'CREATE TABLE nums (n INTEGER)');
    dbEngine.execute(dbName, 'INSERT INTO nums (n) VALUES (1), (2), (3)');
  });

  afterAll(() => {
    dbEngine.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe('parser', () => {
    test('interpreta PROCEDURE MySQL com IN/OUT e blocos de controle', () => {
      const definition = parseCreateRoutine(`
        CREATE PROCEDURE soma(IN limite INT, OUT total INT)
        BEGIN
          DECLARE i INT DEFAULT 0;
          SET total = 0;
          WHILE i < limite DO
            SET total = total + i;
            SET i = i + 1;
          END WHILE;
          SELECT :total AS resultado;
        END
      `, 'aurora-mysql');

      expect(definition.kind).toBe('procedure');
      expect(definition.name).toBe('soma');
      expect(definition.parameters).toEqual([
        { name: 'limite', mode: 'IN', type: 'INTEGER' },
        { name: 'total', mode: 'OUT', type: 'INTEGER' },
      ]);

      const body = parseBody(definition.body);
      expect(body.map((node) => node.type)).toEqual([
        'declare', 'set', 'while', 'sql',
      ]);
      expect(body[2].condition).toBe('i < limite');
      expect(body[2].statements).toHaveLength(2);
    });

    test('interpreta FUNCTION PostgreSQL com dollar quoting', () => {
      const definition = parseCreateRoutine(`
        CREATE OR REPLACE FUNCTION triplo(x int) RETURNS int
        AS $$ BEGIN RETURN x * 3; END; $$ LANGUAGE plpgsql
      `, 'aurora-postgresql');

      expect(definition.kind).toBe('function');
      expect(definition.name).toBe('triplo');
      expect(definition.returns).toBe('INTEGER');
      expect(definition.language).toBe('plpgsql');
      expect(definition.body).toContain('RETURN x * 3');
      expect(parseBody(definition.body)[0].statements[0]).toMatchObject({
        type: 'return',
        expression: 'x * 3',
      });
    });

    test('interpreta DROP e CALL com argumentos nomeados', () => {
      expect(parseDropRoutine('DROP PROCEDURE IF EXISTS soma')).toEqual({
        kind: 'procedure', ifExists: true, name: 'soma',
      });
      expect(parseCall('CALL soma(:limite, @total)')).toEqual({
        name: 'soma', args: [':limite', '@total'],
      });
    });
  });

  describe('catálogo e executor', () => {
    test('executa PROCEDURE com OUT, variável de sessão e SELECT interno', () => {
      service.create(dbName, 'aurora-mysql', `
        CREATE PROCEDURE soma(IN limite INT, OUT total INT)
        BEGIN
          DECLARE i INT DEFAULT 0;
          SET total = 0;
          WHILE i < limite DO
            SET total = total + i;
            SET i = i + 1;
          END WHILE;
          SELECT :total AS resultado;
        END
      `);

      const { boundSql, bindings } = bindNamedValues('CALL soma(:limite, @total)', { limite: 5 });
      const result = service.call(dbName, { sql: boundSql, bindings });

      expect(result.rows).toEqual([{ resultado: 10 }]);
      expect(result.outValues).toEqual({ total: 10 });
      expect(service.executor.store.getSessionVar(
        dbName,
        dbEngine.getOrCreateDatabase(dbName),
        'total'
      )).toBe(10);
    });

    test('registra FUNCTION como UDF utilizável em SELECT', () => {
      service.create(dbName, 'aurora-postgresql', `
        CREATE OR REPLACE FUNCTION triplo(x int) RETURNS int
        AS $$ BEGIN RETURN x * 3; END; $$ LANGUAGE plpgsql
      `);

      expect(dbEngine.execute(dbName, 'SELECT triplo(7) AS valor').rows).toEqual([{ valor: 21 }]);
      expect(service.list(dbName, 'function')).toHaveLength(1);
    });

    test('DROP FUNCTION invalida a UDF registrada', () => {
      service.dropByName(dbName, 'function', 'triplo');
      expect(() => dbEngine.execute(dbName, 'SELECT triplo(7) AS valor')).toThrow(/não existe mais/);
      expect(service.list(dbName, 'function')).toHaveLength(0);
    });

    test('listarotinas e views separadamente', () => {
      const translated = new SqlTranslator('aurora-mysql').translate(
        'CREATE OR REPLACE VIEW pares AS SELECT n FROM nums WHERE n % 2 = 0'
      );
      dbEngine.execute(dbName, translated);

      expect(service.listViews(dbName)).toEqual([
        expect.objectContaining({ name: 'pares' }),
      ]);
      expect(service.list(dbName, 'procedure').map((r) => r.name)).toContain('soma');
    });
  });

  describe('Data API', () => {
    test('CALL via ExecuteStatement devolve registros e metadados', async () => {
      const response = await dataApi.executeStatement({
        resourceArn: 'arn:aws:rds:us-east-1:000000000000:cluster:test-cluster',
        secretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:aurora-test',
        database: dbName,
        sql: 'CALL soma(:limite, @total)',
        parameters: [{ name: 'limite', value: { longValue: 4 } }],
        includeResultMetadata: true,
      });

      expect(response.records).toEqual([[{ longValue: 6 }]]);
      expect(response.columnMetadata).toHaveLength(1);
      expect(response.numberOfRecordsUpdated).toBe(0);
    });

    test('CREATE PROCEDURE via ExecuteStatement não passa pelo tradutor comum', async () => {
      const response = await dataApi.executeStatement({
        resourceArn: 'arn:aws:rds:us-east-1:000000000000:cluster:test-cluster',
        database: dbName,
        sql: `CREATE PROCEDURE eco(IN valor INT)
          BEGIN
            SELECT :valor AS valor;
          END`,
      });

      expect(response.numberOfRecordsUpdated).toBe(0);
      expect(service.list(dbName, 'procedure').map((r) => r.name)).toContain('eco');
    });

    test('SHOW PROCEDURE STATUS usa o catálogo simulado', async () => {
      const response = await dataApi.executeStatement({
        resourceArn: 'arn:aws:rds:us-east-1:000000000000:cluster:test-cluster',
        database: dbName,
        sql: 'SHOW PROCEDURE STATUS',
      });

      expect(response.records.length).toBeGreaterThan(0);
    });
  });
});
