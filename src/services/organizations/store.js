/**
 * Organizations Store - Persistência em JSON
 */

const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

class OrganizationsStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.organizationsDir = path.join(dataDir, 'organizations');
    this.metadataFile = path.join(this.organizationsDir, '__metadata__.json');

    if (!fs.existsSync(this.organizationsDir)) {
      fs.mkdirSync(this.organizationsDir, { recursive: true });
    }
  }

  /**
   * Carrega metadados da organização
   */
  loadOrganizationMetadata() {
    if (fs.existsSync(this.metadataFile)) {
      try {
        const data = fs.readFileSync(this.metadataFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler ${this.metadataFile}: ${error.message}`);
        return null;
      }
    }
    return null;
  }

  /**
   * Salva metadados da organização
   */
  saveOrganizationMetadata(metadata) {
    try {
      fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2), 'utf8');
      logger.debug(`Metadados da organização salvos em ${this.metadataFile}`);
    } catch (error) {
      logger.error(`Erro ao salvar ${this.metadataFile}: ${error.message}`);
    }
  }

  /**
   * Carrega OUs
   */
  loadOrganizationalUnits() {
    const ouFile = path.join(this.organizationsDir, '__ous__.json');
    
    if (fs.existsSync(ouFile)) {
      try {
        const data = fs.readFileSync(ouFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler OUs: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva OUs
   */
  saveOrganizationalUnits(ous) {
    try {
      const ouFile = path.join(this.organizationsDir, '__ous__.json');
      const data = {};

      for (const [ouId, ou] of ous) {
        data[ouId] = ou;
      }

      fs.writeFileSync(ouFile, JSON.stringify(data, null, 2), 'utf8');
      logger.debug(`${Object.keys(data).length} OUs salvas`);
    } catch (error) {
      logger.error(`Erro ao salvar OUs: ${error.message}`);
    }
  }

  /**
   * Carrega contas
   */
  loadAccounts() {
    const accountsFile = path.join(this.organizationsDir, '__accounts__.json');
    
    if (fs.existsSync(accountsFile)) {
      try {
        const data = fs.readFileSync(accountsFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler contas: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva contas
   */
  saveAccounts(accounts) {
    try {
      const accountsFile = path.join(this.organizationsDir, '__accounts__.json');
      const data = {};

      for (const [accountId, account] of accounts) {
        data[accountId] = account;
      }

      fs.writeFileSync(accountsFile, JSON.stringify(data, null, 2), 'utf8');
      logger.debug(`${Object.keys(data).length} contas salvas`);
    } catch (error) {
      logger.error(`Erro ao salvar contas: ${error.message}`);
    }
  }

  /**
   * Carrega policies
   */
  loadPolicies() {
    const policiesFile = path.join(this.organizationsDir, '__policies__.json');
    
    if (fs.existsSync(policiesFile)) {
      try {
        const data = fs.readFileSync(policiesFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler policies: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva policies
   */
  savePolicies(policies) {
    try {
      const policiesFile = path.join(this.organizationsDir, '__policies__.json');
      const data = {};

      for (const [policyId, policy] of policies) {
        data[policyId] = {
          id: policy.id,
          name: policy.name,
          document: policy.document,
          type: policy.type,
          status: policy.status,
          targets: policy.targets,
          createdAt: policy.createdAt,
          lastModifiedAt: policy.lastModifiedAt
        };
      }

      fs.writeFileSync(policiesFile, JSON.stringify(data, null, 2), 'utf8');
      logger.debug(`${Object.keys(data).length} policies salvas`);
    } catch (error) {
      logger.error(`Erro ao salvar policies: ${error.message}`);
    }
  }

  /**
   * Carrega roles
   */
  loadRoles() {
    const rolesFile = path.join(this.organizationsDir, '__roles__.json');
    
    if (fs.existsSync(rolesFile)) {
      try {
        const data = fs.readFileSync(rolesFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler roles: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva roles
   */
  saveRoles(roles) {
    try {
      const rolesFile = path.join(this.organizationsDir, '__roles__.json');
      const data = {};

      for (const [roleId, role] of roles) {
        data[roleId] = {
          id: role.id,
          name: role.name,
          arn: role.arn,
          accountId: role.accountId,
          trustPolicy: role.trustPolicy,
          inlinePolicies: Array.from(role.inlinePolicies.entries()),
          managedPolicies: role.managedPolicies,
          createdAt: role.createdAt,
          lastModifiedAt: role.lastModifiedAt
        };
      }

      fs.writeFileSync(rolesFile, JSON.stringify(data, null, 2), 'utf8');
      logger.debug(`${Object.keys(data).length} roles salvas`);
    } catch (error) {
      logger.error(`Erro ao salvar roles: ${error.message}`);
    }
  }

  /**
   * Limpa tudo
   */
  clear() {
    try {
      if (fs.existsSync(this.organizationsDir)) {
        const files = fs.readdirSync(this.organizationsDir);
        files.forEach(file => {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.organizationsDir, file));
          }
        });
        logger.debug('Todos os dados de organizações foram limpos');
      }
    } catch (error) {
      logger.error(`Erro ao limpar organizações: ${error.message}`);
    }
  }
}

module.exports = OrganizationsStore;
