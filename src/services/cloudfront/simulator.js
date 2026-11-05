const { Distribution } = require('./models');
const CacheEngine = require('./cache-engine');
const SignedUrlGenerator = require('./signed-url-generator');
const OriginValidator = require('./origin-validator');
const GeoRestrictions = require('./geo-restrictions');
const OriginRouter = require('./origin-router');

/**
 * CloudFront Simulator
 * Simulates CloudFront distribution behavior including caching, routing, and content delivery
 */
class CloudFrontSimulator {
  constructor(options = {}) {
    this.distributions = new Map();
    this.cacheEngine = new CacheEngine(options.cacheOptions);
    this.signedUrlGenerator = new SignedUrlGenerator();
    this.originValidator = new OriginValidator();
    this.geoRestrictions = new GeoRestrictions();
    this.originRouter = new OriginRouter(options.servicesRegistry || {});
    this.requestStats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      blockedRequests: 0
    };
  }

  /**
   * Register services for origin routing
   * @param {string} serviceName - Service name (s3, apigateway, ec2, lambda, etc)
   * @param {object} serviceInstance - Service instance
   */
  registerService(serviceName, serviceInstance) {
    this.originRouter.registerService(serviceName, serviceInstance);
  }
  createDistribution(distributionConfig) {
    const distribution = new Distribution(distributionConfig);
    
    // Validate all origins
    // Validação estrutural síncrona (a verificação de alcance do origin é assíncrona e não bloqueia a criação)
    for (const origin of distribution.origins) {
      if (!origin.id || !origin.domainName) {
        throw new Error(`Invalid origin '${origin.id}': Origin must have id and domainName`);
      }
    }

    // Validate geo-restrictions if present
    if (distribution.restrictions?.geoRestriction) {
      const geoValidation = this.geoRestrictions.validateGeoRestriction(
        distribution.restrictions.geoRestriction
      );
      if (!geoValidation.isValid) {
        throw new Error(
          `Invalid geo-restriction: ${geoValidation.errors.join(', ')}`
        );
      }
    }

    this.distributions.set(distribution.Id || distribution.id, distribution);
    return distribution;
  }

  /**
   * Get a distribution by ID
   * @param {string} distributionId - Distribution ID
   * @returns {object|null} Distribution or null
   */
  getDistribution(distributionId) {
    return this.distributions.get(distributionId) || null;
  }

  /**
   * List all distributions
   * @returns {object[]} Array of distributions
   */
  listDistributions() {
    return Array.from(this.distributions.values());
  }

  /**
   * Delete a distribution
   * @param {string} distributionId - Distribution ID
   * @returns {boolean} True if deleted
   */
  deleteDistribution(distributionId) {
    // Invalidate all cached content for this distribution
    this.cacheEngine.invalidateDistribution(distributionId);
    return this.distributions.delete(distributionId);
  }

  /**
   * Process a request through CloudFront
   * Handles routing, caching, geo-restrictions, signed URLs, etc.
   * @param {object} request - Request object
   * @param {string} request.distributionId - Distribution to route through
   * @param {string} request.path - Request path
   * @param {string} [request.method] - HTTP method (default: GET)
   * @param {object} [request.headers] - Request headers
   * @param {string} [request.clientIp] - Client IP for geo-restrictions
   * @param {string} [request.protocol] - Request protocol (http/https)
   * @returns {object} Response object with caching info
   */
  processRequest(request) {
    this.requestStats.totalRequests++;

    const distribution = this.getDistribution(request.distributionId);
    if (!distribution) {
      return {
        status: 404,
        error: 'Distribution not found',
        cached: false
      };
    }

    // Check if distribution is enabled
    if (!distribution.enabled) {
      return {
        status: 403,
        error: 'Distribution is disabled',
        cached: false
      };
    }

    // Check geo-restrictions
    if (distribution.restrictions?.geoRestriction && request.clientIp) {
      const clientCountry = this._getCountryFromIp(request.clientIp);
      const geoCheck = this.geoRestrictions.checkGeoRestriction(
        distribution.restrictions.geoRestriction,
        clientCountry,
        { ip: request.clientIp, distributionId: request.distributionId }
      );

      if (!geoCheck.isAllowed) {
        this.requestStats.blockedRequests++;
        return {
          status: 403,
          error: 'Access denied by geo-restriction',
          reason: geoCheck.reason,
          cached: false
        };
      }
    }

    // Check signed URL if required
    if (distribution.defaultBehavior?.requireSignedUrls) {
      const urlValidation = this._validateSignedUrl(request, distribution);
      if (!urlValidation.isValid) {
        this.requestStats.blockedRequests++;
        return {
          status: 403,
          error: 'Invalid or missing signed URL',
          reason: urlValidation.reason,
          cached: false
        };
      }
    }

    // Find matching behavior
    const behavior = distribution.matchBehavior(request.path);
    if (!behavior) {
      return {
        status: 404,
        error: 'No matching behavior found',
        cached: false
      };
    }

    // Check cache
    const cacheKey = this._generateCacheKey(request.distributionId, request.path);
    let cachedResponse = this.cacheEngine.get(cacheKey);

    if (cachedResponse) {
      this.requestStats.cacheHits++;
      return {
        ...cachedResponse,
        cached: true,
        cacheStatus: 'HIT',
        xAmzCfId: this._generateCfId()
      };
    }

    this.requestStats.cacheMisses++;

    // Get origin
    const origin = distribution.origins.find(o => o.id === behavior.targetOriginId);
    if (!origin) {
      return {
        status: 502,
        error: 'Origin not found',
        cached: false
      };
    }

    // Request to origin (may be async)
    const originResponse = this._simulateOriginRequest(origin, request, behavior);

    // Handle promise (async origin routing)
    if (originResponse && typeof originResponse.then === 'function') {
      return originResponse.then(response => {
        // Cache response if cacheable
        if (behavior.isCacheable(request.method || 'GET')) {
          const ttl = behavior.getCachePolicy()?.defaultTtl || 3600;
          this.cacheEngine.set(cacheKey, response, ttl, request.distributionId);
        }

        return {
          ...response,
          cached: false,
          cacheStatus: 'MISS',
          xAmzCfId: this._generateCfId()
        };
      }).catch(error => ({
        status: 502,
        error: 'Origin request failed',
        message: error.message,
        cached: false
      }));
    }

    // Synchronous response
    // Cache response if cacheable
    if (behavior.isCacheable(request.method || 'GET')) {
      const ttl = behavior.getCachePolicy()?.defaultTtl || 3600;
      this.cacheEngine.set(cacheKey, originResponse, ttl, request.distributionId);
    }

    return {
      ...originResponse,
      cached: false,
      cacheStatus: 'MISS',
      xAmzCfId: this._generateCfId()
    };
  }

  /**
   * Invalidate distribution content
   * @param {string} distributionId - Distribution ID
   * @param {string|string[]} paths - Paths to invalidate
   * @returns {object} Invalidation result
   */
  invalidateDistribution(distributionId, paths) {
    const distribution = this.getDistribution(distributionId);
    if (!distribution) {
      return { error: 'Distribution not found' };
    }

    const pathsArray = Array.isArray(paths) ? paths : [paths];
    let invalidatedCount = 0;

    for (const path of pathsArray) {
      const cacheKey = this._generateCacheKey(distributionId, path);
      this.cacheEngine.invalidate(cacheKey);
      invalidatedCount++;
    }

    return {
      invalidationId: this._generateInvalidationId(),
      distributionId: distributionId,
      paths: pathsArray,
      invalidatedCount: invalidatedCount,
      status: 'InProgress'
    };
  }

  /**
   * Get distribution statistics
   * @param {string} distributionId - Distribution ID
   * @returns {object} Distribution stats
   */
  getDistributionStats(distributionId) {
    const distribution = this.getDistribution(distributionId);
    if (!distribution) {
      return null;
    }

    const cacheStats = this.cacheEngine.getStats();

    return {
      distributionId: distributionId,
      enabled: distribution.enabled,
      domainName: distribution.domainName,
      caching: {
        entries: cacheStats.entries,
        maxSize: cacheStats.maxSize,
        usedSize: cacheStats.usedSize,
        hitRate: this.requestStats.totalRequests > 0
          ? (this.requestStats.cacheHits / this.requestStats.totalRequests * 100).toFixed(2) + '%'
          : '0%'
      },
      global: this.requestStats
    };
  }

  /**
   * Generate a signed URL
   * @param {string} distributionId - Distribution ID
   * @param {string} resourcePath - Resource path
   * @param {string} privateKey - Private key for signing
   * @param {string} keyPairId - Key pair ID
   * @param {number} expirationTime - Expiration time (seconds from now)
   * @returns {string} Signed URL
   */
  generateSignedUrl(
    distributionId,
    resourcePath,
    privateKey,
    keyPairId,
    expirationTime
  ) {
    const distribution = this.getDistribution(distributionId);
    if (!distribution) {
      throw new Error('Distribution not found');
    }

    const expirationDate = new Date(Date.now() + expirationTime * 1000);
    return this.signedUrlGenerator.generateCannedUrl(
      distribution.domainName,
      resourcePath,
      privateKey,
      keyPairId,
      expirationDate
    );
  }

  /**
   * Get cache engine stats
   * @returns {object} Cache statistics
   */
  getCacheStats() {
    return this.cacheEngine.getStats();
  }

  /**
   * Clear all caches
   */
  clearAllCaches() {
    this.cacheEngine.clear();
  }

  /**
   * Get global request statistics
   * @returns {object} Request statistics
   */
  getRequestStats() {
    const hitRate = this.requestStats.totalRequests > 0
      ? (this.requestStats.cacheHits / this.requestStats.totalRequests * 100).toFixed(2)
      : 0;

    return {
      ...this.requestStats,
      hitRate: hitRate + '%'
    };
  }

  /**
   * Private Methods
   */

  _generateCacheKey(distributionId, path) {
    return `${distributionId}:${path}`;
  }

  _generateCfId() {
    return 'X-Amz-Cf-Id-' + Math.random().toString(36).substring(2, 15);
  }

  _generateInvalidationId() {
    return 'I' + Math.random().toString(36).substring(2, 15).toUpperCase();
  }

  _getCountryFromIp(ip) {
    // Simplified - in production this would use GeoIP database
    // For demo: return country code based on IP ranges
    const ipParts = ip.split('.');
    const firstOctet = parseInt(ipParts[0]);

    // Rough mapping for demo
    if (firstOctet >= 1 && firstOctet <= 39) return 'US';
    if (firstOctet >= 40 && firstOctet <= 79) return 'GB';
    if (firstOctet >= 80 && firstOctet <= 119) return 'DE';
    if (firstOctet >= 120 && firstOctet <= 159) return 'JP';
    if (firstOctet >= 160 && firstOctet <= 199) return 'BR';
    if (firstOctet >= 200 && firstOctet <= 255) return 'CN';

    return 'UNKNOWN';
  }

  _validateSignedUrl(request, distribution) {
    const url = request.url || request.path;
    
    // Look for signature parameters in URL or headers
    const hasSignature = url?.includes('Signature=') || 
                        url?.includes('Policy=') ||
                        request.headers?.['CloudFront-Policy'];

    if (!hasSignature) {
      return {
        isValid: false,
        reason: 'MISSING_SIGNATURE'
      };
    }

    // Full verification would require the public key
    // For now, just check if signature is present
    return {
      isValid: true
    };
  }

  _simulateOriginRequest(origin, request, behavior) {
    // Rotate to real origin (S3, API Gateway, ALB, Lambda, HTTP)
    return this.originRouter.routeToOrigin(origin, request.path || '/', request)
      .then(response => response)
      .catch(error => ({
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Bad Gateway', message: error.message }),
        timestamp: new Date().toISOString()
      }));
  }
}

module.exports = CloudFrontSimulator;
