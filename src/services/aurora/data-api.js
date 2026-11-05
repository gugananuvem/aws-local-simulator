'use strict';

/**
 * Data API Handler - Implements Aurora Data API (RDSDataService) operations.
 * 
 * Handles: ExecuteStatement, BatchExecuteStatement, BeginTransaction,
 * CommitTransaction, RollbackTransaction.
 * 
 * Converts AWS typed parameters to SQLite bindings and formats results
 * in the Aurora Data API response format.
 */

class DataApiHandler {
  /**
   * @param {import('./db-engine').DbEngine} dbEngine
   * @param {import('./sql-translator')} sqlTranslator
   * @param {import('./cluster-manager').ClusterManager} clusterManager
   * @param {object} logger
   */
  constructor(dbEngine, sqlTranslator, clusterManager, logger) {
    this.dbEngine = dbEngine;
    this.sqlTranslator = sqlTranslator;
    this.clusterManager = clusterManager;
    this.logger = logger;
    this.transactions = new Map(); // transactionId → { dbName, startedAt, timer }

    // Optional service dependencies (wired via dependency injection in task 9.1)
    this.secretManagerService = null;
    this.cloudWatchService = null;
    this.cloudTrailService = null;
  }

  /**
   * Routes incoming Data API requests to the appropriate handler method.
   * @param {string} target - The x-amz-target value (e.g., 'RDSDataService.ExecuteStatement')
   * @param {object} body - The request body
   * @returns {Promise<object>} The response object
   */
  async handleRequest(target, body) {
    switch (target) {
      case 'RDSDataService.ExecuteStatement':
        return this.executeStatement(body);
      case 'RDSDataService.BatchExecuteStatement':
        return this.batchExecuteStatement(body);
      case 'RDSDataService.BeginTransaction':
        return this.beginTransaction(body);
      case 'RDSDataService.CommitTransaction':
        return this.commitTransaction(body);
      case 'RDSDataService.RollbackTransaction':
        return this.rollbackTransaction(body);
      default:
        const error = new Error(`Unknown target: ${target}`);
        error.code = 'BadRequestException';
        error.statusCode = 400;
        throw error;
    }
  }

  /**
   * Binds named parameters (:name) to positional placeholders (?).
   * Does NOT mutate the original SQL string.
   * 
   * @param {string} sql - SQL with :name placeholders
   * @param {Array<{name: string, value: object}>} parameters - Typed parameter array
   * @returns {{ boundSql: string, bindings: Array }} SQL with ? placeholders and positional bindings
   */
  bindParameters(sql, parameters = []) {
    if (!parameters.length) return { boundSql: sql, bindings: [] };

    const bindings = [];
    let boundSql = sql;

    // Sort parameters by name length descending (longest first to avoid partial matches)
    const sorted = [...parameters].sort((a, b) => b.name.length - a.name.length);

    for (const param of sorted) {
      const placeholder = `:${param.name}`;
      const value = this.extractValue(param.value);

      // Replace all occurrences of :name with ?
      while (boundSql.includes(placeholder)) {
        const idx = boundSql.indexOf(placeholder);
        boundSql = boundSql.substring(0, idx) + '?' + boundSql.substring(idx + placeholder.length);
        bindings.push(value);
      }
    }

    return { boundSql, bindings };
  }

  /**
   * Extracts native JavaScript value from an AWS typed parameter value object.
   * 
   * @param {object} typedValue - AWS typed value object
   * @returns {*} The extracted native value
   */
  extractValue(typedValue) {
    if (typedValue.isNull) return null;
    if (typedValue.stringValue !== undefined) return typedValue.stringValue;
    if (typedValue.longValue !== undefined) return Number(typedValue.longValue);
    if (typedValue.doubleValue !== undefined) return Number(typedValue.doubleValue);
    if (typedValue.booleanValue !== undefined) return typedValue.booleanValue ? 1 : 0;
    if (typedValue.blobValue !== undefined) return Buffer.from(typedValue.blobValue, 'base64');
    return null;
  }

  /**
   * Executes a single SQL statement via the Data API.
   * @param {object} params - ExecuteStatement parameters
   * @returns {Promise<object>} ExecuteStatement response
   */
  async executeStatement({ resourceArn, secretArn, database, sql, parameters, transactionId, includeResultMetadata }) {
    // 1. Validate secretArn (if secretManagerService is available)
    if (this.secretManagerService) {
      await this._validateSecretArn(secretArn);
    }

    // 2. Resolve cluster from resourceArn
    const cluster = this._resolveCluster(resourceArn);

    // 3. Determine database name
    const dbName = database || cluster.DatabaseName;
    if (!dbName) {
      const error = new Error('No database specified and cluster has no default database');
      error.code = 'BadRequestException';
      error.statusCode = 400;
      throw error;
    }

    // 4. Determine engine mode and create translator
    const engineMode = cluster.Engine; // 'aurora-mysql' or 'aurora-postgresql'
    const SqlTranslator = require('./sql-translator');
    const translator = new SqlTranslator(engineMode);

    // 5. Translate SQL
    const translatedSql = translator.translate(sql);

    // 6. Bind parameters
    const { boundSql, bindings } = this.bindParameters(translatedSql, parameters);

    // 7. Execute
    let result;
    if (transactionId) {
      // Check transaction exists
      const txn = this.transactions.get(transactionId);
      if (!txn) {
        const error = new Error(`Transaction ${transactionId} is not found`);
        error.code = 'BadRequestException';
        error.statusCode = 400;
        throw error;
      }
      result = this.dbEngine.executeInTransaction(transactionId, boundSql, bindings);
    } else {
      result = this.dbEngine.execute(dbName, boundSql, bindings);
    }

    // 8. Format response
    const response = {};

    if (result.type === 'select') {
      response.records = this.formatResults(result.rows, result.columns).records;
      if (includeResultMetadata) {
        response.columnMetadata = this.formatResults(result.rows, result.columns).columnMetadata;
      }
      response.numberOfRecordsUpdated = 0;
    } else if (result.type === 'dml') {
      response.numberOfRecordsUpdated = result.changes;
      response.generatedFields = [];
      // Only include lastInsertRowid for INSERT statements
      const isInsert = boundSql.trim().toUpperCase().startsWith('INSERT');
      if (isInsert && result.lastInsertRowid && result.lastInsertRowid > 0) {
        response.generatedFields.push({ longValue: result.lastInsertRowid });
      }
      if (includeResultMetadata) {
        response.columnMetadata = [];
      }
    } else {
      // DDL
      response.numberOfRecordsUpdated = 0;
      response.generatedFields = [];
      if (includeResultMetadata) {
        response.columnMetadata = [];
      }
    }

    // 9. Emit CloudWatch metric (if available)
    if (this.cloudWatchService) {
      try {
        this.cloudWatchService.putMetricData({
          namespace: 'AWS/RDS',
          metricData: [{
            metricName: 'DataAPIRequests',
            value: 1,
            unit: 'Count',
            dimensions: [{ name: 'DBClusterIdentifier', value: cluster.DBClusterIdentifier }]
          }]
        });
      } catch (e) {
        // Don't fail the request if CloudWatch fails
      }
    }

    return response;
  }

  /**
   * Executes a SQL statement with multiple parameter sets.
   * @param {object} params - BatchExecuteStatement parameters
   * @returns {Promise<object>} BatchExecuteStatement response with updateResults array
   */
  async batchExecuteStatement({ resourceArn, secretArn, database, sql, parameterSets, transactionId }) {
    // 1. Validate secretArn (if secretManagerService is available)
    if (this.secretManagerService) {
      await this._validateSecretArn(secretArn);
    }

    // 2. Resolve cluster from resourceArn
    const cluster = this._resolveCluster(resourceArn);

    // 3. Determine database name
    const dbName = database || cluster.DatabaseName;
    if (!dbName) {
      const error = new Error('No database specified and cluster has no default database');
      error.code = 'BadRequestException';
      error.statusCode = 400;
      throw error;
    }

    // 4. Translate SQL
    const engineMode = cluster.Engine;
    const SqlTranslator = require('./sql-translator');
    const translator = new SqlTranslator(engineMode);
    const translatedSql = translator.translate(sql);

    // 5. Execute once for each parameter set
    const updateResults = [];
    const paramSets = parameterSets || [];

    for (let i = 0; i < paramSets.length; i++) {
      try {
        const { boundSql, bindings } = this.bindParameters(translatedSql, paramSets[i]);
        let result;
        if (transactionId) {
          const txn = this.transactions.get(transactionId);
          if (!txn) {
            const error = new Error(`Transaction ${transactionId} is not found`);
            error.code = 'BadRequestException';
            error.statusCode = 400;
            throw error;
          }
          result = this.dbEngine.executeInTransaction(transactionId, boundSql, bindings);
        } else {
          result = this.dbEngine.execute(dbName, boundSql, bindings);
        }

        const updateResult = {};
        if (result.lastInsertRowid && result.lastInsertRowid > 0) {
          updateResult.generatedFields = [{ longValue: result.lastInsertRowid }];
        } else {
          updateResult.generatedFields = [];
        }
        updateResults.push(updateResult);
      } catch (err) {
        // Report error with indication of which parameter set failed
        const error = new Error(`Error at parameter set index ${i}: ${err.message}`);
        error.code = err.code || 'BadRequestException';
        error.statusCode = err.statusCode || 400;
        throw error;
      }
    }

    // 6. Emit CloudWatch metric (if available)
    if (this.cloudWatchService) {
      try {
        this.cloudWatchService.putMetricData({
          namespace: 'AWS/RDS',
          metricData: [{
            metricName: 'DataAPIRequests',
            value: 1,
            unit: 'Count',
            dimensions: [{ name: 'DBClusterIdentifier', value: cluster.DBClusterIdentifier }]
          }]
        });
      } catch (e) { /* Don't fail if CloudWatch fails */ }
    }

    return { updateResults };
  }

  /**
   * Begins a new transaction.
   * @param {object} params - BeginTransaction parameters
   * @returns {Promise<object>} BeginTransaction response with transactionId
   */
  async beginTransaction({ resourceArn, secretArn, database }) {
    // 1. Validate
    if (this.secretManagerService) {
      await this._validateSecretArn(secretArn);
    }
    const cluster = this._resolveCluster(resourceArn);

    const dbName = database || cluster.DatabaseName;
    if (!dbName) {
      const error = new Error('No database specified and cluster has no default database');
      error.code = 'BadRequestException';
      error.statusCode = 400;
      throw error;
    }

    // 2. Begin transaction via DbEngine
    const transactionId = this.dbEngine.beginTransaction(dbName);

    // 3. Store in transactions Map with timeout timer
    const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
    const timer = setTimeout(() => {
      // Auto-rollback on timeout
      try {
        this.dbEngine.rollback(transactionId);
      } catch (e) { /* already rolled back */ }
      this.transactions.delete(transactionId);
    }, TIMEOUT_MS);

    // Don't hold the event loop open
    if (timer.unref) timer.unref();

    this.transactions.set(transactionId, { dbName, startedAt: Date.now(), timer });

    return { transactionId };
  }

  /**
   * Commits an active transaction.
   * @param {object} params - CommitTransaction parameters
   * @returns {Promise<object>} CommitTransaction response with transactionStatus
   */
  async commitTransaction({ resourceArn, secretArn, transactionId }) {
    // Validate
    if (this.secretManagerService) {
      await this._validateSecretArn(secretArn);
    }

    const txn = this.transactions.get(transactionId);
    if (!txn) {
      const error = new Error(`Transaction ${transactionId} is not found`);
      error.code = 'BadRequestException';
      error.statusCode = 400;
      throw error;
    }

    // Commit via DbEngine
    this.dbEngine.commit(transactionId);

    // Cleanup
    if (txn.timer) clearTimeout(txn.timer);
    this.transactions.delete(transactionId);

    return { transactionStatus: 'Transaction Committed' };
  }

  /**
   * Rolls back an active transaction.
   * @param {object} params - RollbackTransaction parameters
   * @returns {Promise<object>} RollbackTransaction response with transactionStatus
   */
  async rollbackTransaction({ resourceArn, secretArn, transactionId }) {
    // Validate
    if (this.secretManagerService) {
      await this._validateSecretArn(secretArn);
    }

    const txn = this.transactions.get(transactionId);
    if (!txn) {
      const error = new Error(`Transaction ${transactionId} is not found`);
      error.code = 'BadRequestException';
      error.statusCode = 400;
      throw error;
    }

    // Rollback via DbEngine
    this.dbEngine.rollback(transactionId);

    // Cleanup
    if (txn.timer) clearTimeout(txn.timer);
    this.transactions.delete(transactionId);

    return { transactionStatus: 'Transaction Rolledback' };
  }

  /**
   * Resolves a cluster from its ARN.
   * @param {string} resourceArn
   * @returns {object} Cluster object
   */
  _resolveCluster(resourceArn) {
    if (!resourceArn) {
      const error = new Error('resourceArn is required');
      error.code = 'BadRequestException';
      error.statusCode = 400;
      throw error;
    }

    const cluster = this.clusterManager.getClusterByArn(resourceArn);
    if (!cluster) {
      const error = new Error(`Cluster not found for ARN: ${resourceArn}`);
      error.code = 'NotFoundException';
      error.statusCode = 404;
      throw error;
    }
    return cluster;
  }

  /**
   * Validates a secretArn against Secret Manager.
   * If the Secret Manager service is available, checks that the secret actually exists.
   * For local development, accepts any secret ARN matching the Aurora pattern.
   * @param {string} secretArn
   */
  async _validateSecretArn(secretArn) {
    if (!secretArn) {
      const error = new Error('secretArn is required');
      error.code = 'BadRequestException';
      error.statusCode = 400;
      throw error;
    }

    // Always accept Aurora-style secret ARNs for local development
    // This allows the simulator to work without requiring Secret Manager
    const auroraPattern = /^arn:aws:secretsmanager:[^:]+:\d+:secret:(aurora-|rds-)/i;
    if (auroraPattern.test(secretArn)) {
      // Accept Aurora-style secrets for local development
      return;
    }

    // If Secret Manager service is available, validate non-Aurora secrets
    if (this.secretManagerService) {
      try {
        // getSecretValue validates the secret exists and is accessible
        await this.secretManagerService.getSecretValue({ SecretId: secretArn });
      } catch (e) {
        const error = new Error('Invalid secretArn');
        error.code = 'BadRequestException';
        error.statusCode = 400;
        throw error;
      }
    }
    // If no Secret Manager service, accept any secret ARN for local development
  }

  /**
   * Formats SQLite query results into Aurora Data API format.
   * @param {Array<object>} sqliteRows - Row objects from better-sqlite3
   * @param {Array<object>} sqliteColumns - Column metadata from stmt.columns()
   * @returns {{ records: Array[], columnMetadata: Array<object> }}
   */
  formatResults(sqliteRows, sqliteColumns) {
    const columnMetadata = sqliteColumns.map(col => ({
      name: col.name,
      label: col.name,
      typeName: this._inferTypeName(col),
      type: this._inferJdbcType(col),
      nullable: true,
      precision: 0,
      scale: 0,
    }));

    const records = sqliteRows.map(row => {
      return sqliteColumns.map(col => {
        const value = row[col.name];
        if (value === null || value === undefined) return { isNull: true };
        if (typeof value === 'number' && Number.isInteger(value)) return { longValue: value };
        if (typeof value === 'number') return { doubleValue: value };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (Buffer.isBuffer(value)) return { blobValue: value.toString('base64') };
        return { stringValue: String(value) };
      });
    });

    return { records, columnMetadata };
  }

  /**
   * Infers SQL type name from a better-sqlite3 column descriptor.
   * @param {object} col - Column object from stmt.columns()
   * @returns {string} SQL type name
   */
  _inferTypeName(col) {
    const type = col.type ? col.type.toUpperCase() : null;
    switch (type) {
      case 'INTEGER': return 'INTEGER';
      case 'REAL': return 'DOUBLE';
      case 'TEXT': return 'VARCHAR';
      case 'BLOB': return 'BLOB';
      default: return 'VARCHAR';
    }
  }

  /**
   * Infers JDBC type number from a better-sqlite3 column descriptor.
   * @param {object} col - Column object from stmt.columns()
   * @returns {number} JDBC type number
   */
  _inferJdbcType(col) {
    const type = col.type ? col.type.toUpperCase() : null;
    switch (type) {
      case 'INTEGER': return 4;   // JDBC INTEGER
      case 'REAL': return 8;      // JDBC DOUBLE
      case 'TEXT': return 12;     // JDBC VARCHAR
      case 'BLOB': return 2004;   // JDBC BLOB
      default: return 12;         // JDBC VARCHAR (default)
    }
  }
}

module.exports = { DataApiHandler };
