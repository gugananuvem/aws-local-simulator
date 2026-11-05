'use strict';

/**
 * DB Engine - Gerencia múltiplas instâncias SQLite (uma por database lógico Aurora).
 * Responsável por executar queries, gerenciar transações e ciclo de vida de conexões.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../../utils/logger');

class DbEngine {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.databases = new Map(); // dbName → better-sqlite3 Database instance
    this.transactions = new Map(); // transactionId → { db, dbName, startedAt }

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });
  }

  /**
   * Gets or lazily creates a SQLite database file for the given database name.
   * @param {string} dbName - Logical database name
   * @returns {import('better-sqlite3').Database} The better-sqlite3 database instance
   */
  getOrCreateDatabase(dbName) {
    if (this.databases.has(dbName)) {
      return this.databases.get(dbName);
    }

    const dbPath = path.join(this.dataDir, `${dbName}.db`);
    const db = new Database(dbPath);

    // Performance optimizations
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    this.databases.set(dbName, db);
    logger.debug(`[Aurora DbEngine] Database '${dbName}' created/opened at ${dbPath}`);

    return db;
  }

  /**
   * Executes a SQL statement on the specified database.
   * Detects statement type (SELECT, DML, DDL) and returns structured results.
   * @param {string} dbName - Target database name
   * @param {string} sql - SQL statement to execute
   * @param {Array} params - Bound parameters
   * @returns {{ type: string, rows?: Array, columns?: Array, changes?: number, lastInsertRowid?: number }}
   */
  execute(dbName, sql, params) {
    const db = this.getOrCreateDatabase(dbName);
    return this._executeOnDb(db, sql, params);
  }

  /**
   * Begins a new transaction on the specified database.
   * @param {string} dbName - Target database name
   * @returns {string} Unique transaction ID (UUID)
   */
  beginTransaction(dbName) {
    const db = this.getOrCreateDatabase(dbName);
    const transactionId = crypto.randomUUID();

    db.exec('BEGIN');

    this.transactions.set(transactionId, {
      db,
      dbName,
      startedAt: Date.now()
    });

    logger.debug(`[Aurora DbEngine] Transaction ${transactionId} started on '${dbName}'`);
    return transactionId;
  }

  /**
   * Executes a SQL statement within an active transaction.
   * @param {string} transactionId - Active transaction ID
   * @param {string} sql - SQL statement to execute
   * @param {Array} params - Bound parameters
   * @returns {{ type: string, rows?: Array, columns?: Array, changes?: number, lastInsertRowid?: number }}
   */
  executeInTransaction(transactionId, sql, params) {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} is not found`);
    }

    return this._executeOnDb(transaction.db, sql, params);
  }

  /**
   * Commits an active transaction.
   * @param {string} transactionId - Transaction ID to commit
   */
  commit(transactionId) {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} is not found`);
    }

    transaction.db.exec('COMMIT');
    this.transactions.delete(transactionId);
    logger.debug(`[Aurora DbEngine] Transaction ${transactionId} committed`);
  }

  /**
   * Rolls back an active transaction.
   * @param {string} transactionId - Transaction ID to rollback
   */
  rollback(transactionId) {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} is not found`);
    }

    transaction.db.exec('ROLLBACK');
    this.transactions.delete(transactionId);
    logger.debug(`[Aurora DbEngine] Transaction ${transactionId} rolled back`);
  }

  /**
   * Lists all existing databases (based on .db files in the data directory).
   * @returns {string[]} Array of database names (without .db extension)
   */
  listDatabases() {
    if (!fs.existsSync(this.dataDir)) {
      return [];
    }

    return fs.readdirSync(this.dataDir)
      .filter(file => file.endsWith('.db'))
      .map(file => file.slice(0, -3));
  }

  /**
   * Drops a database: closes connection and deletes the .db file.
   * @param {string} dbName - Database name to drop
   */
  dropDatabase(dbName) {
    // Close connection if open
    if (this.databases.has(dbName)) {
      const db = this.databases.get(dbName);
      db.close();
      this.databases.delete(dbName);
    }

    // Delete the .db file
    const dbPath = path.join(this.dataDir, `${dbName}.db`);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      logger.debug(`[Aurora DbEngine] Database '${dbName}' dropped`);
    }
  }

  /**
   * Closes all open SQLite connections and clears the databases Map.
   */
  close() {
    for (const [dbName, db] of this.databases) {
      try {
        db.close();
      } catch (err) {
        logger.debug(`[Aurora DbEngine] Error closing database '${dbName}': ${err.message}`);
      }
    }
    this.databases.clear();
    this.transactions.clear();
    logger.debug('[Aurora DbEngine] All connections closed');
  }

  /**
   * Resets the engine: closes all connections and deletes all .db files.
   */
  reset() {
    this.close();

    // Delete all .db files in the data directory
    if (fs.existsSync(this.dataDir)) {
      const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.db'));
      for (const file of files) {
        fs.unlinkSync(path.join(this.dataDir, file));
      }
    }

    logger.debug('[Aurora DbEngine] Engine reset complete');
  }

  /**
   * Internal: executes SQL on a given database instance, detecting statement type.
   * @private
   */
  _executeOnDb(db, sql, params) {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();

    // Detect statement type
    if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA') || upper.startsWith('EXPLAIN')) {
      return this._executeSelect(db, trimmed, params);
    } else if (
      upper.startsWith('INSERT') ||
      upper.startsWith('UPDATE') ||
      upper.startsWith('DELETE') ||
      upper.startsWith('REPLACE')
    ) {
      return this._executeDml(db, trimmed, params);
    } else {
      // DDL: CREATE, DROP, ALTER, etc.
      return this._executeDdl(db, trimmed);
    }
  }

  /**
   * Executes a SELECT statement, returning rows and column metadata.
   * @private
   */
  _executeSelect(db, sql, params) {
    const stmt = db.prepare(sql);
    const rows = stmt.all(...(params || []));
    const columns = stmt.columns();

    return {
      type: 'select',
      rows,
      columns,
      changes: 0,
      lastInsertRowid: 0
    };
  }

  /**
   * Executes a DML statement (INSERT/UPDATE/DELETE), returning change count.
   * @private
   */
  _executeDml(db, sql, params) {
    const stmt = db.prepare(sql);
    const result = stmt.run(...(params || []));

    return {
      type: 'dml',
      rows: [],
      columns: [],
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid)
    };
  }

  /**
   * Executes a DDL statement (CREATE/DROP/ALTER), returning zero changes.
   * @private
   */
  _executeDdl(db, sql) {
    db.exec(sql);

    return {
      type: 'ddl',
      rows: [],
      columns: [],
      changes: 0,
      lastInsertRowid: 0
    };
  }
}

module.exports = { DbEngine };
