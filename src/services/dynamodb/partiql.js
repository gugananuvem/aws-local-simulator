/**
 * PartiQL parser for DynamoDB ExecuteStatement.
 *
 * Suporta:
 *   SELECT * | attr[, attr...] FROM "tabela" [WHERE cond [AND cond...]] [LIMIT n]
 *   INSERT INTO "tabela" VALUE {'attr': valor, ...}
 *   UPDATE "tabela" SET attr = valor[, ...] WHERE chave = valor [AND ...]
 *   DELETE FROM "tabela" WHERE chave = valor [AND ...]
 *
 * Condições: =, <>, !=, <, <=, >, >=, begins_with(attr, valor).
 * Valores: 'texto', números, TRUE, FALSE, NULL, ?, {map} e [lista].
 * Parâmetros ? são posicionais e recebem valores tipados no formato DynamoDB ({ S: '...' }).
 */

function validation(message) {
  const err = new Error(message);
  err.code = 'ValidationException';
  return err;
}

function tokenize(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      // Literal de texto ('...') ou identificador entre aspas ("..."). Aspas duplicadas escapam a aspa.
      const quote = ch;
      let text = '';
      i++;
      while (true) {
        if (i >= input.length) throw validation('Unterminated string or quoted identifier in statement');
        if (input[i] === quote) {
          if (input[i + 1] === quote) {
            text += quote;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        text += input[i++];
      }
      tokens.push({ type: quote === "'" ? 'string' : 'ident', value: text });
      continue;
    }

    if (ch === '?') {
      tokens.push({ type: 'param' });
      i++;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=' || two === '!=') {
      tokens.push({ type: 'op', value: two === '!=' ? '<>' : two });
      i += 2;
      continue;
    }
    if (ch === '=' || ch === '<' || ch === '>') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    if ('{}[],:()*;'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch });
      i++;
      continue;
    }

    const rest = input.slice(i);
    const num = /^-?\d+(\.\d+)?/.exec(rest);
    if (num) {
      tokens.push({ type: 'number', value: Number(num[0]), raw: num[0] });
      i += num[0].length;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (word) {
      tokens.push({ type: 'word', value: word[0] });
      i += word[0].length;
      continue;
    }

    throw validation(`Unexpected character '${ch}' in statement`);
  }

  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.paramCount = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  atEnd() {
    return this.pos >= this.tokens.length;
  }

  error(message) {
    const t = this.peek();
    const near = t ? ` near '${t.raw ?? t.value ?? t.type}'` : ' at end of statement';
    return validation(`Statement syntax error: ${message}${near}`);
  }

  isWord(word, offset = 0) {
    const t = this.peek(offset);
    return !!t && t.type === 'word' && t.value.toUpperCase() === word;
  }

  expectWord(word) {
    if (!this.isWord(word)) throw this.error(`expected ${word}`);
    this.pos++;
  }

  isPunct(p, offset = 0) {
    const t = this.peek(offset);
    return !!t && t.type === 'punct' && t.value === p;
  }

  eatPunct(p) {
    if (this.isPunct(p)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expectPunct(p) {
    if (!this.eatPunct(p)) throw this.error(`expected '${p}'`);
  }

  identifier() {
    const t = this.peek();
    if (t && (t.type === 'ident' || t.type === 'word')) {
      this.pos++;
      return t.value;
    }
    throw this.error('expected identifier');
  }

  value() {
    const t = this.peek();
    if (!t) throw this.error('expected value');

    if (t.type === 'param') {
      this.pos++;
      return { kind: 'param', index: this.paramCount++ };
    }
    if (t.type === 'string') {
      this.pos++;
      return { kind: 'literal', av: { S: t.value } };
    }
    if (t.type === 'number') {
      this.pos++;
      return { kind: 'literal', av: { N: t.raw } };
    }
    if (this.isWord('TRUE') || this.isWord('FALSE')) {
      const isTrue = this.isWord('TRUE');
      this.pos++;
      return { kind: 'literal', av: { BOOL: isTrue } };
    }
    if (this.isWord('NULL')) {
      this.pos++;
      return { kind: 'literal', av: { NULL: true } };
    }
    if (this.isPunct('{')) return this.mapLiteral();
    if (this.isPunct('[')) return this.listLiteral();

    throw this.error('expected value');
  }

  mapLiteral() {
    this.expectPunct('{');
    const entries = [];
    if (!this.isPunct('}')) {
      do {
        const t = this.peek();
        if (!t || !['string', 'ident', 'word'].includes(t.type)) throw this.error('expected attribute name');
        this.pos++;
        this.expectPunct(':');
        entries.push([t.value, this.value()]);
      } while (this.eatPunct(','));
    }
    this.expectPunct('}');
    return { kind: 'map', entries };
  }

  listLiteral() {
    this.expectPunct('[');
    const items = [];
    if (!this.isPunct(']')) {
      do {
        items.push(this.value());
      } while (this.eatPunct(','));
    }
    this.expectPunct(']');
    return { kind: 'list', items };
  }

  predicate() {
    if (this.isWord('BEGINS_WITH') && this.isPunct('(', 1)) {
      this.pos += 2;
      const attr = this.identifier();
      this.expectPunct(',');
      const value = this.value();
      this.expectPunct(')');
      return { attr, op: 'begins_with', value };
    }

    const attr = this.identifier();
    const t = this.peek();
    if (!t || t.type !== 'op') throw this.error('expected comparison operator');
    this.pos++;
    return { attr, op: t.value, value: this.value() };
  }

  conditions() {
    const preds = [this.predicate()];
    while (this.isWord('AND')) {
      this.pos++;
      preds.push(this.predicate());
    }
    return preds;
  }

  select() {
    this.expectWord('SELECT');
    let projection = null;
    if (!this.eatPunct('*')) {
      projection = [this.identifier()];
      while (this.eatPunct(',')) projection.push(this.identifier());
    }
    this.expectWord('FROM');
    const table = this.identifier();

    let where = [];
    if (this.isWord('WHERE')) {
      this.pos++;
      where = this.conditions();
    }

    let limit = null;
    if (this.isWord('LIMIT')) {
      this.pos++;
      const t = this.peek();
      if (!t || t.type !== 'number' || !Number.isInteger(t.value) || t.value <= 0) {
        throw this.error('LIMIT expects a positive integer');
      }
      this.pos++;
      limit = t.value;
    }

    return { type: 'SELECT', table, projection, where, limit };
  }

  insert() {
    this.expectWord('INSERT');
    this.expectWord('INTO');
    const table = this.identifier();
    this.expectWord('VALUE');
    const item = this.mapLiteral();
    return { type: 'INSERT', table, item };
  }

  update() {
    this.expectWord('UPDATE');
    const table = this.identifier();
    this.expectWord('SET');
    const assignments = [];
    do {
      const attr = this.identifier();
      const t = this.peek();
      if (!t || t.type !== 'op' || t.value !== '=') throw this.error("expected '=' in SET");
      this.pos++;
      assignments.push({ attr, value: this.value() });
    } while (this.eatPunct(','));
    this.expectWord('WHERE');
    const where = this.conditions();
    return { type: 'UPDATE', table, assignments, where };
  }

  remove() {
    this.expectWord('DELETE');
    this.expectWord('FROM');
    const table = this.identifier();
    this.expectWord('WHERE');
    const where = this.conditions();
    return { type: 'DELETE', table, where };
  }

  statement() {
    let stmt;
    if (this.isWord('SELECT')) stmt = this.select();
    else if (this.isWord('INSERT')) stmt = this.insert();
    else if (this.isWord('UPDATE')) stmt = this.update();
    else if (this.isWord('DELETE')) stmt = this.remove();
    else throw this.error('expected SELECT, INSERT, UPDATE or DELETE');

    this.eatPunct(';');
    if (!this.atEnd()) throw this.error('unexpected token');
    return stmt;
  }
}

/**
 * Converte a string PartiQL em uma árvore de comandos.
 * @throws {Error} com code 'ValidationException' quando a sintaxe é inválida.
 */
function parsePartiQL(statement) {
  if (typeof statement !== 'string' || !statement.trim()) {
    throw validation('Statement is empty');
  }
  return new Parser(tokenize(statement)).statement();
}

/**
 * Resolve um valor do parser para o formato tipado do DynamoDB, usando os Parameters da requisição.
 */
function bindValue(node, parameters = []) {
  switch (node.kind) {
    case 'literal':
      return node.av;
    case 'param': {
      const value = parameters[node.index];
      if (value === undefined) {
        throw validation(`Number of parameters in request and statement don't match: missing parameter ${node.index + 1}`);
      }
      return value;
    }
    case 'map': {
      const M = {};
      for (const [key, child] of node.entries) M[key] = bindValue(child, parameters);
      return { M };
    }
    case 'list':
      return { L: node.items.map((child) => bindValue(child, parameters)) };
    default:
      throw validation('Unsupported value in statement');
  }
}

module.exports = { parsePartiQL, bindValue };
