'use strict';

/**
 * Catálogo persistido de rotinas e variáveis de sessão.
 * Cada database lógico guarda suas rotinas no próprio arquivo .db.
 */

class RoutineStore {
  constructor() {
    this.initialized = new Set();
  }

  /**
   * Cria as tabelas internas de um database.
   *
   * @param {import('better-sqlite3').Database} db
   */
  ensureSchema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS __aurora_routines (
        db_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        definition_sql TEXT NOT NULL,
        engine TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (db_name, kind, name)
      );
      CREATE TABLE IF NOT EXISTS __aurora_session_vars (
        db_name TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (db_name, name)
      );
    `);
  }

  /**
   * Marca um database como inicializado (evita recriar tabelas toda vez).
   *
   * @param {string} dbName
   * @param {import('better-sqlite3').Database} db
   */
  initialize(dbName, db) {
    if (this.initialized.has(dbName)) return;
    this.ensureSchema(db);
    this.initialized.add(dbName);
  }

  /**
   * Grava ou substitui uma rotina.
   *
   * @param {string} dbName
   * @param {import('better-sqlite3').Database} db
   * @param {object} definition
   */
  save(dbName, db, definition) {
    this.initialize(dbName, db);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO __aurora_routines
        (db_name, kind, name, definition_json, definition_sql, engine, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(db_name, kind, name) DO UPDATE SET
        definition_json = excluded.definition_json,
        definition_sql = excluded.definition_sql,
        engine = excluded.engine,
        updated_at = excluded.updated_at
    `).run(
      dbName,
      definition.kind,
      definition.name,
      JSON.stringify(definition),
      definition.definitionSql,
      definition.engine,
      now,
      now
    );
  }

  /**
   * Busca uma rotina pelo kind e nome.
   *
   * @param {string} dbName
   * @param {import('better-sqlite3').Database} db
   * @param {string} kind
   * @param {string} name
   * @returns {object|null}
   */
  get(dbName, db, kind, name) {
    this.initialize(dbName, db);
    const row = db.prepare(`
      SELECT definition_json, created_at, updated_at FROM __aurora_routines
      WHERE db_name = ? AND kind = ? AND name = ?
    `).get(dbName, kind, name);
    if (!row) return null;
    const definition = JSON.parse(row.definition_json);
    definition.createdAt = row.created_at;
    definition.updatedAt = row.updated_at;
    return definition;
  }

  /**
   * Lista rotinas de um database.
   *
   * @param {string} dbName
   * @param {import('better-sqlite3').Database} db
   * @param {string} kind - 'procedure', 'function' ou 'all'
   * @returns {object[]}
   */
  list(dbName, db, kind = 'all') {
    this.initialize(dbName, db);
    const sql = kind === 'all'
      ? 'SELECT definition_json, created_at, updated_at FROM __aurora_routines WHERE db_name = ? ORDER BY kind, name'
      : 'SELECT definition_json, created_at, updated_at FROM __aurora_routines WHERE db_name = ? AND kind = ? ORDER BY name';
    const rows = kind === 'all'
      ? db.prepare(sql).all(dbName)
      : db.prepare(sql).all(dbName, kind);
    return rows.map((row) => {
      const definition = JSON.parse(row.definition_json);
      definition.createdAt = row.created_at;
      definition.updatedAt = row.updated_at;
      return definition;
    });
  }

  /**
   * Remove uma rotina.
   *
   * @param {string} dbName
   * @param {import('better-sqlite3').Database} db
   * @param {string} kind
   * @param {string} name
   * @returns {boolean}
   */
  remove(dbName, db, kind, name) {
    this.initialize(dbName, db);
    const result = db.prepare(`
      DELETE FROM __aurora_routines
      WHERE db_name = ? AND kind = ? AND name = ?
    `).run(dbName, kind, name);
    return result.changes > 0;
  }

  /**
   * Grava uma variável de sessão simulada (@nome).
   *
   * @param {string} dbName
   * @param {import('better-sqlite3').Database} db
   * @param {string} name
   * @param {any} value
   */
  setSessionVar(dbName, db, name, value) {
    this.initialize(dbName, db);
    db.prepare(`
      INSERT INTO __aurora_session_vars (db_name, name, value)
      VALUES (?, ?, ?)
      ON CONFLICT(db_name, name) DO UPDATE SET value = excluded.value
    `).run(dbName, name.replace(/^@+/, ''), JSON.stringify(value === undefined ? null : value));
  }

  /**
   * Lê uma variável de sessão simulada.
   *
   * @param {string} dbName
   * @param {import('better-sqlite3').Database} db
   * @param {string} name
   * @returns {any}
   */
  getSessionVar(dbName, db, name) {
    this.initialize(dbName, db);
    const row = db.prepare(`
      SELECT value FROM __aurora_session_vars WHERE db_name = ? AND name = ?
    `).get(dbName, name.replace(/^@+/, ''));
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch (e) {
      return row.value;
    }
  }

  /**
   * Formato público usado pela API administrativa.
   *
   * @param {object} definition
   */
  toPublic(definition) {
    return {
      name: definition.name,
      kind: definition.kind,
      engine: definition.engine,
      parameters: definition.parameters || [],
      returns: definition.returns || null,
      definitionSql: definition.definitionSql,
      createdAt: definition.createdAt || null,
      updatedAt: definition.updatedAt || null,
    };
  }
}

module.exports = { RoutineStore };
