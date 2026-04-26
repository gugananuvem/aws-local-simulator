'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');

/**
 * Parameter Store (SSM) Simulator
 */
class ParameterStoreSimulator {
  constructor(store, logger, config) {
    this.store = store; this.logger = logger; this.config = config;
    this.parameters = new Map();
    this.history = new Map();
    this.audit = new CloudTrailAudit('ssm.amazonaws.com');
  }

  async initialize() {
    try {
      const params = await this.store.read('parameter-store/parameters');
      if (Array.isArray(params)) for (const p of params) this.parameters.set(p.Name, p);
      const history = await this.store.read('parameter-store/history');
      if (Array.isArray(history)) for (const h of history) this.history.set(h.name, h.versions);
      this.logger.info('ParameterStore: dados carregados', 'parameter-store');
    } catch { this.logger.debug('ParameterStore: sem dados anteriores', 'parameter-store'); }
  }

  async _persist() {
    await this.store.write('parameter-store/parameters', null, Array.from(this.parameters.values()));
    const histArr = Array.from(this.history.entries()).map(([name, versions]) => ({ name, versions }));
    await this.store.write('parameter-store/history', null, histArr);
  }

  _require(name) {
    const p = this.parameters.get(name);
    if (!p) { const err = new Error(`Parameter not found: ${name}`); err.code = 'ParameterNotFound'; throw err; }
    return p;
  }

  async putParameter(params) {
    const { Name, Value, Type = 'String', Description, Overwrite, Tags = [], KeyId, AllowedPattern, DataType = 'text' } = params;
    if (this.parameters.has(Name) && !Overwrite) {
      const err = new Error(`Parameter already exists: ${Name}`); err.code = 'ParameterAlreadyExists'; throw err;
    }
    if (AllowedPattern && !new RegExp(AllowedPattern).test(Value)) {
      const err = new Error(`Value doesn't match pattern: ${AllowedPattern}`); err.code = 'ParameterPatternMismatch'; throw err;
    }
    const existing = this.parameters.get(Name);
    const version = existing ? existing.Version + 1 : 1;
    const storedValue = Type === 'SecureString' ? this._encrypt(Value) : Value;
    const param = {
      Name, Value: storedValue, Type, Description: Description || '', Version: version,
      LastModifiedDate: Math.floor(Date.now() / 1000),
      LastModifiedUser: 'local',
      ARN: `arn:aws:ssm:local:000000000000:parameter${Name}`,
      DataType, Tags: Tags || [], KeyId: Type === 'SecureString' ? (KeyId || 'aws/ssm') : undefined
    };
    this.parameters.set(Name, param);
    // History
    if (!this.history.has(Name)) this.history.set(Name, []);
    this.history.get(Name).push({ ...param, Value });
    await this._persist();
    this.logger.info(`ParameterStore: parâmetro definido: ${Name}`, 'parameter-store');
    this.audit.record({ eventName: 'PutParameter', readOnly: false, isDataEvent: true, resources: [{ ARN: param.ARN, type: 'AWS::SSM::Parameter' }], requestParameters: { name: Name, type: Type } });
    return { Version: version, Tier: 'Standard' };
  }

  async getParameter(params) {
    const { Name, WithDecryption } = params;
    const param = this._require(Name);
    const value = (WithDecryption && param.Type === 'SecureString') ? this._decrypt(param.Value) : param.Value;
    this.audit.record({ eventName: 'GetParameter', readOnly: true, isDataEvent: true, resources: [{ ARN: param.ARN, type: 'AWS::SSM::Parameter' }], requestParameters: { name: Name } });
    return { Parameter: { ...param, Value: value } };
  }

  async getParameters(params) {
    const { Names, WithDecryption } = params;
    const found = []; const invalid = [];
    for (const name of Names) {
      try {
        const param = this._require(name);
        const value = (WithDecryption && param.Type === 'SecureString') ? this._decrypt(param.Value) : param.Value;
        found.push({ ...param, Value: value });
      } catch { invalid.push(name); }
    }
    return { Parameters: found, InvalidParameters: invalid };
  }

  async getParametersByPath(params) {
    const { Path, Recursive, WithDecryption, MaxResults = 10, NextToken, ParameterFilters = [] } = params;
    let results = Array.from(this.parameters.values()).filter(p => {
      if (Recursive) return p.Name.startsWith(Path);
      const rest = p.Name.slice(Path.length);
      return p.Name.startsWith(Path) && !rest.includes('/');
    });
    for (const filter of ParameterFilters) {
      if (filter.Key === 'Type') results = results.filter(p => filter.Values.includes(p.Type));
    }
    let startIdx = 0;
    if (NextToken) startIdx = parseInt(NextToken);
    const slice = results.slice(startIdx, startIdx + MaxResults);
    return {
      Parameters: slice.map(p => ({
        ...p, Value: (WithDecryption && p.Type === 'SecureString') ? this._decrypt(p.Value) : p.Value
      })),
      NextToken: results.length > startIdx + MaxResults ? String(startIdx + MaxResults) : undefined
    };
  }

  async deleteParameter(params) {
    const p = this._require(params.Name);
    this.parameters.delete(params.Name);
    await this._persist();
    this.audit.record({ eventName: 'DeleteParameter', readOnly: false, resources: [{ ARN: p.ARN, type: 'AWS::SSM::Parameter' }], requestParameters: { name: params.Name } });
    return {};
  }

  async deleteParameters(params) {
    const { Names } = params;
    const deleted = []; const invalid = [];
    for (const name of Names) {
      if (this.parameters.has(name)) { this.parameters.delete(name); deleted.push(name); }
      else invalid.push(name);
    }
    await this._persist();
    return { DeletedParameters: deleted, InvalidParameters: invalid };
  }

  async describeParameters(params) {
    const { Filters = [], ParameterFilters = [], MaxResults = 50, NextToken } = params || {};
    let results = Array.from(this.parameters.values());
    for (const f of Filters) {
      if (f.Key === 'Name') results = results.filter(p => f.Values.some(v => p.Name.includes(v)));
      if (f.Key === 'Type') results = results.filter(p => f.Values.includes(p.Type));
    }
    let startIdx = 0;
    if (NextToken) startIdx = parseInt(NextToken);
    const slice = results.slice(startIdx, startIdx + MaxResults);
    return {
      Parameters: slice.map(({ Value, ...p }) => p),
      NextToken: results.length > startIdx + MaxResults ? String(startIdx + MaxResults) : undefined
    };
  }

  async getParameterHistory(params) {
    const { Name, MaxResults = 50, NextToken } = params;
    this._require(Name);
    const history = this.history.get(Name) || [];
    let startIdx = 0;
    if (NextToken) startIdx = parseInt(NextToken);
    const slice = history.slice(startIdx, startIdx + MaxResults);
    return {
      Parameters: slice,
      NextToken: history.length > startIdx + MaxResults ? String(startIdx + MaxResults) : undefined
    };
  }

  async addTagsToResource(params) {
    const { ResourceType, ResourceId, Tags } = params;
    if (ResourceType === 'Parameter') {
      const param = this._require(ResourceId);
      for (const tag of Tags) { const idx = param.Tags.findIndex(t => t.Key === tag.Key); if (idx >= 0) param.Tags[idx] = tag; else param.Tags.push(tag); }
      await this._persist();
    }
    return {};
  }

  async removeTagsFromResource(params) {
    const { ResourceType, ResourceId, TagKeys } = params;
    if (ResourceType === 'Parameter') {
      const param = this._require(ResourceId);
      param.Tags = param.Tags.filter(t => !TagKeys.includes(t.Key));
      await this._persist();
    }
    return {};
  }

  _encrypt(value) {
    const key = crypto.createHash('sha256').update('local-ssm-key').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  _decrypt(encrypted) {
    try {
      const key = crypto.createHash('sha256').update('local-ssm-key').digest();
      const buf = Buffer.from(encrypted, 'base64');
      const iv = buf.slice(0, 12); const tag = buf.slice(12, 28); const enc = buf.slice(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch { return encrypted; }
  }

  async reset() { this.parameters.clear(); this.history.clear(); await this.store.clear('parameter-store'); }
}

module.exports = { ParameterStoreSimulator };
