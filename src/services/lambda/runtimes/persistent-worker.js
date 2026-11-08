/**
 * Worker PERSISTENTE para Lambdas por processo (modo python).
 *
 * Mantém UM processo vivo por Lambda (bootstrap_persistent.py), com init uma
 * vez só, e envia as invocações por stdin (uma linha JSON por invocação).
 * Uma invocação por vez (fila FIFO), como uma Lambda com concorrência 1.
 *
 * Protocolo (stdout do worker):
 *   <M>:READY:BEGIN{}<M>:READY:END
 *   <M>:RESULT:<id>:BEGIN<json><M>:RESULT:<id>:END
 *   <M>:ERROR:<id>:BEGIN<json {errorType,errorMessage,stackTrace}><M>:ERROR:<id>:END
 *   <M>:ERROR:init:BEGIN...  (falha de import do handler; o processo sai com código 1)
 * O restante de stdout/stderr vira log da invocação em andamento.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const logger = require("../../../utils/logger");
const {
  killTreeAsync,
  killTreeSync,
  STDERR_TAIL_CHARS,
  PYTHON_PERSISTENT_BOOTSTRAP,
} = require("./process-runner");

const START_TIMEOUT_MS = 60000;
const STOP_GRACE_MS = 2000;
const WATCH_DEBOUNCE_MS = 300;

// Workers com processo vivo: usados pela proteção extra no process.on("exit").
const liveWorkers = new Set();
let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const w of liveWorkers) killTreeSync(w.child);
  });
}

function toLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
}

/** Normaliza/valida `persistent`/`debug`. Retorna { persistent, debug, warnings[], error }. */
function normalizePersistentOptions(lambdaConfig) {
  const warnings = [];
  let persistent = lambdaConfig.persistent === true;
  const rawDebug = lambdaConfig.debug;
  let debug = null;
  if (rawDebug !== undefined && rawDebug !== null && rawDebug !== false) {
    if (!persistent) {
      persistent = true;
      warnings.push("'debug' definido sem 'persistent'; tratando como 'persistent: true' (debug exige processo persistente)");
    }
    const d = typeof rawDebug === "object" ? rawDebug : {};
    const port = Number(d.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { persistent, debug: null, warnings, error: "'debug.port' é obrigatório e deve ser uma porta válida (1-65535)" };
    }
    debug = {
      port,
      host: typeof d.host === "string" && d.host ? d.host : "127.0.0.1",
      waitForClient: d.waitForClient === true,
      ignoreTimeout: d.ignoreTimeout !== false,
    };
  }
  return { persistent, debug, warnings, error: null };
}

class PersistentWorker {
  /**
   * @param {object} o
   * @param {string} o.name        nome da lambda
   * @param {object} o.spec        processSpec (mode, executable, prefixArgs, codePath, handler)
   * @param {object} o.entry       registro da lambda (lê env/timeout/memorySize na hora)
   * @param {object|null} o.debug  { port, host, waitForClient, ignoreTimeout }
   * @param {boolean} o.watch      reinicia ao editar arquivos .py
   */
  constructor({ name, spec, entry, debug = null, watch = false }) {
    this.name = name;
    this.spec = spec;
    this.entry = entry;
    this.debug = debug;
    this.watch = !!watch;
    this.status = "stopped"; // starting | ready | busy | stopped | crashed
    this.child = null;
    this.generation = 0;
    this.queue = [];
    this.current = null;
    this.pumping = false;
    this.startPromise = null;
    this.killing = null;
    this.stopping = false;
    this.disposed = false;
    this.watcher = null;
    this.watchTimer = null;
    this.buf = "";
    this.stderrTail = "";
    this.marker = null;
    this.initError = null;
    this._startWaiter = null;
  }

  get pid() {
    return this.child && this.status !== "stopped" && this.status !== "crashed" ? this.child.pid : null;
  }

  get debugPort() {
    return this.debug ? this.debug.port : null;
  }

  // ------------------------------------------------------------------ start

  start() {
    if (this.startPromise) return this.startPromise;
    if (this.status === "ready" || this.status === "busy") return Promise.resolve();
    this.disposed = false;
    this.startPromise = (async () => {
      if (this.killing) await this.killing;
      await this._start();
    })();
    const clear = () => {
      this.startPromise = null;
    };
    this.startPromise.then(clear, clear);
    this._setupWatch();
    return this.startPromise;
  }

  _buildEnv(marker) {
    const spec = this.spec;
    const env = { ...process.env };
    for (const [k, v] of Object.entries(this.entry.env || {})) env[k] = String(v);
    env.AWS_LOCAL_SIM_MARKER = marker;
    env.AWS_LOCAL_SIM_CODE_PATH = spec.codePath;
    env.AWS_LOCAL_SIM_HANDLER = spec.handler;
    env.AWS_LAMBDA_FUNCTION_NAME = String(this.name);
    env.AWS_LAMBDA_FUNCTION_VERSION = "$LATEST";
    env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = String(this.entry.memorySize ?? 128);
    env.AWS_LAMBDA_LOG_GROUP_NAME = `/aws/lambda/${this.name}`;
    env.AWS_LAMBDA_LOG_STREAM_NAME = `${new Date().toISOString().slice(0, 10).replace(/-/g, "/")}/[$LATEST]persistent`;
    env.PYTHONPATH = env.PYTHONPATH ? `${spec.codePath}${path.delimiter}${env.PYTHONPATH}` : spec.codePath;
    env.PYTHONIOENCODING = "utf-8";
    env.PYTHONUTF8 = "1";
    if (this.debug) {
      env.AWS_LOCAL_SIM_DEBUG_PORT = String(this.debug.port);
      env.AWS_LOCAL_SIM_DEBUG_HOST = this.debug.host;
      env.AWS_LOCAL_SIM_DEBUG_WAIT = this.debug.waitForClient ? "1" : "0";
      env.PYDEVD_DISABLE_FILE_VALIDATION = "1";
    }
    return env;
  }

  _start() {
    return new Promise((resolve, reject) => {
      const marker = `__AWSLOCALSIM_${crypto.randomBytes(8).toString("hex")}__`;
      const args = [...(this.spec.prefixArgs || []), "-u", PYTHON_PERSISTENT_BOOTSTRAP];
      let child;
      try {
        child = spawn(this.spec.executable, args, {
          cwd: this.spec.codePath,
          env: this._buildEnv(marker),
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e) {
        this.status = "crashed";
        return reject(e);
      }

      const gen = ++this.generation;
      this.child = child;
      this.marker = marker;
      this.buf = "";
      this.stderrTail = "";
      this.initError = null;
      this.stopping = false;
      this.status = "starting";
      liveWorkers.add(this);
      installExitHook();

      let startTimer = null;
      if (!(this.debug && this.debug.waitForClient)) {
        startTimer = setTimeout(() => {
          if (gen !== this.generation || this.status !== "starting") return;
          this.stopping = true;
          this._failStart(new Error(`Worker da Lambda '${this.name}' não ficou pronto em ${START_TIMEOUT_MS / 1000}s`));
          this.killing = killTreeAsync(child);
        }, START_TIMEOUT_MS);
      }
      this._startWaiter = {
        resolve: () => {
          clearTimeout(startTimer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(startTimer);
          reject(e);
        },
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdin.on("error", () => {}); // EPIPE: o evento de saída trata o resto
      child.stdout.on("data", (d) => {
        if (gen !== this.generation) return;
        this.buf += d;
        this._drain();
      });
      child.stderr.on("data", (d) => {
        if (gen !== this.generation) return;
        this.stderrTail = (this.stderrTail + d).slice(-STDERR_TAIL_CHARS);
        this._log(toLines(d));
      });
      child.on("error", (e) => {
        if (gen !== this.generation) return;
        const msg =
          e && e.code === "ENOENT"
            ? `Comando não encontrado: '${this.spec.executable}' (ENOENT). Verifique 'command' e o PATH`
            : `Falha ao iniciar o worker: ${e && e.message}`;
        this._handleExit(gen, new Error(msg));
      });
      let exited = false;
      const onExit = (code, signal) => {
        if (exited) return;
        exited = true;
        this._handleExit(gen, null, code, signal);
      };
      child.on("close", onExit);
      // 'close' pode demorar se um neto (adaptador do debugpy) segurar os pipes
      child.on("exit", (code, signal) => setTimeout(() => onExit(code, signal), 200));
    });
  }

  _failStart(err) {
    const w = this._startWaiter;
    this._startWaiter = null;
    if (w) w.reject(err);
  }

  // ------------------------------------------------------------ parsing I/O

  _log(lines) {
    if (!lines.length) return;
    const cur = this.current;
    if (cur && Array.isArray(cur.logs)) {
      for (const l of lines) cur.logs.push(String(l));
    } else {
      for (const l of lines) logger.debug(`[${this.name}] ${l}`);
    }
  }

  _drain() {
    const re = new RegExp(`${this.marker}:(READY|RESULT|ERROR)(?::([^:]*))?:BEGIN`);
    for (;;) {
      const m = re.exec(this.buf);
      if (!m) {
        // sem marcador: libera as linhas completas, mantém a linha parcial
        const nl = this.buf.lastIndexOf("\n");
        if (nl !== -1) {
          this._log(toLines(this.buf.slice(0, nl)));
          this.buf = this.buf.slice(nl + 1);
        }
        return;
      }
      const kind = m[1];
      const id = m[2];
      const tag = id !== undefined ? `${kind}:${id}` : kind;
      const endToken = `${this.marker}:${tag}:END`;
      const bodyStart = m.index + m[0].length;
      const endIdx = this.buf.indexOf(endToken, bodyStart);
      if (endIdx === -1) {
        // bloco incompleto: libera só o que veio antes dele
        this._log(toLines(this.buf.slice(0, m.index)));
        this.buf = this.buf.slice(m.index);
        return;
      }
      this._log(toLines(this.buf.slice(0, m.index)));
      const payload = this.buf.slice(bodyStart, endIdx);
      this.buf = this.buf.slice(endIdx + endToken.length);
      this._onBlock(kind, id, payload);
    }
  }

  _onBlock(kind, id, payload) {
    if (kind === "READY") {
      if (this.status === "starting") {
        this.status = "ready";
        const w = this._startWaiter;
        this._startWaiter = null;
        if (w) w.resolve();
      }
      return;
    }
    let info = null;
    if (kind === "ERROR") {
      try {
        info = JSON.parse(payload);
      } catch (e) {
        info = { errorType: "Error", errorMessage: payload.trim() };
      }
      if (id === "init") {
        this.initError = info;
        return;
      }
    }
    const cur = this.current;
    if (!cur || cur.id !== id) return; // resposta de invocação já encerrada (ex.: timeout)
    if (kind === "RESULT") {
      try {
        this._settle(cur, null, JSON.parse(payload));
      } catch (e) {
        this._settle(cur, new Error(`Resultado do processo externo não é JSON válido: ${e.message}`));
      }
    } else {
      const err = new Error(info.errorMessage || info.errorType || "Erro no handler externo");
      err.errorType = info.errorType;
      err.stackTrace = info.stackTrace;
      this._settle(cur, err);
    }
  }

  // ------------------------------------------------------------------ exit

  _handleExit(gen, spawnError, code, signal) {
    if (gen !== this.generation || this.handledGen === gen) return;
    this.handledGen = gen;
    const child = this.child;
    const intentional = this.stopping;
    liveWorkers.delete(this);
    this._log(toLines(this.buf));
    this.buf = "";
    this.status = intentional ? "stopped" : "crashed";
    this.exitInfo = { code, signal };
    // garante que netos (adaptador do debugpy) não fiquem órfãos
    if (!this.killing) this.killing = killTreeAsync(child).then(() => (this.killing = null));

    const tail = this.stderrTail.trim();
    const how = signal ? `sinal ${signal}` : `código ${code}`;

    if (this._startWaiter) {
      let msg;
      if (spawnError) msg = spawnError.message;
      else if (this.initError) {
        msg = `Falha no init da Lambda '${this.name}': ${this.initError.errorType}: ${this.initError.errorMessage}`;
      } else msg = `Worker da Lambda '${this.name}' terminou durante o init com ${how}`;
      if (tail) msg += ` | stderr: ${tail}`;
      const err = new Error(msg);
      if (this.initError) err.stackTrace = this.initError.stackTrace;
      this._failStart(err);
    }

    const cur = this.current;
    if (cur && !cur.settled) {
      const msg = spawnError
        ? spawnError.message
        : intentional
        ? `Worker da Lambda '${this.name}' foi parado durante a invocação`
        : `Worker da Lambda '${this.name}' terminou inesperadamente com ${how}` + (tail ? ` | stderr: ${tail}` : "");
      this._settle(cur, new Error(msg));
      if (!intentional) this._rejectQueue(new Error(msg));
    }
  }

  _rejectQueue(err) {
    const q = this.queue.splice(0);
    for (const j of q) j.reject(err);
  }

  // ---------------------------------------------------------------- invoke

  /**
   * @param {*} event
   * @param {object} context contexto SERIALIZADO (sem funções)
   * @param {string[]} [logs] destino do stdout/stderr da invocação (context.__externalLogs)
   */
  invoke(event, context, logs) {
    return new Promise((resolve, reject) => {
      this.queue.push({ event, context, logs, resolve, reject });
      this._pump();
    });
  }

  async _pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        try {
          job.resolve(await this._run(job));
        } catch (e) {
          job.reject(e);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  async _run(job) {
    if (this.status === "starting" && this.startPromise) await this.startPromise;
    else if (this.status !== "ready") await this.start();
    if (this.status !== "ready") throw new Error(`Worker da Lambda '${this.name}' indisponível (${this.status})`);

    return new Promise((resolve, reject) => {
      const id = crypto.randomBytes(8).toString("hex");
      const cur = { id, logs: job.logs, settled: false, resolve, reject, timer: null };
      this.current = cur;
      this.status = "busy";
      const timeoutMs = (this.entry.timeout ?? 30) * 1000;
      if (!(this.debug && this.debug.ignoreTimeout)) {
        cur.timer = setTimeout(() => this._onTimeout(cur, timeoutMs), timeoutMs);
      }
      const line = JSON.stringify({ id, event: job.event === undefined ? null : job.event, context: job.context }) + "\n";
      this.child.stdin.write(line, "utf8");
    });
  }

  _settle(cur, err, value) {
    if (cur.settled) return;
    cur.settled = true;
    clearTimeout(cur.timer);
    if (this.current === cur) {
      this.current = null;
      if (this.status === "busy") this.status = "ready";
    }
    if (err) cur.reject(err);
    else cur.resolve(value);
  }

  _onTimeout(cur, timeoutMs) {
    if (cur.settled) return;
    const seconds = Math.round(timeoutMs / 1000);
    this.stopping = true; // a saída por timeout não é "crash"
    const child = this.child;
    this._log(toLines(this.buf));
    this.buf = "";
    this._settle(cur, new Error(`Task timed out after ${seconds} seconds`));
    this.status = "stopped"; // recriado na próxima invocação
    this.killing = killTreeAsync(child).then(() => (this.killing = null));
  }

  // ------------------------------------------------------------------ stop

  /** Para o worker (stdin fecha, espera até ~2s, depois mata a árvore inteira). */
  async stop() {
    const child = this.child;
    if (this.startPromise) {
      // aguarda/forsa o fim de um start em andamento
      this.stopping = true;
    }
    if (!child || this.status === "stopped" || this.status === "crashed") {
      this.status = "stopped";
      if (child) await killTreeAsync(child); // limpa eventuais netos
      if (this.killing) await this.killing;
      liveWorkers.delete(this);
      this._rejectQueue(new Error(`Worker da Lambda '${this.name}' foi parado`));
      return;
    }
    this.stopping = true;
    this._rejectQueue(new Error(`Worker da Lambda '${this.name}' foi parado`));
    const exited = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      const t = setTimeout(resolve, STOP_GRACE_MS);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      try {
        child.stdin.end();
      } catch (e) {}
    });
    await exited;
    await killTreeAsync(child); // inclui o adaptador do debugpy
    this._handleExit(this.generation, null, child.exitCode, child.signalCode);
    this.status = "stopped";
    liveWorkers.delete(this);
    if (this.killing) await this.killing;
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  /** Para o worker e o watcher definitivamente (lambda removida / shutdown). */
  async dispose() {
    this.disposed = true;
    this._closeWatch();
    await this.stop();
  }

  // ----------------------------------------------------------------- watch

  _closeWatch() {
    clearTimeout(this.watchTimer);
    this.watchTimer = null;
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (e) {}
      this.watcher = null;
    }
  }

  _setupWatch() {
    if (!this.watch || this.watcher) return;
    try {
      this.watcher = fs.watch(this.spec.codePath, { recursive: true }, (evt, filename) => {
        const f = String(filename || "");
        if (!f.endsWith(".py") || f.split(/[\\/]/).includes("__pycache__")) return;
        clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => {
          logger.info(`🔄 Lambda '${this.name}': código alterado (${f}), reiniciando worker`);
          this.restart().catch((e) => logger.error(`❌ Lambda '${this.name}': falha ao reiniciar worker: ${e.message}`));
        }, WATCH_DEBOUNCE_MS);
      });
      this.watcher.on("error", () => this._closeWatch());
    } catch (e) {
      logger.warn(`⚠️ Lambda '${this.name}': 'watch' indisponível (${e.message})`);
    }
  }
}

module.exports = { PersistentWorker, normalizePersistentOptions };
