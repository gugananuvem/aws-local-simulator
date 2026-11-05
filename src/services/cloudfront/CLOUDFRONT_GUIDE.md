# AWS CloudFront Simulator Guide

A comprehensive CloudFront simulator for local AWS development and testing. Implements real AWS CloudFront behavior including distributions, caching, invalidation, geo-restrictions, and signed URLs.

## Features

### ✅ Implemented

- **Distribution Management**: Create, read, update, and delete CloudFront distributions
- **Content Caching**: LRU-based cache with configurable TTL and max size
- **Cache Invalidation**: Invalidate specific paths or wildcards
- **Behavior Routing**: Path pattern matching with specificity-based resolution
- **Origins**: Support for S3, HTTP/HTTPS, and Lambda@Edge origins
- **Origin Validation**: Comprehensive origin configuration validation
- **Geo-Restrictions**: Whitelist/blacklist countries with validation
- **Signed URLs**: RSA-based signed URLs for private content distribution
- **Signed Cookies**: Alternative to signed URLs for authentication
- **Origin Groups**: Failover configuration with status code based switching
- **Cache Engine**: Memory-efficient LRU cache with statistics
- **Persistence**: JSON-based store for distributions and configurations
- **REST API**: Full REST API for CloudFront operations
- **Statistics**: Comprehensive caching and request statistics

## Installation

```bash
npm install @gugananuvem/aws-local-simulator
```

## Quick Start

### Basic Usage

```javascript
const CloudFrontService = require('./cloudfront');

// Create service
const service = new CloudFrontService({
  ports: { cloudfront: 4566 },
  storagePath: './data/cloudfront'
});

// Initialize and start
await service.initialize();
await service.start();

// Create distribution
const distribution = service.getSimulator().createDistribution({
  CallerReference: 'my-dist-1',
  Comment: 'My CloudFront distribution',
  Origins: [
    {
      Id: 'myOrigin',
      DomainName: 'mybucket.s3.amazonaws.com'
    }
  ],
  DefaultCacheBehavior: {
    TargetOriginId: 'myOrigin',
    ViewerProtocolPolicy: 'https-only',
    TrustedSigners: { Enabled: false, Quantity: 0 },
    ForwardedValues: {
      QueryString: false,
      Cookies: { Forward: 'none' }
    }
  },
  Enabled: true
});

console.log('Distribution created:', distribution.id);
```

### REST API Usage

```bash
# Create distribution
curl -X POST http://localhost:4566/distribution \
  -H "Content-Type: application/json" \
  -d '{
    "CallerReference": "test-1",
    "Origins": [{"Id": "origin1", "DomainName": "example.com"}],
    "DefaultCacheBehavior": {
      "TargetOriginId": "origin1",
      "ViewerProtocolPolicy": "allow-all"
    },
    "Enabled": true
  }'

# Get distribution
curl http://localhost:4566/distribution/E123456789ABC

# List distributions
curl http://localhost:4566/distribution

# Delete distribution
curl -X DELETE http://localhost:4566/distribution/E123456789ABC
```

## Core Concepts

### Distributions

A distribution is the primary CloudFront resource that specifies:
- Origins (where content comes from)
- Cache behaviors (how content is cached)
- Restrictions (geo-blocking, etc.)
- SSL/TLS settings

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'unique-id', // Must be unique per account
  Comment: 'Description of the distribution',
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
      Cookies: { Forward: 'none' },
      Headers: { Quantity: 0 }
    },
    MinTTL: 0,
    DefaultTTL: 86400,
    MaxTTL: 31536000,
    Compress: true
  },
  Enabled: true
});
```

### Cache Behaviors

Path patterns determine which behavior handles requests:

```javascript
distribution.CacheBehaviors = [
  {
    PathPattern: '/api/*',
    TargetOriginId: 'apiOrigin',
    ViewerProtocolPolicy: 'https-only',
    // Lower TTL for API responses
    DefaultTTL: 60
  },
  {
    PathPattern: '*.jpg',
    TargetOriginId: 'imageOrigin',
    ViewerProtocolPolicy: 'allow-all',
    // Higher TTL for images
    DefaultTTL: 86400
  },
  {
    PathPattern: '/index.html',
    TargetOriginId: 'mainOrigin',
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 0 // No caching
  }
];
```

Behavior matching:
- Most specific patterns are matched first
- `*` matches any path
- `*.ext` matches files with extension
- `/path/*` matches paths under /path/

### Caching

The cache engine implements LRU (Least Recently Used) eviction:

```javascript
// Cache statistics
const stats = simulator.getCacheStats();
console.log(stats);
// {
//   entries: 42,
//   maxSize: 104857600, // 100MB default
//   usedSize: 45678900,
//   hitRate: '78.5%',
//   lastCleanup: '2024-01-15T10:30:00Z'
// }

// Request statistics
const requestStats = simulator.getRequestStats();
console.log(requestStats);
// {
//   totalRequests: 1000,
//   cacheHits: 785,
//   cacheMisses: 215,
//   blockedRequests: 0,
//   hitRate: '78.50%'
// }
```

### Invalidation

Invalidate cached content to force re-fetch from origin:

```javascript
// Invalidate specific paths
const result = simulator.invalidateDistribution(distributionId, [
  '/path/to/file.html',
  '/images/*',
  '/*.css'
]);

console.log(result);
// {
//   invalidationId: 'I1234567890ABC',
//   distributionId: 'E123456789ABC',
//   paths: ['/path/to/file.html', '/images/*', '/*.css'],
//   invalidatedCount: 3,
//   status: 'InProgress'
// }
```

### Geo-Restrictions

Control access by geography:

```javascript
const distribution = simulator.createDistribution({
  // ... other config ...
  Restrictions: {
    GeoRestriction: {
      RestrictionType: 'whitelist', // or 'blacklist'
      Quantity: 2,
      Locations: ['US', 'CA'] // ISO 3166-1 alpha-2 codes
    }
  }
});

// Check if request allowed
const geoRestrictions = new GeoRestrictions();
const check = geoRestrictions.checkGeoRestriction(
  distribution.Restrictions.GeoRestriction,
  'US'
);
console.log(check.isAllowed); // true
```

### Signed URLs

Create time-limited, cryptographically signed URLs for private content:

```javascript
const generator = new SignedUrlGenerator();

// Generate canned signed URL (simple TTL)
const signedUrl = generator.generateCannedUrl(
  'dxample.cloudfront.net',
  '/private/document.pdf',
  privateKey,           // PEM format
  'APKAEXAMPLE',        // Key Pair ID
  new Date(Date.now() + 3600000) // Expires in 1 hour
);

console.log(signedUrl);
// https://d123456.cloudfront.net/private/document.pdf?Signature=...&Key-Pair-Id=APKAEXAMPLE

// Generate custom signed URL (advanced restrictions)
const customUrl = generator.generateCustomUrl(
  'd123456.cloudfront.net',
  '/private/*',
  privateKey,
  'APKAEXAMPLE',
  {
    expirationTime: new Date(Date.now() + 3600000),
    notBefore: new Date(Date.now() - 60000),
    ipRange: ['192.0.2.0/24']
  }
);

// Generate signed cookies (for multiple files)
const cookies = generator.generateCookies(
  privateKey,
  'APKAEXAMPLE',
  '/private/*',
  new Date(Date.now() + 3600000)
);

console.log(cookies);
// {
//   'CloudFront-Policy': '...',
//   'CloudFront-Signature': '...',
//   'CloudFront-Key-Pair-Id': 'APKAEXAMPLE'
// }
```

### Origins

Different origin types are supported:

```javascript
// S3 Origin
{
  Id: 's3Origin',
  DomainName: 'mybucket.s3.amazonaws.com',
  S3OriginConfig: {
    OriginAccessIdentity: 'origin-access-identity/cloudfront/E123456789ABC'
  }
}

// HTTP/HTTPS Origin
{
  Id: 'httpOrigin',
  DomainName: 'example.com',
  OriginPath: '/production',
  CustomOriginConfig: {
    HTTPPort: 80,
    HTTPSPort: 443,
    OriginProtocolPolicy: 'https-only',
    OriginSSLProtocols: ['TLSv1.2'],
    OriginReadTimeout: 30,
    OriginKeepAliveTimeout: 5
  },
  CustomHeaders: [
    {
      HeaderName: 'X-Custom-Header',
      HeaderValue: 'custom-value'
    }
  ]
}

// Lambda@Edge Origin
{
  Id: 'lambdaOrigin',
  DomainName: 'arn:aws:lambda:us-east-1:123456789012:function:my-function:1'
}
```

### Origin Groups

Configure failover between origins:

```javascript
const distribution = simulator.createDistribution({
  // ... other config ...
  OriginGroups: [
    {
      Id: 'myOriginGroup',
      FailoverCriteria: {
        StatusCodes: {
          Quantity: 2,
          Items: [500, 502]
        }
      },
      Members: {
        Quantity: 2,
        Items: [
          { OriginId: 'primaryOrigin' },
          { OriginId: 'backupOrigin' }
        ]
      }
    }
  ]
});
```

## API Reference

### CloudFrontSimulator

#### `createDistribution(config)`
Create a new distribution.

```javascript
const distribution = simulator.createDistribution(config);
```

#### `getDistribution(id)`
Get a distribution by ID.

```javascript
const distribution = simulator.getDistribution('E123456789ABC');
```

#### `listDistributions()`
List all distributions.

```javascript
const distributions = simulator.listDistributions();
```

#### `deleteDistribution(id)`
Delete a distribution.

```javascript
const deleted = simulator.deleteDistribution('E123456789ABC');
```

#### `processRequest(request)`
Process a request through the distribution (for content delivery).

```javascript
const response = simulator.processRequest({
  distributionId: 'E123456789ABC',
  path: '/index.html',
  method: 'GET',
  headers: { 'User-Agent': 'Mozilla/5.0' },
  clientIp: '192.0.2.1',
  protocol: 'https'
});
```

#### `invalidateDistribution(id, paths)`
Invalidate cached content.

```javascript
const result = simulator.invalidateDistribution('E123456789ABC', [
  '/path/*',
  '/file.html'
]);
```

#### `generateSignedUrl(id, path, privateKey, keyPairId, expirationTime)`
Generate a signed URL.

```javascript
const url = simulator.generateSignedUrl(
  'E123456789ABC',
  '/private/file.pdf',
  privateKey,
  'APKAEXAMPLE',
  3600 // seconds from now
);
```

### REST API Endpoints

#### Distributions

```
POST   /distribution                    Create distribution
GET    /distribution/:id                Get distribution
GET    /distribution                    List distributions
PUT    /distribution/:id                Update distribution
DELETE /distribution/:id                Delete distribution
GET    /distribution/:id/config         Get config
PUT    /distribution/:id/config         Update config
```

#### Invalidations

```
POST   /distribution/:id/invalidation                   Create invalidation
GET    /distribution/:id/invalidation/:invalidationId   Get invalidation
```

#### Statistics

```
GET    /distribution/:id/stats          Get distribution stats
GET    /cache/stats                     Get cache stats
```

#### Signed URLs

```
POST   /distribution/:id/signed-url     Generate signed URL
```

#### Content Delivery

```
GET    /:distributionId/*               Deliver content
```

## Configuration

### CloudFront Service Options

```javascript
const service = new CloudFrontService({
  // Port for REST API
  ports: {
    cloudfront: 4566
  },

  // Storage configuration
  storagePath: './data/cloudfront',

  // Cache configuration
  cacheOptions: {
    maxSize: 104857600,  // 100MB default
    cleanupInterval: 60000 // 60 seconds
  }
});
```

## Examples

### Example 1: Simple Static Website Distribution

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'static-site-1',
  Comment: 'Static website distribution',
  Origins: [
    {
      Id: 'S3Origin',
      DomainName: 'mybucket.s3.amazonaws.com'
    }
  ],
  DefaultCacheBehavior: {
    TargetOriginId: 'S3Origin',
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
```

### Example 2: Multi-Origin Distribution with Path Patterns

```javascript
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
    }
  ],
  DefaultCacheBehavior: {
    TargetOriginId: 'staticOrigin',
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 86400
  },
  CacheBehaviors: [
    {
      PathPattern: '/api/*',
      TargetOriginId: 'apiOrigin',
      ViewerProtocolPolicy: 'https-only',
      DefaultTTL: 0 // No caching for API
    }
  ],
  Enabled: true
});
```

### Example 3: Distribution with Geo-Restrictions

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'geo-restricted-1',
  Comment: 'Geo-restricted distribution',
  Origins: [
    {
      Id: 'origin1',
      DomainName: 'example.com'
    }
  ],
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
```

### Example 4: Private Content with Signed URLs

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'private-content-1',
  Comment: 'Private content distribution',
  Origins: [
    {
      Id: 'origin1',
      DomainName: 'example.com'
    }
  ],
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

// Generate signed URL
const signedUrl = simulator.generateSignedUrl(
  distribution.id,
  '/private/document.pdf',
  privateKey,
  'APKAEXAMPLE',
  3600
);
```

## Troubleshooting

### Cache Not Working

1. **Check default behavior TTL**: Ensure `DefaultTTL` is set to a value > 0
2. **Verify request method**: Only GET requests are cached by default
3. **Check cache statistics**: Use `getCacheStats()` to verify cache is being used
4. **Invalidation pending**: Recent invalidations may still be processing

### Geo-Restrictions Not Blocking

1. **Verify country code**: Use ISO 3166-1 alpha-2 format (e.g., 'US', 'GB')
2. **Check restriction type**: Verify 'whitelist' vs 'blacklist' configuration
3. **Validate geo info**: Ensure client IP is correctly mapped to country

### Signed URL Not Working

1. **Check expiration**: Ensure URL hasn't expired
2. **Verify signature**: Use the same private key used to generate URL
3. **Check time sync**: Ensure server time is accurate
4. **Validate format**: Check that URL parameters are correct

## Performance Considerations

- **Cache Size**: Default 100MB - adjust based on your content
- **Cleanup Interval**: Default 60 seconds - balance memory vs. CPU
- **LRU Eviction**: Least recently used entries evicted first
- **Path Matching**: Regex-based matching is cached for performance

## Limitations

- Geolocation based on simplified IP mapping (not production GeoIP)
- Origin validation is local (doesn't test actual origin connectivity)
- Signed URL verification doesn't validate actual key pair validity
- No support for Lambda@Edge execution
- No real-time statistics (no persistent metrics storage)

## Contributing

Contributions are welcome! Areas for improvement:
- Production GeoIP database integration
- Real Lambda@Edge support
- Advanced caching policies
- Custom error responses
- Real-time metrics and monitoring

## License

See LICENSE file for details.
