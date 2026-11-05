/**
 * Route53 Simulator
 * DNS and domain management with weighted routing, health checks, and failover
 */

const path = require('path');
const HostedZone = require('./models/hostedZone');
const ResourceRecord = require('./models/resourceRecord');
const HealthCheck = require('./models/healthCheck');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');

class Route53Simulator {
  constructor(config = {}) {
    this.config = config;
    this.hostedZones = new Map();
    this.resourceRecords = new Map(); // zoneId -> records[]
    this.healthChecks = new Map();
    this.dnsResolution = new Map(); // domain -> resolved records

    // Inicializar persistência
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'route53');
    this.store = new LocalStore(this.dataDir);

    // Health check interval
    this.healthCheckInterval = null;
  }

  // Aceita tanto "abc123" quanto "/hostedzone/abc123"
  normalizeZoneId(zoneId) {
    if (!zoneId) return zoneId;
    return zoneId.startsWith('/hostedzone/') ? zoneId : `/hostedzone/${zoneId}`;
  }

  async initialize() {
    // 1. Carregar dados persistidos
    await this.loadFromPersistence();

    // 2. Criar zonas padrão se configurado
    if (this.hostedZones.size === 0 && this.config.hostedZones && Array.isArray(this.config.hostedZones)) {
      logger.info('📚 Carregando Zonas Hospedadas Route53 da configuração inicial...');
      for (const zoneConfig of this.config.hostedZones) {
        this.createHostedZone(zoneConfig.Name, zoneConfig);
      }
    }

    // 3. Iniciar health checks periódicos
    this.startHealthCheckInterval();
  }

  /**
   * Carrega dados persistidos do storage
   */
  async loadFromPersistence() {
    try {
      // Carregar Hosted Zones
      const zonesData = this.store.read('hosted-zones');
      if (Array.isArray(zonesData)) {
        logger.info(`📂 Carregando ${zonesData.length} Hosted Zones do storage...`);
        for (const zoneData of zonesData) {
          const zone = new HostedZone(zoneData.Name, zoneData.Config);
          zone.Id = zoneData.Id;
          zone.CallerReference = zoneData.CallerReference;
          zone.CreatedDate = zoneData.CreatedDate;
          zone.ResourceRecordSetCount = zoneData.ResourceRecordSetCount;
          this.hostedZones.set(zone.Id, zone);
        }
      }

      // Carregar Resource Records
      const recordsData = this.store.read('resource-records');
      if (Array.isArray(recordsData)) {
        logger.info(`📂 Carregando ${recordsData.length} Resource Records do storage...`);
        for (const recordGroup of recordsData) {
          const records = [];
          for (const recordData of recordGroup.records) {
            const record = new ResourceRecord(recordData.Name, recordData.Type, recordData.ResourceRecords.map(r => r.Value), recordData);
            record.CreatedDate = recordData.CreatedDate;
            record.LastModified = recordData.LastModified;
            records.push(record);
          }
          this.resourceRecords.set(recordGroup.zoneId, records);
        }
      }

      // Carregar Health Checks
      const healthChecksData = this.store.read('health-checks');
      if (Array.isArray(healthChecksData)) {
        logger.info(`📂 Carregando ${healthChecksData.length} Health Checks do storage...`);
        for (const hcData of healthChecksData) {
          const hc = new HealthCheck(hcData.HealthCheckConfig);
          hc.Id = hcData.Id;
          hc.Status = hcData.Status;
          hc.CreatedDate = hcData.CreatedDate;
          this.healthChecks.set(hc.Id, hc);
        }
      }
    } catch (error) {
      logger.error(`Erro ao carregar persistência Route53: ${error.message}`);
    }
  }

  /**
   * Persiste dados para storage
   */
  persistData() {
    try {
      // Persistir Hosted Zones
      const zonesData = Array.from(this.hostedZones.values()).map(zone => zone.toJSON());
      this.store.write('hosted-zones', zonesData);

      // Persistir Resource Records
      const recordsData = Array.from(this.resourceRecords.entries()).map(([zoneId, records]) => ({
        zoneId,
        records: records.map(r => r.toJSON()),
      }));
      this.store.write('resource-records', recordsData);

      // Persistir Health Checks
      const healthChecksData = Array.from(this.healthChecks.values()).map(hc => hc.toJSON());
      this.store.write('health-checks', healthChecksData);
    } catch (error) {
      logger.error(`Erro ao persistir Route53: ${error.message}`);
    }
  }

  /**
   * Cria uma zona hospedada
   */
  createHostedZone(name, config = {}) {
    const zone = new HostedZone(name, config);
    this.hostedZones.set(zone.Id, zone);
    this.resourceRecords.set(zone.Id, []);
    this.persistData();
    logger.info(`✅ Hosted Zone criada: ${name} (${zone.Id})`);
    return zone;
  }

  /**
   * Lista zonas hospedadas
   */
  listHostedZones() {
    return Array.from(this.hostedZones.values());
  }

  /**
   * Obtém zona hospedada
   */
  getHostedZone(zoneId) {
    return this.hostedZones.get(this.normalizeZoneId(zoneId));
  }

  /**
   * Deleta zona hospedada
   */
  deleteHostedZone(zoneId) {
    zoneId = this.normalizeZoneId(zoneId);
    const zone = this.hostedZones.get(zoneId);
    if (!zone) throw new Error(`Hosted Zone não encontrada: ${zoneId}`);

    // Verificar se tem registros
    const records = this.resourceRecords.get(zoneId) || [];
    if (records.length > 2) { // NS e SOA são criados automaticamente
      throw new Error(`Não pode deletar zona com registros: ${records.length} encontrados`);
    }

    this.hostedZones.delete(zoneId);
    this.resourceRecords.delete(zoneId);
    this.persistData();
    logger.info(`✅ Hosted Zone deletada: ${zoneId}`);
    return true;
  }

  /**
   * Cria um resource record
   */
  createResourceRecord(zoneId, name, type, values, config = {}) {
    zoneId = this.normalizeZoneId(zoneId);
    if (!this.hostedZones.has(zoneId)) {
      throw new Error(`Hosted Zone não encontrada: ${zoneId}`);
    }

    if (!this.resourceRecords.has(zoneId)) {
      this.resourceRecords.set(zoneId, []);
    }

    const record = new ResourceRecord(name, type, values, config);
    const records = this.resourceRecords.get(zoneId);
    records.push(record);

    const zone = this.hostedZones.get(zoneId);
    zone.ResourceRecordSetCount = records.length;

    this.persistData();
    logger.info(`✅ Resource Record criado: ${name} (${type})`);
    return record;
  }

  /**
   * Lista resource records
   */
  listResourceRecords(zoneId) {
    zoneId = this.normalizeZoneId(zoneId);
    if (!this.hostedZones.has(zoneId)) {
      throw new Error(`Hosted Zone não encontrada: ${zoneId}`);
    }
    return this.resourceRecords.get(zoneId) || [];
  }

  /**
   * Deleta resource record
   */
  deleteResourceRecord(zoneId, name, type) {
    zoneId = this.normalizeZoneId(zoneId);
    if (!this.resourceRecords.has(zoneId)) {
      throw new Error(`Hosted Zone não encontrada: ${zoneId}`);
    }

    const records = this.resourceRecords.get(zoneId);
    const index = records.findIndex(r => r.Name === name && r.Type === type);

    if (index === -1) {
      throw new Error(`Resource Record não encontrado: ${name} (${type})`);
    }

    records.splice(index, 1);

    const zone = this.hostedZones.get(zoneId);
    zone.ResourceRecordSetCount = records.length;

    this.persistData();
    logger.info(`✅ Resource Record deletado: ${name} (${type})`);
    return true;
  }

  /**
   * Cria um health check
   */
  createHealthCheck(config = {}) {
    const healthCheck = new HealthCheck(config);
    this.healthChecks.set(healthCheck.Id, healthCheck);
    this.persistData();
    logger.info(`✅ Health Check criado: ${healthCheck.Id}`);
    return healthCheck;
  }

  /**
   * Lista health checks
   */
  listHealthChecks() {
    return Array.from(this.healthChecks.values());
  }

  /**
   * Obtém health check
   */
  getHealthCheck(id) {
    return this.healthChecks.get(id);
  }

  /**
   * Deleta health check
   */
  deleteHealthCheck(id) {
    if (!this.healthChecks.has(id)) {
      throw new Error(`Health Check não encontrado: ${id}`);
    }

    this.healthChecks.delete(id);
    this.persistData();
    logger.info(`✅ Health Check deletado: ${id}`);
    return true;
  }

  /**
   * Resolve DNS query (simular resolução)
   */
  resolveDNS(domain, type = 'A', queryType = 'weighted') {
    // Procurar a zona apropriada
    let zone = null;
    let zoneDomain = null;

    for (const z of this.hostedZones.values()) {
      if (domain.endsWith(z.Name.replace(/\.$/, ''))) {
        zone = z;
        zoneDomain = z.Name;
        break;
      }
    }

    if (!zone) {
      throw new Error(`Zona não encontrada para domínio: ${domain}`);
    }

    const records = this.resourceRecords.get(zone.Id) || [];
    let matchedRecords = records.filter(r => r.Name === domain && r.Type === type);

    if (matchedRecords.length === 0) {
      throw new Error(`Nenhum registro encontrado para: ${domain} (${type})`);
    }

    // Aplicar estratégia de resolução
    let selected = matchedRecords;
    if (queryType === 'weighted' && matchedRecords.some(r => r.Weight !== null)) {
      selected = ResourceRecord.selectWeightedRecords(matchedRecords);
    } else if (queryType === 'geolocation') {
      selected = ResourceRecord.selectGeoLocationRecords(matchedRecords);
    } else if (queryType === 'failover' && matchedRecords.some(r => r.Failover)) {
      const healthyIds = Array.from(this.healthChecks.values())
        .filter(hc => hc.Status === 'Healthy')
        .map(hc => hc.Id);
      selected = ResourceRecord.selectFailoverRecords(matchedRecords, healthyIds);
    }

    return {
      domain,
      type,
      records: selected,
      resolvedAt: new Date().toISOString(),
    };
  }

  /**
   * Inicia health check periódico
   */
  startHealthCheckInterval() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    this.healthCheckInterval = setInterval(() => {
      for (const hc of this.healthChecks.values()) {
        hc.check();
      }
      this.persistData();
    }, 30000); // 30 segundos
  }

  /**
   * Para health check periódico
   */
  stopHealthCheckInterval() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}

module.exports = Route53Simulator;

