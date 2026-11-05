/**
 * Kinesis Data Firehose Service - Ponto de entrada
 */

const KinesisFirehoseServer = require('./server');
const KinesisFirehoseSimulator = require('./simulator');

class KinesisFirehoseService {
  constructor(config) {
    this.config = config;
    this.name = 'kinesis-firehose';
    this.port = config.ports['kinesis-firehose'] || 4569;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando Kinesis Firehose Service na porta ${this.port}...`);

    this.simulator = new KinesisFirehoseSimulator(this.config);
    await this.simulator.initialize();

    this.server = new KinesisFirehoseServer(this.port, this.config);
    this.server.simulator = this.simulator;

    await this.server.initialize();

    logger.debug('Kinesis Firehose Service inicializado');
  }

  injectDependencies(server) {
    // Aqui você pode injetar dependências de outros serviços se necessário
  }

  async start() {
    const logger = require('../../utils/logger');

    if (this.isRunning) {
      logger.warn('Kinesis Firehose Service já está em execução');
      return;
    }

    try {
      await this.server.start();
      this.isRunning = true;
      logger.info('Kinesis Firehose Service iniciado com sucesso');
    } catch (error) {
      logger.error(`Erro ao iniciar Kinesis Firehose Service: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    const logger = require('../../utils/logger');

    if (!this.isRunning) {
      logger.warn('Kinesis Firehose Service não está em execução');
      return;
    }

    try {
      await this.server.stop();
      this.isRunning = false;
      logger.info('Kinesis Firehose Service parado com sucesso');
    } catch (error) {
      logger.error(`Erro ao parar Kinesis Firehose Service: ${error.message}`);
      throw error;
    }
  }

  async reset() {
    const logger = require('../../utils/logger');
    try {
      await this.simulator.reset();
      logger.info('Kinesis Firehose Service resetado');
    } catch (error) {
      logger.error(`Erro ao resetar Kinesis Firehose Service: ${error.message}`);
      throw error;
    }
  }

  getSimulator() {
    return this.simulator;
  }

  getStatus() {
    const stats = this.simulator?.getStats() || { deliveryStreamsCount: 0, totalRecords: 0, totalDeliveredRecords: 0 };

    return {
      name: this.name,
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      resources: {
        deliveryStreamsCount: stats.deliveryStreamsCount,
        totalRecords: stats.totalRecords,
        totalDeliveredRecords: stats.totalDeliveredRecords,
        totalFailedRecords: stats.totalFailedRecords
      }
    };
  }
}

module.exports = KinesisFirehoseService;
