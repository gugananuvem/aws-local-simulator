'use strict';

/**
 * Fachada das rotinas do Aurora: parser, catálogo, executor e UDFs.
 */

const { RoutineStore } = require('./routine-store');
const { RoutineExecutor, RoutineError } = require('./routine-executor');
const { parseCreateRoutine, parseDropRoutine } = require('./routine-parser');

class RoutineService {
  /**
   * @param {import('../db-engine').DbEngine} dbEngine
   */
  constructor(dbEngine) {
    this.dbEngine = dbEngine;
    this.store = new RoutineStore();
    this.executor = new RoutineExecutor({ dbEngine, store: this.store });

    // Toda conexão aberta recebe as tabelas internas e as UDFs persistidas.
    dbEngine.onDatabaseOpen = (dbName, db) => this.initializeDatabase(dbName, db);
    dbEngine.onDatabasesClosed = () => this.store.initialized.clear();
  }

  initializeDatabase(dbName, db) {
    this.store.initialize(dbName, db);
    this.executor.registerFunctions(dbName, db);
  }

  /**
   * Identifica comandos que precisam ser tratados fora do caminho SQL comum.
   *
   * @param {string} sql
   * @returns {'create'|'drop'|'call'|'catalog'|null}
   */
  classify(sql) {
    const trimmed = (sql || '').trim();
    if (/^CREATE\s+(OR\s+REPLACE\s+)?(DEFINER\s*=\s*\S+\s+)?(PROCEDURE|FUNCTION)\b/i.test(trimmed)) return 'create';
    if (/^DROP\s+(PROCEDURE|FUNCTION)\b/i.test(trimmed)) return 'drop';
    if (/^CALL\b/i.test(trimmed)) return 'call';
    if (/^SHOW\s+(PROCEDURE|FUNCTION)\s+STATUS\b/i.test(trimmed) || /^SELECT\s+@/i.test(trimmed)) return 'catalog';
    return null;
  }

  /**
   * Cria ou substitui uma rotina.
   *
   * @param {string} dbName
   * @param {string} engineMode
   * @param {string} sql
   */
  create(dbName, engineMode, sql) {
    const db = this.dbEngine.getOrCreateDatabase(dbName);
    const definition = parseCreateRoutine(sql, engineMode);
    this.store.save(dbName, db, definition);
    if (definition.kind === 'function') this.executor.registerFunctions(dbName, db);
    return this.store.toPublic(this.store.get(dbName, db, definition.kind, definition.name));
  }

  /**
   * Remove uma rotina por comando SQL.
   */
  drop(dbName, sql) {
    const parsed = parseDropRoutine(sql);
    return this.dropByName(dbName, parsed.kind, parsed.name);
  }

  /**
   * Remove uma rotina por nome (rota administrativa).
   */
  dropByName(dbName, kind, name) {
    const db = this.dbEngine.getOrCreateDatabase(dbName);
    const removed = this.store.remove(dbName, db, kind, name);
    if (!removed) throw new RoutineError(`Rotina ${name} não encontrada`);
    if (kind === 'function') this.executor.unregisterFunction(dbName, db, name);
    return true;
  }

  call(dbName, params) {
    return this.executor.executeCall(dbName, params);
  }

  catalog(dbName, sql, transactionId) {
    return this.executor.queryCatalog(dbName, sql, transactionId);
  }

  list(dbName, kind = 'all') {
    const db = this.dbEngine.getOrCreateDatabase(dbName);
    return this.store.list(dbName, db, kind).map((definition) => this.store.toPublic(definition));
  }

  get(dbName, kind, name) {
    const db = this.dbEngine.getOrCreateDatabase(dbName);
    const definition = this.store.get(dbName, db, kind, name);
    return definition ? this.store.toPublic(definition) : null;
  }

  listViews(dbName) {
    const db = this.dbEngine.getOrCreateDatabase(dbName);
    return db.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'view' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();
  }
}

module.exports = { RoutineService, RoutineError };
