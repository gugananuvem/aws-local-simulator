const { publicBaseUrl, configurePublicBase } = require('./public-base');

describe('publicBaseUrl', () => {
  afterEach(() => configurePublicBase({ port: 4700, endpointUrl: null }));

  test('uses the Host of the request when AWS_ENDPOINT_URL is not set', () => {
    configurePublicBase({ port: 4700, endpointUrl: null });
    expect(publicBaseUrl({ headers: { host: '192.168.0.10:4700' } })).toBe('http://192.168.0.10:4700');
  });

  test('AWS_ENDPOINT_URL wins over the Host of the request', () => {
    configurePublicBase({ port: 4700, endpointUrl: 'http://meu-host:4700/' });
    expect(publicBaseUrl({ headers: { host: '192.168.0.10:4700' } })).toBe('http://meu-host:4700');
  });

  test('without a request, falls back to localhost on the gateway port', () => {
    configurePublicBase({ port: 4711, endpointUrl: null });
    expect(publicBaseUrl()).toBe('http://localhost:4711');
  });
});
