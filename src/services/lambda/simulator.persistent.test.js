/**
 * Testes do modo PERSISTENTE (um worker Python por Lambda) e debug:
 * reuso de PID, init único, fila/correlação, erro, timeout, crash, limpeza,
 * variáveis de debug, debugpy ausente e regressões (processo por invocação,
 * precedência do runtimeEndpoint).
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
const logger = require('../../utils/logger');
const LambdaSimulator = require('./simulator');

jest.setTimeout(60000);

const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
const pyProbe = spawnSync(pythonCmd, ['--version'], { stdio: 'ignore' });
const hasPython = !pyProbe.error && pyProbe.status === 0;
const describePy = hasPython ? describe : describe.skip;

function makeSimulator() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-pers-data-'));
  const sim = new LambdaSimulator({ dataDir });
  sim.globalEnv = {};
  sim.globalTimeout = null;
  sim.globalMemorySize = null;
  sim.externalDefaultEndpoint = null;
  sim.cloudwatchLogs = [];
  sim.cloudwatchSimulator = {
    putLambdaLogs: jest.fn(async (fn, reqId, lines) => {
      sim.cloudwatchLogs.push(...lines);
    }),
  };
  return sim;
}

function makeCodeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-pers-code-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

const HANDLER = `
import os, sys, time
with open(os.path.join(os.path.dirname(__file__), "imports.txt"), "a") as f:
    f.write("import\\n")
CALLS = [0]

def handler(event, context):
    CALLS[0] += 1
    mode = event.get("mode")
    if mode == "sleep":
        time.sleep(event["s"])
    if mode == "boom":
        raise ValueError("boom!")
    if mode == "crash":
        sys.stderr.write("morrendo\\n")
        sys.stderr.flush()
        os._exit(1)
    print("log-da-invocacao", event.get("n"))
    return {
        "pid": os.getpid(), "calls": CALLS[0], "n": event.get("n"),
        "fn": context.function_name,
        "dbgPort": os.environ.get("AWS_LOCAL_SIM_DEBUG_PORT"),
        "dbgHost": os.environ.get("AWS_LOCAL_SIM_DEBUG_HOST"),
        "dbgWait": os.environ.get("AWS_LOCAL_SIM_DEBUG_WAIT"),
    }
`;

describePy('LambdaSimulator - modo persistente', () => {
  let sim;
  beforeEach(() => {
    sim = makeSimulator();
    jest.clearAllMocks();
  });
  afterEach(async () => {
    await sim.shutdownWorkers();
    jest.restoreAllMocks();
    delete global.fetch;
    delete process.env.AWS_LOCAL_SIMULATOR_LAMBDA_DEBUG;
  });

  const reg = (codePath, extra = {}) =>
    sim.registerLambda({
      name: 'pl',
      runtime: 'python3.12',
      handler: 'h.handler',
      codePath,
      persistent: true,
      timeout: 20,
      ...extra,
    });

  test('regressão: sem persistent cada invocação usa um processo novo', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    await sim.registerLambda({ name: 'np', runtime: 'python3.12', handler: 'h.handler', codePath });
    const a = await sim.invoke('np', { n: 1 });
    const b = await sim.invoke('np', { n: 2 });
    expect(a.Payload.pid).not.toBe(b.Payload.pid);
    expect(sim.getLambda('np').worker).toBeUndefined();
    expect(sim.listLambdas()[0].persistent).toBe(false);
  });

  test('regressão: runtimeEndpoint tem precedência sobre codePath', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ via: 'http' }) }));
    await sim.registerLambda({
      name: 'ep',
      runtime: 'python3.12',
      handler: 'h.handler',
      codePath,
      persistent: true,
      runtimeEndpoint: 'http://127.0.0.1:1/x',
    });
    const res = await sim.invoke('ep', {});
    expect(res.Payload).toEqual({ via: 'http' });
    expect(sim.getLambda('ep').worker).toBeUndefined();
  });

  test('mesmo PID, módulo importado uma vez, estado preservado, logs e admin', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    await reg(codePath);
    const entry = sim.getLambda('pl');
    expect(entry.worker.status).toBe('ready'); // subida antecipada
    const pidBoot = entry.worker.pid;
    const a = await sim.invoke('pl', { n: 1 });
    const b = await sim.invoke('pl', { n: 2 });
    const c = await sim.invoke('pl', { n: 3 });
    expect([a, b, c].map((r) => r.Payload.pid)).toEqual([pidBoot, pidBoot, pidBoot]);
    expect([a, b, c].map((r) => r.Payload.calls)).toEqual([1, 2, 3]);
    expect(a.Payload.fn).toBe('pl');
    expect(fs.readFileSync(path.join(codePath, 'imports.txt'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(sim.cloudwatchLogs).toContain('log-da-invocacao 2');
    const info = sim.listLambdas().find((l) => l.name === 'pl');
    expect(info).toMatchObject({ persistent: true, workerStatus: 'ready', workerPid: pidBoot, debugPort: null });
  });

  test('invocações concorrentes são serializadas e correlacionadas', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    await reg(codePath);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => sim.invoke('pl', n === 1 ? { n, mode: 'sleep', s: 0.3 } : { n }))
    );
    expect(results.map((r) => r.Payload.n)).toEqual([1, 2, 3, 4, 5]);
    expect(results.map((r) => r.Payload.calls)).toEqual([1, 2, 3, 4, 5]); // FIFO, uma por vez
    expect(new Set(results.map((r) => r.Payload.pid)).size).toBe(1);
  });

  test('erro do handler vira falha de invocação e o worker continua vivo', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    await reg(codePath);
    const pid = sim.getLambda('pl').worker.pid;
    await expect(sim.invoke('pl', { mode: 'boom' })).rejects.toThrow('boom!');
    const ok = await sim.invoke('pl', { n: 9 });
    expect(ok.Payload.pid).toBe(pid);
  });

  test('timeout mata e recria o worker', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    await reg(codePath, { timeout: 1 });
    const pid = sim.getLambda('pl').worker.pid;
    await expect(sim.invoke('pl', { mode: 'sleep', s: 5 })).rejects.toThrow('Task timed out after 1 seconds');
    const ok = await sim.invoke('pl', { n: 1 }); // aguarda o kill terminar e recria o worker
    expect(isAlive(pid)).toBe(false);
    expect(ok.Payload.pid).not.toBe(pid);
    expect(ok.Payload.calls).toBe(1);
  });

  test('debug.ignoreTimeout (padrão) não aplica o timeout; variáveis de debug chegam ao worker', async () => {
    const codePath = makeCodeDir({
      'h.py': HANDLER,
      // debugpy falso: registra os argumentos, sem depender do real
      'debugpy.py': `
import os
def listen(addr):
    open(os.path.join(os.path.dirname(__file__), "listen.txt"), "w").write(repr(addr))
def wait_for_client():
    open(os.path.join(os.path.dirname(__file__), "wait.txt"), "w").write("1")
`,
    });
    await reg(codePath, { timeout: 1, debug: { port: 58765, waitForClient: true } });
    const w = sim.getLambda('pl').worker;
    expect(w.debugPort).toBe(58765);
    const res = await sim.invoke('pl', { mode: 'sleep', s: 2.5 }); // > timeout de 1s
    expect(res.Payload).toMatchObject({ dbgPort: '58765', dbgHost: '127.0.0.1', dbgWait: '1', pid: w.pid });
    expect(fs.readFileSync(path.join(codePath, 'listen.txt'), 'utf8')).toBe("('127.0.0.1', 58765)");
    expect(fs.existsSync(path.join(codePath, 'wait.txt'))).toBe(true);
    expect(sim.listLambdas()[0].debugPort).toBe(58765);
  });

  test('debug.ignoreTimeout=false aplica o timeout', async () => {
    const codePath = makeCodeDir({
      'h.py': HANDLER,
      'debugpy.py': 'def listen(a):\n    pass\ndef wait_for_client():\n    pass\n',
    });
    await reg(codePath, { timeout: 1, debug: { port: 58766, ignoreTimeout: false } });
    await expect(sim.invoke('pl', { mode: 'sleep', s: 4 })).rejects.toThrow('Task timed out after 1 seconds');
  });

  test('variável AWS_LOCAL_SIMULATOR_LAMBDA_DEBUG liga o debug sem editar o config', async () => {
    process.env.AWS_LOCAL_SIMULATOR_LAMBDA_DEBUG = 'outra:1111,pl:58767';
    const codePath = makeCodeDir({
      'h.py': HANDLER,
      'debugpy.py': 'def listen(a):\n    pass\ndef wait_for_client():\n    pass\n',
    });
    await sim.registerLambda({ name: 'pl', runtime: 'python3.12', handler: 'h.handler', codePath });
    const res = await sim.invoke('pl', { n: 1 });
    expect(res.Payload.dbgPort).toBe('58767');
    expect(sim.getLambda('pl').persistent).toBe(true);
  });

  test('debug sem persistent vira persistent e avisa', async () => {
    const codePath = makeCodeDir({
      'h.py': HANDLER,
      'debugpy.py': 'def listen(a):\n    pass\ndef wait_for_client():\n    pass\n',
    });
    await sim.registerLambda({ name: 'pl', runtime: 'python3.12', handler: 'h.handler', codePath, debug: { port: 58768 } });
    expect(sim.getLambda('pl').persistent).toBe(true);
    expect(logger.warn.mock.calls.some((c) => /persistent/.test(String(c[0])))).toBe(true);
  });

  test('debugpy ausente: worker sobe sem debug e loga o aviso', async () => {
    const codePath = makeCodeDir({
      'h.py': HANDLER,
      'debugpy.py': 'raise ImportError("sem debugpy")\n', // simula pacote não instalado
    });
    await reg(codePath, { debug: { port: 58769 } });
    const res = await sim.invoke('pl', { n: 1 });
    expect(res.Payload.n).toBe(1);
    expect(logger.debug.mock.calls.some((c) => /pip install debugpy/.test(String(c[0])))).toBe(true);
  });

  test('crash do worker rejeita com mensagem útil e a próxima invocação funciona', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    await reg(codePath);
    const pid = sim.getLambda('pl').worker.pid;
    await expect(sim.invoke('pl', { mode: 'crash' })).rejects.toThrow(/terminou inesperadamente com código 1.*morrendo/s);
    const ok = await sim.invoke('pl', { n: 1 });
    expect(ok.Payload.pid).not.toBe(pid);
  });

  test('crash rejeita também as invocações que estavam na fila', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    await reg(codePath);
    const p1 = sim.invoke('pl', { mode: 'crash' });
    const p2 = sim.invoke('pl', { n: 2 });
    const [r1, r2] = await Promise.allSettled([p1, p2]);
    expect(r1.status).toBe('rejected');
    expect(r2.status).toBe('rejected');
    expect((await sim.invoke('pl', { n: 3 })).Payload.n).toBe(3);
  });

  test('falha no init não derruba o boot; lambda segue invocável e tenta recriar', async () => {
    const codePath = makeCodeDir({ 'h.py': 'raise RuntimeError("init quebrou")\n' });
    await expect(reg(codePath)).resolves.toBeUndefined();
    const entry = sim.getLambda('pl');
    expect(entry.invocable).toBe(true);
    await expect(sim.invoke('pl', {})).rejects.toThrow(/init quebrou/);
    fs.writeFileSync(path.join(codePath, 'h.py'), HANDLER); // corrigido
    expect((await sim.invoke('pl', { n: 1 })).Payload.n).toBe(1);
  });

  test('config inválida: sem debug.port, command e node com persistent ficam não invocáveis', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER, 'index.js': 'exports.h = () => 1;' });
    await reg(codePath, { name: 'sem-porta', debug: { host: '127.0.0.1' } });
    expect(sim.getLambda('sem-porta').invocable).toBe(false);
    expect(sim.getLambda('sem-porta').invalidReason).toMatch(/debug\.port/);

    await sim.registerLambda({
      name: 'cmd',
      runtime: 'java21',
      codePath,
      command: 'echo {handler}',
      handler: 'x',
      persistent: true,
    });
    expect(sim.getLambda('cmd').invocable).toBe(false);
    expect(sim.getLambda('cmd').invalidReason).toMatch(/persistente/);
    await expect(sim.invoke('cmd', {})).rejects.toThrow(/not invocable/);

    await sim.registerLambda({ name: 'nd', runtime: 'nodejs20.x', handler: 'index.h', codePath, persistent: true });
    expect(sim.getLambda('nd').invocable).toBe(false);
  });

  test('shutdownWorkers não deixa processo vivo', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    await reg(codePath);
    const pid = sim.getLambda('pl').worker.pid;
    expect(isAlive(pid)).toBe(true);
    await sim.shutdownWorkers();
    expect(isAlive(pid)).toBe(false);
    expect(sim.getLambda('pl').worker).toBeNull();
  });

  test('reloadLambdas reinicia o worker (código novo) e deleteFunction para o worker', async () => {
    const codePath = makeCodeDir({ 'h.py': HANDLER });
    await reg(codePath);
    const pid = sim.getLambda('pl').worker.pid;
    await sim.reloadLambdas();
    expect(isAlive(pid)).toBe(false);
    const after = await sim.invoke('pl', { n: 1 });
    expect(after.Payload.pid).not.toBe(pid);
    expect(after.Payload.calls).toBe(1);
    const pid2 = sim.getLambda('pl').worker.pid;
    await sim.deleteFunction('pl');
    expect(isAlive(pid2)).toBe(false);
  });

  test('updateFunction com mudança de env recria o worker com o novo env', async () => {
    const codePath = makeCodeDir({
      'h.py': HANDLER.replace('"dbgWait"', '"x": os.environ.get("FOO"), "dbgWait"'),
    });
    await reg(codePath, { env: { FOO: 'a' } });
    const pid = sim.getLambda('pl').worker.pid;
    expect((await sim.invoke('pl', {})).Payload.x).toBe('a');
    await sim.updateFunction('pl', { env: { FOO: 'b' } });
    expect(isAlive(pid)).toBe(false);
    const r = await sim.invoke('pl', {});
    expect(r.Payload.x).toBe('b');
    expect(sim.getLambda('pl').persistent).toBe(true);
  });
});
