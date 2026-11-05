# CloudFront Service Examples

This directory contains practical examples of how to use the CloudFront simulator in the aws-local-simulator.

## Running the Examples

To run all CloudFront examples:

```bash
node examples/cloudfront-example.js
```

To run individual examples, modify the `runExamples()` function in `cloudfront-example.js` and comment out the examples you don't want.

## Example Descriptions

### Example 1: Basic Distribution Setup

Shows how to create a simple CloudFront distribution with a single origin.

**Key concepts:**
- Creating a distribution with `createDistribution()`
- Configuring origins and default cache behavior
- Understanding the distribution structure

**Output:**
- Distribution ID and domain name
- List of all distributions

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'basic-dist-1',
  Comment: 'Basic CloudFront distribution',
  Origins: [...],
  DefaultCacheBehavior: {...},
  Enabled: true
});
```

### Example 2: Caching Behavior

Demonstrates how caching works with cache hits and misses.

**Key concepts:**
- Cache hits (content served from cache)
- Cache misses (content fetched from origin)
- Cache statistics and hit rate
- TTL (Time To Live) configuration

**Output:**
- Request cache status (HIT/MISS)
- Cache statistics (total requests, hits, misses, hit rate)

```javascript
// Request 1 - Cache MISS
const request1 = simulator.processRequest({
  distributionId: distribution.id,
  path: '/api/users',
  method: 'GET'
});

// Request 2 - Cache HIT (same path)
const request2 = simulator.processRequest({
  distributionId: distribution.id,
  path: '/api/users',
  method: 'GET'
});
```

### Example 3: Cache Invalidation

Shows how to invalidate cached content using path patterns.

**Key concepts:**
- Invalidating specific paths
- Using wildcard patterns (*) for bulk invalidation
- Invalidation status tracking
- Cache expiration workflows

**Output:**
- Invalidation ID and status
- Number of paths invalidated

```javascript
const invalidation = simulator.invalidateDistribution(distribution.id, [
  '/images/*',
  '/styles/app.css'
]);
```

### Example 4: Geo-Restrictions

Demonstrates geographic access control for content distribution.

**Key concepts:**
- Whitelist and blacklist restriction types
- Country code validation (ISO 3166-1)
- Testing access from different countries
- Geo-restriction policies

**Output:**
- Distribution created with geo-restrictions
- Access allowed/blocked status for different countries

```javascript
Restrictions: {
  GeoRestriction: {
    RestrictionType: 'blacklist',
    Quantity: 3,
    Locations: ['CN', 'RU', 'KP']
  }
}
```

### Example 5: Signed URLs

Shows how to create cryptographically signed URLs for private content.

**Key concepts:**
- URL signing with RSA keys
- Canned policies (TTL-based)
- Custom policies (with IP and time restrictions)
- Signed cookies as alternative

**Output:**
- Signed URL with embedded signature
- Expiration time
- Signed cookie names

```javascript
const signedUrl = generator.generateCannedUrl(
  distribution.domainName,
  '/private/document.pdf',
  privateKey,
  'APKAEXAMPLE',
  expirationTime
);
```

### Example 6: Multi-Origin Distribution

Demonstrates routing requests to different origins based on path patterns.

**Key concepts:**
- Multiple origins for different content types
- Path pattern matching
- Different caching policies per origin
- Behavior specificity and precedence

**Output:**
- Origins configuration
- Request routing to correct origin
- Cache TTL for each path pattern

```javascript
CacheBehaviors: [
  {
    PathPattern: '/api/*',
    TargetOriginId: 'apiOrigin',
    DefaultTTL: 0 // No caching
  },
  {
    PathPattern: '*.jpg',
    TargetOriginId: 'imagesOrigin',
    DefaultTTL: 2592000 // 30 days
  }
]
```

### Example 7: Complete Setup with Statistics

Shows a complete setup with traffic simulation and comprehensive statistics.

**Key concepts:**
- Full distribution configuration
- Simulating real traffic patterns
- Gathering and displaying statistics
- Performance monitoring

**Output:**
- Distribution summary
- Cache statistics and hit rate
- Request distribution patterns

## Common Use Cases

### Use Case 1: Static Website CDN

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'website-cdn',
  Origins: [{
    Id: 's3Origin',
    DomainName: 'mybucket.s3.amazonaws.com'
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 's3Origin',
    ViewerProtocolPolicy: 'redirect-to-https',
    DefaultTTL: 86400, // 24 hours
    Compress: true
  }
});
```

### Use Case 2: API with Dynamic Content

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'api-cdn',
  Origins: [{
    Id: 'apiOrigin',
    DomainName: 'api.example.com'
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 'apiOrigin',
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 60, // 1 minute
    ForwardedValues: {
      QueryString: true, // Important for APIs
      Cookies: { Forward: 'all' }
    }
  }
});
```

### Use Case 3: Private Content Distribution

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'private-cdn',
  Origins: [{
    Id: 'origin',
    DomainName: 'content.example.com'
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 'origin',
    ViewerProtocolPolicy: 'https-only',
    TrustedSigners: {
      Enabled: true,
      Quantity: 1,
      Items: ['APKAEXAMPLE']
    }
  }
});
```

### Use Case 4: Multi-Regional Content

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'global-cdn',
  Origins: [
    { Id: 'usOrigin', DomainName: 'us.example.com' },
    { Id: 'euOrigin', DomainName: 'eu.example.com' },
    { Id: 'apOrigin', DomainName: 'ap.example.com' }
  ],
  CacheBehaviors: [
    {
      PathPattern: '/us/*',
      TargetOriginId: 'usOrigin'
    },
    {
      PathPattern: '/eu/*',
      TargetOriginId: 'euOrigin'
    },
    {
      PathPattern: '/ap/*',
      TargetOriginId: 'apOrigin'
    }
  ]
});
```

## Testing Patterns

### Pattern 1: Cache Hit Rate Testing

```javascript
// Make multiple requests to same path
for (let i = 0; i < 10; i++) {
  simulator.processRequest({
    distributionId: distribution.id,
    path: '/index.html'
  });
}

// Check hit rate
const stats = simulator.getRequestStats();
console.log(`Hit Rate: ${stats.hitRate}`);
```

### Pattern 2: Path Pattern Testing

```javascript
// Test which behavior matches each path
const paths = [
  '/images/photo.jpg',
  '/api/users',
  '/styles/app.css',
  '/index.html'
];

for (const path of paths) {
  const behavior = distribution.matchBehavior(path);
  console.log(`${path} → ${behavior.TargetOriginId}`);
}
```

### Pattern 3: Invalidation Testing

```javascript
// Cache content
simulator.processRequest({
  distributionId: distribution.id,
  path: '/cached-file.html'
});

// Verify cached
let response = simulator.processRequest({
  distributionId: distribution.id,
  path: '/cached-file.html'
});
console.log(response.cacheStatus); // HIT

// Invalidate
simulator.invalidateDistribution(distribution.id, ['/cached-file.html']);

// Verify invalidated
response = simulator.processRequest({
  distributionId: distribution.id,
  path: '/cached-file.html'
});
console.log(response.cacheStatus); // MISS
```

## Integration with REST API

You can also test CloudFront through the REST API:

```bash
# Create distribution
curl -X POST http://localhost:4566/distribution \
  -H "Content-Type: application/json" \
  -d @distribution-config.json

# Get distribution
curl http://localhost:4566/distribution/E123456789ABC

# Invalidate cache
curl -X POST http://localhost:4566/distribution/E123456789ABC/invalidation \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/images/*"]}'

# Get statistics
curl http://localhost:4566/distribution/E123456789ABC/stats
```

## Advanced Topics

### Custom Cache Behaviors

Configure different cache behaviors for different content types:

```javascript
CacheBehaviors: [
  {
    PathPattern: '/api/*',
    TargetOriginId: 'api',
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 0,
    ForwardedValues: {
      QueryString: true,
      Cookies: { Forward: 'all' }
    }
  },
  {
    PathPattern: '/static/*',
    TargetOriginId: 'static',
    ViewerProtocolPolicy: 'allow-all',
    DefaultTTL: 31536000, // 1 year
    Compress: true
  }
]
```

### Origin Groups with Failover

Configure failover between origins:

```javascript
OriginGroups: [
  {
    Id: 'failover-group',
    Members: {
      Items: [
        { OriginId: 'primaryOrigin' },
        { OriginId: 'backupOrigin' }
      ]
    },
    FailoverCriteria: {
      StatusCodes: [500, 502, 503, 504]
    }
  }
]
```

### Signed URL with Custom Policy

Create signed URLs with custom restrictions:

```javascript
const customUrl = generator.generateCustomUrl(
  'example.cloudfront.net',
  '/private/*',
  privateKey,
  'APKAEXAMPLE',
  {
    expirationTime: new Date(Date.now() + 3600000),
    notBefore: new Date(Date.now() - 60000),
    ipRange: ['192.0.2.0/24', '198.51.100.0/24']
  }
);
```

## Troubleshooting

### Cache Not Working

1. Check default behavior TTL is > 0
2. Verify using GET method
3. Check cache size isn't full

### Geo-Restrictions Not Applied

1. Verify country code format (ISO 3166-1)
2. Check restriction type (whitelist vs blacklist)
3. Ensure geo-restriction is enabled

### Signed URLs Invalid

1. Use consistent private key
2. Check expiration time hasn't passed
3. Verify key pair ID matches

## Further Reading

- [CLOUDFRONT_GUIDE.md](../src/services/cloudfront/CLOUDFRONT_GUIDE.md)
- [INTEGRATION.md](../src/services/cloudfront/INTEGRATION.md)
- [CloudFront API Reference](https://docs.aws.amazon.com/cloudfront/latest/APIReference/)

## Support

For issues or questions:
1. Check the examples in this file
2. Review the comprehensive guides in src/services/cloudfront/
3. Check test cases in src/services/cloudfront/cloudfront.test.js
4. Open an issue on the project repository
