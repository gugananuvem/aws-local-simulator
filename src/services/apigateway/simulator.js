/**
 * API Gateway Simulator Core
 * Simula REST APIs, HTTP APIs, WebSocket APIs, Routes, Integrations
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../utils/logger');
const LocalStore = require('../../utils/local-store');
const path = require('path');
const { URLPattern } = require('urlpattern-polyfill');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');

class APIGatewaySimulator {
  constructor(config) {
    this.config = config;
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR, 'apigateway');
    this.store = new LocalStore(this.dataDir);
    this.apis = new Map();
    this.websocketApis = new Map();
    this.deployments = new Map();
    this.stages = new Map();
    this.resources = new Map();
    this.methods = new Map();
    this.integrations = new Map();
    this.models = new Map();
    this.usagePlans = new Map();
    this.apiKeys = new Map();
    this.domainNames = new Map();
    this.audit = new CloudTrailAudit('execute-api.amazonaws.com');
  }

  async initialize() {
    logger.debug('Inicializando API Gateway Simulator...');
    this.loadAPIs();
    this._loadStaticAPIs();
    this.loadWebSocketAPIs();
    this.loadDeployments();
    this.loadStages();
    this.loadResources();
    this.loadMethods();
    this.loadIntegrations();
    this.loadModels();
    this.loadUsagePlans();
    this.loadApiKeys();
    this.loadDomainNames();
    
    logger.debug(`✅ API Gateway Simulator inicializado com ${this.apis.size} APIs (${Array.from(this.apis.values()).filter(a => a.isStatic).length} estáticas)`);
  }

  _loadStaticAPIs() {
    const staticApis = this.config.apigateway?.apis || [];
    staticApis.forEach((apiConfig, index) => {
      const apiId = `static_${index}`;
      
      const api = {
        id: apiId,
        name: apiConfig.name,
        description: apiConfig.description || 'Configured in aws-local-simulator.json',
        version: 'config',
        createdDate: new Date().toISOString(),
        isStatic: true,
        apiKeySource: 'HEADER',
        endpointConfiguration: { types: ['REGIONAL'] },
        resources: new Map(),
        stages: new Map(),
        deployments: new Map(),
        models: new Map(),
        authorizers: new Map()
      };
      
      // Adiciona recursos a partir dos endpoints configurados
      (apiConfig.endpoints || []).forEach((ep, epIndex) => {
        const resId = `res_${apiId}_${epIndex}`;
        api.resources.set(resId, {
          id: resId,
          path: ep.path,
          pathPart: ep.path.split('/').pop() || '/',
          resourceMethods: new Map([[ep.method, {
            httpMethod: ep.method,
            authorizationType: ep.authorizerRequired ? 'COGNITO_USER_POOLS' : 'NONE',
            apiKeyRequired: false,
            integration: {
              type: ep.integrationType === 'lambda' ? 'AWS_PROXY' : 'HTTP',
              uri: ep.lambdaName,
              integrationHttpMethod: 'POST'
            }
          }]])
        });
      });
      
      // Adiciona um stage padrão
      api.stages.set('local', {
        stageName: 'local',
        createdDate: new Date().toISOString(),
        deploymentId: 'static-deploy'
      });
      
      this.apis.set(apiId, api);
    });
  }


  // ============ REST API Operations ============

  createRestApi(params) {
    const { name, description, version, apiKeySource, endpointConfiguration, tags } = params;
    
    const apiId = `api_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const api = {
      id: apiId,
      name: name,
      description: description || '',
      version: version || '1.0',
      createdDate: new Date().toISOString(),
      apiKeySource: apiKeySource || 'HEADER',
      endpointConfiguration: endpointConfiguration || {
        types: ['REGIONAL']
      },
      tags: tags || {},
      resources: new Map(),
      stages: new Map(),
      deployments: new Map(),
      models: new Map(),
      authorizers: new Map(),
      gatewayResponses: new Map(),
      documentationParts: new Map()
    };
    
    // Cria recurso raiz
    const rootResource = {
      id: uuidv4(),
      path: '/',
      pathPart: '',
      parentId: null,
      resourceMethods: new Map()
    };
    
    api.resources.set('/', rootResource);
    
    this.apis.set(apiId, api);
    this.persistAPIs();
    
    logger.debug(`✅ REST API criada: ${name} (${apiId})`);
    
    return {
      id: apiId,
      name: api.name,
      createdDate: api.createdDate
    };
  }

  getRestApis() {
    return {
      items: Array.from(this.apis.values()).map(api => ({
        id: api.id,
        name: api.name,
        description: api.description,
        version: api.version,
        createdDate: api.createdDate,
        apiKeySource: api.apiKeySource,
        isStatic: api.isStatic || false,
        resourceCount: api.resources.size,
        stageCount: api.stages.size
      }))
    };
  }


  getRestApi(params) {
    const { restApiId } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    return {
      id: api.id,
      name: api.name,
      description: api.description,
      version: api.version,
      createdDate: api.createdDate,
      apiKeySource: api.apiKeySource,
      endpointConfiguration: api.endpointConfiguration,
      tags: api.tags
    };
  }

  updateRestApi(params) {
    const { restApiId, name, description } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    if (name !== undefined) api.name = name;
    if (description !== undefined) api.description = description;
    
    if (api.isStatic) {
      // Once edited, the API is no longer static and will be persisted
      api.isStatic = false;
    }
    
    this.persistAPIs();
    
    return this.getRestApi({ restApiId });
  }

  deleteRestApi(params) {
    const { restApiId } = params;
    
    if (!this.apis.has(restApiId)) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    this.apis.delete(restApiId);
    this.persistAPIs();
    
    return {};
  }

  // ============ Simplified Dashboard Endpoint Operations ============

  putEndpoint(params) {
    const { restApiId, path, method, integrationType, lambdaName, authorizerRequired } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);

    if (api.isStatic) api.isStatic = false;

    // Ensure resource exists
    let resource = Array.from(api.resources.values()).find(r => r.path === path);
    if (!resource) {
      const resourceId = `res_${Date.now()}`;
      resource = {
        id: resourceId,
        path: path,
        pathPart: path.split('/').pop() || '/',
        parentId: null, // Simplified
        resourceMethods: new Map()
      };
      api.resources.set(resourceId, resource);
    }

    // Put method
    resource.resourceMethods.set(method.toUpperCase(), {
      httpMethod: method.toUpperCase(),
      authorizationType: authorizerRequired ? 'COGNITO_USER_POOLS' : 'NONE',
      apiKeyRequired: false,
      integration: {
        type: integrationType === 'lambda' ? 'AWS_PROXY' : 'HTTP',
        uri: lambdaName,
        integrationHttpMethod: 'POST'
      }
    });

    this.persistAPIs();
    return { resourceId: resource.id, path, method };
  }

  deleteEndpoint(params) {
    const { restApiId, path, method } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);

    if (api.isStatic) api.isStatic = false;

    const resource = Array.from(api.resources.values()).find(r => r.path === path);
    if (resource) {
      resource.resourceMethods.delete(method.toUpperCase());
      // If no methods left and not root, we could delete the resource, but keeping it is fine.
      if (resource.resourceMethods.size === 0 && resource.path !== '/') {
        api.resources.delete(resource.id);
      }
      this.persistAPIs();
    }
    return {};
  }

  // ============ Resource Operations ============


  createResource(params) {
    const { restApiId, parentId, pathPart } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const parentResource = api.resources.get(parentId);
    if (!parentResource) {
      throw new Error(`Parent resource ${parentId} not found`);
    }
    
    const resourceId = uuidv4();
    const fullPath = parentResource.path === '/' 
      ? `/${pathPart}` 
      : `${parentResource.path}/${pathPart}`;
    
    const resource = {
      id: resourceId,
      path: fullPath,
      pathPart: pathPart,
      parentId: parentId,
      resourceMethods: new Map()
    };
    
    api.resources.set(resourceId, resource);
    this.persistResources(restApiId);
    
    logger.debug(`📁 Recurso criado: ${fullPath} (${resourceId})`);
    
    return {
      id: resourceId,
      path: resource.path,
      parentId: resource.parentId
    };
  }

  getResources(params) {
    const { restApiId } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const items = Array.from(api.resources.values()).map(resource => ({
      id: resource.id,
      path: resource.path,
      pathPart: resource.pathPart,
      parentId: resource.parentId,
      resourceMethods: Object.fromEntries(resource.resourceMethods)
    }));
    
    return { items };
  }

  deleteResource(params) {
    const { restApiId, resourceId } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    if (!api.resources.has(resourceId)) {
      throw new Error(`Resource ${resourceId} not found`);
    }
    
    // Verifica se tem filhos
    const hasChildren = Array.from(api.resources.values()).some(
      r => r.parentId === resourceId
    );
    
    if (hasChildren) {
      throw new Error('Resource has children');
    }
    
    api.resources.delete(resourceId);
    this.persistResources(restApiId);
    
    return {};
  }

  // ============ Method Operations ============

  putMethod(params) {
    const { restApiId, resourceId, httpMethod, authorizationType, apiKeyRequired, requestParameters, requestModels, authorizerId } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const resource = api.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }
    
    const method = {
      httpMethod: httpMethod,
      authorizationType: authorizationType || 'NONE',
      apiKeyRequired: apiKeyRequired || false,
      requestParameters: requestParameters || {},
      requestModels: requestModels || {},
      authorizerId: authorizerId || null,
      methodResponses: new Map(),
      integration: null
    };
    
    resource.resourceMethods.set(httpMethod, method);
    this.persistMethods(restApiId, resourceId);
    
    logger.debug(`🔧 Método criado: ${httpMethod} ${resource.path}`);
    
    return {
      httpMethod: method.httpMethod,
      authorizationType: method.authorizationType,
      apiKeyRequired: method.apiKeyRequired
    };
  }

  getMethod(params) {
    const { restApiId, resourceId, httpMethod } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const resource = api.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }
    
    const method = resource.resourceMethods.get(httpMethod);
    if (!method) {
      throw new Error(`Method ${httpMethod} not found`);
    }
    
    return {
      httpMethod: method.httpMethod,
      authorizationType: method.authorizationType,
      apiKeyRequired: method.apiKeyRequired,
      requestParameters: method.requestParameters,
      requestModels: method.requestModels
    };
  }

  deleteMethod(params) {
    const { restApiId, resourceId, httpMethod } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const resource = api.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }
    
    resource.resourceMethods.delete(httpMethod);
    this.persistMethods(restApiId, resourceId);
    
    return {};
  }

  // ============ Integration Operations ============

  putIntegration(params) {
    const { restApiId, resourceId, httpMethod, type, integrationHttpMethod, uri, credentials, requestParameters, requestTemplates, passthroughBehavior, timeoutInMillis, cacheNamespace, cacheKeyParameters, contentHandling } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const resource = api.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }
    
    const method = resource.resourceMethods.get(httpMethod);
    if (!method) {
      throw new Error(`Method ${httpMethod} not found`);
    }
    
    const integration = {
      type: type || 'HTTP',
      integrationHttpMethod: integrationHttpMethod,
      uri: uri,
      credentials: credentials || null,
      requestParameters: requestParameters || {},
      requestTemplates: requestTemplates || {},
      passthroughBehavior: passthroughBehavior || 'WHEN_NO_MATCH',
      timeoutInMillis: timeoutInMillis || 29000,
      cacheNamespace: cacheNamespace || '',
      cacheKeyParameters: cacheKeyParameters || [],
      contentHandling: contentHandling || null,
      integrationResponses: new Map()
    };
    
    method.integration = integration;
    this.persistIntegrations(restApiId, resourceId);
    
    logger.debug(`🔌 Integração criada: ${type} -> ${uri}`);
    
    return {
      type: integration.type,
      integrationHttpMethod: integration.integrationHttpMethod,
      uri: integration.uri
    };
  }

  getIntegration(params) {
    const { restApiId, resourceId, httpMethod } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const resource = api.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }
    
    const method = resource.resourceMethods.get(httpMethod);
    if (!method || !method.integration) {
      throw new Error(`Integration not found for ${httpMethod}`);
    }
    
    const integration = method.integration;
    
    return {
      type: integration.type,
      integrationHttpMethod: integration.integrationHttpMethod,
      uri: integration.uri,
      credentials: integration.credentials,
      requestParameters: integration.requestParameters,
      requestTemplates: integration.requestTemplates,
      passthroughBehavior: integration.passthroughBehavior,
      timeoutInMillis: integration.timeoutInMillis
    };
  }

  deleteIntegration(params) {
    const { restApiId, resourceId, httpMethod } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const resource = api.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }
    
    const method = resource.resourceMethods.get(httpMethod);
    if (method) {
      method.integration = null;
      this.persistIntegrations(restApiId, resourceId);
    }
    
    return {};
  }

  // ============ Integration Response Operations ============

  putIntegrationResponse(params) {
    const { restApiId, resourceId, httpMethod, statusCode, selectionPattern, responseParameters, responseTemplates, contentHandling } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const resource = api.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }
    
    const method = resource.resourceMethods.get(httpMethod);
    if (!method || !method.integration) {
      throw new Error(`Integration not found for ${httpMethod}`);
    }
    
    const integrationResponse = {
      statusCode: statusCode,
      selectionPattern: selectionPattern || '',
      responseParameters: responseParameters || {},
      responseTemplates: responseTemplates || {},
      contentHandling: contentHandling || null
    };
    
    method.integration.integrationResponses.set(statusCode, integrationResponse);
    this.persistIntegrations(restApiId, resourceId);
    
    return {
      statusCode: integrationResponse.statusCode,
      selectionPattern: integrationResponse.selectionPattern
    };
  }

  // ============ Deployment Operations ============

  createDeployment(params) {
    const { restApiId, stageName, stageDescription, description, variables } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const deploymentId = uuidv4();
    const deployment = {
      id: deploymentId,
      description: description || '',
      createdDate: new Date().toISOString(),
      apiId: restApiId
    };
    
    api.deployments.set(deploymentId, deployment);
    
    if (stageName) {
      this.createStage({
        restApiId,
        stageName,
        description: stageDescription,
        variables
      });
    }
    
    this.persistDeployments(restApiId);
    
    logger.debug(`🚀 Deployment criado: ${deploymentId} para stage: ${stageName || 'N/A'}`);
    
    return {
      id: deploymentId,
      createdDate: deployment.createdDate
    };
  }

  // ============ Stage Operations ============

  createStage(params) {
    const { restApiId, stageName, description, variables, deploymentId, cacheClusterEnabled, cacheClusterSize, tracingEnabled } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const stage = {
      stageName: stageName,
      description: description || '',
      createdDate: new Date().toISOString(),
      lastUpdatedDate: new Date().toISOString(),
      deploymentId: deploymentId,
      variables: variables || {},
      cacheClusterEnabled: cacheClusterEnabled || false,
      cacheClusterSize: cacheClusterSize || null,
      tracingEnabled: tracingEnabled || false,
      methodSettings: new Map()
    };
    
    api.stages.set(stageName, stage);
    this.persistStages(restApiId);
    
    // Cria endpoint URL
    const endpointUrl = `http://localhost:${this.config.ports.apigateway}/${restApiId}/${stageName}`;
    
    logger.debug(`📡 Stage criado: ${stageName} em ${endpointUrl}`);
    
    return {
      stageName: stage.stageName,
      createdDate: stage.createdDate,
      deploymentId: stage.deploymentId
    };
  }

  getStage(params) {
    const { restApiId, stageName } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const stage = api.stages.get(stageName);
    if (!stage) {
      throw new Error(`Stage ${stageName} not found`);
    }
    
    return {
      stageName: stage.stageName,
      description: stage.description,
      createdDate: stage.createdDate,
      lastUpdatedDate: stage.lastUpdatedDate,
      deploymentId: stage.deploymentId,
      variables: stage.variables,
      methodSettings: Object.fromEntries(stage.methodSettings),
      cacheClusterEnabled: stage.cacheClusterEnabled,
      tracingEnabled: stage.tracingEnabled
    };
  }

  updateStage(params) {
    const { restApiId, stageName, description, variables, deploymentId, tracingEnabled } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    const stage = api.stages.get(stageName);
    if (!stage) {
      throw new Error(`Stage ${stageName} not found`);
    }
    
    if (description !== undefined) stage.description = description;
    if (variables !== undefined) stage.variables = { ...stage.variables, ...variables };
    if (deploymentId !== undefined) stage.deploymentId = deploymentId;
    if (tracingEnabled !== undefined) stage.tracingEnabled = tracingEnabled;
    
    stage.lastUpdatedDate = new Date().toISOString();
    this.persistStages(restApiId);
    
    return {
      stageName: stage.stageName,
      description: stage.description,
      lastUpdatedDate: stage.lastUpdatedDate
    };
  }

  deleteStage(params) {
    const { restApiId, stageName } = params;
    const api = this.apis.get(restApiId);
    
    if (!api) {
      throw new Error(`API ${restApiId} not found`);
    }
    
    api.stages.delete(stageName);
    this.persistStages(restApiId);
    
    return {};
  }

  // ============ API Key Operations ============

  createApiKey(params) {
    const { name, description, enabled, stageKeys, customerId } = params;
    
    const apiKeyId = uuidv4();
    const apiKey = {
      id: apiKeyId,
      name: name || '',
      description: description || '',
      enabled: enabled !== false,
      value: crypto.randomBytes(20).toString('hex'),
      stageKeys: stageKeys || [],
      customerId: customerId || null,
      createdDate: new Date().toISOString(),
      lastUpdatedDate: new Date().toISOString()
    };
    
    this.apiKeys.set(apiKeyId, apiKey);
    this.persistApiKeys();
    
    logger.debug(`🔑 API Key criada: ${name || apiKeyId}`);
    
    return {
      id: apiKey.id,
      name: apiKey.name,
      value: apiKey.value,
      enabled: apiKey.enabled
    };
  }

  getApiKeys(params) {
    const items = Array.from(this.apiKeys.values()).map(key => ({
      id: key.id,
      name: key.name,
      description: key.description,
      enabled: key.enabled,
      createdDate: key.createdDate,
      lastUpdatedDate: key.lastUpdatedDate
    }));
    
    return { items };
  }

  // ============ Usage Plan Operations ============

  createUsagePlan(params) {
    const { name, description, apiStages, throttle, quota } = params;
    
    const usagePlanId = uuidv4();
    const usagePlan = {
      id: usagePlanId,
      name: name,
      description: description || '',
      apiStages: apiStages || [],
      throttle: throttle || {
        burstLimit: 100,
        rateLimit: 10
      },
      quota: quota || {
        limit: 10000,
        period: 'DAY',
        offset: 0
      },
      createdDate: new Date().toISOString(),
      lastUpdatedDate: new Date().toISOString()
    };
    
    this.usagePlans.set(usagePlanId, usagePlan);
    this.persistUsagePlans();
    
    logger.debug(`📊 Usage Plan criado: ${name}`);
    
    return {
      id: usagePlan.id,
      name: usagePlan.name,
      createdDate: usagePlan.createdDate
    };
  }

  // ============ Request Execution ============

  async executeRequest(apiId, stageName, method, path, headers, body, queryString) {
    const api = this.apis.get(apiId);
    if (!api) {
      return this.createResponse(404, 'API not found');
    }
    
    const stage = api.stages.get(stageName);
    if (!stage) {
      return this.createResponse(404, 'Stage not found');
    }
    
    // Encontra o recurso e método correspondente
    const { resource, methodDef } = this.findMatchingResource(api, method, path);
    
    if (!resource || !methodDef) {
      return this.createResponse(404, 'Resource or method not found');
    }
    
    // Verifica API Key
    if (methodDef.apiKeyRequired) {
      const apiKey = this.extractApiKey(headers);
      if (!this.validateApiKey(apiKey)) {
        return this.createResponse(403, 'Forbidden: Invalid API Key');
      }
    }
    
    // Verifica throttling
    const usagePlan = this.getUsagePlanForApi(apiId, stageName);
    if (usagePlan && !this.checkThrottle(usagePlan)) {
      return this.createResponse(429, 'Too Many Requests');
    }
    
    // Processa integração
    const integration = methodDef.integration;
    if (!integration) {
      return this.createResponse(500, 'Integration not configured');
    }
    
    // Executa a integração baseada no tipo
    const response = await this.executeIntegration(integration, {
      method,
      path,
      headers,
      body,
      queryString,
      resource,
      stage
    });
    
    // Aplica resposta da integração
    const integrationResponse = this.getMatchingIntegrationResponse(
      integration.integrationResponses,
      response.statusCode
    );
    
    if (integrationResponse) {
      response.headers = { ...response.headers, ...integrationResponse.responseParameters };
      response.body = this.applyResponseTemplate(integrationResponse, response.body);
    }

    this.audit.record({
      eventName: 'Invoke',
      readOnly: method === 'GET' || method === 'HEAD',
      isDataEvent: true,
      resources: [{ ARN: `arn:aws:execute-api:local:000000000000:${apiId}/${stageName}/${method}${path}`, type: 'AWS::APIGateway::Stage' }],
      requestParameters: { apiId, stageName, method, path },
    });

    return response;
  }

  findMatchingResource(api, method, path) {
    // Busca recurso que corresponda ao path
    const resources = Array.from(api.resources.values());
    
    // Ordena por path mais específico primeiro
    resources.sort((a, b) => b.path.length - a.path.length);
    
    for (const resource of resources) {
      if (this.matchPath(resource.path, path)) {
        const methodDef = resource.resourceMethods.get(method);
        if (methodDef) {
          return { resource, methodDef };
        }
      }
    }
    
    return { resource: null, methodDef: null };
  }

  matchPath(pattern, path) {
    // Converte path com parâmetros para regex
    // Ex: /users/{userId}/posts/{postId}
    const regexPattern = pattern
      .replace(/\{([^}]+)\}/g, '([^/]+)')
      .replace(/\//g, '\\/');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  extractPathParams(pattern, path) {
    const paramNames = [];
    const regexPattern = pattern
      .replace(/\{([^}]+)\}/g, (match, paramName) => {
        paramNames.push(paramName);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');
    
    const regex = new RegExp(`^${regexPattern}$`);
    const match = path.match(regex);
    
    if (match) {
      const params = {};
      paramNames.forEach((name, index) => {
        params[name] = match[index + 1];
      });
      return params;
    }
    
    return {};
  }

  async executeIntegration(integration, context) {
    const { type, uri, integrationHttpMethod, requestTemplates, requestParameters } = integration;
    
    // Prepara o request
    let requestBody = context.body;
    let requestHeaders = { ...context.headers };
    
    // Aplica templates de request
    if (requestTemplates && requestTemplates['application/json']) {
      const template = requestTemplates['application/json'];
      requestBody = this.applyRequestTemplate(template, context);
    }
    
    // Aplica mapeamento de parâmetros
    if (requestParameters) {
      for (const [key, value] of Object.entries(requestParameters)) {
        requestHeaders[key] = this.resolveParameter(value, context);
      }
    }
    
    switch(type) {
      case 'AWS':
      case 'AWS_PROXY':
        return this.executeAWSIntegration(integration, context, requestBody, requestHeaders);
      case 'HTTP':
      case 'HTTP_PROXY':
        return this.executeHTTPIntegration(integration, context, requestBody, requestHeaders);
      case 'MOCK':
        return this.executeMockIntegration(integration);
      default:
        return this.createResponse(501, `Integration type ${type} not supported`);
    }
  }

  async executeAWSIntegration(integration, context, body, headers) {
    // Simula integração com Lambda
    const uriParts = integration.uri.split(':');
    const functionName = uriParts[uriParts.length - 1];
    
    // Aqui poderia chamar o simulador Lambda
    logger.debug(`Invoking Lambda: ${functionName}`);
    
    return this.createResponse(200, {
      message: `Lambda ${functionName} invoked`,
      event: context
    });
  }

  async executeHTTPIntegration(integration, context, body, headers) {
    const { uri, integrationHttpMethod } = integration;
    
    logger.debug(`HTTP ${integrationHttpMethod} to ${uri}`);
    
    // Simula chamada HTTP
    try {
      const response = await this.makeHttpRequest(uri, integrationHttpMethod, headers, body);
      return {
        statusCode: response.status,
        headers: response.headers,
        body: response.data
      };
    } catch (error) {
      return this.createResponse(502, 'Bad Gateway');
    }
  }

  async makeHttpRequest(url, method, headers, body) {
    // Simulação - em implementação real, usaria axios ou fetch
    return {
      status: 200,
      headers: {},
      data: { message: 'Mock HTTP response' }
    };
  }

  executeMockIntegration(integration) {
    // Retorna resposta mock
    const mockResponse = integration.requestTemplates?.mock || {};
    return this.createResponse(200, mockResponse);
  }

  getMatchingIntegrationResponse(responses, statusCode) {
    // Busca response que corresponda ao status code
    if (responses.has(statusCode.toString())) {
      return responses.get(statusCode.toString());
    }
    
    // Busca default
    if (responses.has('default')) {
      return responses.get('default');
    }
    
    return null;
  }

  applyRequestTemplate(template, context) {
    // Implementação simples de template
    try {
      return JSON.stringify(context);
    } catch (error) {
      return template;
    }
  }

  applyResponseTemplate(response, body) {
    const templates = response.responseTemplates;
    if (templates && templates['application/json']) {
      // Aplica template de resposta
      try {
        return JSON.parse(templates['application/json'].replace(/\$\{([^}]+)\}/g, (match, path) => {
          return this.getNestedValue(body, path);
        }));
      } catch (error) {
        return body;
      }
    }
    return body;
  }

  resolveParameter(value, context) {
    // Resolve parâmetros como method.request.header.X-Header
    if (value.includes('method.request.')) {
      const parts = value.split('.');
      const type = parts[2]; // header, querystring, path
      const name = parts[3];
      
      switch(type) {
        case 'header':
          return context.headers[name];
        case 'querystring':
          return context.queryString[name];
        case 'path':
          return context.pathParams[name];
        default:
          return null;
      }
    }
    return value;
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  extractApiKey(headers) {
    return headers['x-api-key'] || headers['X-Api-Key'];
  }

  validateApiKey(apiKeyValue) {
    if (!apiKeyValue) return false;
    
    for (const key of this.apiKeys.values()) {
      if (key.value === apiKeyValue && key.enabled) {
        return true;
      }
    }
    return false;
  }

  getUsagePlanForApi(apiId, stageName) {
    for (const plan of this.usagePlans.values()) {
      const apiStage = plan.apiStages.find(
        as => as.apiId === apiId && as.stage === stageName
      );
      if (apiStage) {
        return plan;
      }
    }
    return null;
  }

  checkThrottle(usagePlan) {
    // Implementação simplificada de throttling
    const { rateLimit, burstLimit } = usagePlan.throttle;
    // Aqui poderia implementar contagem de requests
    return true;
  }

  createResponse(statusCode, body) {
    return {
      statusCode: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    };
  }

  // ============ HTTP API Operations ============

  createHttpApi(params) {
    const { name, description, protocolType, routeSelectionExpression, corsConfiguration } = params;
    
    const apiId = `http_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const api = {
      id: apiId,
      name: name,
      description: description || '',
      protocolType: protocolType || 'HTTP',
      routeSelectionExpression: routeSelectionExpression || '$request.method $request.path',
      corsConfiguration: corsConfiguration || {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['*'],
        maxAge: 300
      },
      routes: new Map(),
      integrations: new Map(),
      stages: new Map(),
      createdDate: new Date().toISOString()
    };
    
    this.apis.set(apiId, api);
    this.persistAPIs();
    
    logger.debug(`✅ HTTP API criada: ${name} (${apiId})`);
    
    return {
      ApiId: apiId,
      Name: api.name,
      ProtocolType: api.protocolType
    };
  }

  createRoute(params) {
    const { apiId, routeKey, authorizationType, target } = params;
    const api = this.apis.get(apiId);
    
    if (!api) {
      throw new Error(`API ${apiId} not found`);
    }
    
    const route = {
      routeKey: routeKey,
      authorizationType: authorizationType || 'NONE',
      target: target,
      createdAt: new Date().toISOString()
    };
    
    api.routes.set(routeKey, route);
    this.persistAPIs();
    
    return { route };
  }

  // ============ Persistence ============

  loadAPIs() {
    const saved = this.store.read('__apis__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        // Reconstitui Maps
        data.resources = new Map(Object.entries(data.resources || {}).map(([rid, r]) => {
          r.resourceMethods = new Map(Object.entries(r.resourceMethods || {}));
          return [rid, r];
        }));
        data.stages = new Map(Object.entries(data.stages || {}));
        data.deployments = new Map(Object.entries(data.deployments || {}));
        data.models = new Map(Object.entries(data.models || {}));
        data.authorizers = new Map(Object.entries(data.authorizers || {}));
        this.apis.set(id, data);
      }
    }
  }


  loadWebSocketAPIs() {
    const saved = this.store.read('__websocket_apis__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.websocketApis.set(id, data);
      }
    }
  }

  loadDeployments() {
    const saved = this.store.read('__deployments__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.deployments.set(id, data);
      }
    }
  }

  loadStages() {
    const saved = this.store.read('__stages__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.stages.set(id, data);
      }
    }
  }

  loadResources() {
    const saved = this.store.read('__resources__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.resources.set(id, data);
      }
    }
  }

  loadMethods() {
    const saved = this.store.read('__methods__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.methods.set(id, data);
      }
    }
  }

  loadIntegrations() {
    const saved = this.store.read('__integrations__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.integrations.set(id, data);
      }
    }
  }

  loadModels() {
    const saved = this.store.read('__models__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.models.set(id, data);
      }
    }
  }

  loadUsagePlans() {
    const saved = this.store.read('__usage_plans__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.usagePlans.set(id, data);
      }
    }
  }

  loadApiKeys() {
    const saved = this.store.read('__api_keys__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.apiKeys.set(id, data);
      }
    }
  }

  loadDomainNames() {
    const saved = this.store.read('__domain_names__');
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        this.domainNames.set(id, data);
      }
    }
  }

  persistAPIs() {
    const apisObj = {};
    for (const [id, api] of this.apis.entries()) {
      if (api.isStatic) continue;
      apisObj[id] = {
        ...api,
        resources: Object.fromEntries(Array.from(api.resources.entries()).map(([rid, r]) => [rid, { ...r, resourceMethods: Object.fromEntries(r.resourceMethods) }])),
        stages: Object.fromEntries(api.stages),
        deployments: Object.fromEntries(api.deployments),
        models: Object.fromEntries(api.models),
        authorizers: Object.fromEntries(api.authorizers)
      };
    }
    this.store.write('__apis__', apisObj);
  }


  persistResources(apiId) {
    const api = this.apis.get(apiId);
    if (api) {
      this.persistAPIs();
    }
  }

  persistMethods(apiId, resourceId) {
    this.persistResources(apiId);
  }

  persistIntegrations(apiId, resourceId) {
    this.persistMethods(apiId, resourceId);
  }

  persistStages(apiId) {
    this.persistAPIs();
  }

  persistDeployments(apiId) {
    this.persistAPIs();
  }

  persistApiKeys() {
    const keysObj = {};
    for (const [id, key] of this.apiKeys.entries()) {
      keysObj[id] = key;
    }
    this.store.write('__api_keys__', keysObj);
  }

  persistUsagePlans() {
    const plansObj = {};
    for (const [id, plan] of this.usagePlans.entries()) {
      plansObj[id] = plan;
    }
    this.store.write('__usage_plans__', plansObj);
  }

  async reset() {
    this.apis.clear();
    this.websocketApis.clear();
    this.deployments.clear();
    this.stages.clear();
    this.resources.clear();
    this.methods.clear();
    this.integrations.clear();
    this.models.clear();
    this.usagePlans.clear();
    this.apiKeys.clear();
    this.domainNames.clear();
    
    this.persistAPIs();
    this.persistApiKeys();
    this.persistUsagePlans();
    
    logger.debug('API Gateway: Todos os dados resetados');
  }

  // ============ Stats ============

  getAPIsCount() {
    return this.apis.size;
  }

  getDeploymentsCount() {
    let count = 0;
    for (const api of this.apis.values()) {
      count += api.deployments.size;
    }
    return count;
  }

  getStagesCount() {
    let count = 0;
    for (const api of this.apis.values()) {
      count += api.stages.size;
    }
    return count;
  }

  getResourcesCount() {
    let count = 0;
    for (const api of this.apis.values()) {
      count += api.resources.size;
    }
    return count;
  }
}

module.exports = APIGatewaySimulator;