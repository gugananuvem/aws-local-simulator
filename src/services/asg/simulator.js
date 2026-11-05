/**
 * ASG Simulator - Auto Scaling Group Simulator com persistência
 */

const path = require('path');
const AutoScalingGroup = require('./models/autoScalingGroup');
const LaunchTemplate = require('./models/launchTemplate');
const ScalingPolicy = require('./models/scalingPolicy');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');

class ASGSimulator {
  constructor(config = {}) {
    this.config = config;
    this.autoScalingGroups = new Map();
    this.launchTemplates = new Map();
    this.scalingPolicies = new Map();
    this.ec2Service = null;
    this.albService = null;

    // Inicializar persistência
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'asg');
    this.store = new LocalStore(this.dataDir);
  }

  async initialize() {
    // 1. Carregar dados persistidos
    await this.loadFromPersistence();

    // 2. Pré-provisionar ASGs se configurado e não existirem
    if (this.autoScalingGroups.size === 0 && this.config.autoScalingGroups && Array.isArray(this.config.autoScalingGroups)) {
      logger.info('📚 Carregando ASGs da configuração inicial...');
      for (const asgConfig of this.config.autoScalingGroups) {
        // Criar launch template primeiro
        const lt = new LaunchTemplate(
          asgConfig.launchTemplateName || asgConfig.AutoScalingGroupName,
          asgConfig.imageId || 'ami-0c55b159cbfafe1f0',
          asgConfig.instanceType || 't2.micro',
          asgConfig.launchTemplateConfig || {}
        );
        this.launchTemplates.set(lt.LaunchTemplateId, lt);

        // Criar ASG
        this.createAutoScalingGroup(
          asgConfig.AutoScalingGroupName,
          lt.LaunchTemplateId,
          asgConfig
        );
      }
    }
  }

  /**
   * Carrega dados persistidos do storage
   */
  async loadFromPersistence() {
    try {
      // Carregar Launch Templates
      const ltsData = this.store.read('launch-templates');
      if (Array.isArray(ltsData)) {
        logger.info(`📂 Carregando ${ltsData.length} Launch Templates do storage...`);
        for (const ltData of ltsData) {
          const lt = new LaunchTemplate(ltData.LaunchTemplateName, ltData.ImageId, ltData.InstanceType);
          lt.LaunchTemplateId = ltData.LaunchTemplateId;
          this.launchTemplates.set(lt.LaunchTemplateId, lt);
        }
      }

      // Carregar ASGs
      const asgsData = this.store.read('auto-scaling-groups');
      if (Array.isArray(asgsData)) {
        logger.info(`📂 Carregando ${asgsData.length} ASGs do storage...`);
        for (const asgData of asgsData) {
          const asg = new AutoScalingGroup(
            asgData.AutoScalingGroupName,
            { LaunchTemplateId: asgData.LaunchTemplateId, ImageId: asgData.ImageId, InstanceType: asgData.InstanceType },
            {
              minSize: asgData.MinSize,
              maxSize: asgData.MaxSize,
              desiredCapacity: asgData.DesiredCapacity,
              vpcZoneIdentifier: asgData.VPCZoneIdentifier,
              availabilityZones: asgData.AvailabilityZones,
              targetGroupARNs: asgData.TargetGroupARNs,
              loadBalancerNames: asgData.LoadBalancerNames,
              healthCheckType: asgData.HealthCheckType,
              healthCheckGracePeriod: asgData.HealthCheckGracePeriod,
              tags: asgData.Tags
            }
          );
          asg.AutoScalingGroupARN = asgData.AutoScalingGroupARN;
          this.autoScalingGroups.set(asg.AutoScalingGroupName, asg);
        }
      }

      // Carregar Scaling Policies
      const polsData = this.store.read('scaling-policies');
      if (Array.isArray(polsData)) {
        logger.info(`📂 Carregando ${polsData.length} Scaling Policies do storage...`);
        for (const polData of polsData) {
          const policy = new ScalingPolicy(polData.PolicyName, polData.AutoScalingGroupName, polData.PolicyType);
          policy.PolicyARN = polData.PolicyARN;
          this.scalingPolicies.set(policy.PolicyARN, policy);
        }
      }
    } catch (error) {
      logger.warn(`⚠️  Erro ao carregar dados persistidos ASG: ${error.message}`);
    }
  }

  /**
   * Persiste estado atual em storage
   */
  persistData() {
    try {
      this.store.write('launch-templates', Array.from(this.launchTemplates.values()).map(lt => lt.toJSON ? lt.toJSON() : lt));
      this.store.write('auto-scaling-groups', Array.from(this.autoScalingGroups.values()).map(asg => asg.toJSON ? asg.toJSON() : asg));
      this.store.write('scaling-policies', Array.from(this.scalingPolicies.values()).map(pol => pol.toJSON ? pol.toJSON() : pol));
    } catch (error) {
      logger.error(`Erro ao persistir dados ASG: ${error.message}`);
    }
  }

  // ========== Launch Template Operations ==========

  createLaunchTemplate(name, imageId, instanceType, config = {}) {
    const lt = new LaunchTemplate(name, imageId, instanceType, config);
    this.launchTemplates.set(lt.LaunchTemplateId, lt);
    logger.info(`✅ Launch Template criado: ${name} (${lt.LaunchTemplateId})`);
    // ✅ Persistir mudanças
    this.persistData();
    return lt;
  }

  describeLaunchTemplates(filters = {}) {
    let templates = Array.from(this.launchTemplates.values());

    if (filters.names && Array.isArray(filters.names)) {
      templates = templates.filter(t => filters.names.includes(t.LaunchTemplateName));
    }

    if (filters.ids && Array.isArray(filters.ids)) {
      templates = templates.filter(t => filters.ids.includes(t.LaunchTemplateId));
    }

    return templates;
  }

  getLaunchTemplate(templateId) {
    const lt = this.launchTemplates.get(templateId);
    if (!lt) {
      throw new Error(`Launch Template ${templateId} not found`);
    }
    return lt;
  }

  deleteLaunchTemplate(templateId) {
    const lt = this.getLaunchTemplate(templateId);
    this.launchTemplates.delete(templateId);
    logger.info(`🗑️ Launch Template deletado: ${lt.LaunchTemplateName}`);
    // ✅ Persistir mudanças
    this.persistData();
    return true;
  }

  // ========== Auto Scaling Group Operations ==========

  createAutoScalingGroup(name, launchTemplateId, config = {}) {
    const lt = this.getLaunchTemplate(launchTemplateId);

    const asg = new AutoScalingGroup(name, lt, {
      minSize: config.minSize !== undefined ? config.minSize : 1,
      maxSize: config.maxSize !== undefined ? config.maxSize : 5,
      desiredCapacity:
        config.desiredCapacity !== undefined
          ? config.desiredCapacity
          : config.minSize !== undefined
          ? config.minSize
          : 1,
      vpcZoneIdentifier: config.vpcZoneIdentifier || [],
      availabilityZones: config.availabilityZones || ['us-east-1a'],
      targetGroupARNs: config.targetGroupARNs || [],
      loadBalancerNames: config.loadBalancerNames || [],
      healthCheckType: config.healthCheckType || 'ELB',
      healthCheckGracePeriod: config.healthCheckGracePeriod || 300,
      tags: config.tags || [],
      enabledMetrics: config.enabledMetrics || ['GroupInServiceInstances']
    });

    this.autoScalingGroups.set(asg.AutoScalingGroupName, asg);
    logger.info(`✅ Auto Scaling Group criado: ${name}`);

    // Se desiredCapacity > 0, criar instâncias
    if (asg.DesiredCapacity > 0 && this.ec2Service) {
      this._scaleToDesiredCapacity(asg);
    }

    // ✅ Persistir mudanças
    this.persistData();

    return asg;
  }

  describeAutoScalingGroups(filters = {}) {
    let asgs = Array.from(this.autoScalingGroups.values());

    if (filters.names && Array.isArray(filters.names)) {
      asgs = asgs.filter(a => filters.names.includes(a.AutoScalingGroupName));
    }

    return asgs;
  }

  getAutoScalingGroup(name) {
    const asg = this.autoScalingGroups.get(name);
    if (!asg) {
      throw new Error(`Auto Scaling Group ${name} not found`);
    }
    return asg;
  }

  deleteAutoScalingGroup(name, forceDelete = false) {
    const asg = this.getAutoScalingGroup(name);

    // Se forceDelete, terminar todas as instâncias
    if (forceDelete && this.ec2Service) {
      for (const inst of asg.Instances) {
        try {
          const ec2Sim = this.ec2Service.getSimulator();
          ec2Sim.terminateInstances([inst.InstanceId]);
        } catch (e) {
          logger.warn(`Erro ao terminar instância ${inst.InstanceId}: ${e.message}`);
        }
      }
    }

    if (asg.Instances.length > 0 && !forceDelete) {
      throw new Error(`Auto Scaling Group ${name} has running instances. Use forceDelete=true to terminate them.`);
    }

    this.autoScalingGroups.delete(name);
    logger.info(`🗑️ Auto Scaling Group deletado: ${name}`);
    // ✅ Persistir mudanças
    this.persistData();
    return true;
  }

  // ========== Scaling Operations ==========

  setDesiredCapacity(asgName, desiredCapacity) {
    const asg = this.getAutoScalingGroup(asgName);

    if (desiredCapacity < asg.MinSize || desiredCapacity > asg.MaxSize) {
      throw new Error(
        `Desired capacity ${desiredCapacity} must be between ${asg.MinSize} and ${asg.MaxSize}`
      );
    }

    const oldCapacity = asg.DesiredCapacity;
    asg.DesiredCapacity = desiredCapacity;

    logger.info(`🎯 ASG ${asgName}: Desired capacity alterado de ${oldCapacity} para ${desiredCapacity}`);

    // Aplicar scaling imediatamente se EC2 service está disponível
    if (this.ec2Service) {
      this._scaleToDesiredCapacity(asg);
    }

    // ✅ Persistir mudanças
    this.persistData();

    return asg;
  }

  // ========== Scaling Policy Operations ==========

  attachScalingPolicy(asgName, policyName, policyType, config = {}) {
    const asg = this.getAutoScalingGroup(asgName);

    const policy = new ScalingPolicy(policyName, asgName, policyType, config);
    const policyKey = `${asgName}:${policyName}`;
    this.scalingPolicies.set(policyKey, policy);

    asg.scalingPolicies.push(policy);
    logger.info(`✅ Scaling Policy criado: ${policyName} para ASG ${asgName}`);
    // ✅ Persistir mudanças
    this.persistData();
    return policy;
  }

  describeScalingPolicies(asgName) {
    const asg = this.getAutoScalingGroup(asgName);
    return asg.scalingPolicies;
  }

  detachScalingPolicy(asgName, policyName) {
    const asg = this.getAutoScalingGroup(asgName);
    const policyKey = `${asgName}:${policyName}`;

    asg.scalingPolicies = asg.scalingPolicies.filter(p => p.PolicyName !== policyName);
    this.scalingPolicies.delete(policyKey);

    logger.info(`🗑️ Scaling Policy deletado: ${policyName}`);
    // ✅ Persistir mudanças
    this.persistData();
    return true;
  }

  // ========== Internal Scaling Logic ==========

  _scaleToDesiredCapacity(asg) {
    const currentCount = asg.getInstanceCount();
    const desiredCount = asg.DesiredCapacity;

    if (currentCount === desiredCount) {
      return;
    }

    const ec2Sim = this.resolveSimulator(this.ec2Service);
    if (!ec2Sim) {
      logger.warn('⚠️  EC2 indisponível: não é possível escalar o Auto Scaling Group');
      return;
    }

    if (currentCount < desiredCount) {
      // Scale up
      const instancesToCreate = desiredCount - currentCount;
      logger.debug(`🔺 Escalando UP: criando ${instancesToCreate} instâncias`);

      for (let i = 0; i < instancesToCreate; i++) {
        try {
          // EC2Simulator.runInstances(imageId, count, instanceType, config) -> Instance[]
          const created = ec2Sim.runInstances(
            asg.LaunchTemplate.ImageId,
            1,
            asg.LaunchTemplate.InstanceType,
            {
              SecurityGroupIds: asg.LaunchTemplate.SecurityGroupIds,
              Tags: [
                { Key: 'aws:autoscaling:groupName', Value: asg.AutoScalingGroupName },
                ...asg.Tags
              ]
            }
          );

          const newInstance = created[0];
          asg.addInstance({
            InstanceId: newInstance.InstanceId,
            InstanceType: newInstance.InstanceType,
            AvailabilityZone: newInstance.AvailabilityZone
          });

          // Registrar em target groups do ALB se configurado
          if (asg.TargetGroupARNs.length > 0) {
            const albSim = this.resolveSimulator(this.albService);
            if (albSim) {
              for (const tgArn of asg.TargetGroupARNs) {
                try {
                  const port = newInstance.WebServerPort || 80;
                  albSim.registerTarget(tgArn, newInstance.InstanceId, port);
                } catch (e) {
                  logger.warn(`Erro ao registrar target no ALB: ${e.message}`);
                }
              }
            }
          }

          logger.info(`✅ Instância ${newInstance.InstanceId} criada por ASG`);
        } catch (e) {
          logger.error(`Erro ao criar instância: ${e.message}`);
        }
      }
    } else {
      // Scale down
      const instancesToTerminate = currentCount - desiredCount;
      logger.debug(`🔻 Escalando DOWN: terminando ${instancesToTerminate} instâncias`);

      const instancesToRemove = asg.Instances.slice(0, instancesToTerminate);

      for (const inst of instancesToRemove) {
        try {
          ec2Sim.terminateInstances([inst.InstanceId]);
          asg.removeInstance(inst.InstanceId);
          logger.info(`🗑️ Instância ${inst.InstanceId} terminada por ASG`);
        } catch (e) {
          logger.warn(`Erro ao terminar instância: ${e.message}`);
        }
      }
    }

    asg.lastScalingTime = new Date();
  }

  evaluateScalingPolicies(asgName) {
    const asg = this.getAutoScalingGroup(asgName);

    for (const policy of asg.scalingPolicies) {
      if (!policy.Enabled) continue;

      // Target tracking: simular com métrica aleatória
      if (policy.PolicyType === 'TargetTrackingScaling') {
        const randomMetric = Math.random() * 100;

        if (randomMetric > policy.TargetValue * 1.2 && asg.canScaleUp()) {
          logger.info(`📈 Scaling up: métrica ${randomMetric.toFixed(2)}% > target ${policy.TargetValue}%`);
          this.setDesiredCapacity(asgName, asg.DesiredCapacity + 1);
        } else if (randomMetric < policy.TargetValue * 0.8 && asg.canScaleDown()) {
          logger.info(`📉 Scaling down: métrica ${randomMetric.toFixed(2)}% < target ${policy.TargetValue * 0.8}%`);
          this.setDesiredCapacity(asgName, asg.DesiredCapacity - 1);
        }
      }
    }
  }

  // ========== Utility ==========

  /**
   * Resolve um simulador a partir de um serviço, de um simulador ou de null.
   */
  resolveSimulator(serviceOrSimulator) {
    if (!serviceOrSimulator) {
      return null;
    }
    if (typeof serviceOrSimulator.getSimulator === 'function') {
      return serviceOrSimulator.getSimulator();
    }
    return serviceOrSimulator;
  }

  injectDependencies(ec2Service, albService) {
    this.ec2Service = ec2Service;
    this.albService = albService;
  }

  getAllResources() {
    return {
      autoScalingGroups: Array.from(this.autoScalingGroups.values()),
      launchTemplates: Array.from(this.launchTemplates.values()),
      scalingPolicies: Array.from(this.scalingPolicies.values())
    };
  }
}

module.exports = ASGSimulator;
