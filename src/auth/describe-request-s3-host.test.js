const { describeRequest } = require('./auth-context');
const { bucketFromHost, virtualHostBucket } = require('../services/s3/host-bucket');

function s3Request({ method = 'GET', path, host, query = {} }) {
  return { method, path, query, headers: host ? { host } : {}, body: undefined };
}

const bucketExists = (name) => name === 'bucket';

describe('S3 authorization target with virtual-hosted Host (D2)', () => {
  test('bucket comes from the Host and the path is the key', () => {
    expect(describeRequest('s3', s3Request({ path: '/chave', host: 'bucket.localhost:4700' }), bucketExists)).toEqual({
      action: 's3:GetObject',
      resource: 'arn:aws:s3:::bucket/chave',
    });
  });

  test('a nested key keeps its slashes', () => {
    expect(describeRequest('s3', s3Request({ path: '/pasta/sub/x.txt', host: 'bucket.localhost:4700' }), bucketExists).resource)
      .toBe('arn:aws:s3:::bucket/pasta/sub/x.txt');
  });

  test('root of a virtual-hosted bucket is a bucket-level action', () => {
    expect(describeRequest('s3', s3Request({ path: '/', host: 'bucket.localhost:4700' }), bucketExists)).toEqual({
      action: 's3:ListBucket',
      resource: 'arn:aws:s3:::bucket',
    });
  });

  test('path-style request is unchanged', () => {
    expect(describeRequest('s3', s3Request({ path: '/bucket/chave', host: 'localhost:4700' }), bucketExists)).toEqual({
      action: 's3:GetObject',
      resource: 'arn:aws:s3:::bucket/chave',
    });
  });

  test('PUT on a virtual-hosted key is PutObject on the Host bucket', () => {
    expect(describeRequest('s3', s3Request({ method: 'PUT', path: '/novo.txt', host: 'bucket.localhost:4700' }), bucketExists)).toEqual({
      action: 's3:PutObject',
      resource: 'arn:aws:s3:::bucket/novo.txt',
    });
  });

  test('IPv4 Host is never virtual-hosted: the bucket comes from the path', () => {
    expect(describeRequest('s3', s3Request({ path: '/bucket/chave', host: '192.168.0.10:4700' }), bucketExists)).toEqual({
      action: 's3:GetObject',
      resource: 'arn:aws:s3:::bucket/chave',
    });
  });

  test('Host label that is not an existing bucket does not change the target', () => {
    expect(describeRequest('s3', s3Request({ path: '/bucket/chave', host: 'outro.example.test:4700' }), bucketExists)).toEqual({
      action: 's3:GetObject',
      resource: 'arn:aws:s3:::bucket/chave',
    });
  });
});

describe('bucketFromHost', () => {
  test.each([
    ['bucket.localhost:4700', 'bucket'],
    ['meu.bucket.localhost', 'meu'],
    ['localhost:4700', null],
    ['127.0.0.1:4700', null],
    ['localhost', null],
    ['192.168.0.10:4700', null],
    ['10.0.0.1', null],
    ['host.docker.internal:4700', 'host'],
    [undefined, null],
  ])('Host %p gives bucket %p', (host, expected) => {
    expect(bucketFromHost(host)).toBe(expected);
  });
});

describe('virtualHostBucket', () => {
  test('returns the Host label only when it is an existing bucket', () => {
    expect(virtualHostBucket('bucket.localhost:4700', bucketExists)).toBe('bucket');
    expect(virtualHostBucket('outro.localhost:4700', bucketExists)).toBeNull();
  });

  test('an IPv4 Host never returns a bucket, even if a bucket named like the first octet exists', () => {
    expect(virtualHostBucket('192.168.0.10:4700', () => true)).toBeNull();
  });
});
