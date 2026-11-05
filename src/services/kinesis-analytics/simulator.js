/**
 * Kinesis Data Analytics Simulator
 * Simulador de Kinesis Data Analytics com suporte a aplicações e queries
 */

const { Application } = require('./models/application');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');
const path = require('path');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');

class KinesisAnalyticsSimulator {
  constructor(config) {
    this.config = config;
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'kinesis-analytics');

    this.store = new LocalStore(this.dataDir);
    this.applications = new Map();
    this.audit = new CloudTrailAudit('kinesisanalytics.amazonaws.com');

    // Mutexes por aplicação
    this._appLocks = new Map();
  }

  /**
   * Executa operação com lock exclusivo por aplicação
   */
  _withAppLock(appName, fn) {
    const prev = this._appLocks.get(appName) || Promise.resolve();
    const next = prev.then(() => fn());
    this._appLocks.set(appName, next.catch(() => {}));
    return next;
  }

  async initialize() {
    logger.debug('Inicializando Kinesis Data Analytics Simulator...');
    this.loadApplications();

    // Cria aplicações da configuração
    if (this.config['kinesis-analytics']?.applications) {
      for (const appConfig of this.config['kinesis-analytics'].applications) {
        if (!this.applications.has(appConfig.name)) {
          this.createApplication(appConfig.name, appConfig);
        }
      }
    }

    logger.debug(`✅ Kinesis Data Analytics Simulator inicializado com ${this.applications.size} aplicações`);
  }

  /**
   * Carrega aplicações persistidas
   */
  loadApplications() {
    const metadata = this.store.read('__applications__');
    if (!metadata) return;

    for (const [appName, appData] of Object.entries(metadata)) {
      const app = new Application(appName, appData);
      this.applications.set(appName, app);
    }

    logger.debug(`Carregadas ${this.applications.size} aplicações`);
  }

  /**
   * Persiste metadados de aplicações
   */
  persistApplications() {
    const metadata = {};

    for (const [appName, app] of this.applications) {
      metadata[appName] = app.toJSON();
    }

    this.store.write('__applications__', metadata);
  }

  /**
   * Cria uma nova aplicação
   */
  createApplication(applicationName, config = {}) {
    if (this.applications.has(applicationName)) {
      throw new Error(`Application '${applicationName}' already exists`);
    }

    const app = new Application(applicationName, config);
    this.applications.set(applicationName, app);
    this.persistApplications();

    this.audit.record({
      eventName: 'CreateApplication',
      readOnly: false,
      resources: [{
        ARN: app.applicationArn,
        type: 'AWS::KinesisAnalytics::Application'
      }],
      requestParameters: { applicationName }
    });

    logger.info(`✅ Aplicação criada: ${applicationName}`);

    return {
      ApplicationSummary: {
        ApplicationName: applicationName,
        ApplicationArn: app.applicationArn,
        ApplicationStatus: app.applicationStatus,
        ApplicationVersionId: app.applicationVersionId,
        CreationTimestamp: app.creationTimestamp
      }
    };
  }

  /**
   * Descreve uma aplicação
   */
  describeApplication(applicationName) {
    const app = this.applications.get(applicationName);
    if (!app) {
      throw new Error(`Application '${applicationName}' not found`);
    }

    return app.describe();
  }

  /**
   * Lista aplicações
   */
  listApplications(params = {}) {
    const { Limit = 50 } = params;
    const appNames = Array.from(this.applications.keys());
    const result = appNames.slice(0, Limit);

    return {
      ApplicationSummaries: result.map(name => {
        const app = this.applications.get(name);
        return {
          ApplicationName: app.applicationName,
          ApplicationArn: app.applicationArn,
          ApplicationStatus: app.applicationStatus,
          ApplicationVersionId: app.applicationVersionId,
          CreationTimestamp: app.creationTimestamp
        };
      }),
      HasMoreApplications: result.length === Limit
    };
  }

  /**
   * Deleta uma aplicação
   */
  deleteApplication(applicationName, currentApplicationVersionId) {
    const app = this.applications.get(applicationName);
    if (!app) {
      throw new Error(`Application '${applicationName}' not found`);
    }

    if (currentApplicationVersionId && app.applicationVersionId !== currentApplicationVersionId) {
      throw new Error('ConcurrentModificationException: Current version does not match');
    }

    this.applications.delete(applicationName);
    this.persistApplications();

    this.audit.record({
      eventName: 'DeleteApplication',
      readOnly: false,
      resources: [{
        ARN: app.applicationArn,
        type: 'AWS::KinesisAnalytics::Application'
      }],
      requestParameters: { applicationName }
    });

    logger.info(`✅ Aplicação deletada: ${applicationName}`);

    return {};
  }

  /**
   * Adiciona input a uma aplicação
   */
  addApplicationInput(applicationName, config) {
    const app = this.applications.get(applicationName);
    if (!app) {
      throw new Error(`Application '${applicationName}' not found`);
    }

    return this._withAppLock(applicationName, () => {
      const input = app.addInput(config.Input.NamePrefix, {
        sourceStreamArn: config.Input.InputParallelism?.InputParallelismCount || 1,
        schema: config.Input.InputSchema
      });

      app.applicationVersionId++;
      this.persistApplications();

      this.audit.record({
        eventName: 'AddApplicationInput',
        readOnly: false,
        resources: [{
          ARN: app.applicationArn,
          type: 'AWS::KinesisAnalytics::Application'
        }],
        requestParameters: { applicationName, inputName: input.inputName }
      });

      return {};
    });
  }

  /**
   * Remove input de uma aplicação
   */
  deleteApplicationInput(applicationName, inputId) {
    const app = this.applications.get(applicationName);
    if (!app) {
      throw new Error(`Application '${applicationName}' not found`);
    }

    return this._withAppLock(applicationName, () => {
      const input = Array.from(app.inputs.values()).find(i => i.inputId === inputId);
      if (!input) {
        throw new Error(`Input '${inputId}' not found`);
      }

      app.removeInput(input.inputName);
      app.applicationVersionId++;
      this.persistApplications();

      return {};
    });
  }

  /**
   * Adiciona output a uma aplicação
   */
  addApplicationOutput(applicationName, config) {
    const app = this.applications.get(applicationName);
    if (!app) {
      throw new Error(`Application '${applicationName}' not found`);
    }

    return this._withAppLock(applicationName, () => {
      const output = app.addOutput(config.Output.Name, {
        destination: config.Output.Destination,
        destinationSchema: config.Output.DestinationSchema
      });

      app.applicationVersionId++;
      this.persistApplications();

      this.audit.record({
        eventName: 'AddApplicationOutput',
        readOnly: false,
        resources: [{
          ARN: app.applicationArn,
          type: 'AWS::KinesisAnalytics::Application'
        }],
        requestParameters: { applicationName, outputName: output.outputName }
      });

      return {};
    });
  }

  /**
   * Remove output de uma aplicação
   */
  deleteApplicationOutput(applicationName, outputId) {
    const app = this.applications.get(applicationName);
    if (!app) {
      throw new Error(`Application '${applicationName}' not found`);
    }

    return this._withAppLock(applicationName, () => {
      const output = Array.from(app.outputs.values()).find(o => o.outputId === outputId);
      if (!output) {
        throw new Error(`Output '${outputId}' not found`);
      }

      app.removeOutput(output.outputName);
      app.applicationVersionId++;
      this.persistApplications();

      return {};
    });
  }

  /**
   * Atualiza código SQL da aplicação
   */
  updateApplicationCode(applicationName, sqlCode) {
    const app = this.applications.get(applicationName);
    if (!app) {
      throw new Error(`Application '${applicationName}' not found`);
    }

    return this._withAppLock(applicationName, () => {
      app.setSqlCode(sqlCode);
      app.applicationVersionId++;
      this.persistApplications();

      this.audit.record({
        eventName: 'UpdateApplicationCode',
        readOnly: false,
        resources: [{
          ARN: app.applicationArn,
          type: 'AWS::KinesisAnalytics::Application'
        }],
        requestParameters: { applicationName }
      });

      logger.info(`✅ Código da aplicação ${applicationName} atualizado`);

      return {};
    });
  }

  /**
   * Inicia uma aplicação
   */
  startApplication(applicationName, runConfiguration) {
    const app = this.applications.get(applicationName);
    if (!app) {
      throw new Error(`Application '${applicationName}' not found`);
    }

    app.applicationStatus = 'RUNNING';
    this.persistApplications();

    this.audit.record({
      eventName: 'StartApplication',
      readOnly: false,
      resources: [{
        ARN: app.applicationArn,
        type: 'AWS::KinesisAnalytics::Application'
      }],
      requestParameters: { applicationName }
    });

    logger.info(`✅ Aplicação iniciada: ${applicationName}`);

    return {};
  }

  /**
   * Para uma aplicação
   */
  stopApplication(applicationName) {
    const app = this.applications.get(applicationName);
    if (!app) {
      throw new Error(`Application '${applicationName}' not found`);
    }

    app.applicationStatus = 'READY';
    this.persistApplications();

    this.audit.record({
      eventName: 'StopApplication',
      readOnly: false,
      resources: [{
        ARN: app.applicationArn,
        type: 'AWS::KinesisAnalytics::Application'
      }],
      requestParameters: { applicationName }
    });

    logger.info(`✅ Aplicação parada: ${applicationName}`);

    return {};
  }

  /**
   * Obtém estatísticas do simulator
   */
  getStats() {
    const stats = {
      applicationsCount: this.applications.size,
      totalInputs: 0,
      totalOutputs: 0,
      applications: []
    };

    for (const [appName, app] of this.applications) {
      const appStats = app.toJSON();
      stats.totalInputs += appStats.inputCount;
      stats.totalOutputs += appStats.outputCount;
      stats.applications.push(appStats);
    }

    return stats;
  }

  /**
   * Reset - limpa todos os dados
   */
  async reset() {
    this.applications.clear();
    this.store.write('__applications__', {});

    logger.info('✅ Kinesis Data Analytics Simulator resetado');
  }
}

module.exports = KinesisAnalyticsSimulator;
