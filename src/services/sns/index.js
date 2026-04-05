'use strict';

/**
 * @fileoverview SNS Service — entry point
 * Porta padrão: 9911
 */

const http = require('http');
const path = require('path');
const { SNSSimulator } = require('./simulator');
const { createSNSServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class SNSService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'sns';
    this.port = config?.ports?.sns || config?.services?.sns?.port || 9911;
    this.store = null;
    this.simulator = null;
    this.app = null;
    this.server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando SNS Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'sns'));
    this.simulator = new SNSSimulator(this.config, this.store, this.logger);
    this.app = createSNSServer(this.simulator, this.config, this.logger);
    this.logger.debug('SNS Service inicializado');
  }

  injectDependencies(server) {
    if (!server) return;
    const lambda = server.getService('lambda');
    if (lambda) this.simulator.setLambdaService(lambda);
    const sqs = server.getService('sqs');
    if (sqs) this.simulator.setSqsService(sqs);
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.audit.setTrail(ct.simulator);
  }

  async start() {
    if (this.isRunning) return;
    await this.store.ensureDir();
    await this.simulator.load();
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);
      this.server.on('error', reject);
      this.server.listen(this.port, () => {
        this.isRunning = true;
        this.logger.debug(`SNS rodando na porta ${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    if (!this.isRunning || !this.server) return;
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
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
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      topics: this.simulator?.topics.size || 0,
      subscriptions: this.simulator?.subscriptions.size || 0,
    };
  }

  getSimulator() { return this.simulator; }
}

module.exports = { SNSService };
