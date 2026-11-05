/**
 * Control Tower Store - Persistência de Landing Zones e Guardrails
 */

const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

class ControlTowerStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.controlTowerDir = path.join(dataDir, 'control-tower');
    this.metadataFile = path.join(this.controlTowerDir, '__metadata__.json');

    if (!fs.existsSync(this.controlTowerDir)) {
      fs.mkdirSync(this.controlTowerDir, { recursive: true });
    }
  }

  /**
   * Carrega landing zones
   */
  loadLandingZones() {
    const landingZonesFile = path.join(this.controlTowerDir, '__landing_zones__.json');
    
    if (fs.existsSync(landingZonesFile)) {
      try {
        const data = fs.readFileSync(landingZonesFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler landing zones: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva landing zones
   */
  saveLandingZones(landingZones) {
    try {
      const landingZonesFile = path.join(this.controlTowerDir, '__landing_zones__.json');
      const data = {};

      for (const [lzId, lz] of landingZones) {
        data[lzId] = lz;
      }

      fs.writeFileSync(landingZonesFile, JSON.stringify(data, null, 2), 'utf8');
      logger.debug(`${Object.keys(data).length} landing zones salvas`);
    } catch (error) {
      logger.error(`Erro ao salvar landing zones: ${error.message}`);
    }
  }

  /**
   * Carrega guardrails
   */
  loadGuardrails() {
    const guardrailsFile = path.join(this.controlTowerDir, '__guardrails__.json');
    
    if (fs.existsSync(guardrailsFile)) {
      try {
        const data = fs.readFileSync(guardrailsFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler guardrails: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva guardrails
   */
  saveGuardrails(guardrails) {
    try {
      const guardrailsFile = path.join(this.controlTowerDir, '__guardrails__.json');
      const data = {};

      for (const [guardrailId, guardrail] of guardrails) {
        data[guardrailId] = guardrail;
      }

      fs.writeFileSync(guardrailsFile, JSON.stringify(data, null, 2), 'utf8');
      logger.debug(`${Object.keys(data).length} guardrails salvos`);
    } catch (error) {
      logger.error(`Erro ao salvar guardrails: ${error.message}`);
    }
  }

  /**
   * Carrega status de guardrails por OU
   */
  loadGuardrailStatus() {
    const statusFile = path.join(this.controlTowerDir, '__guardrail_status__.json');
    
    if (fs.existsSync(statusFile)) {
      try {
        const data = fs.readFileSync(statusFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler status de guardrails: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva status de guardrails
   */
  saveGuardrailStatus(guardrailStatus) {
    try {
      const statusFile = path.join(this.controlTowerDir, '__guardrail_status__.json');
      const data = {};

      for (const [ouId, guardrails] of guardrailStatus) {
        data[ouId] = guardrails;
      }

      fs.writeFileSync(statusFile, JSON.stringify(data, null, 2), 'utf8');
      logger.debug(`Status de guardrails salvo`);
    } catch (error) {
      logger.error(`Erro ao salvar status de guardrails: ${error.message}`);
    }
  }

  /**
   * Carrega compliance checks
   */
  loadComplianceChecks() {
    const checksFile = path.join(this.controlTowerDir, '__compliance_checks__.json');
    
    if (fs.existsSync(checksFile)) {
      try {
        const data = fs.readFileSync(checksFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler compliance checks: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva compliance checks
   */
  saveComplianceChecks(checks) {
    try {
      const checksFile = path.join(this.controlTowerDir, '__compliance_checks__.json');
      fs.writeFileSync(checksFile, JSON.stringify(checks, null, 2), 'utf8');
      logger.debug(`Compliance checks salvos`);
    } catch (error) {
      logger.error(`Erro ao salvar compliance checks: ${error.message}`);
    }
  }

  /**
   * Limpa tudo
   */
  clear() {
    try {
      if (fs.existsSync(this.controlTowerDir)) {
        const files = fs.readdirSync(this.controlTowerDir);
        files.forEach(file => {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.controlTowerDir, file));
          }
        });
        logger.debug('Todos os dados de Control Tower foram limpos');
      }
    } catch (error) {
      logger.error(`Erro ao limpar Control Tower: ${error.message}`);
    }
  }
}

module.exports = ControlTowerStore;
