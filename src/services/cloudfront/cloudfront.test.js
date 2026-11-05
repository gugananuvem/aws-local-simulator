/**
 * CloudFront Service Tests
 * Comprehensive test suite for CloudFront simulator functionality
 */

const CloudFrontSimulator = require('./simulator');
const CloudFrontStore = require('./store');
const SignedUrlGenerator = require('./signed-url-generator');
const OriginValidator = require('./origin-validator');
const GeoRestrictions = require('./geo-restrictions');
const CacheEngine = require('./cache-engine');
const { Distribution, validate } = require('./models');

describe('CloudFront Service', () => {
  let simulator;
  let store;

  beforeEach(() => {
    simulator = new CloudFrontSimulator();
    store = new CloudFrontStore(':memory:');
  });

  // === Distribution Tests ===
  describe('Distribution Management', () => {
    test('should create a distribution', () => {
      const config = {
        CallerReference: 'test-ref-1',
        Comment: 'Test distribution',
        Origins: [
          {
            Id: 'myOrigin',
            DomainName: 'example.com',
            CustomOriginConfig: {
              HTTPPort: 80,
              OriginProtocolPolicy: 'https-only'
            }
          }
        ],
        DefaultCacheBehavior: {
          TargetOriginId: 'myOrigin',
          ViewerProtocolPolicy: 'allow-all',
          TrustedSigners: { Enabled: false, Quantity: 0 },
          ForwardedValues: {
            QueryString: false,
            Cookies: { Forward: 'none' }
          },
          MinTTL: 0
        },
        Enabled: true
      };

      const distribution = simulator.createDistribution(config);
      expect(distribution).toBeDefined();
      expect(distribution.id).toBeDefined();
      expect(distribution.enabled).toBe(true);
    });

    test('should retrieve distribution by ID', () => {
      const config = {
        CallerReference: 'test-ref-2',
        Comment: 'Test distribution',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true
      };

      const created = simulator.createDistribution(config);
      const retrieved = simulator.getDistribution(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
    });

    test('should list all distributions', () => {
      const config = {
        CallerReference: 'test-ref-3',
        Comment: 'Test distribution',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true
      };

      simulator.createDistribution(config);
      simulator.createDistribution({ ...config, CallerReference: 'test-ref-4' });

      const distributions = simulator.listDistributions();
      expect(distributions.length).toBeGreaterThanOrEqual(2);
    });

    test('should delete a distribution', () => {
      const config = {
        CallerReference: 'test-ref-5',
        Comment: 'Test distribution',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true
      };

      const distribution = simulator.createDistribution(config);
      const deleted = simulator.deleteDistribution(distribution.id);

      expect(deleted).toBe(true);
      expect(simulator.getDistribution(distribution.id)).toBeNull();
    });
  });

  // === Cache Tests ===
  describe('Caching Behavior', () => {
    test('should cache GET requests', () => {
      const config = {
        CallerReference: 'cache-test-1',
        Comment: 'Cache test',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true
      };

      const distribution = simulator.createDistribution(config);

      // First request (cache miss)
      const response1 = simulator.processRequest({
        distributionId: distribution.id,
        path: '/index.html',
        method: 'GET'
      });

      expect(response1.cacheStatus).toBe('MISS');

      // Second request (cache hit)
      const response2 = simulator.processRequest({
        distributionId: distribution.id,
        path: '/index.html',
        method: 'GET'
      });

      expect(response2.cacheStatus).toBe('HIT');
    });

    test('should return different cache status for different paths', () => {
      const config = {
        CallerReference: 'cache-test-2',
        Comment: 'Cache test',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true
      };

      const distribution = simulator.createDistribution(config);

      simulator.processRequest({
        distributionId: distribution.id,
        path: '/page1.html',
        method: 'GET'
      });

      const response = simulator.processRequest({
        distributionId: distribution.id,
        path: '/page2.html',
        method: 'GET'
      });

      expect(response.cacheStatus).toBe('MISS');
    });

    test('should track cache statistics', () => {
      const config = {
        CallerReference: 'cache-test-3',
        Comment: 'Cache test',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true
      };

      const distribution = simulator.createDistribution(config);

      simulator.processRequest({
        distributionId: distribution.id,
        path: '/file.txt',
        method: 'GET'
      });

      simulator.processRequest({
        distributionId: distribution.id,
        path: '/file.txt',
        method: 'GET'
      });

      const stats = simulator.getRequestStats();
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
    });
  });

  // === Invalidation Tests ===
  describe('Cache Invalidation', () => {
    test('should invalidate distribution cache', () => {
      const config = {
        CallerReference: 'invalidate-test-1',
        Comment: 'Invalidation test',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true
      };

      const distribution = simulator.createDistribution(config);

      // Cache a request
      simulator.processRequest({
        distributionId: distribution.id,
        path: '/cached.html',
        method: 'GET'
      });

      // Invalidate it
      const result = simulator.invalidateDistribution(distribution.id, ['/cached.html']);

      expect(result.invalidationId).toBeDefined();
      expect(result.invalidatedCount).toBe(1);
    });

    test('should invalidate multiple paths', () => {
      const config = {
        CallerReference: 'invalidate-test-2',
        Comment: 'Invalidation test',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true
      };

      const distribution = simulator.createDistribution(config);

      const result = simulator.invalidateDistribution(distribution.id, [
        '/path1/*',
        '/path2/*',
        '/specific-file.txt'
      ]);

      expect(result.invalidatedCount).toBe(3);
    });
  });

  // === Geo-Restrictions Tests ===
  describe('Geo-Restrictions', () => {
    test('should block requests from restricted countries', () => {
      const geoRestrictions = new GeoRestrictions();

      const config = {
        CallerReference: 'geo-test-1',
        Comment: 'Geo restriction test',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true,
        Restrictions: {
          GeoRestriction: {
            RestrictionType: 'blacklist',
            Quantity: 2,
            Locations: ['CN', 'RU']
          }
        }
      };

      const distribution = simulator.createDistribution(config);

      const result = geoRestrictions.checkGeoRestriction(
        distribution.restrictions.geoRestriction,
        'CN'
      );

      expect(result.isAllowed).toBe(false);
    });

    test('should allow requests from non-restricted countries', () => {
      const geoRestrictions = new GeoRestrictions();

      const restriction = {
        RestrictionType: 'blacklist',
        Locations: ['CN', 'RU']
      };

      const result = geoRestrictions.checkGeoRestriction(restriction, 'US');

      expect(result.isAllowed).toBe(true);
    });

    test('should validate country codes', () => {
      const geoRestrictions = new GeoRestrictions();

      const result = geoRestrictions.checkGeoRestriction(
        {
          RestrictionType: 'blacklist',
          Locations: ['US']
        },
        'INVALID'
      );

      expect(result.isAllowed).toBe(false);
    });
  });

  // === Signed URL Tests ===
  describe('Signed URLs', () => {
    test('should generate canned signed URL', () => {
      const generator = new SignedUrlGenerator();
      const expirationTime = new Date(Date.now() + 3600000);

      // For testing, use a simple key pair
      const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA2Z3qX2BTLS39R3wvUL3p1JIiwsViryb74hNnL5uJlUyJPo2f
-----END RSA PRIVATE KEY-----`;

      const keyPairId = 'APKAEXAMPLE';

      const signedUrl = generator.generateCannedUrl(
        'example.cloudfront.net',
        '/private/file.pdf',
        privateKey,
        keyPairId,
        expirationTime
      );

      expect(signedUrl).toBeDefined();
      expect(signedUrl).toContain('example.cloudfront.net');
      expect(signedUrl).toContain('/private/file.pdf');
      expect(signedUrl).toContain('Signature=');
      expect(signedUrl).toContain('Key-Pair-Id=');
    });
  });

  // === Validation Tests ===
  describe('Configuration Validation', () => {
    test('should validate distribution config', () => {
      const validConfig = {
        CallerReference: 'valid-config',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        }
      };

      const result = validate(validConfig);

      expect(result.isValid).toBe(true);
    });

    test('should reject config without origins', () => {
      const invalidConfig = {
        CallerReference: 'invalid-config',
        Origins: [],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        }
      };

      const result = validate(invalidConfig);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should reject invalid viewer protocol policy', () => {
      const invalidConfig = {
        CallerReference: 'invalid-policy',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'invalid-policy'
        }
      };

      const result = validate(invalidConfig);

      expect(result.isValid).toBe(false);
    });
  });

  // === Cache Engine Tests ===
  describe('Cache Engine', () => {
    test('should set and get cached values', () => {
      const cache = new CacheEngine();

      const key = 'test-key';
      const value = { data: 'test data' };

      cache.set(key, value, 3600);
      const retrieved = cache.get(key);

      expect(retrieved).toBeDefined();
      expect(retrieved.data).toBe('test data');
    });

    test('should invalidate cached values', () => {
      const cache = new CacheEngine();

      const key = 'test-key';
      cache.set(key, { data: 'test' }, 3600);
      cache.invalidate(key);

      const retrieved = cache.get(key);
      expect(retrieved).toBeNull();
    });

    test('should track cache statistics', () => {
      const cache = new CacheEngine();

      cache.set('key1', { data: 'test1' }, 3600);
      cache.set('key2', { data: 'test2' }, 3600);

      const stats = cache.getStats();
      expect(stats.entries).toBe(2);
      expect(stats.maxSize).toBeGreaterThan(0);
    });
  });

  // === Origin Validator Tests ===
  describe('Origin Validation', () => {
    test('should validate S3 origin', () => {
      const validator = new OriginValidator();

      const result = validator.validateS3Origin({
        id: 'myS3Origin',
        domainName: 'mybucket.s3.amazonaws.com'
      });

      expect(result.isValid).toBe(true);
      expect(result.originType).toBe('S3');
    });

    test('should validate HTTP origin', () => {
      const validator = new OriginValidator();

      const result = validator.validateHttpOrigin({
        id: 'myHttpOrigin',
        domainName: 'example.com',
        customOriginConfig: {
          httpPort: 80,
          originProtocolPolicy: 'https-only'
        }
      });

      expect(result.isValid).toBe(true);
    });

    test('should reject invalid HTTP port', () => {
      const validator = new OriginValidator();

      const result = validator.validateHttpOrigin({
        id: 'myHttpOrigin',
        domainName: 'example.com',
        customOriginConfig: {
          httpPort: 99999 // Invalid port
        }
      });

      expect(result.isValid).toBe(false);
    });
  });

  // === Store Tests ===
  describe('Persistence Store', () => {
    test('should save and retrieve distribution', () => {
      const distribution = {
        id: 'DIST123',
        domainName: 'test.cloudfront.net',
        enabled: true
      };

      store.saveDistribution(distribution);
      const retrieved = store.getDistribution('DIST123');

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe('DIST123');
    });

    test('should export and import data', () => {
      const distribution = {
        id: 'DIST456',
        domainName: 'test2.cloudfront.net',
        enabled: true
      };

      store.saveDistribution(distribution);
      const exported = store.export();

      const newStore = new CloudFrontStore(':memory:');
      newStore.import(exported);

      const retrieved = newStore.getDistribution('DIST456');
      expect(retrieved).toBeDefined();
    });

    test('should delete distribution from store', () => {
      const distribution = {
        id: 'DIST789',
        domainName: 'test3.cloudfront.net',
        enabled: true
      };

      store.saveDistribution(distribution);
      const deleted = store.deleteDistribution('DIST789');

      expect(deleted).toBe(true);
      expect(store.getDistribution('DIST789')).toBeNull();
    });
  });

  // === End-to-End Tests ===
  describe('End-to-End Scenarios', () => {
    test('should process complete request lifecycle', () => {
      const config = {
        CallerReference: 'e2e-test-1',
        Comment: 'E2E test',
        Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all'
        },
        Enabled: true
      };

      const distribution = simulator.createDistribution(config);

      // First request
      const response1 = simulator.processRequest({
        distributionId: distribution.id,
        path: '/test.html',
        method: 'GET'
      });

      expect(response1.status).toBe(200);
      expect(response1.cacheStatus).toBe('MISS');

      // Second request (cached)
      const response2 = simulator.processRequest({
        distributionId: distribution.id,
        path: '/test.html',
        method: 'GET'
      });

      expect(response2.cacheStatus).toBe('HIT');

      // Invalidate
      simulator.invalidateDistribution(distribution.id, ['/test.html']);

      // Third request (after invalidation)
      const response3 = simulator.processRequest({
        distributionId: distribution.id,
        path: '/test.html',
        method: 'GET'
      });

      expect(response3.cacheStatus).toBe('MISS');
    });
  });
});
