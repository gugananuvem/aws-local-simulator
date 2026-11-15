'use strict';

/**
 * Modelo de domínios OpenSearch (control plane do AWS CLI `opensearch ...`).
 * Operações: CreateDomain, DescribeDomain, ListDomainNames, DeleteDomain.
 * Persistência: entidade 'domains' do LocalStore.
 */
const ACCOUNT_ID = '000000000000';
const REGION = process.env.AWS_REGION || process.env.REGION || 'us-east-1';
const DEFAULT_ENGINE = 'OpenSearch_2.11';

class DomainError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

class OpenSearchDomains {
  constructor(store) {
    this.store = store;
    this.domains = new Map(); // DomainName -> DomainStatus
  }

  load() {
    const saved = this.store ? this.store.read('domains') : null;
    this.domains.clear();
    for (const status of Array.isArray(saved) ? saved : []) {
      this.domains.set(status.DomainName, status);
    }
  }

  persist() {
    if (this.store) this.store.write('domains', Array.from(this.domains.values()));
  }

  createDomain(params = {}) {
    const name = params.DomainName;
    if (!name || typeof name !== 'string') {
      throw new DomainError('ValidationException', 'DomainName is required', 400);
    }
    if (this.domains.has(name)) {
      throw new DomainError('ResourceAlreadyExistsException', `Domain already exists: ${name}`);
    }
    const status = {
      DomainId: `${ACCOUNT_ID}/${name}`,
      DomainName: name,
      ARN: `arn:aws:es:${REGION}:${ACCOUNT_ID}:domain/${name}`,
      Created: true,
      Deleted: false,
      EngineVersion: params.EngineVersion || DEFAULT_ENGINE,
      ClusterConfig: {
        InstanceType: params.ClusterConfig?.InstanceType || 'm5.large.search',
        InstanceCount: params.ClusterConfig?.InstanceCount || 1,
        DedicatedMasterEnabled: false,
        ZoneAwarenessEnabled: false,
      },
      Processing: false,
      UpgradeProcessing: false,
    };
    this.domains.set(name, status);
    this.persist();
    return status;
  }

  describeDomain(name) {
    const status = this.domains.get(name);
    if (!status) {
      throw new DomainError('ResourceNotFoundException', `Domain not found: ${name}`);
    }
    return status;
  }

  listDomainNames() {
    return Array.from(this.domains.keys()).map((DomainName) => ({ DomainName, EngineType: 'OpenSearch' }));
  }

  deleteDomain(name) {
    const status = this.domains.get(name);
    if (!status) {
      throw new DomainError('ResourceNotFoundException', `Domain not found: ${name}`);
    }
    this.domains.delete(name);
    this.persist();
    return { ...status, Deleted: true };
  }

  reset() {
    this.domains.clear();
    this.persist();
  }
}

module.exports = { OpenSearchDomains, DomainError };
