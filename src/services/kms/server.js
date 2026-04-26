'use strict';

const express = require('express');
const cors = require('cors');

class KMSServer {
  constructor(simulator, logger, config) {
    this.simulator = simulator;
    this.logger = logger;
    this.config = config;
    this.app = express();
    this._setupMiddleware();
    this._setupRoutes();
  }

  _setupMiddleware() {
    if (this.config.cors?.enabled !== false) this.app.use(cors({ origin: this.config.cors?.origin || '*' }));
    this.app.use(express.json({ limit: '5mb', type: ['application/json', 'application/x-amz-json-1.1'] }));
    this.app.use((req, res, next) => { this.logger.debug(`KMS ${req.headers['x-amz-target']}`, 'kms'); next(); });
  }

  _getOperation(target) {
    const map = {
      'TrentService.CreateKey': 'createKey',
      'TrentService.DescribeKey': 'describeKey',
      'TrentService.ListKeys': 'listKeys',
      'TrentService.EnableKey': 'enableKey',
      'TrentService.DisableKey': 'disableKey',
      'TrentService.ScheduleKeyDeletion': 'scheduleKeyDeletion',
      'TrentService.CancelKeyDeletion': 'cancelKeyDeletion',
      'TrentService.CreateAlias': 'createAlias',
      'TrentService.DeleteAlias': 'deleteAlias',
      'TrentService.ListAliases': 'listAliases',
      'TrentService.Encrypt': 'encrypt',
      'TrentService.Decrypt': 'decrypt',
      'TrentService.GenerateDataKey': 'generateDataKey',
      'TrentService.GenerateDataKeyWithoutPlaintext': 'generateDataKeyWithoutPlaintext',
      'TrentService.GenerateDataKeyPair': 'generateDataKeyPair',
      'TrentService.Sign': 'sign',
      'TrentService.Verify': 'verify',
      'TrentService.GenerateRandom': 'generateRandom',
    };
    return map[target];
  }

  _setupRoutes() {
    this.app.get('/__admin/health', (req, res) => res.json({ status: 'healthy', service: 'kms', timestamp: new Date().toISOString() }));
    this.app.get('/__admin/keys', async (req, res) => {
      const keys = this.simulator.listKeysFull();
      res.json(keys);
    });

    this.app.post('/__admin/keys', async (req, res) => {
      try {
        const result = await this.simulator.createKey(req.body);
        res.status(201).json(result);
      } catch (err) {
        res.status(400).json({ __type: err.code || 'KMSInternalException', message: err.message });
      }
    });



    this.app.post('/', async (req, res) => {
      const target = req.headers['x-amz-target'];
      const operation = this._getOperation(target);
      if (!operation) return res.status(400).json({ __type: 'UnknownOperationException', message: `Unknown: ${target}` });
      try {
        const result = await this.simulator[operation](req.body || {});
        res.json(result || {});
      } catch (err) {
        this.logger.error(`KMS ${target}: ${err.message}`, 'kms');
        res.status(err.code === 'NotFoundException' ? 404 : 400).json({ __type: err.code || 'KMSInternalException', message: err.message });
      }
    });
  }

  getApp() { return this.app; }
}

module.exports = { KMSServer };
