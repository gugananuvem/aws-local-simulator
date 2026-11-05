/**
 * Kinesis Data Streams Service - Ponto de entrada
 */

const KinesisDataStreamsServer = require('./server');
const KinesisDataStreamsSimulator = require('./simulator');

class KinesisDataStreamsService {
  constructor(config) {
    this.config = config;
    this.name = 'kinesis-data-streams';
    this.port = config.ports['kinesis-data-streams'] || 4568;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando Kinesis Data Streams Service na porta ${this.port}...`);

    this.simulator = new KinesisDataStreamsSimulator(this.config);
    await this.simulator.initialize();

    this.server = new KinesisDataStreamsServer(this.port, this.config);
    this.server.simulator = this.simulator;

    await this.server.initialize();

    logger.debug('Kinesis Data Streams Service inicializado');
  }

  injectDependencies(server) {
    // Aqui você pode injetar dependências de outros serviços se necessário
  }

  async start() {
    const logger = require('../../utils/logger');

    if (this.isRunning) {
      logger.warn('Kinesis Data Streams Service já está em execução');
      return;
    }

    try {
      await this.server.start();
      this.isRunning = true;
      logger.info('Kinesis Data Streams Service iniciado com sucesso');
    } catch (error) {
      logger.error(`Erro ao iniciar Kinesis Data Streams Service: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    const logger = require('../../utils/logger');

    if (!this.isRunning) {
      logger.warn('Kinesis Data Streams Service não está em execução');
      return;
    }

    try {
      await this.server.stop();
      this.isRunning = false;
      logger.info('Kinesis Data Streams Service parado com sucesso');
    } catch (error) {
      logger.error(`Erro ao parar Kinesis Data Streams Service: ${error.message}`);
      throw error;
    }
  }

  async reset() {
    const logger = require('../../utils/logger');
    try {
      await this.simulator.reset();
      logger.info('Kinesis Data Streams Service resetado');
    } catch (error) {
      logger.error(`Erro ao resetar Kinesis Data Streams Service: ${error.message}`);
      throw error;
    }
  }

  getSimulator() {
    return this.simulator;
  }

  getStatus() {
    const stats = this.simulator?.getStats() || { streamsCount: 0, consumersCount: 0, totalRecords: 0 };

    return {
      name: this.name,
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      resources: {
        streamsCount: stats.streamsCount,
        consumersCount: stats.consumersCount,
        totalRecords: stats.totalRecords,
        totalShards: stats.totalShards
      }
    };
  }
}

module.exports = KinesisDataStreamsService;
