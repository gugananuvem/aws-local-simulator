/**
 * DynamoDB UpdateExpression engine (SET / REMOVE / ADD / DELETE)
 *
 * Suporta: caminhos aninhados (a.b, a[0].c), #nomes, :valores,
 * SET com aritmética (+ / -), if_not_exists(), list_append(),
 * ADD em números e sets, DELETE em sets, REMOVE de atributos e itens de lista.
 *
 * Semântica real: todos os operandos do lado direito são avaliados contra o item
 * ORIGINAL antes de qualquer escrita; caminhos duplicados/sobrepostos são rejeitados.
 */

function validation(msg) {
  const err = new Error(msg);
  err.code = 'ValidationException';
  return err;
}

const TOKEN_RE = /\s*(\(|\)|,|\+|-|=|[:#]?[A-Za-z0-9_]+(?:\.[#]?[A-Za-z0-9_]+|\[\d+\])*)/y;

function tokenize(text) {
  const tokens = [];
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(text);
    if (!m) throw validation(`Invalid UpdateExpression: Syntax error; token: "${text.slice(pos, pos + 10)}"`);
    tokens.push(m[1]);
    pos = TOKEN_RE.lastIndex;
  }
  return tokens;
}

/** Quebra a expressão em { SET: '...', REMOVE: '...', ADD: '...', DELETE: '...' }. */
function splitClauses(expression) {
  const re = /(?<![:#\w.])(SET|REMOVE|ADD|DELETE)(?![\w])/gi;
  const marks = [...expression.matchAll(re)];
  if (!marks.length) throw validation('Invalid UpdateExpression: Syntax error; token: "' + expression.trim().split(/\s+/)[0] + '"');
  if (expression.slice(0, marks[0].index).trim()) {
    throw validation(`Invalid UpdateExpression: Syntax error; token: "${expression.trim().split(/\s+/)[0]}"`);
  }
  const clauses = {};
  marks.forEach((m, i) => {
    const kind = m[1].toUpperCase();
    if (clauses[kind] !== undefined) {
      throw validation(`Invalid UpdateExpression: The "${kind}" section can only be used once in an update expression;`);
    }
    const end = i + 1 < marks.length ? marks[i + 1].index : expression.length;
    clauses[kind] = expression.slice(m.index + m[0].length, end).trim();
    if (!clauses[kind]) throw validation(`Invalid UpdateExpression: The ${kind} section is empty`);
  });
  return clauses;
}

/** Divide por vírgula no nível 0 de parênteses. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function applyUpdateExpression(item, expression, names = {}, values = {}, { normalize, keyAttributes = [] }) {
  const clauses = splitClauses(expression);
  const original = JSON.parse(JSON.stringify(item));
  const touched = new Set();
  const usedPaths = [];
  const updatedTopLevel = new Set();

  const resolvePath = (tok) => {
    const segs = [];
    for (const part of tok.split('.')) {
      const m = part.match(/^([#\w]+)((?:\[\d+\])*)$/);
      if (!m) throw validation(`Invalid UpdateExpression: bad document path ${tok}`);
      let name = m[1];
      if (name.startsWith('#')) {
        if (names[name] === undefined) {
          throw validation(`An expression attribute name used in the document path is not defined; attribute name: ${name}`);
        }
        name = names[name];
      }
      segs.push(name);
      for (const idx of m[2].matchAll(/\[(\d+)\]/g)) segs.push(Number(idx[1]));
    }
    touched.add(tok);
    return segs;
  };
  const registerPath = (segs) => {
    for (const other of usedPaths) {
      const n = Math.min(other.length, segs.length);
      if (other.slice(0, n).every((s, i) => s === segs[i])) {
        throw validation(`Invalid UpdateExpression: Two document paths overlap with each other; must remove or rewrite one of these paths; path one: [${other.join(', ')}], path two: [${segs.join(', ')}]`);
      }
    }
    usedPaths.push(segs);
    if (keyAttributes.includes(segs[0])) {
      throw validation(`One or more parameter values were invalid: Cannot update attribute ${segs[0]}. This attribute is part of the key`);
    }
    updatedTopLevel.add(segs[0]);
  };

  const readPath = (obj, segs) => {
    let cur = obj;
    for (const s of segs) {
      if (cur === undefined || cur === null) return undefined;
      cur = cur[s];
    }
    return cur;
  };
  const invalidPath = () => validation('The document path provided in the update expression is invalid for update');

  const writePath = (segs, value) => {
    let parent = item;
    for (let i = 0; i < segs.length - 1; i++) {
      parent = parent?.[segs[i]];
      if (parent === undefined || parent === null || typeof parent !== 'object') throw invalidPath();
    }
    const last = segs[segs.length - 1];
    if (typeof last === 'number') {
      if (!Array.isArray(parent)) throw invalidPath();
      if (last >= parent.length) parent.push(value); else parent[last] = value;
    } else {
      if (Array.isArray(parent)) throw invalidPath();
      parent[last] = value;
    }
  };
  const removePath = (segs) => {
    let parent = item;
    for (let i = 0; i < segs.length - 1; i++) {
      parent = parent?.[segs[i]];
      if (parent === undefined || parent === null || typeof parent !== 'object') throw invalidPath();
    }
    const last = segs[segs.length - 1];
    if (typeof last === 'number') {
      if (Array.isArray(parent) && last < parent.length) parent.splice(last, 1);
    } else if (!Array.isArray(parent)) {
      delete parent[last];
    }
  };

  const value = (tok) => {
    if (values[tok] === undefined) {
      throw validation(`An expression attribute value used in expression is not defined; attribute value: ${tok}`);
    }
    return normalize(values[tok]);
  };

  // --- SET -----------------------------------------------------------------
  const setActions = [];
  if (clauses.SET) {
    for (const action of splitTopLevel(clauses.SET)) {
      const tokens = tokenize(action);
      let p = 0;
      const next = () => tokens[p++];
      const peek = () => tokens[p];
      const expect = (t) => { if (next() !== t) throw validation(`Invalid UpdateExpression: Syntax error; expected "${t}"`); };

      const target = next();
      if (!target || /^[:(),+\-=]$/.test(target)) throw validation('Invalid UpdateExpression: Syntax error in SET action');
      expect('=');

      const parseOperand = () => {
        const tok = next();
        if (tok === undefined) throw validation('Invalid UpdateExpression: Syntax error; unexpected end of SET value');
        if (tok.startsWith(':')) { const v = value(tok); return () => v; }
        const lower = tok.toLowerCase();
        if (lower === 'if_not_exists' && peek() === '(') {
          next();
          const pathTok = next();
          const segs = resolvePath(pathTok);
          expect(',');
          const fallback = parseOperand();
          expect(')');
          return () => { const cur = readPath(original, segs); return cur !== undefined ? cur : fallback(); };
        }
        if (lower === 'list_append' && peek() === '(') {
          next();
          const a = parseOperand();
          expect(',');
          const b = parseOperand();
          expect(')');
          return () => {
            const x = a(), y = b();
            if (!Array.isArray(x) || !Array.isArray(y)) {
              throw validation('An operand in the update expression has an incorrect data type');
            }
            return [...x, ...y];
          };
        }
        const segs = resolvePath(tok);
        return () => {
          const v = readPath(original, segs);
          if (v === undefined) {
            throw validation('The provided expression refers to an attribute that does not exist in the item');
          }
          return v;
        };
      };

      const left = parseOperand();
      let rhs = left;
      if (peek() === '+' || peek() === '-') {
        const op = next();
        const right = parseOperand();
        rhs = () => {
          const a = left(), b = right();
          if (typeof a !== 'number' || typeof b !== 'number') {
            throw validation('An operand in the update expression has an incorrect data type');
          }
          return op === '+' ? a + b : a - b;
        };
      }
      if (p < tokens.length) throw validation(`Invalid UpdateExpression: Syntax error; token: "${tokens[p]}"`);

      const segs = resolvePath(target);
      registerPath(segs);
      setActions.push({ segs, rhs });
    }
  }

  // --- REMOVE --------------------------------------------------------------
  const removeActions = [];
  if (clauses.REMOVE) {
    for (const part of splitTopLevel(clauses.REMOVE)) {
      const segs = resolvePath(part);
      registerPath(segs);
      removeActions.push(segs);
    }
  }

  // --- ADD / DELETE --------------------------------------------------------
  const parsePathValue = (part, kind) => {
    const m = part.match(/^(\S+)\s+(:[A-Za-z0-9_]+)$/);
    if (!m) throw validation(`Invalid UpdateExpression: Syntax error in ${kind} action`);
    const raw = values[m[2]];
    if (raw === undefined) {
      throw validation(`An expression attribute value used in expression is not defined; attribute value: ${m[2]}`);
    }
    const segs = resolvePath(m[1]);
    registerPath(segs);
    return { segs, raw, val: normalize(raw) };
  };
  const addActions = clauses.ADD ? splitTopLevel(clauses.ADD).map((p) => parsePathValue(p, 'ADD')) : [];
  const delActions = clauses.DELETE ? splitTopLevel(clauses.DELETE).map((p) => parsePathValue(p, 'DELETE')) : [];

  // --- aplicação (RHS já avaliado contra o original) -----------------------
  const computed = setActions.map((a) => ({ segs: a.segs, v: a.rhs() }));
  for (const c of computed) writePath(c.segs, c.v);
  for (const segs of removeActions) removePath(segs);

  for (const { segs, raw, val } of addActions) {
    const cur = readPath(item, segs);
    if (raw.N !== undefined) {
      if (cur !== undefined && typeof cur !== 'number') {
        throw validation('An operand in the update expression has an incorrect data type');
      }
      writePath(segs, (cur || 0) + val);
    } else if (raw.SS !== undefined || raw.NS !== undefined || raw.BS !== undefined) {
      if (cur !== undefined && !Array.isArray(cur)) {
        throw validation('An operand in the update expression has an incorrect data type');
      }
      writePath(segs, [...new Set([...(cur || []), ...val])]);
    } else {
      throw validation('Incorrect operand type for operator or function; operator: ADD');
    }
  }
  for (const { segs, raw, val } of delActions) {
    if (raw.SS === undefined && raw.NS === undefined && raw.BS === undefined) {
      throw validation('Incorrect operand type for operator or function; operator: DELETE');
    }
    const cur = readPath(item, segs);
    if (cur === undefined) continue;
    if (!Array.isArray(cur)) throw validation('An operand in the update expression has an incorrect data type');
    const remaining = cur.filter((x) => !val.includes(x));
    if (remaining.length) writePath(segs, remaining); else removePath(segs);
  }

  return { updatedAttributes: [...updatedTopLevel] };
}

module.exports = { applyUpdateExpression };
