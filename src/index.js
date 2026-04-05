/**
 * AWS Local Simulator - Entry Point Principal
 */

const Server = require('./server');
const { loadConfig } = require('./config/config-loader');
const logger = require('./utils/logger');

// Exporta serviços para uso programático
const DynamoDBService = require('./services/dynamodb');
const S3Service = require('./services/s3');
const SQSService = require('./services/sqs');
const LambdaService = require('./services/lambda');
const { SNSService } = require('./services/sns');
const { EventBridgeService } = require('./services/eventbridge');
const { CloudWatchService } = require('./services/cloudwatch');
const CloudTrailService = require('./services/cloudtrail');
const { KMSService } = require('./services/kms');
const CloudFormationService = require('./services/cloudformation');
const { XRayService } = require('./services/xray');
const { SecretManagerService } = require('./services/secret-manager');
const { ParameterStoreService } = require('./services/parameter-store');
const { ConfigService } = require('./services/config');

// Exporta utilitários
const LocalStore = require('./utils/local-store');
const HandlerLoader = require('./services/lambda/handler-loader');
const RouteRegistry = require('./services/lambda/route-registry');

class AWSLocalSimulator {
  constructor(options = {}) {
    this.options = options;
    this.server = null;
    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) {
      logger.warn('Simulador já está rodando');
      return this;
    }

    try {
      const config = await loadConfig(this.options.configPath);
      this.server = new Server(config);
      await this.server.start();
      this.isRunning = true;
      logger.success('✅ AWS Local Simulator iniciado com sucesso');
      return this;
    } catch (error) {
      logger.error('❌ Erro ao iniciar simulador:', error);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning || !this.server) {
      logger.warn('Simulador não está rodando');
      return this;
    }

    try {
      await this.server.stop();
      this.isRunning = false;
      logger.info('🛑 AWS Local Simulator parado');
      return this;
    } catch (error) {
      logger.error('❌ Erro ao parar simulador:', error);
      throw error;
    }
  }

  async restart() {
    await this.stop();
    await this.start();
    return this;
  }

  async reset() {
    if (!this.server) {
      throw new Error('Simulador não iniciado');
    }
    await this.server.reset();
    logger.success('🗑️ Todos os dados foram resetados');
    return this;
  }

  getStatus() {
    if (!this.server) {
      return { running: false };
    }
    return {
      running: this.isRunning,
      services: this.server.getStatus()
    };
  }

  getService(serviceName) {
    if (!this.server) {
      return null;
    }
    return this.server.getService(serviceName);
  }

  // Métodos de conveniência
  getDynamoDB() {
    return this.getService('dynamodb')?.getSimulator();
  }

  getS3() {
    return this.getService('s3')?.getSimulator();
  }

  getSQS() {
    return this.getService('sqs')?.getSimulator();
  }

  getLambda() {
    return this.getService('lambda')?.getSimulator();
  }
}

// Exporta classes e utilitários
module.exports = {
  AWSLocalSimulator,
  Server,
  DynamoDBService,
  S3Service,
  SQSService,
  LambdaService,
  SNSService,
  EventBridgeService,
  CloudWatchService,
  CloudTrailService,
  KMSService,
  CloudFormationService,
  XRayService,
  SecretManagerService,
  ParameterStoreService,
  ConfigService,
  LocalStore,
  HandlerLoader,
  RouteRegistry
};

// Exporta também como default para ES Modules compatibilidade
module.exports.default = AWSLocalSimulator;