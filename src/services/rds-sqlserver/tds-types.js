'use strict';

/**
 * tds-types.js — Conversao entre tipos declarados pelo SQLite e tipos TDS 7.4.
 *
 * As colunas de resultado usam as variantes "N" (comprimento variavel) dos
 * tipos TDS: INTN(0x26), BITN(0x68), DATETIMN(0x6F), FLTN(0x6D) e NVARCHAR(0xE7).
 * Isso e o que SQL Server envia e o que tedious/sqlcmd/ODBC esperam ler.
 * Os valores 0x32 (BIT) e 0x2D (SMALLDATETIME) aparecem em algumas tabelas
 * antigas; aqui eles sao mantidos como aliases documentados, mas o fio usa
 * as variantes N para manter o alinhamento dos tokens.
 */

/** Identificadores de tipo TDS usados nos metadados de coluna. */
const TDS_TYPE = Object.freeze({
  NULL: 0x1F,
  INTNTYPE: 0x26,      // int / bigint (1 byte de comprimento: 4 ou 8)
  BITTYPE: 0x32,       // bit (alias legado)
  SMALLDATETIMETYPE: 0x2D, // alias legado
  INT4TYPE: 0x38,
  DATETIMETYPE: 0x3D,
  BITNTYPE: 0x68,      // bit com 1 byte de comprimento
  DATETIMNTYPE: 0x6F,  // datetime com 8 bytes de comprimento
  FLTNTYPE: 0x6D,      // real (4) / float (8)
  NVARCHARTYPE: 0xE7,  // texto UTF-16LE com comprimento UInt16
  VARBINARYTYPE: 0xA5  // binario com comprimento UInt16
});

/** Collation SQL_Latin1_General_CP1_CI_AS (LCID 1033, sort id 0). */
const COLLATION = Buffer.from([0x09, 0x04, 0x00, 0x00, 0x00]);

const MAX_NVARCHAR_BYTES = 8000;  // 4000 caracteres UTF-16
const MAX_VARBINARY_BYTES = 8000;

/** Tipos TDS que usam 1 byte de comprimento (0 = NULL) no valor. */
const SHORT_LENGTH_TYPES = new Set([
  TDS_TYPE.INTNTYPE,
  TDS_TYPE.BITNTYPE,
  TDS_TYPE.DATETIMNTYPE,
  TDS_TYPE.FLTNTYPE
]);

/**
 * Mapeia o tipo declarado pelo SQLite para uma familia simplificada.
 * @param {string} declaredType
 * @returns {'int'|'tinyint'|'smallint'|'bit'|'float'|'datetime'|'binary'|'string'}
 */
function mapDeclaredType(declaredType) {
  const type = String(declaredType || '').toUpperCase();

  if (/^(BOOL|BOOLEAN|BIT)$/.test(type)) return 'bit';
  if (/BLOB|BINARY|VARBINARY|IMAGE/.test(type)) return 'binary';
  if (/^(DATE|DATETIME|TIMESTAMP|SMALLDATETIME)/.test(type)) return 'datetime';
  if (/REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC|MONEY/.test(type)) return 'float';
  if (/TINYINT/.test(type)) return 'tinyint';
  if (/SMALLINT/.test(type)) return 'smallint';
  if (/INT/.test(type)) return 'int';
  return 'string';
}

/**
 * Constroi os metadados de cada coluna no formato esperado por colMetadataToken.
 * @param {Array<Object>} columns descritores de coluna (better-sqlite3)
 * @param {Array<Object>} [rows] usado para dimensionar textos/binarios
 * @returns {Array<Object>}
 */
function columnMetadata(columns = [], rows = []) {
  return (columns || []).map((column, index) => {
    // Se ja veio mapeado, reaproveita (evita divergencia entre metadado e valor).
    if (column && typeof column.type === 'number' && column.kind) {
      return column;
    }

    // Nome vazio e valido em TDS: expressoes sem alias do T-SQL chegam assim.
    // Substitui-lo por ColumnN faz o cliente ler a coluna certa, mas o encodeRow
    // nao encontra o valor (a chave da linha e '') e envia NULL no fio.
    const name = column && typeof column.name === 'string'
      ? column.name
      : `Column${index + 1}`;
    const declared = (column && column.type) || '';
    const typeName = String(declared).toUpperCase();
    const nullable = !(column && column.notNull);

    const values = (rows || []).map((row) => {
      if (!row) return undefined;
      return Array.isArray(row) ? row[index] : row[name];
    }).filter((value) => value !== null && value !== undefined);

    // Expressões calculadas (literais, @@MICROSOFTVERSION, shims do SSMS) não
    // têm tipo declarado no SQLite. Infere pela família dos valores para que
    // números cheguem ao cliente como INTN/FLTN e não como NVARCHAR — sem isso
    // o SSMS falha com "Specified cast is not valid" ao ler metadados de versão.
    let kind = mapDeclaredType(declared);
    if (!declared && values.length > 0) {
      if (values.every((value) => typeof value === 'bigint' ||
        (typeof value === 'number' && Number.isInteger(value)))) {
        kind = 'int';
      } else if (values.every((value) => typeof value === 'number')) {
        kind = 'float';
      }
    }

    // sys.databases.state é TINYINT no SQL Server. O SMO lê essa coluna com
    // SqlDataReader.GetByte(); se chegar como INTN de 4 bytes, o Explorer falha
    // com "Specified cast is not valid" ao montar a árvore de databases.
    if (
      !declared && /^state$/i.test(name) && values.length > 0 &&
      values.every((value) => {
        const numero = Number(value);
        return Number.isInteger(numero) && numero >= 0 && numero <= 255;
      })
    ) {
      kind = 'tinyint';
    }

    const base = { name, kind, nullable, declaredType: declared };

    if (kind === 'tinyint') {
      return { ...base, type: TDS_TYPE.INTNTYPE, dataLength: 1 };
    }

    if (kind === 'smallint') {
      return { ...base, type: TDS_TYPE.INTNTYPE, dataLength: 2 };
    }

    if (kind === 'int') {
      const large = values.some((value) => {
        if (typeof value === 'bigint') return true;
        const number = Number(value);
        return !Number.isSafeInteger(number) || Math.abs(number) > 2147483647;
      });
      return { ...base, type: TDS_TYPE.INTNTYPE, dataLength: large ? 8 : 4 };
    }

    if (kind === 'bit') {
      return { ...base, type: TDS_TYPE.BITNTYPE, dataLength: 1 };
    }

    if (kind === 'datetime') {
      return { ...base, type: TDS_TYPE.DATETIMNTYPE, dataLength: 8 };
    }

    if (kind === 'float') {
      return { ...base, type: TDS_TYPE.FLTNTYPE, dataLength: /^REAL/.test(typeName) ? 4 : 8 };
    }

    if (kind === 'binary') {
      let max = 0;
      for (const value of values) {
        if (Buffer.isBuffer(value)) max = Math.max(max, value.length);
      }
      return {
        ...base,
        type: TDS_TYPE.VARBINARYTYPE,
        maxLength: Math.min(Math.max(max, 2), MAX_VARBINARY_BYTES)
      };
    }

    let max = 0;
    for (const value of values) {
      const bytes = Buffer.from(String(value), 'utf16le').length;
      max = Math.max(max, bytes);
    }
    return {
      ...base,
      type: TDS_TYPE.NVARCHARTYPE,
      maxLength: values.length
        ? Math.min(Math.max(max, 2), MAX_NVARCHAR_BYTES)
        : MAX_NVARCHAR_BYTES
    };
  });
}

/**
 * Codifica um valor conforme o tipo do metadado.
 * Valores nulos usam comprimento 0 (tipos curtos) ou 0xFFFF (NVARCHAR/BINARY).
 * @param {*} value
 * @param {Object} meta
 * @returns {Buffer}
 */
function encodeValue(value, meta) {
  const type = meta && meta.type;

  if (value === null || value === undefined) {
    return SHORT_LENGTH_TYPES.has(type) ? Buffer.from([0x00]) : Buffer.from([0xFF, 0xFF]);
  }

  if (type === TDS_TYPE.INTNTYPE) {
    const length = meta.dataLength === 8 ? 8 : meta.dataLength === 2 ? 2 : meta.dataLength === 1 ? 1 : 4;
    const buffer = Buffer.allocUnsafe(1 + length);
    buffer.writeUInt8(length, 0);
    const number = typeof value === 'bigint' ? Number(value) : Number(value);
    if (length === 8) {
      let big;
      try {
        big = BigInt(Math.trunc(number));
      } catch {
        big = 0n;
      }
      buffer.writeBigInt64LE(big, 1);
    } else if (length === 2) {
      buffer.writeInt16LE(Math.trunc(number) & 0xFFFF, 1);
    } else if (length === 1) {
      buffer.writeUInt8(Math.trunc(number) & 0xFF, 1);
    } else {
      buffer.writeInt32LE(Math.trunc(number) | 0, 1);
    }
    return buffer;
  }

  if (type === TDS_TYPE.BITNTYPE) {
    return Buffer.from([0x01, value ? 0x01 : 0x00]);
  }

  if (type === TDS_TYPE.FLTNTYPE) {
    const length = meta.dataLength === 4 ? 4 : 8;
    const buffer = Buffer.allocUnsafe(1 + length);
    buffer.writeUInt8(length, 0);
    const number = Number(value);
    if (length === 4) buffer.writeFloatLE(number, 1);
    else buffer.writeDoubleLE(number, 1);
    return buffer;
  }

  if (type === TDS_TYPE.DATETIMNTYPE) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return Buffer.from([0x00]);
    }

    // SQL Server: dias desde 1900-01-01 +Ticks de 1/300 de segundo desde a meia-noite.
    const epoch = Date.UTC(1900, 0, 1);
    const days = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - epoch) / 86400000);
    const milliseconds = date.getUTCHours() * 3600000 + date.getUTCMinutes() * 60000 + date.getUTCSeconds() * 1000 + date.getUTCMilliseconds();
    let ticks = Math.round(milliseconds * 3 / 10);
    let dayAdjust = 0;
    if (ticks >= 25920000) { // 24h em ticks: vira o dia
      ticks -= 25920000;
      dayAdjust = 1;
    }

    const buffer = Buffer.allocUnsafe(9);
    buffer.writeUInt8(8, 0);
    buffer.writeInt32LE(days + dayAdjust, 1);
    buffer.writeUInt32LE(ticks, 5);
    return buffer;
  }

  if (type === TDS_TYPE.VARBINARYTYPE) {
    const raw = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    const data = raw.length > MAX_VARBINARY_BYTES ? raw.subarray(0, MAX_VARBINARY_BYTES) : raw;
    const buffer = Buffer.allocUnsafe(2 + data.length);
    buffer.writeUInt16LE(data.length, 0);
    data.copy(buffer, 2);
    return buffer;
  }

  // Padrao: NVARCHAR em UTF-16LE.
  let data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf16le');
  if (data.length > MAX_NVARCHAR_BYTES) {
    data = data.subarray(0, MAX_NVARCHAR_BYTES - (MAX_NVARCHAR_BYTES % 2));
  }
  const buffer = Buffer.allocUnsafe(2 + data.length);
  buffer.writeUInt16LE(data.length, 0);
  data.copy(buffer, 2);
  return buffer;
}

/**
 * Mascara de nulos (1 bit por coluna). O TDS 7.4 nao usa esse bitmap no token
 * ROW — ele codifica NULL por valor — mas o helper e util para NBCROW e testes.
 * @param {Array<*>} values
 * @returns {Buffer}
 */
function nullBitmap(values = []) {
  const bitmap = Buffer.alloc(Math.ceil(values.length / 8), 0);
  values.forEach((value, index) => {
    if (value === null || value === undefined) {
      bitmap[index >> 3] |= 1 << (index & 7);
    }
  });
  return bitmap;
}

/**
 * Monta um token ROW (0xD1) para uma linha.
 * @param {Array<*>} values
 * @param {Array<Object>} metadata
 * @returns {Buffer}
 */
function rowToken(values = [], metadata = []) {
  const parts = [Buffer.from([0xD1])];
  metadata.forEach((meta, index) => {
    parts.push(encodeValue(values[index], meta));
  });
  return Buffer.concat(parts);
}

/**
 * Codifica todas as linhas em uma sequencia de tokens ROW.
 * @param {Array<Object|Array>} rows
 * @param {Array<Object>} [columns] descritores de coluna; deduzidos de rows[0] se ausentes
 * @returns {Buffer}
 */
function encodeRow(rows = [], columns) {
  const list = rows || [];
  const cols = columns || (list.length && !Array.isArray(list[0])
    ? Object.keys(list[0]).map((name) => ({ name }))
    : []);
  const metadata = columnMetadata(cols, list);

  return Buffer.concat(list.map((row) => {
    const values = cols.map((column, index) => {
      if (Array.isArray(row)) return row[index];
      const name = column && column.name;
      return row && name != null ? row[name] : undefined;
    });
    return rowToken(values, metadata);
  }));
}

module.exports = {
  TDS_TYPE,
  COLLATION,
  MAX_NVARCHAR_BYTES,
  MAX_VARBINARY_BYTES,
  mapDeclaredType,
  columnMetadata,
  encodeValue,
  nullBitmap,
  rowToken,
  encodeRow
};
