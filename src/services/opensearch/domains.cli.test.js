'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

describe('OpenSearch domain control plane (AWS CLI opensearch create/describe/list/delete-domain)', () => {
  let tmpDir;
  let previousDataDir;
  let OpenSearchSimulator;
  let OpenSearchServer;
  let server;
  let port;

  function request(method, reqPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: reqPath,
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

  async function startServer(simulator) {
    const s = new OpenSearchServer(0, {});
    s.simulator = simulator;
    await s.initialize();
    await new Promise((resolve) => {
      s.server = s.app.listen(0, '127.0.0.1', () => {
        port = s.server.address().port;
        resolve();
      });
    });
    return s;
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-domain-test-'));
    previousDataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = tmpDir;
    OpenSearchSimulator = require('./simulator');
    OpenSearchServer = require('./server');
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.server.close(resolve));
    if (previousDataDir === undefined) delete process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    else process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = previousDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('CreateDomain (POST /2021-01-01/opensearch/domain) returns DomainStatus', async () => {
    const sim = new OpenSearchSimulator({});
    await sim.initialize();
    server = await startServer(sim);
    const res = await request('POST', '/2021-01-01/opensearch/domain', { DomainName: 'dom1' });
    expect(res.status).toBe(200);
    expect(res.json.DomainStatus.DomainName).toBe('dom1');
    expect(res.json.DomainStatus.ARN).toBe('arn:aws:es:us-east-1:000000000000:domain/dom1');
    expect(res.json.DomainStatus.Created).toBe(true);
  });

  test('CreateDomain with an existing name returns ResourceAlreadyExistsException', async () => {
    const res = await request('POST', '/2021-01-01/opensearch/domain', { DomainName: 'dom1' });
    expect(res.status).toBe(409);
    expect(res.json.__type).toBe('ResourceAlreadyExistsException');
  });

  test('CreateDomain without DomainName returns ValidationException', async () => {
    const res = await request('POST', '/2021-01-01/opensearch/domain', {});
    expect(res.status).toBe(400);
    expect(res.json.__type).toBe('ValidationException');
  });

  test('DescribeDomain (GET /2021-01-01/opensearch/domain/:name) returns DomainStatus', async () => {
    const res = await request('GET', '/2021-01-01/opensearch/domain/dom1');
    expect(res.status).toBe(200);
    expect(res.json.DomainStatus.DomainName).toBe('dom1');
  });

  test('DescribeDomain of a missing domain returns ResourceNotFoundException', async () => {
    const res = await request('GET', '/2021-01-01/opensearch/domain/missing');
    expect(res.status).toBe(409);
    expect(res.json.__type).toBe('ResourceNotFoundException');
  });

  test('ListDomainNames (GET /2021-01-01/domain) lists created domains', async () => {
    await request('POST', '/2021-01-01/opensearch/domain', { DomainName: 'dom2' });
    const res = await request('GET', '/2021-01-01/domain');
    expect(res.status).toBe(200);
    expect(res.json.DomainNames).toEqual(
      expect.arrayContaining([
        { DomainName: 'dom1', EngineType: 'OpenSearch' },
        { DomainName: 'dom2', EngineType: 'OpenSearch' },
      ])
    );
  });

  test('DeleteDomain (DELETE /2021-01-01/opensearch/domain/:name) removes the domain', async () => {
    const res = await request('DELETE', '/2021-01-01/opensearch/domain/dom2');
    expect(res.status).toBe(200);
    expect(res.json.DomainStatus.Deleted).toBe(true);
    const list = await request('GET', '/2021-01-01/domain');
    expect(list.json.DomainNames.map((d) => d.DomainName)).not.toContain('dom2');
    const after = await request('GET', '/2021-01-01/opensearch/domain/dom2');
    expect(after.json.__type).toBe('ResourceNotFoundException');
  });

  test('domains persist to the data dir and are loaded by a new simulator', async () => {
    const sim2 = new OpenSearchSimulator({});
    await sim2.initialize();
    expect(sim2.domains.describeDomain('dom1').DomainName).toBe('dom1');
  });

  test('ES REST root route still answers (no regression)', async () => {
    const res = await request('GET', '/_cluster/health');
    expect(res.status).toBe(200);
  });
});
