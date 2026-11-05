/**
 * Testes do suporte a runtimes externos (poliglota) no Lambda Simulator.
 * Cobre: registro externo não chama HandlerLoader.load; invoke externo faz
 * POST ao endpoint e retorna o payload; timeout vira erro; HTTP >=400 vira
 * erro com mensagem útil; e regressão do caminho JS.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// Silencia o logger para não poluir a saída dos testes
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  verboso: jest.fn(),
}));

const HandlerLoader = require('./handler-loader');
const LambdaSimulator = require('./simulator');

function makeSimulator() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-ext-test-'));
  const sim = new LambdaSimulator({ dataDir });
  // initialize() apenas para configurar defaults globais e defaultEndpoint
  sim.globalEnv = {};
  sim.globalTimeout = null;
  sim.globalMemorySize = null;
  sim.externalDefaultEndpoint = null;
  sim._dataDir = dataDir;
  return sim;
}

describe('LambdaSimulator - runtimes externos (poliglota)', () => {
  let sim;

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  beforeEach(() => {
    sim = makeSimulator();
  });

  test('registro de lambda externa NÃO chama HandlerLoader.load', async () => {
    const loadSpy = jest.spyOn(HandlerLoader, 'load');

    await sim.registerLambda({
      name: 'py-fn',
      runtime: 'python3.12',
      runtimeEndpoint: 'http://localhost:5001/invoke',
      handler: 'chat_handler.lambda_handler',
      timeout: 30,
    });

    expect(loadSpy).not.toHaveBeenCalled();

    const lambda = sim.getLambda('py-fn');
    expect(lambda).toBeDefined();
    expect(lambda.external).toBe(true);
    expect(lambda.runtimeEndpoint).toBe('http://localhost:5001/invoke');
    expect(typeof lambda.handler).toBe('function');
    expect(lambda.handlerPath).toBeNull();
    expect(lambda.handlerName).toBe('chat_handler.lambda_handler');
  });

  test('runtime externo sem endpoint é registrado como NÃO invocável e não quebra o boot', async () => {
    await sim.registerLambda({
      name: 'py-no-endpoint',
      runtime: 'python3.12',
      timeout: 30,
    });

    const lambda = sim.getLambda('py-no-endpoint');
    expect(lambda).toBeDefined();
    expect(lambda.external).toBe(true);
    expect(lambda.invocable).toBe(false);
    expect(lambda.handler).toBeNull();

    await expect(sim.invoke('py-no-endpoint', {})).rejects.toThrow(/not invocable/i);
  });

  test('defaultEndpoint global é usado quando runtimeEndpoint não é informado', async () => {
    sim.externalDefaultEndpoint = 'http://localhost:9000/invoke';

    await sim.registerLambda({
      name: 'py-default',
      runtime: 'python3.12',
      timeout: 30,
    });

    const lambda = sim.getLambda('py-default');
    expect(lambda.external).toBe(true);
    expect(lambda.invocable).toBe(true);
    expect(lambda.runtimeEndpoint).toBe('http://localhost:9000/invoke');
  });

  test('invoke de lambda externa faz POST ao endpoint e retorna o payload', async () => {
    const resultPayload = { statusCode: 200, body: 'ok-from-python' };
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(resultPayload),
    }));

    await sim.registerLambda({
      name: 'py-fn',
      runtime: 'python3.12',
      runtimeEndpoint: 'http://localhost:5001/invoke',
      timeout: 30,
    });

    const event = { path: '/chat', body: 'hi' };
    const res = await sim.invoke('py-fn', event);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = global.fetch.mock.calls[0];
    expect(calledUrl).toBe('http://localhost:5001/invoke');
    expect(calledOpts.method).toBe('POST');
    expect(calledOpts.headers['Content-Type']).toBe('application/json');

    const sentBody = JSON.parse(calledOpts.body);
    expect(sentBody.event).toEqual(event);
    // context serializado só com campos de dados (sem funções)
    expect(sentBody.context).toBeDefined();
    expect(sentBody.context.functionName).toBe('py-fn');
    expect(typeof sentBody.context.deadlineMs).toBe('number');
    expect(sentBody.context.getRemainingTimeInMillis).toBeUndefined();

    expect(res.StatusCode).toBe(200);
    expect(res.Payload).toEqual(resultPayload);
  });

  test('envelope { result, logs } repassa logs e retorna result', async () => {
    const envelope = { result: { ok: true }, logs: ['linha 1', 'linha 2'] };
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(envelope),
    }));

    const cwLogs = [];
    sim.cloudwatchSimulator = {
      putLambdaLogs: async (_fn, _rid, logs) => { cwLogs.push(...logs); },
    };

    await sim.registerLambda({
      name: 'py-env',
      runtime: 'python3.12',
      runtimeEndpoint: 'http://localhost:5001/invoke',
      timeout: 30,
    });

    const res = await sim.invoke('py-env', {});
    expect(res.Payload).toEqual({ ok: true });
    // aguarda microtask do putLambdaLogs
    await Promise.resolve();
    expect(cwLogs).toEqual(expect.arrayContaining(['linha 1', 'linha 2']));
  });

  test('timeout do runtime externo gera erro de invocação claro', async () => {
    global.fetch = jest.fn((url, opts) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    await sim.registerLambda({
      name: 'py-timeout',
      runtime: 'python3.12',
      runtimeEndpoint: 'http://localhost:5001/invoke',
      timeout: 1, // 1s
    });

    await expect(sim.invoke('py-timeout', {})).rejects.toThrow(/Task timed out after 1 seconds/);
  });

  test('HTTP >=400 do runtime externo vira erro de invocação com mensagem útil', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ errorType: 'RuntimeError', errorMessage: 'boom no python' }),
    }));

    await sim.registerLambda({
      name: 'py-error',
      runtime: 'python3.12',
      runtimeEndpoint: 'http://localhost:5001/invoke',
      timeout: 30,
    });

    await expect(sim.invoke('py-error', {})).rejects.toThrow('boom no python');
  });

  test('regressão: lambda JS continua carregando e invocando', async () => {
    // Cria um handler JS real em disco
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-js-test-'));
    const handlerFile = path.join(tmpDir, 'handler.js');
    fs.writeFileSync(
      handlerFile,
      'exports.handler = async (event) => ({ statusCode: 200, echoed: event.msg });'
    );

    await sim.registerLambda({
      name: 'js-fn',
      handler: handlerFile,
      runtime: 'nodejs18.x',
      type: 'commonjs',
      timeout: 30,
    });

    const lambda = sim.getLambda('js-fn');
    expect(lambda).toBeDefined();
    expect(lambda.external).toBeUndefined();
    expect(typeof lambda.handler).toBe('function');

    const res = await sim.invoke('js-fn', { msg: 'hello' });
    expect(res.StatusCode).toBe(200);
    expect(res.Payload.echoed).toBe('hello');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
