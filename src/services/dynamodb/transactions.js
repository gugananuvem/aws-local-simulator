/**
 * DynamoDB Transactions - TransactWriteItems / TransactGetItems
 *
 * - Put, Update, Delete, ConditionCheck (com ConditionExpression)
 * - ClientRequestToken (idempotência por 10 minutos)
 * - TransactionCanceledException com CancellationReasons
 * - Escrita atômica: valida tudo antes de gravar qualquer tabela
 */
const crypto = require('crypto');

const MAX_ITEMS = 100;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const OPS = ['Put', 'Update', 'Delete', 'ConditionCheck'];

function awsError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}
const validation = (m) => awsError('ValidationException', m);

// ---------------------------------------------------------------------------
// ConditionExpression
// ---------------------------------------------------------------------------

const TOKEN_RE = /\s*(<>|<=|>=|=|<|>|\(|\)|,|[:#]?[A-Za-z0-9_]+(?:\.[#]?[A-Za-z0-9_]+|\[\d+\])*)/y;

function tokenize(expr) {
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < expr.length) {
    if (/^\s*$/.test(expr.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(expr);
    if (!m) throw validation(`Invalid ConditionExpression: Syntax error near "${expr.slice(pos, pos + 10)}"`);
    tokens.push(m[1]);
    pos = TOKEN_RE.lastIndex;
  }
  return tokens;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    // Sets (SS/NS) ignoram ordem; listas não. Sem metadados de tipo, comparamos em ordem.
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function typeOf(v) {
  if (v === null) return 'NULL';
  if (typeof v === 'string') return 'S';
  if (typeof v === 'number') return 'N';
  if (typeof v === 'boolean') return 'BOOL';
  if (Array.isArray(v)) return 'L';
  if (typeof v === 'object') return 'M';
  return undefined;
}

/**
 * Compila a expressão e devolve (item) => boolean.
 * `normalize` converte AttributeValue -> valor JS.
 */
function compileCondition(expression, names = {}, values = {}, normalize) {
  const tokens = tokenize(expression);
  let p = 0;
  const peek = () => tokens[p];
  const peekU = () => (tokens[p] || '').toUpperCase();
  const next = () => tokens[p++];
  const expect = (t) => {
    if (next() !== t) throw validation(`Invalid ConditionExpression: expected "${t}"`);
  };

  const resolvePath = (tok) => {
    const parts = tok.split('.').map((seg) => {
      const m = seg.match(/^([#\w]+)((?:\[\d+\])*)$/);
      if (!m) throw validation(`Invalid ConditionExpression: bad path ${tok}`);
      let name = m[1];
      if (name.startsWith('#')) {
        if (names[name] === undefined) {
          throw validation(`An expression attribute name used in the document path is not defined; attribute name: ${name}`);
        }
        name = names[name];
      }
      const idx = [...m[2].matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
      return [name, ...idx];
    });
    return parts.flat();
  };
  const readPath = (item, path) => {
    let cur = item;
    for (const seg of path) {
      if (cur === undefined || cur === null) return undefined;
      cur = cur[seg];
    }
    return cur;
  };

  // operand -> (item) => valor
  const parseOperand = () => {
    const tok = next();
    if (tok === undefined) throw validation('Invalid ConditionExpression: unexpected end');
    if (tok.startsWith(':')) {
      if (values[tok] === undefined) {
        throw validation(`An expression attribute value used in expression is not defined; attribute value: ${tok}`);
      }
      const v = normalize(values[tok]);
      return () => v;
    }
    if (tok.toLowerCase() === 'size' && peek() === '(') {
      next();
      const inner = parseOperand();
      expect(')');
      return (item) => {
        const v = inner(item);
        if (typeof v === 'string' || Array.isArray(v)) return v.length;
        if (v && typeof v === 'object') return Object.keys(v).length;
        return undefined;
      };
    }
    const path = resolvePath(tok);
    return (item) => readPath(item, path);
  };

  const cmp = (op, a, b) => {
    if (op === '=') return deepEqual(a, b);
    if (op === '<>') return !deepEqual(a, b);
    if (a === undefined || b === undefined || typeOf(a) !== typeOf(b)) return false;
    if (op === '<') return a < b;
    if (op === '<=') return a <= b;
    if (op === '>') return a > b;
    if (op === '>=') return a >= b;
    return false;
  };

  const parsePrimary = () => {
    const tok = peek();
    if (tok === '(') {
      next();
      const e = parseOr();
      expect(')');
      return e;
    }
    const lower = (tok || '').toLowerCase();
    const FUNCS = ['attribute_exists', 'attribute_not_exists', 'begins_with', 'contains', 'attribute_type'];
    if (FUNCS.includes(lower) && tokens[p + 1] === '(') {
      next(); next();
      const args = [parseOperand()];
      while (peek() === ',') { next(); args.push(parseOperand()); }
      expect(')');
      switch (lower) {
        case 'attribute_exists': return (it) => args[0](it) !== undefined;
        case 'attribute_not_exists': return (it) => args[0](it) === undefined;
        case 'begins_with': return (it) => {
          const a = args[0](it), b = args[1]?.(it);
          return typeof a === 'string' && typeof b === 'string' && a.startsWith(b);
        };
        case 'contains': return (it) => {
          const a = args[0](it), b = args[1]?.(it);
          if (typeof a === 'string') return typeof b === 'string' && a.includes(b);
          if (Array.isArray(a)) return a.some((x) => deepEqual(x, b));
          return false;
        };
        case 'attribute_type': return (it) => typeOf(args[0](it)) === args[1]?.(it);
      }
    }

    const left = parseOperand();
    const op = peekU();
    if (['=', '<>', '<', '<=', '>', '>='].includes(peek())) {
      const o = next();
      const right = parseOperand();
      return (it) => cmp(o, left(it), right(it));
    }
    if (op === 'BETWEEN') {
      next();
      const lo = parseOperand();
      if (peekU() !== 'AND') throw validation('Invalid ConditionExpression: BETWEEN requires AND');
      next();
      const hi = parseOperand();
      return (it) => {
        const v = left(it);
        return cmp('>=', v, lo(it)) && cmp('<=', v, hi(it));
      };
    }
    if (op === 'IN') {
      next();
      expect('(');
      const list = [parseOperand()];
      while (peek() === ',') { next(); list.push(parseOperand()); }
      expect(')');
      return (it) => list.some((f) => deepEqual(left(it), f(it)));
    }
    throw validation(`Invalid ConditionExpression: Syntax error; token: "${tok}"`);
  };

  const parseNot = () => {
    if (peekU() === 'NOT') {
      next();
      const e = parseNot();
      return (it) => !e(it);
    }
    return parsePrimary();
  };
  const parseAnd = () => {
    const parts = [parseNot()];
    while (peekU() === 'AND') { next(); parts.push(parseNot()); }
    return (it) => parts.every((f) => f(it));
  };
  function parseOr() {
    const parts = [parseAnd()];
    while (peekU() === 'OR') { next(); parts.push(parseAnd()); }
    return (it) => parts.some((f) => f(it));
  }

  const fn = parseOr();
  if (p < tokens.length) throw validation(`Invalid ConditionExpression: unexpected token "${tokens[p]}"`);
  return fn;
}

// ---------------------------------------------------------------------------
// Idempotência
// ---------------------------------------------------------------------------

const tokenCache = new Map(); // token -> { hash, at, response }

function purgeTokens() {
  const now = Date.now();
  for (const [k, v] of tokenCache) if (now - v.at > TOKEN_TTL_MS) tokenCache.delete(k);
}

// ---------------------------------------------------------------------------
// TransactWriteItems
// ---------------------------------------------------------------------------

function getTable(sim, name) {
  const table = sim.tables.get(name);
  if (!table) throw awsError('ResourceNotFoundException', 'Requested resource not found');
  return table;
}

function requireKey(sim, table, key, label) {
  if (!key || typeof key !== 'object') throw validation(`${label}: Key is required`);
  if (key[table.hashKey] === undefined) {
    throw validation(`The provided key element does not match the schema`);
  }
  if (table.rangeKey && key[table.rangeKey] === undefined) {
    throw validation(`The provided key element does not match the schema`);
  }
}

function transactWriteItems(sim, params) {
  const { TransactItems, ClientRequestToken, ReturnConsumedCapacity, ReturnItemCollectionMetrics } = params || {};

  if (!Array.isArray(TransactItems) || TransactItems.length < 1) {
    throw validation('1 validation error detected: Value at \'transactItems\' failed to satisfy constraint: Member must have length greater than or equal to 1');
  }
  if (TransactItems.length > MAX_ITEMS) {
    throw validation(`1 validation error detected: Value at 'transactItems' failed to satisfy constraint: Member must have length less than or equal to ${MAX_ITEMS}`);
  }
  if (ClientRequestToken !== undefined && (ClientRequestToken.length < 1 || ClientRequestToken.length > 36)) {
    throw validation('ClientRequestToken must be between 1 and 36 characters');
  }

  // Idempotência
  purgeTokens();
  const hash = crypto.createHash('sha256').update(JSON.stringify(TransactItems)).digest('hex');
  if (ClientRequestToken) {
    const cached = tokenCache.get(ClientRequestToken);
    if (cached) {
      if (cached.hash !== hash) {
        throw awsError('IdempotentParameterMismatchException',
          'The request uses the same client token as a previous, but non-identical request.');
      }
      return cached.response;
    }
  }

  // Normalização / validação estrutural
  const seen = new Set();
  const ops = TransactItems.map((entry, i) => {
    const kinds = OPS.filter((k) => entry?.[k]);
    if (kinds.length !== 1) {
      throw validation('TransactItems can only contain one of Check, Put, Update or Delete');
    }
    const kind = kinds[0];
    const spec = entry[kind];
    if (!spec.TableName) throw validation(`TransactItems[${i}]: TableName is required`);
    const table = getTable(sim, spec.TableName);

    let key;
    if (kind === 'Put') {
      if (!spec.Item) throw validation('One or more parameter values were invalid: Item is required');
      const hv = spec.Item[table.hashKey];
      if (hv === undefined) throw validation(`One or more parameter values were invalid: Missing the key ${table.hashKey} in the item`);
      if (table.rangeKey && spec.Item[table.rangeKey] === undefined) {
        throw validation(`One or more parameter values were invalid: Missing the key ${table.rangeKey} in the item`);
      }
      key = { [table.hashKey]: hv, ...(table.rangeKey ? { [table.rangeKey]: spec.Item[table.rangeKey] } : {}) };
    } else {
      requireKey(sim, table, spec.Key, `TransactItems[${i}]`);
      key = spec.Key;
    }
    if (kind === 'Update' && !spec.UpdateExpression) {
      throw validation('UpdateExpression is required for Update');
    }
    if (kind === 'ConditionCheck' && !spec.ConditionExpression) {
      throw validation('ConditionExpression is required for ConditionCheck');
    }

    const itemKey = sim.getItemKeyFromKeys(key, table);
    const id = `${spec.TableName}\u0000${itemKey}`;
    if (seen.has(id)) throw validation('Transaction request cannot include multiple operations on one item');
    seen.add(id);

    const normalize = (v) => sim.normalizeValue(v, table);
    const condition = spec.ConditionExpression
      ? compileCondition(spec.ConditionExpression, spec.ExpressionAttributeNames || {}, spec.ExpressionAttributeValues || {}, normalize)
      : null;

    return { kind, spec, table, itemKey, condition };
  });

  const tableNames = [...new Set(ops.map((o) => o.spec.TableName))].sort();

  const run = () => {
    // Snapshot por tabela (cópia, para aplicar tudo ou nada)
    const working = new Map();
    for (const name of tableNames) working.set(name, JSON.parse(JSON.stringify(sim.store.read(name))));
    const find = (op) => working.get(op.spec.TableName)
      .findIndex((it) => sim.getItemKey(it, op.table) === op.itemKey);

    // Fase 1: condições
    const reasons = ops.map((op) => {
      const idx = find(op);
      const existing = idx === -1 ? undefined : working.get(op.spec.TableName)[idx];
      if (op.condition && !op.condition(existing || {})) {
        const reason = { Code: 'ConditionalCheckFailed', Message: 'The conditional request failed' };
        if (op.spec.ReturnValuesOnConditionCheckFailure === 'ALL_OLD' && existing) {
          reason.Item = sim.marshallItem(existing, op.table);
        }
        return reason;
      }
      return { Code: 'None' };
    });

    if (reasons.some((r) => r.Code !== 'None')) {
      const summary = reasons.map((r) => r.Code).join(', ');
      throw awsError('TransactionCanceledException',
        `Transaction cancelled, please refer cancellation reasons for specific reasons [${summary}]`,
        { cancellationReasons: reasons });
    }

    // Fase 2: aplicação
    const now = new Date().toISOString();
    const delta = new Map(tableNames.map((n) => [n, 0]));
    for (const op of ops) {
      const arr = working.get(op.spec.TableName);
      const idx = find(op);
      const { spec, table } = op;
      if (op.kind === 'Put') {
        const item = sim.normalizeItem(spec.Item, table);
        item._createdAt = idx !== -1 ? (arr[idx]._createdAt || now) : now;
        item._updatedAt = now;
        if (idx !== -1) arr[idx] = item; else { arr.push(item); delta.set(spec.TableName, delta.get(spec.TableName) + 1); }
      } else if (op.kind === 'Update') {
        const base = idx !== -1 ? arr[idx] : { ...sim.normalizeItem(spec.Key, table), _createdAt: now };
        base._updatedAt = now;
        sim.processUpdateExpression(base, spec.UpdateExpression, spec.ExpressionAttributeNames || {}, spec.ExpressionAttributeValues || {}, table);
        if (idx !== -1) arr[idx] = base; else { arr.push(base); delta.set(spec.TableName, delta.get(spec.TableName) + 1); }
      } else if (op.kind === 'Delete') {
        if (idx !== -1) { arr.splice(idx, 1); delta.set(spec.TableName, delta.get(spec.TableName) - 1); }
      }
      // ConditionCheck: sem efeito
    }

    for (const name of tableNames) {
      sim.store.write(name, working.get(name));
      const t = sim.tables.get(name);
      t.itemCount = Math.max(0, (t.itemCount || 0) + delta.get(name));
    }
    sim.persistTables();

    const response = {};
    if (ReturnConsumedCapacity && ReturnConsumedCapacity !== 'NONE') {
      response.ConsumedCapacity = tableNames.map((name) => ({
        TableName: name,
        CapacityUnits: ops.filter((o) => o.spec.TableName === name).length * 2,
      }));
    }
    if (ReturnItemCollectionMetrics === 'SIZE') response.ItemCollectionMetrics = {};
    return response;
  };

  return sim._withTableLocks(tableNames, async () => {
    const response = run();
    if (ClientRequestToken) tokenCache.set(ClientRequestToken, { hash, at: Date.now(), response });
    return response;
  });
}

// ---------------------------------------------------------------------------
// TransactGetItems
// ---------------------------------------------------------------------------

function transactGetItems(sim, params) {
  const { TransactItems } = params || {};
  if (!Array.isArray(TransactItems) || TransactItems.length < 1 || TransactItems.length > MAX_ITEMS) {
    throw validation(`TransactItems must contain between 1 and ${MAX_ITEMS} items`);
  }

  const seen = new Set();
  const responses = TransactItems.map((entry, i) => {
    const get = entry?.Get;
    if (!get) throw validation('TransactItems can only contain Get');
    const table = getTable(sim, get.TableName);
    requireKey(sim, table, get.Key, `TransactItems[${i}]`);
    const itemKey = sim.getItemKeyFromKeys(get.Key, table);
    const id = `${get.TableName}\u0000${itemKey}`;
    if (seen.has(id)) throw validation('Transaction request cannot include multiple operations on one item');
    seen.add(id);

    const item = sim.store.read(get.TableName).find((it) => sim.getItemKey(it, table) === itemKey);
    if (!item) return {};
    let marshalled = sim.marshallItem(item, table);
    if (get.ProjectionExpression) {
      marshalled = sim.applyProjection([marshalled], get.ProjectionExpression, get.ExpressionAttributeNames || {})[0];
    }
    return { Item: marshalled };
  });

  return { Responses: responses };
}

module.exports = { transactWriteItems, transactGetItems, compileCondition };
