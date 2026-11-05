/**
 * S3 Service - Ponto de entrada
 * Exporta o serviço principal e seus componentes
 */

const S3Server = require('./server');
const S3Simulator = require('./simulator');

class S3Service {
  constructor(config) {
    this.config = config;
    this.name = 's3';
    this.port = config.ports.s3;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando S3 Service na porta ${this.port}...`);
    
    this.simulator = new S3Simulator(this.config);
    await this.simulator.initialize();

    this.server = new S3Server(this.port, this.config);
    this.server.simulator = this.simulator;
    
    await this.server.initialize();
    
    logger.debug('S3 Service inicializado');
  }

  injectDependencies(server) {
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.audit.setTrail(ct.simulator);

    const lambda = server.getService('lambda');
    if (lambda) this.simulator.setLambdaService(lambda);

    const sns = server.getService('sns');
    if (sns) this.simulator.setSnsService(sns);

    const sqs = server.getService('sqs');
    if (sqs) this.simulator.setSqsService(sqs);

    const eventbridge = server.getService('eventbridge');
    if (eventbridge) this.simulator.setEventbridgeService(eventbridge);

    // IAM enforcement middleware (only when IAM service is active)
    const iamService = server.getService('iam');
    if (iamService && iamService.getSimulator()) {
      const { createIAMEnforcementMiddleware } = require('../iam/middleware');
      const iamSimulator = iamService.getSimulator();

      const middleware = createIAMEnforcementMiddleware({
        iamSimulator,
        servicePrefix: 's3',
        extractAction: (req) => {
          const pathParts = req.path.split('/').filter(Boolean);
          const hasKey = pathParts.length >= 2;

          switch (req.method) {
            case 'GET':
              return hasKey ? 'GetObject' : 'ListBucket';
            case 'PUT':
              return hasKey ? 'PutObject' : 'CreateBucket';
            case 'DELETE':
              return hasKey ? 'DeleteObject' : 'DeleteBucket';
            case 'HEAD':
              return hasKey ? 'GetObject' : 'ListBucket';
            case 'POST':
              return 'PutObject';
            default:
              return 'Unknown';
          }
        },
        extractResource: (req) => {
          const pathParts = req.path.split('/').filter(Boolean);
          const bucket = pathParts[0] || 'unknown';
          const key = pathParts.slice(1).join('/');
          if (key) return `arn:aws:s3:::${bucket}/${key}`;
          return `arn:aws:s3:::${bucket}`;
        },
        extractConditionContext: (req) => ({
          's3:prefix': req.query?.prefix || '',
          's3:delimiter': req.query?.delimiter || ''
        }),
        formatError: (res, code, message) => {
          res.status(403).set('Content-Type', 'application/xml').send(
            `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`
          );
        }
      });

      // Set middleware on the S3 server so it's applied before routes
      this.server.iamMiddleware = middleware;
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
      bucketsCount: this.simulator?.getBucketsCount() || 0,
      objectsCount: this.simulator?.getTotalObjectsCount() || 0
    };
  }

  getSimulator() {
    return this.simulator;
  }

  getServer() {
    return this.server;
  }
}

module.exports = S3Service;