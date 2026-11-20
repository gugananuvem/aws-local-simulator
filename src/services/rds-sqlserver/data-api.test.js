const { DataApiHandler } = require('./data-api');

const RESOURCE_ARN = 'arn:aws:rds:us-east-1:000000000000:cluster:sqlsrv-demo';
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:rds-demo';

function criarMocks() {
  const cluster = { DBClusterIdentifier: 'sqlsrv-demo', DatabaseName: 'master', Engine: 'sqlserver-se' };
  const clusterManager = {
    getClusterByArn: jest.fn((arn) => (arn === RESOURCE_ARN ? cluster : null)),
  };
  const dbEngine = {
    execute: jest.fn(),
    executeInTransaction: jest.fn(),
    beginTransaction: jest.fn(() => 'tx-1'),
    commit: jest.fn(),
    rollback: jest.fn(),
  };
  return { cluster, clusterManager, dbEngine };
}

describe('Data API do SQL Server', () => {
  test('liga :nome e @nome sem alterar literais nem comentários', () => {
    const handler = new DataApiHandler({}, {}, {});
    const sql = "SELECT ':name' AS literal, @name AS usuario, :other -- @name comentado\n";

    const { boundSql, bindings } = handler.bindParameters(sql, [
      { name: 'name', value: { stringValue: 'Ana' } },
      { name: 'other', value: { longValue: '42' } },
    ]);

    expect(boundSql).toContain("':name' AS literal");
    expect(boundSql).toContain('-- @name comentado');
    expect(boundSql.match(/\?/g)).toHaveLength(2);
    expect(bindings).toEqual(['Ana', 42]);
  });

  test('executa SELECT e formata registros com metadados', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    dbEngine.execute.mockReturnValue({
      type: 'select',
      rows: [{ id: 1, nome: 'Ana' }],
      columns: [{ name: 'id', type: 'INTEGER' }, { name: 'nome', type: 'TEXT' }],
      changes: 0,
      lastInsertRowid: 0,
    });
    const handler = new DataApiHandler(dbEngine, null, clusterManager);

    const result = await handler.handleRequest('RDSDataService.ExecuteStatement', {
      resourceArn: RESOURCE_ARN,
      secretArn: SECRET_ARN,
      sql: 'SELECT id, nome FROM users WHERE nome = :nome',
      parameters: [{ name: 'nome', value: { stringValue: 'Ana' } }],
      includeResultMetadata: true,
    });

    expect(result.records).toEqual([[{ longValue: 1 }, { stringValue: 'Ana' }]]);
    expect(result.columnMetadata).toHaveLength(2);
    expect(dbEngine.execute).toHaveBeenCalledWith('master', expect.stringContaining('?'), ['Ana']);
  });

  test('reporta DML com generatedFields para INSERT', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    dbEngine.execute.mockReturnValue({ type: 'dml', rows: [], columns: [], changes: 1, lastInsertRowid: 7 });
    const handler = new DataApiHandler(dbEngine, null, clusterManager);

    const result = await handler.executeStatement({
      resourceArn: RESOURCE_ARN,
      secretArn: SECRET_ARN,
      sql: 'INSERT INTO users (nome) VALUES (@nome)',
      parameters: [{ name: 'nome', value: { stringValue: 'Ana' } }],
    });

    expect(result).toMatchObject({ numberOfRecordsUpdated: 1, generatedFields: [{ longValue: 7 }] });
  });

  test('executa lote com conjuntos de parâmetros', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    dbEngine.execute.mockReturnValue({ type: 'dml', rows: [], columns: [], changes: 1, lastInsertRowid: 1 });
    const handler = new DataApiHandler(dbEngine, null, clusterManager);

    const result = await handler.batchExecuteStatement({
      resourceArn: RESOURCE_ARN,
      secretArn: SECRET_ARN,
      sql: 'INSERT INTO users (nome) VALUES (:nome)',
      parameterSets: [
        [{ name: 'nome', value: { stringValue: 'Ana' } }],
        [{ name: 'nome', value: { stringValue: 'Bia' } }],
      ],
    });

    expect(result.updateResults).toHaveLength(2);
    expect(dbEngine.execute).toHaveBeenCalledTimes(2);
  });

  test('gerencia transação com commit e rollback', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    const handler = new DataApiHandler(dbEngine, null, clusterManager);

    await expect(handler.beginTransaction({ resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN }))
      .resolves.toEqual({ transactionId: 'tx-1' });
    expect(handler.transactions.has('tx-1')).toBe(true);

    dbEngine.executeInTransaction.mockReturnValue({ type: 'dml', rows: [], columns: [], changes: 1, lastInsertRowid: 0 });
    await handler.executeStatement({
      resourceArn: RESOURCE_ARN,
      secretArn: SECRET_ARN,
      sql: 'UPDATE users SET nome = :nome',
      parameters: [{ name: 'nome', value: { stringValue: 'Ana' } }],
      transactionId: 'tx-1',
    });
    expect(dbEngine.executeInTransaction).toHaveBeenCalled();

    await expect(handler.commitTransaction({ secretArn: SECRET_ARN, transactionId: 'tx-1' }))
      .resolves.toEqual({ transactionStatus: 'Transaction Committed' });
    expect(dbEngine.commit).toHaveBeenCalledWith('tx-1');
    expect(handler.transactions.size).toBe(0);

    await handler.beginTransaction({ resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN });
    await expect(handler.rollbackTransaction({ secretArn: SECRET_ARN, transactionId: 'tx-1' }))
      .resolves.toEqual({ transactionStatus: 'Transaction Rolledback' });
    expect(dbEngine.rollback).toHaveBeenCalledWith('tx-1');
  });

  test('publica métrica no CloudWatch quando disponível', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    dbEngine.execute.mockReturnValue({ type: 'ddl', rows: [], columns: [], changes: 0, lastInsertRowid: 0 });
    const handler = new DataApiHandler(dbEngine, null, clusterManager);
    handler.cloudWatchService = { putMetricData: jest.fn() };

    await handler.executeStatement({ resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN, sql: 'CREATE TABLE t (id INT)' });

    expect(handler.cloudWatchService.putMetricData).toHaveBeenCalledWith(expect.objectContaining({
      namespace: 'AWS/RDS',
      metricData: expect.arrayContaining([expect.objectContaining({ metricName: 'DataAPIRequests' })]),
    }));
  });

  test('valida resourceArn, secretArn e targets desconhecidos', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    const handler = new DataApiHandler(dbEngine, null, clusterManager);

    await expect(handler.executeStatement({ secretArn: SECRET_ARN, sql: 'SELECT 1' }))
      .rejects.toMatchObject({ code: 'BadRequestException' });
    await expect(handler.executeStatement({ resourceArn: 'arn:qualquer', secretArn: SECRET_ARN, sql: 'SELECT 1' }))
      .rejects.toMatchObject({ code: 'NotFoundException' });
    await expect(handler.executeStatement({ resourceArn: RESOURCE_ARN, sql: 'SELECT 1' }))
      .rejects.toMatchObject({ code: 'BadRequestException' });
    await expect(handler.handleRequest('RDSDataService.Bogus', {}))
      .rejects.toMatchObject({ code: 'BadRequestException' });
  });

  test('handleRequest despacha os cinco targets da Data API', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    dbEngine.execute.mockReturnValue({ type: 'dml', rows: [], columns: [], changes: 0 });
    dbEngine.executeInTransaction.mockReturnValue({ type: 'dml', rows: [], columns: [], changes: 0 });
    const handler = new DataApiHandler(dbEngine, null, clusterManager);

    await expect(handler.handleRequest('RDSDataService.BatchExecuteStatement', {
      resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN, sql: 'UPDATE t SET v = :v', parameterSets: []
    })).resolves.toEqual({ updateResults: [] });
    await expect(handler.handleRequest('RDSDataService.BeginTransaction', {
      resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN
    })).resolves.toEqual({ transactionId: 'tx-1' });
    await expect(handler.handleRequest('RDSDataService.CommitTransaction', {
      secretArn: SECRET_ARN, transactionId: 'tx-1'
    })).resolves.toEqual({ transactionStatus: 'Transaction Committed' });
    await handler.handleRequest('RDSDataService.BeginTransaction', {
      resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN
    });
    await expect(handler.handleRequest('RDSDataService.RollbackTransaction', {
      secretArn: SECRET_ARN, transactionId: 'tx-1'
    })).resolves.toEqual({ transactionStatus: 'Transaction Rolledback' });
  });

  test('o binder ignora identificadores entre aspas/colchetes e comentários em bloco', () => {
    const handler = new DataApiHandler({}, {}, {});
    const sql = 'SELECT "col:@name", [outro:@name], /* @name */ @name, @@servername';
    const { boundSql, bindings } = handler.bindParameters(sql, [
      { name: 'name', value: { stringValue: 'Ana' } }
    ]);

    expect(boundSql).toContain('"col:@name"');
    expect(boundSql).toContain('[outro:@name]');
    expect(boundSql).toContain('/* @name */');
    expect(boundSql).toContain('@@servername');
    expect(boundSql.match(/\?/g)).toHaveLength(1);
    expect(bindings).toEqual(['Ana']);
  });

  test('extrai todos os tipos de valor tipado da Data API', () => {
    const handler = new DataApiHandler({}, {}, {});

    expect(handler.extractValue({ isNull: true })).toBeNull();
    expect(handler.extractValue({ doubleValue: '1.5' })).toBe(1.5);
    expect(handler.extractValue({ booleanValue: true })).toBe(1);
    expect(handler.extractValue({ booleanValue: false })).toBe(0);
    expect(handler.extractValue({ blobValue: Buffer.from('ab').toString('base64') })).toEqual(Buffer.from('ab'));
    expect(handler.extractValue(undefined)).toBeNull();
  });

  test('lote quebra com mensagem identificando o conjunto de parâmetros', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    dbEngine.execute
      .mockReturnValueOnce({ type: 'dml', rows: [], columns: [], changes: 1 })
      .mockImplementationOnce(() => { throw new Error('violação'); });
    const handler = new DataApiHandler(dbEngine, null, clusterManager);

    await expect(handler.batchExecuteStatement({
      resourceArn: RESOURCE_ARN,
      secretArn: SECRET_ARN,
      sql: 'INSERT INTO t (v) VALUES (:v)',
      parameterSets: [
        [{ name: 'v', value: { stringValue: 'ok' } }],
        [{ name: 'v', value: { stringValue: 'falha' } }]
      ]
    })).rejects.toMatchObject({ code: 'BadRequestException', message: expect.stringContaining('conjunto de parâmetros 1') });
  });

  test('timeout e close revertem transações pendentes', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    const handler = new DataApiHandler(dbEngine, null, clusterManager);

    jest.useFakeTimers();
    try {
      await handler.beginTransaction({ resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN });
      jest.advanceTimersByTime(3 * 60 * 1000);
      expect(dbEngine.rollback).toHaveBeenCalledWith('tx-1');
      expect(handler.transactions.size).toBe(0);

      await handler.beginTransaction({ resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN });
      handler.close();
      expect(dbEngine.rollback).toHaveBeenCalledTimes(2);
      expect(handler.transactions.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('valida secretArn no Secret Manager quando o padrão não corresponde', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    const handler = new DataApiHandler(dbEngine, null, clusterManager);
    const secretManagerService = { getSecretValue: jest.fn() };
    handler.secretManagerService = secretManagerService;
    dbEngine.execute.mockReturnValue({ type: 'ddl', rows: [], columns: [], changes: 0 });

    secretManagerService.getSecretValue.mockResolvedValueOnce({});
    await expect(handler.executeStatement({
      resourceArn: RESOURCE_ARN,
      secretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:custom',
      sql: 'SELECT 1'
    })).resolves.toMatchObject({ numberOfRecordsUpdated: 0 });

    secretManagerService.getSecretValue.mockRejectedValueOnce(new Error('not found'));
    await expect(handler.executeStatement({
      resourceArn: RESOURCE_ARN,
      secretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:invalid',
      sql: 'SELECT 1'
    })).rejects.toMatchObject({ code: 'BadRequestException' });
  });

  test('falha ao publicar métrica não quebra a execução', async () => {
    const { clusterManager, dbEngine } = criarMocks();
    dbEngine.execute.mockReturnValue({ type: 'ddl', rows: [], columns: [], changes: 0 });
    const debug = jest.fn();
    const handler = new DataApiHandler(dbEngine, null, clusterManager, { debug });
    handler.cloudWatchService = {
      putMetricData: jest.fn(() => { throw new Error('CloudWatch indisponível'); })
    };

    await expect(handler.executeStatement({
      resourceArn: RESOURCE_ARN, secretArn: SECRET_ARN, sql: 'CREATE TABLE t (id INT)'
    })).resolves.toMatchObject({ numberOfRecordsUpdated: 0 });
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Falha ao publicar métrica'));
  });
});
