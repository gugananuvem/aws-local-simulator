/**
 * DynamoDB Service - Ponto de entrada
 * Exporta o serviço principal e seus componentes
 */

const DynamoDBServer = require('./server');
const DynamoDBSimulator = require('./simulator');
const LocalStore = require('../../utils/local-store');

class DynamoDBService {
  constructor(config) {
    this.config = config;
    this.name = 'dynamodb';
    this.port = config.ports.dynamodb;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando DynamoDB Service na porta ${this.port}...`);
    
    // Cria o simulador
    this.simulator = new DynamoDBSimulator(this.config);
    
    // Cria o servidor HTTP
    this.server = new DynamoDBServer(this.port, this.config);
    this.server.simulator = this.simulator;
    
    await this.server.initialize();
    
    logger.debug('DynamoDB Service inicializado');
  }

  injectDependencies(server) {
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.audit.setTrail(ct.simulator);
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
      tablesCount: this.simulator?.getTablesCount() || 0,
      itemsCount: this.simulator?.getTotalItems() || 0
    };
  }

  getSimulator() {
    return this.simulator;
  }

  getServer() {
    return this.server;
  }
}

module.exports = DynamoDBService;