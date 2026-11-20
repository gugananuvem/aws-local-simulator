'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { SqlServerService } = require('./index');

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: requestPath }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    }).on('error', reject);
  });
}

describe('ciclo de vida do SqlServerService', () => {
  let service;
  let dataDir;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-sqlserver-service-'));
    service = new SqlServerService({
      dataDir,
      authentication: { enabled: false },
      ports: { 'rds-sqlserver': 0, 'rds-sqlserver-tds': 0 },
    });
    await service.initialize();
    await service.start();
  });

  afterAll(async () => {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('sobe HTTP e TDS e publica o status agregado', () => {
    const status = service.getStatus();

    expect(status.running).toBe(true);
    expect(status.port).toBe(0);
    expect(status.tds.running).toBe(true);
    expect(typeof status.tds.port).toBe('number');
    expect(status.clusters).toBe(0);
    expect(status.databases).toBe(0);
    expect(service.getSimulator()).toMatchObject({
      clusterManager: expect.any(Object),
      dbEngine: expect.any(Object),
      rdsApiHandler: expect.any(Object),
      dataApiHandler: expect.any(Object),
      tdsServer: expect.any(Object),
    });
  });

  test('expõe os endpoints administrativos pelo servidor HTTP', async () => {
    const port = service.server.server.address().port;

    const health = await request(port, '/__admin/health');
    expect(health).toMatchObject({
      status: 200,
      body: { service: 'rds-sqlserver', status: 'healthy' },
    });

    const databases = await request(port, '/rds-sqlserver/__admin/databases');
    expect(databases.body.databases).toEqual([]);
  });

  test('injeta KMS, Secrets Manager, CloudTrail e CloudWatch nos handlers', () => {
    const kms = { describeKey: jest.fn() };
    const secrets = { getSecretValue: jest.fn() };
    const cloudTrail = { recordEvent: jest.fn() };
    const cloudWatch = { putMetricData: jest.fn() };
    service.injectDependencies({
      getService: (name) => ({
        kms: { simulator: kms },
        'secret-manager': { simulator: secrets },
        cloudtrail: { simulator: cloudTrail },
        cloudwatch: { simulator: cloudWatch },
      })[name],
    });

    expect(service.rdsApiHandler.kmsService).toBe(kms);
    expect(service.dataApiHandler.secretManagerService).toBe(secrets);
    expect(service.rdsApiHandler.cloudTrailService).toBe(cloudTrail);
    expect(service.dataApiHandler.cloudWatchService).toBe(cloudWatch);
  });

  test('reset limpa metadados e bancos e mantém o serviço utilizável', async () => {
    const manager = service.clusterManager;
    manager.createCluster({
      DBClusterIdentifier: 'sqlsrv-demo',
      Engine: 'sqlserver-se',
      EngineVersion: '16.00.4035.2.v1',
      MasterUsername: 'admin',
      MasterUserPassword: 'Senha123456',
    });
    service.dbEngine.getOrCreateDatabase('demo');
    expect(manager.listClusters()).toHaveLength(1);
    expect(service.dbEngine.listDatabases()).toContain('demo');

    const engineAntes = service.dbEngine;
    await service.reset();

    expect(manager.listClusters()).toHaveLength(0);
    expect(service.dbEngine.listDatabases()).toEqual([]);
    expect(service.dbEngine).not.toBe(engineAntes);
    expect(service.server.dbEngine).toBe(service.dbEngine);
    expect(service.tdsServer.dbEngine).toBe(service.dbEngine);
    expect(service.rdsApiHandler.dbEngine).toBe(service.dbEngine);
    expect(service.dataApiHandler.dbEngine).toBe(service.dbEngine);
  });

  test('stop encerra listeners e permite iniciar novamente', async () => {
    await service.stop();
    expect(service.getStatus()).toMatchObject({
      running: false,
      tds: { running: false },
    });

    await service.start();
    expect(service.getStatus().running).toBe(true);
    expect(service.getStatus().tds.running).toBe(true);
  });
});
