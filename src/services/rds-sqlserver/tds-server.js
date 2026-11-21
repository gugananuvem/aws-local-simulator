'use strict';

/**
 * tds-server.js — Servidor TDS 7.4 minimo sobre TCP (porta 1433 por padrao).
 *
 * Aceita PRELOGIN, LOGIN7, SQL Batch e RPC (best-effort) e traduz as consultas
 * para o DbEngine/ClusterManager existentes. Nenhuma dependencia de runtime
 * alem de 'net' e 'Buffer'.
 */

const net = require('net');
const logger = require('../../utils/logger');

const {
  TYPE,
  buildPacket,
  buildPreloginResponse,
  parseLogin7,
  PacketAssembler
} = require('./tds-packet');

const {
  DONE_STATUS,
  loginAckToken,
  databaseEnvChangeToken,
  collationEnvChangeToken,
  infoToken,
  errorToken,
  colMetadataToken,
  doneToken
} = require('./tds-tokens');

const { columnMetadata, encodeRow } = require('./tds-types');
const { VERSAO } = require('./system-catalog');

const DEFAULT_PACKET_SIZE = 4096;
const MIN_PACKET_SIZE = 512;
const MAX_PACKET_SIZE = 32767;
const MAX_PACKET_PAYLOAD = 0xFFFF - 8; // tamanho maximo cabeca UInt16BE menos o cabecalho

/**
 * O LOGINACK precisa anunciar a mesma versao que SERVERPROPERTY/@@VERSION.
 * O SSMS 19 (Microsoft.Data.SqlClient 3.1.3) usa ServerVersion para escolher
 * recursos do SMO; anunciar 11.0 enquanto o catalogo diz 16.0 deixa arvores
 * do Object Explorer em estado inconsistente.
 */
function versaoLoginAck() {
  const [major = 16, minor = 0, build = 4035] = String(VERSAO).split('.').map(Number);
  return {
    major: major & 0xFF,
    minor: minor & 0xFF,
    buildHi: (build >> 8) & 0xFF,
    buildLow: build & 0xFF
  };
}

/** Le um B_VARCHAR (1 byte de caracteres + UTF-16LE). */
function readBVarChar(buffer, position) {
  const count = buffer.readUInt8(position);
  const start = position + 1;
  const end = Math.min(start + count * 2, buffer.length);
  return { value: buffer.toString('utf16le', start, end), offset: end };
}

/** Le um US_VARCHAR (2 bytes de caracteres + UTF-16LE). */
function readUsVarChar(buffer, position) {
  const count = buffer.readUInt16LE(position);
  const start = position + 2;
  const end = Math.min(start + count * 2, buffer.length);
  return { value: buffer.toString('utf16le', start, end), offset: end };
}

/**
 * Interpretacao minima de um valor de parametro RPC: apenas o necessario para
 * extrair o texto de sp_executesql e alguns parametros posicionais.
 */
function readRpcValue(buffer, position) {
  let pos = position;
  if (pos >= buffer.length) return { value: null, offset: pos };
  const type = buffer.readUInt8(pos++);

  try {
    if (type === 0x26 || type === 0x68 || type === 0x6D || type === 0x6F) {
      const maxLength = buffer.readUInt8(pos++);
      if (!maxLength) return { value: null, offset: pos };
      // SqlClient inclui o comprimento real antes dos dados em tipos numericos
      // de tamanho variavel (INTN, BITN, FLOATN, DATETIMEN).
      const length = buffer.readUInt8(pos++);
      if (!length) return { value: null, offset: pos };
      if (type === 0x26) {
        if (length === 8) return { value: Number(buffer.readBigInt64LE(pos)), offset: pos + 8 };
        if (length === 2) return { value: buffer.readInt16LE(pos), offset: pos + 2 };
        if (length === 1) return { value: buffer.readInt8(pos), offset: pos + 1 };
        return { value: buffer.readInt32LE(pos), offset: pos + 4 };
      }
      if (type === 0x68) return { value: buffer.readUInt8(pos) === 1, offset: pos + 1 };
      if (type === 0x6D) {
        return length === 4
          ? { value: buffer.readFloatLE(pos), offset: pos + 4 }
          : { value: buffer.readDoubleLE(pos), offset: pos + 8 };
      }
      return { value: new Date(1900, 0, 1, 0, 0, 0, 0), offset: pos + 8 };
    }

    if (type === 0xE7) { // NVARCHAR com comprimentos de 2 bytes
      pos += 2; // tamanho maximo declarado
      pos += 5; // collation
      const bytes = buffer.readUInt16LE(pos);
      pos += 2;
      if (bytes === 0xFFFF) return { value: null, offset: pos };
      return { value: buffer.toString('utf16le', pos, Math.min(pos + bytes, buffer.length)), offset: pos + bytes };
    }

    if (type === 0x63) { // NVARCHAR com comprimentos de 4 bytes (SqlClient/SMO)
      pos += 4; // tamanho maximo declarado
      pos += 5; // collation
      const bytes = buffer.readUInt32LE(pos);
      pos += 4;
      if (bytes === 0xFFFFFFFF) return { value: null, offset: pos };
      return { value: buffer.toString('utf16le', pos, Math.min(pos + bytes, buffer.length)), offset: pos + bytes };
    }

    if (type === 0xA5) { // VARBINARY
      const bytes = buffer.readUInt16LE(pos);
      pos += 2;
      if (bytes === 0xFFFF) return { value: null, offset: pos };
      return { value: buffer.subarray(pos, Math.min(pos + bytes, buffer.length)), offset: pos + bytes };
    }
  } catch {
    // Parametro malformado: devolvemos null e seguimos para nao derrubar a conexao.
  }

  return { value: null, offset: Math.min(pos + 1, buffer.length) };
}

/** Procedimentos que o SqlClient chama pelo ProcID numerico. */
const RPC_POR_ID = Object.freeze({
  10: 'sp_executesql',
  11: 'sp_prepare',
  12: 'sp_execute',
  15: 'sp_unprepare'
});

/** Extrai nome do procedimento e parametros de uma mensagem RPC. */
function parseRpc(payload) {
  let pos = 0;
  let procName = '';

  // O SqlClient prefixa o RPC com um cabecalho de 22 bytes: TotalLength,
  // HeaderLength (18) e os campos MARS (tipo, transacao e resultados abertos).
  if (payload.length >= 22 && payload.readUInt32LE(4) === 18) {
    pos = 4 + payload.readUInt32LE(4);
  }

  if (payload.length >= pos + 2 && payload.readUInt16LE(pos) === 0xFFFF) {
    // 0xFFFF indica ProcID numerico (sp_executesql, sp_execute, ...).
    const procId = payload.readUInt16LE(pos + 2);
    procName = RPC_POR_ID[procId] || '';
    pos += 4;
  } else {
    const name = readUsVarChar(payload, pos);
    procName = String(name.value || '');
    pos = name.offset;
  }

  pos += 2; // OptionFlags

  const params = [];
  while (pos + 1 < payload.length) {
    const start = pos;
    const name = readBVarChar(payload, pos);
    pos = name.offset + 1; // nome + StatusFlags
    const value = readRpcValue(payload, pos);
    pos = value.offset;
    if (pos <= start) break; // protecao contra loop infinito
    params.push(value.value);
  }

  return { procName, params };
}

class TdsServer {
  /**
   * @param {{port?:number,host?:string,clusterManager?:Object,dbEngine?:Object,logger?:Object}} opcoes
   */
  constructor({
    port = 1433,
    host = '127.0.0.1',
    clusterManager,
    dbEngine,
    logger: customLogger
  } = {}) {
    this.port = port;
    this.host = host;
    this.clusterManager = clusterManager;
    this.dbEngine = dbEngine;
    this.logger = customLogger || logger;

    this.server = null;
    this.sessions = new Map();
    this._nextSpid = 1;
    this._onConnectionBound = (socket) => this._onConnection(socket);
  }

  /** Inicia a escuta TCP. Resolve com a porta real (util quando port = 0). */
  start() {
    if (this.server) {
      return Promise.resolve(this.getStatus().port);
    }

    return new Promise((resolve, reject) => {
      const server = net.createServer(this._onConnectionBound);
      const onError = (error) => reject(error);
      server.once('error', onError);

      server.listen(this.port, this.host, () => {
        server.removeListener('error', onError);
        server.on('error', (error) => this.logger.error('[TDS] Erro no servidor:', error.message));
        this.server = server;
        const status = this.getStatus();
        this.logger.info(`[TDS] Servidor TDS 7.4 ouvindo em ${status.host}:${status.port}`);
        resolve(status.port);
      });
    });
  }

  /** Fecha apenas as conexoes ativas (usado pelo reset do servico). */
  closeSessions() {
    for (const session of this.sessions.values()) {
      try {
        session.socket.destroy();
      } catch {
        // Conexao ja fechada.
      }
    }
    this.sessions.clear();
  }

  /** Encerra o servidor e destri todas as conexoes ativas. */
  stop() {
    const server = this.server;
    if (!server) return Promise.resolve();

    this.closeSessions();

    return new Promise((resolve) => {
      server.close(() => {
        this.server = null;
        this.logger.debug('[TDS] Servidor TDS encerrado');
        resolve();
      });
    });
  }

  getStatus() {
    let port = this.port;
    if (this.server && this.server.listening) {
      const address = this.server.address();
      if (address && typeof address === 'object') {
        port = address.port;
      }
    }
    return {
      running: !!(this.server && this.server.listening),
      host: this.host,
      port,
      connections: this.sessions.size
    };
  }

  _onConnection(socket) {
    const spid = this._nextSpid++ & 0xFFFF;
    const session = {
      socket,
      spid,
      cluster: null,
      dbName: null,
      packetSize: DEFAULT_PACKET_SIZE,
      packetId: 0,
      assembler: new PacketAssembler()
    };
    this.sessions.set(socket, session);
    this.logger.debug(`[TDS] Conexao ${spid} aceita de ${socket.remoteAddress || '?'}`);

    socket.on('data', (chunk) => {
      let messages;
      try {
        messages = session.assembler.push(chunk);
      } catch (error) {
        this.logger.debug(`[TDS] Falha ao montar pacote (spid ${spid}): ${error.message}`);
        socket.destroy();
        return;
      }

      for (const message of messages) {
        Promise.resolve()
          .then(() => this._handleMessage(socket, session, message))
          .catch((error) => {
            this.logger.error(`[TDS] Erro ao processar mensagem (spid ${spid}):`, error.message);
            this._sendFailure(socket, session, error);
          });
      }
    });

    socket.on('error', (error) => {
      this.logger.debug(`[TDS] Socket ${spid}: ${error.message}`);
    });

    socket.on('close', () => {
      this.sessions.delete(socket);
      this.logger.debug(`[TDS] Conexao ${spid} encerrada`);
    });
  }

  async _handleMessage(socket, session, message) {
    switch (message.type) {
      case TYPE.PRELOGIN:
        // O cliente envia 0x12, mas a resposta do servidor deve usar 0x04 (TABULAR).
        this._sendRaw(socket, session, TYPE.TABULAR, buildPreloginResponse());
        break;

      case TYPE.LOGIN7:
        this._handleLogin(socket, session, message);
        break;

      case TYPE.SQLBATCH:
        await this._handleSqlBatch(socket, session, message);
        break;

      case TYPE.RPC:
        await this._handleRpc(socket, session, message);
        break;

      case TYPE.ATTENTION:
        // O SqlClient/SMO envia ATTENTION para cancelar a leitura de certos
        // resultsets de metadados. Responder com ERROR faz o cliente estourar
        // NullReferenceException no TdsParser; o correto e ack com DONE_ATTN.
        this._sendRaw(socket, session, TYPE.TABULAR, doneToken({
          status: DONE_STATUS.ATTN,
          rowcount: 0
        }));
        break;

      case TYPE.SSPI:
        this._sendFailure(
          socket,
          session,
          new Error('Autenticacao integrada (SSPI) nao suportada; use autenticacao SQL Server.')
        );
        break;

      default:
        this._sendFailure(socket, session, new Error(`Tipo de pacote TDS 0x${message.type.toString(16)} nao suportado.`));
    }
  }

  /** Escreve uma mensagem TDS, fragmentando em pacotes quando necessario. */
  _sendRaw(socket, session, type, payload) {
    if (!socket || !socket.writable || !payload) return;

    const windowSize = Math.min(
      Math.max(session.packetSize || DEFAULT_PACKET_SIZE, 512),
      MAX_PACKET_SIZE
    );
    const limit = Math.min(windowSize - 8, MAX_PACKET_PAYLOAD);
    const packets = [];

    if (payload.length <= limit) {
      packets.push(buildPacket(type, payload, {
        spid: session.spid,
        packetId: this._nextPacketId(session),
        end: true
      }));
    } else {
      for (let offset = 0; offset < payload.length; offset += limit) {
        const end = offset + limit >= payload.length;
        packets.push(buildPacket(type, payload.subarray(offset, Math.min(offset + limit, payload.length)), {
          spid: session.spid,
          packetId: this._nextPacketId(session),
          end
        }));
      }
    }

    socket.write(Buffer.concat(packets));
  }

  _nextPacketId(session) {
    session.packetId = (session.packetId + 1) & 0xFF;
    return session.packetId;
  }

  _serverName(session) {
    return (session.cluster && session.cluster.DBClusterIdentifier) || 'LOCAL';
  }

  _handleLogin(socket, session, message) {
    const login = parseLogin7(message.payload);
    if (!login) {
      this._sendFailure(socket, session, new Error('Mensagem LOGIN7 incompleta.'), 18456, 14);
      socket.end();
      return;
    }

    if (login.packetSize >= MIN_PACKET_SIZE) {
      session.packetSize = Math.min(login.packetSize, MAX_PACKET_SIZE);
    }

    let cluster = null;
    try {
      if (this.clusterManager && typeof this.clusterManager.verifyCredentials === 'function') {
        cluster = this.clusterManager.verifyCredentials(login.userName, login.password, login.serverName);
      }
    } catch (error) {
      this.logger.debug(`[TDS] Falha ao verificar credenciais: ${error.message}`);
    }

    if (!cluster) {
      const messageText = `Falha de login para o usuario '${login.userName}'.`;
      this.logger.debug(`[TDS] Login recusado (spid ${session.spid}): ${login.userName}`);
      const response = Buffer.concat([
        errorToken(18456, 1, 14, messageText, login.serverName || 'LOCAL'),
        doneToken({ status: DONE_STATUS.ERROR | DONE_STATUS.COUNT, rowcount: 0 })
      ]);
      this._sendRaw(socket, session, TYPE.TABULAR, response);
      socket.end();
      return;
    }

    session.cluster = cluster;
    // O SSMS abre uma conexão separada com Initial Catalog=msdb para avaliar a
    // policy health; ignorar esse campo faz o SqlClient falhar localmente.
    session.dbName = String(login.database || '').trim() || cluster.DatabaseName || 'master';
    const serverName = this._serverName(session);

    const response = Buffer.concat([
      databaseEnvChangeToken('', session.dbName),
      collationEnvChangeToken(),
      loginAckToken(serverName, versaoLoginAck()),
      infoToken(`Conectado ao cluster local ${serverName} (TDS 7.4).`, serverName),
      doneToken({ rowcount: 0 })
    ]);

    this._sendRaw(socket, session, TYPE.TABULAR, response);
    this.logger.debug(`[TDS] Login aceito (spid ${session.spid}): ${login.userName} -> ${session.dbName}`);
  }

  _splitBatches(sql) {
    if (this.dbEngine && this.dbEngine.translator) {
      const translator = this.dbEngine.translator;
      // O SSMS envia lotes de descoberta que devem virar varios resultsets.
      if (typeof translator.expandirResultSets === 'function') {
        try {
          const expandidos = translator.expandirResultSets(sql);
          if (Array.isArray(expandidos) && expandidos.length > 0) return expandidos;
        } catch (error) {
          this.logger.debug(`[TDS] expandirResultSets falhou, usando fallback: ${error.message}`);
        }
      }
      if (typeof translator.splitBatches === 'function') {
        try {
          const batches = translator.splitBatches(sql);
          if (Array.isArray(batches)) return batches;
        } catch (error) {
          this.logger.debug(`[TDS] splitBatches falhou, usando fallback: ${error.message}`);
        }
      }
    }
    return String(sql).split(/^\s*GO\s*;?\s*$/im).map((batch) => batch.trim()).filter(Boolean);
  }

  /**
   * O payload de SQL Batch comeca com um bloco "All Headers": 4 bytes com o tamanho
   * total do cabecalho (incluindo esses 4 bytes) e, em seguida, o SQL em UCS-2LE.
   * Clients simplificados enviam apenas o texto, sem esse prefixo.
   * @private
   */
  _decodeSqlBatch(payload) {
    let inicio = 0;
    if (payload.length >= 4) {
      const tamanhoCabecalho = payload.readUInt32LE(0);
      if (tamanhoCabecalho >= 4 && tamanhoCabecalho <= payload.length) {
        inicio = tamanhoCabecalho;
      }
    }

    const texto = payload.subarray(inicio);
    const sqlUtf16 = texto.toString('utf16le');
    return sqlUtf16.includes('\uFFFD') ? texto.toString('utf8') : sqlUtf16;
  }

  async _handleSqlBatch(socket, session, message) {
    const sql = this._decodeSqlBatch(message.payload);
    await this._executeSql(socket, session, sql);
  }

  async _executeSql(socket, session, sql, params = []) {
    const batches = this._splitBatches(sql);
    const response = [];
    let hasResults = false;

    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index];
      if (!batch || !batch.trim()) continue;

      const useMatch = batch.match(/^\s*USE\s+(?:\[([^\]]+)\]|"([^"]+)"|`([^`]+)`|([A-Za-z0-9_]+))\s*;?\s*$/i);
      if (useMatch) {
        const database = useMatch[1] || useMatch[2] || useMatch[3] || useMatch[4];
        const previous = session.dbName || 'master';
        session.dbName = database;
        response.push(databaseEnvChangeToken(previous, database));
        // Sem contagem de linhas: clientes ODBC encerram a sessao se DONE_COUNT
        // vier com rowcount zero para um comando de sessao (USE, SET, etc.).
        response.push(doneToken({ status: 0, rowcount: 0 }));
        hasResults = true;
        continue;
      }

      const more = index < batches.length - 1;
      try {
        if (!this.dbEngine || typeof this.dbEngine.execute !== 'function') {
          throw new Error('DbEngine nao disponivel para executar a consulta.');
        }

        const result = await this.dbEngine.execute(session.dbName || 'master', batch, params || []);
        hasResults = true;

        if (result && result.type === 'select') {
          const columns = result.columns || [];
          const rows = result.rows || [];
          response.push(colMetadataToken(columnMetadata(columns, rows)));
          response.push(encodeRow(rows, columns));
          response.push(doneToken({ rowcount: rows.length, more }));
        } else {
          const changes = (result && result.changes) || 0;
          response.push(doneToken({
            status: changes ? DONE_STATUS.COUNT : 0,
            rowcount: changes,
            more
          }));
        }
      } catch (error) {
        hasResults = true;
        response.push(errorToken(
          error.number || 50000,
          error.state || 1,
          error.class || 16,
          error.message || String(error),
          this._serverName(session)
        ));
        response.push(doneToken({
          status: DONE_STATUS.ERROR | DONE_STATUS.COUNT,
          rowcount: 0
        }));
      }
    }

    if (!hasResults) {
      // Lote vazio (ex.: SET de sessao ja removido pelo tradutor): sem DONE_COUNT.
      response.push(doneToken({ status: 0, rowcount: 0 }));
    }

    this._sendRaw(socket, session, TYPE.TABULAR, Buffer.concat(response));
  }

  async _handleRpc(socket, session, message) {
    let rpc;
    try {
      rpc = parseRpc(message.payload);
    } catch {
      rpc = { procName: '', params: [] };
    }

    const procName = String(rpc.procName || '').replace(/^dbo\./i, '').toLowerCase();
    if (procName === 'sp_executesql' && rpc.params.length) {
      const sql = typeof rpc.params[0] === 'string' ? rpc.params[0] : '';
      if (sql.trim()) {
        // params[1] e a definicao dos parametros; os demais sao os valores.
        await this._executeSql(socket, session, sql, rpc.params.slice(2));
        return;
      }
    }

    const description = procName ? `RPC '${procName}'` : 'RPC';
    const response = Buffer.concat([
      errorToken(2812, 62, 16, `${description} nao suportado; use SQL Batch.`, this._serverName(session)),
      doneToken({ status: DONE_STATUS.ERROR | DONE_STATUS.COUNT, rowcount: 0 })
    ]);
    this._sendRaw(socket, session, TYPE.TABULAR, response);
  }

  _sendFailure(socket, session, error, number = 50000, severity = 16) {
    const response = Buffer.concat([
      errorToken(number, 1, severity, error.message || String(error), this._serverName(session)),
      doneToken({ status: DONE_STATUS.ERROR | DONE_STATUS.COUNT, rowcount: 0 })
    ]);
    this._sendRaw(socket, session, TYPE.TABULAR, response);
  }
}

module.exports = { TdsServer };
