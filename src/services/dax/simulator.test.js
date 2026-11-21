const fs = require('fs');
const os = require('os');
const path = require('path');
const DAXSimulator = require('./simulator');

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('DAX parameter groups', () => {
  let dataDir;
  let previousDataDir;
  let simulator;

  beforeEach(async () => {
    previousDataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dax-simulator-test-'));
    process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = dataDir;
    simulator = new DAXSimulator({});
    await simulator.initialize();
  });

  afterEach(() => {
    if (previousDataDir === undefined) {
      delete process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    } else {
      process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = previousDataDir;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates parameter groups with default TTL parameters', () => {
    simulator.handleRequest('CreateParameterGroup', {
      ParameterGroupName: 'cache-settings',
      ParameterGroupFamily: 'dax1.0',
      Description: 'Cache TTL settings'
    });

    const { Parameters } = simulator.handleRequest('DescribeParameters', {
      ParameterGroupName: 'cache-settings'
    });

    expect(Parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ ParameterName: 'record-ttl-millis', ParameterValue: '300000' }),
      expect.objectContaining({ ParameterName: 'query-ttl-millis', ParameterValue: '300000' })
    ]));
  });

  it('updates and persists item and query TTL values', async () => {
    simulator.handleRequest('CreateParameterGroup', {
      ParameterGroupName: 'cache-settings'
    });
    simulator.handleRequest('UpdateParameterGroup', {
      ParameterGroupName: 'cache-settings',
      ParameterNameValues: [
        { ParameterName: 'record-ttl-millis', ParameterValue: '18000000' },
        { ParameterName: 'query-ttl-millis', ParameterValue: '18000000' }
      ]
    });

    const restartedSimulator = new DAXSimulator({});
    await restartedSimulator.initialize();
    const { Parameters } = restartedSimulator.handleRequest('DescribeParameters', {
      ParameterGroupName: 'cache-settings'
    });

    expect(Parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ ParameterName: 'record-ttl-millis', ParameterValue: '18000000' }),
      expect.objectContaining({ ParameterName: 'query-ttl-millis', ParameterValue: '18000000' })
    ]));
  });

  it('rejects unsupported parameters and values outside the DAX range', () => {
    simulator.handleRequest('CreateParameterGroup', {
      ParameterGroupName: 'cache-settings'
    });

    expect(() => simulator.handleRequest('UpdateParameterGroup', {
      ParameterGroupName: 'cache-settings',
      ParameterNameValues: [{ ParameterName: 'unknown-setting', ParameterValue: '1' }]
    })).toThrow('Unsupported DAX parameter');

    expect(() => simulator.handleRequest('UpdateParameterGroup', {
      ParameterGroupName: 'cache-settings',
      ParameterNameValues: [{ ParameterName: 'record-ttl-millis', ParameterValue: '2147483648' }]
    })).toThrow('between 0 and 2147483647');
  });

  it('includes the built-in parameter group alongside custom groups', () => {
    simulator.handleRequest('CreateParameterGroup', {
      ParameterGroupName: 'cache-settings'
    });

    const names = simulator.handleRequest('DescribeParameterGroups').ParameterGroups
      .map(({ ParameterGroupName }) => ParameterGroupName);

    expect(names).toEqual(expect.arrayContaining(['default.dax1.0', 'cache-settings']));
  });
});
