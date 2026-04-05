'use strict';

const express = require('express');
const cors = require('cors');

class ParameterStoreServer {
  constructor(simulator, logger, config) {
    this.simulator = simulator; this.logger = logger; this.config = config;
    this.app = express();
    this._setupMiddleware(); this._setupRoutes();
  }
  _setupMiddleware() {
    if (this.config.cors?.enabled !== false) this.app.use(cors({ origin: this.config.cors?.origin || '*' }));
    this.app.use(express.json({ limit: '5mb', type: ['application/json', 'application/x-amz-json-1.1'] }));
  }
  _getOperation(target) {
    const map = {
      'AmazonSSM.PutParameter': 'putParameter',
      'AmazonSSM.GetParameter': 'getParameter',
      'AmazonSSM.GetParameters': 'getParameters',
      'AmazonSSM.GetParametersByPath': 'getParametersByPath',
      'AmazonSSM.DeleteParameter': 'deleteParameter',
      'AmazonSSM.DeleteParameters': 'deleteParameters',
      'AmazonSSM.DescribeParameters': 'describeParameters',
      'AmazonSSM.GetParameterHistory': 'getParameterHistory',
      'AmazonSSM.AddTagsToResource': 'addTagsToResource',
      'AmazonSSM.RemoveTagsFromResource': 'removeTagsFromResource',
    };
    return map[target];
  }
  _setupRoutes() {
    this.app.get('/__admin/health', (req, res) => res.json({ status: 'healthy', service: 'parameter-store', timestamp: new Date().toISOString() }));
    this.app.post('/', async (req, res) => {
      const target = req.headers['x-amz-target'];
      const operation = this._getOperation(target);
      if (!operation) return res.status(400).json({ __type: 'InvalidAction', message: `Unknown: ${target}` });
      try {
        const result = await this.simulator[operation](req.body || {});
        res.json(result || {});
      } catch (err) {
        this.logger.error(`ParameterStore ${target}: ${err.message}`, 'parameter-store');
        const statusCodes = { ParameterNotFound: 400, ParameterAlreadyExists: 400, ParameterPatternMismatch: 400 };
        res.status(statusCodes[err.code] || 500).json({ __type: err.code || 'InternalServerError', message: err.message });
      }
    });
  }
  getApp() { return this.app; }
}

module.exports = { ParameterStoreServer };
