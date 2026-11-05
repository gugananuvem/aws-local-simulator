'use strict';

/**
 * Builds the environment variables for a CloudShell PTY session.
 * Includes AWS credentials and endpoint URLs for all active services.
 *
 * @param {Function} getActiveServices - returns array of { name, port }
 * @returns {Object} environment variables object
 */
function buildShellEnvironment(getActiveServices) {
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: 'local-access-key',
    AWS_SECRET_ACCESS_KEY: 'local-secret-key',
    AWS_DEFAULT_REGION: 'us-east-1',
  };

  const services = getActiveServices();
  for (const { name, port } of services) {
    const envKey = `AWS_ENDPOINT_${name.toUpperCase().replace(/-/g, '_')}`;
    env[envKey] = `http://localhost:${port}`;
  }

  return env;
}

module.exports = { buildShellEnvironment };
