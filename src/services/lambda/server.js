/**
 * Lambda Server - Servidor HTTP para Lambda (API Gateway style)
 */

const express = require('express');
const cors = require('cors');
const LambdaSimulator = require('./simulator');
const logger = require('../../utils/logger');

class LambdaServer {
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
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        version: require('../../../package.json').version,
        lambdas: this.simulator.getLambdasCount(),
        routes: this.simulator.listRoutes()
      });
    });
    
    // Rota catch-all para todas as Lambdas
    this.app.all('*', async (req, res) => {
      const result = await this.simulator.handleRequest(req, res);
      
      if (result && result.error) {
        res.status(result.status).json(result.error);
      }
    });
    
    // Admin endpoints
    this.setupAdminRoutes();
  }

  setupAdminRoutes() {
    // Listar todas as Lambdas
    this.app.get('/__admin/lambdas', (req, res) => {
      res.json(this.simulator.listLambdas());
    });
    
    // Detalhes de uma Lambda
    this.app.get('/__admin/lambdas/:path', (req, res) => {
      const lambda = this.simulator.getLambda(req.params.path);
      if (lambda) {
        res.json(lambda);
      } else {
        res.status(404).json({ error: 'Lambda not found' });
      }
    });
    
    // Recarregar Lambdas
    this.app.post('/__admin/reload', async (req, res) => {
      await this.simulator.reloadLambdas();
      res.json({ 
        message: 'Lambdas recarregadas', 
        count: this.simulator.getLambdasCount() 
      });
    });
    
    // Injetar variável de ambiente
    this.app.post('/__admin/env', (req, res) => {
      const { key, value } = req.body;
      if (key && value !== undefined) {
        this.simulator.setEnvironmentVariable(key, value);
        res.json({ message: `Environment variable ${key} set` });
      } else {
        res.status(400).json({ error: 'Missing key or value' });
      }
    });
    
    // Listar variáveis de ambiente
    this.app.get('/__admin/env', (req, res) => {
      res.json(this.simulator.getEnvironmentVariables());
    });
    
    // Estatísticas
    this.app.get('/__admin/stats', (req, res) => {
      res.json(this.simulator.getStats());
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
      logger.info(`   ${lambda.path.padEnd(30)} -> ${lambda.handlerName || 'anonymous'}`);
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