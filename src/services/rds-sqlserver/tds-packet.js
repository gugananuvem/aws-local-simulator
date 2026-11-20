'use strict';

/**
 * tds-packet.js — Montagem e leitura de pacotes TDS 7.4.
 *
 * Todo pacote TDS possui um cabecalho fixo de 8 bytes:
 *   [0] tipo, [1] status (bit 0x01 = EOM), [2..3] tamanho total (BE),
 *   [4..5] SPID (BE), [6] packetId, [7] window (sempre 0 neste simulador).
 *
 * Nenhuma dependencia externa: apenas Buffer.
 */

const HEADER_SIZE = 8;

/** Tipos de pacote TDS utilizados pelo servidor. */
const TYPE = Object.freeze({
  SQLBATCH: 0x01,
  RPC: 0x03,
  TABULAR: 0x04,
  LOGIN7: 0x10,
  SSPI: 0x11,
  PRELOGIN: 0x12
});

/** Bits de status do cabecalho. */
const STATUS = Object.freeze({
  NORMAL: 0x00,
  EOM: 0x01,
  IGNORE: 0x02
});

/** Versao TDS 7.4 (SQL Server 2012+), no formato usado pelo LOGIN7. */
const TDS_VERSION_74 = 0x74000004;

/**
 * Le o cabecalho de 8 bytes de um pacote.
 * @param {Buffer} buffer
 * @returns {{type:number,status:number,length:number,spid:number,packetId:number,window:number,end:boolean}|null}
 */
function parseHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_SIZE) {
    return null;
  }

  const status = buffer.readUInt8(1);
  return {
    type: buffer.readUInt8(0),
    status,
    length: buffer.readUInt16BE(2),
    spid: buffer.readUInt16BE(4),
    packetId: buffer.readUInt8(6),
    window: buffer.readUInt8(7),
    end: (status & STATUS.EOM) !== 0
  };
}

/**
 * Monta um pacote TDS completo (cabecalho + payload).
 * @param {number} type um dos valores de TYPE
 * @param {Buffer|string} payload
 * @param {{spid?:number,packetId?:number,end?:boolean}} opcoes
 * @returns {Buffer}
 */
function buildPacket(type, payload, { spid = 0, packetId = 1, end = true } = {}) {
  const body = payload == null
    ? Buffer.alloc(0)
    : (Buffer.isBuffer(payload) ? payload : Buffer.from(payload));

  const packet = Buffer.allocUnsafe(HEADER_SIZE + body.length);
  packet.writeUInt8(type & 0xFF, 0);
  packet.writeUInt8(end ? STATUS.EOM : STATUS.NORMAL, 1);
  packet.writeUInt16BE(packet.length, 2); // tamanho total inclui o cabecalho
  packet.writeUInt16BE(spid & 0xFFFF, 4);
  packet.writeUInt8(packetId & 0xFF, 6);
  packet.writeUInt8(0, 7);
  body.copy(packet, HEADER_SIZE);
  return packet;
}

/**
 * Le um pacote completo de um buffer. Retorna null se ainda nao ha bytes
 * suficientes para o cabecalho ou para o corpo declarado.
 * @param {Buffer} buffer
 * @returns {{header:Object,type:number,end:boolean,length:number,payload:Buffer,bytesConsumed:number}|null}
 */
function readPacket(buffer) {
  const header = parseHeader(buffer);
  if (!header || header.length < HEADER_SIZE || !Buffer.isBuffer(buffer) || buffer.length < header.length) {
    return null;
  }

  return {
    header,
    type: header.type,
    end: header.end,
    length: header.length,
    payload: Buffer.from(buffer.subarray(HEADER_SIZE, header.length)),
    bytesConsumed: header.length
  };
}

/**
 * Acumula chunks TCP e devolve mensagens TDS completas (uma mensagem =
 * um ou mais pacotes terminados por EOM).
 */
class PacketAssembler {
  constructor() {
    this.reset();
  }

  reset() {
    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._messageType = null;
    this._spid = 0;
  }

  /**
   * @param {Buffer} chunk
   * @returns {Array<{type:number,payload:Buffer,spid:number}>}
   */
  push(chunk) {
    const messages = [];
    if (!chunk || !chunk.length) {
      return messages;
    }

    this._buffer = this._buffer.length
      ? Buffer.concat([this._buffer, chunk])
      : Buffer.from(chunk);

    while (this._buffer.length >= HEADER_SIZE) {
      const packet = readPacket(this._buffer);
      if (!packet) {
        break; // pacote incompleto: espera o proximo chunk
      }

      this._buffer = this._buffer.subarray(packet.bytesConsumed);

      if (this._messageType === null) {
        this._messageType = packet.type;
        this._spid = packet.header.spid;
      }
      this._fragments.push(packet.payload);

      if (packet.end) {
        messages.push({
          type: this._messageType,
          payload: Buffer.concat(this._fragments),
          spid: this._spid
        });
        this._fragments = [];
        this._messageType = null;
      }
    }

    return messages;
  }
}

/**
 * Monta a resposta PRELOGIN: tabela de tokens + area de dados.
 * Offsets sao relativos ao inicio do payload PRELOGIN (apos o cabecalho TDS).
 *
 * @param {number[]} version 6 bytes: major, minor, build(2), subbuild(2)
 * @returns {Buffer}
 */
function buildPreloginResponse(version = [0x0B, 0x00, 0x00, 0x00, 0x00, 0x00]) {
  const entries = [
    { token: 0x00, data: Buffer.from(version) },              // VERSION
    { token: 0x01, data: Buffer.from([0x02]) },               // ENCRYPTION = NOT_SUP
    { token: 0x02, data: Buffer.from([0x00]) },               // INSTOPT = none
    { token: 0x03, data: Buffer.from([0x00, 0x00, 0x00, 0x00]) }, // THREADID = 0
    { token: 0x04, data: Buffer.from([0x00]) }                // MARS = desligado
  ];

  // Cada entrada ocupa 5 bytes (token + offset + tamanho); mais 1 byte de terminador.
  let offset = entries.length * 5 + 1;
  const table = [];
  const data = [];

  for (const entry of entries) {
    const item = Buffer.alloc(5);
    item.writeUInt8(entry.token, 0);
    item.writeUInt16BE(offset, 1);
    item.writeUInt16BE(entry.data.length, 3);
    table.push(item);
    data.push(entry.data);
    offset += entry.data.length;
  }

  return Buffer.concat([...table, Buffer.from([0xFF]), ...data]);
}

/** Nomes dos pares ib/cch da tabela de offsets do LOGIN7, na ordem do fio. */
const LOGIN7_FIELDS = [
  'hostName', 'userName', 'password', 'appName', 'serverName',
  'extension', 'ctlibLibrary', 'locale', 'database'
];

/**
 * Interpreta o corpo de uma mensagem LOGIN7.
 * As strings sao UTF-16LE e seus tamanhos (cch) sao contados em caracteres.
 * O bloco FeatureExt do TDS 7.4 fica apos os dados e termina em 0xFF; apenas
 * o localizamos para nao confundi-lo com dados de texto.
 *
 * @param {Buffer} payload
 * @returns {Object|null}
 */
/**
 * A senha viaja em UTF-16LE com cada byte trocando os nibbles e depois XOR 0xA5.
 * A operação é simétrica: aplicá-la novamente devolve o texto original.
 * @private
 */
function decodificarSenha(buffer) {
  const saida = Buffer.allocUnsafe(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i] ^ 0xA5;
    saida[i] = ((byte & 0x0F) << 4) | ((byte & 0xF0) >> 4);
  }
  return saida.toString('utf16le').replace(/\0+$/, '');
}

function parseLogin7(payload) {
  // Cabeçalho fixo: Length(4), TDSVersion(4), PacketSize(4), ProgVer(4), PID(4),
  // ConnectionID(4), flags(4), TimeZone(4), LCID(4) = 36 bytes; depois vem a tabela ib/cch.
  const CABECALHO_LOGIN7 = 36;
  if (!Buffer.isBuffer(payload) || payload.length < CABECALHO_LOGIN7 + LOGIN7_FIELDS.length * 4) {
    return null;
  }

  const tdsVersion = payload.readUInt32LE(4);
  const packetSize = payload.readUInt32LE(8);

  const offsets = {};
  LOGIN7_FIELDS.forEach((name, index) => {
    const at = CABECALHO_LOGIN7 + index * 4;
    offsets[name] = {
      ib: payload.readUInt16LE(at),
      cch: payload.readUInt16LE(at + 2)
    };
  });

  function readField(name) {
    const info = offsets[name];
    if (!info || !info.cch || info.ib + info.cch * 2 > payload.length) {
      return '';
    }
    if (name === 'password') {
      return decodificarSenha(payload.subarray(info.ib, info.ib + info.cch * 2));
    }
    return payload.toString('utf16le', info.ib, info.ib + info.cch * 2).replace(/\0+$/, '');
  }

  const strings = {};
  let dataEnd = 0;
  for (const name of LOGIN7_FIELDS) {
    strings[name] = readField(name);
    const info = offsets[name];
    const end = info.ib + info.cch * 2;
    if (info.cch && end > dataEnd) {
      dataEnd = end;
    }
  }

  const featureExt = dataEnd < payload.length ? payload.subarray(dataEnd) : Buffer.alloc(0);

  return {
    tdsVersion,
    tdsVersionLabel: tdsVersion === TDS_VERSION_74 ? '7.4' : null,
    packetSize,
    optionFlags1: payload.readUInt8(24),
    optionFlags2: payload.readUInt8(25),
    typeFlags: payload.readUInt8(26),
    optionFlags3: payload.readUInt8(27),
    clientLcid: payload.readUInt32LE(32),
    offsets,
    featureExt,
    hasFeatureExtTerminator: featureExt.length > 0 && featureExt[featureExt.length - 1] === 0xFF,
    hostName: strings.hostName,
    userName: strings.userName,
    password: strings.password,
    appName: strings.appName,
    serverName: strings.serverName,
    database: strings.database,
    databaseName: strings.database
  };
}

module.exports = {
  HEADER_SIZE,
  TYPE,
  STATUS,
  TDS_VERSION_74,
  LOGIN7_FIELDS,
  buildPacket,
  parseHeader,
  readPacket,
  PacketAssembler,
  buildPreloginResponse,
  parseLogin7
};
