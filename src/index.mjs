/**
 * AWS Local Simulator - ES Module Entry Point
 */

import Server from './server.js';
import { loadConfig } from './config/config-loader.js';
import logger from './utils/logger.js';
import DynamoDBService from './services/dynamodb/index.js';
import S3Service from './services/s3/index.js';
import SQSService from './services/sqs/index.js';
import LambdaService from './services/lambda/index.js';
import SNSService from './services/sns/index.js';
import EventBridgeService from './services/eventbridge/index.js';
import LocalStore from './utils/local-store.js';
import HandlerLoader from './services/lambda/handler-loader.js';
import RouteRegistry from './services/lambda/route-registry.js';

export class AWSLocalSimulator {
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
export {
  Server,
  DynamoDBService,
  S3Service,
  SQSService,
  LambdaService,
  SNSService,
  EventBridgeService,
  LocalStore,
  HandlerLoader,
  RouteRegistry
};

export default AWSLocalSimulator;