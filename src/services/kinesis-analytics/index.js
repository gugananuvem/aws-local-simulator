/**
 * Kinesis Data Analytics Service - Ponto de entrada
 */

const KinesisAnalyticsServer = require('./server');
const KinesisAnalyticsSimulator = require('./simulator');

class KinesisAnalyticsService {
  constructor(config) {
    this.config = config;
    this.name = 'kinesis-analytics';
    this.port = config.ports['kinesis-analytics'] || 4570;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando Kinesis Analytics Service na porta ${this.port}...`);

    this.simulator = new KinesisAnalyticsSimulator(this.config);
    await this.simulator.initialize();

    this.server = new KinesisAnalyticsServer(this.port, this.config);
    this.server.simulator = this.simulator;

    await this.server.initialize();

    logger.debug('Kinesis Analytics Service inicializado');
  }

  injectDependencies(server) {
    // Aqui você pode injetar dependências de outros serviços se necessário
  }

  async start() {
    const logger = require('../../utils/logger');

    if (this.isRunning) {
      logger.warn('Kinesis Analytics Service já está em execução');
      return;
    }

    try {
      await this.server.start();
      this.isRunning = true;
      logger.info('Kinesis Analytics Service iniciado com sucesso');
    } catch (error) {
      logger.error(`Erro ao iniciar Kinesis Analytics Service: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    const logger = require('../../utils/logger');

    if (!this.isRunning) {
      logger.warn('Kinesis Analytics Service não está em execução');
      return;
    }

    try {
      await this.server.stop();
      this.isRunning = false;
      logger.info('Kinesis Analytics Service parado com sucesso');
    } catch (error) {
      logger.error(`Erro ao parar Kinesis Analytics Service: ${error.message}`);
      throw error;
    }
  }

  async reset() {
    const logger = require('../../utils/logger');
    try {
      await this.simulator.reset();
      logger.info('Kinesis Analytics Service resetado');
    } catch (error) {
      logger.error(`Erro ao resetar Kinesis Analytics Service: ${error.message}`);
      throw error;
    }
  }

  getSimulator() {
    return this.simulator;
  }

  getStatus() {
    const stats = this.simulator?.getStats() || { applicationsCount: 0, totalInputs: 0, totalOutputs: 0 };

    return {
      name: this.name,
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      resources: {
        applicationsCount: stats.applicationsCount,
        totalInputs: stats.totalInputs,
        totalOutputs: stats.totalOutputs
      }
    };
  }
}

module.exports = KinesisAnalyticsService;
