'use strict';

/**
 * tds-tokens.js — Codificadores dos tokens TDS 7.4 enviados ao cliente.
 *
 * Tokens de resultado: COLMETADATA(0x81), COLINFO(0xA5), ROW(0xD1),
 * DONE(0xFD)/DONEPROC(0xFE)/DONEINPROC(0xFF).
 * Tokens de sessao: LOGINACK(0xAD), ENVCHANGE(0xE3), INFO(0xAB), ERROR(0xAA).
 */

const { TDS_TYPE, COLLATION, rowToken, nullBitmap } = require('./tds-types');

/** Identificadores de token TDS. */
const TOKEN = Object.freeze({
  LOGINACK: 0xAD,
  ENVCHANGE: 0xE3,
  INFO: 0xAB,
  ERROR: 0xAA,
  COLMETADATA: 0x81, // MS-TDS 2.2.7.4
  COLINFO: 0xA5,     // MS-TDS 2.2.7.3
  ROW: 0xD1,
  DONE: 0xFD,
  DONEPROC: 0xFE,
  DONEINPROC: 0xFF
});

/** Bits de status dos tokens DONE. */
const DONE_STATUS = Object.freeze({
  MORE: 0x0001,
  ERROR: 0x0002,
  INXACT: 0x0004,
  COUNT: 0x0010,
  ATTN: 0x0020,
  SRVERROR: 0x0100
});

/** Tipos ENVCHANGE mais comuns. */
const ENVCHANGE = Object.freeze({
  DATABASE: 0x01,
  LANGUAGE: 0x02,
  CHARSET: 0x03,
  PACKET_SIZE: 0x04,
  COLLATION: 0x07
});

const TDS_VERSION_74 = 0x74000004;

/** B_VARCHAR: 1 byte de contagem de caracteres + UTF-16LE. */
function bVarChar(value) {
  // O comprimento cabe em 1 byte: truncar apenas o contador deixaria bytes
  // extras no fluxo e o SqlClient fecharia a conexao com erro fatal.
  const text = String(value == null ? '' : value).slice(0, 0xFF);
  const head = Buffer.alloc(1);
  head.writeUInt8(text.length, 0);
  return Buffer.concat([head, Buffer.from(text, 'utf16le')]);
}

/** US_VARCHAR: 2 bytes de contagem de caracteres + UTF-16LE. */
function usVarChar(value) {
  const text = String(value == null ? '' : value);
  const head = Buffer.alloc(2);
  head.writeUInt16LE(Math.min(text.length, 0xFFFF), 0);
  return Buffer.concat([head, Buffer.from(text, 'utf16le')]);
}

/** B_VARCHAR de bytes crus (usado por ENVCHANGE de tipos nao texto). */
function bVarByte(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value == null ? '' : value), 'utf8');
  const head = Buffer.alloc(1);
  head.writeUInt8(Math.min(data.length, 0xFF), 0);
  return Buffer.concat([head, data]);
}

function tokenWithLength16(token, body) {
  const head = Buffer.alloc(3);
  head.writeUInt8(token, 0);
  head.writeUInt16LE(body.length, 1);
  return Buffer.concat([head, body]);
}

/**
 * LOGINACK (0xAD). O tamanho e UInt16LE, a versao TDS e gravada em BE e o
 * nome do programaServer vem como B_VARCHAR.
 */
function loginAckToken(serverName = 'LOCAL', options = {}) {
  const version = Buffer.alloc(4);
  version.writeUInt32BE(options.tdsVersion == null ? TDS_VERSION_74 : options.tdsVersion, 0);

  const body = Buffer.concat([
    Buffer.from([options.interface == null ? 0x01 : options.interface]), // SQL_TSQL
    version,
    bVarChar(serverName),
    Buffer.from([
      options.major == null ? 11 : options.major,
      options.minor == null ? 0 : options.minor,
      options.buildHi == null ? 0 : options.buildHi,
      options.buildLow == null ? 0 : options.buildLow
    ])
  ]);

  return tokenWithLength16(TOKEN.LOGINACK, body);
}

/**
 * ENVCHANGE (0xE3). A ordem no fio e novo valor antes do valor antigo.
 * Para DATABASE os valores sao UTF-16LE com contagem de caracteres (B_VARCHAR).
 *
 * @param {number} type ex.: ENVCHANGE.DATABASE
 * @param {string|Buffer} oldValue
 * @param {string|Buffer} newValue
 * @param {{encoding?:string}} [options] 'utf16le' (padrao para texto) ou 'utf8'
 */
function envChangeToken(type, oldValue, newValue, options = {}) {
  const encoding = options.encoding || (type === ENVCHANGE.DATABASE ? 'utf16le' : 'utf8');
  const pack = (value) => encoding === 'utf16le'
    ? bVarChar(value)
    : bVarByte(value);

  // Importante: primeiro o NOVO, depois o ANTIGO.
  const body = Buffer.concat([
    Buffer.from([type & 0xFF]),
    pack(newValue),
    pack(oldValue)
  ]);
  return tokenWithLength16(TOKEN.ENVCHANGE, body);
}

/** Atalho para o ENVCHANGE de troca de database. */
function databaseEnvChangeToken(oldDatabase, newDatabase) {
  return envChangeToken(ENVCHANGE.DATABASE, oldDatabase, newDatabase, { encoding: 'utf16le' });
}

/**
 * ENVCHANGE de COLLATION (0x07). Sem ele o SqlClient mantem _defaultCollation
 * nulo e estoura NullReferenceException ao serializar parametros de RPC.
 * Tanto o valor novo quanto o antigo tem 5 bytes (info UInt32 + sortId).
 */
function collationEnvChangeToken(collation = COLLATION) {
  return envChangeToken(ENVCHANGE.COLLATION, collation, collation, { encoding: 'utf8' });
}

/**
 * INFO (0xAB) e ERROR (0xAA) compartilham o mesmo corpo.
 * @returns {Buffer}
 */
function messageToken(token, {
  number = 0,
  state = 0,
  class: severity = 0,
  message = '',
  server = '',
  proc = '',
  lineNumber = 0
} = {}) {
  const fixed = Buffer.allocUnsafe(6);
  fixed.writeUInt32LE(number >>> 0, 0);
  fixed.writeUInt8(state & 0xFF, 4);
  fixed.writeUInt8(severity & 0xFF, 5);

  const line = Buffer.alloc(4);
  line.writeUInt32LE(lineNumber >>> 0, 0);

  const body = Buffer.concat([
    fixed,
    usVarChar(message),
    bVarChar(server),
    bVarChar(proc),
    line
  ]);
  return tokenWithLength16(token, body);
}

function infoToken(message, server = 'LOCAL', options = {}) {
  return messageToken(TOKEN.INFO, { ...options, message, server });
}

function errorToken(number, state, severity, message, server = 'LOCAL', options = {}) {
  return messageToken(TOKEN.ERROR, {
    ...options,
    number,
    state,
    class: severity,
    message,
    server
  });
}

/** Serializa um descritor de coluna para COLMETADATA/COLINFO. */
function columnDefinition(meta) {
  const head = Buffer.allocUnsafe(7);
  head.writeUInt32LE(0, 0);                       // userType
  head.writeUInt16LE(meta.nullable ? 0x01 : 0x00, 4); // flags: fNullable
  head.writeUInt8(meta.type, 6);

  let extra;
  switch (meta.type) {
    case TDS_TYPE.INTNTYPE:
    case TDS_TYPE.BITNTYPE:
    case TDS_TYPE.DATETIMNTYPE:
    case TDS_TYPE.FLTNTYPE:
      extra = Buffer.from([meta.dataLength || 4]);
      break;
    case TDS_TYPE.NVARCHARTYPE: {
      extra = Buffer.allocUnsafe(2 + COLLATION.length);
      extra.writeUInt16LE(meta.maxLength || MAX_NVARCHAR_FALLBACK, 0);
      COLLATION.copy(extra, 2);
      break;
    }
    case TDS_TYPE.VARBINARYTYPE: {
      extra = Buffer.allocUnsafe(2);
      extra.writeUInt16LE(meta.maxLength || MAX_NVARCHAR_FALLBACK, 0);
      break;
    }
    default:
      extra = Buffer.from([meta.dataLength || 4]);
  }

  return Buffer.concat([head, extra, bVarChar(meta.name || '')]);
}

const MAX_NVARCHAR_FALLBACK = 8000;

/**
 * COLMETADATA (0x81): contagem UInt16LE + uma definicao por coluna.
 * @param {Array<Object>} metadata metadados vindos de columnMetadata()
 */
function colMetadataToken(metadata = []) {
  const head = Buffer.allocUnsafe(3);
  head.writeUInt8(TOKEN.COLMETADATA, 0);
  head.writeUInt16LE(metadata.length, 1);
  return Buffer.concat([head, ...metadata.map(columnDefinition)]);
}

/**
 * COLINFO (0xA5) opcional: numero da coluna, numero da tabela e status.
 * O servidor nao emite esse token por padrao, mas o codificador fica disponivel.
 */
function colInfoToken(columns = []) {
  // status 0x04 = EXPRESSION; nao usamos DIFFERENT_NAME, entao nao ha nome extra.
  const body = Buffer.concat(columns.map((column, index) => Buffer.from([
    index & 0xFF,
    0,    // tableNum
    0x04  // status
  ])));
  return tokenWithLength16(TOKEN.COLINFO, body);
}

/**
 * DONE / DONEPROC / DONEINPROC. Em TDS 7.4 o rowcount ocupa 8 bytes (BigInt).
 */
function doneToken({
  status = DONE_STATUS.COUNT,
  curcmd = 0,
  rowcount = 0,
  more = false,
  kind = 'DONE'
} = {}) {
  const head = Buffer.allocUnsafe(5);
  head.writeUInt8(TOKEN[kind] || TOKEN.DONE, 0);
  head.writeUInt16LE((status | (more ? DONE_STATUS.MORE : 0)) & 0xFFFF, 1);
  head.writeUInt16LE(curcmd & 0xFFFF, 3);

  const rowCount = Buffer.alloc(8);
  let count;
  try {
    count = BigInt(rowcount || 0);
  } catch {
    count = 0n;
  }
  rowCount.writeBigUInt64LE(count < 0n ? 0n : count, 0);

  return Buffer.concat([head, rowCount]);
}

function doneProcToken(options = {}) {
  return doneToken({ ...options, kind: 'DONEPROC' });
}

function doneInProcToken(options = {}) {
  return doneToken({ ...options, kind: 'DONEINPROC' });
}

module.exports = {
  TOKEN,
  DONE_STATUS,
  ENVCHANGE,
  TDS_VERSION_74,
  bVarChar,
  usVarChar,
  loginAckToken,
  envChangeToken,
  databaseEnvChangeToken,
  collationEnvChangeToken,
  infoToken,
  errorToken,
  colMetadataToken,
  colInfoToken,
  rowToken,
  nullBitmap,
  doneToken,
  doneProcToken,
  doneInProcToken
};
