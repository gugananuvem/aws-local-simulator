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
    this.requestValidators = new Map();
    this.audit = new CloudTrailAudit('execute-api.amazonaws.com');
    this.lambdaService = null;
    this.sqsService = null;
    this.snsService = null;
    this.eventbridgeService = null;
    this.region = 'local';
    this.accountId = '000000000000';
  }

  setLambdaService(service) { this.lambdaService = service; }
  setSqsService(service) { this.sqsService = service; }
  setSnsService(service) { this.snsService = service; }
  setEventbridgeService(service) { this.eventbridgeService = service; }
  setRegion(region) { this.region = region || this.region; }
  setAccountId(accountId) { this.accountId = accountId || this.accountId; }

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
        authorizers: new Map(),
        requestValidators: new Map()
      };
      
      (apiConfig.endpoints || []).forEach((ep, epIndex) => {
        const resId = `res_${apiId}_${epIndex}`;
        const intType = (ep.integrationType || '').toLowerCase();
        let integration;

        if (intType === 'sqs' || ep.queueArn || ep.queueUrl) {
          integration = {
            type: 'AWS',
            awsService: 'sqs',
            action: 'SendMessage',
            uri: ep.queueArn || ep.queueUrl || `arn:aws:apigateway:local:sqs:action/SendMessage`,
            queueArn: ep.queueArn,
            queueUrl: ep.queueUrl,
            integrationHttpMethod: 'POST'
          };
        } else if (intType === 'sns' || ep.topicArn) {
          integration = {
            type: 'AWS',
            awsService: 'sns',
            action: 'Publish',
            uri: ep.topicArn || `arn:aws:apigateway:local:sns:action/Publish`,
            topicArn: ep.topicArn,
            integrationHttpMethod: 'POST'
          };
        } else if (intType === 'eventbridge' || intType === 'events' || ep.eventBusName) {
          integration = {
            type: 'AWS',
            awsService: 'events',
            action: 'PutEvents',
            uri: `arn:aws:apigateway:local:events:action/PutEvents`,
            eventBusName: ep.eventBusName,
            integrationHttpMethod: 'POST'
          };
        } else {
          integration = {
            type: 'AWS_PROXY',
            awsService: 'lambda',
            uri: ep.lambdaName || '',
            integrationHttpMethod: 'POST'
          };
        }

        api.resources.set(resId, {
          id: resId,
          path: ep.path,
          pathPart: ep.path.split('/').pop() || '/',
          resourceMethods: new Map([[ep.method, {
            httpMethod: ep.method,
            authorizationType: ep.authorizerRequired ? 'COGNITO_USER_POOLS' : 'NONE',
            apiKeyRequired: false,
            integration
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
      documentationParts: new Map(),
      requestValidators: new Map()
    };
    
    // Cria recurso raiz
    const rootResource = {
      id: uuidv4(),
      path: '/',
      pathPart: '',
      parentId: null,
      resourceMethods: new Map()
    };
    
    api.resources.set(rootResource.id, rootResource);
    rootResource.apiId = apiId;
    api.rootResourceId = rootResource.id;
    
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
    const { restApiId, path, method, integrationType, lambdaName, authorizerRequired, queueArn, queueUrl, topicArn, eventBusName } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);

    if (api.isStatic) api.isStatic = false;

    let resource = Array.from(api.resources.values()).find(r => r.path === path);
    if (!resource) {
      const resourceId = `res_${Date.now()}`;
      resource = {
        id: resourceId,
        path: path,
        pathPart: path.split('/').pop() || '/',
        parentId: null,
        resourceMethods: new Map()
      };
      api.resources.set(resourceId, resource);
    }

    const intType = (integrationType || '').toLowerCase();
    let integration;

    if (intType === 'sqs' || queueArn || queueUrl) {
      integration = {
        type: 'AWS',
        awsService: 'sqs',
        action: 'SendMessage',
        uri: queueArn || queueUrl || `arn:aws:apigateway:local:sqs:action/SendMessage`,
        queueArn,
        queueUrl,
        integrationHttpMethod: 'POST'
      };
    } else if (intType === 'sns' || topicArn) {
      integration = {
        type: 'AWS',
        awsService: 'sns',
        action: 'Publish',
        uri: topicArn || `arn:aws:apigateway:local:sns:action/Publish`,
        topicArn,
        integrationHttpMethod: 'POST'
      };
    } else if (intType === 'eventbridge' || intType === 'events' || eventBusName) {
      integration = {
        type: 'AWS',
        awsService: 'events',
        action: 'PutEvents',
        uri: `arn:aws:apigateway:local:events:action/PutEvents`,
        eventBusName,
        integrationHttpMethod: 'POST'
      };
    } else {
      integration = {
        type: 'AWS_PROXY',
        awsService: 'lambda',
        uri: lambdaName || '',
        integrationHttpMethod: 'POST'
      };
    }

    resource.resourceMethods.set(method.toUpperCase(), {
      httpMethod: method.toUpperCase(),
      authorizationType: authorizerRequired ? 'COGNITO_USER_POOLS' : 'NONE',
      apiKeyRequired: false,
      integration
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
    const { restApiId, resourceId, httpMethod, authorizationType, apiKeyRequired, requestParameters, requestModels, authorizerId, requestValidatorId } = params;
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
      requestValidatorId: requestValidatorId || null,
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

    // Valida request parâmetros e body (Request Validator / Models)
    const pathParams = resource ? this.extractPathParams(resource.path, path) : {};
    const validationError = this.validateRequest({
      api,
      methodDef,
      headers,
      queryString,
      pathParams,
      body
    });
    if (validationError) {
      return this.createResponse(400, {
        __type: 'BadRequestException',
        message: validationError
      });
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
      pathParams,
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
    const uri = integration.uri || '';
    const action = integration.action;
    const explicitService = (integration.awsService || '').toLowerCase();

    // Detecta serviço AWS alvo pela URI (formato: arn:aws:apigateway:{region}:{service}:path|action/{action})
    // Ex.: arn:aws:apigateway:us-east-1:sqs:action/SendMessage
    // Ex.: arn:aws:apigateway:us-east-1:events:action/PutEvents
    // Ou URI estilo AWS service path /2012-11-05/queues/{queueName}/sendMessage
    // Ou por configuração explícita (integrações de dashboard / config estática)
    let awsService = explicitService || null;
    let awsAction = action;
    const arnMatch = uri.match(/arn:aws:apigateway:[^:]*:([^:]+):(?:action|path)\/([^?/]+)/);
    if (arnMatch) {
      awsService = awsService || arnMatch[1];
      awsAction = awsAction || arnMatch[2];
    } else if (integration.queueArn || integration.queueUrl || (/sqs/i.test(uri) || /SendMessage/i.test(uri))) {
      awsService = awsService || 'sqs';
      awsAction = awsAction || 'SendMessage';
    } else if (integration.eventBusName || (/events|eventbridge/i.test(uri) || /PutEvents/i.test(uri))) {
      awsService = awsService || 'events';
      awsAction = awsAction || 'PutEvents';
    } else if (integration.topicArn || (/sns/i.test(uri) || /Publish/i.test(uri))) {
      awsService = awsService || 'sns';
      awsAction = awsAction || 'Publish';
    } else if (/lambda/i.test(uri) || integration.type === 'AWS_PROXY') {
      awsService = awsService || 'lambda';
    }
    awsService = awsService || 'lambda';
    awsAction = awsAction || '';

    const ctx = context || {};
    const parsedBody = (typeof body === 'string' && body.length > 0)
      ? (() => { try { return JSON.parse(body); } catch { return null; } })()
      : body || ctx.body || null;

    if (awsService === 'sqs') {
      return this._executeSQSIntegration(integration, awsAction, parsedBody || {}, ctx);
    }

    if (awsService === 'events') {
      return this._executeEventBridgeIntegration(integration, awsAction, parsedBody || {}, ctx);
    }

    if (awsService === 'sns') {
      return this._executeSNSIntegration(integration, awsAction, parsedBody || {}, ctx);
    }

    // Lambda (padrão)
    const uriParts = uri.split(':');
    const functionName = uriParts[uriParts.length - 1];
    logger.debug(`Invoking Lambda: ${functionName}`);

    if (this.lambdaService?.simulator) {
      const lambdaEvent = {
        ...(ctx.headers ? { headers: ctx.headers } : {}),
        ...(ctx.queryString ? { queryStringParameters: ctx.queryString } : {}),
        ...(ctx.pathParams ? { pathParameters: ctx.pathParams } : {}),
        ...(parsedBody ? { body: JSON.stringify(parsedBody) } : { body: body || null }),
        httpMethod: ctx.method || 'POST',
        path: ctx.path || '/',
        isBase64Encoded: false,
        requestContext: { stage: ctx.stage?.stageName || 'local' }
      };
      const result = await this.lambdaService.simulator.invoke(functionName, lambdaEvent);
      const payload = result.Payload || {};
      return this.createResponse(
        payload.statusCode || 200,
        typeof payload.body === 'string'
          ? (() => { try { return JSON.parse(payload.body); } catch { return payload.body; } })()
          : payload
      );
    }

    return this.createResponse(200, {
      message: `Lambda ${functionName} invoked`,
      event: context
    });
  }

  _resolveSQSQueueArnOrName(queueNameOrUrlOrArn) {
    if (!queueNameOrUrlOrArn) return null;
    const s = String(queueNameOrUrlOrArn);
    const arnMatch = s.match(/arn:aws:sqs:[^:]+:[^:]+:([^:]+)$/);
    if (arnMatch) return { name: arnMatch[1], arn: s };
    const urlMatch = s.match(/\/queue\/([^/?]+)/);
    if (urlMatch) return { name: urlMatch[1], arn: null };
    return { name: s, arn: null };
  }

  async _executeSQSIntegration(integration, action, payload, ctx) {
    if (!this.sqsService?.simulator) {
      return this.createResponse(503, { __type: 'ServiceUnavailable', message: 'SQS service not available' });
    }

    const sqsSim = this.sqsService.simulator;
    const actionLower = (action || '').toLowerCase();

    if (actionLower === 'sendmessage' || actionLower === '') {
      let queueUrl = payload.QueueUrl;
      let messageBody = payload.MessageBody;
      let delaySeconds = payload.DelaySeconds;
      let messageAttributes = payload.MessageAttributes;

      if (!queueUrl && integration.queueUrl) {
        queueUrl = integration.queueUrl;
      }
      if (!queueUrl && integration.queueArn) {
        const qInfo = this._resolveSQSQueueArnOrName(integration.queueArn);
        if (qInfo?.name) {
          const q = sqsSim.queues.get(qInfo.name);
          queueUrl = q && q.url;
        }
      }
      if (!queueUrl && ctx.pathParams) {
        const qName = ctx.pathParams.queueName || ctx.pathParams.name;
        if (qName) {
          const queue = sqsSim.queues.get(qName);
          queueUrl = queue && queue.url;
        }
      }
      if (!queueUrl && integration.requestParameters) {
        for (const [k, v] of Object.entries(integration.requestParameters)) {
          if (k.toLowerCase() === 'integration.request.querystring.queueurl' || k.toLowerCase() === 'integration.request.path.queueurl') {
            const val = this.resolveParameter(v, { ...ctx, headers: ctx.headers || {}, queryString: ctx.queryString || {} });
            if (val) queueUrl = val;
          }
        }
      }
      if (!messageBody) {
        if (ctx.body && typeof ctx.body === 'string' && ctx.body.length > 0) {
          messageBody = ctx.body;
        }
      }
      if (!messageBody) {
        if (payload && Object.keys(payload).length > 0 && payload.MessageBody === undefined) {
          messageBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
        }
      }

      const queueInfo = this._resolveSQSQueueArnOrName(queueUrl || ctx.queryString?.queueUrl || '');
      if (!queueUrl && queueInfo?.name) {
        const q = sqsSim.queues.get(queueInfo.name);
        queueUrl = q && q.url;
      }

      if (!queueUrl) {
        return this.createResponse(400, { __type: 'MissingParameter', message: 'QueueUrl is required' });
      }
      if (!messageBody) {
        return this.createResponse(400, { __type: 'MissingParameter', message: 'MessageBody is required' });
      }

      try {
        const result = sqsSim.sendMessage({ QueueUrl: queueUrl, MessageBody: messageBody, DelaySeconds: delaySeconds, MessageAttributes: messageAttributes });
        if (result.error) {
          return this.createResponse(result.status || 400, { __type: result.error.code || 'InternalError', message: result.error.message });
        }
        return this.createResponse(200, {
          SendMessageResponse: {
            SendMessageResult: {
              MessageId: result.messageId,
              MD5OfMessageBody: result.md5
            },
            ResponseMetadata: { RequestId: crypto.randomUUID() }
          }
        });
      } catch (err) {
        logger.error('APIGateway SQS integration error:', err);
        return this.createResponse(502, { __type: 'InternalFailure', message: err.message });
      }
    }

    if (actionLower === 'sendmessagebatch') {
      return this.createResponse(501, { __type: 'NotImplemented', message: 'SendMessageBatch not implemented' });
    }

    return this.createResponse(400, { __type: 'InvalidAction', message: `Action ${action} not supported for SQS` });
  }

  async _executeEventBridgeIntegration(integration, action, payload, ctx) {
    if (!this.eventbridgeService?.simulator) {
      return this.createResponse(503, { __type: 'ServiceUnavailable', message: 'EventBridge service not available' });
    }

    const ebSim = this.eventbridgeService.simulator;
    const actionLower = (action || '').toLowerCase();
    const defaultEventBusName = integration.eventBusName;

    if (actionLower === 'putevents' || actionLower === '') {
      let entries = payload.Entries;
      if (!entries && payload && Object.keys(payload).length > 0) {
        entries = [{
          Source: payload.Source || payload.source || 'aws.apigateway',
          DetailType: payload.DetailType || payload.detailType || 'API Gateway Request',
          Detail: JSON.stringify(payload.Detail || payload.detail || payload),
          EventBusName: payload.EventBusName || payload.eventBusName || defaultEventBusName || 'default',
          Time: payload.Time || new Date().toISOString(),
          Resources: payload.Resources || []
        }];
      } else if (entries && defaultEventBusName) {
        entries = entries.map(e => ({
          ...e,
          EventBusName: e.EventBusName || defaultEventBusName
        }));
      }
      if (!entries || !Array.isArray(entries) || entries.length === 0) {
        return this.createResponse(400, { __type: 'ValidationException', message: 'Entries list is required and must not be empty' });
      }

      const normalizedEntries = entries.map(e => ({
        Time: e.Time || new Date().toISOString(),
        Source: e.Source || 'aws.apigateway',
        Resources: e.Resources || [],
        DetailType: e.DetailType || 'API Gateway Request',
        Detail: typeof e.Detail === 'string' ? e.Detail : JSON.stringify(e.Detail || {}),
        EventBusName: e.EventBusName || defaultEventBusName || 'default',
        TraceHeader: e.TraceHeader
      }));

      try {
        const result = await ebSim.putEvents({ Entries: normalizedEntries });
        return this.createResponse(200, {
          Entries: (result.Entries || []).map(e => ({
            EventId: e.EventId || crypto.randomUUID(),
            ErrorCode: e.ErrorCode,
            ErrorMessage: e.ErrorMessage
          })),
          FailedEntryCount: result.FailedEntryCount || 0
        });
      } catch (err) {
        logger.error('APIGateway EventBridge integration error:', err);
        return this.createResponse(err.name && err.name !== 'Error' ? 400 : 502, {
          __type: err.__type || err.name || 'InternalFailure',
          message: err.message
        });
      }
    }

    return this.createResponse(400, { __type: 'InvalidAction', message: `Action ${action} not supported for EventBridge` });
  }

  async _executeSNSIntegration(integration, action, payload, ctx) {
    if (!this.snsService?.simulator) {
      return this.createResponse(503, { __type: 'ServiceUnavailable', message: 'SNS service not available' });
    }

    const snsSim = this.snsService.simulator;
    const actionLower = (action || '').toLowerCase();

    if (actionLower === 'publish' || actionLower === '') {
      let topicArn = payload.TopicArn || payload.TargetArn || ctx.queryString?.TopicArn;
      if (!topicArn && integration.topicArn) {
        topicArn = integration.topicArn;
      }
      let message = payload.Message;
      if (!message && ctx.body && typeof ctx.body === 'string' && ctx.body.length > 0) {
        message = ctx.body;
      }
      if (!message && payload && Object.keys(payload).length > 0 && payload.Message === undefined) {
        message = typeof payload === 'string' ? payload : JSON.stringify(payload);
      }
      const subject = payload.Subject;
      if (!message) return this.createResponse(400, { __type: 'MissingParameter', message: 'Message is required' });

      try {
        const result = await snsSim.publish({
          TopicArn: topicArn,
          TargetArn: payload.TargetArn,
          Message: typeof message === 'string' ? message : JSON.stringify(message),
          Subject: subject,
          MessageAttributes: payload.MessageAttributes
        });

        return this.createResponse(200, {
          PublishResponse: {
            PublishResult: { MessageId: result.messageId || crypto.randomUUID() },
            ResponseMetadata: { RequestId: crypto.randomUUID() }
          }
        });
      } catch (err) {
        logger.error('APIGateway SNS integration error:', err);
        return this.createResponse(err.__type ? 400 : 502, {
          __type: err.__type || err.name || 'InternalFailure',
          message: err.message
        });
      }
    }

    return this.createResponse(400, { __type: 'InvalidAction', message: `Action ${action} not supported for SNS` });
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
        data.requestValidators = new Map(Object.entries(data.requestValidators || {}));
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
        authorizers: Object.fromEntries(api.authorizers),
        requestValidators: Object.fromEntries(api.requestValidators)
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

  // ============ JSON Schema Validator (API Gateway style - JSON Schema draft-04) ============

  _jsonSchemaTypeMatches(value, type) {
    if (value === null) return type === 'null' || type === undefined;
    switch (type) {
      case 'string': return typeof value === 'string';
      case 'integer': return Number.isInteger(value);
      case 'number': return typeof value === 'number' && Number.isFinite(value);
      case 'boolean': return typeof value === 'boolean';
      case 'array': return Array.isArray(value);
      case 'object': return typeof value === 'object' && !Array.isArray(value);
      case 'null': return value === null;
      default: return true;
    }
  }

  _validateJsonSchema(value, schema, path = '$') {
    if (!schema || typeof schema !== 'object') return null;

    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some(t => this._jsonSchemaTypeMatches(value, t))) {
        return `${path} should be ${types.join(' or ')}`;
      }
    }

    if (schema.enum !== undefined && Array.isArray(schema.enum)) {
      const match = schema.enum.some(opt => JSON.stringify(opt) === JSON.stringify(value));
      if (!match) return `${path} should be equal to one of the allowed values`;
    }

    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return `${path} should NOT be shorter than ${schema.minLength} characters`;
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return `${path} should NOT be longer than ${schema.maxLength} characters`;
      }
      if (schema.pattern !== undefined) {
        try {
          const re = new RegExp(schema.pattern);
          if (!re.test(value)) return `${path} should match pattern "${schema.pattern}"`;
        } catch (_e) { /* invalid pattern, skip */ }
      }
      if (schema.format !== undefined) {
        const fmt = schema.format.toLowerCase();
        if (fmt === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${path} should be format "date"`;
        if (fmt === 'date-time') {
          if (Number.isNaN(Date.parse(value))) return `${path} should be format "date-time"`;
        }
        if (fmt === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return `${path} should be format "email"`;
        if ((fmt === 'uri' || fmt === 'uriref') && !/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(value)) {
          if (fmt === 'uri') return `${path} should be format "uri"`;
        }
        if (fmt === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          return `${path} should be format "uuid"`;
        }
      }
    }

    if (typeof value === 'number') {
      if (schema.minimum !== undefined) {
        if (schema.exclusiveMinimum ? value <= schema.minimum : value < schema.minimum) {
          return `${path} should be ${schema.exclusiveMinimum ? '>' : '>='} ${schema.minimum}`;
        }
      }
      if (schema.maximum !== undefined) {
        if (schema.exclusiveMaximum ? value >= schema.maximum : value > schema.maximum) {
          return `${path} should be ${schema.exclusiveMaximum ? '<' : '<='} ${schema.maximum}`;
        }
      }
      if (schema.multipleOf !== undefined && value % schema.multipleOf !== 0) {
        return `${path} should be multiple of ${schema.multipleOf}`;
      }
    }

    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        return `${path} should NOT have fewer than ${schema.minItems} items`;
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        return `${path} should NOT have more than ${schema.maxItems} items`;
      }
      if (schema.uniqueItems === true) {
        const seen = new Set();
        for (const item of value) {
          const key = JSON.stringify(item);
          if (seen.has(key)) return `${path} should NOT have duplicate items`;
          seen.add(key);
        }
      }
      if (schema.items !== undefined) {
        if (Array.isArray(schema.items)) {
          for (let i = 0; i < Math.min(schema.items.length, value.length); i++) {
            const err = this._validateJsonSchema(value[i], schema.items[i], `${path}[${i}]`);
            if (err) return err;
          }
        } else {
          for (let i = 0; i < value.length; i++) {
            const err = this._validateJsonSchema(value[i], schema.items, `${path}[${i}]`);
            if (err) return err;
          }
        }
      }
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (schema.required !== undefined && Array.isArray(schema.required)) {
        for (const reqField of schema.required) {
          if (!(reqField in value) || value[reqField] === undefined) {
            return `${path} should have required property '${reqField}'`;
          }
        }
      }
      if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
        return `${path} should NOT have fewer than ${schema.minProperties} properties`;
      }
      if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) {
        return `${path} should NOT have more than ${schema.maxProperties} properties`;
      }
      if (schema.properties && typeof schema.properties === 'object') {
        for (const [key, subSchema] of Object.entries(schema.properties)) {
          if (key in value && value[key] !== undefined) {
            const err = this._validateJsonSchema(value[key], subSchema, `${path}.${key}`);
            if (err) return err;
          }
        }
      }
      if (schema.additionalProperties === false && schema.properties) {
        const allowed = new Set(Object.keys(schema.properties));
        for (const k of Object.keys(value)) {
          if (!allowed.has(k)) return `${path} should NOT have additional properties '${k}'`;
        }
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        if (schema.properties) {
          const defined = new Set(Object.keys(schema.properties));
          for (const [k, v] of Object.entries(value)) {
            if (!defined.has(k)) {
              const err = this._validateJsonSchema(v, schema.additionalProperties, `${path}.${k}`);
              if (err) return err;
            }
          }
        }
      }
      if (schema.patternProperties && typeof schema.patternProperties === 'object') {
        for (const [pattern, subSchema] of Object.entries(schema.patternProperties)) {
          try {
            const re = new RegExp(pattern);
            for (const [k, v] of Object.entries(value)) {
              if (re.test(k)) {
                const err = this._validateJsonSchema(v, subSchema, `${path}.${k}`);
                if (err) return err;
              }
            }
          } catch (_e) { /* ignore bad pattern */ }
        }
      }
      if (schema.allOf && Array.isArray(schema.allOf)) {
        for (let i = 0; i < schema.allOf.length; i++) {
          const err = this._validateJsonSchema(value, schema.allOf[i], path);
          if (err) return err;
        }
      }
      if (schema.oneOf && Array.isArray(schema.oneOf)) {
        let matchCount = 0;
        for (const sub of schema.oneOf) if (!this._validateJsonSchema(value, sub, path)) matchCount++;
        if (matchCount !== 1) return `${path} should match exactly one schema in oneOf`;
      }
      if (schema.anyOf && Array.isArray(schema.anyOf)) {
        let ok = false;
        for (const sub of schema.anyOf) if (!this._validateJsonSchema(value, sub, path)) { ok = true; break; }
        if (!ok) return `${path} should match some schema in anyOf`;
      }
      if (schema.not) {
        if (!this._validateJsonSchema(value, schema.not, path)) return `${path} should NOT be valid against the schema in "not"`;
      }
    }

    return null;
  }

  // ============ Request Validation (AWS API Gateway style) ============

  validateRequest({ api, methodDef, headers, queryString, pathParams, body }) {
    const validator = (methodDef && methodDef.requestValidatorId && api?.requestValidators)
      ? api.requestValidators.get(methodDef.requestValidatorId)
      : null;

    const validateParams = !!validator?.validateRequestParameters;
    const validateBody = !!validator?.validateRequestBody;

    if (!validateParams && !validateBody) return null;

    if (validateParams && methodDef.requestParameters) {
      for (const [paramKey, required] of Object.entries(methodDef.requestParameters)) {
        if (!required) continue;
        const key = String(paramKey);
        let value = null;
        if (key.startsWith('method.request.querystring.')) {
          const name = key.slice('method.request.querystring.'.length);
          value = (queryString && name in queryString) ? queryString[name] : null;
        } else if (key.startsWith('method.request.path.')) {
          const name = key.slice('method.request.path.'.length);
          value = (pathParams && name in pathParams) ? pathParams[name] : null;
        } else if (key.startsWith('method.request.header.')) {
          const name = key.slice('method.request.header.'.length);
          value = null;
          if (headers) {
            value = headers[name] ?? headers[name.toLowerCase()] ?? null;
          }
        }
        if (value === null || value === undefined || value === '') {
          return `Missing required request parameters: [${key}]`;
        }
      }
    }

    if (validateBody && methodDef.requestModels) {
      const contentType = (headers && (headers['Content-Type'] || headers['content-type'])) || 'application/json';
      const modelName = methodDef.requestModels[contentType] || methodDef.requestModels['application/json'];
      if (!modelName) return null;

      const model = (api?.models && api.models.get(modelName)) || this.models.get(modelName);
      if (!model) {
        logger.warn(`APIGateway: Model "${modelName}" referenced but not found for validation`);
        return null;
      }

      const schema = typeof model.schema === 'string'
        ? (() => { try { return JSON.parse(model.schema); } catch (_e) { return null; } })()
        : model.schema;
      if (!schema || typeof schema !== 'object') return null;

      let parsed = body;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); }
        catch (_e) { return 'Invalid request body: expected valid JSON'; }
      }

      const err = this._validateJsonSchema(parsed, schema, '$');
      if (err) return `Invalid request body: ${err}`;
    }

    return null;
  }

  // ============ Model Operations ============

  createModel(params) {
    const { restApiId, name, description, schema, contentType } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);
    if (!name) throw new Error('Model name is required');

    const schemaStr = typeof schema === 'string' ? schema : JSON.stringify(schema || {});
    const model = {
      name,
      description: description || '',
      schema: schemaStr,
      contentType: contentType || 'application/json',
      createdDate: new Date().toISOString()
    };

    api.models.set(name, model);
    this.persistAPIs();
    return { id: name, ...model };
  }

  getModel(params) {
    const { restApiId, modelName, flatten } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);
    const model = api.models.get(modelName);
    if (!model) throw new Error(`Model ${modelName} not found`);

    if (flatten === 'true' || flatten === true) {
      const parsed = typeof model.schema === 'string'
        ? (() => { try { return JSON.parse(model.schema); } catch (_e) { return {}; } })()
        : model.schema;
      return { name: model.name, description: model.description, contentType: model.contentType, schema: parsed };
    }
    return { ...model };
  }

  getModels(params) {
    const { restApiId } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);
    return {
      items: Array.from(api.models.values()).map(m => ({
        name: m.name,
        description: m.description,
        contentType: m.contentType,
        createdDate: m.createdDate
      }))
    };
  }

  deleteModel(params) {
    const { restApiId, modelName } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);
    if (!api.models.has(modelName)) throw new Error(`Model ${modelName} not found`);
    api.models.delete(modelName);
    this.persistAPIs();
    return {};
  }

  // ============ Request Validator Operations ============

  createRequestValidator(params) {
    const { restApiId, name, validateRequestBody, validateRequestParameters } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);

    const id = `rv_${crypto.randomBytes(6).toString('hex')}`;
    const validator = {
      id,
      name: name || `validator-${id}`,
      validateRequestBody: !!validateRequestBody,
      validateRequestParameters: !!validateRequestParameters
    };

    api.requestValidators.set(id, validator);
    this.persistAPIs();
    return validator;
  }

  getRequestValidator(params) {
    const { restApiId, requestValidatorId } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);
    const v = api.requestValidators.get(requestValidatorId);
    if (!v) throw new Error(`Request validator ${requestValidatorId} not found`);
    return { ...v };
  }

  getRequestValidators(params) {
    const { restApiId } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);
    return { items: Array.from(api.requestValidators.values()) };
  }

  updateRequestValidator(params) {
    const { restApiId, requestValidatorId, name, validateRequestBody, validateRequestParameters } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);
    const v = api.requestValidators.get(requestValidatorId);
    if (!v) throw new Error(`Request validator ${requestValidatorId} not found`);
    if (name !== undefined) v.name = name;
    if (validateRequestBody !== undefined) v.validateRequestBody = !!validateRequestBody;
    if (validateRequestParameters !== undefined) v.validateRequestParameters = !!validateRequestParameters;
    this.persistAPIs();
    return { ...v };
  }

  deleteRequestValidator(params) {
    const { restApiId, requestValidatorId } = params;
    const api = this.apis.get(restApiId);
    if (!api) throw new Error(`API ${restApiId} not found`);
    if (!api.requestValidators.has(requestValidatorId)) throw new Error(`Request validator ${requestValidatorId} not found`);
    api.requestValidators.delete(requestValidatorId);
    this.persistAPIs();
    return {};
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
    this.requestValidators.clear();
    
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