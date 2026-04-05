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