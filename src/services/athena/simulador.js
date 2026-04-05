'use strict';

/**
 * @fileoverview Athena Simulator
 *
 * Suporta:
 *  Query Execution:
 *   - StartQueryExecution
 *   - StopQueryExecution
 *   - GetQueryExecution
 *   - ListQueryExecutions
 *   - BatchGetQueryExecution
 *
 *  Query Results:
 *   - GetQueryResults
 *
 *  Named Queries:
 *   - CreateNamedQuery
 *   - DeleteNamedQuery
 *   - GetNamedQuery
 *   - ListNamedQueries
 *   - BatchGetNamedQuery
 *
 *  Workgroups:
 *   - CreateWorkGroup
 *   - DeleteWorkGroup
 *   - UpdateWorkGroup
 *   - GetWorkGroup
 *   - ListWorkGroups
 *
 *  Data Catalogs:
 *   - CreateDataCatalog
 *   - DeleteDataCatalog
 *   - UpdateDataCatalog
 *   - GetDataCatalog
 *   - ListDataCatalogs
 *
 *  Databases:
 *   - ListDatabases
 *   - GetDatabase
 *
 *  TableMetadata:
 *   - ListTableMetadata
 *   - GetTableMetadata
 *
 *  Prepared Statements:
 *   - CreatePreparedStatement
 *   - UpdatePreparedStatement
 *   - DeletePreparedStatement
 *   - GetPreparedStatement
 *   - ListPreparedStatements
 *
 *  Tags:
 *   - TagResource / UntagResource / ListTagsForResource
 *
 *  Integração:
 *   - Execução de queries simuladas contra dados do S3
 *   - Suporte a DDL (CREATE TABLE, CREATE DATABASE, DROP TABLE, DROP DATABASE)
 *   - Suporte a DML (SELECT, INSERT, UPDATE, DELETE)
 *   - Parser simples de SQL para retornar resultados simulados
 *   - Persistência via LocalStore
 */

const { randomUUID } = require('crypto');

// ─── Erros tipados ────────────────────────────────────────────────────────────

class AthenaError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const Errors = {
  InvalidRequest: (msg) =>
    new AthenaError('InvalidRequestException', msg, 400),
  QueryNotFound: (id) =>
    new AthenaError('InvalidRequestException', `Query execution not found: ${id}`, 400),
  NamedQueryNotFound: (id) =>
    new AthenaError('InvalidRequestException', `Named query not found: ${id}`, 400),
  WorkGroupNotFound: (name) =>
    new AthenaError('InvalidRequestException', `WorkGroup not found: ${name}`, 400),
  WorkGroupAlreadyExists: (name) =>
    new AthenaError('InvalidRequestException', `WorkGroup already exists: ${name}`, 400),
  DataCatalogNotFound: (name) =>
    new AthenaError('InvalidRequestException', `DataCatalog not found: ${name}`, 404),
  DataCatalogAlreadyExists: (name) =>
    new AthenaError('InvalidRequestException', `DataCatalog already exists: ${name}`, 400),
  DatabaseNotFound: (name) =>
    new AthenaError('MetadataException', `Database not found: ${name}`, 404),
  TableNotFound: (name) =>
    new AthenaError('MetadataException', `Table not found: ${name}`, 404),
  PreparedStatementNotFound: (name) =>
    new AthenaError('ResourceNotFoundException', `Prepared statement not found: ${name}`, 404),
  TooManyRequests: () =>
    new AthenaError('TooManyRequestsException', 'Too many requests', 429),
  QueryAlreadyStopped: (id) =>
    new AthenaError('InvalidRequestException', `Query execution already stopped: ${id}`, 400),
};

// ─── Parser SQL simples ───────────────────────────────────────────────────────

function parseSql(sql) {
  const normalized = sql.trim().replace(/\s+/g, ' ').toUpperCase();

  if (normalized.startsWith('SELECT')) return { type: 'SELECT', sql };
  if (normalized.startsWith('INSERT')) return { type: 'INSERT', sql };
  if (normalized.startsWith('UPDATE')) return { type: 'UPDATE', sql };
  if (normalized.startsWith('DELETE')) return { type: 'DELETE', sql };
  if (normalized.startsWith('CREATE TABLE')) return { type: 'CREATE_TABLE', sql };
  if (normalized.startsWith('CREATE DATABASE') || normalized.startsWith('CREATE SCHEMA')) return { type: 'CREATE_DATABASE', sql };
  if (normalized.startsWith('DROP TABLE')) return { type: 'DROP_TABLE', sql };
  if (normalized.startsWith('DROP DATABASE') || normalized.startsWith('DROP SCHEMA')) return { type: 'DROP_DATABASE', sql };
  if (normalized.startsWith('SHOW')) return { type: 'SHOW', sql };
  if (normalized.startsWith('DESCRIBE') || normalized.startsWith('DESC')) return { type: 'DESCRIBE', sql };
  if (normalized.startsWith('ALTER')) return { type: 'ALTER', sql };
  if (normalized.startsWith('MSCK REPAIR TABLE')) return { type: 'MSCK_REPAIR', sql };

  return { type: 'UNKNOWN', sql };
}

function generateSimulatedResults(parsed) {
  switch (parsed.type) {
    case 'SELECT': {
      const columns = ['id', 'name', 'value', 'timestamp'];
      const rows = Array.from({ length: 3 }, (_, i) => ({
        Data: [
          { VarCharValue: String(i + 1) },
          { VarCharValue: `item_${i + 1}` },
          { VarCharValue: String(Math.floor(Math.random() * 1000)) },
          { VarCharValue: new Date().toISOString() },
        ],
      }));
      return {
        ResultSet: {
          Rows: [
            { Data: columns.map((c) => ({ VarCharValue: c })) },
            ...rows,
          ],
          ResultSetMetadata: {
            ColumnInfo: columns.map((c, i) => ({
              CatalogName: 'hive',
              SchemaName: '',
              TableName: '',
              Name: c,
              Label: c,
              Type: i === 3 ? 'varchar' : i === 2 ? 'bigint' : 'varchar',
              Precision: 2147483647,
              Scale: 0,
              Nullable: 'UNKNOWN',
              CaseSensitive: i !== 2,
            })),
          },
        },
        NextToken: null,
      };
    }
    case 'CREATE_TABLE':
    case 'CREATE_DATABASE':
    case 'DROP_TABLE':
    case 'DROP_DATABASE':
    case 'INSERT':
    case 'UPDATE':
    case 'DELETE':
    case 'ALTER':
    case 'MSCK_REPAIR':
      return {
        ResultSet: { Rows: [], ResultSetMetadata: { ColumnInfo: [] } },
        NextToken: null,
        UpdateCount: 1,
      };
    case 'SHOW': {
      return {
        ResultSet: {
          Rows: [{ Data: [{ VarCharValue: 'tab_name' }] }],
          ResultSetMetadata: { ColumnInfo: [{ Name: 'tab_name', Type: 'varchar' }] },
        },
        NextToken: null,
      };
    }
    default:
      return {
        ResultSet: { Rows: [], ResultSetMetadata: { ColumnInfo: [] } },
        NextToken: null,
      };
  }
}

// ─── Simulador ────────────────────────────────────────────────────────────────

class AthenaSimulator {
  constructor(config, store, logger) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.region = config?.region || 'us-east-1';
    this.accountId = config?.accountId || '000000000000';

    // State
    this.queryExecutions = new Map();   // executionId → execution
    this.queryResults = new Map();      // executionId → results
    this.namedQueries = new Map();      // queryId → namedQuery
    this.workgroups = new Map();        // name → workgroup
    this.dataCatalogs = new Map();      // name → catalog
    this.databases = new Map();         // catalogName.dbName → database
    this.tables = new Map();            // catalogName.dbName.tableName → table
    this.preparedStatements = new Map();// workgroup.name → statement
    this.tags = new Map();              // arn → tags

    // Injeções cross-service
    this.s3Simulator = null;

    // Workgroup padrão
    this._initDefaults();
  }

  _initDefaults() {
    this.workgroups.set('primary', {
      Name: 'primary',
      State: 'ENABLED',
      Description: 'Primary workgroup',
      Configuration: {
        ResultConfiguration: {
          OutputLocation: 's3://aws-athena-query-results-local/',
          EncryptionConfiguration: null,
        },
        EnforceWorkGroupConfiguration: false,
        PublishCloudWatchMetricsEnabled: false,
        BytesScannedCutoffPerQuery: null,
        RequesterPaysEnabled: false,
        EngineVersion: { SelectedEngineVersion: 'Athena engine version 3', EffectiveEngineVersion: 'Athena engine version 3' },
      },
      CreationTime: new Date().toISOString(),
    });

    this.dataCatalogs.set('AwsDataCatalog', {
      Name: 'AwsDataCatalog',
      Description: 'AWS Glue based Data Catalog',
      Type: 'GLUE',
      Parameters: {},
      Tags: [],
    });

    // Banco de dados padrão
    this.databases.set('AwsDataCatalog.default', {
      Name: 'default',
      Description: 'Default Hive database',
      Parameters: {},
    });
  }

  // ── Persistência ──────────────────────────────────────────────────────────

  async load() {
    try {
      const data = await this.store.load('athena');
      if (!data) return;

      if (data.queryExecutions) {
        for (const [k, v] of Object.entries(data.queryExecutions)) {
          this.queryExecutions.set(k, v);
        }
      }
      if (data.queryResults) {
        for (const [k, v] of Object.entries(data.queryResults)) {
          this.queryResults.set(k, v);
        }
      }
      if (data.namedQueries) {
        for (const [k, v] of Object.entries(data.namedQueries)) {
          this.namedQueries.set(k, v);
        }
      }
      if (data.workgroups) {
        for (const [k, v] of Object.entries(data.workgroups)) {
          this.workgroups.set(k, v);
        }
      }
      if (data.dataCatalogs) {
        for (const [k, v] of Object.entries(data.dataCatalogs)) {
          this.dataCatalogs.set(k, v);
        }
      }
      if (data.databases) {
        for (const [k, v] of Object.entries(data.databases)) {
          this.databases.set(k, v);
        }
      }
      if (data.tables) {
        for (const [k, v] of Object.entries(data.tables)) {
          this.tables.set(k, v);
        }
      }
      if (data.preparedStatements) {
        for (const [k, v] of Object.entries(data.preparedStatements)) {
          this.preparedStatements.set(k, v);
        }
      }
      if (data.tags) {
        for (const [k, v] of Object.entries(data.tags)) {
          this.tags.set(k, v);
        }
      }

      this.logger.debug('[Athena] State loaded from store');
    } catch (err) {
      this.logger.warn('[Athena] Could not load state:', err.message);
    }
  }

  async save() {
    try {
      await this.store.save('athena', {
        queryExecutions: Object.fromEntries(this.queryExecutions),
        queryResults: Object.fromEntries(this.queryResults),
        namedQueries: Object.fromEntries(this.namedQueries),
        workgroups: Object.fromEntries(this.workgroups),
        dataCatalogs: Object.fromEntries(this.dataCatalogs),
        databases: Object.fromEntries(this.databases),
        tables: Object.fromEntries(this.tables),
        preparedStatements: Object.fromEntries(this.preparedStatements),
        tags: Object.fromEntries(this.tags),
      });
    } catch (err) {
      this.logger.warn('[Athena] Could not save state:', err.message);
    }
  }

  reset() {
    this.queryExecutions.clear();
    this.queryResults.clear();
    this.namedQueries.clear();
    this.workgroups.clear();
    this.dataCatalogs.clear();
    this.databases.clear();
    this.tables.clear();
    this.preparedStatements.clear();
    this.tags.clear();
    this._initDefaults();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _arn(type, name) {
    return `arn:aws:athena:${this.region}:${this.accountId}:${type}/${name}`;
  }

  _wgArn(name) { return this._arn('workgroup', name); }
  _catalogArn(name) { return this._arn('datacatalog', name); }

  _resolveWorkgroup(name) {
    const wgName = name || 'primary';
    const wg = this.workgroups.get(wgName);
    if (!wg) throw Errors.WorkGroupNotFound(wgName);
    return wg;
  }

  _resolveOutputLocation(params, wg) {
    return (
      params.ResultConfiguration?.OutputLocation ||
      wg.Configuration?.ResultConfiguration?.OutputLocation ||
      `s3://aws-athena-query-results-${this.accountId}-${this.region}/`
    );
  }

  _simulateQueryAsync(executionId, parsed) {
    const delay = 200 + Math.floor(Math.random() * 300);
    setTimeout(() => {
      const execution = this.queryExecutions.get(executionId);
      if (!execution || execution.Status.State === 'CANCELLED') return;

      const results = generateSimulatedResults(parsed);
      const dataScanned = Math.floor(Math.random() * 10000000);

      execution.Status.State = 'SUCCEEDED';
      execution.Status.CompletionDateTime = new Date().toISOString();
      execution.Statistics = {
        EngineExecutionTimeInMillis: delay,
        DataScannedInBytes: dataScanned,
        DataManifestLocation: execution.ResultConfiguration.OutputLocation + executionId + '-manifest.csv',
        TotalExecutionTimeInMillis: delay + 50,
        QueryQueueTimeInMillis: 50,
        QueryPlanningTimeInMillis: 30,
        ServiceProcessingTimeInMillis: 20,
      };

      this.queryResults.set(executionId, results);
      this.queryExecutions.set(executionId, execution);
      this.save();
    }, delay);
  }

  // ── Query Execution ────────────────────────────────────────────────────────

  startQueryExecution(params) {
    const { QueryString, ClientRequestToken, QueryExecutionContext, ResultConfiguration, WorkGroup } = params;

    if (!QueryString) throw Errors.InvalidRequest('QueryString is required');

    const wg = this._resolveWorkgroup(WorkGroup);
    const executionId = ClientRequestToken || randomUUID();

    if (this.queryExecutions.has(executionId)) {
      return { QueryExecutionId: executionId };
    }

    const parsed = parseSql(QueryString);
    const outputLocation = this._resolveOutputLocation(params, wg);

    const execution = {
      QueryExecutionId: executionId,
      Query: QueryString,
      StatementType: this._getStatementType(parsed.type),
      ResultConfiguration: {
        OutputLocation: outputLocation + executionId + '.csv',
        EncryptionConfiguration: params.ResultConfiguration?.EncryptionConfiguration || null,
      },
      QueryExecutionContext: {
        Database: QueryExecutionContext?.Database || 'default',
        Catalog: QueryExecutionContext?.Catalog || 'AwsDataCatalog',
      },
      Status: {
        State: 'RUNNING',
        SubmissionDateTime: new Date().toISOString(),
        CompletionDateTime: null,
        StateChangeReason: null,
        AthenaError: null,
      },
      Statistics: null,
      WorkGroup: wg.Name,
      EngineVersion: wg.Configuration?.EngineVersion || { SelectedEngineVersion: 'AUTO', EffectiveEngineVersion: 'Athena engine version 3' },
      ExecutionParameters: params.ExecutionParameters || null,
    };

    this.queryExecutions.set(executionId, execution);
    this._simulateQueryAsync(executionId, parsed);
    this.save();

    this.logger.debug(`[Athena] StartQueryExecution: ${executionId} - ${parsed.type}`);
    return { QueryExecutionId: executionId };
  }

  _getStatementType(type) {
    if (['SELECT', 'SHOW', 'DESCRIBE'].includes(type)) return 'DQL';
    if (['INSERT', 'UPDATE', 'DELETE'].includes(type)) return 'DML';
    return 'DDL';
  }

  stopQueryExecution(params) {
    const { QueryExecutionId } = params;
    const execution = this.queryExecutions.get(QueryExecutionId);
    if (!execution) throw Errors.QueryNotFound(QueryExecutionId);

    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(execution.Status.State)) {
      throw Errors.QueryAlreadyStopped(QueryExecutionId);
    }

    execution.Status.State = 'CANCELLED';
    execution.Status.CompletionDateTime = new Date().toISOString();
    execution.Status.StateChangeReason = 'Query was cancelled by the user';
    this.queryExecutions.set(QueryExecutionId, execution);
    this.save();

    return {};
  }

  getQueryExecution(params) {
    const { QueryExecutionId } = params;
    const execution = this.queryExecutions.get(QueryExecutionId);
    if (!execution) throw Errors.QueryNotFound(QueryExecutionId);
    return { QueryExecution: execution };
  }

  listQueryExecutions(params) {
    const { WorkGroup, NextToken, MaxResults = 50 } = params;
    let executions = [...this.queryExecutions.values()];

    if (WorkGroup) {
      executions = executions.filter((e) => e.WorkGroup === WorkGroup);
    }

    const ids = executions.map((e) => e.QueryExecutionId);
    const start = NextToken ? ids.indexOf(NextToken) + 1 : 0;
    const page = ids.slice(start, start + MaxResults);
    const next = start + MaxResults < ids.length ? ids[start + MaxResults] : null;

    return { QueryExecutionIds: page, NextToken: next };
  }

  batchGetQueryExecution(params) {
    const { QueryExecutionIds } = params;
    if (!Array.isArray(QueryExecutionIds)) throw Errors.InvalidRequest('QueryExecutionIds is required');

    const found = [];
    const unprocessed = [];

    for (const id of QueryExecutionIds) {
      const ex = this.queryExecutions.get(id);
      if (ex) found.push(ex);
      else unprocessed.push({ QueryExecutionId: id, ErrorCode: 'InvalidRequestException', ErrorMessage: `Query execution not found: ${id}` });
    }

    return { QueryExecutions: found, UnprocessedQueryExecutionIds: unprocessed };
  }

  getQueryResults(params) {
    const { QueryExecutionId, NextToken, MaxResults = 1000 } = params;
    const execution = this.queryExecutions.get(QueryExecutionId);
    if (!execution) throw Errors.QueryNotFound(QueryExecutionId);

    if (execution.Status.State === 'RUNNING' || execution.Status.State === 'QUEUED') {
      throw Errors.InvalidRequest(`Query execution ${QueryExecutionId} is still running`);
    }
    if (execution.Status.State === 'CANCELLED') {
      throw Errors.InvalidRequest(`Query execution ${QueryExecutionId} was cancelled`);
    }
    if (execution.Status.State === 'FAILED') {
      throw Errors.InvalidRequest(`Query execution ${QueryExecutionId} failed: ${execution.Status.StateChangeReason}`);
    }

    const results = this.queryResults.get(QueryExecutionId) || {
      ResultSet: { Rows: [], ResultSetMetadata: { ColumnInfo: [] } },
      NextToken: null,
    };

    const rows = results.ResultSet.Rows;
    const start = NextToken ? parseInt(NextToken, 10) : 0;
    const page = rows.slice(start, start + MaxResults);
    const next = start + MaxResults < rows.length ? String(start + MaxResults) : null;

    return {
      ResultSet: { ...results.ResultSet, Rows: page },
      NextToken: next,
      UpdateCount: results.UpdateCount || 0,
    };
  }

  getQueryRuntimeStatistics(params) {
    const { QueryExecutionId } = params;
    const execution = this.queryExecutions.get(QueryExecutionId);
    if (!execution) throw Errors.QueryNotFound(QueryExecutionId);

    return {
      QueryRuntimeStatistics: {
        Timeline: {
          QueryQueueTimeInMillis: 50,
          QueryPlanningTimeInMillis: 30,
          EngineExecutionTimeInMillis: execution.Statistics?.EngineExecutionTimeInMillis || 0,
          ServiceProcessingTimeInMillis: 20,
          TotalExecutionTimeInMillis: execution.Statistics?.TotalExecutionTimeInMillis || 0,
        },
        Rows: {
          InputRows: 100,
          InputBytes: execution.Statistics?.DataScannedInBytes || 0,
          OutputRows: 3,
          OutputBytes: 1024,
        },
        OutputStage: null,
      },
    };
  }

  // ── Named Queries ─────────────────────────────────────────────────────────

  createNamedQuery(params) {
    const { Name, Description, Database, QueryString, ClientRequestToken, WorkGroup } = params;
    if (!Name) throw Errors.InvalidRequest('Name is required');
    if (!QueryString) throw Errors.InvalidRequest('QueryString is required');
    if (!Database) throw Errors.InvalidRequest('Database is required');

    const queryId = ClientRequestToken || randomUUID();

    const query = {
      QueryId: queryId,
      Name,
      Description: Description || '',
      Database,
      QueryString,
      WorkGroup: WorkGroup || 'primary',
      NamedQueryId: queryId,
    };

    this.namedQueries.set(queryId, query);
    this.save();

    this.logger.debug(`[Athena] CreateNamedQuery: ${queryId} (${Name})`);
    return { NamedQueryId: queryId };
  }

  deleteNamedQuery(params) {
    const { NamedQueryId } = params;
    if (!this.namedQueries.has(NamedQueryId)) throw Errors.NamedQueryNotFound(NamedQueryId);
    this.namedQueries.delete(NamedQueryId);
    this.save();
    return {};
  }

  getNamedQuery(params) {
    const { NamedQueryId } = params;
    const query = this.namedQueries.get(NamedQueryId);
    if (!query) throw Errors.NamedQueryNotFound(NamedQueryId);
    return { NamedQuery: query };
  }

  listNamedQueries(params) {
    const { WorkGroup, NextToken, MaxResults = 50 } = params;
    let queries = [...this.namedQueries.values()];

    if (WorkGroup) {
      queries = queries.filter((q) => q.WorkGroup === WorkGroup);
    }

    const ids = queries.map((q) => q.QueryId);
    const start = NextToken ? ids.indexOf(NextToken) + 1 : 0;
    const page = ids.slice(start, start + MaxResults);
    const next = start + MaxResults < ids.length ? ids[start + MaxResults] : null;

    return { NamedQueryIds: page, NextToken: next };
  }

  batchGetNamedQuery(params) {
    const { NamedQueryIds } = params;
    if (!Array.isArray(NamedQueryIds)) throw Errors.InvalidRequest('NamedQueryIds is required');

    const found = [];
    const unprocessed = [];

    for (const id of NamedQueryIds) {
      const q = this.namedQueries.get(id);
      if (q) found.push(q);
      else unprocessed.push({ NamedQueryId: id, ErrorCode: 'InvalidRequestException', ErrorMessage: `Named query not found: ${id}` });
    }

    return { NamedQueries: found, UnprocessedNamedQueryIds: unprocessed };
  }

  // ── WorkGroups ────────────────────────────────────────────────────────────

  createWorkGroup(params) {
    const { Name, Description, Configuration, Tags } = params;
    if (!Name) throw Errors.InvalidRequest('Name is required');
    if (this.workgroups.has(Name)) throw Errors.WorkGroupAlreadyExists(Name);

    const wg = {
      Name,
      State: 'ENABLED',
      Description: Description || '',
      Configuration: Configuration || {
        ResultConfiguration: { OutputLocation: `s3://aws-athena-query-results-${Name}/` },
        EnforceWorkGroupConfiguration: false,
        PublishCloudWatchMetricsEnabled: false,
        BytesScannedCutoffPerQuery: null,
        RequesterPaysEnabled: false,
        EngineVersion: { SelectedEngineVersion: 'AUTO', EffectiveEngineVersion: 'Athena engine version 3' },
      },
      CreationTime: new Date().toISOString(),
    };

    this.workgroups.set(Name, wg);

    const arn = this._wgArn(Name);
    if (Tags && Tags.length > 0) {
      this.tags.set(arn, Tags);
    }

    this.save();
    this.logger.debug(`[Athena] CreateWorkGroup: ${Name}`);
    return {};
  }

  deleteWorkGroup(params) {
    const { WorkGroup, RecursiveDeleteOption } = params;
    if (!this.workgroups.has(WorkGroup)) throw Errors.WorkGroupNotFound(WorkGroup);
    if (WorkGroup === 'primary') throw Errors.InvalidRequest('Cannot delete the primary workgroup');

    if (RecursiveDeleteOption) {
      for (const [id, ex] of this.queryExecutions) {
        if (ex.WorkGroup === WorkGroup) {
          this.queryExecutions.delete(id);
          this.queryResults.delete(id);
        }
      }
      for (const [id, q] of this.namedQueries) {
        if (q.WorkGroup === WorkGroup) this.namedQueries.delete(id);
      }
    }

    this.workgroups.delete(WorkGroup);
    this.save();
    return {};
  }

  updateWorkGroup(params) {
    const { WorkGroup, Description, Configuration, State } = params;
    const wg = this.workgroups.get(WorkGroup);
    if (!wg) throw Errors.WorkGroupNotFound(WorkGroup);

    if (Description !== undefined) wg.Description = Description;
    if (State !== undefined) wg.State = State;
    if (Configuration) {
      wg.Configuration = { ...wg.Configuration, ...Configuration };
    }

    this.workgroups.set(WorkGroup, wg);
    this.save();
    return {};
  }

  getWorkGroup(params) {
    const { WorkGroup } = params;
    const wg = this.workgroups.get(WorkGroup);
    if (!wg) throw Errors.WorkGroupNotFound(WorkGroup);
    return { WorkGroup: wg };
  }

  listWorkGroups(params) {
    const { NextToken, MaxResults = 50 } = params;
    const all = [...this.workgroups.values()].map((wg) => ({
      Name: wg.Name,
      State: wg.State,
      Description: wg.Description,
      CreationTime: wg.CreationTime,
      EngineVersion: wg.Configuration?.EngineVersion || null,
    }));

    const start = NextToken ? all.findIndex((w) => w.Name === NextToken) + 1 : 0;
    const page = all.slice(start, start + MaxResults);
    const next = start + MaxResults < all.length ? all[start + MaxResults].Name : null;

    return { WorkGroups: page, NextToken: next };
  }

  // ── Data Catalogs ─────────────────────────────────────────────────────────

  createDataCatalog(params) {
    const { Name, Type, Description, Parameters, Tags } = params;
    if (!Name) throw Errors.InvalidRequest('Name is required');
    if (!Type) throw Errors.InvalidRequest('Type is required');
    if (this.dataCatalogs.has(Name)) throw Errors.DataCatalogAlreadyExists(Name);

    const catalog = {
      Name,
      Description: Description || '',
      Type,
      Parameters: Parameters || {},
      Tags: Tags || [],
    };

    this.dataCatalogs.set(Name, catalog);
    const arn = this._catalogArn(Name);
    if (Tags && Tags.length > 0) this.tags.set(arn, Tags);

    this.save();
    this.logger.debug(`[Athena] CreateDataCatalog: ${Name}`);
    return {};
  }

  deleteDataCatalog(params) {
    const { Name } = params;
    if (!this.dataCatalogs.has(Name)) throw Errors.DataCatalogNotFound(Name);
    if (Name === 'AwsDataCatalog') throw Errors.InvalidRequest('Cannot delete the default AwsDataCatalog');

    this.dataCatalogs.delete(Name);
    this.save();
    return {};
  }

  updateDataCatalog(params) {
    const { Name, Type, Description, Parameters } = params;
    const catalog = this.dataCatalogs.get(Name);
    if (!catalog) throw Errors.DataCatalogNotFound(Name);

    if (Type !== undefined) catalog.Type = Type;
    if (Description !== undefined) catalog.Description = Description;
    if (Parameters !== undefined) catalog.Parameters = Parameters;

    this.dataCatalogs.set(Name, catalog);
    this.save();
    return {};
  }

  getDataCatalog(params) {
    const { Name } = params;
    const catalog = this.dataCatalogs.get(Name);
    if (!catalog) throw Errors.DataCatalogNotFound(Name);
    return { DataCatalog: catalog };
  }

  listDataCatalogs(params) {
    const { NextToken, MaxResults = 50 } = params;
    const all = [...this.dataCatalogs.values()].map(({ Name, Description, Type }) => ({ CatalogName: Name, Description, Type }));
    const start = NextToken ? all.findIndex((c) => c.CatalogName === NextToken) + 1 : 0;
    const page = all.slice(start, start + MaxResults);
    const next = start + MaxResults < all.length ? all[start + MaxResults].CatalogName : null;
    return { DataCatalogsSummary: page, NextToken: next };
  }

  // ── Databases ─────────────────────────────────────────────────────────────

  listDatabases(params) {
    const { CatalogName, NextToken, MaxResults = 50 } = params;
    if (!CatalogName) throw Errors.InvalidRequest('CatalogName is required');
    if (!this.dataCatalogs.has(CatalogName)) throw Errors.DataCatalogNotFound(CatalogName);

    const all = [...this.databases.entries()]
      .filter(([k]) => k.startsWith(CatalogName + '.'))
      .map(([, v]) => v);

    const start = NextToken ? all.findIndex((d) => d.Name === NextToken) + 1 : 0;
    const page = all.slice(start, start + MaxResults);
    const next = start + MaxResults < all.length ? all[start + MaxResults].Name : null;

    return { DatabaseList: page, NextToken: next };
  }

  getDatabase(params) {
    const { CatalogName, DatabaseName } = params;
    if (!CatalogName) throw Errors.InvalidRequest('CatalogName is required');
    if (!DatabaseName) throw Errors.InvalidRequest('DatabaseName is required');

    const key = `${CatalogName}.${DatabaseName}`;
    const db = this.databases.get(key);
    if (!db) throw Errors.DatabaseNotFound(DatabaseName);
    return { Database: db };
  }

  // ── Table Metadata ────────────────────────────────────────────────────────

  listTableMetadata(params) {
    const { CatalogName, DatabaseName, Expression, NextToken, MaxResults = 50 } = params;
    if (!CatalogName) throw Errors.InvalidRequest('CatalogName is required');
    if (!DatabaseName) throw Errors.InvalidRequest('DatabaseName is required');

    const prefix = `${CatalogName}.${DatabaseName}.`;
    let tables = [...this.tables.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);

    if (Expression) {
      const re = new RegExp(Expression.replace(/\*/g, '.*'), 'i');
      tables = tables.filter((t) => re.test(t.Name));
    }

    const start = NextToken ? tables.findIndex((t) => t.Name === NextToken) + 1 : 0;
    const page = tables.slice(start, start + MaxResults);
    const next = start + MaxResults < tables.length ? tables[start + MaxResults].Name : null;

    return { TableMetadataList: page, NextToken: next };
  }

  getTableMetadata(params) {
    const { CatalogName, DatabaseName, TableName } = params;
    if (!CatalogName) throw Errors.InvalidRequest('CatalogName is required');
    if (!DatabaseName) throw Errors.InvalidRequest('DatabaseName is required');
    if (!TableName) throw Errors.InvalidRequest('TableName is required');

    const key = `${CatalogName}.${DatabaseName}.${TableName}`;
    const table = this.tables.get(key);
    if (!table) throw Errors.TableNotFound(TableName);
    return { TableMetadata: table };
  }

  // ── Prepared Statements ───────────────────────────────────────────────────

  createPreparedStatement(params) {
    const { StatementName, WorkGroup, QueryStatement, Description } = params;
    if (!StatementName) throw Errors.InvalidRequest('StatementName is required');
    if (!WorkGroup) throw Errors.InvalidRequest('WorkGroup is required');
    if (!QueryStatement) throw Errors.InvalidRequest('QueryStatement is required');

    this._resolveWorkgroup(WorkGroup);

    const key = `${WorkGroup}.${StatementName}`;
    const stmt = {
      StatementName,
      WorkGroupName: WorkGroup,
      QueryStatement,
      Description: Description || '',
      LastModifiedTime: new Date().toISOString(),
    };

    this.preparedStatements.set(key, stmt);
    this.save();
    this.logger.debug(`[Athena] CreatePreparedStatement: ${key}`);
    return {};
  }

  updatePreparedStatement(params) {
    const { StatementName, WorkGroup, QueryStatement, Description } = params;
    if (!StatementName) throw Errors.InvalidRequest('StatementName is required');
    if (!WorkGroup) throw Errors.InvalidRequest('WorkGroup is required');

    const key = `${WorkGroup}.${StatementName}`;
    const stmt = this.preparedStatements.get(key);
    if (!stmt) throw Errors.PreparedStatementNotFound(StatementName);

    if (QueryStatement) stmt.QueryStatement = QueryStatement;
    if (Description !== undefined) stmt.Description = Description;
    stmt.LastModifiedTime = new Date().toISOString();

    this.preparedStatements.set(key, stmt);
    this.save();
    return {};
  }

  deletePreparedStatement(params) {
    const { StatementName, WorkGroup } = params;
    if (!StatementName) throw Errors.InvalidRequest('StatementName is required');
    if (!WorkGroup) throw Errors.InvalidRequest('WorkGroup is required');

    const key = `${WorkGroup}.${StatementName}`;
    if (!this.preparedStatements.has(key)) throw Errors.PreparedStatementNotFound(StatementName);

    this.preparedStatements.delete(key);
    this.save();
    return {};
  }

  getPreparedStatement(params) {
    const { StatementName, WorkGroup } = params;
    if (!StatementName) throw Errors.InvalidRequest('StatementName is required');
    if (!WorkGroup) throw Errors.InvalidRequest('WorkGroup is required');

    const key = `${WorkGroup}.${StatementName}`;
    const stmt = this.preparedStatements.get(key);
    if (!stmt) throw Errors.PreparedStatementNotFound(StatementName);
    return { PreparedStatement: stmt };
  }

  listPreparedStatements(params) {
    const { WorkGroup, NextToken, MaxResults = 50 } = params;
    if (!WorkGroup) throw Errors.InvalidRequest('WorkGroup is required');
    this._resolveWorkgroup(WorkGroup);

    const all = [...this.preparedStatements.entries()]
      .filter(([k]) => k.startsWith(WorkGroup + '.'))
      .map(([, v]) => ({ StatementName: v.StatementName, LastModifiedTime: v.LastModifiedTime }));

    const start = NextToken ? all.findIndex((s) => s.StatementName === NextToken) + 1 : 0;
    const page = all.slice(start, start + MaxResults);
    const next = start + MaxResults < all.length ? all[start + MaxResults].StatementName : null;

    return { PreparedStatements: page, NextToken: next };
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  tagResource(params) {
    const { ResourceARN, Tags } = params;
    if (!ResourceARN) throw Errors.InvalidRequest('ResourceARN is required');
    if (!Tags || !Array.isArray(Tags)) throw Errors.InvalidRequest('Tags is required');

    const existing = this.tags.get(ResourceARN) || [];
    const tagMap = {};
    for (const t of existing) tagMap[t.Key] = t.Value;
    for (const t of Tags) tagMap[t.Key] = t.Value;

    this.tags.set(ResourceARN, Object.entries(tagMap).map(([Key, Value]) => ({ Key, Value })));
    this.save();
    return {};
  }

  untagResource(params) {
    const { ResourceARN, TagKeys } = params;
    if (!ResourceARN) throw Errors.InvalidRequest('ResourceARN is required');
    if (!TagKeys || !Array.isArray(TagKeys)) throw Errors.InvalidRequest('TagKeys is required');

    const existing = this.tags.get(ResourceARN) || [];
    this.tags.set(ResourceARN, existing.filter((t) => !TagKeys.includes(t.Key)));
    this.save();
    return {};
  }

  listTagsForResource(params) {
    const { ResourceARN } = params;
    if (!ResourceARN) throw Errors.InvalidRequest('ResourceARN is required');
    const tags = this.tags.get(ResourceARN) || [];
    return { Tags: tags };
  }

  // ── Admin helpers ─────────────────────────────────────────────────────────

  getAdminStatus() {
    return {
      queryExecutions: this.queryExecutions.size,
      namedQueries: this.namedQueries.size,
      workgroups: this.workgroups.size,
      dataCatalogs: this.dataCatalogs.size,
      databases: this.databases.size,
      tables: this.tables.size,
      preparedStatements: this.preparedStatements.size,
    };
  }
}

module.exports = { AthenaSimulator };
