const fs = require('fs');
const os = require('os');
const path = require('path');
const EnvLoader = require('./env-loader');
const { loadConfig } = require('./config-loader');

const ENV_KEYS = [
  'AWS_ENDPOINT_URL',
  'AWS_LOCAL_SIMULATOR_GATEWAY_PORT',
  'AWS_LOCAL_SIMULATOR_LEGACY_PORTS',
];

describe('gateway configuration', () => {
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
  });

  describe('parseEndpointUrl', () => {
    test('reads host and port from a valid URL', () => {
      expect(EnvLoader.parseEndpointUrl('http://localhost:4700')).toEqual({
        url: 'http://localhost:4700',
        hostname: 'localhost',
        port: 4700,
      });
    });

    test('uses the gateway default port when the URL has no explicit port', () => {
      expect(EnvLoader.parseEndpointUrl('http://localhost').port).toBe(4700);
    });

    test('keeps a non-localhost host', () => {
      expect(EnvLoader.parseEndpointUrl('http://127.0.0.1:4800/')).toEqual({
        url: 'http://127.0.0.1:4800',
        hostname: '127.0.0.1',
        port: 4800,
      });
    });

    test('rejects a value that is not a URL', () => {
      expect(() => EnvLoader.parseEndpointUrl('not a url')).toThrow(/AWS_ENDPOINT_URL invalida/);
    });

    test('rejects a protocol other than http or https', () => {
      expect(() => EnvLoader.parseEndpointUrl('ftp://localhost:4700')).toThrow(/http ou https/);
    });

    test('rejects a port outside 1-65535', () => {
      expect(() => EnvLoader.parseEndpointUrl('http://localhost:70000')).toThrow(/AWS_ENDPOINT_URL invalida/);
    });
  });

  describe('EnvLoader.loadGateway', () => {
    test('empty when no gateway variable is set', () => {
      expect(EnvLoader.loadGateway()).toEqual({});
    });

    test('gateway port from AWS_LOCAL_SIMULATOR_GATEWAY_PORT', () => {
      process.env.AWS_LOCAL_SIMULATOR_GATEWAY_PORT = '4800';
      expect(EnvLoader.loadGateway()).toEqual({ port: 4800 });
    });

    test('AWS_ENDPOINT_URL port wins over AWS_LOCAL_SIMULATOR_GATEWAY_PORT', () => {
      process.env.AWS_LOCAL_SIMULATOR_GATEWAY_PORT = '4800';
      process.env.AWS_ENDPOINT_URL = 'http://localhost:4900';
      expect(EnvLoader.loadGateway()).toEqual({
        port: 4900,
        endpointUrl: 'http://localhost:4900',
      });
    });

    test('legacy ports flag accepts true, 1 and yes', () => {
      for (const value of ['true', '1', 'yes']) {
        process.env.AWS_LOCAL_SIMULATOR_LEGACY_PORTS = value;
        expect(EnvLoader.loadGateway().legacyPorts).toBe(true);
      }
      process.env.AWS_LOCAL_SIMULATOR_LEGACY_PORTS = 'false';
      expect(EnvLoader.loadGateway().legacyPorts).toBe(false);
    });
  });

  describe('ConfigLoader.load', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeUserConfig(gateway) {
      const file = path.join(tmpDir, 'aws-local-simulator.json');
      fs.writeFileSync(file, JSON.stringify({ gateway }));
      return file;
    }

    test('defaults to port 4700 with legacy ports off', async () => {
      const config = await loadConfig(writeUserConfig(undefined));
      expect(config.gateway).toEqual({ port: 4700, legacyPorts: false });
    });

    test('port from the user file is used when the environment does not set one', async () => {
      const config = await loadConfig(writeUserConfig({ port: 5555 }));
      expect(config.gateway.port).toBe(5555);
    });

    test('AWS_ENDPOINT_URL overrides the port from the user file', async () => {
      process.env.AWS_ENDPOINT_URL = 'http://localhost:4900';
      const config = await loadConfig(writeUserConfig({ port: 5555 }));
      expect(config.gateway.port).toBe(4900);
      expect(config.gateway.endpointUrl).toBe('http://localhost:4900');
    });

    test('invalid AWS_ENDPOINT_URL stops initialization with a clear error', async () => {
      process.env.AWS_ENDPOINT_URL = 'banana';
      await expect(loadConfig(writeUserConfig(undefined))).rejects.toThrow(/AWS_ENDPOINT_URL invalida/);
    });
  });
});
