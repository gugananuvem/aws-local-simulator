/**
 * OpenSearch Service - Ponto de entrada
 */

const OpenSearchServer = require('./server');
const OpenSearchSimulator = require('./simulator');

class OpenSearchService {
  constructor(config) {
    this.config = config;
    this.name = 'opensearch';
    this.port = config.ports.opensearch || 9200;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando OpenSearch Service na porta ${this.port}...`);

    this.simulator = new OpenSearchSimulator(this.config);
    await this.simulator.initialize();

    this.server = new OpenSearchServer(this.port, this.config);
    this.server.simulator = this.simulator;

    await this.server.initialize();

    logger.debug('OpenSearch Service inicializado');
  }

  injectDependencies(server) {
    // Aqui você pode injetar dependências de outros serviços se necessário
  }

  async start() {
    const logger = require('../../utils/logger');

    if (this.isRunning) {
      logger.warn('OpenSearch Service já está em execução');
      return;
    }

    try {
      await this.server.start();
      this.isRunning = true;
      logger.info('OpenSearch Service iniciado com sucesso');
    } catch (error) {
      logger.error(`Erro ao iniciar OpenSearch Service: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    const logger = require('../../utils/logger');

    if (!this.isRunning) {
      logger.warn('OpenSearch Service não está em execução');
      return;
    }

    try {
      await this.server.stop();
      this.isRunning = false;
      logger.info('OpenSearch Service parado com sucesso');
    } catch (error) {
      logger.error(`Erro ao parar OpenSearch Service: ${error.message}`);
      throw error;
    }
  }

  async reset() {
    const logger = require('../../utils/logger');
    try {
      await this.simulator.reset();
      logger.info('OpenSearch Service resetado');
    } catch (error) {
      logger.error(`Erro ao resetar OpenSearch Service: ${error.message}`);
      throw error;
    }
  }

  getSimulator() {
    return this.simulator;
  }

  getStatus() {
    const stats = this.simulator?.getClusterStats() || { indices: 0, docs: 0, size_mb: 0 };

    return {
      name: this.name,
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      resources: {
        indicesCount: stats.indices,
        docsCount: stats.docs,
        sizeMb: stats.size_mb
      }
    };
  }
}

module.exports = OpenSearchService;
