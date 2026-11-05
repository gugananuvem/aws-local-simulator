/**
 * Policy Enforcement Middleware
 * 
 * Aplica validação de SCP + IAM policies em requisições
 * Ordem real da AWS:
 * 1. Extract principal
 * 2. Get all applicable policies (SCP + IAM)
 * 3. Evaluate (Deny > Allow > Implicit Deny)
 * 4. Check conditions
 * 5. Allow/Deny ação
 */

const logger = require('../utils/logger');
const PolicyCache = require('../utils/policy-cache');

class PolicyEnforcementMiddleware {
  constructor(organizationsService, iamService) {
    this.organizationsService = organizationsService;
    this.iamService = iamService;
    this.cache = new PolicyCache();
  }

  /**
   * Middleware Express para enforçar políticas
   */
  middleware(service = 'unknown', allowByDefault = true) {
    return async (req, res, next) => {
      try {
        const enforced = req.app.locals.organizationsPolicyEnforcement?.enabled;
        
        if (!enforced) {
          // Se enforcement desativado, permite tudo
          req.policyDecision = { allowed: true, reason: 'enforcement_disabled' };
          return next();
        }

        // Se não há principal, negar (já foi validado em authorization.js)
        if (!req.principal && req.app.locals.organizationsPolicyEnforcement?.requireAccountContext) {
          return this.accessDenied(res, {
            principal: 'unknown',
            action: `${service}:*`,
            resource: '*',
            reason: 'no_principal',
            message: 'Missing principal context'
          });
        }

        if (!req.principal) {
          // Sem principal mas enforcement desativado por account context
          req.policyDecision = { allowed: true, reason: 'no_principal_enforcement_disabled' };
          return next();
        }

        // Extrair ação e recurso da requisição
        const { action, resource } = this.extractActionAndResource(req, service);

        // Verificar cache
        const cacheKey = this.generateCacheKey(req.principal, action, resource);
        const cached = this.cache.get(cacheKey);
        
        if (cached) {
          req.policyDecision = cached;
          if (!cached.allowed) {
            return this.accessDenied(res, cached);
          }
          return next();
        }

        // Avaliar políticas
        const decision = await this.evaluatePolicies(
          req.principal,
          action,
          resource,
          service,
          req
        );

        // Cache resultado
        this.cache.set(cacheKey, decision);
        req.policyDecision = decision;

        if (!decision.allowed) {
          return this.accessDenied(res, decision);
        }

        // Log de acesso permitido
        if (req.app.locals.organizationsPolicyEnforcement?.scpEvaluation?.logAllowances) {
          this.logAllowance(req.principal, action, resource, decision);
        }

        next();
      } catch (error) {
        logger.error('Policy enforcement error:', error.message);
        res.status(500).json({
          code: 'InternalError',
          message: 'Internal error during policy evaluation',
          requestId: req.requestId || 'unknown'
        });
      }
    };
  }

  /**
   * Avalia todas as políticas aplicáveis
   * Ordem: SCP → IAM
   */
  async evaluatePolicies(principal, action, resource, service, req) {
    try {
      const accountId = principal.accountId;
      const roleArn = principal.roleArn || principal.assumedRole;

      // 1. Avaliar SCPs (Service Control Policies)
      const scpDecision = await this.evaluateSCPs(accountId, action, resource, service);
      
      // Explicit DENY em SCP → nega imediatamente
      if (!scpDecision.allowed && scpDecision.reason === 'explicit_deny') {
        return {
          allowed: false,
          principal: roleArn,
          action,
          resource,
          account: accountId,
          deniedBy: [{
            type: 'SCP',
            ...scpDecision.deniedByPolicy
          }],
          allowedBy: [],
          evaluationDetails: scpDecision
        };
      }

      // 2. Avaliar IAM policies
      const iamDecision = await this.evaluateIAM(roleArn, action, resource);

      // Explicit DENY em IAM → nega imediatamente
      if (!iamDecision.allowed && iamDecision.reason === 'explicit_deny') {
        return {
          allowed: false,
          principal: roleArn,
          action,
          resource,
          account: accountId,
          deniedBy: [{
            type: 'IAM',
            ...iamDecision.deniedByPolicy
          }],
          allowedBy: [],
          evaluationDetails: iamDecision
        };
      }

      // 3. SCP permite? IAM permite? → Allowed
      if (scpDecision.allowed && iamDecision.allowed) {
        return {
          allowed: true,
          principal: roleArn,
          action,
          resource,
          account: accountId,
          deniedBy: [],
          allowedBy: [
            { type: 'SCP', details: scpDecision },
            { type: 'IAM', details: iamDecision }
          ],
          evaluationDetails: { scpDecision, iamDecision }
        };
      }

      // 4. Se SCP nega (implicit ou explicit) → Nega
      if (!scpDecision.allowed) {
        return {
          allowed: false,
          principal: roleArn,
          action,
          resource,
          account: accountId,
          deniedBy: [{
            type: 'SCP',
            ...scpDecision.deniedByPolicy,
            reason: scpDecision.reason
          }],
          allowedBy: iamDecision.allowed ? [{ type: 'IAM' }] : [],
          evaluationDetails: scpDecision
        };
      }

      // 5. Se IAM não permite (implicit deny) → Nega
      if (!iamDecision.allowed) {
        return {
          allowed: false,
          principal: roleArn,
          action,
          resource,
          account: accountId,
          deniedBy: [{
            type: 'IAM',
            reason: 'implicit_deny',
            message: 'No explicit allow in principal policy'
          }],
          allowedBy: scpDecision.allowed ? [{ type: 'SCP' }] : [],
          evaluationDetails: iamDecision
        };
      }

      return {
        allowed: false,
        principal: roleArn,
        action,
        resource,
        account: accountId,
        deniedBy: [{ type: 'Unknown', reason: 'implicit_deny' }],
        allowedBy: []
      };
    } catch (error) {
      logger.error('Policy evaluation error:', error.message);
      throw error;
    }
  }

  /**
   * Avalia Service Control Policies
   */
  async evaluateSCPs(accountId, action, resource, service) {
    try {
      if (!this.organizationsService?.organizationsSimulator) {
        return { allowed: true, reason: 'organizations_not_available' };
      }

      const result = this.organizationsService.organizationsSimulator.evaluateSCPs(
        accountId,
        action,
        resource || `arn:aws:${service}:*:${accountId}:*`
      );

      return {
        allowed: result.allowed,
        reason: result.allowed ? 'explicit_allow' : 'implicit_deny',
        evaluationResults: result.evaluationResults,
        deniedByPolicy: result.denied ? {
          policyId: result.denied.id,
          name: result.denied.name,
          effect: 'Deny'
        } : null
      };
    } catch (error) {
      logger.debug('SCP evaluation error:', error.message);
      return { allowed: true, reason: 'evaluation_error' };
    }
  }

  /**
   * Avalia IAM policies
   */
  async evaluateIAM(roleArn, action, resource) {
    try {
      if (!this.organizationsService?.organizationsSimulator?.iamIntegration) {
        return { allowed: true, reason: 'iam_not_available' };
      }

      const result = this.organizationsService.organizationsSimulator.iamIntegration.evaluateAction(
        roleArn,
        action,
        resource
      );

      return {
        allowed: result.allowed,
        reason: result.allowed ? 'explicit_allow' : 'implicit_deny',
        evaluationResults: result.evaluationResults
      };
    } catch (error) {
      logger.debug('IAM evaluation error:', error.message);
      return { allowed: true, reason: 'evaluation_error' };
    }
  }

  /**
   * Extrai action e resource da requisição
   */
  extractActionAndResource(req, service) {
    // Action: service:operation (ex: s3:PutObject, sqs:SendMessage)
    const action = this.mapHttpMethodToAction(req.method, req.path, service);
    
    // Resource: construir ARN baseado no path/body
    const resource = this.mapPathToResource(req, service);

    return { action, resource };
  }

  /**
   * Map HTTP method + path → AWS action
   */
  mapHttpMethodToAction(method, path, service) {
    // Exemplos:
    // POST /buckets → s3:CreateBucket
    // PUT /object → s3:PutObject
    // DELETE /queue → sqs:DeleteQueue
    
    const pathParts = path.toLowerCase().split('/').filter(p => p);
    
    const methodMap = {
      POST: 'Create',
      PUT: 'Put',
      GET: 'Get',
      DELETE: 'Delete',
      PATCH: 'Update',
      HEAD: 'Head'
    };

    const verb = methodMap[method] || 'Invoke';
    const resource = pathParts[0] || 'Resource';
    const resourceName = resource.charAt(0).toUpperCase() + resource.slice(1, -1); // Remove 's'

    return `${service}:${verb}${resourceName}`;
  }

  /**
   * Map path/params → AWS resource ARN
   */
  mapPathToResource(req, service) {
    const account = req.accountId || '*';
    const region = req.get('X-Amz-Target')?.split('.')[0] || '*';

    switch (service) {
      case 's3':
        // arn:aws:s3:::bucket-name
        return req.body?.Bucket 
          ? `arn:aws:s3:::${req.body.Bucket}`
          : 'arn:aws:s3:::*';

      case 'sqs':
        // arn:aws:sqs:region:account:queue-name
        return req.body?.QueueName
          ? `arn:aws:sqs:${region}:${account}:${req.body.QueueName}`
          : `arn:aws:sqs:${region}:${account}:*`;

      case 'sns':
        // arn:aws:sns:region:account:topic-name
        return req.body?.Name
          ? `arn:aws:sns:${region}:${account}:${req.body.Name}`
          : `arn:aws:sns:${region}:${account}:*`;

      case 'dynamodb':
        // arn:aws:dynamodb:region:account:table/table-name
        return req.body?.TableName
          ? `arn:aws:dynamodb:${region}:${account}:table/${req.body.TableName}`
          : `arn:aws:dynamodb:${region}:${account}:table/*`;

      case 'kms':
        // arn:aws:kms:region:account:key/key-id
        return req.body?.KeyId
          ? `arn:aws:kms:${region}:${account}:key/${req.body.KeyId}`
          : `arn:aws:kms:${region}:${account}:key/*`;

      case 'lambda':
        // arn:aws:lambda:region:account:function:function-name
        return req.body?.FunctionName
          ? `arn:aws:lambda:${region}:${account}:function:${req.body.FunctionName}`
          : `arn:aws:lambda:${region}:${account}:function:*`;

      default:
        return `arn:aws:${service}:${region}:${account}:*`;
    }
  }

  /**
   * Gera cache key única
   */
  generateCacheKey(principal, action, resource) {
    const principalId = principal.roleArn || principal.credentials?.accessKeyId || 'unknown';
    return `${principalId}|${action}|${resource}`;
  }

  /**
   * Retorna erro de acesso negado (formato AWS real)
   */
  accessDenied(res, details) {
    const deniedBy = details.deniedBy?.[0] || details;

    logger.warn(`Access Denied: ${details.principal} → ${details.action}`, deniedBy);

    return res.status(403).json({
      code: 'AccessDenied',
      message: `User: ${details.principal} is not authorized to perform: ${details.action} because ${deniedBy.reason || 'implicit deny'}`,
      requestId: details.requestId || 'unknown',
      evaluationDetails: {
        principal: details.principal,
        action: details.action,
        resource: details.resource,
        account: details.account,
        deniedBy: details.deniedBy || [deniedBy],
        allowedBy: details.allowedBy || []
      }
    });
  }

  /**
   * Log de acesso permitido (para auditoria)
   */
  logAllowance(principal, action, resource, decision) {
    logger.info(`Access Allowed: ${principal.roleArn} → ${action} on ${resource}`, {
      allowedBy: decision.allowedBy
    });
  }
}

module.exports = PolicyEnforcementMiddleware;
