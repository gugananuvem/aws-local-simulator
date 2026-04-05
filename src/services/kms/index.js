'use strict';

const http = require('http');
const path = require('path');
const { KMSSimulator } = require('./simulator');
const { KMSServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class KMSService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'kms';
    this.port = config?.ports?.kms || config?.services?.kms?.port || 4000;
    this.store = null;
    this.simulator = null;
    this.httpServer = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando KMS Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'kms'));
    this.simulator = new KMSSimulator(this.store, this.logger, this.config);
    await this.simulator.initialize();
    this.app = new KMSServer(this.simulator, this.logger, this.config).getApp();
    this.logger.debug('KMS Service inicializado');
  }

  injectDependencies(server) {
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.audit.setTrail(ct.simulator);
  }

  async start() {
    if (this.isRunning) return;
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(this.app);
      this.httpServer.listen(this.port, () => {
        this.isRunning = true;
        this.logger.debug(`KMS rodando na porta ${this.port}`);
        resolve();
      });
      this.httpServer.on('error', reject);
    });
  }

  async stop() {
    if (!this.isRunning || !this.httpServer) return;
    return new Promise((resolve) => {
      this.httpServer.close(() => {
        this.isRunning = false;
        resolve();
      });
    });
  }

  async reset() {
    await this.simulator.reset();
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      keys: this.simulator?.keys.size || 0,
    };
  }

  getSimulator() { return this.simulator; }
}

module.exports = { KMSService };
