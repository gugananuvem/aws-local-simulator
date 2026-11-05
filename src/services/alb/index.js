/**
 * ALB Service - Ponto de entrada
 */

const ALBServer = require('./server');
const ALBSimulator = require('./simulator');

class ALBService {
  constructor(config) {
    this.config = config;
    this.name = 'alb';
    this.port = config.ports.alb || 4021;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando ALB Service na porta ${this.port}...`);

    this.simulator = new ALBSimulator(this.config.alb || {});
    await this.simulator.initialize();

    this.server = new ALBServer(this.port, this.config);
    this.server.simulator = this.simulator;

    await this.server.initialize();

    logger.debug('ALB Service inicializado');
  }

  injectDependencies(server) {
    // Aqui você pode injetar dependências de outros serviços se necessário
    // Por exemplo, integração com EC2 para health checks
  }

  async start() {
    const logger = require('../../utils/logger');

    if (this.isRunning) {
      logger.warn('ALB Service já está em execução');
      return;
    }

    try {
      await this.server.start();
      this.isRunning = true;
      logger.info('ALB Service iniciado com sucesso');
    } catch (error) {
      logger.error(`Erro ao iniciar ALB Service: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    const logger = require('../../utils/logger');

    if (!this.isRunning) {
      logger.warn('ALB Service não está em execução');
      return;
    }

    try {
      await this.server.stop();
      this.isRunning = false;
      logger.info('ALB Service parado com sucesso');
    } catch (error) {
      logger.error(`Erro ao parar ALB Service: ${error.message}`);
      throw error;
    }
  }

  getSimulator() {
    return this.simulator;
  }

  getStatus() {
    const resources = this.simulator.getAllResources();
    const totalTargets = resources.targetGroups.reduce(
      (sum, tg) => sum + tg.Targets.length,
      0
    );
    const healthyTargets = resources.targetGroups.reduce((sum, tg) => {
      return sum + tg.Targets.filter(t => t.HealthState === 'healthy').length;
    }, 0);

    return {
      name: this.name,
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      resources: {
        loadBalancersCount: resources.loadBalancers.length,
        targetGroupsCount: resources.targetGroups.length,
        totalTargets,
        healthyTargets,
        unhealthyTargets: totalTargets - healthyTargets
      }
    };
  }
}

module.exports = ALBService;
