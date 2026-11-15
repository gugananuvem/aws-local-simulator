'use strict';

const http = require('http');
const { XRaySimulator } = require('./simulador');
const { createXRayServer } = require('./server');

// Store that accepts any persistence call without writing to disk.
const memoryStore = new Proxy({}, { get: () => async () => undefined });
const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, verboso() {} };

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : {} }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

describe('X-Ray REST routes used by the AWS CLI (botocore model)', () => {
  let server;
  let port;

  beforeAll(async () => {
    const simulator = new XRaySimulator({}, memoryStore, silentLogger);
    server = createXRayServer(simulator);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('POST /CreateGroup creates a group', async () => {
    const res = await request(port, 'POST', '/CreateGroup', { GroupName: 'cli-group' });
    expect(res.status).toBe(200);
    expect(res.json.Group.GroupName).toBe('cli-group');
  });

  test('POST /Groups (CLI get-groups) lists groups and does not require GroupName', async () => {
    const res = await request(port, 'POST', '/Groups', {});
    expect(res.status).toBe(200);
    expect(res.json.Groups.map((g) => g.GroupName)).toContain('cli-group');
  });

  test('POST /TraceSummaries (CLI get-trace-summaries) answers with TraceSummaries', async () => {
    const res = await request(port, 'POST', '/TraceSummaries', { StartTime: 1700000000, EndTime: 1800000000 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.TraceSummaries)).toBe(true);
  });

  test('POST /GetSamplingRules (CLI get-sampling-rules) answers with SamplingRuleRecords', async () => {
    const res = await request(port, 'POST', '/GetSamplingRules', {});
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.SamplingRuleRecords)).toBe(true);
  });

  test('GET /Groups keeps working (no regression)', async () => {
    const res = await request(port, 'GET', '/Groups');
    expect(res.status).toBe(200);
    expect(res.json.Groups.map((g) => g.GroupName)).toContain('cli-group');
  });
});
