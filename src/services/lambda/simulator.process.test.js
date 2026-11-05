/**
 * Testes do modo de runtime externo por PROCESSO (spawn por invocação):
 * bootstrap Node (sync/async/logs), erros, timeout (kill), ENOENT, modo
 * command genérico, validação no registro, precedência e Python (se existir).
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

const LambdaSimulator = require('./simulator');
const { parseCommand } = require('./runtimes/process-runner');

jest.setTimeout(30000);

function makeSimulator() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-proc-data-'));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-proc-code-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
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

const pyProbe = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['--version'], { stdio: 'ignore' });
const hasPython = !pyProbe.error && pyProbe.status === 0;
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

describe('LambdaSimulator - runtime por processo', () => {
  let sim;
  beforeEach(() => {
    sim = makeSimulator();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  describe('bootstrap Node', () => {
    test('handler sync e async, console.log capturado como logs e contexto', async () => {
      const codePath = makeCodeDir({
        'index.js': `
          exports.syncHandler = (event, context) => {
            console.log('log-sync', event.n);
            return { statusCode: 200, n: event.n + 1, fn: context.functionName, left: context.getRemainingTimeInMillis() };
          };
          exports.asyncHandler = async (event) => {
            console.error('log-err');
            await new Promise((r) => setTimeout(r, 20));
            return { statusCode: 200, doubled: event.n * 2, env: process.env.MY_VAR, cwd: process.cwd() };
          };
        `,
      });
      await sim.registerLambda({ name: 'n-sync', runtime: 'nodejs20.x', handler: 'index.syncHandler', codePath, timeout: 10 });
      await sim.registerLambda({
        name: 'n-async', runtime: 'nodejs20.x', handler: 'index.asyncHandler', codePath, timeout: 10, env: { MY_VAR: 'abc' },
      });

      const entry = sim.getLambda('n-sync');
      expect(entry.external).toBe(true);
      expect(entry.executionMode).toBe('process');
      expect(entry.invocable).toBe(true);
      expect(entry.codePath).toBe(codePath);

      const r1 = await sim.invoke('n-sync', { n: 1 });
      expect(r1.Payload.n).toBe(2);
      expect(r1.Payload.fn).toBe('n-sync');
      expect(r1.Payload.left).toBeGreaterThan(0);
      expect(r1.Payload.left).toBeLessThanOrEqual(30000);
      expect(sim.cloudwatchLogs).toContain('log-sync 1');

      const r2 = await sim.invoke('n-async', { n: 4 });
      expect(r2.Payload.doubled).toBe(8);
      expect(r2.Payload.env).toBe('abc');
      expect(fs.realpathSync(r2.Payload.cwd)).toBe(fs.realpathSync(codePath));
      expect(sim.cloudwatchLogs).toContain('log-err');
    });

    test('saída do usuário que imita JSON/marcador não corrompe o resultado', async () => {
      const codePath = makeCodeDir({
        'index.js': `exports.h = async () => { console.log('{"statusCode":500}'); console.log('__AWSLOCALSIM_fake__:RESULT:BEGIN{}'); return { statusCode: 200, ok: true }; };`,
      });
      await sim.registerLambda({ name: 'noisy', runtime: 'nodejs20.x', handler: 'index.h', codePath });
      const res = await sim.invoke('noisy', {});
      expect(res.Payload).toEqual({ statusCode: 200, ok: true });
    });

    test('erro do handler vira erro de invocação (errorMessage) e logs são preservados', async () => {
      const codePath = makeCodeDir({
        'index.js': `exports.h = async () => { console.log('antes'); throw new TypeError('boom!'); };`,
      });
      await sim.registerLambda({ name: 'err-fn', runtime: 'nodejs20.x', handler: 'index.h', codePath });
      const err = await sim.invoke('err-fn', {}).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('boom!');
      expect(err.errorType).toBe('TypeError');
      expect(Array.isArray(err.stackTrace)).toBe(true);
      expect(sim.cloudwatchLogs).toContain('antes');
    });

    test('módulo/função inexistente em runtime vira erro claro', async () => {
      const codePath = makeCodeDir({ 'index.js': `exports.other = () => 1;` });
      await sim.registerLambda({ name: 'nofn', runtime: 'nodejs20.x', handler: 'index.missing', codePath });
      await expect(sim.invoke('nofn', {})).rejects.toThrow(/missing/);
    });

    test('exit não-zero sem resultado inclui o tail do stderr', async () => {
      const codePath = makeCodeDir({
        'index.js': `exports.h = () => { process.stderr.write('falha-fatal-xyz'); process.exit(3); };`,
      });
      await sim.registerLambda({ name: 'exit3', runtime: 'nodejs20.x', handler: 'index.h', codePath });
      await expect(sim.invoke('exit3', {})).rejects.toThrow(/código 3.*falha-fatal-xyz/s);
    });

    test('timeout mata o processo e lança "Task timed out after N seconds"', async () => {
      const codePath = makeCodeDir({
        'index.js': `
          const fs = require('fs');
          exports.h = async () => { fs.writeFileSync(process.env.PID_FILE, String(process.pid)); setInterval(() => {}, 1000); return new Promise(() => {}); };
        `,
      });
      const pidFile = path.join(codePath, 'pid.txt');
      await sim.registerLambda({
        name: 'slow', runtime: 'nodejs20.x', handler: 'index.h', codePath, timeout: 1, env: { PID_FILE: pidFile },
      });
      await expect(sim.invoke('slow', {})).rejects.toThrow('Task timed out after 1 seconds');
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      expect(pid).toBeGreaterThan(0);
      let alive = true;
      for (let i = 0; i < 40 && alive; i++) {
        alive = isAlive(pid);
        if (alive) await new Promise((r) => setTimeout(r, 100));
      }
      expect(alive).toBe(false);
    });

    test('interpretador inexistente (ENOENT) gera erro mencionando o comando', async () => {
      const codePath = makeCodeDir({ 'index.js': `exports.h = () => ({ statusCode: 200 });` });
      await sim.registerLambda({
        name: 'enoent', runtime: 'nodejs20.x', handler: 'index.h', codePath, command: 'interp-que-nao-existe-xyz',
      });
      expect(sim.getLambda('enoent').invocable).toBe(true);
      await expect(sim.invoke('enoent', {})).rejects.toThrow(/interp-que-nao-existe-xyz.*ENOENT/);
    });

    test('command com override de interpretador (caminho do node) funciona', async () => {
      const codePath = makeCodeDir({ 'index.js': `exports.h = () => ({ statusCode: 200, v: process.version });` });
      await sim.registerLambda({ name: 'ovr', runtime: 'nodejs20.x', handler: 'index.h', codePath, command: process.execPath });
      const res = await sim.invoke('ovr', {});
      expect(res.Payload.v).toBe(process.version);
    });
  });

  describe('modo command genérico', () => {
    const prog = `
      let data = '';
      process.stdin.on('data', (c) => (data += c));
      process.stdin.on('end', () => {
        const input = JSON.parse(data);
        (process.env.USE_MARKERS ? console.log : console.error)('linha de log do programa estrangeiro');
        const out = { statusCode: 200, handler: input.handler, event: input.event, argv: process.argv.slice(2), hasCtx: !!input.context.awsRequestId };
        if (process.env.USE_MARKERS) {
          const m = process.env.AWS_LOCAL_SIM_MARKER;
          process.stdout.write('\\n' + m + ':RESULT:BEGIN' + JSON.stringify(out) + m + ':RESULT:END\\n');
        } else {
          process.stdout.write(JSON.stringify(out));
        }
      });
    `;

    test('stdout inteiro como JSON, {handler} substituído e evento só por stdin', async () => {
      const codePath = makeCodeDir({ 'prog.js': prog });
      await sim.registerLambda({
        name: 'gen', runtime: 'java21', handler: 'com.acme.Handler::handle', codePath,
        command: `"${process.execPath}" prog.js {handler}`,
      });
      const evil = { x: '"; echo pwned & $(whoami) `id`' };
      const res = await sim.invoke('gen', evil);
      expect(res.Payload.argv).toEqual(['com.acme.Handler::handle']);
      expect(res.Payload.event).toEqual(evil);
      expect(res.Payload.hasCtx).toBe(true);
      expect(sim.getLambda('gen').processMode).toBe('command');
    });

    test('com marcadores, a linha de log é separada do resultado', async () => {
      const codePath = makeCodeDir({ 'prog.js': prog });
      await sim.registerLambda({
        name: 'gen-m', runtime: 'dotnet8', handler: 'Asm::Cls::Fn', codePath, env: { USE_MARKERS: '1' },
        command: `"${process.execPath}" prog.js {handler}`,
      });
      const res = await sim.invoke('gen-m', { a: 1 });
      expect(res.Payload.event).toEqual({ a: 1 });
      expect(sim.cloudwatchLogs).toContain('linha de log do programa estrangeiro');
    });

    test('runtime estrangeiro sem command fica não invocável', async () => {
      const codePath = makeCodeDir({});
      await sim.registerLambda({ name: 'nocmd', runtime: 'java21', handler: 'a.B', codePath });
      const l = sim.getLambda('nocmd');
      expect(l.invocable).toBe(false);
      await expect(sim.invoke('nocmd', {})).rejects.toThrow(/Function not invocable.*command/);
    });

    test('parseCommand respeita aspas e não usa shell', () => {
      expect(parseCommand('java -jar "my app.jar" {handler}')).toEqual(['java', '-jar', 'my app.jar', '{handler}']);
      expect(() => parseCommand('java "abc')).toThrow(/aspas/);
    });
  });

  describe('validação no registro', () => {
    test('codePath inexistente e handler inexistente => não invocável, sem lançar', async () => {
      await expect(
        sim.registerLambda({ name: 'bad-path', runtime: 'nodejs20.x', handler: 'index.h', codePath: path.join(os.tmpdir(), 'nao-existe-xyz-123') })
      ).resolves.toBeUndefined();
      const codePath = makeCodeDir({ 'other.js': '' });
      await sim.registerLambda({ name: 'bad-file', runtime: 'nodejs20.x', handler: 'index.h', codePath });
      await sim.registerLambda({ name: 'bad-handler', runtime: 'python3.12', handler: 'semponto', codePath });

      for (const n of ['bad-path', 'bad-file', 'bad-handler']) {
        const l = sim.getLambda(n);
        expect(l.external).toBe(true);
        expect(l.invocable).toBe(false);
        expect(l.executionMode).toBe('process');
        await expect(sim.invoke(n, {})).rejects.toThrow(/Function not invocable/);
      }
      expect(require('../../utils/logger').error).toHaveBeenCalled();
    });

    test('lambda inválida não impede o registro das demais (initialize)', async () => {
      const good = makeCodeDir({ 'index.js': `exports.h = () => ({ statusCode: 200 });` });
      const s = new LambdaSimulator({
        dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-proc-init-')),
        lambdas: [
          { name: 'broken', runtime: 'python3.12', handler: 'x.y', codePath: '/nao/existe/xyz' },
          { name: 'ok', runtime: 'nodejs20.x', handler: 'index.h', codePath: good },
        ],
      });
      await s.initialize();
      expect(s.getLambda('broken').invocable).toBe(false);
      expect(s.getLambda('ok').invocable).toBe(true);
    });

    test('createFunction/updateFunction aceitam codePath e command', async () => {
      const codePath = makeCodeDir({ 'index.js': `exports.h = () => ({ statusCode: 200, v: 1 }); exports.g = () => ({ statusCode: 200, v: 2 });` });
      const created = await sim.createFunction({ name: 'dyn', runtime: 'nodejs20.x', handler: 'index.h', codePath });
      expect(created.executionMode).toBe('process');
      expect((await sim.invoke('dyn', {})).Payload.v).toBe(1);
      const updated = await sim.updateFunction('dyn', { handler: 'index.g', timeout: 5 });
      expect(updated.timeout).toBe(5);
      expect((await sim.invoke('dyn', {})).Payload.v).toBe(2);
      const listed = sim.listLambdas().find((l) => l.name === 'dyn');
      expect(listed.codePath).toBe(codePath);
      expect(listed.executionMode).toBe('process');
    });
  });

  describe('precedência e regressão', () => {
    test('runtimeEndpoint vence codePath (modo http)', async () => {
      const codePath = makeCodeDir({ 'index.js': `exports.h = () => ({ statusCode: 200, from: 'process' });` });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ statusCode: 200, from: 'http' }),
      });
      await sim.registerLambda({
        name: 'prec', runtime: 'nodejs20.x', handler: 'index.h', codePath, runtimeEndpoint: 'http://localhost:5999/invoke',
      });
      const l = sim.getLambda('prec');
      expect(l.executionMode).toBe('http');
      const res = await sim.invoke('prec', {});
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(res.Payload.from).toBe('http');
    });

    test('codePath vence defaultEndpoint', async () => {
      const codePath = makeCodeDir({ 'index.js': `exports.h = () => ({ statusCode: 200, from: 'process' });` });
      sim.externalDefaultEndpoint = 'http://localhost:5999/invoke';
      global.fetch = jest.fn();
      await sim.registerLambda({ name: 'prec2', runtime: 'nodejs20.x', handler: 'index.h', codePath });
      const res = await sim.invoke('prec2', {});
      expect(res.Payload.from).toBe('process');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('lambda JS continua sem external/executionMode', async () => {
      const dir = makeCodeDir({ 'handler.js': 'exports.handler = async (e) => ({ statusCode: 200, echoed: e.msg });' });
      await sim.registerLambda({ name: 'js-fn', handler: path.join(dir, 'handler.js'), runtime: 'nodejs18.x', type: 'commonjs' });
      const l = sim.getLambda('js-fn');
      expect(l.external).toBeUndefined();
      expect(l.executionMode).toBeUndefined();
      expect((await sim.invoke('js-fn', { msg: 'hi' })).Payload.echoed).toBe('hi');
    });
  });

  (hasPython ? describe : describe.skip)('bootstrap Python (requer python no PATH)', () => {
    test('handler sync e async, print capturado, contexto e erro', async () => {
      const codePath = makeCodeDir({
        'chat_handler.py': [
          'import os, asyncio',
          'def lambda_handler(event, context):',
          '    print("py-log", event["n"])',
          '    return {"statusCode": 200, "n": event["n"] + 1, "fn": context.function_name,',
          '            "req": bool(context.aws_request_id), "mem": context.memory_limit_in_mb,',
          '            "arn": context.invoked_function_arn, "left": context.get_remaining_time_in_millis(),',
          '            "var": os.environ.get("MY_VAR"), "txt": "ação"}',
          'async def async_handler(event, context):',
          '    await asyncio.sleep(0.01)',
          '    return {"statusCode": 200, "async": True}',
          'def boom(event, context):',
          '    raise ValueError("py-boom")',
        ].join('\n'),
      });
      await sim.registerLambda({
        name: 'py1', runtime: 'python3.12', handler: 'chat_handler.lambda_handler', codePath, command: pythonCmd, env: { MY_VAR: 'v1' },
      });
      await sim.registerLambda({ name: 'py2', runtime: 'python3.12', handler: 'chat_handler.async_handler', codePath, command: pythonCmd });
      await sim.registerLambda({ name: 'py3', runtime: 'python3.12', handler: 'chat_handler.boom', codePath, command: pythonCmd });

      const r1 = await sim.invoke('py1', { n: 1 });
      expect(r1.Payload).toMatchObject({ n: 2, fn: 'py1', req: true, var: 'v1', txt: 'ação' });
      expect(r1.Payload.left).toBeGreaterThan(0);
      expect(sim.cloudwatchLogs).toContain('py-log 1');

      expect((await sim.invoke('py2', {})).Payload.async).toBe(true);

      const err = await sim.invoke('py3', {}).catch((e) => e);
      expect(err.message).toBe('py-boom');
      expect(err.errorType).toBe('ValueError');
    });
  });
});
