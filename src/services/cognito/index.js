/**
 * Cognito Service - Simulador de Amazon Cognito
 * Suporta: User Pools, Identity Pools, Authentication, User Management
 */

const CognitoServer = require('./server');
const CognitoSimulator = require('./simulator');

class CognitoService {
  constructor(config) {
    this.config = config;
    this.name = 'cognito';
    this.port = config.ports.cognito || 9229;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando Cognito Service na porta ${this.port}...`);
    
    this.simulator = new CognitoSimulator(this.config);
    await this.simulator.initialize();
    
    this.server = new CognitoServer(this.port, this.config);
    this.server.simulator = this.simulator;
    
    await this.server.initialize();
    
    logger.debug('Cognito Service inicializado');
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

  async reset() {
    await this.simulator.reset();
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      userPoolsCount: this.simulator?.getUserPoolsCount() || 0,
      usersCount: this.simulator?.getTotalUsersCount() || 0,
      identityPoolsCount: this.simulator?.getIdentityPoolsCount() || 0
    };
  }

  getSimulator() {
    return this.simulator;
  }
}

module.exports = CognitoService;