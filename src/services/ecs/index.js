/**
 * ECS Service - Simulador de Elastic Container Service
 * Suporta: Fargate, EC2 launch types, Tasks, Services
 */

const ECSServer = require('./server');
const ECSSimulator = require('./simulator');

class ECSService {
  constructor(config) {
    this.config = config;
    this.name = 'ecs';
    this.port = config.ports.ecs || 8080;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando ECS Service na porta ${this.port}...`);
    
    this.simulator = new ECSSimulator(this.config);
    await this.simulator.initialize();
    
    this.server = new ECSServer(this.port, this.config);
    this.server.simulator = this.simulator;
    
    await this.server.initialize();
    
    logger.debug('ECS Service inicializado');
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
      clustersCount: this.simulator?.getClustersCount() || 0,
      servicesCount: this.simulator?.getServicesCount() || 0,
      tasksCount: this.simulator?.getTasksCount() || 0
    };
  }

  getSimulator() {
    return this.simulator;
  }
}

module.exports = ECSService;