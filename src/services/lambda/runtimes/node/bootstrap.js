/**
 * Bootstrap Node do AWS Local Simulator (um processo por invocação).
 *
 * Lê JSON { handler, event, context } do stdin, carrega o módulo do handler a
 * partir de AWS_LOCAL_SIM_CODE_PATH (ou cwd), chama a função (sync/async/callback)
 * e escreve o resultado/erro no stdout entre marcadores únicos.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const marker = process.env.AWS_LOCAL_SIM_MARKER || "__AWSLOCALSIM__";
let finished = false;

function emit(kind, payload, exitCode) {
  if (finished) return;
  finished = true;
  const text = `\n${marker}:${kind}:BEGIN${payload}${marker}:${kind}:END\n`;
  process.stdout.write(text, () => process.exit(exitCode));
}

function emitError(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  emit(
    "ERROR",
    JSON.stringify({
      errorType: e.name || "Error",
      errorMessage: e.message,
      stackTrace: String(e.stack || "").split("\n"),
    }),
    1
  );
}

process.on("uncaughtException", emitError);
process.on("unhandledRejection", emitError);

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function findModuleFile(codePath, modulePart) {
  const base = path.resolve(codePath, modulePart);
  const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, path.join(base, "index.js")];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch (e) {}
  }
  throw new Error(`Módulo do handler '${modulePart}' não encontrado em ${codePath}`);
}

async function loadModule(file) {
  if (file.endsWith(".mjs")) return import(pathToFileURL(file).href);
  try {
    return require(file);
  } catch (err) {
    if (err && err.code === "ERR_REQUIRE_ESM") return import(pathToFileURL(file).href);
    throw err;
  }
}

function buildContext(data) {
  const deadlineMs = data.deadlineMs;
  return {
    awsRequestId: data.awsRequestId,
    functionName: data.functionName,
    functionVersion: data.functionVersion,
    invokedFunctionArn: data.invokedFunctionArn,
    memoryLimitInMB: data.memoryLimitInMB,
    logGroupName: data.logGroupName,
    logStreamName: data.logStreamName,
    callbackWaitsForEmptyEventLoop: true,
    identity: null,
    clientContext: null,
    getRemainingTimeInMillis: () =>
      typeof deadlineMs === "number" ? Math.max(0, Math.floor(deadlineMs - Date.now())) : 0,
  };
}

async function main() {
  const payload = JSON.parse(await readStdin());
  const handler = payload.handler;
  const idx = handler.lastIndexOf(".");
  const modulePart = handler.slice(0, idx);
  const fnName = handler.slice(idx + 1);
  const codePath = process.env.AWS_LOCAL_SIM_CODE_PATH || process.cwd();

  const mod = await loadModule(findModuleFile(codePath, modulePart));
  const fn = mod && mod[fnName];
  if (typeof fn !== "function") {
    throw new TypeError(`Handler '${fnName}' não é uma função exportada por '${modulePart}'`);
  }

  const context = buildContext(payload.context || {});
  const event = payload.event === undefined ? null : payload.event;

  let result;
  if (fn.length >= 3) {
    // Estilo callback: (event, context, callback)
    result = await new Promise((resolve, reject) => {
      const maybe = fn(event, context, (err, res) => (err ? reject(err) : resolve(res)));
      if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
    });
  } else {
    result = await fn(event, context);
  }

  const json = JSON.stringify(result === undefined ? null : result);
  emit("RESULT", json === undefined ? "null" : json, 0);
}

main().catch(emitError);
