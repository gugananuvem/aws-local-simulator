/**
 * CloudFront Service Index
 * Main entry point for CloudFront simulator
 */

const CloudFrontServer = require('./server');
const CloudFrontSimulator = require('./simulator');
const CloudFrontStore = require('./store');
const SignedUrlGenerator = require('./signed-url-generator');
const OriginValidator = require('./origin-validator');
const GeoRestrictions = require('./geo-restrictions');
const OriginRouter = require('./origin-router');
const CacheEngine = require('./cache-engine');

const {
  Distribution,
  Origin,
  Behavior,
  Invalidation,
  validate
} = require('./models');

/**
 * CloudFront Service Class
 */
class CloudFrontService {
  constructor(config) {
    this.config = config;
    this.name = 'cloudfront';
    this.port = config?.ports?.cloudfront || config?.services?.cloudfront?.port || 4017;
    this.server = null;
    this.simulator = null;
    this.store = null;
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger?.debug?.(`Initializing CloudFront Service on port ${this.port}...`);
    
    this.simulator = new CloudFrontSimulator(this.config);
    this.store = new CloudFrontStore(this.config?.storagePath || './data/cloudfront');
    this.server = new CloudFrontServer(this.config);
    
    // Inject simulator into server
    this.server.simulator = this.simulator;
    
    logger?.debug?.('CloudFront Service initialized');
  }

  injectDependencies(server) {
    // CloudFront may depend on other services like S3, Lambda, etc.
    // Injections would happen here
    const s3Service = server.getService('s3');
    const apigatewayService = server.getService('apigateway');
    const ec2Service = server.getService('ec2');
    const lambdaService = server.getService('lambda');

    if (this.simulator) {
      if (s3Service) this.simulator.registerService('s3', s3Service);
      if (apigatewayService) this.simulator.registerService('apigateway', apigatewayService);
      if (ec2Service) this.simulator.registerService('ec2', ec2Service);
      if (lambdaService) this.simulator.registerService('lambda', lambdaService);
    }
  }

  async start() {
    if (this.isRunning) return;
    
    return new Promise((resolve, reject) => {
      try {
        const httpServer = this.server.listen(this.port);
        
        // Handle listen errors
        httpServer.on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            reject(new Error(`Port ${this.port} is already in use`));
          } else {
            reject(error);
          }
        });
        
        // Server is listening
        this.isRunning = true;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop() {
    if (!this.isRunning) return;
    
    return new Promise((resolve) => {
      if (this.server?.server) {
        this.server.server.close(() => {
          this.isRunning = false;
          resolve();
        });
      } else {
        this.isRunning = false;
        resolve();
      }
    });
  }

  async reset() {
    if (this.simulator) {
      this.simulator.reset?.();
    }
    if (this.store) {
      this.store.clear?.();
    }
  }

  getStatus() {
    const stats = this.simulator?.getStats?.() || { 
      distributionsCount: 0, 
      cacheHits: 0, 
      cacheMisses: 0 
    };
    
    return {
      name: 'cloudfront',
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      ...stats
    };
  }

  getSimulator() {
    return this.simulator;
  }

  getServer() {
    return this.server;
  }

  getStore() {
    return this.store;
  }
}

/**
 * Create a CloudFront service instance (backward compatibility)
 * @param {object} options - Configuration options
 * @returns {object} CloudFront service object
 */
function createCloudFrontService(options = {}) {
  const simulator = new CloudFrontSimulator(options);
  const store = new CloudFrontStore(options.storePath);
  const server = new CloudFrontServer(options);

  return {
    // Simulator methods
    simulator,
    createDistribution: (config) => simulator.createDistribution(config),
    getDistribution: (id) => simulator.getDistribution(id),
    listDistributions: () => simulator.listDistributions(),
    deleteDistribution: (id) => simulator.deleteDistribution(id),
    processRequest: (request) => simulator.processRequest(request),
    invalidateDistribution: (id, paths) => simulator.invalidateDistribution(id, paths),
    generateSignedUrl: (id, path, key, keyPair, expiration) =>
      simulator.generateSignedUrl(id, path, key, keyPair, expiration),
    getCacheStats: () => simulator.getCacheStats(),
    getDistributionStats: (id) => simulator.getDistributionStats(id),
    getRequestStats: () => simulator.getRequestStats(),

    // Store methods
    store,
    saveDistribution: (distribution) => store.saveDistribution(distribution),
    loadDistribution: (id) => store.getDistribution(id),
    loadDistributions: () => store.getAllDistributions(),
    saveInvalidation: (invalidation) => store.saveInvalidation(invalidation),
    loadInvalidation: (id) => store.getInvalidation(id),
    clearStore: () => store.clear(),
    exportData: () => store.export(),
    importData: (data) => store.import(data),
    createBackup: (path) => store.createBackup(path),

    // Server methods
    server,
    listen: (port) => server.listen(port),
    getApp: () => server.getApp(),

    // Helper classes
    SignedUrlGenerator,
    OriginValidator,
    GeoRestrictions,
    CacheEngine,

    // Models
    Distribution,
    Origin,
    Behavior,
    Invalidation,
    validate
  };
}

module.exports = CloudFrontService;

// Also export for backward compatibility
module.exports.CloudFrontService = CloudFrontService;
module.exports.createCloudFrontService = createCloudFrontService;
module.exports.CloudFrontServer = CloudFrontServer;
module.exports.CloudFrontSimulator = CloudFrontSimulator;
module.exports.CloudFrontStore = CloudFrontStore;
module.exports.SignedUrlGenerator = SignedUrlGenerator;
module.exports.OriginValidator = OriginValidator;
module.exports.OriginRouter = OriginRouter;
module.exports.GeoRestrictions = GeoRestrictions;
module.exports.CacheEngine = CacheEngine;
module.exports.Distribution = Distribution;
module.exports.Origin = Origin;
module.exports.Behavior = Behavior;
module.exports.Invalidation = Invalidation;
module.exports.validate = validate;
