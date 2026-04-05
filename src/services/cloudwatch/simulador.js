'use strict';

/**
 * @fileoverview CloudWatch Simulator
 *
 * Suporta:
 *  Logs:
 *   - CreateLogGroup / DeleteLogGroup / DescribeLogGroups
 *   - CreateLogStream / DeleteLogStream / DescribeLogStreams
 *   - PutLogEvents / GetLogEvents / FilterLogEvents
 *   - PutRetentionPolicy / DeleteRetentionPolicy
 *   - PutSubscriptionFilter / DeleteSubscriptionFilter / DescribeSubscriptionFilters
 *   - Integração com Lambda (recebe logs automaticamente)
 *
 *  Metrics:
 *   - PutMetricData
 *   - GetMetricStatistics
 *   - ListMetrics
 *
 *  Alarms:
 *   - PutMetricAlarm / DeleteAlarms / DescribeAlarms
 *   - SetAlarmState
 *   - DescribeAlarmsForMetric
 *   - Ações SNS ao mudar de estado
 *
 *  Persistência via LocalStore
 */

const { randomUUID } = require('crypto');

// ─── Erros tipados ────────────────────────────────────────────────────────────

class CloudWatchError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const Errors = {
  LogGroupNotFound: (name) =>
    new CloudWatchError('ResourceNotFoundException', `The specified log group does not exist: ${name}`, 404),
  LogStreamNotFound: (name) =>
    new CloudWatchError('ResourceNotFoundException', `The specified log stream does not exist: ${name}`, 404),
  LogGroupAlreadyExists: (name) =>
    new CloudWatchError('ResourceAlreadyExistsException', `The specified log group already exists: ${name}`, 400),
  LogStreamAlreadyExists: (name) =>
    new CloudWatchError('ResourceAlreadyExistsException', `The specified log stream already exists: ${name}`, 400),
  AlarmNotFound: (name) =>
    new CloudWatchError('ResourceNotFoundException', `Alarm [${name}] does not exist`, 404),
  InvalidParameter: (msg) =>
    new CloudWatchError('InvalidParameterValue', msg, 400),
  InvalidToken: () =>
    new CloudWatchError('InvalidParameterException', 'The specified sequence token is invalid', 400),
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const REGION = 'us-east-1';
const ACCOUNT = '000000000000';

const AlarmState = {
  OK: 'OK',
  ALARM: 'ALARM',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
};

const ComparisonOperator = {
  GreaterThanOrEqualToThreshold: 'GreaterThanOrEqualToThreshold',
  GreaterThanThreshold: 'GreaterThanThreshold',
  LessThanThreshold: 'LessThanThreshold',
  LessThanOrEqualToThreshold: 'LessThanOrEqualToThreshold',
};

const Statistic = {
  SampleCount: 'SampleCount',
  Average: 'Average',
  Sum: 'Sum',
  Minimum: 'Minimum',
  Maximum: 'Maximum',
};

// ─── Utilitários ─────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function logGroupArn(name) {
  return `arn:aws:logs:${REGION}:${ACCOUNT}:log-group:${name}`;
}

function logStreamArn(groupName, streamName) {
  return `arn:aws:logs:${REGION}:${ACCOUNT}:log-group:${groupName}:log-stream:${streamName}`;
}

function alarmArn(name) {
  return `arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:${name}`;
}

// ─── CloudWatch Simulator ─────────────────────────────────────────────────────

class CloudWatchSimulator {
  /**
   * @param {Object} config - Global config
   * @param {Object} store  - LocalStore
   * @param {Object} logger - Logger
   */
  constructor(config, store, logger) {
    this.config = config;
    this.store = store;
    this.logger = logger;

    // Logs
    /** @type {Map<string, Object>} name -> logGroup */
    this.logGroups = new Map();
    /** @type {Map<string, Map<string, Object>>} groupName -> streamName -> logStream */
    this.logStreams = new Map();
    /** @type {Map<string, Array>} `groupName/streamName` -> events[] */
    this.logEvents = new Map();
    /** @type {Map<string, Array>} groupName -> subscriptionFilters[] */
    this.subscriptionFilters = new Map();

    // Metrics
    /** @type {Array} all metric data points */
    this.metricData = [];

    // Alarms
    /** @type {Map<string, Object>} name -> alarm */
    this.alarms = new Map();

    // Referência ao simulador de SNS (injetado depois)
    this.snsSimulator = null;
    this.lambdaSimulator = null;

    // Config CloudWatch
    this.cwConfig = config?.cloudwatch || {};
    this.retentionDefault = this.cwConfig.retentionInDays || 7;
    this.lambdaLogGroup = this.cwConfig.lambdaLogGroup || '/aws/lambda';
  }

  // ─── Persistência ─────────────────────────────────────────────────────────

  async load() {
    try {
      const data = await this.store.load('cloudwatch');
      if (data) {
        if (data.logGroups) {
          this.logGroups = new Map(Object.entries(data.logGroups));
        }
        if (data.logStreams) {
          this.logStreams = new Map(
            Object.entries(data.logStreams).map(([g, streams]) => [
              g,
              new Map(Object.entries(streams)),
            ])
          );
        }
        if (data.logEvents) {
          this.logEvents = new Map(Object.entries(data.logEvents));
        }
        if (data.subscriptionFilters) {
          this.subscriptionFilters = new Map(Object.entries(data.subscriptionFilters));
        }
        if (data.metricData) {
          this.metricData = data.metricData;
        }
        if (data.alarms) {
          this.alarms = new Map(Object.entries(data.alarms));
        }
        this.logger.info('[CloudWatch] Data loaded from store');
      }
    } catch (err) {
      this.logger.warn('[CloudWatch] No persisted data found, starting fresh');
    }
  }

  async save() {
    try {
      const logStreamsObj = {};
      for (const [g, streams] of this.logStreams.entries()) {
        logStreamsObj[g] = Object.fromEntries(streams);
      }

      const data = {
        logGroups: Object.fromEntries(this.logGroups),
        logStreams: logStreamsObj,
        logEvents: Object.fromEntries(this.logEvents),
        subscriptionFilters: Object.fromEntries(this.subscriptionFilters),
        metricData: this.metricData,
        alarms: Object.fromEntries(this.alarms),
      };
      await this.store.save('cloudwatch', data);
    } catch (err) {
      this.logger.error('[CloudWatch] Failed to persist data:', err.message);
    }
  }

  reset() {
    this.logGroups.clear();
    this.logStreams.clear();
    this.logEvents.clear();
    this.subscriptionFilters.clear();
    this.metricData = [];
    this.alarms.clear();
    this.logger.info('[CloudWatch] State reset');
  }

  // ─── Log Groups ───────────────────────────────────────────────────────────

  /**
   * CreateLogGroup
   */
  createLogGroup({ logGroupName, retentionInDays, tags }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (this.logGroups.has(logGroupName)) throw Errors.LogGroupAlreadyExists(logGroupName);

    const group = {
      logGroupName,
      arn: logGroupArn(logGroupName),
      creationTime: nowMs(),
      retentionInDays: retentionInDays || this.retentionDefault,
      metricFilterCount: 0,
      storedBytes: 0,
      tags: tags || {},
    };

    this.logGroups.set(logGroupName, group);
    this.logStreams.set(logGroupName, new Map());
    this.subscriptionFilters.set(logGroupName, []);

    this.logger.info(`[CloudWatch] Log group created: ${logGroupName}`);
    this.save();
    return group;
  }

  /**
   * DeleteLogGroup
   */
  deleteLogGroup({ logGroupName }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!this.logGroups.has(logGroupName)) throw Errors.LogGroupNotFound(logGroupName);

    this.logGroups.delete(logGroupName);

    // Remove streams and events
    const streams = this.logStreams.get(logGroupName);
    if (streams) {
      for (const streamName of streams.keys()) {
        this.logEvents.delete(`${logGroupName}/${streamName}`);
      }
    }
    this.logStreams.delete(logGroupName);
    this.subscriptionFilters.delete(logGroupName);

    this.logger.info(`[CloudWatch] Log group deleted: ${logGroupName}`);
    this.save();
  }

  /**
   * DescribeLogGroups
   */
  describeLogGroups({ logGroupNamePrefix, logGroupNamePattern, limit = 50, nextToken } = {}) {
    let groups = [...this.logGroups.values()];

    if (logGroupNamePrefix) {
      groups = groups.filter(g => g.logGroupName.startsWith(logGroupNamePrefix));
    }
    if (logGroupNamePattern) {
      const re = new RegExp(logGroupNamePattern);
      groups = groups.filter(g => re.test(g.logGroupName));
    }

    // Pagination
    let startIdx = 0;
    if (nextToken) {
      startIdx = parseInt(nextToken, 10) || 0;
    }
    const page = groups.slice(startIdx, startIdx + limit);
    const newNextToken = startIdx + limit < groups.length ? String(startIdx + limit) : null;

    return { logGroups: page, nextToken: newNextToken };
  }

  /**
   * PutRetentionPolicy
   */
  putRetentionPolicy({ logGroupName, retentionInDays }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    const group = this.logGroups.get(logGroupName);
    if (!group) throw Errors.LogGroupNotFound(logGroupName);

    group.retentionInDays = retentionInDays;
    this.logger.info(`[CloudWatch] Retention policy set: ${logGroupName} = ${retentionInDays} days`);
    this.save();
  }

  /**
   * DeleteRetentionPolicy
   */
  deleteRetentionPolicy({ logGroupName }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    const group = this.logGroups.get(logGroupName);
    if (!group) throw Errors.LogGroupNotFound(logGroupName);

    delete group.retentionInDays;
    this.logger.info(`[CloudWatch] Retention policy deleted: ${logGroupName}`);
    this.save();
  }

  // ─── Log Streams ──────────────────────────────────────────────────────────

  /**
   * CreateLogStream
   */
  createLogStream({ logGroupName, logStreamName }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!logStreamName) throw Errors.InvalidParameter('logStreamName is required');
    if (!this.logGroups.has(logGroupName)) throw Errors.LogGroupNotFound(logGroupName);

    const streams = this.logStreams.get(logGroupName);
    if (streams.has(logStreamName)) throw Errors.LogStreamAlreadyExists(logStreamName);

    const stream = {
      logStreamName,
      arn: logStreamArn(logGroupName, logStreamName),
      creationTime: nowMs(),
      firstEventTimestamp: null,
      lastEventTimestamp: null,
      lastIngestionTime: null,
      uploadSequenceToken: '1',
      storedBytes: 0,
    };

    streams.set(logStreamName, stream);
    this.logEvents.set(`${logGroupName}/${logStreamName}`, []);

    this.logger.info(`[CloudWatch] Log stream created: ${logGroupName}/${logStreamName}`);
    this.save();
    return stream;
  }

  /**
   * DeleteLogStream
   */
  deleteLogStream({ logGroupName, logStreamName }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!logStreamName) throw Errors.InvalidParameter('logStreamName is required');
    if (!this.logGroups.has(logGroupName)) throw Errors.LogGroupNotFound(logGroupName);

    const streams = this.logStreams.get(logGroupName);
    if (!streams || !streams.has(logStreamName)) throw Errors.LogStreamNotFound(logStreamName);

    streams.delete(logStreamName);
    this.logEvents.delete(`${logGroupName}/${logStreamName}`);

    this.logger.info(`[CloudWatch] Log stream deleted: ${logGroupName}/${logStreamName}`);
    this.save();
  }

  /**
   * DescribeLogStreams
   */
  describeLogStreams({ logGroupName, logStreamNamePrefix, orderBy = 'LogStreamName', descending = false, limit = 50, nextToken } = {}) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!this.logGroups.has(logGroupName)) throw Errors.LogGroupNotFound(logGroupName);

    const streams = this.logStreams.get(logGroupName);
    let result = streams ? [...streams.values()] : [];

    if (logStreamNamePrefix) {
      result = result.filter(s => s.logStreamName.startsWith(logStreamNamePrefix));
    }

    // Ordenação
    result.sort((a, b) => {
      let va, vb;
      if (orderBy === 'LastEventTime') {
        va = a.lastEventTimestamp || 0;
        vb = b.lastEventTimestamp || 0;
      } else {
        va = a.logStreamName;
        vb = b.logStreamName;
      }
      if (va < vb) return descending ? 1 : -1;
      if (va > vb) return descending ? -1 : 1;
      return 0;
    });

    // Pagination
    let startIdx = 0;
    if (nextToken) startIdx = parseInt(nextToken, 10) || 0;
    const page = result.slice(startIdx, startIdx + limit);
    const newNextToken = startIdx + limit < result.length ? String(startIdx + limit) : null;

    return { logStreams: page, nextToken: newNextToken };
  }

  // ─── Log Events ───────────────────────────────────────────────────────────

  /**
   * PutLogEvents
   */
  async putLogEvents({ logGroupName, logStreamName, logEvents, sequenceToken }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!logStreamName) throw Errors.InvalidParameter('logStreamName is required');
    if (!logEvents || !Array.isArray(logEvents)) throw Errors.InvalidParameter('logEvents must be an array');

    // Auto-create group/stream se não existirem (comportamento permissivo)
    if (!this.logGroups.has(logGroupName)) {
      this.createLogGroup({ logGroupName });
    }
    const streams = this.logStreams.get(logGroupName);
    if (!streams.has(logStreamName)) {
      this.createLogStream({ logGroupName, logStreamName });
    }

    const stream = streams.get(logStreamName);
    const key = `${logGroupName}/${logStreamName}`;
    const existing = this.logEvents.get(key) || [];

    const now = nowMs();
    const newEvents = logEvents.map(e => ({
      timestamp: e.timestamp || now,
      message: e.message || '',
      ingestionTime: now,
    }));

    // Ordena por timestamp
    newEvents.sort((a, b) => a.timestamp - b.timestamp);
    const all = [...existing, ...newEvents].sort((a, b) => a.timestamp - b.timestamp);

    // Aplica retenção (remove eventos mais antigos que retentionInDays)
    const group = this.logGroups.get(logGroupName);
    if (group && group.retentionInDays) {
      const cutoff = now - group.retentionInDays * 24 * 60 * 60 * 1000;
      const filtered = all.filter(e => e.timestamp >= cutoff);
      this.logEvents.set(key, filtered);
    } else {
      this.logEvents.set(key, all);
    }

    // Atualiza metadados do stream
    const timestamps = newEvents.map(e => e.timestamp);
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);

    if (!stream.firstEventTimestamp || minTs < stream.firstEventTimestamp) {
      stream.firstEventTimestamp = minTs;
    }
    if (!stream.lastEventTimestamp || maxTs > stream.lastEventTimestamp) {
      stream.lastEventTimestamp = maxTs;
    }
    stream.lastIngestionTime = now;
    stream.uploadSequenceToken = String(parseInt(stream.uploadSequenceToken || '0', 10) + newEvents.length);

    // Atualiza storedBytes do grupo
    const bytes = newEvents.reduce((acc, e) => acc + Buffer.byteLength(e.message, 'utf8'), 0);
    group.storedBytes = (group.storedBytes || 0) + bytes;

    this.logger.debug(`[CloudWatch] PutLogEvents: ${logGroupName}/${logStreamName} +${newEvents.length} events`);

    // Envia para subscription filters
    await this._deliverToSubscriptionFilters(logGroupName, logStreamName, newEvents);

    this.save();

    return {
      nextSequenceToken: stream.uploadSequenceToken,
      rejectedLogEventsInfo: null,
    };
  }

  /**
   * GetLogEvents
   */
  getLogEvents({ logGroupName, logStreamName, startTime, endTime, nextToken, limit = 10000, startFromHead = false }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!logStreamName) throw Errors.InvalidParameter('logStreamName is required');
    if (!this.logGroups.has(logGroupName)) throw Errors.LogGroupNotFound(logGroupName);

    const streams = this.logStreams.get(logGroupName);
    if (!streams || !streams.has(logStreamName)) throw Errors.LogStreamNotFound(logStreamName);

    const key = `${logGroupName}/${logStreamName}`;
    let events = this.logEvents.get(key) || [];

    if (startTime) events = events.filter(e => e.timestamp >= startTime);
    if (endTime) events = events.filter(e => e.timestamp <= endTime);

    if (!startFromHead) events = [...events].reverse();

    // Pagination
    let startIdx = 0;
    if (nextToken) startIdx = parseInt(nextToken, 10) || 0;
    const page = events.slice(startIdx, startIdx + limit);
    const newNextToken = startIdx + limit < events.length ? String(startIdx + limit) : null;

    return {
      events: page,
      nextForwardToken: startFromHead ? newNextToken : null,
      nextBackwardToken: !startFromHead ? newNextToken : null,
    };
  }

  /**
   * FilterLogEvents
   */
  filterLogEvents({ logGroupName, logStreamNames, startTime, endTime, filterPattern, nextToken, limit = 10000 }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!this.logGroups.has(logGroupName)) throw Errors.LogGroupNotFound(logGroupName);

    const streams = this.logStreams.get(logGroupName);
    if (!streams) return { events: [], searchedLogStreams: [], nextToken: null };

    let matchingStreams = [...streams.keys()];
    if (logStreamNames && logStreamNames.length > 0) {
      matchingStreams = matchingStreams.filter(s => logStreamNames.includes(s));
    }

    let allEvents = [];
    for (const streamName of matchingStreams) {
      const key = `${logGroupName}/${streamName}`;
      const events = (this.logEvents.get(key) || []).map(e => ({ ...e, logStreamName: streamName }));
      allEvents = allEvents.concat(events);
    }

    // Filtro por tempo
    if (startTime) allEvents = allEvents.filter(e => e.timestamp >= startTime);
    if (endTime) allEvents = allEvents.filter(e => e.timestamp <= endTime);

    // Filtro por padrão (simples — verifica se a mensagem contém o padrão)
    if (filterPattern) {
      try {
        // Suporta padrões simples: termos literais e "?" (negação)
        const terms = filterPattern.split(/\s+/);
        allEvents = allEvents.filter(e => {
          return terms.every(term => {
            if (term.startsWith('?')) {
              return true; // termo opcional
            }
            return e.message.includes(term);
          });
        });
      } catch (_) {
        // ignora padrões inválidos
      }
    }

    // Ordena por timestamp
    allEvents.sort((a, b) => a.timestamp - b.timestamp);

    // Pagination
    let startIdx = 0;
    if (nextToken) startIdx = parseInt(nextToken, 10) || 0;
    const page = allEvents.slice(startIdx, startIdx + limit);
    const newNextToken = startIdx + limit < allEvents.length ? String(startIdx + limit) : null;

    const searchedLogStreams = matchingStreams.map(s => ({
      logStreamName: s,
      searchedCompletely: true,
    }));

    return { events: page, searchedLogStreams, nextToken: newNextToken };
  }

  // ─── Subscription Filters ─────────────────────────────────────────────────

  /**
   * PutSubscriptionFilter
   */
  putSubscriptionFilter({ logGroupName, filterName, filterPattern, destinationArn, distribution }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!filterName) throw Errors.InvalidParameter('filterName is required');
    if (!destinationArn) throw Errors.InvalidParameter('destinationArn is required');
    if (!this.logGroups.has(logGroupName)) throw Errors.LogGroupNotFound(logGroupName);

    const filters = this.subscriptionFilters.get(logGroupName) || [];

    // Remove filter existente com mesmo nome
    const idx = filters.findIndex(f => f.filterName === filterName);
    if (idx !== -1) filters.splice(idx, 1);

    // Máximo 2 subscription filters por grupo
    if (filters.length >= 2) {
      throw Errors.InvalidParameter('A log group can have at most 2 subscription filters');
    }

    filters.push({
      filterName,
      filterPattern: filterPattern || '',
      destinationArn,
      distribution: distribution || 'ByLogStream',
      creationTime: nowMs(),
      logGroupName,
    });

    this.subscriptionFilters.set(logGroupName, filters);
    this.logger.info(`[CloudWatch] Subscription filter set: ${logGroupName} -> ${filterName}`);
    this.save();
  }

  /**
   * DeleteSubscriptionFilter
   */
  deleteSubscriptionFilter({ logGroupName, filterName }) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!filterName) throw Errors.InvalidParameter('filterName is required');
    if (!this.logGroups.has(logGroupName)) throw Errors.LogGroupNotFound(logGroupName);

    const filters = this.subscriptionFilters.get(logGroupName) || [];
    const idx = filters.findIndex(f => f.filterName === filterName);
    if (idx === -1) throw new CloudWatchError('ResourceNotFoundException', `Subscription filter [${filterName}] not found`, 404);

    filters.splice(idx, 1);
    this.subscriptionFilters.set(logGroupName, filters);
    this.logger.info(`[CloudWatch] Subscription filter deleted: ${logGroupName}/${filterName}`);
    this.save();
  }

  /**
   * DescribeSubscriptionFilters
   */
  describeSubscriptionFilters({ logGroupName, filterNamePrefix, limit = 50, nextToken } = {}) {
    if (!logGroupName) throw Errors.InvalidParameter('logGroupName is required');
    if (!this.logGroups.has(logGroupName)) throw Errors.LogGroupNotFound(logGroupName);

    let filters = this.subscriptionFilters.get(logGroupName) || [];
    if (filterNamePrefix) {
      filters = filters.filter(f => f.filterName.startsWith(filterNamePrefix));
    }

    let startIdx = 0;
    if (nextToken) startIdx = parseInt(nextToken, 10) || 0;
    const page = filters.slice(startIdx, startIdx + limit);
    const newNextToken = startIdx + limit < filters.length ? String(startIdx + limit) : null;

    return { subscriptionFilters: page, nextToken: newNextToken };
  }

  /**
   * Entrega eventos para subscription filters (Lambda ou SQS)
   * @private
   */
  async _deliverToSubscriptionFilters(logGroupName, logStreamName, events) {
    const filters = this.subscriptionFilters.get(logGroupName) || [];
    if (filters.length === 0) return;

    for (const filter of filters) {
      let matchedEvents = events;

      // Aplica filtro de padrão
      if (filter.filterPattern) {
        const terms = filter.filterPattern.split(/\s+/).filter(t => t && !t.startsWith('?'));
        matchedEvents = events.filter(e => terms.every(t => e.message.includes(t)));
      }

      if (matchedEvents.length === 0) continue;

      const payload = {
        awslogs: {
          data: Buffer.from(
            JSON.stringify({
              messageType: 'DATA_MESSAGE',
              owner: ACCOUNT,
              logGroup: logGroupName,
              logStream: logStreamName,
              subscriptionFilters: [filter.filterName],
              logEvents: matchedEvents.map(e => ({
                id: randomUUID().replace(/-/g, ''),
                timestamp: e.timestamp,
                message: e.message,
              })),
            })
          ).toString('base64'),
        },
      };

      // Entrega para Lambda se tiver referência
      if (filter.destinationArn.includes(':lambda:') && this.lambdaSimulator) {
        try {
          const fnName = filter.destinationArn.split(':').pop();
          await this.lambdaSimulator.invoke(fnName, payload, { eventType: 'cloudwatch-logs' });
          this.logger.debug(`[CloudWatch] Delivered ${matchedEvents.length} events to Lambda ${fnName}`);
        } catch (err) {
          this.logger.error(`[CloudWatch] Failed to deliver to Lambda: ${err.message}`);
        }
      }
    }
  }

  // ─── Integração Lambda ────────────────────────────────────────────────────

  /**
   * Adiciona logs de uma execução Lambda automaticamente
   * Chamado pelo simulador Lambda após cada invocação
   */
  async putLambdaLogs(functionName, requestId, logs) {
    const logGroupName = `${this.lambdaLogGroup}/${functionName}`;
    const logStreamName = `${new Date().toISOString().slice(0, 10).replace(/-/g, '/')}/${randomUUID().slice(0, 8)}`;

    // Monta eventos de log
    const now = nowMs();
    const logEvents = [
      { timestamp: now, message: `START RequestId: ${requestId} Version: $LATEST` },
      ...logs.map((line, i) => ({ timestamp: now + i + 1, message: String(line) })),
      { timestamp: now + logs.length + 1, message: `END RequestId: ${requestId}` },
      { timestamp: now + logs.length + 2, message: `REPORT RequestId: ${requestId}` },
    ];

    await this.putLogEvents({ logGroupName, logStreamName, logEvents });
  }

  // ─── Metrics ─────────────────────────────────────────────────────────────

  /**
   * PutMetricData
   */
  putMetricData({ namespace, metricData }) {
    if (!namespace) throw Errors.InvalidParameter('namespace is required');
    if (!metricData || !Array.isArray(metricData)) throw Errors.InvalidParameter('metricData must be an array');

    const now = nowMs();

    for (const metric of metricData) {
      const point = {
        namespace,
        metricName: metric.metricName,
        dimensions: metric.dimensions || [],
        timestamp: metric.timestamp ? new Date(metric.timestamp).getTime() : now,
        value: metric.value !== undefined ? metric.value : null,
        statistic: metric.statistic || null,
        counts: metric.counts || null,
        values: metric.values || null,
        unit: metric.unit || 'None',
        storageResolution: metric.storageResolution || 60,
      };
      this.metricData.push(point);
    }

    // Mantém apenas os últimos 14 dias
    const cutoff = now - 14 * 24 * 60 * 60 * 1000;
    this.metricData = this.metricData.filter(p => p.timestamp >= cutoff);

    this.logger.debug(`[CloudWatch] PutMetricData: ${namespace} +${metricData.length} points`);

    // Verifica alarms após novo dado
    this._evaluateAlarms(namespace);

    this.save();
  }

  /**
   * GetMetricStatistics
   */
  getMetricStatistics({ namespace, metricName, dimensions, startTime, endTime, period, statistics, unit }) {
    if (!namespace) throw Errors.InvalidParameter('namespace is required');
    if (!metricName) throw Errors.InvalidParameter('metricName is required');
    if (!startTime) throw Errors.InvalidParameter('startTime is required');
    if (!endTime) throw Errors.InvalidParameter('endTime is required');
    if (!period) throw Errors.InvalidParameter('period is required');
    if (!statistics || !Array.isArray(statistics)) throw Errors.InvalidParameter('statistics must be an array');

    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    // Filtra pontos
    let points = this.metricData.filter(p => {
      if (p.namespace !== namespace) return false;
      if (p.metricName !== metricName) return false;
      if (p.timestamp < start || p.timestamp > end) return false;
      if (unit && p.unit !== unit) return false;

      // Verifica dimensions
      if (dimensions && dimensions.length > 0) {
        const pDims = p.dimensions || [];
        return dimensions.every(d =>
          pDims.some(pd => pd.name === d.name && pd.value === d.value)
        );
      }
      return true;
    });

    // Agrupa por período
    const buckets = new Map();
    for (const point of points) {
      const bucket = Math.floor((point.timestamp - start) / (period * 1000)) * period * 1000 + start;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(point.value !== null ? point.value : 0);
    }

    // Calcula estatísticas por bucket
    const datapoints = [];
    for (const [timestamp, values] of buckets.entries()) {
      const dp = { timestamp: new Date(timestamp).toISOString(), unit: unit || 'None' };

      if (statistics.includes('SampleCount')) dp.sampleCount = values.length;
      if (statistics.includes('Sum')) dp.sum = values.reduce((a, b) => a + b, 0);
      if (statistics.includes('Average')) dp.average = values.reduce((a, b) => a + b, 0) / values.length;
      if (statistics.includes('Minimum')) dp.minimum = Math.min(...values);
      if (statistics.includes('Maximum')) dp.maximum = Math.max(...values);

      datapoints.push(dp);
    }

    datapoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return { label: metricName, datapoints };
  }

  /**
   * ListMetrics
   */
  listMetrics({ namespace, metricName, dimensions, nextToken } = {}) {
    const seen = new Map();

    for (const point of this.metricData) {
      if (namespace && point.namespace !== namespace) continue;
      if (metricName && point.metricName !== metricName) continue;

      const key = `${point.namespace}/${point.metricName}/${JSON.stringify(point.dimensions || [])}`;
      if (!seen.has(key)) {
        seen.set(key, {
          namespace: point.namespace,
          metricName: point.metricName,
          dimensions: point.dimensions || [],
        });
      }
    }

    let metrics = [...seen.values()];

    // Filtro por dimensions
    if (dimensions && dimensions.length > 0) {
      metrics = metrics.filter(m =>
        dimensions.every(d =>
          (m.dimensions || []).some(md => md.name === d.name && md.value === d.value)
        )
      );
    }

    // Paginação simples
    let startIdx = 0;
    if (nextToken) startIdx = parseInt(nextToken, 10) || 0;
    const limit = 500;
    const page = metrics.slice(startIdx, startIdx + limit);
    const newNextToken = startIdx + limit < metrics.length ? String(startIdx + limit) : null;

    return { metrics: page, nextToken: newNextToken };
  }

  // ─── Alarms ───────────────────────────────────────────────────────────────

  /**
   * PutMetricAlarm
   */
  putMetricAlarm(params) {
    const {
      alarmName,
      alarmDescription,
      actionsEnabled = true,
      okActions = [],
      alarmActions = [],
      insufficientDataActions = [],
      metricName,
      namespace,
      statistic = 'Average',
      dimensions = [],
      period = 60,
      evaluationPeriods = 1,
      datapointsToAlarm,
      threshold,
      comparisonOperator,
      treatMissingData = 'missing',
      unit,
    } = params;

    if (!alarmName) throw Errors.InvalidParameter('alarmName is required');
    if (!metricName) throw Errors.InvalidParameter('metricName is required');
    if (!namespace) throw Errors.InvalidParameter('namespace is required');
    if (!comparisonOperator) throw Errors.InvalidParameter('comparisonOperator is required');
    if (threshold === undefined) throw Errors.InvalidParameter('threshold is required');

    const existing = this.alarms.get(alarmName);
    const alarm = {
      alarmName,
      alarmArn: alarmArn(alarmName),
      alarmDescription: alarmDescription || '',
      actionsEnabled,
      okActions,
      alarmActions,
      insufficientDataActions,
      metricName,
      namespace,
      statistic,
      dimensions,
      period,
      evaluationPeriods,
      datapointsToAlarm: datapointsToAlarm || evaluationPeriods,
      threshold,
      comparisonOperator,
      treatMissingData,
      unit: unit || null,
      stateValue: existing ? existing.stateValue : AlarmState.INSUFFICIENT_DATA,
      stateReason: existing ? existing.stateReason : 'Alarm created',
      stateReasonData: existing ? existing.stateReasonData : null,
      stateUpdatedTimestamp: existing ? existing.stateUpdatedTimestamp : nowIso(),
      alarmConfigurationUpdatedTimestamp: nowIso(),
    };

    this.alarms.set(alarmName, alarm);
    this.logger.info(`[CloudWatch] Alarm created/updated: ${alarmName}`);
    this.save();

    // Avalia imediatamente
    this._evaluateAlarm(alarm);

    return alarm;
  }

  /**
   * DeleteAlarms
   */
  deleteAlarms({ alarmNames }) {
    if (!alarmNames || !Array.isArray(alarmNames)) throw Errors.InvalidParameter('alarmNames is required');

    for (const name of alarmNames) {
      this.alarms.delete(name);
      this.logger.info(`[CloudWatch] Alarm deleted: ${name}`);
    }
    this.save();
  }

  /**
   * DescribeAlarms
   */
  describeAlarms({ alarmNames, alarmNamePrefix, stateValue, actionPrefix, maxRecords = 50, nextToken } = {}) {
    let alarms = [...this.alarms.values()];

    if (alarmNames && alarmNames.length > 0) {
      alarms = alarms.filter(a => alarmNames.includes(a.alarmName));
    }
    if (alarmNamePrefix) {
      alarms = alarms.filter(a => a.alarmName.startsWith(alarmNamePrefix));
    }
    if (stateValue) {
      alarms = alarms.filter(a => a.stateValue === stateValue);
    }
    if (actionPrefix) {
      alarms = alarms.filter(a =>
        [...(a.alarmActions || []), ...(a.okActions || []), ...(a.insufficientDataActions || [])]
          .some(action => action.startsWith(actionPrefix))
      );
    }

    let startIdx = 0;
    if (nextToken) startIdx = parseInt(nextToken, 10) || 0;
    const page = alarms.slice(startIdx, startIdx + maxRecords);
    const newNextToken = startIdx + maxRecords < alarms.length ? String(startIdx + maxRecords) : null;

    return { metricAlarms: page, nextToken: newNextToken };
  }

  /**
   * DescribeAlarmsForMetric
   */
  describeAlarmsForMetric({ metricName, namespace, statistic, dimensions, period, unit } = {}) {
    if (!metricName) throw Errors.InvalidParameter('metricName is required');
    if (!namespace) throw Errors.InvalidParameter('namespace is required');

    let alarms = [...this.alarms.values()].filter(a =>
      a.metricName === metricName && a.namespace === namespace
    );

    if (statistic) alarms = alarms.filter(a => a.statistic === statistic);
    if (period) alarms = alarms.filter(a => a.period === period);
    if (unit) alarms = alarms.filter(a => a.unit === unit);

    return { metricAlarms: alarms };
  }

  /**
   * SetAlarmState
   */
  setAlarmState({ alarmName, stateValue, stateReason, stateReasonData }) {
    if (!alarmName) throw Errors.InvalidParameter('alarmName is required');
    if (!stateValue) throw Errors.InvalidParameter('stateValue is required');
    if (!stateReason) throw Errors.InvalidParameter('stateReason is required');

    const alarm = this.alarms.get(alarmName);
    if (!alarm) throw Errors.AlarmNotFound(alarmName);

    const prevState = alarm.stateValue;
    alarm.stateValue = stateValue;
    alarm.stateReason = stateReason;
    alarm.stateReasonData = stateReasonData || null;
    alarm.stateUpdatedTimestamp = nowIso();

    this.logger.info(`[CloudWatch] Alarm state set: ${alarmName} -> ${stateValue}`);
    this.save();

    // Dispara ações se mudou de estado
    if (prevState !== stateValue) {
      this._triggerAlarmActions(alarm, prevState);
    }
  }

  /**
   * Avalia todos os alarms de um namespace após novos dados
   * @private
   */
  _evaluateAlarms(namespace) {
    for (const alarm of this.alarms.values()) {
      if (alarm.namespace === namespace) {
        this._evaluateAlarm(alarm);
      }
    }
  }

  /**
   * Avalia um alarm individual com base nos dados de métrica recentes
   * @private
   */
  _evaluateAlarm(alarm) {
    const now = nowMs();
    const windowStart = now - alarm.evaluationPeriods * alarm.period * 1000;

    let points = this.metricData.filter(p => {
      if (p.namespace !== alarm.namespace) return false;
      if (p.metricName !== alarm.metricName) return false;
      if (p.timestamp < windowStart) return false;

      if (alarm.dimensions && alarm.dimensions.length > 0) {
        const pDims = p.dimensions || [];
        return alarm.dimensions.every(d =>
          pDims.some(pd => pd.name === d.name && pd.value === d.value)
        );
      }
      return true;
    });

    if (points.length === 0) {
      const newState = alarm.treatMissingData === 'breaching'
        ? AlarmState.ALARM
        : alarm.treatMissingData === 'notBreaching'
          ? AlarmState.OK
          : AlarmState.INSUFFICIENT_DATA;

      this._updateAlarmState(alarm, newState, 'Insufficient data for evaluation');
      return;
    }

    // Calcula estatística
    const values = points.map(p => p.value !== null ? p.value : 0);
    let statValue;
    switch (alarm.statistic) {
      case 'Sum': statValue = values.reduce((a, b) => a + b, 0); break;
      case 'Minimum': statValue = Math.min(...values); break;
      case 'Maximum': statValue = Math.max(...values); break;
      case 'SampleCount': statValue = values.length; break;
      case 'Average':
      default: statValue = values.reduce((a, b) => a + b, 0) / values.length;
    }

    // Compara com threshold
    let breaching = false;
    switch (alarm.comparisonOperator) {
      case 'GreaterThanOrEqualToThreshold': breaching = statValue >= alarm.threshold; break;
      case 'GreaterThanThreshold': breaching = statValue > alarm.threshold; break;
      case 'LessThanThreshold': breaching = statValue < alarm.threshold; break;
      case 'LessThanOrEqualToThreshold': breaching = statValue <= alarm.threshold; break;
    }

    const newState = breaching ? AlarmState.ALARM : AlarmState.OK;
    const reason = `Threshold Crossed: ${statValue} ${alarm.comparisonOperator} ${alarm.threshold}`;
    this._updateAlarmState(alarm, newState, reason);
  }

  /**
   * Atualiza estado de um alarm e dispara ações se mudou
   * @private
   */
  _updateAlarmState(alarm, newState, reason) {
    if (alarm.stateValue === newState) return;

    const prevState = alarm.stateValue;
    alarm.stateValue = newState;
    alarm.stateReason = reason;
    alarm.stateUpdatedTimestamp = nowIso();

    this.logger.info(`[CloudWatch] Alarm state changed: ${alarm.alarmName} ${prevState} -> ${newState}`);
    this._triggerAlarmActions(alarm, prevState);
  }

  /**
   * Dispara ações de alarm (SNS)
   * @private
   */
  async _triggerAlarmActions(alarm, prevState) {
    if (!alarm.actionsEnabled) return;

    let actions = [];
    if (alarm.stateValue === AlarmState.ALARM) actions = alarm.alarmActions || [];
    else if (alarm.stateValue === AlarmState.OK) actions = alarm.okActions || [];
    else if (alarm.stateValue === AlarmState.INSUFFICIENT_DATA) actions = alarm.insufficientDataActions || [];

    for (const actionArn of actions) {
      if (actionArn.includes(':sns:') && this.snsSimulator) {
        try {
          const message = JSON.stringify({
            AlarmName: alarm.alarmName,
            AlarmDescription: alarm.alarmDescription,
            AWSAccountId: ACCOUNT,
            NewStateValue: alarm.stateValue,
            NewStateReason: alarm.stateReason,
            OldStateValue: prevState,
            Trigger: {
              MetricName: alarm.metricName,
              Namespace: alarm.namespace,
              Threshold: alarm.threshold,
            },
          });

          const topicArn = actionArn;
          await this.snsSimulator.publish({ topicArn, message, subject: `ALARM: ${alarm.alarmName}` });
          this.logger.info(`[CloudWatch] Alarm action triggered: ${alarm.alarmName} -> SNS ${topicArn}`);
        } catch (err) {
          this.logger.error(`[CloudWatch] Failed to trigger alarm action: ${err.message}`);
        }
      }
    }
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      logGroups: this.logGroups.size,
      logStreams: [...this.logStreams.values()].reduce((acc, s) => acc + s.size, 0),
      logEventCount: [...this.logEvents.values()].reduce((acc, e) => acc + e.length, 0),
      metricDataPoints: this.metricData.length,
      alarms: this.alarms.size,
    };
  }

  listAdminLogGroups() {
    return [...this.logGroups.values()].map(g => ({
      ...g,
      streamCount: (this.logStreams.get(g.logGroupName) || new Map()).size,
    }));
  }

  listAdminAlarms() {
    return [...this.alarms.values()];
  }

  listAdminMetrics() {
    const seen = new Map();
    for (const p of this.metricData) {
      const key = `${p.namespace}/${p.metricName}`;
      if (!seen.has(key)) seen.set(key, { namespace: p.namespace, metricName: p.metricName, count: 0 });
      seen.get(key).count++;
    }
    return [...seen.values()];
  }
}

module.exports = { CloudWatchSimulator };
