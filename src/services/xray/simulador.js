'use strict';

/**
 * @fileoverview X-Ray Simulator
 *
 * Suporta:
 *  Segments / Traces:
 *   - PutTraceSegments         → recebe segmentos e subsegmentos
 *   - BatchGetTraces           → recupera traces por IDs
 *   - GetTraceSummaries        → lista summaries com filtro e paginação
 *   - GetTraceGraph            → grafo de serviços para um trace específico
 *
 *  Service Graph:
 *   - GetServiceGraph          → grafo de serviços por janela de tempo
 *
 *  Groups:
 *   - CreateGroup / UpdateGroup / DeleteGroup / GetGroup / GetGroups
 *
 *  Sampling Rules:
 *   - CreateSamplingRule / UpdateSamplingRule / DeleteSamplingRule
 *   - GetSamplingRules / GetSamplingStatisticSummaries / GetSamplingTargets
 *
 *  Encryption:
 *   - PutEncryptionConfig / GetEncryptionConfig
 *
 *  Tags:
 *   - TagResource / UntagResource / ListTagsForResource
 *
 *  Insights:
 *   - GetInsight / GetInsightSummaries / GetInsightEvents / GetInsightImpactGraph
 *
 *  Persistência via LocalStore
 */

const { randomUUID } = require('crypto');

// ─── Erros tipados ────────────────────────────────────────────────────────────

class XRayError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const Errors = {
  InvalidRequest: (msg) =>
    new XRayError('InvalidRequestException', msg, 400),
  TraceNotFound: (id) =>
    new XRayError('TraceNotFoundException', `Trace not found: ${id}`, 404),
  GroupNotFound: (name) =>
    new XRayError('InvalidRequestException', `Group not found: ${name}`, 404),
  GroupAlreadyExists: (name) =>
    new XRayError('InvalidRequestException', `Group already exists: ${name}`, 400),
  SamplingRuleNotFound: (name) =>
    new XRayError('InvalidRequestException', `Sampling rule not found: ${name}`, 404),
  SamplingRuleAlreadyExists: (name) =>
    new XRayError('InvalidRequestException', `Sampling rule already exists: ${name}`, 400),
  ThrottledException: () =>
    new XRayError('ThrottledException', 'Rate exceeded', 429),
  ResourceNotFound: (arn) =>
    new XRayError('ResourceNotFoundException', `Resource not found: ${arn}`, 404),
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const REGION = 'us-east-1';
const ACCOUNT_ID = '000000000000';
const MAX_TRACES_PER_REQUEST = 5;
const MAX_RESULTS_DEFAULT = 1000;
const TRACE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 dias

// ─── Utilitários ──────────────────────────────────────────────────────────────

function groupArn(groupName) {
  return `arn:aws:xray:${REGION}:${ACCOUNT_ID}:group/${groupName}`;
}

function samplingRuleArn(ruleName) {
  return `arn:aws:xray:${REGION}:${ACCOUNT_ID}:sampling-rule/${ruleName}`;
}

function generateTraceId() {
  const epoch = Math.floor(Date.now() / 1000).toString(16);
  const unique = randomUUID().replace(/-/g, '').substring(0, 24);
  return `1-${epoch}-${unique}`;
}

function parseSegmentDocument(doc) {
  try {
    return typeof doc === 'string' ? JSON.parse(doc) : doc;
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function extractServiceFromSegment(segment) {
  return {
    Name: segment.name || 'unknown',
    Type: segment.origin || 'AWS::Other',
    AccountId: ACCOUNT_ID,
    State: { ok: true },
    StartTime: segment.start_time ? new Date(segment.start_time * 1000).toISOString() : nowIso(),
    EndTime: segment.end_time ? new Date(segment.end_time * 1000).toISOString() : nowIso(),
    Edges: [],
    SummaryStatistics: {
      OkCount: segment.error ? 0 : 1,
      ErrorStatistics: {
        ThrottleCount: segment.throttle ? 1 : 0,
        OtherCount: segment.error ? 1 : 0,
        TotalCount: segment.error ? 1 : 0,
      },
      FaultStatistics: {
        OtherCount: segment.fault ? 1 : 0,
        TotalCount: segment.fault ? 1 : 0,
      },
      TotalCount: 1,
      TotalResponseTime: segment.end_time && segment.start_time
        ? segment.end_time - segment.start_time
        : 0,
    },
  };
}

function buildTraceSummary(trace) {
  const rootSegment = trace.segments[0] || {};
  const seg = parseSegmentDocument(rootSegment.Document || rootSegment) || {};

  const hasError = trace.segments.some(s => {
    const d = parseSegmentDocument(s.Document || s) || {};
    return d.error || d.fault;
  });

  return {
    Id: trace.id,
    Duration: trace.duration || 0,
    ResponseTime: trace.duration || 0,
    HasFault: trace.segments.some(s => {
      const d = parseSegmentDocument(s.Document || s) || {};
      return !!d.fault;
    }),
    HasError: hasError,
    HasThrottle: trace.segments.some(s => {
      const d = parseSegmentDocument(s.Document || s) || {};
      return !!d.throttle;
    }),
    IsPartial: trace.isPartial || false,
    Http: seg.http ? {
      HttpURL: { Value: seg.http.request?.url || '' },
      HttpStatus: { Value: seg.http.response?.status || 0 },
      HttpMethod: { Value: seg.http.request?.method || '' },
      UserAgent: { Value: seg.http.request?.user_agent || '' },
      ClientIp: { Value: seg.http.request?.client_ip || '' },
    } : undefined,
    Annotations: seg.annotations || {},
    Users: seg.user ? [{ UserName: seg.user, ServiceIds: [] }] : [],
    ServiceIds: [{
      Name: seg.name || 'unknown',
      AccountId: ACCOUNT_ID,
      Type: seg.origin || 'AWS::Other',
    }],
    ResourceARNs: [],
    InstanceIds: [],
    AvailabilityZones: [{ Name: 'us-east-1a' }],
    EntryPoint: {
      Name: seg.name || 'unknown',
      AccountId: ACCOUNT_ID,
      Type: seg.origin || 'AWS::Other',
    },
    MatchedEventTime: trace.createdAt,
    Revision: trace.revision || 0,
  };
}

function applyFilterExpression(traces, filterExpression) {
  if (!filterExpression) return traces;

  return traces.filter(trace => {
    const summary = buildTraceSummary(trace);

    // service("name")
    const serviceMatch = filterExpression.match(/service\("([^"]+)"\)/);
    if (serviceMatch) {
      const svcName = serviceMatch[1].toLowerCase();
      return summary.ServiceIds.some(s => s.Name.toLowerCase().includes(svcName));
    }

    // annotation.key = "value"
    const annotationMatch = filterExpression.match(/annotation\.(\w+)\s*=\s*"([^"]+)"/);
    if (annotationMatch) {
      const key = annotationMatch[1];
      const val = annotationMatch[2];
      return summary.Annotations[key] === val;
    }

    // http.status = 500
    const statusMatch = filterExpression.match(/http\.status\s*=\s*(\d+)/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1]);
      return summary.Http?.HttpStatus?.Value === status;
    }

    // fault
    if (filterExpression.includes('fault')) return summary.HasFault;

    // error
    if (filterExpression.includes('error')) return summary.HasError;

    // responsetime > X
    const rtMatch = filterExpression.match(/responsetime\s*([><=!]+)\s*([\d.]+)/);
    if (rtMatch) {
      const op = rtMatch[1];
      const val = parseFloat(rtMatch[2]);
      const rt = summary.ResponseTime;
      if (op === '>') return rt > val;
      if (op === '<') return rt < val;
      if (op === '>=') return rt >= val;
      if (op === '<=') return rt <= val;
      if (op === '=') return rt === val;
    }

    return true;
  });
}

// ─── XRaySimulator ────────────────────────────────────────────────────────────

class XRaySimulator {
  constructor(config, store, logger) {
    this.config = config || {};
    this.store = store;
    this.logger = logger || console;

    // Estado em memória
    this._traces = new Map();        // traceId → { id, segments, createdAt, duration, ... }
    this._groups = new Map();        // groupName → group object
    this._samplingRules = new Map(); // ruleName → rule object
    this._encryptionConfig = {
      Type: 'NONE',
      Status: 'ACTIVE',
    };
    this._insights = new Map();      // insightId → insight object
    this._tags = new Map();          // arn → { key: value }

    // Injetado externamente
    this.cloudwatchSimulator = null;
    this.cloudtrailSimulator = null;
  }

  // ─── Persistência ───────────────────────────────────────────────────────────

  async load() {
    try {
      const data = await this.store.load('xray');
      if (data) {
        if (data.traces) {
          this._traces = new Map(Object.entries(data.traces));
        }
        if (data.groups) {
          this._groups = new Map(Object.entries(data.groups));
        }
        if (data.samplingRules) {
          this._samplingRules = new Map(Object.entries(data.samplingRules));
        }
        if (data.encryptionConfig) {
          this._encryptionConfig = data.encryptionConfig;
        }
        if (data.tags) {
          this._tags = new Map(Object.entries(data.tags));
        }
        this.logger.info(`[XRay] Loaded ${this._traces.size} traces, ${this._groups.size} groups`);
      }

      // Garante grupo e sampling rule padrão
      this._ensureDefaults();
    } catch (err) {
      this.logger.warn('[XRay] No persisted data found, starting fresh');
      this._ensureDefaults();
    }
  }

  async save() {
    try {
      const data = {
        traces: Object.fromEntries(this._traces),
        groups: Object.fromEntries(this._groups),
        samplingRules: Object.fromEntries(this._samplingRules),
        encryptionConfig: this._encryptionConfig,
        tags: Object.fromEntries(this._tags),
      };
      await this.store.save('xray', data);
    } catch (err) {
      this.logger.error('[XRay] Failed to save data:', err.message);
    }
  }

  _ensureDefaults() {
    // Grupo padrão "Default"
    if (!this._groups.has('Default')) {
      this._groups.set('Default', {
        GroupName: 'Default',
        GroupARN: groupArn('Default'),
        FilterExpression: '',
        InsightsConfiguration: {
          InsightsEnabled: false,
          NotificationsEnabled: false,
        },
        Tags: {},
      });
    }

    // Sampling rule padrão
    if (!this._samplingRules.has('Default')) {
      this._samplingRules.set('Default', {
        SamplingRule: {
          RuleName: 'Default',
          RuleARN: samplingRuleArn('Default'),
          ResourceARN: '*',
          Priority: 10000,
          FixedRate: 0.05,
          ReservoirSize: 1,
          ServiceName: '*',
          ServiceType: '*',
          Host: '*',
          HTTPMethod: '*',
          URLPath: '*',
          Version: 1,
          Attributes: {},
        },
        CreatedAt: nowIso(),
        ModifiedAt: nowIso(),
      });
    }
  }

  // ─── PutTraceSegments ────────────────────────────────────────────────────────

  async putTraceSegments({ TraceSegmentDocuments }) {
    if (!Array.isArray(TraceSegmentDocuments) || TraceSegmentDocuments.length === 0) {
      throw Errors.InvalidRequest('TraceSegmentDocuments is required and must be non-empty');
    }

    const unprocessedTraceSegments = [];

    for (const docStr of TraceSegmentDocuments) {
      try {
        const segment = parseSegmentDocument(docStr);
        if (!segment) {
          unprocessedTraceSegments.push({
            Id: 'unknown',
            ErrorCode: 'ParseError',
            Message: 'Failed to parse segment document',
          });
          continue;
        }

        const traceId = segment.trace_id || generateTraceId();
        const segmentId = segment.id || randomUUID().replace(/-/g, '').substring(0, 16);

        let trace = this._traces.get(traceId);
        if (!trace) {
          trace = {
            id: traceId,
            segments: [],
            createdAt: nowIso(),
            duration: 0,
            isPartial: false,
            revision: 0,
          };
          this._traces.set(traceId, trace);
        }

        // Verifica se segmento já existe (pelo id) e substitui ou adiciona
        const existingIdx = trace.segments.findIndex(s => {
          const d = parseSegmentDocument(s.Document || s) || {};
          return d.id === segmentId;
        });

        const segmentEntry = {
          Id: segmentId,
          Document: docStr,
        };

        if (existingIdx >= 0) {
          trace.segments[existingIdx] = segmentEntry;
        } else {
          trace.segments.push(segmentEntry);
        }

        // Atualiza duração do trace
        if (segment.start_time && segment.end_time) {
          const duration = segment.end_time - segment.start_time;
          if (duration > trace.duration) {
            trace.duration = parseFloat(duration.toFixed(6));
          }
        }

        // Marca como parcial se não tem end_time
        trace.isPartial = !segment.end_time;
        trace.revision = (trace.revision || 0) + 1;

        this.logger.debug(`[XRay] Stored segment ${segmentId} for trace ${traceId}`);
      } catch (err) {
        unprocessedTraceSegments.push({
          Id: 'unknown',
          ErrorCode: 'InternalError',
          Message: err.message,
        });
      }
    }

    await this.save();

    return { UnprocessedTraceSegments: unprocessedTraceSegments };
  }

  // ─── BatchGetTraces ──────────────────────────────────────────────────────────

  async batchGetTraces({ TraceIds, NextToken }) {
    if (!Array.isArray(TraceIds) || TraceIds.length === 0) {
      throw Errors.InvalidRequest('TraceIds is required and must be non-empty');
    }

    if (TraceIds.length > MAX_TRACES_PER_REQUEST) {
      throw Errors.InvalidRequest(`Maximum of ${MAX_TRACES_PER_REQUEST} trace IDs per request`);
    }

    const traces = [];
    const unprocessedTraceIds = [];

    for (const traceId of TraceIds) {
      const trace = this._traces.get(traceId);
      if (trace) {
        traces.push({
          Id: trace.id,
          Duration: trace.duration,
          LimitExceeded: false,
          Segments: trace.segments,
        });
      } else {
        unprocessedTraceIds.push(traceId);
      }
    }

    return {
      Traces: traces,
      UnprocessedTraceIds: unprocessedTraceIds,
      NextToken: null,
    };
  }

  // ─── GetTraceSummaries ───────────────────────────────────────────────────────

  async getTraceSummaries({ StartTime, EndTime, TimeRangeType, Sampling, FilterExpression, NextToken }) {
    if (!StartTime || !EndTime) {
      throw Errors.InvalidRequest('StartTime and EndTime are required');
    }

    const startMs = new Date(StartTime * 1000 || StartTime).getTime();
    const endMs = new Date(EndTime * 1000 || EndTime).getTime();

    let traces = Array.from(this._traces.values()).filter(trace => {
      const createdMs = new Date(trace.createdAt).getTime();
      return createdMs >= startMs && createdMs <= endMs;
    });

    // Aplica filtro
    if (FilterExpression) {
      traces = applyFilterExpression(traces, FilterExpression);
    }

    // Paginação simples
    let startIndex = 0;
    if (NextToken) {
      try {
        startIndex = parseInt(Buffer.from(NextToken, 'base64').toString('utf8'));
      } catch {
        startIndex = 0;
      }
    }

    const pageSize = 100;
    const pageTraces = traces.slice(startIndex, startIndex + pageSize);
    const newNextToken = startIndex + pageSize < traces.length
      ? Buffer.from(String(startIndex + pageSize)).toString('base64')
      : null;

    const summaries = pageTraces.map(buildTraceSummary);

    return {
      TraceSummaries: summaries,
      ApproximateTime: new Date().toISOString(),
      TracesProcessedCount: traces.length,
      NextToken: newNextToken,
    };
  }

  // ─── GetTraceGraph ───────────────────────────────────────────────────────────

  async getTraceGraph({ TraceIds, NextToken }) {
    if (!Array.isArray(TraceIds) || TraceIds.length === 0) {
      throw Errors.InvalidRequest('TraceIds is required');
    }

    const services = [];
    const seenServices = new Set();

    for (const traceId of TraceIds) {
      const trace = this._traces.get(traceId);
      if (!trace) continue;

      for (const seg of trace.segments) {
        const doc = parseSegmentDocument(seg.Document || seg) || {};
        const serviceKey = `${doc.name}:${doc.origin || 'AWS::Other'}`;

        if (!seenServices.has(serviceKey)) {
          seenServices.add(serviceKey);
          services.push(extractServiceFromSegment(doc));
        }

        // Subsegmentos como edges
        if (doc.subsegments) {
          for (const sub of doc.subsegments) {
            const subKey = `${sub.name}:${sub.namespace || 'remote'}`;
            if (!seenServices.has(subKey)) {
              seenServices.add(subKey);
              services.push({
                Name: sub.name || 'unknown',
                Type: sub.namespace === 'aws' ? 'AWS::Lambda::Function' : 'remote',
                AccountId: ACCOUNT_ID,
                State: { ok: true },
                StartTime: sub.start_time ? new Date(sub.start_time * 1000).toISOString() : nowIso(),
                EndTime: sub.end_time ? new Date(sub.end_time * 1000).toISOString() : nowIso(),
                Edges: [],
                SummaryStatistics: {
                  OkCount: 1,
                  ErrorStatistics: { ThrottleCount: 0, OtherCount: 0, TotalCount: 0 },
                  FaultStatistics: { OtherCount: 0, TotalCount: 0 },
                  TotalCount: 1,
                  TotalResponseTime: sub.end_time && sub.start_time
                    ? sub.end_time - sub.start_time
                    : 0,
                },
              });
            }
          }
        }
      }
    }

    return {
      Services: services,
      NextToken: null,
    };
  }

  // ─── GetServiceGraph ─────────────────────────────────────────────────────────

  async getServiceGraph({ StartTime, EndTime, GroupName, GroupARN, NextToken }) {
    if (!StartTime || !EndTime) {
      throw Errors.InvalidRequest('StartTime and EndTime are required');
    }

    const startMs = new Date(StartTime * 1000 || StartTime).getTime();
    const endMs = new Date(EndTime * 1000 || EndTime).getTime();

    const traces = Array.from(this._traces.values()).filter(trace => {
      const createdMs = new Date(trace.createdAt).getTime();
      return createdMs >= startMs && createdMs <= endMs;
    });

    // Agrega serviços únicos de todos os traces na janela de tempo
    const servicesMap = new Map();

    for (const trace of traces) {
      for (const seg of trace.segments) {
        const doc = parseSegmentDocument(seg.Document || seg) || {};
        const key = doc.name || 'unknown';

        if (!servicesMap.has(key)) {
          servicesMap.set(key, extractServiceFromSegment(doc));
        } else {
          // Agrega estatísticas
          const existing = servicesMap.get(key);
          existing.SummaryStatistics.TotalCount += 1;
          if (!doc.error && !doc.fault) existing.SummaryStatistics.OkCount += 1;
          if (doc.error) existing.SummaryStatistics.ErrorStatistics.TotalCount += 1;
          if (doc.fault) existing.SummaryStatistics.FaultStatistics.TotalCount += 1;
          const dur = doc.end_time && doc.start_time ? doc.end_time - doc.start_time : 0;
          existing.SummaryStatistics.TotalResponseTime += dur;
        }
      }
    }

    return {
      Services: Array.from(servicesMap.values()),
      StartTime: new Date(startMs).toISOString(),
      EndTime: new Date(endMs).toISOString(),
      ContainsOldGroupVersions: false,
      NextToken: null,
    };
  }

  // ─── Groups ──────────────────────────────────────────────────────────────────

  async createGroup({ GroupName, FilterExpression, InsightsConfiguration, Tags }) {
    if (!GroupName) throw Errors.InvalidRequest('GroupName is required');
    if (this._groups.has(GroupName)) throw Errors.GroupAlreadyExists(GroupName);

    const group = {
      GroupName,
      GroupARN: groupArn(GroupName),
      FilterExpression: FilterExpression || '',
      InsightsConfiguration: InsightsConfiguration || {
        InsightsEnabled: false,
        NotificationsEnabled: false,
      },
      Tags: Tags || {},
    };

    this._groups.set(GroupName, group);
    if (Tags) this._tags.set(groupArn(GroupName), Tags);
    await this.save();

    return { Group: group };
  }

  async updateGroup({ GroupName, GroupARN, FilterExpression, InsightsConfiguration }) {
    const name = GroupName || (GroupARN && GroupARN.split('/').pop());
    if (!name) throw Errors.InvalidRequest('GroupName or GroupARN is required');

    const group = this._groups.get(name);
    if (!group) throw Errors.GroupNotFound(name);

    if (FilterExpression !== undefined) group.FilterExpression = FilterExpression;
    if (InsightsConfiguration !== undefined) group.InsightsConfiguration = InsightsConfiguration;

    await this.save();
    return { Group: group };
  }

  async deleteGroup({ GroupName, GroupARN }) {
    const name = GroupName || (GroupARN && GroupARN.split('/').pop());
    if (!name) throw Errors.InvalidRequest('GroupName or GroupARN is required');
    if (name === 'Default') throw Errors.InvalidRequest('Cannot delete Default group');

    const group = this._groups.get(name);
    if (!group) throw Errors.GroupNotFound(name);

    this._groups.delete(name);
    this._tags.delete(groupArn(name));
    await this.save();

    return {};
  }

  async getGroup({ GroupName, GroupARN }) {
    const name = GroupName || (GroupARN && GroupARN.split('/').pop());
    if (!name) throw Errors.InvalidRequest('GroupName or GroupARN is required');

    const group = this._groups.get(name);
    if (!group) throw Errors.GroupNotFound(name);

    return { Group: group };
  }

  async getGroups({ NextToken }) {
    const groups = Array.from(this._groups.values());

    let startIndex = 0;
    if (NextToken) {
      try {
        startIndex = parseInt(Buffer.from(NextToken, 'base64').toString('utf8'));
      } catch { startIndex = 0; }
    }

    const page = groups.slice(startIndex, startIndex + 25);
    const newNextToken = startIndex + 25 < groups.length
      ? Buffer.from(String(startIndex + 25)).toString('base64')
      : null;

    return {
      Groups: page,
      NextToken: newNextToken,
    };
  }

  // ─── Sampling Rules ──────────────────────────────────────────────────────────

  async createSamplingRule({ SamplingRule, Tags }) {
    if (!SamplingRule || !SamplingRule.RuleName) {
      throw Errors.InvalidRequest('SamplingRule.RuleName is required');
    }

    const { RuleName } = SamplingRule;
    if (this._samplingRules.has(RuleName)) {
      throw Errors.SamplingRuleAlreadyExists(RuleName);
    }

    const rule = {
      SamplingRule: {
        ...SamplingRule,
        RuleARN: samplingRuleArn(RuleName),
        Version: SamplingRule.Version || 1,
        Attributes: SamplingRule.Attributes || {},
      },
      CreatedAt: nowIso(),
      ModifiedAt: nowIso(),
    };

    this._samplingRules.set(RuleName, rule);
    if (Tags) this._tags.set(samplingRuleArn(RuleName), Tags);
    await this.save();

    return { SamplingRuleRecord: rule };
  }

  async updateSamplingRule({ SamplingRuleUpdate }) {
    if (!SamplingRuleUpdate) throw Errors.InvalidRequest('SamplingRuleUpdate is required');

    const name = SamplingRuleUpdate.RuleName ||
      (SamplingRuleUpdate.RuleARN && SamplingRuleUpdate.RuleARN.split('/').pop());
    if (!name) throw Errors.InvalidRequest('RuleName or RuleARN is required');

    const existing = this._samplingRules.get(name);
    if (!existing) throw Errors.SamplingRuleNotFound(name);

    Object.assign(existing.SamplingRule, SamplingRuleUpdate);
    existing.ModifiedAt = nowIso();

    await this.save();
    return { SamplingRuleRecord: existing };
  }

  async deleteSamplingRule({ RuleName, RuleARN }) {
    const name = RuleName || (RuleARN && RuleARN.split('/').pop());
    if (!name) throw Errors.InvalidRequest('RuleName or RuleARN is required');
    if (name === 'Default') throw Errors.InvalidRequest('Cannot delete Default sampling rule');

    const rule = this._samplingRules.get(name);
    if (!rule) throw Errors.SamplingRuleNotFound(name);

    this._samplingRules.delete(name);
    this._tags.delete(samplingRuleArn(name));
    await this.save();

    return { SamplingRuleRecord: rule };
  }

  async getSamplingRules({ NextToken }) {
    const rules = Array.from(this._samplingRules.values());

    let startIndex = 0;
    if (NextToken) {
      try {
        startIndex = parseInt(Buffer.from(NextToken, 'base64').toString('utf8'));
      } catch { startIndex = 0; }
    }

    const page = rules.slice(startIndex, startIndex + 25);
    const newNextToken = startIndex + 25 < rules.length
      ? Buffer.from(String(startIndex + 25)).toString('base64')
      : null;

    return {
      SamplingRuleRecords: page,
      NextToken: newNextToken,
    };
  }

  async getSamplingStatisticSummaries({ SamplingStatisticsDocuments }) {
    // Simula resposta com targets baseados nas regras existentes
    const targets = (SamplingStatisticsDocuments || []).map(doc => ({
      RuleName: doc.RuleName,
      FixedRate: this._samplingRules.get(doc.RuleName)?.SamplingRule?.FixedRate || 0.05,
      ReservoirQuota: this._samplingRules.get(doc.RuleName)?.SamplingRule?.ReservoirSize || 1,
      ReservoirQuotaTTL: Math.floor(Date.now() / 1000) + 10,
      Interval: 10,
    }));

    return {
      SamplingStatisticSummaries: [],
      NextToken: null,
    };
  }

  async getSamplingTargets({ SamplingStatisticsDocuments }) {
    if (!Array.isArray(SamplingStatisticsDocuments)) {
      throw Errors.InvalidRequest('SamplingStatisticsDocuments is required');
    }

    const targets = SamplingStatisticsDocuments.map(doc => {
      const rule = this._samplingRules.get(doc.RuleName);
      return {
        RuleName: doc.RuleName,
        FixedRate: rule?.SamplingRule?.FixedRate || 0.05,
        ReservoirQuota: rule?.SamplingRule?.ReservoirSize || 1,
        ReservoirQuotaTTL: Math.floor(Date.now() / 1000) + 10,
        Interval: 10,
      };
    });

    return {
      SamplingTargetDocuments: targets,
      LastRuleModification: nowIso(),
      UnprocessedStatistics: [],
    };
  }

  // ─── Encryption Config ───────────────────────────────────────────────────────

  async putEncryptionConfig({ Type, KeyId }) {
    if (!Type) throw Errors.InvalidRequest('Type is required');
    if (!['NONE', 'KMS'].includes(Type)) {
      throw Errors.InvalidRequest('Type must be NONE or KMS');
    }
    if (Type === 'KMS' && !KeyId) {
      throw Errors.InvalidRequest('KeyId is required when Type is KMS');
    }

    this._encryptionConfig = {
      KeyId: Type === 'KMS' ? KeyId : undefined,
      Status: 'ACTIVE',
      Type,
    };

    await this.save();
    return { EncryptionConfig: this._encryptionConfig };
  }

  async getEncryptionConfig() {
    return { EncryptionConfig: this._encryptionConfig };
  }

  // ─── Tags ────────────────────────────────────────────────────────────────────

  async tagResource({ ResourceARN, Tags }) {
    if (!ResourceARN) throw Errors.InvalidRequest('ResourceARN is required');
    if (!Tags || typeof Tags !== 'object') throw Errors.InvalidRequest('Tags is required');

    const existing = this._tags.get(ResourceARN) || {};
    this._tags.set(ResourceARN, { ...existing, ...Tags });
    await this.save();

    return {};
  }

  async untagResource({ ResourceARN, TagKeys }) {
    if (!ResourceARN) throw Errors.InvalidRequest('ResourceARN is required');
    if (!Array.isArray(TagKeys)) throw Errors.InvalidRequest('TagKeys is required');

    const existing = this._tags.get(ResourceARN) || {};
    for (const key of TagKeys) {
      delete existing[key];
    }
    this._tags.set(ResourceARN, existing);
    await this.save();

    return {};
  }

  async listTagsForResource({ ResourceARN }) {
    if (!ResourceARN) throw Errors.InvalidRequest('ResourceARN is required');
    const tags = this._tags.get(ResourceARN) || {};
    return { Tags: tags };
  }

  // ─── Insights ────────────────────────────────────────────────────────────────

  async getInsight({ InsightId }) {
    if (!InsightId) throw Errors.InvalidRequest('InsightId is required');
    const insight = this._insights.get(InsightId);
    if (!insight) {
      return {
        Insight: {
          InsightId,
          State: 'CLOSED',
          Summary: 'No insight found',
        },
      };
    }
    return { Insight: insight };
  }

  async getInsightSummaries({ States, GroupARN, GroupName, StartTime, EndTime, MaxResults, NextToken }) {
    const insights = Array.from(this._insights.values());
    return {
      InsightSummaries: insights,
      NextToken: null,
    };
  }

  async getInsightEvents({ InsightId, MaxResults, NextToken }) {
    if (!InsightId) throw Errors.InvalidRequest('InsightId is required');
    return {
      InsightEvents: [],
      NextToken: null,
    };
  }

  async getInsightImpactGraph({ InsightId, StartTime, EndTime, NextToken }) {
    if (!InsightId) throw Errors.InvalidRequest('InsightId is required');
    return {
      InsightId,
      ServiceGraphStartTime: StartTime || nowIso(),
      ServiceGraphEndTime: EndTime || nowIso(),
      Services: [],
      NextToken: null,
    };
  }

  // ─── Método interno: record trace de outros serviços ─────────────────────────

  recordServiceCall({ serviceName, operationName, traceId, startTime, endTime, statusCode, error }) {
    const tId = traceId || generateTraceId();
    const segmentId = randomUUID().replace(/-/g, '').substring(0, 16);

    const now = Date.now() / 1000;
    const start = startTime || now;
    const end = endTime || now + 0.001;

    const segment = {
      name: serviceName || 'unknown',
      id: segmentId,
      trace_id: tId,
      start_time: start,
      end_time: end,
      origin: `AWS::${serviceName}`,
      http: {
        response: { status: statusCode || 200 },
      },
      error: !!error,
      fault: statusCode >= 500,
      annotations: {
        operation: operationName || '',
      },
    };

    const docStr = JSON.stringify(segment);

    let trace = this._traces.get(tId);
    if (!trace) {
      trace = {
        id: tId,
        segments: [],
        createdAt: nowIso(),
        duration: end - start,
        isPartial: false,
        revision: 0,
      };
      this._traces.set(tId, trace);
    }

    trace.segments.push({ Id: segmentId, Document: docStr });
    trace.revision = (trace.revision || 0) + 1;

    // Salva de forma assíncrona (não bloqueia)
    this.save().catch(() => {});

    return tId;
  }

  // ─── Reset ───────────────────────────────────────────────────────────────────

  async reset() {
    this._traces.clear();
    this._groups.clear();
    this._samplingRules.clear();
    this._insights.clear();
    this._tags.clear();
    this._encryptionConfig = { Type: 'NONE', Status: 'ACTIVE' };
    this._ensureDefaults();
    await this.save();
    this.logger.info('[XRay] Reset complete');
  }

  // ─── Status ──────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      traces: this._traces.size,
      groups: this._groups.size,
      samplingRules: this._samplingRules.size,
      encryptionType: this._encryptionConfig.Type,
    };
  }
}

module.exports = { XRaySimulator };
