/**
 * ASG Service - Ponto de entrada
 */

const ASGServer = require('./server');
const ASGSimulator = require('./simulator');

class ASGService {
  constructor(config) {
    this.config = config;
    this.name = 'asg';
    this.port = config.ports.asg || 4022;
    this.server = null;
    this.simulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando ASG Service na porta ${this.port}...`);

    this.simulator = new ASGSimulator(this.config.asg || {});
    await this.simulator.initialize();

    this.server = new ASGServer(this.port, this.config);
    this.server.simulator = this.simulator;

    await this.server.initialize();

    logger.debug('ASG Service inicializado');
  }

  injectDependencies(serverOrEc2Service, albService) {
    // O Server chama injectDependencies(this); resolvemos ec2/alb a partir dele.
    // Também aceita a forma antiga (ec2Service, albService) por compatibilidade.
    if (serverOrEc2Service && typeof serverOrEc2Service.getService === 'function') {
      this.simulator.injectDependencies(
        serverOrEc2Service.getService('ec2'),
        serverOrEc2Service.getService('alb')
      );
      return;
    }

    this.simulator.injectDependencies(serverOrEc2Service, albService);
  }

  async start() {
    const logger = require('../../utils/logger');

    if (this.isRunning) {
      logger.warn('ASG Service já está em execução');
      return;
    }

    try {
      await this.server.start();
      this.isRunning = true;
      logger.info('ASG Service iniciado com sucesso');
    } catch (error) {
      logger.error(`Erro ao iniciar ASG Service: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    const logger = require('../../utils/logger');

    if (!this.isRunning) {
      logger.warn('ASG Service não está em execução');
      return;
    }

    try {
      await this.server.stop();
      this.isRunning = false;
      logger.info('ASG Service parado com sucesso');
    } catch (error) {
      logger.error(`Erro ao parar ASG Service: ${error.message}`);
      throw error;
    }
  }

  getSimulator() {
    return this.simulator;
  }

  getStatus() {
    const resources = this.simulator.getAllResources();
    const totalInstances = resources.autoScalingGroups.reduce(
      (sum, asg) => sum + asg.Instances.length,
      0
    );

    return {
      name: this.name,
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      resources: {
        autoScalingGroupsCount: resources.autoScalingGroups.length,
        launchTemplatesCount: resources.launchTemplates.length,
        scalingPoliciesCount: resources.scalingPolicies.length,
        totalInstances: totalInstances
      }
    };
  }
}

module.exports = ASGService;
