# CloudFront Integration Guide

This document describes how to integrate CloudFront with other AWS services in the simulator.

## S3 Integration (Task 12)

CloudFront is commonly used to distribute content stored in S3 buckets.

### Configuration

```javascript
const { S3Service } = require('../s3');
const CloudFrontService = require('./index');

class IntegratedSetup {
  constructor(config) {
    this.s3Service = new S3Service(config);
    this.cfService = new CloudFrontService(config);
  }

  async initialize() {
    await this.s3Service.initialize();
    await this.cfService.initialize();
  }

  async createCDN(bucketName, distributionConfig) {
    // Verify S3 bucket exists
    const simulator = this.s3Service.getSimulator();
    const bucket = simulator.getBucket(bucketName);
    
    if (!bucket) {
      throw new Error(`S3 bucket not found: ${bucketName}`);
    }

    // Create CloudFront distribution pointing to S3
    const cfSimulator = this.cfService.getSimulator();
    const distribution = cfSimulator.createDistribution({
      ...distributionConfig,
      Origins: [
        {
          Id: 's3Origin',
          DomainName: `${bucketName}.s3.amazonaws.com`,
          S3OriginConfig: {}
        }
      ],
      DefaultCacheBehavior: {
        TargetOriginId: 's3Origin',
        ViewerProtocolPolicy: 'https-only',
        TrustedSigners: { Enabled: false, Quantity: 0 },
        ForwardedValues: {
          QueryString: false,
          Cookies: { Forward: 'none' }
        }
      }
    });

    return distribution;
  }
}
```

### Example Usage

```javascript
const setup = new IntegratedSetup(config);
await setup.initialize();

// Create S3 bucket and CloudFront distribution
const s3 = setup.s3Service.getSimulator();
const bucket = s3.createBucket('my-website');

const cfService = setup.cfService;
const distribution = await setup.createCDN('my-website', {
  CallerReference: 'web-cdn-1',
  Comment: 'CDN for my-website bucket'
});

console.log(`S3 Bucket: ${bucket.name}`);
console.log(`CloudFront Distribution: ${distribution.domainName}`);
```

## Lambda Integration (Task 13)

CloudFront can serve content from Lambda functions via Lambda@Edge.

### Configuration

```javascript
const LambdaService = require('../lambda');
const CloudFrontService = require('./index');

class LambdaEdgeCDN {
  constructor(config) {
    this.lambdaService = new LambdaService(config);
    this.cfService = new CloudFrontService(config);
  }

  async createLambdaEdgeDistribution(functionArn, distributionConfig) {
    const cfSimulator = this.cfService.getSimulator();

    // Create distribution with Lambda@Edge origin
    return cfSimulator.createDistribution({
      ...distributionConfig,
      Origins: [
        {
          Id: 'lambdaEdgeOrigin',
          DomainName: functionArn, // ARN format
          CustomHeaders: [
            {
              HeaderName: 'X-Lambda-Edge',
              HeaderValue: 'true'
            }
          ]
        }
      ],
      DefaultCacheBehavior: {
        TargetOriginId: 'lambdaEdgeOrigin',
        ViewerProtocolPolicy: 'https-only',
        TrustedSigners: { Enabled: false, Quantity: 0 },
        ForwardedValues: {
          QueryString: true, // Pass query strings to Lambda
          Cookies: { Forward: 'all' }
        },
        DefaultTTL: 0 // No caching for Lambda responses
      }
    });
  }
}
```

## CloudWatch Integration (Task 14)

CloudFront metrics can be sent to CloudWatch for monitoring.

### Configuration

```javascript
const CloudWatchService = require('../cloudwatch');
const CloudFrontService = require('./index');

class MonitoredCloudFront {
  constructor(config) {
    this.cwService = new CloudWatchService(config);
    this.cfService = new CloudFrontService(config);
  }

  async publishMetrics(distributionId, interval = 60000) {
    const cfSimulator = this.cfService.getSimulator();
    const cwSimulator = this.cwService.getSimulator();

    setInterval(() => {
      const stats = cfSimulator.getDistributionStats(distributionId);
      const requestStats = cfSimulator.getRequestStats();

      // Publish cache hit rate
      cwSimulator.putMetricData({
        Namespace: 'AWS/CloudFront',
        MetricData: [
          {
            MetricName: 'CacheHitRate',
            Value: parseFloat(stats.caching.hitRate),
            Unit: 'Percent',
            Dimensions: [
              {
                Name: 'DistributionId',
                Value: distributionId
              }
            ]
          },
          {
            MetricName: 'Requests',
            Value: requestStats.totalRequests,
            Unit: 'Count',
            Dimensions: [
              {
                Name: 'DistributionId',
                Value: distributionId
              }
            ]
          },
          {
            MetricName: 'BytesSent',
            Value: stats.caching.usedSize,
            Unit: 'Bytes',
            Dimensions: [
              {
                Name: 'DistributionId',
                Value: distributionId
              }
            ]
          }
        ]
      });
    }, interval);
  }
}
```

## IAM Integration (Task 15)

CloudFront uses IAM for access control and SCP evaluation.

### Configuration

```javascript
const IAMService = require('../iam');
const CloudFrontService = require('./index');

class SecuredCloudFront {
  constructor(config) {
    this.iamService = new IAMService(config);
    this.cfService = new CloudFrontService(config);
  }

  async createDistributionWithIAM(distributionConfig, principalArn) {
    const iamSimulator = this.iamService.getSimulator();
    
    // Check if principal has CloudFront permissions
    const hasPermission = iamSimulator.evaluatePolicy(principalArn, 'cloudfront:CreateDistribution');
    
    if (!hasPermission) {
      throw new Error('Principal does not have cloudfront:CreateDistribution permission');
    }

    // Create distribution
    const cfSimulator = this.cfService.getSimulator();
    return cfSimulator.createDistribution(distributionConfig);
  }

  async signUrlWithIAMRole(distributionId, resourcePath, roleArn) {
    // Get temporary credentials for role
    const sts = require('../sts');
    const credentials = await sts.assumeRole(roleArn);

    // Use credentials for signing (in real scenario)
    const cfSimulator = this.cfService.getSimulator();
    return cfSimulator.generateSignedUrl(
      distributionId,
      resourcePath,
      credentials.privateKey,
      credentials.keyPairId,
      3600
    );
  }
}
```

## KMS Integration

For encrypted content distribution:

```javascript
const KMSService = require('../kms');
const CloudFrontService = require('./index');
const S3Service = require('../s3');

class EncryptedCDN {
  constructor(config) {
    this.kmsService = new KMSService(config);
    this.cfService = new CloudFrontService(config);
    this.s3Service = new S3Service(config);
  }

  async createEncryptedDistribution(bucketName, kmsKeyId, distributionConfig) {
    const cfSimulator = this.cfService.getSimulator();
    const s3Simulator = this.s3Service.getSimulator();

    // Verify bucket has encryption with KMS key
    const bucket = s3Simulator.getBucket(bucketName);
    if (!bucket.encryption || bucket.encryption.keyId !== kmsKeyId) {
      throw new Error('Bucket encryption must use specified KMS key');
    }

    // Create distribution
    return cfSimulator.createDistribution({
      ...distributionConfig,
      Origins: [
        {
          Id: 's3Origin',
          DomainName: `${bucketName}.s3.amazonaws.com`,
          S3OriginConfig: {},
          CustomHeaders: [
            {
              HeaderName: 'X-KMS-Key-Id',
              HeaderValue: kmsKeyId
            }
          ]
        }
      ],
      DefaultCacheBehavior: {
        TargetOriginId: 's3Origin',
        ViewerProtocolPolicy: 'https-only',
        TrustedSigners: { Enabled: false, Quantity: 0 },
        ForwardedValues: {
          QueryString: false,
          Cookies: { Forward: 'none' }
        }
      }
    });
  }
}
```

## Multi-Service Example

Complete example integrating multiple services:

```javascript
const S3Service = require('../s3');
const CloudFrontService = require('./index');
const CloudWatchService = require('../cloudwatch');
const IAMService = require('../iam');

class FullStackCDN {
  constructor(config) {
    this.s3 = new S3Service(config);
    this.cf = new CloudFrontService(config);
    this.cw = new CloudWatchService(config);
    this.iam = new IAMService(config);
  }

  async initialize() {
    await this.s3.initialize();
    await this.cf.initialize();
    await this.cw.initialize();
    await this.iam.initialize();
  }

  async deployWebsite(websiteName, files) {
    // 1. Create S3 bucket
    const s3Sim = this.s3.getSimulator();
    const bucket = s3Sim.createBucket(`${websiteName}-website`);
    
    // Upload files
    for (const file of files) {
      s3Sim.putObject(bucket.name, file.key, file.body);
    }

    // 2. Create CloudFront distribution
    const cfSim = this.cf.getSimulator();
    const distribution = cfSim.createDistribution({
      CallerReference: websiteName,
      Comment: `Website distribution for ${websiteName}`,
      Origins: [
        {
          Id: 's3Origin',
          DomainName: `${bucket.name}.s3.amazonaws.com`,
          S3OriginConfig: {}
        }
      ],
      DefaultCacheBehavior: {
        TargetOriginId: 's3Origin',
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

    // 3. Configure CloudWatch monitoring
    this.startMonitoring(distribution.id);

    // 4. Configure IAM policies
    this.setupIAMPolicies(bucket.name, distribution.id);

    return {
      bucket: bucket.name,
      distribution: distribution.id,
      domainName: distribution.domainName
    };
  }

  startMonitoring(distributionId) {
    const cwSim = this.cw.getSimulator();
    const cfSim = this.cf.getSimulator();

    setInterval(() => {
      const stats = cfSim.getDistributionStats(distributionId);
      cwSim.putMetricData({
        Namespace: 'Website/CDN',
        MetricData: [
          {
            MetricName: 'CacheHitRate',
            Value: parseFloat(stats.caching.hitRate),
            Unit: 'Percent'
          },
          {
            MetricName: 'BytesSent',
            Value: stats.caching.usedSize,
            Unit: 'Bytes'
          }
        ]
      });
    }, 60000);
  }

  setupIAMPolicies(bucketName, distributionId) {
    const iamSim = this.iam.getSimulator();
    
    // Create role with CloudFront/S3 permissions
    const role = iamSim.createRole({
      RoleName: `cloudfront-${distributionId}`,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'cloudfront.amazonaws.com'
            },
            Action: 'sts:AssumeRole'
          }
        ]
      })
    });

    // Attach policy for S3 read access
    iamSim.putRolePolicy({
      RoleName: role.RoleName,
      PolicyName: 's3-read-policy',
      PolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:ListBucket'],
            Resource: [
              `arn:aws:s3:::${bucketName}`,
              `arn:aws:s3:::${bucketName}/*`
            ]
          }
        ]
      })
    });
  }
}

// Usage
(async () => {
  const setup = new FullStackCDN(config);
  await setup.initialize();

  const website = await setup.deployWebsite('mywebsite', [
    { key: 'index.html', body: '<html>...</html>' },
    { key: 'style.css', body: 'body { ... }' },
    { key: 'script.js', body: 'console.log(...);' }
  ]);

  console.log('Website deployed:');
  console.log(`  S3 Bucket: ${website.bucket}`);
  console.log(`  CloudFront Distribution: ${website.distribution}`);
  console.log(`  Domain: ${website.domainName}`);
})();
```

## Best Practices for Integration

1. **Dependency Injection**: Pass service instances rather than creating them internally
2. **Error Handling**: Always check if resources exist before operating on them
3. **Cleanup**: Remove distributions and associated resources when no longer needed
4. **Testing**: Mock integrated services for unit tests
5. **Monitoring**: Always publish metrics for observability
6. **Permissions**: Use IAM to enforce access control

## Troubleshooting Integration Issues

### CloudFront Can't Access S3 Bucket
- Verify bucket policy allows CloudFront access
- Check origin configuration matches bucket domain
- Ensure origin access identity is configured

### Metrics Not Appearing in CloudWatch
- Verify CloudWatch service is initialized
- Check metric namespace is correct
- Ensure metrics are being published with correct dimensions

### IAM Permissions Failing
- Verify role has appropriate trust relationship
- Check policy document syntax
- Ensure principal has required service permissions

## See Also

- [CLOUDFRONT_GUIDE.md](./CLOUDFRONT_GUIDE.md) - Complete CloudFront documentation
- [S3 Integration](../s3/INTEGRATION.md)
- [Lambda Integration](../lambda/INTEGRATION.md)
- [CloudWatch Integration](../cloudwatch/INTEGRATION.md)
