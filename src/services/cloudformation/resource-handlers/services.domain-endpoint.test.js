const { configurePublicBase } = require('../../../gateway/public-base');
const EnvLoader = require('@/config/env-loader');
const domain = require('./services')['AWS::OpenSearchService::Domain'];

const ENV_KEYS = ['AWS_ENDPOINT_URL', 'AWS_LOCAL_SIMULATOR_GATEWAY_PORT', 'AWS_LOCAL_SIMULATOR_LEGACY_PORTS'];
const env = { region: 'us-east-1', account: '000000000000', partition: 'aws' };

const createDomain = () => domain.create({
  logicalId: 'Dom',
  stackName: 'st',
  props: { DomainName: 'dom-a' },
  env,
  sims: {},
});

describe('AWS::OpenSearchService::Domain DomainEndpoint', () => {
  let saved;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    configurePublicBase();
  });

  test('uses the host of AWS_ENDPOINT_URL when it is set', async () => {
    process.env.AWS_ENDPOINT_URL = 'http://meu-host:4900';
    configurePublicBase(EnvLoader.loadGateway());

    const result = await createDomain();

    expect(result.attrs.DomainEndpoint).toBe('meu-host:4900');
    expect(result.attrs.Arn).toBe('arn:aws:es:us-east-1:000000000000:domain/dom-a');
    expect(result.attrs.DomainName).toBe('dom-a');
  });

  test('uses localhost on the gateway port when AWS_ENDPOINT_URL is not set', async () => {
    configurePublicBase({ port: 4711, endpointUrl: null });

    const result = await createDomain();

    expect(result.attrs.DomainEndpoint).toBe('localhost:4711');
    expect(result.attrs.Arn).toBe('arn:aws:es:us-east-1:000000000000:domain/dom-a');
    expect(result.attrs.DomainName).toBe('dom-a');
  });

  test('falls back to localhost:4700 when the gateway was never configured', async () => {
    configurePublicBase();

    const result = await createDomain();

    expect(result.attrs.DomainEndpoint).toBe('localhost:4700');
    expect(result.attrs.Arn).toBe('arn:aws:es:us-east-1:000000000000:domain/dom-a');
    expect(result.attrs.DomainName).toBe('dom-a');
  });
});
