'use strict';

/**
 * RDS SQL Server Service - ciclo de vida HTTP + TDS + SQLite.
 * O serviço é opt-in e roteia as chamadas AWS pelo gateway (prefixo /rds-sqlserver).
 */

const path = require('path');

const logger = require('../../utils/logger');
const LocalStore = require('../../utils/local-store');
const { getInternalHost } = require('../../gateway/internal-host');
const SqlServerServer = require('./server');
const { DbEngine } = require('./db-engine');
const { ClusterManager } = require('./cluster-manager');
const { DataApiHandler } = require('./data-api');
const { RdsApiHandler } = require('./rds-api');
const SqlTranslator = require('./sql-translator');
const { TdsServer } = require('./tds-server');

class SqlServerService {
  constructor(config, dependencies = {}) {
    this.config = config || {};
    this.name = 'rds-sqlserver';
    this.port = this.config.ports?.['rds-sqlserver'] ?? 4511;
    this.tdsPort = this.config.ports?.['rds-sqlserver-tds'] ?? 1433;
    this.dataDir = path.join(this.config.dataDir || './.aws-local-simulator-data', 'rds-sqlserver');

    this.server = null;
    this.tdsServer = null;
    this.dbEngine = null;
    this.clusterManager = null;
    this.dataApiHandler = null;
    this.rdsApiHandler = null;
    this.store = null;
    this.isRunning = false;

    this.kmsService = dependencies.kms?.simulator || dependencies.kms || null;
    this.secretManagerService = dependencies['secret-manager']?.simulator || dependencies['secret-manager'] || null;
    this.cloudTrailService = null;
    this.cloudWatchService = null;
  }

  async initialize() {
    logger.debug(`Inicializando RDS SQL Server nas portas ${this.port} (HTTP) e ${this.tdsPort} (TDS)...`);

    this.store = new LocalStore(this.dataDir);
    this.translator = new SqlTranslator('sqlserver-se');

    this.dbEngine = new DbEngine(this.dataDir, this.translator);
    this.clusterManager = new ClusterManager(this.dataDir, this.store);
    this.clusterManager.initialize();

    this.dataApiHandler = new DataApiHandler(this.dbEngine, this.translator, this.clusterManager, logger);
    this.rdsApiHandler = new RdsApiHandler(this.clusterManager, this.dbEngine, logger);

    this.server = new SqlServerServer(this.port, this.config);
    this.server.dataApiHandler = this.dataApiHandler;
    this.server.rdsApiHandler = this.rdsApiHandler;
    this.server.clusterManager = this.clusterManager;
    this.server.dbEngine = this.dbEngine;
    this.server.resetHandler = () => this.reset();
    await this.server.initialize();

    this.tdsServer = new TdsServer({
      port: this.tdsPort,
      host: getInternalHost(),
      clusterManager: this.clusterManager,
      dbEngine: this.dbEngine,
      logger,
    });

    this._wireDependencies({
      kms: this.kmsService,
      secretManager: this.secretManagerService,
      cloudTrail: this.cloudTrailService,
      cloudWatch: this.cloudWatchService,
    });

    logger.debug('RDS SQL Server inicializado');
  }

  injectDependencies(server) {
    const getSim = (name) => server.getService(name)?.simulator || null;
    this._wireDependencies({
      kms: getSim('kms'),
      secretManager: getSim('secret-manager'),
      cloudTrail: getSim('cloudtrail'),
      cloudWatch: getSim('cloudwatch'),
    });
  }

  _wireDependencies({ kms, secretManager, cloudTrail, cloudWatch }) {
    if (kms) {
      this.kmsService = kms;
      if (this.rdsApiHandler) this.rdsApiHandler.kmsService = kms;
    }
    if (secretManager) {
      this.secretManagerService = secretManager;
      if (this.dataApiHandler) this.dataApiHandler.secretManagerService = secretManager;
    }
    if (cloudTrail) {
      this.cloudTrailService = cloudTrail;
      if (this.rdsApiHandler) this.rdsApiHandler.cloudTrailService = cloudTrail;
      if (this.dataApiHandler) this.dataApiHandler.cloudTrailService = cloudTrail;
    }
    if (cloudWatch) {
      this.cloudWatchService = cloudWatch;
      if (this.dataApiHandler) this.dataApiHandler.cloudWatchService = cloudWatch;
    }
  }

  async start() {
    if (this.isRunning) return;

    // O stop() fecha o metadata.db; ao reiniciar o serviço ele precisa ser reaberto.
    if (this.clusterManager?.isClosed) this.clusterManager.initialize();

    await this.server.start();
    try {
      await this.tdsServer.start();
    } catch (error) {
      await this.server.stop();
      throw error;
    }
    this.isRunning = true;
  }

  async stop() {
    if (this.tdsServer) await this.tdsServer.stop();
    if (this.server) await this.server.stop();
    if (this.dataApiHandler) this.dataApiHandler.close();
    if (this.dbEngine) this.dbEngine.close();
    if (this.clusterManager) this.clusterManager.close();
    this.isRunning = false;
  }

  async reset() {
    if (this.tdsServer?.closeSessions) this.tdsServer.closeSessions();
    if (this.dataApiHandler) this.dataApiHandler.close();
    if (this.clusterManager) this.clusterManager.reset();
    if (this.store) this.store.delete('__rds-sqlserver__');
    if (this.dbEngine) this.dbEngine.reset();

    // Reabre o engine para que o serviço continue utilizável após o reset.
    this.dbEngine = new DbEngine(this.dataDir, this.translator);
    if (this.dataApiHandler) this.dataApiHandler.dbEngine = this.dbEngine;
    if (this.rdsApiHandler) this.rdsApiHandler.dbEngine = this.dbEngine;
    if (this.server) this.server.dbEngine = this.dbEngine;
    if (this.tdsServer) this.tdsServer.dbEngine = this.dbEngine;
  }

  getStatus() {
    const contar = (fn) => {
      try {
        return fn?.()?.length || 0;
      } catch {
        // Metadados podem estar fechados entre stop() e start().
        return 0;
      }
    };

    return {
      running: this.isRunning,
      port: this.port,
      tdsPort: this.tdsPort,
      endpoint: `http://localhost:${this.port}`,
      clusters: contar(() => this.clusterManager?.listClusters?.()),
      databases: contar(() => this.dbEngine?.listDatabases?.()),
      activeTransactions: this.dataApiHandler?.transactions?.size || 0,
      tds: this.tdsServer?.getStatus?.() || { running: false, port: this.tdsPort },
    };
  }

  getSimulator() {
    return {
      dataApiHandler: this.dataApiHandler,
      rdsApiHandler: this.rdsApiHandler,
      clusterManager: this.clusterManager,
      dbEngine: this.dbEngine,
      tdsServer: this.tdsServer,
    };
  }

  getServer() {
    return this.server;
  }
}

module.exports = { SqlServerService };
