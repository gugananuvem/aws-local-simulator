'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { DbEngine } = require('../db-engine');
const AuroraServer = require('../server');
const { RoutineService } = require('./index');

function request(port, method, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: requestPath }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let body = data;
        try { body = JSON.parse(data); } catch (e) { /* resposta não-JSON */ }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Aurora admin endpoints para rotinas e views', () => {
  let dataDir;
  let dbEngine;
  let server;
  let port;
  const dbName = 'admin_test';

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-admin-test-'));
    dbEngine = new DbEngine(dataDir);
    const routineService = new RoutineService(dbEngine);

    dbEngine.execute(dbName, 'CREATE TABLE t (id INTEGER)');
    dbEngine.execute(dbName, 'CREATE VIEW v AS SELECT id FROM t');
    routineService.create(dbName, 'aurora-mysql', `
      CREATE PROCEDURE ping(IN x INT)
      BEGIN
        SELECT :x AS pong;
      END
    `);

    server = new AuroraServer(0, {});
    server.dbEngine = dbEngine;
    server.routineService = routineService;
    await server.initialize();
    await new Promise((resolve) => {
      server.server = server.app.listen(0, '127.0.0.1', () => {
        port = server.server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.server.close(resolve));
    dbEngine.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('GET /__admin/routines devolve procedures e functions', async () => {
    const res = await request(port, 'GET', `/__admin/routines?database=${dbName}`);
    expect(res.status).toBe(200);
    expect(res.body.routines).toEqual([
      expect.objectContaining({ name: 'ping', kind: 'procedure' }),
    ]);
  });

  test('GET /__admin/routines/:kind/:name devolve a definição', async () => {
    const res = await request(port, 'GET', `/__admin/routines/procedure/ping?database=${dbName}`);
    expect(res.status).toBe(200);
    expect(res.body.routine.definitionSql).toContain('CREATE PROCEDURE ping');
  });

  test('GET /__admin/views devolve views do database', async () => {
    const res = await request(port, 'GET', `/__admin/views?database=${dbName}`);
    expect(res.status).toBe(200);
    expect(res.body.views).toEqual([expect.objectContaining({ name: 'v' })]);
  });

  test('DELETE /__admin/routines/:kind/:name remove a rotina', async () => {
    const res = await request(port, 'DELETE', `/__admin/routines/procedure/ping?database=${dbName}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/removida/);

    const followUp = await request(port, 'GET', `/__admin/routines?database=${dbName}`);
    expect(followUp.body.routines).toHaveLength(0);
  });

  test('valida parâmetro database', async () => {
    const res = await request(port, 'GET', '/__admin/routines?database=inexistente');
    expect(res.status).toBe(400);
  });
});
