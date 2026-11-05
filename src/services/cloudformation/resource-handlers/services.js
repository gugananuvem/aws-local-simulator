"use strict";

/**
 * Handlers CloudFormation: CloudFront, ACM, OpenSearch, Aurora/RDS, DAX, Config,
 * CloudTrail, X-Ray, Kinesis Analytics e extras do Athena.
 */

const { arn, generateName, toBool, toNumber } = require("./helpers");

/** Lista CFN -> estrutura { Quantity, Items } da API do CloudFront. */
const cfList = (items = []) => ({ Quantity: items.length, Items: items });

/** Primeira letra minúscula nas chaves de topo (AWS Config usa name, roleARN, ...). */
const lowerKeys = (obj = {}) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), v]));

const hostPort = (endpoint, fallbackPort) => {
  const [address, port] = String(endpoint || "").split(":");
  return { address: address || "", port: port || String(fallbackPort ?? "") };
};

module.exports = {
  // ─── CloudFront ─────────────────────────────────────────────────────────
  "AWS::CloudFront::Distribution": {
    requires: ["cloudfront"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const cfg = props.DistributionConfig || {};
      const origins = (cfg.Origins || []).map((o) => ({ ...o, id: o.Id }));
      const distribution = sims.cloudfront.createDistribution({
        Comment: cfg.Comment || "",
        DefaultRootObject: cfg.DefaultRootObject,
        Enabled: toBool(cfg.Enabled, true),
        Origins: cfList(origins),
        DefaultCacheBehavior: cfg.DefaultCacheBehavior,
        CacheBehaviors: cfList(cfg.CacheBehaviors || []),
        Aliases: cfList(cfg.Aliases || []),
        PriceClass: cfg.PriceClass,
        ViewerCertificate: cfg.ViewerCertificate,
        Restrictions: cfg.Restrictions,
        WebACLId: cfg.WebACLId,
      });
      return { physicalId: distribution.Id, attrs: { Id: distribution.Id, DomainName: distribution.DomainName } };
    },
    async delete({ physicalId, sims }) {
      sims.cloudfront.deleteDistribution(physicalId);
    },
  },

  // ─── ACM ────────────────────────────────────────────────────────────────
  "AWS::CertificateManager::Certificate": {
    requires: ["acm"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const cert = sims.acm.requestCertificate(props.DomainName, {
        SubjectAlternativeNames: props.SubjectAlternativeNames,
        ValidationMethod: props.ValidationMethod || "DNS",
        Tags: props.Tags || [],
      });
      return { physicalId: cert.CertificateArn, attrs: { CertificateArn: cert.CertificateArn } };
    },
    async delete({ physicalId, sims }) {
      sims.acm.deleteCertificate(physicalId);
    },
  },

  // ─── OpenSearch (sem conceito de domínio no simulador: endpoint único) ──
  ...Object.fromEntries(["AWS::OpenSearchService::Domain", "AWS::Elasticsearch::Domain"].map((type) => [
    type,
    {
      inPlace: ["ClusterConfig", "EBSOptions", "AccessPolicies", "Tags", "EngineVersion", "ElasticsearchClusterConfig"],
      async create({ logicalId, stackName, props, env, sims }) {
        const name = props.DomainName || generateName(stackName, logicalId, { lower: true, max: 28 });
        const port = sims.opensearch?.config?.ports?.opensearch || 9200;
        const domainArn = arn(env, "es", `domain/${name}`);
        return {
          physicalId: name,
          attrs: { Arn: domainArn, DomainArn: domainArn, DomainEndpoint: `localhost:${port}`, DomainName: name },
        };
      },
      async delete() {},
    },
  ])),

  // ─── Aurora / RDS ───────────────────────────────────────────────────────
  "AWS::RDS::DBCluster": {
    requires: ["aurora"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const id = (props.DBClusterIdentifier || generateName(stackName, logicalId, { lower: true, max: 63 })).toLowerCase();
      const { DBCluster } = await sims.aurora.createDBCluster({
        DBClusterIdentifier: id,
        Engine: props.Engine,
        EngineVersion: props.EngineVersion,
        MasterUsername: props.MasterUsername,
        MasterUserPassword: props.MasterUserPassword,
        Port: props.Port !== undefined ? Number(props.Port) : undefined,
        DatabaseName: props.DatabaseName,
        StorageEncrypted: toBool(props.StorageEncrypted, false),
        KmsKeyId: props.KmsKeyId,
        AvailabilityZones: props.AvailabilityZones,
      });
      const endpoint = hostPort(DBCluster.Endpoint, DBCluster.Port);
      const reader = hostPort(DBCluster.ReaderEndpoint, DBCluster.Port);
      return {
        physicalId: id,
        attrs: {
          "Endpoint.Address": endpoint.address,
          "Endpoint.Port": endpoint.port,
          "ReadEndpoint.Address": reader.address,
          DBClusterArn: DBCluster.DBClusterArn,
          "DBClusterResourceId": DBCluster.DbClusterResourceId,
        },
      };
    },
    async delete({ physicalId, sims }) {
      await sims.aurora.deleteDBCluster({ DBClusterIdentifier: physicalId });
    },
  },

  "AWS::RDS::DBInstance": {
    requires: ["aurora"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const id = (props.DBInstanceIdentifier || generateName(stackName, logicalId, { lower: true, max: 63 })).toLowerCase();
      const { DBInstance } = await sims.aurora.createDBInstance({
        DBInstanceIdentifier: id,
        DBClusterIdentifier: props.DBClusterIdentifier,
        DBInstanceClass: props.DBInstanceClass,
        Engine: props.Engine,
        EngineVersion: props.EngineVersion,
      });
      return {
        physicalId: id,
        attrs: {
          "Endpoint.Address": DBInstance.Endpoint?.Address,
          "Endpoint.Port": String(DBInstance.Endpoint?.Port ?? ""),
          DBInstanceArn: DBInstance.DBInstanceArn,
        },
      };
    },
    async delete({ physicalId, sims }) {
      await sims.aurora.deleteDBInstance({ DBInstanceIdentifier: physicalId });
    },
  },

  // ─── DAX ────────────────────────────────────────────────────────────────
  "AWS::DAX::Cluster": {
    requires: ["dax"],
    inPlace: ["Description", "Tags"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.ClusterName || generateName(stackName, logicalId, { lower: true, max: 20 });
      const r = sims.dax.createCluster({
        ClusterName: name,
        NodeType: props.NodeType,
        ReplicationFactor: toNumber(props.ReplicationFactor, 1),
        Description: props.Description,
        IamRoleArn: props.IAMRoleARN,
        SubnetGroupName: props.SubnetGroupName,
        ParameterGroupName: props.ParameterGroupName,
        SecurityGroupIds: props.SecurityGroupIds,
      });
      const cluster = r.Cluster || {};
      return {
        physicalId: name,
        attrs: {
          Arn: cluster.ClusterArn,
          ClusterDiscoveryEndpoint: cluster.ClusterDiscoveryEndpoint?.Address || `${name}.dax-clusters.local`,
          ClusterDiscoveryEndpointURL: `dax://${name}.dax-clusters.local`,
        },
      };
    },
    async delete({ physicalId, sims }) {
      sims.dax.deleteCluster({ ClusterName: physicalId });
    },
  },

  "AWS::DAX::SubnetGroup": {
    requires: ["dax"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.SubnetGroupName || generateName(stackName, logicalId, { lower: true, max: 255 });
      sims.dax.createSubnetGroup({ SubnetGroupName: name, Description: props.Description, SubnetIds: props.SubnetIds });
      return { physicalId: name, attrs: {} };
    },
    async delete({ physicalId, sims }) {
      sims.dax.deleteSubnetGroup({ SubnetGroupName: physicalId });
    },
  },

  "AWS::DAX::ParameterGroup": {
    requires: ["dax"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.ParameterGroupName || generateName(stackName, logicalId, { lower: true, max: 255 });
      sims.dax.createParameterGroup({ ParameterGroupName: name, Description: props.Description });
      return { physicalId: name, attrs: {} };
    },
    async delete({ physicalId, sims }) {
      sims.dax.deleteParameterGroup({ ParameterGroupName: physicalId });
    },
  },

  // ─── AWS Config ─────────────────────────────────────────────────────────
  "AWS::Config::ConfigRule": {
    requires: ["config"],
    inPlace: ["Description", "InputParameters", "Scope"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.ConfigRuleName || generateName(stackName, logicalId, { max: 128 });
      const rule = { ConfigRuleName: name, Description: props.Description, Source: props.Source, Scope: props.Scope, InputParameters: props.InputParameters };
      sims.config.putConfigRule({ ConfigRule: rule });
      return { physicalId: name, attrs: { Arn: arn({ region: "local", account: "000000000000" }, "config", `config-rule/${name}`), "Compliance.Type": "INSUFFICIENT_DATA" } };
    },
    async update({ physicalId, props, sims, previous }) {
      sims.config.putConfigRule({ ConfigRule: { ConfigRuleName: physicalId, Description: props.Description, Source: props.Source, Scope: props.Scope, InputParameters: props.InputParameters } });
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.config.deleteConfigRule({ ConfigRuleName: physicalId });
    },
  },

  "AWS::Config::ConfigurationRecorder": {
    requires: ["config"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.Name || "default";
      sims.config.putConfigurationRecorder({
        ConfigurationRecorder: { name, roleARN: props.RoleARN, recordingGroup: props.RecordingGroup ? lowerKeys(props.RecordingGroup) : undefined },
      });
      return { physicalId: name, attrs: {} };
    },
    async delete({ physicalId, sims }) {
      sims.config.deleteConfigurationRecorder?.({ ConfigurationRecorderName: physicalId });
    },
  },

  "AWS::Config::DeliveryChannel": {
    requires: ["config"],
    inPlace: [],
    async create({ props, sims }) {
      const name = props.Name || "default";
      sims.config.putDeliveryChannel({
        DeliveryChannel: { name, s3BucketName: props.S3BucketName, s3KeyPrefix: props.S3KeyPrefix, snsTopicARN: props.SnsTopicARN },
      });
      return { physicalId: name, attrs: {} };
    },
    async delete({ physicalId, sims }) {
      sims.config.deleteDeliveryChannel?.({ DeliveryChannelName: physicalId });
    },
  },

  // ─── CloudTrail ─────────────────────────────────────────────────────────
  "AWS::CloudTrail::Trail": {
    requires: ["cloudtrail"],
    inPlace: ["IsLogging", "Tags", "EventSelectors"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.TrailName || generateName(stackName, logicalId, { max: 128 });
      const trail = sims.cloudtrail.createTrail({
        Name: name,
        S3BucketName: props.S3BucketName,
        S3KeyPrefix: props.S3KeyPrefix,
        SnsTopicName: props.SnsTopicName,
        IncludeGlobalServiceEvents: toBool(props.IncludeGlobalServiceEvents, true),
        IsMultiRegionTrail: toBool(props.IsMultiRegionTrail, false),
        EnableLogFileValidation: toBool(props.EnableLogFileValidation, false),
        KmsKeyId: props.KMSKeyId,
      });
      if (toBool(props.IsLogging, false)) sims.cloudtrail.startLogging?.({ Name: name });
      const trailArn = trail?.TrailARN || arn({ region: "local", account: "000000000000" }, "cloudtrail", `trail/${name}`);
      return { physicalId: name, ref: name, attrs: { Arn: trailArn, SnsTopicArn: "" } };
    },
    async update({ physicalId, props, sims, previous }) {
      if (toBool(props.IsLogging, false)) sims.cloudtrail.startLogging?.({ Name: physicalId });
      else sims.cloudtrail.stopLogging?.({ Name: physicalId });
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.cloudtrail.deleteTrail({ Name: physicalId });
    },
  },

  // ─── X-Ray ──────────────────────────────────────────────────────────────
  "AWS::XRay::Group": {
    requires: ["xray"],
    inPlace: ["FilterExpression", "InsightsConfiguration", "Tags"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.GroupName || generateName(stackName, logicalId, { max: 32 });
      const r = await sims.xray.createGroup({ GroupName: name, FilterExpression: props.FilterExpression, InsightsConfiguration: props.InsightsConfiguration });
      const groupArn = r?.Group?.GroupARN || arn({ region: "local", account: "000000000000" }, "xray", `group/${name}`);
      return { physicalId: groupArn, attrs: { GroupARN: groupArn, GroupName: name } };
    },
    async delete({ physicalId, sims }) {
      await sims.xray.deleteGroup({ GroupARN: physicalId });
    },
  },

  "AWS::XRay::SamplingRule": {
    requires: ["xray"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const rule = { ...(props.SamplingRule || {}) };
      if (!rule.RuleName) rule.RuleName = generateName(stackName, logicalId, { max: 32 });
      const r = await sims.xray.createSamplingRule({ SamplingRule: rule });
      const ruleArn = r?.SamplingRuleRecord?.SamplingRule?.RuleARN || arn({ region: "local", account: "000000000000" }, "xray", `sampling-rule/${rule.RuleName}`);
      return { physicalId: ruleArn, attrs: { RuleARN: ruleArn } };
    },
    async delete({ physicalId, sims }) {
      await sims.xray.deleteSamplingRule({ RuleARN: physicalId });
    },
  },

  // ─── Kinesis Analytics ──────────────────────────────────────────────────
  "AWS::KinesisAnalytics::Application": {
    requires: ["kinesisAnalytics"],
    inPlace: ["ApplicationDescription"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.ApplicationName || generateName(stackName, logicalId, { max: 128 });
      const app = sims.kinesisAnalytics.createApplication(name, { applicationDescription: props.ApplicationDescription, applicationCode: props.ApplicationCode, inputs: props.Inputs });
      return { physicalId: name, attrs: { Arn: app?.applicationArn || arn({ region: "local", account: "000000000000" }, "kinesisanalytics", `application/${name}`) } };
    },
    async delete({ physicalId, sims }) {
      sims.kinesisAnalytics.deleteApplication(physicalId);
    },
  },

  // ─── Athena (extras) ────────────────────────────────────────────────────
  "AWS::Athena::NamedQuery": {
    requires: ["athena"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const r = await sims.athena.createNamedQuery({
        Name: props.Name || generateName(stackName, logicalId),
        Description: props.Description,
        Database: props.Database,
        QueryString: props.QueryString,
        WorkGroup: props.WorkGroup || "primary",
      });
      return { physicalId: r.NamedQueryId, attrs: { NamedQueryId: r.NamedQueryId } };
    },
    async delete({ physicalId, sims }) {
      await sims.athena.deleteNamedQuery({ NamedQueryId: physicalId });
    },
  },

  "AWS::Athena::DataCatalog": {
    requires: ["athena"],
    inPlace: ["Description", "Tags"],
    async create({ props, sims }) {
      await sims.athena.createDataCatalog({ Name: props.Name, Type: props.Type, Description: props.Description, Parameters: props.Parameters, Tags: props.Tags });
      return { physicalId: props.Name, attrs: {} };
    },
    async delete({ physicalId, sims }) {
      await sims.athena.deleteDataCatalog({ Name: physicalId });
    },
  },
};
