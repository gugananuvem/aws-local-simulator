const crypto = require('crypto');
const logger = require('../../utils/logger');

class STSSimulator {
  constructor(config, organizationsService = null) {
    this.config = config;
    this.organizationsService = organizationsService;
    this.assumedRoles = new Map();
    this.sessions = new Map(); // Track active sessions
  }

  async initialize() {
    logger.debug('Inicializando STS Simulator...');
  }

  /**
   * AssumeRole - com integração a Organizations
   * Retorna temporary credentials com SessionToken JWT
   */
  assumeRole(params = {}) {
    const { RoleArn, RoleSessionName, DurationSeconds = 3600, ExternalId = null, SerialNumber = null, TokenCode = null } = params;
    
    if (!RoleArn) throw new Error('RoleArn is required');
    if (!RoleSessionName) throw new Error('RoleSessionName is required');

    // Extrair accountId e roleName do ARN
    // Format: arn:aws:iam::123456789012:role/role-name
    const arnParts = RoleArn.match(/arn:aws:iam::(\d+):role\/(.+)/);
    if (!arnParts) throw new Error('Invalid RoleArn format');

    const [, accountId, roleName] = arnParts;

    // Validar role existe na organização (se Organizations está disponível)
    if (this.organizationsService?.organizationsSimulator?.roles) {
      const roleExists = this.organizationsService.organizationsSimulator.roles.has(RoleArn);
      if (!roleExists) {
        throw new Error(`Role ${RoleArn} does not exist`);
      }
    }

    // Gerar temporary credentials
    const credentials = this.generateTemporaryCredentials(
      accountId,
      RoleArn,
      RoleSessionName,
      DurationSeconds
    );

    // Armazenar session para rastreamento
    this.sessions.set(credentials.sessionId, {
      roleArn: RoleArn,
      sessionName: RoleSessionName,
      createdAt: Date.now(),
      expiresAt: credentials.expiresAtMs,
      accountId,
      accessKeyId: credentials.accessKeyId
    });

    const expiration = new Date(credentials.expiresAtMs).toISOString();
    const assumedRoleId = `AROA${crypto.randomBytes(8).toString('hex').toUpperCase()}:${RoleSessionName}`;

    return {
      Credentials: {
        AccessKeyId: credentials.accessKeyId,
        SecretAccessKey: credentials.secretAccessKey,
        SessionToken: credentials.sessionToken,
        Expiration: expiration
      },
      AssumedRoleUser: {
        AssumedRoleId: assumedRoleId,
        Arn: `${RoleArn}/${RoleSessionName}`
      },
      PackedPolicySize: 6
    };
  }

  /**
   * Gerar credentials temporárias com JWT SessionToken
   * SessionToken contém informações do role para validação posterior
   */
  generateTemporaryCredentials(accountId, roleArn, sessionName, durationSeconds) {
    const now = Date.now();
    const expiresAtMs = now + (durationSeconds * 1000);

    // AccessKeyId com prefixo ASIA (indica temporary credentials)
    const accessKeyId = `ASIA${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const secretAccessKey = crypto.randomBytes(20).toString('hex');

    // Gerar JWT SessionToken com informações do role
    const sessionId = crypto.randomBytes(16).toString('hex');
    
    const payload = {
      sessionId,
      accountId,
      assumedRole: roleArn,
      sessionName,
      principal: 'unknown',
      issuedAt: now,
      expiresAt: expiresAtMs,
      accessKeyId,
      secretAccessKey,
      iss: 'aws-local-simulator-sts',
      type: 'temporary-credentials'
    };

    // Criar JWT simples
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const signature = crypto
      .createHmac('sha256', this.config.jwtSecret || 'local-simulator-secret')
      .update(`${header}.${payloadEncoded}`)
      .digest('base64url');

    const sessionToken = `${header}.${payloadEncoded}.${signature}`;

    return {
      sessionId,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      expiresAtMs,
      accountId,
      roleArn
    };
  }

  /**
   * Validar SessionToken JWT
   */
  validateSessionToken(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

      if (payload.expiresAt < Date.now()) {
        return null;
      }

      return payload;
    } catch (error) {
      logger.debug('SessionToken validation error:', error.message);
      return null;
    }
  }

  /**
   * GetCallerIdentity - Retorna informações do principal
   */
  getCallerIdentity(params = {}, sessionToken = null) {
    if (sessionToken) {
      const payload = this.validateSessionToken(sessionToken);
      if (payload) {
        return {
          UserId: payload.sessionId,
          Account: payload.accountId,
          Arn: payload.assumedRole,
          SessionToken: sessionToken,
          Type: 'AssumedRole'
        };
      }
    }

    return {
      UserId: 'AKIAIOSFODNN7EXAMPLE',
      Account: '123456789012',
      Arn: 'arn:aws:iam::123456789012:user/local-simulator',
      Type: 'IAMUser'
    };
  }

  /**
   * GetSessionToken - Gera session token para MFA
   */
  getSessionToken(params = {}) {
    const { DurationSeconds = 3600 } = params;

    const credentials = this.generateTemporaryCredentials(
      '123456789012',
      'arn:aws:iam::123456789012:root',
      'mfa-session',
      DurationSeconds
    );

    return {
      Credentials: {
        AccessKeyId: credentials.accessKeyId,
        SecretAccessKey: credentials.secretAccessKey,
        SessionToken: credentials.sessionToken,
        Expiration: new Date(credentials.expiresAtMs).toISOString()
      }
    };
  }

  /**
   * AssumeRoleWithWebIdentity
   */
  assumeRoleWithWebIdentity(params = {}) {
    return this.assumeRole({
      ...params,
      RoleSessionName: params.RoleSessionName || 'web-identity-session'
    });
  }

  /**
   * AssumeRoleWithSAML
   */
  assumeRoleWithSAML(params = {}) {
    return this.assumeRole({
      ...params,
      RoleSessionName: params.RoleSessionName || 'saml-session'
    });
  }

  /**
   * GetStats
   */
  getStats() {
    const now = Date.now();
    let activeSessions = 0;
    let expiredSessions = 0;

    for (const session of this.sessions.values()) {
      if (session.expiresAt > now) {
        activeSessions++;
      } else {
        expiredSessions++;
      }
    }

    return {
      activeSessions,
      expiredSessions,
      totalSessions: this.sessions.size
    };
  }

  /**
   * Reset
   */
  async reset() {
    this.assumedRoles.clear();
    this.sessions.clear();
    logger.debug('STS Simulator reset');
  }

  /**
   * Generate error response
   */
  generateErrorResponse(code, message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <Error><Code>${code}</Code><Message>${message}</Message></Error>
  <RequestId>${crypto.randomUUID()}</RequestId>
</ErrorResponse>`;
  }
}

module.exports = STSSimulator;
