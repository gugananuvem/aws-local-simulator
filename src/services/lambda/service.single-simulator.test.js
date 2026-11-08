/**
 * Uma única instância de LambdaSimulator (e um único worker persistente) por
 * LambdaService: 1 worker após initialize(), 0 após stop().
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  verboso: jest.fn(),
}));
const LambdaService = require('./index');
const LambdaServer = require('./server');
const LambdaSimulator = require('./simulator');
const { liveWorkers } = require('./runtimes/persistent-worker');

jest.setTimeout(60000);

const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
const pyProbe = spawnSync(pythonCmd, ['--version'], { stdio: 'ignore' });
const describePy = !pyProbe.error && pyProbe.status === 0 ? describe : describe.skip;

describePy('LambdaService - simulador único', () => {
  test('1 worker vivo após initialize, 0 após stop; server reutiliza o simulador', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-svc-data-'));
    const codePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-svc-code-'));
    fs.writeFileSync(path.join(codePath, 'h.py'), 'def handler(event, context):\n    return {"statusCode": 200}\n');

    const before = liveWorkers.size;
    const service = new LambdaService({
      dataDir,
      ports: { lambda: 0 },
      lambdas: [{ name: 'fn', runtime: 'python3.12', handler: 'h.handler', codePath, persistent: true }],
    });
    await service.initialize();
    try {
      expect(service.server.simulator).toBe(service.simulator);
      expect(liveWorkers.size - before).toBe(1);
    } finally {
      await service.stop();
    }
    expect(liveWorkers.size - before).toBe(0);
  });
});

describe('LambdaServer isolado', () => {
  test('cria o próprio simulador e encerra seus workers no stop', async () => {
    const shutdown = jest.spyOn(LambdaSimulator.prototype, 'shutdownWorkers').mockResolvedValue();
    jest.spyOn(LambdaSimulator.prototype, 'initialize').mockResolvedValue();
    const server = new LambdaServer(0, {});
    await server.initialize();
    expect(server.ownsSimulator).toBe(true);
    await server.stop();
    expect(shutdown).toHaveBeenCalledTimes(1);

    // Simulador injetado: o server não é dono e não encerra os workers
    shutdown.mockClear();
    const injected = new LambdaServer(0, {});
    injected.simulator = { getLambdasCount: () => 0 };
    await injected.initialize();
    await injected.stop();
    expect(shutdown).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});
