/**
 * @fileoverview EventBridge Simulator
 * Simula o Amazon EventBridge com event buses, rules e targets
 */

'use strict';

const crypto = require('crypto');

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
        rules.forEach(r => this.rules.set(r.Arn, r));
      }
      const targets = await this.store.read('eventbridge/targets');
      if (Array.isArray(targets)) {
        targets.forEach(({ ruleArn, list }) => this.targets.set(ruleArn, list));
      }
      this.logger.debug('EventBridge', `Loaded ${this.buses.size} buses, ${this.rules.size} rules`);
    } catch {
      this.logger.debug('EventBridge', 'No persisted data, starting fresh');
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
        DeadLetterConfig: target.DeadLetterConfig || null
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
      this.eventArchive.push(event);
      if (this.eventArchive.length > 1000) {
        this.eventArchive.shift();
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
            await this._deliverToTarget(target, event);
          } catch (err) {
            this.logger.warn('EventBridge', `Target delivery failed: ${err.message}`);
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
    for (const [key, matchers] of Object.entries(pattern)) {
      const eventValue = key === 'detail' ? event.detail : event[key];

      if (key === 'detail' && typeof matchers === 'object' && !Array.isArray(matchers)) {
        // Recursive detail matching
        if (!this._matchesPattern(event.detail || {}, matchers)) return false;
        continue;
      }

      if (!Array.isArray(matchers)) continue;

      const matches = matchers.some(matcher => {
        if (matcher === null) return eventValue === null;
        if (typeof matcher === 'string') return eventValue === matcher;
        if (typeof matcher === 'object') {
          if (matcher.prefix) return String(eventValue).startsWith(matcher.prefix);
          if (matcher['anything-but']) {
            return !matcher['anything-but'].includes(eventValue);
          }
          if (matcher.exists !== undefined) {
            return matcher.exists ? eventValue !== undefined : eventValue === undefined;
          }
          if (matcher.numeric) return this._checkNumeric(parseFloat(eventValue), matcher.numeric);
        }
        return false;
      });

      if (!matches) return false;
    }
    return true;
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
   * Deliver event to target
   * @param {Object} target
   * @param {Object} event
   */
  async _deliverToTarget(target, event) {
    // Transform input
    let inputEvent = event;
    if (target.Input) {
      try { inputEvent = JSON.parse(target.Input); } catch { inputEvent = target.Input; }
    } else if (target.InputPath) {
      inputEvent = this._extractPath(event, target.InputPath);
    } else if (target.InputTransformer) {
      inputEvent = this._transformInput(event, target.InputTransformer);
    }

    const arn = target.Arn;

    // Lambda target
    if (arn.includes(':lambda:') || arn.includes('function:')) {
      if (!this.lambdaService) return;
      const match = arn.match(/function:([^:]+)/);
      if (!match) return;
      await this.lambdaService.simulator.invokeFunction(match[1], inputEvent);
      this.logger.debug('EventBridge', `Delivered to Lambda: ${match[1]}`);
      return;
    }

    // SQS target
    if (arn.includes(':sqs:') || arn.includes(':queue:')) {
      if (!this.sqsService) return;
      await this.sqsService.simulator.sendMessage({
        QueueUrl: arn,
        MessageBody: JSON.stringify(inputEvent)
      });
      this.logger.debug('EventBridge', `Delivered to SQS: ${arn}`);
      return;
    }

    // SNS target
    if (arn.includes(':sns:')) {
      if (!this.snsService) return;
      await this.snsService.simulator.publish({
        TopicArn: arn,
        Message: JSON.stringify(inputEvent)
      });
      this.logger.debug('EventBridge', `Delivered to SNS: ${arn}`);
      return;
    }

    this.logger.warn('EventBridge', `Unsupported target ARN: ${arn}`);
  }

  /**
   * Extract value at JSONPath
   * @param {Object} obj
   * @param {string} path
   * @returns {*}
   */
  _extractPath(obj, path) {
    if (path === '$') return obj;
    const parts = path.replace(/^\$\./, '').split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return null;
      current = current[part];
    }
    return current;
  }

  /**
   * Transform input using InputTransformer
   * @param {Object} event
   * @param {Object} transformer
   * @returns {*}
   */
  _transformInput(event, transformer) {
    const { InputPathsMap, InputTemplate } = transformer;
    let result = InputTemplate;

    if (InputPathsMap && InputTemplate) {
      for (const [key, path] of Object.entries(InputPathsMap)) {
        const value = this._extractPath(event, path);
        result = result.replace(new RegExp(`<${key}>`, 'g'), JSON.stringify(value));
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
