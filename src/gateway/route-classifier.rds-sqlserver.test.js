const { classify, needsFormBody } = require('./route-classifier');

const noState = {
  bucketExists: () => false,
  apiExists: () => false,
};

const SIGNED_RDS = {
  authorization: 'AWS4-HMAC-SHA256 Credential=AKIDTEST/20250101/us-east-1/rds/aws4_request, SignedHeaders=host, Signature=abc',
  host: 'localhost:4700',
};

describe('roteamento do RDS SQL Server no gateway', () => {
  test('prefixo de caminho vence assinatura de escopo rds (que iria para aurora)', () => {
    const result = classify({
      method: 'POST',
      url: '/rds-sqlserver',
      headers: { ...SIGNED_RDS, 'content-type': 'application/x-www-form-urlencoded' },
      form: { Action: 'DescribeDBClusters', Version: '2014-10-31' },
    }, noState);

    expect(result).toMatchObject({ service: 'rds-sqlserver', rule: 'R0' });
  });

  test('prefixo de caminho vence X-Amz-Target RDSDataService', () => {
    const result = classify({
      method: 'POST',
      url: '/rds-sqlserver',
      headers: { 'x-amz-target': 'RDSDataService.ExecuteStatement', host: 'localhost:4700' },
    }, noState);

    expect(result).toMatchObject({ service: 'rds-sqlserver', rule: 'R0' });
  });

  test('prefixo de caminho com subpath também é roteado', () => {
    const result = classify({
      method: 'POST',
      url: '/rds-sqlserver/__admin/health',
      headers: { host: 'localhost:4700' },
    }, noState);

    expect(result).toMatchObject({ service: 'rds-sqlserver', rule: 'R0' });
  });

  test('não captura caminhos que apenas começam com o mesmo texto', () => {
    const result = classify({
      method: 'POST',
      url: '/rds-sqlserver-extra',
      headers: { host: 'localhost:4700' },
    }, noState);

    expect(result.service).toBeNull();
  });

  test('lê o corpo do formulário para descobrir Action quando há prefixo', () => {
    expect(needsFormBody({
      url: '/rds-sqlserver',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })).toBe(true);
  });
});
