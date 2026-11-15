const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getInternalHost } = require('../../gateway/internal-host');
const CloudFrontSimulator = require('./simulator');
const { validate: validateConfig } = require('./models');

/**
 * CloudFront REST API Server
 * Implements CloudFront API endpoints for distribution management and content delivery
 */
const xmlbuilder = require('xmlbuilder');

const CLOUDFRONT_NS = 'http://cloudfront.amazonaws.com/doc/2020-05-31/';

function appendXml(parent, name, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    const el = parent.ele(name);
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        const child = el.ele(name.endsWith('s') ? name.slice(0, -1) : name);
        for (const [k, v] of Object.entries(item)) appendXml(child, k, v);
      } else {
        el.ele(name.endsWith('s') ? name.slice(0, -1) : name, String(item));
      }
    }
    return;
  }
  if (typeof value === 'object') {
    const el = parent.ele(name);
    for (const [k, v] of Object.entries(value)) appendXml(el, k, v);
    return;
  }
  parent.ele(name, String(value));
}

/** <DistributionList> as returned by the CloudFront REST-XML API (ListDistributions). */
function distributionListXml(summaries) {
  const doc = xmlbuilder.create('DistributionList', { version: '1.0', encoding: 'UTF-8' });
  doc.att('xmlns', CLOUDFRONT_NS);
  doc.ele('Marker', '');
  doc.ele('MaxItems', 100);
  doc.ele('IsTruncated', false);
  doc.ele('Quantity', summaries.length);
  const items = doc.ele('Items');
  for (const summary of summaries) {
    const el = items.ele('DistributionSummary');
    for (const [k, v] of Object.entries(summary)) appendXml(el, k, v);
  }
  return doc.end({ pretty: false });
}

class CloudFrontServer {
  constructor(options = {}) {
    this.app = express();
    // Entrega de conteúdo (GET /{distributionId}/...) é pública, como no CloudFront.
    require('../../auth/guard').attachAuthGuard(this.app, {
      service: 'cloudfront',
      format: 'xml',
      exempt: (req) => {
        const seg = req.url.split('?')[0].split('/').filter(Boolean);
        return req.method === 'GET' && seg.length >= 2 && !['distribution', 'json', 'cache', 'health'].includes(seg[0]);
      },
    });
    this.simulator = new CloudFrontSimulator(options);
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // CORS middleware
    this.app.use((req, res, next) => {
      console.log('[CORS] Request:', req.method, req.path);
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Amz-Date, X-Amz-Security-Token');
      
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      
      next();
    });
    
    this.app.use(express.json());
    
    // Error handling middleware
    this.app.use((err, req, res, next) => {
      console.error('CloudFront Error:', err);
      res.status(err.status || 500).json({
        Error: {
          Code: err.code || 'InternalError',
          Message: err.message || 'Internal server error'
        }
      });
    });
  }

  setupRoutes() {
    // Distributions
    this.app.post('/distribution', this.createDistribution.bind(this));
    this.app.get('/distribution/:id', this.getDistribution.bind(this));
    this.app.get('/distribution', this.listDistributions.bind(this));
    this.app.put('/distribution/:id', this.updateDistribution.bind(this));
    this.app.delete('/distribution/:id', this.deleteDistribution.bind(this));

    // Distribution Config
    this.app.get('/distribution/:id/config', this.getDistributionConfig.bind(this));
    this.app.put('/distribution/:id/config', this.updateDistributionConfig.bind(this));

    // Invalidations
    this.app.post('/distribution/:id/invalidation', this.createInvalidation.bind(this));
    this.app.get('/distribution/:id/invalidation/:invalidationId', this.getInvalidation.bind(this));

    // Statistics
    this.app.get('/distribution/:id/stats', this.getDistributionStats.bind(this));
    this.app.get('/cache/stats', this.getCacheStats.bind(this));

    // Signed URLs
    this.app.post('/distribution/:id/signed-url', this.generateSignedUrl.bind(this));

    // ── JSON routes for React frontend ────────────────────────────────────
    this.app.get('/json/cloudfront/distributions', (req, res, next) => {
      try {
        const distributions = this.simulator.listDistributions();
        res.json(distributions.map(d => d.toAWSFormat?.() || d));
      } catch (error) {
        next(error);
      }
    });

    this.app.get('/json/cloudfront/distribution/:id', (req, res, next) => {
      try {
        const distribution = this.simulator.getDistribution(req.params.id);
        if (!distribution) {
          return res.status(404).json({ error: 'Distribution not found' });
        }
        res.json(distribution.toAWSFormat?.() || distribution);
      } catch (error) {
        next(error);
      }
    });

    this.app.post('/json/cloudfront/distribution', (req, res, next) => {
      this.createDistribution(req, res, next);
    });

    this.app.delete('/json/cloudfront/distribution/:id', (req, res, next) => {
      this.deleteDistribution(req, res, next);
    });

    this.app.get('/json/cloudfront/distribution/:id/invalidations', (req, res, next) => {
      try {
        const distribution = this.simulator.getDistribution(req.params.id);
        if (!distribution) {
          return res.status(404).json({ error: 'Distribution not found' });
        }
        const invalidations = distribution.invalidations || [];
        res.json(invalidations);
      } catch (error) {
        next(error);
      }
    });

    this.app.post('/json/cloudfront/distribution/:id/invalidation', (req, res, next) => {
      this.createInvalidation(req, res, next);
    });

    // Content delivery (GET requests) - must come AFTER /json routes
    this.app.get('/:distributionId/*', this.deliverContent.bind(this));

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'cloudfront',
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * POST /distribution
   * Create a new distribution
   */
  createDistribution(req, res, next) {
    try {
      const config = req.body;
      
      // Validate configuration
      const validation = validateConfig(config);
      if (!validation.isValid) {
        return res.status(400).json({
          Error: {
            Code: 'InvalidDistributionConfig',
            Message: validation.errors.join('; ')
          }
        });
      }

      const distribution = this.simulator.createDistribution(config);
      
      res.status(201).json({
        Distribution: distribution.toAWSFormat(),
        ETag: this._generateETag()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /distribution/:id
   * Get a distribution
   */
  getDistribution(req, res, next) {
    try {
      const distribution = this.simulator.getDistribution(req.params.id);
      
      if (!distribution) {
        return res.status(404).json({
          Error: {
            Code: 'NoSuchDistribution',
            Message: `Distribution with id ${req.params.id} not found`
          }
        });
      }

      res.json({
        Distribution: distribution.toAWSFormat(),
        ETag: this._generateETag()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /distribution
   * List distributions
   */
  listDistributions(req, res, next) {
    try {
      const distributions = this.simulator.listDistributions();
      if (req.awsApiVersionPrefix) {
        return res.type('application/xml').send(distributionListXml(distributions.map(d => d.toAWSFormat())));
      }
      
      res.json({
        DistributionList: {
          IsTruncated: false,
          Items: distributions.map(d => d.toAWSFormat()),
          Marker: '',
          MaxItems: 100,
          Quantity: distributions.length
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /distribution/:id
   * Update a distribution
   */
  updateDistribution(req, res, next) {
    try {
      const { config, ETag } = req.body;
      
      // In a real system, ETag would be checked for concurrency
      const distribution = this.simulator.getDistribution(req.params.id);
      if (!distribution) {
        return res.status(404).json({
          Error: {
            Code: 'NoSuchDistribution',
            Message: `Distribution not found`
          }
        });
      }

      // Update distribution (simplified - would merge config)
      const updated = this.simulator.createDistribution({
        ...distribution,
        ...config,
        id: req.params.id
      });

      res.json({
        Distribution: updated.toAWSFormat(),
        ETag: this._generateETag()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /distribution/:id
   * Delete a distribution
   */
  deleteDistribution(req, res, next) {
    try {
      const success = this.simulator.deleteDistribution(req.params.id);
      
      if (!success) {
        return res.status(404).json({
          Error: {
            Code: 'NoSuchDistribution',
            Message: 'Distribution not found'
          }
        });
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /distribution/:id/config
   * Get distribution config
   */
  getDistributionConfig(req, res, next) {
    try {
      const distribution = this.simulator.getDistribution(req.params.id);
      if (!distribution) {
        return res.status(404).json({
          Error: { Code: 'NoSuchDistribution' }
        });
      }

      res.json({
        DistributionConfig: distribution.toAWSFormat().DistributionConfig,
        ETag: this._generateETag()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /distribution/:id/config
   * Update distribution config
   */
  updateDistributionConfig(req, res, next) {
    try {
      const { DistributionConfig, ETag } = req.body;
      
      const distribution = this.simulator.getDistribution(req.params.id);
      if (!distribution) {
        return res.status(404).json({
          Error: { Code: 'NoSuchDistribution' }
        });
      }

      // Update config
      const updated = this.simulator.createDistribution({
        ...DistributionConfig,
        id: req.params.id
      });

      res.json({
        Distribution: updated.toAWSFormat(),
        ETag: this._generateETag()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /distribution/:id/invalidation
   * Create invalidation
   */
  createInvalidation(req, res, next) {
    try {
      const { paths } = req.body;
      
      if (!paths || paths.length === 0) {
        return res.status(400).json({
          Error: {
            Code: 'InvalidRequest',
            Message: 'At least one path must be specified for invalidation'
          }
        });
      }

      const result = this.simulator.invalidateDistribution(req.params.id, paths);
      
      if (result.error) {
        return res.status(404).json({
          Error: {
            Code: 'NoSuchDistribution',
            Message: result.error
          }
        });
      }

      res.status(201).json({
        Invalidation: result,
        Location: `/distribution/${req.params.id}/invalidation/${result.invalidationId}`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /distribution/:id/invalidation/:invalidationId
   * Get invalidation status
   */
  getInvalidation(req, res, next) {
    try {
      // Simplified - would look up actual invalidation
      res.json({
        InvalidationList: {
          IsTruncated: false,
          Items: [{
            Id: req.params.invalidationId,
            CreateTime: new Date().toISOString(),
            Status: 'Completed'
          }],
          Marker: '',
          MaxItems: 100,
          Quantity: 1
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /distribution/:id/stats
   * Get distribution statistics
   */
  getDistributionStats(req, res, next) {
    try {
      const stats = this.simulator.getDistributionStats(req.params.id);
      
      if (!stats) {
        return res.status(404).json({
          Error: { Code: 'NoSuchDistribution' }
        });
      }

      res.json({ stats });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /cache/stats
   * Get cache statistics
   */
  getCacheStats(req, res, next) {
    try {
      const stats = this.simulator.getCacheStats();
      res.json({ stats });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /distribution/:id/signed-url
   * Generate a signed URL
   */
  generateSignedUrl(req, res, next) {
    try {
      const { resourcePath, privateKey, keyPairId, expirationTime } = req.body;

      if (!resourcePath || !privateKey || !keyPairId || !expirationTime) {
        return res.status(400).json({
          Error: {
            Code: 'InvalidRequest',
            Message: 'Missing required parameters'
          }
        });
      }

      const signedUrl = this.simulator.generateSignedUrl(
        req.params.id,
        resourcePath,
        privateKey,
        keyPairId,
        expirationTime
      );

      res.json({
        signedUrl: signedUrl,
        expiresIn: expirationTime,
        expiresAt: new Date(Date.now() + expirationTime * 1000)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /:distributionId/*
   * Deliver content from distribution
   */
  async deliverContent(req, res, next) {
    try {
      const { distributionId } = req.params;
      const path = '/' + (req.params[0] || '');

      // Requisições ao origin devolvem Promise; sem o await o servidor respondia um objeto vazio.
      const response = await this.simulator.processRequest({
        distributionId: distributionId,
        path: path,
        method: req.method,
        headers: req.headers,
        clientIp: req.ip,
        protocol: req.protocol,
        url: req.originalUrl
      });

      res.status(response.status || 200);
      
      if (response.headers) {
        Object.entries(response.headers).forEach(([key, value]) => {
          res.set(key, value);
        });
      }

      res.set('X-Cache', response.cacheStatus || 'MISS');
      res.set('X-Amz-Cf-Id', response.xAmzCfId);

      res.send(response.body || response.error || 'OK');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Start the server
   * @param {number} port - Port to listen on
   */
  listen(port, host = getInternalHost()) {
    const http = require('http');
    const app = this.app;
    // Strip the API version prefix the AWS CLI/SDK sends (/2020-05-31/distribution) before the
    // app and its auth guard see the path, and mark the request so the handler answers in XML.
    this.server = http.createServer((req, res) => {
      const match = /^\/2020-05-31(?=\/|\?|$)/.exec(req.url);
      if (match) {
        req.awsApiVersionPrefix = true;
        req.url = req.url.slice(match[0].length) || '/';
      }
      app(req, res);
    }).listen(port, host, () => {
      console.log(`CloudFront server listening on port ${port}`);
    });
    return this.server;
  }

  /**
   * Get Express app instance
   */
  getApp() {
    return this.app;
  }

  /**
   * Private Methods
   */

  _generateETag() {
    return '"' + Math.random().toString(36).substring(2, 15) + '"';
  }
}

module.exports = CloudFrontServer;
