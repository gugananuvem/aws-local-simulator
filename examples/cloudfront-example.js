/**
 * CloudFront Service Example
 * Demonstrates how to use the CloudFront simulator with various scenarios
 */

const CloudFrontService = require('../src/services/cloudfront');

// Example 1: Basic Distribution Setup
async function basicDistributionExample() {
  console.log('\n=== Example 1: Basic Distribution Setup ===\n');

  const config = {
    ports: { cloudfront: 4566 },
    storagePath: './data/cloudfront'
  };

  // Create and initialize service
  const service = new CloudFrontService(config);
  await service.initialize();
  await service.start();

  const simulator = service.getSimulator();

  // Create a simple distribution
  const distribution = simulator.createDistribution({
    CallerReference: 'basic-dist-1',
    Comment: 'Basic CloudFront distribution',
    Origins: [
      {
        Id: 'myOrigin',
        DomainName: 'example.com',
        CustomOriginConfig: {
          HTTPPort: 80,
          HTTPSPort: 443,
          OriginProtocolPolicy: 'https-only'
        }
      }
    ],
    DefaultCacheBehavior: {
      TargetOriginId: 'myOrigin',
      ViewerProtocolPolicy: 'redirect-to-https',
      TrustedSigners: { Enabled: false, Quantity: 0 },
      ForwardedValues: {
        QueryString: false,
        Cookies: { Forward: 'none' }
      },
      DefaultTTL: 86400,
      Compress: true
    },
    Enabled: true
  });

  console.log('✓ Distribution created');
  console.log(`  ID: ${distribution.id}`);
  console.log(`  Domain: ${distribution.domainName}`);
  console.log(`  Status: ${distribution.enabled ? 'Enabled' : 'Disabled'}`);

  // List distributions
  const distributions = simulator.listDistributions();
  console.log(`\n✓ Total distributions: ${distributions.length}`);

  return { service, distribution };
}

// Example 2: Caching and Cache Statistics
async function cachingExample() {
  console.log('\n=== Example 2: Caching Behavior ===\n');

  const config = {
    ports: { cloudfront: 4566 },
    storagePath: './data/cloudfront'
  };

  const service = new CloudFrontService(config);
  await service.initialize();
  await service.start();

  const simulator = service.getSimulator();

  // Create distribution
  const distribution = simulator.createDistribution({
    CallerReference: 'cache-test-1',
    Comment: 'Cache test distribution',
    Origins: [
      {
        Id: 'origin1',
        DomainName: 'api.example.com'
      }
    ],
    DefaultCacheBehavior: {
      TargetOriginId: 'origin1',
      ViewerProtocolPolicy: 'https-only',
      DefaultTTL: 3600,
      Compress: true
    },
    Enabled: true
  });

  // Make requests and observe caching
  console.log('Making requests...\n');

  // Request 1 - Cache MISS
  const request1 = simulator.processRequest({
    distributionId: distribution.id,
    path: '/api/users',
    method: 'GET'
  });
  console.log(`Request 1: ${request1.cacheStatus} (status: ${request1.status})`);

  // Request 2 - Same path, should be Cache HIT
  const request2 = simulator.processRequest({
    distributionId: distribution.id,
    path: '/api/users',
    method: 'GET'
  });
  console.log(`Request 2: ${request2.cacheStatus} (status: ${request2.status})`);

  // Request 3 - Different path, Cache MISS
  const request3 = simulator.processRequest({
    distributionId: distribution.id,
    path: '/api/posts',
    method: 'GET'
  });
  console.log(`Request 3: ${request3.cacheStatus} (status: ${request3.status})`);

  // Request 4 - Cached path again, Cache HIT
  const request4 = simulator.processRequest({
    distributionId: distribution.id,
    path: '/api/users',
    method: 'GET'
  });
  console.log(`Request 4: ${request4.cacheStatus} (status: ${request4.status})`);

  // Show statistics
  const stats = simulator.getRequestStats();
  console.log('\n✓ Cache Statistics:');
  console.log(`  Total Requests: ${stats.totalRequests}`);
  console.log(`  Cache Hits: ${stats.cacheHits}`);
  console.log(`  Cache Misses: ${stats.cacheMisses}`);
  console.log(`  Hit Rate: ${stats.hitRate}`);

  return { service, distribution };
}

// Example 3: Cache Invalidation
async function invalidationExample() {
  console.log('\n=== Example 3: Cache Invalidation ===\n');

  const config = {
    ports: { cloudfront: 4566 },
    storagePath: './data/cloudfront'
  };

  const service = new CloudFrontService(config);
  await service.initialize();
  await service.start();

  const simulator = service.getSimulator();

  // Create distribution
  const distribution = simulator.createDistribution({
    CallerReference: 'invalidate-test-1',
    Comment: 'Invalidation test',
    Origins: [{ Id: 'origin1', DomainName: 'cdn.example.com' }],
    DefaultCacheBehavior: {
      TargetOriginId: 'origin1',
      ViewerProtocolPolicy: 'https-only',
      DefaultTTL: 86400
    },
    Enabled: true
  });

  // Cache some content
  console.log('Caching content...\n');
  simulator.processRequest({
    distributionId: distribution.id,
    path: '/images/photo1.jpg',
    method: 'GET'
  });

  simulator.processRequest({
    distributionId: distribution.id,
    path: '/images/photo2.jpg',
    method: 'GET'
  });

  simulator.processRequest({
    distributionId: distribution.id,
    path: '/styles/app.css',
    method: 'GET'
  });

  console.log('✓ Content cached');

  // Invalidate paths
  console.log('\nInvalidating paths...\n');
  const invalidation = simulator.invalidateDistribution(distribution.id, [
    '/images/*',
    '/styles/app.css'
  ]);

  console.log(`✓ Invalidation created`);
  console.log(`  Invalidation ID: ${invalidation.invalidationId}`);
  console.log(`  Paths invalidated: ${invalidation.invalidatedCount}`);
  console.log(`  Status: ${invalidation.status}`);

  return { service, distribution };
}

// Example 4: Geo-Restrictions
async function geoRestrictionsExample() {
  console.log('\n=== Example 4: Geo-Restrictions ===\n');

  const config = {
    ports: { cloudfront: 4566 },
    storagePath: './data/cloudfront'
  };

  const service = new CloudFrontService(config);
  await service.initialize();
  await service.start();

  const simulator = service.getSimulator();

  // Create distribution with geo-restrictions
  const distribution = simulator.createDistribution({
    CallerReference: 'geo-test-1',
    Comment: 'Geo-restricted distribution',
    Origins: [{ Id: 'origin1', DomainName: 'geo-cdn.example.com' }],
    DefaultCacheBehavior: {
      TargetOriginId: 'origin1',
      ViewerProtocolPolicy: 'https-only',
      DefaultTTL: 3600
    },
    Restrictions: {
      GeoRestriction: {
        RestrictionType: 'blacklist',
        Quantity: 3,
        Locations: ['CN', 'RU', 'KP']
      }
    },
    Enabled: true
  });

  console.log('✓ Distribution created with geo-restrictions');
  console.log('  Blocked countries: CN (China), RU (Russia), KP (North Korea)\n');

  // Test requests from different countries
  const geoRestrictions = require('../src/services/cloudfront/geo-restrictions');
  const geo = new geoRestrictions();

  const countries = ['US', 'GB', 'CN', 'JP', 'RU'];

  console.log('Testing requests from different countries:\n');
  for (const country of countries) {
    const check = geo.checkGeoRestriction(
      distribution.Restrictions.GeoRestriction,
      country
    );
    const status = check.isAllowed ? '✓ ALLOWED' : '✗ BLOCKED';
    console.log(`  ${country}: ${status}`);
  }

  return { service, distribution };
}

// Example 5: Signed URLs
async function signedUrlExample() {
  console.log('\n=== Example 5: Signed URLs for Private Content ===\n');

  const crypto = require('crypto');
  const config = {
    ports: { cloudfront: 4566 },
    storagePath: './data/cloudfront'
  };

  const service = new CloudFrontService(config);
  await service.initialize();
  await service.start();

  const simulator = service.getSimulator();

  // Create distribution for private content
  const distribution = simulator.createDistribution({
    CallerReference: 'private-content-1',
    Comment: 'Private content distribution',
    Origins: [{ Id: 'origin1', DomainName: 'private.example.com' }],
    DefaultCacheBehavior: {
      TargetOriginId: 'origin1',
      ViewerProtocolPolicy: 'https-only',
      TrustedSigners: {
        Enabled: true,
        Quantity: 1,
        Items: ['APKAEXAMPLE']
      },
      DefaultTTL: 3600
    },
    Enabled: true
  });

  console.log('✓ Distribution created for private content\n');

  // For demo, generate a test key pair (in production, use real keys)
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  // Generate signed URL
  const SignedUrlGenerator = require('../src/services/cloudfront/signed-url-generator');
  const generator = new SignedUrlGenerator();

  const expirationTime = new Date(Date.now() + 3600000); // 1 hour
  const signedUrl = generator.generateCannedUrl(
    distribution.domainName,
    '/private/document.pdf',
    privateKey,
    'APKAEXAMPLE',
    expirationTime
  );

  console.log('✓ Signed URL generated');
  console.log(`\nURL (truncated):`);
  console.log(`  ${signedUrl.substring(0, 80)}...`);
  console.log(`\nExpires: ${expirationTime.toISOString()}`);

  // Generate signed cookies as alternative
  const cookies = generator.generateCookies(
    privateKey,
    'APKAEXAMPLE',
    '/private/*',
    expirationTime
  );

  console.log('\n✓ Signed cookies generated');
  console.log(`  Cookie names:`);
  console.log(`    - CloudFront-Policy`);
  console.log(`    - CloudFront-Signature`);
  console.log(`    - CloudFront-Key-Pair-Id`);

  return { service, distribution };
}

// Example 6: Multi-Origin Distribution with Path Patterns
async function multiOriginExample() {
  console.log('\n=== Example 6: Multi-Origin Distribution ===\n');

  const config = {
    ports: { cloudfront: 4566 },
    storagePath: './data/cloudfront'
  };

  const service = new CloudFrontService(config);
  await service.initialize();
  await service.start();

  const simulator = service.getSimulator();

  // Create distribution with multiple origins
  const distribution = simulator.createDistribution({
    CallerReference: 'multi-origin-1',
    Comment: 'Multi-origin distribution',
    Origins: [
      {
        Id: 'staticOrigin',
        DomainName: 'static.example.com'
      },
      {
        Id: 'apiOrigin',
        DomainName: 'api.example.com'
      },
      {
        Id: 'imagesOrigin',
        DomainName: 'images.example.com'
      }
    ],
    DefaultCacheBehavior: {
      TargetOriginId: 'staticOrigin',
      ViewerProtocolPolicy: 'https-only',
      DefaultTTL: 86400,
      Compress: true
    },
    CacheBehaviors: [
      {
        PathPattern: '/api/*',
        TargetOriginId: 'apiOrigin',
        ViewerProtocolPolicy: 'https-only',
        DefaultTTL: 0 // No caching for API
      },
      {
        PathPattern: '*.jpg',
        TargetOriginId: 'imagesOrigin',
        ViewerProtocolPolicy: 'allow-all',
        DefaultTTL: 2592000, // 30 days for images
        Compress: true
      }
    ],
    Enabled: true
  });

  console.log('✓ Multi-origin distribution created\n');
  console.log('Origins configured:');
  console.log('  1. Static content (default) → static.example.com');
  console.log('  2. API (/api/*) → api.example.com (no cache)');
  console.log('  3. Images (*.jpg) → images.example.com (30 day cache)\n');

  // Test routing
  console.log('Testing request routing:\n');

  const testPaths = [
    '/index.html',
    '/api/users',
    '/photo.jpg',
    '/api/posts/123',
    '/banner.jpg',
    '/about.html'
  ];

  for (const path of testPaths) {
    const behavior = distribution.matchBehavior(path);
    const originId = behavior.TargetOriginId;
    const ttl = behavior.DefaultTTL || 0;
    const cache = ttl > 0 ? `(${ttl}s cache)` : '(no cache)';
    console.log(`  ${path.padEnd(20)} → ${originId.padEnd(15)} ${cache}`);
  }

  return { service, distribution };
}

// Example 7: Complete Setup with Statistics
async function completeSetupExample() {
  console.log('\n=== Example 7: Complete Setup with Statistics ===\n');

  const config = {
    ports: { cloudfront: 4566 },
    storagePath: './data/cloudfront'
  };

  const service = new CloudFrontService(config);
  await service.initialize();
  await service.start();

  const simulator = service.getSimulator();

  // Create distribution
  const distribution = simulator.createDistribution({
    CallerReference: 'complete-setup-1',
    Comment: 'Complete setup example',
    Origins: [{ Id: 'origin1', DomainName: 'example.com' }],
    DefaultCacheBehavior: {
      TargetOriginId: 'origin1',
      ViewerProtocolPolicy: 'https-only',
      DefaultTTL: 3600
    },
    Enabled: true
  });

  console.log('Distribution Summary:');
  console.log(`  ID: ${distribution.id}`);
  console.log(`  Domain: ${distribution.domainName}`);
  console.log(`  Status: ${distribution.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  Created: ${distribution.createdTime}`);

  // Simulate traffic
  console.log('\nSimulating traffic...\n');

  const paths = ['/index.html', '/api/data', '/images/banner.jpg', '/index.html', '/api/data', '/about.html'];

  for (const path of paths) {
    simulator.processRequest({
      distributionId: distribution.id,
      path: path,
      method: 'GET'
    });
  }

  // Show statistics
  console.log('✓ Traffic simulated\n');

  const stats = simulator.getDistributionStats(distribution.id);
  console.log('Distribution Statistics:');
  console.log(`  Enabled: ${stats.enabled}`);
  console.log(`  Domain: ${stats.domainName}`);
  console.log(`  Cache Entries: ${stats.caching.entries}`);
  console.log(`  Cache Hit Rate: ${stats.caching.hitRate}`);
  console.log(`  Total Requests: ${stats.global.totalRequests}`);
  console.log(`  Cache Hits: ${stats.global.cacheHits}`);
  console.log(`  Cache Misses: ${stats.global.cacheMisses}`);

  const cacheStats = simulator.getCacheStats();
  console.log('\nGlobal Cache Statistics:');
  console.log(`  Total Entries: ${cacheStats.entries}`);
  console.log(`  Max Size: ${(cacheStats.maxSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Used Size: ${(cacheStats.usedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Cleanup Interval: ${cacheStats.cleanupInterval / 1000} seconds`);

  return { service, distribution };
}

// Run examples
async function runExamples() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         CloudFront Service Examples & Demonstrations            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  try {
    // Uncomment examples to run them
    await basicDistributionExample();
    await cachingExample();
    await invalidationExample();
    await geoRestrictionsExample();
    await signedUrlExample();
    await multiOriginExample();
    await completeSetupExample();

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    All Examples Completed ✓                     ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('\n✗ Error running examples:', error.message);
    process.exit(1);
  }
}

// Export for use in tests
module.exports = {
  basicDistributionExample,
  cachingExample,
  invalidationExample,
  geoRestrictionsExample,
  signedUrlExample,
  multiOriginExample,
  completeSetupExample,
  runExamples
};

// Run if executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}
