const { setupServiceMiddleware } = require('../../middleware');
/**
 * S3 Server - Servidor HTTP para S3
 */

const express = require('express');
const cors = require('cors');
const S3Simulator = require('./simulator');
const logger = require('../../utils/logger');

class S3Server {
  constructor(port, config) {
    this.organizationsService = null;
    this.stsService = null;
    this.port = port;
    this.config = config;
    this.app = express();
    this.simulator = null;
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(cors());
    // Rotas administrativas recebem JSON; precisa vir antes do raw (que captura tudo).
    this.app.use('/__admin', express.json({ limit: '10mb' }));
    // Captura raw body como Buffer para qualquer content-type
    this.app.use(express.raw({ type: () => true, limit: '100mb' }));
    this.app.use(express.text({ limit: '100mb' }));
    
    // Suporte a Virtual Host Style addressing (bucket.localhost:4566)
    this.app.use((req, res, next) => {
      const host = req.headers.host || '';
      // Se o host contém múltiplos pontos e não é apenas um IP ou localhost puro
      if (host.includes('.') && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
        const parts = host.split('.');
        // O primeiro fragmento é o nome do bucket se houver mais de 2 partes (bucket.localhost:port)
        // ou se a segunda parte for localhost
        if (parts.length >= 2) {
          const bucket = parts[0];
          // Evita processar se for admin ou se já estiver no path style (heurística simples)
          if (bucket !== 'localhost' && !req.path.startsWith('/__admin/')) {
            req.url = `/${bucket}${req.url}`;
            logger.verboso(`S3: Virtual Host Style detected. Rewriting to ${req.url}`);
          }
        }
      }
      next();
    });

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
    // IAM enforcement (applied conditionally via injectDependencies)
    this.app.use((req, res, next) => {
      if (this.iamMiddleware && !req.path.startsWith('/__admin')) {
        return this.iamMiddleware(req, res, next);
      }
      next();
    });

    // Admin endpoints devem vir antes das rotas S3 para evitar conflito com /:bucket
    this.setupAdminRoutes();
    this.setupS3ExtendedAdminRoutes();

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
      if (req.query.notification !== undefined) {
        let config = {};
        try {
          const bodyStr = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body || '{}';
          config = JSON.parse(bodyStr);
        } catch (_) {}
        const result = this.simulator.putBucketNotificationConfiguration(req.params.bucket, config);
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
      if (req.query.notification !== undefined) {
        const result = this.simulator.getBucketNotificationConfiguration(req.params.bucket);
        if (result.error) {
          return res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
        }
        return res.set('Content-Type', 'application/xml').send(this._generateNotificationConfigXml(result.notificationConfiguration));
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
    // (já registrados no início de setupRoutes, antes das rotas wildcard de objetos)
  }

  setupS3ExtendedAdminRoutes() {
    // General purpose buckets
    this.app.post('/__admin/s3/general-buckets', (req, res) => {
      const result = this.simulator.createBucket(
        req.body?.name || req.body?.Name || req.body?.bucketName,
        req.body || {}
      );
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(this.simulator._generalBucketToJson(result.bucket));
    });

    // Directory buckets
    this.app.get('/__admin/s3/directory-buckets', (req, res) => res.json(this.simulator.listDirectoryBuckets()));
    this.app.post('/__admin/s3/directory-buckets', (req, res) => {
      const result = this.simulator.createDirectoryBucket(req.body?.name || req.body?.Name, req.body || {});
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(result.bucket);
    });
    this.app.get('/__admin/s3/directory-buckets/:name', (req, res) => {
      const result = this.simulator.getDirectoryBucket(req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.bucket);
    });
    this.app.delete('/__admin/s3/directory-buckets/:name', (req, res) => {
      const result = this.simulator.deleteDirectoryBucket(req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'Directory bucket deleted' });
    });

    // Table buckets
    this.app.get('/__admin/s3/table-buckets', (req, res) => res.json(this.simulator.listTableBuckets()));
    this.app.post('/__admin/s3/table-buckets', (req, res) => {
      const result = this.simulator.createTableBucket(req.body?.name || req.body?.Name, req.body || {});
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(result.bucket);
    });
    this.app.get('/__admin/s3/table-buckets/:name', (req, res) => {
      const result = this.simulator.getTableBucket(req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.bucket);
    });
    this.app.delete('/__admin/s3/table-buckets/:name', (req, res) => {
      const result = this.simulator.deleteTableBucket(req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'Table bucket deleted' });
    });

    // Vector buckets
    this.app.get('/__admin/s3/vector-buckets', (req, res) => res.json(this.simulator.listVectorBuckets()));
    this.app.post('/__admin/s3/vector-buckets', (req, res) => {
      const result = this.simulator.createVectorBucket(req.body?.name || req.body?.Name, req.body || {});
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(result.bucket);
    });
    this.app.get('/__admin/s3/vector-buckets/:name', (req, res) => {
      const result = this.simulator.getVectorBucket(req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.bucket);
    });
    this.app.delete('/__admin/s3/vector-buckets/:name', (req, res) => {
      const result = this.simulator.deleteVectorBucket(req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'Vector bucket deleted' });
    });

    // Vector indexes
    this.app.get('/__admin/s3/vector-buckets/:bucket/indexes', (req, res) => {
      const result = this.simulator.listVectorIndexes(req.params.bucket);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.indexes);
    });
    this.app.post('/__admin/s3/vector-buckets/:bucket/indexes', (req, res) => {
      const result = this.simulator.createVectorIndex(req.params.bucket, req.body?.name || req.body?.Name, req.body || {});
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(result.index);
    });
    this.app.get('/__admin/s3/vector-buckets/:bucket/indexes/:name', (req, res) => {
      const result = this.simulator.getVectorIndex(req.params.bucket, req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.index);
    });
    this.app.delete('/__admin/s3/vector-buckets/:bucket/indexes/:name', (req, res) => {
      const result = this.simulator.deleteVectorIndex(req.params.bucket, req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'Vector index deleted' });
    });

    // Access Points
    this.app.get('/__admin/s3/access-points', (req, res) => res.json(this.simulator.listAccessPoints()));
    this.app.post('/__admin/s3/access-points', (req, res) => {
      const result = this.simulator.createAccessPoint(req.body?.name || req.body?.Name, req.body || {});
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(result.accessPoint);
    });
    this.app.get('/__admin/s3/access-points/:name', (req, res) => {
      const result = this.simulator.getAccessPoint(req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.accessPoint);
    });
    this.app.delete('/__admin/s3/access-points/:name', (req, res) => {
      const result = this.simulator.deleteAccessPoint(req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'Access point deleted' });
    });
    this.app.put('/__admin/s3/access-points/:name/policy', (req, res) => {
      const result = this.simulator.putAccessPointPolicy(req.params.name, req.body?.PolicyDocument || req.body);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'Access point policy updated' });
    });
    this.app.get('/__admin/s3/access-points/:name/policy', (req, res) => {
      const result = this.simulator.getAccessPointPolicy(req.params.name);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.policy);
    });

    // File systems
    this.app.get('/__admin/s3/file-systems', (req, res) => res.json(this.simulator.listFileSystems()));
    this.app.post('/__admin/s3/file-systems', (req, res) => {
      const result = this.simulator.createFileSystem(req.body || {});
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(result.fileSystem);
    });
    this.app.get('/__admin/s3/file-systems/:id', (req, res) => {
      const result = this.simulator.getFileSystem(req.params.id);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.fileSystem);
    });
    this.app.delete('/__admin/s3/file-systems/:id', (req, res) => {
      const result = this.simulator.deleteFileSystem(req.params.id);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'File system deleted' });
    });

    // Access Grants
    this.app.get('/__admin/s3/access-grants', (req, res) => res.json(this.simulator.listAccessGrants()));
    this.app.post('/__admin/s3/access-grants', (req, res) => {
      const result = this.simulator.createAccessGrant(req.body || {});
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(result.accessGrant);
    });
    this.app.get('/__admin/s3/access-grants/:id', (req, res) => {
      const result = this.simulator.getAccessGrant(req.params.id);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.accessGrant);
    });
    this.app.delete('/__admin/s3/access-grants/:id', (req, res) => {
      const result = this.simulator.deleteAccessGrant(req.params.id);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'Access grant deleted' });
    });

    // Storage Lens
    this.app.get('/__admin/s3/storage-lens', (req, res) => res.json(this.simulator.listStorageLensConfigurations()));
    this.app.post('/__admin/s3/storage-lens', (req, res) => {
      const id = req.body?.Id || req.body?.id || `default-${Date.now()}`;
      const result = this.simulator.createStorageLensConfiguration(id, req.body || {});
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(result.storageLensConfiguration);
    });
    this.app.get('/__admin/s3/storage-lens/:id', (req, res) => {
      const result = this.simulator.getStorageLensConfiguration(req.params.id);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.storageLensConfiguration);
    });
    this.app.delete('/__admin/s3/storage-lens/:id', (req, res) => {
      const result = this.simulator.deleteStorageLensConfiguration(req.params.id);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'Storage Lens configuration deleted' });
    });

    // Batch Operations
    this.app.get('/__admin/s3/batch-operations/jobs', (req, res) => res.json(this.simulator.listBatchJobs()));
    this.app.post('/__admin/s3/batch-operations/jobs', (req, res) => {
      const result = this.simulator.createBatchJob(req.body || {});
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.status(201).json(result.job);
    });
    this.app.get('/__admin/s3/batch-operations/jobs/:jobId', (req, res) => {
      const result = this.simulator.getBatchJob(req.params.jobId);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json(result.job);
    });
    this.app.put('/__admin/s3/batch-operations/jobs/:jobId/cancel', (req, res) => {
      const result = this.simulator.cancelBatchJob(req.params.jobId);
      if (result.error) return res.status(result.status || 400).json(result.error);
      res.json({ message: 'Job cancelled' });
    });
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

    // ─── Presigned URL Endpoints ──────────────────────────────────────────

    /**
     * POST /__admin/presigned-urls/get
     * Generate a presigned GET URL for downloading an object
     * Body: { bucket, key, expiresIn?, credentials? }
     */
    this.app.post('/__admin/presigned-urls/get', (req, res) => {
      try {
        const { bucket, key, expiresIn, credentials } = req.body || {};
        
        if (!bucket || !key) {
          return res.status(400).json({ error: 'bucket and key are required' });
        }

        const result = this.simulator.generatePresignedGetUrl(bucket, key, { expiresIn, credentials });
        
        if (result.error) {
          return res.status(result.status || 500).json(result.error);
        }

        res.json({
          presignedUrl: result.presignedUrl,
          expiresIn: expiresIn || 3600,
          expiresAt: new Date(Date.now() + (expiresIn || 3600) * 1000).toISOString()
        });
      } catch (err) {
        logger.error('Error generating presigned GET URL:', err);
        res.status(500).json({ error: err.message });
      }
    });

    /**
     * POST /__admin/presigned-urls/put
     * Generate a presigned PUT URL for uploading an object
     * Body: { bucket, key, expiresIn?, credentials?, contentType? }
     */
    this.app.post('/__admin/presigned-urls/put', (req, res) => {
      try {
        const { bucket, key, expiresIn, credentials, contentType } = req.body || {};
        
        if (!bucket || !key) {
          return res.status(400).json({ error: 'bucket and key are required' });
        }

        const result = this.simulator.generatePresignedPutUrl(bucket, key, { expiresIn, credentials, contentType });
        
        if (result.error) {
          return res.status(result.status || 500).json(result.error);
        }

        res.json({
          presignedUrl: result.presignedUrl,
          expiresIn: expiresIn || 3600,
          expiresAt: new Date(Date.now() + (expiresIn || 3600) * 1000).toISOString()
        });
      } catch (err) {
        logger.error('Error generating presigned PUT URL:', err);
        res.status(500).json({ error: err.message });
      }
    });

    /**
     * POST /__admin/presigned-urls/delete
     * Generate a presigned DELETE URL for deleting an object
     * Body: { bucket, key, expiresIn?, credentials? }
     */
    this.app.post('/__admin/presigned-urls/delete', (req, res) => {
      try {
        const { bucket, key, expiresIn, credentials } = req.body || {};
        
        if (!bucket || !key) {
          return res.status(400).json({ error: 'bucket and key are required' });
        }

        const result = this.simulator.generatePresignedDeleteUrl(bucket, key, { expiresIn, credentials });
        
        if (result.error) {
          return res.status(result.status || 500).json(result.error);
        }

        res.json({
          presignedUrl: result.presignedUrl,
          expiresIn: expiresIn || 3600,
          expiresAt: new Date(Date.now() + (expiresIn || 3600) * 1000).toISOString()
        });
      } catch (err) {
        logger.error('Error generating presigned DELETE URL:', err);
        res.status(500).json({ error: err.message });
      }
    });

    /**
     * POST /__admin/presigned-urls/head
     * Generate a presigned HEAD URL for checking object metadata
     * Body: { bucket, key, expiresIn?, credentials? }
     */
    this.app.post('/__admin/presigned-urls/head', (req, res) => {
      try {
        const { bucket, key, expiresIn, credentials } = req.body || {};
        
        if (!bucket || !key) {
          return res.status(400).json({ error: 'bucket and key are required' });
        }

        const result = this.simulator.generatePresignedHeadUrl(bucket, key, { expiresIn, credentials });
        
        if (result.error) {
          return res.status(result.status || 500).json(result.error);
        }

        res.json({
          presignedUrl: result.presignedUrl,
          expiresIn: expiresIn || 3600,
          expiresAt: new Date(Date.now() + (expiresIn || 3600) * 1000).toISOString()
        });
      } catch (err) {
        logger.error('Error generating presigned HEAD URL:', err);
        res.status(500).json({ error: err.message });
      }
    });

    /**
     * POST /__admin/presigned-urls/post-policy
     * Generate a presigned POST policy for form uploads
     * Body: { bucket, key, expiresIn?, credentials?, contentType?, conditions? }
     */
    this.app.post('/__admin/presigned-urls/post-policy', (req, res) => {
      try {
        const { bucket, key, expiresIn, credentials, contentType, conditions } = req.body || {};
        
        if (!bucket || !key) {
          return res.status(400).json({ error: 'bucket and key are required' });
        }

        const result = this.simulator.generatePresignedPostPolicy(bucket, key, { expiresIn, credentials, contentType, conditions });
        
        if (result.error) {
          return res.status(result.status || 500).json(result.error);
        }

        res.json({
          ...result,
          expiresIn: expiresIn || 3600,
          expiresAt: new Date(Date.now() + (expiresIn || 3600) * 1000).toISOString()
        });
      } catch (err) {
        logger.error('Error generating presigned POST policy:', err);
        res.status(500).json({ error: err.message });
      }
    });

    /**
     * POST /__admin/presigned-urls/validate
     * Validate a presigned URL
     * Body: { url, method?, credentials? }
     */
    this.app.post('/__admin/presigned-urls/validate', (req, res) => {
      try {
        const { url, method, credentials } = req.body || {};
        
        if (!url) {
          return res.status(400).json({ error: 'url is required' });
        }

        const result = this.simulator.validatePresignedUrl(url, method || 'GET', credentials);
        res.json(result);
      } catch (err) {
        logger.error('Error validating presigned URL:', err);
        res.status(500).json({ error: err.message });
      }
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

  _generateNotificationConfigXml(config) {
    const nc = config || { LambdaFunctionConfigurations: [], QueueConfigurations: [], TopicConfigurations: [] };
    const lambdaXml = (nc.LambdaFunctionConfigurations || []).map(cfg => `
  <CloudFunctionConfiguration>
    <Id>${cfg.Id || ''}</Id>
    ${(cfg.Events || []).map(e => `<Event>${e}</Event>`).join('')}
    <CloudFunction>${cfg.LambdaFunctionArn}</CloudFunction>
    ${cfg.Filter && cfg.Filter.Key ? `<Filter><S3Key>${(cfg.Filter.Key.FilterRules || []).map(r => `<FilterRule><Name>${r.Name}</Name><Value>${r.Value}</Value></FilterRule>`).join('')}</S3Key></Filter>` : ''}
  </CloudFunctionConfiguration>`).join('');
    const queueXml = (nc.QueueConfigurations || []).map(cfg => `
  <QueueConfiguration>
    <Id>${cfg.Id || ''}</Id>
    ${(cfg.Events || []).map(e => `<Event>${e}</Event>`).join('')}
    <Queue>${cfg.QueueArn}</Queue>
    ${cfg.Filter && cfg.Filter.Key ? `<Filter><S3Key>${(cfg.Filter.Key.FilterRules || []).map(r => `<FilterRule><Name>${r.Name}</Name><Value>${r.Value}</Value></FilterRule>`).join('')}</S3Key></Filter>` : ''}
  </QueueConfiguration>`).join('');
    const topicXml = (nc.TopicConfigurations || []).map(cfg => `
  <TopicConfiguration>
    <Id>${cfg.Id || ''}</Id>
    ${(cfg.Events || []).map(e => `<Event>${e}</Event>`).join('')}
    <Topic>${cfg.TopicArn}</Topic>
    ${cfg.Filter && cfg.Filter.Key ? `<Filter><S3Key>${(cfg.Filter.Key.FilterRules || []).map(r => `<FilterRule><Name>${r.Name}</Name><Value>${r.Value}</Value></FilterRule>`).join('')}</S3Key></Filter>` : ''}
  </TopicConfiguration>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<NotificationConfiguration>${lambdaXml}${queueXml}${topicXml}
</NotificationConfiguration>`;
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