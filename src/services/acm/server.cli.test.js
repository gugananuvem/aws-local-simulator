'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

describe('ACM AWS JSON protocol (CertificateManager.* targets used by the AWS CLI)', () => {
  let server;
  let port;
  let tmpDir;
  let previousDataDir;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-cli-test-'));
    previousDataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = tmpDir;
    const ACMSimulator = require('./simulator');
    const ACMServer = require('./server');
    const simulator = new ACMSimulator({});
    await simulator.initialize();
    server = new ACMServer(0, {});
    await server.initialize(simulator);
    await new Promise((resolve) => {
      server.server = server.app.listen(0, '127.0.0.1', () => {
        port = server.server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.server.close(resolve));
    if (previousDataDir === undefined) delete process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    else process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = previousDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function call(operation, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body || {});
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': `CertificateManager.${operation}`,
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data || '{}') }));
        }
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  test('ListCertificates (CLI acm list-certificates) returns CertificateSummaryList', async () => {
    const res = await call('ListCertificates', {});
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.CertificateSummaryList)).toBe(true);
    expect(res.json.NextToken).toBeNull();
  });

  test('RequestCertificate, DescribeCertificate and DeleteCertificate use the same protocol', async () => {
    const requested = await call('RequestCertificate', { DomainName: 'cli.example.com' });
    expect(requested.status).toBe(200);
    const arn = requested.json.CertificateArn;
    expect(arn).toMatch(/^arn:aws:acm:/);

    const described = await call('DescribeCertificate', { CertificateArn: arn });
    expect(described.status).toBe(200);
    expect(described.json.Certificate.DomainName).toBe('cli.example.com');

    const listed = await call('ListCertificates', {});
    expect(listed.json.CertificateSummaryList.map((c) => c.CertificateArn)).toContain(arn);

    const deleted = await call('DeleteCertificate', { CertificateArn: arn });
    expect(deleted.status).toBe(200);
  });

  test('unknown operation returns InvalidAction', async () => {
    const res = await call('NoSuchOperation', {});
    expect(res.status).toBe(400);
    expect(res.json.__type).toBe('InvalidAction');
  });

  test('REST route /acm/list-certificates keeps working (no regression)', async () => {
    const res = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/acm/list-certificates' }, (r) => {
          let data = '';
          r.on('data', (c) => (data += c));
          r.on('end', () => resolve({ status: r.statusCode, json: JSON.parse(data) }));
        })
        .on('error', reject);
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.CertificateSummaryList)).toBe(true);
  });
});
