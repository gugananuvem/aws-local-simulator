'use strict';

/**
 * @fileoverview AWS Config Simulator
 *
 * Suporta:
 *  Configuration Recorders:
 *   - PutConfigurationRecorder / DeleteConfigurationRecorder
 *   - DescribeConfigurationRecorders / DescribeConfigurationRecorderStatus
 *   - StartConfigurationRecorder / StopConfigurationRecorder
 *
 *  Delivery Channels:
 *   - PutDeliveryChannel / DeleteDeliveryChannel
 *   - DescribeDeliveryChannels / DescribeDeliveryChannelStatus
 *   - DeliverConfigSnapshot
 *
 *  Config Rules:
 *   - PutConfigRule / DeleteConfigRule
 *   - DescribeConfigRules / DescribeConfigRuleEvaluationStatus
 *   - StartConfigRulesEvaluation
 *   - GetComplianceDetailsByConfigRule
 *   - GetComplianceDetailsByResource
 *   - GetComplianceSummaryByConfigRule
 *   - GetComplianceSummaryByResourceType
 *
 *  Resource Configuration:
 *   - GetResourceConfigHistory
 *   - ListDiscoveredResources
 *   - GetDiscoveredResourceCounts
 *   - BatchGetResourceConfig
 *   - BatchGetAggregateResourceConfig
 *
 *  Conformance Packs:
 *   - PutConformancePack / DeleteConformancePack
 *   - DescribeConformancePacks / DescribeConformancePackStatus
 *   - GetConformancePackComplianceSummary
 *
 *  Aggregators:
 *   - PutConfigurationAggregator / DeleteConfigurationAggregator
 *   - DescribeConfigurationAggregators
 *
 *  Remediation:
 *   - PutRemediationConfigurations / DeleteRemediationConfigurations
 *   - DescribeRemediationConfigurations
 *   - StartRemediationExecution
 *
 *  Tags:
 *   - TagResource / UntagResource / ListTagsForResource
 *
 *  Persistência via LocalStore
 */

const { randomUUID } = require('crypto');

// ─── Erros tipados ────────────────────────────────────────────────────────────

class ConfigError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const Errors = {
  NoSuchConfigRule: (name) =>
    new ConfigError('NoSuchConfigRuleException', `The ConfigRule '${name}' provided in the request is invalid`, 400),
  NoSuchConfigurationRecorder: (name) =>
    new ConfigError('NoSuchConfigurationRecorderException', `Cannot find configuration recorder '${name}'`, 400),
  NoSuchDeliveryChannel: (name) =>
    new ConfigError('NoSuchDeliveryChannelException', `Cannot find delivery channel '${name}'`, 400),
  NoSuchConformancePack: (name) =>
    new ConfigError('NoSuchConformancePackException', `Conformance pack '${name}' not found`, 400),
  NoSuchConfigurationAggregator: (name) =>
    new ConfigError('NoSuchConfigurationAggregatorException', `Aggregator '${name}' not found`, 400),
  NoSuchRemediationConfiguration: (name) =>
    new ConfigError('NoSuchRemediationConfigurationException', `Remediation configuration not found for rule '${name}'`, 400),
  MaxActiveRulesExceeded: () =>
    new ConfigError('MaxActiveRulesExceededException', 'Maximum number of active rules exceeded (max: 150)', 400),
  MaxNumberOfConfigRules: () =>
    new ConfigError('MaxNumberOfConfigRulesExceededException', 'Maximum number of config rules exceeded', 400),
  InvalidParameterValue: (msg) =>
    new ConfigError('InvalidParameterValueException', msg, 400),
  ValidationError: (msg) =>
    new ConfigError('ValidationException', msg, 400),
  ResourceNotFoundException: (msg) =>
    new ConfigError('ResourceNotFoundException', msg, 404),
  LimitExceeded: (msg) =>
    new ConfigError('LimitExceededException', msg, 400),
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const REGION = 'us-east-1';
const ACCOUNT_ID = '000000000000';
const MAX_RULES = 150;
const MAX_RESULTS_DEFAULT = 100;

// Tipos de recursos suportados
const SUPPORTED_RESOURCE_TYPES = [
  'AWS::EC2::Instance',
  'AWS::EC2::VPC',
  'AWS::EC2::Subnet',
  'AWS::EC2::SecurityGroup',
  'AWS::EC2::InternetGateway',
  'AWS::EC2::RouteTable',
  'AWS::EC2::NetworkInterface',
  'AWS::S3::Bucket',
  'AWS::IAM::Role',
  'AWS::IAM::Policy',
  'AWS::IAM::User',
  'AWS::IAM::Group',
  'AWS::Lambda::Function',
  'AWS::DynamoDB::Table',
  'AWS::SNS::Topic',
  'AWS::SQS::Queue',
  'AWS::CloudFormation::Stack',
  'AWS::CloudWatch::Alarm',
  'AWS::KMS::Key',
  'AWS::SecretsManager::Secret',
  'AWS::ECS::Cluster',
  'AWS::ECS::TaskDefinition',
  'AWS::ECS::Service',
  'AWS::StepFunctions::StateMachine',
  'AWS::ApiGateway::RestApi',
  'AWS::Cognito::UserPool',
];

// Modos de gravação do recorder
const RECORDER_MODES = ['ALL', 'INCLUDE', 'EXCLUDE'];

// ─── Utilitários ──────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function resourceArn(resourceType, resourceId) {
  const service = resourceType.split('::')[1].toLowerCase();
  return `arn:aws:${service}:${REGION}:${ACCOUNT_ID}:${resourceId}`;
}

function configRuleArn(ruleName) {
  return `arn:aws:config:${REGION}:${ACCOUNT_ID}:config-rule/config-rule-${ruleName}`;
}

function recorderArn(recorderName) {
  return `arn:aws:config:${REGION}:${ACCOUNT_ID}:configuration-recorder/${recorderName}`;
}

function conformancePackArn(packName) {
  return `arn:aws:config:${REGION}:${ACCOUNT_ID}:conformance-pack/${packName}`;
}

function aggregatorArn(aggregatorName) {
  return `arn:aws:config:${REGION}:${ACCOUNT_ID}:config-aggregator/${aggregatorName}`;
}

function paginate(items, nextToken, limit = MAX_RESULTS_DEFAULT) {
  let start = 0;
  if (nextToken) {
    try {
      start = parseInt(Buffer.from(nextToken, 'base64').toString(), 10);
    } catch {
      start = 0;
    }
  }
  const slice = items.slice(start, start + limit);
  const newToken = start + limit < items.length
    ? Buffer.from(String(start + limit)).toString('base64')
    : null;
  return { items: slice, nextToken: newToken };
}

// ─── Simulator Principal ──────────────────────────────────────────────────────

class ConfigSimulator {
  constructor(config, store, logger) {
    this.config = config;
    this.store = store;
    this.logger = logger;

    // State
    this.recorders = new Map();       // name → recorder object
    this.recorderStatus = new Map();  // name → status object
    this.deliveryChannels = new Map(); // name → channel object
    this.deliveryChannelStatus = new Map(); // name → status object
    this.configRules = new Map();     // name → rule object
    this.ruleEvaluationStatus = new Map(); // name → evaluation status
    this.evaluationResults = new Map(); // ruleId → evaluation results[]
    this.resourceConfigs = new Map(); // "type::id" → config history[]
    this.discoveredResources = new Map(); // "type::id" → resource info
    this.conformancePacks = new Map(); // name → pack object
    this.conformancePackStatus = new Map(); // name → status
    this.aggregators = new Map();     // name → aggregator object
    this.remediationConfigs = new Map(); // ruleName → remediation config[]
    this.remediationExecutions = new Map(); // ruleName → execution results[]
    this.tags = new Map();            // arn → { key: value }

    // Cross-service
    this.s3Simulator = null;
    this.snsSimulator = null;
    this.cloudtrailSimulator = null;

    // Recorder automático — inicia ao criar o primeiro recorder
    this._recordingInterval = null;
  }

  // ─── Persistência ──────────────────────────────────────────────────────────

  async load() {
    try {
      const data = await this.store.load('config');
      if (data) {
        if (data.recorders) this.recorders = new Map(Object.entries(data.recorders));
        if (data.recorderStatus) this.recorderStatus = new Map(Object.entries(data.recorderStatus));
        if (data.deliveryChannels) this.deliveryChannels = new Map(Object.entries(data.deliveryChannels));
        if (data.deliveryChannelStatus) this.deliveryChannelStatus = new Map(Object.entries(data.deliveryChannelStatus));
        if (data.configRules) this.configRules = new Map(Object.entries(data.configRules));
        if (data.ruleEvaluationStatus) this.ruleEvaluationStatus = new Map(Object.entries(data.ruleEvaluationStatus));
        if (data.evaluationResults) {
          this.evaluationResults = new Map(
            Object.entries(data.evaluationResults).map(([k, v]) => [k, v])
          );
        }
        if (data.resourceConfigs) {
          this.resourceConfigs = new Map(
            Object.entries(data.resourceConfigs).map(([k, v]) => [k, v])
          );
        }
        if (data.discoveredResources) {
          this.discoveredResources = new Map(Object.entries(data.discoveredResources));
        }
        if (data.conformancePacks) this.conformancePacks = new Map(Object.entries(data.conformancePacks));
        if (data.conformancePackStatus) this.conformancePackStatus = new Map(Object.entries(data.conformancePackStatus));
        if (data.aggregators) this.aggregators = new Map(Object.entries(data.aggregators));
        if (data.remediationConfigs) {
          this.remediationConfigs = new Map(Object.entries(data.remediationConfigs));
        }
        if (data.tags) this.tags = new Map(Object.entries(data.tags));
        this.logger.info('[Config] State loaded from store');
      }
    } catch (err) {
      this.logger.warn('[Config] Could not load state:', err.message);
    }
  }

  async save() {
    try {
      const data = {
        recorders: Object.fromEntries(this.recorders),
        recorderStatus: Object.fromEntries(this.recorderStatus),
        deliveryChannels: Object.fromEntries(this.deliveryChannels),
        deliveryChannelStatus: Object.fromEntries(this.deliveryChannelStatus),
        configRules: Object.fromEntries(this.configRules),
        ruleEvaluationStatus: Object.fromEntries(this.ruleEvaluationStatus),
        evaluationResults: Object.fromEntries(this.evaluationResults),
        resourceConfigs: Object.fromEntries(this.resourceConfigs),
        discoveredResources: Object.fromEntries(this.discoveredResources),
        conformancePacks: Object.fromEntries(this.conformancePacks),
        conformancePackStatus: Object.fromEntries(this.conformancePackStatus),
        aggregators: Object.fromEntries(this.aggregators),
        remediationConfigs: Object.fromEntries(this.remediationConfigs),
        tags: Object.fromEntries(this.tags),
      };
      await this.store.save('config', data);
    } catch (err) {
      this.logger.warn('[Config] Could not save state:', err.message);
    }
  }

  reset() {
    this.recorders.clear();
    this.recorderStatus.clear();
    this.deliveryChannels.clear();
    this.deliveryChannelStatus.clear();
    this.configRules.clear();
    this.ruleEvaluationStatus.clear();
    this.evaluationResults.clear();
    this.resourceConfigs.clear();
    this.discoveredResources.clear();
    this.conformancePacks.clear();
    this.conformancePackStatus.clear();
    this.aggregators.clear();
    this.remediationConfigs.clear();
    this.remediationExecutions.clear();
    this.tags.clear();
    this._stopRecording();
    this.logger.info('[Config] State reset');
  }

  // ─── Gravação automática de recursos ───────────────────────────────────────

  _startRecording() {
    if (this._recordingInterval) return;
    this._recordingInterval = setInterval(() => {
      this._recordResources();
    }, 30000); // a cada 30s simula nova captura
  }

  _stopRecording() {
    if (this._recordingInterval) {
      clearInterval(this._recordingInterval);
      this._recordingInterval = null;
    }
  }

  _recordResources() {
    // Registra recursos de serviços injetados
    const timestamp = now();

    // Lambda
    if (this.lambdaSimulator) {
      const functions = this.lambdaSimulator.functions || new Map();
      for (const [name, fn] of functions) {
        this._recordResourceConfig('AWS::Lambda::Function', name, fn, timestamp);
      }
    }

    // DynamoDB
    if (this.dynamoSimulator) {
      const tables = this.dynamoSimulator.tables || new Map();
      for (const [name, table] of tables) {
        this._recordResourceConfig('AWS::DynamoDB::Table', name, table, timestamp);
      }
    }

    // S3
    if (this.s3Simulator) {
      const buckets = this.s3Simulator.buckets || new Map();
      for (const [name, bucket] of buckets) {
        this._recordResourceConfig('AWS::S3::Bucket', name, bucket, timestamp);
      }
    }

    // SNS
    if (this.snsSimulator) {
      const topics = this.snsSimulator.topics || new Map();
      for (const [arn, topic] of topics) {
        this._recordResourceConfig('AWS::SNS::Topic', arn, topic, timestamp);
      }
    }
  }

  _recordResourceConfig(resourceType, resourceId, configuration, timestamp) {
    const key = `${resourceType}::${resourceId}`;
    const configItem = {
      version: '1.3',
      accountId: ACCOUNT_ID,
      configurationItemCaptureTime: timestamp || now(),
      configurationItemStatus: 'OK',
      configurationStateId: Date.now().toString(),
      configurationItemMD5Hash: randomUUID().replace(/-/g, ''),
      arn: resourceArn(resourceType, resourceId),
      resourceType,
      resourceId,
      resourceName: resourceId,
      awsRegion: REGION,
      availabilityZone: 'us-east-1a',
      tags: this.tags.get(resourceArn(resourceType, resourceId)) || {},
      relatedEvents: [],
      relationships: [],
      configuration: typeof configuration === 'object' ? JSON.stringify(configuration) : configuration,
      supplementaryConfiguration: {},
    };

    if (!this.resourceConfigs.has(key)) {
      this.resourceConfigs.set(key, []);
    }
    const history = this.resourceConfigs.get(key);
    history.push(configItem);
    // Limita o histórico a 100 itens por recurso
    if (history.length > 100) history.shift();

    // Registra como recurso descoberto
    this.discoveredResources.set(key, {
      resourceType,
      resourceId,
      resourceName: resourceId,
      resourceDeletionTime: null,
    });
  }

  // ─── Configuration Recorders ────────────────────────────────────────────────

  putConfigurationRecorder({ ConfigurationRecorder }) {
    if (!ConfigurationRecorder || !ConfigurationRecorder.name) {
      throw Errors.ValidationError('ConfigurationRecorder name is required');
    }

    const { name, roleARN, recordingGroup, recordingMode } = ConfigurationRecorder;

    const recorder = {
      name,
      roleARN: roleARN || `arn:aws:iam::${ACCOUNT_ID}:role/aws-config-role`,
      recordingGroup: recordingGroup || {
        allSupported: true,
        includeGlobalResourceTypes: false,
        resourceTypes: [],
      },
      recordingMode: recordingMode || {
        recordingFrequency: 'CONTINUOUS',
      },
    };

    this.recorders.set(name, recorder);

    if (!this.recorderStatus.has(name)) {
      this.recorderStatus.set(name, {
        name,
        lastStartTime: null,
        lastStopTime: null,
        recording: false,
        lastStatus: 'Pending',
        lastStatusChangeTime: now(),
        lastSuccessfulDeliveryTime: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    }

    this.logger.info(`[Config] Configuration recorder '${name}' created/updated`);
    this.save();
    return {};
  }

  deleteConfigurationRecorder({ ConfigurationRecorderName }) {
    if (!this.recorders.has(ConfigurationRecorderName)) {
      throw Errors.NoSuchConfigurationRecorder(ConfigurationRecorderName);
    }
    this.recorders.delete(ConfigurationRecorderName);
    this.recorderStatus.delete(ConfigurationRecorderName);
    this.logger.info(`[Config] Configuration recorder '${ConfigurationRecorderName}' deleted`);
    this.save();
    return {};
  }

  describeConfigurationRecorders({ ConfigurationRecorderNames } = {}) {
    let recorders = Array.from(this.recorders.values());
    if (ConfigurationRecorderNames && ConfigurationRecorderNames.length > 0) {
      recorders = recorders.filter(r => ConfigurationRecorderNames.includes(r.name));
    }
    return { ConfigurationRecorders: recorders };
  }

  describeConfigurationRecorderStatus({ ConfigurationRecorderNames } = {}) {
    let statuses = Array.from(this.recorderStatus.values());
    if (ConfigurationRecorderNames && ConfigurationRecorderNames.length > 0) {
      statuses = statuses.filter(s => ConfigurationRecorderNames.includes(s.name));
    }
    return { ConfigurationRecordersStatus: statuses };
  }

  startConfigurationRecorder({ ConfigurationRecorderName }) {
    if (!this.recorders.has(ConfigurationRecorderName)) {
      throw Errors.NoSuchConfigurationRecorder(ConfigurationRecorderName);
    }
    const status = this.recorderStatus.get(ConfigurationRecorderName);
    status.recording = true;
    status.lastStartTime = now();
    status.lastStatus = 'SUCCESS';
    status.lastStatusChangeTime = now();
    this.recorderStatus.set(ConfigurationRecorderName, status);
    this._startRecording();
    this.logger.info(`[Config] Recorder '${ConfigurationRecorderName}' started`);
    this.save();
    return {};
  }

  stopConfigurationRecorder({ ConfigurationRecorderName }) {
    if (!this.recorders.has(ConfigurationRecorderName)) {
      throw Errors.NoSuchConfigurationRecorder(ConfigurationRecorderName);
    }
    const status = this.recorderStatus.get(ConfigurationRecorderName);
    status.recording = false;
    status.lastStopTime = now();
    status.lastStatus = 'SUCCESS';
    status.lastStatusChangeTime = now();
    this.recorderStatus.set(ConfigurationRecorderName, status);
    this.logger.info(`[Config] Recorder '${ConfigurationRecorderName}' stopped`);
    this.save();
    return {};
  }

  // ─── Delivery Channels ──────────────────────────────────────────────────────

  putDeliveryChannel({ DeliveryChannel }) {
    if (!DeliveryChannel || !DeliveryChannel.name) {
      throw Errors.ValidationError('DeliveryChannel name is required');
    }
    const { name, s3BucketName, s3KeyPrefix, snsTopicARN, configSnapshotDeliveryProperties } = DeliveryChannel;

    const channel = {
      name,
      s3BucketName: s3BucketName || '',
      s3KeyPrefix: s3KeyPrefix || '',
      snsTopicARN: snsTopicARN || '',
      configSnapshotDeliveryProperties: configSnapshotDeliveryProperties || {
        deliveryFrequency: 'TwentyFour_Hours',
      },
    };

    this.deliveryChannels.set(name, channel);

    if (!this.deliveryChannelStatus.has(name)) {
      this.deliveryChannelStatus.set(name, {
        name,
        configSnapshotDeliveryInfo: {
          lastStatus: 'NOT_APPLICABLE',
          lastStatusChangeTime: now(),
        },
        configHistoryDeliveryInfo: {
          lastStatus: 'NOT_APPLICABLE',
          lastStatusChangeTime: now(),
        },
        configStreamDeliveryInfo: {
          lastStatus: 'SUCCESS',
          lastStatusChangeTime: now(),
        },
      });
    }

    this.logger.info(`[Config] Delivery channel '${name}' created/updated`);
    this.save();
    return {};
  }

  deleteDeliveryChannel({ DeliveryChannelName }) {
    if (!this.deliveryChannels.has(DeliveryChannelName)) {
      throw Errors.NoSuchDeliveryChannel(DeliveryChannelName);
    }
    this.deliveryChannels.delete(DeliveryChannelName);
    this.deliveryChannelStatus.delete(DeliveryChannelName);
    this.logger.info(`[Config] Delivery channel '${DeliveryChannelName}' deleted`);
    this.save();
    return {};
  }

  describeDeliveryChannels({ DeliveryChannelNames } = {}) {
    let channels = Array.from(this.deliveryChannels.values());
    if (DeliveryChannelNames && DeliveryChannelNames.length > 0) {
      channels = channels.filter(c => DeliveryChannelNames.includes(c.name));
    }
    return { DeliveryChannels: channels };
  }

  describeDeliveryChannelStatus({ DeliveryChannelNames } = {}) {
    let statuses = Array.from(this.deliveryChannelStatus.values());
    if (DeliveryChannelNames && DeliveryChannelNames.length > 0) {
      statuses = statuses.filter(s => DeliveryChannelNames.includes(s.name));
    }
    return { DeliveryChannelsStatus: statuses };
  }

  deliverConfigSnapshot({ DeliveryChannelName }) {
    if (!this.deliveryChannels.has(DeliveryChannelName)) {
      throw Errors.NoSuchDeliveryChannel(DeliveryChannelName);
    }
    const configSnapshotId = randomUUID();
    const channel = this.deliveryChannels.get(DeliveryChannelName);
    const status = this.deliveryChannelStatus.get(DeliveryChannelName);

    // Simula entrega para S3
    if (this.s3Simulator && channel.s3BucketName) {
      const snapshotKey = `${channel.s3KeyPrefix || 'AWSLogs'}/${ACCOUNT_ID}/Config/${REGION}/${now().split('T')[0]}/ConfigSnapshot/${configSnapshotId}.json`;
      const snapshot = {
        fileVersion: '1.0',
        requestId: configSnapshotId,
        configurationItems: Array.from(this.resourceConfigs.values()).flatMap(v => v.slice(-1)),
      };
      try {
        this.s3Simulator.putObject({
          Bucket: channel.s3BucketName,
          Key: snapshotKey,
          Body: JSON.stringify(snapshot),
          ContentType: 'application/json',
        });
      } catch (err) {
        this.logger.warn(`[Config] Could not deliver snapshot to S3: ${err.message}`);
      }
    }

    // Atualiza status do canal
    status.configSnapshotDeliveryInfo = {
      lastStatus: 'SUCCESS',
      lastStatusChangeTime: now(),
      lastSuccessfulTime: now(),
      nextDeliveryTime: new Date(Date.now() + 86400000).toISOString(),
    };
    this.deliveryChannelStatus.set(DeliveryChannelName, status);
    this.save();

    this.logger.info(`[Config] Config snapshot delivered — ID: ${configSnapshotId}`);
    return { configSnapshotId };
  }

  // ─── Config Rules ───────────────────────────────────────────────────────────

  putConfigRule({ ConfigRule, Tags }) {
    if (!ConfigRule || !ConfigRule.ConfigRuleName) {
      throw Errors.ValidationError('ConfigRule.ConfigRuleName is required');
    }

    if (this.configRules.size >= MAX_RULES && !this.configRules.has(ConfigRule.ConfigRuleName)) {
      throw Errors.MaxActiveRulesExceeded();
    }

    const {
      ConfigRuleName,
      Description,
      Scope,
      Source,
      InputParameters,
      MaximumExecutionFrequency,
      ConfigRuleState,
    } = ConfigRule;

    const ruleId = `config-rule-${randomUUID().substring(0, 8)}`;
    const existing = this.configRules.get(ConfigRuleName);

    const rule = {
      ConfigRuleName,
      ConfigRuleArn: configRuleArn(ConfigRuleName),
      ConfigRuleId: existing ? existing.ConfigRuleId : ruleId,
      Description: Description || '',
      Scope: Scope || null,
      Source: Source || { Owner: 'AWS', SourceIdentifier: 'REQUIRED_TAGS' },
      InputParameters: InputParameters || '{}',
      MaximumExecutionFrequency: MaximumExecutionFrequency || 'TwentyFour_Hours',
      ConfigRuleState: ConfigRuleState || 'ACTIVE',
      CreatedBy: 'Local',
    };

    this.configRules.set(ConfigRuleName, rule);

    // Inicializa status de avaliação
    if (!this.ruleEvaluationStatus.has(ConfigRuleName)) {
      this.ruleEvaluationStatus.set(ConfigRuleName, {
        ConfigRuleName,
        ConfigRuleArn: rule.ConfigRuleArn,
        ConfigRuleId: rule.ConfigRuleId,
        LastSuccessfulInvocationTime: null,
        LastFailedInvocationTime: null,
        LastSuccessfulEvaluationTime: null,
        LastFailedEvaluationTime: null,
        FirstActivatedTime: now(),
        LastDeactivatedTime: null,
        LastErrorCode: null,
        LastErrorMessage: null,
        FirstEvaluationStarted: false,
      });
    }

    // Tags
    if (Tags && Tags.length > 0) {
      const arn = rule.ConfigRuleArn;
      const tagMap = this.tags.get(arn) || {};
      for (const { Key, Value } of Tags) tagMap[Key] = Value;
      this.tags.set(arn, tagMap);
    }

    this.logger.info(`[Config] Config rule '${ConfigRuleName}' created/updated`);
    this.save();
    return {};
  }

  deleteConfigRule({ ConfigRuleName }) {
    if (!this.configRules.has(ConfigRuleName)) {
      throw Errors.NoSuchConfigRule(ConfigRuleName);
    }
    const rule = this.configRules.get(ConfigRuleName);
    this.configRules.delete(ConfigRuleName);
    this.ruleEvaluationStatus.delete(ConfigRuleName);
    this.evaluationResults.delete(ConfigRuleName);
    this.tags.delete(rule.ConfigRuleArn);
    this.logger.info(`[Config] Config rule '${ConfigRuleName}' deleted`);
    this.save();
    return {};
  }

  describeConfigRules({ ConfigRuleNames, NextToken, Filters } = {}) {
    let rules = Array.from(this.configRules.values());

    if (ConfigRuleNames && ConfigRuleNames.length > 0) {
      rules = rules.filter(r => ConfigRuleNames.includes(r.ConfigRuleName));
    }

    if (Filters) {
      if (Filters.ConfigRuleName) {
        rules = rules.filter(r => r.ConfigRuleName.includes(Filters.ConfigRuleName));
      }
    }

    const { items, nextToken } = paginate(rules, NextToken);
    return { ConfigRules: items, NextToken: nextToken };
  }

  describeConfigRuleEvaluationStatus({ ConfigRuleNames, NextToken, Limit } = {}) {
    let statuses = Array.from(this.ruleEvaluationStatus.values());

    if (ConfigRuleNames && ConfigRuleNames.length > 0) {
      statuses = statuses.filter(s => ConfigRuleNames.includes(s.ConfigRuleName));
    }

    const limit = Limit || MAX_RESULTS_DEFAULT;
    const { items, nextToken } = paginate(statuses, NextToken, limit);
    return { ConfigRulesEvaluationStatus: items, NextToken: nextToken };
  }

  startConfigRulesEvaluation({ ConfigRuleNames }) {
    if (!ConfigRuleNames || ConfigRuleNames.length === 0) {
      throw Errors.ValidationError('ConfigRuleNames is required');
    }

    for (const ruleName of ConfigRuleNames) {
      if (!this.configRules.has(ruleName)) {
        throw Errors.NoSuchConfigRule(ruleName);
      }

      const status = this.ruleEvaluationStatus.get(ruleName);
      status.FirstEvaluationStarted = true;
      status.LastSuccessfulInvocationTime = now();
      this.ruleEvaluationStatus.set(ruleName, status);

      // Executa avaliação assíncrona
      setImmediate(() => this._evaluateRule(ruleName));
    }

    this.save();
    return {};
  }

  _evaluateRule(ruleName) {
    const rule = this.configRules.get(ruleName);
    if (!rule) return;

    const results = [];
    const resources = Array.from(this.discoveredResources.values());

    for (const resource of resources) {
      // Verifica se o escopo da regra se aplica ao recurso
      let applicable = true;
      if (rule.Scope) {
        if (rule.Scope.ComplianceResourceTypes && rule.Scope.ComplianceResourceTypes.length > 0) {
          applicable = rule.Scope.ComplianceResourceTypes.includes(resource.resourceType);
        }
      }

      if (!applicable) continue;

      // Simula avaliação — COMPLIANT por padrão, NON_COMPLIANT aleatório
      const compliance = Math.random() > 0.2 ? 'COMPLIANT' : 'NON_COMPLIANT';

      results.push({
        EvaluationResultIdentifier: {
          EvaluationResultQualifier: {
            ConfigRuleName: ruleName,
            ResourceType: resource.resourceType,
            ResourceId: resource.resourceId,
            EvaluationMode: 'DETECTIVE',
          },
          OrderingTimestamp: now(),
        },
        ComplianceType: compliance,
        ResultRecordedTime: now(),
        ConfigRuleInvokedTime: now(),
        Annotation: compliance === 'NON_COMPLIANT' ? 'Resource does not comply with the rule' : '',
        ResultToken: randomUUID(),
      });
    }

    this.evaluationResults.set(ruleName, results);

    const status = this.ruleEvaluationStatus.get(ruleName);
    if (status) {
      status.LastSuccessfulEvaluationTime = now();
      this.ruleEvaluationStatus.set(ruleName, status);
    }

    this.save();
    this.logger.debug(`[Config] Rule '${ruleName}' evaluated: ${results.length} results`);
  }

  getComplianceDetailsByConfigRule({ ConfigRuleName, ComplianceTypes, NextToken, Limit } = {}) {
    if (!this.configRules.has(ConfigRuleName)) {
      throw Errors.NoSuchConfigRule(ConfigRuleName);
    }

    let results = this.evaluationResults.get(ConfigRuleName) || [];

    if (ComplianceTypes && ComplianceTypes.length > 0) {
      results = results.filter(r => ComplianceTypes.includes(r.ComplianceType));
    }

    const limit = Limit || MAX_RESULTS_DEFAULT;
    const { items, nextToken } = paginate(results, NextToken, limit);
    return { EvaluationResults: items, NextToken: nextToken };
  }

  getComplianceDetailsByResource({ ResourceType, ResourceId, ComplianceTypes, NextToken } = {}) {
    if (!ResourceType || !ResourceId) {
      throw Errors.ValidationError('ResourceType and ResourceId are required');
    }

    let results = [];
    for (const [ruleName, ruleResults] of this.evaluationResults) {
      const filtered = ruleResults.filter(
        r =>
          r.EvaluationResultIdentifier.EvaluationResultQualifier.ResourceType === ResourceType &&
          r.EvaluationResultIdentifier.EvaluationResultQualifier.ResourceId === ResourceId
      );
      results.push(...filtered);
    }

    if (ComplianceTypes && ComplianceTypes.length > 0) {
      results = results.filter(r => ComplianceTypes.includes(r.ComplianceType));
    }

    const { items, nextToken } = paginate(results, NextToken);
    return { EvaluationResults: items, NextToken: nextToken };
  }

  getComplianceSummaryByConfigRule() {
    let compliantCount = 0;
    let nonCompliantCount = 0;

    for (const [, results] of this.evaluationResults) {
      for (const r of results) {
        if (r.ComplianceType === 'COMPLIANT') compliantCount++;
        else if (r.ComplianceType === 'NON_COMPLIANT') nonCompliantCount++;
      }
    }

    const summaries = Array.from(this.configRules.keys()).map(ruleName => {
      const results = this.evaluationResults.get(ruleName) || [];
      const compliant = results.filter(r => r.ComplianceType === 'COMPLIANT').length;
      const nonCompliant = results.filter(r => r.ComplianceType === 'NON_COMPLIANT').length;
      const overallCompliance = nonCompliant === 0 && compliant > 0 ? 'COMPLIANT' :
        nonCompliant > 0 ? 'NON_COMPLIANT' : 'INSUFFICIENT_DATA';

      return {
        ConfigRuleName: ruleName,
        Compliance: {
          ComplianceType: overallCompliance,
          ComplianceContributorCount: {
            CappedCount: nonCompliant,
            CapExceeded: false,
          },
        },
      };
    });

    return { ComplianceSummariesByConfigRule: summaries };
  }

  getComplianceSummaryByResourceType({ ResourceTypes } = {}) {
    const summaryMap = new Map();

    for (const [, results] of this.evaluationResults) {
      for (const r of results) {
        const type = r.EvaluationResultIdentifier.EvaluationResultQualifier.ResourceType;
        if (ResourceTypes && ResourceTypes.length > 0 && !ResourceTypes.includes(type)) continue;

        if (!summaryMap.has(type)) {
          summaryMap.set(type, { compliant: 0, nonCompliant: 0 });
        }
        const s = summaryMap.get(type);
        if (r.ComplianceType === 'COMPLIANT') s.compliant++;
        else if (r.ComplianceType === 'NON_COMPLIANT') s.nonCompliant++;
      }
    }

    const summaries = Array.from(summaryMap.entries()).map(([type, counts]) => ({
      ResourceType: type,
      ComplianceSummary: {
        CompliantResourceCount: { CappedCount: counts.compliant, CapExceeded: false },
        NonCompliantResourceCount: { CappedCount: counts.nonCompliant, CapExceeded: false },
        ComplianceSummaryTimestamp: now(),
      },
    }));

    return { ComplianceSummariesByResourceType: summaries };
  }

  // ─── Resource Configuration ─────────────────────────────────────────────────

  getResourceConfigHistory({ resourceType, resourceId, laterTime, earlierTime, chronologicalOrder, limit, nextToken } = {}) {
    if (!resourceType || !resourceId) {
      throw Errors.ValidationError('resourceType and resourceId are required');
    }

    const key = `${resourceType}::${resourceId}`;
    let history = this.resourceConfigs.get(key) || [];

    if (earlierTime) {
      history = history.filter(h => new Date(h.configurationItemCaptureTime) >= new Date(earlierTime));
    }
    if (laterTime) {
      history = history.filter(h => new Date(h.configurationItemCaptureTime) <= new Date(laterTime));
    }

    if (chronologicalOrder === 'Forward') {
      history = history.slice().sort((a, b) =>
        new Date(a.configurationItemCaptureTime) - new Date(b.configurationItemCaptureTime)
      );
    } else {
      history = history.slice().sort((a, b) =>
        new Date(b.configurationItemCaptureTime) - new Date(a.configurationItemCaptureTime)
      );
    }

    const { items, nextToken: newToken } = paginate(history, nextToken, limit || MAX_RESULTS_DEFAULT);
    return { configurationItems: items, nextToken: newToken };
  }

  listDiscoveredResources({ resourceType, resourceIds, resourceName, limit, nextToken, includeDeletedResources } = {}) {
    if (!resourceType) {
      throw Errors.ValidationError('resourceType is required');
    }

    let resources = Array.from(this.discoveredResources.values()).filter(
      r => r.resourceType === resourceType
    );

    if (resourceIds && resourceIds.length > 0) {
      resources = resources.filter(r => resourceIds.includes(r.resourceId));
    }
    if (resourceName) {
      resources = resources.filter(r => r.resourceName === resourceName);
    }
    if (!includeDeletedResources) {
      resources = resources.filter(r => !r.resourceDeletionTime);
    }

    const { items, nextToken: newToken } = paginate(resources, nextToken, limit || MAX_RESULTS_DEFAULT);
    return {
      resourceIdentifiers: items.map(r => ({
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        resourceName: r.resourceName,
        resourceDeletionTime: r.resourceDeletionTime,
      })),
      nextToken: newToken,
    };
  }

  getDiscoveredResourceCounts({ resourceTypes, nextToken, limit } = {}) {
    const countMap = new Map();

    for (const [, resource] of this.discoveredResources) {
      if (resourceTypes && resourceTypes.length > 0 && !resourceTypes.includes(resource.resourceType)) continue;
      const count = countMap.get(resource.resourceType) || 0;
      countMap.set(resource.resourceType, count + 1);
    }

    const counts = Array.from(countMap.entries()).map(([resourceType, count]) => ({
      resourceType,
      count,
    }));

    const { items, nextToken: newToken } = paginate(counts, nextToken, limit || MAX_RESULTS_DEFAULT);
    return {
      totalDiscoveredResources: this.discoveredResources.size,
      resourceCounts: items,
      nextToken: newToken,
    };
  }

  batchGetResourceConfig({ resourceKeys } = {}) {
    if (!resourceKeys || resourceKeys.length === 0) {
      throw Errors.ValidationError('resourceKeys is required');
    }

    const baseConfigurationItems = [];
    const unprocessedResourceKeys = [];

    for (const key of resourceKeys) {
      const mapKey = `${key.resourceType}::${key.resourceId}`;
      const history = this.resourceConfigs.get(mapKey);
      if (history && history.length > 0) {
        baseConfigurationItems.push(history[history.length - 1]);
      } else {
        unprocessedResourceKeys.push(key);
      }
    }

    return { baseConfigurationItems, unprocessedResourceKeys };
  }

  // ─── Conformance Packs ──────────────────────────────────────────────────────

  putConformancePack({ ConformancePackName, TemplateS3Uri, TemplateBody, DeliveryS3Bucket, DeliveryS3KeyPrefix, ConformancePackInputParameters } = {}) {
    if (!ConformancePackName) {
      throw Errors.ValidationError('ConformancePackName is required');
    }

    const pack = {
      ConformancePackName,
      ConformancePackArn: conformancePackArn(ConformancePackName),
      ConformancePackId: `cp-${randomUUID().substring(0, 8)}`,
      DeliveryS3Bucket: DeliveryS3Bucket || '',
      DeliveryS3KeyPrefix: DeliveryS3KeyPrefix || '',
      ConformancePackInputParameters: ConformancePackInputParameters || [],
      CreatedBy: 'Local',
      LastUpdateRequestedTime: now(),
    };

    this.conformancePacks.set(ConformancePackName, pack);
    this.conformancePackStatus.set(ConformancePackName, {
      ConformancePackName,
      ConformancePackId: pack.ConformancePackId,
      ConformancePackArn: pack.ConformancePackArn,
      ConformancePackState: 'CREATE_COMPLETE',
      ConformancePackStatusReason: '',
      LastUpdateRequestedTime: now(),
      LastUpdateCompletedTime: now(),
    });

    this.logger.info(`[Config] Conformance pack '${ConformancePackName}' created`);
    this.save();
    return { ConformancePackArn: pack.ConformancePackArn };
  }

  deleteConformancePack({ ConformancePackName }) {
    if (!this.conformancePacks.has(ConformancePackName)) {
      throw Errors.NoSuchConformancePack(ConformancePackName);
    }
    this.conformancePacks.delete(ConformancePackName);
    this.conformancePackStatus.delete(ConformancePackName);
    this.logger.info(`[Config] Conformance pack '${ConformancePackName}' deleted`);
    this.save();
    return {};
  }

  describeConformancePacks({ ConformancePackNames, NextToken, Limit } = {}) {
    let packs = Array.from(this.conformancePacks.values());
    if (ConformancePackNames && ConformancePackNames.length > 0) {
      packs = packs.filter(p => ConformancePackNames.includes(p.ConformancePackName));
    }
    const { items, nextToken } = paginate(packs, NextToken, Limit || MAX_RESULTS_DEFAULT);
    return { ConformancePackDetails: items, NextToken: nextToken };
  }

  describeConformancePackStatus({ ConformancePackNames, NextToken, Limit } = {}) {
    let statuses = Array.from(this.conformancePackStatus.values());
    if (ConformancePackNames && ConformancePackNames.length > 0) {
      statuses = statuses.filter(s => ConformancePackNames.includes(s.ConformancePackName));
    }
    const { items, nextToken } = paginate(statuses, NextToken, Limit || MAX_RESULTS_DEFAULT);
    return { ConformancePackStatusDetails: items, NextToken: nextToken };
  }

  getConformancePackComplianceSummary({ ConformancePackNames, NextToken, Limit } = {}) {
    let packs = Array.from(this.conformancePacks.values());
    if (ConformancePackNames && ConformancePackNames.length > 0) {
      packs = packs.filter(p => ConformancePackNames.includes(p.ConformancePackName));
    }

    const summaries = packs.map(pack => ({
      ConformancePackName: pack.ConformancePackName,
      ConformancePackComplianceSummary: {
        ConformancePackName: pack.ConformancePackName,
        ConformancePackComplianceStatus: 'COMPLIANT',
      },
    }));

    const { items, nextToken } = paginate(summaries, NextToken, Limit || MAX_RESULTS_DEFAULT);
    return { ConformancePackComplianceSummaryList: items, NextToken: nextToken };
  }

  // ─── Configuration Aggregators ─────────────────────────────────────────────

  putConfigurationAggregator({ ConfigurationAggregatorName, AccountAggregationSources, OrganizationAggregationSource, Tags } = {}) {
    if (!ConfigurationAggregatorName) {
      throw Errors.ValidationError('ConfigurationAggregatorName is required');
    }

    const aggregator = {
      ConfigurationAggregatorName,
      ConfigurationAggregatorArn: aggregatorArn(ConfigurationAggregatorName),
      AccountAggregationSources: AccountAggregationSources || [],
      OrganizationAggregationSource: OrganizationAggregationSource || null,
      CreationTime: now(),
      LastUpdatedTime: now(),
    };

    this.aggregators.set(ConfigurationAggregatorName, aggregator);

    if (Tags && Tags.length > 0) {
      const arn = aggregator.ConfigurationAggregatorArn;
      const tagMap = this.tags.get(arn) || {};
      for (const { Key, Value } of Tags) tagMap[Key] = Value;
      this.tags.set(arn, tagMap);
    }

    this.logger.info(`[Config] Aggregator '${ConfigurationAggregatorName}' created`);
    this.save();
    return { ConfigurationAggregator: aggregator };
  }

  deleteConfigurationAggregator({ ConfigurationAggregatorName }) {
    if (!this.aggregators.has(ConfigurationAggregatorName)) {
      throw Errors.NoSuchConfigurationAggregator(ConfigurationAggregatorName);
    }
    this.aggregators.delete(ConfigurationAggregatorName);
    this.logger.info(`[Config] Aggregator '${ConfigurationAggregatorName}' deleted`);
    this.save();
    return {};
  }

  describeConfigurationAggregators({ ConfigurationAggregatorNames, NextToken, Limit } = {}) {
    let aggregators = Array.from(this.aggregators.values());
    if (ConfigurationAggregatorNames && ConfigurationAggregatorNames.length > 0) {
      aggregators = aggregators.filter(a => ConfigurationAggregatorNames.includes(a.ConfigurationAggregatorName));
    }
    const { items, nextToken } = paginate(aggregators, NextToken, Limit || MAX_RESULTS_DEFAULT);
    return { ConfigurationAggregators: items, NextToken: nextToken };
  }

  // ─── Remediation ────────────────────────────────────────────────────────────

  putRemediationConfigurations({ RemediationConfigurations } = {}) {
    if (!RemediationConfigurations || RemediationConfigurations.length === 0) {
      throw Errors.ValidationError('RemediationConfigurations is required');
    }

    const failures = [];
    for (const config of RemediationConfigurations) {
      if (!config.ConfigRuleName) {
        failures.push({ ConfigRuleName: '', ErrorMessage: 'ConfigRuleName is required' });
        continue;
      }
      const existing = this.remediationConfigs.get(config.ConfigRuleName) || [];
      existing.push({
        ...config,
        Arn: `arn:aws:config:${REGION}:${ACCOUNT_ID}:remediation-configuration/${config.ConfigRuleName}`,
        CreatedByService: 'Local',
      });
      this.remediationConfigs.set(config.ConfigRuleName, existing);
    }

    this.save();
    this.logger.info(`[Config] Remediation configurations added`);
    return { FailedBatches: failures };
  }

  deleteRemediationConfigurations({ ConfigRuleNames } = {}) {
    if (!ConfigRuleNames || ConfigRuleNames.length === 0) {
      throw Errors.ValidationError('ConfigRuleNames is required');
    }
    const failures = [];
    for (const name of ConfigRuleNames) {
      if (!this.remediationConfigs.has(name)) {
        failures.push({ ConfigRuleName: name, ErrorMessage: 'Remediation configuration not found' });
      } else {
        this.remediationConfigs.delete(name);
      }
    }
    this.save();
    return { FailedBatches: failures };
  }

  describeRemediationConfigurations({ ConfigRuleNames } = {}) {
    if (!ConfigRuleNames || ConfigRuleNames.length === 0) {
      throw Errors.ValidationError('ConfigRuleNames is required');
    }
    const configs = [];
    for (const name of ConfigRuleNames) {
      const c = this.remediationConfigs.get(name) || [];
      configs.push(...c);
    }
    return { RemediationConfigurations: configs };
  }

  startRemediationExecution({ ConfigRuleName, ResourceKeys } = {}) {
    if (!ConfigRuleName) {
      throw Errors.ValidationError('ConfigRuleName is required');
    }
    if (!this.remediationConfigs.has(ConfigRuleName)) {
      throw Errors.NoSuchRemediationConfiguration(ConfigRuleName);
    }

    const failures = [];
    const executions = this.remediationExecutions.get(ConfigRuleName) || [];

    for (const key of (ResourceKeys || [])) {
      executions.push({
        ResourceKey: key,
        State: 'IN_QUEUE',
        StepDetails: [],
        InvocationTime: now(),
        LastUpdatedTime: now(),
      });
    }

    this.remediationExecutions.set(ConfigRuleName, executions);

    // Simula conclusão
    setImmediate(() => {
      const execs = this.remediationExecutions.get(ConfigRuleName) || [];
      for (const exec of execs) {
        exec.State = 'SUCCEEDED';
        exec.LastUpdatedTime = now();
      }
      this.remediationExecutions.set(ConfigRuleName, execs);
      this.save();
    });

    return { FailedItems: failures };
  }

  // ─── Tags ────────────────────────────────────────────────────────────────────

  tagResource({ ResourceArn, Tags } = {}) {
    if (!ResourceArn) throw Errors.ValidationError('ResourceArn is required');
    if (!Tags || Tags.length === 0) throw Errors.ValidationError('Tags is required');
    const tagMap = this.tags.get(ResourceArn) || {};
    for (const { Key, Value } of Tags) tagMap[Key] = Value;
    this.tags.set(ResourceArn, tagMap);
    this.save();
    return {};
  }

  untagResource({ ResourceArn, TagKeys } = {}) {
    if (!ResourceArn) throw Errors.ValidationError('ResourceArn is required');
    const tagMap = this.tags.get(ResourceArn) || {};
    for (const key of (TagKeys || [])) delete tagMap[key];
    this.tags.set(ResourceArn, tagMap);
    this.save();
    return {};
  }

  listTagsForResource({ ResourceArn, NextToken, Limit } = {}) {
    if (!ResourceArn) throw Errors.ValidationError('ResourceArn is required');
    const tagMap = this.tags.get(ResourceArn) || {};
    const tags = Object.entries(tagMap).map(([Key, Value]) => ({ Key, Value }));
    const { items, nextToken } = paginate(tags, NextToken, Limit || MAX_RESULTS_DEFAULT);
    return { Tags: items, NextToken: nextToken };
  }

  // ─── Método interno: registrar recurso de outro serviço ───────────────────

  recordResource(resourceType, resourceId, configuration) {
    this._recordResourceConfig(resourceType, resourceId, configuration);
  }

  getStatus() {
    return {
      recorders: this.recorders.size,
      activeRecorders: Array.from(this.recorderStatus.values()).filter(s => s.recording).length,
      deliveryChannels: this.deliveryChannels.size,
      configRules: this.configRules.size,
      discoveredResources: this.discoveredResources.size,
      conformancePacks: this.conformancePacks.size,
      aggregators: this.aggregators.size,
    };
  }
}

module.exports = { ConfigSimulator };
