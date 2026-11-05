'use strict';

/**
 * Aurora Server - HTTP server que roteia requisições para Data API ou RDS Management API.
 * 
 * Routing:
 * - x-amz-target header starting with "RDSDataService" → Data API Handler
 * - Body/query Action parameter → RDS Management API Handler
 * - Otherwise → HTTP 400
 * 
 * Admin endpoints:
 * - GET /__admin/health
 * - GET /__admin/clusters
 * - GET /__admin/databases
 * - POST /__admin/reset
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');

class AuroraServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.server = null;

    // Handler/manager references set externally by AuroraService
    this.dataApiHandler = null;
    this.rdsApiHandler = null;
    this.clusterManager = null;
    this.dbEngine = null;

    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(cors());
    this.app.use(express.json({
      type: (req) => {
        const ct = req.headers['content-type'] || '';
        return ct.includes('application/x-amz-json-1.1') || ct.includes('application/json');
      }
    }));

    // Request logging
    if (logger.currentLogLevel === 'verboso') {
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          const target = req.headers['x-amz-target'] || '';
          const action = req.body?.Action || '';
          logger.verboso(`Aurora: ${target || action || req.method} - ${duration}ms`);
        });
        next();
      });
    }
  }

  async initialize() {
    this.setupRoutes();
  }

  setupRoutes() {
    // Main endpoint - route based on headers/body
    this.app.post('/', async (req, res) => {
      const target = req.headers['x-amz-target'] || '';
      const body = req.body || {};
      const action = body.Action || req.query?.Action || '';

      try {
        let result;

        if (target.startsWith('RDSDataService')) {
          // Data API routing
          if (!this.dataApiHandler) {
            return res.status(503).json({
              __type: 'ServiceUnavailableException',
              message: 'Data API handler not initialized'
            });
          }
          result = await this.dataApiHandler.handleRequest(target, body);
        } else if (action) {
          // RDS Management API routing
          if (!this.rdsApiHandler) {
            return res.status(503).json({
              __type: 'ServiceUnavailableException',
              message: 'RDS API handler not initialized'
            });
          }
          result = await this.rdsApiHandler.handleRequest(action, body);
        } else {
          // Unrecognized request
          return res.status(400).json({
            __type: 'BadRequestException',
            message: 'Unrecognized request. Expected x-amz-target header starting with "RDSDataService" or an Action parameter.'
          });
        }

        res.json(result || {});
      } catch (error) {
        logger.error(`Aurora Error: ${error.message}`);

        // If error already has an AWS-style code, use it directly
        if (error.code && error.statusCode) {
          return res.status(error.statusCode).json({
            __type: error.code,
            message: error.message
          });
        }

        // Wrap raw SQLite/better-sqlite3 errors as BadRequestException
        // These come from db.prepare(), stmt.run(), stmt.all(), etc.
        if (error.message && (
          error.message.includes('SQLITE_') ||
          error.message.includes('no such table') ||
          error.message.includes('no such column') ||
          error.message.includes('near "') ||
          error.message.includes('syntax error') ||
          error.constructor?.name === 'SqliteError'
        )) {
          return res.status(400).json({
            __type: 'BadRequestException',
            message: error.message
          });
        }

        // Default: treat unstructured errors as BadRequestException (matching AWS behavior)
        const statusCode = error.statusCode || 400;
        res.status(statusCode).json({
          __type: error.code || 'BadRequestException',
          message: error.message
        });
      }
    });

    // Admin endpoints
    this.setupAdminRoutes();
  }

  setupAdminRoutes() {
    this.app.get('/__admin/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'aurora',
        port: this.port,
        running: !!this.server
      });
    });

    this.app.get('/__admin/clusters', (req, res) => {
      try {
        const clusters = this.clusterManager ? this.clusterManager.listClusters() : [];
        res.json({ clusters });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/__admin/databases', (req, res) => {
      try {
        const databases = this.dbEngine ? this.dbEngine.listDatabases() : [];
        res.json({ databases });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/__admin/reset', async (req, res) => {
      try {
        if (this.clusterManager) await this.clusterManager.reset();
        if (this.dbEngine) await this.dbEngine.reset();
        res.json({ message: 'Aurora data reset complete' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🌐 Aurora rodando em http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getStatus() {
    return {
      running: !!this.server,
      port: this.port,
      endpoint: `http://localhost:${this.port}`
    };
  }
}

module.exports = AuroraServer;
