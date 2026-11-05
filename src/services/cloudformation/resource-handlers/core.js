"use strict";

/**
 * Handlers dos recursos originalmente suportados:
 * S3, SQS, DynamoDB, KMS, Secrets Manager, SSM Parameter, Athena WorkGroup.
 */

const { assertOk, arn, generateName } = require("./helpers");

const DYNAMO_IN_PLACE = [
  "Tags", "BillingMode", "ProvisionedThroughput", "StreamSpecification", "TimeToLiveSpecification",
  "PointInTimeRecoverySpecification", "DeletionProtectionEnabled", "SSESpecification",
  "ContributorInsightsSpecification", "KinesisStreamSpecification", "ImportSourceSpecification", "VectorIndexes",
];

/** Converte VectorIndexes do template para o formato da API (Dimensions numérico). */
function toApiVectorIndexes(list = []) {
  return list.map((v) => ({
    IndexName: v.IndexName,
    VectorAttribute: { AttributeName: v.VectorAttribute?.AttributeName },
    Dimensions: Number(v.Dimensions),
    DistanceFunction: v.DistanceFunction,
    Projection: {
      ProjectionType: v.Projection?.ProjectionType,
      ...(v.Projection?.NonKeyAttributes ? { NonKeyAttributes: v.Projection.NonKeyAttributes } : {}),
    },
    ...(v.SearchSchema
      ? { SearchSchema: v.SearchSchema.map((s) => ({ AttributeName: s.AttributeName, SearchSchemaElementType: s.SearchSchemaElementType })) }
      : {}),
  }));
}

module.exports = {
  "AWS::S3::Bucket": {
    requires: ["s3"],
    inPlace: ["Tags", "VersioningConfiguration", "NotificationConfiguration", "LifecycleConfiguration", "CorsConfiguration", "PublicAccessBlockConfiguration", "BucketEncryption", "WebsiteConfiguration", "LoggingConfiguration"],
    async create({ logicalId, stackName, props, sims, env }) {
      const name = props.BucketName || generateName(stackName, logicalId, { lower: true, max: 63 });
      assertOk(sims.s3.createBucket(name));
      return {
        physicalId: name,
        attrs: {
          Arn: arn(env, "s3", name, { region: false, account: false }),
          DomainName: `${name}.s3.amazonaws.com`,
          DualStackDomainName: `${name}.s3.dualstack.${env.region}.amazonaws.com`,
          RegionalDomainName: `${name}.s3.${env.region}.amazonaws.com`,
          WebsiteURL: `http://${name}.s3-website-${env.region}.amazonaws.com`,
        },
      };
    },
    async update({ physicalId, previous }) {
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      assertOk(await sims.s3.deleteBucket(physicalId));
    },
  },

  "AWS::SQS::Queue": {
    requires: ["sqs"],
    inPlace: ["Tags", "VisibilityTimeout", "DelaySeconds", "MessageRetentionPeriod", "ReceiveMessageWaitTimeSeconds", "MaximumMessageSize", "RedrivePolicy"],
    async create({ logicalId, stackName, props, sims, env }) {
      const name = props.QueueName || generateName(stackName, logicalId, { max: 80 });
      const attributes = {};
      for (const k of ["VisibilityTimeout", "DelaySeconds", "MessageRetentionPeriod", "ReceiveMessageWaitTimeSeconds", "MaximumMessageSize", "RedrivePolicy"]) {
        if (props[k] !== undefined) attributes[k] = props[k];
      }
      const result = assertOk(sims.sqs.createQueue(name, attributes));
      const queue = result?.queue || {};
      return {
        physicalId: name,
        ref: queue.url || name,
        attrs: { Arn: queue.arn || arn(env, "sqs", name), QueueName: name, QueueUrl: queue.url || name },
      };
    },
    async update({ physicalId, previous }) {
      return { physicalId, ref: previous.ref, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.sqs.deleteQueue(physicalId);
    },
  },

  "AWS::DynamoDB::Table": {
    requires: ["dynamodb"],
    inPlace: DYNAMO_IN_PLACE,
    async create({ logicalId, stackName, props, sims, env }) {
      const name = props.TableName || generateName(stackName, logicalId);
      const payBilling = props.BillingMode === "PAY_PER_REQUEST";
      const gsis = (props.GlobalSecondaryIndexes || []).map((gsi) => ({
        IndexName: gsi.IndexName,
        KeySchema: gsi.KeySchema,
        Projection: gsi.Projection || { ProjectionType: "ALL" },
        ...(!payBilling && gsi.ProvisionedThroughput
          ? {
              ProvisionedThroughput: {
                ReadCapacityUnits: Number(gsi.ProvisionedThroughput.ReadCapacityUnits || 5),
                WriteCapacityUnits: Number(gsi.ProvisionedThroughput.WriteCapacityUnits || 5),
              },
            }
          : {}),
      }));
      await sims.dynamodb.createTable({
        TableName: name,
        AttributeDefinitions: props.AttributeDefinitions || [],
        KeySchema: props.KeySchema || [],
        GlobalSecondaryIndexes: gsis,
        VectorIndexes: toApiVectorIndexes(props.VectorIndexes),
        BillingMode: props.BillingMode || "PAY_PER_REQUEST",
        Tags: props.Tags || [],
      });
      return {
        physicalId: name,
        attrs: {
          Arn: arn(env, "dynamodb", `table/${name}`),
          StreamArn: arn(env, "dynamodb", `table/${name}/stream/${new Date().toISOString()}`),
        },
      };
    },
    async update({ physicalId, props, previous, sims }) {
      // Apenas VectorIndexes é refletido no simulador; demais propriedades "in place" são metadados.
      const before = new Map((previous.props.VectorIndexes || []).map((v) => [v.IndexName, v]));
      const after = new Map((props.VectorIndexes || []).map((v) => [v.IndexName, v]));
      const updates = [];
      for (const [name, def] of before) {
        if (!after.has(name) || JSON.stringify(after.get(name)) !== JSON.stringify(def)) updates.push({ Delete: { IndexName: name } });
      }
      for (const [name, def] of after) {
        if (!before.has(name) || JSON.stringify(before.get(name)) !== JSON.stringify(def)) {
          updates.push({ Create: toApiVectorIndexes([def])[0] });
        }
      }
      if (updates.length) sims.dynamodb.updateTable({ TableName: physicalId, VectorIndexUpdates: updates });
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      await sims.dynamodb.deleteTable({ TableName: physicalId });
    },
  },

  "AWS::KMS::Key": {
    requires: ["kms"],
    inPlace: ["Description", "Enabled", "EnableKeyRotation", "KeyPolicy", "Tags", "PendingWindowInDays"],
    async create({ logicalId, stackName, props, sims, env }) {
      const result = await sims.kms.createKey({
        Description: props.Description || `${stackName}-${logicalId}`,
        KeyUsage: props.KeyUsage || "ENCRYPT_DECRYPT",
        KeySpec: props.KeySpec || props.CustomerMasterKeySpec || "SYMMETRIC_DEFAULT",
        Tags: props.Tags || [],
      });
      const keyId = result.KeyMetadata.KeyId;
      return { physicalId: keyId, attrs: { Arn: result.KeyMetadata.Arn || arn(env, "kms", `key/${keyId}`), KeyId: keyId } };
    },
    async update({ physicalId, previous }) {
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      await sims.kms.scheduleKeyDeletion({ KeyId: physicalId, PendingWindowInDays: 7 });
    },
  },

  "AWS::SecretsManager::Secret": {
    requires: ["secrets"],
    inPlace: ["Description", "Tags", "KmsKeyId"],
    async create({ logicalId, stackName, props, sims, env }) {
      const name = props.Name || generateName(stackName, logicalId, { max: 512 });
      let secretString = props.SecretString;
      if (secretString === undefined && props.GenerateSecretString) {
        const g = props.GenerateSecretString;
        const len = Number(g.PasswordLength || 32);
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const password = Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
        secretString = g.SecretStringTemplate && g.GenerateStringKey
          ? JSON.stringify({ ...JSON.parse(g.SecretStringTemplate), [g.GenerateStringKey]: password })
          : password;
      }
      const result = await sims.secrets.createSecret({
        Name: name,
        Description: props.Description || "",
        SecretString: secretString ?? "{}",
        Tags: props.Tags || [],
        ...(props.KmsKeyId ? { KmsKeyId: props.KmsKeyId } : {}),
      });
      const secretArn = result?.ARN || arn(env, "secretsmanager", `secret:${name}`);
      return { physicalId: name, ref: secretArn, attrs: { Arn: secretArn, Id: secretArn } };
    },
    async update({ physicalId, previous }) {
      return { physicalId, ref: previous.ref, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      await sims.secrets.deleteSecret({ SecretId: physicalId, ForceDeleteWithoutRecovery: true });
    },
  },

  "AWS::SSM::Parameter": {
    requires: ["parameterStore"],
    inPlace: ["Value", "Description", "Tags", "AllowedPattern", "Tier", "Policies"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.Name || `/${stackName}/${logicalId}`;
      await sims.parameterStore.putParameter({
        Name: name,
        Value: String(props.Value ?? ""),
        Type: props.Type || "String",
        Description: props.Description || "",
        Tags: Array.isArray(props.Tags) ? props.Tags : [],
        Overwrite: true,
      });
      return { physicalId: name, attrs: { Type: props.Type || "String", Value: String(props.Value ?? "") } };
    },
    async update({ physicalId, props, sims }) {
      await sims.parameterStore.putParameter({
        Name: physicalId,
        Value: String(props.Value ?? ""),
        Type: props.Type || "String",
        Description: props.Description || "",
        Overwrite: true,
      });
      return { physicalId, attrs: { Type: props.Type || "String", Value: String(props.Value ?? "") } };
    },
    async delete({ physicalId, sims }) {
      await sims.parameterStore.deleteParameter({ Name: physicalId });
    },
  },

  "AWS::Athena::WorkGroup": {
    requires: ["athena"],
    inPlace: ["Description", "Tags", "WorkGroupConfiguration", "State"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.Name || generateName(stackName, logicalId);
      await sims.athena.createWorkGroup({
        Name: name,
        Description: props.Description || "",
        Configuration: props.WorkGroupConfiguration || {},
      });
      return { physicalId: name, attrs: { WorkGroupConfiguration: props.WorkGroupConfiguration || {} } };
    },
    async update({ physicalId, previous }) {
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      await sims.athena.deleteWorkGroup({ WorkGroup: physicalId, RecursiveDeleteOption: true });
    },
  },
};
