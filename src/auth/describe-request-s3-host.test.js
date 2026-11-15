const { describeRequest } = require('./auth-context');
const { bucketFromHost } = require('../services/s3/host-bucket');

function s3Request({ method = 'GET', path, host, query = {} }) {
  return { method, path, query, headers: host ? { host } : {}, body: undefined };
}

describe('S3 authorization target with virtual-hosted Host (D2)', () => {
  test('bucket comes from the Host and the path is the key', () => {
    expect(describeRequest('s3', s3Request({ path: '/chave', host: 'bucket.localhost:4700' }))).toEqual({
      action: 's3:GetObject',
      resource: 'arn:aws:s3:::bucket/chave',
    });
  });

  test('a nested key keeps its slashes', () => {
    expect(describeRequest('s3', s3Request({ path: '/pasta/sub/x.txt', host: 'bucket.localhost:4700' })).resource)
      .toBe('arn:aws:s3:::bucket/pasta/sub/x.txt');
  });

  test('root of a virtual-hosted bucket is a bucket-level action', () => {
    expect(describeRequest('s3', s3Request({ path: '/', host: 'bucket.localhost:4700' }))).toEqual({
      action: 's3:ListBucket',
      resource: 'arn:aws:s3:::bucket',
    });
  });

  test('path-style request is unchanged', () => {
    expect(describeRequest('s3', s3Request({ path: '/bucket/chave', host: 'localhost:4700' }))).toEqual({
      action: 's3:GetObject',
      resource: 'arn:aws:s3:::bucket/chave',
    });
  });

  test('PUT on a virtual-hosted key is PutObject on the Host bucket', () => {
    expect(describeRequest('s3', s3Request({ method: 'PUT', path: '/novo.txt', host: 'bucket.localhost:4700' }))).toEqual({
      action: 's3:PutObject',
      resource: 'arn:aws:s3:::bucket/novo.txt',
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
    [undefined, null],
  ])('Host %p gives bucket %p', (host, expected) => {
    expect(bucketFromHost(host)).toBe(expected);
  });
});
