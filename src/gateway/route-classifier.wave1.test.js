const { classify } = require('./route-classifier');

// Credencial falsa: o classificador lê só o escopo do Authorization.
const SIGNED = (scope) => ({
  authorization: `AWS4-HMAC-SHA256 Credential=test/20260101/us-east-1/${scope}/aws4_request, SignedHeaders=host, Signature=abc`,
  host: 'localhost:4700',
});

const noState = {
  bucketExists: () => false,
  apiExists: () => false,
};

describe('route classifier: onda 1 (iam, kms, secret-manager, parameter-store, cloudtrail)', () => {
  test('iam ListUsers assinado com escopo iam roteia por R2', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: {
        ...SIGNED('iam'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      form: { Action: 'ListUsers', Version: '2010-05-08' },
    }, noState);
    expect(result).toMatchObject({ service: 'iam', rule: 'R2' });
  });

  test('iam ListUsers sem assinatura roteia por R3 (Action e Version na query)', () => {
    const result = classify({
      method: 'GET',
      url: '/?Action=ListUsers&Version=2010-05-08',
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'iam', rule: 'R3' });
  });

  test('kms ListKeys via X-Amz-Target roteia por R1', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: { 'x-amz-target': 'TrentService.ListKeys', host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'kms', rule: 'R1' });
  });

  test('secret-manager ListSecrets via X-Amz-Target roteia por R1', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: { 'x-amz-target': 'secretsmanager.ListSecrets', host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'secret-manager', rule: 'R1' });
  });

  test('parameter-store DescribeParameters via X-Amz-Target roteia por R1', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: { 'x-amz-target': 'AmazonSSM.DescribeParameters', host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'parameter-store', rule: 'R1' });
  });

  test('cloudtrail DescribeTrails via X-Amz-Target roteia por R1', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: {
        'x-amz-target': 'com.amazonaws.cloudtrail.v20131101.DescribeTrails',
        host: 'localhost:4700',
      },
    }, noState);
    expect(result).toMatchObject({ service: 'cloudtrail', rule: 'R1' });
  });

  test('X-Amz-Target do secret-manager vence escopo sts da assinatura', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: { ...SIGNED('sts'), 'x-amz-target': 'secretsmanager.ListSecrets' },
    }, noState);
    expect(result).toMatchObject({ service: 'secret-manager', rule: 'R1' });
  });
});
