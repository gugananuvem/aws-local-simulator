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

describe('route classifier: servicos core (dynamodb, s3, lambda, apigateway, sqs, sns)', () => {
  test('dynamodb ListTables via X-Amz-Target roteia por R1', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: { 'x-amz-target': 'DynamoDB_20120810.ListTables', host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'dynamodb', rule: 'R1' });
  });

  test('s3 assinado com escopo s3 roteia por R2', () => {
    const result = classify({
      method: 'GET',
      url: '/',
      headers: SIGNED('s3'),
    }, noState);
    expect(result).toMatchObject({ service: 's3', rule: 'R2' });
  });

  test('s3 path-style sem assinatura roteia por R5a quando o bucket existe', () => {
    const result = classify({
      method: 'GET',
      url: '/my-demo-bucket/x',
      headers: { host: 'localhost:4700' },
    }, { ...noState, bucketExists: (name) => name === 'my-demo-bucket' });
    expect(result).toMatchObject({ service: 's3', rule: 'R5a' });
  });

  test('s3 virtual-hosted roteia por R6 quando o bucket existe', () => {
    const result = classify({
      method: 'GET',
      url: '/',
      headers: { host: 'my-demo-bucket.localhost:4700' },
    }, { ...noState, bucketExists: (name) => name === 'my-demo-bucket' });
    expect(result).toMatchObject({ service: 's3', rule: 'R6' });
  });

  test('s3 virtual-hosted com bucket inexistente cai em UnknownService', () => {
    const result = classify({
      method: 'GET',
      url: '/',
      headers: { host: 'my-demo-bucket.localhost:4700' },
    }, noState);
    expect(result.service).toBeNull();
    expect(result.error.code).toBe('UnknownService');
  });

  test('lambda assinado com escopo lambda roteia por R2', () => {
    const result = classify({
      method: 'GET',
      url: '/2015-03-31/functions',
      headers: SIGNED('lambda'),
    }, noState);
    expect(result).toMatchObject({ service: 'lambda', rule: 'R2' });
  });

  test.each([
    ['GET', '/2015-03-31/functions'],
    ['GET', '/2018-10-31/layers'],
    ['GET', '/2015-03-31/event-source-mappings'],
    ['POST', '/2015-03-31/functions/minha-funcao/invocations'],
  ])('lambda %s %s sem assinatura roteia por R4', (method, url) => {
    const result = classify({
      method,
      url,
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'lambda', rule: 'R4' });
  });

  test('apigateway assinado com escopo apigateway roteia por R2', () => {
    const result = classify({
      method: 'GET',
      url: '/restapis',
      headers: SIGNED('apigateway'),
    }, noState);
    expect(result).toMatchObject({ service: 'apigateway', rule: 'R2' });
  });

  test('apigateway GET /restapis sem assinatura roteia por R4', () => {
    const result = classify({
      method: 'GET',
      url: '/restapis',
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'apigateway', rule: 'R4' });
  });

  test('apigateway de execucao roteia por R5b quando a API existe', () => {
    const result = classify({
      method: 'GET',
      url: '/abc123/dev/users',
      headers: { host: 'localhost:4700' },
    }, { ...noState, apiExists: (id) => id === 'abc123' });
    expect(result).toMatchObject({ service: 'apigateway', rule: 'R5b' });
  });

  test('sqs CreateQueue via X-Amz-Target roteia por R1', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: { 'x-amz-target': 'AmazonSQS.CreateQueue', host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'sqs', rule: 'R1' });
  });

  test('sqs assinado com escopo sqs roteia por R2', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: SIGNED('sqs'),
    }, noState);
    expect(result).toMatchObject({ service: 'sqs', rule: 'R2' });
  });

  test('sqs GetQueueUrl pela query roteia por R3', () => {
    const result = classify({
      method: 'GET',
      url: '/?Action=GetQueueUrl&Version=2012-11-05',
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'sqs', rule: 'R3' });
  });

  test('sqs por caminho /queue/ roteia por R4', () => {
    const result = classify({
      method: 'GET',
      url: '/queue/minha-fila',
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'sqs', rule: 'R4' });
  });

  test('sns assinado com escopo sns e corpo de formulario roteia por R2', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: {
        ...SIGNED('sns'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      form: { Action: 'ListTopics', Version: '2010-03-31' },
    }, noState);
    expect(result).toMatchObject({ service: 'sns', rule: 'R2' });
  });

  test('sns ListTopics pela query roteia por R3', () => {
    const result = classify({
      method: 'GET',
      url: '/?Action=ListTopics&Version=2010-03-31',
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'sns', rule: 'R3' });
  });

  test('sns /__admin/topics sem assinatura nao roteia pelo gateway (UnknownService)', () => {
    const result = classify({
      method: 'GET',
      url: '/__admin/topics',
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result.service).toBeNull();
    expect(result.error.code).toBe('UnknownService');
  });
});
