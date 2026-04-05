'use strict';

/**
 * @fileoverview CloudFormation Simulator
 *
 * Suporta:
 *  - CreateStack / UpdateStack / DeleteStack
 *  - DescribeStacks / ListStacks
 *  - CreateChangeSet / DescribeChangeSet / ExecuteChangeSet / DeleteChangeSet / ListChangeSets
 *  - DescribeStackResources / ListStackResources
 *  - GetTemplate
 *  - ValidateTemplate
 *  - Tags
 *  - Persistência via LocalStore
 */

const { randomUUID } = require('crypto');
const yaml = require('js-yaml');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');

// ─── Erros tipados ───────────────────────────────────────────────────────────

class CloudFormationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const Errors = {
  AlreadyExists: (name) =>
    new CloudFormationError('AlreadyExistsException', `Stack [${name}] already exists`, 400),
  DoesNotExist: (name) =>
    new CloudFormationError('ValidationError', `Stack with id ${name} does not exist`, 400),
  ChangeSetNotFound: (name) =>
    new CloudFormationError('ChangeSetNotFoundException', `ChangeSet [${name}] does not exist`, 404),
  InvalidTemplate: (msg) =>
    new CloudFormationError('ValidationError', `Template format error: ${msg}`, 400),
  InvalidAction: (msg) =>
    new CloudFormationError('ValidationError', msg, 400),
};

// ─── Constantes ──────────────────────────────────────────────────────────────

const REGION = 'us-east-1';
const ACCOUNT = '000000000000';

const StackStatus = {
  CREATE_IN_PROGRESS: 'CREATE_IN_PROGRESS',
  CREATE_COMPLETE: 'CREATE_COMPLETE',
  CREATE_FAILED: 'CREATE_FAILED',
  UPDATE_IN_PROGRESS: 'UPDATE_IN_PROGRESS',
  UPDATE_COMPLETE: 'UPDATE_COMPLETE',
  UPDATE_FAILED: 'UPDATE_FAILED',
  DELETE_IN_PROGRESS: 'DELETE_IN_PROGRESS',
  DELETE_COMPLETE: 'DELETE_COMPLETE',
  DELETE_FAILED: 'DELETE_FAILED',
  ROLLBACK_IN_PROGRESS: 'ROLLBACK_IN_PROGRESS',
  ROLLBACK_COMPLETE: 'ROLLBACK_COMPLETE',
};

const ChangeSetStatus = {
  CREATE_PENDING: 'CREATE_PENDING',
  CREATE_IN_PROGRESS: 'CREATE_IN_PROGRESS',
  CREATE_COMPLETE: 'CREATE_COMPLETE',
  DELETE_COMPLETE: 'DELETE_COMPLETE',
  FAILED: 'FAILED',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function stackArn(stackName, stackId) {
  return `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${stackName}/${stackId}`;
}

function changeSetArn(stackName, changeSetName) {
  return `arn:aws:cloudformation:${REGION}:${ACCOUNT}:changeSet/${changeSetName}/${stackName}`;
}

// ─── Template Parser ─────────────────────────────────────────────────────────

/**
 * Faz parse básico do template (JSON ou YAML string → objeto)
 */
function parseTemplate(template) {
  if (!template) throw Errors.InvalidTemplate('Template body is required');
  if (typeof template === 'object') return template;
  try {
    return JSON.parse(template);
  } catch (_) {
    try {
      // Schema customizado que trata tags AWS como !Ref, !Sub, !If, etc.
      const awsSchema = yaml.DEFAULT_SCHEMA.extend([
        new yaml.Type('!Ref',       { kind: 'scalar',   construct: d => ({ Ref: d }) }),
        new yaml.Type('!Sub',       { kind: 'scalar',   construct: d => ({ 'Fn::Sub': d }) }),
        new yaml.Type('!Sub',       { kind: 'sequence', construct: d => ({ 'Fn::Sub': d }) }),
        new yaml.Type('!If',        { kind: 'sequence', construct: d => ({ 'Fn::If': d }) }),
        new yaml.Type('!Equals',    { kind: 'sequence', construct: d => ({ 'Fn::Equals': d }) }),
        new yaml.Type('!Not',       { kind: 'sequence', construct: d => ({ 'Fn::Not': d }) }),
        new yaml.Type('!And',       { kind: 'sequence', construct: d => ({ 'Fn::And': d }) }),
        new yaml.Type('!Or',        { kind: 'sequence', construct: d => ({ 'Fn::Or': d }) }),
        new yaml.Type('!Select',    { kind: 'sequence', construct: d => ({ 'Fn::Select': d }) }),
        new yaml.Type('!Split',     { kind: 'sequence', construct: d => ({ 'Fn::Split': d }) }),
        new yaml.Type('!Join',      { kind: 'sequence', construct: d => ({ 'Fn::Join': d }) }),
        new yaml.Type('!GetAtt',    { kind: 'scalar',   construct: d => ({ 'Fn::GetAtt': d.split('.') }) }),
        new yaml.Type('!FindInMap', { kind: 'sequence', construct: d => ({ 'Fn::FindInMap': d }) }),
        new yaml.Type('!Base64',    { kind: 'scalar',   construct: d => ({ 'Fn::Base64': d }) }),
        new yaml.Type('!Cidr',      { kind: 'sequence', construct: d => ({ 'Fn::Cidr': d }) }),
        new yaml.Type('!ImportValue',{ kind: 'scalar',  construct: d => ({ 'Fn::ImportValue': d }) }),
      ]);
      return yaml.load(template, { schema: awsSchema });
    } catch (yamlErr) {
      throw Errors.InvalidTemplate(`Could not parse template as JSON or YAML: ${yamlErr.message}`);
    }
  }
}

/**
 * Extrai recursos de um template e gera lista de stack resources
 */
function extractResources(parsedTemplate, stackName) {
  const resources = [];
  const templateResources = parsedTemplate?.Resources || {};
  for (const [logicalId, resource] of Object.entries(templateResources)) {
    resources.push({
      LogicalResourceId: logicalId,
      PhysicalResourceId: `${stackName}-${logicalId}-${randomUUID().slice(0, 8)}`,
      ResourceType: resource.Type || 'AWS::CloudFormation::WaitConditionHandle',
      ResourceStatus: 'CREATE_COMPLETE',
      Timestamp: now(),
      DriftInformation: { StackResourceDriftStatus: 'NOT_CHECKED' },
    });
  }
  return resources;
}

/**
 * Resolve parâmetros do template
 */
function resolveParameters(templateParams, inputParams) {
  const resolved = {};
  const templateDefs = templateParams || {};
  const inputMap = {};

  for (const param of (inputParams || [])) {
    inputMap[param.ParameterKey] = param;
  }

  for (const [key, def] of Object.entries(templateDefs)) {
    const input = inputMap[key];
    if (input) {
      resolved[key] = input.UsePreviousValue
        ? def.Default || ''
        : (input.ParameterValue || def.Default || '');
    } else {
      resolved[key] = def.Default || '';
    }
  }

  return Object.entries(resolved).map(([k, v]) => ({
    ParameterKey: k,
    ParameterValue: v,
    ResolvedValue: v,
  }));
}

/**
 * Calcula outputs do template (simples)
 */
function resolveOutputs(parsedTemplate, stackName) {
  const outputs = [];
  const templateOutputs = parsedTemplate?.Outputs || {};
  for (const [key, def] of Object.entries(templateOutputs)) {
    outputs.push({
      OutputKey: key,
      OutputValue: def.Value || `${stackName}-${key}-output`,
      Description: def.Description || '',
      ExportName: def.Export?.Name || undefined,
    });
  }
  return outputs;
}

// ─── Simulador ───────────────────────────────────────────────────────────────

class CloudFormationSimulator {
  /**
   * @param {Object} config
   * @param {Object} store - LocalStore
   * @param {Object} logger
   */
  constructor(config, store, logger) {
    this.config = config;
    this.store = store;
    this.logger = logger;

    /** @type {Map<string, Object>} stackName → stack */
    this.stacks = new Map();

    /** @type {Map<string, Object[]>} stackName → resources[] */
    this.stackResources = new Map();

    /** @type {Map<string, Object>} changeSetArn → changeSet */
    this.changeSets = new Map();

    this.audit = new CloudTrailAudit('cloudformation.amazonaws.com');

    // Simuladores injetados via injectDependencies
    this.s3Simulator = null;
    this.sqsSimulator = null;
    this.dynamoSimulator = null;
    this.kmsSimulator = null;
    this.secretsSimulator = null;
    this.parameterStoreSimulator = null;
    this.athenaSimulator = null;
  }

  // ─── Persistência ──────────────────────────────────────────────

  async load() {
    try {
      const data = await this.store.read('cloudformation', 'data');
      if (data) {
        if (data.stacks) this.stacks = new Map(Object.entries(data.stacks));
        if (data.stackResources) this.stackResources = new Map(Object.entries(data.stackResources));
        if (data.changeSets) this.changeSets = new Map(Object.entries(data.changeSets));
        this.logger.info('[CloudFormation] Loaded persisted data');
      }
    } catch (_) {
      this.logger.debug('[CloudFormation] No persisted data found, starting fresh');
    }
  }

  async save() {
    try {
      await this.store.write('cloudformation', 'data', {
        stacks: Object.fromEntries(this.stacks),
        stackResources: Object.fromEntries(this.stackResources),
        changeSets: Object.fromEntries(this.changeSets),
      });
    } catch (err) {
      this.logger.warn(`[CloudFormation] Failed to persist data: ${err.message}`);
    }
  }

  async reset() {
    this.stacks.clear();
    this.stackResources.clear();
    this.changeSets.clear();
    try { await this.store.clear('cloudformation'); } catch (_) {}
    this.logger.info('[CloudFormation] Reset complete');
  }

  // ─── Stacks ────────────────────────────────────────────────────

  /**
   * CreateStack
   */
  async createStack({
    StackName,
    TemplateBody,
    TemplateURL,
    Parameters = [],
    Capabilities = [],
    Tags = [],
    OnFailure = 'ROLLBACK',
    TimeoutInMinutes,
    NotificationARNs = [],
    RoleARN,
    DisableRollback = false,
  }) {
    if (!StackName) throw Errors.InvalidAction('StackName is required');
    if (this.stacks.has(StackName)) throw Errors.AlreadyExists(StackName);

    const template = parseTemplate(TemplateBody || '{}');
    const stackId = randomUUID();
    const arn = stackArn(StackName, stackId);
    const resolvedParams = resolveParameters(template.Parameters, Parameters);
    const outputs = resolveOutputs(template, StackName);
    const resources = extractResources(template, StackName);

    const stack = {
      StackId: arn,
      StackName,
      StackStatus: StackStatus.CREATE_COMPLETE,
      StackStatusReason: 'Stack created successfully',
      CreationTime: now(),
      LastUpdatedTime: now(),
      Parameters: resolvedParams,
      Outputs: outputs,
      Capabilities,
      Tags,
      NotificationARNs,
      RoleARN: RoleARN || '',
      TimeoutInMinutes: TimeoutInMinutes || 0,
      DisableRollback,
      OnFailure,
      TemplateBody: TemplateBody || JSON.stringify(template),
      EnableTerminationProtection: false,
      DriftInformation: { StackDriftStatus: 'NOT_CHECKED' },
    };

    this.stacks.set(StackName, stack);
    this.stackResources.set(StackName, resources);

    this.logger.info(`[CloudFormation] Created stack: ${StackName} (${resources.length} resources)`);
    await this.save();

    // Provisiona os recursos nos simuladores injetados
    await this._provisionResources(StackName, template, resolvedParams);

    this.audit.record({
      eventName: 'CreateStack',
      readOnly: false,
      resources: [{ ARN: arn, type: 'AWS::CloudFormation::Stack' }],
      requestParameters: { stackName: StackName }
    });

    return { StackId: arn };
  }

  /**
   * Provisiona recursos do template nos simuladores locais
   */
  async _provisionResources(stackName, template, resolvedParams) {
    const resources = template?.Resources || {};

    // Helper para resolver !Ref de parâmetros
    const resolveRef = (value) => {
      if (!value) return value;
      if (typeof value === 'object' && value.Ref) {
        const param = resolvedParams.find(p => p.ParameterKey === value.Ref);
        return param ? param.ParameterValue : value.Ref;
      }
      if (typeof value === 'object' && value['Fn::Sub']) {
        return value['Fn::Sub'].replace(/\$\{([^}]+)\}/g, (_, key) => {
          const param = resolvedParams.find(p => p.ParameterKey === key);
          return param ? param.ParameterValue : key;
        });
      }
      return value;
    };

    const stackResourceList = this.stackResources.get(stackName) || [];

    for (const [logicalId, resource] of Object.entries(resources)) {
      try {
        const props = resource.Properties || {};
        let physicalId = null;

        switch (resource.Type) {

          case 'AWS::S3::Bucket': {
            if (!this.s3Simulator) break;
            const bucketName = resolveRef(props.BucketName) || `${stackName}-${logicalId}`.toLowerCase();
            this.s3Simulator.createBucket(bucketName);
            physicalId = bucketName;
            this.logger.info(`[CloudFormation] Provisionado S3 bucket: ${bucketName}`);
            break;
          }

          case 'AWS::SQS::Queue': {
            if (!this.sqsSimulator) break;
            const queueName = resolveRef(props.QueueName) || `${stackName}-${logicalId}`;
            this.sqsSimulator.createQueue(queueName);
            physicalId = queueName;
            this.logger.info(`[CloudFormation] Provisionada SQS queue: ${queueName}`);
            break;
          }

          case 'AWS::DynamoDB::Table': {
            if (!this.dynamoSimulator) break;
            const tableName = resolveRef(props.TableName) || `${stackName}-${logicalId}`;
            const attrDefs = (props.AttributeDefinitions || []).map(a => ({
              AttributeName: resolveRef(a.AttributeName),
              AttributeType: a.AttributeType,
            }));
            const keySchema = (props.KeySchema || []).map(k => ({
              AttributeName: resolveRef(k.AttributeName),
              KeyType: k.KeyType,
            }));
            await this.dynamoSimulator.createTable({
              TableName: tableName,
              AttributeDefinitions: attrDefs,
              KeySchema: keySchema,
              BillingMode: props.BillingMode || 'PAY_PER_REQUEST',
              Tags: props.Tags || [],
            });
            physicalId = tableName;
            this.logger.info(`[CloudFormation] Provisionada DynamoDB table: ${tableName}`);
            break;
          }

          case 'AWS::Athena::WorkGroup': {
            if (!this.athenaSimulator) break;
            const wgName = resolveRef(props.Name) || `${stackName}-${logicalId}`;
            await this.athenaSimulator.createWorkGroup({
              Name: wgName,
              Description: resolveRef(props.Description) || '',
              Configuration: props.WorkGroupConfiguration || {},
            });
            physicalId = wgName;
            this.logger.info(`[CloudFormation] Provisionado Athena WorkGroup: ${wgName}`);
            break;
          }

          case 'AWS::KMS::Key': {
            if (!this.kmsSimulator) break;
            const result = await this.kmsSimulator.createKey({
              Description: resolveRef(props.Description) || `${stackName}-${logicalId}`,
              KeyUsage: props.KeyUsage || 'ENCRYPT_DECRYPT',
              KeySpec: props.KeySpec || 'SYMMETRIC_DEFAULT',
              Tags: props.Tags || [],
            });
            physicalId = result.KeyMetadata.KeyId;
            this.logger.info(`[CloudFormation] Provisionada KMS key: ${physicalId}`);
            break;
          }

          case 'AWS::SecretsManager::Secret': {
            if (!this.secretsSimulator) break;
            const secretName = resolveRef(props.Name) || `${stackName}-${logicalId}`;
            await this.secretsSimulator.createSecret({
              Name: secretName,
              Description: resolveRef(props.Description) || '',
              SecretString: resolveRef(props.SecretString) || '{}',
              Tags: props.Tags || [],
            });
            physicalId = secretName;
            this.logger.info(`[CloudFormation] Provisionado Secret: ${secretName}`);
            break;
          }

          case 'AWS::SSM::Parameter': {
            if (!this.parameterStoreSimulator) break;
            const paramName = resolveRef(props.Name) || `/${stackName}/${logicalId}`;
            await this.parameterStoreSimulator.putParameter({
              Name: paramName,
              Value: resolveRef(props.Value) || '',
              Type: props.Type || 'String',
              Description: resolveRef(props.Description) || '',
              Tags: props.Tags || [],
              Overwrite: true,
            });
            physicalId = paramName;
            this.logger.info(`[CloudFormation] Provisionado SSM Parameter: ${paramName}`);
            break;
          }

          default:
            this.logger.debug(`[CloudFormation] Tipo não provisionado localmente: ${resource.Type} (${logicalId})`);
        }

        // Atualiza o PhysicalResourceId com o nome real do recurso
        if (physicalId) {
          const entry = stackResourceList.find(r => r.LogicalResourceId === logicalId);
          if (entry) entry.PhysicalResourceId = physicalId;
        }

      } catch (err) {
        this.logger.warn(`[CloudFormation] Erro ao provisionar ${logicalId} (${resource.Type}): ${err.message}`);
      }
    }
  }

  /**
   * UpdateStack
   */
  async updateStack({
    StackName,
    TemplateBody,
    UsePreviousTemplate = false,
    Parameters = [],
    Capabilities = [],
    Tags,
    RoleARN,
    NotificationARNs,
  }) {
    const stack = this._getStack(StackName);

    const templateBody = UsePreviousTemplate
      ? stack.TemplateBody
      : (TemplateBody || stack.TemplateBody);

    const template = parseTemplate(templateBody);
    const resolvedParams = resolveParameters(template.Parameters, Parameters.length ? Parameters : stack.Parameters.map(p => ({ ParameterKey: p.ParameterKey, UsePreviousValue: true })));
    const outputs = resolveOutputs(template, StackName);
    const resources = extractResources(template, StackName);

    stack.StackStatus = StackStatus.UPDATE_COMPLETE;
    stack.StackStatusReason = 'Stack updated successfully';
    stack.LastUpdatedTime = now();
    stack.TemplateBody = templateBody;
    stack.Parameters = resolvedParams;
    stack.Outputs = outputs;
    if (Tags) stack.Tags = Tags;
    if (RoleARN) stack.RoleARN = RoleARN;
    if (NotificationARNs) stack.NotificationARNs = NotificationARNs;
    if (Capabilities.length) stack.Capabilities = Capabilities;

    this.stackResources.set(StackName, resources);

    this.logger.info(`[CloudFormation] Updated stack: ${StackName}`);
    await this.save();

    return { StackId: stack.StackId };
  }

  /**
   * DeleteStack
   */
  async deleteStack({ StackName, RetainResources = [] }) {
    if (!this.stacks.has(StackName)) {
      // AWS retorna sucesso mesmo se a stack não existe
      return {};
    }

    const stack = this.stacks.get(StackName);

    if (stack.EnableTerminationProtection) {
      throw new CloudFormationError(
        'ValidationError',
        `Stack [${StackName}] cannot be deleted while TerminationProtection is enabled`,
        400
      );
    }

    // Captura recursos antes de remover do map
    const resources = this.stackResources.get(StackName) || [];

    this.stacks.delete(StackName);
    this.stackResources.delete(StackName);

    // Remove changesets associados
    for (const [key, cs] of this.changeSets.entries()) {
      if (cs.StackName === StackName) this.changeSets.delete(key);
    }

    // Deprovisiona os recursos nos simuladores
    await this._deprovisionResources(resources);

    this.logger.info(`[CloudFormation] Deleted stack: ${StackName}`);
    await this.save();

    return {};
  }

  async _deprovisionResources(resources) {
    for (const resource of resources) {
      const { ResourceType, PhysicalResourceId } = resource;
      try {
        switch (ResourceType) {
          case 'AWS::S3::Bucket':
            if (this.s3Simulator && PhysicalResourceId) {
              this.s3Simulator.deleteBucket(PhysicalResourceId);
              this.logger.info(`[CloudFormation] Removido S3 bucket: ${PhysicalResourceId}`);
            }
            break;

          case 'AWS::SQS::Queue':
            if (this.sqsSimulator && PhysicalResourceId) {
              this.sqsSimulator.deleteQueue(PhysicalResourceId);
              this.logger.info(`[CloudFormation] Removida SQS queue: ${PhysicalResourceId}`);
            }
            break;

          case 'AWS::DynamoDB::Table':
            if (this.dynamoSimulator && PhysicalResourceId) {
              await this.dynamoSimulator.deleteTable({ TableName: PhysicalResourceId });
              this.logger.info(`[CloudFormation] Removida DynamoDB table: ${PhysicalResourceId}`);
            }
            break;

          case 'AWS::KMS::Key':
            if (this.kmsSimulator && PhysicalResourceId) {
              await this.kmsSimulator.scheduleKeyDeletion({ KeyId: PhysicalResourceId, PendingWindowInDays: 7 });
              this.logger.info(`[CloudFormation] Agendada exclusão KMS key: ${PhysicalResourceId}`);
            }
            break;

          case 'AWS::SecretsManager::Secret':
            if (this.secretsSimulator && PhysicalResourceId) {
              await this.secretsSimulator.deleteSecret({ SecretId: PhysicalResourceId, ForceDeleteWithoutRecovery: true });
              this.logger.info(`[CloudFormation] Removido Secret: ${PhysicalResourceId}`);
            }
            break;

          case 'AWS::SSM::Parameter':
            if (this.parameterStoreSimulator && PhysicalResourceId) {
              await this.parameterStoreSimulator.deleteParameter({ Name: PhysicalResourceId });
              this.logger.info(`[CloudFormation] Removido SSM Parameter: ${PhysicalResourceId}`);
            }
            break;

          case 'AWS::Athena::WorkGroup':
            if (this.athenaSimulator && PhysicalResourceId) {
              await this.athenaSimulator.deleteWorkGroup({ WorkGroup: PhysicalResourceId, RecursiveDeleteOption: true });
              this.logger.info(`[CloudFormation] Removido Athena WorkGroup: ${PhysicalResourceId}`);
            }
            break;

          default:
            this.logger.debug(`[CloudFormation] Tipo não desprovisionado: ${ResourceType}`);
        }
      } catch (err) {
        this.logger.warn(`[CloudFormation] Erro ao remover ${ResourceType} (${PhysicalResourceId}): ${err.message}`);
      }
    }
  }

  /**
   * DescribeStacks
   */
  describeStacks({ StackName } = {}) {
    if (StackName) {
      const stack = this._getStack(StackName);
      return { Stacks: [this._formatStack(stack)] };
    }
    const stacks = Array.from(this.stacks.values()).map(s => this._formatStack(s));
    return { Stacks: stacks };
  }

  /**
   * ListStacks
   */
  listStacks({ StackStatusFilter = [], NextToken } = {}) {
    let items = Array.from(this.stacks.values());

    if (StackStatusFilter.length > 0) {
      items = items.filter(s => StackStatusFilter.includes(s.StackStatus));
    }

    let startIdx = 0;
    if (NextToken) {
      startIdx = parseInt(Buffer.from(NextToken, 'base64').toString('utf8'), 10) || 0;
    }

    const page = items.slice(startIdx, startIdx + 100).map(s => ({
      StackId: s.StackId,
      StackName: s.StackName,
      StackStatus: s.StackStatus,
      StackStatusReason: s.StackStatusReason,
      CreationTime: s.CreationTime,
      LastUpdatedTime: s.LastUpdatedTime,
      DeletionTime: s.DeletionTime,
      DriftInformation: s.DriftInformation,
    }));

    const hasMore = startIdx + 100 < items.length;
    const newNextToken = hasMore
      ? Buffer.from(String(startIdx + 100)).toString('base64')
      : undefined;

    return { StackSummaries: page, NextToken: newNextToken };
  }

  // ─── Template ──────────────────────────────────────────────────

  /**
   * ValidateTemplate
   */
  validateTemplate({ TemplateBody, TemplateURL }) {
    const body = TemplateBody || '{}';
    const template = parseTemplate(body);

    const parameters = Object.entries(template.Parameters || {}).map(([key, def]) => ({
      ParameterKey: key,
      DefaultValue: def.Default || '',
      NoEcho: def.NoEcho || false,
      Description: def.Description || '',
    }));

    const capabilities = [];
    const resources = Object.values(template.Resources || {});
    const hasIAM = resources.some(r =>
      r.Type && (r.Type.includes('IAM') || r.Type.includes('Role'))
    );
    if (hasIAM) capabilities.push('CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM');

    return {
      Parameters: parameters,
      Description: template.Description || '',
      Capabilities: capabilities,
      CapabilitiesReason: capabilities.length > 0
        ? 'The following resource(s) require capabilities: [AWS::IAM::Role]'
        : '',
    };
  }

  /**
   * GetTemplate
   */
  getTemplate({ StackName, TemplateStage = 'Original' }) {
    const stack = this._getStack(StackName);
    return {
      TemplateBody: stack.TemplateBody || '{}',
      StagesAvailable: ['Original', 'Processed'],
    };
  }

  // ─── StackResources ────────────────────────────────────────────

  /**
   * DescribeStackResources
   */
  describeStackResources({ StackName, LogicalResourceId }) {
    const resources = this.stackResources.get(StackName) || [];
    let filtered = resources;
    if (LogicalResourceId) {
      filtered = resources.filter(r => r.LogicalResourceId === LogicalResourceId);
    }
    return {
      StackResources: filtered.map(r => ({ ...r, StackName, StackId: this.stacks.get(StackName)?.StackId })),
    };
  }

  /**
   * ListStackResources
   */
  listStackResources({ StackName, NextToken } = {}) {
    if (!this.stacks.has(StackName)) throw Errors.DoesNotExist(StackName);
    const resources = this.stackResources.get(StackName) || [];

    let startIdx = 0;
    if (NextToken) {
      startIdx = parseInt(Buffer.from(NextToken, 'base64').toString('utf8'), 10) || 0;
    }

    const page = resources.slice(startIdx, startIdx + 100);
    const hasMore = startIdx + 100 < resources.length;
    const newNextToken = hasMore
      ? Buffer.from(String(startIdx + 100)).toString('base64')
      : undefined;

    return {
      StackResourceSummaries: page,
      NextToken: newNextToken,
    };
  }

  // ─── ChangeSets ────────────────────────────────────────────────

  /**
   * CreateChangeSet
   */
  async createChangeSet({
    StackName,
    ChangeSetName,
    TemplateBody,
    UsePreviousTemplate = false,
    Parameters = [],
    Capabilities = [],
    Tags = [],
    Description = '',
    ChangeSetType = 'UPDATE',
  }) {
    if (!ChangeSetName) throw Errors.InvalidAction('ChangeSetName is required');
    if (!StackName) throw Errors.InvalidAction('StackName is required');

    // Para CREATE, a stack não deve existir; para UPDATE, deve existir
    if (ChangeSetType === 'UPDATE' && !this.stacks.has(StackName)) {
      throw Errors.DoesNotExist(StackName);
    }

    const csArn = changeSetArn(StackName, ChangeSetName);

    const existingStack = this.stacks.get(StackName);
    const templateBody = UsePreviousTemplate
      ? (existingStack?.TemplateBody || '{}')
      : (TemplateBody || '{}');

    const template = parseTemplate(templateBody);
    const newResources = extractResources(template, StackName);
    const currentResources = this.stackResources.get(StackName) || [];

    // Calcula changes (adições, remoções, modificações)
    const changes = this._computeChanges(currentResources, newResources);

    const changeSet = {
      ChangeSetId: csArn,
      ChangeSetName,
      StackName,
      StackId: existingStack?.StackId || stackArn(StackName, randomUUID()),
      Status: ChangeSetStatus.CREATE_COMPLETE,
      StatusReason: 'Complete',
      Description,
      ChangeSetType,
      CreationTime: now(),
      Parameters,
      Capabilities,
      Tags,
      TemplateBody: templateBody,
      Changes: changes,
      ExecutionStatus: 'AVAILABLE',
    };

    this.changeSets.set(csArn, changeSet);

    this.logger.info(`[CloudFormation] Created ChangeSet: ${ChangeSetName} on ${StackName} (${changes.length} changes)`);
    await this.save();

    return { Id: csArn, StackId: changeSet.StackId };
  }

  /**
   * DescribeChangeSet
   */
  describeChangeSet({ ChangeSetName, StackName, NextToken }) {
    const changeSet = this._getChangeSet(ChangeSetName, StackName);
    return { ...changeSet };
  }

  /**
   * ExecuteChangeSet
   */
  async executeChangeSet({ ChangeSetName, StackName, ClientRequestToken }) {
    const changeSet = this._getChangeSet(ChangeSetName, StackName);

    if (changeSet.ExecutionStatus !== 'AVAILABLE') {
      throw new CloudFormationError(
        'InvalidChangeSetStatus',
        `ChangeSet [${ChangeSetName}] cannot be executed in its current status [${changeSet.ExecutionStatus}]`,
        400
      );
    }

    const template = parseTemplate(changeSet.TemplateBody);
    const resources = extractResources(template, StackName);
    const resolvedParams = resolveParameters(template.Parameters, changeSet.Parameters);
    const outputs = resolveOutputs(template, StackName);

    if (changeSet.ChangeSetType === 'CREATE') {
      // Cria a stack
      const stackId = randomUUID();
      const arn = stackArn(StackName, stackId);
      const stack = {
        StackId: changeSet.StackId || arn,
        StackName,
        StackStatus: StackStatus.CREATE_COMPLETE,
        StackStatusReason: 'Stack created via ChangeSet',
        CreationTime: now(),
        LastUpdatedTime: now(),
        Parameters: resolvedParams,
        Outputs: outputs,
        Capabilities: changeSet.Capabilities,
        Tags: changeSet.Tags,
        NotificationARNs: [],
        TemplateBody: changeSet.TemplateBody,
        EnableTerminationProtection: false,
        DriftInformation: { StackDriftStatus: 'NOT_CHECKED' },
      };
      this.stacks.set(StackName, stack);
    } else {
      // Atualiza stack existente
      const stack = this.stacks.get(StackName);
      if (stack) {
        stack.StackStatus = StackStatus.UPDATE_COMPLETE;
        stack.StackStatusReason = 'Stack updated via ChangeSet';
        stack.LastUpdatedTime = now();
        stack.TemplateBody = changeSet.TemplateBody;
        stack.Parameters = resolvedParams;
        stack.Outputs = outputs;
      }
    }

    this.stackResources.set(StackName, resources);
    changeSet.ExecutionStatus = 'EXECUTE_COMPLETE';
    changeSet.Status = 'UPDATE_COMPLETE';

    this.logger.info(`[CloudFormation] Executed ChangeSet: ${ChangeSetName} on ${StackName}`);
    await this.save();

    return {};
  }

  /**
   * DeleteChangeSet
   */
  async deleteChangeSet({ ChangeSetName, StackName }) {
    const changeSet = this._getChangeSet(ChangeSetName, StackName);
    this.changeSets.delete(changeSet.ChangeSetId);

    this.logger.info(`[CloudFormation] Deleted ChangeSet: ${ChangeSetName}`);
    await this.save();

    return {};
  }

  /**
   * ListChangeSets
   */
  listChangeSets({ StackName, NextToken } = {}) {
    const items = Array.from(this.changeSets.values())
      .filter(cs => cs.StackName === StackName)
      .map(cs => ({
        ChangeSetId: cs.ChangeSetId,
        ChangeSetName: cs.ChangeSetName,
        StackId: cs.StackId,
        StackName: cs.StackName,
        ExecutionStatus: cs.ExecutionStatus,
        Status: cs.Status,
        StatusReason: cs.StatusReason,
        Description: cs.Description,
        CreationTime: cs.CreationTime,
      }));

    return { Summaries: items };
  }

  // ─── Helpers privados ──────────────────────────────────────────

  _getStack(nameOrArn) {
    // Busca por nome ou ARN
    if (this.stacks.has(nameOrArn)) return this.stacks.get(nameOrArn);

    // Tenta por ARN
    for (const stack of this.stacks.values()) {
      if (stack.StackId === nameOrArn) return stack;
    }

    throw Errors.DoesNotExist(nameOrArn);
  }

  _getChangeSet(changeSetName, stackName) {
    // Busca por ARN direto
    if (this.changeSets.has(changeSetName)) {
      return this.changeSets.get(changeSetName);
    }

    // Busca por nome + stackName
    const csArn = changeSetArn(stackName, changeSetName);
    if (this.changeSets.has(csArn)) {
      return this.changeSets.get(csArn);
    }

    // Busca linear
    for (const cs of this.changeSets.values()) {
      if (cs.ChangeSetName === changeSetName && (!stackName || cs.StackName === stackName)) {
        return cs;
      }
    }

    throw Errors.ChangeSetNotFound(changeSetName);
  }

  _formatStack(stack) {
    return {
      StackId: stack.StackId,
      StackName: stack.StackName,
      StackStatus: stack.StackStatus,
      StackStatusReason: stack.StackStatusReason,
      CreationTime: stack.CreationTime,
      LastUpdatedTime: stack.LastUpdatedTime,
      Parameters: stack.Parameters || [],
      Outputs: stack.Outputs || [],
      Capabilities: stack.Capabilities || [],
      Tags: stack.Tags || [],
      NotificationARNs: stack.NotificationARNs || [],
      RoleARN: stack.RoleARN || '',
      EnableTerminationProtection: stack.EnableTerminationProtection || false,
      DriftInformation: stack.DriftInformation || { StackDriftStatus: 'NOT_CHECKED' },
    };
  }

  _computeChanges(currentResources, newResources) {
    const changes = [];
    const currentMap = new Map(currentResources.map(r => [r.LogicalResourceId, r]));
    const newMap = new Map(newResources.map(r => [r.LogicalResourceId, r]));

    // Adições
    for (const [id, res] of newMap.entries()) {
      if (!currentMap.has(id)) {
        changes.push({
          Type: 'Resource',
          ResourceChange: {
            Action: 'Add',
            LogicalResourceId: id,
            ResourceType: res.ResourceType,
            Replacement: 'False',
            Scope: [],
            Details: [],
          },
        });
      }
    }

    // Remoções
    for (const [id, res] of currentMap.entries()) {
      if (!newMap.has(id)) {
        changes.push({
          Type: 'Resource',
          ResourceChange: {
            Action: 'Remove',
            LogicalResourceId: id,
            PhysicalResourceId: res.PhysicalResourceId,
            ResourceType: res.ResourceType,
            Replacement: 'False',
            Scope: [],
            Details: [],
          },
        });
      }
    }

    // Modificações (mesmo ID, tipo pode mudar)
    for (const [id, res] of newMap.entries()) {
      if (currentMap.has(id)) {
        const current = currentMap.get(id);
        if (current.ResourceType !== res.ResourceType) {
          changes.push({
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: id,
              PhysicalResourceId: current.PhysicalResourceId,
              ResourceType: res.ResourceType,
              Replacement: 'True',
              Scope: ['Properties'],
              Details: [],
            },
          });
        }
      }
    }

    return changes;
  }

  // ─── Admin ────────────────────────────────────────────────────

  getStats() {
    return {
      stacks: this.stacks.size,
      changeSets: this.changeSets.size,
      resources: Array.from(this.stackResources.values()).reduce((acc, r) => acc + r.length, 0),
    };
  }
}

module.exports = { CloudFormationSimulator };
