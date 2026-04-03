/**
 * Lambda Simulator - Simula execução de funções Lambda
 */

const HandlerLoader = require('./handler-loader');
const RouteRegistry = require('./route-registry');
const logger = require('../../utils/logger');

class LambdaSimulator {
  constructor(config) {
    this.config = config;
    this.routeRegistry = new RouteRegistry();
    this.lambdas = new Map();
    this.environment = { ...process.env };
  }

  async initialize() {
    logger.debug('Inicializando Lambda Simulator...');
    
    if (this.config.lambdas && this.config.lambdas.length > 0) {
      for (const lambdaConfig of this.config.lambdas) {
        await this.registerLambda(lambdaConfig);
      }
    }
    
    logger.debug(`✅ ${this.lambdas.size} Lambdas registradas`);
  }

  async registerLambda(lambdaConfig) {
    try {
      const { path, handler: handlerPath, env = {}, type = 'auto' } = lambdaConfig;
      
      // Carrega o handler
      const handler = await HandlerLoader.load(handlerPath, type);
      
      // Registra no route registry
      this.routeRegistry.register(path, handler, env);
      
      // Armazena metadata
      this.lambdas.set(path, {
        path,
        handler,
        handlerPath,
        handlerName: handler.name || 'anonymous',
        env,
        type,
        registeredAt: new Date().toISOString()
      });
      
      logger.debug(`✅ Lambda registrada: ${path} -> ${handler.name || 'anonymous'}`);
      
    } catch (error) {
      logger.error(`❌ Erro ao registrar Lambda ${lambdaConfig.path}:`, error);
      throw error;
    }
  }

  async handleRequest(req, res) {
    const matchedRoute = this.routeRegistry.find(req.path);
    
    if (!matchedRoute) {
      return {
        error: {
          statusCode: 404,
          message: `Route not found: ${req.path}`,
          availableRoutes: this.listRoutes()
        },
        status: 404
      };
    }
    
    // Aplica variáveis de ambiente específicas da rota
    this.applyEnvironment(matchedRoute.env);
    
    // Prepara evento Lambda
    const event = this.toLambdaEvent(req, matchedRoute.params);
    
    logger.debug(`🎯 Executando: ${matchedRoute.path} -> ${matchedRoute.handler.name || 'anonymous'}`);
    
    // Executa middlewares
    const middlewares = this.routeRegistry.getMiddlewares(matchedRoute);
    let handled = false;
    let result = null;
    
    const runMiddlewares = async (index) => {
      if (index >= middlewares.length) {
        // Executa handler

        result = await this.executeHandler(matchedRoute.handler, event);
        handled = true;
      
        console.log(`✅ Resposta: ${result.statusCode}`);
        res
          .status(result.statusCode || 200)
          .set(result.headers || {})
          .send(result.body ? JSON.parse(result.body) : null);
        return;
      }
      
      const middleware = middlewares[index];
      await new Promise((resolve, reject) => {
        middleware(event, {
          status: (code) => ({ json: (data) => {
            result = { statusCode: code, body: data };
            handled = true;
            resolve();
          }}),
          send: (data) => {
            result = { statusCode: 200, body: data };
            handled = true;
            resolve();
          },
          next: () => {
            runMiddlewares(index + 1).then(resolve).catch(reject);
          }
        });
      });
    };
    
    await runMiddlewares(0);
    
    if (!handled && result) {
      return this.formatResponse(result);
    }

    return null;
  }

  async executeHandler(handler, event) {
    try {
      const context = this.createContext();
      const result = await handler(event, context);
      return result;
    } catch (error) {
      logger.error('❌ Erro no handler:', error);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      };
    }
  }

  toLambdaEvent(req, params = {}) {
    return {
      httpMethod: req.method,
      path: req.path,
      headers: req.headers,
      queryStringParameters: req.query,
      pathParameters: params,
      body: req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : null,
      isBase64Encoded: false,
      requestContext: {
        path: req.path,
        stage: process.env.STAGE_NAME || 'dev',
        requestId: Math.random().toString(36).substring(7),
        identity: {
          sourceIp: req.ip,
          userAgent: req.headers['user-agent']
        }
      },
      stageVariables: {},
      resource: req.path
    };
  }

  formatResponse(result) {
    const statusCode = result.statusCode || 200;
    const body = result.body;
    const headers = result.headers || { 'Content-Type': 'application/json' };
    
    return {
      statusCode,
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      isBase64Encoded: false
    };
  }

  createContext() {
    return {
      awsRequestId: Math.random().toString(36).substring(7),
      functionName: 'local-lambda',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:local:function',
      memoryLimitInMB: '1024',
      logGroupName: '/aws/lambda/local-lambda',
      logStreamName: 'local-stream',
      getRemainingTimeInMillis: () => 30000,
      callbackWaitsForEmptyEventLoop: true,
      identity: null,
      clientContext: null
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
    return Array.from(this.lambdas.values()).map(l => ({
      path: l.path,
      handlerName: l.handlerName,
      handlerPath: l.handlerPath,
      type: l.type,
      env: l.env,
      registeredAt: l.registeredAt
    }));
  }

  getLambda(path) {
    return this.lambdas.get(path);
  }

  listRoutes() {
    return this.routeRegistry.list();
  }

  getLambdasCount() {
    return this.lambdas.size;
  }

  async reloadLambdas() {
    logger.info('🔄 Recarregando Lambdas...');
    
    for (const [path, lambda] of this.lambdas.entries()) {
      try {
        const newHandler = await HandlerLoader.reload(lambda.handlerPath, lambda.type);
        this.routeRegistry.register(path, newHandler, lambda.env);
        lambda.handler = newHandler;
        lambda.handlerName = newHandler.name || 'anonymous';
        logger.debug(`✅ Lambda recarregada: ${path}`);
      } catch (error) {
        logger.error(`❌ Erro ao recarregar Lambda ${path}:`, error);
      }
    }
    
    logger.info(`✅ ${this.lambdas.size} Lambdas recarregadas`);
  }

  getStats() {
    const lambdas = this.listLambdas();
    return {
      totalLambdas: lambdas.length,
      lambdas: lambdas.map(l => ({
        path: l.path,
        handler: l.handlerName
      })),
      routes: this.routeRegistry.getStats(),
      environment: Object.keys(this.environment).length
    };
  }

  async reset() {
    // Recarrega Lambdas
    await this.reloadLambdas();
    
    // Limpa variáveis de ambiente customizadas
    for (const key of Object.keys(this.environment)) {
      if (!process.env.hasOwnProperty(key) || key.startsWith('AWS_LOCAL_SIMULATOR_')) {
        delete process.env[key];
      }
    }
    
    this.environment = { ...process.env };
    logger.debug('Lambda: Estado resetado');
  }
}

module.exports = LambdaSimulator;