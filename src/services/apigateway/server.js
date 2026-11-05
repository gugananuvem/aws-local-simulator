const { setupServiceMiddleware } = require('../../middleware');
/**
 * API Gateway Server - Servidor HTTP para API Gateway
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');

class APIGatewayServer {
  constructor(port, config) {
    this.organizationsService = null;
    this.stsService = null;
    this.port = port;
    this.config = config;
    this.app = express();
    this.simulator = null;
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    // Parse bodies with AWS content types (e.g. application/x-amz-json-1.1)
    this.app.use((req, res, next) => {
      const ct = req.headers['content-type'] || ''; 
      if ((req.body && JSON.stringify(req.body) == "{}") && ct.includes('application/x-amz-json')) {
        let data = "";
        req.on("data", (chunk) => {
          data += chunk;
        });
        req.on("end", () => {
          try {
            req.body = JSON.parse(data);
          } catch (error) {
            req.body = {};
          }
          next();
        });
      } else {
        next();
      }      
    });
    this.app.use(cors());
    
    if (logger.currentLogLevel === 'verboso') {
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.verboso(`API Gateway: ${req.method} ${req.path} - ${duration}ms`);
        });
        next();
      });
    }
  }

  async initialize() {
    this.setupRoutes();
    this.setupConfigRoutes();
    this.setupProxyRoutes();
    logger.debug('API Gateway Server inicializado');
  }

  setupConfigRoutes() {
    // Register routes from aws-local-simulator.json config directly
    const apis = this.config.apigateway?.apis || [];
    for (const api of apis) {
      // Build Cognito authorizer middleware for this API if configured
      const cognitoAuthorizer = this._buildCognitoAuthorizer(api.authorizer);

      for (const endpoint of (api.endpoints || [])) {
        const { path, method, lambdaName, integrationType, authorizerRequired, queueArn, queueUrl, eventBusName, topicArn } = endpoint;
        if (!path || !method) continue;

        const expressPath = path.replace(/\{([^}]+)\}/g, ':$1');
        const httpMethod = method.toLowerCase();

        const intType = (integrationType || '').toLowerCase();
        logger.debug(`📡 Registrando rota: ${method} ${path} -> ${intType || 'lambda'} (${lambdaName || queueArn || topicArn || eventBusName || 'n/a'})`);

        let handler;
        if (intType === 'sqs' || queueArn || queueUrl) {
          handler = async (req, res) => {
            try {
              const sqsService = this.sqsService;
              if (!sqsService) {
                return res.status(500).json({ error: 'SQS service not available' });
              }
              const sqsSim = sqsService.simulator;
              let resolvedQueueUrl = queueUrl;
              if (!resolvedQueueUrl && queueArn) {
                const nameMatch = String(queueArn).match(/:([^:]+)$/);
                if (nameMatch) {
                  const q = sqsSim.queues.get(nameMatch[1]);
                  resolvedQueueUrl = q && q.url;
                }
              }
              const bodyContent = req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : '';
              const messageBody = req.body?.MessageBody || bodyContent;
              if (!resolvedQueueUrl) {
                return res.status(400).json({ __type: 'MissingParameter', message: 'QueueUrl or queueArn must be configured' });
              }
              const result = sqsSim.sendMessage({
                QueueUrl: resolvedQueueUrl,
                MessageBody: messageBody,
                DelaySeconds: req.body?.DelaySeconds,
                MessageAttributes: req.body?.MessageAttributes
              });
              if (result.error) return res.status(result.status || 400).json(result.error);
              res.status(200).json({
                SendMessageResponse: {
                  SendMessageResult: { MessageId: result.messageId, MD5OfMessageBody: result.md5 },
                  ResponseMetadata: { RequestId: Math.random().toString(36).slice(2) }
                }
              });
            } catch (err) {
              logger.error('SQS send error:', err);
              res.status(500).json({ error: err.message });
            }
          };
        } else if (intType === 'eventbridge' || intType === 'events' || eventBusName) {
          handler = async (req, res) => {
            try {
              const ebService = this.eventbridgeService;
              if (!ebService) {
                return res.status(500).json({ error: 'EventBridge service not available' });
              }
              const ebSim = ebService.simulator;
              const entries = req.body?.Entries || [{
                Source: req.body?.Source || 'aws.apigateway',
                DetailType: req.body?.DetailType || 'API Gateway Request',
                Detail: JSON.stringify(req.body?.Detail || req.body || {}),
                EventBusName: eventBusName || req.body?.EventBusName || 'default',
                Time: new Date().toISOString(),
                Resources: []
              }];
              const norm = entries.map(e => ({
                Time: e.Time || new Date().toISOString(),
                Source: e.Source || 'aws.apigateway',
                Resources: e.Resources || [],
                DetailType: e.DetailType || 'API Gateway Request',
                Detail: typeof e.Detail === 'string' ? e.Detail : JSON.stringify(e.Detail || {}),
                EventBusName: eventBusName || e.EventBusName || 'default',
                TraceHeader: e.TraceHeader
              }));
              const result = await ebSim.putEvents({ Entries: norm });
              res.status(200).json({
                Entries: (result.Entries || []).map(e => ({
                  EventId: e.EventId || Math.random().toString(36).slice(2),
                  ErrorCode: e.ErrorCode,
                  ErrorMessage: e.ErrorMessage
                })),
                FailedEntryCount: result.FailedEntryCount || 0
              });
            } catch (err) {
              logger.error('EventBridge putEvents error:', err);
              res.status(500).json({ error: err.message });
            }
          };
        } else if (intType === 'sns' || topicArn) {
          handler = async (req, res) => {
            try {
              const snsService = this.snsService;
              if (!snsService) {
                return res.status(500).json({ error: 'SNS service not available' });
              }
              const snsSim = snsService.simulator;
              const message = req.body?.Message || (req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : '');
              const result = await snsSim.publish({
                TopicArn: topicArn || req.body?.TopicArn,
                TargetArn: req.body?.TargetArn,
                Message: message,
                Subject: req.body?.Subject,
                MessageAttributes: req.body?.MessageAttributes
              });
              res.status(200).json({
                PublishResponse: {
                  PublishResult: { MessageId: result.messageId || Math.random().toString(36).slice(2) },
                  ResponseMetadata: { RequestId: Math.random().toString(36).slice(2) }
                }
              });
            } catch (err) {
              logger.error('SNS publish error:', err);
              res.status(500).json({ error: err.message });
            }
          };
        } else {
          handler = async (req, res) => {
            try {
              const lambdaService = this.lambdaService;
              if (!lambdaService) {
                return res.status(500).json({ error: 'Lambda service not available' });
              }

              const event = {
                httpMethod: req.method,
                path: req.path,
                headers: req.headers,
                queryStringParameters: Object.keys(req.query).length ? req.query : null,
                pathParameters: Object.keys(req.params).length ? req.params : null,
                body: req.body ? JSON.stringify(req.body) : null,
                isBase64Encoded: false,
                requestContext: {
                  path: req.path,
                  stage: 'local',
                  requestId: Math.random().toString(36).substring(7),
                  identity: { sourceIp: req.ip },
                  authorizer: req.cognitoAuthorizer || null
                }
              };

              const result = await lambdaService.simulator.invoke(lambdaName, event);
              const payload = result.Payload || {};
              const statusCode = payload.statusCode || 200;
              const headers = payload.headers || { 'Content-Type': 'application/json' };
              const body = payload.body;

              res.status(statusCode).set(headers).send(body);
            } catch (err) {
              logger.error(`Lambda invoke error (${lambdaName}):`, err);
              res.status(500).json({ error: err.message });
            }
          };
        }

        const middlewares = [];
        if (authorizerRequired && cognitoAuthorizer) {
          middlewares.push(cognitoAuthorizer);
        }
        middlewares.push(handler);

        const ANY_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];
        if (httpMethod === 'any') {
          for (const m of ANY_METHODS) {
            this.app[m](expressPath, ...middlewares);
          }
        } else {
          this.app[httpMethod](expressPath, ...middlewares);
        }
      }
    }
  }

  _buildCognitoAuthorizer(authorizerConfig) {
    if (!authorizerConfig) return null;
    if (authorizerConfig.type !== 'COGNITO_USER_POOLS') return null;

    const { userPoolId } = authorizerConfig;

    return (req, res, next) => {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      if (!authHeader) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

      const cognitoSimulator = this.cognitoService?.simulator;
      if (!cognitoSimulator) {
        logger.warn('⚠️ Cognito authorizer configured but Cognito service is not available');
        return res.status(500).json({ message: 'Authorizer unavailable' });
      }

      // Validate the token belongs to the configured user pool
      const decoded = cognitoSimulator.verifyAccessToken(token);
      if (!decoded) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // If a specific userPoolId is required, verify it matches
      if (userPoolId && decoded['cognito:username'] !== undefined) {
        const session = cognitoSimulator.accessTokens.get(token);
        if (session && userPoolId && session.UserPoolId !== userPoolId) {
          return res.status(401).json({ message: 'Unauthorized' });
        }
      }

      // Attach claims to request so Lambda receives them in requestContext.authorizer
      req.cognitoAuthorizer = {
        claims: decoded,
        principalId: decoded.sub
      };

      next();
    };
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'apigateway-simulator',
        version: '1.0.0'
      });
    });

    // Control Plane - REST API
    this.app.post('/restapis', async (req, res) => {
      try {
        const result = this.simulator.createRestApi(req.body);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/restapis', (req, res) => {
      const result = this.simulator.getRestApis();
      res.json(result);
    });

    this.app.get('/restapis/:apiId', (req, res) => {
      try {
        const result = this.simulator.getRestApi({ restApiId: req.params.apiId });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.patch('/restapis/:apiId', (req, res) => {
      try {
        const result = this.simulator.updateRestApi({
          ...req.body,
          restApiId: req.params.apiId
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.delete('/restapis/:apiId', (req, res) => {
      try {
        this.simulator.deleteRestApi({ restApiId: req.params.apiId });
        res.json({});
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // Resources
    this.app.get('/restapis/:apiId/resources', (req, res) => {
      try {
        const result = this.simulator.getResources({ restApiId: req.params.apiId });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.post('/restapis/:apiId/resources', (req, res) => {
      try {
        const result = this.simulator.createResource({
          ...req.body,
          restApiId: req.params.apiId
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.delete('/restapis/:apiId/resources/:resourceId', (req, res) => {
      try {
        this.simulator.deleteResource({
          restApiId: req.params.apiId,
          resourceId: req.params.resourceId
        });
        res.json({});
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Methods
    this.app.put('/restapis/:apiId/resources/:resourceId/methods/:method', (req, res) => {
      try {
        const result = this.simulator.putMethod({
          ...req.body,
          restApiId: req.params.apiId,
          resourceId: req.params.resourceId,
          httpMethod: req.params.method
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/restapis/:apiId/resources/:resourceId/methods/:method', (req, res) => {
      try {
        const result = this.simulator.getMethod({
          restApiId: req.params.apiId,
          resourceId: req.params.resourceId,
          httpMethod: req.params.method
        });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.delete('/restapis/:apiId/resources/:resourceId/methods/:method', (req, res) => {
      try {
        this.simulator.deleteMethod({
          restApiId: req.params.apiId,
          resourceId: req.params.resourceId,
          httpMethod: req.params.method
        });
        res.json({});
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // Integrations
    this.app.put('/restapis/:apiId/resources/:resourceId/methods/:method/integration', (req, res) => {
      try {
        const result = this.simulator.putIntegration({
          ...req.body,
          restApiId: req.params.apiId,
          resourceId: req.params.resourceId,
          httpMethod: req.params.method
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/restapis/:apiId/resources/:resourceId/methods/:method/integration', (req, res) => {
      try {
        const result = this.simulator.getIntegration({
          restApiId: req.params.apiId,
          resourceId: req.params.resourceId,
          httpMethod: req.params.method
        });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.delete('/restapis/:apiId/resources/:resourceId/methods/:method/integration', (req, res) => {
      try {
        this.simulator.deleteIntegration({
          restApiId: req.params.apiId,
          resourceId: req.params.resourceId,
          httpMethod: req.params.method
        });
        res.json({});
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // Deployments
    this.app.post('/restapis/:apiId/deployments', (req, res) => {
      try {
        const result = this.simulator.createDeployment({
          ...req.body,
          restApiId: req.params.apiId
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Stages
    this.app.post('/restapis/:apiId/stages', (req, res) => {
      try {
        const result = this.simulator.createStage({
          ...req.body,
          restApiId: req.params.apiId
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/restapis/:apiId/stages/:stageName', (req, res) => {
      try {
        const result = this.simulator.getStage({
          restApiId: req.params.apiId,
          stageName: req.params.stageName
        });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.patch('/restapis/:apiId/stages/:stageName', (req, res) => {
      try {
        const result = this.simulator.updateStage({
          ...req.body,
          restApiId: req.params.apiId,
          stageName: req.params.stageName
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.delete('/restapis/:apiId/stages/:stageName', (req, res) => {
      try {
        this.simulator.deleteStage({
          restApiId: req.params.apiId,
          stageName: req.params.stageName
        });
        res.json({});
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // API Keys
    this.app.post('/apikeys', (req, res) => {
      try {
        const result = this.simulator.createApiKey(req.body);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/apikeys', (req, res) => {
      const result = this.simulator.getApiKeys(req.query);
      res.json(result);
    });

    // Usage Plans
    this.app.post('/usageplans', (req, res) => {
      try {
        const result = this.simulator.createUsagePlan(req.body);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Models
    this.app.post('/restapis/:apiId/models', (req, res) => {
      try {
        const result = this.simulator.createModel({ ...req.body, restApiId: req.params.apiId });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/restapis/:apiId/models', (req, res) => {
      try {
        const result = this.simulator.getModels({ restApiId: req.params.apiId });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.get('/restapis/:apiId/models/:modelName', (req, res) => {
      try {
        const result = this.simulator.getModel({
          restApiId: req.params.apiId,
          modelName: req.params.modelName,
          flatten: req.query.flatten
        });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.delete('/restapis/:apiId/models/:modelName', (req, res) => {
      try {
        const result = this.simulator.deleteModel({
          restApiId: req.params.apiId,
          modelName: req.params.modelName
        });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // Request Validators
    this.app.post('/restapis/:apiId/requestvalidators', (req, res) => {
      try {
        const result = this.simulator.createRequestValidator({ ...req.body, restApiId: req.params.apiId });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/restapis/:apiId/requestvalidators', (req, res) => {
      try {
        const result = this.simulator.getRequestValidators({ restApiId: req.params.apiId });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.get('/restapis/:apiId/requestvalidators/:requestValidatorId', (req, res) => {
      try {
        const result = this.simulator.getRequestValidator({
          restApiId: req.params.apiId,
          requestValidatorId: req.params.requestValidatorId
        });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.patch('/restapis/:apiId/requestvalidators/:requestValidatorId', (req, res) => {
      try {
        const result = this.simulator.updateRequestValidator({
          ...req.body,
          restApiId: req.params.apiId,
          requestValidatorId: req.params.requestValidatorId
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.delete('/restapis/:apiId/requestvalidators/:requestValidatorId', (req, res) => {
      try {
        const result = this.simulator.deleteRequestValidator({
          restApiId: req.params.apiId,
          requestValidatorId: req.params.requestValidatorId
        });
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // HTTP APIs
    this.app.post('/httpapis', (req, res) => {
      try {
        const result = this.simulator.createHttpApi(req.body);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.post('/httpapis/:apiId/routes', (req, res) => {
      try {
        const result = this.simulator.createRoute({
          ...req.body,
          apiId: req.params.apiId
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Admin endpoints
    this.setupAdminRoutes();
  }

  setupProxyRoutes() {
    // Proxy para execução das APIs
    this.app.all('/:apiId/:stageName/*', async (req, res) => {
      const apiId = req.params.apiId;
      const stageName = req.params.stageName;
      const path = '/' + (req.params[0] || '');
      
      logger.debug(`🌐 Executando: ${req.method} ${path} (${apiId}/${stageName})`);
      
      try {
        const result = await this.simulator.executeRequest(
          apiId,
          stageName,
          req.method,
          path,
          req.headers,
          req.body,
          req.query
        );
        
        res.status(result.statusCode);
        
        if (result.headers) {
          Object.entries(result.headers).forEach(([key, value]) => {
            res.set(key, value);
          });
        }
        
        res.send(result.body);
      } catch (error) {
        logger.error('Error executing request:', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  setupAdminRoutes() {
    this.app.get('/__admin/apis', (req, res) => {
      res.json({
        totalApis: this.simulator.getAPIsCount(),
        totalDeployments: this.simulator.getDeploymentsCount(),
        totalStages: this.simulator.getStagesCount(),
        totalResources: this.simulator.getResourcesCount()
      });
    });

    this.app.get('/__admin/apis/:apiId', (req, res) => {
      const api = this.simulator.apis.get(req.params.apiId);
      if (api) {
        res.json({
          id: api.id,
          name: api.name,
          resources: Array.from(api.resources.keys()),
          stages: Array.from(api.stages.keys()),
          deployments: Array.from(api.deployments.keys())
        });
      } else {
        res.status(404).json({ error: 'API not found' });
      }
    });

    this.app.post('/__admin/apis/:apiId/endpoints', (req, res) => {
      try {
        const result = this.simulator.putEndpoint({
          ...req.body,
          restApiId: req.params.apiId
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.delete('/__admin/apis/:apiId/endpoints', (req, res) => {
      try {
        const result = this.simulator.deleteEndpoint({
          restApiId: req.params.apiId,
          path: req.query.path,
          method: req.query.method
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/__admin/apikeys', (req, res) => {
      const keys = Array.from(this.simulator.apiKeys.values()).map(k => ({
        id: k.id,
        name: k.name,
        enabled: k.enabled,
        createdDate: k.createdDate
      }));
      res.json(keys);
    });

    this.app.get('/__admin/usageplans', (req, res) => {
      const plans = Array.from(this.simulator.usagePlans.values());
      res.json(plans);
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🌐 API Gateway rodando em http://localhost:${this.port}`);
        this.printInfo();
        resolve();
      });
    });
  }

  printInfo() {
    logger.info('\n📡 API Gateway Endpoints:');
    logger.info(`   Control Plane: http://localhost:${this.port}/restapis`);
    logger.info(`   Execute APIs: http://localhost:${this.port}/{apiId}/{stageName}/{path}`);
    logger.info('\n📚 Admin Endpoints:');
    logger.info(`   GET  http://localhost:${this.port}/__admin/apis`);
    logger.info(`   GET  http://localhost:${this.port}/__admin/apikeys`);
    logger.info(`   GET  http://localhost:${this.port}/__admin/usageplans`);
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getStatus() {
    return {
      running: !!this.server,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      apisCount: this.simulator?.getAPIsCount() || 0,
      deploymentsCount: this.simulator?.getDeploymentsCount() || 0,
      stagesCount: this.simulator?.getStagesCount() || 0,
      resourcesCount: this.simulator?.getResourcesCount() || 0
    };
  }
}

module.exports = APIGatewayServer;