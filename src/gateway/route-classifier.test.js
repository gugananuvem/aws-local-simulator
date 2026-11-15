const {
  classify,
  needsFormBody,
  TARGET_PREFIXES,
  SCOPE_SERVICES,
  VERSION_SERVICES,
  PATH_PREFIXES,
} = require('./route-classifier');

const SIGNED = (scope) => ({
  authorization: `AWS4-HMAC-SHA256 Credential=AKIDTEST/20250101/us-east-1/${scope}/aws4_request, SignedHeaders=host, Signature=abc`,
  host: 'localhost:4700',
});

const noState = {
  bucketExists: () => false,
  apiExists: () => false,
};

describe('route classifier', () => {
  describe('R1: X-Amz-Target', () => {
    test.each(Object.entries(TARGET_PREFIXES))('prefix %s routes to %s', (prefix, service) => {
      const result = classify({
        method: 'POST',
        url: '/',
        headers: { 'x-amz-target': `${prefix}Operation`, host: 'localhost:4700' },
      }, noState);
      expect(result).toMatchObject({ service, rule: 'R1' });
    });

    test('DynamoDB Streams target has no route (not handled by the dynamodb server)', () => {
      const result = classify({
        method: 'POST',
        url: '/',
        headers: { 'x-amz-target': 'DynamoDBStreams_20120810.ListStreams', host: 'localhost:4700' },
      }, noState);
      expect(result.service).toBeNull();
    });

    test('target wins over a different credential scope', () => {
      const result = classify({
        method: 'POST',
        url: '/',
        headers: { ...SIGNED('sqs'), 'x-amz-target': 'TrentService.CreateKey' },
      }, noState);
      expect(result).toMatchObject({ service: 'kms', rule: 'R1' });
    });
  });

  describe('R2: credential scope', () => {
    test.each(Object.entries(SCOPE_SERVICES))('scope %s in Authorization routes to %s', (scope, service) => {
      const result = classify({
        method: 'GET',
        url: '/anything',
        headers: SIGNED(scope),
      }, noState);
      expect(result).toMatchObject({ service, rule: 'R2' });
    });

    test('presigned URL scope in X-Amz-Credential routes by scope', () => {
      const credential = encodeURIComponent('AKIDTEST/20250101/us-east-1/s3/aws4_request');
      const result = classify({
        method: 'GET',
        url: `/bucket/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${credential}`,
        headers: { host: 'localhost:4700' },
      }, noState);
      expect(result).toMatchObject({ service: 's3', rule: 'R2' });
    });

    test('scope wins over a path that would match a REST prefix', () => {
      const result = classify({
        method: 'GET',
        url: '/restapis',
        headers: SIGNED('s3'),
      }, noState);
      expect(result).toMatchObject({ service: 's3', rule: 'R2' });
    });

    test('unknown scope falls through to the next rules', () => {
      const result = classify({
        method: 'GET',
        url: '/restapis',
        headers: SIGNED('unknown-service'),
      }, noState);
      expect(result).toMatchObject({ service: 'apigateway', rule: 'R4' });
    });
  });

  describe('R3: query protocol Action + Version', () => {
    test.each(Object.entries(VERSION_SERVICES))('version %s routes to %s (query string)', (version, service) => {
      const result = classify({
        method: 'GET',
        url: `/?Action=Something&Version=${version}`,
        headers: { host: 'localhost:4700' },
      }, noState);
      expect(result).toMatchObject({ service, rule: 'R3' });
    });

    test('Action and Version in the form body route to the service', () => {
      const result = classify({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'localhost:4700' },
        form: { Action: 'ListTopics', Version: '2010-03-31' },
      }, noState);
      expect(result).toMatchObject({ service: 'sns', rule: 'R3' });
    });

    test('unknown Version does not match', () => {
      const result = classify({
        method: 'GET',
        url: '/?Action=Something&Version=1999-01-01',
        headers: { host: 'localhost:4700' },
      }, noState);
      expect(result.service).toBeNull();
      expect(result.error.code).toBe('UnknownService');
    });

    test('Version without Action does not match', () => {
      const result = classify({
        method: 'GET',
        url: '/?Version=2012-11-05',
        headers: { host: 'localhost:4700' },
      }, noState);
      expect(result.service).toBeNull();
    });
  });

  describe('R4: URL path prefix', () => {
    test.each(PATH_PREFIXES.map((p) => [p.prefix, p.service]))('path prefix %s routes to %s', (prefix, service) => {
      const path = prefix.endsWith('/') ? `${prefix}x` : `${prefix}/x`;
      const result = classify({
        method: 'GET',
        url: path,
        headers: { host: 'localhost:4700' },
      }, noState);
      expect(result).toMatchObject({ service, rule: 'R4' });
    });

    test('prefix must match a whole segment', () => {
      const result = classify({
        method: 'GET',
        url: '/apisomething',
        headers: { host: 'localhost:4700' },
      }, noState);
      expect(result.service).toBeNull();
    });
  });

  describe('R5: unsigned request without target', () => {
    test('R5a: first path segment is an existing bucket routes to s3 (path-style)', () => {
      const result = classify({
        method: 'GET',
        url: '/meu-bucket/arquivo.txt',
        headers: { host: 'localhost:4700' },
      }, { bucketExists: (name) => name === 'meu-bucket', apiExists: () => false });
      expect(result).toMatchObject({ service: 's3', rule: 'R5a' });
    });

    test('R5a does not match a bucket that does not exist', () => {
      const result = classify({
        method: 'GET',
        url: '/meu-bucket/arquivo.txt',
        headers: { host: 'localhost:4700' },
      }, noState);
      expect(result.service).toBeNull();
      expect(result.error).toMatchObject({ status: 400, code: 'UnknownService' });
    });

    test('R5b: /{apiId}/{stage}/... with an existing API routes to apigateway', () => {
      const result = classify({
        method: 'GET',
        url: '/abc123/dev/pets',
        headers: { host: 'localhost:4700' },
      }, { bucketExists: () => false, apiExists: (id) => id === 'abc123' });
      expect(result).toMatchObject({ service: 'apigateway', rule: 'R5b' });
    });

    test('R5 does not apply to signed requests', () => {
      const result = classify({
        method: 'GET',
        url: '/meu-bucket/arquivo.txt',
        headers: { ...SIGNED('unknown-service') },
      }, { bucketExists: () => true, apiExists: () => false });
      expect(result.service).toBeNull();
    });
  });

  describe('R6: virtual-hosted bucket in Host', () => {
    test('Host bucket.localhost:4700 with an existing bucket routes to s3', () => {
      const result = classify({
        method: 'GET',
        url: '/chave.txt',
        headers: { host: 'bucket.localhost:4700' },
      }, { bucketExists: (name) => name === 'bucket', apiExists: () => false });
      expect(result).toMatchObject({ service: 's3', rule: 'R6' });
    });

    test('Host bucket.localhost:4700 with a missing bucket does not match', () => {
      const result = classify({
        method: 'GET',
        url: '/chave.txt',
        headers: { host: 'bucket.localhost:4700' },
      }, noState);
      expect(result.service).toBeNull();
    });

    test('Host localhost:4700 does not match R6', () => {
      const result = classify({
        method: 'GET',
        url: '/bucket/chave.txt',
        headers: { host: 'localhost:4700' },
      }, { bucketExists: () => true, apiExists: () => false });
      expect(result).toMatchObject({ service: 's3', rule: 'R5a' });

      const noBucket = classify({
        method: 'GET',
        url: '/chave.txt',
        headers: { host: 'localhost:4700' },
      }, { bucketExists: (name) => name === 'bucket', apiExists: () => false });
      expect(noBucket.service).toBeNull();
    });
  });

  describe('unrecognized request', () => {
    test('returns 400 UnknownService with the documented message', () => {
      const result = classify({
        method: 'GET',
        url: '/health',
        headers: { host: 'localhost:4700' },
      }, noState);
      expect(result.service).toBeNull();
      expect(result.error.status).toBe(400);
      expect(result.error.code).toBe('UnknownService');
      expect(result.error.message).toMatch(/could not route request/);
    });
  });

  describe('needsFormBody', () => {
    test('true for a form body with no target, no scope and no Action in the query', () => {
      expect(needsFormBody({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })).toBe(true);
    });

    test('false when a target, a known scope or an Action in the query is present', () => {
      const form = { 'content-type': 'application/x-www-form-urlencoded' };
      expect(needsFormBody({ method: 'POST', url: '/', headers: { ...form, 'x-amz-target': 'AmazonSQS.X' } })).toBe(false);
      expect(needsFormBody({ method: 'POST', url: '/', headers: { ...form, ...SIGNED('sqs') } })).toBe(false);
      expect(needsFormBody({ method: 'POST', url: '/?Action=X', headers: form })).toBe(false);
    });

    test('false for non-form content types', () => {
      expect(needsFormBody({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' } })).toBe(false);
    });
  });
});
