const STSServer = require('./server');
const logger = require('../../utils/logger');

class STSService {
  constructor(config) {
    this.config = config;
    this.name = 'sts';
    this.port = config.ports.sts || 9326;
    this.server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.server = new STSServer(this.port, this.config);
    await this.server.initialize();
  }

  async start() {
    if (this.isRunning) return;
    await this.server.start();
    this.isRunning = true;
  }

  async stop() {
    if (!this.isRunning) return;
    await this.server.stop();
    this.isRunning = false;
  }

  async reset() {}

  getStatus() {
    return { running: this.isRunning, port: this.port, endpoint: `http://localhost:${this.port}` };
  }
}

module.exports = STSService;
