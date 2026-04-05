'use strict';

const { randomUUID } = require('crypto');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');

const ACCOUNT = '000000000000';
const REGION = 'us-east-1';

/**
 * Athena Simulator
 * Suporta: StartQueryExecution, GetQueryExecution, GetQueryResults,
 *          StopQueryExecution, ListQueryExecutions, CreateNamedQuery,
 *          GetNamedQuery, ListNamedQueries, DeleteNamedQuery,
 *          CreateWorkGroup, GetWorkGroup, ListWorkGroups, DeleteWorkGroup
 */
class AthenaSimulator {
  constructor(config, store, logger) {
    this.config = config;
    this.store = store;
    this.logger = logger;

    /** @type {Map<string, Object>} queryExecutionId → execution */
    this.queryExecutions = new Map();

    /** @type {Map<string, Object>} namedQueryId → namedQuery */
    this.namedQueries = new Map();

    /** @type {Map<string, Object>} workGroupName → workGroup */
    this.workGroups = new Map();

    this.audit = new CloudTrailAudit('athena.amazonaws.com');
  }

  async initialize() {
    // Cria workgroup padrão
    if (!this.workGroups.has('primary')) {
      this.workGroups.set('primary', {
        Name: 'primary',
        State: 'ENABLED',
        Description: 'Primary workgroup',
        CreationTime: new Date().toISOString(),
        Configuration: {
          ResultConfiguration: { OutputLocation: 's3://aws-athena-query-results-local/' },
          EnforceWorkGroupConfiguration: false,
          PublishCloudWatchMetricsEnabled: false,
          BytesScannedCutoffPerQuery: 0,
          RequesterPaysEnabled: false,
        },
      });
    }

    try {
      const data = await this.store.load('athena');
      if (data) {
        if (data.queryExecutions) this.queryExecutions = new Map(Object.entries(data.queryExecutions));
        if (data.namedQueries) this.namedQueries = new Map(Object.entries(data.namedQueries));
        if (data.workGroups) this.workGroups = new Map(Object.entries(data.workGroups));
        this.logger.info(`[Athena] Loaded ${this.queryExecutions.size} executions, ${this.namedQueries.size} named queries`);
      }
    } catch {
      this.logger.debug('[Athena] No persisted data, starting fresh');
    }
  }

  async _persist() {
    try {
      await this.store.save('athena', {
        queryExecutions: Object.fromEntries(this.queryExecutions),
        namedQueries: Object.fromEntries(this.namedQueries),
        workGroups: Object.fromEntries(this.workGroups),
      });
    } catch (err) {
      this.logger.warn(`[Athena] Failed to persist: ${err.message}`);
    }
  }

  // ── Query Execution ──────────────────────────────────────────────────────

  async startQueryExecution(params) {
    const {
      QueryString,
      QueryExecutionContext = {},
      ResultConfiguration = {},
      WorkGroup = 'primary',
      ClientRequestToken,
    } = params;

    if (!QueryString) throw this._error('InvalidRequestException', 'QueryString is required');

    const wg = this.workGroups.get(WorkGroup);
    if (!wg) throw this._error('InvalidRequestException', `WorkGroup ${WorkGroup} does not exist`);

    const queryExecutionId = randomUUID();
    const outputLocation = ResultConfiguration.OutputLocation ||
      wg.Configuration?.ResultConfiguration?.OutputLocation ||
      `s3://aws-athena-query-results-local/${queryExecutionId}/`;

    const execution = {
      QueryExecutionId: queryExecutionId,
      Query: QueryString,
      StatementType: this._detectStatementType(QueryString),
      ResultConfiguration: { OutputLocation: outputLocation },
      QueryExecutionContext,
      Status: {
        State: 'SUCCEEDED',
        SubmissionDateTime: new Date().toISOString(),
        CompletionDateTime: new Date().toISOString(),
      },
      Statistics: {
        EngineExecutionTimeInMillis: Math.floor(Math.random() * 500) + 50,
        DataScannedInBytes: Math.floor(Math.random() * 1024 * 1024),
        TotalExecutionTimeInMillis: Math.floor(Math.random() * 600) + 100,
        QueryQueueTimeInMillis: 10,
        ServiceProcessingTimeInMillis: 20,
      },
      WorkGroup,
      _results: this._generateResults(QueryString),
    };

    this.queryExecutions.set(queryExecutionId, execution);
    await this._persist();

    this.audit.record({
      eventName: 'StartQueryExecution',
      readOnly: false,
      resources: [{ ARN: `arn:aws:athena:${REGION}:${ACCOUNT}:workgroup/${WorkGroup}`, type: 'AWS::Athena::WorkGroup' }],
      requestParameters: { queryString: QueryString, workGroup: WorkGroup },
    });

    this.logger.info(`[Athena] Query started: ${queryExecutionId}`);
    return { QueryExecutionId: queryExecutionId };
  }

  getQueryExecution({ QueryExecutionId }) {
    const exec = this.queryExecutions.get(QueryExecutionId);
    if (!exec) throw this._error('InvalidRequestException', `Query execution ${QueryExecutionId} not found`);

    const { _results, ...clean } = exec;
    this.audit.record({
      eventName: 'GetQueryExecution',
      readOnly: true,
      requestParameters: { queryExecutionId: QueryExecutionId },
    });
    return { QueryExecution: clean };
  }

  getQueryResults({ QueryExecutionId, MaxResults = 1000, NextToken }) {
    const exec = this.queryExecutions.get(QueryExecutionId);
    if (!exec) throw this._error('InvalidRequestException', `Query execution ${QueryExecutionId} not found`);
    if (exec.Status.State !== 'SUCCEEDED') {
      throw this._error('InvalidRequestException', `Query is in state ${exec.Status.State}`);
    }

    const rows = exec._results || [];
    const startIdx = NextToken ? parseInt(NextToken) : 0;
    const slice = rows.slice(startIdx, startIdx + MaxResults);

    this.audit.record({
      eventName: 'GetQueryResults',
      readOnly: true,
      requestParameters: { queryExecutionId: QueryExecutionId },
    });

    return {
      ResultSet: {
        Rows: slice,
        ResultSetMetadata: { ColumnInfo: exec._columnInfo || [] },
      },
      NextToken: rows.length > startIdx + MaxResults ? String(startIdx + MaxResults) : undefined,
    };
  }

  async stopQueryExecution({ QueryExecutionId }) {
    const exec = this.queryExecutions.get(QueryExecutionId);
    if (!exec) throw this._error('InvalidRequestException', `Query execution ${QueryExecutionId} not found`);

    exec.Status.State = 'CANCELLED';
    exec.Status.CompletionDateTime = new Date().toISOString();
    await this._persist();

    this.audit.record({ eventName: 'StopQueryExecution', readOnly: false, requestParameters: { queryExecutionId: QueryExecutionId } });
    return {};
  }

  listQueryExecutions({ MaxResults = 50, NextToken, WorkGroup } = {}) {
    let ids = Array.from(this.queryExecutions.keys());
    if (WorkGroup) ids = ids.filter(id => this.queryExecutions.get(id).WorkGroup === WorkGroup);

    const startIdx = NextToken ? parseInt(NextToken) : 0;
    const slice = ids.slice(startIdx, startIdx + MaxResults);

    return {
      QueryExecutionIds: slice,
      NextToken: ids.length > startIdx + MaxResults ? String(startIdx + MaxResults) : undefined,
    };
  }

  // ── Named Queries ────────────────────────────────────────────────────────

  async createNamedQuery(params) {
    const { Name, Description = '', Database, QueryString, WorkGroup = 'primary' } = params;
    if (!Name || !QueryString) throw this._error('InvalidRequestException', 'Name and QueryString are required');

    const namedQueryId = randomUUID();
    const query = { NamedQueryId: namedQueryId, Name, Description, Database, QueryString, WorkGroup };
    this.namedQueries.set(namedQueryId, query);
    await this._persist();

    this.audit.record({ eventName: 'CreateNamedQuery', readOnly: false, requestParameters: { name: Name } });
    return { NamedQueryId: namedQueryId };
  }

  getNamedQuery({ NamedQueryId }) {
    const q = this.namedQueries.get(NamedQueryId);
    if (!q) throw this._error('InvalidRequestException', `Named query ${NamedQueryId} not found`);
    return { NamedQuery: q };
  }

  listNamedQueries({ MaxResults = 50, NextToken, WorkGroup } = {}) {
    let ids = Array.from(this.namedQueries.keys());
    if (WorkGroup) ids = ids.filter(id => this.namedQueries.get(id).WorkGroup === WorkGroup);

    const startIdx = NextToken ? parseInt(NextToken) : 0;
    const slice = ids.slice(startIdx, startIdx + MaxResults);

    return {
      NamedQueryIds: slice,
      NextToken: ids.length > startIdx + MaxResults ? String(startIdx + MaxResults) : undefined,
    };
  }

  async deleteNamedQuery({ NamedQueryId }) {
    if (!this.namedQueries.has(NamedQueryId)) {
      throw this._error('InvalidRequestException', `Named query ${NamedQueryId} not found`);
    }
    this.namedQueries.delete(NamedQueryId);
    await this._persist();
    this.audit.record({ eventName: 'DeleteNamedQuery', readOnly: false, requestParameters: { namedQueryId: NamedQueryId } });
    return {};
  }

  // ── WorkGroups ───────────────────────────────────────────────────────────

  async createWorkGroup(params) {
    const { Name, Description = '', Configuration = {}, Tags = [] } = params;
    if (!Name) throw this._error('InvalidRequestException', 'Name is required');
    if (this.workGroups.has(Name)) throw this._error('InvalidRequestException', `WorkGroup ${Name} already exists`);

    const wg = {
      Name, Description, State: 'ENABLED', Tags,
      CreationTime: new Date().toISOString(),
      Configuration: {
        ResultConfiguration: Configuration.ResultConfiguration || { OutputLocation: `s3://aws-athena-query-results-local/${Name}/` },
        EnforceWorkGroupConfiguration: Configuration.EnforceWorkGroupConfiguration || false,
        PublishCloudWatchMetricsEnabled: Configuration.PublishCloudWatchMetricsEnabled || false,
        BytesScannedCutoffPerQuery: Configuration.BytesScannedCutoffPerQuery || 0,
        RequesterPaysEnabled: Configuration.RequesterPaysEnabled || false,
      },
    };

    this.workGroups.set(Name, wg);
    await this._persist();
    this.audit.record({ eventName: 'CreateWorkGroup', readOnly: false, requestParameters: { name: Name } });
    return {};
  }

  getWorkGroup({ WorkGroup }) {
    const wg = this.workGroups.get(WorkGroup);
    if (!wg) throw this._error('InvalidRequestException', `WorkGroup ${WorkGroup} not found`);
    return { WorkGroup: wg };
  }

  listWorkGroups({ MaxResults = 50, NextToken } = {}) {
    const all = Array.from(this.workGroups.values()).map(({ Name, State, Description, CreationTime }) => ({
      Name, State, Description, CreationTime,
    }));
    const startIdx = NextToken ? parseInt(NextToken) : 0;
    const slice = all.slice(startIdx, startIdx + MaxResults);
    return {
      WorkGroups: slice,
      NextToken: all.length > startIdx + MaxResults ? String(startIdx + MaxResults) : undefined,
    };
  }

  async deleteWorkGroup({ WorkGroup, RecursiveDeleteOption = false }) {
    if (WorkGroup === 'primary') throw this._error('InvalidRequestException', 'Cannot delete primary workgroup');
    if (!this.workGroups.has(WorkGroup)) throw this._error('InvalidRequestException', `WorkGroup ${WorkGroup} not found`);

    if (RecursiveDeleteOption) {
      for (const [id, exec] of this.queryExecutions.entries()) {
        if (exec.WorkGroup === WorkGroup) this.queryExecutions.delete(id);
      }
    }

    this.workGroups.delete(WorkGroup);
    await this._persist();
    this.audit.record({ eventName: 'DeleteWorkGroup', readOnly: false, requestParameters: { workGroup: WorkGroup } });
    return {};
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _detectStatementType(query) {
    const q = query.trim().toUpperCase();
    if (q.startsWith('SELECT')) return 'DML';
    if (q.startsWith('CREATE') || q.startsWith('DROP') || q.startsWith('ALTER')) return 'DDL';
    if (q.startsWith('INSERT') || q.startsWith('UPDATE') || q.startsWith('DELETE')) return 'DML';
    return 'UTILITY';
  }

  _generateResults(query) {
    const q = query.trim().toUpperCase();
    if (!q.startsWith('SELECT')) return [{ Data: [{ VarCharValue: 'OK' }] }];

    // Gera resultado simulado com header + 2 linhas de exemplo
    return [
      { Data: [{ VarCharValue: 'id' }, { VarCharValue: 'value' }, { VarCharValue: 'timestamp' }] },
      { Data: [{ VarCharValue: '1' }, { VarCharValue: 'sample-data-1' }, { VarCharValue: new Date().toISOString() }] },
      { Data: [{ VarCharValue: '2' }, { VarCharValue: 'sample-data-2' }, { VarCharValue: new Date().toISOString() }] },
    ];
  }

  _error(code, message) {
    const err = new Error(message);
    err.code = code;
    err.statusCode = 400;
    return err;
  }

  getStats() {
    return {
      queryExecutions: this.queryExecutions.size,
      namedQueries: this.namedQueries.size,
      workGroups: this.workGroups.size,
    };
  }

  async reset() {
    this.queryExecutions.clear();
    this.namedQueries.clear();
    this.workGroups.clear();
    await this._persist();
  }
}

module.exports = { AthenaSimulator };
