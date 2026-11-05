/**
 * AWS Organizations & Control Tower Service - Ponto de entrada
 */

const OrganizationsServer = require('./server');
const OrganizationsSimulator = require('./simulator');
const ControlTowerSimulator = require('./control-tower-simulator');

class OrganizationsService {
  constructor(config) {
    this.config = config;
    this.name = 'organizations';
    this.port = config.ports.organizations || 4580;
    this.server = null;
    this.organizationsSimulator = null;
    this.controlTowerSimulator = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando Organizations Service na porta ${this.port}...`);

    // Inicializa simuladores
    this.organizationsSimulator = new OrganizationsSimulator(this.config);
    await this.organizationsSimulator.initialize();

    this.controlTowerSimulator = new ControlTowerSimulator(this.config, this.organizationsSimulator);
    await this.controlTowerSimulator.initialize();

    // Inicializa server
    this.server = new OrganizationsServer(this.port, this.config);
    this.server.organizationsSimulator = this.organizationsSimulator;
    this.server.controlTowerSimulator = this.controlTowerSimulator;

    await this.server.initialize();

    logger.debug('Organizations Service inicializado');
  }

  injectDependencies(server) {
    // Injetar dependências de outros serviços (IAM, VPC, EC2, etc)
  }

  async start() {
    const logger = require('../../utils/logger');

    if (this.isRunning) {
      logger.warn('Organizations Service já está em execução');
      return;
    }

    try {
      await this.server.start();
      this.isRunning = true;
      logger.info('Organizations Service iniciado com sucesso');
    } catch (error) {
      logger.error(`Erro ao iniciar Organizations Service: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    const logger = require('../../utils/logger');

    if (!this.isRunning) {
      logger.warn('Organizations Service não está em execução');
      return;
    }

    try {
      await this.server.stop();
      this.isRunning = false;
      logger.info('Organizations Service parado com sucesso');
    } catch (error) {
      logger.error(`Erro ao parar Organizations Service: ${error.message}`);
      throw error;
    }
  }

  async reset() {
    const logger = require('../../utils/logger');
    try {
      await this.organizationsSimulator.reset();
      await this.controlTowerSimulator.reset();
      logger.info('Organizations Service resetado');
    } catch (error) {
      logger.error(`Erro ao resetar Organizations Service: ${error.message}`);
      throw error;
    }
  }

  getStatus() {
    const orgStats = this.organizationsSimulator?.getStats() || {};
    const ctStats = this.controlTowerSimulator?.getStats() || {};

    return {
      name: this.name,
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      resources: {
        organizationId: orgStats.organizationId,
        accounts: orgStats.accountCount,
        ous: orgStats.ouCount,
        policies: orgStats.policyCount,
        roles: orgStats.roleCount,
        landingZones: ctStats.landingZonesCount,
        guardrails: ctStats.guardrailsCount,
        preventiveGuardrails: ctStats.preventiveGuardrailsCount,
        detectiveGuardrails: ctStats.detectiveGuardrailsCount,
        enabledGuardrails: ctStats.enabledGuardrailsCount
      }
    };
  }

  // Métodos auxiliares para integração com outros serviços

  /**
   * Integração com IAM - Valida se um role pode assumir outro
   */
  validateAssumeRole(assumingRoleId, targetRoleId) {
    const assumingRole = this.organizationsSimulator.roles.get(assumingRoleId);
    const targetRole = this.organizationsSimulator.roles.get(targetRoleId);

    if (!assumingRole || !targetRole) {
      return false;
    }

    return targetRole.canAssumeRole(assumingRole.arn);
  }

  /**
   * Integração com IAM - Avalia se ação é permitida
   */
  evaluateIAMAction(roleId, action, resource = '*') {
    const role = this.organizationsSimulator.roles.get(roleId);
    if (!role) {
      return false;
    }

    return role.canPerformAction(action, resource);
  }

  /**
   * Integração com VPC - Valida restrições regionais por SCP
   */
  validateRegionalRestrictions(accountId, region, service) {
    const evaluation = this.organizationsSimulator.evaluateSCPs(
      accountId,
      `${service}:*`,
      `arn:aws:${service}:${region}:*:*`
    );

    return evaluation.allowed;
  }

  /**
   * Integração com EC2 - Valida se instância pode ser criada
   */
  validateEC2Instance(accountId, instanceType, region) {
    // Verifica SCP
    const scpEvaluation = this.evaluateSCPs(accountId, 'ec2:RunInstances');
    
    // Verifica restrições regionais
    const regionalCheck = this.validateRegionalRestrictions(accountId, region, 'ec2');

    return scpEvaluation.allowed && regionalCheck;
  }
}

module.exports = OrganizationsService;
