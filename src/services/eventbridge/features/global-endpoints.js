/**
 * @fileoverview Global endpoints (metadados para paridade com o console).
 */

'use strict';

const {
  nowIso, buildArn, awsError, normalizeTags, paginate, clone,
} = require('./shared');

class GlobalEndpointFeature {
  /** @param {Object} simulator */
  constructor(simulator) {
    this.simulator = simulator;
    this.store = simulator.store;
    this.logger = simulator.logger;
    /** @type {Map<string, Object>} */
    this.endpoints = new Map();
  }

  async load() {
    const endpoints = await this.store.read('eventbridge/global-endpoints');
    if (Array.isArray(endpoints)) {
      for (const endpoint of endpoints) {
        if (endpoint && endpoint.Name) this.endpoints.set(endpoint.Name, endpoint);
      }
    }
  }

  async save() {
    await this.store.write('eventbridge/global-endpoints', null, Array.from(this.endpoints.values()));
  }

  async reset() {
    this.endpoints.clear();
  }

  async createEndpoint(params = {}) {
    const { Name, RoleArn, Description, RoutingConfig, ReplicationConfig, EventBuses } = params;
    if (!Name) throw awsError('ValidationException', 'Name é obrigatório');
    if (this.endpoints.has(Name)) {
      throw awsError('ResourceAlreadyExistsException', `Global endpoint ${Name} já existe`);
    }

    const endpoint = {
      Name,
      Arn: buildArn(this.simulator, 'events', `endpoint/${Name}`),
      RoleArn: RoleArn || null,
      Description: Description || '',
      RoutingConfig: RoutingConfig || null,
      ReplicationConfig: ReplicationConfig || null,
      EventBuses: EventBuses || [],
      State: 'ACTIVE',
      StateReason: null,
      CreationTime: nowIso(),
    };

    this.endpoints.set(Name, endpoint);
    await this.save();
    this.logger.info('EventBridge', `Global endpoint criado: ${Name}`);
    return {
      EndpointArn: endpoint.Arn,
      State: endpoint.State,
    };
  }

  async updateEndpoint(params = {}) {
    const endpoint = this._findEndpoint(params.Name);
    if (!endpoint) throw awsError('ResourceNotFoundException', `Global endpoint não encontrado: ${params.Name}`);

    if (params.Description !== undefined) endpoint.Description = params.Description;
    if (params.RoleArn !== undefined) endpoint.RoleArn = params.RoleArn;
    if (params.RoutingConfig !== undefined) endpoint.RoutingConfig = params.RoutingConfig;
    if (params.ReplicationConfig !== undefined) endpoint.ReplicationConfig = params.ReplicationConfig;
    if (params.EventBuses !== undefined) endpoint.EventBuses = params.EventBuses;

    await this.save();
    return { EndpointArn: endpoint.Arn, State: endpoint.State };
  }

  async deleteEndpoint(params = {}) {
    const endpoint = this._findEndpoint(params.Name);
    if (!endpoint) throw awsError('ResourceNotFoundException', `Global endpoint não encontrado: ${params.Name}`);
    this.endpoints.delete(endpoint.Name);
    await this.save();
    return {};
  }

  describeEndpoint(params = {}) {
    const endpoint = this._findEndpoint(params.Name);
    if (!endpoint) throw awsError('ResourceNotFoundException', `Global endpoint não encontrado: ${params.Name}`);
    return clone(endpoint);
  }

  listEndpoints(params = {}) {
    let endpoints = Array.from(this.endpoints.values());
    if (params.NamePrefix) {
      endpoints = endpoints.filter((endpoint) => endpoint.Name.startsWith(params.NamePrefix));
    }
    return paginate(endpoints, params, 'Endpoints');
  }

  _findEndpoint(nameOrArn) {
    if (!nameOrArn) return null;
    if (this.endpoints.has(nameOrArn)) return this.endpoints.get(nameOrArn);
    return Array.from(this.endpoints.values()).find((endpoint) => endpoint.Arn === nameOrArn) || null;
  }

  getStats() {
    return { globalEndpoints: this.endpoints.size };
  }
}

module.exports = { GlobalEndpointFeature };
