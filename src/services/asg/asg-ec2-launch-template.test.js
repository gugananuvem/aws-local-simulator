'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

describe('ASG resolves launch templates created by EC2', () => {
  let tmpDir;
  let previousDataDir;
  let ec2Sim;
  let asgSim;
  let asgServer;
  let port;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asg-ec2-lt-test-'));
    previousDataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = tmpDir;

    const EC2Simulator = require('../ec2/simulator');
    const ASGSimulator = require('./simulator');
    const ASGServer = require('./server');

    ec2Sim = new EC2Simulator({});
    await ec2Sim.initialize();
    ec2Sim.createLaunchTemplate({
      LaunchTemplateName: 'asg-test-lt',
      LaunchTemplateData: {
        ImageId: 'ami-0123456789abcdef0',
        InstanceType: 't3.micro',
        SecurityGroupIds: ['sg-0123456789abcdef0'],
      },
    });

    asgSim = new ASGSimulator({});
    await asgSim.initialize();
    asgSim.injectDependencies({ getSimulator: () => ec2Sim }, null);

    asgServer = new ASGServer(0, {});
    asgServer.simulator = asgSim;
    await asgServer.initialize();
    await new Promise((resolve) => {
      asgServer.server = asgServer.app.listen(0, '127.0.0.1', () => {
        port = asgServer.server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => asgServer.server.close(resolve));
    if (previousDataDir === undefined) delete process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    else process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = previousDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function query(action, params) {
    return new Promise((resolve, reject) => {
      const payload = new URLSearchParams({ Action: action, Version: '2011-01-01', ...params }).toString();
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  test('simulator copies the EC2 template by name, keeping its id and image', () => {
    const ec2Template = ec2Sim.describeLaunchTemplates().find((t) => t.LaunchTemplateName === 'asg-test-lt');
    const asg = asgSim.createAutoScalingGroup('asg-sim-by-name', 'asg-test-lt', { minSize: 0, maxSize: 1 });

    expect(asg.LaunchTemplate.LaunchTemplateId).toBe(ec2Template.LaunchTemplateId);
    expect(asg.LaunchTemplate.LaunchTemplateName).toBe('asg-test-lt');
    expect(asg.LaunchTemplate.ImageId).toBe('ami-0123456789abcdef0');
    expect(asg.LaunchTemplate.InstanceType).toBe('t3.micro');
    expect(asg.LaunchTemplate.SecurityGroupIds).toEqual(['sg-0123456789abcdef0']);
  });

  test('simulator resolves the EC2 template by id', () => {
    const ec2Template = ec2Sim.describeLaunchTemplates().find((t) => t.LaunchTemplateName === 'asg-test-lt');
    const asg = asgSim.createAutoScalingGroup('asg-sim-by-id', ec2Template.LaunchTemplateId, { minSize: 0, maxSize: 1 });

    expect(asg.LaunchTemplate.LaunchTemplateName).toBe('asg-test-lt');
  });

  test('simulator rejects a template that exists in neither ASG nor EC2', () => {
    expect(() => asgSim.createAutoScalingGroup('asg-sim-missing', 'no-such-lt', {})).toThrow(
      'Launch Template no-such-lt not found'
    );
  });

  test('CreateAutoScalingGroup with LaunchTemplateName from the AWS CLI query protocol succeeds', async () => {
    const created = await query('CreateAutoScalingGroup', {
      AutoScalingGroupName: 'asg-http-by-name',
      'LaunchTemplate.LaunchTemplateName': 'asg-test-lt',
      'LaunchTemplate.Version': '$Default',
      MinSize: '0',
      MaxSize: '1',
      AvailabilityZones: 'us-east-1a',
    });
    expect(created.status).toBe(200);
    expect(created.body).not.toContain('<Error>');

    const described = await query('DescribeAutoScalingGroups', {
      'AutoScalingGroupNames.member.1': 'asg-http-by-name',
    });
    expect(described.status).toBe(200);
    expect(described.body).toContain('<AutoScalingGroupName>asg-http-by-name</AutoScalingGroupName>');
    expect(described.body).toContain('<LaunchTemplateName>asg-test-lt</LaunchTemplateName>');
    expect(described.body).toMatch(/<CreatedTime>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/CreatedTime>/);

    const deleted = await query('DeleteAutoScalingGroup', {
      AutoScalingGroupName: 'asg-http-by-name',
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).not.toContain('<Error>');
  });

  test('CreateAutoScalingGroup without any template reference returns the existing error', async () => {
    const res = await query('CreateAutoScalingGroup', {
      AutoScalingGroupName: 'asg-http-no-template',
      MinSize: '0',
      MaxSize: '1',
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain('LaunchTemplate.LaunchTemplateId or LaunchTemplateName is required');
  });
});
