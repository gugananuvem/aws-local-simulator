const { setupServiceMiddleware } = require('../../middleware');
/**
 * Lambda Server - Servidor HTTP para Lambda (API Gateway style)
 */

const express = require('express');
const cors = require('cors');
const LambdaSimulator = require('./simulator');
const logger = require('../../utils/logger');

class LambdaServer {
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
    this.app.use(express.json()); // Adiciona suporte para JSON
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cors());
    
    // Logging de requisições
    if (logger.currentLogLevel === 'verboso') {
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.verboso(`Lambda: ${req.method} ${req.path} - ${duration}ms`);
        });
        next();
      });
    }
  }

  async initialize() {
    this.simulator = new LambdaSimulator(this.config);
    await this.simulator.initialize();
    this.setupRoutes();
  }

  setupRoutes() {
    // IAM enforcement (conditionally applied)
    this.app.use((req, res, next) => {
      if (this.iamMiddleware && !req.path.startsWith('/__admin') && !req.path.startsWith('/health')) {
        return this.iamMiddleware(req, res, next);
      }
      next();
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', lambdas: this.simulator.getLambdasCount() });
    });

    // AWS Lambda Invoke API: POST /2015-03-31/functions/{functionName}/invocations
    this.app.post('/2015-03-31/functions/:functionName/invocations', async (req, res) => {
      const { functionName } = req.params;
      const invocationType = req.headers['x-amz-invocation-type'] || 'RequestResponse';

      // O express.json() global já consome o stream quando o Content-Type é JSON
      // (marca req._body); nesse caso usa req.body. Senão lê o stream (SDKs que
      // enviam outro Content-Type ou nenhum). Ler o stream depois do parser
      // nunca dispara 'end' e a requisição ficava pendurada.
      let event = {};
      try {
        if (req._body) {
          event = req.body === undefined ? {} : req.body;
        } else if (!req.readableEnded) {
          const rawBody = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
          });
          if (rawBody.length > 0) {
            event = JSON.parse(rawBody.toString('utf8'));
          }
        }
      } catch {
        event = {};
      }

      logger.debug(`Lambda invoke: ${functionName} (${invocationType})`);

      try {
        const result = await this.simulator.invoke(functionName, event, invocationType);

        if (invocationType === 'Event') {
          return res.status(202).send();
        }

        res.status(result.StatusCode || 200).json(result.Payload);
      } catch (err) {
        if (err.message && err.message.includes('Function not found')) {
          return res.status(404).json({ __type: 'ResourceNotFoundException', message: err.message });
        }
        logger.error('Lambda invoke error:', err);
        res.status(500).json({ __type: 'ServiceException', message: err.message });
      }
    });

    // Admin endpoints
    this.setupAdminRoutes();
  }

  setupAdminRoutes() {
    this.app.get('/__admin/functions', (req, res) => {
      res.json(this.simulator.listLambdas());
    });
    
    this.app.post('/__admin/functions', async (req, res) => {
      try {
        logger.debug(`📥 POST /__admin/functions:`, req.body);
        const lambda = await this.simulator.createFunction(req.body);
        res.status(201).json(lambda);
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    this.app.put('/__admin/functions/:name', async (req, res) => {
      try {
        logger.debug(`📥 PUT /__admin/functions/${req.params.name}:`, req.body);
        const lambda = await this.simulator.updateFunction(req.params.name, req.body);
        res.json(lambda);
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    this.app.delete('/__admin/functions/:name', async (req, res) => {
      const deleted = await this.simulator.deleteFunction(req.params.name);
      if (deleted) res.json({ message: 'Lambda deleted' });
      else res.status(404).json({ error: 'Lambda not found' });
    });

    this.app.post('/__admin/reload', async (req, res) => {
      await this.simulator.reloadLambdas();
      res.json({ message: 'Lambdas recarregadas', count: this.simulator.getLambdasCount() });
    });

    this.app.post('/__admin/env', (req, res) => {
      const { key, value } = req.body;
      if (key && value !== undefined) {
        this.simulator.setEnvironmentVariable(key, value);
        res.json({ message: `Environment variable ${key} set` });
      } else {
        res.status(400).json({ error: 'Missing key or value' });
      }
    });

    this.app.get('/__admin/env', (req, res) => {
      res.json(this.simulator.getEnvironmentVariables());
    });

    this.app.get('/__admin/stats', (req, res) => {
      res.json(this.simulator.getStats());
    });

    // Event Source Mappings
    this.app.get('/2015-03-31/event-source-mappings', (req, res) => {
      try { res.json(this.simulator.listEventSourceMappings(req.query)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.post('/2015-03-31/event-source-mappings', (req, res) => {
      try { res.status(202).json(this.simulator.createEventSourceMapping(req.body)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.get('/2015-03-31/event-source-mappings/:UUID', (req, res) => {
      const m = this.simulator.getEventSourceMapping(req.params.UUID);
      if (!m) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'EventSourceMapping not found' });
      res.json(m);
    });
    this.app.put('/2015-03-31/event-source-mappings/:UUID', (req, res) => {
      try { res.json(this.simulator.updateEventSourceMapping(req.params.UUID, req.body)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.delete('/2015-03-31/event-source-mappings/:UUID', (req, res) => {
      const ok = this.simulator.deleteEventSourceMapping(req.params.UUID);
      if (!ok) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'EventSourceMapping not found' });
      res.json({});
    });

    // Layers
    this.app.get('/2018-10-31/layers', (req, res) => {
      try { res.json(this.simulator.listLayers(req.query)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.post('/2018-10-31/layers/:LayerName/versions', (req, res) => {
      try { res.status(201).json(this.simulator.publishLayerVersion(req.params.LayerName, req.body)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.get('/2018-10-31/layers/:LayerName/versions', (req, res) => {
      try { res.json(this.simulator.listLayerVersions(req.params.LayerName)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.get('/2018-10-31/layers/:LayerName/versions/:VersionNumber', (req, res) => {
      const v = this.simulator.getLayerVersion(req.params.LayerName, req.params.VersionNumber);
      if (!v) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'LayerVersion not found' });
      res.json(v);
    });
    this.app.delete('/2018-10-31/layers/:LayerName/versions/:VersionNumber', (req, res) => {
      const ok = this.simulator.deleteLayerVersion(req.params.LayerName, req.params.VersionNumber);
      if (!ok) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'LayerVersion not found' });
      res.json({});
    });

    // Code Signing Configs
    this.app.get('/2020-04-22/code-signing-configs', (req, res) => {
      try { res.json(this.simulator.listCodeSigningConfigs()); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.post('/2020-04-22/code-signing-configs', (req, res) => {
      try { res.status(201).json(this.simulator.createCodeSigningConfig(req.body)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.get('/2020-04-22/code-signing-configs/:CodeSigningConfigArn', (req, res) => {
      const c = this.simulator.getCodeSigningConfig(decodeURIComponent(req.params.CodeSigningConfigArn));
      if (!c) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'CodeSigningConfig not found' });
      res.json({ CodeSigningConfig: c });
    });
    this.app.put('/2020-04-22/code-signing-configs/:CodeSigningConfigArn', (req, res) => {
      try { res.json(this.simulator.updateCodeSigningConfig(decodeURIComponent(req.params.CodeSigningConfigArn), req.body)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.delete('/2020-04-22/code-signing-configs/:CodeSigningConfigArn', (req, res) => {
      const ok = this.simulator.deleteCodeSigningConfig(decodeURIComponent(req.params.CodeSigningConfigArn));
      if (!ok) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'CodeSigningConfig not found' });
      res.json({});
    });

    // Capacity Providers
    this.app.get('/2025-11-30/capacity-providers', (req, res) => {
      try { res.json(this.simulator.listCapacityProviders()); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.post('/2025-11-30/capacity-providers', (req, res) => {
      try { res.status(201).json(this.simulator.createCapacityProvider(req.body)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.get('/2025-11-30/capacity-providers/:CapacityProviderName', (req, res) => {
      const cp = this.simulator.getCapacityProvider(req.params.CapacityProviderName);
      if (!cp) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'CapacityProvider not found' });
      res.json({ CapacityProvider: cp });
    });
    this.app.put('/2025-11-30/capacity-providers/:CapacityProviderName', (req, res) => {
      try { res.json(this.simulator.updateCapacityProvider(req.params.CapacityProviderName, req.body)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.delete('/2025-11-30/capacity-providers/:CapacityProviderName', (req, res) => {
      const ok = this.simulator.deleteCapacityProvider(req.params.CapacityProviderName);
      if (!ok) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'CapacityProvider not found' });
      res.json({});
    });

    // Function URLs
    this.app.get('/2021-10-31/functions/:FunctionName/url', (req, res) => {
      try {
        const c = this.simulator.getFunctionUrlConfig(req.params.FunctionName);
        if (!c) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'FunctionUrlConfig not found' });
        res.json(c);
      } catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.get('/2021-10-31/functions/:FunctionName/urls', (req, res) => {
      try { res.json(this.simulator.listFunctionUrlConfigs(req.params.FunctionName)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.post('/2021-10-31/functions/:FunctionName/url', (req, res) => {
      try { res.status(201).json(this.simulator.createFunctionUrlConfig(req.params.FunctionName, req.body)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.put('/2021-10-31/functions/:FunctionName/url', (req, res) => {
      try { res.json(this.simulator.updateFunctionUrlConfig(req.params.FunctionName, req.body)); }
      catch (e) { res.status(400).json({ __type: 'ValidationException', message: e.message }); }
    });
    this.app.delete('/2021-10-31/functions/:FunctionName/url', (req, res) => {
      const ok = this.simulator.deleteFunctionUrlConfig(req.params.FunctionName);
      if (!ok) return res.status(404).json({ __type: 'ResourceNotFoundException', message: 'FunctionUrlConfig not found' });
      res.json({});
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🚀 Lambda API rodando em http://localhost:${this.port}`);
        this.printRoutes();
        resolve();
      });
    });
  }

  printRoutes() {
    logger.info('\n📚 Lambdas registradas:');
    const lambdas = this.simulator.listLambdas();
    for (const lambda of lambdas) {
      logger.info(`   ${lambda.name.padEnd(30)} -> ${lambda.handlerName || 'anonymous'}`);
    }
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
      lambdasCount: this.simulator?.getLambdasCount() || 0
    };
  }
}

module.exports = LambdaServer;