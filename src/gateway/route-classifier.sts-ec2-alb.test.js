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

describe('route classifier: sts, ec2 e alb', () => {
  test('sts GetCallerIdentity assinado com escopo sts roteia por R2', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: {
        ...SIGNED('sts'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      form: { Action: 'GetCallerIdentity', Version: '2011-06-15' },
    }, noState);
    expect(result).toMatchObject({ service: 'sts', rule: 'R2' });
  });

  test('sts GetCallerIdentity sem assinatura roteia por R3 (Action e Version na query)', () => {
    const result = classify({
      method: 'GET',
      url: '/?Action=GetCallerIdentity&Version=2011-06-15',
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'sts', rule: 'R3' });
  });

  test('ec2 DescribeVpcs assinado com escopo ec2 roteia por R2', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: {
        ...SIGNED('ec2'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      form: { Action: 'DescribeVpcs', Version: '2016-11-15' },
    }, noState);
    expect(result).toMatchObject({ service: 'ec2', rule: 'R2' });
  });

  test('ec2 DescribeVpcs sem assinatura roteia por R3 (Action e Version na query)', () => {
    const result = classify({
      method: 'GET',
      url: '/?Action=DescribeVpcs&Version=2016-11-15',
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'ec2', rule: 'R3' });
  });

  test('alb DescribeLoadBalancers assinado com escopo elasticloadbalancing roteia por R2', () => {
    const result = classify({
      method: 'POST',
      url: '/',
      headers: {
        ...SIGNED('elasticloadbalancing'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      form: { Action: 'DescribeLoadBalancers', Version: '2015-12-01' },
    }, noState);
    expect(result).toMatchObject({ service: 'alb', rule: 'R2' });
  });

  test('alb DescribeLoadBalancers sem assinatura roteia por R3 (Action e Version na query)', () => {
    const result = classify({
      method: 'GET',
      url: '/?Action=DescribeLoadBalancers&Version=2015-12-01',
      headers: { host: 'localhost:4700' },
    }, noState);
    expect(result).toMatchObject({ service: 'alb', rule: 'R3' });
  });
});
