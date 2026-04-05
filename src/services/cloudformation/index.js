'use strict';

/**
 * @fileoverview CloudFormation Service
 * Porta padrão: 4580
 */

const http = require('http');
const path = require('path');
const { CloudFormationSimulator } = require('./simulador');
const { createCloudFormationServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class CloudFormationService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'cloudformation';
    this.port = config?.ports?.cloudformation || config?.services?.cloudformation?.port || 4580;
    this.store = null;
    this.simulator = null;
    this._server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando CloudFormation Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'cloudformation'));
    this.simulator = new CloudFormationSimulator(this.config, this.store, this.logger);
    await this.simulator.load();
    this.logger.debug('CloudFormation Service inicializado');
  }

  async start() {
    if (this.isRunning) return;
    const app = createCloudFormationServer(this.simulator, this.config, this.logger);
    this._server = http.createServer(app);
    return new Promise((resolve, reject) => {
      this._server.listen(this.port, () => {
        this.isRunning = true;
        this.logger.debug(`CloudFormation rodando na porta ${this.port}`);
        resolve();
      });
      this._server.once('error', reject);
    });
  }

  async stop() {
    if (!this.isRunning || !this._server) return;
    return new Promise((resolve, reject) => {
      this._server.close((err) => {
        if (err) return reject(err);
        this.isRunning = false;
        resolve();
      });
    });
  }

  async reset() {
    await this.simulator.reset();
  }

  getStatus() {
    const stats = this.simulator?.getStats() || {};
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      ...stats,
    };
  }

  getSimulator() { return this.simulator; }

  async createStack(params) { return this.simulator.createStack(params); }
  describeStacks(params) { return this.simulator.describeStacks(params); }
}

module.exports = CloudFormationService;
