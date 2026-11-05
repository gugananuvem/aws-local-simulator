"use strict";

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

const { randomUUID } = require("crypto");
const yaml = require("js-yaml");
const { CloudTrailAudit } = require("../../utils/cloudtrail-audit");
const HANDLERS = require("./resource-handlers");
const { provisionStack, deprovisionStack } = require("./provisioner");
const { TemplateContext, TemplateError, sortResources, validateReferences, collectReferences } = require("./template-engine");

// ─── Erros tipados ───────────────────────────────────────────────────────────

class CloudFormationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const Errors = {
  AlreadyExists: (name) => new CloudFormationError("AlreadyExistsException", `Stack [${name}] already exists`, 400),
  DoesNotExist: (name) => new CloudFormationError("ValidationError", `Stack with id ${name} does not exist`, 400),
  ChangeSetNotFound: (name) => new CloudFormationError("ChangeSetNotFoundException", `ChangeSet [${name}] does not exist`, 404),
  InvalidTemplate: (msg) => new CloudFormationError("ValidationError", `Template format error: ${msg}`, 400),
  InvalidAction: (msg) => new CloudFormationError("ValidationError", msg, 400),
};

// ─── Constantes ──────────────────────────────────────────────────────────────

const REGION = "us-east-1";
const ACCOUNT = "000000000000";

const StackStatus = {
  CREATE_IN_PROGRESS: "CREATE_IN_PROGRESS",
  CREATE_COMPLETE: "CREATE_COMPLETE",
  CREATE_FAILED: "CREATE_FAILED",
  UPDATE_IN_PROGRESS: "UPDATE_IN_PROGRESS",
  UPDATE_COMPLETE: "UPDATE_COMPLETE",
  UPDATE_FAILED: "UPDATE_FAILED",
  DELETE_IN_PROGRESS: "DELETE_IN_PROGRESS",
  DELETE_COMPLETE: "DELETE_COMPLETE",
  DELETE_FAILED: "DELETE_FAILED",
  ROLLBACK_IN_PROGRESS: "ROLLBACK_IN_PROGRESS",
  ROLLBACK_COMPLETE: "ROLLBACK_COMPLETE",
  UPDATE_ROLLBACK_COMPLETE: "UPDATE_ROLLBACK_COMPLETE",
};

const ChangeSetStatus = {
  CREATE_PENDING: "CREATE_PENDING",
  CREATE_IN_PROGRESS: "CREATE_IN_PROGRESS",
  CREATE_COMPLETE: "CREATE_COMPLETE",
  DELETE_COMPLETE: "DELETE_COMPLETE",
  FAILED: "FAILED",
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
  if (!template) throw Errors.InvalidTemplate("Template body is required");
  if (typeof template === "object") return template;
  try {
    return JSON.parse(template);
  } catch (_) {
    try {
      // Schema customizado que trata tags AWS como !Ref, !Sub, !If, etc.
      const awsSchema = yaml.DEFAULT_SCHEMA.extend([
        new yaml.Type("!Ref", { kind: "scalar", construct: (d) => ({ Ref: d }) }),
        new yaml.Type("!Sub", { kind: "scalar", construct: (d) => ({ "Fn::Sub": d }) }),
        new yaml.Type("!Sub", { kind: "sequence", construct: (d) => ({ "Fn::Sub": d }) }),
        new yaml.Type("!If", { kind: "sequence", construct: (d) => ({ "Fn::If": d }) }),
        new yaml.Type("!Equals", { kind: "sequence", construct: (d) => ({ "Fn::Equals": d }) }),
        new yaml.Type("!Not", { kind: "sequence", construct: (d) => ({ "Fn::Not": d }) }),
        new yaml.Type("!And", { kind: "sequence", construct: (d) => ({ "Fn::And": d }) }),
        new yaml.Type("!Or", { kind: "sequence", construct: (d) => ({ "Fn::Or": d }) }),
        new yaml.Type("!Select", { kind: "sequence", construct: (d) => ({ "Fn::Select": d }) }),
        new yaml.Type("!Split", { kind: "sequence", construct: (d) => ({ "Fn::Split": d }) }),
        new yaml.Type("!Join", { kind: "sequence", construct: (d) => ({ "Fn::Join": d }) }),
        new yaml.Type("!GetAtt", { kind: "scalar", construct: (d) => ({ "Fn::GetAtt": d.split(".") }) }),
        new yaml.Type("!FindInMap", { kind: "sequence", construct: (d) => ({ "Fn::FindInMap": d }) }),
        new yaml.Type("!Base64", { kind: "scalar", construct: (d) => ({ "Fn::Base64": d }) }),
        new yaml.Type("!Cidr", { kind: "sequence", construct: (d) => ({ "Fn::Cidr": d }) }),
        new yaml.Type("!ImportValue", { kind: "scalar", construct: (d) => ({ "Fn::ImportValue": d }) }),
      ]);
      return yaml.load(template, { schema: awsSchema });
    } catch (yamlErr) {
      throw Errors.InvalidTemplate(`Could not parse template as JSON or YAML: ${yamlErr.message}`);
    }
  }
}

/**
 * Resolve parâmetros do template
 */
function resolveParameters(templateParams, inputParams, previousParams = []) {
  const templateDefs = templateParams || {};
  const inputMap = {};
  const previousMap = {};
  for (const param of inputParams || []) inputMap[param.ParameterKey] = param;
  for (const param of previousParams || []) previousMap[param.ParameterKey] = param.ParameterValue;

  const missing = [];
  const resolved = {};
  for (const [key, def] of Object.entries(templateDefs)) {
    const input = inputMap[key];
    let value;
    if (input && input.UsePreviousValue && key in previousMap) value = previousMap[key];
    else if (input && input.ParameterValue !== undefined) value = input.ParameterValue;
    else if (!input && key in previousMap && !("Default" in def)) value = previousMap[key];
    else if ("Default" in def) value = def.Default;
    else missing.push(key);

    if (value !== undefined) {
      value = String(value);
      if (Array.isArray(def.AllowedValues) && !def.AllowedValues.map(String).includes(value)) {
        throw new CloudFormationError("ValidationError", `Parameter '${key}' must be one of AllowedValues`, 400);
      }
      if (def.AllowedPattern && !new RegExp(`^(?:${def.AllowedPattern})$`).test(value)) {
        throw new CloudFormationError("ValidationError", `Parameter '${key}' must match pattern ${def.AllowedPattern}`, 400);
      }
      if (def.MinLength !== undefined && value.length < Number(def.MinLength)) {
        throw new CloudFormationError("ValidationError", `Parameter '${key}' must be at least ${def.MinLength} characters`, 400);
      }
      if (def.MaxLength !== undefined && value.length > Number(def.MaxLength)) {
        throw new CloudFormationError("ValidationError", `Parameter '${key}' must be at most ${def.MaxLength} characters`, 400);
      }
      if (String(def.Type || "String") === "Number") {
        const n = Number(value);
        if (Number.isNaN(n) || (def.MinValue !== undefined && n < Number(def.MinValue)) || (def.MaxValue !== undefined && n > Number(def.MaxValue))) {
          throw new CloudFormationError("ValidationError", `Parameter '${key}' must be a number within its allowed range`, 400);
        }
      }
      resolved[key] = value;
    }
  }
  if (missing.length) {
    throw new CloudFormationError("ValidationError", `Parameters: [${missing.join(", ")}] must have values`, 400);
  }

  return Object.entries(resolved).map(([k, v]) => ({
    ParameterKey: k,
    ParameterValue: v,
    ResolvedValue: v,
  }));
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

    /** @type {Map<string, Object[]>} stackId -> eventos (ordem cronológica) */
    this.stackEvents = new Map();

    this.audit = new CloudTrailAudit("cloudformation.amazonaws.com");

    // Simuladores injetados via injectDependencies
    // Simuladores por nome lógico (usados pelos resource handlers). Preenchido em CloudFormationService.injectDependencies.
    this.sims = {};
    this.env = { region: REGION, account: ACCOUNT, partition: "aws" };
  }

  // ─── Persistência ──────────────────────────────────────────────

  async load() {
    try {
      const data = await this.store.read("cloudformation", "data");
      if (data) {
        if (data.stacks) this.stacks = new Map(Object.entries(data.stacks));
        if (data.stackResources) this.stackResources = new Map(Object.entries(data.stackResources));
        if (data.changeSets) this.changeSets = new Map(Object.entries(data.changeSets));
        if (data.stackEvents) this.stackEvents = new Map(Object.entries(data.stackEvents));
        this.logger.info("[CloudFormation] Loaded persisted data");
      }
    } catch (_) {
      this.logger.debug("[CloudFormation] No persisted data found, starting fresh");
    }
  }

  async save() {
    try {
      await this.store.write("cloudformation", "data", {
        stacks: Object.fromEntries(this.stacks),
        stackResources: Object.fromEntries(this.stackResources),
        changeSets: Object.fromEntries(this.changeSets),
        stackEvents: Object.fromEntries(this.stackEvents),
      });
    } catch (err) {
      this.logger.warn(`[CloudFormation] Failed to persist data: ${err.message}`);
    }
  }

  async reset() {
    this.stacks.clear();
    this.stackResources.clear();
    this.changeSets.clear();
    this.stackEvents.clear();
    try {
      await this.store.clear("cloudformation");
    } catch (_) {}
    this.logger.info("[CloudFormation] Reset complete");
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
    OnFailure = "ROLLBACK",
    TimeoutInMinutes,
    NotificationARNs = [],
    RoleARN,
    DisableRollback = false,
  }) {
    if (!StackName) throw Errors.InvalidAction("StackName is required");
    if (this.stacks.has(StackName)) throw Errors.AlreadyExists(StackName);

    const template = parseTemplate(TemplateBody || "{}");
    const stackId = randomUUID();
    const arn = stackArn(StackName, stackId);
    const resolvedParams = resolveParameters(template.Parameters, Parameters);

    // Validação estática (síncrona, como no CloudFormation real)
    this._preflight(template);

    const stack = {
      StackId: arn,
      StackName,
      StackStatus: StackStatus.CREATE_IN_PROGRESS,
      StackStatusReason: "User Initiated",
      CreationTime: now(),
      LastUpdatedTime: now(),
      Parameters: resolvedParams,
      Outputs: [],
      Capabilities,
      Tags,
      NotificationARNs,
      RoleARN: RoleARN || "",
      TimeoutInMinutes: TimeoutInMinutes || 0,
      DisableRollback,
      OnFailure,
      TemplateBody: TemplateBody || JSON.stringify(template),
      EnableTerminationProtection: false,
      DriftInformation: { StackDriftStatus: "NOT_CHECKED" },
    };

    this.stacks.set(StackName, stack);
    this.stackResources.set(StackName, []);

    this.logger.info(`[CloudFormation] Creating stack: ${StackName} (${Object.keys(template.Resources || {}).length} resources)`);

    await this._runCreate(stack, template);

    this.audit.record({
      eventName: "CreateStack",
      readOnly: false,
      resources: [{ ARN: arn, type: "AWS::CloudFormation::Stack" }],
      requestParameters: { stackName: StackName },
    });

    return { StackId: arn };
  }

  /** Validação estática do template: referências, condições, dependências circulares. */
  _preflight(template) {
    try {
      validateReferences(template);
      sortResources(template.Resources || {});
    } catch (err) {
      if (err instanceof TemplateError) throw new CloudFormationError("ValidationError", err.message, 400);
      throw err;
    }
  }

  /** Exports (Outputs com Export.Name) de todas as stacks, exceto `excludeStack`. */
  _collectExports(excludeStack) {
    const exportsMap = new Map();
    for (const [name, stack] of this.stacks) {
      if (name === excludeStack) continue;
      for (const o of stack.Outputs || []) {
        if (o.ExportName) exportsMap.set(o.ExportName, o.OutputValue);
      }
    }
    return exportsMap;
  }

  _deployArgs(stack, template, previousResources) {
    return {
      template,
      stackName: stack.StackName,
      stackId: stack.StackId,
      env: this.env,
      parameters: stack.Parameters,
      exports: this._collectExports(stack.StackName),
      handlers: HANDLERS,
      sims: this.sims,
      previousResources,
      onEvent: this._onEvent(stack),
    };
  }

  // ─── Eventos (DescribeStackEvents) ─────────────────────────────

  /** Registra um evento. Para o evento da própria stack, logicalId = StackName. */
  _recordEvent(stack, { logicalId, physicalId, type, status, reason }) {
    const events = this.stackEvents.get(stack.StackId) || [];
    events.push({
      StackId: stack.StackId,
      EventId: randomUUID(),
      StackName: stack.StackName,
      LogicalResourceId: logicalId,
      PhysicalResourceId: physicalId || "",
      ResourceType: type,
      Timestamp: now(),
      ResourceStatus: status,
      ...(reason ? { ResourceStatusReason: reason } : {}),
    });
    if (events.length > 1000) events.splice(0, events.length - 1000);
    this.stackEvents.set(stack.StackId, events);
  }

  _onEvent(stack) {
    return (e) => this._recordEvent(stack, e);
  }

  /** Evento de nível de stack (AWS::CloudFormation::Stack). */
  _stackEvent(stack, status, reason) {
    this._recordEvent(stack, { logicalId: stack.StackName, physicalId: stack.StackId, type: "AWS::CloudFormation::Stack", status, reason });
  }

  /**
   * Provisiona uma stack nova e atualiza o seu status (com rollback em caso de falha).
   */
  async _runCreate(stack, template) {
    this._stackEvent(stack, StackStatus.CREATE_IN_PROGRESS, "User Initiated");
    const result = await provisionStack(this._deployArgs(stack, template, [])).catch((err) => ({
      resources: [],
      outputs: [],
      errors: [{ logicalId: "Template", type: "Template", message: err.message, code: err.code }],
    }));

    if (!result.errors.length) {
      stack.StackStatus = StackStatus.CREATE_COMPLETE;
      stack.StackStatusReason = "Stack created successfully";
      stack.Outputs = result.outputs;
      this.stackResources.set(stack.StackName, result.resources);
    } else {
      const reason = result.errors.map((e) => `${e.logicalId} (${e.type}): ${e.message}`).join("; ");
      const keepResources = stack.DisableRollback || stack.OnFailure === "DO_NOTHING";
      this._stackEvent(stack, keepResources ? StackStatus.CREATE_FAILED : StackStatus.ROLLBACK_IN_PROGRESS, reason);
      if (keepResources) {
        stack.StackStatus = StackStatus.CREATE_FAILED;
        this.stackResources.set(stack.StackName, result.resources);
      } else {
        const created = result.resources.filter((r) => r.ResourceStatus === "CREATE_COMPLETE");
        await deprovisionStack({ resources: created, handlers: HANDLERS, sims: this.sims, env: this.env, stackName: stack.StackName, onEvent: this._onEvent(stack) });
        for (const r of result.resources) if (r.ResourceStatus === "CREATE_COMPLETE") r.ResourceStatus = "DELETE_COMPLETE";
        this.stackResources.set(stack.StackName, result.resources);
        stack.StackStatus = StackStatus.ROLLBACK_COMPLETE;
        if (stack.OnFailure === "DELETE") {
          stack.StackStatus = StackStatus.DELETE_COMPLETE;
          this.stacks.delete(stack.StackName);
          this.stackResources.delete(stack.StackName);
        }
      }
      stack.StackStatusReason = reason;
      this.logger.warn(`[CloudFormation] Stack ${stack.StackName} falhou: ${reason}`);
    }
    stack.LastUpdatedTime = now();
    this._stackEvent(stack, stack.StackStatus, stack.StackStatusReason);
    await this.save();
  }

  /**
   * Aplica um template novo sobre uma stack existente (UpdateStack / ExecuteChangeSet):
   * cria recursos novos, atualiza (ou substitui) alterados e remove os retirados do template.
   * Em caso de falha reverte os recursos criados e mantém o estado anterior (UPDATE_ROLLBACK_COMPLETE).
   */
  async _runUpdate(stack, template, { templateBody, parameters, reasonOk = "Stack updated successfully" }) {
    const previous = this.stackResources.get(stack.StackName) || [];
    stack.StackStatus = StackStatus.UPDATE_IN_PROGRESS;
    this._stackEvent(stack, StackStatus.UPDATE_IN_PROGRESS, "User Initiated");
    const previousParams = stack.Parameters;
    stack.Parameters = parameters;

    const result = await provisionStack(this._deployArgs(stack, template, previous)).catch((err) => ({
      resources: [],
      outputs: [],
      errors: [{ logicalId: "Template", type: "Template", message: err.message, code: err.code }],
    }));

    if (!result.errors.length) {
      stack.StackStatus = StackStatus.UPDATE_COMPLETE;
      stack.StackStatusReason = reasonOk;
      stack.TemplateBody = templateBody;
      stack.Outputs = result.outputs;
      this.stackResources.set(stack.StackName, result.resources);
    } else {
      this._stackEvent(stack, "UPDATE_ROLLBACK_IN_PROGRESS", result.errors.map((e) => `${e.logicalId} (${e.type}): ${e.message}`).join("; "));
      const previousIds = new Set(previous.map((r) => r.LogicalResourceId));
      const createdNow = result.resources.filter((r) => r.ResourceStatus === "CREATE_COMPLETE" && !previousIds.has(r.LogicalResourceId));
      await deprovisionStack({ resources: createdNow, handlers: HANDLERS, sims: this.sims, env: this.env, stackName: stack.StackName, onEvent: this._onEvent(stack) });
      stack.Parameters = previousParams;
      stack.StackStatus = StackStatus.UPDATE_ROLLBACK_COMPLETE;
      stack.StackStatusReason = result.errors.map((e) => `${e.logicalId} (${e.type}): ${e.message}`).join("; ");
      this.logger.warn(`[CloudFormation] Update de ${stack.StackName} revertido: ${stack.StackStatusReason}`);
    }
    stack.LastUpdatedTime = now();
    this._stackEvent(stack, stack.StackStatus, stack.StackStatusReason);
    await this.save();
  }

  /**
   * UpdateStack
   */
  async updateStack({ StackName, TemplateBody, UsePreviousTemplate = false, Parameters = [], Capabilities = [], Tags, RoleARN, NotificationARNs }) {
    const stack = this._getStack(StackName);

    const templateBody = UsePreviousTemplate ? stack.TemplateBody : TemplateBody || stack.TemplateBody;

    const template = parseTemplate(templateBody);
    const resolvedParams = resolveParameters(template.Parameters, Parameters.length ? Parameters : [], stack.Parameters);
    this._preflight(template);

    if (Tags) stack.Tags = Tags;
    if (RoleARN) stack.RoleARN = RoleARN;
    if (NotificationARNs) stack.NotificationARNs = NotificationARNs;
    if (Capabilities.length) stack.Capabilities = Capabilities;

    this.logger.info(`[CloudFormation] Updating stack: ${StackName}`);
    await this._runUpdate(stack, template, { templateBody, parameters: resolvedParams });

    this.audit.record({
      eventName: "UpdateStack",
      readOnly: false,
      resources: [{ ARN: stack.StackId, type: "AWS::CloudFormation::Stack" }],
      requestParameters: { stackName: StackName },
    });

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
      throw new CloudFormationError("ValidationError", `Stack [${StackName}] cannot be deleted while TerminationProtection is enabled`, 400);
    }

    // Exports em uso por outras stacks bloqueiam a exclusão
    const myExports = new Set((stack.Outputs || []).filter((o) => o.ExportName).map((o) => o.ExportName));
    if (myExports.size) {
      for (const [otherName, other] of this.stacks) {
        if (otherName === StackName) continue;
        const text = other.TemplateBody || "";
        for (const exp of myExports) {
          if (text.includes(exp) && /ImportValue/.test(text)) {
            throw new CloudFormationError("ValidationError", `Export ${exp} cannot be deleted as it is in use by ${otherName}`, 400);
          }
        }
      }
    }

    const resources = this.stackResources.get(StackName) || [];
    const retain = new Set(RetainResources);
    const toDelete = resources.filter((r) => !retain.has(r.LogicalResourceId));

    stack.StackStatus = StackStatus.DELETE_IN_PROGRESS;
    this._stackEvent(stack, StackStatus.DELETE_IN_PROGRESS, "User Initiated");
    const { errors } = await deprovisionStack({ resources: toDelete, handlers: HANDLERS, sims: this.sims, env: this.env, stackName: StackName, onEvent: this._onEvent(stack) });

    if (errors.length) {
      stack.StackStatus = StackStatus.DELETE_FAILED;
      stack.StackStatusReason = errors.map((e) => `${e.logicalId} (${e.type}): ${e.message}`).join("; ");
      this._stackEvent(stack, StackStatus.DELETE_FAILED, stack.StackStatusReason);
      this.logger.warn(`[CloudFormation] Falha ao deletar ${StackName}: ${stack.StackStatusReason}`);
      await this.save();
      return {};
    }

    this._stackEvent(stack, StackStatus.DELETE_COMPLETE);
    this.stacks.delete(StackName);
    this.stackResources.delete(StackName);

    // Remove changesets associados
    for (const [key, cs] of this.changeSets.entries()) {
      if (cs.StackName === StackName) this.changeSets.delete(key);
    }

    this.logger.info(`[CloudFormation] Deleted stack: ${StackName}`);
    this.audit.record({
      eventName: "DeleteStack",
      readOnly: false,
      resources: [{ ARN: stack.StackId, type: "AWS::CloudFormation::Stack" }],
      requestParameters: { stackName: StackName },
    });
    await this.save();

    return {};
  }

  /**
   * DescribeStacks
   */
  describeStacks({ StackName } = {}) {
    if (StackName) {
      const stack = this._getStack(StackName);
      return { Stacks: [this._formatStack(stack)] };
    }
    const stacks = Array.from(this.stacks.values()).map((s) => this._formatStack(s));
    return { Stacks: stacks };
  }

  /**
   * ListStacks
   */
  listStacks({ StackStatusFilter = [], NextToken } = {}) {
    let items = Array.from(this.stacks.values());

    if (StackStatusFilter.length > 0) {
      items = items.filter((s) => StackStatusFilter.includes(s.StackStatus));
    }

    let startIdx = 0;
    if (NextToken) {
      startIdx = parseInt(Buffer.from(NextToken, "base64").toString("utf8"), 10) || 0;
    }

    const page = items.slice(startIdx, startIdx + 100).map((s) => ({
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
    const newNextToken = hasMore ? Buffer.from(String(startIdx + 100)).toString("base64") : undefined;

    return { StackSummaries: page, NextToken: newNextToken };
  }

  // ─── Template ──────────────────────────────────────────────────

  /**
   * ValidateTemplate
   */
  validateTemplate({ TemplateBody, TemplateURL }) {
    const body = TemplateBody || "{}";
    const template = parseTemplate(body);

    const parameters = Object.entries(template.Parameters || {}).map(([key, def]) => ({
      ParameterKey: key,
      DefaultValue: def.Default || "",
      NoEcho: def.NoEcho || false,
      Description: def.Description || "",
    }));

    const capabilities = [];
    const resources = Object.values(template.Resources || {});
    const hasIAM = resources.some((r) => r.Type && (r.Type.includes("IAM") || r.Type.includes("Role")));
    if (hasIAM) capabilities.push("CAPABILITY_IAM", "CAPABILITY_NAMED_IAM");

    return {
      Parameters: parameters,
      Description: template.Description || "",
      Capabilities: capabilities,
      CapabilitiesReason: capabilities.length > 0 ? "The following resource(s) require capabilities: [AWS::IAM::Role]" : "",
    };
  }

  /**
   * GetTemplate
   */
  getTemplate({ StackName, TemplateStage = "Original" }) {
    const stack = this._getStack(StackName);
    return {
      TemplateBody: stack.TemplateBody || "{}",
      StagesAvailable: ["Original", "Processed"],
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
      filtered = resources.filter((r) => r.LogicalResourceId === LogicalResourceId);
    }
    return {
      StackResources: filtered.map(({ _meta, ...r }) => ({ ...r, StackName, StackId: this.stacks.get(StackName)?.StackId })),
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
      startIdx = parseInt(Buffer.from(NextToken, "base64").toString("utf8"), 10) || 0;
    }

    const page = resources.slice(startIdx, startIdx + 100).map(({ _meta, ...r }) => r);
    const hasMore = startIdx + 100 < resources.length;
    const newNextToken = hasMore ? Buffer.from(String(startIdx + 100)).toString("base64") : undefined;

    return {
      StackResourceSummaries: page,
      NextToken: newNextToken,
    };
  }

  // ─── ChangeSets ────────────────────────────────────────────────

  /**
   * CreateChangeSet
   */
  async createChangeSet({ StackName, ChangeSetName, TemplateBody, UsePreviousTemplate = false, Parameters = [], Capabilities = [], Tags = [], Description = "", ChangeSetType = "UPDATE" }) {
    if (!ChangeSetName) throw Errors.InvalidAction("ChangeSetName is required");
    if (!StackName) throw Errors.InvalidAction("StackName is required");

    // Para CREATE, a stack não deve existir; para UPDATE, deve existir
    if (ChangeSetType === "UPDATE" && !this.stacks.has(StackName)) {
      throw Errors.DoesNotExist(StackName);
    }

    const csArn = changeSetArn(StackName, ChangeSetName);

    const existingStack = this.stacks.get(StackName);
    const templateBody = UsePreviousTemplate ? existingStack?.TemplateBody || "{}" : TemplateBody || "{}";

    const template = parseTemplate(templateBody);
    this._preflight(template);
    const resolvedParams = resolveParameters(template.Parameters, Parameters, existingStack?.Parameters);

    // Calcula changes (adições, remoções, modificações)
    const changes = this._computeChanges(existingStack, template, resolvedParams);

    const changeSet = {
      ChangeSetId: csArn,
      ChangeSetName,
      StackName,
      StackId: existingStack?.StackId || stackArn(StackName, randomUUID()),
      Status: ChangeSetStatus.CREATE_COMPLETE,
      StatusReason: "Complete",
      Description,
      ChangeSetType,
      CreationTime: now(),
      Parameters,
      Capabilities,
      Tags,
      TemplateBody: templateBody,
      Changes: changes,
      ExecutionStatus: "AVAILABLE",
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

    if (changeSet.ExecutionStatus !== "AVAILABLE") {
      throw new CloudFormationError("InvalidChangeSetStatus", `ChangeSet [${ChangeSetName}] cannot be executed in its current status [${changeSet.ExecutionStatus}]`, 400);
    }

    const template = parseTemplate(changeSet.TemplateBody);
    let stack;

    if (changeSet.ChangeSetType === "CREATE") {
      if (this.stacks.has(StackName)) throw Errors.AlreadyExists(StackName);
      const stackId = randomUUID();
      const arn = changeSet.StackId || stackArn(StackName, stackId);
      stack = {
        StackId: arn,
        StackName,
        StackStatus: StackStatus.CREATE_IN_PROGRESS,
        StackStatusReason: "User Initiated",
        CreationTime: now(),
        LastUpdatedTime: now(),
        Parameters: resolveParameters(template.Parameters, changeSet.Parameters),
        Outputs: [],
        Capabilities: changeSet.Capabilities,
        Tags: changeSet.Tags,
        NotificationARNs: [],
        TemplateBody: changeSet.TemplateBody,
        EnableTerminationProtection: false,
        DisableRollback: false,
        OnFailure: "ROLLBACK",
        DriftInformation: { StackDriftStatus: "NOT_CHECKED" },
      };
      this.stacks.set(StackName, stack);
      this.stackResources.set(StackName, []);
      await this._runCreate(stack, template);
    } else {
      stack = this._getStack(StackName);
      const parameters = resolveParameters(template.Parameters, changeSet.Parameters, stack.Parameters);
      if (changeSet.Tags?.length) stack.Tags = changeSet.Tags;
      await this._runUpdate(stack, template, {
        templateBody: changeSet.TemplateBody,
        parameters,
        reasonOk: "Stack updated via ChangeSet",
      });
    }

    const failed = [StackStatus.CREATE_FAILED, StackStatus.ROLLBACK_COMPLETE, StackStatus.UPDATE_ROLLBACK_COMPLETE].includes(stack.StackStatus);
    changeSet.ExecutionStatus = failed ? "EXECUTE_FAILED" : "EXECUTE_COMPLETE";
    changeSet.Status = failed ? "FAILED" : "CREATE_COMPLETE";
    if (failed) changeSet.StatusReason = stack.StackStatusReason;

    this.logger.info(`[CloudFormation] Executed ChangeSet: ${ChangeSetName} on ${StackName} -> ${stack.StackStatus}`);
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
      .filter((cs) => cs.StackName === StackName)
      .map((cs) => ({
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
      RoleARN: stack.RoleARN || "",
      EnableTerminationProtection: stack.EnableTerminationProtection || false,
      DriftInformation: stack.DriftInformation || { StackDriftStatus: "NOT_CHECKED" },
    };
  }

  /** Recursos ativos (Condition verdadeira) de um template, com seus ids. */
  _activeResources(template, parameters) {
    const ctx = new TemplateContext({ template, stackName: "", stackId: "", region: this.env.region, account: this.env.account, parameters, handlers: HANDLERS });
    ctx.evaluateConditions();
    const active = {};
    for (const [id, def] of Object.entries(template.Resources || {})) {
      if (def.Condition === undefined || ctx.condition(def.Condition)) active[id] = def;
    }
    return active;
  }

  /** Assinatura de uma definição de recurso, incluindo os valores de parâmetros que ela referencia. */
  _signature(def, parameters) {
    const refs = collectReferences(def.Properties);
    const paramValues = {};
    for (const p of parameters) if (refs.has(p.ParameterKey)) paramValues[p.ParameterKey] = p.ParameterValue;
    return { type: def.Type, props: def.Properties || {}, params: paramValues };
  }

  /**
   * Diff entre a stack atual e o template novo:
   * Add / Remove / Modify (com Replacement e Details por propriedade).
   */
  _computeChanges(stack, newTemplate, newParams) {
    const oldTemplate = stack ? parseTemplate(stack.TemplateBody) : { Resources: {} };
    const oldParams = stack?.Parameters || [];
    const oldRes = this._activeResources(oldTemplate, oldParams);
    const newRes = this._activeResources(newTemplate, newParams);
    const currentRecords = new Map((stack ? this.stackResources.get(stack.StackName) || [] : []).map((r) => [r.LogicalResourceId, r]));
    const changes = [];

    const change = (action, id, def, extra = {}) => ({
      Type: "Resource",
      ResourceChange: {
        Action: action,
        LogicalResourceId: id,
        ResourceType: def.Type,
        Replacement: "False",
        Scope: [],
        Details: [],
        ...extra,
      },
    });

    for (const [id, def] of Object.entries(newRes)) {
      if (!oldRes[id]) changes.push(change("Add", id, def));
    }
    for (const [id, def] of Object.entries(oldRes)) {
      if (!newRes[id]) {
        changes.push(change("Remove", id, def, { PhysicalResourceId: currentRecords.get(id)?.PhysicalResourceId }));
      }
    }
    for (const [id, def] of Object.entries(newRes)) {
      const old = oldRes[id];
      if (!old) continue;
      const physicalId = currentRecords.get(id)?.PhysicalResourceId;

      if (old.Type !== def.Type) {
        changes.push(change("Modify", id, def, { PhysicalResourceId: physicalId, Replacement: "True", Scope: ["Properties"] }));
        continue;
      }
      const a = this._signature(old, oldParams);
      const b = this._signature(def, newParams);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;

      const names = new Set([...Object.keys(a.props), ...Object.keys(b.props)]);
      const handler = HANDLERS[def.Type];
      const inPlace = new Set(handler?.inPlace || []);
      const details = [];
      for (const name of names) {
        // Propriedade alterada por valor direto ou por mudança de parâmetro referenciado
        const sameRaw = JSON.stringify(a.props[name]) === JSON.stringify(b.props[name]);
        const refsParams = [...collectReferences(b.props[name])].filter((r) => r in b.params);
        const paramChanged = refsParams.some((r) => a.params[r] !== b.params[r]);
        if (sameRaw && !paramChanged) continue;
        details.push({
          Target: { Attribute: "Properties", Name: name, RequiresRecreation: !handler || inPlace.has(name) ? "Never" : "Always" },
          Evaluation: "Static",
          ChangeSource: sameRaw ? "ParameterReference" : "DirectModification",
        });
      }
      const replacement = details.some((d) => d.Target.RequiresRecreation === "Always");
      changes.push(change("Modify", id, def, {
        PhysicalResourceId: physicalId,
        Replacement: replacement ? "True" : "False",
        Scope: ["Properties"],
        Details: details,
      }));
    }

    return changes;
  }

  // ─── Admin ────────────────────────────────────────────────────

  /**
   * DescribeStackEvents: mais recentes primeiro, paginado (100 por página).
   * Aceita nome da stack ou StackId (inclusive de stacks já removidas).
   */
  describeStackEvents({ StackName, NextToken } = {}) {
    if (!StackName) throw Errors.InvalidAction("StackName is required");

    let stackId;
    if (this.stacks.has(StackName)) stackId = this.stacks.get(StackName).StackId;
    else if (this.stackEvents.has(StackName)) stackId = StackName;
    else stackId = this._getStack(StackName).StackId;

    const all = [...(this.stackEvents.get(stackId) || [])].reverse();
    const pageSize = 100;
    let start = 0;
    if (NextToken) start = parseInt(Buffer.from(NextToken, "base64").toString("utf8"), 10) || 0;

    return {
      StackEvents: all.slice(start, start + pageSize),
      NextToken: start + pageSize < all.length ? Buffer.from(String(start + pageSize)).toString("base64") : undefined,
    };
  }

  /**
   * ListExports: exports (Outputs com Export.Name) de todas as stacks ativas.
   */
  listExports({ NextToken } = {}) {
    const all = [];
    for (const stack of this.stacks.values()) {
      for (const o of stack.Outputs || []) {
        if (o.ExportName) all.push({ ExportingStackId: stack.StackId, Name: o.ExportName, Value: o.OutputValue });
      }
    }
    const pageSize = 100;
    let start = 0;
    if (NextToken) start = parseInt(Buffer.from(NextToken, "base64").toString("utf8"), 10) || 0;

    return {
      Exports: all.slice(start, start + pageSize),
      NextToken: start + pageSize < all.length ? Buffer.from(String(start + pageSize)).toString("base64") : undefined,
    };
  }

  getStats() {
    return {
      stacks: this.stacks.size,
      changeSets: this.changeSets.size,
      resources: Array.from(this.stackResources.values()).reduce((acc, r) => acc + r.length, 0),
    };
  }
}

module.exports = { CloudFormationSimulator };
