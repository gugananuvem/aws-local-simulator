/**
 * Testes do DynamoDB Simulator
 */

const DynamoDBService = require('../../src/services/dynamodb');

describe('DynamoDB Service', () => {
  let service;

  beforeEach(() => {
    // Configuração de teste
    const config = {
      ports: { dynamodb: 8001 },
      dataDir: process.env.AWS_LOCAL_SIMULATOR_DATA_DIR,
      dynamodb: {
        tables: [
          {
            TableName: 'test-table',
            KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
            AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }]
          }
        ]
      }
    };
    service = new DynamoDBService(config);
  });

  afterEach(async () => {
    if (service.isRunning) {
      await service.stop();
    }
  });

  test('Deve inicializar serviço', async () => {
    await service.initialize();
    expect(service.simulator).toBeDefined();
    expect(service.name).toBe('dynamodb');
  }, 5000);

  test('Deve iniciar servidor', async () => {
    await service.initialize();
    await service.start();
    expect(service.isRunning).toBe(true);
  }, 10000);

  test('Deve parar servidor', async () => {
    await service.initialize();
    await service.start();
    await service.stop();
    expect(service.isRunning).toBe(false);
  }, 10000);

  test('Deve retornar status', async () => {
    await service.initialize();
    const status = service.getStatus();
    expect(status).toHaveProperty('running');
    expect(status).toHaveProperty('port');
    expect(status).toHaveProperty('endpoint');
    expect(status.port).toBe(8001);
  }, 5000);
});