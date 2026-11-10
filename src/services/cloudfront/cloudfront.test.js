/**
 * CloudFront Service Tests
 * Comprehensive test suite for CloudFront simulator functionality
 */

const crypto = require('crypto');
const CloudFrontSimulator = require('./simulator');
const CloudFrontStore = require('./store');
const SignedUrlGenerator = require('./signed-url-generator');
const OriginValidator = require('./origin-validator');
const GeoRestrictions = require('./geo-restrictions');
const CacheEngine = require('./cache-engine');
const { Distribution, validate } = require('./models');

// Origem S3 é resolvida pelo roteador sem chamada de rede (o serviço S3 não está registrado).
const ORIGIN = { Id: 'origin1', DomainName: 'bucket.s3.amazonaws.com' };

function baseConfig(overrides = {}) {
  return {
    CallerReference: `ref-${Math.random().toString(36).slice(2)}`,
    Comment: 'Test distribution',
    Origins: [ORIGIN],
    DefaultCacheBehavior: {
      TargetOriginId: 'origin1',
      ViewerProtocolPolicy: 'allow-all'
    },
    Enabled: true,
    ...overrides
  };
}

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
      const config = baseConfig({
        Origins: [
          {
            Id: 'myOrigin',
            DomainName: 'bucket.s3.amazonaws.com',
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
        }
      });

      const distribution = simulator.createDistribution(config);
      expect(distribution).toBeDefined();
      expect(distribution.Id).toBeDefined();
      expect(distribution.enabled).toBe(true);
    });

    test('should accept origins in the AWS format ({ Quantity, Items })', () => {
      const config = baseConfig({
        Origins: { Quantity: 1, Items: [ORIGIN] }
      });

      const result = validate(config);
      expect(result.isValid).toBe(true);

      const distribution = simulator.createDistribution(config);
      expect(distribution.origins).toHaveLength(1);
      expect(distribution.origins[0].id).toBe('origin1');
    });

    test('should retrieve distribution by ID', () => {
      const created = simulator.createDistribution(baseConfig());
      const retrieved = simulator.getDistribution(created.Id);

      expect(retrieved).toBeDefined();
      expect(retrieved.Id).toBe(created.Id);
    });

    test('should list all distributions', () => {
      simulator.createDistribution(baseConfig());
      simulator.createDistribution(baseConfig());

      const distributions = simulator.listDistributions();
      expect(distributions.length).toBeGreaterThanOrEqual(2);
    });

    test('should delete a distribution', () => {
      const distribution = simulator.createDistribution(baseConfig());
      const deleted = simulator.deleteDistribution(distribution.Id);

      expect(deleted).toBe(true);
      expect(simulator.getDistribution(distribution.Id)).toBeNull();
    });

    test('should report a disabled distribution as 403 (Enabled: false)', async () => {
      const distribution = simulator.createDistribution(baseConfig({ Enabled: false }));

      const response = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/index.html',
        method: 'GET',
        clientIp: '10.0.0.1'
      });

      expect(response.status).toBe(403);
      expect(response.error).toBe('Distribution is disabled');
    });
  });

  // === Cache Tests ===
  describe('Caching Behavior', () => {
    test('should cache GET requests', async () => {
      const distribution = simulator.createDistribution(baseConfig());

      // First request (cache miss)
      const response1 = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/index.html',
        method: 'GET'
      });

      expect(response1.cacheStatus).toBe('MISS');

      // Second request (cache hit)
      const response2 = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/index.html',
        method: 'GET'
      });

      expect(response2.cacheStatus).toBe('HIT');
      expect(response2.body).toBe(response1.body);
    });

    test('should return different cache status for different paths', async () => {
      const distribution = simulator.createDistribution(baseConfig());

      await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/page1.html',
        method: 'GET'
      });

      const response = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/page2.html',
        method: 'GET'
      });

      expect(response.cacheStatus).toBe('MISS');
    });

    test('should track cache statistics', async () => {
      const distribution = simulator.createDistribution(baseConfig());

      await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/file.txt',
        method: 'GET'
      });

      await simulator.processRequest({
        distributionId: distribution.Id,
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
    test('should invalidate distribution cache', async () => {
      const distribution = simulator.createDistribution(baseConfig());

      await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/cached.html',
        method: 'GET'
      });

      const result = simulator.invalidateDistribution(distribution.Id, ['/cached.html']);
      expect(result.invalidationId).toBeDefined();
      expect(result.invalidatedCount).toBe(1);

      // Depois da invalidação, a próxima requisição volta ao origin
      const after = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/cached.html',
        method: 'GET'
      });
      expect(after.cacheStatus).toBe('MISS');
    });

    test('should invalidate multiple paths', () => {
      const distribution = simulator.createDistribution(baseConfig());

      const result = simulator.invalidateDistribution(distribution.Id, [
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

      const distribution = simulator.createDistribution(baseConfig({
        Restrictions: {
          GeoRestriction: {
            RestrictionType: 'blacklist',
            Quantity: 2,
            Items: ['CN', 'RU']
          }
        }
      }));

      const result = geoRestrictions.checkGeoRestriction(
        distribution.restrictions.geoRestriction,
        'CN'
      );

      expect(result.isAllowed).toBe(false);
    });

    test('should block a restricted client in a request (403 geo-restriction)', async () => {
      const distribution = simulator.createDistribution(baseConfig({
        Restrictions: {
          GeoRestriction: { RestrictionType: 'blacklist', Quantity: 1, Items: ['BR'] }
        }
      }));

      // Primeiro octeto 160-199 é mapeado para BR pelo simulador
      const response = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/index.html',
        method: 'GET',
        clientIp: '170.0.0.1'
      });

      expect(response.status).toBe(403);
      expect(response.error).toBe('Access denied by geo-restriction');
    });

    test('should allow requests from non-restricted countries', () => {
      const geoRestrictions = new GeoRestrictions();

      const result = geoRestrictions.checkGeoRestriction(
        { restrictionType: 'blacklist', locations: ['CN', 'RU'] },
        'US'
      );

      expect(result.isAllowed).toBe(true);
    });

    test('should validate country codes', () => {
      const geoRestrictions = new GeoRestrictions();

      const result = geoRestrictions.checkGeoRestriction(
        { restrictionType: 'blacklist', locations: ['US'] },
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

      // Par de chaves RSA de teste, gerado na hora (o assinador exige PEM válido)
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
      });

      const signedUrl = generator.generateCannedUrl(
        'example.cloudfront.net',
        '/private/file.pdf',
        privateKey,
        'APKAEXAMPLE',
        expirationTime
      );

      expect(signedUrl).toBeDefined();
      expect(signedUrl).toContain('example.cloudfront.net');
      expect(signedUrl).toContain('/private/file.pdf');
      expect(signedUrl).toContain('Signature=');
      expect(signedUrl).toContain('Key-Pair-Id=');
    });

    test('should reject unsigned requests when TrustedSigners is enabled', async () => {
      const distribution = simulator.createDistribution(baseConfig({
        DefaultCacheBehavior: {
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all',
          TrustedSigners: { Enabled: true, Quantity: 0 }
        }
      }));

      const response = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/private.pdf',
        method: 'GET',
        clientIp: '10.0.0.1'
      });

      expect(response.status).toBe(403);
      expect(response.error).toBe('Invalid or missing signed URL');
    });
  });

  // === Bucket policy access (Origin Access Identity) ===
  describe('Bucket policy access (OAI)', () => {
    const OAI_ID = 'EOAI123';
    const OAI_ARN = `arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${OAI_ID}`;
    const BUCKET = 'oai-bucket';

    // S3 mínimo: uma política (ou nenhuma) e um objeto. Evita gravar nada em disco.
    function fakeS3(policy) {
      return {
        getBucketPolicy: () => (policy
          ? { policy, status: 200 }
          : { error: { code: 'NoSuchBucketPolicy' }, status: 404 }),
        getObject: () => ({
          content: Buffer.from('hello oai'),
          contentType: 'text/html',
          size: 9,
          etag: 'etag-1'
        })
      };
    }

    function distributionFor(s3, oai) {
      const origin = { Id: 's3o', DomainName: `${BUCKET}.s3.amazonaws.com` };
      if (oai) origin.S3OriginConfig = { OriginAccessIdentity: `origin-access-identity/cloudfront/${oai}` };
      const sim = new CloudFrontSimulator({ servicesRegistry: { s3: { getSimulator: () => s3 } } });
      const distribution = sim.createDistribution(baseConfig({
        Origins: [origin],
        DefaultCacheBehavior: { TargetOriginId: 's3o', ViewerProtocolPolicy: 'allow-all' }
      }));
      return { sim, distribution };
    }

    const allowOai = {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { AWS: OAI_ARN }, Action: 's3:GetObject', Resource: `arn:aws:s3:::${BUCKET}/*` }]
    };

    test('should serve content when the policy allows the origin OAI', async () => {
      const { sim, distribution } = distributionFor(fakeS3(allowOai), OAI_ID);

      const response = await sim.processRequest({ distributionId: distribution.Id, path: '/index.html', method: 'GET', clientIp: '10.0.0.1' });

      expect(response.status).toBe(200);
      expect(Buffer.from(response.body.data ?? response.body).toString()).toBe('hello oai');
    });

    test('should deny when the origin has no OAI', async () => {
      const { sim, distribution } = distributionFor(fakeS3(allowOai), undefined);

      const response = await sim.processRequest({ distributionId: distribution.Id, path: '/index.html', method: 'GET', clientIp: '10.0.0.1' });

      expect(response.status).toBe(403);
      expect(JSON.stringify(response)).toContain('does not have permission');
    });

    test('should deny when the policy names a different OAI', async () => {
      const { sim, distribution } = distributionFor(fakeS3(allowOai), 'EOTHER');

      const response = await sim.processRequest({ distributionId: distribution.Id, path: '/index.html', method: 'GET', clientIp: '10.0.0.1' });

      expect(response.status).toBe(403);
    });

    test('should serve a public policy (Principal { AWS: "*" }) without OAI', async () => {
      const publicPolicy = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { AWS: '*' }, Action: 's3:GetObject', Resource: `arn:aws:s3:::${BUCKET}/*` }]
      };
      const { sim, distribution } = distributionFor(fakeS3(publicPolicy), undefined);

      const response = await sim.processRequest({ distributionId: distribution.Id, path: '/index.html', method: 'GET', clientIp: '10.0.0.1' });

      expect(response.status).toBe(200);
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
    let cache;

    beforeEach(() => {
      cache = new CacheEngine();
    });

    afterEach(() => {
      cache.destroy();
    });

    test('should set and get cached values', () => {
      const key = 'test-key';
      const value = { data: 'test data' };

      cache.set(key, value, 3600);
      const retrieved = cache.get(key);

      expect(retrieved).toBeDefined();
      expect(retrieved.data).toBe('test data');
    });

    test('should invalidate cached values', () => {
      const key = 'test-key';
      cache.set(key, { data: 'test' }, 3600);
      cache.invalidate(key);

      expect(cache.get(key)).toBeNull();
    });

    test('should invalidate by path pattern', () => {
      cache.set('dist1:/img/a.png', { status: 200 }, 3600, 'dist1');
      cache.set('dist1:/img/b.png', { status: 200 }, 3600, 'dist1');
      cache.set('dist1:/index.html', { status: 200 }, 3600, 'dist1');

      expect(cache.invalidate('/img/*')).toBe(2);
      expect(cache.get('dist1:/index.html')).not.toBeNull();
    });

    test('should honor the TTL passed as the third argument', () => {
      const realNow = Date.now;
      try {
        const start = 1_000_000;
        Date.now = () => start;
        cache.set('ttl-key', { status: 200 }, 60, 'dist1');

        Date.now = () => start + 59_000;
        expect(cache.get('ttl-key')).not.toBeNull();

        Date.now = () => start + 61_000;
        expect(cache.get('ttl-key')).toBeNull();
      } finally {
        Date.now = realNow;
      }
    });

    test('should track cache statistics', () => {
      cache.set('key1', { data: 'test1' }, 3600);
      cache.set('key2', { data: 'test2' }, 3600);

      const stats = cache.getStats();
      expect(stats.cacheSize).toBe(2);
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

    test('should accept regional S3 endpoints', () => {
      const validator = new OriginValidator();

      const result = validator.validateS3Origin({
        id: 'regional',
        domainName: 'mybucket.s3.us-east-1.amazonaws.com'
      });

      expect(result.isValid).toBe(true);
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
    test('should process complete request lifecycle', async () => {
      const distribution = simulator.createDistribution(baseConfig({ Comment: 'E2E test' }));

      // First request
      const response1 = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/test.html',
        method: 'GET'
      });

      expect(response1.status).toBe(200);
      expect(response1.cacheStatus).toBe('MISS');

      // Second request (cached)
      const response2 = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/test.html',
        method: 'GET'
      });

      expect(response2.cacheStatus).toBe('HIT');

      // Invalidate
      simulator.invalidateDistribution(distribution.Id, ['/test.html']);

      // Third request (after invalidation)
      const response3 = await simulator.processRequest({
        distributionId: distribution.Id,
        path: '/test.html',
        method: 'GET'
      });

      expect(response3.cacheStatus).toBe('MISS');
    });
  });
});
