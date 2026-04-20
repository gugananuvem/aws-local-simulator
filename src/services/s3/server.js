/**
 * S3 Server - Servidor HTTP para S3
 */

const express = require('express');
const cors = require('cors');
const S3Simulator = require('./simulator');
const logger = require('../../utils/logger');

class S3Server {
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
    // Captura raw body como Buffer para qualquer content-type
    this.app.use(express.raw({ type: () => true, limit: '100mb' }));
    this.app.use(express.text({ limit: '100mb' }));
    
    // Logging de requisições
    if (logger.currentLogLevel === 'verboso') {
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.verboso(`S3: ${req.method} ${req.path} - ${duration}ms`);
        });
        next();
      });
    }
  }

  async initialize() {
    if (!this.simulator) {
      this.simulator = new S3Simulator(this.config);
      await this.simulator.initialize();
    }
    this.setupRoutes();
  }

  setupRoutes() {
    // Admin endpoints devem vir antes das rotas S3 para evitar conflito com /:bucket
    this.setupAdminRoutes();

    // Website static serving: GET /website/{bucket}/[path]
    this.app.get('/website/:bucket', (req, res) => this._serveWebsite(req, res, ''));
    this.app.get('/website/:bucket/*', (req, res) => this._serveWebsite(req, res, req.params[0]));

    // Listar buckets
    this.app.get('/', (req, res) => {
      const buckets = this.simulator.listBuckets();
      res.set('Content-Type', 'application/xml');
      res.send(this.simulator.generateListBucketsResponse(buckets));
    });
    
    // Criar bucket
    this.app.put('/:bucket', (req, res) => {
      if (req.query.website !== undefined) {
        let config = {};
        try { config = JSON.parse(req.body?.toString() || '{}'); } catch (_) {}
        const result = this.simulator.putWebsiteConfig(req.params.bucket, config);
        if (result.error) {
          return res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
        }
        return res.status(200).send();
      }
      const result = this.simulator.createBucket(req.params.bucket);
      if (result.error) {
        res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
      } else {
        res.status(200).send();
      }
    });
    
    // Deletar bucket
    this.app.delete('/:bucket', (req, res) => {
      if (req.query.website !== undefined) {
        const result = this.simulator.deleteWebsiteConfig(req.params.bucket);
        if (result.error) {
          return res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
        }
        return res.status(204).send();
      }
      const result = this.simulator.deleteBucket(req.params.bucket);
      if (result.error) {
        res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
      } else {
        res.status(204).send();
      }
    });
    
    // Head bucket
    this.app.head('/:bucket', (req, res) => {
      const bucket = this.simulator.getBucket(req.params.bucket);
      if (!bucket) {
        res.status(404).send();
      } else {
        res.status(200).send();
      }
    });
    
    // Upload object
    this.app.put('/:bucket/*', (req, res) => {
      try {
        const bucket = req.params.bucket;
        const key = req.params[0];
        const result = this.simulator.putObject(bucket, key, req.body, req.headers);
        
        if (result.error) {
          res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
        } else {
          res.set('ETag', `"${result.etag}"`);
          res.status(200).send();
        }
      } catch (err) {
        logger.error('S3 putObject error:', err);
        res.status(500).send(this.simulator.generateErrorResponse('InternalError', err.message));
      }
    });
    
    // Get object
    this.app.get('/:bucket/*', (req, res) => {
      const bucket = req.params.bucket;
      const key = req.params[0];
      const result = this.simulator.getObject(bucket, key, req.headers);
      
      if (result.error) {
        res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
      } else {
        res.set('ETag', `"${result.etag}"`);
        res.set('Last-Modified', result.lastModified);
        res.set('Content-Type', result.contentType);
        res.set('Content-Length', result.size);
        
        if (result.metadata) {
          Object.entries(result.metadata).forEach(([k, v]) => {
            res.set(`x-amz-meta-${k}`, v);
          });
        }
        
        res.send(result.content);
      }
    });
    
    // Head object
    this.app.head('/:bucket/*', (req, res) => {
      const bucket = req.params.bucket;
      const key = req.params[0];
      const result = this.simulator.headObject(bucket, key);
      
      if (result.error) {
        res.status(result.status).send();
      } else {
        res.set('ETag', `"${result.etag}"`);
        res.set('Last-Modified', result.lastModified);
        res.set('Content-Type', result.contentType);
        res.set('Content-Length', result.size);
        res.status(200).send();
      }
    });
    
    // Delete object
    this.app.delete('/:bucket/*', (req, res) => {
      const bucket = req.params.bucket;
      const key = req.params[0];
      const result = this.simulator.deleteObject(bucket, key);
      
      if (result.error) {
        res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
      } else {
        res.status(204).send();
      }
    });
    
    // Website config
    this.app.get('/:bucket', (req, res) => {
      if (req.query.website !== undefined) {
        const result = this.simulator.getWebsiteConfig(req.params.bucket);
        if (result.error) {
          return res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
        }
        return res.set('Content-Type', 'application/xml').send(this._generateWebsiteConfigXml(result.websiteConfiguration));
      }
      const bucket = req.params.bucket;
      const prefix = req.query.prefix || '';
      const delimiter = req.query.delimiter;
      const maxKeys = parseInt(req.query['max-keys']) || 1000;
      const listType = req.query['list-type'];
      
      const result = this.simulator.listObjects(bucket, { prefix, delimiter, maxKeys });
      
      if (result.error) {
        res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
      } else {
        res.set('Content-Type', 'application/xml');
        if (listType === '2') {
          res.send(this.simulator.generateListObjectsV2Response(result));
        } else {
          res.send(this.simulator.generateListObjectsResponse(result));
        }
      }
    });
    
    // Admin endpoints
    // (já registrados no início de setupRoutes)
  }

  setupAdminRoutes() {
    this.app.get('/__admin/buckets', (req, res) => {
      res.json(this.simulator.getBucketsInfo());
    });
    
    this.app.get('/__admin/buckets/:bucket', (req, res) => {
      const info = this.simulator.getBucketInfo(req.params.bucket);
      if (info.error) {
        res.status(404).json(info.error);
      } else {
        res.json(info);
      }
    });
    
    this.app.get('/__admin/buckets/:bucket/objects', (req, res) => {
      const objects = this.simulator.listAllObjects(req.params.bucket);
      res.json(objects);
    });
    
    this.app.delete('/__admin/buckets/:bucket', (req, res) => {
      this.simulator.clearBucket(req.params.bucket);
      res.json({ message: `Bucket ${req.params.bucket} cleared` });
    });
    
    this.app.delete('/__admin/buckets/:bucket/objects/:key', (req, res) => {
      this.simulator.deleteObject(req.params.bucket, req.params.key);
      res.json({ message: 'Object deleted' });
    });
    
    this.app.get('/__admin/stats', (req, res) => {
      res.json(this.simulator.getStats());
    });
  }

  _serveWebsite(req, res, keyPath) {
    const bucketName = req.params.bucket;
    const bucket = this.simulator.getBucket(bucketName);

    if (!bucket) {
      return res.status(404).send('<html><body><h1>404 - Bucket not found</h1></body></html>');
    }

    if (!bucket.website) {
      return res.status(403).send('<html><body><h1>403 - This bucket does not have static website hosting enabled</h1></body></html>');
    }

    const websiteConfig = bucket.websiteConfiguration || {};
    const indexDoc = websiteConfig.IndexDocument?.Suffix || 'index.html';
    const errorDoc = websiteConfig.ErrorDocument?.Key   || 'error.html';

    // Resolve a chave: path vazio ou terminando em '/' serve o indexDocument
    let key = keyPath || '';
    if (!key || key.endsWith('/')) {
      key = key + indexDoc;
    }

    let result = this.simulator.getObject(bucketName, key, req.headers);

    // Se não encontrou e não tem extensão, tenta com indexDoc dentro do path
    if (result.error && !key.includes('.')) {
      result = this.simulator.getObject(bucketName, key + '/' + indexDoc, req.headers);
    }

    if (result.error) {
      const errorResult = this.simulator.getObject(bucketName, errorDoc, req.headers);
      if (!errorResult.error) {
        res.status(404).set('Content-Type', errorResult.contentType || 'text/html');
        return res.send(errorResult.content);
      }
      return res.status(404).send('<html><body><h1>404 - Not Found</h1></body></html>');
    }

    res.set('Content-Type', result.contentType || 'text/html');
    res.set('ETag', `"${result.etag}"`);
    res.set('Last-Modified', result.lastModified);
    res.send(result.content);
  }

  _generateWebsiteConfigXml(config) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<WebsiteConfiguration>
  <IndexDocument><Suffix>${config.IndexDocument?.Suffix || 'index.html'}</Suffix></IndexDocument>
  <ErrorDocument><Key>${config.ErrorDocument?.Key || 'error.html'}</Key></ErrorDocument>
</WebsiteConfiguration>`;
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🗄️  S3 rodando em http://localhost:${this.port}`);
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
      bucketsCount: this.simulator?.getBucketsCount() || 0,
      objectsCount: this.simulator?.getTotalObjectsCount() || 0
    };
  }
}

module.exports = S3Server;