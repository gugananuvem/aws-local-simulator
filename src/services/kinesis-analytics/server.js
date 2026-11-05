/**
 * Kinesis Data Analytics Server - Servidor HTTP REST/JSON para Analytics
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');

class KinesisAnalyticsServer {
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
    this.app.use(express.json({ limit: '10mb' }));

    // Custom header parsing para AWS SDK
    this.app.use((req, res, next) => {
      const target = req.headers['x-amz-target'];
      if (target) {
        const [, action] = target.split('.');
        req.action = action;
      }

      logger.debug(`Kinesis Analytics: ${req.method} ${req.path} - Action: ${req.action || 'none'}`);
      next();
    });
  }

  async initialize() {
    logger.debug(`Inicializando Kinesis Data Analytics Server na porta ${this.port}`);
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.post('/', (req, res) => {
      const action = req.action || req.body.Action;

      try {
        switch (action) {
          case 'CreateApplication':
            return this.createApplication(req, res);
          case 'DescribeApplication':
            return this.describeApplication(req, res);
          case 'ListApplications':
            return this.listApplications(req, res);
          case 'DeleteApplication':
            return this.deleteApplication(req, res);
          case 'AddApplicationInput':
            return this.addApplicationInput(req, res);
          case 'DeleteApplicationInput':
            return this.deleteApplicationInput(req, res);
          case 'AddApplicationOutput':
            return this.addApplicationOutput(req, res);
          case 'DeleteApplicationOutput':
            return this.deleteApplicationOutput(req, res);
          case 'UpdateApplicationCode':
            return this.updateApplicationCode(req, res);
          case 'StartApplication':
            return this.startApplication(req, res);
          case 'StopApplication':
            return this.stopApplication(req, res);
          default:
            res.status(400).json({ __type: 'UnknownAction', message: `Unknown action: ${action}` });
        }
      } catch (error) {
        res.status(400).json({ __type: 'InternalFailure', message: error.message });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'kinesis-analytics',
        port: this.port,
        stats: this.simulator.getStats()
      });
    });
  }

  async createApplication(req, res) {
    const { ApplicationName, RuntimeEnvironment = 'SQL_1_0', ApplicationDescription = '' } = req.body;

    if (!ApplicationName) {
      throw new Error('ApplicationName is required');
    }

    const result = this.simulator.createApplication(ApplicationName, {
      runtimeEnvironment: RuntimeEnvironment,
      applicationDescription: ApplicationDescription
    });

    res.status(201).json(result);
  }

  async describeApplication(req, res) {
    const { ApplicationName } = req.body;

    if (!ApplicationName) {
      throw new Error('ApplicationName is required');
    }

    const result = this.simulator.describeApplication(ApplicationName);
    res.json(result);
  }

  async listApplications(req, res) {
    const { Limit } = req.body;

    const result = this.simulator.listApplications({ Limit });
    res.json(result);
  }

  async deleteApplication(req, res) {
    const { ApplicationName, CurrentApplicationVersionId } = req.body;

    if (!ApplicationName) {
      throw new Error('ApplicationName is required');
    }

    const result = this.simulator.deleteApplication(ApplicationName, CurrentApplicationVersionId);
    res.json(result);
  }

  async addApplicationInput(req, res) {
    const { ApplicationName, CurrentApplicationVersionId, Input } = req.body;

    if (!ApplicationName || !Input) {
      throw new Error('ApplicationName and Input are required');
    }

    const result = this.simulator.addApplicationInput(ApplicationName, {
      Input,
      CurrentApplicationVersionId
    });

    res.json(result);
  }

  async deleteApplicationInput(req, res) {
    const { ApplicationName, CurrentApplicationVersionId, InputId } = req.body;

    if (!ApplicationName || !InputId) {
      throw new Error('ApplicationName and InputId are required');
    }

    const result = this.simulator.deleteApplicationInput(ApplicationName, InputId);
    res.json(result);
  }

  async addApplicationOutput(req, res) {
    const { ApplicationName, CurrentApplicationVersionId, Output } = req.body;

    if (!ApplicationName || !Output) {
      throw new Error('ApplicationName and Output are required');
    }

    const result = this.simulator.addApplicationOutput(ApplicationName, {
      Output,
      CurrentApplicationVersionId
    });

    res.json(result);
  }

  async deleteApplicationOutput(req, res) {
    const { ApplicationName, CurrentApplicationVersionId, OutputId } = req.body;

    if (!ApplicationName || !OutputId) {
      throw new Error('ApplicationName and OutputId are required');
    }

    const result = this.simulator.deleteApplicationOutput(ApplicationName, OutputId);
    res.json(result);
  }

  async updateApplicationCode(req, res) {
    const { ApplicationName, CurrentApplicationVersionId, ApplicationCode } = req.body;

    if (!ApplicationName || !ApplicationCode) {
      throw new Error('ApplicationName and ApplicationCode are required');
    }

    const result = this.simulator.updateApplicationCode(ApplicationName, ApplicationCode);
    res.json(result);
  }

  async startApplication(req, res) {
    const { ApplicationName, RunConfiguration } = req.body;

    if (!ApplicationName) {
      throw new Error('ApplicationName is required');
    }

    const result = this.simulator.startApplication(ApplicationName, RunConfiguration);
    res.json(result);
  }

  async stopApplication(req, res) {
    const { ApplicationName } = req.body;

    if (!ApplicationName) {
      throw new Error('ApplicationName is required');
    }

    const result = this.simulator.stopApplication(ApplicationName);
    res.json(result);
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info(`✅ Kinesis Data Analytics Server iniciado na porta ${this.port}`);
          resolve();
        });
      } catch (error) {
        logger.error(`❌ Erro ao iniciar Kinesis Data Analytics Server: ${error.message}`);
        reject(error);
      }
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            logger.error(`Erro ao parar Kinesis Data Analytics Server: ${err.message}`);
            reject(err);
          } else {
            logger.info('Kinesis Data Analytics Server parado');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = KinesisAnalyticsServer;
