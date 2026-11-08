/**
 * Lambda Service - Ponto de entrada
 * Exporta o serviço principal e seus componentes
 */

const LambdaServer = require('./server');
const LambdaSimulator = require('./simulator');

class LambdaService {
  constructor(config) {
    this.config = config;
    this.name = 'lambda';
    this.port = config.ports.lambda;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando Lambda Service na porta ${this.port}...`);
    
    // Cria o simulador
    this.simulator = new LambdaSimulator(this.config);
    await this.simulator.initialize();

    // Cria o servidor HTTP
    this.server = new LambdaServer(this.port, this.config);
    this.server.simulator = this.simulator;
    
    await this.server.initialize();
    
    logger.debug('Lambda Service inicializado');
  }

  injectDependencies(server) {
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.audit.setTrail(ct.simulator);

    const cw = server.getService('cloudwatch');
    if (cw?.simulator) this.simulator.cloudwatchSimulator = cw.simulator;

    // IAM enforcement middleware (only when IAM service is active)
    const iamService = server.getService('iam');
    if (iamService && iamService.getSimulator()) {
      const { createIAMEnforcementMiddleware } = require('../iam/middleware');
      const iamSimulator = iamService.getSimulator();
      this.server.iamMiddleware = createIAMEnforcementMiddleware({
        iamSimulator,
        servicePrefix: 'lambda',
        extractAction: (req) => {
          if (req.path.includes('/invocations')) return 'InvokeFunction';
          if (req.method === 'POST') return 'CreateFunction';
          if (req.method === 'GET') return 'ListFunctions';
          if (req.method === 'DELETE') return 'DeleteFunction';
          if (req.method === 'PUT') return 'UpdateFunctionConfiguration';
          return 'Unknown';
        },
        extractResource: (req) => {
          const functionName = req.params?.functionName || req.path.split('/functions/')[1]?.split('/')[0] || 'unknown';
          return `arn:aws:lambda:us-east-1:123456789012:function:${functionName}`;
        },
        formatError: (res, code, message) => {
          res.status(403).json({ Message: message, Type: code });
        }
      });
    }
  }

  async start() {
    if (this.isRunning) return;
    await this.server.start();
    this.isRunning = true;
  }

  async stop() {
    // Workers persistentes são encerrados sempre (iniciam no initialize, antes do start)
    if (this.simulator) await this.simulator.shutdownWorkers();
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
      lambdasCount: this.simulator?.getLambdasCount() || 0
    };
  }

  getHandler(path) {
    return this.simulator?.getHandler(path);
  }

  getSimulator() {
    return this.simulator;
  }

  getServer() {
    return this.server;
  }
}

module.exports = LambdaService;