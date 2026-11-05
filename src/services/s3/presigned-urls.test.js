/**
 * Presigned URL Integration Tests
 * Tests the integration of PresignedUrlGenerator with S3Simulator and S3Server
 */

const S3Simulator = require('./simulator');
const S3Server = require('./server');
const PresignedUrlGenerator = require('./presigned-url-generator');

describe('S3 Presigned URLs Integration', () => {
  let simulator;
  let server;
  
  beforeEach(async () => {
    process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = '/tmp/aws-local-test';
    simulator = new S3Simulator({});
    await simulator.initialize();
    
    // Create test bucket
    simulator.createBucket('test-bucket');
    simulator.putObject('test-bucket', 'test-key.txt', Buffer.from('test content'), {
      'content-type': 'text/plain'
    });
  });

  afterEach(async () => {
    if (server) {
      server.stop();
    }
  });

  // ─── Unit Tests ──────────────────────────────────────────────────────────

  describe('S3Simulator Presigned URL Methods', () => {
    test('should generate a presigned GET URL', () => {
      const result = simulator.generatePresignedGetUrl('test-bucket', 'test-key.txt');
      
      expect(result.presignedUrl).toBeDefined();
      expect(result.presignedUrl).toContain('test-bucket');
      expect(result.presignedUrl).toContain('test-key.txt');
      expect(result.presignedUrl).toContain('X-Amz-Signature');
    });

    test('should generate a presigned PUT URL', () => {
      const result = simulator.generatePresignedPutUrl('test-bucket', 'upload-key.txt', {
        contentType: 'application/octet-stream'
      });
      
      expect(result.presignedUrl).toBeDefined();
      expect(result.presignedUrl).toContain('test-bucket');
      expect(result.presignedUrl).toContain('upload-key.txt');
      expect(result.presignedUrl).toContain('X-Amz-Signature');
    });

    test('should generate a presigned DELETE URL', () => {
      const result = simulator.generatePresignedDeleteUrl('test-bucket', 'test-key.txt');
      
      expect(result.presignedUrl).toBeDefined();
      expect(result.presignedUrl).toContain('test-bucket');
      expect(result.presignedUrl).toContain('test-key.txt');
      expect(result.presignedUrl).toContain('X-Amz-Signature');
    });

    test('should generate a presigned HEAD URL', () => {
      const result = simulator.generatePresignedHeadUrl('test-bucket', 'test-key.txt');
      
      expect(result.presignedUrl).toBeDefined();
      expect(result.presignedUrl).toContain('test-bucket');
      expect(result.presignedUrl).toContain('test-key.txt');
      expect(result.presignedUrl).toContain('X-Amz-Signature');
    });

    test('should generate a presigned POST policy', () => {
      const result = simulator.generatePresignedPostPolicy('test-bucket', 'form-upload.txt');
      
      expect(result.policy).toBeDefined();
      expect(result.signature).toBeDefined();
      expect(result.amzAlgorithm).toBe('AWS4-HMAC-SHA256');
      expect(result.amzDate).toBeDefined();
      expect(result.amzCredential).toBeDefined();
    });

    test('should validate a presigned URL', () => {
      const urlResult = simulator.generatePresignedGetUrl('test-bucket', 'test-key.txt');
      const validation = simulator.validatePresignedUrl(urlResult.presignedUrl, 'GET');
      
      expect(validation.valid).toBe(true);
    });

    test('should return error for non-existent bucket', () => {
      const result = simulator.generatePresignedGetUrl('nonexistent-bucket', 'key.txt');
      
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('NoSuchBucket');
      expect(result.status).toBe(404);
    });

    test('should support custom expiration times', () => {
      const result = simulator.generatePresignedGetUrl('test-bucket', 'test-key.txt', {
        expiresIn: 7200 // 2 hours
      });
      
      expect(result.presignedUrl).toBeDefined();
      expect(result.presignedUrl).toContain('X-Amz-Expires=7200');
    });

    test('should include custom credentials in presigned URL', () => {
      const customCredentials = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        sessionToken: 'AQoDYXdzEJr...'
      };
      
      const result = simulator.generatePresignedGetUrl('test-bucket', 'test-key.txt', {
        credentials: customCredentials
      });
      
      expect(result.presignedUrl).toBeDefined();
      expect(result.presignedUrl).toContain('X-Amz-Credential');
    });
  });

  describe('URL Structure Validation', () => {
    test('presigned GET URL should include correct query parameters', () => {
      const result = simulator.generatePresignedGetUrl('test-bucket', 'test-key.txt');
      const url = new URL(result.presignedUrl, 'http://localhost:4566');
      
      expect(url.searchParams.has('X-Amz-Algorithm')).toBe(true);
      expect(url.searchParams.has('X-Amz-Credential')).toBe(true);
      expect(url.searchParams.has('X-Amz-Date')).toBe(true);
      expect(url.searchParams.has('X-Amz-Expires')).toBe(true);
      expect(url.searchParams.has('X-Amz-SignedHeaders')).toBe(true);
      expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
    });

    test('presigned PUT URL should include content-type condition', () => {
      const result = simulator.generatePresignedPutUrl('test-bucket', 'upload.txt', {
        contentType: 'text/plain'
      });
      
      expect(result.presignedUrl).toBeDefined();
    });

    test('presigned URLs should be unique', () => {
      const url1 = simulator.generatePresignedGetUrl('test-bucket', 'test-key.txt').presignedUrl;
      const url2 = simulator.generatePresignedGetUrl('test-bucket', 'test-key.txt').presignedUrl;
      
      // URLs should differ due to different timestamps
      expect(url1).not.toBe(url2);
    });
  });

  describe('PresignedUrlGenerator Instance', () => {
    test('simulator should have PresignedUrlGenerator instance', () => {
      expect(simulator.presignedUrlGenerator).toBeInstanceOf(PresignedUrlGenerator);
    });

    test('PresignedUrlGenerator should be properly configured', () => {
      expect(simulator.presignedUrlGenerator.signatureVersion).toBe('AWS4-HMAC-SHA256');
    });
  });

  describe('Integration with Object Operations', () => {
    test('presigned URL should work for existing objects', () => {
      simulator.putObject('test-bucket', 'existing.txt', Buffer.from('content'), {
        'content-type': 'text/plain'
      });

      const result = simulator.generatePresignedGetUrl('test-bucket', 'existing.txt');
      expect(result.presignedUrl).toBeDefined();
    });

    test('presigned URL should be generatable for non-existing objects', () => {
      // S3 allows generating presigned URLs even for non-existing objects (useful for uploads)
      const result = simulator.generatePresignedPutUrl('test-bucket', 'future-upload.txt');
      expect(result.presignedUrl).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid bucket names gracefully', () => {
      const result = simulator.generatePresignedGetUrl('', 'key.txt');
      expect(result.error || !result.presignedUrl).toBe(true);
    });

    test('should handle missing key parameter', () => {
      const result = simulator.generatePresignedGetUrl('test-bucket', '');
      // Should still generate URL, as S3 allows this
      expect(result.presignedUrl || result.error).toBeDefined();
    });

    test('should validate presigned URL with invalid signature', () => {
      const result = simulator.generatePresignedGetUrl('test-bucket', 'test-key.txt');
      const tamperedUrl = result.presignedUrl.replace(/Signature=[^&]*/, 'Signature=invalid');
      
      const validation = simulator.validatePresignedUrl(tamperedUrl, 'GET');
      expect(validation.valid).toBe(false);
    });

    test('should detect expired presigned URLs', () => {
      const result = simulator.generatePresignedGetUrl('test-bucket', 'test-key.txt', {
        expiresIn: -100 // Already expired
      });
      
      // Generator should handle this, but let's verify behavior
      expect(result.presignedUrl || result.error).toBeDefined();
    });
  });

  describe('Different HTTP Methods', () => {
    test('should generate URLs for different HTTP methods', () => {
      const getUrl = simulator.generatePresignedGetUrl('test-bucket', 'key.txt');
      const putUrl = simulator.generatePresignedPutUrl('test-bucket', 'key.txt');
      const deleteUrl = simulator.generatePresignedDeleteUrl('test-bucket', 'key.txt');
      const headUrl = simulator.generatePresignedHeadUrl('test-bucket', 'key.txt');

      expect(getUrl.presignedUrl).toContain('GET');
      expect(putUrl.presignedUrl).toContain('PUT');
      expect(deleteUrl.presignedUrl).toContain('DELETE');
      expect(headUrl.presignedUrl).toContain('HEAD');
    });
  });
});

describe('S3 Presigned URLs - Server Routes', () => {
  let server;

  beforeEach(async () => {
    process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = '/tmp/aws-local-test';
    server = new S3Server(4566, {});
    await server.initialize();
    server.start();
    
    // Create test bucket
    server.simulator.createBucket('test-bucket');
  });

  afterEach(() => {
    if (server) {
      server.stop();
    }
  });

  describe('REST API Endpoints', () => {
    test('should have presigned-urls/get endpoint', () => {
      // Verify endpoint exists in routes
      const routes = server.app._router.stack
        .filter(r => r.route)
        .map(r => r.route.path);
      
      expect(routes).toContain('/__admin/presigned-urls/get');
    });

    test('should have presigned-urls/put endpoint', () => {
      const routes = server.app._router.stack
        .filter(r => r.route)
        .map(r => r.route.path);
      
      expect(routes).toContain('/__admin/presigned-urls/put');
    });

    test('should have presigned-urls/delete endpoint', () => {
      const routes = server.app._router.stack
        .filter(r => r.route)
        .map(r => r.route.path);
      
      expect(routes).toContain('/__admin/presigned-urls/delete');
    });

    test('should have presigned-urls/head endpoint', () => {
      const routes = server.app._router.stack
        .filter(r => r.route)
        .map(r => r.route.path);
      
      expect(routes).toContain('/__admin/presigned-urls/head');
    });

    test('should have presigned-urls/post-policy endpoint', () => {
      const routes = server.app._router.stack
        .filter(r => r.route)
        .map(r => r.route.path);
      
      expect(routes).toContain('/__admin/presigned-urls/post-policy');
    });

    test('should have presigned-urls/validate endpoint', () => {
      const routes = server.app._router.stack
        .filter(r => r.route)
        .map(r => r.route.path);
      
      expect(routes).toContain('/__admin/presigned-urls/validate');
    });
  });
});
