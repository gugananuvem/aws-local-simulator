'use strict';

const http = require('http');
const CloudFrontServer = require('./server');

function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: data }));
      })
      .on('error', reject);
  });
}

describe('CloudFront REST-XML ListDistributions with the AWS CLI version prefix', () => {
  let server;
  let port;

  beforeAll(async () => {
    server = new CloudFrontServer({});
    // One distribution in the same shape the simulator returns from toAWSFormat().
    server.simulator.distributions.set('E1TEST', {
      toAWSFormat: () => ({ Id: 'E1TEST', DomainName: 'd1example.cloudfront.net', Status: 'Deployed', Enabled: true }),
    });
    const listening = server.listen(0, '127.0.0.1');
    await new Promise((resolve) => listening.on('listening', resolve));
    port = listening.address().port;
    server.server = listening;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.server.close(resolve));
  });

  test('GET /2020-05-31/distribution (CLI list-distributions) answers DistributionList as XML', async () => {
    const res = await get(port, '/2020-05-31/distribution');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/xml/);
    expect(res.body).toContain('<DistributionList xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/">');
    expect(res.body).toContain('<Quantity>1</Quantity>');
    expect(res.body).toContain('<DistributionSummary><Id>E1TEST</Id>');
    expect(res.body).toContain('<DomainName>d1example.cloudfront.net</DomainName>');
  });

  test('GET /distribution without the version prefix keeps the JSON response (no regression)', async () => {
    const res = await get(port, '/distribution');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/json/);
    const json = JSON.parse(res.body);
    expect(json.DistributionList.Quantity).toBe(1);
  });

  test('GET /health still answers without the prefix', async () => {
    const res = await get(port, '/health');
    expect(res.status).toBe(200);
  });
});
