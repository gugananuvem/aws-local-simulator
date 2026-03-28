/**
 * Testes básicos do AWS Local Simulator
 */

const { AWSLocalSimulator } = require('../src/index');

describe('AWS Local Simulator', () => {
  let simulator;

  beforeEach(() => {
    simulator = new AWSLocalSimulator();
  });

  afterEach(async () => {
    if (simulator.isRunning) {
      await simulator.stop();
    }
  });

  test('Deve criar instância do simulador', () => {
    expect(simulator).toBeDefined();
    expect(simulator.isRunning).toBe(false);
  });

  test('Deve carregar configurações padrão', async () => {
    // Aguarda a inicialização interna
    const config = simulator.options;
    expect(config).toBeDefined();
  });

  test('Deve iniciar serviços', async () => {
    await simulator.start();
    expect(simulator.isRunning).toBe(true);
  }, 15000);

  test('Deve parar serviços', async () => {
    await simulator.start();
    await simulator.stop();
    expect(simulator.isRunning).toBe(false);
  }, 15000);

  test('Deve retornar status', async () => {
    const status = simulator.getStatus();
    expect(status).toHaveProperty('running');
    // services pode não existir se não iniciado
    if (!simulator.isRunning) {
      expect(status.running).toBe(false);
    }
  });
});