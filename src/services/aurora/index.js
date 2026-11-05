'use strict';

/**
 * Aurora Service - Ponto de entrada
 * Simula Amazon Aurora (MySQL/PostgreSQL-compatible) via Data API e RDS Management API.
 * Porta padrão: 4510
 */

const path = require('path');
const AuroraServer = require('./server');
const { DbEngine } = require('./db-engine');
const { ClusterManager } = require('./cluster-manager');
const { DataApiHandler } = require('./data-api');
const { RdsApiHandler } = require('./rds-api');
const LocalStore = require('../../utils/local-store');

class AuroraService {
  constructor(config) {
    this.config = config;
    this.name = 'aurora';
    this.port = config?.ports?.aurora || 4510;
    this.server = null;
    this.dbEngine = null;
    this.clusterManager = null;
    this.dataApiHandler = null;
    this.rdsApiHandler = null;
    this.isRunning = false;

    // Dependencies injected later via injectDependencies()
    this.kmsService = null;
    this.secretManagerService = null;
    this.cloudTrailService = null;
    this.cloudWatchService = null;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando Aurora Service na porta ${this.port}...`);

    // Data directory for SQLite files
    const dataDir = path.join(this.config.dataDir || './data', 'aurora');

    // Create LocalStore for JSON persistence
    const store = new LocalStore(dataDir);

    // 1. Create core components
    this.dbEngine = new DbEngine(dataDir);
    this.clusterManager = new ClusterManager(dataDir, store);
    this.clusterManager.initialize();

    // 2. Create handlers with dependencies
    this.dataApiHandler = new DataApiHandler(this.dbEngine, null, this.clusterManager, logger);
    this.rdsApiHandler = new RdsApiHandler(this.clusterManager, this.dbEngine, logger);

    // 3. Create server and wire handlers
    this.server = new AuroraServer(this.port, this.config);
    this.server.dataApiHandler = this.dataApiHandler;
    this.server.rdsApiHandler = this.rdsApiHandler;
    this.server.clusterManager = this.clusterManager;
    this.server.dbEngine = this.dbEngine;
    await this.server.initialize();

    logger.debug('Aurora Service inicializado');
  }

  injectDependencies(server) {
    const kms = server.getService('kms');
    if (kms?.simulator) {
      this.kmsService = kms.simulator;
      if (this.rdsApiHandler) this.rdsApiHandler.kmsService = this.kmsService;
    }

    const secretManager = server.getService('secret-manager');
    if (secretManager?.simulator) {
      this.secretManagerService = secretManager.simulator;
      if (this.dataApiHandler) this.dataApiHandler.secretManagerService = this.secretManagerService;
    }

    const cloudTrail = server.getService('cloudtrail');
    if (cloudTrail?.simulator) {
      this.cloudTrailService = cloudTrail.simulator;
      if (this.rdsApiHandler) this.rdsApiHandler.cloudTrailService = this.cloudTrailService;
      if (this.dataApiHandler) this.dataApiHandler.cloudTrailService = this.cloudTrailService;
    }

    const cloudWatch = server.getService('cloudwatch');
    if (cloudWatch?.simulator) {
      this.cloudWatchService = cloudWatch.simulator;
      if (this.dataApiHandler) this.dataApiHandler.cloudWatchService = this.cloudWatchService;
    }
  }

  async start() {
    if (this.isRunning) return;
    await this.server.start();
    this.isRunning = true;
  }

  async stop() {
    if (!this.isRunning) return;
    await this.server.stop();
    if (this.dbEngine) this.dbEngine.close();
    if (this.clusterManager?.metaDb) {
      this.clusterManager.metaDb.close();
      this.clusterManager.metaDb = null;
    }
    this.isRunning = false;
  }

  async reset() {
    // Reset cluster metadata first (clears rows but keeps metaDb open)
    if (this.clusterManager) {
      this.clusterManager.reset();
      // Also clear the JSON persistence file
      const dataDir = path.join(this.config.dataDir || './data', 'aurora');
      const store = new LocalStore(dataDir);
      store.delete('__aurora__');
    }
    // Close all user database connections and delete their files
    if (this.dbEngine) {
      this.dbEngine.close();
      // Remove only databases managed by DbEngine (not metadata.db)
      const fs = require('fs');
      const dataDir = this.dbEngine.dataDir;
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.db') && f !== 'metadata.db');
        for (const file of files) {
          fs.unlinkSync(path.join(dataDir, file));
        }
      }
    }
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      clusters: this.clusterManager?.listClusters?.()?.length || 0,
      databases: this.dbEngine?.listDatabases?.()?.length || 0,
      activeTransactions: this.dataApiHandler?.transactions?.size || 0
    };
  }

  getSimulator() {
    return {
      dataApiHandler: this.dataApiHandler,
      rdsApiHandler: this.rdsApiHandler,
      clusterManager: this.clusterManager,
      dbEngine: this.dbEngine
    };
  }

  getServer() {
    return this.server;
  }
}

module.exports = { AuroraService };
