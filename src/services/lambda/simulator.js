/**
 * Lambda Simulator - Simula execução de funções Lambda
 */

const HandlerLoader = require("./handler-loader");
const logger = require("../../utils/logger");
const { CloudTrailAudit } = require("../../utils/cloudtrail-audit");

class LambdaSimulator {
  constructor(config) {
    this.config = config;
    this.lambdas = new Map(); // functionName -> { handler, env, config }
    this.environment = { ...process.env };
    this.audit = new CloudTrailAudit("lambda.amazonaws.com");
  }

  async initialize() {
    logger.debug("Inicializando Lambda Simulator...");

    if (this.config.lambdas && this.config.lambdas.length > 0) {
      for (const lambdaConfig of this.config.lambdas) {
        await this.registerLambda(lambdaConfig);
      }
    }

    logger.debug(`✅ ${this.lambdas.size} Lambdas registradas`);
  }

  async registerLambda(lambdaConfig) {
    try {
      const { name, handler: handlerPath, env = {}, type = "auto" } = lambdaConfig;

      if (!name) {
        logger.warn(`Lambda sem nome ignorada: ${JSON.stringify(lambdaConfig)}`);
        return;
      }

      const handler = await HandlerLoader.load(handlerPath, type);
      if (handler != undefined) {
        this.lambdas.set(name, {
          name,
          handler,
          handlerPath,
          handlerName: handler.name || "anonymous",
          env,
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
      this.executeHandler(lambda.handler, event).catch((err) => logger.error(`❌ Async Lambda error (${functionName}):`, err));
      return { StatusCode: 202 };
    }

    const result = await this.executeHandler(lambda.handler, event);
    this.audit.record({
      eventName: "Invoke",
      readOnly: false,
      resources: [{ ARN: `arn:aws:lambda:local:000000000000:function:${functionName}`, type: "AWS::Lambda::Function" }],
      requestParameters: { functionName, invocationType },
    });
    return { StatusCode: result.statusCode || 200, Payload: result };
  }

  async executeHandler(handler, event) {
    try {
      const context = this.createContext();
      const result = await handler(event, context);
      return result;
    } catch (error) {
      logger.error("❌ Erro no handler:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Internal Server Error", message: error.message }),
      };
    }
  }

  createContext() {
    return {
      awsRequestId: Math.random().toString(36).substring(7),
      functionName: "local-lambda",
      functionVersion: "$LATEST",
      invokedFunctionArn: "arn:aws:lambda:local:000000000000:function:local-lambda",
      memoryLimitInMB: "1024",
      logGroupName: "/aws/lambda/local-lambda",
      logStreamName: "local-stream",
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
    return Array.from(this.lambdas.values()).map((l) => ({
      name: l.name,
      handlerName: l.handlerName,
      handlerPath: l.handlerPath,
      type: l.type,
      env: l.env,
      registeredAt: l.registeredAt,
    }));
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
