const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

const DATA_DIR = path.join(process.cwd(), '.aws-local-simulator-data', 'iam');

const FILE_MAP = {
  users: 'users.json',
  groups: 'groups.json',
  roles: 'roles.json',
  policies: 'policies.json',
  accessKeys: 'access-keys.json',
  userPolicies: 'user-policies.json',
  groupPolicies: 'group-policies.json',
  rolePolicies: 'role-policies.json',
  groupMembers: 'group-members.json',
  userGroups: 'user-groups.json'
};

class IAMSimulator {
  constructor(config) {
    this.config = config;
    this.users = new Map();
    this.groups = new Map();
    this.roles = new Map();
    this.policies = new Map();
    this.accessKeys = new Map();
    this.userPolicies = new Map();
    this.groupPolicies = new Map();
    this.rolePolicies = new Map();
    this.groupMembers = new Map();
    this.userGroups = new Map();
  }

  async initialize() {
    logger.debug('Inicializando IAM Simulator...');
    await this._load();
    await this._provisionFromConfig();
  }

  // --- Access Key Management ---

  async createAccessKey(params) {
    const { UserName } = params;

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const AccessKeyId = 'AKIA' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const SecretAccessKey = crypto.randomBytes(20).toString('hex');

    const record = {
      AccessKeyId,
      SecretAccessKey,
      UserName,
      Status: 'Active',
      CreateDate: new Date().toISOString()
    };

    this.accessKeys.set(AccessKeyId, record);
    await this._persist();

    return { AccessKey: record };
  }

  async listAccessKeys(params) {
    const { UserName } = params;

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const filteredKeys = [];
    for (const record of this.accessKeys.values()) {
      if (record.UserName === UserName) {
        filteredKeys.push({
          AccessKeyId: record.AccessKeyId,
          UserName: record.UserName,
          Status: record.Status,
          CreateDate: record.CreateDate
        });
      }
    }

    return { AccessKeyMetadata: filteredKeys };
  }

  async deleteAccessKey(params) {
    const { AccessKeyId } = params;

    if (!this.accessKeys.has(AccessKeyId)) {
      const err = new Error(`The Access Key with id ${AccessKeyId} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    this.accessKeys.delete(AccessKeyId);
    await this._persist();
    
    return {};
  }

  async updateAccessKey(params) {
    const { AccessKeyId, Status, UserName } = params || {};

    if (!this.accessKeys.has(AccessKeyId)) {
      const err = new Error(`The Access Key with id ${AccessKeyId} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const record = this.accessKeys.get(AccessKeyId);
    if (UserName && record.UserName !== UserName) {
      const err = new Error(`The access key with id ${AccessKeyId} does not belong to user ${UserName}.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    if (Status) {
      record.Status = Status;
    }

    await this._persist();
    return {};
  }

  // --- Group Management ---

  async createGroup(params) {
    const { GroupName, Path = '/' } = params || {};

    if (!GroupName) {
      const err = new Error('1 validation error detected: Value at \'groupName\' failed to satisfy constraint: Member must not be null');
      err.code = 'ValidationError';
      err.statusCode = 400;
      throw err;
    }

    if (this.groups.has(GroupName)) {
      const err = new Error(`Group with name ${GroupName} already exists.`);
      err.code = 'EntityAlreadyExists';
      err.statusCode = 409;
      throw err;
    }

    const GroupId = 'AGPA' + crypto.randomUUID().replace(/-/g, '').substring(0, 21).toUpperCase();
    const Arn = `arn:aws:iam::123456789012:group${Path}${GroupName}`;
    const CreateDate = new Date().toISOString();

    const group = { GroupName, GroupId, Arn, Path, CreateDate };

    this.groups.set(GroupName, group);
    this.groupPolicies.set(GroupName, new Set());
    this.groupMembers.set(GroupName, new Set());

    await this._persist();

    return { Group: group };
  }

  async getGroup(params) {
    const { GroupName } = params || {};

    if (!this.groups.has(GroupName)) {
      const err = new Error(`The group with name ${GroupName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const groupRecord = this.groups.get(GroupName);
    const members = this.groupMembers.get(GroupName) || new Set();
    const Users = [];

    for (const userName of members) {
      const userRecord = this.users.get(userName);
      if (userRecord) {
        Users.push(userRecord);
      }
    }

    return { Group: groupRecord, Users };
  }

  async deleteGroup(params) {
    const { GroupName } = params || {};

    if (!this.groups.has(GroupName)) {
      const err = new Error(`The group with name ${GroupName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const members = this.groupMembers.get(GroupName);
    if (members && members.size > 0) {
      const err = new Error(`Cannot delete group ${GroupName} - it still contains members.`);
      err.code = 'DeleteConflict';
      err.statusCode = 409;
      throw err;
    }

    // Decrement attachment count for all policies attached to this group
    const groupPolicies = this.groupPolicies.get(GroupName);
    if (groupPolicies) {
      for (const policyArn of groupPolicies) {
        const policyRecord = this.policies.get(policyArn);
        if (policyRecord) {
          policyRecord.AttachmentCount = Math.max(0, policyRecord.AttachmentCount - 1);
        }
      }
    }

    this.groups.delete(GroupName);
    this.groupPolicies.delete(GroupName);
    this.groupMembers.delete(GroupName);

    await this._persist();
    
    return {};
  }

  async addUserToGroup(params) {
    const { GroupName, UserName } = params || {};

    if (!this.groups.has(GroupName)) {
      const err = new Error(`The group with name ${GroupName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    this.groupMembers.get(GroupName).add(UserName);
    this.userGroups.get(UserName).add(GroupName);

    await this._persist();
    
    return {};
  }

  async removeUserFromGroup(params) {
    const { GroupName, UserName } = params || {};

    if (!this.groups.has(GroupName)) {
      const err = new Error(`The group with name ${GroupName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    this.groupMembers.get(GroupName).delete(UserName);
    this.userGroups.get(UserName).delete(GroupName);

    await this._persist();
    
    return {};
  }

  async listGroupsForUser(params) {
    const { UserName } = params || {};

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const groupNames = this.userGroups.get(UserName) || new Set();
    const Groups = [];

    for (const groupName of groupNames) {
      const groupRecord = this.groups.get(groupName);
      if (groupRecord) {
        Groups.push(groupRecord);
      }
    }

    return { Groups };
  }

  async listGroups(params) {
    const { PathPrefix = '/' } = params || {};

    const filteredGroups = [];
    for (const group of this.groups.values()) {
      if (group.Path.startsWith(PathPrefix)) {
        filteredGroups.push(group);
      }
    }

    return { Groups: filteredGroups };
  }

  // --- Role Management ---

  async createRole(params) {
    const { RoleName, Path = '/', AssumeRolePolicyDocument } = params || {};

    if (!RoleName) {
      const err = new Error('1 validation error detected: Value at \'roleName\' failed to satisfy constraint: Member must not be null');
      err.code = 'ValidationError';
      err.statusCode = 400;
      throw err;
    }

    if (this.roles.has(RoleName)) {
      const err = new Error(`Role with name ${RoleName} already exists.`);
      err.code = 'EntityAlreadyExists';
      err.statusCode = 409;
      throw err;
    }

    const RoleId = 'AROA' + crypto.randomUUID().replace(/-/g, '').substring(0, 21).toUpperCase();
    const Arn = `arn:aws:iam::123456789012:role${Path}${RoleName}`;
    const CreateDate = new Date().toISOString();

    let parsedAssumeRolePolicyDocument = AssumeRolePolicyDocument;
    if (typeof AssumeRolePolicyDocument === 'string') {
      try {
        parsedAssumeRolePolicyDocument = JSON.parse(AssumeRolePolicyDocument);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    const role = {
      RoleName,
      RoleId,
      Arn,
      Path,
      AssumeRolePolicyDocument: parsedAssumeRolePolicyDocument,
      CreateDate
    };

    this.roles.set(RoleName, role);
    this.rolePolicies.set(RoleName, new Set());

    await this._persist();

    return { Role: role };
  }

  async getRole(params) {
    const { RoleName } = params || {};

    if (!this.roles.has(RoleName)) {
      const err = new Error(`The role with name ${RoleName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const roleRecord = this.roles.get(RoleName);
    const attachedPolicies = this.rolePolicies.get(RoleName) || new Set();

    return { Role: roleRecord, AttachedPolicies: [...attachedPolicies] };
  }

  async listRoles(params) {
    const { PathPrefix = '/' } = params || {};

    const filteredRoles = [];
    for (const role of this.roles.values()) {
      if (role.Path.startsWith(PathPrefix)) {
        filteredRoles.push(role);
      }
    }

    return { Roles: filteredRoles };
  }

  async deleteRole(params) {
    const { RoleName } = params || {};

    if (!this.roles.has(RoleName)) {
      const err = new Error(`The role with name ${RoleName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const attachedPolicies = this.rolePolicies.get(RoleName);
    if (attachedPolicies && attachedPolicies.size > 0) {
      const err = new Error(`Cannot delete role ${RoleName} - it has attached policies.`);
      err.code = 'DeleteConflict';
      err.statusCode = 409;
      throw err;
    }

    this.roles.delete(RoleName);
    this.rolePolicies.delete(RoleName);

    await this._persist();
    
    return {};
  }

  // --- Policy Management ---

  _validatePolicyDocument(document) {
    let parsed = document;

    if (typeof document === 'string') {
      try {
        parsed = JSON.parse(document);
      } catch (e) {
        const err = new Error('Policy document is not valid JSON.');
        err.code = 'MalformedPolicyDocument';
        err.statusCode = 400;
        throw err;
      }
    }

    if (!parsed || !Array.isArray(parsed.Statement) || parsed.Statement.length === 0) {
      const err = new Error('Policy document must contain a Statement array with at least one element.');
      err.code = 'MalformedPolicyDocument';
      err.statusCode = 400;
      throw err;
    }

    for (const statement of parsed.Statement) {
      if (!statement.Effect || (statement.Effect !== 'Allow' && statement.Effect !== 'Deny')) {
        const err = new Error('Policy statement must have an Effect field with value "Allow" or "Deny".');
        err.code = 'MalformedPolicyDocument';
        err.statusCode = 400;
        throw err;
      }

      if (!statement.Action) {
        const err = new Error('Policy statement must have an Action field.');
        err.code = 'MalformedPolicyDocument';
        err.statusCode = 400;
        throw err;
      }

      if (!statement.Resource) {
        const err = new Error('Policy statement must have a Resource field.');
        err.code = 'MalformedPolicyDocument';
        err.statusCode = 400;
        throw err;
      }
    }

    return parsed;
  }

  async createPolicy(params) {
    const { PolicyName, Path = '/', PolicyDocument } = params || {};

    if (!PolicyName) {
      const err = new Error('1 validation error detected: Value at \'policyName\' failed to satisfy constraint: Member must not be null');
      err.code = 'ValidationError';
      err.statusCode = 400;
      throw err;
    }

    const document = this._validatePolicyDocument(PolicyDocument);

    const Arn = `arn:aws:iam::123456789012:policy${Path}${PolicyName}`;

    if (this.policies.has(Arn)) {
      const err = new Error(`A policy called ${PolicyName} already exists. Duplicate names are not allowed.`);
      err.code = 'EntityAlreadyExists';
      err.statusCode = 409;
      throw err;
    }

    const PolicyId = 'ANPA' + crypto.randomUUID().replace(/-/g, '').substring(0, 21).toUpperCase();
    const CreateDate = new Date().toISOString();

    const policy = {
      PolicyName,
      PolicyId,
      Arn,
      Path,
      DefaultVersionId: 'v1',
      Document: document,
      CreateDate,
      AttachmentCount: 0
    };

    this.policies.set(Arn, policy);
    await this._persist();

    // Return metadata only (without Document) wrapped in Policy
    const { Document, ...metadata } = policy;
    return { Policy: metadata };
  }

  async getPolicy(params) {
    const { PolicyArn } = params || {};

    if (!this.policies.has(PolicyArn)) {
      const err = new Error(`Policy ${PolicyArn} does not exist or is not attachable.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const policyRecord = this.policies.get(PolicyArn);
    const { Document, ...metadata } = policyRecord;
    return { Policy: metadata };
  }

  async getPolicyVersion(params) {
    const { PolicyArn, VersionId } = params || {};

    if (!this.policies.has(PolicyArn)) {
      const err = new Error(`Policy ${PolicyArn} does not exist or is not attachable.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const policyRecord = this.policies.get(PolicyArn);

    return {
      PolicyVersion: {
        Document: policyRecord.Document,
        VersionId: policyRecord.DefaultVersionId,
        IsDefaultVersion: true,
        CreateDate: policyRecord.CreateDate
      }
    };
  }

  async listPolicies(params) {
    const { PathPrefix = '/', Scope } = params || {};

    const filteredPolicies = [];
    for (const policy of this.policies.values()) {
      if (!policy.Path.startsWith(PathPrefix)) {
        continue;
      }

      // If Scope === 'Local', only return local policies (all of ours are local)
      if (Scope === 'Local' || Scope === undefined || Scope === null || Scope === 'All') {
        const { Document, ...metadata } = policy;
        filteredPolicies.push(metadata);
      }
    }

    return { Policies: filteredPolicies };
  }

  async deletePolicy(params) {
    const { PolicyArn } = params || {};

    if (!this.policies.has(PolicyArn)) {
      const err = new Error(`Policy ${PolicyArn} does not exist or is not attachable.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const policyRecord = this.policies.get(PolicyArn);

    if (policyRecord.AttachmentCount > 0) {
      const err = new Error(`Cannot delete policy ${PolicyArn} - it is attached to entities.`);
      err.code = 'DeleteConflict';
      err.statusCode = 409;
      throw err;
    }

    this.policies.delete(PolicyArn);
    await this._persist();
    
    return {};
  }

  // --- Policy Attach/Detach ---

  async attachUserPolicy(params) {
    const { UserName, PolicyArn } = params || {};

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    if (!this.policies.has(PolicyArn)) {
      const err = new Error(`Policy ${PolicyArn} does not exist or is not attachable.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const userPolicySet = this.userPolicies.get(UserName);
    if (!userPolicySet.has(PolicyArn)) {
      userPolicySet.add(PolicyArn);
      const policyRecord = this.policies.get(PolicyArn);
      policyRecord.AttachmentCount++;
    }

    await this._persist();
    
    return {};
  }

  async attachGroupPolicy(params) {
    const { GroupName, PolicyArn } = params || {};

    if (!this.groups.has(GroupName)) {
      const err = new Error(`The group with name ${GroupName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    if (!this.policies.has(PolicyArn)) {
      const err = new Error(`Policy ${PolicyArn} does not exist or is not attachable.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const groupPolicySet = this.groupPolicies.get(GroupName);
    if (!groupPolicySet.has(PolicyArn)) {
      groupPolicySet.add(PolicyArn);
      const policyRecord = this.policies.get(PolicyArn);
      policyRecord.AttachmentCount++;
    }

    await this._persist();
    
    return {};
  }

  async attachRolePolicy(params) {
    const { RoleName, PolicyArn } = params || {};

    if (!this.roles.has(RoleName)) {
      const err = new Error(`The role with name ${RoleName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    if (!this.policies.has(PolicyArn)) {
      const err = new Error(`Policy ${PolicyArn} does not exist or is not attachable.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const rolePolicySet = this.rolePolicies.get(RoleName);
    if (!rolePolicySet.has(PolicyArn)) {
      rolePolicySet.add(PolicyArn);
      const policyRecord = this.policies.get(PolicyArn);
      policyRecord.AttachmentCount++;
    }

    await this._persist();
    
    return {};
  }

  async detachUserPolicy(params) {
    const { UserName, PolicyArn } = params || {};

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    if (!this.policies.has(PolicyArn)) {
      const err = new Error(`Policy ${PolicyArn} does not exist or is not attachable.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const userPolicySet = this.userPolicies.get(UserName);
    if (userPolicySet.has(PolicyArn)) {
      userPolicySet.delete(PolicyArn);
      const policyRecord = this.policies.get(PolicyArn);
      policyRecord.AttachmentCount = Math.max(0, policyRecord.AttachmentCount - 1);
    }

    await this._persist();
    
    return {};
  }

  async detachGroupPolicy(params) {
    const { GroupName, PolicyArn } = params || {};

    if (!this.groups.has(GroupName)) {
      const err = new Error(`The group with name ${GroupName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    if (!this.policies.has(PolicyArn)) {
      const err = new Error(`Policy ${PolicyArn} does not exist or is not attachable.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const groupPolicySet = this.groupPolicies.get(GroupName);
    if (groupPolicySet.has(PolicyArn)) {
      groupPolicySet.delete(PolicyArn);
      const policyRecord = this.policies.get(PolicyArn);
      policyRecord.AttachmentCount = Math.max(0, policyRecord.AttachmentCount - 1);
    }

    await this._persist();
    
    return {};
  }

  async detachRolePolicy(params) {
    const { RoleName, PolicyArn } = params || {};

    if (!this.roles.has(RoleName)) {
      const err = new Error(`The role with name ${RoleName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    if (!this.policies.has(PolicyArn)) {
      const err = new Error(`Policy ${PolicyArn} does not exist or is not attachable.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const rolePolicySet = this.rolePolicies.get(RoleName);
    if (rolePolicySet.has(PolicyArn)) {
      rolePolicySet.delete(PolicyArn);
      const policyRecord = this.policies.get(PolicyArn);
      policyRecord.AttachmentCount = Math.max(0, policyRecord.AttachmentCount - 1);
    }

    await this._persist();
    
    return {};
  }

  async listAttachedUserPolicies(params) {
    const { UserName, PathPrefix = '/' } = params || {};

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const policyArns = this.userPolicies.get(UserName) || new Set();
    const AttachedPolicies = [];

    for (const policyArn of policyArns) {
      const policyRecord = this.policies.get(policyArn);
      if (policyRecord && policyRecord.Path.startsWith(PathPrefix)) {
        AttachedPolicies.push({
          PolicyName: policyRecord.PolicyName,
          PolicyArn: policyRecord.Arn
        });
      }
    }

    return { AttachedPolicies };
  }

  async listAttachedGroupPolicies(params) {
    const { GroupName, PathPrefix = '/' } = params || {};

    if (!this.groups.has(GroupName)) {
      const err = new Error(`The group with name ${GroupName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const policyArns = this.groupPolicies.get(GroupName) || new Set();
    const AttachedPolicies = [];

    for (const policyArn of policyArns) {
      const policyRecord = this.policies.get(policyArn);
      if (policyRecord && policyRecord.Path.startsWith(PathPrefix)) {
        AttachedPolicies.push({
          PolicyName: policyRecord.PolicyName,
          PolicyArn: policyRecord.Arn
        });
      }
    }

    return { AttachedPolicies };
  }

  async listAttachedRolePolicies(params) {
    const { RoleName, PathPrefix = '/' } = params || {};

    if (!this.roles.has(RoleName)) {
      const err = new Error(`The role with name ${RoleName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    const policyArns = this.rolePolicies.get(RoleName) || new Set();
    const AttachedPolicies = [];

    for (const policyArn of policyArns) {
      const policyRecord = this.policies.get(policyArn);
      if (policyRecord && policyRecord.Path.startsWith(PathPrefix)) {
        AttachedPolicies.push({
          PolicyName: policyRecord.PolicyName,
          PolicyArn: policyRecord.Arn
        });
      }
    }

    return { AttachedPolicies };
  }

  async getAccountSummary(params) {
    const Users = this.users.size;
    const Groups = this.groups.size;
    const Roles = this.roles.size;
    const Policies = this.policies.size;
    const AccessKeys = this.accessKeys.size;

    let GroupPolicyAttachments = 0;
    for (const policySet of this.groupPolicies.values()) {
      GroupPolicyAttachments += policySet.size;
    }
    let UserPolicyAttachments = 0;
    for (const policySet of this.userPolicies.values()) {
      UserPolicyAttachments += policySet.size;
    }
    let RolePolicyAttachments = 0;
    for (const policySet of this.rolePolicies.values()) {
      RolePolicyAttachments += policySet.size;
    }
    const AttachedPoliciesPerGroupQuota = 10;
    const AttachedPoliciesPerRoleQuota = 10;
    const AttachedPoliciesPerUserQuota = 10;
    const GroupQuota = 300;
    const UserQuota = 5000;
    const RoleQuota = 1000;
    const PolicyQuota = 1500;
    const PolicyVersionsInUseQuota = 10000;
    const ServerCertificatesQuota = 20;
    const SigningCertificatesPerUserQuota = 2;
    const AccessKeysPerUserQuota = 2;
    const MFADevices = 0;
    const MFADevicesInUse = 0;
    const AccountMFAEnabled = 0;
    const SSLCertificates = 0;
    const ServerCertificates = 0;

    return {
      SummaryMap: {
        Users,
        Groups,
        Roles,
        Policies,
        AccessKeys,
        GroupPolicyAttachments,
        UserPolicyAttachments,
        RolePolicyAttachments,
        AttachedPoliciesPerGroupQuota,
        AttachedPoliciesPerRoleQuota,
        AttachedPoliciesPerUserQuota,
        GroupQuota,
        UserQuota,
        RoleQuota,
        PolicyQuota,
        PolicyVersionsInUseQuota,
        ServerCertificatesQuota,
        SigningCertificatesPerUserQuota,
        AccessKeysPerUserQuota,
        MFADevices,
        MFADevicesInUse,
        AccountMFAEnabled,
        SSLCertificates,
        ServerCertificates
      }
    };
  }

  // --- Policy Evaluation Engine ---

  resolveIdentity(accessKeyId) {
    const record = this.accessKeys.get(accessKeyId);
    if (!record) return null;
    return { type: 'user', userName: record.UserName, accessKeyId };
  }

  _collectPolicies(identity) {
    const allStatements = [];

    // Get user's directly attached policies
    const userPolicyArns = this.userPolicies.get(identity.userName);
    const policyArns = new Set();

    if (userPolicyArns) {
      for (const arn of userPolicyArns) {
        policyArns.add(arn);
      }
    }

    // Get all groups the user belongs to and their policies
    const groups = this.userGroups.get(identity.userName);
    if (groups) {
      for (const groupName of groups) {
        const groupPolicyArns = this.groupPolicies.get(groupName);
        if (groupPolicyArns) {
          for (const arn of groupPolicyArns) {
            policyArns.add(arn);
          }
        }
      }
    }

    // For each policy ARN, get the full policy Document and collect statements
    for (const arn of policyArns) {
      const policyRecord = this.policies.get(arn);
      if (policyRecord && policyRecord.Document && Array.isArray(policyRecord.Document.Statement)) {
        for (const statement of policyRecord.Document.Statement) {
          allStatements.push(statement);
        }
      }
    }

    return allStatements;
  }

  evaluateAccess({ accessKeyId, action, resource, context }) {
    const identity = this.resolveIdentity(accessKeyId);
    if (!identity) return 'Deny';

    const allStatements = this._collectPolicies(identity);

    let allowed = false;

    for (const statement of allStatements) {
      // Normalize Action and Resource to arrays
      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];

      // Check if this statement matches the request
      const actionMatches = actions.some(a => this._matchAction(a, action));
      const resourceMatches = resources.some(r => this._matchResource(r, resource));

      if (!actionMatches || !resourceMatches) continue;

      // Check conditions if present
      if (statement.Condition) {
        if (!this._evaluateConditions(statement.Condition, context)) continue;
      }

      // Statement matches - check effect
      if (statement.Effect === 'Deny') {
        return 'Deny'; // Explicit deny always wins
      }
      if (statement.Effect === 'Allow') {
        allowed = true;
      }
    }

    return allowed ? 'Allow' : 'Deny';
  }

  _matchAction(pattern, action) {
    if (pattern === '*') return true;
    return this._wildcardMatch(pattern.toLowerCase(), action.toLowerCase());
  }

  _matchResource(pattern, resource) {
    if (pattern === '*') return true;
    return this._wildcardMatch(pattern, resource);
  }

  _wildcardMatch(pattern, value) {
    let p = 0, v = 0, starP = -1, matchV = -1;

    while (v < value.length) {
      if (p < pattern.length && (pattern[p] === '?' || pattern[p] === value[v])) {
        p++;
        v++;
      } else if (p < pattern.length && pattern[p] === '*') {
        starP = p;
        matchV = v;
        p++;
      } else if (starP !== -1) {
        p = starP + 1;
        matchV++;
        v = matchV;
      } else {
        return false;
      }
    }

    while (p < pattern.length && pattern[p] === '*') {
      p++;
    }

    return p === pattern.length;
  }

  _evaluateConditions(conditions, context) {
    for (const [operator, conditionMap] of Object.entries(conditions)) {
      for (const [key, value] of Object.entries(conditionMap)) {
        switch (operator) {
          case 'StringEquals':
            if (!this._evaluateStringEquals(key, value, context)) return false;
            break;
          case 'StringLike':
            if (!this._evaluateStringLike(key, value, context)) return false;
            break;
          case 'IpAddress':
            if (!this._evaluateIpAddress(key, value, context)) return false;
            break;
          default:
            // Unknown operator — skip (permissive)
            break;
        }
      }
    }
    return true;
  }

  _evaluateStringEquals(key, value, context) {
    const contextValue = context[key];
    if (contextValue === undefined) return false;
    if (Array.isArray(value)) return value.includes(contextValue);
    return contextValue === value;
  }

  _evaluateStringLike(key, pattern, context) {
    const contextValue = context[key];
    if (contextValue === undefined) return false;
    if (Array.isArray(pattern)) {
      return pattern.some(p => this._wildcardMatch(p, contextValue));
    }
    return this._wildcardMatch(pattern, contextValue);
  }

  _evaluateIpAddress(key, cidr, context) {
    const sourceIp = context[key];
    if (sourceIp === undefined) return false;
    if (Array.isArray(cidr)) {
      return cidr.some(c => this._cidrContains(c, sourceIp));
    }
    return this._cidrContains(cidr, sourceIp);
  }

  _cidrContains(cidr, ip) {
    const [baseIp, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr, 10);
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : ((-1 << (32 - prefix)) >>> 0);
    const baseInt = this._ipToInt(baseIp);
    const ipInt = this._ipToInt(ip);
    return (ipInt & mask) === (baseInt & mask);
  }

  _ipToInt(ip) {
    const parts = ip.split('.').map(Number);
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }

  async _persist() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    for (const [mapName, fileName] of Object.entries(FILE_MAP)) {
      const filePath = path.join(DATA_DIR, fileName);
      const map = this[mapName];
      let data;

      // Maps that store Sets as values need special serialization
      if (['userPolicies', 'groupPolicies', 'rolePolicies', 'groupMembers', 'userGroups'].includes(mapName)) {
        const obj = {};
        for (const [key, value] of map.entries()) {
          obj[key] = Array.from(value);
        }
        data = JSON.stringify(obj, null, 2);
      } else {
        // Maps that store objects as values (users, groups, roles, policies, accessKeys)
        const entries = Array.from(map.values());
        data = JSON.stringify(entries, null, 2);
      }

      fs.writeFileSync(filePath, data, 'utf-8');
    }

    logger.debug('IAM state persisted to disk.');
  }

  async _load() {
    if (!fs.existsSync(DATA_DIR)) {
      logger.debug('IAM data directory not found, starting with empty state.');
      return;
    }

    for (const [mapName, fileName] of Object.entries(FILE_MAP)) {
      const filePath = path.join(DATA_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);

        if (['userPolicies', 'groupPolicies', 'rolePolicies', 'groupMembers', 'userGroups'].includes(mapName)) {
          // These are objects where keys map to arrays (restored as Sets)
          this[mapName] = new Map();
          for (const [key, value] of Object.entries(parsed)) {
            this[mapName].set(key, new Set(value));
          }
        } else {
          // These are arrays of records, keyed by their primary identifier
          this[mapName] = new Map();
          const keyField = this._getKeyField(mapName);
          for (const record of parsed) {
            this[mapName].set(record[keyField], record);
          }
        }
      } catch (err) {
        logger.warn(`Failed to load IAM data from ${fileName}: ${err.message}`);
      }
    }

    logger.debug('IAM state loaded from disk.');
  }

  _getKeyField(mapName) {
    switch (mapName) {
      case 'users': return 'UserName';
      case 'groups': return 'GroupName';
      case 'roles': return 'RoleName';
      case 'policies': return 'Arn';
      case 'accessKeys': return 'AccessKeyId';
      default: return 'id';
    }
  }

  async reset() {
    this.users = new Map();
    this.groups = new Map();
    this.roles = new Map();
    this.policies = new Map();
    this.accessKeys = new Map();
    this.userPolicies = new Map();
    this.groupPolicies = new Map();
    this.rolePolicies = new Map();
    this.groupMembers = new Map();
    this.userGroups = new Map();

    await this._provisionFromConfig();
    await this._persist();

    logger.debug('IAM state reset and re-provisioned from config.');
  }

  // --- User Management ---

  async createUser(params) {
    const { UserName, Path = '/' } = params || {};

    if (!UserName) {
      const err = new Error('1 validation error detected: Value at \'userName\' failed to satisfy constraint: Member must not be null');
      err.code = 'ValidationError';
      err.statusCode = 400;
      throw err;
    }

    if (this.users.has(UserName)) {
      const err = new Error(`User with name ${UserName} already exists.`);
      err.code = 'EntityAlreadyExists';
      err.statusCode = 409;
      throw err;
    }

    const UserId = 'AIDA' + crypto.randomUUID().replace(/-/g, '').substring(0, 21).toUpperCase();
    const Arn = `arn:aws:iam::123456789012:user${Path}${UserName}`;
    const CreateDate = new Date().toISOString();

    const user = { UserName, UserId, Arn, Path, CreateDate };

    this.users.set(UserName, user);
    this.userPolicies.set(UserName, new Set());
    this.userGroups.set(UserName, new Set());

    await this._persist();

    return { User: user };
  }

  async getUser(params) {
    const { UserName } = params || {};

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    return { User: this.users.get(UserName) };
  }

  async listUsers(params) {
    const { PathPrefix = '/' } = params || {};

    const filteredUsers = [];
    for (const user of this.users.values()) {
      if (user.Path.startsWith(PathPrefix)) {
        filteredUsers.push(user);
      }
    }

    return { Users: filteredUsers };
  }

  async deleteUser(params) {
    const { UserName } = params || {};

    if (!this.users.has(UserName)) {
      const err = new Error(`The user with name ${UserName} cannot be found.`);
      err.code = 'NoSuchEntity';
      err.statusCode = 404;
      throw err;
    }

    // Remove all access keys for this user
    for (const [keyId, keyRecord] of this.accessKeys.entries()) {
      if (keyRecord.UserName === UserName) {
        this.accessKeys.delete(keyId);
      }
    }

    // Remove user from all groups
    const groups = this.userGroups.get(UserName);
    if (groups) {
      for (const groupName of groups) {
        const members = this.groupMembers.get(groupName);
        if (members) {
          members.delete(UserName);
        }
      }
    }

    // Decrement attachment count for all policies attached to this user
    const userPolicies = this.userPolicies.get(UserName);
    if (userPolicies) {
      for (const policyArn of userPolicies) {
        const policyRecord = this.policies.get(policyArn);
        if (policyRecord) {
          policyRecord.AttachmentCount = Math.max(0, policyRecord.AttachmentCount - 1);
        }
      }
    }

    // Delete user records
    this.users.delete(UserName);
    this.userPolicies.delete(UserName);
    this.userGroups.delete(UserName);

    await this._persist();
    
    return {}; // Return empty object for successful delete
  }

  async _provisionFromConfig() {
    const iamConfig = this.config?.iam;
    if (!iamConfig) return;

    // 1. Create policies first (other resources reference them)
    if (Array.isArray(iamConfig.policies)) {
      for (const policyDef of iamConfig.policies) {
        try {
          await this.createPolicy({
            PolicyName: policyDef.PolicyName,
            Path: policyDef.Path || '/',
            PolicyDocument: policyDef.Document
          });
          logger.debug(`IAM Config: Created policy ${policyDef.PolicyName}`);
        } catch (err) {
          // Skip if already exists (from persistence)
          if (err.code !== 'EntityAlreadyExists') {
            logger.warn(`IAM Config: Failed to create policy ${policyDef.PolicyName}: ${err.message}`);
          }
        }
      }
    }

    // 2. Create users, attach policies, generate keys
    if (Array.isArray(iamConfig.users)) {
      for (const userDef of iamConfig.users) {
        try {
          await this.createUser({
            UserName: userDef.UserName,
            Path: userDef.Path || '/'
          });
          logger.debug(`IAM Config: Created user ${userDef.UserName}`);

          // Attach policies
          if (Array.isArray(userDef.Policies)) {
            for (const policyArn of userDef.Policies) {
              try {
                await this.attachUserPolicy({ UserName: userDef.UserName, PolicyArn: policyArn });
              } catch (err) {
                logger.warn(`IAM Config: Failed to attach policy ${policyArn} to user ${userDef.UserName}: ${err.message}`);
              }
            }
          }

          // Generate access keys if requested
          if (userDef.generateAccessKeys) {
            const key = await this.createAccessKey({ UserName: userDef.UserName });
            logger.info(`🔑 IAM: Generated AccessKey for ${userDef.UserName}: ${key.AccessKeyId}`);
          }
        } catch (err) {
          if (err.code !== 'EntityAlreadyExists') {
            logger.warn(`IAM Config: Failed to create user ${userDef.UserName}: ${err.message}`);
          }
        }
      }
    }

    // 3. Create groups, add members, attach policies
    if (Array.isArray(iamConfig.groups)) {
      for (const groupDef of iamConfig.groups) {
        try {
          await this.createGroup({
            GroupName: groupDef.GroupName,
            Path: groupDef.Path || '/'
          });
          logger.debug(`IAM Config: Created group ${groupDef.GroupName}`);

          // Add members
          if (Array.isArray(groupDef.Members)) {
            for (const userName of groupDef.Members) {
              try {
                await this.addUserToGroup({ GroupName: groupDef.GroupName, UserName: userName });
              } catch (err) {
                logger.warn(`IAM Config: Failed to add ${userName} to group ${groupDef.GroupName}: ${err.message}`);
              }
            }
          }

          // Attach policies
          if (Array.isArray(groupDef.Policies)) {
            for (const policyArn of groupDef.Policies) {
              try {
                await this.attachGroupPolicy({ GroupName: groupDef.GroupName, PolicyArn: policyArn });
              } catch (err) {
                logger.warn(`IAM Config: Failed to attach policy ${policyArn} to group ${groupDef.GroupName}: ${err.message}`);
              }
            }
          }
        } catch (err) {
          if (err.code !== 'EntityAlreadyExists') {
            logger.warn(`IAM Config: Failed to create group ${groupDef.GroupName}: ${err.message}`);
          }
        }
      }
    }

    // 4. Create roles, attach policies
    if (Array.isArray(iamConfig.roles)) {
      for (const roleDef of iamConfig.roles) {
        try {
          await this.createRole({
            RoleName: roleDef.RoleName,
            Path: roleDef.Path || '/',
            AssumeRolePolicyDocument: roleDef.AssumeRolePolicyDocument
          });
          logger.debug(`IAM Config: Created role ${roleDef.RoleName}`);

          // Attach policies
          if (Array.isArray(roleDef.Policies)) {
            for (const policyArn of roleDef.Policies) {
              try {
                await this.attachRolePolicy({ RoleName: roleDef.RoleName, PolicyArn: policyArn });
              } catch (err) {
                logger.warn(`IAM Config: Failed to attach policy ${policyArn} to role ${roleDef.RoleName}: ${err.message}`);
              }
            }
          }
        } catch (err) {
          if (err.code !== 'EntityAlreadyExists') {
            logger.warn(`IAM Config: Failed to create role ${roleDef.RoleName}: ${err.message}`);
          }
        }
      }
    }
  }
}

module.exports = IAMSimulator;
