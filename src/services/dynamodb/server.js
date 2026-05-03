/**
 * DynamoDB Server - Servidor HTTP para DynamoDB
 */

const express = require('express');
const cors = require('cors');
const DynamoDBSimulator = require('./simulator');
const logger = require('../../utils/logger');

class DynamoDBServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.simulator = null;
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(cors());
    this.app.use(express.json({
      type: (req) => {
        const ct = req.headers['content-type'] || '';
        return ct.includes('application/x-amz-json-1.0') || ct.includes('application/json');
      }
    }));
    
    // Logging de requisições
    if (logger.currentLogLevel === 'verboso') {
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.verboso(`DynamoDB: ${req.headers['x-amz-target'] || req.method} - ${duration}ms`);
        });
        next();
      });
    }
  }

  async initialize() {
    if (!this.simulator) {
      this.simulator = new DynamoDBSimulator(this.config);
      await this.simulator.initialize();
    }
    this.setupRoutes();
  }

  setupRoutes() {
    // Endpoint principal
    this.app.post('/', async (req, res) => {
      const target = req.headers['x-amz-target'];
      
      if (!target) {
        return res.status(400).json({ message: 'Missing X-Amz-Target header' });
      }

      logger.debug(`DynamoDB target=${target} content-type=${req.headers['content-type']} body=${JSON.stringify(req.body)}`);

      try {
        const result = await this.simulator.handleRequest(target, req.body);
        res.json(result);
      } catch (error) {
        logger.error('DynamoDB Error:', error);
        res.status(400).json({
          __type: error.code || 'InternalServerError',
          message: error.message
        });
      }
    });
    
    // Admin endpoints
    this.setupAdminRoutes();
  }

  setupAdminRoutes() {
    this.app.get('/__admin/tables', (req, res) => {
      res.json(this.simulator.listTables());
    });
    
    this.app.get('/__admin/tables/:tableName', (req, res) => {
      const table = this.simulator.describeTable(req.params.tableName);
      res.json(table);
    });
    
    this.app.get('/__admin/tables/:tableName/items', (req, res) => {
      const params = { TableName: req.params.tableName };
      if (req.query.Limit) params.Limit = Number(req.query.Limit);
      if (req.query.ExclusiveStartKey) {
        try {
          params.ExclusiveStartKey = JSON.parse(req.query.ExclusiveStartKey);
        } catch (e) {
          // Ignore invalid JSON for ExclusiveStartKey
        }
      }
      const items = this.simulator.scan(params);
      res.json(items);
    });
    
    this.app.delete('/__admin/tables/:tableName', (req, res) => {
      this.simulator.truncateTable(req.params.tableName);
      res.json({ message: `Table ${req.params.tableName} truncated` });
    });
    
    this.app.get('/__admin/stats', (req, res) => {
      res.json(this.simulator.getStats());
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🗄️  DynamoDB rodando em http://localhost:${this.port}`);
        resolve();
      });
    });
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
      tablesCount: this.simulator?.getTablesCount() || 0
    };
  }
}

module.exports = DynamoDBServer;