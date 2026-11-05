/**
 * AWS Organizations Simulator
 * Gerencia organização, contas, OUs, policies e convites (handshakes).
 *
 * Persistência: um arquivo JSON por coleção em <dataDir>/organizations,
 * no mesmo padrão do IAM Simulator (`_persist()`/`_load()`).
 */

const Organization = require('./models/organization');
const Invitation = require('./models/invitation');
const OrganizationRole = require('./models/role');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');
const path = require('path');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');

// Entidades persistidas (uma coleção por arquivo JSON).
const FILE_MAP = {
  metadata: '__organization__.json',
  accounts: '__accounts__.json',
  ous: '__ous__.json',
  policies: '__policies__.json',
  roles: '__roles__.json',
  invitations: '__invitations__.json',
  serviceAccess: '__service-access__.json',
};

class OrganizationsSimulator {
  constructor(config) {
    this.config = config;
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'organizations');

    this.store = new LocalStore(this.dataDir);
    this.organization = null;
    this.roles = new Map();
    this.invitations = new Map();
    this.audit = new CloudTrailAudit('organizations.amazonaws.com');

    // Mutexes para thread safety
    this._orgLock = Promise.resolve();
  }

  /**
   * Executa operação com lock
   */
  async _withOrgLock(fn) {
    const prev = this._orgLock;
    const next = prev.then(() => fn());
    this._orgLock = next.catch(() => {});
    return next;
  }

  async initialize() {
    logger.debug('Inicializando Organizations Simulator...');

    await this._load();

    logger.debug(
      `✅ Organizations Simulator inicializado — org ${this.organization.id}, ` +
      `${this.organization.accounts.size} contas, ${this.organization.ous.size} OUs, ` +
      `${this.invitations.size} convites`
    );
  }

  // ============ Persistência (padrão IAM) ============

  async _persist() {
    const snapshot = this.organization.toSnapshot();

    this.store.write(FILE_MAP.metadata, {
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
      policyTypes: snapshot.policyTypes
    });
    this.store.write(FILE_MAP.accounts, snapshot.accounts);
    this.store.write(FILE_MAP.ous, snapshot.ous);
    this.store.write(FILE_MAP.policies, snapshot.policies);
    this.store.write(FILE_MAP.roles, Array.from(this.roles.values()).map(r => r.toJSON()));
    this.store.write(FILE_MAP.invitations, Array.from(this.invitations.values()));
    this.store.write(FILE_MAP.serviceAccess, this.organization.listServiceAccess());
  }

  async _load() {
    const metadata = this.store.read(FILE_MAP.metadata);
    const accounts = this.store.read(FILE_MAP.accounts);
    const ous = this.store.read(FILE_MAP.ous);
    const policies = this.store.read(FILE_MAP.policies);
    const serviceAccess = this.store.read(FILE_MAP.serviceAccess);

    const snapshot = {
      ...(metadata && metadata.id ? metadata : {}),
      accounts: Array.isArray(accounts) ? accounts : [],
      ous: Array.isArray(ous) ? ous : [],
      policies: Array.isArray(policies) ? policies : [],
      serviceAccess: Array.isArray(serviceAccess) ? serviceAccess : []
    };

    const isNewOrganization = !snapshot.id;
    this.organization = Organization.fromSnapshot(snapshot);
    if (isNewOrganization) await this._persist();

    this._loadRoles();
    this._loadInvitations();
  }

  /**
   * Compatibilidade: mantém o nome antigo usado por chamadores existentes.
   */
  persistOrganization() {
    return this._persist();
  }

  _loadRoles() {
    const savedRoles = this.store.read(FILE_MAP.roles);
    this.roles = new Map();

    if (!Array.isArray(savedRoles)) return;

    for (const roleData of savedRoles) {
      const role = new OrganizationRole(roleData.name, roleData.trustPolicy, {
        accountId: roleData.accountId
      });
      if (roleData.id) role.id = roleData.id;
      this.roles.set(role.id, role);
    }
  }

  _loadInvitations() {
    const saved = this.store.read(FILE_MAP.invitations);
    this.invitations = new Map();

    if (!Array.isArray(saved)) return;

    for (const data of saved) {
      this.invitations.set(data.id, new Invitation(data));
    }
  }

  // ============ Organizations ============

  describeOrganization() {
    return this.organization.describe();
  }

  listRoots() {
    return { Roots: [this.getRoot()] };
  }

  /** Raiz da organização no formato da API (com os policy types habilitados). */
  getRoot() {
    return {
      Id: this.organization.rootId,
      Arn: `arn:aws:organizations::123456789012:ou/o-${this.organization.id}/${this.organization.rootId}`,
      Name: 'Root',
      PolicyTypes: this.organization.listPolicyTypes()
    };
  }

  createOrganizationalUnit(parentId, name) {
    const ou = this.organization.createOrganizationalUnit(parentId, name);

    this.persistOrganization();
    this.audit.record({
      eventName: 'CreateOrganizationalUnit',
      readOnly: false,
      resources: [{ ARN: ou.arn, type: 'AWS::Organizations::OrganizationalUnit' }],
      requestParameters: { parentId, name }
    });

    logger.info(`✅ OU criada: ${name}`);

    return { OrganizationalUnit: ou };
  }

  describeOrganizationalUnit(ouId) {
    const ou = this.organization.getOrganizationalUnit(ouId);
    if (!ou) throw new Error(`OU '${ouId}' not found`);

    return { OrganizationalUnit: ou };
  }

  listOrganizationalUnitsForParent(parentId) {
    const parent = this.organization.getOrganizationalUnit(parentId);
    if (!parent) throw new Error(`Parent OU '${parentId}' not found`);

    return { OrganizationalUnits: this.organization.listOrganizationalUnitsForParent(parentId) };
  }

  deleteOrganizationalUnit(ouId) {
    this.organization.deleteOrganizationalUnit(ouId);
    this.persistOrganization();

    logger.info(`✅ OU removida: ${ouId}`);
    return {};
  }

  // ============ Contas ============

  createAccount(email, accountName, config = {}) {
    const account = this.organization.createAccount(email, accountName, {
      parentOUId: config.parentOUId || this.organization.rootId,
      roleName: config.roleName,
      tags: config.tags
    });

    this.persistOrganization();
    this.audit.record({
      eventName: 'CreateAccount',
      readOnly: false,
      resources: [{ ARN: account.arn, type: 'AWS::Organizations::Account' }],
      requestParameters: { email, accountName }
    });

    logger.info(`✅ Conta criada: ${email}`);

    return {
      CreateAccountStatus: {
        Id: `car-${account.id}`,
        AccountName: accountName,
        State: 'SUCCEEDED',
        RequestedTimestamp: Math.floor(Date.now() / 1000),
        CompletedTimestamp: Math.floor(Date.now() / 1000),
        AccountId: account.id
      }
    };
  }

  listAccounts() {
    return { Accounts: this.organization.listAccounts() };
  }

  listAccountsForParent(parentId) {
    return { Accounts: this.organization.listAccountsForParent(parentId) };
  }

  describeAccount(accountId) {
    const account = this.organization.getAccount(accountId);
    if (!account) throw new Error(`Account '${accountId}' not found`);

    return { Account: account };
  }

  moveAccount(accountId, sourceParentId, destinationParentId) {
    const account = this.organization.moveAccount(accountId, destinationParentId);

    this.persistOrganization();
    this.audit.record({
      eventName: 'MoveAccount',
      readOnly: false,
      resources: [{ ARN: account.arn, type: 'AWS::Organizations::Account' }],
      requestParameters: { accountId, destinationParentId }
    });

    logger.info(`✅ Conta movida: ${accountId} -> ${destinationParentId}`);

    return {};
  }

  removeAccountFromOrganization(accountId) {
    const account = this.organization.removeAccount(accountId);

    this.persistOrganization();
    this.audit.record({
      eventName: 'RemoveAccountFromOrganization',
      readOnly: false,
      resources: [{ ARN: account.arn, type: 'AWS::Organizations::Account' }],
      requestParameters: { accountId }
    });

    return {};
  }

  // ============ Policies ============

  createPolicy(name, document, type = 'SERVICE_CONTROL_POLICY') {
    const policy = this.organization.createPolicy(name, document, type);

    this.persistOrganization();
    this.audit.record({
      eventName: 'CreatePolicy',
      readOnly: false,
      resources: [{ ARN: policy.arn, type: 'AWS::Organizations::Policy' }],
      requestParameters: { name, type }
    });

    logger.info(`✅ Policy criada: ${name}`);

    return { Policy: { PolicySummary: policy, Content: JSON.stringify(policy.document) } };
  }

  describePolicy(policyId) {
    const policy = this.organization.getPolicy(policyId);
    if (!policy) throw new Error(`Policy '${policyId}' not found`);

    return {
      Policy: {
        PolicySummary: policy,
        Content: JSON.stringify(policy.document)
      }
    };
  }

  listPolicies(type = 'SERVICE_CONTROL_POLICY') {
    const policies = this.organization.listPolicies(type);

    return { Policies: policies.map(p => ({ PolicySummary: p })) };
  }

  /** Lista os policy types habilitados na raiz. */
  listPolicyTypes() {
    return { PolicyTypes: this.organization.listPolicyTypes() };
  }

  /** Habilita um policy type (EnablePolicyType). */
  enablePolicyType(type) {
    const result = this.organization.enablePolicyType(type);

    this.persistOrganization();
    this.audit.record({
      eventName: 'EnablePolicyType',
      readOnly: false,
      resources: [{ ARN: this.getRoot().Arn, type: 'AWS::Organizations::Root' }],
      requestParameters: { policyType: type }
    });

    logger.info(`✅ Policy type habilitado: ${type}`);

    return result;
  }

  /** Desabilita um policy type (DisablePolicyType). */
  disablePolicyType(type) {
    const result = this.organization.disablePolicyType(type);

    this.persistOrganization();
    this.audit.record({
      eventName: 'DisablePolicyType',
      readOnly: false,
      resources: [{ ARN: this.getRoot().Arn, type: 'AWS::Organizations::Root' }],
      requestParameters: { policyType: type }
    });

    logger.info(`✅ Policy type desabilitado: ${type}`);

    return result;
  }

  /** Lista os serviços com trusted access habilitado. */
  listServiceAccess() {
    return { EnabledServicePrincipals: this.organization.listServiceAccess() };
  }

  /** Habilita trusted access de um serviço (EnableAWSServiceAccess). */
  enableServiceAccess(principal) {
    const result = this.organization.enableServiceAccess(principal);

    this.persistOrganization();
    this.audit.record({
      eventName: 'EnableAWSServiceAccess',
      readOnly: false,
      resources: [{ ARN: `arn:aws:organizations::123456789012:organization/o-${this.organization.id}`, type: 'AWS::Organizations::Organization' }],
      requestParameters: { servicePrincipal: principal }
    });

    logger.info(`✅ Trusted access habilitado: ${principal}`);

    return result;
  }

  /** Desabilita trusted access de um serviço (DisableAWSServiceAccess). */
  disableServiceAccess(principal) {
    const result = this.organization.disableServiceAccess(principal);

    this.persistOrganization();
    this.audit.record({
      eventName: 'DisableAWSServiceAccess',
      readOnly: false,
      resources: [{ ARN: `arn:aws:organizations::123456789012:organization/o-${this.organization.id}`, type: 'AWS::Organizations::Organization' }],
      requestParameters: { servicePrincipal: principal }
    });

    logger.info(`✅ Trusted access desabilitado: ${principal}`);

    return result;
  }

  deletePolicy(policyId) {
    const policy = this.organization.getPolicy(policyId);
    if (!policy) throw new Error(`Policy '${policyId}' not found`);

    this.organization.policies.delete(policyId);
    this.organization.policyTargets.delete(policyId);
    this.persistOrganization();

    return {};
  }

  attachPolicy(policyId, targetId) {
    const policy = this.organization.attachPolicy(policyId, targetId);

    this.persistOrganization();
    this.audit.record({
      eventName: 'AttachPolicy',
      readOnly: false,
      resources: [{ ARN: policy.arn, type: 'AWS::Organizations::Policy' }],
      requestParameters: { policyId, targetId }
    });

    logger.info(`✅ Policy anexada: ${policyId} -> ${targetId}`);

    return {};
  }

  detachPolicy(policyId, targetId) {
    const policy = this.organization.detachPolicy(policyId, targetId);

    this.persistOrganization();
    this.audit.record({
      eventName: 'DetachPolicy',
      readOnly: false,
      resources: [{ ARN: policy.arn, type: 'AWS::Organizations::Policy' }],
      requestParameters: { policyId, targetId }
    });

    logger.info(`✅ Policy desanexada: ${policyId} -> ${targetId}`);

    return {};
  }

  listPoliciesForTarget(targetId, type = 'SERVICE_CONTROL_POLICY') {
    const policies = this.organization.listPoliciesForTarget(targetId, type);

    return { Policies: policies.map(p => ({ PolicySummary: p })) };
  }

  /**
   * Avalia se uma ação é permitida por SCPs
   */
  evaluateSCPs(accountId, action, resource = '*') {
    const account = this.organization.getAccount(accountId);
    if (!account) throw new Error(`Account '${accountId}' not found`);

    const applicablePolicies = [];

    let currentOUId = account.parentId;
    while (currentOUId) {
      applicablePolicies.push(
        ...this.organization.listPoliciesForTarget(currentOUId, 'SERVICE_CONTROL_POLICY')
      );
      const ou = this.organization.getOrganizationalUnit(currentOUId);
      currentOUId = ou?.parentId;
    }

    applicablePolicies.push(
      ...this.organization.listPoliciesForTarget(accountId, 'SERVICE_CONTROL_POLICY')
    );

    for (const policy of applicablePolicies) {
      if (!policy.evaluateAction(action, resource)) {
        return { allowed: false, deniedBy: [policy.name], action, resource };
      }
    }

    return { allowed: true, action, resource };
  }

  // ============ Convites (Handshakes) ============

  inviteAccount(email, config = {}) {
    if (!email) throw new Error('Email is required to invite an account');

    const invitation = new Invitation({
      organizationId: this.organization.id,
      email,
      accountId: config.accountId || null,
      message: config.message || ''
    });

    this.invitations.set(invitation.id, invitation);
    this.persistOrganization();
    this.audit.record({
      eventName: 'InviteAccountToOrganization',
      readOnly: false,
      resources: [{ ARN: `arn:aws:organizations::123456789012:handshake/o-${this.organization.id}/invite/${invitation.id}`, type: 'AWS::Organizations::Handshake' }],
      requestParameters: { email }
    });

    logger.info(`✅ Convite enviado para: ${email}`);

    return { Handshake: invitation.toHandshake() };
  }

  listInvitations() {
    return { Handshakes: Array.from(this.invitations.values()).map(i => i.toHandshake()) };
  }

  describeInvitation(handshakeId) {
    const invitation = this.invitations.get(handshakeId);
    if (!invitation) throw new Error(`Handshake '${handshakeId}' not found`);

    return { Handshake: invitation.toHandshake() };
  }

  cancelInvitation(handshakeId) {
    const invitation = this.invitations.get(handshakeId);
    if (!invitation) throw new Error(`Handshake '${handshakeId}' not found`);
    if (invitation.state !== 'REQUESTED') {
      throw new Error(`Handshake '${handshakeId}' is not in REQUESTED state`);
    }

    invitation.state = 'CANCELED';
    invitation.completedTimestamp = Math.floor(Date.now() / 1000);
    this.invitations.set(invitation.id, invitation);
    this.persistOrganization();

    logger.info(`✅ Convite cancelado: ${invitation.email}`);

    return { Handshake: invitation.toHandshake() };
  }

  // ============ Roles ============

  createRole(roleName, trustPolicy, config = {}) {
    const role = new OrganizationRole(roleName, trustPolicy, config);
    this.roles.set(role.id, role);

    this.persistOrganization();
    this.audit.record({
      eventName: 'CreateRole',
      readOnly: false,
      resources: [{ ARN: role.arn, type: 'AWS::IAM::Role' }],
      requestParameters: { roleName }
    });

    logger.info(`✅ Role criada: ${roleName}`);

    return { Role: role.toJSON() };
  }

  getRole(roleId) {
    const role = this.roles.get(roleId);
    if (!role) throw new Error(`Role '${roleId}' not found`);

    return { Role: role.toJSON() };
  }

  listRoles() {
    return { Roles: Array.from(this.roles.values()).map(r => r.toJSON()) };
  }

  putRolePolicy(roleId, policyName, policyDocument) {
    const role = this.roles.get(roleId);
    if (!role) throw new Error(`Role '${roleId}' not found`);

    role.putInlinePolicy(policyName, policyDocument);
    this.persistOrganization();

    return {};
  }

  // ============ Estatísticas / Reset ============

  getStats() {
    return {
      organizationId: this.organization.id,
      accountCount: this.organization.accountCount,
      ouCount: this.organization.ous.size,
      policyCount: this.organization.policies.size,
      roleCount: this.roles.size,
      invitationCount: this.invitations.size
    };
  }

  async reset() {
    this.organization = new Organization();
    this.roles.clear();
    this.invitations.clear();
    await this._persist();

    logger.info('✅ Organizations Simulator resetado');
  }
}

module.exports = OrganizationsSimulator;
