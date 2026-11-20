'use strict';

/**
 * RDS Management API do simulador de SQL Server.
 * Implementa clusters, instâncias e tags no mesmo formato do RDS real.
 */

const logger = require('../../utils/logger');

const ALLOWED_MODIFY_FIELDS = new Set([
  'EngineVersion',
  'Port',
  'MasterUsername',
  'DatabaseName',
  'StorageEncrypted',
  'KmsKeyId',
  'Status',
  'LicenseModel',
  'CharacterSet',
  'Timezone',
]);

// A CLI RDS usa `Tags.Tag.N` e `TagKeys.member.N`; o SDK JSON envia listas prontas.
const MEMBER_RE = /^([A-Za-z][A-Za-z0-9]*)\.(?:member|Tag|TagKey)\.(\d+)(?:\.(.+))?$/;

function coerceScalar(value) {
  if (typeof value !== 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value) && !/^-?0\d/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return value;
}

function setNested(target, path, value) {
  const parts = String(path).split('.');
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== 'object') current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Converte parâmetros do protocolo query (`Tags.member.1.Key=...`) em objetos.
 * Objetos enviados por clientes JSON passam sem alteração.
 */
function normalizeParams(body) {
  const out = {};
  for (const [key, rawValue] of Object.entries(body || {})) {
    const value = coerceScalar(rawValue);
    const match = MEMBER_RE.exec(key);
    if (!match) {
      out[key] = value;
      continue;
    }

    const [, name, indexText, nestedPath] = match;
    const index = Number(indexText) - 1;
    if (!Array.isArray(out[name])) out[name] = [];
    if (!out[name][index]) out[name][index] = {};
    if (nestedPath) {
      setNested(out[name][index], nestedPath, value);
    } else {
      out[name][index] = value;
    }
  }
  return out;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function fail(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

class RdsApiHandler {
  constructor(clusterManager, dbEngine, log) {
    this.clusterManager = clusterManager;
    this.dbEngine = dbEngine;
    this.logger = log || logger;

    // Serviços opcionais, injetados pelo ciclo de vida do simulador.
    this.kmsService = null;
    this.cloudTrailService = null;
  }

  async handleRequest(action, rawBody) {
    const body = normalizeParams(rawBody);
    switch (action) {
      case 'CreateDBCluster': return this.createDBCluster(body);
      case 'DescribeDBClusters': return this.describeDBClusters(body);
      case 'DeleteDBCluster': return this.deleteDBCluster(body);
      case 'CreateDBInstance': return this.createDBInstance(body);
      case 'DescribeDBInstances': return this.describeDBInstances(body);
      case 'DeleteDBInstance': return this.deleteDBInstance(body);
      case 'ModifyDBCluster': return this.modifyDBCluster(body);
      case 'StopDBCluster': return this.stopDBCluster(body);
      case 'StartDBCluster': return this.startDBCluster(body);
      case 'ListTagsForResource': return this.listTagsForResource(body);
      case 'AddTagsToResource': return this.addTagsToResource(body);
      case 'RemoveTagsFromResource': return this.removeTagsFromResource(body);
      default:
        return fail('InvalidAction', `Ação desconhecida: ${action}`, 400);
    }
  }

  async createDBCluster(params) {
    await this._validateKmsKey(params);

    // SQL Server usa `master` como database padrão quando não informado.
    const createParams = { ...params, DatabaseName: params.DatabaseName || 'master' };
    const cluster = this.clusterManager.createCluster(createParams);

    // Cria o arquivo SQLite lógico associado ao database inicial.
    const dbName = createParams.DatabaseName;
    if (dbName && this.dbEngine) this.dbEngine.getOrCreateDatabase(dbName);

    this._recordEvent('CreateDBCluster', params.DBClusterIdentifier, 'AWS::RDS::DBCluster');
    return { DBCluster: cluster };
  }

  async describeDBClusters(params) {
    const filters = params.DBClusterIdentifier ? { DBClusterIdentifier: params.DBClusterIdentifier } : undefined;
    return { DBClusters: this.clusterManager.listClusters(filters) };
  }

  async deleteDBCluster(params) {
    const { DBClusterIdentifier } = params;
    if (!DBClusterIdentifier) fail('InvalidParameterValue', 'DBClusterIdentifier é obrigatório');

    this.clusterManager.deleteCluster(DBClusterIdentifier);
    this._recordEvent('DeleteDBCluster', DBClusterIdentifier, 'AWS::RDS::DBCluster');
    return {};
  }

  async createDBInstance(params) {
    const instance = this.clusterManager.createInstance(params);
    this._recordEvent('CreateDBInstance', params.DBInstanceIdentifier, 'AWS::RDS::DBInstance');
    return { DBInstance: instance };
  }

  async describeDBInstances(params) {
    const filters = params.DBInstanceIdentifier ? { DBInstanceIdentifier: params.DBInstanceIdentifier } : undefined;
    return { DBInstances: this.clusterManager.listInstances(filters) };
  }

  async deleteDBInstance(params) {
    const { DBInstanceIdentifier } = params;
    if (!DBInstanceIdentifier) fail('InvalidParameterValue', 'DBInstanceIdentifier é obrigatório');

    this.clusterManager.deleteInstance(DBInstanceIdentifier);
    this._recordEvent('DeleteDBInstance', DBInstanceIdentifier, 'AWS::RDS::DBInstance');
    return {};
  }

  async modifyDBCluster(params) {
    const { DBClusterIdentifier, ...rest } = params;
    if (!DBClusterIdentifier) fail('InvalidParameterValue', 'DBClusterIdentifier é obrigatório');

    const fields = {};
    for (const [key, value] of Object.entries(rest)) {
      if (ALLOWED_MODIFY_FIELDS.has(key)) fields[key] = value;
    }

    await this._validateKmsKey({ ...fields, DBClusterIdentifier });
    const cluster = this.clusterManager.updateCluster(DBClusterIdentifier, fields);
    this._recordEvent('ModifyDBCluster', DBClusterIdentifier, 'AWS::RDS::DBCluster');
    return { DBCluster: cluster };
  }

  async stopDBCluster(params) {
    const { DBClusterIdentifier } = params;
    if (!DBClusterIdentifier) fail('InvalidParameterValue', 'DBClusterIdentifier é obrigatório');

    const cluster = this.clusterManager.updateCluster(DBClusterIdentifier, { Status: 'stopped' });
    this._recordEvent('StopDBCluster', DBClusterIdentifier, 'AWS::RDS::DBCluster');
    return { DBCluster: cluster };
  }

  async startDBCluster(params) {
    const { DBClusterIdentifier } = params;
    if (!DBClusterIdentifier) fail('InvalidParameterValue', 'DBClusterIdentifier é obrigatório');

    const cluster = this.clusterManager.updateCluster(DBClusterIdentifier, { Status: 'available' });
    this._recordEvent('StartDBCluster', DBClusterIdentifier, 'AWS::RDS::DBCluster');
    return { DBCluster: cluster };
  }

  /**
   * O protocolo query da AWS usa ResourceName para as operações de tag (o campo do modelo é
   * ResourceArn). Aceitamos os dois nomes para compatibilidade com a CLI e com o SDK.
   * @private
   */
  _resourceArn(params) {
    const resourceArn = params.ResourceArn || params.ResourceName;
    if (!resourceArn) fail('InvalidParameterValue', 'ResourceName/ResourceArn é obrigatório');
    return resourceArn;
  }

  async listTagsForResource(params) {
    const resourceArn = this._resourceArn(params);
    return { TagList: this.clusterManager.listTags(resourceArn) };
  }

  async addTagsToResource(params) {
    const resourceArn = this._resourceArn(params);
    const tags = asArray(params.Tags);
    if (!tags.length) fail('InvalidParameterValue', 'Tags é obrigatório');

    this.clusterManager.addTags(resourceArn, tags);
    this._recordEvent('AddTagsToResource', resourceArn, 'AWS::RDS::DBCluster');
    return {};
  }

  async removeTagsFromResource(params) {
    const resourceArn = this._resourceArn(params);
    const keys = asArray(params.TagKeys).map((key) => (typeof key === 'object' ? key.Key : key)).filter(Boolean);
    if (!keys.length) fail('InvalidParameterValue', 'TagKeys é obrigatório');

    this.clusterManager.removeTags(resourceArn, keys);
    this._recordEvent('RemoveTagsFromResource', resourceArn, 'AWS::RDS::DBCluster');
    return {};
  }

  async _validateKmsKey(params) {
    if (!params.StorageEncrypted || !params.KmsKeyId || !this.kmsService) return;
    try {
      await this.kmsService.describeKey({ KeyId: params.KmsKeyId });
    } catch {
      fail('InvalidParameterValue', `Chave KMS inválida ou inexistente: ${params.KmsKeyId}`);
    }
  }

  _recordEvent(eventName, resourceId, resourceType) {
    if (!this.cloudTrailService) return;
    try {
      this.cloudTrailService.recordEvent({
        eventSource: 'rds.amazonaws.com',
        eventName,
        resources: [{ ResourceType: resourceType || 'AWS::RDS::DBCluster', ResourceName: resourceId || 'unknown' }],
        requestParameters: { resourceId: resourceId || 'unknown' },
      });
    } catch (error) {
      this.logger.debug(`[RDS SQL Server] Falha ao registrar evento no CloudTrail: ${error.message}`);
    }
  }
}

module.exports = { RdsApiHandler, normalizeParams };
