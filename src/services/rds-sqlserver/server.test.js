const http = require('http');
const SqlServerServer = require('./server');

function request(port, { method = 'GET', path = '/', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: res.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('servidor HTTP do RDS SQL Server', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = new SqlServerServer(0, { authentication: { enabled: false } });
    server.rdsApiHandler = { handleRequest: jest.fn(async () => ({ DBClusters: [] })) };
    server.dataApiHandler = { handleRequest: jest.fn(async () => ({ records: [] })) };
    server.clusterManager = { listClusters: () => [], listInstances: () => [{ DBInstanceIdentifier: 'i-1' }] };
    server.dbEngine = { listDatabases: () => ['master'] };
    server.resetHandler = jest.fn(async () => {});
    await server.initialize();
    await server.start();
    port = server.server.address().port;
  });

  afterEach(async () => {
    await server.stop();
  });

  test('responde XML para o protocolo query da AWS CLI no prefixo do gateway', async () => {
    const body = 'Action=DescribeDBClusters&Version=2014-10-31';
    const response = await request(port, {
      method: 'POST',
      path: '/rds-sqlserver',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body),
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(response.contentType).toContain('text/xml');
    expect(response.body).toContain('<DescribeDBClustersResponse');
    expect(response.body).toContain('<DBClusters');
    expect(server.rdsApiHandler.handleRequest).toHaveBeenCalledWith('DescribeDBClusters', expect.any(Object));
  });

  test('responde JSON para Data API', async () => {
    const body = JSON.stringify({ resourceArn: 'arn:qualquer' });
    const response = await request(port, {
      method: 'POST',
      path: '/',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'RDSDataService.ExecuteStatement',
        'content-length': Buffer.byteLength(body),
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ records: [] });
    expect(server.dataApiHandler.handleRequest).toHaveBeenCalledWith('RDSDataService.ExecuteStatement', expect.any(Object));
  });

  test('devolve erro AWS em XML quando a ação falha', async () => {
    server.rdsApiHandler.handleRequest.mockRejectedValueOnce(
      Object.assign(new Error('Cluster não encontrado'), { code: 'DBClusterNotFoundFault', statusCode: 404 })
    );
    const body = 'Action=DescribeDBClusters&Version=2014-10-31';
    const response = await request(port, {
      method: 'POST',
      path: '/',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body),
      },
      body,
    });

    expect(response.status).toBe(404);
    expect(response.body).toContain('<Code>DBClusterNotFoundFault</Code>');
  });

  test('rejeita requisição sem target nem Action', async () => {
    const body = JSON.stringify({});
    const response = await request(port, {
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      body,
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).__type).toBe('BadRequestException');
  });

  test('expõe endpoints administrativos e reset único', async () => {
    expect(JSON.parse((await request(port, { path: '/rds-sqlserver/__admin/health' })).body))
      .toMatchObject({ service: 'rds-sqlserver', status: 'healthy' });
    expect(JSON.parse((await request(port, { path: '/__admin/clusters' })).body)).toEqual({ clusters: [] });
    expect(JSON.parse((await request(port, { path: '/__admin/instances' })).body).instances).toHaveLength(1);
    expect(JSON.parse((await request(port, { path: '/__admin/databases' })).body).databases).toEqual(['master']);

    const reset = await request(port, { method: 'POST', path: '/__admin/reset' });
    expect(reset.status).toBe(200);
    expect(server.resetHandler).toHaveBeenCalledTimes(1);
  });
});
