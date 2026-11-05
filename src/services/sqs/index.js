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

  injectDependencies(server) {
    const lambdaService = server.getService('lambda');
    if (lambdaService) {
      this.lambdaService = lambdaService;
      if (this.simulator) {
        this.simulator.setLambdaService(lambdaService);
        this.simulator.reattachLambdaHandlers();
      }
      if (this.server) {
        this.server.lambdaService = lambdaService;
      }
    }

    const iamService = server.getService('iam');
    if (iamService && iamService.getSimulator()) {
      const { createIAMEnforcementMiddleware } = require('../iam/middleware');
      const iamSimulator = iamService.getSimulator();

      const middleware = createIAMEnforcementMiddleware({
        iamSimulator,
        servicePrefix: 'sqs',
        extractAction: (req) => req.body?.Action || req.query?.Action || 'Unknown',
        extractResource: (req) => {
          const queueUrl = req.body?.QueueUrl || req.query?.QueueUrl || '';
          const queueName = queueUrl.split('/').pop() || req.body?.QueueName || 'unknown';
          return `arn:aws:sqs:us-east-1:123456789012:${queueName}`;
        },
        formatError: (res, code, message) => {
          res.status(403).set('Content-Type', 'text/xml').send(
            `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error></ErrorResponse>`
          );
        }
      });

      this.server.iamMiddleware = middleware;
    }
  }
}

module.exports = SQSService;