"use strict";

/**
 * Handlers CloudFormation para AWS Organizations.
 * sims.organizations -> OrganizationsSimulator
 */

const { generateName } = require("./helpers");

module.exports = {
  "AWS::Organizations::OrganizationalUnit": {
    requires: ["organizations"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const { OrganizationalUnit: ou } = sims.organizations.createOrganizationalUnit(props.ParentId, props.Name);
      return { physicalId: ou.id, attrs: { Arn: ou.arn, Id: ou.id } };
    },
    async delete({ physicalId, sims }) {
      sims.organizations.deleteOrganizationalUnit(physicalId);
    },
  },

  "AWS::Organizations::Account": {
    requires: ["organizations"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const parent = Array.isArray(props.ParentIds) ? props.ParentIds[0] : undefined;
      const result = sims.organizations.createAccount(props.Email, props.AccountName, {
        parentOUId: parent,
        roleName: props.RoleName,
        tags: props.Tags,
      });
      const accountId = result.CreateAccountStatus.AccountId;
      const account = sims.organizations.describeAccount(accountId).Account;
      return {
        physicalId: accountId,
        attrs: {
          AccountId: accountId,
          Arn: account.arn,
          JoinedMethod: account.joinedMethod || "CREATED",
          JoinedTimestamp: account.joinedTimestamp || new Date().toISOString(),
          Status: account.status || "ACTIVE",
        },
      };
    },
    async delete({ physicalId, sims }) {
      sims.organizations.removeAccountFromOrganization(physicalId);
    },
  },

  "AWS::Organizations::Policy": {
    requires: ["organizations"],
    inPlace: ["Description", "Tags"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.Name || generateName(stackName, logicalId, { max: 128 });
      const content = typeof props.Content === "string" ? JSON.parse(props.Content) : props.Content;
      const { Policy } = sims.organizations.createPolicy(name, content, props.Type || "SERVICE_CONTROL_POLICY");
      const summary = Policy.PolicySummary;
      for (const target of props.TargetIds || []) sims.organizations.attachPolicy(summary.id, target);
      return { physicalId: summary.id, attrs: { Arn: summary.arn, Id: summary.id, Type: props.Type || "SERVICE_CONTROL_POLICY" } };
    },
    async delete({ physicalId, props, sims }) {
      for (const target of props?.TargetIds || []) {
        try {
          sims.organizations.detachPolicy(physicalId, target);
        } catch (_) {}
      }
      sims.organizations.deletePolicy(physicalId);
    },
  },
};
