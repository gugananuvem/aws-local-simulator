/**
 * API Gateway Service - Simulador de Amazon API Gateway
 * Suporta: REST APIs, HTTP APIs, WebSocket APIs, Stages, Deployments
 */

const APIGatewayServer = require('./server');
const APIGatewaySimulator = require('./simulator');

class APIGatewayService {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.name = 'apigateway';
    this.port = config.ports.apigateway || 4567;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
    this.lambdaService = dependencies.lambda || null;
    this.cognitoService = dependencies.cognito || null;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando API Gateway Service na porta ${this.port}...`);

    this.simulator = new APIGatewaySimulator(this.config);
    await this.simulator.initialize();

    this.server = new APIGatewayServer(this.port, this.config);
    this.server.simulator = this.simulator;
    this.server.lambdaService = this.lambdaService;
    this.server.cognitoService = this.cognitoService;
    
    await this.server.initialize();
    
    logger.debug('API Gateway Service inicializado');
  }

  injectDependencies(server) {
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.audit.setTrail(ct.simulator);

    const lambda = server.getService('lambda');
    if (lambda) {
      this.lambdaService = lambda;
      if (this.simulator) this.simulator.setLambdaService(lambda);
      if (this.server) this.server.lambdaService = lambda;
    }
    const sqs = server.getService('sqs');
    if (sqs) {
      if (this.simulator) this.simulator.setSqsService(sqs);
      if (this.server) this.server.sqsService = sqs;
    }
    const sns = server.getService('sns');
    if (sns) {
      if (this.simulator) this.simulator.setSnsService(sns);
      if (this.server) this.server.snsService = sns;
    }
    const eb = server.getService('eventbridge');
    if (eb) {
      if (this.simulator) this.simulator.setEventbridgeService(eb);
      if (this.server) this.server.eventbridgeService = eb;
    }
  }

  async start() {
    if (this.isRunning) return;
    await this.server.start();
    this.isRunning = true;
  }

  async stop() {
    if (!this.isRunning) return;
    await this.server.stop();
    this.isRunning = false;
  }

  async reset() {
    await this.simulator.reset();
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      apisCount: this.simulator?.getAPIsCount() || 0,
      deploymentsCount: this.simulator?.getDeploymentsCount() || 0,
      stagesCount: this.simulator?.getStagesCount() || 0,
      resourcesCount: this.simulator?.getResourcesCount() || 0
    };
  }

  getSimulator() {
    return this.simulator;
  }
}

module.exports = APIGatewayService;