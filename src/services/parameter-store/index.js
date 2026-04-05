'use strict';

/**
 * @fileoverview Parameter Store Service
 * Porta padrão: 4002
 */

const http = require('http');
const path = require('path');
const { ParameterStoreSimulator } = require('./simulator');
const { ParameterStoreServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class ParameterStoreService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'parameter-store';
    this.port = config?.ports?.parameterStore || config?.services?.parameterStore?.port || 4002;
    this.store = null;
    this.simulator = null;
    this.httpServer = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando Parameter Store Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'parameter-store'));
    this.simulator = new ParameterStoreSimulator(this.store, this.logger, this.config);
    await this.simulator.initialize();
    this.app = new ParameterStoreServer(this.simulator, this.logger, this.config).getApp();
    this.logger.debug('Parameter Store Service inicializado');
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
        this.logger.debug(`Parameter Store rodando na porta ${this.port}`);
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
      parameters: this.simulator?.parameters.size || 0,
    };
  }

  getSimulator() { return this.simulator; }
}

module.exports = { ParameterStoreService };
