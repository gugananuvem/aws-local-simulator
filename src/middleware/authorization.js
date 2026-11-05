/**
 * Authorization Middleware
 * 
 * Extrai e valida o principal (usuário/role/assumed-role) das requisições
 * Suporta:
 * - AWS SigV4 (Authorization header)
 * - SessionToken (X-Amz-Security-Token)
 * - Headers customizados (X-Account-Id, X-Role-Arn)
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

class AuthorizationMiddleware {
  constructor(organizationsService, stsService) {
    this.organizationsService = organizationsService;
    this.stsService = stsService;
    this.principalCache = new Map();
    this.cacheTTL = 300000; // 5 minutes
  }

  /**
   * Middleware Express para extrair principal
   */
  middleware() {
    return async (req, res, next) => {
      try {
        const enforced = req.app.locals.organizationsPolicyEnforcement?.enabled;
        
        if (!enforced) {
          // Se enforcement desativado, continua sem validar
          req.principal = null;
          req.credentials = null;
          return next();
        }

        // Extrair principal de múltiplas fontes
        const principal = await this.extractPrincipal(req);
        
        if (!principal) {
          // Se enforcement ativado mas sem credenciais, nega
          return res.status(403).json({
            code: 'InvalidCredentials',
            message: 'Missing or invalid AWS credentials. Set Authorization header or AWS_ACCESS_KEY_ID environment variable.',
            requestId: this.generateRequestId()
          });
        }

        // Validar se principal ainda existe e não expirou
        const isValid = await this.validatePrincipal(principal);
        if (!isValid) {
          return res.status(403).json({
            code: 'InvalidCredentials',
            message: 'Invalid or expired credentials',
            requestId: this.generateRequestId()
          });
        }

        req.principal = principal;
        req.credentials = principal.credentials;
        req.accountId = principal.accountId;
        req.roleArn = principal.roleArn;

        next();
      } catch (error) {
        logger.error('Authorization error:', error.message);
        res.status(500).json({
          code: 'InternalError',
          message: 'Internal error during authorization',
          requestId: this.generateRequestId()
        });
      }
    };
  }

  /**
   * Extrai principal de:
   * 1. Authorization header (AWS SigV4)
   * 2. X-Amz-Security-Token header (SessionToken de STS)
   * 3. Headers customizados (X-Account-Id, X-Role-Arn)
   */
  async extractPrincipal(req) {
    // Opção 1: SessionToken do STS (SigV4 com assumed role)
    const sessionToken = req.get('X-Amz-Security-Token');
    if (sessionToken) {
      return this.extractFromSessionToken(sessionToken);
    }

    // Opção 2: Authorization header (AWS SigV4)
    const authHeader = req.get('Authorization');
    if (authHeader && authHeader.startsWith('AWS4-HMAC-SHA256')) {
      return this.extractFromSigV4(authHeader, req);
    }

    // Opção 3: Headers customizados (para testes/desenvolvimento)
    const accountId = req.get('X-Account-Id');
    const roleArn = req.get('X-Role-Arn');
    if (accountId && roleArn) {
      return {
        accountId,
        roleArn,
        assumedRole: roleArn,
        sessionName: req.get('X-Session-Name') || 'custom-session',
        credentials: {
          accessKeyId: req.get('X-Access-Key-Id'),
          secretAccessKey: req.get('X-Secret-Access-Key'),
          sessionToken: 'custom-token'
        },
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        type: 'custom'
      };
    }

    // Opção 4: Environment variables (AWS CLI default)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      return {
        accountId: process.env.AWS_ACCOUNT_ID || '123456789012',
        roleArn: process.env.AWS_ROLE_ARN || 'arn:aws:iam::123456789012:root',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN
        },
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        type: 'env'
      };
    }

    return null;
  }

  /**
   * Extrai do SessionToken (JWT com assumed role info)
   * Formato: header.payload.signature
   */
  extractFromSessionToken(token) {
    try {
      // Parse JWT simples (sem validar assinatura por enquanto)
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid token format');
      }

      // Decode payload (base64url)
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8')
      );

      // Validar expiração
      if (payload.expiresAt < Date.now()) {
        return null; // Token expirado
      }

      return {
        accountId: payload.accountId,
        roleArn: payload.assumedRole || payload.roleArn,
        assumedRole: payload.assumedRole,
        originalPrincipal: payload.principal,
        sessionName: payload.sessionName,
        credentials: {
          accessKeyId: payload.accessKeyId,
          secretAccessKey: payload.secretAccessKey,
          sessionToken: token
        },
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        type: 'sts'
      };
    } catch (error) {
      logger.debug('Failed to extract from SessionToken:', error.message);
      return null;
    }
  }

  /**
   * Extrai do Authorization header (AWS SigV4)
   * Formato: AWS4-HMAC-SHA256 Credential=AKIA.../20260930/us-east-1/service/aws4_request, ...
   */
  extractFromSigV4(authHeader, req) {
    try {
      const credentialMatch = authHeader.match(/Credential=([^,]+)/);
      if (!credentialMatch) {
        return null;
      }

      const credential = credentialMatch[1];
      const [accessKeyId, date, region, service, signatureType] = credential.split('/');

      // Lookup access key no STS para obter informações do principal
      // Por enquanto, extrair do AccessKeyId
      const accountId = accessKeyId.substring(4, 20); // ASIA prefix é para STS
      const isTemporary = accessKeyId.startsWith('ASIA');

      return {
        accountId,
        credentials: {
          accessKeyId,
          date,
          region,
          service
        },
        isTemporary,
        type: 'sigv4'
      };
    } catch (error) {
      logger.debug('Failed to extract from SigV4:', error.message);
      return null;
    }
  }

  /**
   * Valida se principal ainda é válido
   */
  async validatePrincipal(principal) {
    // Verificar cache
    const cacheKey = `principal_${principal.credentials?.accessKeyId || principal.roleArn}`;
    const cached = this.principalCache.get(cacheKey);
    
    if (cached && cached.expiresAt > Date.now()) {
      return cached.valid;
    }

    try {
      // Validar se role ainda existe na organização
      if (this.organizationsService && principal.roleArn) {
        const roleExists = this.organizationsService.organizationsSimulator
          ?.roles?.has(principal.roleArn);
        
        if (!roleExists) {
          this.principalCache.set(cacheKey, { valid: false, expiresAt: Date.now() + this.cacheTTL });
          return false;
        }
      }

      // Validar se credentials não expiraram
      if (principal.expiresAt && principal.expiresAt < Date.now()) {
        this.principalCache.set(cacheKey, { valid: false, expiresAt: Date.now() + this.cacheTTL });
        return false;
      }

      this.principalCache.set(cacheKey, { valid: true, expiresAt: Date.now() + this.cacheTTL });
      return true;
    } catch (error) {
      logger.debug('Principal validation error:', error.message);
      return false;
    }
  }

  /**
   * Gera request ID único para rastreamento
   */
  generateRequestId() {
    return crypto.randomBytes(8).toString('hex').toUpperCase();
  }

  /**
   * Limpa cache expirado
   */
  cleanupCache() {
    const now = Date.now();
    for (const [key, value] of this.principalCache.entries()) {
      if (value.expiresAt < now) {
        this.principalCache.delete(key);
      }
    }
  }
}

module.exports = AuthorizationMiddleware;
