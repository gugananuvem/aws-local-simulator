'use strict';

/**
 * Helpers de SQL compartilhados entre a Data API e o executor de rotinas.
 * Nenhuma função altera a string recebida.
 */

/**
 * Substitui placeholders nomeados (:nome) por '?' usando valores nativos.
 * Não substitui ocorrências dentro de strings ou identificadores entre aspas.
 *
 * @param {string} sql
 * @param {Record<string, any>} values
 * @returns {{ boundSql: string, bindings: Array }}
 */
function bindNamedValues(sql, values = {}) {
  if (!sql || typeof sql !== 'string') return { boundSql: sql, bindings: [] };

  const names = Object.keys(values).sort((a, b) => b.length - a.length);
  if (!names.length) return { boundSql: sql, bindings: [] };

  let boundSql = '';
  const bindings = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      const start = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (sql[i] === '\\' && i + 1 < sql.length) {
          i += 2;
          continue;
        }
        i++;
      }
      boundSql += sql.slice(start, i);
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      const start = i;
      while (i < sql.length && sql[i] !== '\n') i++;
      boundSql += sql.slice(start, i);
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      const start = i;
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      boundSql += sql.slice(start, i);
      continue;
    }

    if (ch === ':') {
      const match = /^:([A-Za-z_]\w*)/.exec(sql.slice(i));
      if (match && Object.prototype.hasOwnProperty.call(values, match[1])) {
        boundSql += '?';
        bindings.push(values[match[1]]);
        i += match[0].length;
        continue;
      }
    }

    boundSql += ch;
    i++;
  }

  return { boundSql, bindings };
}

/**
 * Divide um texto em partes no delimitador de nível superior, respeitando
 * strings, parênteses e blocos BEGIN/END.
 *
 * @param {string} text
 * @param {string} delimiter
 * @returns {string[]}
 */
function splitTopLevel(text, delimiter = ',') {
  if (!text) return [];

  const parts = [];
  let current = '';
  let depth = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "'" || ch === '"' || ch === '`' || ch === '$') {
      if (ch === '$') {
        const tag = /^\$([A-Za-z_]\w*)?\$/.exec(text.slice(i));
        if (tag) {
          const close = text.indexOf(tag[0], i + tag[0].length);
          const end = close === -1 ? text.length : close + tag[0].length;
          current += text.slice(i, end);
          i = end;
          continue;
        }
      } else {
        const start = i;
        i++;
        while (i < text.length) {
          if (text[i] === ch) {
            if (text[i + 1] === ch) {
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (text[i] === '\\' && i + 1 < text.length) i += 2;
          else i++;
        }
        current += text.slice(start, i);
        continue;
      }
    }

    if (ch === '(') depth++;
    if (ch === ')') depth--;

    if (ch === delimiter && depth === 0) {
      parts.push(current.trim());
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Converte um tipo MySQL/PostgreSQL em uma classe de valor usada pelo simulador.
 * Os tipos são informativos: o SQLite faz a coerência real na execução.
 *
 * @param {string} type
 * @returns {string}
 */
function normalizeType(type) {
  const raw = (type || '').trim().toLowerCase();
  if (/^(bigint|int|integer|smallint|tinyint|mediumint|serial|bigserial)/.test(raw)) return 'INTEGER';
  if (/^(decimal|numeric|float|double|real|money)/.test(raw)) return 'REAL';
  if (/^(bool|boolean)/.test(raw)) return 'BOOLEAN';
  if (/^(blob|bytea|binary|varbinary)/.test(raw)) return 'BLOB';
  if (/^(date|datetime|timestamp|time|year)/.test(raw)) return 'TEXT';
  if (/^(json|jsonb)/.test(raw)) return 'TEXT';
  if (/^(varchar|char|text|uuid|enum|set)/.test(raw)) return 'TEXT';
  return 'TEXT';
}

module.exports = { bindNamedValues, splitTopLevel, normalizeType };
