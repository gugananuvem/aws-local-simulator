'use strict';

/**
 * @fileoverview EventBridge Service — entry point
 * Porta padrão: 4010
 */

const http = require('http');
const path = require('path');
const { EventBridgeSimulator } = require('./simulator');
const { createEventBridgeServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class EventBridgeService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'eventbridge';
    this.port = config?.ports?.eventbridge || config?.services?.eventbridge?.port || 4010;
    this.store = null;
    this.simulator = null;
    this.app = null;
    this.server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando EventBridge Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'eventbridge'));
    this.simulator = new EventBridgeSimulator(this.config, this.store, this.logger);
    this.app = createEventBridgeServer(this.simulator, this.config, this.logger);
    this.logger.debug('EventBridge Service inicializado');
  }

  injectDependencies(server) {
    if (!server) return;
    const lambda = server.getService('lambda');
    if (lambda) this.simulator.setLambdaService(lambda);
    const sqs = server.getService('sqs');
    if (sqs) this.simulator.setSqsService(sqs);
    const sns = server.getService('sns');
    if (sns) this.simulator.setSnsService(sns);
  }

  async start() {
    if (this.isRunning) return;
    await this.store.ensureDir();
    await this.simulator.load();

    // Inicia features com runtime
    try {
      if (this.simulator.features?.scheduler?.start) {
        this.simulator.features.scheduler.start();
      }
    } catch (err) {
      this.logger.warn('EventBridge', `Scheduler não iniciado: ${err.message}`);
    }

    try {
      if (this.simulator.features?.pipes?.start) {
        this.simulator.features.pipes.start();
      }
    } catch (err) {
      this.logger.warn('EventBridge', `Pipes polling não iniciado: ${err.message}`);
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);
      this.server.on('error', reject);
      this.server.listen(this.port, () => {
        this.isRunning = true;
        this.logger.debug(`EventBridge rodando na porta ${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    if (!this.isRunning || !this.server) return;

    try {
      if (this.simulator.features?.scheduler?.stop) {
        this.simulator.features.scheduler.stop();
      }
    } catch (err) {
      this.logger.warn('EventBridge', `Erro ao parar scheduler: ${err.message}`);
    }

    try {
      if (this.simulator.features?.pipes?.reset) {
        // reset apenas limpa em memória; não apaga dados
      }
    } catch (err) {
      // ignore
    }

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
      buses: this.simulator?.buses.size || 0,
      rules: this.simulator?.rules.size || 0,
    };
  }

  getSimulator() { return this.simulator; }
}

module.exports = { EventBridgeService };
