/**
 * AWS Organizations - SCP (Service Control Policy) Model
 * Gerencia policies de controle de serviços com suporte a Allow/Deny
 */

const { v4: uuidv4 } = require('uuid');

class ServiceControlPolicy {
  constructor(name, document, config = {}) {
    this.id = uuidv4().substring(0, 8);
    this.name = name;
    this.document = document; // JSON policy document
    this.type = 'SERVICE_CONTROL_POLICY';
    this.status = 'ACTIVE';
    this.createdAt = new Date().toISOString();
    this.lastModifiedAt = new Date().toISOString();
    
    // Targets (OUs, Accounts)
    this.targets = [];
    
    // Metadados
    this.awsManaged = config.awsManaged || false;
    this.customerManaged = !this.awsManaged;
    this.policyArn = `arn:aws:organizations::123456789012:policy/o-xxxxxxxxxx/service_control_policy/p-${this.id}`;
  }

  /**
   * Valida se uma ação é permitida por esta policy
   */
  evaluateAction(action, resource = '*') {
    if (!this.document || !this.document.Statement) {
      return true; // Nenhuma restrição
    }

    // Processa statements na ordem
    for (const statement of this.document.Statement) {
      if (this.matchesStatement(statement, action, resource)) {
        // Se Effect é Deny, a ação é bloqueada
        if (statement.Effect === 'Deny') {
          return false;
        }
        // Se Effect é Allow, a ação é permitida
        if (statement.Effect === 'Allow') {
          return true;
        }
      }
    }

    // Se não encontrou Deny, é permitido por padrão
    return true;
  }

  /**
   * Verifica se um statement match com a ação
   */
  matchesStatement(statement, action, resource) {
    // Verifica Action
    if (!this.matchesPattern(statement.Action, action)) {
      return false;
    }

    // Verifica Resource (se especificado)
    if (statement.Resource && !this.matchesPattern(statement.Resource, resource)) {
      return false;
    }

    // Verifica Condition (se especificado)
    if (statement.Condition && !this.evaluateCondition(statement.Condition)) {
      return false;
    }

    return true;
  }

  /**
   * Verifica se um padrão match com um valor
   */
  matchesPattern(pattern, value) {
    if (!pattern) return true;
    
    if (typeof pattern === 'string') {
      return this.matchesWildcard(pattern, value);
    }

    if (Array.isArray(pattern)) {
      return pattern.some(p => this.matchesWildcard(p, value));
    }

    return false;
  }

  /**
   * Suporta wildcards: * e ?
   */
  matchesWildcard(pattern, value) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return regex.test(value);
  }

  /**
   * Avalia condições (versão simplificada)
   */
  evaluateCondition(condition) {
    // Suporte básico a StringEquals, StringLike, etc
    return true; // Por enquanto aceita tudo
  }

  /**
   * Atualiza o documento da policy
   */
  updateDocument(newDocument) {
    this.document = newDocument;
    this.lastModifiedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      createdAt: this.createdAt,
      lastModifiedAt: this.lastModifiedAt,
      awsManaged: this.awsManaged,
      targetCount: this.targets.length,
      statementCount: this.document?.Statement?.length || 0
    };
  }
}

module.exports = ServiceControlPolicy;
