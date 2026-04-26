'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');

/**
 * Secrets Manager Simulator
 */
class SecretManagerSimulator {
  constructor(store, logger, config) {
    this.store = store; this.logger = logger; this.config = config;
    this.secrets = new Map();
    this.audit = new CloudTrailAudit('secretsmanager.amazonaws.com');
  }

  async initialize() {
    try {
      const secrets = await this.store.read('secret-manager/secrets');
      if (Array.isArray(secrets)) {
        for (const s of secrets) {
          if (typeof s.CreatedDate === 'string') s.CreatedDate = Math.floor(new Date(s.CreatedDate).getTime() / 1000);
          if (typeof s.LastChangedDate === 'string') s.LastChangedDate = Math.floor(new Date(s.LastChangedDate).getTime() / 1000);
          if (s._versions) {
            for (const v of Object.values(s._versions)) {
              if (typeof v.CreatedDate === 'string') v.CreatedDate = Math.floor(new Date(v.CreatedDate).getTime() / 1000);
            }
          }
          this.secrets.set(s.Name, s);
        }
      }
      this.logger.info('SecretsManager: dados carregados', 'secret-manager');
    } catch { this.logger.debug('SecretsManager: sem dados anteriores', 'secret-manager'); }
  }

  async _persist() { await this.store.write('secret-manager/secrets', null, Array.from(this.secrets.values())); }

  _requireSecret(id) {
    const s = this.secrets.get(id) || Array.from(this.secrets.values()).find(s => s.ARN === id);
    if (!s) { const err = new Error(`Secret not found: ${id}`); err.code = 'ResourceNotFoundException'; throw err; }
    return s;
  }

  async createSecret(params) {
    const { Name, SecretString, SecretBinary, Description, Tags = [], KmsKeyId } = params;
    if (this.secrets.has(Name)) { const err = new Error(`Secret already exists: ${Name}`); err.code = 'ResourceExistsException'; throw err; }
    const secretId = uuidv4();
    const secret = {
      ARN: `arn:aws:secretsmanager:local:000000000000:secret:${Name}-${secretId.slice(0, 6)}`,
      Name, Description: Description || '', Tags,
      KmsKeyId: KmsKeyId || 'aws/secretsmanager',
      CreatedDate: Math.floor(Date.now() / 1000),
      LastChangedDate: Math.floor(Date.now() / 1000),
      LastAccessedDate: null,
      RotationEnabled: false,
      VersionsToStages: { [secretId]: ['AWSCURRENT'] },
      _versions: { [secretId]: { SecretString, SecretBinary, CreatedDate: Math.floor(Date.now() / 1000) } }
    };
    this.secrets.set(Name, secret);
    await this._persist();
    this.logger.info(`SecretsManager: secret criado: ${Name}`, 'secret-manager');
    this.audit.record({ eventName: 'CreateSecret', readOnly: false, resources: [{ ARN: secret.ARN, type: 'AWS::SecretsManager::Secret' }], requestParameters: { name: Name } });
    return { ARN: secret.ARN, Name, VersionId: secretId };
  }

  async getSecretValue(params) {
    const { SecretId, VersionId, VersionStage = 'AWSCURRENT' } = params;
    const secret = this._requireSecret(SecretId);
    secret.LastAccessedDate = Math.floor(Date.now() / 1000);
    let versionId = VersionId;
    if (!versionId) {
      versionId = Object.entries(secret.VersionsToStages).find(([, stages]) => stages.includes(VersionStage))?.[0];
    }
    const version = versionId ? secret._versions[versionId] : null;
    if (!version) { const err = new Error('Secret version not found'); err.code = 'ResourceNotFoundException'; throw err; }
    this.audit.record({ eventName: 'GetSecretValue', readOnly: true, isDataEvent: true, resources: [{ ARN: secret.ARN, type: 'AWS::SecretsManager::Secret' }], requestParameters: { secretId: SecretId } });
    return {
      ARN: secret.ARN, Name: secret.Name, VersionId: versionId,
      SecretString: version.SecretString, SecretBinary: version.SecretBinary,
      VersionStages: secret.VersionsToStages[versionId] || [],
      CreatedDate: version.CreatedDate
    };
  }

  async putSecretValue(params) {
    const { SecretId, SecretString, SecretBinary, VersionStages = ['AWSCURRENT'] } = params;
    const secret = this._requireSecret(SecretId);
    const versionId = uuidv4();
    // Move AWSCURRENT to AWSPREVIOUS
    for (const [vid, stages] of Object.entries(secret.VersionsToStages)) {
      if (stages.includes('AWSCURRENT')) {
        secret.VersionsToStages[vid] = stages.filter(s => s !== 'AWSCURRENT').concat(['AWSPREVIOUS']);
      }
    }
    secret._versions[versionId] = { SecretString, SecretBinary, CreatedDate: Math.floor(Date.now() / 1000) };
    secret.VersionsToStages[versionId] = VersionStages;
    secret.LastChangedDate = Math.floor(Date.now() / 1000);
    await this._persist();
    return { ARN: secret.ARN, Name: secret.Name, VersionId: versionId, VersionStages };
  }

  async updateSecret(params) {
    const { SecretId, SecretString, SecretBinary, Description, KmsKeyId } = params;
    const secret = this._requireSecret(SecretId);
    if (Description !== undefined) secret.Description = Description;
    if (KmsKeyId !== undefined) secret.KmsKeyId = KmsKeyId;
    if (SecretString !== undefined || SecretBinary !== undefined) {
      return this.putSecretValue({ SecretId, SecretString, SecretBinary });
    }
    await this._persist();
    return { ARN: secret.ARN, Name: secret.Name };
  }

  async deleteSecret(params) {
    const { SecretId, RecoveryWindowInDays = 30, ForceDeleteWithoutRecovery } = params;
    const secret = this._requireSecret(SecretId);
    const deletionDate = ForceDeleteWithoutRecovery ? Math.floor(Date.now() / 1000) : Math.floor((Date.now() + RecoveryWindowInDays * 86400000) / 1000);
    secret.DeletedDate = Math.floor(Date.now() / 1000);
    secret.DeletionDate = deletionDate;
    if (ForceDeleteWithoutRecovery) this.secrets.delete(secret.Name);
    await this._persist();
    this.audit.record({ eventName: 'DeleteSecret', readOnly: false, resources: [{ ARN: secret.ARN, type: 'AWS::SecretsManager::Secret' }], requestParameters: { secretId: SecretId } });
    return { ARN: secret.ARN, Name: secret.Name, DeletionDate: deletionDate };
  }

  async restoreSecret(params) {
    const secret = this._requireSecret(params.SecretId);
    delete secret.DeletedDate; delete secret.DeletionDate;
    await this._persist();
    return { ARN: secret.ARN, Name: secret.Name };
  }

  async listSecrets(params) {
    const { MaxResults = 100, NextToken, Filters = [] } = params || {};
    let secrets = Array.from(this.secrets.values());
    for (const filter of Filters) {
      if (filter.Key === 'name') secrets = secrets.filter(s => filter.Values.some(v => s.Name.includes(v)));
    }
    let startIdx = 0;
    if (NextToken) startIdx = parseInt(NextToken);
    const slice = secrets.slice(startIdx, startIdx + MaxResults);
    return {
      SecretList: slice.map(s => ({ ARN: s.ARN, Name: s.Name, Description: s.Description, CreatedDate: s.CreatedDate, LastChangedDate: s.LastChangedDate, Tags: s.Tags })),
      NextToken: secrets.length > startIdx + MaxResults ? String(startIdx + MaxResults) : undefined
    };
  }

  async describeSecret(params) {
    const secret = this._requireSecret(params.SecretId);
    const { _versions, ...clean } = secret;
    return clean;
  }

  async rotateSecret(params) {
    const { SecretId, RotationLambdaARN, RotationRules } = params;
    const secret = this._requireSecret(SecretId);
    secret.RotationEnabled = true;
    secret.RotationLambdaARN = RotationLambdaARN;
    secret.RotationRules = RotationRules;
    secret.LastRotatedDate = Math.floor(Date.now() / 1000);
    await this._persist();
    return { ARN: secret.ARN, Name: secret.Name };
  }

  async tagResource(params) {
    const { SecretId, Tags } = params;
    const secret = this._requireSecret(SecretId);
    for (const tag of Tags) { const existing = secret.Tags.findIndex(t => t.Key === tag.Key); if (existing >= 0) secret.Tags[existing] = tag; else secret.Tags.push(tag); }
    await this._persist(); return {};
  }

  async untagResource(params) {
    const { SecretId, TagKeys } = params;
    const secret = this._requireSecret(SecretId);
    secret.Tags = secret.Tags.filter(t => !TagKeys.includes(t.Key));
    await this._persist(); return {};
  }

  async reset() { this.secrets.clear(); await this.store.clear('secret-manager'); }
}

module.exports = { SecretManagerSimulator };
