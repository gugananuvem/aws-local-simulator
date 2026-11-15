/**
 * ACM (AWS Certificate Manager) Service
 */

const ACMSimulator = require('./simulator');
const ACMServer = require('./server');
const logger = require('../../utils/logger');

class ACMService {
  constructor(config = {}) {
    this.name = 'acm';
    this.config = config;
    this.port = config.ports?.acm || 4025;
    this.simulator = null;
    this.server = null;
  }

  async initialize() {
    this.simulator = new ACMSimulator(this.config);
    await this.simulator.initialize();
  }

  injectDependencies(server) {
    // Para possíveis integrações futuras
  }

  async start() {
    try {
      const port = this.port;
      this.server = new ACMServer(port, this.config);
      await this.server.initialize(this.simulator);
      await this.server.start();
      return true;
    } catch (error) {
      logger.error(`ACM Service error: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    if (this.server) {
      await this.server.stop();
    }
    if (this.simulator) {
      this.simulator.stopRenewalCheckInterval();
    }
  }

  getStatus() {
    return {
      name: 'acm',
      port: this.port,
      running: this.server ? true : false,
      endpoint: `http://localhost:${this.port}`,
    };
  }

  async reset() {
    if (this.simulator) {
      this.simulator.certificates.clear();
      this.simulator.certificatesByDomain.clear();
      this.simulator.persistData();
    }
  }
}

module.exports = ACMService;
