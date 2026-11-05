/**
 * @fileoverview EventBridge Simulator
 * Simula o Amazon EventBridge com event buses, rules e targets
 */

'use strict';

const crypto = require('crypto');
const { ArchiveFeature } = require('./features/archives');
const { PipeFeature } = require('./features/pipes');
const { SchedulerFeature } = require('./features/scheduler');
const { IntegrationFeature } = require('./features/integrations');
const { SchemaFeature } = require('./features/schemas');
const { GlobalEndpointFeature } = require('./features/global-endpoints');

/**
 * EventBridge Simulator
 */
class EventBridgeSimulator {
  /**
   * @param {Object} config - Service configuration
   * @param {Object} store - LocalStore instance
   * @param {Object} logger - Logger instance
   */
  constructor(config, store, logger) {
    this.config = config;
    this.store = store;
    this.logger = logger;

    /** @type {Map<string, Object>} Event buses */
    this.buses = new Map();
    /** @type {Map<string, Object>} Rules by ruleArn */
    this.rules = new Map();
    /** @type {Map<string, Object[]>} Targets by ruleArn */
    this.targets = new Map();
    /** @type {Array} Event archive (recent events) */
    this.eventArchive = [];

    this.region = 'us-east-1';
    this.accountId = '123456789012';

    // Services for target delivery
    this.lambdaService = null;
    this.sqsService = null;
    this.snsService = null;

    // Feature modules
    this.features = {
      archives: new ArchiveFeature(this),
      pipes: new PipeFeature(this),
      scheduler: new SchedulerFeature(this),
      integrations: new IntegrationFeature(this),
      schemas: new SchemaFeature(this),
      globalEndpoints: new GlobalEndpointFeature(this),
    };

    // Create default event bus
    this._createDefaultBus();
  }

  /**
   * Create the default event bus
   */
  _createDefaultBus() {
    const defaultBus = {
      Name: 'default',
      Arn: `arn:aws:events:${this.region}:${this.accountId}:event-bus/default`,
      State: 'ACTIVE',
      CreationTime: new Date().toISOString()
    };
    this.buses.set('default', defaultBus);
  }

  /** @param {Object} s */ setLambdaService(s) { this.lambdaService = s; }
  /** @param {Object} s */ setSqsService(s) { this.sqsService = s; }
  /** @param {Object} s */ setSnsService(s) { this.snsService = s; }

  /**
   * Load persisted data
   */
  async load() {
    try {
      const buses = await this.store.read('eventbridge/buses');
      if (Array.isArray(buses)) {
        buses.forEach(b => this.buses.set(b.Name, b));
      }
      const rules = await this.store.read('eventbridge/rules');
      if (Array.isArray(rules)) {
        rules.forEach(r => {
          this.rules.set(r.Arn, r);
          // Reparseia padrões caso tenham sido carregados.
          if (r.EventPattern && !r.ParsedPattern) {
            try { r.ParsedPattern = JSON.parse(r.EventPattern); } catch { r.ParsedPattern = null; }
          }
        });
      }
      const targets = await this.store.read('eventbridge/targets');
      if (Array.isArray(targets)) {
        targets.forEach(({ ruleArn, list }) => this.targets.set(ruleArn, list));
      }
      this.logger.debug('EventBridge', `Loaded ${this.buses.size} buses, ${this.rules.size} rules`);
    } catch {
      this.logger.debug('EventBridge', 'No persisted data, starting fresh');
    }

    try {
      await this.features.archives.load();
    } catch (err) {
      this.logger.debug('EventBridge', `Archives não carregados: ${err.message}`);
    }
    try {
      await this.features.pipes.load();
    } catch (err) {
      this.logger.debug('EventBridge', `Pipes não carregados: ${err.message}`);
    }
    try {
      await this.features.scheduler.load();
    } catch (err) {
      this.logger.debug('EventBridge', `Scheduler não carregados: ${err.message}`);
    }
    try {
      await this.features.integrations.load();
    } catch (err) {
      this.logger.debug('EventBridge', `Integrações não carregadas: ${err.message}`);
    }
    try {
      await this.features.schemas.load();
    } catch (err) {
      this.logger.debug('EventBridge', `Schema registry não carregado: ${err.message}`);
    }
    try {
      await this.features.globalEndpoints.load();
    } catch (err) {
      this.logger.debug('EventBridge', `Global endpoints não carregados: ${err.message}`);
    }
  }

  /**
   * Save data
   */
  async _save() {
    await this.store.write('eventbridge/buses', null, Array.from(this.buses.values()));
    await this.store.write('eventbridge/rules', null, Array.from(this.rules.values()));
    const targetsList = Array.from(this.targets.entries())
      .map(([ruleArn, list]) => ({ ruleArn, list }));
    await this.store.write('eventbridge/targets', null, targetsList);
  }

  // ==================== Event Bus Operations ====================

  /**
   * CreateEventBus
   * @param {Object} params
   * @returns {Object}
   */
  async createEventBus(params) {
    const { Name, EventSourceName, Tags } = params;

    if (!Name) throw this._error('ValidationException', 'Name is required');
    if (Name === 'default') throw this._error('ResourceAlreadyExistsException', 'Default event bus already exists');
    if (this.buses.has(Name)) throw this._error('ResourceAlreadyExistsException', `Event bus ${Name} already exists`);

    const bus = {
      Name,
      Arn: `arn:aws:events:${this.region}:${this.accountId}:event-bus/${Name}`,
      State: 'ACTIVE',
      EventSourceName: EventSourceName || null,
      Tags: Tags || [],
      CreationTime: new Date().toISOString()
    };

    this.buses.set(Name, bus);
    await this._save();

    this.logger.info('EventBridge', `Created event bus: ${Name}`);
    return { EventBusArn: bus.Arn };
  }

  /**
   * DeleteEventBus
   * @param {Object} params
   */
  async deleteEventBus(params) {
    const { Name } = params;

    if (Name === 'default') throw this._error('ValidationException', 'Cannot delete default event bus');
    if (!this.buses.has(Name)) throw this._error('ResourceNotFoundException', `Event bus ${Name} not found`);

    // Delete all rules for this bus
    for (const [arn, rule] of this.rules.entries()) {
      if (rule.EventBusName === Name) {
        this.rules.delete(arn);
        this.targets.delete(arn);
      }
    }

    this.buses.delete(Name);

    try {
      if (this.features?.archives?.deleteForBus) await this.features.archives.deleteForBus(Name);
    } catch (err) {
      this.logger.warn('EventBridge', `Falha ao limpar archives do bus: ${err.message}`);
    }

    try {
      if (this.features?.pipes?.deleteForBus) await this.features.pipes.deleteForBus(Name);
    } catch (err) {
      this.logger.warn('EventBridge', `Falha ao limpar pipes do bus: ${err.message}`);
    }

    await this._save();

    this.logger.info('EventBridge', `Deleted event bus: ${Name}`);
  }

  /**
   * ListEventBuses
   * @param {Object} params
   * @returns {Object}
   */
  listEventBuses(params = {}) {
    const { Limit = 100, NamePrefix, NextToken } = params;
    let buses = Array.from(this.buses.values());

    if (NamePrefix) {
      buses = buses.filter(b => b.Name.startsWith(NamePrefix));
    }

    return {
      EventBuses: buses.slice(0, Limit).map(b => ({
        Name: b.Name,
        Arn: b.Arn,
        State: b.State
      }))
    };
  }

  /**
   * DescribeEventBus
   * @param {Object} params
   * @returns {Object}
   */
  describeEventBus(params = {}) {
    const { Name = 'default' } = params;
    const bus = this.buses.get(Name);
    if (!bus) throw this._error('ResourceNotFoundException', `Event bus ${Name} not found`);
    return bus;
  }

  // ==================== Rules ====================

  /**
   * PutRule
   * @param {Object} params
   * @returns {Object}
   */
  async putRule(params) {
    const {
      Name, EventBusName = 'default', EventPattern, ScheduleExpression,
      State = 'ENABLED', Description, RoleArn, Tags
    } = params;

    if (!Name) throw this._error('ValidationException', 'Name is required');
    if (!EventPattern && !ScheduleExpression) {
      throw this._error('ValidationException', 'Either EventPattern or ScheduleExpression is required');
    }

    const bus = this.buses.get(EventBusName);
    if (!bus) throw this._error('ResourceNotFoundException', `Event bus ${EventBusName} not found`);

    // Validate EventPattern
    let parsedPattern = null;
    if (EventPattern) {
      try {
        parsedPattern = JSON.parse(EventPattern);
      } catch {
        throw this._error('InvalidEventPatternException', 'Event pattern is not valid JSON');
      }
    }

    const ruleArn = `arn:aws:events:${this.region}:${this.accountId}:rule/${EventBusName}/${Name}`;

    const rule = {
      Name,
      Arn: ruleArn,
      EventBusName,
      EventPattern: EventPattern || null,
      ParsedPattern: parsedPattern,
      ScheduleExpression: ScheduleExpression || null,
      State,
      Description: Description || '',
      RoleArn: RoleArn || null,
      Tags: Tags || [],
      CreatedAt: new Date().toISOString()
    };

    this.rules.set(ruleArn, rule);
    await this._save();

    this.logger.info('EventBridge', `Put rule: ${Name} on bus ${EventBusName}`);
    return { RuleArn: ruleArn };
  }

  /**
   * DeleteRule
   * @param {Object} params
   */
  async deleteRule(params) {
    const { Name, EventBusName = 'default', Force } = params;

    const ruleArn = `arn:aws:events:${this.region}:${this.accountId}:rule/${EventBusName}/${Name}`;

    if (!this.rules.has(ruleArn)) {
      throw this._error('ResourceNotFoundException', `Rule ${Name} not found`);
    }

    // Check for targets unless Force
    const ruleTargets = this.targets.get(ruleArn) || [];
    if (ruleTargets.length > 0 && !Force) {
      throw this._error('ValidationException', 'Rule has targets. Use Force=true to delete anyway');
    }

    this.rules.delete(ruleArn);
    this.targets.delete(ruleArn);
    await this._save();

    this.logger.info('EventBridge', `Deleted rule: ${Name}`);
  }

  /**
   * ListRules
   * @param {Object} params
   * @returns {Object}
   */
  listRules(params = {}) {
    const { EventBusName = 'default', NamePrefix, Limit = 100 } = params;
    let rules = Array.from(this.rules.values())
      .filter(r => r.EventBusName === EventBusName);

    if (NamePrefix) {
      rules = rules.filter(r => r.Name.startsWith(NamePrefix));
    }

    return {
      Rules: rules.slice(0, Limit).map(r => ({
        Name: r.Name,
        Arn: r.Arn,
        EventBusName: r.EventBusName,
        EventPattern: r.EventPattern,
        ScheduleExpression: r.ScheduleExpression,
        State: r.State,
        Description: r.Description
      }))
    };
  }

  /**
   * DescribeRule
   * @param {Object} params
   * @returns {Object}
   */
  describeRule(params) {
    const { Name, EventBusName = 'default' } = params;
    const ruleArn = `arn:aws:events:${this.region}:${this.accountId}:rule/${EventBusName}/${Name}`;
    const rule = this.rules.get(ruleArn);
    if (!rule) throw this._error('ResourceNotFoundException', `Rule ${Name} not found`);
    return rule;
  }

  /**
   * EnableRule
   * @param {Object} params
   */
  async enableRule(params) {
    const { Name, EventBusName = 'default' } = params;
    const ruleArn = `arn:aws:events:${this.region}:${this.accountId}:rule/${EventBusName}/${Name}`;
    const rule = this.rules.get(ruleArn);
    if (!rule) throw this._error('ResourceNotFoundException', `Rule ${Name} not found`);
    rule.State = 'ENABLED';
    await this._save();
  }

  /**
   * DisableRule
   * @param {Object} params
   */
  async disableRule(params) {
    const { Name, EventBusName = 'default' } = params;
    const ruleArn = `arn:aws:events:${this.region}:${this.accountId}:rule/${EventBusName}/${Name}`;
    const rule = this.rules.get(ruleArn);
    if (!rule) throw this._error('ResourceNotFoundException', `Rule ${Name} not found`);
    rule.State = 'DISABLED';
    await this._save();
  }

  // ==================== Targets ====================

  /**
   * PutTargets
   * @param {Object} params
   * @returns {Object}
   */
  async putTargets(params) {
    const { Rule, EventBusName = 'default', Targets } = params;

    if (!Rule) throw this._error('ValidationException', 'Rule is required');
    if (!Targets || !Targets.length) throw this._error('ValidationException', 'Targets are required');

    const ruleArn = `arn:aws:events:${this.region}:${this.accountId}:rule/${EventBusName}/${Rule}`;
    if (!this.rules.has(ruleArn)) throw this._error('ResourceNotFoundException', `Rule ${Rule} not found`);

    const existing = this.targets.get(ruleArn) || [];
    const failedEntries = [];

    for (const target of Targets) {
      if (!target.Id || !target.Arn) {
        failedEntries.push({ TargetId: target.Id, ErrorCode: 'ValidationException', ErrorMessage: 'Id and Arn are required' });
        continue;
      }

      // Remove existing target with same Id
      const idx = existing.findIndex(t => t.Id === target.Id);
      if (idx >= 0) existing.splice(idx, 1);

      existing.push({
        Id: target.Id,
        Arn: target.Arn,
        Input: target.Input || null,
        InputPath: target.InputPath || null,
        InputTransformer: target.InputTransformer || null,
        RoleArn: target.RoleArn || null,
        RetryPolicy: target.RetryPolicy || { MaximumRetryAttempts: 185, MaximumEventAgeInSeconds: 86400 },
        DeadLetterConfig: target.DeadLetterConfig || null,
        MessageGroupId: target.MessageGroupId || null,
        KinesisParameters: target.KinesisParameters || null,
        EcsParameters: target.EcsParameters || null,
        BatchParameters: target.BatchParameters || null,
        HttpParameters: target.HttpParameters || null,
        RedshiftDataParameters: target.RedshiftDataParameters || null,
        SageMakerPipelineParameters: target.SageMakerPipelineParameters || null,
        AppSyncParameters: target.AppSyncParameters || null
      });
    }

    this.targets.set(ruleArn, existing);
    await this._save();

    this.logger.info('EventBridge', `Put ${Targets.length} targets for rule ${Rule}`);
    return {
      FailedEntryCount: failedEntries.length,
      FailedEntries: failedEntries
    };
  }

  /**
   * RemoveTargets
   * @param {Object} params
   * @returns {Object}
   */
  async removeTargets(params) {
    const { Rule, EventBusName = 'default', Ids } = params;

    const ruleArn = `arn:aws:events:${this.region}:${this.accountId}:rule/${EventBusName}/${Rule}`;
    const existing = this.targets.get(ruleArn) || [];

    const remaining = existing.filter(t => !Ids.includes(t.Id));
    this.targets.set(ruleArn, remaining);
    await this._save();

    return { FailedEntryCount: 0, FailedEntries: [] };
  }

  /**
   * ListTargetsByRule
   * @param {Object} params
   * @returns {Object}
   */
  listTargetsByRule(params) {
    const { Rule, EventBusName = 'default' } = params;
    const ruleArn = `arn:aws:events:${this.region}:${this.accountId}:rule/${EventBusName}/${Rule}`;

    if (!this.rules.has(ruleArn)) throw this._error('ResourceNotFoundException', `Rule ${Rule} not found`);

    const targets = this.targets.get(ruleArn) || [];
    return { Targets: targets };
  }

  // ==================== PutEvents ====================

  /**
   * PutEvents
   * @param {Object} params
   * @returns {Object}
   */
  async putEvents(params) {
    const { Entries } = params;

    if (!Entries || !Entries.length) {
      throw this._error('ValidationException', 'Entries are required');
    }

    const results = [];
    const failedEntries = [];

    for (const entry of Entries) {
      const eventId = crypto.randomUUID();

      // Validate entry
      if (!entry.Source) {
        failedEntries.push({ ErrorCode: 'ValidationException', ErrorMessage: 'Source is required' });
        results.push({ EventId: null, ErrorCode: 'ValidationException' });
        continue;
      }

      const busName = entry.EventBusName || 'default';
      if (!this.buses.has(busName)) {
        failedEntries.push({ ErrorCode: 'ResourceNotFoundException', ErrorMessage: `Bus ${busName} not found` });
        results.push({ EventId: null, ErrorCode: 'ResourceNotFoundException' });
        continue;
      }

      // Build event
      let detail = entry.Detail;
      if (typeof detail === 'string') {
        try { detail = JSON.parse(detail); } catch { detail = {}; }
      }

      const event = {
        id: eventId,
        version: '0',
        account: this.accountId,
        time: entry.Time || new Date().toISOString(),
        region: this.region,
        source: entry.Source,
        'detail-type': entry.DetailType || '',
        resources: entry.Resources || [],
        detail: detail || {}
      };

      // Archive event
      event.EventBusName = event.EventBusName || busName;
      this.eventArchive.push(event);
      if (this.eventArchive.length > 1000) {
        this.eventArchive.shift();
      }

      // Archive features
      try {
        if (this.features?.archives?.record) {
          await this.features.archives.record(busName, event);
        }
      } catch (err) {
        this.logger.warn('EventBridge', `Falha ao arquivar evento: ${err.message}`);
      }

      // Pipes com origem em EventBridge
      try {
        if (this.features?.pipes?.onEventBridgeEvent) {
          await this.features.pipes.onEventBridgeEvent(busName, event);
        }
      } catch (err) {
        this.logger.warn('EventBridge', `Falha ao processar pipe: ${err.message}`);
      }

      // Match and deliver to rules
      await this._matchAndDeliver(busName, event);

      results.push({ EventId: eventId });
    }

    this.logger.debug('EventBridge', `PutEvents: ${Entries.length} events, ${failedEntries.length} failed`);

    return {
      FailedEntryCount: failedEntries.length,
      Entries: results
    };
  }

  /**
   * Match event to rules and deliver to targets
   * @param {string} busName
   * @param {Object} event
   */
  async _matchAndDeliver(busName, event) {
    const busRules = Array.from(this.rules.values())
      .filter(r => r.EventBusName === busName && r.State === 'ENABLED');

    for (const rule of busRules) {
      if (rule.ParsedPattern && this._matchesPattern(event, rule.ParsedPattern)) {
        const targets = this.targets.get(rule.Arn) || [];
        for (const target of targets) {
          try {
            await this._deliverToTarget(target, event, { ruleArn: rule.Arn, ruleName: rule.Name, eventBusName: busName });
          } catch (err) {
            this.logger.warn('EventBridge', `Target delivery failed: ${err.message}`);
            // DeadLetterConfig: AWS moves failed events to the DLQ SQS ARN
            const dlqArn = target.DeadLetterConfig && target.DeadLetterConfig.Arn;
            if (dlqArn && this.sqsService) {
              try { await this._deliverToSQS(dlqArn, JSON.stringify(event), { _eventbridge_dlq_original_target: target.Arn }); }
              catch (dlqErr) { this.logger.warn('EventBridge DLQ', `DLQ delivery also failed: ${dlqErr.message}`); }
            }
          }
        }
      }
    }
  }

  /**
   * Check if event matches pattern
   * @param {Object} event
   * @param {Object} pattern
   * @returns {boolean}
   */
  _matchesPattern(event, pattern) {
    // AWS EventBridge $or (array of pattern objects, match any)
    if (Array.isArray(pattern)) {
      return pattern.some(subPattern => this._matchesPattern(event, subPattern));
    }

    for (const [key, matchers] of Object.entries(pattern)) {
      if (key === '$or') {
        if (!Array.isArray(matchers)) continue;
        const orMatch = matchers.some(sub => this._matchesPattern(event, sub));
        if (!orMatch) return false;
        continue;
      }

      if (key === 'detail' && typeof matchers === 'object' && !Array.isArray(matchers)) {
        if (!this._matchesPattern(event.detail || {}, matchers)) return false;
        continue;
      }

      const eventValue = key === 'detail' ? event.detail : event[key];

      // AWS: if matcher is array and field value is also array → any element matches any matcher
      if (Array.isArray(matchers) && Array.isArray(eventValue)) {
        const arrMatch = eventValue.some(v => matchers.some(m => this._singleMatcherMatches(v, m)));
        if (!arrMatch) return false;
        continue;
      }

      if (!Array.isArray(matchers)) continue;

      const matches = matchers.some(matcher => this._singleMatcherMatches(eventValue, matcher));
      if (!matches) return false;
    }
    return true;
  }

  _singleMatcherMatches(eventValue, matcher) {
    if (matcher === null) return eventValue === null;
    if (typeof matcher === 'string') {
      if (matcher.endsWith('*')) {
        const prefix = matcher.slice(0, -1);
        return eventValue != null && String(eventValue).startsWith(prefix);
      }
      if (matcher.startsWith('*')) {
        const suffix = matcher.slice(1);
        return eventValue != null && String(eventValue).endsWith(suffix);
      }
      return eventValue === matcher;
    }
    if (typeof matcher === 'object') {
      if (matcher.prefix) return String(eventValue).startsWith(matcher.prefix);
      if (matcher.suffix) return String(eventValue).endsWith(matcher.suffix);
      if (matcher.wildcard) {
        const wc = matcher.wildcard;
        let regex = '^';
        for (let i = 0; i < wc.length; i++) {
          const c = wc[i];
          if (c === '*') regex += '.*';
          else if (c === '?') regex += '.';
          else regex += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        regex += '$';
        try { return new RegExp(regex).test(String(eventValue)); } catch (_e) { return false; }
      }
      if (matcher['anything-but']) {
        const forbidden = matcher['anything-but'];
        if (Array.isArray(forbidden)) return !forbidden.includes(eventValue);
        return eventValue !== forbidden;
      }
      if (matcher.exists !== undefined) {
        return matcher.exists ? eventValue !== undefined : eventValue === undefined;
      }
      if (matcher.numeric) return this._checkNumeric(parseFloat(eventValue), matcher.numeric);
      if (matcher.ctype === 'string') return typeof eventValue === 'string';
    }
    return false;
  }

  /**
   * Check numeric conditions
   * @param {number} value
   * @param {Array} conditions
   * @returns {boolean}
   */
  _checkNumeric(value, conditions) {
    for (let i = 0; i < conditions.length; i += 2) {
      const op = conditions[i];
      const threshold = conditions[i + 1];
      if (op === '=' && value !== threshold) return false;
      if (op === '>' && value <= threshold) return false;
      if (op === '>=' && value < threshold) return false;
      if (op === '<' && value >= threshold) return false;
      if (op === '<=' && value > threshold) return false;
    }
    return true;
  }

  /**
   * Resolve SQS ARN or URL → SQS QueueUrl (formato aceito pelo SQS simulator)
   */
  _resolveSqsQueueUrl(arnOrUrlOrName) {
    if (!arnOrUrlOrName) return null;
    const sqs = this.sqsService && this.sqsService.simulator;
    if (!sqs) return null;

    if (typeof arnOrUrlOrName !== 'string') return null;
    if (/^https?:\/\//i.test(arnOrUrlOrName) || arnOrUrlOrName.includes('/queue/')) {
      return arnOrUrlOrName;
    }
    let name = arnOrUrlOrName;
    const arnMatch = arnOrUrlOrName.match(/:queue:([^:]+)$|:sqs:[^:]*:[^:]*:([^:/]+)/);
    if (arnMatch) name = arnMatch[1] || arnMatch[2];

    const q = sqs.queues && sqs.queues.get(name);
    return (q && q.url) || (sqs.endpoint ? `${sqs.endpoint}/queue/${name}` : null);
  }

  /**
   * Deliver directly to SQS with ARN/URL resolution + AWS-style MessageAttributes
   */
  async _deliverToSQS(queueArnOrUrl, messageBody, extraAttributes = {}) {
    if (!this.sqsService) throw new Error('SQS service not available');
    const sqs = this.sqsService.simulator;
    const queueUrl = this._resolveSqsQueueUrl(queueArnOrUrl);
    if (!queueUrl) throw new Error(`Unable to resolve SQS queue: ${queueArnOrUrl}`);

    const traceId = crypto.randomUUID();
    const MessageAttributes = {
      AWSTraceHeader: {
        DataType: 'String',
        StringValue: `Root=1-${Date.now().toString(16)}-${traceId.replace(/-/g, '')}`
      },
      ...Object.fromEntries(Object.entries(extraAttributes || {}).map(([k, v]) => [
        k,
        typeof v === 'string' ? { DataType: 'String', StringValue: v } : { DataType: 'String', StringValue: JSON.stringify(v) }
      ]))
    };

    const result = sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: messageBody,
      MessageAttributes
    });

    if (!result || result.error) throw new Error((result && result.error && result.error.message) || 'SQS sendMessage failed');
    return result;
  }

  /**
   * Deliver event to target
   * @param {Object} target
   * @param {Object} event
   * @param {Object} [ruleInfo]
   */
  async _deliverToTarget(target, event, ruleInfo) {
    // Apply Input / InputPath / InputTransformer (AWS precedence)
    let inputEvent = event;
    if (target.Input) {
      try { inputEvent = JSON.parse(target.Input); } catch { inputEvent = target.Input; }
    } else if (target.InputPath) {
      inputEvent = this._extractPath(event, target.InputPath);
    } else if (target.InputTransformer) {
      inputEvent = this._transformInput(event, target.InputTransformer, ruleInfo);
    }

    const arn = target.Arn;

    // Lambda target
    if (arn.includes(':lambda:') || arn.includes(':function:') || (arn.startsWith('arn:aws:lambda') || arn.startsWith('arn:aws-cn:lambda') || arn.startsWith('arn:aws-us-gov:lambda'))) {
      if (!this.lambdaService) throw new Error('Lambda service not available');
      let functionName = null;
      const match = arn.match(/:function:([^:/]+)/);
      if (match) {
        functionName = match[1];
      } else {
        functionName = arn;
      }
      if (!functionName) throw new Error(`Could not resolve Lambda function from ARN: ${arn}`);
      // AWS EventBridge invokes Lambda asynchronously with invocation-type=Event
      await this.lambdaService.simulator.invokeFunction(functionName, inputEvent);
      this.logger.debug('EventBridge', `Delivered to Lambda: ${functionName}`);
      return;
    }

    // SQS target
    if (arn.includes(':sqs:') || arn.includes(':queue:')) {
      const isFifo = arn.endsWith('.fifo');
      const msgBody = typeof inputEvent === 'string' ? inputEvent : JSON.stringify(inputEvent);
      const extraAttrs = {};
      if (ruleInfo && ruleInfo.ruleArn) extraAttrs['EventBridgeRuleArn'] = ruleInfo.ruleArn;
      const sendParams = {
        QueueUrl: this._resolveSqsQueueUrl(arn) || arn,
        MessageBody: msgBody
      };
      if (isFifo) {
        sendParams.MessageGroupId = target.MessageGroupId || `${ruleInfo ? ruleInfo.ruleArn : 'eventbridge'}-${target.Id || 'tgt'}`;
        if (target.Id) extraAttrs['TargetId'] = target.Id;
      }
      const result = await this._deliverToSQS(sendParams.QueueUrl, sendParams.MessageBody, extraAttrs);
      this.logger.debug('EventBridge', `Delivered to SQS: ${arn}`);
      return;
    }

    // SNS target
    if (arn.includes(':sns:')) {
      if (!this.snsService) throw new Error('SNS service not available');
      const message = typeof inputEvent === 'string' ? inputEvent : JSON.stringify(inputEvent);
      const traceId = crypto.randomUUID();
      const attrs = {
        AWSTraceHeader: { DataType: 'String', StringValue: traceId }
      };
      if (ruleInfo && ruleInfo.ruleArn) {
        attrs['EventBridgeRuleArn'] = { DataType: 'String', StringValue: ruleInfo.ruleArn };
      }
      const result = await this.snsService.simulator.publish({
        TopicArn: arn,
        Message: message,
        MessageAttributes: attrs
      });
      if (!result || (result && result.error)) {
        throw new Error((result && result.error && result.error.message) || 'SNS publish failed');
      }
      this.logger.debug('EventBridge', `Delivered to SNS: ${arn}`);
      return;
    }

    // API destination target
    if (arn.includes(':api-destination/')) {
      if (!this.features?.integrations?.deliverApiDestination) {
        throw new Error('Integrations service not available');
      }
      const payload = typeof inputEvent === 'string' ? inputEvent : JSON.stringify(inputEvent);
      await this.features.integrations.deliverApiDestination(arn, payload, target.HttpParameters);
      this.logger.debug('EventBridge', `Delivered to API destination: ${arn}`);
      return;
    }

    // EventBridge event bus target
    if (arn.includes(':event-bus/')) {
      const busName = String(arn).split(':event-bus/')[1];
      if (!this.buses.has(busName)) throw new Error(`Event bus not found: ${busName}`);
      const detail = typeof inputEvent === 'string' ? inputEvent : JSON.stringify(inputEvent);
      await this.putEvents({
        Entries: [{
          EventBusName: busName,
          Source: ruleInfo?.ruleName ? `aws.events.rule.${ruleInfo.ruleName}` : 'aws.events',
          DetailType: 'EventBridge Target',
          Detail: detail
        }]
      });
      this.logger.debug('EventBridge', `Delivered to event bus: ${busName}`);
      return;
    }

    this.logger.warn('EventBridge', `Unsupported target ARN: ${arn}`);
    throw new Error(`Unsupported target type for ARN: ${arn}`);
  }

  /**
   * Extract value at JSONPath
   * @param {Object} obj
   * @param {string} path
   * @returns {*}
   */
  _extractPath(obj, path) {
    if (!path) return obj;
    if (path === '$') return obj;
    const cleaned = path.replace(/^\$\.?/, '');
    if (!cleaned) return obj;

    // Tokenize: suporta dotted keys e bracket array notation como resources[0], [0]
    const tokens = [];
    let buf = '';
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (c === '.') {
        if (buf) tokens.push({ type: 'key', value: buf });
        buf = '';
      } else if (c === '[') {
        if (buf) tokens.push({ type: 'key', value: buf });
        buf = '';
      } else if (c === ']') {
        if (buf.length > 0) {
          const n = Number(buf);
          tokens.push({ type: Number.isNaN(n) ? 'key' : 'index', value: Number.isNaN(n) ? buf : n });
        }
        buf = '';
      } else {
        buf += c;
      }
    }
    if (buf) tokens.push({ type: 'key', value: buf });

    let current = obj;
    for (const t of tokens) {
      if (current === null || current === undefined) return null;
      if (t.type === 'index') {
        if (!Array.isArray(current)) return null;
        current = current[t.value];
      } else {
        current = current[t.value];
      }
    }
    return current;
  }

  /**
   * Transform input using InputTransformer (AWS style)
   * @param {Object} event
   * @param {Object} transformer
   * @param {Object} [ruleInfo] optional rule info for <aws.events.rule-arn>, etc.
   * @returns {*}
   */
  _transformInput(event, transformer, ruleInfo) {
    const { InputPathsMap, InputTemplate } = transformer;
    if (!InputTemplate) return event;
    let result = String(InputTemplate);

    // AWS reserved placeholders
    const reserved = {
      'aws.events.event': JSON.stringify(event),
      'aws.events.event.json': JSON.stringify(event),
      'aws.events.rule-arn': (ruleInfo && ruleInfo.ruleArn) || '',
      'aws.events.rule-name': (ruleInfo && ruleInfo.ruleName) || '',
      'aws.events.eventbus-name': (ruleInfo && ruleInfo.eventBusName) || ''
    };
    for (const [k, v] of Object.entries(reserved)) {
      result = result.split(`<${k}>`).join(typeof v === 'string' ? v : JSON.stringify(v));
    }

    if (InputPathsMap && typeof InputPathsMap === 'object') {
      for (const [key, path] of Object.entries(InputPathsMap)) {
        const value = this._extractPath(event, path);
        const safeValue = typeof value === 'string' ? value : JSON.stringify(value);
        result = result.split(`<${key}>`).join(safeValue);
      }
    }

    try { return JSON.parse(result); } catch { return result; }
  }

  /**
   * Reset all data
   */
  async reset() {
    this.buses.clear();
    this.rules.clear();
    this.targets.clear();
    this.eventArchive = [];
    this._createDefaultBus();

    try {
      if (this.features?.archives?.reset) await this.features.archives.reset();
    } catch {}
    try {
      if (this.features?.pipes?.reset) await this.features.pipes.reset();
    } catch {}
    try {
      if (this.features?.scheduler?.reset) await this.features.scheduler.reset();
    } catch {}
    try {
      if (this.features?.integrations?.reset) await this.features.integrations.reset();
    } catch {}
    try {
      if (this.features?.schemas?.reset) await this.features.schemas.reset();
    } catch {}
    try {
      if (this.features?.globalEndpoints?.reset) await this.features.globalEndpoints.reset();
    } catch {}

    await this._save();
    this.logger.info('EventBridge', 'Data reset');
  }

  /**
   * Create AWS-formatted error
   * @param {string} code
   * @param {string} message
   * @returns {Error}
   */
  _error(code, message) {
    const err = new Error(message);
    err.code = code;
    err.__type = code;
    return err;
  }
}

module.exports = { EventBridgeSimulator };
