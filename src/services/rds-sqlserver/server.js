'use strict';

/**
 * Servidor HTTP do simulador RDS SQL Server.
 * Roteia Data API (x-amz-target), RDS Management API (Action) e endpoints administrativos.
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');
const { getInternalHost } = require('../../gateway/internal-host');
const { successXml, errorXml } = require('./query-response');

const ROOT_PATHS = ['/', '/rds-sqlserver', '/rds-sqlserver/'];

class SqlServerServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    require('../../auth/guard').attachAuthGuard(this.app, { service: 'rds', format: 'json' });
    this.server = null;

    // Referências injetadas pelo SqlServerService.
    this.dataApiHandler = null;
    this.rdsApiHandler = null;
    this.clusterManager = null;
    this.dbEngine = null;
    this.resetHandler = null;

    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(cors());
    this.app.use(express.json({
      type: (req) => {
        const contentType = req.headers['content-type'] || '';
        return contentType.includes('application/x-amz-json-1.1') || contentType.includes('application/json');
      },
    }));
    this.app.use(express.urlencoded({ extended: false }));

    if (logger.currentLogLevel === 'verboso') {
      this.app.use((req, res, next) => {
        const startedAt = Date.now();
        res.on('finish', () => {
          const alvo = req.headers['x-amz-target'] || req.body?.Action || req.method;
          logger.verboso(`RDS SQL Server: ${alvo} - ${Date.now() - startedAt}ms`);
        });
        next();
      });
    }
  }

  async initialize() {
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.post(ROOT_PATHS, async (req, res) => {
      const target = String(req.headers['x-amz-target'] || '');
      const body = req.body || {};
      const action = body.Action || req.query?.Action || '';
      const isQuery = !target.startsWith('RDSDataService') && !!action && req.is('application/x-www-form-urlencoded');

      try {
        let result;
        if (target.startsWith('RDSDataService')) {
          if (!this.dataApiHandler) {
            return res.status(503).json({
              __type: 'ServiceUnavailableException',
              message: 'Data API não inicializado',
            });
          }
          result = await this.dataApiHandler.handleRequest(target, body);
        } else if (action) {
          if (!this.rdsApiHandler) {
            return res.status(503).json({
              __type: 'ServiceUnavailableException',
              message: 'RDS API não inicializado',
            });
          }
          result = await this.rdsApiHandler.handleRequest(action, body);
        } else {
          return res.status(400).json({
            __type: 'BadRequestException',
            message: 'Requisição não reconhecida. Envie x-amz-target RDSDataService.* ou o parâmetro Action.',
          });
        }

        if (isQuery) return res.type('text/xml').send(successXml(action, result, body.Version));
        return res.json(result || {});
      } catch (error) {
        logger.error(`RDS SQL Server: ${error.message}`);
        const code = error.code || 'BadRequestException';
        const message = error.message || 'Erro na requisição';
        const status = error.statusCode || (code === 'NotFoundException' ? 404 : 400);

        if (isQuery) {
          return res.status(status).type('text/xml').send(errorXml(code, message, body.Version));
        }
        return res.status(status).json({ __type: code, message });
      }
    });

    this.setupAdminRoutes();
  }

  setupAdminRoutes() {
    const healthPaths = ['/__admin/health', '/rds-sqlserver/__admin/health'];
    this.app.get(healthPaths, (req, res) => {
      res.json({
        status: 'healthy',
        service: 'rds-sqlserver',
        port: this.port,
        running: !!this.server,
      });
    });

    this.app.get(['/__admin/clusters', '/rds-sqlserver/__admin/clusters'], (req, res) => {
      try {
        res.json({ clusters: this.clusterManager ? this.clusterManager.listClusters() : [] });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get(['/__admin/instances', '/rds-sqlserver/__admin/instances'], (req, res) => {
      try {
        res.json({ instances: this.clusterManager ? this.clusterManager.listInstances() : [] });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get(['/__admin/databases', '/rds-sqlserver/__admin/databases'], (req, res) => {
      try {
        res.json({ databases: this.dbEngine ? this.dbEngine.listDatabases() : [] });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post(['/__admin/reset', '/rds-sqlserver/__admin/reset'], async (req, res) => {
      try {
        if (this.resetHandler) {
          await this.resetHandler();
        } else {
          if (this.clusterManager) this.clusterManager.reset();
          if (this.dbEngine) this.dbEngine.reset();
        }
        res.json({ message: 'Dados do RDS SQL Server removidos' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, getInternalHost(), () => {
        const portaReal = this.server.address()?.port ?? this.port;
        logger.info(`🌐 RDS SQL Server HTTP rodando na porta ${portaReal}`);
        resolve();
      });
      this.server.once('error', reject);
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  getStatus() {
    return {
      running: !!this.server,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
    };
  }
}

module.exports = SqlServerServer;
