'use strict';

/**
 * @fileoverview CloudTrail Service
 * Porta padrão: 4012
 */

const http = require('http');
const path = require('path');
const { CloudTrailSimulator } = require('./simulador');
const { createCloudTrailServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class CloudTrailService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'cloudtrail';
    this.port = config?.ports?.cloudtrail || config?.services?.cloudtrail?.port || 4012;
    this.store = null;
    this.simulator = null;
    this._server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando CloudTrail Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'cloudtrail'));
    this.simulator = new CloudTrailSimulator(this.config, this.store, this.logger);
    await this.simulator.load();
    this.logger.debug('CloudTrail Service inicializado');
  }

  injectDependencies(server) {
    if (!server) return;
    const s3 = server.getService('s3');
    if (s3?.simulator) this.simulator.s3Simulator = s3.simulator;
    const cw = server.getService('cloudwatch');
    if (cw?.simulator) this.simulator.cloudwatchSimulator = cw.simulator;
  }

  async start() {
    if (this.isRunning) return;
    const app = createCloudTrailServer(this.simulator, this.logger);
    return new Promise((resolve, reject) => {
      this._server = http.createServer(app);
      this._server.listen(this.port, () => {
        this.isRunning = true;
        this.logger.debug(`CloudTrail rodando na porta ${this.port}`);
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

module.exports = CloudTrailService;
