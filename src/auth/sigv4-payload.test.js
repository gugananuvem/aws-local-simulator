const crypto = require('crypto');
const { verifySignature } = require('./sigv4');
const { AuthError } = require('./auth-context');

const NOW = Date.parse('2025-01-01T00:00:00Z');
const AUTHORIZATION =
  'AWS4-HMAC-SHA256 Credential=AKIDTEST/20250101/us-east-1/sqs/aws4_request, ' +
  'SignedHeaders=host;x-amz-date, Signature=' + '0'.repeat(64);
const BODY = Buffer.from('{"QueueName":"fila"}');

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// A assinatura abaixo nao e valida de proposito: os testes conferem so a etapa do hash do corpo,
// que roda antes da comparacao da assinatura.
function check(extraHeaders, body = BODY) {
  return verifySignature({
    method: 'POST',
    rawPath: '/',
    rawQuery: '',
    headers: { host: 'localhost:4700', 'x-amz-date': '20250101T000000Z', ...extraHeaders },
    body,
    authorization: AUTHORIZATION,
    secretAccessKey: 'secret',
    now: NOW,
  });
}

describe('SigV4 payload hash (x-amz-content-sha256)', () => {
  test('a literal hash that does not match the body is rejected', () => {
    const result = check({ 'x-amz-content-sha256': sha256Hex('outro corpo') });
    expect(result).toEqual({ ok: false, code: 'XAmzContentSHA256Mismatch' });
  });

  test('a literal hash that matches the body continues to the signature check', () => {
    const result = check({ 'x-amz-content-sha256': sha256Hex(BODY) });
    expect(result).toEqual({ ok: false, code: 'SignatureDoesNotMatch' });
  });

  test('UNSIGNED-PAYLOAD is not compared with the body', () => {
    const result = check({ 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' });
    expect(result.code).toBe('SignatureDoesNotMatch');
  });

  test('STREAMING payload markers are not compared with the body', () => {
    const result = check({ 'x-amz-content-sha256': 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD' });
    expect(result.code).toBe('SignatureDoesNotMatch');
  });

  test('without the header, the body hash is computed and used', () => {
    const result = check({});
    expect(result.code).toBe('SignatureDoesNotMatch');
  });

  test('a mismatch is answered with HTTP 400, other auth errors with 403', () => {
    expect(new AuthError('XAmzContentSHA256Mismatch').status).toBe(400);
    expect(new AuthError('SignatureDoesNotMatch').status).toBe(403);
  });

  test('query-string authentication errors have a message', () => {
    const error = new AuthError('AuthorizationQueryParametersError');
    expect(error.message).toMatch(/X-Amz-Credential/);
  });
});
