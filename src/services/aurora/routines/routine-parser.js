'use strict';

/**
 * Parser de rotinas (procedures/functions) para o simulador Aurora.
 *
 * Implementa um subconjunto controlado das sintaxes MySQL e PostgreSQL,
 * suficiente para declarar parâmetros, corpo procedural e controle de fluxo.
 * Nenhuma dependência externa é necessária.
 */

const { splitTopLevel, normalizeType } = require('./sql-bindings');

const TWO_CHAR_OPERATORS = [':=', '>=', '<=', '<>', '!=', '||', '&&', '=>', '::'];

/**
 * Tokeniza o SQL mantendo o texto original de cada token.
 *
 * @param {string} source
 * @returns {Array<{type: string, value: string, raw: string, start: number, end: number, content?: string}>}
 */
function tokenize(source) {
  const tokens = [];
  const text = source || '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === quote) {
          if (text[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (text[i] === '\\' && i + 1 < text.length) {
          i += 2;
          continue;
        }
        i++;
      }
      const raw = text.slice(start, i);
      tokens.push({
        type: quote === "'" ? 'string' : 'quoted',
        value: raw.slice(1, -1).replace(new RegExp(quote + quote, 'g'), quote),
        raw,
        start,
        end: i,
      });
      continue;
    }

    if (ch === '$') {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(text.slice(i));
      if (tag) {
        const start = i;
        const close = text.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? text.length : close + tag[0].length;
        tokens.push({
          type: 'dollar',
          value: text.slice(i + tag[0].length, close === -1 ? text.length : close),
          raw: text.slice(start, end),
          start,
          end,
        });
        i = end;
        continue;
      }
    }

    if (ch === '@') {
      const match = /^@@?[A-Za-z_]\w*/.exec(text.slice(i));
      if (match) {
        tokens.push({ type: 'atvar', value: match[0], raw: match[0], start: i, end: i + match[0].length });
        i += match[0].length;
        continue;
      }
    }

    if (ch === ':') {
      const match = /^:[A-Za-z_]\w*/.exec(text.slice(i));
      if (match) {
        tokens.push({ type: 'named', value: match[0], raw: match[0], start: i, end: i + match[0].length });
        i += match[0].length;
        continue;
      }
    }

    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_]\w*/.exec(text.slice(i));
      tokens.push({ type: 'word', value: match[0].toUpperCase(), raw: match[0], start: i, end: i + match[0].length });
      i += match[0].length;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const match = /^\d+(\.\d+)?/.exec(text.slice(i));
      tokens.push({ type: 'number', value: match[0], raw: match[0], start: i, end: i + match[0].length });
      i += match[0].length;
      continue;
    }

    const two = text.slice(i, i + 2);
    if (TWO_CHAR_OPERATORS.includes(two)) {
      tokens.push({ type: 'op', value: two, raw: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }

    tokens.push({ type: 'punct', value: ch, raw: ch, start: i, end: i + 1 });
    i++;
  }

  return tokens;
}

function isWord(token, value) {
  return !!token && token.type === 'word' && token.value === value;
}

function isPunct(token, value) {
  return !!token && token.type === 'punct' && token.raw === value;
}

function unquote(value) {
  if (!value) return '';
  const raw = value.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith('`') && raw.endsWith('`'))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function matchingParen(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (isPunct(tokens[i], '(')) depth++;
    else if (isPunct(tokens[i], ')')) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findTopLevelWord(tokens, start, words) {
  let depth = 0;
  const wanted = Array.isArray(words) ? words : [words];
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (isPunct(token, '(')) depth++;
    else if (isPunct(token, ')')) depth--;
    else if (depth === 0 && token.type === 'word' && wanted.includes(token.value)) return i;
  }
  return -1;
}

function findTopLevelOp(tokens, start, operators) {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (isPunct(token, '(')) depth++;
    else if (isPunct(token, ')')) depth--;
    else if (depth === 0 && operators.includes(token.value)) return i;
  }
  return -1;
}

function semicolonIndex(tokens, start) {
  return findTopLevelOp(tokens, start, [';']);
}

function splitTokensByComma(tokens) {
  const groups = [];
  let current = [];
  let depth = 0;
  for (const token of tokens) {
    if (isPunct(token, '(')) depth++;
    else if (isPunct(token, ')')) depth--;
    if (isPunct(token, ',') && depth === 0) {
      if (current.length) groups.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length) groups.push(current);
  return groups;
}

function findBlockEnd(tokens, beginIndex) {
  // Apenas BEGIN/END isolados delimitam o corpo da rotina. Encerramentos
  // como END IF, END LOOP, END REPEAT, END CASE e END WHILE são internos.
  const innerEnds = ['IF', 'LOOP', 'REPEAT', 'CASE', 'WHILE'];
  let depth = 1;
  for (let i = beginIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (isWord(token, 'BEGIN')) {
      depth++;
      continue;
    }
    if (!isWord(token, 'END')) continue;

    const next = tokens[i + 1];
    if (next && innerEnds.includes(next.value)) {
      i++;
      continue;
    }

    depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function parseParameters(tokens) {
  return splitTokensByComma(tokens).map((group) => {
    let mode = 'IN';
    if (isWord(group[0], 'IN') || isWord(group[0], 'OUT') || isWord(group[0], 'INOUT')) {
      mode = group[0].value;
      group = group.slice(1);
    }
    if (!group.length) return null;

    const name = unquote(group[0].raw);
    const typeText = group.slice(1).map((token) => token.raw).join(' ').trim();
    return { name, mode, type: normalizeType(typeText) };
  }).filter(Boolean);
}

/**
 * Interpreta CREATE PROCEDURE / CREATE FUNCTION (MySQL e PostgreSQL).
 *
 * @param {string} sql
 * @param {string} engineMode - 'aurora-mysql' | 'aurora-postgresql'
 * @returns {object} definição normalizada
 */
function parseCreateRoutine(sql, engineMode) {
  const tokens = tokenize(sql);
  const startIndex = tokens.findIndex((token) => isWord(token, 'PROCEDURE') || isWord(token, 'FUNCTION'));
  if (startIndex === -1) {
    throw new Error('Não foi possível identificar CREATE PROCEDURE ou CREATE FUNCTION');
  }

  const kind = tokens[startIndex].value === 'PROCEDURE' ? 'procedure' : 'function';
  const nameToken = tokens[startIndex + 1];
  if (!nameToken || !['word', 'quoted'].includes(nameToken.type)) {
    throw new Error('Nome de rotina inválido');
  }
  const name = unquote(nameToken.raw);

  let index = startIndex + 2;
  const parameters = [];
  if (isPunct(tokens[index], '(')) {
    const close = matchingParen(tokens, index);
    if (close === -1) throw new Error('Lista de parâmetros não fechada');
    parameters.push(...parseParameters(tokens.slice(index + 1, close)));
    index = close + 1;
  }

  let returns = null;
  const returnsIndex = findTopLevelWord(tokens, index, ['RETURNS']);
  if (kind === 'function') {
    if (returnsIndex === -1) throw new Error('CREATE FUNCTION exige cláusula RETURNS');
    const bodyHint = findTopLevelWord(tokens, returnsIndex + 1, ['BEGIN', 'AS', 'LANGUAGE', 'RETURN', 'DETERMINISTIC']);
    const dollarHint = tokens.findIndex((token, i) => i > returnsIndex && token.type === 'dollar');
    const endType = bodyHint !== -1 ? bodyHint : dollarHint !== -1 ? dollarHint : tokens.length;
    returns = normalizeType(tokens.slice(returnsIndex + 1, endType).map((token) => token.raw).join(' '));
    if (returnsIndex > index) index = returnsIndex + 1;
  }

  let deterministic = false;
  let language = engineMode === 'aurora-postgresql' ? 'plpgsql' : 'mysql';
  for (let i = index; i < tokens.length; i++) {
    if (isWord(tokens[i], 'DETERMINISTIC')) deterministic = true;
    if (isWord(tokens[i], 'NOT') && isWord(tokens[i + 1], 'DETERMINISTIC')) deterministic = false;
    if (isWord(tokens[i], 'LANGUAGE') && tokens[i + 1]) language = tokens[i + 1].value.toLowerCase();
    if (isWord(tokens[i], 'BEGIN') || isWord(tokens[i], 'RETURN') || tokens[i].type === 'dollar') break;
  }

  const dollarIndex = tokens.findIndex((token) => token.type === 'dollar');
  const beginIndex = tokens.findIndex((token, i) => i >= index && isWord(token, 'BEGIN'));
  const returnIndex = tokens.findIndex((token, i) => i >= index && isWord(token, 'RETURN'));

  let body;
  if (dollarIndex !== -1) {
    body = tokens[dollarIndex].value.trim();
    if (language === 'mysql' && engineMode === 'aurora-postgresql') language = 'plpgsql';
  } else if (beginIndex !== -1) {
    const endIndex = findBlockEnd(tokens, beginIndex);
    if (endIndex === -1) throw new Error('Bloco BEGIN/END não fechado');
    body = sql.slice(tokens[beginIndex + 1].start, tokens[endIndex].start).trim();
  } else if (returnIndex !== -1) {
    const last = tokens[tokens.length - 1];
    body = sql.slice(tokens[returnIndex].start, last.end).trim();
  } else {
    throw new Error('Corpo da rotina não encontrado');
  }

  return {
    name,
    kind,
    engine: engineMode,
    parameters,
    returns,
    deterministic,
    language,
    body,
    definitionSql: sql.trim(),
  };
}

/**
 * Interpreta DROP PROCEDURE / DROP FUNCTION.
 *
 * @param {string} sql
 * @returns {{kind: string, name: string, ifExists: boolean}}
 */
function parseDropRoutine(sql) {
  const match = /^DROP\s+(PROCEDURE|FUNCTION)\s+(IF\s+EXISTS\s+)?([`"]?[\w]+[`"]?)/i.exec(sql.trim());
  if (!match) throw new Error('DROP de rotina inválido');
  return {
    kind: match[1].toLowerCase() === 'procedure' ? 'procedure' : 'function',
    ifExists: !!match[2],
    name: unquote(match[3]),
  };
}

/**
 * Interpreta CALL nome(arg1, arg2, ...).
 *
 * @param {string} sql
 * @returns {{name: string, args: string[]}}
 */
function parseCall(sql) {
  const match = /^CALL\s+([`"]?[\w]+[`"]?)\s*\(([\s\S]*)\)\s*;?\s*$/i.exec(sql.trim());
  if (!match) throw new Error('CALL inválido: use CALL nome(argumentos)');
  return {
    name: unquote(match[1]),
    args: splitTopLevel(match[2]),
  };
}

function textBetween(source, tokens, from, to) {
  return source.slice(tokens[from].start, tokens[to].end).trim();
}

function textBefore(source, tokens, from, to) {
  return source.slice(tokens[from].start, to < tokens.length ? tokens[to].start : source.length).trim();
}

function parseStatements(source, tokens, start, stops, ctx) {
  const statements = [];
  let i = start;

  while (i < tokens.length) {
    const token = tokens[i];

    if (stops.some((word) => isWord(token, word))) break;
    if (isPunct(token, ';')) {
      i++;
      continue;
    }

    const parsed = parseStatement(source, tokens, i, ctx);
    if (parsed.node) statements.push(parsed.node);
    i = parsed.next;
  }

  return { statements, index: i };
}

function parseStatement(source, tokens, i, ctx) {
  const token = tokens[i];

  if (isPunct(token, ':')) {
    throw new Error('Sintaxe inválida perto de ":"');
  }

  if (token.type === 'word') {
    switch (token.value) {
      case 'DECLARE': {
        const end = semicolonIndex(tokens, i + 1);
        const text = textBefore(source, tokens, i + 1, end === -1 ? tokens.length : end);
        const declarations = splitTopLevel(text, ',').map((part) => {
          const match = /^([`"]?[\w]+[`"]?)\s+([\s\S]*)$/.exec(part.trim());
          if (!match) throw new Error(`DECLARE inválido: ${part}`);
          const rest = match[2];
          const defaultMatch = /\bDEFAULT\s+([\s\S]+)$/i.exec(rest);
          return {
            name: unquote(match[1]),
            type: normalizeType(defaultMatch ? rest.slice(0, defaultMatch.index) : rest),
            defaultExpression: defaultMatch ? defaultMatch[1].trim() : null,
          };
        });
        return {
          node: { type: 'declare', declarations },
          next: end === -1 ? tokens.length : end + 1,
        };
      }

      case 'SET': {
        const end = semicolonIndex(tokens, i + 1);
        const limit = end === -1 ? tokens.length : end;
        const eq = findTopLevelOp(tokens, i + 1, ['=', ':=']);
        if (eq === -1 || eq >= limit) throw new Error('SET exige uma atribuição');
        const target = unquote(textBefore(source, tokens, i + 1, eq));
        const expression = textBefore(source, tokens, eq + 1, limit);
        return { node: { type: 'set', target, expression }, next: limit + 1 };
      }

      case 'IF': {
        const thenIndex = findTopLevelWord(tokens, i + 1, ['THEN']);
        if (thenIndex === -1) throw new Error('IF sem THEN');
        const branches = [{
          condition: textBetween(source, tokens, i + 1, thenIndex - 1),
          statements: [],
        }];
        let j = thenIndex + 1;
        let elseStatements = null;

        while (j < tokens.length) {
          const result = parseStatements(source, tokens, j, ['ELSEIF', 'ELSIF', 'ELSE', 'END'], ctx);
          branches[branches.length - 1].statements = result.statements;
          j = result.index;

          if (isWord(tokens[j], 'ELSEIF') || isWord(tokens[j], 'ELSIF')) {
            const nextThen = findTopLevelWord(tokens, j + 1, ['THEN']);
            if (nextThen === -1) throw new Error('ELSEIF sem THEN');
            branches.push({
              condition: textBetween(source, tokens, j + 1, nextThen - 1),
              statements: [],
            });
            j = nextThen + 1;
            continue;
          }

          if (isWord(tokens[j], 'ELSE')) {
            j++;
            const elseResult = parseStatements(source, tokens, j, ['END'], ctx);
            elseStatements = elseResult.statements;
            j = elseResult.index;
          }

          if (isWord(tokens[j], 'END')) {
            j++;
            if (isWord(tokens[j], 'IF')) j++;
            if (isPunct(tokens[j], ';')) j++;
            break;
          }

          if (j >= tokens.length) break;
        }

        return { node: { type: 'if', branches, elseStatements }, next: j };
      }

      case 'WHILE': {
        const loopIndex = findTopLevelWord(tokens, i + 1, ['LOOP', 'DO']);
        if (loopIndex === -1) throw new Error('WHILE sem LOOP ou DO');
        const isMysql = isWord(tokens[loopIndex], 'DO');
        const condition = textBetween(source, tokens, i + 1, loopIndex - 1);
        const body = parseStatements(source, tokens, loopIndex + 1, ['END'], ctx);
        let j = body.index;
        if (isWord(tokens[j], 'END')) j++;
        if (isWord(tokens[j], isMysql ? 'WHILE' : 'LOOP')) j++;
        if (isPunct(tokens[j], ';')) j++;
        return { node: { type: 'while', condition, statements: body.statements }, next: j };
      }

      case 'LOOP': {
        const body = parseStatements(source, tokens, i + 1, ['END'], ctx);
        let j = body.index;
        if (isWord(tokens[j], 'END')) j++;
        if (isWord(tokens[j], 'LOOP')) j++;
        if (isPunct(tokens[j], ';')) j++;
        return { node: { type: 'loop', label: ctx.label || null, statements: body.statements }, next: j };
      }

      case 'REPEAT': {
        const body = parseStatements(source, tokens, i + 1, ['UNTIL'], ctx);
        let j = body.index;
        if (isWord(tokens[j], 'UNTIL')) j++;
        const untilEnd = findTopLevelWord(tokens, j, ['END']);
        const condition = untilEnd === -1
          ? textBefore(source, tokens, j, tokens.length)
          : textBefore(source, tokens, j, untilEnd);
        j = untilEnd === -1 ? tokens.length : untilEnd + 1;
        if (isWord(tokens[j], 'REPEAT')) j++;
        if (isPunct(tokens[j], ';')) j++;
        return { node: { type: 'repeat', condition, statements: body.statements }, next: j };
      }

      case 'BEGIN': {
        const body = parseStatements(source, tokens, i + 1, ['END'], ctx);
        let j = body.index;
        if (isWord(tokens[j], 'END')) j++;
        if (isPunct(tokens[j], ';')) j++;
        return { node: { type: 'block', statements: body.statements }, next: j };
      }

      case 'RETURN': {
        const end = semicolonIndex(tokens, i + 1);
        const limit = end === -1 ? tokens.length : end;
        const expression = textBefore(source, tokens, i + 1, limit);
        return { node: { type: 'return', expression }, next: limit + 1 };
      }

      case 'SELECT': {
        const end = semicolonIndex(tokens, i + 1);
        const limit = end === -1 ? tokens.length : end;
        const intoIndex = findTopLevelWord(tokens, i + 1, ['INTO']);
        if (intoIndex !== -1 && intoIndex < limit) {
          const targetToken = tokens[intoIndex + 1];
          const sql = `${textBefore(source, tokens, i, intoIndex)} ${textBefore(source, tokens, intoIndex + 2, limit)}`.trim();
          return {
            node: { type: 'selectInto', sql, target: unquote(targetToken ? targetToken.raw : '') },
            next: limit + 1,
          };
        }
        const sql = textBefore(source, tokens, i, limit);
        return { node: { type: 'sql', sql }, next: limit + 1 };
      }

      case 'CALL': {
        const end = semicolonIndex(tokens, i + 1);
        const limit = end === -1 ? tokens.length : end;
        const open = tokens.findIndex((candidate, index) => index > i && isPunct(candidate, '('));
        if (open === -1 || open >= limit) throw new Error('CALL inválido');
        const close = matchingParen(tokens, open);
        const name = unquote(tokens[i + 1] ? tokens[i + 1].raw : '');
        const argsText = source.slice(tokens[open].end, close === -1 ? tokens[limit - 1].end : tokens[close].start);
        return {
          node: { type: 'call', name, args: splitTopLevel(argsText) },
          next: close === -1 ? limit + 1 : close + 2,
        };
      }

      case 'SIGNAL':
      case 'RAISE': {
        const end = semicolonIndex(tokens, i + 1);
        const limit = end === -1 ? tokens.length : end;
        const stringToken = tokens.slice(i + 1, limit).find((candidate) => candidate.type === 'string');
        const message = stringToken ? stringToken.value : 'Erro levantado pela rotina';
        return { node: { type: 'raise', message }, next: limit + 1 };
      }

      case 'LEAVE':
      case 'ITERATE': {
        const target = tokens[i + 1] ? unquote(tokens[i + 1].raw) : null;
        let next = i + 2;
        if (isPunct(tokens[next], ';')) next++;
        return { node: { type: token.value === 'LEAVE' ? 'leave' : 'iterate', target }, next };
      }

      default:
        break;
    }

    const labelledLoop = tokens[i].type === 'word'
      && ((isPunct(tokens[i + 1], ':') && isWord(tokens[i + 2], 'LOOP')) || isWord(tokens[i + 1], 'LOOP'));
    if (labelledLoop) {
      const label = unquote(token.raw);
      const bodyStart = isPunct(tokens[i + 1], ':') ? i + 3 : i + 2;
      const body = parseStatements(source, tokens, bodyStart, ['END'], { label });
      let j = body.index;
      if (isWord(tokens[j], 'END')) j++;
      if (isWord(tokens[j], 'LOOP')) j++;
      if (isPunct(tokens[j], ';')) j++;
      return { node: { type: 'loop', label, statements: body.statements }, next: j };
    }

    const assignIndex = findTopLevelOp(tokens, i + 1, [':=']);
    if (assignIndex !== -1) {
      const end = semicolonIndex(tokens, assignIndex + 1);
      const limit = end === -1 ? tokens.length : end;
      const target = unquote(textBefore(source, tokens, i, assignIndex));
      const expression = textBefore(source, tokens, assignIndex + 1, limit);
      return { node: { type: 'set', target, expression }, next: limit + 1 };
    }
  }

  const end = semicolonIndex(tokens, i);
  const limit = end === -1 ? tokens.length : end;
  const sql = textBefore(source, tokens, i, limit);
  return { node: sql ? { type: 'sql', sql } : null, next: limit + 1 };
}

/**
 * Transforma o corpo de uma rotina em uma lista de nós executáveis.
 *
 * @param {string} body
 * @returns {Array<object>}
 */
function parseBody(body) {
  const tokens = tokenize(body || '');
  return parseStatements(body || '', tokens, 0, [], { label: null }).statements;
}

module.exports = {
  tokenize,
  parseBody,
  parseCall,
  parseCreateRoutine,
  parseDropRoutine,
};
