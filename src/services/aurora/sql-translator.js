'use strict';

/**
 * SQL Translator - Converte SQL MySQL/PostgreSQL para SQLite compatível.
 * 
 * Responsabilidades:
 * - Conversão de tipos de dados (VARCHAR→TEXT, INT→INTEGER, DOUBLE→REAL, etc.)
 * - Tradução de funções (NOW()→datetime('now'), UUID()→hex expression)
 * - Remoção de cláusulas não-suportadas (ENGINE, CHARSET, COLLATE, COMMENT)
 * - Substituição AUTO_INCREMENT→AUTOINCREMENT
 * - Normalização de whitespace e remoção de comentários
 * 
 * IMPORTANTE: O método translate() NÃO muta a string SQL original.
 */

class SqlTranslator {
  /**
   * @param {string} engineMode - 'aurora-mysql' | 'aurora-postgresql'
   */
  constructor(engineMode) {
    if (engineMode !== 'aurora-mysql' && engineMode !== 'aurora-postgresql') {
      throw new Error(`Invalid engineMode: ${engineMode}. Must be 'aurora-mysql' or 'aurora-postgresql'`);
    }
    this.engineMode = engineMode;
  }

  /**
   * Translates SQL from MySQL/PostgreSQL dialect to SQLite-compatible SQL.
   * Does NOT mutate the original SQL string.
   * 
   * @param {string} sql - Original SQL statement
   * @returns {string} SQLite-compatible SQL
   */
  translate(sql) {
    if (!sql || typeof sql !== 'string') {
      return sql;
    }

    // Work on a copy - never mutate the original
    let result = sql.trim();

    // Step 1: Normalize whitespace and remove comments
    result = this._removeComments(result);
    result = this._normalizeWhitespace(result);

    // Step 2: Translate data types (only in DDL context)
    result = this._translateDataTypes(result);

    // Step 3: Translate AUTO_INCREMENT
    if (this.engineMode === 'aurora-mysql') {
      result = result.replace(/\bAUTO_INCREMENT\b/gi, 'AUTOINCREMENT');
    }

    // Step 4: Remove engine-specific clauses
    result = this._removeEngineClauses(result);

    // Step 5: Translate functions (apply globally)
    result = this._translateFunctions(result);

    // Step 6: Translate ON CONFLICT (PostgreSQL only)
    if (this.engineMode === 'aurora-postgresql') {
      result = this._translateOnConflict(result);
    }

    return result;
  }

  /**
   * Remove SQL comments (single-line -- and multi-line /* *\/)
   * @private
   */
  _removeComments(sql) {
    // Remove multi-line comments /* ... */
    let result = sql.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove single-line comments -- ...
    result = result.replace(/--[^\n]*/g, '');
    return result;
  }

  /**
   * Normalize whitespace: collapse multiple spaces/tabs/newlines into single space
   * @private
   */
  _normalizeWhitespace(sql) {
    return sql.replace(/\s+/g, ' ').trim();
  }

  /**
   * Translate MySQL/PostgreSQL data types to SQLite equivalents.
   * Only applies within CREATE TABLE statements to avoid replacing data in DML.
   * @private
   */
  _translateDataTypes(sql) {
    if (this.engineMode === 'aurora-postgresql') {
      return this._translatePostgresDataTypes(sql);
    }

    if (this.engineMode !== 'aurora-mysql') {
      return sql;
    }

    // Check if this is a CREATE TABLE statement
    if (!/\bCREATE\s+TABLE\b/i.test(sql)) {
      return sql;
    }

    let result = sql;

    // VARCHAR(N), CHAR(N) → TEXT
    result = result.replace(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');
    result = result.replace(/\bCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');

    // TINYTEXT, MEDIUMTEXT, LONGTEXT → TEXT
    result = result.replace(/\bTINYTEXT\b/gi, 'TEXT');
    result = result.replace(/\bMEDIUMTEXT\b/gi, 'TEXT');
    result = result.replace(/\bLONGTEXT\b/gi, 'TEXT');

    // TINYINT, SMALLINT, MEDIUMINT → INTEGER (before INT to avoid partial match)
    result = result.replace(/\bTINYINT\b/gi, 'INTEGER');
    result = result.replace(/\bSMALLINT\b/gi, 'INTEGER');
    result = result.replace(/\bMEDIUMINT\b/gi, 'INTEGER');

    // BIGINT → INTEGER (before INT to avoid partial match)
    result = result.replace(/\bBIGINT\b/gi, 'INTEGER');

    // INT → INTEGER (word boundary prevents matching TINYINT, BIGINT, etc.)
    result = result.replace(/\bINT\b/gi, 'INTEGER');

    // FLOAT → REAL
    result = result.replace(/\bFLOAT\b/gi, 'REAL');

    // DOUBLE → REAL
    result = result.replace(/\bDOUBLE\b/gi, 'REAL');

    // DECIMAL(N,M) → REAL
    result = result.replace(/\bDECIMAL\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'REAL');

    // DATETIME → TEXT
    result = result.replace(/\bDATETIME\b/gi, 'TEXT');

    // TIMESTAMP → TEXT
    result = result.replace(/\bTIMESTAMP\b/gi, 'TEXT');

    // DATE → TEXT (word boundary avoids matching CURDATE, DATETIME, etc.)
    result = result.replace(/\bDATE\b/gi, 'TEXT');

    // TIME → TEXT (word boundary avoids matching DATETIME, TIMESTAMP, etc.)
    result = result.replace(/\bTIME\b/gi, 'TEXT');

    // JSON → TEXT
    result = result.replace(/\bJSON\b/gi, 'TEXT');

    // TINYBLOB, MEDIUMBLOB, LONGBLOB → BLOB (before BLOB)
    result = result.replace(/\bTINYBLOB\b/gi, 'BLOB');
    result = result.replace(/\bMEDIUMBLOB\b/gi, 'BLOB');
    result = result.replace(/\bLONGBLOB\b/gi, 'BLOB');

    // BLOB → BLOB (already correct, but normalize case)
    result = result.replace(/\bBLOB\b/gi, 'BLOB');

    // ENUM(...) → TEXT
    result = result.replace(/\bENUM\s*\([^)]*\)/gi, 'TEXT');

    // SET(...) → TEXT
    result = result.replace(/\bSET\s*\([^)]*\)/gi, 'TEXT');

    return result;
  }

  /**
   * Remove engine-specific clauses (ENGINE, CHARSET, COLLATE, CHARACTER SET, COMMENT)
   * @private
   */
  _removeEngineClauses(sql) {
    let result = sql;

    // ENGINE=InnoDB (or any engine name)
    result = result.replace(/\s*ENGINE\s*=\s*\w+/gi, '');

    // DEFAULT CHARSET=utf8mb4 (or any charset)
    result = result.replace(/\s*DEFAULT\s+CHARSET\s*=\s*\w+/gi, '');

    // COLLATE = utf8mb4_unicode_ci or COLLATE utf8mb4_unicode_ci
    result = result.replace(/\s*COLLATE\s*=?\s*\w+/gi, '');

    // CHARACTER SET utf8
    result = result.replace(/\s*CHARACTER\s+SET\s+\w+/gi, '');

    // COMMENT 'text'
    result = result.replace(/\s*COMMENT\s+'[^']*'/gi, '');

    return result;
  }

  /**
   * Translate MySQL/PostgreSQL functions to SQLite equivalents.
   * Applied globally (not just in DDL).
   * @private
   */
  _translateFunctions(sql) {
    if (this.engineMode === 'aurora-postgresql') {
      return this._translatePostgresFunctions(sql);
    }

    if (this.engineMode !== 'aurora-mysql') {
      return sql;
    }

    let result = sql;

    // NOW() → datetime('now')
    result = result.replace(/\bNOW\s*\(\s*\)/gi, "datetime('now')");

    // CURDATE() → date('now')
    result = result.replace(/\bCURDATE\s*\(\s*\)/gi, "date('now')");

    // CURTIME() → time('now')
    result = result.replace(/\bCURTIME\s*\(\s*\)/gi, "time('now')");

    // UUID() → lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)))
    result = result.replace(
      /\bUUID\s*\(\s*\)/gi,
      "lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)))"
    );

    return result;
  }

  /**
   * Translate PostgreSQL data types to SQLite equivalents.
   * Only applies within CREATE TABLE statements to avoid replacing data in DML.
   * @private
   */
  _translatePostgresDataTypes(sql) {
    // Check if this is a CREATE TABLE statement
    if (!/\bCREATE\s+TABLE\b/i.test(sql)) {
      return sql;
    }

    let result = sql;

    // BIGSERIAL → INTEGER PRIMARY KEY AUTOINCREMENT (before SERIAL to avoid partial match)
    result = result.replace(/\bBIGSERIAL\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');

    // SERIAL → INTEGER PRIMARY KEY AUTOINCREMENT
    result = result.replace(/\bSERIAL\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');

    // JSONB → TEXT (before JSON to avoid partial match)
    result = result.replace(/\bJSONB\b/gi, 'TEXT');

    // JSON → TEXT
    result = result.replace(/\bJSON\b/gi, 'TEXT');

    // BYTEA → BLOB
    result = result.replace(/\bBYTEA\b/gi, 'BLOB');

    // TIMESTAMPTZ → TEXT (before TIMESTAMP to avoid partial match)
    result = result.replace(/\bTIMESTAMPTZ\b/gi, 'TEXT');

    // TIMESTAMP → TEXT
    result = result.replace(/\bTIMESTAMP\b/gi, 'TEXT');

    // VARCHAR(N) → TEXT
    result = result.replace(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');

    // CHAR(N) → TEXT
    result = result.replace(/\bCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');

    // BOOLEAN → INTEGER
    result = result.replace(/\bBOOLEAN\b/gi, 'INTEGER');

    // NUMERIC(N,M) → REAL
    result = result.replace(/\bNUMERIC\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'REAL');

    // DOUBLE PRECISION → REAL (before FLOAT to avoid conflicts)
    result = result.replace(/\bDOUBLE\s+PRECISION\b/gi, 'REAL');

    // FLOAT → REAL
    result = result.replace(/\bFLOAT\b/gi, 'REAL');

    // TEXT[] → TEXT (arrays stored as JSON text)
    result = result.replace(/\bTEXT\s*\[\s*\]/gi, 'TEXT');

    return result;
  }

  /**
   * Translate PostgreSQL functions to SQLite equivalents.
   * Applied globally (not just in DDL).
   * @private
   */
  _translatePostgresFunctions(sql) {
    let result = sql;

    // NOW() → datetime('now')
    result = result.replace(/\bNOW\s*\(\s*\)/gi, "datetime('now')");

    // CURRENT_TIMESTAMP → datetime('now') (without parentheses - it's a keyword in PostgreSQL)
    result = result.replace(/\bCURRENT_TIMESTAMP\b/gi, "datetime('now')");

    // gen_random_uuid() → lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)))
    result = result.replace(
      /\bgen_random_uuid\s*\(\s*\)/gi,
      "lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)))"
    );

    // COALESCE is already SQLite-compatible, no translation needed

    return result;
  }

  /**
   * Translate PostgreSQL ON CONFLICT clauses to SQLite INSERT OR REPLACE/IGNORE.
   * This is a simplification for the local simulator.
   * @private
   */
  _translateOnConflict(sql) {
    // ON CONFLICT (...) DO NOTHING → INSERT OR IGNORE INTO ...
    let result = sql.replace(
      /\bINSERT\s+INTO\b(.*?)\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+NOTHING\b/gi,
      'INSERT OR IGNORE INTO$1'
    );

    // ON CONFLICT (...) DO UPDATE SET ... → INSERT OR REPLACE INTO ...
    result = result.replace(
      /\bINSERT\s+INTO\b(.*?)\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b[^;]*/gi,
      'INSERT OR REPLACE INTO$1'
    );

    return result;
  }
}

module.exports = SqlTranslator;
