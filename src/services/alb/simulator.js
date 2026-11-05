/**
 * ALB Simulator - Application Load Balancer com persistência
 */

const path = require('path');
const LoadBalancer = require('./models/loadBalancer');
const { TargetGroup, Target } = require('./models/targetGroup');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');

class ALBSimulator {
  constructor(config = {}) {
    this.config = config;
    this.loadBalancers = new Map();
    this.targetGroups = new Map();

    // Inicializar persistência
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'alb');
    this.store = new LocalStore(this.dataDir);
  }

  async initialize() {
    // 1. Carregar dados persistidos
    await this.loadFromPersistence();

    // 2. Pré-provisionar ALBs se configurado e não existirem
    if (this.loadBalancers.size === 0 && this.config.loadBalancers && Array.isArray(this.config.loadBalancers)) {
      logger.info('📚 Carregando ALBs da configuração inicial...');
      for (const albConfig of this.config.loadBalancers) {
        this.createLoadBalancer(albConfig.Name, 'internet-facing', albConfig);
      }
    }
  }

  /**
   * Carrega dados persistidos do storage
   */
  async loadFromPersistence() {
    try {
      // Carregar Load Balancers
      const albsData = this.store.read('load-balancers');
      if (Array.isArray(albsData)) {
        logger.info(`📂 Carregando ${albsData.length} ALBs do storage...`);
        for (const albData of albsData) {
          const alb = new LoadBalancer(albData.LoadBalancerName, albData.Scheme, albData);
          alb.LoadBalancerArn = albData.LoadBalancerArn;
          alb.State = albData.State;
          alb.Listeners = albData.Listeners || [];
          this.loadBalancers.set(alb.LoadBalancerArn, alb);
        }
      }

      // Carregar Target Groups
      const tgsData = this.store.read('target-groups');
      if (Array.isArray(tgsData)) {
        logger.info(`📂 Carregando ${tgsData.length} Target Groups do storage...`);
        for (const tgData of tgsData) {
          const tg = new TargetGroup(tgData.TargetGroupName, tgData.Protocol, tgData.Port, tgData.VpcId);
          tg.TargetGroupArn = tgData.TargetGroupArn;
          // Reconstruir objetos Target a partir dos dados persistidos
          tg.Targets = (tgData.Targets || []).map(t => {
            const target = new Target(t.TargetId, t.Port);
            target.HealthState = t.HealthState || 'healthy';
            target.HealthReason = t.HealthReason || 'N/A';
            target.Description = t.Description || 'Target registered';
            target.RegisteredAt = t.RegisteredAt || new Date().toISOString();
            return target;
          });
          tg.HealthCheckConfig = tgData.HealthCheckConfig || {};
          this.targetGroups.set(tg.TargetGroupArn, tg);
        }
      }
    } catch (error) {
      logger.warn(`⚠️  Erro ao carregar dados persistidos ALB: ${error.message}`);
    }
  }

  /**
   * Persiste estado atual em storage
   */
  persistData() {
    try {
      this.store.write('load-balancers', Array.from(this.loadBalancers.values()).map(a => a.toJSON ? a.toJSON() : a));
      this.store.write('target-groups', Array.from(this.targetGroups.values()).map(tg => tg.toJSON ? tg.toJSON() : tg));
    } catch (error) {
      logger.error(`Erro ao persistir dados ALB: ${error.message}`);
    }
  }

  // ========== Load Balancer Operations ==========

  createLoadBalancer(name, scheme = 'internet-facing', config = {}) {
    const alb = new LoadBalancer(name, scheme, config);
    this.loadBalancers.set(alb.LoadBalancerArn, alb);
    logger.info(`✅ ALB criado: ${name} (${alb.LoadBalancerArn})`);
    // ✅ Persistir mudanças
    this.persistData();
    return alb;
  }

  describeLoadBalancers(filters = {}) {
    let albs = Array.from(this.loadBalancers.values());

    if (filters.names && Array.isArray(filters.names)) {
      albs = albs.filter(a => filters.names.includes(a.LoadBalancerName));
    }

    if (filters.arns && Array.isArray(filters.arns)) {
      albs = albs.filter(a => filters.arns.includes(a.LoadBalancerArn));
    }

    return albs;
  }

  getLoadBalancer(albArn) {
    const alb = this.loadBalancers.get(albArn);
    if (!alb) {
      throw new Error(`Load Balancer ${albArn} not found`);
    }
    return alb;
  }

  deleteLoadBalancer(albArn) {
    // Deletar target groups associados
    const alb = this.getLoadBalancer(albArn);
    alb.TargetGroups.forEach(tg => {
      this.targetGroups.delete(tg.TargetGroupArn);
    });

    this.loadBalancers.delete(albArn);
    logger.info(`🗑️ ALB deletado: ${albArn}`);
    // ✅ Persistir mudanças
    this.persistData();
    return true;
  }

  // ========== Target Group Operations ==========

  createTargetGroup(name, protocol = 'HTTP', port = 80, vpcId = null, config = {}) {
    const tg = new TargetGroup(name, protocol, port, vpcId, config);
    this.targetGroups.set(tg.TargetGroupArn, tg);
    logger.info(`✅ Target Group criado: ${name} (${tg.TargetGroupArn})`);
    // ✅ Persistir mudanças
    this.persistData();
    return tg;
  }

  describeTargetGroups(filters = {}) {
    let tgs = Array.from(this.targetGroups.values());

    if (filters.names && Array.isArray(filters.names)) {
      tgs = tgs.filter(t => filters.names.includes(t.TargetGroupName));
    }

    if (filters.arns && Array.isArray(filters.arns)) {
      tgs = tgs.filter(t => filters.arns.includes(t.TargetGroupArn));
    }

    return tgs;
  }

  getTargetGroup(tgArn) {
    const tg = this.targetGroups.get(tgArn);
    if (!tg) {
      throw new Error(`Target Group ${tgArn} not found`);
    }
    return tg;
  }

  deleteTargetGroup(tgArn) {
    // Verificar se está em uso por ALB
    const inUse = Array.from(this.loadBalancers.values()).some(alb =>
      alb.TargetGroups.some(tg => tg.TargetGroupArn === tgArn)
    );

    if (inUse) {
      throw new Error(`Target Group ${tgArn} still in use by load balancer`);
    }

    this.targetGroups.delete(tgArn);
    logger.info(`🗑️ Target Group deletado: ${tgArn}`);
    // ✅ Persistir mudanças
    this.persistData();
    return true;
  }

  // ========== Target Operations ==========

  registerTarget(tgArn, targetId, port = null) {
    const tg = this.getTargetGroup(tgArn);
    const target = tg.registerTarget(targetId, port);
    logger.info(`✅ Target registrado: ${targetId} em ${tg.TargetGroupName}`);
    // ✅ Persistir mudanças
    this.persistData();
    return target;
  }

  deregisterTarget(tgArn, targetId, port = null) {
    const tg = this.getTargetGroup(tgArn);
    const target = tg.deregisterTarget(targetId, port);
    logger.info(`🗑️ Target removido: ${targetId} de ${tg.TargetGroupName}`);
    // ✅ Persistir mudanças
    this.persistData();
    return target;
  }

  describeTargetHealth(tgArn) {
    const tg = this.getTargetGroup(tgArn);
    return {
      TargetGroupArn: tgArn,
      HealthDescriptions: tg.Targets.map(t => ({
        TargetId: t.TargetId,
        Port: t.Port,
        HealthState: t.HealthState,
        HealthReason: t.HealthReason
      }))
    };
  }

  // ========== Listener Operations ==========

  addListener(albArn, protocol = 'HTTP', port = 80, tgArn = null) {
    const alb = this.getLoadBalancer(albArn);

    if (tgArn) {
      this.getTargetGroup(tgArn); // Validar que o TG existe
    }

    const listener = alb.addListener(protocol, port, tgArn);
    logger.info(`✅ Listener adicionado: ${protocol}:${port} → ${tgArn}`);
    // ✅ Persistir mudanças
    this.persistData();
    return listener;
  }

  describeListeners(filters = {}) {
    let listeners = [];

    const albs = filters.albArn
      ? [this.getLoadBalancer(filters.albArn)]
      : Array.from(this.loadBalancers.values());

    for (const alb of albs) {
      listeners = listeners.concat(alb.Listeners || []);
    }

    if (filters.listenerArns && Array.isArray(filters.listenerArns)) {
      listeners = listeners.filter(l => filters.listenerArns.includes(l.ListenerArn));
    }

    return listeners;
  }

  deleteListener(listenerArn) {
    for (const alb of this.loadBalancers.values()) {
      const index = (alb.Listeners || []).findIndex(l => l.ListenerArn === listenerArn);
      if (index > -1) {
        alb.Listeners.splice(index, 1);
        logger.info(`🗑️ Listener deletado: ${listenerArn}`);
        // ✅ Persistir mudanças
        this.persistData();
        return true;
      }
    }

    throw new Error(`Listener ${listenerArn} not found`);
  }

  // ========== Load Balancing Logic ==========

  routeRequest(albArn, path = '/') {
    const alb = this.getLoadBalancer(albArn);

    // Se não há target groups, retornar erro
    if (alb.TargetGroups.length === 0) {
      return null;
    }

    // Usar o primeiro target group por padrão
    const tg = alb.TargetGroups[0];
    const nextTarget = tg.getNextTarget();

    return nextTarget
      ? {
          TargetId: nextTarget.TargetId,
          Port: nextTarget.Port,
          TargetGroupArn: tg.TargetGroupArn
        }
      : null;
  }

  // ========== Utility ==========

  getAllResources() {
    return {
      loadBalancers: Array.from(this.loadBalancers.values()),
      targetGroups: Array.from(this.targetGroups.values())
    };
  }
}

module.exports = ALBSimulator;
