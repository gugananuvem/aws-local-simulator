'use strict';

/**
 * @fileoverview X-Ray Service
 * Porta padrão: 4015
 */

const path = require('path');
const { XRaySimulator } = require('./simulador');
const { createXRayServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class XRayService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'xray';
    this.port = config?.ports?.xray || config?.services?.xray?.port || 4015;
    this.store = null;
    this.simulator = null;
    this._server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando X-Ray Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'xray'));
    this.simulator = new XRaySimulator(this.config, this.store, this.logger);
    await this.simulator.load();
    this.logger.debug('X-Ray Service inicializado');
  }

  injectDependencies(server) {
    if (!server) return;
    const cw = server.getService('cloudwatch');
    if (cw?.simulator) this.simulator.cloudwatchSimulator = cw.simulator;
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.cloudtrailSimulator = ct.simulator;
  }

  async start() {
    if (this.isRunning) return;
    const httpServer = createXRayServer(this.simulator);
    return new Promise((resolve, reject) => {
      httpServer.listen(this.port, () => {
        this._server = httpServer;
        this.isRunning = true;
        this.logger.debug(`X-Ray rodando na porta ${this.port}`);
        resolve();
      });
      httpServer.on('error', reject);
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
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      ...this.simulator?.getStatus(),
    };
  }

  getSimulator() { return this.simulator; }
}

module.exports = { XRayService };
