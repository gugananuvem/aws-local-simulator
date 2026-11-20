const { RdsApiHandler, normalizeParams } = require('./rds-api');

function criarGerenciador() {
  return {
    createCluster: jest.fn(() => ({ DBClusterIdentifier: 'sqlsrv-demo' })),
    listClusters: jest.fn(() => [{ DBClusterIdentifier: 'sqlsrv-demo' }]),
    deleteCluster: jest.fn(),
    createInstance: jest.fn(() => ({ DBInstanceIdentifier: 'sqlsrv-demo-1' })),
    listInstances: jest.fn(() => [{ DBInstanceIdentifier: 'sqlsrv-demo-1' }]),
    deleteInstance: jest.fn(),
    updateCluster: jest.fn(() => ({ DBClusterIdentifier: 'sqlsrv-demo', Status: 'stopped' })),
    listTags: jest.fn(() => [{ Key: 'Env', Value: 'dev' }]),
    addTags: jest.fn(() => [{ Key: 'Env', Value: 'dev' }]),
    removeTags: jest.fn(() => []),
  };
}

describe('RDS API do SQL Server', () => {
  test('normaliza parâmetros do protocolo query (member, Tag e TagKey)', () => {
    expect(normalizeParams({
      Action: 'AddTagsToResource',
      'Tags.Tag.1.Key': 'Env',
      'Tags.Tag.1.Value': 'dev',
      'TagKeys.member.1': 'Env',
      StorageEncrypted: 'true',
      Port: '1433',
    })).toMatchObject({
      Action: 'AddTagsToResource',
      Tags: [{ Key: 'Env', Value: 'dev' }],
      TagKeys: ['Env'],
      StorageEncrypted: true,
      Port: 1433,
    });
  });

  test('cria cluster com database padrão master e abre o SQLite', async () => {
    const manager = criarGerenciador();
    const dbEngine = { getOrCreateDatabase: jest.fn() };
    const handler = new RdsApiHandler(manager, dbEngine);

    const result = await handler.handleRequest('CreateDBCluster', {
      Action: 'CreateDBCluster',
      DBClusterIdentifier: 'sqlsrv-demo',
      Engine: 'sqlserver-se',
      EngineVersion: '16.00.4035.2.v1',
      MasterUsername: 'admin',
      MasterUserPassword: 'senha123456',
    });

    expect(result.DBCluster.DBClusterIdentifier).toBe('sqlsrv-demo');
    expect(manager.createCluster).toHaveBeenCalledWith(expect.objectContaining({ DatabaseName: 'master' }));
    expect(dbEngine.getOrCreateDatabase).toHaveBeenCalledWith('master');
  });

  test('aceita ResourceName (protocolo query da AWS CLI) nas operações de tag', async () => {
    const manager = criarGerenciador();
    const handler = new RdsApiHandler(manager, { getOrCreateDatabase: jest.fn() });

    await expect(handler.handleRequest('ListTagsForResource', { ResourceName: 'arn:aws:rds::cluster:sqlsrv-demo' }))
      .resolves.toMatchObject({ TagList: expect.any(Array) });
    expect(manager.listTags).toHaveBeenCalledWith('arn:aws:rds::cluster:sqlsrv-demo');

    await expect(handler.handleRequest('AddTagsToResource', {
      ResourceName: 'arn:aws:rds::cluster:sqlsrv-demo',
      Tags: [{ Key: 'Env', Value: 'dev' }],
    })).resolves.toEqual({});
    expect(manager.addTags).toHaveBeenCalledWith('arn:aws:rds::cluster:sqlsrv-demo', [{ Key: 'Env', Value: 'dev' }]);

    await expect(handler.handleRequest('RemoveTagsFromResource', {
      ResourceName: 'arn:aws:rds::cluster:sqlsrv-demo',
      TagKeys: ['Env'],
    })).resolves.toEqual({});
    expect(manager.removeTags).toHaveBeenCalledWith('arn:aws:rds::cluster:sqlsrv-demo', ['Env']);
  });

  test('valida KMS quando StorageEncrypted é verdadeiro', async () => {
    const manager = criarGerenciador();
    const handler = new RdsApiHandler(manager, { getOrCreateDatabase: jest.fn() });
    handler.kmsService = { describeKey: jest.fn().mockRejectedValue(new Error('não encontrada')) };

    await expect(handler.handleRequest('CreateDBCluster', {
      DBClusterIdentifier: 'sqlsrv-demo',
      StorageEncrypted: 'true',
      KmsKeyId: 'alias/chave',
    })).rejects.toMatchObject({ code: 'InvalidParameterValue' });
    expect(manager.createCluster).not.toHaveBeenCalled();
  });

  test('roteia ações de clusters, instâncias e tags', async () => {
    const manager = criarGerenciador();
    const handler = new RdsApiHandler(manager, { getOrCreateDatabase: jest.fn() });

    await expect(handler.handleRequest('DescribeDBClusters', { DBClusterIdentifier: 'sqlsrv-demo' }))
      .resolves.toMatchObject({ DBClusters: expect.any(Array) });
    await expect(handler.handleRequest('DeleteDBCluster', { DBClusterIdentifier: 'sqlsrv-demo' }))
      .resolves.toEqual({});
    await expect(handler.handleRequest('CreateDBInstance', { DBInstanceIdentifier: 'sqlsrv-demo-1' }))
      .resolves.toMatchObject({ DBInstance: expect.any(Object) });
    await expect(handler.handleRequest('DescribeDBInstances', {}))
      .resolves.toMatchObject({ DBInstances: expect.any(Array) });
    await expect(handler.handleRequest('DeleteDBInstance', { DBInstanceIdentifier: 'sqlsrv-demo-1' }))
      .resolves.toEqual({});
    await expect(handler.handleRequest('ModifyDBCluster', { DBClusterIdentifier: 'sqlsrv-demo', Port: '1434' }))
      .resolves.toMatchObject({ DBCluster: expect.any(Object) });
    await expect(handler.handleRequest('StopDBCluster', { DBClusterIdentifier: 'sqlsrv-demo' }))
      .resolves.toMatchObject({ DBCluster: expect.any(Object) });
    await expect(handler.handleRequest('StartDBCluster', { DBClusterIdentifier: 'sqlsrv-demo' }))
      .resolves.toMatchObject({ DBCluster: expect.any(Object) });
    await expect(handler.handleRequest('ListTagsForResource', { ResourceArn: 'arn:aws:rds::cluster:sqlsrv-demo' }))
      .resolves.toMatchObject({ TagList: expect.any(Array) });
    await expect(handler.handleRequest('AddTagsToResource', {
      ResourceArn: 'arn:aws:rds::cluster:sqlsrv-demo',
      'Tags.member.1.Key': 'Env',
      'Tags.member.1.Value': 'dev',
    })).resolves.toEqual({});
    expect(manager.addTags).toHaveBeenCalledWith('arn:aws:rds::cluster:sqlsrv-demo', [{ Key: 'Env', Value: 'dev' }]);

    await expect(handler.handleRequest('RemoveTagsFromResource', {
      ResourceArn: 'arn:aws:rds::cluster:sqlsrv-demo',
      'TagKeys.member.1': 'Env',
    })).resolves.toEqual({});
    expect(manager.removeTags).toHaveBeenCalledWith('arn:aws:rds::cluster:sqlsrv-demo', ['Env']);
  });

  test('registra eventos no CloudTrail sem quebrar a requisição', async () => {
    const manager = criarGerenciador();
    const handler = new RdsApiHandler(manager, { getOrCreateDatabase: jest.fn() });
    handler.cloudTrailService = { recordEvent: jest.fn() };

    await handler.handleRequest('CreateDBCluster', { DBClusterIdentifier: 'sqlsrv-demo' });
    expect(handler.cloudTrailService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventSource: 'rds.amazonaws.com',
      eventName: 'CreateDBCluster',
    }));
  });

  test('rejeita ação desconhecida', async () => {
    const handler = new RdsApiHandler(criarGerenciador(), { getOrCreateDatabase: jest.fn() });
    await expect(handler.handleRequest('Bogus', {})).rejects.toMatchObject({ code: 'InvalidAction' });
  });
});
