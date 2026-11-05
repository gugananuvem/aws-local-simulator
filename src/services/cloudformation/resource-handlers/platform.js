"use strict";

/**
 * Handlers CloudFormation: CloudWatch (Logs/Alarms), Kinesis, Firehose, Cognito, Route 53.
 */

const { arn, generateName, tagsToObject, toBool, toNumber } = require("./helpers");

const stripZonePrefix = (id) => String(id).replace(/^\/hostedzone\//, "");

module.exports = {
  // ─── CloudWatch ─────────────────────────────────────────────────────────
  "AWS::Logs::LogGroup": {
    requires: ["cloudwatch"],
    inPlace: ["RetentionInDays", "Tags", "KmsKeyId"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.LogGroupName || generateName(stackName, logicalId, { max: 512 });
      sims.cloudwatch.createLogGroup({
        logGroupName: name,
        retentionInDays: props.RetentionInDays !== undefined ? Number(props.RetentionInDays) : undefined,
        tags: tagsToObject(props.Tags),
      });
      const group = sims.cloudwatch.logGroups.get(name);
      return { physicalId: name, attrs: { Arn: group?.arn || `arn:aws:logs:local:000000000000:log-group:${name}:*` } };
    },
    async update({ physicalId, props, sims, previous }) {
      if (props.RetentionInDays !== undefined) sims.cloudwatch.putRetentionPolicy({ logGroupName: physicalId, retentionInDays: Number(props.RetentionInDays) });
      else sims.cloudwatch.deleteRetentionPolicy?.({ logGroupName: physicalId });
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.cloudwatch.deleteLogGroup({ logGroupName: physicalId });
    },
  },

  "AWS::CloudWatch::Alarm": {
    requires: ["cloudwatch"],
    inPlace: ["AlarmDescription", "ActionsEnabled", "AlarmActions", "OKActions", "InsufficientDataActions", "Threshold", "EvaluationPeriods", "DatapointsToAlarm", "Period", "Statistic", "ComparisonOperator", "TreatMissingData", "Dimensions", "Unit"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.AlarmName || generateName(stackName, logicalId, { max: 255 });
      const alarm = sims.cloudwatch.putMetricAlarm({
        alarmName: name,
        alarmDescription: props.AlarmDescription,
        actionsEnabled: toBool(props.ActionsEnabled, true),
        okActions: props.OKActions || [],
        alarmActions: props.AlarmActions || [],
        insufficientDataActions: props.InsufficientDataActions || [],
        metricName: props.MetricName,
        namespace: props.Namespace,
        statistic: props.Statistic || "Average",
        dimensions: props.Dimensions || [],
        period: toNumber(props.Period, 60),
        evaluationPeriods: toNumber(props.EvaluationPeriods, 1),
        datapointsToAlarm: props.DatapointsToAlarm !== undefined ? Number(props.DatapointsToAlarm) : undefined,
        threshold: Number(props.Threshold),
        comparisonOperator: props.ComparisonOperator,
        treatMissingData: props.TreatMissingData || "missing",
        unit: props.Unit,
      });
      return { physicalId: name, attrs: { Arn: alarm.alarmArn } };
    },
    async update({ physicalId, props, sims, previous }) {
      sims.cloudwatch.putMetricAlarm({
        alarmName: physicalId,
        alarmDescription: props.AlarmDescription,
        actionsEnabled: toBool(props.ActionsEnabled, true),
        okActions: props.OKActions || [],
        alarmActions: props.AlarmActions || [],
        insufficientDataActions: props.InsufficientDataActions || [],
        metricName: props.MetricName,
        namespace: props.Namespace,
        statistic: props.Statistic || "Average",
        dimensions: props.Dimensions || [],
        period: toNumber(props.Period, 60),
        evaluationPeriods: toNumber(props.EvaluationPeriods, 1),
        datapointsToAlarm: props.DatapointsToAlarm !== undefined ? Number(props.DatapointsToAlarm) : undefined,
        threshold: Number(props.Threshold),
        comparisonOperator: props.ComparisonOperator,
        treatMissingData: props.TreatMissingData || "missing",
        unit: props.Unit,
      });
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.cloudwatch.deleteAlarms({ alarmNames: [physicalId] });
    },
  },

  // ─── Kinesis / Firehose ─────────────────────────────────────────────────
  "AWS::Kinesis::Stream": {
    requires: ["kinesis"],
    inPlace: ["RetentionPeriodHours", "Tags", "StreamEncryption"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.Name || generateName(stackName, logicalId, { max: 128 });
      const stream = sims.kinesis.createStream(name, {
        shardCount: toNumber(props.ShardCount, 1),
        streamMode: props.StreamModeDetails?.StreamMode || "PROVISIONED",
        retentionPeriod: toNumber(props.RetentionPeriodHours, 24),
      });
      const streamArn = stream?.streamArn || `arn:aws:kinesis:us-east-1:123456789012:stream/${name}`;
      return { physicalId: name, attrs: { Arn: streamArn } };
    },
    async delete({ physicalId, sims }) {
      sims.kinesis.deleteStream(physicalId);
    },
  },

  "AWS::KinesisFirehose::DeliveryStream": {
    requires: ["firehose"],
    inPlace: ["Tags"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.DeliveryStreamName || generateName(stackName, logicalId, { max: 64 });
      const s3 = props.S3DestinationConfiguration || props.ExtendedS3DestinationConfiguration;
      const stream = sims.firehose.createDeliveryStream(name, {
        deliveryStreamType: props.DeliveryStreamType || "DirectPut",
        ...(s3 ? { s3DestinationConfiguration: s3 } : {}),
      });
      const streamArn = stream?.deliveryStreamArn || `arn:aws:firehose:us-east-1:123456789012:deliverystream/${name}`;
      return { physicalId: name, attrs: { Arn: streamArn } };
    },
    async delete({ physicalId, sims }) {
      sims.firehose.deleteDeliveryStream(physicalId);
    },
  },

  // ─── Cognito ────────────────────────────────────────────────────────────
  "AWS::Cognito::UserPool": {
    requires: ["cognito"],
    inPlace: ["LambdaConfig", "MfaConfiguration", "AutoVerifiedAttributes", "Policies", "UserPoolTags"],
    async create({ logicalId, stackName, props, sims, env }) {
      const name = props.UserPoolName || generateName(stackName, logicalId, { max: 128 });
      const { UserPool } = sims.cognito.createUserPool({
        PoolName: name,
        Policies: props.Policies,
        LambdaConfig: props.LambdaConfig,
        AutoVerifiedAttributes: props.AutoVerifiedAttributes,
        AliasAttributes: props.AliasAttributes,
        UsernameAttributes: props.UsernameAttributes,
        MfaConfiguration: props.MfaConfiguration,
      });
      return {
        physicalId: UserPool.Id,
        attrs: {
          Arn: UserPool.Arn,
          ProviderName: `cognito-idp.${env.region}.amazonaws.com/${UserPool.Id}`,
          ProviderURL: `https://cognito-idp.${env.region}.amazonaws.com/${UserPool.Id}`,
          UserPoolId: UserPool.Id,
        },
      };
    },
    async update({ physicalId, props, sims, previous }) {
      sims.cognito.updateUserPool({
        UserPoolId: physicalId,
        LambdaConfig: props.LambdaConfig,
        MfaConfiguration: props.MfaConfiguration,
        AutoVerifiedAttributes: props.AutoVerifiedAttributes,
        Policies: props.Policies,
      });
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.cognito.deleteUserPool({ UserPoolId: physicalId });
    },
  },

  "AWS::Cognito::UserPoolClient": {
    requires: ["cognito"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.ClientName || generateName(stackName, logicalId, { max: 128 });
      const { UserPoolClient } = sims.cognito.createUserPoolClient({
        UserPoolId: props.UserPoolId,
        ClientName: name,
        GenerateSecret: toBool(props.GenerateSecret, false),
        RefreshTokenValidity: props.RefreshTokenValidity !== undefined ? Number(props.RefreshTokenValidity) : undefined,
        AccessTokenValidity: props.AccessTokenValidity !== undefined ? Number(props.AccessTokenValidity) : undefined,
        IdTokenValidity: props.IdTokenValidity !== undefined ? Number(props.IdTokenValidity) : undefined,
        AllowedOAuthFlows: props.AllowedOAuthFlows,
        AllowedOAuthScopes: props.AllowedOAuthScopes,
        CallbackURLs: props.CallbackURLs,
        LogoutURLs: props.LogoutURLs,
      });
      return { physicalId: UserPoolClient.ClientId, attrs: { ClientSecret: UserPoolClient.ClientSecret || "", Name: name } };
    },
    async delete({ physicalId, props, sims }) {
      sims.cognito.deleteUserPoolClient({ UserPoolId: props?.UserPoolId, ClientId: physicalId });
    },
  },

  "AWS::Cognito::IdentityPool": {
    requires: ["cognito"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.IdentityPoolName || generateName(stackName, logicalId, { max: 128 });
      const pool = sims.cognito.createIdentityPool({
        IdentityPoolName: name,
        AllowUnauthenticatedIdentities: toBool(props.AllowUnauthenticatedIdentities, false),
        SupportedLoginProviders: props.SupportedLoginProviders,
        CognitoIdentityProviders: props.CognitoIdentityProviders,
      });
      const id = pool.IdentityPoolId;
      return { physicalId: id, attrs: { Name: name } };
    },
    async delete({ physicalId, sims }) {
      sims.cognito.identityPools?.delete?.(physicalId);
    },
  },

  // ─── Route 53 ───────────────────────────────────────────────────────────
  "AWS::Route53::HostedZone": {
    requires: ["route53"],
    inPlace: ["HostedZoneConfig", "HostedZoneTags"],
    async create({ props, sims }) {
      const zone = sims.route53.createHostedZone(props.Name, {
        Comment: props.HostedZoneConfig?.Comment,
        PrivateZone: Boolean(props.VPCs?.length),
      });
      const id = stripZonePrefix(zone.Id);
      return { physicalId: id, attrs: { Id: id, NameServers: ["ns-1.local.", "ns-2.local."] } };
    },
    async delete({ physicalId, sims }) {
      sims.route53.deleteHostedZone(physicalId);
    },
  },

  "AWS::Route53::RecordSet": {
    requires: ["route53"],
    inPlace: [],
    async create({ props, sims }) {
      const zoneId = props.HostedZoneId || [...sims.route53.hostedZones.values()].find((z) => z.Name === props.HostedZoneName)?.Id;
      if (!zoneId) throw new Error("HostedZoneId or a valid HostedZoneName is required");
      const values = props.AliasTarget ? [props.AliasTarget.DNSName] : props.ResourceRecords || [];
      sims.route53.createResourceRecord(zoneId, props.Name, props.Type, values, {
        TTL: toNumber(props.TTL, 300),
        SetIdentifier: props.SetIdentifier,
        Weight: props.Weight !== undefined ? Number(props.Weight) : undefined,
        Region: props.Region,
        Failover: props.Failover,
        HealthCheckId: props.HealthCheckId,
      });
      return { physicalId: props.Name, attrs: {} };
    },
    async delete({ props, sims }) {
      const zoneId = props?.HostedZoneId || [...sims.route53.hostedZones.values()].find((z) => z.Name === props?.HostedZoneName)?.Id;
      if (zoneId) sims.route53.deleteResourceRecord(zoneId, props.Name, props.Type);
    },
  },

  "AWS::Route53::HealthCheck": {
    requires: ["route53"],
    inPlace: ["HealthCheckTags"],
    async create({ props, sims }) {
      const hc = sims.route53.createHealthCheck(props.HealthCheckConfig || {});
      return { physicalId: hc.Id, attrs: { HealthCheckId: hc.Id } };
    },
    async delete({ physicalId, sims }) {
      sims.route53.deleteHealthCheck(physicalId);
    },
  },
};
