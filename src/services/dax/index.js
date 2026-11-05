/**
 * DAX Service - Ponto de entrada
 */
const DAXServer = require('./server');
const DAXSimulator = require('./simulator');

class DAXService {
  constructor(config) {
    this.config = config;
    this.name = 'dax';
    this.port = config.ports?.dax || 8111;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando DAX Service na porta ${this.port}...`);
    
    this.simulator = new DAXSimulator(this.config);
    await this.simulator.initialize();

    this.server = new DAXServer(this.port, this.config);
    this.server.simulator = this.simulator;
    
    await this.server.initialize();
    
    logger.debug('DAX Service inicializado');
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
      clustersCount: this.simulator?.getClustersCount() || 0
    };
  }

  getSimulator() {
    return this.simulator;
  }

  getServer() {
    return this.server;
  }
}

module.exports = DAXService;
