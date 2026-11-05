/**
 * @fileoverview Schema Registry (metadados + busca).
 */

'use strict';

const {
  nowIso, buildArn, awsError, normalizeTags, paginate, clone,
} = require('./shared');

class SchemaFeature {
  /** @param {Object} simulator */
  constructor(simulator) {
    this.simulator = simulator;
    this.store = simulator.store;
    this.logger = simulator.logger;
    /** @type {Map<string, Object>} */
    this.registries = new Map();
    /** @type {Map<string, Object>} */
    this.schemas = new Map();
    /** @type {Map<string, Array<Object>>} */
    this.versions = new Map();
  }

  async load() {
    if (!this.registries.has('discovered-schemas')) {
      this._createDefaultRegistry();
    }

    const registries = await this.store.read('eventbridge/schema-registries');
    if (Array.isArray(registries)) {
      for (const registry of registries) {
        if (registry && registry.RegistryName && registry.RegistryName !== 'discovered-schemas') {
          this.registries.set(registry.RegistryName, registry);
        }
      }
    }

    const schemas = await this.store.read('eventbridge/schemas');
    if (Array.isArray(schemas)) {
      for (const schema of schemas) {
        if (schema && schema.SchemaName) {
          this.schemas.set(schema.SchemaKey || `${schema.RegistryName}|${schema.SchemaName}`, schema);
        }
      }
    }

    const versions = await this.store.read('eventbridge/schema-versions');
    if (Array.isArray(versions)) {
      for (const entry of versions) {
        if (!entry || !entry.key) continue;
        this.versions.set(entry.key, Array.isArray(entry.value) ? entry.value : []);
      }
    }
  }

  async save() {
    await this.store.write('eventbridge/schema-registries', null, Array.from(this.registries.values()));
    await this.store.write('eventbridge/schemas', null, Array.from(this.schemas.values()));
    const versionsList = Array.from(this.versions.entries()).map(([key, value]) => ({ key, value }));
    await this.store.write('eventbridge/schema-versions', null, versionsList);
  }

  async reset() {
    this.registries.clear();
    this.schemas.clear();
    this.versions.clear();
    this._createDefaultRegistry();
  }

  _createDefaultRegistry() {
    this.registries.set('discovered-schemas', {
      RegistryName: 'discovered-schemas',
      RegistryArn: buildArn(this.simulator, 'schemas', 'registry/discovered-schemas'),
      Description: 'Registry for discovered schemas',
      Tags: {},
    });
  }

  _schemaKey(registryName, schemaName) {
    return `${registryName}|${schemaName}`;
  }

  // ==================== Registries ====================

  async createRegistry(params = {}) {
    const { RegistryName, Description, Tags } = params;
    if (!RegistryName) throw awsError('ValidationException', 'RegistryName é obrigatório');
    if (this.registries.has(RegistryName)) {
      throw awsError('ResourceAlreadyExistsException', `Registry ${RegistryName} já existe`);
    }
    const registry = {
      RegistryName,
      RegistryArn: buildArn(this.simulator, 'schemas', `registry/${RegistryName}`),
      Description: Description || '',
      Tags: normalizeTags(Tags),
    };
    this.registries.set(RegistryName, registry);
    await this.save();
    return { RegistryArn: registry.RegistryArn };
  }

  describeRegistry(params = {}) {
    const registry = this.registries.get(params.RegistryName);
    if (!registry) throw awsError('ResourceNotFoundException', `Registry não encontrado: ${params.RegistryName}`);
    return { ...registry };
  }

  listRegistries(params = {}) {
    let registries = Array.from(this.registries.values());
    if (params.RegistryNamePrefix) {
      registries = registries.filter((registry) => registry.RegistryName.startsWith(params.RegistryNamePrefix));
    }
    return paginate(registries, params, 'Registries');
  }

  async deleteRegistry(params = {}) {
    if (params.RegistryName === 'discovered-schemas') {
      throw awsError('BadRequestException', 'Não é possível excluir o registry discovered-schemas');
    }
    const registry = this.registries.get(params.RegistryName);
    if (!registry) throw awsError('ResourceNotFoundException', `Registry não encontrado: ${params.RegistryName}`);
    this.registries.delete(params.RegistryName);
    for (const [key, schema] of this.schemas.entries()) {
      if (schema.RegistryName === params.RegistryName) this.schemas.delete(key);
    }
    await this.save();
    return {};
  }

  // ==================== Schemas ====================

  async createSchema(params = {}) {
    const { RegistryName = 'discovered-schemas', SchemaName, Type, Content, Description, Tags } = params;
    if (!SchemaName) throw awsError('ValidationException', 'SchemaName é obrigatório');
    if (!Type) throw awsError('ValidationException', 'Type é obrigatório');
    if (!Content) throw awsError('ValidationException', 'Content é obrigatório');
    if (!this.registries.has(RegistryName)) {
      throw awsError('ResourceNotFoundException', `Registry não encontrado: ${RegistryName}`);
    }

    const key = this._schemaKey(RegistryName, SchemaName);
    if (this.schemas.has(key)) {
      throw awsError('ResourceAlreadyExistsException', `Schema ${SchemaName} já existe`);
    }

    const schema = {
      SchemaName,
      SchemaArn: buildArn(this.simulator, 'schemas', `schema/${RegistryName}/${SchemaName}`),
      RegistryName,
      Type,
      Description: Description || '',
      Tags: normalizeTags(Tags),
      LastModified: nowIso(),
      VersionCreatedDate: nowIso(),
      SchemaVersion: '1',
    };

    const version = {
      SchemaVersion: '1',
      Type,
      Description: Description || '',
      CreatedDate: nowIso(),
      Content,
    };

    this.schemas.set(key, schema);
    this.versions.set(key, [version]);
    await this.save();
    this.logger.info('EventBridge', `Schema criado: ${RegistryName}/${SchemaName}`);

    return {
      SchemaArn: schema.SchemaArn,
      SchemaName,
      SchemaVersion: '1',
      Type,
    };
  }

  describeSchema(params = {}) {
    const key = this._schemaKey(params.RegistryName || 'discovered-schemas', params.SchemaName);
    const schema = this.schemas.get(key);
    if (!schema) throw awsError('ResourceNotFoundException', `Schema não encontrado: ${params.SchemaName}`);
    return { ...schema, Content: this._getVersionContent(key, params.SchemaVersion) };
  }

  _getVersionContent(key, version) {
    const list = this.versions.get(key) || [];
    if (!version) return list[list.length - 1]?.Content || '';
    return list.find((item) => item.SchemaVersion === version)?.Content || '';
  }

  async updateSchema(params = {}) {
    const key = this._schemaKey(params.RegistryName || 'discovered-schemas', params.SchemaName);
    const schema = this.schemas.get(key);
    if (!schema) throw awsError('ResourceNotFoundException', `Schema não encontrado: ${params.SchemaName}`);

    if (params.Description !== undefined) schema.Description = params.Description;
    if (params.Content !== undefined) {
      const nextVersion = String((Number(schema.SchemaVersion) || 1) + 1);
      schema.SchemaVersion = nextVersion;
      schema.LastModified = nowIso();
      schema.VersionCreatedDate = nowIso();
      const list = this.versions.get(key) || [];
      list.push({
        SchemaVersion: nextVersion,
        Type: schema.Type,
        Description: schema.Description,
        CreatedDate: nowIso(),
        Content: params.Content,
      });
      this.versions.set(key, list);
    }

    await this.save();
    return {
      SchemaArn: schema.SchemaArn,
      SchemaName: schema.SchemaName,
      SchemaVersion: schema.SchemaVersion,
      Type: schema.Type,
    };
  }

  async deleteSchema(params = {}) {
    const key = this._schemaKey(params.RegistryName || 'discovered-schemas', params.SchemaName);
    if (!this.schemas.has(key)) throw awsError('ResourceNotFoundException', `Schema não encontrado: ${params.SchemaName}`);
    this.schemas.delete(key);
    this.versions.delete(key);
    await this.save();
    return {};
  }

  listSchemas(params = {}) {
    let schemas = Array.from(this.schemas.values());
    if (params.RegistryName) {
      schemas = schemas.filter((schema) => schema.RegistryName === params.RegistryName);
    }
    if (params.SchemaNamePrefix) {
      schemas = schemas.filter((schema) => schema.SchemaName.startsWith(params.SchemaNamePrefix));
    }
    const list = schemas.map((schema) => ({
      SchemaArn: schema.SchemaArn,
      SchemaName: schema.SchemaName,
      RegistryName: schema.RegistryName,
      Type: schema.Type,
      SchemaVersion: schema.SchemaVersion,
      LastModified: schema.LastModified,
    }));
    return paginate(list, params, 'Schemas');
  }

  listSchemaVersions(params = {}) {
    const key = this._schemaKey(params.RegistryName || 'discovered-schemas', params.SchemaName);
    const versions = (this.versions.get(key) || []).map((version) => ({
      SchemaVersion: version.SchemaVersion,
      Type: version.Type,
      CreatedDate: version.CreatedDate,
    }));
    return paginate(versions, params, 'SchemaVersions');
  }

  getCodeBindingSource(params = {}) {
    const key = this._schemaKey(params.RegistryName || 'discovered-schemas', params.SchemaName);
    const schema = this.schemas.get(key);
    if (!schema) throw awsError('ResourceNotFoundException', `Schema não encontrado: ${params.SchemaName}`);
    const content = this._getVersionContent(key, params.SchemaVersion);
    return {
      Status: 'CREATE_COMPLETE',
      SchemaVersion: params.SchemaVersion || schema.SchemaVersion,
      CodeBindingSource: `// Código gerado pelo simulador (stub)\n// Registry: ${schema.RegistryName}\n// Schema: ${schema.SchemaName}\n// Type: ${schema.Type}\n\nexport const schema = ${JSON.stringify(content)};\n`,
    };
  }

  getStats() {
    return {
      registries: this.registries.size,
      schemas: this.schemas.size,
    };
  }
}

module.exports = { SchemaFeature };
