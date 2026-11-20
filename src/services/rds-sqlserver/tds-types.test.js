'use strict';

const {
  TDS_TYPE,
  COLLATION,
  MAX_NVARCHAR_BYTES,
  MAX_VARBINARY_BYTES,
  mapDeclaredType,
  columnMetadata,
  encodeValue,
  nullBitmap,
  rowToken,
  encodeRow,
} = require('./tds-types');

describe('tipos TDS', () => {
  test('mapeia tipos declarados do SQLite para famílias TDS', () => {
    expect(mapDeclaredType('BIT')).toBe('bit');
    expect(mapDeclaredType('boolean')).toBe('bit');
    expect(mapDeclaredType('VARBINARY(MAX)')).toBe('binary');
    expect(mapDeclaredType('datetime')).toBe('datetime');
    expect(mapDeclaredType('DECIMAL(10,2)')).toBe('float');
    expect(mapDeclaredType('BIGINT')).toBe('int');
    expect(mapDeclaredType('NVARCHAR(50)')).toBe('string');
    expect(mapDeclaredType()).toBe('string');
    expect(COLLATION).toHaveLength(5);
  });

  test('monta metadados INTN de 4 ou 8 bytes conforme os valores', () => {
    expect(columnMetadata([{ name: 'id', type: 'INTEGER' }], [{ id: 1 }])[0])
      .toMatchObject({ type: TDS_TYPE.INTNTYPE, dataLength: 4, nullable: true });
    expect(columnMetadata([{ name: 'id', type: 'INTEGER' }], [{ id: 9007199254740993n }])[0])
      .toMatchObject({ type: TDS_TYPE.INTNTYPE, dataLength: 8 });
    expect(columnMetadata([{ name: 'id', type: 'INTEGER', notNull: true }])[0].nullable).toBe(false);
  });

  test('monta metadados de bit, data, float, binário e texto', () => {
    const colunas = columnMetadata([
      { name: 'ativo', type: 'BIT' },
      { name: 'criado', type: 'DATETIME' },
      { name: 'preco', type: 'REAL' },
      { name: 'total', type: 'MONEY' },
      { name: 'dados', type: 'BLOB' },
      { name: 'nome', type: 'NVARCHAR' },
      { name: 'vazio', type: 'TEXT' },
      { name: 'outro', type: ' Column1 ' },
    ], [{
      ativo: 1,
      criado: '2026-01-01T10:00:00Z',
      preco: 1.5,
      total: 2.5,
      dados: Buffer.from([1, 2, 3]),
      nome: 'Ana',
      vazio: null,
      Column1: 'x',
    }]);

    expect(colunas[0]).toMatchObject({ type: TDS_TYPE.BITNTYPE, dataLength: 1 });
    expect(colunas[1]).toMatchObject({ type: TDS_TYPE.DATETIMNTYPE, dataLength: 8 });
    expect(colunas[2]).toMatchObject({ type: TDS_TYPE.FLTNTYPE, dataLength: 4 });
    expect(colunas[3]).toMatchObject({ type: TDS_TYPE.FLTNTYPE, dataLength: 8 });
    expect(colunas[4]).toMatchObject({ type: TDS_TYPE.VARBINARYTYPE, maxLength: 3 });
    expect(colunas[5]).toMatchObject({ type: TDS_TYPE.NVARCHARTYPE, maxLength: 6 });
    expect(colunas[6]).toMatchObject({ type: TDS_TYPE.NVARCHARTYPE, maxLength: MAX_NVARCHAR_BYTES });
    expect(colunas[7].name).toBe('outro');
  });

  test('reaproveita metadados já mapeados e nomeia colunas sem descritor', () => {
    const meta = { name: 'pronto', kind: 'int', type: TDS_TYPE.INTNTYPE, dataLength: 4 };
    expect(columnMetadata([meta])[0]).toBe(meta);
    expect(columnMetadata([null])[0]).toMatchObject({ name: 'Column1', type: TDS_TYPE.NVARCHARTYPE });
    expect(columnMetadata([{ name: 'x', type: 'BLOB' }], [undefined])[0].maxLength).toBe(2);
  });

  test('codifica nulos com comprimento correto', () => {
    expect(encodeValue(null, { type: TDS_TYPE.INTNTYPE })).toEqual(Buffer.from([0x00]));
    expect(encodeValue(undefined, { type: TDS_TYPE.BITNTYPE })).toEqual(Buffer.from([0x00]));
    expect(encodeValue(null, { type: TDS_TYPE.DATETIMNTYPE })).toEqual(Buffer.from([0x00]));
    expect(encodeValue(null, { type: TDS_TYPE.FLTNTYPE })).toEqual(Buffer.from([0x00]));
    expect(encodeValue(null, { type: TDS_TYPE.NVARCHARTYPE })).toEqual(Buffer.from([0xFF, 0xFF]));
    expect(encodeValue(null, { type: TDS_TYPE.VARBINARYTYPE })).toEqual(Buffer.from([0xFF, 0xFF]));
  });

  test('codifica inteiros de 4 e 8 bytes, bits e floats', () => {
    const int4 = encodeValue(42, { type: TDS_TYPE.INTNTYPE, dataLength: 4 });
    expect(int4[0]).toBe(4);
    expect(int4.readInt32LE(1)).toBe(42);

    const int8 = encodeValue(5000000000n, { type: TDS_TYPE.INTNTYPE, dataLength: 8 });
    expect(int8[0]).toBe(8);
    expect(int8.readBigInt64LE(1)).toBe(5000000000n);

    expect(encodeValue(1, { type: TDS_TYPE.BITNTYPE })).toEqual(Buffer.from([0x01, 0x01]));
    expect(encodeValue(0, { type: TDS_TYPE.BITNTYPE })).toEqual(Buffer.from([0x01, 0x00]));

    const real = encodeValue(1.5, { type: TDS_TYPE.FLTNTYPE, dataLength: 4 });
    expect(real.readFloatLE(1)).toBe(1.5);
    const float = encodeValue(1.5, { type: TDS_TYPE.FLTNTYPE, dataLength: 8 });
    expect(float.readDoubleLE(1)).toBe(1.5);
  });

  test('codifica datas no formato de ticks do SQL Server', () => {
    const data = encodeValue('1900-01-01T00:00:00.000Z', { type: TDS_TYPE.DATETIMNTYPE });
    expect(data[0]).toBe(8);
    expect(data.readInt32LE(1)).toBe(0);
    expect(data.readUInt32LE(5)).toBe(0);

    const fim = encodeValue(new Date('1900-01-02T00:00:00.000Z'), { type: TDS_TYPE.DATETIMNTYPE });
    expect(fim.readInt32LE(1)).toBe(1);
    expect(encodeValue('data inválida', { type: TDS_TYPE.DATETIMNTYPE })).toEqual(Buffer.from([0x00]));
  });

  test('limita binários e textos ao tamanho máximo', () => {
    const bin = Buffer.alloc(MAX_VARBINARY_BYTES + 10, 7);
    const codificado = encodeValue(bin, { type: TDS_TYPE.VARBINARYTYPE });
    expect(codificado.readUInt16LE(0)).toBe(MAX_VARBINARY_BYTES);
    expect(encodeValue('abc', { type: TDS_TYPE.VARBINARYTYPE }).toString('utf8')).toContain('abc');

    const texto = Buffer.alloc(MAX_NVARCHAR_BYTES + 10, 0x41);
    const nvarchar = encodeValue(texto, { type: TDS_TYPE.NVARCHARTYPE });
    expect(nvarchar.readUInt16LE(0)).toBe(MAX_NVARCHAR_BYTES);
  });

  test('gera máscara de nulos, token ROW e linhas completas', () => {
    expect(nullBitmap([1, null, undefined, 4])).toEqual(Buffer.from([0x06]));
    expect(nullBitmap([null, ...Array(9).fill(1)])).toEqual(Buffer.from([0x01, 0x00]));

    const meta = [{ name: 'id', kind: 'int', type: TDS_TYPE.INTNTYPE, dataLength: 4 }];
    const token = rowToken([7], meta);
    expect(token[0]).toBe(0xD1);
    expect(token.readInt32LE(2)).toBe(7);

    const linhas = encodeRow([{ nome: 'Ana' }, { nome: 'Bia' }]);
    expect(linhas.filter((byte) => byte === 0xD1)).toHaveLength(2);
    expect(encodeRow([[1, 2]], [{ name: 'a', type: 'INTEGER' }, { name: 'b', type: 'INTEGER' }])[0]).toBe(0xD1);
    expect(encodeRow([])).toEqual(Buffer.alloc(0));
  });
});
