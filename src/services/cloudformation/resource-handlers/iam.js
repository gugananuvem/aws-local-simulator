"use strict";

/**
 * Handlers CloudFormation para IAM.
 * O simulador IAM não possui políticas inline nem instance profiles: políticas inline
 * (propriedade `Policies`, AWS::IAM::Policy) são materializadas como políticas gerenciadas
 * dedicadas, anexadas à entidade e removidas junto com ela.
 */

const { generateName } = require("./helpers");

const asJson = (doc) => (typeof doc === "string" ? doc : JSON.stringify(doc));
const mapGet = (map, key) => (map && map.get(key) ? [...map.get(key)] : []);

const KINDS = {
  role: { attach: "attachRolePolicy", detach: "detachRolePolicy", key: "RoleName", store: "rolePolicies" },
  user: { attach: "attachUserPolicy", detach: "detachUserPolicy", key: "UserName", store: "userPolicies" },
  group: { attach: "attachGroupPolicy", detach: "detachGroupPolicy", key: "GroupName", store: "groupPolicies" },
};

/** Cria políticas inline (como gerenciadas) e anexa à entidade. Retorna os ARNs criados. */
async function attachInline(sims, kind, entityName, policies = []) {
  const created = [];
  for (const p of policies) {
    const policyName = `${entityName}-${p.PolicyName}`;
    const result = await sims.iam.createPolicy({ PolicyName: policyName, PolicyDocument: asJson(p.PolicyDocument) });
    const policyArn = result.Policy.Arn;
    await sims.iam[KINDS[kind].attach]({ [KINDS[kind].key]: entityName, PolicyArn: policyArn });
    created.push(policyArn);
  }
  return created;
}

async function attachManaged(sims, kind, entityName, arns = []) {
  for (const policyArn of arns) {
    await sims.iam[KINDS[kind].attach]({ [KINDS[kind].key]: entityName, PolicyArn: policyArn });
  }
}

/** Desanexa tudo da entidade e apaga as políticas inline criadas pelo stack. */
async function detachAll(sims, kind, entityName, inlineArns = []) {
  const k = KINDS[kind];
  for (const policyArn of mapGet(sims.iam[k.store], entityName)) {
    try {
      await sims.iam[k.detach]({ [k.key]: entityName, PolicyArn: policyArn });
    } catch (_) {}
  }
  for (const policyArn of inlineArns) {
    try {
      await sims.iam.deletePolicy({ PolicyArn: policyArn });
    } catch (_) {}
  }
}

const EXTRA_POLICY_ATTRS = ["Policies", "ManagedPolicyArns"];

module.exports = {
  "AWS::IAM::Role": {
    requires: ["iam"],
    inPlace: [...EXTRA_POLICY_ATTRS, "Description", "MaxSessionDuration", "Tags", "AssumeRolePolicyDocument", "PermissionsBoundary"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.RoleName || generateName(stackName, logicalId, { max: 64 });
      const result = await sims.iam.createRole({
        RoleName: name,
        Path: props.Path || "/",
        AssumeRolePolicyDocument: asJson(props.AssumeRolePolicyDocument),
      });
      await attachManaged(sims, "role", name, props.ManagedPolicyArns);
      const inline = await attachInline(sims, "role", name, props.Policies);
      return { physicalId: name, attrs: { Arn: result.Role.Arn, RoleId: result.Role.RoleId, InlinePolicyArns: inline } };
    },
    async update({ physicalId, props, previous, sims }) {
      await detachAll(sims, "role", physicalId, previous.attrs.InlinePolicyArns);
      await attachManaged(sims, "role", physicalId, props.ManagedPolicyArns);
      const inline = await attachInline(sims, "role", physicalId, props.Policies);
      const role = sims.iam.roles.get(physicalId);
      if (role && props.AssumeRolePolicyDocument) {
        role.AssumeRolePolicyDocument = typeof props.AssumeRolePolicyDocument === "string" ? JSON.parse(props.AssumeRolePolicyDocument) : props.AssumeRolePolicyDocument;
        await sims.iam._persist();
      }
      return { physicalId, attrs: { ...previous.attrs, InlinePolicyArns: inline } };
    },
    async delete({ physicalId, attrs, sims }) {
      await detachAll(sims, "role", physicalId, attrs?.InlinePolicyArns);
      await sims.iam.deleteRole({ RoleName: physicalId });
    },
  },

  "AWS::IAM::ManagedPolicy": {
    requires: ["iam"],
    inPlace: ["Description", "Roles", "Users", "Groups"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.ManagedPolicyName || generateName(stackName, logicalId, { max: 128 });
      const result = await sims.iam.createPolicy({ PolicyName: name, Path: props.Path || "/", PolicyDocument: asJson(props.PolicyDocument) });
      const policyArn = result.Policy.Arn;
      for (const r of props.Roles || []) await sims.iam.attachRolePolicy({ RoleName: r, PolicyArn: policyArn });
      for (const u of props.Users || []) await sims.iam.attachUserPolicy({ UserName: u, PolicyArn: policyArn });
      for (const g of props.Groups || []) await sims.iam.attachGroupPolicy({ GroupName: g, PolicyArn: policyArn });
      return { physicalId: policyArn, attrs: { PolicyArn: policyArn } };
    },
    async delete({ physicalId, props, sims }) {
      for (const r of props?.Roles || []) try { await sims.iam.detachRolePolicy({ RoleName: r, PolicyArn: physicalId }); } catch (_) {}
      for (const u of props?.Users || []) try { await sims.iam.detachUserPolicy({ UserName: u, PolicyArn: physicalId }); } catch (_) {}
      for (const g of props?.Groups || []) try { await sims.iam.detachGroupPolicy({ GroupName: g, PolicyArn: physicalId }); } catch (_) {}
      await sims.iam.deletePolicy({ PolicyArn: physicalId });
    },
  },

  // Política inline (AWS::IAM::Policy): vira política gerenciada anexada às entidades indicadas
  "AWS::IAM::Policy": {
    requires: ["iam"],
    inPlace: [],
    async create({ props, sims }) {
      const result = await sims.iam.createPolicy({ PolicyName: props.PolicyName, PolicyDocument: asJson(props.PolicyDocument) });
      const policyArn = result.Policy.Arn;
      for (const r of props.Roles || []) await sims.iam.attachRolePolicy({ RoleName: r, PolicyArn: policyArn });
      for (const u of props.Users || []) await sims.iam.attachUserPolicy({ UserName: u, PolicyArn: policyArn });
      for (const g of props.Groups || []) await sims.iam.attachGroupPolicy({ GroupName: g, PolicyArn: policyArn });
      return { physicalId: props.PolicyName, attrs: { PolicyArn: policyArn } };
    },
    async delete({ props, attrs, sims }) {
      const policyArn = attrs?.PolicyArn;
      if (!policyArn) return;
      for (const r of props?.Roles || []) try { await sims.iam.detachRolePolicy({ RoleName: r, PolicyArn: policyArn }); } catch (_) {}
      for (const u of props?.Users || []) try { await sims.iam.detachUserPolicy({ UserName: u, PolicyArn: policyArn }); } catch (_) {}
      for (const g of props?.Groups || []) try { await sims.iam.detachGroupPolicy({ GroupName: g, PolicyArn: policyArn }); } catch (_) {}
      await sims.iam.deletePolicy({ PolicyArn: policyArn });
    },
  },

  "AWS::IAM::User": {
    requires: ["iam"],
    inPlace: [...EXTRA_POLICY_ATTRS, "Groups", "Tags"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.UserName || generateName(stackName, logicalId, { max: 64 });
      const result = await sims.iam.createUser({ UserName: name, Path: props.Path || "/" });
      for (const g of props.Groups || []) await sims.iam.addUserToGroup({ GroupName: g, UserName: name });
      await attachManaged(sims, "user", name, props.ManagedPolicyArns);
      const inline = await attachInline(sims, "user", name, props.Policies);
      return { physicalId: name, attrs: { Arn: result.User.Arn, InlinePolicyArns: inline } };
    },
    async update({ physicalId, props, previous, sims }) {
      await detachAll(sims, "user", physicalId, previous.attrs.InlinePolicyArns);
      await attachManaged(sims, "user", physicalId, props.ManagedPolicyArns);
      const inline = await attachInline(sims, "user", physicalId, props.Policies);
      return { physicalId, attrs: { ...previous.attrs, InlinePolicyArns: inline } };
    },
    async delete({ physicalId, attrs, sims }) {
      await detachAll(sims, "user", physicalId, attrs?.InlinePolicyArns);
      await sims.iam.deleteUser({ UserName: physicalId });
    },
  },

  "AWS::IAM::Group": {
    requires: ["iam"],
    inPlace: [...EXTRA_POLICY_ATTRS],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.GroupName || generateName(stackName, logicalId, { max: 128 });
      const result = await sims.iam.createGroup({ GroupName: name, Path: props.Path || "/" });
      await attachManaged(sims, "group", name, props.ManagedPolicyArns);
      const inline = await attachInline(sims, "group", name, props.Policies);
      const arn = result.Group?.Arn || `arn:aws:iam::123456789012:group/${name}`;
      return { physicalId: name, attrs: { Arn: arn, InlinePolicyArns: inline } };
    },
    async update({ physicalId, props, previous, sims }) {
      await detachAll(sims, "group", physicalId, previous.attrs.InlinePolicyArns);
      await attachManaged(sims, "group", physicalId, props.ManagedPolicyArns);
      const inline = await attachInline(sims, "group", physicalId, props.Policies);
      return { physicalId, attrs: { ...previous.attrs, InlinePolicyArns: inline } };
    },
    async delete({ physicalId, attrs, sims }) {
      await detachAll(sims, "group", physicalId, attrs?.InlinePolicyArns);
      await sims.iam.deleteGroup({ GroupName: physicalId });
    },
  },

  "AWS::IAM::AccessKey": {
    requires: ["iam"],
    inPlace: ["Status"],
    async create({ props, sims }) {
      const result = await sims.iam.createAccessKey({ UserName: props.UserName });
      const key = result.AccessKey;
      return { physicalId: key.AccessKeyId, attrs: { SecretAccessKey: key.SecretAccessKey } };
    },
    async update({ physicalId, props, previous, sims }) {
      await sims.iam.updateAccessKey({ AccessKeyId: physicalId, UserName: props.UserName, Status: props.Status || "Active" });
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      await sims.iam.deleteAccessKey({ AccessKeyId: physicalId });
    },
  },

  // O simulador não modela instance profiles: o recurso existe apenas no stack (Ref = nome, GetAtt Arn).
  "AWS::IAM::InstanceProfile": {
    inPlace: ["Roles"],
    async create({ logicalId, stackName, props, env }) {
      const name = props.InstanceProfileName || generateName(stackName, logicalId, { max: 128 });
      return { physicalId: name, attrs: { Arn: `arn:aws:iam::${env.account}:instance-profile${props.Path || "/"}${name}` } };
    },
    async delete() {},
  },
};
