'use strict';

/**
 * @fileoverview CloudWatch Service
 * Porta padrão: 4011
 */

const http = require('http');
const path = require('path');
const { CloudWatchSimulator } = require('./simulador');
const { createCloudWatchServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class CloudWatchService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'cloudwatch';
    this.port = config?.ports?.cloudwatch || config?.services?.cloudwatch?.port || 4011;
    this.store = null;
    this.simulator = null;
    this._server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando CloudWatch Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'cloudwatch'));
    this.simulator = new CloudWatchSimulator(this.config, this.store, this.logger);
    await this.simulator.load();
    this.logger.debug('CloudWatch Service inicializado');
  }

  injectDependencies(server) {
    if (!server) return;
    const sns = server.getService('sns');
    if (sns?.simulator) this.simulator.snsSimulator = sns.simulator;
    const lambda = server.getService('lambda');
    if (lambda?.simulator) this.simulator.lambdaSimulator = lambda.simulator;
  }

  async start() {
    if (this.isRunning) return;
    const app = createCloudWatchServer(this.simulator, this.logger);
    return new Promise((resolve, reject) => {
      this._server = http.createServer(app);
      this._server.listen(this.port, () => {
        this.isRunning = true;
        this.logger.debug(`CloudWatch rodando na porta ${this.port}`);
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
    this.simulator.reset();
    await this.simulator.save();
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      ...this.simulator?.getStatus(),
    };
  }

  getSimulator() { return this.simulator; }
}

module.exports = { CloudWatchService };
