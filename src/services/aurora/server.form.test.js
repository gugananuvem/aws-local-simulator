'use strict';

const http = require('http');
const AuroraServer = require('./server');

function post(port, path, contentType, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': contentType } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('AuroraServer RDS query protocol (form body)', () => {
  let server;
  let port;

  const defaultHandler = {
    handleRequest: async () => ({ DBClusters: [] })
  };

  beforeAll(async () => {
    server = new AuroraServer(0, {});
    await server.initialize();
    await new Promise((resolve) => {
      server.server = server.app.listen(0, '127.0.0.1', () => {
        port = server.server.address().port;
        resolve();
      });
    });
  });

  beforeEach(() => {
    server.rdsApiHandler = defaultHandler;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.server.close(resolve));
  });

  test('form-urlencoded Action (AWS CLI rds describe-db-clusters) is routed and answered as XML', async () => {
    const res = await post(
      port,
      '/',
      'application/x-www-form-urlencoded; charset=utf-8',
      'Action=DescribeDBClusters&Version=2014-10-31'
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/^<\?xml/);
    expect(res.body).toContain('<DescribeDBClustersResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/">');
    expect(res.body).toContain('<DescribeDBClustersResult><DBClusters/></DescribeDBClustersResult>');
    expect(res.body).toMatch(/<ResponseMetadata><RequestId>[0-9a-f-]{36}<\/RequestId><\/ResponseMetadata>/);
  });

  test('list results serialize items with singular element names', async () => {
    server.rdsApiHandler = {
      handleRequest: async () => ({ DBClusters: [{ DBClusterIdentifier: 'c1', Status: 'available' }] })
    };
    const res = await post(port, '/', 'application/x-www-form-urlencoded', 'Action=DescribeDBClusters&Version=2014-10-31');
    expect(res.body).toContain(
      '<DBClusters><DBCluster><DBClusterIdentifier>c1</DBClusterIdentifier><Status>available</Status></DBCluster></DBClusters>'
    );
  });

  test('form-urlencoded query error is returned as XML ErrorResponse with the same status', async () => {
    server.rdsApiHandler = {
      handleRequest: async () => {
        const e = new Error('Cluster not found');
        e.code = 'DBClusterNotFoundFault';
        e.statusCode = 404;
        throw e;
      }
    };
    const res = await post(port, '/', 'application/x-www-form-urlencoded', 'Action=DescribeDBClusters&Version=2014-10-31');
    expect(res.status).toBe(404);
    expect(res.body).toContain('<ErrorResponse');
    expect(res.body).toContain('<Code>DBClusterNotFoundFault</Code>');
    expect(res.body).toContain('<Message>Cluster not found</Message>');
  });

  test('JSON body with Action keeps the JSON response (no regression)', async () => {
    const res = await post(port, '/', 'application/json', JSON.stringify({ Action: 'DescribeDBClusters', Version: '2014-10-31' }));
    expect(res.status).toBe(200);
    expect(res.body).not.toMatch(/^<\?xml/);
    expect(JSON.parse(res.body)).toEqual({ DBClusters: [] });
  });

  test('form body without Action is still rejected with 400 BadRequestException', async () => {
    const res = await post(port, '/', 'application/x-www-form-urlencoded', 'Version=2014-10-31');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).__type).toBe('BadRequestException');
  });
});
