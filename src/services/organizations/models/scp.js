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
  evaluateAction(action, resource = '*', context = {}) {
    if (!this.document || !this.document.Statement) {
      return true; // Nenhuma restrição
    }

    // Processa statements na ordem
    for (const statement of this.document.Statement) {
      if (this.matchesStatement(statement, action, resource, context)) {
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
  matchesStatement(statement, action, resource, context = {}) {
    // Verifica Action
    if (!this.matchesPattern(statement.Action, action)) {
      return false;
    }

    // Verifica Resource (se especificado)
    if (statement.Resource && !this.matchesPattern(statement.Resource, resource)) {
      return false;
    }

    // Verifica Condition (se especificado)
    if (statement.Condition && !this.evaluateCondition(statement.Condition, context)) {
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
  /**
   * Avalia o bloco Condition de um statement contra o contexto da requisição
   * (ex.: { 'aws:RequestedRegion': 'us-west-2' }). Todas as chaves precisam bater (AND);
   * dentro de uma chave, qualquer valor da lista basta (OR).
   */
  evaluateCondition(condition, context = {}) {
    for (const [operator, keys] of Object.entries(condition || {})) {
      for (const [key, expected] of Object.entries(keys || {})) {
        if (!this.conditionMatches(operator, key, expected, context)) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Um operador de condição. Chave ausente no contexto: operadores positivos não batem e
   * operadores negativos (StringNotEquals, StringNotLike) batem, como na AWS.
   * Operadores não suportados não batem (o statement não se aplica).
   */
  conditionMatches(operator, key, expected, context) {
    const values = (Array.isArray(expected) ? expected : [expected]).map(String);
    const present = Object.prototype.hasOwnProperty.call(context, key) && context[key] !== undefined;
    const actual = present ? String(context[key]) : null;

    switch (operator) {
      case 'StringEquals':
        return present && values.some(v => actual === v);
      case 'StringNotEquals':
        return !present || values.every(v => actual !== v);
      case 'StringLike':
        return present && values.some(v => this.matchesWildcard(v, actual));
      case 'StringNotLike':
        return !present || values.every(v => !this.matchesWildcard(v, actual));
      case 'Bool':
        return present && values.some(v => actual.toLowerCase() === v.toLowerCase());
      default:
        return false;
    }
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
