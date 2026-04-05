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
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando API Gateway Service na porta ${this.port}...`);

    this.simulator = new APIGatewaySimulator(this.config);
    await this.simulator.initialize();

    this.server = new APIGatewayServer(this.port, this.config);
    this.server.simulator = this.simulator;
    this.server.lambdaService = this.lambdaService;
    
    await this.server.initialize();
    
    logger.debug('API Gateway Service inicializado');
  }

  injectDependencies(server) {
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.audit.setTrail(ct.simulator);
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