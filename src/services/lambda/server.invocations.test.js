/**
 * Rota POST /2015-03-31/functions/:functionName/invocations não pode ficar
 * pendurada quando o express.json() global já consumiu o corpo.
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

jest.setTimeout(10000);

function post(port, path, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('requisição pendurada (timeout)')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('Lambda server - /invocations', () => {
  let server;
  let httpServer;
  let port;
  const received = [];

  beforeAll(async () => {
    server = new LambdaServer(0, {});
    server.simulator = {
      invoke: jest.fn(async (name, event) => {
        received.push(event);
        return { StatusCode: 200, Payload: { echo: event } };
      }),
    };
    server.setupRoutes();
    await new Promise((resolve) => {
      httpServer = server.app.listen(0, '127.0.0.1', resolve);
    });
    port = httpServer.address().port;
  });

  afterAll(() => new Promise((resolve) => httpServer.close(resolve)));

  test('Content-Type JSON: usa o corpo já parseado (não pendura)', async () => {
    const res = await post(port, '/2015-03-31/functions/f/invocations', JSON.stringify({ a: 1 }), {
      'Content-Type': 'application/json',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ echo: { a: 1 } });
  });

  test('sem Content-Type JSON: lê o stream', async () => {
    const res = await post(port, '/2015-03-31/functions/f/invocations', JSON.stringify({ b: 2 }), {
      'Content-Type': 'application/octet-stream',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ echo: { b: 2 } });
  });

  test('corpo vazio: evento {}', async () => {
    const res = await post(port, '/2015-03-31/functions/f/invocations', undefined, {});
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ echo: {} });
  });
});
