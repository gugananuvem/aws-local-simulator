'use strict';

/**
 * Data API (RDSDataService) do simulador de SQL Server.
 * A tradução T-SQL fica centralizada no DbEngine; aqui apenas ligamos parâmetros,
 * gerenciamos transações e formatamos a resposta no formato da AWS.
 */

const logger = require('../../utils/logger');

const TRANSACTION_TIMEOUT_MS = 3 * 60 * 1000;
const SECRET_PATTERN = /^arn:aws:secretsmanager:[^:]+:\d+:secret:(rds-|sqlserver-|aurora-)/i;
const IDENTIFIER_RE = /[A-Za-z0-9_]/;

function fail(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

class DataApiHandler {
  constructor(dbEngine, sqlTranslator, clusterManager, log) {
    this.dbEngine = dbEngine;
    // Mantido por compatibilidade com a assinatura do Aurora; a tradução é feita no DbEngine.
    this.sqlTranslator = sqlTranslator;
    this.clusterManager = clusterManager;
    this.logger = log || logger;
    this.transactions = new Map();

    this.secretManagerService = null;
    this.cloudWatchService = null;
    this.cloudTrailService = null;
  }

  async handleRequest(target, body) {
    switch (target) {
      case 'RDSDataService.ExecuteStatement':
        return this.executeStatement(body || {});
      case 'RDSDataService.BatchExecuteStatement':
        return this.batchExecuteStatement(body || {});
      case 'RDSDataService.BeginTransaction':
        return this.beginTransaction(body || {});
      case 'RDSDataService.CommitTransaction':
        return this.commitTransaction(body || {});
      case 'RDSDataService.RollbackTransaction':
        return this.rollbackTransaction(body || {});
      default:
        return fail('BadRequestException', `Target desconhecido: ${target}`);
    }
  }

  /**
   * Substitui :nome e @nome por `?`, ignorando literais, identificadores entre colchetes
   * e comentários. A ordem dos bindings segue a ordem de aparição no SQL.
   */
  bindParameters(sql, parameters = []) {
    const text = String(sql || '');
    if (!parameters.length) return { boundSql: text, bindings: [] };

    const byName = new Map();
    for (const param of parameters) {
      if (!param || !param.name) continue;
      const name = String(param.name).replace(/^[:@]/, '');
      byName.set(name.toLowerCase(), { name, value: this.extractValue(param.value) });
    }
    if (byName.size === 0) return { boundSql: text, bindings: [] };

    const bindings = [];
    let boundSql = '';
    let state = 'normal';
    let i = 0;

    while (i < text.length) {
      const ch = text[i];
      const next = text[i + 1];

      if (state === 'normal') {
        if (ch === "'") { state = 'single'; boundSql += ch; i++; continue; }
        if (ch === '"') { state = 'double'; boundSql += ch; i++; continue; }
        if (ch === '[') { state = 'bracket'; boundSql += ch; i++; continue; }
        if (ch === '-' && next === '-') { state = 'line'; boundSql += '--'; i += 2; continue; }
        if (ch === '/' && next === '*') { state = 'block'; boundSql += '/*'; i += 2; continue; }

        if ((ch === ':' || ch === '@') && !(ch === '@' && next === '@')) {
          let j = i + 1;
          while (j < text.length && IDENTIFIER_RE.test(text[j])) j++;
          if (j > i + 1) {
            const rawName = text.slice(i + 1, j);
            const param = byName.get(rawName.toLowerCase());
            if (param) {
              boundSql += '?';
              bindings.push(param.value);
              i = j;
              continue;
            }
          }
        }

        boundSql += ch;
        i++;
        continue;
      }

      if (state === 'single') {
        boundSql += ch;
        if (ch === "'" && next === "'") { boundSql += next; i += 2; continue; }
        if (ch === "'") state = 'normal';
        i++;
        continue;
      }

      if (state === 'double') {
        boundSql += ch;
        if (ch === '"') state = 'normal';
        i++;
        continue;
      }

      if (state === 'bracket') {
        boundSql += ch;
        if (ch === ']' && next === ']') { boundSql += next; i += 2; continue; }
        if (ch === ']') state = 'normal';
        i++;
        continue;
      }

      if (state === 'line') {
        boundSql += ch;
        if (ch === '\n') state = 'normal';
        i++;
        continue;
      }

      // state === 'block'
      boundSql += ch;
      if (ch === '*' && next === '/') { boundSql += next; i += 2; state = 'normal'; continue; }
      i++;
    }

    return { boundSql, bindings };
  }

  extractValue(typedValue) {
    if (!typedValue || typeof typedValue !== 'object') return typedValue ?? null;
    if (typedValue.isNull) return null;
    if (typedValue.stringValue !== undefined) return typedValue.stringValue;
    if (typedValue.longValue !== undefined) return Number(typedValue.longValue);
    if (typedValue.doubleValue !== undefined) return Number(typedValue.doubleValue);
    if (typedValue.booleanValue !== undefined) return typedValue.booleanValue ? 1 : 0;
    if (typedValue.blobValue !== undefined) return Buffer.from(typedValue.blobValue, 'base64');
    return null;
  }

  async executeStatement({ resourceArn, secretArn, database, sql, parameters, transactionId, includeResultMetadata } = {}) {
    await this._validateSecretArn(secretArn);
    const cluster = this._resolveCluster(resourceArn);
    const dbName = database || cluster.DatabaseName;
    if (!dbName) fail('BadRequestException', 'Nenhum database informado e o cluster não possui database padrão');
    if (!sql) fail('BadRequestException', 'sql é obrigatório');

    const { boundSql, bindings } = this.bindParameters(sql, parameters);
    let result;
    if (transactionId) {
      this._getTransaction(transactionId);
      result = this.dbEngine.executeInTransaction(transactionId, boundSql, bindings);
    } else {
      result = this.dbEngine.execute(dbName, boundSql, bindings);
    }

    const response = {};
    if (result.type === 'select') {
      const formatted = this.formatResults(result.rows, result.columns);
      response.records = formatted.records;
      if (includeResultMetadata) response.columnMetadata = formatted.columnMetadata;
      response.numberOfRecordsUpdated = 0;
    } else if (result.type === 'dml') {
      response.numberOfRecordsUpdated = result.changes || 0;
      response.generatedFields = [];
      if (boundSql.trim().toUpperCase().startsWith('INSERT') && result.lastInsertRowid > 0) {
        response.generatedFields.push({ longValue: result.lastInsertRowid });
      }
      if (includeResultMetadata) response.columnMetadata = [];
    } else {
      response.numberOfRecordsUpdated = 0;
      response.generatedFields = [];
      if (includeResultMetadata) response.columnMetadata = [];
    }

    this._recordMetric(cluster);
    return response;
  }

  async batchExecuteStatement({ resourceArn, secretArn, database, sql, parameterSets, transactionId } = {}) {
    await this._validateSecretArn(secretArn);
    const cluster = this._resolveCluster(resourceArn);
    const dbName = database || cluster.DatabaseName;
    if (!dbName) fail('BadRequestException', 'Nenhum database informado e o cluster não possui database padrão');
    if (!sql) fail('BadRequestException', 'sql é obrigatório');

    if (transactionId) this._getTransaction(transactionId);

    const updateResults = [];
    const sets = parameterSets || [];
    for (let index = 0; index < sets.length; index++) {
      try {
        const { boundSql, bindings } = this.bindParameters(sql, sets[index]);
        const result = transactionId
          ? this.dbEngine.executeInTransaction(transactionId, boundSql, bindings)
          : this.dbEngine.execute(dbName, boundSql, bindings);

        updateResults.push({
          generatedFields: result.lastInsertRowid > 0 ? [{ longValue: result.lastInsertRowid }] : [],
        });
      } catch (error) {
        fail(error.code || 'BadRequestException', `Erro no conjunto de parâmetros ${index}: ${error.message}`, error.statusCode || 400);
      }
    }

    this._recordMetric(cluster);
    return { updateResults };
  }

  async beginTransaction({ resourceArn, secretArn, database } = {}) {
    await this._validateSecretArn(secretArn);
    const cluster = this._resolveCluster(resourceArn);
    const dbName = database || cluster.DatabaseName;
    if (!dbName) fail('BadRequestException', 'Nenhum database informado e o cluster não possui database padrão');

    const transactionId = this.dbEngine.beginTransaction(dbName);
    const timer = setTimeout(() => {
      try { this.dbEngine.rollback(transactionId); } catch { /* já revertida */ }
      this.transactions.delete(transactionId);
    }, TRANSACTION_TIMEOUT_MS);
    if (timer.unref) timer.unref();

    this.transactions.set(transactionId, { dbName, startedAt: Date.now(), timer });
    return { transactionId };
  }

  async commitTransaction({ secretArn, transactionId } = {}) {
    await this._validateSecretArn(secretArn);
    const txn = this._getTransaction(transactionId);
    this.dbEngine.commit(transactionId);
    this._clearTransaction(transactionId, txn);
    return { transactionStatus: 'Transaction Committed' };
  }

  async rollbackTransaction({ secretArn, transactionId } = {}) {
    await this._validateSecretArn(secretArn);
    const txn = this._getTransaction(transactionId);
    this.dbEngine.rollback(transactionId);
    this._clearTransaction(transactionId, txn);
    return { transactionStatus: 'Transaction Rolledback' };
  }

  _getTransaction(transactionId) {
    const txn = this.transactions.get(transactionId);
    if (!txn) fail('BadRequestException', `Transação ${transactionId} não encontrada`);
    return txn;
  }

  _clearTransaction(transactionId, txn) {
    if (txn?.timer) clearTimeout(txn.timer);
    this.transactions.delete(transactionId);
  }

  /** Cancela os timers pendentes e reverte transações ainda abertas. */
  close() {
    for (const [transactionId, txn] of this.transactions) {
      try { this.dbEngine.rollback(transactionId); } catch { /* já revertida */ }
      this._clearTransaction(transactionId, txn);
    }
  }

  _resolveCluster(resourceArn) {
    if (!resourceArn) fail('BadRequestException', 'resourceArn é obrigatório');
    const cluster = this.clusterManager.getClusterByArn(resourceArn);
    if (!cluster) fail('NotFoundException', `Cluster não encontrado para o ARN: ${resourceArn}`, 404);
    return cluster;
  }

  async _validateSecretArn(secretArn) {
    if (!secretArn) fail('BadRequestException', 'secretArn é obrigatório');
    if (SECRET_PATTERN.test(secretArn)) return;

    if (this.secretManagerService) {
      try {
        await this.secretManagerService.getSecretValue({ SecretId: secretArn });
      } catch {
        fail('BadRequestException', 'secretArn inválido');
      }
    }
  }

  _recordMetric(cluster) {
    if (!this.cloudWatchService) return;
    try {
      this.cloudWatchService.putMetricData({
        namespace: 'AWS/RDS',
        metricData: [{
          metricName: 'DataAPIRequests',
          value: 1,
          unit: 'Count',
          dimensions: [{ name: 'DBClusterIdentifier', value: cluster.DBClusterIdentifier }],
        }],
      });
    } catch (error) {
      this.logger.debug(`[RDS SQL Server] Falha ao publicar métrica: ${error.message}`);
    }
  }

  formatResults(sqliteRows, sqliteColumns) {
    const columns = sqliteColumns || [];
    const columnMetadata = columns.map((col) => ({
      name: col.name,
      label: col.name,
      typeName: this._inferTypeName(col),
      type: this._inferJdbcType(col),
      nullable: true,
      precision: 0,
      scale: 0,
    }));

    const records = (sqliteRows || []).map((row) => columns.map((col) => {
      const value = row[col.name];
      if (value === null || value === undefined) return { isNull: true };
      if (typeof value === 'number' && Number.isInteger(value)) return { longValue: value };
      if (typeof value === 'number') return { doubleValue: value };
      if (typeof value === 'boolean') return { booleanValue: value };
      if (Buffer.isBuffer(value)) return { blobValue: value.toString('base64') };
      return { stringValue: String(value) };
    }));

    return { records, columnMetadata };
  }

  _inferTypeName(col) {
    const type = String(col.type || '').toUpperCase();
    if (type.includes('INT')) return 'INTEGER';
    if (type.includes('REAL') || type.includes('FLOAT') || type.includes('DOUBLE') || type.includes('DECIMAL')) return 'DOUBLE';
    if (type.includes('BLOB')) return 'BLOB';
    return 'VARCHAR';
  }

  _inferJdbcType(col) {
    const type = String(col.type || '').toUpperCase();
    if (type.includes('INT')) return 4;
    if (type.includes('REAL') || type.includes('FLOAT') || type.includes('DOUBLE') || type.includes('DECIMAL')) return 8;
    if (type.includes('BLOB')) return 2004;
    return 12;
  }
}

module.exports = { DataApiHandler };
