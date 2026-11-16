'use strict';
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

describe('OpenSearch domain Endpoint, UpdateDomainConfig and tags (AWS CLI opensearch)', () => {
  let tmpDir;
  let previousDataDir;
  let OpenSearchSimulator;
  let OpenSearchServer;
  let server;
  let port;
  let sim;

  const ARN1 = 'arn:aws:es:us-east-1:000000000000:domain/cfg1';
  const ARN2 = 'arn:aws:es:us-east-1:000000000000:domain/cfg2';

  function request(method, reqPath, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: reqPath,
          method,
          headers: payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
            : { ...headers },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode, text: data, json: data ? safeJson(data) : {} }));
        }
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  function safeJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-config-tags-test-'));
    previousDataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = tmpDir;
    OpenSearchSimulator = require('./simulator');
    OpenSearchServer = require('./server');
    sim = new OpenSearchSimulator({});
    await sim.initialize();
    server = await startServer(sim);
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.server.close(resolve));
    if (previousDataDir === undefined) delete process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    else process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = previousDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Endpoint', () => {
    test('CreateDomain, DescribeDomain e DeleteDomain usam o host da requisição (localhost:4700)', async () => {
      const created = await request('POST', '/2021-01-01/opensearch/domain', { DomainName: 'ep1' }, { Host: 'localhost:4700' });
      expect(created.status).toBe(200);
      expect(created.json.DomainStatus.Endpoint).toBe('localhost:4700');

      const described = await request('GET', '/2021-01-01/opensearch/domain/ep1', undefined, { Host: 'localhost:4700' });
      expect(described.json.DomainStatus.Endpoint).toBe('localhost:4700');

      const deleted = await request('DELETE', '/2021-01-01/opensearch/domain/ep1', undefined, { Host: 'localhost:4700' });
      expect(deleted.json.DomainStatus.Endpoint).toBe('localhost:4700');
    });

    test('Endpoint acompanha a porta de entrada (192.168.0.10:9200)', async () => {
      await request('POST', '/2021-01-01/opensearch/domain', { DomainName: 'ep2' }, { Host: '192.168.0.10:9200' });
      const res = await request('GET', '/2021-01-01/opensearch/domain/ep2', undefined, { Host: '192.168.0.10:9200' });
      expect(res.json.DomainStatus.Endpoint).toBe('192.168.0.10:9200');
      await request('DELETE', '/2021-01-01/opensearch/domain/ep2', undefined, { Host: '192.168.0.10:9200' });
    });

    test('Endpoint não é gravado no domínio: outra porta devolve outro host', async () => {
      await request('POST', '/2021-01-01/opensearch/domain', { DomainName: 'ep3' }, { Host: 'localhost:4700' });
      const res = await request('GET', '/2021-01-01/opensearch/domain/ep3', undefined, { Host: 'localhost:9200' });
      expect(res.json.DomainStatus.Endpoint).toBe('localhost:9200');
      expect(sim.domains.describeDomain('ep3')).not.toHaveProperty('Endpoint');
    });
  });

  describe('UpdateDomainConfig (POST /2021-01-01/opensearch/domain/:name/config)', () => {
    beforeAll(async () => {
      await request('POST', '/2021-01-01/opensearch/domain', { DomainName: 'cfg1' });
    });

    test('altera InstanceCount, mantém os demais campos e devolve Options completo', async () => {
      const res = await request('POST', '/2021-01-01/opensearch/domain/cfg1/config', {
        ClusterConfig: { InstanceCount: 2 },
      });
      expect(res.status).toBe(200);
      expect(res.json.DomainConfig.ClusterConfig.Options).toEqual({
        InstanceType: 'm5.large.search',
        InstanceCount: 2,
        DedicatedMasterEnabled: false,
        ZoneAwarenessEnabled: false,
      });
    });

    test('DescribeDomain em seguida mostra o valor novo', async () => {
      const res = await request('GET', '/2021-01-01/opensearch/domain/cfg1');
      expect(res.json.DomainStatus.ClusterConfig.InstanceCount).toBe(2);
    });

    test('aceita flags booleanas e InstanceType', async () => {
      const res = await request('POST', '/2021-01-01/opensearch/domain/cfg1/config', {
        ClusterConfig: { InstanceType: 'r6g.large.search', ZoneAwarenessEnabled: true },
      });
      expect(res.status).toBe(200);
      expect(res.json.DomainConfig.ClusterConfig.Options).toMatchObject({
        InstanceType: 'r6g.large.search',
        InstanceCount: 2,
        ZoneAwarenessEnabled: true,
      });
    });

    test('domínio inexistente devolve ResourceNotFoundException (409)', async () => {
      const res = await request('POST', '/2021-01-01/opensearch/domain/missing/config', {
        ClusterConfig: { InstanceCount: 2 },
      });
      expect(res.status).toBe(409);
      expect(res.json.__type).toBe('ResourceNotFoundException');
    });

    test('InstanceCount 0 devolve ValidationException (400) e não altera nada', async () => {
      const res = await request('POST', '/2021-01-01/opensearch/domain/cfg1/config', {
        ClusterConfig: { InstanceCount: 0 },
      });
      expect(res.status).toBe(400);
      expect(res.json.__type).toBe('ValidationException');
      expect(sim.domains.describeDomain('cfg1').ClusterConfig.InstanceCount).toBe(2);
    });

    test('flag não booleana devolve ValidationException (400)', async () => {
      const res = await request('POST', '/2021-01-01/opensearch/domain/cfg1/config', {
        ClusterConfig: { DedicatedMasterEnabled: 'yes' },
      });
      expect(res.status).toBe(400);
      expect(res.json.__type).toBe('ValidationException');
    });

    test('corpo sem ClusterConfig responde 200 e não altera nada', async () => {
      const before = sim.domains.describeDomain('cfg1').ClusterConfig;
      const res = await request('POST', '/2021-01-01/opensearch/domain/cfg1/config', {});
      expect(res.status).toBe(200);
      expect(sim.domains.describeDomain('cfg1').ClusterConfig).toEqual(before);
    });

    test('campo fora de ClusterConfig é ignorado com 200', async () => {
      const res = await request('POST', '/2021-01-01/opensearch/domain/cfg1/config', {
        EngineVersion: 'OpenSearch_9.9',
      });
      expect(res.status).toBe(200);
      expect(sim.domains.describeDomain('cfg1').EngineVersion).not.toBe('OpenSearch_9.9');
    });
  });

  describe('tags (AddTags, ListTags, RemoveTags)', () => {
    beforeAll(async () => {
      await request('POST', '/2021-01-01/opensearch/domain', { DomainName: 'cfg2' });
    });

    test('AddTags (POST /2021-01-01/tags) responde 200 sem corpo', async () => {
      const res = await request('POST', '/2021-01-01/tags', {
        ARN: ARN1,
        TagList: [
          { Key: 'env', Value: 'dev' },
          { Key: 'team', Value: 'core' },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.text).toBe('');
    });

    test('ListTags (GET /2021-01-01/tags) devolve as tags na ordem de inserção', async () => {
      const res = await request('GET', `/2021-01-01/tags/?arn=${encodeURIComponent(ARN1)}`);
      expect(res.status).toBe(200);
      expect(res.json.TagList).toEqual([
        { Key: 'env', Value: 'dev' },
        { Key: 'team', Value: 'core' },
      ]);
    });

    test('AddTags com chave existente sobrescreve o valor', async () => {
      await request('POST', '/2021-01-01/tags', { ARN: ARN1, TagList: [{ Key: 'env', Value: 'prod' }] });
      const res = await request('GET', `/2021-01-01/tags/?arn=${encodeURIComponent(ARN1)}`);
      expect(res.json.TagList).toEqual([
        { Key: 'env', Value: 'prod' },
        { Key: 'team', Value: 'core' },
      ]);
    });

    test('ARN sem domain/<nome> devolve ValidationException (400)', async () => {
      const res = await request('POST', '/2021-01-01/tags', {
        ARN: 'arn:aws:es:us-east-1:000000000000:collection/x',
        TagList: [{ Key: 'a', Value: 'b' }],
      });
      expect(res.status).toBe(400);
      expect(res.json.__type).toBe('ValidationException');
    });

    test('domínio do ARN inexistente devolve ResourceNotFoundException (409)', async () => {
      const res = await request('POST', '/2021-01-01/tags', {
        ARN: 'arn:aws:es:us-east-1:000000000000:domain/missing',
        TagList: [{ Key: 'a', Value: 'b' }],
      });
      expect(res.status).toBe(409);
      expect(res.json.__type).toBe('ResourceNotFoundException');
    });

    test('TagList inválido devolve ValidationException (400)', async () => {
      const notArray = await request('POST', '/2021-01-01/tags', { ARN: ARN1, TagList: 'env=dev' });
      expect(notArray.status).toBe(400);
      const emptyKey = await request('POST', '/2021-01-01/tags', { ARN: ARN1, TagList: [{ Key: '', Value: 'x' }] });
      expect(emptyKey.status).toBe(400);
      const numericValue = await request('POST', '/2021-01-01/tags', { ARN: ARN1, TagList: [{ Key: 'k', Value: 1 }] });
      expect(numericValue.status).toBe(400);
    });

    test('ListTags de domínio sem tags devolve TagList vazio', async () => {
      const res = await request('GET', `/2021-01-01/tags/?arn=${encodeURIComponent(ARN2)}`);
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ TagList: [] });
    });

    test('RemoveTags (POST /2021-01-01/tags-removal) remove a chave', async () => {
      const res = await request('POST', '/2021-01-01/tags-removal', { ARN: ARN1, TagKeys: ['team'] });
      expect(res.status).toBe(200);
      const list = await request('GET', `/2021-01-01/tags/?arn=${encodeURIComponent(ARN1)}`);
      expect(list.json.TagList).toEqual([{ Key: 'env', Value: 'prod' }]);
    });

    test('RemoveTags de chave inexistente responde 200', async () => {
      const res = await request('POST', '/2021-01-01/tags-removal', { ARN: ARN1, TagKeys: ['nao-existe'] });
      expect(res.status).toBe(200);
    });

    test('ListTags sem arn devolve ValidationException (400)', async () => {
      const res = await request('GET', '/2021-01-01/tags/');
      expect(res.status).toBe(400);
      expect(res.json.__type).toBe('ValidationException');
    });
  });

  describe('persistência das tags', () => {
    test('DeleteDomain remove as tags do ARN', async () => {
      await request('POST', '/2021-01-01/opensearch/domain', { DomainName: 'cfg3' });
      const arn3 = 'arn:aws:es:us-east-1:000000000000:domain/cfg3';
      await request('POST', '/2021-01-01/tags', { ARN: arn3, TagList: [{ Key: 'x', Value: 'y' }] });
      await request('DELETE', '/2021-01-01/opensearch/domain/cfg3');
      expect(sim.domains.tags.has(arn3)).toBe(false);
    });

    test('um OpenSearchDomains novo sobre o mesmo store carrega as tags gravadas', async () => {
      const { OpenSearchDomains } = require('./domains');
      const fresh = new OpenSearchDomains(sim.domains.store);
      fresh.load();
      expect(fresh.listTags(ARN1)).toEqual([{ Key: 'env', Value: 'prod' }]);
    });
  });
});
