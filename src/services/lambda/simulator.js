const LocalStore = require("../../utils/local-store");
const path = require("path");
const fs = require("fs");
const HandlerLoader = require("./handler-loader");
const logger = require("../../utils/logger");
const { CloudTrailAudit } = require("../../utils/cloudtrail-audit");
const { buildProcessSpec, makeProcessHandler } = require("./runtimes/process-runner");
const { PersistentWorker, normalizePersistentOptions } = require("./runtimes/persistent-worker");

/**
 * AWS_LOCAL_SIMULATOR_LAMBDA_DEBUG="nome:porta[,nome2:porta2]" liga o debug
 * (e o modo persistente) de lambdas por processo sem editar o config.
 */
function debugPortFromEnv(name) {
  const raw = process.env.AWS_LOCAL_SIMULATOR_LAMBDA_DEBUG;
  if (!raw) return null;
  for (const item of String(raw).split(",")) {
    const i = item.lastIndexOf(":");
    if (i > 0 && item.slice(0, i).trim() === name) return Number(item.slice(i + 1).trim());
  }
  return null;
}

class LambdaSimulator {
  constructor(config) {
    this.config = config;
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data', "lambda");
    this.store = new LocalStore(this.dataDir);
    this.lambdas = new Map(); // functionName -> { handler, env, config }
    this.environment = { ...process.env };
    this.audit = new CloudTrailAudit("lambda.amazonaws.com");
    this.cloudwatchSimulator = null; // injected via injectDependencies
    this.eventSourceMappings = new Map();
    this.layers = new Map(); // layerName -> { versions: [] }
    this.codeSigningConfigs = new Map();
    this.capacityProviders = new Map();
    this.functionUrls = new Map();
  }

  async initialize() {
    logger.debug("Inicializando Lambda Simulator...");

    // Build global lambda defaults from config.global
    const globalDefaults = this.config.global || {};
    this.globalEnv = globalDefaults.env || {};
    this.globalTimeout = globalDefaults.timeout || null;
    this.globalMemorySize = globalDefaults.memorySize || null;

    // Endpoint default para runtimes externos (poliglota)
    // Configurável via config global: lambda.externalRuntime.defaultEndpoint
    this.externalDefaultEndpoint =
      (this.config.lambda && this.config.lambda.externalRuntime && this.config.lambda.externalRuntime.defaultEndpoint) || null;

    // Carrega do config.lambdas (fixo)
    if (this.config.lambdas && this.config.lambdas.length > 0) {
      for (const lambdaConfig of this.config.lambdas) {
        await this.registerLambda(lambdaConfig);
      }
    }

    // Carrega lambdas dinâmicas do disco
    const savedLambdas = this.store.read("__functions__");
    if (savedLambdas && Array.isArray(savedLambdas)) {
      for (const lambdaConfig of savedLambdas) {
        if (!this.lambdas.has(lambdaConfig.name)) {
          await this.registerLambda(lambdaConfig);
        }
      }
    }

    try {
      const esm = this.store.read("__event_source_mappings__");
      if (Array.isArray(esm)) {
        for (const m of esm) this.eventSourceMappings.set(m.UUID || m.uuid, m);
      }
    } catch (e) {}
    try {
      const layers = this.store.read("__layers__");
      if (layers && typeof layers === 'object') {
        for (const [k, v] of Object.entries(layers)) this.layers.set(k, v);
      }
    } catch (e) {}
    try {
      const csc = this.store.read("__code_signing_configs__");
      if (Array.isArray(csc)) {
        for (const c of csc) this.codeSigningConfigs.set(c.CodeSigningConfigArn || c.arn, c);
      }
    } catch (e) {}
    try {
      const cp = this.store.read("__capacity_providers__");
      if (Array.isArray(cp)) {
        for (const c of cp) this.capacityProviders.set(c.CapacityProviderName || c.name, c);
      }
    } catch (e) {}
    try {
      const fu = this.store.read("__function_urls__");
      if (fu && typeof fu === 'object') {
        for (const [k, v] of Object.entries(fu)) this.functionUrls.set(k, v);
      }
    } catch (e) {}

    logger.debug(`✅ ${this.lambdas.size} Lambdas registradas`);
  }


  /**
   * Detecta se um runtime (string) é externo/poliglota.
   * Ex.: python3.12, java21, dotnet8, ruby3.3, go1.x
   */
  static isExternalRuntime(runtime) {
    return typeof runtime === "string" && /^(python|java|dotnet|ruby|go)/i.test(runtime);
  }

  /**
   * Resolve o endpoint do runtime externo seguindo a precedência:
   * runtimeEndpoint explícito > defaultEndpoint global > null.
   */
  resolveExternalEndpoint(lambdaConfig) {
    if (lambdaConfig.runtimeEndpoint) return lambdaConfig.runtimeEndpoint;
    if (this.externalDefaultEndpoint) return this.externalDefaultEndpoint;
    return null;
  }

  /**
   * Serializa o context de execução para envio HTTP (somente campos de dados).
   * Funções (ex.: getRemainingTimeInMillis) NÃO são enviadas; em vez disso
   * calculamos deadlineMs a partir do tempo restante.
   */
  serializeContext(context) {
    let deadlineMs;
    try {
      const remaining = typeof context.getRemainingTimeInMillis === "function"
        ? context.getRemainingTimeInMillis()
        : 0;
      deadlineMs = Date.now() + remaining;
    } catch (e) {
      deadlineMs = Date.now();
    }
    return {
      awsRequestId: context.awsRequestId,
      functionName: context.functionName,
      functionVersion: context.functionVersion,
      invokedFunctionArn: context.invokedFunctionArn,
      memoryLimitInMB: context.memoryLimitInMB,
      logGroupName: context.logGroupName,
      logStreamName: context.logStreamName,
      deadlineMs,
    };
  }

  /**
   * Cria um handler-proxy que encaminha a invocação por HTTP para o
   * runtime server externo. Mantém o mesmo contrato de uma Lambda JS:
   * uma função async (event, context) => result, de modo que
   * executeHandler funcione sem alteração.
   */
  makeExternalHandler({ runtimeEndpoint, timeoutMs }) {
    const self = this;
    return async function externalHandler(event, context) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(runtimeEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event, context: self.serializeContext(context) }),
          signal: controller.signal,
        });

        const text = await res.text();
        let payload;
        try {
          payload = text ? JSON.parse(text) : {};
        } catch (e) {
          payload = text;
        }

        if (!res.ok) {
          const msg =
            (payload && payload.errorMessage) ||
            `Runtime externo retornou HTTP ${res.status}`;
          const err = new Error(msg);
          err.runtimeStatus = res.status;
          err.runtimePayload = payload;
          throw err;
        }

        // Convenção de envelope (modo externo apenas):
        // Se o corpo for { result, logs } com logs = string[], tratamos como
        // envelope: `result` é o resultado real e `logs` são linhas de log do
        // handler externo, repassadas ao CloudWatch simulado.
        if (
          payload &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          Array.isArray(payload.logs) &&
          Object.prototype.hasOwnProperty.call(payload, "result")
        ) {
          if (Array.isArray(context.__externalLogs)) {
            for (const line of payload.logs) {
              context.__externalLogs.push(String(line));
            }
          }
          return payload.result;
        }

        return payload; // corpo HTTP é o próprio resultado da Lambda
      } catch (err) {
        if (err && err.name === "AbortError") {
          const seconds = Math.round(timeoutMs / 1000);
          throw new Error(`Task timed out after ${seconds} seconds`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    };
  }

  /**
   * Resolve codePath relativo ao cwd, com fallback para o dataDir
   * (mesmo estilo usado para handlerPath).
   */
  resolveCodePath(codePath) {
    let resolved = path.resolve(process.cwd(), codePath);
    if (!fs.existsSync(resolved)) {
      const dataPath = path.resolve(this.dataDir, String(codePath).replace(/^\.\//, ""));
      if (fs.existsSync(dataPath)) resolved = dataPath;
    }
    return resolved;
  }

  /**
   * Registra uma lambda externa executada por processo. Config inválida NÃO
   * derruba o boot: a lambda fica registrada como não invocável.
   */
  registerProcessLambda(lambdaConfig, base) {
    const { name, runtime, type, env, timeout, memorySize } = base;
    const codePath = this.resolveCodePath(lambdaConfig.codePath);
    const built = buildProcessSpec({
      runtime,
      handler: lambdaConfig.handler,
      command: lambdaConfig.command,
      codePath,
      env,
    });

    const entry = {
      name,
      runtime,
      handler: null,
      handlerPath: null,
      handlerName: lambdaConfig.handler || "external",
      env,
      timeout,
      memorySize,
      codeSize: 0,
      type,
      external: true,
      executionMode: "process",
      runtimeEndpoint: null,
      codePath,
      command: lambdaConfig.command || null,
      invocable: false,
      registeredAt: new Date().toISOString(),
    };

    if (!built.ok) {
      logger.error(
        `❌ Lambda por processo '${name}' (runtime: ${runtime}) mal configurada: ${built.error}. Registrada como NÃO invocável.`
      );
      entry.invalidReason = built.error;
      this.lambdas.set(name, entry);
      return;
    }

    for (const w of built.warnings) logger.warn(`⚠️ Lambda por processo '${name}': ${w}`);
    entry.processMode = built.spec.mode;
    entry.processSpec = built.spec;

    // ---- Modo persistente / debug (opcional; padrão = um processo por invocação) ----
    const optsConfig = { ...lambdaConfig };
    const envPort = debugPortFromEnv(name);
    if (envPort !== null && !optsConfig.debug) {
      optsConfig.debug = { port: envPort };
      logger.info(`🐞 Lambda '${name}': debug ativado por AWS_LOCAL_SIMULATOR_LAMBDA_DEBUG (porta ${envPort})`);
    }
    const opts = normalizePersistentOptions(optsConfig);
    for (const w of opts.warnings) logger.warn(`⚠️ Lambda por processo '${name}': ${w}`);
    entry.persistent = opts.persistent;
    entry.debug = opts.debug;
    entry.watch = lambdaConfig.watch === true;

    if (opts.persistent) {
      let invalid = opts.error;
      if (!invalid && built.spec.mode !== "python") {
        invalid = `modo persistente só é suportado para runtime python (modo '${built.spec.mode}' não suportado)`;
      }
      if (invalid) {
        logger.error(`❌ Lambda por processo '${name}' (runtime: ${runtime}) mal configurada: ${invalid}. Registrada como NÃO invocável.`);
        entry.invalidReason = invalid;
        this.lambdas.set(name, entry);
        return entry;
      }
      const worker = new PersistentWorker({ name, spec: built.spec, entry, debug: opts.debug, watch: entry.watch });
      entry.worker = worker;
      entry.invocable = true;
      entry.handler = async (event, context) =>
        worker.invoke(event, this.serializeContext(context), context.__externalLogs);
      this.lambdas.set(name, entry);
      if (opts.debug) {
        logger.info(`🐞 Lambda '${name}': debugpy em ${opts.debug.host}:${opts.debug.port} (anexe o debugger)`);
        if (opts.debug.ignoreTimeout) logger.info(`   ↳ timeout ignorado enquanto o debug estiver ativo (debug.ignoreTimeout)`);
      }
      logger.debug(`✅ Lambda persistente registrada: ${name} -> ${codePath} (${built.spec.mode}, runtime: ${runtime})`);
      return entry;
    }

    entry.invocable = true;
    entry.handler = makeProcessHandler({
      spec: built.spec,
      entry,
      serializeContext: (ctx) => this.serializeContext(ctx),
    });
    this.lambdas.set(name, entry);
    logger.debug(`✅ Lambda por processo registrada: ${name} -> ${codePath} (${built.spec.mode}, runtime: ${runtime})`);
    return entry;
  }

  /** Sobe o worker já no registro (cold start pago no boot). Nunca derruba o boot. */
  async startWorkerEagerly(entry) {
    if (!entry || !entry.worker) return;
    const p = entry.worker.start();
    if (entry.debug && entry.debug.waitForClient) {
      // aguardando o debugger anexar: não bloqueia o boot
      p.catch((e) => logger.error(`❌ Lambda '${entry.name}': falha ao iniciar worker: ${e.message}`));
      return;
    }
    try {
      await p;
    } catch (e) {
      logger.error(`❌ Lambda '${entry.name}': falha ao iniciar worker (será recriado na próxima invocação): ${e.message}`);
    }
  }

  /** Para o worker persistente de uma lambda (se houver). */
  async stopWorkerOf(name) {
    const existing = this.lambdas.get(name);
    if (existing && existing.worker) {
      try {
        await existing.worker.dispose();
      } catch (e) {
        logger.error(`❌ Erro ao parar worker da Lambda '${name}': ${e.message}`);
      }
      existing.worker = null;
    }
  }

  /** Encerra todos os workers persistentes (e seus processos filhos). */
  async shutdownWorkers() {
    await Promise.all(Array.from(this.lambdas.keys()).map((n) => this.stopWorkerOf(n)));
  }

  async registerLambda(lambdaConfig) {
    try {
      const { name, handler: handlerPath, type = "auto", runtime = "nodejs18.x" } = lambdaConfig;

      if (!name) {
        logger.warn(`Lambda sem nome ignorada: ${JSON.stringify(lambdaConfig)}`);
        return;
      }

      // Re-registro (ex.: updateFunction): o worker antigo precisa liberar a porta de debug antes
      await this.stopWorkerOf(name);

      // Merge: global env as base, lambda-specific env overrides
      const env = {
        ...(this.globalEnv || {}),
        ...(lambdaConfig.env || {}),
      };

      const timeout = lambdaConfig.timeout ?? this.globalTimeout ?? 30;
      const memorySize = lambdaConfig.memorySize ?? this.globalMemorySize ?? 128;

      // ---- Caminho de runtime externo por PROCESSO (spawn por invocação) ----
      // Precedência: runtimeEndpoint (HTTP) > codePath (processo) > defaultEndpoint > JS.
      if (!lambdaConfig.runtimeEndpoint && lambdaConfig.codePath) {
        const entry = this.registerProcessLambda(lambdaConfig, { name, runtime, type, env, timeout, memorySize });
        await this.startWorkerEagerly(entry);
        return;
      }

      // ---- Caminho de runtime externo (poliglota) ----
      // Precedência: runtimeEndpoint explícito > runtime externo (python/java/...).
      const isExternal =
        !!lambdaConfig.runtimeEndpoint || LambdaSimulator.isExternalRuntime(runtime);

      if (isExternal) {
        const runtimeEndpoint = this.resolveExternalEndpoint(lambdaConfig);

        if (!runtimeEndpoint) {
          // Mal configurada: sem endpoint resolvível. Não derruba o boot dos
          // demais serviços; registra como não-invocável.
          logger.error(
            `❌ Lambda externa '${name}' (runtime: ${runtime}) sem 'runtimeEndpoint' e sem 'lambda.externalRuntime.defaultEndpoint'. Registrada como NÃO invocável.`
          );
          this.lambdas.set(name, {
            name,
            runtime,
            handler: null,
            handlerPath: null,
            handlerName: lambdaConfig.handler || "external",
            env,
            timeout,
            memorySize,
            codeSize: 0,
            type,
            external: true,
            runtimeEndpoint: null,
            invocable: false,
            registeredAt: new Date().toISOString(),
          });
          return;
        }

        const timeoutMs = timeout * 1000;
        const handler = this.makeExternalHandler({ runtimeEndpoint, timeoutMs });

        this.lambdas.set(name, {
          name,
          runtime,
          handler,
          handlerPath: null,
          handlerName: lambdaConfig.handler || "external",
          env,
          timeout,
          memorySize,
          codeSize: 0,
          type,
          external: true,
          executionMode: "http",
          runtimeEndpoint,
          invocable: true,
          registeredAt: new Date().toISOString(),
        });

        logger.debug(`✅ Lambda externa registrada: ${name} -> ${runtimeEndpoint} (runtime: ${runtime})`);
        return;
      }

      // ---- Caminho JS atual (inalterado) ----
      // Resolve the handler path to absolute path
      let resolvedHandlerPath = path.resolve(process.cwd(), handlerPath);

      // Se não existir no cwd, tenta no data dir
      if (!fs.existsSync(resolvedHandlerPath)) {
        const dataPath = path.resolve(this.dataDir, handlerPath.replace(/^\.\//, ''));
        if (fs.existsSync(dataPath)) {
          resolvedHandlerPath = dataPath;
        }
      }

      const handler = await HandlerLoader.load(handlerPath, type);
      let codeSize = 0;
      try {
        const info = await HandlerLoader.getInfo(handlerPath);
        codeSize = info.size;
      } catch (err) {
        // Ignore size errors
      }

      if (handler != undefined) {
        this.lambdas.set(name, {
          name,
          runtime,
          handler,
          handlerPath: resolvedHandlerPath,
          handlerName: handler.name || "anonymous",
          env,
          timeout,
          memorySize,
          codeSize,
          type,
          registeredAt: new Date().toISOString(),
        });
      }
      logger.debug(`✅ Lambda registrada: ${name} -> ${resolvedHandlerPath}`);
    } catch (error) {     
      if (error.message.indexOf("Handler não encontrado") == -1){
        logger.error(`Erro ao registrar Lambda ${lambdaConfig.name}:`, error);
        throw error;
      }else{
        logger.error(`Erro ao registrar Lambda ${lambdaConfig.name}:`);
      }
    }
  }

  async invoke(functionName, event, invocationType = "RequestResponse") {
    const lambda = this.lambdas.get(functionName);

    if (!lambda) {
      throw new Error(`Function not found: ${functionName}`);
    }

    if (lambda.external && lambda.invocable === false) {
      const reason = lambda.invalidReason || `runtime externo '${lambda.runtime}' sem endpoint configurado`;
      throw new Error(`Function not invocable: ${functionName} (${reason})`);
    }

    this.applyEnvironment(lambda.env);
    logger.debug(`🎯 Invocando Lambda: ${functionName}`);

    if (invocationType === "Event") {
      this.executeHandler(lambda, functionName, event).catch((err) => logger.error(`❌ Async Lambda error (${functionName}):`, err));
      return { StatusCode: 202 };
    }

    let result;
    try {
      result = await this.executeHandler(lambda, functionName, event);
    } catch (error) {
      logger.error(`❌ Lambda handler error (${functionName}):`, error);
      throw error;
    }
    this.audit.record({
      eventName: "Invoke",
      readOnly: false,
      resources: [{ ARN: `arn:aws:lambda:local:000000000000:function:${functionName}`, type: "AWS::Lambda::Function" }],
      requestParameters: { functionName, invocationType },
    });
    return { StatusCode: result.statusCode || 200, Payload: result };
  }

  async invokeFunction(functionName, event) {
    return this.invoke(functionName, event, "Event");
  }

  async executeHandler(lambda, functionName, event) {
    const requestId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const capturedLogs = [];

    const context = this.createContext(functionName, requestId);
    // Buffer para logs vindos de runtimes externos (envelope { result, logs }).
    // Não afeta o caminho JS: só é preenchido pelo handler-proxy externo.
    context.__externalLogs = [];

    // Intercept console output during handler execution
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    const origInfo = console.info;

    const capture = (...args) => {
      const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      capturedLogs.push(line);
    };

    console.log = (...args) => { capture(...args); origLog(...args); };
    console.error = (...args) => { capture(`[ERROR] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`); origError(...args); };
    console.warn = (...args) => { capture(`[WARN] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`); origWarn(...args); };
    console.info = (...args) => { capture(`[INFO] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`); origInfo(...args); };

    let result;
    let execError;
    try {
      result = await lambda.handler(event, context);
    } catch (err) {
      execError = err;
      capturedLogs.push(`[ERROR] ${err.message}`);
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
      console.info = origInfo;
    }

    // Anexa logs capturados do runtime externo (se houver) ao buffer
    if (Array.isArray(context.__externalLogs) && context.__externalLogs.length > 0) {
      capturedLogs.push(...context.__externalLogs);
    }

    // Send logs to CloudWatch asynchronously (non-blocking)
    if (this.cloudwatchSimulator) {
      this.cloudwatchSimulator
        .putLambdaLogs(functionName, requestId, capturedLogs)
        .catch((err) => logger.debug(`[CloudWatch] Failed to store Lambda logs: ${err.message}`));
    }

    if (execError) throw execError;
    return result;
  }

  createContext(functionName = "local-lambda", requestId = null) {
    const reqId = requestId || Math.random().toString(36).substring(2, 18);
    return {
      awsRequestId: reqId,
      functionName,
      functionVersion: "$LATEST",
      invokedFunctionArn: `arn:aws:lambda:local:000000000000:function:${functionName}`,
      memoryLimitInMB: "1024",
      logGroupName: `/aws/lambda/${functionName}`,
      logStreamName: `${new Date().toISOString().slice(0, 10).replace(/-/g, '/')}/${reqId.slice(0, 8)}`,
      getRemainingTimeInMillis: () => 30000,
      callbackWaitsForEmptyEventLoop: true,
      identity: null,
      clientContext: null,
    };
  }

  applyEnvironment(env) {
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
      this.environment[key] = value;
    }
  }

  setEnvironmentVariable(key, value) {
    process.env[key] = value;
    this.environment[key] = value;
  }

  getEnvironmentVariables() {
    return { ...this.environment };
  }

  listLambdas() {
    return Array.from(this.lambdas.values()).map((l) => {
      let code = "";
      try {
        if (l.handlerPath && fs.existsSync(l.handlerPath)) {
          code = fs.readFileSync(l.handlerPath, "utf8");
        }
      } catch (err) {
        logger.error(`Erro ao ler código da lambda ${l.name}:`, err);
      }

      return {
        name: l.name,
        runtime: l.runtime,
        handlerName: l.handlerName,
        handlerPath: l.handlerPath,
        type: l.type,
        env: l.env,
        timeout: l.timeout,
        memorySize: l.memorySize,
        codeSize: l.codeSize,
        registeredAt: l.registeredAt,
        external: !!l.external,
        runtimeEndpoint: l.runtimeEndpoint || null,
        executionMode: l.executionMode || null,
        codePath: l.codePath || null,
        command: l.command || null,
        persistent: !!l.persistent,
        workerStatus: l.worker ? l.worker.status : null,
        workerPid: l.worker ? l.worker.pid : null,
        debugPort: l.debug ? l.debug.port : null,
        invocable: l.invocable !== false,
        invalidReason: l.invalidReason || null,
        code: code
      };
    });
  }


  getLambda(name) {
    return this.lambdas.get(name);
  }

  getLambdasCount() {
    return this.lambdas.size;
  }

  async reloadLambdas() {
    logger.info("🔄 Recarregando Lambdas...");

    for (const [name, lambda] of this.lambdas.entries()) {
      // Workers persistentes: reinicia para carregar o código editado.
      if (lambda.worker) {
        try {
          await lambda.worker.restart();
          logger.debug(`✅ Worker reiniciado: ${name}`);
        } catch (error) {
          logger.error(`❌ Erro ao reiniciar worker da Lambda ${name} (será recriado na próxima invocação): ${error.message}`);
        }
        continue;
      }
      // Lambdas externas não têm arquivo JS para recarregar.
      if (lambda.external) {
        logger.debug(`⏭️ Lambda externa não recarregada (sem código JS): ${name}`);
        continue;
      }
      try {
        const newHandler = await HandlerLoader.reload(lambda.handlerPath, lambda.type);
        lambda.handler = newHandler;
        lambda.handlerName = newHandler.name || "anonymous";
        logger.debug(`✅ Lambda recarregada: ${name}`);
      } catch (error) {
        logger.error(`❌ Erro ao recarregar Lambda ${name}:`, error);
      }
    }

    logger.info(`✅ ${this.lambdas.size} Lambdas recarregadas`);
  }

  async createFunction(lambdaConfig) {
    const { name, code, runtime, handler, timeout, memorySize, environment, runtimeEndpoint, codePath, command, persistent, debug, watch } = lambdaConfig;

    if (!name) throw new Error("Function name is required");

    // Runtime externo (poliglota): não grava arquivo .js, apenas registra o proxy (HTTP ou processo).
    if (runtimeEndpoint || codePath || LambdaSimulator.isExternalRuntime(runtime)) {
      await this.registerLambda({
        name,
        handler,
        runtime: runtime || "python3.12",
        runtimeEndpoint,
        codePath,
        command,
        persistent,
        debug,
        watch,
        timeout: timeout || 30,
        memorySize: memorySize || 128,
        env: environment || {},
      });
      // Lambdas externas vêm da config, não são persistidas como dinâmicas em disco.
      return this.lambdas.get(name);
    }

    // Define o caminho do arquivo (dentro do dataDir/functions)
    const functionsDir = path.join(this.dataDir, "functions");
    if (!fs.existsSync(functionsDir)) fs.mkdirSync(functionsDir, { recursive: true });

    const fileName = `${name}.js`;
    const filePath = path.join(functionsDir, fileName);

    // Salva o código no disco
    fs.writeFileSync(filePath, code || "// Hello Lambda");

    // Registra a lambda
    const config = {
      name,
      handler: filePath,
      runtime: runtime || "nodejs18.x",
      timeout: timeout || 30,
      memorySize: memorySize || 128,
      env: environment || {},
      type: "commonjs"
    };

    await this.registerLambda(config);
    this.persistLambdas();

    return this.lambdas.get(name);
  }

  async updateFunction(name, lambdaConfig) {
    const lambda = this.lambdas.get(name);
    if (!lambda) throw new Error(`Function not found: ${name}`);

    // Normaliza 'environment' para 'env' se necessário
    const config = {
      ...lambdaConfig,
      env: lambdaConfig.environment || lambdaConfig.env
    };
    delete config.environment; // Remove para evitar confusão

    const { code, runtime, handler, timeout, memorySize, env } = config;

    // Lambda por processo: revalida e reconstrói o proxy de processo.
    if (!config.runtimeEndpoint && (config.codePath || lambda.executionMode === "process")) {
      await this.registerLambda({
        name,
        runtime: runtime !== undefined ? runtime : lambda.runtime,
        handler: handler !== undefined ? handler : lambda.handlerName,
        codePath: config.codePath !== undefined ? config.codePath : lambda.codePath,
        command: config.command !== undefined ? config.command : lambda.command,
        persistent: config.persistent !== undefined ? config.persistent : lambda.persistent,
        debug: config.debug !== undefined ? config.debug : lambda.debug,
        watch: config.watch !== undefined ? config.watch : lambda.watch,
        timeout: timeout !== undefined ? timeout : lambda.timeout,
        memorySize: memorySize !== undefined ? memorySize : lambda.memorySize,
        env: env !== undefined ? env : lambda.env,
      });
      return this.lambdas.get(name);
    }

    // Lambda externa: atualiza metadados e reconstrói o proxy HTTP se preciso.
    if (lambda.external || config.runtimeEndpoint) {
      if (runtime !== undefined) lambda.runtime = runtime;
      if (timeout !== undefined) lambda.timeout = timeout;
      if (memorySize !== undefined) lambda.memorySize = memorySize;
      if (env !== undefined) lambda.env = env;
      if (config.runtimeEndpoint !== undefined) lambda.runtimeEndpoint = config.runtimeEndpoint;
      if (handler !== undefined) lambda.handlerName = handler;

      const endpoint = lambda.runtimeEndpoint || this.externalDefaultEndpoint || null;
      if (endpoint) {
        lambda.runtimeEndpoint = endpoint;
        lambda.external = true;
        lambda.invocable = true;
        lambda.executionMode = "http";
        lambda.handler = this.makeExternalHandler({
          runtimeEndpoint: endpoint,
          timeoutMs: (lambda.timeout ?? 30) * 1000,
        });
      } else {
        lambda.invocable = false;
      }
      return this.lambdas.get(name);
    }

    logger.debug(`📝 Updating function ${name}:`, { 
      hasCode: !!code, 
      code: code ? `(${code.length} chars)` : 'NULL/UNDEFINED',
      codeLength: code?.length,
      runtime, 
      timeout, 
      memorySize,
      handlerPath: lambda.handlerPath,
      configKeys: Object.keys(config)
    });

    // Se houver código novo, sobrescreve o arquivo
    if (code !== undefined && code !== null && code.trim() !== '') {
      logger.debug(`💾 Escrevendo código no arquivo: ${lambda.handlerPath}`);
      try {
        fs.writeFileSync(lambda.handlerPath, code, 'utf8');
        logger.debug(`✅ Arquivo atualizado com sucesso`);
      } catch (err) {
        logger.error(`❌ Erro ao escrever arquivo:`, err);
        throw err;
      }

      // Reload the handler from the updated file
      try {
        const newHandler = await HandlerLoader.reload(lambda.handlerPath, lambda.type);
        lambda.handler = newHandler;
        lambda.handlerName = newHandler.name || "anonymous";
        
        // Update code size
        try {
          const info = await HandlerLoader.getInfo(lambda.handlerPath);
          lambda.codeSize = info.size;
        } catch (err) {
          // Ignore size errors
        }
      } catch (error) {
        logger.error(`❌ Erro ao recarregar Lambda ${name}:`, error);
        throw error;
      }
    } else {
      logger.warn(`⚠️ Nenhum código fornecido para atualização. code=${JSON.stringify(code)}`);
    }

    // Atualiza outras configurações
    if (runtime !== undefined) lambda.runtime = runtime;
    if (timeout !== undefined) lambda.timeout = timeout;
    if (memorySize !== undefined) lambda.memorySize = memorySize;
    if (env !== undefined) lambda.env = env;

    this.persistLambdas();

    return this.lambdas.get(name);
  }

  async deleteFunction(name) {

    if (this.lambdas.has(name)) {
      await this.stopWorkerOf(name);
      this.lambdas.delete(name);
      this.persistLambdas();
      return true;
    }
    return false;
  }

  persistLambdas() {
    const functionsToSave = Array.from(this.lambdas.values())
      .filter(l => l.handlerPath && l.handlerPath.includes(this.dataDir)) // Apenas as dinâmicas
      .map(l => ({
        name: l.name,
        handler: l.handlerPath,
        type: l.type,
        env: l.env,
        timeout: l.timeout,
        memorySize: l.memorySize,
      }));

    this.store.write("__functions__", functionsToSave);
  }

  getStats() {
    return {
      totalLambdas: this.lambdas.size,
      lambdas: this.listLambdas().map((l) => ({ name: l.name, handler: l.handlerName })),
    };
  }


  // Event Source Mappings
  listEventSourceMappings(params = {}) {
    const arr = Array.from(this.eventSourceMappings.values());
    return { EventSourceMappings: arr };
  }
  getEventSourceMapping(uuid) {
    return this.eventSourceMappings.get(uuid);
  }
  createEventSourceMapping(params = {}) {
    const uuid = params.UUID || require('crypto').randomUUID();
    const mapping = {
      UUID: uuid,
      EventSourceArn: params.EventSourceArn,
      FunctionArn: params.FunctionName ? `arn:aws:lambda:local:000000000000:function:${params.FunctionName}` : params.FunctionArn,
      FunctionName: params.FunctionName,
      BatchSize: params.BatchSize || 10,
      Enabled: params.Enabled !== false,
      State: 'Enabled',
      LastModified: new Date().toISOString(),
      ...params,
    };
    this.eventSourceMappings.set(uuid, mapping);
    this.store.write("__event_source_mappings__", Array.from(this.eventSourceMappings.values()));
    return mapping;
  }
  updateEventSourceMapping(uuid, params = {}) {
    const existing = this.eventSourceMappings.get(uuid) || { UUID: uuid };
    const mapping = { ...existing, ...params, LastModified: new Date().toISOString() };
    this.eventSourceMappings.set(uuid, mapping);
    this.store.write("__event_source_mappings__", Array.from(this.eventSourceMappings.values()));
    return mapping;
  }
  deleteEventSourceMapping(uuid) {
    const existed = this.eventSourceMappings.delete(uuid);
    this.store.write("__event_source_mappings__", Array.from(this.eventSourceMappings.values()));
    return existed;
  }

  // Layers
  listLayers(params = {}) {
    const layers = [];
    for (const [layerName, layer] of this.layers.entries()) {
      const latest = (layer.versions || [])[0];
      layers.push({
        LayerName: layerName,
        LayerArn: `arn:aws:lambda:local:000000000000:layer:${layerName}`,
        LatestMatchingVersion: latest ? {
          LayerVersionArn: latest.LayerVersionArn,
          Version: latest.Version,
          Description: latest.Description,
          CreatedDate: latest.CreatedDate,
          CompatibleRuntimes: latest.CompatibleRuntimes || [],
        } : undefined,
      });
    }
    return { Layers: layers };
  }
  listLayerVersions(layerName) {
    const layer = this.layers.get(layerName);
    return { LayerVersions: layer?.versions || [] };
  }
  publishLayerVersion(layerName, params = {}) {
    const layer = this.layers.get(layerName) || { versions: [] };
    const version = (layer.versions[0]?.Version || 0) + 1;
    const lv = {
      LayerArn: `arn:aws:lambda:local:000000000000:layer:${layerName}`,
      LayerVersionArn: `arn:aws:lambda:local:000000000000:layer:${layerName}:${version}`,
      Version: version,
      Description: params.Description || '',
      CreatedDate: new Date().toISOString(),
      CompatibleRuntimes: params.CompatibleRuntimes || [],
      CompatibleArchitectures: params.CompatibleArchitectures || [],
      LicenseInfo: params.LicenseInfo || '',
      Content: params.Content || {},
    };
    layer.versions.unshift(lv);
    this.layers.set(layerName, layer);
    const obj = {};
    for (const [k, v] of this.layers.entries()) obj[k] = v;
    this.store.write("__layers__", obj);
    return lv;
  }
  getLayerVersion(layerName, version) {
    const layer = this.layers.get(layerName);
    return (layer?.versions || []).find(v => String(v.Version) === String(version));
  }
  deleteLayerVersion(layerName, version) {
    const layer = this.layers.get(layerName);
    if (!layer) return false;
    layer.versions = (layer.versions || []).filter(v => String(v.Version) !== String(version));
    this.layers.set(layerName, layer);
    const obj = {};
    for (const [k, v] of this.layers.entries()) obj[k] = v;
    this.store.write("__layers__", obj);
    return true;
  }

  // Code Signing Configs
  listCodeSigningConfigs() {
    return { CodeSigningConfigs: Array.from(this.codeSigningConfigs.values()) };
  }
  getCodeSigningConfig(arn) {
    return Array.from(this.codeSigningConfigs.values()).find(c => (c.CodeSigningConfigArn === arn) || (c.Arn === arn));
  }
  createCodeSigningConfig(params = {}) {
    const id = require('crypto').randomUUID().replace(/-/g, '').slice(0, 16);
    const arn = `arn:aws:lambda:local:000000000000:code-signing-config:csc-${id}`;
    const csc = {
      CodeSigningConfigId: id,
      CodeSigningConfigArn: arn,
      AllowedPublishers: params.AllowedPublishers || {},
      CodeSigningPolicies: params.CodeSigningPolicies || { UntrustedArtifactOnDeployment: 'Warn' },
      Description: params.Description || '',
      LastModified: new Date().toISOString(),
      ...params,
    };
    this.codeSigningConfigs.set(arn, csc);
    this.store.write("__code_signing_configs__", Array.from(this.codeSigningConfigs.values()));
    return { CodeSigningConfig: csc };
  }
  updateCodeSigningConfig(arn, params = {}) {
    const existing = this.getCodeSigningConfig(arn) || { CodeSigningConfigArn: arn };
    const csc = { ...existing, ...params, LastModified: new Date().toISOString() };
    this.codeSigningConfigs.set(csc.CodeSigningConfigArn, csc);
    this.store.write("__code_signing_configs__", Array.from(this.codeSigningConfigs.values()));
    return { CodeSigningConfig: csc };
  }
  deleteCodeSigningConfig(arn) {
    const csc = this.getCodeSigningConfig(arn);
    if (!csc) return false;
    this.codeSigningConfigs.delete(csc.CodeSigningConfigArn);
    this.store.write("__code_signing_configs__", Array.from(this.codeSigningConfigs.values()));
    return true;
  }

  // Capacity Providers
  listCapacityProviders() {
    return { CapacityProviders: Array.from(this.capacityProviders.values()) };
  }
  getCapacityProvider(name) {
    return this.capacityProviders.get(name);
  }
  createCapacityProvider(params = {}) {
    const cp = {
      CapacityProviderName: params.CapacityProviderName || params.name,
      CapacityProviderArn: `arn:aws:lambda:local:000000000000:capacity-provider:${params.CapacityProviderName || params.name}`,
      State: 'Active',
      VpcConfig: params.VpcConfig || {},
      PermissionsConfig: params.PermissionsConfig || {},
      LastModified: new Date().toISOString(),
      ...params,
    };
    this.capacityProviders.set(cp.CapacityProviderName, cp);
    this.store.write("__capacity_providers__", Array.from(this.capacityProviders.values()));
    return { CapacityProvider: cp };
  }
  updateCapacityProvider(name, params = {}) {
    const existing = this.capacityProviders.get(name) || { CapacityProviderName: name };
    const cp = { ...existing, ...params, LastModified: new Date().toISOString() };
    this.capacityProviders.set(name, cp);
    this.store.write("__capacity_providers__", Array.from(this.capacityProviders.values()));
    return { CapacityProvider: cp };
  }
  deleteCapacityProvider(name) {
    const existed = this.capacityProviders.delete(name);
    this.store.write("__capacity_providers__", Array.from(this.capacityProviders.values()));
    return existed;
  }

  // Function URLs
  getFunctionUrlConfig(functionName) {
    return this.functionUrls.get(functionName) || null;
  }
  listFunctionUrlConfigs(functionName) {
    const c = this.functionUrls.get(functionName);
    return { FunctionUrlConfigs: c ? [c] : [] };
  }
  createFunctionUrlConfig(functionName, params = {}) {
    const cfg = {
      FunctionUrl: `http://localhost:${this.config.ports?.lambda || 3001}/2021-10-31/functions/${functionName}/url`,
      FunctionArn: `arn:aws:lambda:local:000000000000:function:${functionName}`,
      CreationTime: new Date().toISOString(),
      LastModifiedTime: new Date().toISOString(),
      AuthType: params.AuthType || 'NONE',
      Cors: params.Cors || {},
      InvokeMode: params.InvokeMode || 'BUFFERED',
      ...params,
    };
    this.functionUrls.set(functionName, cfg);
    const obj = {};
    for (const [k, v] of this.functionUrls.entries()) obj[k] = v;
    this.store.write("__function_urls__", obj);
    return cfg;
  }
  updateFunctionUrlConfig(functionName, params = {}) {
    const existing = this.functionUrls.get(functionName) || {};
    const cfg = { ...existing, ...params, LastModifiedTime: new Date().toISOString() };
    this.functionUrls.set(functionName, cfg);
    const obj = {};
    for (const [k, v] of this.functionUrls.entries()) obj[k] = v;
    this.store.write("__function_urls__", obj);
    return cfg;
  }
  deleteFunctionUrlConfig(functionName) {
    const existed = this.functionUrls.delete(functionName);
    const obj = {};
    for (const [k, v] of this.functionUrls.entries()) obj[k] = v;
    this.store.write("__function_urls__", obj);
    return existed;
  }

  async reset() {
    await this.reloadLambdas();
    this.environment = { ...process.env };
    this.eventSourceMappings.clear();
    this.layers.clear();
    this.codeSigningConfigs.clear();
    this.capacityProviders.clear();
    this.functionUrls.clear();
    logger.debug("Lambda: Estado resetado");
  }
}

module.exports = LambdaSimulator;
