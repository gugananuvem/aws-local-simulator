const IAMSimulator = require('./simulator');
const logger = require('../../utils/logger');

class IAMService {
  constructor(config, dependencies) {
    this.config = config;
    this.dependencies = dependencies || {};
    this.name = 'iam';
    this.port = config?.ports?.iam || 4003;
    this.simulator = null;
    this.server = null;
    this.httpServer = null;
    this.isRunning = false;
  }

  async initialize() {
    this.simulator = new IAMSimulator(this.config);
    await this.simulator.initialize();

    const IAMServer = require('./server');
    this.server = new IAMServer(this.simulator, logger, this.config);
  }

  async start() {
    if (this.isRunning) return;

    this.httpServer = this.server.getApp().listen(this.port);
    logger.info(`🔐 IAM rodando em http://localhost:${this.port}`);
    this.isRunning = true;
  }

  async stop() {
    if (!this.isRunning) return;

    await new Promise((resolve, reject) => {
      this.httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.isRunning = false;
  }

  async reset() {
    await this.simulator.reset();
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`
    };
  }

  getSimulator() {
    return this.simulator;
  }

  injectDependencies(server) {
    this.stsService = server.getService('sts');
  }
}

module.exports = IAMService;
