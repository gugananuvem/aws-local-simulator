/**
 * @fileoverview Connections e API destinations do EventBridge.
 *
 * API destinations permitem que regras, pipes e schedules invoquem endpoints
 * HTTP reais. As connections guardam a configuração de autorização.
 */

'use strict';

const {
  nowIso, buildArn, awsError, normalizeTags, paginate,
} = require('./shared');

const MASK = '*****';
const DEFAULT_RATE_LIMIT = 300;
const REQUEST_TIMEOUT_MS = 10000;

/** Substitui segredos por máscara na resposta pública. */
function maskConnection(connection) {
  const copy = JSON.parse(JSON.stringify(connection));
  const auth = copy.AuthParameters;
  if (auth) {
    if (auth.BasicAuthParameters) auth.BasicAuthParameters.Password = MASK;
    if (auth.ApiKeyAuthParameters) auth.ApiKeyAuthParameters.ApiKeyValue = MASK;
    if (auth.OAuthParameters?.ClientParameters) {
      auth.OAuthParameters.ClientParameters.ClientSecret = MASK;
    }
  }
  return copy;
}

class IntegrationFeature {
  /** @param {Object} simulator */
  constructor(simulator) {
    this.simulator = simulator;
    this.store = simulator.store;
    this.logger = simulator.logger;
    /** @type {Map<string, Object>} */
    this.connections = new Map();
    /** @type {Map<string, Object>} */
    this.destinations = new Map();
    /** @type {Map<string, {tokens: number, updatedAt: number}>} */
    this.rateBuckets = new Map();
    /** @type {Map<string, {token: string, expiresAt: number}>} */
    this.oauthTokens = new Map();
  }

  async load() {
    const connections = await this.store.read('eventbridge/connections');
    if (Array.isArray(connections)) {
      for (const connection of connections) {
        if (connection && connection.Name) this.connections.set(connection.Name, connection);
      }
    }
    const destinations = await this.store.read('eventbridge/api-destinations');
    if (Array.isArray(destinations)) {
      for (const destination of destinations) {
        if (destination && destination.Name) this.destinations.set(destination.Name, destination);
      }
    }
  }

  async save() {
    await this.store.write('eventbridge/connections', null, Array.from(this.connections.values()));
    await this.store.write('eventbridge/api-destinations', null, Array.from(this.destinations.values()));
  }

  async reset() {
    this.connections.clear();
    this.destinations.clear();
    this.rateBuckets.clear();
    this.oauthTokens.clear();
  }

  _findConnection(nameOrArn) {
    if (!nameOrArn) return null;
    if (this.connections.has(nameOrArn)) return this.connections.get(nameOrArn);
    return Array.from(this.connections.values())
      .find((connection) => connection.Arn === nameOrArn) || null;
  }

  _findDestination(nameOrArn) {
    if (!nameOrArn) return null;
    if (this.destinations.has(nameOrArn)) return this.destinations.get(nameOrArn);
    return Array.from(this.destinations.values())
      .find((destination) => destination.Arn === nameOrArn) || null;
  }

  // ==================== Connections ====================

  async createConnection(params = {}) {
    const { Name, AuthorizationType, AuthParameters, Description, InvocationHttpParameters, Tags } = params;
    if (!Name) throw awsError('ValidationException', 'Name é obrigatório');
    if (!AuthorizationType) throw awsError('ValidationException', 'AuthorizationType é obrigatório');
    if (!['BASIC', 'API_KEY', 'OAUTH_CLIENT_CREDENTIALS'].includes(AuthorizationType)) {
      throw awsError('ValidationException', `AuthorizationType inválido: ${AuthorizationType}`);
    }
    if (this.connections.has(Name)) {
      throw awsError('ResourceAlreadyExistsException', `Connection ${Name} já existe`);
    }

    const connection = {
      Name,
      Arn: buildArn(this.simulator, 'events', `connection/${Name}`),
      ConnectionState: 'ACTIVE',
      AuthorizationType,
      AuthParameters: AuthParameters || {},
      InvocationHttpParameters: InvocationHttpParameters || null,
      Description: Description || '',
      Tags: normalizeTags(Tags),
      CreationTime: nowIso(),
      LastModifiedTime: nowIso(),
    };

    this.connections.set(Name, connection);
    await this.save();
    this.logger.info('EventBridge', `Connection criada: ${Name}`);
    return {
      ConnectionArn: connection.Arn,
      ConnectionState: connection.ConnectionState,
      CreationTime: connection.CreationTime,
      LastModifiedTime: connection.LastModifiedTime,
    };
  }

  async updateConnection(params = {}) {
    const connection = this._findConnection(params.Name);
    if (!connection) throw awsError('ResourceNotFoundException', `Connection não encontrada: ${params.Name}`);

    if (params.AuthorizationType !== undefined) connection.AuthorizationType = params.AuthorizationType;
    if (params.AuthParameters !== undefined) connection.AuthParameters = params.AuthParameters;
    if (params.InvocationHttpParameters !== undefined) {
      connection.InvocationHttpParameters = params.InvocationHttpParameters;
    }
    if (params.Description !== undefined) connection.Description = params.Description;
    connection.LastModifiedTime = nowIso();

    await this.save();
    return {
      ConnectionArn: connection.Arn,
      ConnectionState: connection.ConnectionState,
      LastModifiedTime: connection.LastModifiedTime,
    };
  }

  async deleteConnection(params = {}) {
    const connection = this._findConnection(params.Name);
    if (!connection) throw awsError('ResourceNotFoundException', `Connection não encontrada: ${params.Name}`);

    const inUse = Array.from(this.destinations.values())
      .find((destination) => destination.ConnectionArn === connection.Arn);
    if (inUse) {
      throw awsError('ResourceInUseException', `Connection em uso pela API destination ${inUse.Name}`);
    }

    this.connections.delete(connection.Name);
    await this.save();
    return {};
  }

  describeConnection(params = {}) {
    const connection = this._findConnection(params.Name);
    if (!connection) throw awsError('ResourceNotFoundException', `Connection não encontrada: ${params.Name}`);
    return maskConnection(connection);
  }

  listConnections(params = {}) {
    let connections = Array.from(this.connections.values());
    if (params.NamePrefix) {
      connections = connections.filter((connection) => connection.Name.startsWith(params.NamePrefix));
    }
    const list = connections.map((connection) => maskConnection({
      Name: connection.Name,
      Arn: connection.Arn,
      ConnectionState: connection.ConnectionState,
      AuthorizationType: connection.AuthorizationType,
      CreationTime: connection.CreationTime,
      LastModifiedTime: connection.LastModifiedTime,
      Description: connection.Description,
    }));
    return paginate(list, params, 'Connections');
  }

  // ==================== API destinations ====================

  async createApiDestination(params = {}) {
    const {
      Name, ConnectionArn, InvocationEndpoint, HttpMethod,
      InvocationRateLimitPerSecond, Description,
    } = params;

    if (!Name) throw awsError('ValidationException', 'Name é obrigatório');
    if (!InvocationEndpoint) throw awsError('ValidationException', 'InvocationEndpoint é obrigatório');
    if (this.destinations.has(Name)) {
      throw awsError('ResourceAlreadyExistsException', `API destination ${Name} já existe`);
    }

    const connection = this._findConnection(ConnectionArn);
    if (ConnectionArn && !connection) {
      throw awsError('ResourceNotFoundException', `Connection não encontrada: ${ConnectionArn}`);
    }

    const destination = {
      Name,
      Arn: buildArn(this.simulator, 'events', `api-destination/${Name}`),
      ApiDestinationState: 'ACTIVE',
      ConnectionArn: connection ? connection.Arn : null,
      InvocationEndpoint,
      HttpMethod: (HttpMethod || 'POST').toUpperCase(),
      InvocationRateLimitPerSecond: Number(InvocationRateLimitPerSecond) || DEFAULT_RATE_LIMIT,
      Description: Description || '',
      CreationTime: nowIso(),
      LastModifiedTime: nowIso(),
    };

    this.destinations.set(Name, destination);
    await this.save();
    this.logger.info('EventBridge', `API destination criada: ${Name}`);
    return {
      ApiDestinationArn: destination.Arn,
      ApiDestinationState: destination.ApiDestinationState,
      CreationTime: destination.CreationTime,
      LastModifiedTime: destination.LastModifiedTime,
    };
  }

  async updateApiDestination(params = {}) {
    const destination = this._findDestination(params.Name);
    if (!destination) {
      throw awsError('ResourceNotFoundException', `API destination não encontrada: ${params.Name}`);
    }

    if (params.ConnectionArn !== undefined) {
      const connection = this._findConnection(params.ConnectionArn);
      if (params.ConnectionArn && !connection) {
        throw awsError('ResourceNotFoundException', `Connection não encontrada: ${params.ConnectionArn}`);
      }
      destination.ConnectionArn = connection ? connection.Arn : null;
    }
    if (params.InvocationEndpoint !== undefined) destination.InvocationEndpoint = params.InvocationEndpoint;
    if (params.HttpMethod !== undefined) destination.HttpMethod = String(params.HttpMethod).toUpperCase();
    if (params.InvocationRateLimitPerSecond !== undefined) {
      destination.InvocationRateLimitPerSecond = Number(params.InvocationRateLimitPerSecond) || DEFAULT_RATE_LIMIT;
    }
    if (params.Description !== undefined) destination.Description = params.Description;
    if (params.ApiDestinationState !== undefined) destination.ApiDestinationState = params.ApiDestinationState;
    destination.LastModifiedTime = nowIso();

    await this.save();
    return {
      ApiDestinationArn: destination.Arn,
      ApiDestinationState: destination.ApiDestinationState,
      LastModifiedTime: destination.LastModifiedTime,
    };
  }

  async deleteApiDestination(params = {}) {
    const destination = this._findDestination(params.Name);
    if (!destination) {
      throw awsError('ResourceNotFoundException', `API destination não encontrada: ${params.Name}`);
    }
    this.destinations.delete(destination.Name);
    this.rateBuckets.delete(destination.Name);
    await this.save();
    return {};
  }

  describeApiDestination(params = {}) {
    const destination = this._findDestination(params.Name);
    if (!destination) {
      throw awsError('ResourceNotFoundException', `API destination não encontrada: ${params.Name}`);
    }
    return { ...destination };
  }

  listApiDestinations(params = {}) {
    let destinations = Array.from(this.destinations.values());
    if (params.NamePrefix) {
      destinations = destinations.filter((destination) => destination.Name.startsWith(params.NamePrefix));
    }
    if (params.ConnectionArn) {
      destinations = destinations.filter((destination) => destination.ConnectionArn === params.ConnectionArn);
    }
    const list = destinations.map((destination) => ({ ...destination }));
    return paginate(list, params, 'ApiDestinations');
  }

  // ==================== Rate limit / auth ====================

  _consumeRateLimit(destination) {
    const now = Date.now();
    const limit = destination.InvocationRateLimitPerSecond || DEFAULT_RATE_LIMIT;
    const bucket = this.rateBuckets.get(destination.Name) || { tokens: limit, updatedAt: now };

    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(limit, bucket.tokens + (elapsed / 1000) * limit);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      this.rateBuckets.set(destination.Name, bucket);
      throw awsError('LimitExceededException', `Limite de invocações excedido para ${destination.Name}`);
    }

    bucket.tokens -= 1;
    this.rateBuckets.set(destination.Name, bucket);
  }

  async _authorizationHeaders(connection) {
    if (!connection) return {};
    const auth = connection.AuthParameters || {};

    if (connection.AuthorizationType === 'BASIC') {
      const basic = auth.BasicAuthParameters || {};
      const encoded = Buffer.from(`${basic.Username || ''}:${basic.Password || ''}`).toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }

    if (connection.AuthorizationType === 'API_KEY') {
      const apiKey = auth.ApiKeyAuthParameters || {};
      return { [apiKey.ApiKeyName || 'Authorization']: apiKey.ApiKeyValue || '' };
    }

    if (connection.AuthorizationType === 'OAUTH_CLIENT_CREDENTIALS') {
      const token = await this._getOAuthToken(connection);
      return token ? { Authorization: `Bearer ${token}` } : {};
    }

    return {};
  }

  async _getOAuthToken(connection) {
    const cached = this.oauthTokens.get(connection.Name);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const oauth = connection.AuthParameters?.OAuthParameters;
    if (!oauth || !oauth.AuthorizationEndpoint) return null;

    const client = oauth.ClientParameters || {};
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${client.ClientID || ''}:${client.ClientSecret || ''}`).toString('base64')}`,
    };

    try {
      const response = await this._fetchWithTimeout(oauth.AuthorizationEndpoint, {
        method: oauth.HttpMethod || 'POST',
        headers,
        body: body.toString(),
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.access_token) return null;
      const expiresIn = Number(data.expires_in) || 3600;
      this.oauthTokens.set(connection.Name, {
        token: data.access_token,
        expiresAt: Date.now() + Math.max(30, expiresIn - 30) * 1000,
      });
      return data.access_token;
    } catch (err) {
      this.logger.warn('EventBridge', `Falha ao obter token OAuth: ${err.message}`);
      return null;
    }
  }

  async _fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  _applyHttpParameters(url, headers, httpParameters) {
    const target = new URL(url);

    if (httpParameters?.PathParameterValues?.length) {
      const segments = target.pathname.split('/');
      // AWS envia os valores na ordem declarada; substitui os :param restantes.
      for (const value of httpParameters.PathParameterValues) {
        const marker = segments.findIndex((segment) => segment.startsWith(':'));
        if (marker === -1) break;
        segments[marker] = encodeURIComponent(String(value));
      }
      target.pathname = segments.join('/');
    }

    const addParams = (params) => {
      for (const [key, value] of Object.entries(params || {})) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (item && item.IsValueSecret) continue;
          target.searchParams.append(key, String(item?.Value ?? item));
        }
      }
    };
    addParams(httpParameters?.QueryStringParameters);

    const addHeaders = (params) => {
      for (const [key, value] of Object.entries(params || {})) {
        const item = Array.isArray(value) ? value[0] : value;
        if (item && item.IsValueSecret) continue;
        headers[key] = String(item?.Value ?? item);
      }
    };
    addHeaders(httpParameters?.HeaderParameters);

    return target.toString();
  }

  /**
   * Invoca uma API destination (usada como target de regras/pipes/schedules).
   * @param {string} nameOrArn
   * @param {*} payload
   * @param {Object} [httpParameters]
   * @returns {Promise<Object>}
   */
  async deliverApiDestination(nameOrArn, payload, httpParameters = {}) {
    const destination = this._findDestination(nameOrArn);
    if (!destination) {
      throw awsError('ResourceNotFoundException', `API destination não encontrada: ${nameOrArn}`);
    }
    if (destination.ApiDestinationState !== 'ACTIVE') {
      throw awsError('ResourceNotFoundException', `API destination ${destination.Name} não está ativa`);
    }

    this._consumeRateLimit(destination);

    const connection = this._findConnection(destination.ConnectionArn);
    const headers = {
      'Content-Type': 'application/json',
      ...(await this._authorizationHeaders(connection)),
    };

    if (connection?.InvocationHttpParameters) {
      const authParams = connection.InvocationHttpParameters;
      for (const [key, value] of Object.entries(authParams.HeaderParameters || {})) {
        const item = Array.isArray(value) ? value[0] : value;
        headers[key] = String(item?.Value ?? item);
      }
    }

    const url = this._applyHttpParameters(
      destination.InvocationEndpoint,
      headers,
      httpParameters,
    );

    const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
    const response = await this._fetchWithTimeout(url, {
      method: destination.HttpMethod,
      headers,
      body: destination.HttpMethod === 'GET' || destination.HttpMethod === 'DELETE' ? undefined : body,
    });

    if (!response.ok) {
      throw new Error(`API destination ${destination.Name} respondeu HTTP ${response.status}`);
    }

    const text = await response.text();
    this.logger.debug('EventBridge', `API destination ${destination.Name} invocada (HTTP ${response.status})`);
    return { statusCode: response.status, body: text };
  }

  getStats() {
    return {
      connections: this.connections.size,
      apiDestinations: this.destinations.size,
    };
  }
}

module.exports = { IntegrationFeature };
