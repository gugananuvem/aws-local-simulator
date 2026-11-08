/**
 * Execução de Lambdas externas por PROCESSO (um spawn por invocação).
 *
 * Modos:
 *  - python  : python <bootstrap.py>   (runtime python*)
 *  - node    : node   <bootstrap.js>   (runtime nodejs*)
 *  - command : template livre, ex.: "java -jar app.jar {handler}" (qualquer linguagem)
 *
 * Protocolo (stdin/stdout):
 *  - stdin  : JSON { handler, event, context } (o evento trafega SOMENTE por stdin)
 *  - env    : AWS_LOCAL_SIM_MARKER = prefixo único por invocação
 *  - stdout : o resultado vem entre marcadores únicos:
 *               <MARKER>:RESULT:BEGIN<json><MARKER>:RESULT:END
 *             e erros em:
 *               <MARKER>:ERROR:BEGIN<json {errorType,errorMessage,stackTrace}><MARKER>:ERROR:END
 *             Todo o restante de stdout/stderr vira `logs`.
 *  - modo command sem marcadores: stdout inteiro é tratado como o resultado JSON.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const PYTHON_BOOTSTRAP = path.join(__dirname, "python", "bootstrap.py");
const PYTHON_PERSISTENT_BOOTSTRAP = path.join(__dirname, "python", "bootstrap_persistent.py");
const NODE_BOOTSTRAP = path.join(__dirname, "node", "bootstrap.js");
const STDERR_TAIL_CHARS = 2000;

/** Divide um template de comando em tokens (aspas simples/duplas), sem shell. */
function parseCommand(template) {
  const tokens = [];
  let cur = "";
  let inToken = false;
  let quote = null;
  const s = String(template);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === "\\" && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(cur);
        cur = "";
        inToken = false;
      }
    } else {
      cur += ch;
      inToken = true;
    }
  }
  if (quote) throw new Error(`aspas não fechadas no comando: ${template}`);
  if (inToken) tokens.push(cur);
  return tokens;
}

/** Resolve um executável (caminho ou nome no PATH). Retorna caminho ou null. */
function resolveExecutable(cmd, env) {
  if (!cmd) return null;
  const isWin = process.platform === "win32";
  const hasSep = cmd.includes("/") || cmd.includes("\\");
  const exts = isWin ? ["", ...String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";")] : [""];
  const check = (base) => {
    for (const ext of exts) {
      const p = base + ext;
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch (e) {}
    }
    return null;
  };
  if (path.isAbsolute(cmd) || hasSep) return check(path.resolve(cmd));
  const pathVar = env.PATH || env.Path || "";
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    const found = check(path.join(dir, cmd));
    if (found) return found;
  }
  return null;
}

/** Procura o arquivo do módulo do handler; retorna caminho ou null. */
function findHandlerFile(codePath, mode, modulePart) {
  const rel = mode === "python" ? modulePart.replace(/\./g, "/") : modulePart;
  const base = path.resolve(codePath, rel);
  const candidates =
    mode === "python"
      ? [`${base}.py`, path.join(base, "__init__.py")]
      : [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, path.join(base, "index.js")];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch (e) {}
  }
  return null;
}

function splitHandler(handler) {
  const idx = typeof handler === "string" ? handler.lastIndexOf(".") : -1;
  if (idx <= 0 || idx === handler.length - 1) return null;
  return { modulePart: handler.slice(0, idx), fnName: handler.slice(idx + 1) };
}

/**
 * Valida a config e monta a especificação de spawn.
 * Retorna { ok: true, spec, warnings[] } ou { ok: false, error }.
 */
function buildProcessSpec({ runtime, handler, command, codePath, env }) {
  const rt = String(runtime || "");
  const warnings = [];
  let stat;
  try {
    stat = fs.statSync(codePath);
  } catch (e) {}
  if (!stat || !stat.isDirectory()) {
    return { ok: false, error: `codePath não encontrado ou não é um diretório: ${codePath}` };
  }

  const searchEnv = { ...process.env, ...(env || {}) };
  const isTemplate = typeof command === "string" && command.includes("{handler}");
  let mode;
  if (isTemplate) mode = "command";
  else if (/^python/i.test(rt)) mode = "python";
  else if (/^nodejs/i.test(rt)) mode = "node";
  else mode = "command";

  if (mode === "command") {
    if (!command || typeof command !== "string" || !command.trim()) {
      return {
        ok: false,
        error: `runtime '${rt}' exige 'command' (template, ex.: "java -jar app.jar {handler}") quando usa 'codePath'`,
      };
    }
    let tokens;
    try {
      tokens = parseCommand(command);
    } catch (e) {
      return { ok: false, error: `'command' inválido: ${e.message}` };
    }
    if (tokens.length === 0) return { ok: false, error: "'command' vazio" };
    if (!resolveExecutable(tokens[0], searchEnv)) {
      warnings.push(`executável '${tokens[0]}' não encontrado no PATH (a invocação falhará com ENOENT)`);
    }
    return {
      ok: true,
      warnings,
      spec: { mode, codePath, handler: handler || "", executable: tokens[0], args: tokens.slice(1), template: true, command },
    };
  }

  // python / node: handler = módulo.função (como na AWS)
  const parts = splitHandler(handler);
  if (!parts) {
    return { ok: false, error: `handler inválido '${handler}' (esperado 'modulo.funcao')` };
  }
  const file = findHandlerFile(codePath, mode, parts.modulePart);
  if (!file) {
    return {
      ok: false,
      error: `arquivo do handler '${handler}' não encontrado em ${codePath} (módulo '${parts.modulePart}')`,
    };
  }

  let executable;
  let prefixArgs = [];
  if (command) {
    if (fs.existsSync(command)) {
      executable = command;
    } else {
      try {
        const t = parseCommand(command);
        executable = t[0];
        prefixArgs = t.slice(1);
      } catch (e) {
        return { ok: false, error: `'command' inválido: ${e.message}` };
      }
    }
  } else if (mode === "python") {
    executable = process.platform === "win32" ? "python" : "python3";
  } else {
    executable = process.execPath;
  }
  if (!resolveExecutable(executable, searchEnv)) {
    warnings.push(`interpretador '${executable}' não encontrado (a invocação falhará com ENOENT)`);
  }
  const bootstrap = mode === "python" ? PYTHON_BOOTSTRAP : NODE_BOOTSTRAP;
  const args = mode === "python" ? [...prefixArgs, "-u", bootstrap] : [...prefixArgs, bootstrap];
  return {
    ok: true,
    warnings,
    spec: { mode, codePath, handler, executable, args, prefixArgs, template: false, command: command || null },
  };
}

/** Termina o processo e seus filhos (inclusive no Windows). */
function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    try {
      const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      k.on("error", () => {
        try { child.kill(); } catch (e) {}
      });
    } catch (e) {
      try { child.kill(); } catch (e2) {}
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (e) {
      try { child.kill("SIGKILL"); } catch (e2) {}
    }
  }
}

/** Variante assíncrona de killTree: resolve quando o taskkill/kill terminou. */
function killTreeAsync(child) {
  return new Promise((resolve) => {
    if (!child || !child.pid) return resolve();
    if (process.platform === "win32") {
      try {
        const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        k.on("error", () => {
          try { child.kill(); } catch (e) {}
          resolve();
        });
        k.on("close", () => resolve());
      } catch (e) {
        try { child.kill(); } catch (e2) {}
        resolve();
      }
    } else {
      killTree(child);
      resolve();
    }
  });
}

/** Variante síncrona (usada no evento process 'exit', onde nada assíncrono roda). */
function killTreeSync(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch (e) {
      try { child.kill(); } catch (e2) {}
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (e) {
      try { child.kill("SIGKILL"); } catch (e2) {}
    }
  }
}

/** Spawna o processo uma vez. Resolve { stdout, stderr, code, signal } ou rejeita. */
function runProcess({ executable, args, cwd, env, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      return reject(e);
    }

    const timer = setTimeout(() => {
      killTree(child);
      const seconds = Math.round(timeoutMs / 1000);
      const err = new Error(`Task timed out after ${seconds} seconds`);
      err.stdout = stdout;
      err.stderr = stderr;
      err.timedOut = true;
      finish(reject, err);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      e.stdout = stdout;
      e.stderr = stderr;
      finish(reject, e);
    });
    child.on("close", (code, signal) => finish(resolve, { stdout, stderr, code, signal }));

    child.stdin.on("error", () => {}); // EPIPE se o processo sair antes de ler
    child.stdin.end(input, "utf8");
  });
}

/** Extrai um bloco <marker>:KIND:BEGIN...END; retorna { payload, rest } ou null. */
function extractBlock(text, marker, kind) {
  const begin = `${marker}:${kind}:BEGIN`;
  const end = `${marker}:${kind}:END`;
  const b = text.lastIndexOf(begin);
  if (b === -1) return null;
  const e = text.indexOf(end, b + begin.length);
  if (e === -1) return null;
  return {
    payload: text.slice(b + begin.length, e),
    rest: text.slice(0, b) + text.slice(e + end.length),
  };
}

function toLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
}

/**
 * Cria o handler-proxy (async (event, context) => result) que spawna o processo.
 * `entry` é o registro da lambda (lê env/timeout/memorySize na hora da invocação).
 */
function makeProcessHandler({ spec, entry, serializeContext }) {
  return async function processHandler(event, context) {
    const marker = `__AWSLOCALSIM_${crypto.randomBytes(8).toString("hex")}__`;
    const ctx = serializeContext(context);
    const timeoutMs = (entry.timeout ?? 30) * 1000;

    const env = { ...process.env };
    for (const [k, v] of Object.entries(entry.env || {})) env[k] = String(v);
    env.AWS_LOCAL_SIM_MARKER = marker;
    env.AWS_LOCAL_SIM_CODE_PATH = spec.codePath;
    env.AWS_LAMBDA_FUNCTION_NAME = String(context.functionName);
    env.AWS_LAMBDA_FUNCTION_VERSION = String(context.functionVersion);
    env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = String(entry.memorySize ?? 128);
    env.AWS_LAMBDA_LOG_GROUP_NAME = String(context.logGroupName);
    env.AWS_LAMBDA_LOG_STREAM_NAME = String(context.logStreamName);
    if (spec.mode === "python") {
      env.PYTHONPATH = env.PYTHONPATH ? `${spec.codePath}${path.delimiter}${env.PYTHONPATH}` : spec.codePath;
      env.PYTHONIOENCODING = "utf-8";
      env.PYTHONUTF8 = "1";
    }

    const args = spec.template
      ? spec.args.map((a) => a.split("{handler}").join(spec.handler))
      : spec.args;
    const executable = spec.template ? spec.executable.split("{handler}").join(spec.handler) : spec.executable;

    const input = JSON.stringify({
      handler: spec.handler,
      event: event === undefined ? null : event,
      context: ctx,
    });

    const pushLogs = (lines) => {
      if (Array.isArray(context.__externalLogs)) {
        for (const l of lines) context.__externalLogs.push(String(l));
      }
    };

    let res;
    try {
      res = await runProcess({ executable, args, cwd: spec.codePath, env, input, timeoutMs });
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new Error(
          `Comando não encontrado: '${executable}' (ENOENT). Verifique 'command', o PATH e se 'codePath' existe (${spec.codePath})`
        );
      }
      if (err && err.timedOut) {
        const b = extractBlock(String(err.stdout || ""), marker, "RESULT");
        pushLogs(toLines(b ? b.rest : err.stdout));
        pushLogs(toLines(err.stderr));
      }
      throw err;
    }

    let out = res.stdout;
    let resultBlock = extractBlock(out, marker, "RESULT");
    let errorBlock = null;
    if (resultBlock) {
      out = resultBlock.rest;
    } else {
      errorBlock = extractBlock(out, marker, "ERROR");
      if (errorBlock) out = errorBlock.rest;
    }

    // Erro reportado pelo bootstrap tem precedência sobre o código de saída
    if (errorBlock) {
      pushLogs(toLines(out));
      pushLogs(toLines(res.stderr));
      let info;
      try {
        info = JSON.parse(errorBlock.payload);
      } catch (e) {
        info = { errorType: "Error", errorMessage: errorBlock.payload.trim() };
      }
      const err = new Error(info.errorMessage || info.errorType || "Erro no handler externo");
      err.errorType = info.errorType;
      err.stackTrace = info.stackTrace;
      throw err;
    }

    if (resultBlock) {
      pushLogs(toLines(out));
      pushLogs(toLines(res.stderr));
      try {
        return JSON.parse(resultBlock.payload);
      } catch (e) {
        throw new Error(`Resultado do processo externo não é JSON válido: ${e.message}`);
      }
    }

    // Sem marcadores
    const stderrTail = res.stderr.slice(-STDERR_TAIL_CHARS).trim();
    if (res.code !== 0) {
      pushLogs(toLines(res.stdout));
      pushLogs(toLines(res.stderr));
      const how = res.signal ? `sinal ${res.signal}` : `código ${res.code}`;
      throw new Error(
        `Processo externo '${executable}' terminou com ${how} sem retornar resultado.` +
          (stderrTail ? ` stderr: ${stderrTail}` : "")
      );
    }

    if (spec.mode === "command") {
      // Contrato do modo command: stdout inteiro é o resultado JSON
      pushLogs(toLines(res.stderr));
      const text = res.stdout.trim();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (e) {
        return text;
      }
    }

    pushLogs(toLines(res.stdout));
    pushLogs(toLines(res.stderr));
    throw new Error(
      `Processo externo '${executable}' terminou sem retornar resultado (bootstrap não emitiu o bloco de resultado).` +
        (stderrTail ? ` stderr: ${stderrTail}` : "")
    );
  };
}

module.exports = {
  parseCommand,
  resolveExecutable,
  buildProcessSpec,
  makeProcessHandler,
  runProcess,
  killTree,
  killTreeAsync,
  killTreeSync,
  extractBlock,
  STDERR_TAIL_CHARS,
  PYTHON_BOOTSTRAP,
  PYTHON_PERSISTENT_BOOTSTRAP,
  NODE_BOOTSTRAP,
};
