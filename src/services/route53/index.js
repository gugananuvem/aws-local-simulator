/**
 * Route53 Service
 */

const Route53Simulator = require('./simulator');
const Route53Server = require('./server');
const logger = require('../../utils/logger');

class Route53Service {
  constructor(config = {}) {
    this.name = 'route53';
    this.config = config;
    this.port = config.ports?.route53 || 4024;
    this.simulator = null;
    this.server = null;
  }

  async initialize() {
    this.simulator = new Route53Simulator(this.config);
    await this.simulator.initialize();
  }

  injectDependencies(server) {
    // Para possíveis integrações futuras
  }

  async start() {
    try {
      const port = this.port;
      this.server = new Route53Server(port, this.config);
      await this.server.initialize(this.simulator);
      await this.server.start();
      return true;
    } catch (error) {
      logger.error(`Route53 Service error: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    if (this.server) {
      await this.server.stop();
    }
    if (this.simulator) {
      this.simulator.stopHealthCheckInterval();
    }
  }

  getStatus() {
    return {
      name: 'route53',
      port: this.port,
      running: this.server ? true : false,
      endpoint: `http://localhost:${this.port}`,
    };
  }

  async reset() {
    if (this.simulator) {
      this.simulator.hostedZones.clear();
      this.simulator.resourceRecords.clear();
      this.simulator.healthChecks.clear();
      this.simulator.persistData();
    }
  }
}

module.exports = Route53Service;
