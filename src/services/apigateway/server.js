/**
 * API Gateway Server - Servidor HTTP para API Gateway
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');

class APIGatewayServer {
  constructor(port, config) {
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
        const { path, method, lambdaName, integrationType, authorizerRequired } = endpoint;
        if (!path || !method) continue;

        const expressPath = path.replace(/\{([^}]+)\}/g, ':$1');
        const httpMethod = method.toLowerCase();

        logger.debug(`📡 Registrando rota: ${method} ${path} -> ${lambdaName}`);

        const handler = async (req, res) => {
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