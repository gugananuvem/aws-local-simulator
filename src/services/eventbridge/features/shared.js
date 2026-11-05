/**
 * @fileoverview Utilitários compartilhados pelas features do EventBridge.
 */

'use strict';

const crypto = require('crypto');

/** @returns {string} timestamp ISO atual */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Monta um ARN do simulador.
 * @param {Object} simulator
 * @param {string} service - ex.: events, pipes, scheduler, schemas
 * @param {string} resource
 * @returns {string}
 */
function buildArn(simulator, service, resource) {
  return `arn:aws:${service}:${simulator.region}:${simulator.accountId}:${resource}`;
}

/**
 * Cria um erro no formato aceito pelas APIs AWS do simulador.
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
function awsError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.__type = code;
  return err;
}

/**
 * Normaliza tags (array AWS ou objeto simples) para o formato [{Key, Value}].
 * @param {Array|Object} tags
 * @returns {Array<{Key: string, Value: string}>}
 */
function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags
      .filter((tag) => tag && tag.Key !== undefined)
      .map((tag) => ({ Key: String(tag.Key), Value: String(tag.Value ?? '') }));
  }
  if (typeof tags === 'object') {
    return Object.entries(tags).map(([Key, Value]) => ({ Key, Value: String(Value ?? '') }));
  }
  return [];
}

/**
 * Paginação simples no estilo AWS.
 * @param {Array} items
 * @param {Object} params
 * @param {number} [params.Limit]
 * @param {string} [params.NextToken]
 * @param {string} key - nome do campo de lista na resposta
 * @returns {Object}
 */
function paginate(items, params = {}, key) {
  const limit = Math.max(1, Math.min(Number(params.Limit) || 100, 1000));
  let start = 0;
  if (params.NextToken) {
    const parsed = Number(Buffer.from(String(params.NextToken), 'base64').toString('utf8'));
    if (Number.isFinite(parsed) && parsed > 0) start = parsed;
  }
  const slice = items.slice(start, start + limit);
  const next = start + limit < items.length
    ? Buffer.from(String(start + limit), 'utf8').toString('base64')
    : null;
  const result = { [key]: slice };
  if (next) result.NextToken = next;
  return result;
}

/**
 * Gera um id curto e único.
 * @returns {string}
 */
function randomId() {
  return crypto.randomUUID();
}

/**
 * Copia profunda simples via JSON.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Remove chaves com valor undefined de um objeto.
 * @param {Object} obj
 * @returns {Object}
 */
function compact(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, value]) => value !== undefined));
}

module.exports = {
  nowIso,
  buildArn,
  awsError,
  normalizeTags,
  paginate,
  randomId,
  clone,
  compact,
};
