/**
 * EC2 Simulator
 * Gerencia instâncias, AMIs, security groups e network interfaces com persistência
 */

const path = require('path');
const Instance = require('./models/instance');
const AMI = require('./models/ami');
const SecurityGroup = require('./models/securityGroup');
const NetworkInterface = require('./models/networkInterface');
const { Volume, VolumeAttachment } = require('./models/volume');
const { Snapshot } = require('./models/snapshot');
const { LifecyclePolicy } = require('./models/lifecyclePolicy');
const LaunchTemplate = require('./models/launchTemplate');
const KeyPair = require('./models/keyPair');
const PlacementGroup = require('./models/placementGroup');
const DedicatedHost = require('./models/dedicatedHost');
const CapacityReservation = require('./models/capacityReservation');
const SpotInstanceRequest = require('./models/spotInstanceRequest');
const { ReservedInstance, defaultReservedInstancesOfferings } = require('./models/reservedInstance');
const InstanceServer = require('./instanceServer');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');

class EC2Simulator {
  constructor(config = {}) {
    this.config = config;
    this.instances = new Map();
    this.amis = new Map();
    this.securityGroups = new Map();
    this.networkInterfaces = new Map();
    this.volumes = new Map();
    this.snapshots = new Map();
    this.lifecyclePolicies = new Map();
    this.launchTemplates = new Map();
    this.volumeModifications = new Map();
    this.instanceServers = new Map();
    // Recursos adicionais de EC2 (spot/reservas/hosts/capacidade/placement/key pairs)
    this.keyPairs = new Map();
    this.placementGroups = new Map();
    this.dedicatedHosts = new Map();
    this.capacityReservations = new Map();
    this.spotInstanceRequests = new Map();
    this.reservedInstances = new Map();
    this.reservedInstancesOfferings = defaultReservedInstancesOfferings();
    this.instanceCounter = 0;

    // Inicializar persistência
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'ec2');
    this.store = new LocalStore(this.dataDir);
  }

  async initialize() {
    // 1. Carregar dados persistidos
    await this.loadFromPersistence();

    // 2. Se não houver dados, criar AMIs e security groups padrão
    if (this.amis.size === 0) {
      this.createDefaultAMIs();
    }

    if (this.securityGroups.size === 0) {
      this.createDefaultSecurityGroup();
    }

    // 3. Pré-provisionar instâncias se configurado e não existirem
    if (this.instances.size === 0 && this.config.instances && Array.isArray(this.config.instances)) {
      logger.info('📚 Carregando Instâncias EC2 da configuração inicial...');
      for (const instanceConfig of this.config.instances) {
        const instance = this.runInstances(
          instanceConfig.ImageId || 'ami-default',
          1,
          instanceConfig.InstanceType || 't2.micro',
          instanceConfig
        )[0];

        // Se houver website dir, iniciar servidor
        if (instanceConfig.WebServerDir) {
          await this.startInstanceServer(instance.InstanceId, instanceConfig.WebServerDir);
        }
      }
    }
  }

  /**
   * Carrega dados persistidos do storage
   */
  async loadFromPersistence() {
    try {
      // Carregar AMIs
      const amisData = this.store.read('amis');
      if (Array.isArray(amisData)) {
        logger.info(`📂 Carregando ${amisData.length} AMIs do storage...`);
        for (const amiData of amisData) {
          const ami = new AMI(amiData.Name, amiData.Architecture, amiData.RootDeviceType);
          ami.ImageId = amiData.ImageId;
          this.amis.set(ami.ImageId, ami);
        }
      }

      // Carregar Security Groups
      const sgsData = this.store.read('security-groups');
      if (Array.isArray(sgsData)) {
        logger.info(`📂 Carregando ${sgsData.length} Security Groups do storage...`);
        for (const sgData of sgsData) {
          const sg = new SecurityGroup(sgData.GroupName, sgData.Description, sgData.VpcId);
          sg.GroupId = sgData.GroupId;
          sg.IngressRules = sgData.IngressRules || [];
          sg.EgressRules = sgData.EgressRules || [];
          this.securityGroups.set(sg.GroupId, sg);
        }
      }

      // Carregar Network Interfaces
      const nisData = this.store.read('network-interfaces');
      if (Array.isArray(nisData)) {
        logger.info(`📂 Carregando ${nisData.length} Network Interfaces do storage...`);
        for (const niData of nisData) {
          const ni = new NetworkInterface(niData.SubnetId, niData.VpcId);
          ni.NetworkInterfaceId = niData.NetworkInterfaceId;
          ni.PrivateIpAddress = niData.PrivateIpAddress;
          ni.SecurityGroups = niData.SecurityGroups || [];
          this.networkInterfaces.set(ni.NetworkInterfaceId, ni);
        }
      }

      // Carregar Instâncias
      const instancesData = this.store.read('instances');
      if (Array.isArray(instancesData)) {
        logger.info(`📂 Carregando ${instancesData.length} Instâncias do storage...`);
        for (const instData of instancesData) {
          const instance = new Instance(instData.ImageId, instData.InstanceType, instData.SecurityGroupIds);
          instance.InstanceId = instData.InstanceId;
          instance.State = instData.State;
          instance.LaunchTime = instData.LaunchTime;
          instance.PublicIpAddress = instData.PublicIpAddress;
          instance.PrivateIpAddress = instData.PrivateIpAddress;
          instance.Tags = instData.Tags || [];
          this.instances.set(instance.InstanceId, instance);
        }
      }

      // Carregar Volumes EBS
      const volumesData = this.store.read('volumes');
      if (Array.isArray(volumesData)) {
        logger.info(`📂 Carregando ${volumesData.length} Volumes EBS do storage...`);
        for (const volData of volumesData) {
          const volume = new Volume(volData);
          volume.VolumeId = volData.VolumeId;
          volume.State = volData.State || 'available';
          volume.CreateTime = volData.CreateTime || new Date().toISOString();
          // Reconstrói anexos como instâncias (o JSON carrega objetos simples)
          volume.Attachments = (volData.Attachments || []).map(att => {
            const attachment = new VolumeAttachment(
              volume.VolumeId,
              att.InstanceId,
              att.Device,
              att.DeleteOnTermination
            );
            attachment.State = att.State || 'attached';
            attachment.AttachTime = att.AttachTime || new Date().toISOString();
            return attachment;
          });
          this.volumes.set(volume.VolumeId, volume);
        }
      }

      // Carregar Snapshots EBS
      const snapshotsData = this.store.read('snapshots');
      if (Array.isArray(snapshotsData)) {
        logger.info(`📂 Carregando ${snapshotsData.length} Snapshots EBS do storage...`);
        for (const snapData of snapshotsData) {
          const snapshot = new Snapshot(snapData);
          snapshot.SnapshotId = snapData.SnapshotId;
          snapshot.StartTime = snapData.StartTime || new Date().toISOString();
          this.snapshots.set(snapshot.SnapshotId, snapshot);
        }
      }

      // Carregar Políticas do Lifecycle Manager
      const policiesData = this.store.read('lifecycle-policies');
      if (Array.isArray(policiesData)) {
        logger.info(`📂 Carregando ${policiesData.length} Políticas do Lifecycle Manager do storage...`);
        for (const policyData of policiesData) {
          const policy = new LifecyclePolicy(policyData);
          policy.PolicyId = policyData.PolicyId;
          policy.DateCreated = policyData.DateCreated || new Date().toISOString();
          policy.DateModified = policyData.DateModified || policy.DateCreated;
          this.lifecyclePolicies.set(policy.PolicyId, policy);
        }
      }

      // Carregar modificações de volume
      const modificationsData = this.store.read('volume-modifications');
      if (Array.isArray(modificationsData)) {
        for (const mod of modificationsData) {
          if (mod && mod.VolumeId) this.volumeModifications.set(mod.VolumeId, mod);
        }
      }

      // Carregar Launch Templates
      const launchTemplatesData = this.store.read('launch-templates');
      if (Array.isArray(launchTemplatesData)) {
        logger.info(`📂 Carregando ${launchTemplatesData.length} Launch Templates do storage...`);
        for (const templateData of launchTemplatesData) {
          const template = LaunchTemplate.fromJSON(templateData);
          this.launchTemplates.set(template.LaunchTemplateId, template);
        }
      }

      // Carregar Key Pairs
      const keyPairsData = this.store.read('key-pairs');
      if (Array.isArray(keyPairsData)) {
        logger.info(`📂 Carregando ${keyPairsData.length} Key Pairs do storage...`);
        for (const kpData of keyPairsData) {
          const kp = Object.assign(Object.create(KeyPair.prototype), kpData);
          this.keyPairs.set(kp.KeyName, kp);
        }
      }

      // Carregar Placement Groups
      const placementGroupsData = this.store.read('placement-groups');
      if (Array.isArray(placementGroupsData)) {
        logger.info(`📂 Carregando ${placementGroupsData.length} Placement Groups do storage...`);
        for (const pgData of placementGroupsData) {
          const pg = Object.assign(Object.create(PlacementGroup.prototype), pgData);
          this.placementGroups.set(pg.GroupName, pg);
        }
      }

      // Carregar Dedicated Hosts
      const dedicatedHostsData = this.store.read('dedicated-hosts');
      if (Array.isArray(dedicatedHostsData)) {
        logger.info(`📂 Carregando ${dedicatedHostsData.length} Dedicated Hosts do storage...`);
        for (const hostData of dedicatedHostsData) {
          const host = Object.assign(Object.create(DedicatedHost.prototype), hostData);
          this.dedicatedHosts.set(host.HostId, host);
        }
      }

      // Carregar Capacity Reservations
      const capacityReservationsData = this.store.read('capacity-reservations');
      if (Array.isArray(capacityReservationsData)) {
        logger.info(`📂 Carregando ${capacityReservationsData.length} Capacity Reservations do storage...`);
        for (const crData of capacityReservationsData) {
          const cr = Object.assign(Object.create(CapacityReservation.prototype), crData);
          this.capacityReservations.set(cr.CapacityReservationId, cr);
        }
      }

      // Carregar Spot Instance Requests
      const spotRequestsData = this.store.read('spot-instance-requests');
      if (Array.isArray(spotRequestsData)) {
        logger.info(`📂 Carregando ${spotRequestsData.length} Spot Instance Requests do storage...`);
        for (const sirData of spotRequestsData) {
          const sir = Object.assign(Object.create(SpotInstanceRequest.prototype), sirData);
          this.spotInstanceRequests.set(sir.SpotInstanceRequestId, sir);
        }
      }

      // Carregar Reserved Instances
      const reservedInstancesData = this.store.read('reserved-instances');
      if (Array.isArray(reservedInstancesData)) {
        logger.info(`📂 Carregando ${reservedInstancesData.length} Reserved Instances do storage...`);
        for (const riData of reservedInstancesData) {
          const ri = Object.assign(Object.create(ReservedInstance.prototype), riData);
          this.reservedInstances.set(ri.ReservedInstancesId, ri);
        }
      }
    } catch (error) {
      logger.warn(`⚠️  Erro ao carregar dados persistidos EC2: ${error.message}`);
    }
  }

  /**
   * Persiste estado atual em storage
   */
  persistData() {
    try {
      this.store.write('amis', Array.from(this.amis.values()).map(a => a.toJSON ? a.toJSON() : a));
      this.store.write('security-groups', Array.from(this.securityGroups.values()).map(sg => sg.toJSON ? sg.toJSON() : sg));
      this.store.write('network-interfaces', Array.from(this.networkInterfaces.values()).map(ni => ni.toJSON ? ni.toJSON() : ni));
      this.store.write('instances', Array.from(this.instances.values()).map(i => i.toJSON ? i.toJSON() : i));
      this.store.write('volumes', Array.from(this.volumes.values()).map(v => v.toJSON ? v.toJSON() : v));
      this.store.write('snapshots', Array.from(this.snapshots.values()).map(s => s.toJSON ? s.toJSON() : s));
      this.store.write('lifecycle-policies', Array.from(this.lifecyclePolicies.values()).map(p => p.toJSON ? p.toJSON() : p));
      this.store.write('launch-templates', Array.from(this.launchTemplates.values()).map(t => t.toJSON ? t.toJSON() : t));
      this.store.write('volume-modifications', Array.from(this.volumeModifications.values()));
      this.store.write('key-pairs', Array.from(this.keyPairs.values()).map(kp => kp.toJSON ? kp.toJSON() : kp));
      this.store.write('placement-groups', Array.from(this.placementGroups.values()).map(pg => pg.toJSON ? pg.toJSON() : pg));
      this.store.write('dedicated-hosts', Array.from(this.dedicatedHosts.values()).map(h => h.toJSON ? h.toJSON() : h));
      this.store.write('capacity-reservations', Array.from(this.capacityReservations.values()).map(cr => cr.toJSON ? cr.toJSON() : cr));
      this.store.write('spot-instance-requests', Array.from(this.spotInstanceRequests.values()).map(s => s.toJSON ? s.toJSON() : s));
      this.store.write('reserved-instances', Array.from(this.reservedInstances.values()).map(r => r.toJSON ? r.toJSON() : r));
    } catch (error) {
      logger.error(`Erro ao persistir dados EC2: ${error.message}`);
    }
  }

  createDefaultAMIs() {
    const amis = [
      { name: 'ubuntu-20.04', desc: 'Ubuntu 20.04 LTS' },
      { name: 'ubuntu-22.04', desc: 'Ubuntu 22.04 LTS' },
      { name: 'amazon-linux-2', desc: 'Amazon Linux 2' },
      { name: 'debian-11', desc: 'Debian 11' }
    ];

    amis.forEach(ami => {
      const newAmi = new AMI(ami.name, ami.desc);
      this.amis.set(newAmi.ImageId, newAmi);
    });

    logger.debug(`✅ ${amis.length} AMIs padrão criadas`);
  }

  createDefaultSecurityGroup() {
    const sg = new SecurityGroup('default', 'Security group padrão');
    sg.addIngressRule('0.0.0.0/0', null, 80, 80, 'tcp', 'HTTP');
    sg.addIngressRule('0.0.0.0/0', null, 443, 443, 'tcp', 'HTTPS');
    sg.addIngressRule('0.0.0.0/0', null, 22, 22, 'tcp', 'SSH');
    this.securityGroups.set(sg.GroupId, sg);
    logger.debug(`✅ Security group padrão criado: ${sg.GroupId}`);
  }

  // ========== Instance Operations ==========

  runInstances(imageId, count = 1, instanceType = 't2.micro', config = {}) {
    const ami = this.amis.get(imageId) || this.getFirstAMI();
    if (!ami) {
      throw new Error(`AMI ${imageId} not found`);
    }

    const instances = [];

    for (let i = 0; i < count; i++) {
      const instance = new Instance(imageId, instanceType, {
        SubnetId: config.SubnetId,
        VpcId: config.VpcId,
        SecurityGroupIds: config.SecurityGroupIds || ['sg-default'],
        KeyName: config.KeyName,
        Tags: config.Tags,
        WebServerDir: config.WebServerDir,
        ProxyUrl: config.ProxyUrl // Passar ProxyUrl se configurado
      });

      this.instances.set(instance.InstanceId, instance);

      // Criar network interface para a instância
      if (config.SubnetId && config.VpcId) {
        const eni = new NetworkInterface(config.SubnetId, config.VpcId);
        eni.attachToInstance(instance.InstanceId, 0);
        this.networkInterfaces.set(eni.NetworkInterfaceId, eni);
      }

      // Criar volume raiz EBS automaticamente e anexar à instância (DeleteOnTermination)
      const rootVolume = new Volume({
        Size: config.RootVolumeSize || 8,
        VolumeType: config.RootVolumeType || 'gp3',
        AvailabilityZone: config.AvailabilityZone || 'us-east-1a',
        Tags: [{ Key: 'Name', Value: `root-volume-${instance.InstanceId}` }]
      });
      rootVolume.attach(instance.InstanceId, '/dev/sda1', true);
      this.volumes.set(rootVolume.VolumeId, rootVolume);

      instances.push(instance);
      logger.info(`✅ Instância criada: ${instance.InstanceId} (${instanceType})`);
    }

    // ✅ Persistir mudanças
    this.persistData();

    return instances;
  }

  describeInstances(filters = {}) {
    let instances = Array.from(this.instances.values());

    if (filters.instanceIds && Array.isArray(filters.instanceIds)) {
      instances = instances.filter(i => filters.instanceIds.includes(i.InstanceId));
    }

    if (filters.state) {
      instances = instances.filter(i => i.State === filters.state);
    }

    if (filters.vpcIds && Array.isArray(filters.vpcIds)) {
      instances = instances.filter(i => filters.vpcIds.includes(i.VpcId));
    }

    return instances;
  }

  getInstance(instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }
    return instance;
  }

  startInstances(instanceIds) {
    const instances = [];
    for (const instanceId of instanceIds) {
      const instance = this.getInstance(instanceId);
      instance.setState('running', 'User initiated');
      instances.push(instance);
      logger.info(`✅ Instância iniciada: ${instanceId}`);
    }
    // ✅ Persistir mudanças
    this.persistData();
    return instances;
  }

  stopInstances(instanceIds) {
    const instances = [];
    for (const instanceId of instanceIds) {
      const instance = this.getInstance(instanceId);
      instance.setState('stopped', 'User initiated');
      instances.push(instance);
      logger.info(`⏸️ Instância parada: ${instanceId}`);
    }
    // ✅ Persistir mudanças
    this.persistData();
    return instances;
  }

  rebootInstances(instanceIds) {
    const instances = [];
    for (const instanceId of instanceIds) {
      const instance = this.getInstance(instanceId);
      // Simular reinício: running -> stopping -> running
      instance.setState('stopping', 'Rebooting');
      setTimeout(() => {
        instance.setState('running', 'Reboot complete');
        this.persistData();
      }, 100);
      instances.push(instance);
      logger.info(`🔄 Instância reiniciada: ${instanceId}`);
    }
    return instances;
  }

  terminateInstances(instanceIds) {
    const instances = [];
    for (const instanceId of instanceIds) {
      const instance = this.getInstance(instanceId);
      instance.setState('terminated', 'User initiated');
      
      // Parar servidor web se estiver rodando
      if (this.instanceServers.has(instanceId)) {
        this.stopInstanceServer(instanceId);
      }

      // Tratar volumes EBS anexados: remover os com DeleteOnTermination, desanexar os demais
      for (const volume of Array.from(this.volumes.values())) {
        const attachment = volume.Attachments.find(a => a.InstanceId === instanceId);
        if (!attachment) continue;

        if (attachment.DeleteOnTermination) {
          this.volumes.delete(volume.VolumeId);
          logger.info(`🗑️ Volume EBS ${volume.VolumeId} removido com a instância ${instanceId}`);
        } else {
          volume.detach(instanceId);
          logger.info(`🔌 Volume EBS ${volume.VolumeId} desanexado da instância ${instanceId}`);
        }
      }

      instances.push(instance);
      logger.info(`🗑️ Instância terminada: ${instanceId}`);
    }
    // ✅ Persistir mudanças
    this.persistData();
    return instances;
  }

  // ========== Instance Server Operations ==========

  async startInstanceServer(instanceId, websiteDir = null, proxyUrl = null) {
    const instance = this.getInstance(instanceId);

    if (this.instanceServers.has(instanceId)) {
      throw new Error(`Instance server already running for ${instanceId}`);
    }

    // Se ProxyUrl foi fornecido, atualizar a instância
    if (proxyUrl) {
      instance.ProxyUrl = proxyUrl;
    }

    try {
      const server = new InstanceServer(instance, websiteDir);
      await server.start();
      this.instanceServers.set(instanceId, server);
      
      const serverType = proxyUrl ? '🔗 Proxy' : '🌐 Web';
      const target = proxyUrl ? `→ ${proxyUrl}` : websiteDir ? `→ ${websiteDir}` : '';
      logger.info(`${serverType} servidor iniciado para ${instanceId} ${target}`);
    } catch (error) {
      logger.error(`Erro ao iniciar servidor web para ${instanceId}:`, error.message);
      throw error;
    }
  }

  async stopInstanceServer(instanceId) {
    const server = this.instanceServers.get(instanceId);
    if (server) {
      await server.stop();
      this.instanceServers.delete(instanceId);
      logger.info(`🌐 Servidor web parado para ${instanceId}`);
    }
  }

  getInstanceServerPort(instanceId) {
    const instance = this.getInstance(instanceId);
    return instance.WebServerPort;
  }

  // ========== AMI Operations ==========

  describeImages(filters = {}) {
    let amis = Array.from(this.amis.values());

    if (filters.imageIds && Array.isArray(filters.imageIds)) {
      amis = amis.filter(a => filters.imageIds.includes(a.ImageId));
    }

    return amis;
  }

  getFirstAMI() {
    return this.amis.values().next().value;
  }

  registerImage(config = {}) {
    const name = config.Name || `image-${Date.now()}`;
    const ami = new AMI(name, config.Description || '', config);
    if (config.ImageId) ami.ImageId = config.ImageId;
    this.amis.set(ami.ImageId, ami);
    logger.info(`✅ AMI registrada: ${ami.ImageId} (${ami.Name})`);
    this.persistData();
    return ami;
  }

  deregisterImage(imageId) {
    if (!this.amis.has(imageId)) {
      throw new Error(`AMI ${imageId} not found`);
    }
    this.amis.delete(imageId);
    logger.info(`🗑️ AMI desregistrada: ${imageId}`);
    this.persistData();
    return true;
  }

  // ========== Security Group Operations ==========

  createSecurityGroup(name, description = '', vpcId = null, config = {}) {
    const sg = new SecurityGroup(name, description, vpcId, config);
    this.securityGroups.set(sg.GroupId, sg);
    return sg;
  }

  describeSecurityGroups(filters = {}) {
    let sgs = Array.from(this.securityGroups.values());

    if (filters.groupIds && Array.isArray(filters.groupIds)) {
      sgs = sgs.filter(sg => filters.groupIds.includes(sg.GroupId));
    }

    if (filters.groupNames && Array.isArray(filters.groupNames)) {
      sgs = sgs.filter(sg => filters.groupNames.includes(sg.GroupName));
    }

    return sgs;
  }

  getSecurityGroup(groupId) {
    const sg = this.securityGroups.get(groupId);
    if (!sg) {
      throw new Error(`Security Group ${groupId} not found`);
    }
    return sg;
  }

  deleteSecurityGroup(groupId) {
    // Verificar se está em uso
    const inUse = Array.from(this.instances.values()).some(i =>
      i.State !== 'terminated' &&
      i.SecurityGroupIds.includes(groupId)
    );

    if (inUse) {
      throw new Error(`Cannot delete security group ${groupId}: in use`);
    }

    this.securityGroups.delete(groupId);
    return true;
  }

  // ========== Network Interface Operations ==========

  createNetworkInterface(subnetId, vpcId, config = {}) {
    const eni = new NetworkInterface(subnetId, vpcId, config);
    this.networkInterfaces.set(eni.NetworkInterfaceId, eni);
    return eni;
  }

  describeNetworkInterfaces(filters = {}) {
    let enis = Array.from(this.networkInterfaces.values());

    if (filters.networkInterfaceIds && Array.isArray(filters.networkInterfaceIds)) {
      enis = enis.filter(e => filters.networkInterfaceIds.includes(e.NetworkInterfaceId));
    }

    if (filters.subnetIds && Array.isArray(filters.subnetIds)) {
      enis = enis.filter(e => filters.subnetIds.includes(e.SubnetId));
    }

    return enis;
  }

  getNetworkInterface(eniId) {
    const eni = this.networkInterfaces.get(eniId);
    if (!eni) {
      throw new Error(`Network Interface ${eniId} not found`);
    }
    return eni;
  }

  deleteNetworkInterface(eniId) {
    const eni = this.getNetworkInterface(eniId);
    if (eni.Attachment) {
      throw new Error(`Cannot delete network interface ${eniId}: in use`);
    }
    this.networkInterfaces.delete(eniId);
    logger.info(`🗑️ Network interface removida: ${eniId}`);
    this.persistData();
    return true;
  }

  // ========== EBS Volume Operations ==========

  createVolume(config = {}) {
    // Restore: ao criar a partir de um snapshot, herda o tamanho do snapshot se não informado
    if (config.SnapshotId && (config.Size === undefined || config.Size === null || config.Size === '')) {
      const snapshot = this.snapshots.get(config.SnapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${config.SnapshotId} not found`);
      }
      config = { ...config, Size: snapshot.VolumeSize };
    }

    const volume = new Volume(config);
    this.volumes.set(volume.VolumeId, volume);
    logger.info(`✅ Volume EBS criado: ${volume.VolumeId} (${volume.Size} GiB ${volume.VolumeType})`);
    this.persistData();
    return volume;
  }

  describeVolumes(filters = {}) {
    let volumes = Array.from(this.volumes.values());

    if (filters.volumeIds && Array.isArray(filters.volumeIds)) {
      volumes = volumes.filter(v => filters.volumeIds.includes(v.VolumeId));
    }

    if (filters.instanceId) {
      volumes = volumes.filter(v => v.Attachments.some(a => a.InstanceId === filters.instanceId));
    }

    if (filters.status) {
      const statusList = Array.isArray(filters.status) ? filters.status : [filters.status];
      volumes = volumes.filter(v => statusList.includes(v.State));
    }

    if (filters.volumeType) {
      const typeList = Array.isArray(filters.volumeType) ? filters.volumeType : [filters.volumeType];
      volumes = volumes.filter(v => typeList.includes(v.VolumeType));
    }

    if (filters.snapshotId) {
      volumes = volumes.filter(v => v.SnapshotId === filters.snapshotId);
    }

    if (filters.availabilityZone) {
      volumes = volumes.filter(v => v.AvailabilityZone === filters.availabilityZone);
    }

    return volumes;
  }

  getVolume(volumeId) {
    const volume = this.volumes.get(volumeId);
    if (!volume) {
      throw new Error(`Volume ${volumeId} not found`);
    }
    return volume;
  }

  attachVolume(volumeId, instanceId, device = '/dev/sdf', deleteOnTermination = false) {
    const volume = this.getVolume(volumeId);
    if (instanceId) {
      // Valida que a instância existe
      this.getInstance(instanceId);
    }
    volume.attach(instanceId, device, deleteOnTermination);
    logger.info(`🔌 Volume EBS ${volumeId} anexado à instância ${instanceId} (${device})`);
    this.persistData();
    return volume;
  }

  detachVolume(volumeId, instanceId = null) {
    const volume = this.getVolume(volumeId);
    volume.detach(instanceId);
    logger.info(`🔌 Volume EBS ${volumeId} desanexado`);
    this.persistData();
    return volume;
  }

  deleteVolume(volumeId) {
    const volume = this.getVolume(volumeId);
    if (volume.State === 'in-use') {
      throw new Error(`Cannot delete volume ${volumeId}: volume is in use`);
    }
    this.volumes.delete(volumeId);
    this.volumeModifications.delete(volumeId);
    logger.info(`🗑️ Volume EBS removido: ${volumeId}`);
    this.persistData();
    return true;
  }

  modifyVolume(volumeId, params = {}) {
    const volume = this.getVolume(volumeId);
    const original = volume.modify(params);

    const modification = {
      VolumeId: volume.VolumeId,
      ModificationState: 'completed',
      TargetSize: volume.Size,
      TargetVolumeType: volume.VolumeType,
      TargetIops: volume.Iops,
      TargetThroughput: volume.Throughput,
      OriginalSize: original.Size,
      OriginalVolumeType: original.VolumeType,
      OriginalIops: original.Iops,
      OriginalThroughput: original.Throughput,
      Progress: 100,
      StartTime: new Date().toISOString(),
      EndTime: new Date().toISOString()
    };

    this.volumeModifications.set(volume.VolumeId, modification);
    logger.info(`✏️ Volume EBS modificado: ${volumeId}`);
    this.persistData();
    return modification;
  }

  describeVolumesModifications(filters = {}) {
    let modifications = Array.from(this.volumeModifications.values());

    if (filters.volumeIds && Array.isArray(filters.volumeIds)) {
      modifications = modifications.filter(m => filters.volumeIds.includes(m.VolumeId));
    }

    return modifications;
  }

  describeVolumeStatus(filters = {}) {
    let volumes = Array.from(this.volumes.values());

    if (filters.volumeIds && Array.isArray(filters.volumeIds)) {
      volumes = volumes.filter(v => filters.volumeIds.includes(v.VolumeId));
    }

    return volumes;
  }

  // ========== EBS Snapshot Operations ==========

  createSnapshot(volumeId, description = '', tags = []) {
    const volume = this.getVolume(volumeId);
    const snapshot = new Snapshot({
      VolumeId: volume.VolumeId,
      VolumeSize: volume.Size,
      Description: description,
      Encrypted: volume.Encrypted,
      Tags: tags
    });
    this.snapshots.set(snapshot.SnapshotId, snapshot);
    logger.info(`✅ Snapshot EBS criado: ${snapshot.SnapshotId} (volume ${volumeId})`);
    this.persistData();
    return snapshot;
  }

  describeSnapshots(filters = {}) {
    let snapshots = Array.from(this.snapshots.values());

    if (filters.snapshotIds && Array.isArray(filters.snapshotIds)) {
      snapshots = snapshots.filter(s => filters.snapshotIds.includes(s.SnapshotId));
    }

    if (filters.volumeId) {
      snapshots = snapshots.filter(s => s.VolumeId === filters.volumeId);
    }

    if (filters.ownerIds && Array.isArray(filters.ownerIds) && !filters.ownerIds.includes('self')) {
      snapshots = snapshots.filter(s => filters.ownerIds.includes(s.OwnerId));
    }

    return snapshots;
  }

  getSnapshot(snapshotId) {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    return snapshot;
  }

  deleteSnapshot(snapshotId) {
    this.getSnapshot(snapshotId);
    this.snapshots.delete(snapshotId);
    logger.info(`🗑️ Snapshot EBS removido: ${snapshotId}`);
    this.persistData();
    return true;
  }

  // ========== Lifecycle Manager (DLM) Operations ==========

  createLifecyclePolicy(config = {}) {
    const policy = new LifecyclePolicy(config);
    this.lifecyclePolicies.set(policy.PolicyId, policy);
    logger.info(`✅ Política do Lifecycle Manager criada: ${policy.PolicyId}`);
    this.persistData();
    return policy;
  }

  describeLifecyclePolicies(filters = {}) {
    let policies = Array.from(this.lifecyclePolicies.values());

    if (filters.policyIds && Array.isArray(filters.policyIds)) {
      policies = policies.filter(p => filters.policyIds.includes(p.PolicyId));
    }

    if (filters.state) {
      const states = Array.isArray(filters.state) ? filters.state : [filters.state];
      policies = policies.filter(p => states.includes(p.State));
    }

    return policies;
  }

  getLifecyclePolicy(policyId) {
    const policy = this.lifecyclePolicies.get(policyId);
    if (!policy) {
      throw new Error(`Lifecycle policy ${policyId} not found`);
    }
    return policy;
  }

  deleteLifecyclePolicy(policyId) {
    this.getLifecyclePolicy(policyId);
    this.lifecyclePolicies.delete(policyId);
    logger.info(`🗑️ Política do Lifecycle Manager removida: ${policyId}`);
    this.persistData();
    return true;
  }

  enableLifecyclePolicy(policyId) {
    const policy = this.getLifecyclePolicy(policyId);
    policy.enable();
    logger.info(`▶️ Política do Lifecycle Manager habilitada: ${policyId}`);
    this.persistData();
    return policy;
  }

  disableLifecyclePolicy(policyId) {
    const policy = this.getLifecyclePolicy(policyId);
    policy.disable();
    logger.info(`⏸️ Política do Lifecycle Manager desabilitada: ${policyId}`);
    this.persistData();
    return policy;
  }

  updateLifecyclePolicy(policyId, config = {}) {
    const policy = this.getLifecyclePolicy(policyId);
    if (config.Description !== undefined) policy.Description = config.Description;
    if (config.State) policy.State = config.State;
    if (config.ResourceType) policy.ResourceType = config.ResourceType;
    if (config.TargetTags) policy.TargetTags = config.TargetTags;
    if (config.Schedules) policy.Schedules = config.Schedules;
    if (config.ExecutionRoleArn) policy.ExecutionRoleArn = config.ExecutionRoleArn;
    policy.DateModified = new Date().toISOString();
    this.persistData();
    return policy;
  }

  // ========== Launch Template Operations ==========

  /**
   * Localiza um launch template por ID ou nome.
   */
  _findLaunchTemplate(idOrName) {
    if (!idOrName) return undefined;
    if (this.launchTemplates.has(idOrName)) return this.launchTemplates.get(idOrName);
    return Array.from(this.launchTemplates.values()).find(
      t => t.LaunchTemplateName === idOrName
    );
  }

  createLaunchTemplate(config = {}) {
    const name = config.LaunchTemplateName;
    if (!name) {
      throw new Error('LaunchTemplateName é obrigatório');
    }

    if (this._findLaunchTemplate(name)) {
      throw new Error(`Launch template com o nome "${name}" já existe`);
    }

    const template = new LaunchTemplate(name, config.LaunchTemplateData || {}, {
      CreatedBy: config.CreatedBy,
      VersionDescription: config.VersionDescription,
      Tags: config.Tags || []
    });

    this.launchTemplates.set(template.LaunchTemplateId, template);
    logger.info(`✅ Launch Template criado: ${template.LaunchTemplateId} (${name})`);
    this.persistData();
    return template;
  }

  createLaunchTemplateVersion(idOrName, config = {}) {
    const template = this.getLaunchTemplate(idOrName);
    const version = template.addVersion(
      config.LaunchTemplateData || {},
      config.VersionDescription || '',
      !!config.SetAsDefault
    );
    logger.info(
      `✅ Launch Template ${template.LaunchTemplateId}: versão ${version.VersionNumber} criada`
    );
    this.persistData();
    return { template, version };
  }

  describeLaunchTemplates(filters = {}) {
    let templates = Array.from(this.launchTemplates.values());

    if (filters.launchTemplateIds && filters.launchTemplateIds.length > 0) {
      templates = templates.filter(t => filters.launchTemplateIds.includes(t.LaunchTemplateId));
    }

    if (filters.launchTemplateNames && filters.launchTemplateNames.length > 0) {
      templates = templates.filter(t => filters.launchTemplateNames.includes(t.LaunchTemplateName));
    }

    return templates;
  }

  describeLaunchTemplateVersions(filters = {}) {
    let templates = Array.from(this.launchTemplates.values());

    if (filters.launchTemplateId) {
      templates = templates.filter(t => t.LaunchTemplateId === filters.launchTemplateId);
    }

    if (filters.launchTemplateName) {
      templates = templates.filter(t => t.LaunchTemplateName === filters.launchTemplateName);
    }

    const versions = [];
    for (const template of templates) {
      const selected = Array.isArray(filters.versions) && filters.versions.length > 0
        ? filters.versions
        : template.Versions.map(v => v.VersionNumber);

      for (const version of selected) {
        versions.push(template.versionToJSON(version));
      }
    }

    return versions;
  }

  getLaunchTemplate(idOrName) {
    const template = this._findLaunchTemplate(idOrName);
    if (!template) {
      throw new Error(`Launch template ${idOrName} não encontrado`);
    }
    return template;
  }

  deleteLaunchTemplate(idOrName) {
    const template = this.getLaunchTemplate(idOrName);
    this.launchTemplates.delete(template.LaunchTemplateId);
    logger.info(`🗑️ Launch Template removido: ${template.LaunchTemplateId}`);
    this.persistData();
    return template;
  }

  /**
   * Remove uma ou mais versões de um launch template.
   */
  deleteLaunchTemplateVersions(idOrName, versions) {
    const template = this.getLaunchTemplate(idOrName);
    const list = Array.isArray(versions) ? versions : [versions];
    const deleted = [];
    for (const version of list) {
      deleted.push(template.deleteVersion(version));
    }
    logger.info(
      `🗑️ Launch Template ${template.LaunchTemplateId}: versões removidas ${deleted.join(', ')}`
    );
    this.persistData();
    return { template, deleted };
  }

  /**
   * Altera a versão padrão de um launch template.
   */
  modifyLaunchTemplate(idOrName, params = {}) {
    const template = this.getLaunchTemplate(idOrName);
    if (params.defaultVersion === undefined || params.defaultVersion === null) {
      throw new Error('DefaultVersionNumber é obrigatório');
    }
    const versionNumber = template.setDefaultVersion(params.defaultVersion);
    logger.info(
      `✏️ Launch Template ${template.LaunchTemplateId}: versão padrão agora é ${versionNumber}`
    );
    this.persistData();
    return template;
  }

  /**
   * Resolve o LaunchTemplateData de uma versão — usado pelo RunInstances.
   */
  resolveLaunchTemplateData(idOrName, version) {
    const template = this.getLaunchTemplate(idOrName);
    const resolved = template.getVersion(version);
    return { template, version: resolved, data: resolved.LaunchTemplateData };
  }

  // ========== Key Pair Operations ==========

  createKeyPair(name, publicKeyMaterial = null, config = {}) {
    if (!name) throw new Error('KeyName is required');
    if (this.keyPairs.has(name)) {
      throw new Error(`Key pair ${name} already exists`);
    }
    const kp = new KeyPair(name, publicKeyMaterial, config);
    this.keyPairs.set(name, kp);
    logger.info(`✅ Key pair criado: ${name}`);
    this.persistData();
    return kp;
  }

  describeKeyPairs(filters = {}) {
    let pairs = Array.from(this.keyPairs.values());
    if (filters.keyNames && filters.keyNames.length) {
      pairs = pairs.filter(k => filters.keyNames.includes(k.KeyName));
    }
    if (filters.keyPairIds && filters.keyPairIds.length) {
      pairs = pairs.filter(k => filters.keyPairIds.includes(k.KeyPairId));
    }
    return pairs;
  }

  getKeyPair(name) {
    const kp = this.keyPairs.get(name);
    if (!kp) throw new Error(`Key pair ${name} not found`);
    return kp;
  }

  deleteKeyPair(name) {
    if (!this.keyPairs.has(name)) {
      throw new Error(`Key pair ${name} not found`);
    }
    this.keyPairs.delete(name);
    logger.info(`🗑️ Key pair removido: ${name}`);
    this.persistData();
    return true;
  }

  // ========== Placement Group Operations ==========

  createPlacementGroup(name, strategy = 'spread', config = {}) {
    if (!name) throw new Error('GroupName is required');
    if (this.placementGroups.has(name)) {
      throw new Error(`Placement group ${name} already exists`);
    }
    const pg = new PlacementGroup(name, strategy, config);
    this.placementGroups.set(name, pg);
    logger.info(`✅ Placement group criado: ${name} (${strategy})`);
    this.persistData();
    return pg;
  }

  describePlacementGroups(filters = {}) {
    let groups = Array.from(this.placementGroups.values());
    if (filters.groupNames && filters.groupNames.length) {
      groups = groups.filter(g => filters.groupNames.includes(g.GroupName));
    }
    if (filters.groupIds && filters.groupIds.length) {
      groups = groups.filter(g => filters.groupIds.includes(g.GroupId));
    }
    return groups;
  }

  deletePlacementGroup(name) {
    if (!this.placementGroups.has(name)) {
      throw new Error(`Placement group ${name} not found`);
    }
    this.placementGroups.delete(name);
    logger.info(`🗑️ Placement group removido: ${name}`);
    this.persistData();
    return true;
  }

  // ========== Dedicated Host Operations ==========

  allocateHosts(instanceType, availabilityZone, quantity = 1, config = {}) {
    if (!instanceType) throw new Error('InstanceType is required');
    const count = Number(quantity) || 1;
    const hosts = [];
    for (let i = 0; i < count; i++) {
      const host = new DedicatedHost(instanceType, availabilityZone || 'us-east-1a', config);
      this.dedicatedHosts.set(host.HostId, host);
      hosts.push(host);
    }
    logger.info(`✅ ${hosts.length} Dedicated Host(s) alocado(s): ${instanceType}`);
    this.persistData();
    return hosts;
  }

  describeHosts(filters = {}) {
    let hosts = Array.from(this.dedicatedHosts.values());
    if (filters.hostIds && filters.hostIds.length) {
      hosts = hosts.filter(h => filters.hostIds.includes(h.HostId));
    }
    return hosts;
  }

  releaseHosts(hostIds = []) {
    const results = [];
    for (const id of hostIds) {
      if (this.dedicatedHosts.has(id)) {
        this.dedicatedHosts.delete(id);
        results.push({ HostId: id });
      }
    }
    logger.info(`🗑️ ${results.length} Dedicated Host(s) liberado(s)`);
    this.persistData();
    return results;
  }

  // ========== Capacity Reservation Operations ==========

  createCapacityReservation(instanceType, availabilityZone, instanceCount, config = {}) {
    if (!instanceType) throw new Error('InstanceType is required');
    if (!availabilityZone) throw new Error('AvailabilityZone is required');
    const cr = new CapacityReservation(instanceType, availabilityZone, instanceCount, config);
    this.capacityReservations.set(cr.CapacityReservationId, cr);
    logger.info(`✅ Capacity reservation criada: ${cr.CapacityReservationId}`);
    this.persistData();
    return cr;
  }

  describeCapacityReservations(filters = {}) {
    let reservations = Array.from(this.capacityReservations.values());
    if (filters.capacityReservationIds && filters.capacityReservationIds.length) {
      reservations = reservations.filter(c =>
        filters.capacityReservationIds.includes(c.CapacityReservationId)
      );
    }
    return reservations;
  }

  cancelCapacityReservation(id) {
    const cr = this.capacityReservations.get(id);
    if (!cr) throw new Error(`Capacity reservation ${id} not found`);
    cr.State = 'cancelled';
    this.capacityReservations.delete(id);
    logger.info(`🗑️ Capacity reservation cancelada: ${id}`);
    this.persistData();
    return true;
  }

  // ========== Spot Instance Request Operations ==========

  requestSpotInstances(config = {}) {
    const sir = new SpotInstanceRequest(config);
    this.spotInstanceRequests.set(sir.SpotInstanceRequestId, sir);
    logger.info(`✅ Spot instance request criado: ${sir.SpotInstanceRequestId}`);
    this.persistData();
    return sir;
  }

  describeSpotInstanceRequests(filters = {}) {
    let requests = Array.from(this.spotInstanceRequests.values());
    if (filters.spotInstanceRequestIds && filters.spotInstanceRequestIds.length) {
      requests = requests.filter(r =>
        filters.spotInstanceRequestIds.includes(r.SpotInstanceRequestId)
      );
    }
    return requests;
  }

  cancelSpotInstanceRequests(ids = []) {
    const results = [];
    for (const id of ids) {
      const sir = this.spotInstanceRequests.get(id);
      if (sir) {
        sir.cancel();
        results.push({ SpotInstanceRequestId: id, State: sir.State });
      }
    }
    logger.info(`🗑️ ${results.length} Spot instance request(s) cancelado(s)`);
    this.persistData();
    return results;
  }

  // ========== Reserved Instance Operations ==========

  describeReservedInstancesOfferings(filters = {}) {
    let offerings = this.reservedInstancesOfferings.slice();
    if (filters.instanceType) {
      offerings = offerings.filter(o => o.InstanceType === filters.instanceType);
    }
    if (filters.offeringId) {
      offerings = offerings.filter(o => o.ReservedInstancesOfferingId === filters.offeringId);
    }
    return offerings;
  }

  purchaseReservedInstancesOffering(offeringId, config = {}) {
    const offering = this.reservedInstancesOfferings.find(
      o => o.ReservedInstancesOfferingId === offeringId
    );
    if (!offering) {
      throw new Error(`Reserved instances offering ${offeringId} not found`);
    }
    const ri = new ReservedInstance(offering, config);
    this.reservedInstances.set(ri.ReservedInstancesId, ri);
    logger.info(`✅ Reserved instance comprada: ${ri.ReservedInstancesId}`);
    this.persistData();
    return ri;
  }

  describeReservedInstances(filters = {}) {
    let reservations = Array.from(this.reservedInstances.values());
    if (filters.reservedInstancesIds && filters.reservedInstancesIds.length) {
      reservations = reservations.filter(r =>
        filters.reservedInstancesIds.includes(r.ReservedInstancesId)
      );
    }
    return reservations;
  }

  // ========== Utility ==========

  getAllResources() {
    return {
      instances: Array.from(this.instances.values()),
      amis: Array.from(this.amis.values()),
      securityGroups: Array.from(this.securityGroups.values()),
      networkInterfaces: Array.from(this.networkInterfaces.values()),
      volumes: Array.from(this.volumes.values()),
      snapshots: Array.from(this.snapshots.values()),
      lifecyclePolicies: Array.from(this.lifecyclePolicies.values()),
      launchTemplates: Array.from(this.launchTemplates.values()),
      volumeModifications: Array.from(this.volumeModifications.values()),
      keyPairs: Array.from(this.keyPairs.values()),
      placementGroups: Array.from(this.placementGroups.values()),
      dedicatedHosts: Array.from(this.dedicatedHosts.values()),
      capacityReservations: Array.from(this.capacityReservations.values()),
      spotInstanceRequests: Array.from(this.spotInstanceRequests.values()),
      reservedInstances: Array.from(this.reservedInstances.values()),
      reservedInstancesOfferings: this.reservedInstancesOfferings,
      instanceServersCount: this.instanceServers.size
    };
  }
}

module.exports = EC2Simulator;
