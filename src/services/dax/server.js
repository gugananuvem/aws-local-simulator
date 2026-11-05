const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');

class DAXServer {
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
        return ct.includes('application/x-amz-json') || ct.includes('application/json');
      }
    }));
  }

  async initialize() {
    if (!this.simulator) {
      const DAXSimulator = require('./simulator');
      this.simulator = new DAXSimulator(this.config);
      await this.simulator.initialize();
    }
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.post('/', async (req, res) => {
      const target = req.headers['x-amz-target'];
      if (!target) {
        return res.status(400).json({ message: 'Missing X-Amz-Target header' });
      }
      const action = target.split('.')[1];
      try {
        const result = await this.simulator.handleRequest(action, req.body);
        res.json(result);
      } catch (error) {
        logger.error('DAX Error:', error);
        res.status(400).json({
          __type: error.code || 'InternalServerError',
          message: error.message
        });
      }
    });

    this.app.get('/__admin/clusters', (req, res) => {
      res.json(this.simulator.describeClusters());
    });
    this.app.get('/__admin/subnet-groups', (req, res) => {
      res.json(this.simulator.describeSubnetGroups());
    });
    this.app.get('/__admin/parameter-groups', (req, res) => {
      res.json(this.simulator.describeParameterGroups());
    });
    this.app.get('/__admin/events', (req, res) => {
      res.json(this.simulator.describeEvents());
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`⚡ DAX rodando em http://localhost:${this.port}`);
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
      clustersCount: this.simulator?.getClustersCount() || 0
    };
  }
}

module.exports = DAXServer;
