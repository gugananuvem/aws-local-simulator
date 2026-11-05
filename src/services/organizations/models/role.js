/**
 * AWS Organizations - Role Model
 * Integração com IAM para gerenciar roles em contas diferentes
 */

const { v4: uuidv4 } = require('uuid');

class OrganizationRole {
  constructor(roleName, trustPolicy, config = {}) {
    this.id = uuidv4().substring(0, 8);
    this.name = roleName;
    this.arn = `arn:aws:iam::${config.accountId || '123456789012'}:role/${roleName}`;
    this.pathPrefix = config.pathPrefix || '/';
    
    // Trust Policy (AssumeRolePolicyDocument)
    this.trustPolicy = trustPolicy;
    
    // Policies inline
    this.inlinePolicies = new Map();
    
    // Managed policies anexadas
    this.managedPolicies = [];
    
    // Metadados
    this.createdAt = new Date().toISOString();
    this.lastModifiedAt = new Date().toISOString();
    this.accountId = config.accountId || '123456789012';
    this.maxSessionDuration = config.maxSessionDuration || 3600;
    this.description = config.description || '';
    
    // Permissões efetivas calculadas
    this.effectivePermissions = new Map();
  }

  /**
   * Adiciona uma inline policy
   */
  putInlinePolicy(policyName, policyDocument) {
    this.inlinePolicies.set(policyName, {
      name: policyName,
      document: policyDocument,
      createdAt: new Date().toISOString()
    });

    this.lastModifiedAt = new Date().toISOString();
    this.recalculateEffectivePermissions();
    
    return true;
  }

  /**
   * Remove uma inline policy
   */
  deleteInlinePolicy(policyName) {
    const deleted = this.inlinePolicies.delete(policyName);
    
    if (deleted) {
      this.lastModifiedAt = new Date().toISOString();
      this.recalculateEffectivePermissions();
    }

    return deleted;
  }

  /**
   * Obtém inline policy
   */
  getInlinePolicy(policyName) {
    return this.inlinePolicies.get(policyName);
  }

  /**
   * Lista inline policies
   */
  listInlinePolicies() {
    return Array.from(this.inlinePolicies.values());
  }

  /**
   * Anexa managed policy
   */
  attachManagedPolicy(policyArn) {
    if (!this.managedPolicies.includes(policyArn)) {
      this.managedPolicies.push(policyArn);
      this.lastModifiedAt = new Date().toISOString();
      this.recalculateEffectivePermissions();
    }

    return true;
  }

  /**
   * Desanexa managed policy
   */
  detachManagedPolicy(policyArn) {
    const index = this.managedPolicies.indexOf(policyArn);
    
    if (index > -1) {
      this.managedPolicies.splice(index, 1);
      this.lastModifiedAt = new Date().toISOString();
      this.recalculateEffectivePermissions();
      return true;
    }

    return false;
  }

  /**
   * Lista managed policies
   */
  listManagedPolicies() {
    return this.managedPolicies;
  }

  /**
   * Atualiza trust policy
   */
  updateTrustPolicy(newTrustPolicy) {
    this.trustPolicy = newTrustPolicy;
    this.lastModifiedAt = new Date().toISOString();
  }

  /**
   * Calcula permissões efetivas combinando inline + managed
   */
  recalculateEffectivePermissions() {
    this.effectivePermissions.clear();

    // Processa inline policies
    for (const [policyName, policy] of this.inlinePolicies) {
      if (policy.document && policy.document.Statement) {
        for (const statement of policy.document.Statement) {
          this.addStatementToEffectivePermissions(statement);
        }
      }
    }

    // Managed policies seriam processadas aqui se disponíveis
    // Por enquanto apenas rastreamos os ARNs
  }

  /**
   * Adiciona statement às permissões efetivas
   */
  addStatementToEffectivePermissions(statement) {
    if (!statement.Action) return;

    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
    const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource || '*'];

    for (const action of actions) {
      for (const resource of resources) {
        const key = `${action}:${resource}`;
        this.effectivePermissions.set(key, {
          action,
          resource,
          effect: statement.Effect,
          condition: statement.Condition
        });
      }
    }
  }

  /**
   * Verifica se uma ação é permitida
   */
  canPerformAction(action, resource = '*') {
    // Verifica inline policies
    for (const [policyName, policy] of this.inlinePolicies) {
      if (policy.document && policy.document.Statement) {
        for (const statement of policy.document.Statement) {
          if (this.matchesStatement(statement, action, resource)) {
            if (statement.Effect === 'Allow') {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Verifica se um statement match
   */
  matchesStatement(statement, action, resource) {
    if (!statement.Action) return false;

    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
    const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource || '*'];

    const actionMatch = actions.some(a => this.matchesWildcard(a, action));
    const resourceMatch = resources.some(r => this.matchesWildcard(r, resource));

    return actionMatch && resourceMatch;
  }

  /**
   * Suporta wildcards
   */
  matchesWildcard(pattern, value) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return regex.test(value);
  }

  /**
   * Assume role - valida trust policy
   */
  canAssumeRole(principalArn, principalType = 'AWS') {
    if (!this.trustPolicy || !this.trustPolicy.Statement) {
      return false;
    }

    for (const statement of this.trustPolicy.Statement) {
      if (statement.Effect !== 'Allow') continue;
      if (statement.Principal?.AWS && this.matchesWildcard(statement.Principal.AWS, principalArn)) {
        return true;
      }
      if (statement.Principal === '*') {
        return true;
      }
    }

    return false;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      arn: this.arn,
      accountId: this.accountId,
      createdAt: this.createdAt,
      lastModifiedAt: this.lastModifiedAt,
      inlinePoliciesCount: this.inlinePolicies.size,
      managedPoliciesCount: this.managedPolicies.length,
      maxSessionDuration: this.maxSessionDuration,
      description: this.description
    };
  }
}

module.exports = OrganizationRole;
