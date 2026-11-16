/**
 * GET /2015-03-31/functions (ListFunctions): resposta 200 com Functions e
 * NextMarker, e 400 ValidationException para MaxItems inválido.
 */
const http = require('http');
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  verboso: jest.fn(),
}));
const LambdaServer = require('./server');
const { toFunctionConfiguration } = require('./list-functions');

jest.setTimeout(10000);

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('timeout', () => req.destroy(new Error('requisição pendurada (timeout)')));
    req.on('error', reject);
    req.end();
  });
}

describe('Lambda server - ListFunctions', () => {
  let server;
  let httpServer;
  let port;

  beforeAll(async () => {
    const entries = ['beta', 'alpha', 'gamma'].map((name) => ({
      name,
      runtime: 'nodejs18.x',
      handlerName: 'index.handler',
      timeout: 3,
      memorySize: 128,
      codeSize: 1,
      registeredAt: '2025-01-01T00:00:00.000Z',
    }));
    server = new LambdaServer(0, {});
    server.simulator = {
      listFunctionConfigurations: jest.fn(() =>
        entries
          .map((e) => toFunctionConfiguration(e))
          .sort((a, b) => (a.FunctionName < b.FunctionName ? -1 : 1))
      ),
    };
    server.setupRoutes();
    await new Promise((resolve) => {
      httpServer = server.app.listen(0, '127.0.0.1', resolve);
    });
    port = httpServer.address().port;
  });

  afterAll(() => new Promise((resolve) => httpServer.close(resolve)));

  test('200 com Functions ordenadas e sem NextMarker quando cabe tudo', async () => {
    const res = await get(port, '/2015-03-31/functions');
    expect(res.status).toBe(200);
    expect(res.body.Functions.map((f) => f.FunctionName)).toEqual(['alpha', 'beta', 'gamma']);
    expect(res.body.Functions[0]).toMatchObject({
      FunctionArn: 'arn:aws:lambda:local:000000000000:function:alpha',
      Version: '$LATEST',
    });
    expect(res.body).not.toHaveProperty('NextMarker');
  });

  test('MaxItems=1 devolve NextMarker', async () => {
    const res = await get(port, '/2015-03-31/functions?MaxItems=1');
    expect(res.status).toBe(200);
    expect(res.body.Functions.map((f) => f.FunctionName)).toEqual(['alpha']);
    expect(res.body.NextMarker).toBe('alpha');
  });

  test('Marker da página anterior devolve a página seguinte', async () => {
    const res = await get(port, '/2015-03-31/functions?MaxItems=1&Marker=alpha');
    expect(res.status).toBe(200);
    expect(res.body.Functions.map((f) => f.FunctionName)).toEqual(['beta']);
    expect(res.body.NextMarker).toBe('beta');
  });

  test('MaxItems=abc devolve 400 ValidationException', async () => {
    const res = await get(port, '/2015-03-31/functions?MaxItems=abc');
    expect(res.status).toBe(400);
    expect(res.body.__type).toBe('ValidationException');
  });
});
