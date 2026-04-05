'use strict';

/**
 * @fileoverview AWS Config Service
 * Porta padrão: 4013
 */

const http = require('http');
const path = require('path');
const { ConfigSimulator } = require('./simulador');
const { createConfigServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class ConfigService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'config';
    this.port = config?.ports?.config || config?.services?.config?.port || 4013;
    this.store = null;
    this.simulator = null;
    this._server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando AWS Config Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'config'));
    this.simulator = new ConfigSimulator(this.config, this.store, this.logger);
    await this.simulator.load();
    this.logger.debug('AWS Config Service inicializado');
  }

  injectDependencies(server) {
    if (!server) return;
    const s3 = server.getService('s3');
    if (s3?.simulator) this.simulator.s3Simulator = s3.simulator;
    const sns = server.getService('sns');
    if (sns?.simulator) this.simulator.snsSimulator = sns.simulator;
    const lambda = server.getService('lambda');
    if (lambda?.simulator) this.simulator.lambdaSimulator = lambda.simulator;
    const dynamo = server.getService('dynamodb');
    if (dynamo?.simulator) this.simulator.dynamoSimulator = dynamo.simulator;
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.cloudtrailSimulator = ct.simulator;
  }

  async start() {
    if (this.isRunning) return;
    const { handler } = createConfigServer(this.simulator, this.logger);
    this._server = http.createServer((req, res) => {
      handler(req, res).catch(err => {
        this.logger.error('[Config] Unhandled error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/x-amz-json-1.1' });
          res.end(JSON.stringify({ __type: 'InternalFailure', message: err.message }));
        }
      });
    });
    return new Promise((resolve, reject) => {
      this._server.listen(this.port, '0.0.0.0', (err) => {
        if (err) return reject(err);
        this.isRunning = true;
        this.logger.debug(`AWS Config rodando na porta ${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    if (!this.isRunning || !this._server) return;
    await new Promise((resolve) => this._server.close(resolve));
    this.simulator._stopRecording?.();
    this._server = null;
    this.isRunning = false;
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

module.exports = { ConfigService };
