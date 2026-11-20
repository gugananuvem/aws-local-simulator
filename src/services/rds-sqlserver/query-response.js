'use strict';

/**
 * Formata respostas do protocolo query usado pela AWS CLI (`aws rds ...`) em XML.
 * O envelope segue o padrão do RDS: <ActionResponse><ActionResult/>...</ActionResponse>.
 */

const crypto = require('crypto');
const xmlbuilder = require('xmlbuilder');

const NS_VERSION = '2014-10-31';
const NS = `http://rds.amazonaws.com/doc/${NS_VERSION}/`;

function singular(name) {
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

function appendValue(parent, name, value) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    const el = parent.ele(name);
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const child = el.ele(singular(name));
        for (const [k, v] of Object.entries(item)) appendValue(child, k, v);
      } else {
        el.ele(singular(name), item === undefined || item === null ? '' : String(item));
      }
    }
    return;
  }

  if (typeof value === 'object') {
    const el = parent.ele(name);
    for (const [k, v] of Object.entries(value)) appendValue(el, k, v);
    return;
  }

  parent.ele(name, String(value));
}

function requestId() {
  return crypto.randomUUID();
}

/** Envelope de sucesso. */
function successXml(action, result, version = NS_VERSION) {
  const doc = xmlbuilder.create(`${action}Response`, { version: '1.0', encoding: 'UTF-8' });
  doc.att('xmlns', `http://rds.amazonaws.com/doc/${version || NS_VERSION}/`);
  const resultEl = doc.ele(`${action}Result`);
  for (const [k, v] of Object.entries(result || {})) appendValue(resultEl, k, v);
  doc.ele('ResponseMetadata').ele('RequestId', requestId());
  return doc.end({ pretty: false });
}

/** Envelope de erro no formato AWS query. */
function errorXml(code, message, version = NS_VERSION) {
  const doc = xmlbuilder.create('ErrorResponse', { version: '1.0', encoding: 'UTF-8' });
  doc.att('xmlns', `http://rds.amazonaws.com/doc/${version || NS_VERSION}/`);
  const err = doc.ele('Error');
  err.ele('Type', 'Sender');
  err.ele('Code', code || 'BadRequestException');
  err.ele('Message', message || 'Erro na requisição');
  doc.ele('RequestId', requestId());
  return doc.end({ pretty: false });
}

module.exports = { successXml, errorXml, NS, NS_VERSION };
