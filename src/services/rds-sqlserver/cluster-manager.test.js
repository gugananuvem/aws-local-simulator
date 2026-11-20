'use strict';

/**
 * Testes focados do gerenciador de clusters SQL Server.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const LocalStore = require('../../utils/local-store');
const { ClusterManager } = require('./cluster-manager');

describe('SQL Server ClusterManager', () => {
  let dataDir;
  let store;
  let managers;
  let manager;

  const baseParams = (overrides = {}) => ({
    DBClusterIdentifier: 'sql-cluster',
    Engine: 'sqlserver-se',
    EngineVersion: '15.00.4388.7.v1',
    MasterUsername: 'sa',
    MasterUserPassword: 'Senha@123!',
    LicenseModel: 'license-included',
    CharacterSet: 'SQL_Latin1_General_CP1_CI_AS',
    Timezone: 'UTC',
    AvailabilityZones: ['us-east-1a', 'us-east-1b'],
    StorageEncrypted: true,
    KmsKeyId: 'arn:aws:kms:us-east-1:000000000000:key/1234',
    DatabaseName: 'Principal',
    ...overrides
  });

  const instanceParams = (overrides = {}) => ({
    DBInstanceIdentifier: 'sql-cluster-instance-1',
    DBClusterIdentifier: 'sql-cluster',
    DBInstanceClass: 'db.r5.large',
    ...overrides
  });

  const criarManager = () => {
    const instancia = new ClusterManager(dataDir, store);
    instancia.initialize();
    managers.push(instancia);
    return instancia;
  };

  const esperarErro = (fn, code, statusCode) => {
    try {
      fn();
      throw new Error('A operação deveria ter falhado');
    } catch (err) {
      expect(err.code).toBe(code);
      expect(err.statusCode).toBe(statusCode);
      return err;
    }
  };

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-sqlserver-'));
    store = new LocalStore(dataDir);
    managers = [];
    manager = criarManager();
  });

  afterEach(() => {
    for (const instancia of managers) {
      instancia.close();
    }
    managers = [];
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('inicialização é idempotente e fecha sem erro', () => {
    expect(() => manager.initialize()).not.toThrow();
    expect(manager.listClusters()).toEqual([]);
    expect(() => manager.close()).not.toThrow();
    expect(() => manager.close()).not.toThrow();
  });

  test('cria, busca e lista clusters com campos no padrão AWS', () => {
    const cluster = manager.createCluster(baseParams());

    expect(cluster.DBClusterIdentifier).toBe('sql-cluster');
    expect(cluster.DBClusterArn).toBe('arn:aws:rds:us-east-1:000000000000:cluster:sql-cluster');
    expect(cluster.Engine).toBe('sqlserver-se');
    expect(cluster.EngineVersion).toBe('15.00.4388.7.v1');
    expect(cluster.Status).toBe('available');
    expect(cluster.Endpoint).toBe('sql-cluster.cluster-local.us-east-1.rds.amazonaws.com');
    expect(cluster.ReaderEndpoint).toBe('sql-cluster.cluster-ro-local.us-east-1.rds.amazonaws.com');
    expect(cluster.Port).toBe(1433);
    expect(cluster.DatabaseName).toBe('Principal');
    expect(cluster.StorageEncrypted).toBe(true);
    expect(cluster.KmsKeyId).toBe(baseParams().KmsKeyId);
    expect(cluster.DbClusterResourceId).toMatch(/^cluster-[0-9a-f]{26}$/);
    expect(cluster.LicenseModel).toBe('license-included');
    expect(cluster.CharacterSet).toBe('SQL_Latin1_General_CP1_CI_AS');
    expect(cluster.Timezone).toBe('UTC');
    expect(cluster.AvailabilityZones).toEqual(['us-east-1a', 'us-east-1b']);
    expect(cluster.DBClusterMembers).toEqual([]);
    expect(cluster.CreatedAt).toBeDefined();
    expect(cluster.UpdatedAt).toBeDefined();

    expect(manager.getCluster('sql-cluster').DBClusterArn).toBe(cluster.DBClusterArn);
    expect(manager.listClusters()).toHaveLength(1);
    expect(manager.listClusters({ DBClusterIdentifier: 'sql-cluster' })).toHaveLength(1);
    expect(manager.getClusterByArn(cluster.DBClusterArn).DBClusterIdentifier).toBe('sql-cluster');
    expect(manager.getClusterByArn('arn:aws:rds:us-east-1:000000000000:cluster:outro')).toBeNull();
  });

  test('persiste senha apenas como hash e salt', () => {
    manager.createCluster(baseParams());

    const json = store.read('__rds-sqlserver__');
    const persistido = json.clusters['sql-cluster'];

    expect(persistido.MasterPasswordHash).toMatch(/^[0-9a-f]{128}$/);
    expect(persistido.MasterPasswordSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(json)).not.toContain('Senha@123!');
  });

  test('valida parâmetros de criação e duplicidade', () => {
    manager.createCluster(baseParams());

    const casos = [
      [() => manager.createCluster(baseParams({ DBClusterIdentifier: 'SQL_MAU' })), 'InvalidParameterValue'],
      [() => manager.createCluster(baseParams({ Engine: 'mysql' })), 'InvalidParameterValue'],
      [() => manager.createCluster(baseParams({ EngineVersion: '8.0' })), 'InvalidParameterValue'],
      [() => manager.createCluster(baseParams({ MasterUsername: '' })), 'InvalidParameterValue'],
      [() => manager.createCluster(baseParams({ MasterUserPassword: 'curta' })), 'InvalidParameterValue'],
      [() => manager.createCluster(baseParams({ Port: 70000 })), 'InvalidParameterValue'],
      [() => manager.createCluster(baseParams()), 'DBClusterAlreadyExistsFault']
    ];

    for (const [fn, code] of casos) {
      esperarErro(fn, code, 400);
    }
  });

  test('atualiza campos permitidos do cluster', () => {
    manager.createCluster(baseParams());

    const atualizado = manager.updateCluster('sql-cluster', {
      EngineVersion: '16.00.4035.2.v1',
      Port: 1500,
      Status: 'stopped',
      LicenseModel: 'bring-your-own-license',
      CharacterSet: 'Latin1_General_CI_AS',
      Timezone: 'America/Sao_Paulo',
      MasterUsername: 'sqladmin',
      DatabaseName: 'OutroBanco'
    });

    expect(atualizado.EngineVersion).toBe('16.00.4035.2.v1');
    expect(atualizado.Port).toBe(1500);
    expect(atualizado.Status).toBe('stopped');
    expect(atualizado.LicenseModel).toBe('bring-your-own-license');
    expect(atualizado.CharacterSet).toBe('Latin1_General_CI_AS');
    expect(atualizado.Timezone).toBe('America/Sao_Paulo');
    expect(atualizado.MasterUsername).toBe('sqladmin');
    expect(atualizado.DatabaseName).toBe('OutroBanco');
    expect(manager.listDatabases('sql-cluster').map(row => row.name)).toContain('OutroBanco');

    esperarErro(
      () => manager.updateCluster('sql-cluster', { EngineVersion: '9.0' }),
      'InvalidParameterValue',
      400
    );
    esperarErro(
      () => manager.updateCluster('inexistente', { Status: 'available' }),
      'DBClusterNotFoundFault',
      404
    );
  });

  test('gerencia instâncias e marca a primeira como escritora', () => {
    manager.createCluster(baseParams());

    const primeira = manager.createInstance(instanceParams());
    const segunda = manager.createInstance(instanceParams({
      DBInstanceIdentifier: 'sql-cluster-instance-2',
      DBInstanceClass: 'db.t3.micro'
    }));

    expect(primeira.IsClusterWriter).toBe(true);
    expect(segunda.IsClusterWriter).toBe(false);
    expect(primeira.DBInstanceArn).toBe('arn:aws:rds:us-east-1:000000000000:db:sql-cluster-instance-1');
    expect(primeira.Endpoint).toEqual({
      Address: 'sql-cluster-instance-1.local.us-east-1.rds.amazonaws.com',
      Port: 1433,
      HostedZoneId: 'Z1234567890'
    });
    expect(primeira.Engine).toBe('sqlserver-se');
    expect(primeira.LicenseModel).toBe('license-included');
    expect(primeira.Timezone).toBe('UTC');

    expect(manager.getInstance('sql-cluster-instance-1').DBInstanceClass).toBe('db.r5.large');
    expect(manager.listInstances()).toHaveLength(2);
    expect(manager.listInstances({ DBClusterIdentifier: 'sql-cluster' })).toHaveLength(2);
    expect(manager.listInstances({ DBInstanceIdentifier: 'sql-cluster-instance-1' })).toHaveLength(1);
    expect(manager.getCluster('sql-cluster').DBClusterMembers).toHaveLength(2);

    esperarErro(
      () => manager.createInstance(instanceParams({ DBInstanceClass: 'db.m5.large' })),
      'InvalidParameterValue',
      400
    );
    esperarErro(
      () => manager.createInstance(instanceParams({ DBClusterIdentifier: 'inexistente' })),
      'DBClusterNotFoundFault',
      404
    );
    esperarErro(
      () => manager.getInstance('inexistente'),
      'DBInstanceNotFoundFault',
      404
    );

    manager.deleteInstance('sql-cluster-instance-2');
    expect(manager.listInstances()).toHaveLength(1);
  });

  test('registra, lista e remove bancos de dados lógicos', () => {
    manager.createCluster(baseParams());

    expect(manager.listDatabases('sql-cluster').map(row => row.name)).toEqual(['Principal']);

    const criado = manager.createDatabase('Relatorios', 'sql-cluster');
    expect(criado.name).toBe('Relatorios');
    expect(manager.listDatabases('sql-cluster')).toHaveLength(2);

    esperarErro(() => manager.createDatabase('Relatorios', 'sql-cluster'), 'InvalidParameterValue', 400);
    esperarErro(() => manager.createDatabase('Novo', 'inexistente'), 'DBClusterNotFoundFault', 404);

    manager.deleteDatabase('Relatorios', 'sql-cluster');
    expect(manager.listDatabases('sql-cluster').map(row => row.name)).toEqual(['Principal']);
  });

  test('adiciona, substitui, lista e remove tags', () => {
    manager.createCluster(baseParams());
    const arn = manager.getCluster('sql-cluster').DBClusterArn;

    manager.addTags(arn, [
      { Key: 'Ambiente', Value: 'teste' },
      { Key: 'Projeto', Value: 'simulador' }
    ]);
    expect(manager.listTags(arn)).toEqual([
      { Key: 'Ambiente', Value: 'teste' },
      { Key: 'Projeto', Value: 'simulador' }
    ]);

    manager.addTags(arn, [{ Key: 'Ambiente', Value: 'producao' }]);
    expect(manager.listTags(arn)).toEqual([
      { Key: 'Ambiente', Value: 'producao' },
      { Key: 'Projeto', Value: 'simulador' }
    ]);

    expect(manager.removeTags(arn, ['Projeto'])).toEqual([{ Key: 'Ambiente', Value: 'producao' }]);
    expect(store.read('__rds-sqlserver__').tags[arn]).toEqual([{ Key: 'Ambiente', Value: 'producao' }]);
  });

  test('verifica credenciais com scrypt e comparação segura', () => {
    manager.createCluster(baseParams());
    manager.createCluster(baseParams({
      DBClusterIdentifier: 'sql-cluster-dois',
      MasterUserPassword: 'OutraSenha@456'
    }));

    const autenticado = manager.verifyCredentials('sa', 'Senha@123!', 'sql-cluster');
    expect(autenticado.DBClusterIdentifier).toBe('sql-cluster');
    expect(manager.verifyCredentials('sa', 'senha-errada', 'sql-cluster')).toBeNull();
    expect(manager.verifyCredentials('desconhecido', 'Senha@123!')).toBeNull();
    expect(manager.verifyCredentials('sa', 'OutraSenha@456', 'sql-cluster-dois').DBClusterIdentifier)
      .toBe('sql-cluster-dois');
  });

  test('recarrega clusters, instâncias, tags e credenciais do JSON', () => {
    manager.createCluster(baseParams());
    manager.createInstance(instanceParams());
    const arn = manager.getCluster('sql-cluster').DBClusterArn;
    manager.addTags(arn, [{ Key: 'Ambiente', Value: 'teste' }]);
    const resourceId = manager.getCluster('sql-cluster').DbClusterResourceId;

    manager.close();
    for (const arquivo of fs.readdirSync(dataDir)) {
      if (arquivo.startsWith('metadata.db')) {
        fs.unlinkSync(path.join(dataDir, arquivo));
      }
    }

    const recarregado = criarManager();

    expect(recarregado.getCluster('sql-cluster').DbClusterResourceId).toBe(resourceId);
    expect(recarregado.listInstances({ DBClusterIdentifier: 'sql-cluster' })).toHaveLength(1);
    expect(recarregado.listInstances({ DBClusterIdentifier: 'sql-cluster' })[0].IsClusterWriter).toBe(true);
    expect(recarregado.listTags(arn)).toEqual([{ Key: 'Ambiente', Value: 'teste' }]);
    expect(recarregado.verifyCredentials('sa', 'Senha@123!', 'sql-cluster').DBClusterIdentifier)
      .toBe('sql-cluster');
    expect(recarregado.verifyCredentials('sa', 'senha-errada', 'sql-cluster')).toBeNull();
  });

  test('reset limpa metadados sem fechar o banco e permite novo cluster', () => {
    manager.createCluster(baseParams());
    manager.createInstance(instanceParams());
    const arn = manager.getCluster('sql-cluster').DBClusterArn;
    manager.addTags(arn, [{ Key: 'Ambiente', Value: 'teste' }]);

    manager.reset();

    expect(manager.listClusters()).toEqual([]);
    expect(manager.listInstances()).toEqual([]);
    expect(manager.listTags(arn)).toEqual([]);
    expect(store.read('__rds-sqlserver__').clusters).toEqual({});
    expect(manager.createCluster(baseParams()).DBClusterIdentifier).toBe('sql-cluster');
  });

  test('deleteCluster remove cluster, instâncias, bancos e tags', () => {
    manager.createCluster(baseParams());
    const cluster = manager.getCluster('sql-cluster');
    const instancia = manager.createInstance(instanceParams());
    manager.addTags(cluster.DBClusterArn, [{ Key: 'Ambiente', Value: 'teste' }]);
    manager.addTags(instancia.DBInstanceArn, [{ Key: 'Ambiente', Value: 'teste' }]);

    manager.deleteCluster('sql-cluster');

    expect(manager.listClusters()).toEqual([]);
    expect(manager.listInstances()).toEqual([]);
    expect(manager.listTags(cluster.DBClusterArn)).toEqual([]);
    expect(manager.listTags(instancia.DBInstanceArn)).toEqual([]);
    esperarErro(() => manager.getCluster('sql-cluster'), 'DBClusterNotFoundFault', 404);
    esperarErro(() => manager.deleteCluster('sql-cluster'), 'DBClusterNotFoundFault', 404);
  });
});
