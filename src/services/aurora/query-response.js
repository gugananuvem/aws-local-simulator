'use strict';

/**
 * Formata respostas do protocolo query do RDS (AWS CLI `rds ...`) em XML.
 * Envelope: <ActionResponse><ActionResult>...</ActionResult><ResponseMetadata/></ActionResponse>
 * Itens de lista usam o nome no singular (DBClusters -> DBCluster), como a API real.
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
    if (value.length === 0) return;
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const child = el.ele(singular(name));
        for (const [k, v] of Object.entries(item)) appendValue(child, k, v);
      } else {
        el.ele(singular(name), item === null || item === undefined ? '' : String(item));
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

/** Sucesso: <ActionResponse xmlns=...><ActionResult>...</ActionResult><ResponseMetadata>...</ResponseMetadata></ActionResponse> */
function successXml(action, result, version = NS_VERSION) {
  const doc = xmlbuilder.create(`${action}Response`, { version: '1.0', encoding: 'UTF-8' });
  doc.att('xmlns', `http://rds.amazonaws.com/doc/${version}/`);
  const resultEl = doc.ele(`${action}Result`);
  for (const [k, v] of Object.entries(result || {})) appendValue(resultEl, k, v);
  doc.ele('ResponseMetadata').ele('RequestId', requestId());
  return doc.end({ pretty: false });
}

/** Erro: <ErrorResponse><Error><Type/><Code/><Message/></Error><RequestId/></ErrorResponse> */
function errorXml(code, message, version = NS_VERSION) {
  const doc = xmlbuilder.create('ErrorResponse', { version: '1.0', encoding: 'UTF-8' });
  doc.att('xmlns', `http://rds.amazonaws.com/doc/${version}/`);
  const err = doc.ele('Error');
  err.ele('Type', 'Sender');
  err.ele('Code', code);
  err.ele('Message', message);
  doc.ele('RequestId', requestId());
  return doc.end({ pretty: false });
}

module.exports = { successXml, errorXml, NS };
