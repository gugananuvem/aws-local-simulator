const LocalStore = require("../../utils/local-store");
const path = require("path");
const fs = require("fs");
const HandlerLoader = require("./handler-loader");
const logger = require("../../utils/logger");
const { CloudTrailAudit } = require("../../utils/cloudtrail-audit");

class LambdaSimulator {
  constructor(config) {
    this.config = config;
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR, "lambda");
    this.store = new LocalStore(this.dataDir);
    this.lambdas = new Map(); // functionName -> { handler, env, config }
    this.environment = { ...process.env };
    this.audit = new CloudTrailAudit("lambda.amazonaws.com");
    this.cloudwatchSimulator = null; // injected via injectDependencies
  }

  async initialize() {
    logger.debug("Inicializando Lambda Simulator...");

    // Build global lambda defaults from config.global
    const globalDefaults = this.config.global || {};
    this.globalEnv = globalDefaults.env || {};
    this.globalTimeout = globalDefaults.timeout || null;
    this.globalMemorySize = globalDefaults.memorySize || null;

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

    logger.debug(`✅ ${this.lambdas.size} Lambdas registradas`);
  }


  async registerLambda(lambdaConfig) {
    try {
      const { name, handler: handlerPath, type = "auto" } = lambdaConfig;

      if (!name) {
        logger.warn(`Lambda sem nome ignorada: ${JSON.stringify(lambdaConfig)}`);
        return;
      }

      // Merge: global env as base, lambda-specific env overrides
      const env = {
        ...(this.globalEnv || {}),
        ...(lambdaConfig.env || {}),
      };

      const timeout = lambdaConfig.timeout ?? this.globalTimeout ?? 30;
      const memorySize = lambdaConfig.memorySize ?? this.globalMemorySize ?? 128;

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
          handler,
          handlerPath,
          handlerName: handler.name || "anonymous",
          env,
          timeout,
          memorySize,
          codeSize,
          type,
          registeredAt: new Date().toISOString(),
        });
      }
      logger.debug(`✅ Lambda registrada: ${name} -> ${handlerPath}`);
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

  async executeHandler(lambda, functionName, event) {
    const requestId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const capturedLogs = [];

    const context = this.createContext(functionName, requestId);

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
        if (fs.existsSync(l.handlerPath)) {
          code = fs.readFileSync(l.handlerPath, "utf8");
        }
      } catch (err) {
        logger.error(`Erro ao ler código da lambda ${l.name}:`, err);
      }

      return {
        name: l.name,
        handlerName: l.handlerName,
        handlerPath: l.handlerPath,
        type: l.type,
        env: l.env,
        timeout: l.timeout,
        memorySize: l.memorySize,
        codeSize: l.codeSize,
        registeredAt: l.registeredAt,
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
    const { name, code, runtime, handler, timeout, memorySize, environment } = lambdaConfig;

    if (!name) throw new Error("Function name is required");

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

    const { code, runtime, handler, timeout, memorySize, environment } = lambdaConfig;

    // Se houver código novo, sobrescreve o arquivo
    if (code !== undefined) {
      fs.writeFileSync(lambda.handlerPath, code);
    }

    // Atualiza a configuração
    const updatedConfig = {
      name,
      handler: lambda.handlerPath,
      runtime: runtime || lambda.runtime,
      timeout: timeout || lambda.timeout,
      memorySize: memorySize || lambda.memorySize,
      env: environment || lambda.env,
      type: lambda.type
    };

    await this.registerLambda(updatedConfig);
    this.persistLambdas();

    return this.lambdas.get(name);
  }

  async deleteFunction(name) {

    if (this.lambdas.has(name)) {
      this.lambdas.delete(name);
      this.persistLambdas();
      return true;
    }
    return false;
  }

  persistLambdas() {
    const functionsToSave = Array.from(this.lambdas.values())
      .filter(l => l.handlerPath.includes(this.dataDir)) // Apenas as dinâmicas
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


  async reset() {
    await this.reloadLambdas();
    this.environment = { ...process.env };
    logger.debug("Lambda: Estado resetado");
  }
}

module.exports = LambdaSimulator;
