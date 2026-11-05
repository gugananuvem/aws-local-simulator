/**
 * AWS Organizations - Organization Model
 * Representa a raiz da organização e gerencia estrutura hierárquica
 */

const { v4: uuidv4 } = require('uuid');
const ServiceControlPolicy = require('./scp');

class Organization {
  constructor(config = {}) {
    this.id = config.id || uuidv4().substring(0, 12);
    this.arn = config.arn || `arn:aws:organizations::123456789012:organization/o-${this.id}`;
    this.rootId = config.rootId || `r-${uuidv4().substring(0, 4)}`;
    this.masterAccountId = config.masterAccountId || '123456789012';
    this.masterAccountArn = config.masterAccountArn ||
      `arn:aws:organizations::123456789012:account/o-${this.id}/${this.masterAccountId}`;
    this.masterAccountEmail = config.masterAccountEmail || 'master@example.com';
    this.masterAccountName = config.masterAccountName || 'Master Account';

    this.createdAt = config.createdAt || new Date().toISOString();
    this.status = config.status || 'ACTIVE';
    this.featureSet = config.featureSet || 'ALL'; // ALL ou CONSOLIDATED_BILLING

    // Contas da organização
    this.accounts = new Map();
    this.accountCount = 1; // Conta master

    // OUs (Organizational Units)
    this.ous = new Map();
    this.ous.set(this.rootId, {
      id: this.rootId,
      name: 'Root',
      arn: `arn:aws:organizations::123456789012:ou/o-${this.id}/${this.rootId}`,
      parentId: null,
      children: []
    });

    // Policies (SCPs, Tag Policies, etc)
    this.policies = new Map();
    this.policyTargets = new Map(); // Mapear policy -> targets

    // Policy types habilitados na organização (mapa Type -> Status).
    // SERVICE_CONTROL_POLICY (SCP) já vem habilitado ao criar a organização.
    this.policyTypes = new Map();
    const enabledTypes = Array.isArray(config.policyTypes) && config.policyTypes.length > 0
      ? config.policyTypes
      : ['SERVICE_CONTROL_POLICY'];
    for (const entry of enabledTypes) {
      const type = typeof entry === 'string' ? entry : entry?.Type;
      const status = typeof entry === 'string' ? 'ENABLED' : (entry?.Status || 'ENABLED');
      if (type) this.policyTypes.set(type, status);
    }

    // Trusted access: serviços integrados habilitados (mapa Principal -> DateEnabled ISO).
    this.serviceAccess = new Map();
    const enabledServices = Array.isArray(config.serviceAccess) ? config.serviceAccess : [];
    for (const entry of enabledServices) {
      const principal = typeof entry === 'string' ? entry : entry?.ServicePrincipal;
      const dateEnabled = typeof entry === 'string'
        ? new Date().toISOString()
        : (entry?.DateEnabled || new Date().toISOString());
      if (principal) this.serviceAccess.set(principal, dateEnabled);
    }

    // Cria conta master
    this.createMasterAccount();
  }

  /**
   * Cria a conta master
   */
  createMasterAccount() {
    const masterAccount = {
      id: this.masterAccountId,
      arn: this.masterAccountArn,
      email: this.masterAccountEmail,
      name: this.masterAccountName,
      status: 'ACTIVE',
      type: 'MASTER',
      parentId: this.rootId,
      createdAt: this.createdAt,
      joinedMethod: 'CREATED'
    };

    this.accounts.set(this.masterAccountId, masterAccount);
  }

  /**
   * Cria uma nova OU
   */
  createOrganizationalUnit(parentId, name, config = {}) {
    if (!this.ous.has(parentId)) {
      throw new Error(`Parent OU '${parentId}' not found`);
    }

    const ouId = `ou-${uuidv4().substring(0, 8)}`;
    const ou = {
      id: ouId,
      name: name,
      arn: `arn:aws:organizations::123456789012:ou/o-${this.id}/${ouId}`,
      parentId: parentId,
      children: [],
      createdAt: new Date().toISOString()
    };

    this.ous.set(ouId, ou);

    const parent = this.ous.get(parentId);
    if (parent) parent.children.push(ouId);

    return ou;
  }

  /**
   * Obtém OU por ID
   */
  getOrganizationalUnit(ouId) {
    return this.ous.get(ouId);
  }

  /**
   * Lista OUs filhas de um parent
   */
  listOrganizationalUnitsForParent(parentId) {
    return Array.from(this.ous.values()).filter(ou => ou.parentId === parentId);
  }

  /**
   * Cria uma nova conta
   */
  createAccount(email, accountName, config = {}) {
    for (const acc of this.accounts.values()) {
      if (acc.email === email) {
        throw new Error(`Account with email '${email}' already exists`);
      }
    }

    const accountId = config.accountId || Math.floor(100000000000 + Math.random() * 899999999999).toString();
    const parentOUId = config.parentOUId || this.rootId;

    if (!this.ous.has(parentOUId)) {
      throw new Error(`Parent OU '${parentOUId}' not found`);
    }

    const account = {
      id: accountId,
      arn: `arn:aws:organizations::123456789012:account/o-${this.id}/${accountId}`,
      email: email,
      name: accountName,
      status: config.status || 'ACTIVE',
      type: 'MEMBER',
      parentId: parentOUId,
      createdAt: new Date().toISOString(),
      joinedMethod: config.joinedMethod || 'CREATED',
      roleName: config.roleName || 'OrganizationAccountAccessRole',
      tags: config.tags || []
    };

    this.accounts.set(accountId, account);
    this.accountCount++;

    const parent = this.ous.get(parentOUId);
    if (parent && !parent.children.includes(accountId)) parent.children.push(accountId);

    return account;
  }

  /**
   * Move uma conta para outra OU
   */
  moveAccount(accountId, newParentId) {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account '${accountId}' not found`);
    }

    const newParent = this.ous.get(newParentId);
    if (!newParent) {
      throw new Error(`Target OU '${newParentId}' not found`);
    }

    const oldParent = this.ous.get(account.parentId);
    if (oldParent) {
      oldParent.children = oldParent.children.filter(id => id !== accountId);
    }

    account.parentId = newParentId;
    if (!newParent.children.includes(accountId)) newParent.children.push(accountId);

    return account;
  }

  /**
   * Remove uma conta
   */
  removeAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account '${accountId}' not found`);
    }
    if (account.type === 'MASTER') {
      throw new Error('The management account cannot be removed from the organization');
    }

    const parent = this.ous.get(account.parentId);
    if (parent) parent.children = parent.children.filter(id => id !== accountId);

    this.accounts.delete(accountId);
    this.accountCount--;

    return account;
  }

  /**
   * Obtém conta por ID
   */
  getAccount(accountId) {
    return this.accounts.get(accountId);
  }

  /**
   * Lista todas as contas
   */
  listAccounts() {
    return Array.from(this.accounts.values());
  }

  /**
   * Lista contas filhas de um parent
   */
  listAccountsForParent(parentId) {
    return Array.from(this.accounts.values()).filter(acc => acc.parentId === parentId);
  }

  /**
   * Remove uma OU
   */
  deleteOrganizationalUnit(ouId) {
    const ou = this.ous.get(ouId);
    if (!ou) {
      throw new Error(`OU '${ouId}' not found`);
    }
    if (ou.parentId === null) {
      throw new Error('The root cannot be deleted');
    }

    const childOus = this.listOrganizationalUnitsForParent(ouId);
    if (childOus.length > 0) {
      throw new Error(`OU '${ouId}' has child OUs. Remove them first.`);
    }

    const accountsInOu = this.listAccountsForParent(ouId);
    if (accountsInOu.length > 0) {
      throw new Error(`OU '${ouId}' has accounts. Move them first.`);
    }

    this.ous.delete(ouId);

    if (ou.parentId) {
      const parent = this.ous.get(ou.parentId);
      if (parent) parent.children = parent.children.filter(id => id !== ouId);
    }

    return true;
  }

  /**
   * Cria uma SCP (Service Control Policy)
   */
  createPolicy(name, document, type = 'SERVICE_CONTROL_POLICY', config = {}) {
    const policyId = `p-${uuidv4().substring(0, 8)}`;

    // Usa o modelo SCP para ter evaluateAction/matchesPattern disponíveis.
    const policy = new ServiceControlPolicy(name, document, config);
    policy.id = policyId;
    policy.arn = `arn:aws:organizations::123456789012:policy/o-${this.id}/service_control_policy/${policyId}`;
    policy.type = type;
    policy.targets = [];

    this.policies.set(policyId, policy);
    this.policyTargets.set(policyId, []);

    return policy;
  }

  /**
   * Obtém policy por ID
   */
  getPolicy(policyId) {
    return this.policies.get(policyId);
  }

  /**
   * Lista policies
   */
  listPolicies(type) {
    return Array.from(this.policies.values())
      .filter(p => !type || p.type === type);
  }

  /**
   * Lista os policy types habilitados na raiz (formato da API ListRoots).
   */
  listPolicyTypes() {
    // A API ListRoots devolve apenas os tipos habilitados.
    return Array.from(this.policyTypes.entries())
      .filter(([, Status]) => Status === 'ENABLED')
      .map(([Type, Status]) => ({ Type, Status }));
  }

  /**
   * Verifica se um policy type está habilitado.
   */
  isPolicyTypeEnabled(type) {
    return this.policyTypes.get(type) === 'ENABLED';
  }

  /**
   * Habilita um policy type (EnablePolicyType).
   */
  enablePolicyType(type) {
    if (!type) throw new Error('PolicyType is required');
    this.policyTypes.set(type, 'ENABLED');
    return { Type: type, Status: 'ENABLED' };
  }

  /**
   * Desabilita um policy type (DisablePolicyType).
   */
  disablePolicyType(type) {
    if (!type) throw new Error('PolicyType is required');
    this.policyTypes.delete(type);
    return { Type: type, Status: 'DISABLED' };
  }

  /**
   * Lista os serviços com trusted access habilitado (EnableAWSServiceAccess).
   */
  listServiceAccess() {
    return Array.from(this.serviceAccess.entries()).map(([ServicePrincipal, DateEnabled]) => ({
      ServicePrincipal,
      DateEnabled
    }));
  }

  /**
   * Verifica se um serviço está com trusted access habilitado.
   */
  isServiceAccessEnabled(principal) {
    return this.serviceAccess.has(principal);
  }

  /**
   * Habilita trusted access de um serviço (EnableAWSServiceAccess).
   */
  enableServiceAccess(principal) {
    if (!principal) throw new Error('ServicePrincipal is required');
    const dateEnabled = this.serviceAccess.get(principal) || new Date().toISOString();
    this.serviceAccess.set(principal, dateEnabled);
    return { ServicePrincipal: principal, DateEnabled: dateEnabled };
  }

  /**
   * Desabilita trusted access de um serviço (DisableAWSServiceAccess).
   */
  disableServiceAccess(principal) {
    if (!principal) throw new Error('ServicePrincipal is required');
    this.serviceAccess.delete(principal);
    return { ServicePrincipal: principal };
  }

  /**
   * Anexa policy a um target (OU ou Account)
   */
  attachPolicy(policyId, targetId) {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy '${policyId}' not found`);
    }

    const ou = this.ous.get(targetId);
    const account = this.accounts.get(targetId);

    if (!ou && !account) {
      throw new Error(`Target '${targetId}' not found`);
    }

    const targets = this.policyTargets.get(policyId) || [];
    if (!targets.includes(targetId)) {
      targets.push(targetId);
      this.policyTargets.set(policyId, targets);
      policy.targets = targets;
    }

    return policy;
  }

  /**
   * Desanexa policy de um target
   */
  detachPolicy(policyId, targetId) {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy '${policyId}' not found`);
    }

    const targets = this.policyTargets.get(policyId) || [];
    const index = targets.indexOf(targetId);

    if (index > -1) {
      targets.splice(index, 1);
      policy.targets = targets;
    }

    return policy;
  }

  /**
   * Lista policies anexadas a um target
   */
  listPoliciesForTarget(targetId, type = 'SERVICE_CONTROL_POLICY') {
    const policies = [];

    for (const [policyId, policy] of this.policies) {
      if (policy.type === type) {
        const targets = this.policyTargets.get(policyId) || policy.targets || [];
        if (targets.includes(targetId)) {
          policies.push(policy);
        }
      }
    }

    return policies;
  }

  /**
   * Descreve a organização
   */
  describe() {
    return {
      Organization: {
        Id: this.id,
        Arn: this.arn,
        RootId: this.rootId,
        MasterAccountId: this.masterAccountId,
        MasterAccountArn: this.masterAccountArn,
        MasterAccountEmail: this.masterAccountEmail,
        CreatedAt: this.createdAt,
        Status: this.status,
        FeatureSet: this.featureSet
      }
    };
  }

  /**
   * Snapshot serializável para persistência (mesmo padrão JSON do IAM).
   */
  toSnapshot() {
    return {
      id: this.id,
      arn: this.arn,
      rootId: this.rootId,
      masterAccountId: this.masterAccountId,
      masterAccountArn: this.masterAccountArn,
      masterAccountEmail: this.masterAccountEmail,
      masterAccountName: this.masterAccountName,
      createdAt: this.createdAt,
      status: this.status,
      featureSet: this.featureSet,
      accounts: Array.from(this.accounts.values()),
      ous: Array.from(this.ous.values()),
      policies: Array.from(this.policies.values()),
      policyTypes: this.listPolicyTypes(),
      serviceAccess: this.listServiceAccess()
    };
  }

  /**
   * Reconstrói a organização a partir de um snapshot persistido.
   */
  static fromSnapshot(snapshot) {
    if (!snapshot || !snapshot.id) return new Organization();

    const organization = new Organization({
      id: snapshot.id,
      arn: snapshot.arn,
      rootId: snapshot.rootId,
      masterAccountId: snapshot.masterAccountId,
      masterAccountArn: snapshot.masterAccountArn,
      masterAccountEmail: snapshot.masterAccountEmail,
      masterAccountName: snapshot.masterAccountName,
      createdAt: snapshot.createdAt,
      status: snapshot.status,
      featureSet: snapshot.featureSet,
      policyTypes: snapshot.policyTypes,
      serviceAccess: snapshot.serviceAccess
    });

    if (Array.isArray(snapshot.ous) && snapshot.ous.length > 0) {
      organization.ous = new Map(snapshot.ous.map(ou => [ou.id, ou]));
    }
    if (Array.isArray(snapshot.accounts) && snapshot.accounts.length > 0) {
      organization.accounts = new Map(snapshot.accounts.map(a => [a.id, a]));
    }
    if (Array.isArray(snapshot.policies)) {
      organization.policies = new Map();
      organization.policyTargets = new Map();
      for (const stored of snapshot.policies) {
        // Reidrata como instância de SCP para preservar evaluateAction().
        const policy = new ServiceControlPolicy(stored.name, stored.document, {
          awsManaged: stored.awsManaged
        });
        policy.id = stored.id;
        policy.arn = stored.arn;
        policy.type = stored.type || 'SERVICE_CONTROL_POLICY';
        policy.status = stored.status || 'ACTIVE';
        policy.createdAt = stored.createdAt || policy.createdAt;
        policy.lastModifiedAt = stored.lastModifiedAt || policy.createdAt;
        policy.targets = stored.targets || [];

        organization.policies.set(policy.id, policy);
        organization.policyTargets.set(policy.id, policy.targets);
      }
    }
    organization.accountCount = organization.accounts.size;

    // Reparações defensivas: garante root existente e sem duplicidade nos children.
    if (!organization.ous.has(organization.rootId)) {
      organization.ous.set(organization.rootId, {
        id: organization.rootId,
        name: 'Root',
        arn: `arn:aws:organizations::123456789012:ou/o-${organization.id}/${organization.rootId}`,
        parentId: null,
        children: []
      });
    }
    for (const ou of organization.ous.values()) {
      const childOus = organization.listOrganizationalUnitsForParent(ou.id).map(o => o.id);
      const childAccounts = organization.listAccountsForParent(ou.id).map(a => a.id);
      ou.children = [...childOus, ...childAccounts];
    }

    return organization;
  }

  toJSON() {
    return {
      id: this.id,
      arn: this.arn,
      rootId: this.rootId,
      masterAccountId: this.masterAccountId,
      masterAccountEmail: this.masterAccountEmail,
      masterAccountName: this.masterAccountName,
      createdAt: this.createdAt,
      status: this.status,
      featureSet: this.featureSet,
      accountCount: this.accountCount,
      ouCount: this.ous.size,
      policyCount: this.policies.size,
      policyTypes: this.listPolicyTypes(),
      serviceAccess: this.listServiceAccess()
    };
  }
}

module.exports = Organization;
