'use strict';

/**
 * tds-types.js — Conversao entre tipos declarados pelo SQLite e tipos TDS 7.4.
 *
 * As colunas de resultado usam as variantes "N" (comprimento variavel) dos
 * tipos TDS: INTN(0x26), BITN(0x68), DATETIMN(0x6F), FLTN(0x6D),
 * DECIMAL(0x6A) e NVARCHAR(0xE7).
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
  DECIMALTYPE: 0x6A,   // decimal/numeric com precisao e escala
  UNIQUEIDTYPE: 0x24,  // uniqueidentifier (16 bytes, prefixo de comprimento)
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
  TDS_TYPE.FLTNTYPE,
  TDS_TYPE.DECIMALTYPE,
  TDS_TYPE.UNIQUEIDTYPE
]);

/**
 * Mapeia o tipo declarado pelo SQLite para uma familia simplificada.
 * @param {string} declaredType
 * @returns {'int'|'tinyint'|'smallint'|'bit'|'float'|'decimal'|'datetime'|'binary'|'uniqueidentifier'|'string'}
 */
function mapDeclaredType(declaredType) {
  const type = String(declaredType || '').toUpperCase();

  if (/UNIQUEIDENTIFIER/.test(type)) return 'uniqueidentifier';
  if (/^(BOOL|BOOLEAN|BIT)$/.test(type)) return 'bit';
  if (/BLOB|BINARY|VARBINARY|IMAGE/.test(type)) return 'binary';
  if (/^(DATE|DATETIME|TIMESTAMP|SMALLDATETIME)/.test(type)) return 'datetime';
  // O SMO faz cast explicito para System.Decimal em colunas como
  // IdentitySeedAsDecimal. FLTN chega como double e estoura InvalidCast.
  if (/DECIMAL|NUMERIC/.test(type)) return 'decimal';
  if (/REAL|FLOAT|DOUBLE|MONEY/.test(type)) return 'float';
  if (/TINYINT/.test(type)) return 'tinyint';
  if (/SMALLINT/.test(type)) return 'smallint';
  if (/INT/.test(type)) return 'int';
  return 'string';
}

/**
 * Extrai precisao/escala de DECIMAL(p,s) e calcula o tamanho maximo do valor TDS.
 * @param {string} declaredType
 * @returns {{ precision: number, scale: number, maxLength: number }}
 */
function decimalShape(declaredType) {
  const encontrado = String(declaredType || '').match(/\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/);
  const precision = Math.min(Math.max(encontrado ? Number(encontrado[1]) : 18, 1), 38);
  const scale = Math.min(Math.max(encontrado && encontrado[2] ? Number(encontrado[2]) : 0, 0), precision);
  const maxLength = precision <= 9 ? 5 : precision <= 19 ? 9 : precision <= 28 ? 13 : 17;
  return { precision, scale, maxLength };
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
    let declared = (column && column.type) || '';
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

    // O SMO lê várias colunas de metadados com GetBoolean()/GetByte()/GetInt16().
    // Quando a expressão vem sem tipo declarado (CAST AS bit que o SQLite apaga,
    // CASE, ISNULL, COALESCE, aritmética), inferimos pelo nome+valor para evitar
    // "Specified cast is not valid" no SSMS (ex.: Script Key/Constraint As).
    if (!declared) {
      const todosZeroUm = values.length > 0 && values.every((value) => {
        const numero = Number(value);
        return Number.isInteger(numero) && (numero === 0 || numero === 1);
      });
      const todosInteiros = values.length > 0 && values.every((value) => Number.isInteger(Number(value)));
      if (/^(?:Is[A-Z_]|Has[A-Z_]|No[A-Z_]|PadIndex$|Unique$|Temporary$|IsOptimizedForSequentialKey$|IsFileTableDefined$|IsSystemNamed$|DisallowRowLocks$|DisallowPageLocks$|IgnoreDuplicateKeys$|IsDisabled$|IsUnique$|IsClustered$|IsSystemObject$|IsFullTextKey$|IsXmlIndex$|IsSpatialIndex$|HasSparseColumn$|HasFilter$|IsPartitioned$)/.test(name)) {
        if (values.length === 0 || todosZeroUm) kind = 'bit';
      } else if (/^(?:FillFactor|IndexType|SpatialIndexType|SecondaryXmlIndexType|ResumableOperationState|BackupSetType)$/i.test(name)) {
        if (values.length === 0 || todosInteiros) kind = 'tinyint';
      } else if (/^(?:Level[1-4]Grid|IndexKeyType)$/i.test(name)) {
        if (values.length === 0 || (todosInteiros && values.every((value) => {
          const numero = Number(value);
          return numero >= -32768 && numero <= 32767;
        }))) kind = 'smallint';
      }
    }

    // syscomments.texttype e syscomments.colid são SMALLINT no SQL Server. O
    // View Designer lê texttype com SqlDataReader.GetInt16(); se a coluna chegar
    // como INTN de 4 bytes ele estoura "Specified cast is not valid" e abre a
    // janela em branco. CAST não preserva o tipo declarado no SQLite, então a
    // correção precisa ser feita por nome aqui, antes de montar o metadado TDS.
    if (
      !declared && /^(texttype|colid)$/i.test(name) && values.length > 0 &&
      values.every((value) => {
        const numero = Number(value);
        return Number.isInteger(numero) && numero >= -32768 && numero <= 32767;
      })
    ) {
      declared = 'SMALLINT';
      kind = 'smallint';
    }

    const base = { name, kind, nullable, declaredType: declared };

    if (kind === 'tinyint') {
      return { ...base, type: TDS_TYPE.INTNTYPE, dataLength: 1 };
    }

    if (kind === 'smallint') {
      return { ...base, type: TDS_TYPE.INTNTYPE, dataLength: 2 };
    }

    if (kind === 'int') {
      // BIGINT declarado deve chegar sempre como INTN de 8 bytes, mesmo quando
      // o valor cabe em Int32. O SMO le essas colunas com GetInt64() e estoura
      // "Specified cast is not valid" se receber 4 bytes (ex.: Size 0, reads 0).
      const declaradoBigInt = /\bBIGINT\b/.test(typeName);
      const large = declaradoBigInt || values.some((value) => {
        if (typeof value === 'bigint') return true;
        const number = Number(value);
        return !Number.isSafeInteger(number) || Math.abs(number) > 2147483647;
      });
      return { ...base, type: TDS_TYPE.INTNTYPE, dataLength: large ? 8 : 4 };
    }

    if (kind === 'uniqueidentifier') {
      return { ...base, type: TDS_TYPE.UNIQUEIDTYPE, dataLength: 16 };
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

    if (kind === 'decimal') {
      return { ...base, type: TDS_TYPE.DECIMALTYPE, ...decimalShape(declared) };
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
    // syscomments.text é NVARCHAR(4000) no SQL Server. O View Designer usa o
    // ColumnSize anunciado para dimensionar o buffer de leitura do texto da
    // view; dimensionar pelo valor real (ex.: 84 bytes) faz a leitura falhar
    // silenciosamente e a janela abre em branco.
    const tamanhoTexto = /^text$/i.test(name) && !declared
      ? MAX_NVARCHAR_BYTES
      : Math.min(Math.max(max, 2), MAX_NVARCHAR_BYTES);
    return {
      ...base,
      type: TDS_TYPE.NVARCHARTYPE,
      maxLength: values.length ? tamanhoTexto : MAX_NVARCHAR_BYTES
    };
  });
}

/**
 * Converte um numero em digitos inteiros ja escalados para o TDS DECIMAL.
 * @param {*} value
 * @param {number} scale
 * @returns {{ negativo: boolean, valor: bigint }}
 */
function decimaisEscalados(value, scale) {
  let texto = String(value == null ? 0 : value).trim();
  const negativo = /^-/.test(texto);
  if (negativo) texto = texto.slice(1);

  let inteiro;
  let fracao;
  if (/^\d+(?:\.\d+)?$/.test(texto)) {
    [inteiro, fracao = ''] = texto.split('.');
  } else {
    const numero = Number(texto);
    texto = Number.isFinite(numero) ? Math.abs(numero).toFixed(scale) : '0';
    [inteiro, fracao = ''] = texto.split('.');
  }

  const digitos = inteiro + fracao.padEnd(scale, '0').slice(0, scale);
  return { negativo, valor: BigInt(digitos || '0') };
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

  if (type === TDS_TYPE.DECIMALTYPE) {
    const maxLength = meta.maxLength || 17;
    const { negativo, valor } = decimaisEscalados(value, meta.scale || 0);
    const buffer = Buffer.allocUnsafe(1 + maxLength);
    buffer.writeUInt8(maxLength, 0);
    // [MS-TDS]: 0 = negativo, 1 = nao negativo (invertido em relacao ao
    // decimal do .NET). Escrever 0 para positivo faz o cliente ler -1.
    buffer.writeUInt8(negativo ? 0 : 1, 1);
    let resto = valor;
    for (let indice = 0; indice < maxLength - 1; indice++) {
      buffer.writeUInt8(Number(resto & 0xFFn), 2 + indice);
      resto >>= 8n;
    }
    return buffer;
  }

  if (type === TDS_TYPE.UNIQUEIDTYPE) {
    // uniqueidentifier usa 16 bytes no formato mixed-endian do SQL Server:
    // os tres primeiros grupos em little-endian e os dois ultimos em big-endian.
    const texto = String(value).replace(/[{}-]/g, '');
    const hexadecimal = /^[0-9a-fA-F]{32}$/.test(texto)
      ? Buffer.from(texto, 'hex')
      : Buffer.alloc(16);
    const dados = Buffer.allocUnsafe(16);
    dados[0] = hexadecimal[3]; dados[1] = hexadecimal[2];
    dados[2] = hexadecimal[1]; dados[3] = hexadecimal[0];
    dados[4] = hexadecimal[5]; dados[5] = hexadecimal[4];
    dados[6] = hexadecimal[7]; dados[7] = hexadecimal[6];
    hexadecimal.copy(dados, 8, 8, 16);
    return Buffer.concat([Buffer.from([16]), dados]);
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
