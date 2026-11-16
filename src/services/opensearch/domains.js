'use strict';

/**
 * Modelo de domínios OpenSearch (control plane do AWS CLI `opensearch ...`).
 * Operações: CreateDomain, DescribeDomain, ListDomainNames, DeleteDomain,
 * UpdateDomainConfig (ClusterConfig), AddTags, ListTags, RemoveTags.
 * Persistência: entidade 'domains' (DomainStatus) e 'domain-tags' (ARN -> {chave: valor}) do LocalStore.
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

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

class OpenSearchDomains {
  constructor(store) {
    this.store = store;
    this.domains = new Map(); // DomainName -> DomainStatus
    this.tags = new Map(); // ARN -> Map(chave -> valor), em ordem de inserção
  }

  load() {
    const saved = this.store ? this.store.read('domains') : null;
    this.domains.clear();
    for (const status of Array.isArray(saved) ? saved : []) {
      this.domains.set(status.DomainName, status);
    }
    const savedTags = this.store ? this.store.read('domain-tags') : null;
    this.tags.clear();
    if (isPlainObject(savedTags)) {
      for (const [arn, pairs] of Object.entries(savedTags)) {
        this.tags.set(arn, new Map(Object.entries(pairs || {})));
      }
    }
  }

  persist() {
    if (!this.store) return;
    this.store.write('domains', Array.from(this.domains.values()));
    const tagsObject = {};
    for (const [arn, pairs] of this.tags) {
      tagsObject[arn] = Object.fromEntries(pairs);
    }
    this.store.write('domain-tags', tagsObject);
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
    this.tags.delete(status.ARN);
    this.persist();
    return { ...status, Deleted: true };
  }

  /**
   * UpdateDomainConfig. Só ClusterConfig é modelado: InstanceType, InstanceCount,
   * DedicatedMasterEnabled e ZoneAwarenessEnabled. Campos ausentes mantêm o valor atual.
   * Outros campos são ignorados. Tipo inválido em campo modelado gera ValidationException.
   */
  updateDomainConfig(name, params = {}) {
    const status = this.describeDomain(name);
    const requested = params.ClusterConfig;
    if (requested === undefined) {
      return { ClusterConfig: { Options: { ...status.ClusterConfig } } };
    }
    if (!isPlainObject(requested)) {
      throw new DomainError('ValidationException', 'ClusterConfig must be an object', 400);
    }
    const merged = { ...status.ClusterConfig };
    if (requested.InstanceType !== undefined) {
      if (typeof requested.InstanceType !== 'string' || requested.InstanceType === '') {
        throw new DomainError('ValidationException', 'InstanceType must be a non-empty string', 400);
      }
      merged.InstanceType = requested.InstanceType;
    }
    if (requested.InstanceCount !== undefined) {
      if (!Number.isInteger(requested.InstanceCount) || requested.InstanceCount < 1) {
        throw new DomainError('ValidationException', 'InstanceCount must be an integer >= 1', 400);
      }
      merged.InstanceCount = requested.InstanceCount;
    }
    for (const flag of ['DedicatedMasterEnabled', 'ZoneAwarenessEnabled']) {
      if (requested[flag] !== undefined) {
        if (typeof requested[flag] !== 'boolean') {
          throw new DomainError('ValidationException', `${flag} must be a boolean`, 400);
        }
        merged[flag] = requested[flag];
      }
    }
    status.ClusterConfig = merged;
    this.persist();
    return { ClusterConfig: { Options: { ...merged } } };
  }

  /** Extrai o nome do domínio de um ARN `...:domain/<nome>`. */
  domainNameFromArn(arn) {
    const match = typeof arn === 'string' ? /:domain\/([^/]+)$/.exec(arn) : null;
    if (!match) {
      throw new DomainError('ValidationException', 'ARN must reference an OpenSearch domain (...:domain/<name>)', 400);
    }
    return match[1];
  }

  /** Confirma o domínio do ARN e devolve o nome. Região e conta não são checadas. */
  requireDomainForArn(arn) {
    const name = this.domainNameFromArn(arn);
    this.describeDomain(name);
    return name;
  }

  addTags(arn, tagList) {
    this.domainNameFromArn(arn);
    if (!Array.isArray(tagList)) {
      throw new DomainError('ValidationException', 'TagList must be an array', 400);
    }
    for (const tag of tagList) {
      if (!isPlainObject(tag) || typeof tag.Key !== 'string' || tag.Key === '' || typeof tag.Value !== 'string') {
        throw new DomainError('ValidationException', 'Each tag needs a non-empty string Key and a string Value', 400);
      }
    }
    this.requireDomainForArn(arn);
    const pairs = this.tags.get(arn) || new Map();
    for (const tag of tagList) pairs.set(tag.Key, tag.Value);
    this.tags.set(arn, pairs);
    this.persist();
  }

  listTags(arn) {
    this.requireDomainForArn(arn);
    const pairs = this.tags.get(arn) || new Map();
    return Array.from(pairs, ([Key, Value]) => ({ Key, Value }));
  }

  removeTags(arn, tagKeys) {
    this.domainNameFromArn(arn);
    if (!Array.isArray(tagKeys) || tagKeys.some((k) => typeof k !== 'string' || k === '')) {
      throw new DomainError('ValidationException', 'TagKeys must be an array of non-empty strings', 400);
    }
    this.requireDomainForArn(arn);
    const pairs = this.tags.get(arn);
    if (pairs) {
      for (const key of tagKeys) pairs.delete(key);
    }
    this.persist();
  }

  reset() {
    this.domains.clear();
    this.tags.clear();
    this.persist();
  }
}

module.exports = { OpenSearchDomains, DomainError };
