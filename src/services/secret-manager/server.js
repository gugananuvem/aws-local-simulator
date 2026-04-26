'use strict';

const express = require('express');
const cors = require('cors');

class SecretManagerServer {
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
      'secretsmanager.CreateSecret': 'createSecret',
      'secretsmanager.GetSecretValue': 'getSecretValue',
      'secretsmanager.PutSecretValue': 'putSecretValue',
      'secretsmanager.UpdateSecret': 'updateSecret',
      'secretsmanager.DeleteSecret': 'deleteSecret',
      'secretsmanager.RestoreSecret': 'restoreSecret',
      'secretsmanager.ListSecrets': 'listSecrets',
      'secretsmanager.DescribeSecret': 'describeSecret',
      'secretsmanager.RotateSecret': 'rotateSecret',
      'secretsmanager.TagResource': 'tagResource',
      'secretsmanager.UntagResource': 'untagResource',
    };
    return map[target];
  }
  _setupRoutes() {
    this.app.get('/__admin/health', (req, res) => res.json({ status: 'healthy', service: 'secret-manager', timestamp: new Date().toISOString() }));
    this.app.post('/', async (req, res) => {
      const target = req.headers['x-amz-target'];
      const operation = this._getOperation(target);
      if (!operation) return res.status(400).json({ __type: 'UnknownOperationException', message: `Unknown: ${target}` });
      try {
        const result = await this.simulator[operation](req.body || {});
        res.setHeader('Content-Type', 'application/x-amz-json-1.1');
        res.send(JSON.stringify(result || {}));
      } catch (err) {
        this.logger.error(`SecretsManager ${target}: ${err.message}`, 'secret-manager');
        res.status(err.code === 'ResourceNotFoundException' ? 404 : 400).json({ __type: err.code || 'InternalServiceError', Message: err.message });
      }
    });
  }
  getApp() { return this.app; }
}

module.exports = { SecretManagerServer };
