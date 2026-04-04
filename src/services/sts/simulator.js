const crypto = require('crypto');
const logger = require('../../utils/logger');

class STSSimulator {
  constructor(config) {
    this.config = config;
    this.assumedRoles = new Map();
  }

  async initialize() {
    logger.debug('Inicializando STS Simulator...');
  }

  assumeRole(params = {}) {
    const { RoleArn, RoleSessionName, DurationSeconds = 3600 } = params;
    if (!RoleArn) throw new Error('RoleArn is required');
    if (!RoleSessionName) throw new Error('RoleSessionName is required');

    const accessKeyId = `ASIA${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const secretKey = crypto.randomBytes(20).toString('hex');
    const sessionToken = crypto.randomBytes(64).toString('base64');
    const expiration = new Date(Date.now() + DurationSeconds * 1000).toISOString();
    const assumedRoleId = `AROA${crypto.randomBytes(8).toString('hex').toUpperCase()}:${RoleSessionName}`;

    return {
      Credentials: { AccessKeyId: accessKeyId, SecretAccessKey: secretKey, SessionToken: sessionToken, Expiration: expiration },
      AssumedRoleUser: { AssumedRoleId: assumedRoleId, Arn: `${RoleArn}/${RoleSessionName}` },
      PackedPolicySize: null
    };
  }

  getCallerIdentity(params = {}) {
    return {
      UserId: 'AKIAIOSFODNN7EXAMPLE',
      Account: '123456789012',
      Arn: 'arn:aws:iam::123456789012:user/local-simulator'
    };
  }

  getSessionToken(params = {}) {
    const { DurationSeconds = 3600 } = params;
    return {
      Credentials: {
        AccessKeyId: `ASIA${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
        SecretAccessKey: crypto.randomBytes(20).toString('hex'),
        SessionToken: crypto.randomBytes(64).toString('base64'),
        Expiration: new Date(Date.now() + DurationSeconds * 1000).toISOString()
      }
    };
  }

  assumeRoleWithWebIdentity(params = {}) {
    return this.assumeRole({ ...params, RoleSessionName: params.RoleSessionName || 'web-identity-session' });
  }

  assumeRoleWithSAML(params = {}) {
    return this.assumeRole({ ...params, RoleSessionName: params.RoleSessionName || 'saml-session' });
  }

  generateErrorResponse(code, message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <Error><Code>${code}</Code><Message>${message}</Message></Error>
  <RequestId>${crypto.randomUUID()}</RequestId>
</ErrorResponse>`;
  }
}

module.exports = STSSimulator;
