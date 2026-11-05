"use strict";

/**
 * Handlers CloudFormation: SNS, Lambda, KMS Alias, S3 BucketPolicy, EventBridge,
 * e recursos "virtuais" (políticas/permissões) que o simulador não impõe.
 */

const { assertOk, arn, generateName, toBool, toNumber } = require("./helpers");

const json = (v) => (typeof v === "string" ? v : JSON.stringify(v));

/** Recurso sem efeito nos simuladores (política/permissão não aplicada), mas rastreado no stack. */
const virtual = (inPlace = []) => ({
  inPlace,
  async create({ logicalId, stackName }) {
    return { physicalId: `${stackName}-${logicalId}`, attrs: {} };
  },
  async delete() {},
});

module.exports = {
  // ─── SNS ────────────────────────────────────────────────────────────────
  "AWS::SNS::Topic": {
    requires: ["sns"],
    inPlace: ["DisplayName", "Tags", "KmsMasterKeyId", "Subscription"],
    async create({ logicalId, stackName, props, sims }) {
      let name = props.TopicName || generateName(stackName, logicalId, { max: 256 });
      if (toBool(props.FifoTopic, false) && !name.endsWith(".fifo")) name += ".fifo";
      const attributes = {};
      if (props.DisplayName) attributes.DisplayName = props.DisplayName;
      if (toBool(props.FifoTopic, false)) attributes.FifoTopic = "true";
      if (props.ContentBasedDeduplication !== undefined) attributes.ContentBasedDeduplication = String(props.ContentBasedDeduplication);
      const { TopicArn } = await sims.sns.createTopic({ Name: name, Attributes: attributes, Tags: props.Tags || [] });
      const subscriptionArns = [];
      for (const s of props.Subscription || []) {
        const r = await sims.sns.subscribe({ TopicArn, Protocol: s.Protocol, Endpoint: s.Endpoint });
        subscriptionArns.push(r.SubscriptionArn);
      }
      return { physicalId: TopicArn, attrs: { TopicArn, TopicName: name, SubscriptionArns: subscriptionArns } };
    },
    async update({ physicalId, props, previous, sims }) {
      const topic = sims.sns.topics?.get(physicalId);
      if (topic && props.DisplayName !== undefined) topic.Attributes.DisplayName = props.DisplayName;
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      await sims.sns.deleteTopic({ TopicArn: physicalId });
    },
  },

  "AWS::SNS::Subscription": {
    requires: ["sns"],
    inPlace: ["FilterPolicy", "RawMessageDelivery", "DeliveryPolicy", "RedrivePolicy"],
    async create({ props, sims }) {
      const attributes = {};
      if (props.RawMessageDelivery !== undefined) attributes.RawMessageDelivery = String(props.RawMessageDelivery);
      if (props.FilterPolicy) attributes.FilterPolicy = json(props.FilterPolicy);
      if (props.RedrivePolicy) attributes.RedrivePolicy = json(props.RedrivePolicy);
      const r = await sims.sns.subscribe({
        TopicArn: props.TopicArn,
        Protocol: props.Protocol,
        Endpoint: props.Endpoint,
        Attributes: attributes,
        ReturnSubscriptionArn: true,
      });
      return { physicalId: r.SubscriptionArn, attrs: {} };
    },
    async delete({ physicalId, sims }) {
      await sims.sns.unsubscribe({ SubscriptionArn: physicalId });
    },
  },

  "AWS::SNS::TopicPolicy": virtual(["PolicyDocument", "Topics"]),
  "AWS::SQS::QueuePolicy": virtual(["PolicyDocument", "Queues"]),

  // ─── Lambda ─────────────────────────────────────────────────────────────
  "AWS::Lambda::Function": {
    requires: ["lambda"],
    inPlace: ["Description", "Timeout", "MemorySize", "Environment", "Tags", "Role", "Code", "Handler", "Layers", "ReservedConcurrentExecutions", "TracingConfig"],
    async create({ logicalId, stackName, props, sims, env }) {
      const name = props.FunctionName || generateName(stackName, logicalId, { max: 64 });
      const code = props.Code?.ZipFile;
      await sims.lambda.createFunction({
        name,
        code,
        runtime: props.Runtime,
        handler: props.Handler,
        timeout: toNumber(props.Timeout, 3),
        memorySize: toNumber(props.MemorySize, 128),
        environment: props.Environment?.Variables || {},
      });
      return {
        physicalId: name,
        attrs: { Arn: `arn:aws:lambda:${env.region}:${env.account}:function:${name}`, "SnapStartResponse.ApplyOn": "None" },
      };
    },
    async update({ physicalId, props, sims, previous }) {
      await sims.lambda.updateFunction(physicalId, {
        code: props.Code?.ZipFile,
        runtime: props.Runtime,
        timeout: toNumber(props.Timeout, undefined),
        memorySize: toNumber(props.MemorySize, undefined),
        environment: props.Environment?.Variables,
      });
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      await sims.lambda.deleteFunction(physicalId);
    },
  },

  "AWS::Lambda::EventSourceMapping": {
    requires: ["lambda"],
    inPlace: ["BatchSize", "Enabled"],
    async create({ props, sims }) {
      const mapping = sims.lambda.createEventSourceMapping({
        EventSourceArn: props.EventSourceArn,
        FunctionName: String(props.FunctionName).split(":").pop(),
        BatchSize: toNumber(props.BatchSize, 10),
        Enabled: toBool(props.Enabled, true),
      });
      const uuid = mapping?.UUID || mapping?.uuid;
      return { physicalId: uuid, attrs: { Id: uuid, EventSourceMappingArn: `arn:aws:lambda:local:000000000000:event-source-mapping:${uuid}` } };
    },
    async delete({ physicalId, sims }) {
      sims.lambda.deleteEventSourceMapping(physicalId);
    },
  },

  "AWS::Lambda::Url": {
    requires: ["lambda"],
    inPlace: ["Cors", "InvokeMode"],
    async create({ props, sims }) {
      const fn = String(props.TargetFunctionArn).split(":").pop();
      const cfg = sims.lambda.createFunctionUrlConfig(fn, { AuthType: props.AuthType || "NONE", Cors: props.Cors, InvokeMode: props.InvokeMode });
      return { physicalId: cfg.FunctionArn, attrs: { FunctionArn: cfg.FunctionArn, FunctionUrl: cfg.FunctionUrl } };
    },
    async delete({ props, sims }) {
      sims.lambda.deleteFunctionUrlConfig(String(props?.TargetFunctionArn).split(":").pop());
    },
  },

  "AWS::Lambda::Permission": virtual(["Action", "Principal", "SourceArn"]),
  "AWS::Lambda::Version": {
    inPlace: ["Description"],
    async create({ props, env }) {
      const fn = String(props.FunctionName);
      return { physicalId: `${fn}:1`, attrs: { Version: "1", FunctionArn: `arn:aws:lambda:${env.region}:${env.account}:function:${fn}:1` } };
    },
    async delete() {},
  },
  "AWS::Lambda::Alias": {
    inPlace: ["Description", "FunctionVersion"],
    async create({ props, env }) {
      const fn = String(props.FunctionName);
      const arnValue = `arn:aws:lambda:${env.region}:${env.account}:function:${fn}:${props.Name}`;
      return { physicalId: arnValue, attrs: { AliasArn: arnValue } };
    },
    async delete() {},
  },

  // ─── KMS / S3 ───────────────────────────────────────────────────────────
  "AWS::KMS::Alias": {
    requires: ["kms"],
    inPlace: [],
    async create({ props, sims }) {
      await sims.kms.createAlias({ AliasName: props.AliasName, TargetKeyId: props.TargetKeyId });
      return { physicalId: props.AliasName, attrs: {} };
    },
    async delete({ physicalId, sims }) {
      await sims.kms.deleteAlias({ AliasName: physicalId });
    },
  },

  "AWS::S3::BucketPolicy": {
    requires: ["s3"],
    inPlace: ["PolicyDocument"],
    async create({ props, sims, logicalId, stackName }) {
      assertOk(sims.s3.putBucketPolicy(props.Bucket, props.PolicyDocument));
      return { physicalId: `${stackName}-${logicalId}`, attrs: {} };
    },
    async update({ physicalId, props, sims, previous }) {
      assertOk(sims.s3.putBucketPolicy(props.Bucket, props.PolicyDocument));
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ props, sims }) {
      try {
        sims.s3.deleteBucketPolicy(props.Bucket);
      } catch (_) {}
    },
  },

  // ─── EventBridge ────────────────────────────────────────────────────────
  "AWS::Events::EventBus": {
    requires: ["eventbridge"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const r = await sims.eventbridge.createEventBus({ Name: props.Name, EventSourceName: props.EventSourceName, Tags: props.Tags });
      const busArn = r?.EventBusArn || r?.Arn || `arn:aws:events:local:000000000000:event-bus/${props.Name}`;
      return { physicalId: props.Name, ref: props.Name, attrs: { Arn: busArn, Name: props.Name } };
    },
    async delete({ physicalId, sims }) {
      await sims.eventbridge.deleteEventBus({ Name: physicalId });
    },
  },

  "AWS::Events::Rule": {
    requires: ["eventbridge"],
    inPlace: ["Description", "State", "Targets", "EventPattern", "ScheduleExpression", "RoleArn"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.Name || generateName(stackName, logicalId, { max: 64 });
      const bus = props.EventBusName || "default";
      const r = await sims.eventbridge.putRule({
        Name: name,
        EventBusName: bus,
        EventPattern: props.EventPattern ? json(props.EventPattern) : undefined,
        ScheduleExpression: props.ScheduleExpression,
        State: props.State || "ENABLED",
        Description: props.Description,
        RoleArn: props.RoleArn,
      });
      if (props.Targets?.length) {
        await sims.eventbridge.putTargets({
          Rule: name,
          EventBusName: bus,
          Targets: props.Targets.map((t) => ({ ...t, Input: t.Input !== undefined ? json(t.Input) : undefined })),
        });
      }
      return { physicalId: name, attrs: { Arn: r.RuleArn } };
    },
    async update({ physicalId, props, previous, sims }) {
      const bus = props.EventBusName || "default";
      await sims.eventbridge.putRule({
        Name: physicalId,
        EventBusName: bus,
        EventPattern: props.EventPattern ? json(props.EventPattern) : undefined,
        ScheduleExpression: props.ScheduleExpression,
        State: props.State || "ENABLED",
        Description: props.Description,
        RoleArn: props.RoleArn,
      });
      const oldIds = (previous.props.Targets || []).map((t) => t.Id);
      if (oldIds.length) await sims.eventbridge.removeTargets({ Rule: physicalId, EventBusName: bus, Ids: oldIds });
      if (props.Targets?.length) {
        await sims.eventbridge.putTargets({
          Rule: physicalId,
          EventBusName: bus,
          Targets: props.Targets.map((t) => ({ ...t, Input: t.Input !== undefined ? json(t.Input) : undefined })),
        });
      }
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, props, sims }) {
      const bus = props?.EventBusName || "default";
      const ids = (props?.Targets || []).map((t) => t.Id);
      if (ids.length) await sims.eventbridge.removeTargets({ Rule: physicalId, EventBusName: bus, Ids: ids });
      await sims.eventbridge.deleteRule({ Name: physicalId, EventBusName: bus, Force: true });
    },
  },
};
