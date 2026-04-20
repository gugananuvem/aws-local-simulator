/**
 * SQS Service - Ponto de entrada
 * Exporta o serviço principal e seus componentes
 */

const SQSServer = require('./server');
const SQSSimulator = require('./simulator');

class SQSService {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.lambdaService = dependencies.lambda;
    this.name = 'sqs';
    this.port = config.ports.sqs;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando SQS Service na porta ${this.port}...`);
    
    this.simulator = new SQSSimulator(this.config, this.lambdaService);
    await this.simulator.initialize();

    this.server = new SQSServer(this.port, this.config, this.lambdaService);
    this.server.simulator = this.simulator;
    
    await this.server.initialize();
    
    await this.setupQueueTriggers();
    
    logger.debug('SQS Service inicializado');
  }

  async setupQueueTriggers() {
    if (!this.config.sqs?.queues) return;
    
    const logger = require('../../utils/logger');
    
    for (const queueConfig of this.config.sqs.queues) {
      if (typeof queueConfig === 'object' && queueConfig.lambdaName && this.lambdaService) {
        const lambdaSimulator = this.lambdaService.simulator;
        const lambda = lambdaSimulator?.getLambda(queueConfig.lambdaName);

        if (lambda) {
          const lambdaName = queueConfig.lambdaName;
          const handler = async (event) => lambdaSimulator.invoke(lambdaName, event);

          this.simulator.attachLambdaToQueue(
            queueConfig.name,
            handler,
            { batchSize: queueConfig.batchSize || 10 }
          );
          logger.debug(`🔗 Fila ${queueConfig.name} -> Lambda ${lambdaName}`);
        } else {
          logger.warn(`⚠️ Lambda não encontrada para fila ${queueConfig.name}: ${queueConfig.lambdaName}`);
        }
      }
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
      queuesCount: this.simulator?.getQueuesCount() || 0,
      messagesCount: this.simulator?.getTotalMessagesCount() || 0
    };
  }

  getSimulator() {
    return this.simulator;
  }

  getServer() {
    return this.server;
  }
}

module.exports = SQSService;