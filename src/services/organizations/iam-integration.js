/**
 * IAM Integration Module
 * Integra Organizations/SCP com IAM para avaliação completa de permissões
 */

const logger = require('../../utils/logger');

class IAMIntegration {
  constructor(organizationsSimulator, iamService) {
    this.organizationsSimulator = organizationsSimulator;
    this.iamService = iamService;
  }

  /**
   * Avalia ação completa: SCP + IAM Policy
   * Retorna: allowed/denied com motivo detalhado
   */
  evaluateAction(principalArn, action, resource = '*', accountId = null, context = {}) {
    logger.debug(`Evaluating action: ${action} on ${resource} by ${principalArn}`);

    // 1. Extrai account ID do principal ARN
    if (!accountId) {
      const match = principalArn.match(/:(\d+):/);
      accountId = match ? match[1] : null;
    }

    if (!accountId) {
      return {
        allowed: false,
        deniedBy: ['UnknownAccount'],
        reason: 'Could not determine account ID from principal ARN',
        principal: principalArn,
        action,
        resource
      };
    }

    // 2. Avalia SCPs primeiro (mais restritivas)
    const scpEvaluation = this.organizationsSimulator.evaluateSCPs(accountId, action, resource);
    
    if (!scpEvaluation.allowed) {
      return {
        allowed: false,
        deniedBy: scpEvaluation.deniedBy || ['SCP'],
        reason: 'Denied by Service Control Policy',
        principal: principalArn,
        action,
        resource,
        policy: 'SCP'
      };
    }

    // 3. Se houver IAM service, avalia IAM policies
    if (this.iamService) {
      const iamEvaluation = this.evaluateIAMPolicies(principalArn, action, resource, context);
      
      if (!iamEvaluation.allowed) {
        return {
          allowed: false,
          deniedBy: iamEvaluation.deniedBy || ['IAM Policy'],
          reason: iamEvaluation.reason || 'Denied by IAM policy',
          principal: principalArn,
          action,
          resource,
          policy: 'IAM'
        };
      }
    }

    // 4. Tudo permitido
    return {
      allowed: true,
      principal: principalArn,
      action,
      resource,
      evaluatedBy: ['SCP', 'IAM']
    };
  }

  /**
   * Avalia IAM policies associadas ao principal
   */
  evaluateIAMPolicies(principalArn, action, resource, context = {}) {
    try {
      // Extrai o tipo de principal (user, role, assumedRole)
      const principalType = this.extractPrincipalType(principalArn);
      
      if (principalType === 'unknown') {
        return {
          allowed: false,
          deniedBy: ['UnknownPrincipalType'],
          reason: 'Unknown principal type'
        };
      }

      // Obtém policies do principal
      const policies = this.getPoliciesForPrincipal(principalArn, principalType);

      if (policies.length === 0) {
        return {
          allowed: false,
          deniedBy: ['NoPolicies'],
          reason: 'No policies attached to principal'
        };
      }

      // Avalia cada policy
      for (const policy of policies) {
        if (policy.Statement) {
          for (const statement of policy.Statement) {
            if (this.statementMatches(statement, action, resource, context)) {
              if (statement.Effect === 'Deny') {
                return {
                  allowed: false,
                  deniedBy: [policy.name || 'InlinePolicy'],
                  reason: 'Explicitly denied by policy'
                };
              }
              
              if (statement.Effect === 'Allow') {
                return {
                  allowed: true,
                  allowedBy: [policy.name || 'InlinePolicy']
                };
              }
            }
          }
        }
      }

      // Nenhuma policy permitiu explicitamente
      return {
        allowed: false,
        deniedBy: ['ImplicitDeny'],
        reason: 'No policy explicitly allows this action'
      };

    } catch (error) {
      logger.error(`Error evaluating IAM policies: ${error.message}`);
      return {
        allowed: false,
        deniedBy: ['EvaluationError'],
        reason: error.message
      };
    }
  }

  /**
   * Extrai tipo de principal
   */
  extractPrincipalType(principalArn) {
    if (principalArn.includes(':iam::') && principalArn.includes(':user/')) {
      return 'user';
    }
    if (principalArn.includes(':iam::') && principalArn.includes(':role/')) {
      return 'role';
    }
    if (principalArn.includes(':sts::') && principalArn.includes(':assumed-role/')) {
      return 'assumed-role';
    }
    if (principalArn === '*') {
      return 'everyone';
    }
    return 'unknown';
  }

  /**
   * Obtém policies para um principal
   */
  getPoliciesForPrincipal(principalArn, principalType) {
    if (!this.iamService) {
      return [];
    }

    try {
      const policies = [];

      if (principalType === 'user' || principalType === 'assumed-role') {
        // Extrai nome do usuário do ARN
        const userMatch = principalArn.match(/user\/(.+?)(?::.*)?$/);
        if (userMatch && this.iamService.simulator) {
          const userName = userMatch[1];
          const user = this.iamService.simulator.users?.get(userName);
          
          if (user && user.policies) {
            policies.push(...Array.from(user.policies.values()));
          }
        }
      }

      if (principalType === 'role' || principalType === 'assumed-role') {
        // Extrai nome da role
        const roleMatch = principalArn.match(/role\/(.+?)(?::.*)?$/);
        if (roleMatch) {
          const roleName = roleMatch[1];
          
          // Procura em Organizations roles
          for (const [, role] of this.organizationsSimulator.roles) {
            if (role.name === roleName) {
              // Retorna inline policies
              for (const [, policy] of role.inlinePolicies) {
                policies.push(policy);
              }
              break;
            }
          }

          // Se IAM service disponível, procura lá também
          if (this.iamService && this.iamService.simulator) {
            const role = this.iamService.simulator.roles?.get(roleName);
            if (role) {
              // Retorna policies inline
              if (role.inline_policies) {
                for (const [, policy] of role.inline_policies) {
                  policies.push(policy);
                }
              }
            }
          }
        }
      }

      return policies;
    } catch (error) {
      logger.warn(`Could not get policies for ${principalArn}: ${error.message}`);
      return [];
    }
  }

  /**
   * Verifica se um statement match com a ação/recurso
   */
  statementMatches(statement, action, resource, context = {}) {
    if (!statement.Action || !statement.Resource) {
      return false;
    }

    // Verifica Action
    const actionMatches = this.patternMatches(statement.Action, action);
    if (!actionMatches) {
      return false;
    }

    // Verifica Resource
    const resourceMatches = this.patternMatches(statement.Resource, resource);
    if (!resourceMatches) {
      return false;
    }

    // Verifica Condition se houver
    if (statement.Condition) {
      return this.evaluateCondition(statement.Condition, context);
    }

    return true;
  }

  /**
   * Verifica se padrão (com wildcards) match
   */
  patternMatches(pattern, value) {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    
    for (const p of patterns) {
      if (p === '*') {
        return true;
      }
      
      const regex = new RegExp('^' + p.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      if (regex.test(value)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Avalia conditions (versão simplificada)
   */
  evaluateCondition(condition, context = {}) {
    // Implementação simplificada
    // Em produção seria mais complexo com vários operadores
    if (!condition) {
      return true;
    }

    try {
      // Suporta StringEquals, StringLike, etc
      for (const [operator, conditions] of Object.entries(condition)) {
        for (const [key, values] of Object.entries(conditions)) {
          const contextValue = context[key];
          
          if (!contextValue) {
            return false;
          }

          const condValues = Array.isArray(values) ? values : [values];
          
          switch (operator) {
            case 'StringEquals':
              if (!condValues.includes(contextValue)) {
                return false;
              }
              break;
            
            case 'StringLike':
              let matched = false;
              for (const condValue of condValues) {
                const regex = new RegExp('^' + condValue.replace(/\*/g, '.*') + '$');
                if (regex.test(contextValue)) {
                  matched = true;
                  break;
                }
              }
              if (!matched) {
                return false;
              }
              break;
            
            default:
              // Operadores desconhecidos são ignorados
              break;
          }
        }
      }

      return true;
    } catch (error) {
      logger.warn(`Error evaluating condition: ${error.message}`);
      return false;
    }
  }

  /**
   * Avalia AssumeRole - pode o principal assumir a role?
   */
  canAssumeRole(principalArn, roleArn) {
    try {
      // Procura role pelo ARN
      let targetRole = null;

      for (const [, role] of this.organizationsSimulator.roles) {
        if (role.arn === roleArn) {
          targetRole = role;
          break;
        }
      }

      if (!targetRole) {
        return {
          allowed: false,
          reason: 'Role not found'
        };
      }

      // Verifica trust policy
      if (!targetRole.trustPolicy || !targetRole.trustPolicy.Statement) {
        return {
          allowed: false,
          reason: 'No trust policy defined'
        };
      }

      // Valida trust policy
      for (const statement of targetRole.trustPolicy.Statement) {
        if (statement.Effect === 'Allow') {
          if (statement.Principal?.AWS) {
            if (this.patternMatches(statement.Principal.AWS, principalArn)) {
              return {
                allowed: true,
                reason: 'Allowed by trust policy'
              };
            }
          }
          
          if (statement.Principal === '*') {
            return {
              allowed: true,
              reason: 'Allowed by wildcard principal'
            };
          }
        }
      }

      return {
        allowed: false,
        reason: 'Not allowed by trust policy'
      };

    } catch (error) {
      logger.error(`Error checking AssumeRole: ${error.message}`);
      return {
        allowed: false,
        reason: error.message
      };
    }
  }

  /**
   * Gera audit log de avaliação
   */
  auditEvaluation(evaluation) {
    const level = evaluation.allowed ? 'INFO' : 'WARN';
    const message = evaluation.allowed 
      ? `Action allowed: ${evaluation.action} on ${evaluation.resource}`
      : `Action denied: ${evaluation.action} on ${evaluation.resource} - ${evaluation.reason}`;

    logger.log(level, `[Policy Evaluation] ${message} - Principal: ${evaluation.principal}`);
  }
}

module.exports = IAMIntegration;
