/**
 * @fileoverview EventBridge Scheduler (versão nova).
 *
 * Schedules e ScheduleGroups com execução real via timer. Suporta
 * rate/at/cron, targets Lambda/SQS/SNS/EventBridge/Pipe-compat e
 * API destinations.
 */

'use strict';

const {
  nowIso, buildArn, awsError, normalizeTags, paginate, clone,
} = require('./shared');
const { parseScheduleExpression, nextOccurrence } = require('./schedule-expression');

const CHECK_INTERVAL_MS = 1000;
const DEAD_LETTER_ATTRIBUTE = 'EventBridgeSchedulerDlq';

class SchedulerFeature {
  /** @param {Object} simulator */
  constructor(simulator) {
    this.simulator = simulator;
    this.store = simulator.store;
    this.logger = simulator.logger;
    /** @type {Map<string, Object>} */
    this.groups = new Map();
    /** @type {Map<string, Object>} */
    this.schedules = new Map();
    this.timer = null;
    this.stopped = false;
  }

  async load() {
    const groups = await this.store.read('eventbridge/scheduler-groups');
    if (Array.isArray(groups)) {
      for (const group of groups) {
        if (group && group.Name) this.groups.set(group.Name, group);
      }
    }

    const schedules = await this.store.read('eventbridge/schedules');
    if (Array.isArray(schedules)) {
      for (const schedule of schedules) {
        if (!schedule || !schedule.Name) continue;
        if (schedule.State === 'ENABLED') {
          this._ensureNext(schedule);
        }
        this.schedules.set(schedule.Name, schedule);
      }
    }
  }

  async save() {
    await this.store.write('eventbridge/scheduler-groups', null, Array.from(this.groups.values()));
    await this.store.write('eventbridge/schedules', null, Array.from(this.schedules.values()));
  }

  async reset() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.groups.clear();
    this.schedules.clear();
  }

  /** Inicia o loop de execução do scheduler. */
  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
    this.logger.debug('EventBridge', 'Scheduler iniciado');
  }

  /** Para o loop de execução do scheduler. */
  stop() {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _ensureNext(schedule) {
    try {
      schedule.Parsed = parseScheduleExpression(schedule.ScheduleExpression);
      const next = nextOccurrence(schedule.Parsed, new Date());
      schedule.NextInvocationTime = next ? next.toISOString() : null;
    } catch (err) {
      schedule.NextInvocationTime = null;
      schedule.State = 'DISABLED';
      schedule.StateReason = err.message;
    }
  }

  async _tick() {
    if (this.stopped) return;
    const now = Date.now();

    for (const schedule of this.schedules.values()) {
      if (schedule.State !== 'ENABLED') continue;
      if (!schedule.NextInvocationTime) {
        this._ensureNext(schedule);
        continue;
      }

      const next = new Date(schedule.NextInvocationTime).getTime();
      if (Number.isNaN(next) || next > now) continue;

      // Garante no máximo uma execução por tick.
      if (schedule._executing) continue;
      schedule._executing = true;

      try {
        await this._execute(schedule);
      } catch (err) {
        this.logger.warn('EventBridge', `Scheduler ${schedule.Name} falhou: ${err.message}`);
      } finally {
        schedule._executing = false;
      }

      this._advance(schedule);
      await this.save();
    }
  }

  async _execute(schedule) {
    const target = schedule.Target || {};
    const arn = target.Arn;
    if (!arn) throw new Error('Target.Arn não informado');

    let payload = target.Input || null;
    if (payload && typeof payload === 'object') payload = JSON.stringify(payload);
    if (payload === null) payload = JSON.stringify({ scheduleName: schedule.Name });

    // API destination
    if (String(arn).includes(':api-destination/')) {
      return this.simulator.features.integrations.deliverApiDestination(arn, payload, target.HttpParameters);
    }

    // EventBridge bus
    if (String(arn).includes(':event-bus/')) {
      const busName = String(arn).split(':event-bus/')[1];
      await this.simulator.putEvents({
        Entries: [{
          EventBusName: busName,
          Source: schedule.Source || 'aws.scheduler',
          DetailType: schedule.DetailType || 'Scheduled Event',
          Detail: payload,
        }],
      });
      return;
    }

    // Lambda / SQS / SNS
    const ruleInfo = { ruleArn: schedule.Arn, ruleName: schedule.Name, eventBusName: 'default' };
    let inputEvent = payload;
    try {
      inputEvent = JSON.parse(payload);
    } catch {
      inputEvent = payload;
    }
    await this.simulator._deliverToTarget({ Id: schedule.Name, Arn: arn }, inputEvent, ruleInfo);
  }

  _advance(schedule) {
    if (schedule.ActionAfterCompletion === 'DELETE') {
      this.schedules.delete(schedule.Name);
      return;
    }

    if (schedule.ScheduleExpression && schedule.ScheduleExpression.toLowerCase().startsWith('at(')) {
      schedule.State = 'DISABLED';
      schedule.NextInvocationTime = null;
      return;
    }

    if (schedule.Parsed) {
      const next = nextOccurrence(schedule.Parsed, new Date());
      schedule.NextInvocationTime = next ? next.toISOString() : null;
      if (!next) {
        schedule.State = 'DISABLED';
        schedule.StateReason = 'Nenhuma execução futura';
      }
    }
  }

  // ==================== Schedule Groups ====================

  async createScheduleGroup(params = {}) {
    const { Name, Tags } = params;
    if (!Name) throw awsError('ValidationException', 'Name é obrigatório');
    if (this.groups.has(Name)) {
      throw awsError('ResourceAlreadyExistsException', `Schedule group ${Name} já existe`);
    }

    const group = {
      Name,
      Arn: buildArn(this.simulator, 'scheduler', `schedule-group/${Name}`),
      State: 'ACTIVE',
      Tags: normalizeTags(Tags),
      CreationTime: nowIso(),
    };
    this.groups.set(Name, group);
    await this.save();
    this.logger.info('EventBridge', `Schedule group criado: ${Name}`);
    return { ScheduleGroupArn: group.Arn, State: group.State, CreationTime: group.CreationTime };
  }

  async deleteScheduleGroup(params = {}) {
    const group = this._findGroup(params.Name);
    if (!group) throw awsError('ResourceNotFoundException', `Schedule group não encontrado: ${params.Name}`);
    const inUse = Array.from(this.schedules.values()).some((schedule) => schedule.ScheduleGroupName === group.Name);
    if (inUse) throw awsError('ResourceInUseException', `Schedule group ${group.Name} possui schedules ativos`);
    this.groups.delete(group.Name);
    await this.save();
    return {};
  }

  getScheduleGroup(params = {}) {
    const group = this._findGroup(params.Name);
    if (!group) throw awsError('ResourceNotFoundException', `Schedule group não encontrado: ${params.Name}`);
    return { ...group };
  }

  listScheduleGroups(params = {}) {
    let groups = Array.from(this.groups.values());
    if (params.NamePrefix) groups = groups.filter((group) => group.Name.startsWith(params.NamePrefix));
    const list = groups.map((group) => ({ ...group }));
    return paginate(list, params, 'ScheduleGroups');
  }

  _findGroup(nameOrArn) {
    if (!nameOrArn) return null;
    if (this.groups.has(nameOrArn)) return this.groups.get(nameOrArn);
    if (nameOrArn === 'default') return this._ensureDefaultGroup();
    return Array.from(this.groups.values()).find((group) => group.Arn === nameOrArn) || null;
  }

  _ensureDefaultGroup() {
    if (!this.groups.has('default')) {
      this.groups.set('default', {
        Name: 'default',
        Arn: buildArn(this.simulator, 'scheduler', 'schedule-group/default'),
        State: 'ACTIVE',
        Tags: [],
        CreationTime: nowIso(),
      });
    }
    return this.groups.get('default');
  }

  // ==================== Schedules ====================

  async createSchedule(params = {}) {
    const {
      Name, GroupName = 'default', ScheduleExpression, ScheduleExpressionTimezone = 'UTC',
      FlexibleTimeWindow, Target, State = 'ENABLED', Description,
      StartDate, EndDate, ActionAfterCompletion, Input, Arn, RoleArn,
    } = params;

    if (!Name) throw awsError('ValidationException', 'Name é obrigatório');
    if (!ScheduleExpression) throw awsError('ValidationException', 'ScheduleExpression é obrigatório');
    const targetArn = (Target && Target.Arn) || Arn;
    if (!targetArn) throw awsError('ValidationException', 'Target.Arn é obrigatório');
    if (this.schedules.has(Name)) {
      throw awsError('ResourceAlreadyExistsException', `Schedule ${Name} já existe`);
    }

    this._findGroup(GroupName) || this._ensureDefaultGroup();

    const schedule = {
      Name,
      Arn: buildArn(this.simulator, 'scheduler', `schedule/${Name}`),
      ScheduleGroupName: GroupName,
      ScheduleExpression,
      ScheduleExpressionTimezone,
      FlexibleTimeWindow: FlexibleTimeWindow || { Mode: 'OFF' },
      Target: Target || { Arn: targetArn, Input: Input },
      State,
      Description: Description || '',
      StartDate: StartDate ? new Date(StartDate).toISOString() : null,
      EndDate: EndDate ? new Date(EndDate).toISOString() : null,
      ActionAfterCompletion: ActionAfterCompletion || 'NONE',
      RoleArn: RoleArn || null,
      Tags: normalizeTags(params.Tags),
      CreationTime: nowIso(),
      LastModificationTime: nowIso(),
      NextInvocationTime: null,
      Parsed: null,
    };

    try {
      schedule.Parsed = parseScheduleExpression(ScheduleExpression);
    } catch (err) {
      schedule.State = 'DISABLED';
      schedule.StateReason = err.message;
    }

    if (schedule.State === 'ENABLED') {
      const next = nextOccurrence(schedule.Parsed, new Date());
      schedule.NextInvocationTime = next ? next.toISOString() : null;
      if (!next) {
        schedule.State = 'DISABLED';
        schedule.StateReason = 'Nenhuma execução futura';
      }
    }

    this.schedules.set(Name, schedule);
    await this.save();
    this.logger.info('EventBridge', `Schedule criado: ${Name} (${ScheduleExpression})`);
    return {
      ScheduleArn: schedule.Arn,
      ScheduleGroupName: schedule.ScheduleGroupName,
      State: schedule.State,
      CreationTime: schedule.CreationTime,
    };
  }

  async updateSchedule(params = {}) {
    const schedule = this._findSchedule(params.Name);
    if (!schedule) throw awsError('ResourceNotFoundException', `Schedule não encontrado: ${params.Name}`);

    if (params.ScheduleExpression !== undefined) {
      schedule.ScheduleExpression = params.ScheduleExpression;
      try {
        schedule.Parsed = parseScheduleExpression(params.ScheduleExpression);
      } catch (err) {
        schedule.State = 'DISABLED';
        schedule.StateReason = err.message;
      }
    }
    if (params.Target !== undefined) schedule.Target = params.Target;
    if (params.State !== undefined) schedule.State = params.State;
    if (params.Description !== undefined) schedule.Description = params.Description;
    if (params.ScheduleExpressionTimezone !== undefined) schedule.ScheduleExpressionTimezone = params.ScheduleExpressionTimezone;
    if (params.FlexibleTimeWindow !== undefined) schedule.FlexibleTimeWindow = params.FlexibleTimeWindow;
    if (params.ActionAfterCompletion !== undefined) schedule.ActionAfterCompletion = params.ActionAfterCompletion;

    schedule.LastModificationTime = nowIso();

    if (schedule.State === 'ENABLED') {
      const next = nextOccurrence(schedule.Parsed, new Date());
      schedule.NextInvocationTime = next ? next.toISOString() : null;
    } else {
      schedule.NextInvocationTime = null;
    }

    await this.save();
    return {
      ScheduleArn: schedule.Arn,
      ScheduleGroupName: schedule.ScheduleGroupName,
      LastModificationTime: schedule.LastModificationTime,
    };
  }

  async deleteSchedule(params = {}) {
    const schedule = this._findSchedule(params.Name);
    if (!schedule) throw awsError('ResourceNotFoundException', `Schedule não encontrado: ${params.Name}`);
    this.schedules.delete(schedule.Name);
    await this.save();
    return {};
  }

  getSchedule(params = {}) {
    const schedule = this._findSchedule(params.Name);
    if (!schedule) throw awsError('ResourceNotFoundException', `Schedule não encontrado: ${params.Name}`);
    return clone(schedule);
  }

  listSchedules(params = {}) {
    let schedules = Array.from(this.schedules.values());
    if (params.GroupName && params.GroupName !== 'default') {
      schedules = schedules.filter((schedule) => schedule.ScheduleGroupName === params.GroupName);
    } else if (params.GroupName === 'default') {
      schedules = schedules.filter((schedule) => schedule.ScheduleGroupName === 'default');
    }
    if (params.NamePrefix) {
      schedules = schedules.filter((schedule) => schedule.Name.startsWith(params.NamePrefix));
    }
    if (params.State) {
      schedules = schedules.filter((schedule) => schedule.State === params.State);
    }
    const list = schedules.map((schedule) => ({
      Name: schedule.Name,
      Arn: schedule.Arn,
      ScheduleGroupName: schedule.ScheduleGroupName,
      ScheduleExpression: schedule.ScheduleExpression,
      State: schedule.State,
      Target: schedule.Target,
      CreationTime: schedule.CreationTime,
      LastModificationTime: schedule.LastModificationTime,
      NextInvocationTime: schedule.NextInvocationTime,
    }));
    return paginate(list, params, 'Schedules');
  }

  _findSchedule(nameOrArn) {
    if (!nameOrArn) return null;
    if (this.schedules.has(nameOrArn)) return this.schedules.get(nameOrArn);
    return Array.from(this.schedules.values()).find((schedule) => schedule.Arn === nameOrArn) || null;
  }

  getStats() {
    const enabled = Array.from(this.schedules.values()).filter((schedule) => schedule.State === 'ENABLED').length;
    return {
      scheduleGroups: this.groups.size,
      schedules: this.schedules.size,
      enabledSchedules: enabled,
    };
  }
}

module.exports = { SchedulerFeature };
