'use strict';

const http = require('http');
const path = require('path');
const { AthenaSimulator } = require('./simulator');
const { createAthenaServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class AthenaService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'athena';
    this.port = config?.ports?.athena || 4599;
    this.store = null;
    this.simulator = null;
    this._server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando Athena Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'athena'));
    this.simulator = new AthenaSimulator(this.config, this.store, this.logger);
    await this.simulator.initialize();
    this.app = createAthenaServer(this.simulator, this.logger);
    this.logger.debug('Athena Service inicializado');
  }

  injectDependencies(server) {
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.audit.setTrail(ct.simulator);
  }

  async start() {
    if (this.isRunning) return;
    return new Promise((resolve, reject) => {
      this._server = http.createServer(this.app);
      this._server.listen(this.port, () => {
        this.isRunning = true;
        this.logger.info(`🔍 Athena rodando em http://localhost:${this.port}`);
        resolve();
      });
      this._server.on('error', reject);
    });
  }

  async stop() {
    if (!this.isRunning || !this._server) return;
    return new Promise((resolve) => {
      this._server.close(() => {
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
      ...this.simulator?.getStats(),
    };
  }

  getSimulator() { return this.simulator; }
}

module.exports = { AthenaService };
