/**
 * AWS Control Tower Simulator
 * Gerencia landing zones, guardrails e conformidade
 */

const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ControlTowerSimulator {
  constructor(config, organizationsSimulator) {
    this.config = config;
    this.organizationsSimulator = organizationsSimulator;
    
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'control-tower');

    this.store = new LocalStore(this.dataDir);
    
    // Landing zones
    this.landingZones = new Map();
    
    // Guardrails (Preventive e Detective)
    this.guardrails = new Map();
    this.guardrailStatus = new Map(); // Mapear OU -> guardrails ativos
    
    // Compliance checks
    this.complianceChecks = new Map();
  }

  async initialize() {
    logger.debug('Inicializando Control Tower Simulator...');
    
    this.createDefaultGuardrails();
    logger.debug(`✅ Control Tower Simulator inicializado`);
  }

  /**
   * Cria guardrails padrão
   */
  createDefaultGuardrails() {
    // Preventive Guardrails
    this.createGuardrail('DisablePublicS3Buckets', 'PREVENTIVE', {
      description: 'Bloqueia criação de buckets S3 públicos',
      service: 's3',
      action: 'PutBucketPublicAccessBlock'
    });

    this.createGuardrail('RequireMFA', 'PREVENTIVE', {
      description: 'Requer MFA para operações sensíveis',
      service: 'iam',
      action: 'iam:*'
    });

    this.createGuardrail('RestrictEC2InstanceTypes', 'PREVENTIVE', {
      description: 'Restringe tipos de instância EC2 a tipos aprovados',
      service: 'ec2',
      action: 'ec2:RunInstances'
    });

    // Detective Guardrails
    this.createGuardrail('LogAllAPIActivity', 'DETECTIVE', {
      description: 'Detecta falta de CloudTrail logging',
      service: 'cloudtrail',
      action: 'cloudtrail:StartLogging'
    });

    this.createGuardrail('DetectRootAccountUsage', 'DETECTIVE', {
      description: 'Detecta uso de conta root',
      service: 'iam',
      action: 'root-account-usage'
    });

    this.createGuardrail('DetectUnencryptedData', 'DETECTIVE', {
      description: 'Detecta dados não criptografados',
      service: 'kms',
      action: 'kms:Encrypt'
    });
  }

  /**
   * Cria um guardrail
   */
  createGuardrail(name, type, config = {}) {
    const guardrailId = uuidv4().substring(0, 12);
    
    const guardrail = {
      id: guardrailId,
      name: name,
      type: type, // PREVENTIVE ou DETECTIVE
      arn: `arn:aws:controltower::123456789012:guardrail/${guardrailId}`,
      description: config.description || '',
      service: config.service,
      action: config.action,
      createdAt: new Date().toISOString(),
      status: 'ACTIVE'
    };

    this.guardrails.set(guardrailId, guardrail);
    return guardrail;
  }

  /**
   * Estabelece landing zone
   */
  setupLandingZone(organizationRootId, config = {}) {
    const landingZoneId = uuidv4().substring(0, 12);
    
    const landingZone = {
      id: landingZoneId,
      arn: `arn:aws:controltower::123456789012:landingzone/${landingZoneId}`,
      organizationRootId: organizationRootId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      version: '2.0',
      // OUs criadas pela Landing Zone
      ous: {
        managementOu: null,
        securityOu: null,
        sandboxOu: null
      },
      enabledGuardrails: [],
      complianceStatus: 'COMPLIANT'
    };

    this.landingZones.set(landingZoneId, landingZone);
    
    logger.info(`✅ Landing Zone estabelecida: ${landingZoneId}`);

    return {
      LandingZone: landingZone
    };
  }

  /**
   * Habilita guardrail em uma OU
   */
  enableGuardrail(guardrailId, targetOUId) {
    const guardrail = this.guardrails.get(guardrailId);
    if (!guardrail) {
      throw new Error(`Guardrail '${guardrailId}' not found`);
    }

    // Valida OU
    const organization = this.organizationsSimulator.organization;
    const ou = organization.getOrganizationalUnit(targetOUId);
    if (!ou) {
      throw new Error(`OU '${targetOUId}' not found`);
    }

    if (!this.guardrailStatus.has(targetOUId)) {
      this.guardrailStatus.set(targetOUId, []);
    }

    const enabledGuardrails = this.guardrailStatus.get(targetOUId);
    if (!enabledGuardrails.includes(guardrailId)) {
      enabledGuardrails.push(guardrailId);
    }

    logger.info(`✅ Guardrail habilitado: ${guardrail.name} em OU ${targetOUId}`);

    return {
      GuardrailStatus: {
        GuardrailId: guardrailId,
        TargetOUId: targetOUId,
        Status: 'ENABLED'
      }
    };
  }

  /**
   * Desabilita guardrail em uma OU
   */
  disableGuardrail(guardrailId, targetOUId) {
    const guardrails = this.guardrailStatus.get(targetOUId);
    if (!guardrails) {
      throw new Error(`No guardrails enabled for OU '${targetOUId}'`);
    }

    const index = guardrails.indexOf(guardrailId);
    if (index > -1) {
      guardrails.splice(index, 1);
    }

    logger.info(`✅ Guardrail desabilitado: ${guardrailId} em OU ${targetOUId}`);

    return {};
  }

  /**
   * Lista guardrails disponíveis
   */
  listGuardrails() {
    return {
      Guardrails: Array.from(this.guardrails.values())
    };
  }

  /**
   * Lista guardrails habilitados em uma OU
   */
  getGuardrailsForOU(ouId) {
    const enabledIds = this.guardrailStatus.get(ouId) || [];
    const enabledGuardrails = enabledIds.map(id => this.guardrails.get(id));

    return {
      Guardrails: enabledGuardrails.filter(g => g)
    };
  }

  /**
   * Verifica conformidade de um account
   */
  checkCompliance(accountId) {
    const organization = this.organizationsSimulator.organization;
    const account = organization.getAccount(accountId);
    
    if (!account) {
      throw new Error(`Account '${accountId}' not found`);
    }

    // Coleta guardrails aplicáveis
    const applicableGuardrails = [];
    
    let currentOUId = account.parentId;
    while (currentOUId) {
      const guardrails = this.guardrailStatus.get(currentOUId) || [];
      applicableGuardrails.push(...guardrails);
      
      const ou = organization.getOrganizationalUnit(currentOUId);
      currentOUId = ou?.parentId;
    }

    // Simula verificação de conformidade
    const results = {
      AccountId: accountId,
      ComplianceStatus: 'COMPLIANT',
      Guardrails: applicableGuardrails.map(guardrailId => {
        const guardrail = this.guardrails.get(guardrailId);
        return {
          GuardrailId: guardrailId,
          GuardrailName: guardrail?.name,
          Status: 'COMPLIANT', // Em produção seria baseado em verificações reais
          LastCheckedAt: new Date().toISOString()
        };
      })
    };

    return results;
  }

  /**
   * Gera relatório de conformidade
   */
  generateComplianceReport() {
    const organization = this.organizationsSimulator.organization;
    const accounts = organization.listAccounts();

    const report = {
      ReportId: uuidv4().substring(0, 12),
      GeneratedAt: new Date().toISOString(),
      AccountsChecked: accounts.length,
      CompliantAccounts: 0,
      NonCompliantAccounts: 0,
      AccountResults: accounts.map(account => {
        const compliance = this.checkCompliance(account.id);
        if (compliance.ComplianceStatus === 'COMPLIANT') {
          report.CompliantAccounts++;
        } else {
          report.NonCompliantAccounts++;
        }
        return compliance;
      })
    };

    return report;
  }

  /**
   * Obtém status da landing zone
   */
  getLandingZoneStatus(landingZoneId) {
    const landingZone = this.landingZones.get(landingZoneId);
    if (!landingZone) {
      throw new Error(`Landing Zone '${landingZoneId}' not found`);
    }

    return {
      LandingZone: landingZone
    };
  }

  /**
   * Obtém estatísticas
   */
  getStats() {
    return {
      landingZonesCount: this.landingZones.size,
      guardrailsCount: this.guardrails.size,
      preventiveGuardrailsCount: Array.from(this.guardrails.values()).filter(g => g.type === 'PREVENTIVE').length,
      detectiveGuardrailsCount: Array.from(this.guardrails.values()).filter(g => g.type === 'DETECTIVE').length,
      enabledGuardrailsCount: Array.from(this.guardrailStatus.values()).reduce((sum, arr) => sum + arr.length, 0)
    };
  }

  /**
   * Reset
   */
  async reset() {
    this.landingZones.clear();
    this.guardrailStatus.clear();
    this.guardrails.clear();
    
    this.createDefaultGuardrails();
    logger.info('✅ Control Tower Simulator resetado');
  }
}

module.exports = ControlTowerSimulator;
