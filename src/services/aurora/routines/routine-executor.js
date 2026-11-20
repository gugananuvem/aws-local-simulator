'use strict';

/**
 * Interpretador de rotinas Aurora.
 *
 * Executa o corpo das rotinas no mesmo database SQLite da Data API, com
 * limites de iteração/profundidade para evitar loops infinitos no simulador.
 */

const Database = require('better-sqlite3');
const { parseBody, parseCall, tokenize } = require('./routine-parser');

const MAX_ITERATIONS = 10000;
const MAX_STATEMENTS = 10000;
const MAX_CALL_DEPTH = 32;

class RoutineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoutineError';
    this.code = 'BadRequestException';
    this.statusCode = 400;
  }
}

class ReturnSignal extends Error {
  constructor(value) {
    super('RETURN');
    this.name = 'ReturnSignal';
    this.value = value;
  }
}

class LeaveSignal extends Error {
  constructor(label) {
    super('LEAVE');
    this.name = 'LeaveSignal';
    this.label = label;
  }
}

class IterateSignal extends Error {
  constructor(label) {
    super('IterateSignal');
    this.name = 'IterateSignal';
    this.label = label;
  }
}

class RoutineExecutor {
  /**
   * @param {{dbEngine: object, store: import('./routine-store').RoutineStore}} dependencies
   */
  constructor({ dbEngine, store }) {
    this.dbEngine = dbEngine;
    this.store = store;
    // Definições em memória das UDFs: evita consultar o db durante um SELECT em andamento.
    this.functionDefinitions = new Map();
  }

  _getDb(dbName, transactionId) {
    if (transactionId) {
      const transaction = this.dbEngine.transactions.get(transactionId);
      if (!transaction) throw new RoutineError(`Transação ${transactionId} não encontrada`);
      return transaction.db;
    }
    return this.dbEngine.getOrCreateDatabase(dbName);
  }

  /**
   * Substitui @variáveis e :parâmetros por placeholders posicionais.
   *
   * @param {string} sql
   * @param {string} dbName
   * @param {import('better-sqlite3').Database} db
   * @param {{params: object, vars: object}} env
   */
  _bindSql(sql, dbName, db, env, substituteWords = false) {
    const source = sql || '';
    const tokens = tokenize(source);
    if (!tokens.length) return { boundSql: source, bindings: [] };

    const reserved = new Set([
      'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'CASE', 'WHEN',
      'THEN', 'ELSE', 'END', 'IN', 'LIKE', 'IS', 'BETWEEN', 'ORDER', 'BY', 'GROUP',
      'HAVING', 'LIMIT', 'DISTINCT', 'TRUE', 'FALSE',
    ]);
    let boundSql = '';
    const bindings = [];
    let cursor = 0;

    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      boundSql += source.slice(cursor, token.start);
      cursor = token.end;

      if (substituteWords && token.type === 'word' && !reserved.has(token.value)) {
        const previous = tokens[index - 1];
        const next = tokens[index + 1];
        const qualified = previous && previous.raw === '.';
        const functionCall = next && next.raw === '(';
        if (!qualified && !functionCall) {
          const lookup = (target) => Object.keys(target).find(
            (name) => name.toLowerCase() === token.raw.toLowerCase()
          );
          const paramKey = lookup(env.params);
          const varKey = lookup(env.vars);
          if (paramKey || varKey) {
            boundSql += '?';
            bindings.push(paramKey ? env.params[paramKey] : env.vars[varKey]);
            continue;
          }
        }
      }

      if (token.type === 'atvar') {
        boundSql += '?';
        bindings.push(this.store.getSessionVar(dbName, db, token.value));
        continue;
      }

      if (token.type === 'named') {
        const key = token.value.slice(1);
        if (Object.prototype.hasOwnProperty.call(env.params, key)) {
          boundSql += '?';
          bindings.push(env.params[key]);
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(env.vars, key)) {
          boundSql += '?';
          bindings.push(env.vars[key]);
          continue;
        }
      }

      boundSql += token.raw;
    }

    boundSql += source.slice(cursor);
    return { boundSql: boundSql.trim(), bindings };
  }

  /**
   * Executa uma única instrução SQL e devolve resultado estruturado.
   */
  _runSql(db, dbName, sql, env, extraBindings = []) {
    const trimmed = (sql || '').trim();
    if (!trimmed) return { type: 'ddl', rows: [], columns: [], changes: 0, lastInsertRowid: 0 };

    const upper = trimmed.toUpperCase();
    const { boundSql, bindings } = this._bindSql(trimmed, dbName, db, env);
    const values = [...bindings, ...extraBindings];

    if (/^(SELECT|PRAGMA|EXPLAIN|WITH)\b/.test(upper)) {
      const statement = db.prepare(boundSql);
      return {
        type: 'select',
        rows: statement.all(...values),
        columns: statement.columns(),
        changes: 0,
        lastInsertRowid: 0,
      };
    }

    if (/^(INSERT|UPDATE|DELETE|REPLACE)\b/.test(upper)) {
      const statement = db.prepare(boundSql);
      const result = statement.run(...values);
      return {
        type: 'dml',
        rows: [],
        columns: [],
        changes: result.changes,
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    }

    db.exec(boundSql);
    return { type: 'ddl', rows: [], columns: [], changes: 0, lastInsertRowid: 0 };
  }

  /**
   * Avalia uma expressão usando o próprio SQLite como avaliador.
   */
  _evaluate(db, dbName, expression, env) {
    if (!expression || !expression.trim()) return null;
    const sql = /^SELECT\b/i.test(expression.trim()) ? expression.trim() : `SELECT ${expression.trim()}`;
    const { boundSql, bindings } = this._bindSql(sql, dbName, db, env, true);
    const row = db.prepare(boundSql).get(...bindings);
    if (!row) return null;
    const values = Object.values(row);
    return values.length ? values[0] : null;
  }

  _assign(env, target, value) {
    const name = (target || '').replace(/^@+/, '');
    if (!name) throw new RoutineError('Alvo de atribuição inválido');
    if (Object.prototype.hasOwnProperty.call(env.params, name)) {
      env.params[name] = value;
      return;
    }
    env.vars[name] = value;
  }

  _runStatements(statements, env, ctx) {
    let lastResult = { type: 'ddl', rows: [], columns: [], changes: 0, lastInsertRowid: 0 };
    let executed = 0;

    for (const node of statements || []) {
      executed++;
      if (executed > MAX_STATEMENTS) {
        throw new RoutineError(`Rotina excedeu o limite de ${MAX_STATEMENTS} instruções`);
      }

      switch (node.type) {
        case 'declare': {
          for (const declaration of node.declarations) {
            const value = declaration.defaultExpression
              ? this._evaluate(ctx.db, ctx.dbName, declaration.defaultExpression, env)
              : null;
            env.vars[declaration.name] = value;
          }
          break;
        }

        case 'set': {
          const value = this._evaluate(ctx.db, ctx.dbName, node.expression, env);
          this._assign(env, node.target, value);
          break;
        }

        case 'if': {
          let matched = false;
          for (const branch of node.branches) {
            if (this._evaluate(ctx.db, ctx.dbName, branch.condition, env)) {
              this._runStatements(branch.statements, env, ctx);
              matched = true;
              break;
            }
          }
          if (!matched && node.elseStatements) this._runStatements(node.elseStatements, env, ctx);
          break;
        }

        case 'while': {
          let iterations = 0;
          while (this._evaluate(ctx.db, ctx.dbName, node.condition, env)) {
            if (++iterations > MAX_ITERATIONS) {
              throw new RoutineError(`Rotina excedeu o limite de ${MAX_ITERATIONS} iterações`);
            }
            try {
              this._runStatements(node.statements, env, ctx);
            } catch (error) {
              if (error instanceof LeaveSignal) break;
              if (error instanceof IterateSignal) continue;
              throw error;
            }
          }
          break;
        }

        case 'loop': {
          let iterations = 0;
          for (;;) {
            if (++iterations > MAX_ITERATIONS) {
              throw new RoutineError(`Rotina excedeu o limite de ${MAX_ITERATIONS} iterações`);
            }
            try {
              this._runStatements(node.statements, env, ctx);
            } catch (error) {
              if (error instanceof LeaveSignal && (!error.label || error.label === node.label)) break;
              if (error instanceof IterateSignal && (!error.label || error.label === node.label)) continue;
              throw error;
            }
          }
          break;
        }

        case 'repeat': {
          let iterations = 0;
          do {
            if (++iterations > MAX_ITERATIONS) {
              throw new RoutineError(`Rotina excedeu o limite de ${MAX_ITERATIONS} iterações`);
            }
            let leave = false;
            try {
              this._runStatements(node.statements, env, ctx);
            } catch (error) {
              if (error instanceof LeaveSignal) leave = true;
              else if (error instanceof IterateSignal) { /* continua */ }
              else throw error;
            }
            if (leave) break;
          } while (!this._evaluate(ctx.db, ctx.dbName, node.condition, env));
          break;
        }

        case 'block':
          this._runStatements(node.statements, env, ctx);
          break;

        case 'selectInto': {
          const result = this._runSql(ctx.db, ctx.dbName, node.sql, env);
          const firstRow = result.rows?.[0];
          this._assign(env, node.target, firstRow ? Object.values(firstRow)[0] : null);
          lastResult = { type: 'ddl', rows: [], columns: [], changes: 0, lastInsertRowid: 0 };
          break;
        }

        case 'sql':
          lastResult = this._runSql(ctx.db, ctx.dbName, node.sql, env);
          break;

        case 'call':
          this._callByName(ctx.dbName, node.name, node.args, [], {
            ...ctx,
            depth: ctx.depth + 1,
          });
          break;

        case 'return':
          throw new ReturnSignal(this._evaluate(ctx.db, ctx.dbName, node.expression, env));

        case 'raise':
          throw new RoutineError(node.message);

        case 'leave':
          throw new LeaveSignal(node.target);

        case 'iterate':
          throw new IterateSignal(node.target);

        default:
          break;
      }
    }

    return lastResult;
  }

  /**
   * Prepara os parâmetros de uma chamada a partir dos argumentos em texto.
   */
  _buildEnvironment(db, dbName, definition, argsText, callBindings) {
    const parameters = definition.parameters || [];
    const env = { params: {}, vars: {} };
    const outRefs = [];
    let bindingIndex = 0;

    parameters.forEach((parameter, index) => {
      const raw = (argsText[index] || '').trim();
      let value = null;

      if (raw === '?') {
        value = callBindings[bindingIndex++];
      } else if (raw.startsWith('@')) {
        outRefs.push({ parameter: parameter.name, variable: raw });
      } else if (raw) {
        value = this._evaluate(db, dbName, raw, { params: {}, vars: {} });
      }

      env.params[parameter.name] = value;
    });

    return { env, outRefs };
  }

  _outValues(definition, env) {
    const values = {};
    for (const parameter of definition.parameters || []) {
      if (parameter.mode === 'OUT' || parameter.mode === 'INOUT') {
        values[parameter.name] = env.params[parameter.name];
      }
    }
    return values;
  }

  _syntheticOutResult(outValues) {
    const entries = Object.entries(outValues);
    if (!entries.length) {
      return { type: 'ddl', rows: [], columns: [], changes: 0, lastInsertRowid: 0 };
    }
    return {
      type: 'select',
      rows: [Object.fromEntries(entries)],
      columns: entries.map(([name]) => ({ name, type: 'TEXT', table: '', column: name, database: '' })),
      changes: 0,
      lastInsertRowid: 0,
    };
  }

  _callByName(dbName, name, argsText, callBindings, ctx) {
    if (ctx.depth > MAX_CALL_DEPTH) {
      throw new RoutineError(`Rotina excedeu o limite de ${MAX_CALL_DEPTH} chamadas aninhadas`);
    }

    const db = ctx.db;
    const definition = this.store.get(dbName, db, 'procedure', name)
      || this.store.get(dbName, db, 'function', name);
    if (!definition) throw new RoutineError(`Rotina ${name} não encontrada`);

    const { env, outRefs } = this._buildEnvironment(db, dbName, definition, argsText, callBindings);
    const context = { ...ctx, db, dbName };

    let result;
    if (definition.kind === 'function') {
      let value = null;
      try {
        this._runStatements(parseBody(definition.body), env, context);
      } catch (error) {
        if (!(error instanceof ReturnSignal)) throw error;
        value = error.value;
      }
      result = {
        type: 'select',
        rows: [{ [definition.name]: value }],
        columns: [{ name: definition.name, type: 'TEXT', table: '', column: definition.name, database: '' }],
        changes: 0,
        lastInsertRowid: 0,
      };
    } else {
      result = this._runStatements(parseBody(definition.body), env, context);
      for (const ref of outRefs) {
        this.store.setSessionVar(dbName, db, ref.variable, env.params[ref.parameter]);
      }
      const outValues = this._outValues(definition, env);
      if (result.type !== 'select' && Object.keys(outValues).length) {
        result = this._syntheticOutResult(outValues);
      }
      result.outValues = outValues;
    }

    return result;
  }

  /**
   * Executa um CALL recebido pela Data API.
   *
   * @param {string} dbName
   * @param {{sql: string, bindings: any[], transactionId?: string}} params
   */
  executeCall(dbName, { sql, bindings = [], transactionId } = {}) {
    const call = parseCall(sql);
    const db = this._getDb(dbName, transactionId);
    return this._callByName(dbName, call.name, call.args, bindings, {
      db,
      dbName,
      depth: 1,
      transactionId,
    });
  }

  /**
   * Executa o corpo de uma function registrada como UDF.
   *
   * Uma UDF roda dentro do SELECT que a chamou; por isso usamos uma conexão
   * separada para o mesmo arquivo .db. Assim o corpo pode conter SQL sem
   * tentar preparar instruções na conexão que já está ocupada.
   */
  executeFunctionScalar(dbName, definition, args, transactionId, depth = 1) {
    if (depth > MAX_CALL_DEPTH) {
      throw new RoutineError(`Function excedeu o limite de ${MAX_CALL_DEPTH} chamadas aninhadas`);
    }

    const expected = (definition.parameters || []).length;
    if ((args || []).length !== expected) {
      throw new RoutineError(`Function ${definition.name} espera ${expected} argumento(s), recebeu ${(args || []).length}`);
    }

    const sourceDb = transactionId ? this._getDb(dbName, transactionId) : this.dbEngine.getOrCreateDatabase(dbName);
    const isolatedDb = new Database(sourceDb.name || ':memory:');
    try {
      isolatedDb.pragma('foreign_keys = ON');
      this.registerFunctions(dbName, isolatedDb, depth + 1);

      const env = { params: {}, vars: {} };
      (definition.parameters || []).forEach((parameter, index) => {
        env.params[parameter.name] = args[index];
      });

      try {
        this._runStatements(parseBody(definition.body), env, {
          db: isolatedDb,
          dbName,
          depth,
          transactionId: null,
        });
        return null;
      } catch (error) {
        if (error instanceof ReturnSignal) return error.value;
        throw error;
      }
    } finally {
      isolatedDb.close();
    }
  }

  /**
   * Registra (ou atualiza) as functions de um database como UDFs SQLite.
   *
   * @param {string} dbName
   * @param {import('better-sqlite3').Database} db
   * @param {number} depth
   */
  registerFunctions(dbName, db, depth = 1) {
    for (const definition of this.store.list(dbName, db, 'function')) {
      const key = `${dbName}.${definition.name}`;
      this.functionDefinitions.set(key, definition);

      try {
        db.function(
          definition.name,
          { deterministic: !!definition.deterministic, varargs: true },
          (...args) => {
            const current = this.functionDefinitions.get(key);
            if (!current) {
              throw new RoutineError(`Function ${definition.name} não existe mais`);
            }
            return this.executeFunctionScalar(dbName, current, args, null, depth + 1);
          }
        );
      } catch (error) {
        throw new RoutineError(`Falha ao registrar function ${definition.name}: ${error.message}`);
      }
    }
  }

  /**
   * Invalida uma UDF removida, substituindo-a por uma função que falha.
   */
  unregisterFunction(dbName, db, name) {
    this.functionDefinitions.delete(`${dbName}.${name}`);
    db.function(name, { varargs: true }, () => {
      throw new RoutineError(`Function ${name} não existe mais`);
    });
  }

  /**
   * Responde comandos de catálogo simulados (SHOW ... STATUS, SELECT @var).
   *
   * @returns {{rows: object[], columns: object[]}|null}
   */
  queryCatalog(dbName, sql, transactionId) {
    const db = this._getDb(dbName, transactionId);
    const trimmed = (sql || '').trim();

    const showMatch = /^SHOW\s+(PROCEDURE|FUNCTION)\s+STATUS\s*(?:WHERE[\s\S]*)?;?$/i.exec(trimmed);
    if (showMatch) {
      const kind = showMatch[1].toLowerCase() === 'procedure' ? 'procedure' : 'function';
      const rows = this.store.list(dbName, db, kind).map((definition) => ({
        Db: dbName,
        Name: definition.name,
        Type: kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION',
        Definition: definition.definitionSql,
      }));
      return {
        type: 'select',
        rows,
        columns: ['Db', 'Name', 'Type', 'Definition'].map((name) => ({
          name,
          type: 'TEXT',
          table: '',
          column: name,
          database: '',
        })),
      };
    }

    const selectVar = /^SELECT\s+(@[A-Za-z_]\w*)(?:\s+AS\s+([A-Za-z_]\w*))?\s*;?$/i.exec(trimmed);
    if (selectVar) {
      const name = selectVar[2] || selectVar[1].slice(1);
      const value = this.store.getSessionVar(dbName, db, selectVar[1]);
      return {
        type: 'select',
        rows: [{ [name]: value }],
        columns: [{ name, type: 'TEXT', table: '', column: name, database: '' }],
      };
    }

    return null;
  }
}

module.exports = { RoutineExecutor, RoutineError };
