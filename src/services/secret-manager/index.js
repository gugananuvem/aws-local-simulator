'use strict';

/**
 * @fileoverview Secrets Manager Service
 * Porta padrão: 4001
 */

const http = require('http');
const path = require('path');
const { SecretManagerSimulator } = require('./simulator');
const { SecretManagerServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class SecretManagerService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'secret-manager';
    this.port = config?.ports?.secretManager || config?.services?.secretManager?.port || 4001;
    this.store = null;
    this.simulator = null;
    this.httpServer = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando Secrets Manager Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'secret-manager'));
    this.simulator = new SecretManagerSimulator(this.store, this.logger, this.config);
    await this.simulator.initialize();
    this.app = new SecretManagerServer(this.simulator, this.logger, this.config).getApp();
    this.logger.debug('Secrets Manager Service inicializado');
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
        this.logger.debug(`Secrets Manager rodando na porta ${this.port}`);
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
      secrets: this.simulator?.secrets.size || 0,
    };
  }

  getSimulator() { return this.simulator; }
}

module.exports = { SecretManagerService };
