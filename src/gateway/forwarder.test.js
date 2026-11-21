const http = require('http');
const { GatewayServer, MAX_FORM_BODY_BYTES } = require('./gateway-server');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function request(port, { method = 'GET', path = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        rawHeaders: res.rawHeaders,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('gateway forwarding', () => {
  let upstream;
  let upstreamPort;
  let gateway;
  let gatewayPort;
  let deadPort;

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      if (req.url.startsWith('/chunked')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('part-1;');
        setTimeout(() => res.end('part-2'), 10);
        return;
      }
      if (req.url.startsWith('/missing')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('nope');
      }
      if (req.url.startsWith('/cookies')) {
        res.setHeader('Set-Cookie', ['a=1', 'b=2']);
        return res.end('ok');
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
    });
    upstreamPort = await listen(upstream);

    // Porta fechada: aberta e fechada para obter um numero de porta sem servico.
    const probe = http.createServer();
    deadPort = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));

    gateway = new GatewayServer({
      port: 0,
      host: '127.0.0.1',
      resolvePort: (name) => {
        if (name === 'sqs' || name === 'sns' || name === 'lambda') return upstreamPort;
        if (name === 'dynamodb') return deadPort;
        return undefined;
      },
      lookup: { bucketExists: (name) => name === 'meu-bucket', apiExists: () => false },
    });
    await gateway.start();
    gatewayPort = gateway.server.address().port;
  });

  afterAll(async () => {
    await gateway.stop();
    await new Promise((resolve) => upstream.close(resolve));
  });

  test('answers browser preflight requests with CORS headers without classifying them', async () => {
    const res = await request(gatewayPort, {
      method: 'OPTIONS',
      path: '/',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-amz-target',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toBe('content-type,x-amz-target');
  });

  test('keeps method, raw path and query, Host header and body unchanged', async () => {
    const res = await request(gatewayPort, {
      method: 'POST',
      path: '/echo/a%20b?x=%2F&y=1',
      headers: {
        host: 'bucket.localhost:4700',
        'x-amz-target': 'AmazonSQS.ListQueues',
        'content-type': 'application/x-amz-json-1.0',
      },
      body: '{"hello":"world"}',
    });
    expect(res.status).toBe(200);
    const echo = JSON.parse(res.body);
    expect(echo.method).toBe('POST');
    expect(echo.url).toBe('/echo/a%20b?x=%2F&y=1');
    expect(echo.headers.host).toBe('bucket.localhost:4700');
    expect(echo.body).toBe('{"hello":"world"}');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  test('removes hop-by-hop request headers before forwarding', async () => {
    const res = await request(gatewayPort, {
      path: '/echo',
      headers: { 'x-amz-target': 'AmazonSQS.ListQueues', te: 'trailers', 'x-custom': 'kept' },
    });
    const echo = JSON.parse(res.body);
    expect(echo.headers.te).toBeUndefined();
    expect(echo.headers['x-custom']).toBe('kept');
  });

  test('passes a chunked response through', async () => {
    const res = await request(gatewayPort, {
      path: '/chunked',
      headers: { 'x-amz-target': 'AmazonSQS.ListQueues' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('part-1;part-2');
  });

  test('passes the upstream status code through', async () => {
    const res = await request(gatewayPort, {
      path: '/missing',
      headers: { 'x-amz-target': 'AmazonSQS.ListQueues' },
    });
    expect(res.status).toBe(404);
    expect(res.body).toBe('nope');
  });

  test('keeps every Set-Cookie header', async () => {
    const res = await request(gatewayPort, {
      path: '/cookies',
      headers: { 'x-amz-target': 'AmazonSQS.ListQueues' },
    });
    expect(res.headers['set-cookie']).toEqual(['a=1', 'b=2']);
  });

  test('replays a form body read for classification, so the service receives it intact', async () => {
    const res = await request(gatewayPort, {
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'Action=ListTopics&Version=2010-03-31',
    });
    expect(res.status).toBe(200);
    const echo = JSON.parse(res.body);
    expect(echo.body).toBe('Action=ListTopics&Version=2010-03-31');
    expect(echo.headers['content-length']).toBe(String(Buffer.byteLength('Action=ListTopics&Version=2010-03-31')));
  });

  test('form body over 1 MiB gets 413', async () => {
    const big = 'Action=ListTopics&Version=2010-03-31&pad=' + 'x'.repeat(MAX_FORM_BODY_BYTES + 10);
    const res = await request(gatewayPort, {
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: big,
    });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body).__type).toBe('RequestEntityTooLarge');
  });

  test('unrecognized request gets 400 UnknownService', async () => {
    const res = await request(gatewayPort, { path: '/health' });
    expect(res.status).toBe(400);
    expect(res.headers['x-amzn-errortype']).toBe('UnknownService');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(JSON.parse(res.body).__type).toBe('UnknownService');
  });

  test('service that is not running gets 503 ServiceUnavailable', async () => {
    const res = await request(gatewayPort, {
      path: '/',
      headers: { 'x-amz-target': 'Kinesis_20131202.ListStreams' },
    });
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body).__type).toBe('ServiceUnavailable');
  });

  test('internal service that is down gets 503 ServiceUnavailable', async () => {
    const res = await request(gatewayPort, {
      path: '/',
      headers: { 'x-amz-target': 'DynamoDB_20120810.ListTables' },
    });
    expect(res.status).toBe(503);
    expect(res.headers['x-amzn-errortype']).toBe('ServiceUnavailable');
  });

  test('bucket in path (no signature) reaches s3 through the lookup', async () => {
    // s3 nao esta em resolvePort: o gateway responde 503, mas a classificacao foi s3.
    const res = await request(gatewayPort, { path: '/meu-bucket/arquivo.txt' });
    expect(res.status).toBe(503);
    expect(res.body).toMatch(/Service s3 is not running/);
  });
});
