'use strict';

/**
 * Testes do servidor TDS local. Nao dependem de SQL Server real: usamos
 * sockets TCP na porta 0 e fakes de ClusterManager/DbEngine.
 */

const net = require('net');

const { TdsServer } = require('./tds-server');
const { SqlTranslator } = require('./sql-translator');
const {
  HEADER_SIZE,
  TYPE,
  buildPacket,
  buildPreloginResponse,
  parseHeader,
  parseLogin7,
  PacketAssembler
} = require('./tds-packet');
const {
  TOKEN,
  DONE_STATUS,
  ENVCHANGE,
  databaseEnvChangeToken,
  doneToken,
  doneProcToken,
  doneInProcToken,
  colInfoToken,
  colMetadataToken,
  envChangeToken,
  errorToken,
  loginAckToken
} = require('./tds-tokens');
const { TDS_TYPE, columnMetadata, encodeRow } = require('./tds-types');

const LOGGER_SILENCIOSO = { info() {}, debug() {}, warn() {}, error() {} };

function conectar(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Dispara uma acao e devolve todos os bytes recebidos ate o timeout curto. */
function coletar(socket, acao, esperaMs = 80) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    const aoDado = (pedaco) => pedacos.push(pedaco);
    socket.on('data', aoDado);

    Promise.resolve().then(acao).catch((erro) => {
      socket.off('data', aoDado);
      reject(erro);
    });

    setTimeout(() => {
      socket.off('data', aoDado);
      resolve(Buffer.concat(pedacos));
    }, esperaMs);
  });
}

/** Ofusca a senha como o cliente TDS: troca nibbles e aplica XOR 0xA5. */
function ofuscarSenha(texto) {
  const bytes = Buffer.from(texto, 'utf16le');
  const saida = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    saida[i] = (((bytes[i] & 0x0F) << 4) | ((bytes[i] & 0xF0) >> 4)) ^ 0xA5;
  }
  return saida;
}

/** B_VARCHAR: 1 byte de contagem de caracteres + UTF-16LE. */
function bVarChar(texto) {
  const bytes = Buffer.from(texto, 'utf16le');
  const cabecalho = Buffer.alloc(1);
  cabecalho.writeUInt8(texto.length, 0);
  return Buffer.concat([cabecalho, bytes]);
}

/** US_VARCHAR: 2 bytes de contagem de caracteres + UTF-16LE. */
function usVarChar(texto) {
  const bytes = Buffer.from(texto, 'utf16le');
  const cabecalho = Buffer.alloc(2);
  cabecalho.writeUInt16LE(texto.length, 0);
  return Buffer.concat([cabecalho, bytes]);
}

/** Valor NVARCHAR de um parametro RPC. */
function valorNvarchar(texto) {
  const bytes = Buffer.from(texto, 'utf16le');
  const cabecalho = Buffer.alloc(10);
  cabecalho.writeUInt8(TDS_TYPE.NVARCHARTYPE, 0);
  cabecalho.writeUInt16LE(8000, 1);
  cabecalho.writeUInt16LE(bytes.length, 8);
  return Buffer.concat([cabecalho, bytes]);
}

/** Valor INT de um parametro RPC. */
function valorInt(valor) {
  const cabecalho = Buffer.alloc(2);
  cabecalho.writeUInt8(TDS_TYPE.INTNTYPE, 0);
  cabecalho.writeUInt8(4, 1);
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(valor, 0);
  return Buffer.concat([cabecalho, bytes]);
}

/** RPC sp_executesql com um parametro de texto e outro inteiro. */
function montarRpcSpExecuteSql() {
  return Buffer.concat([
    usVarChar('sp_executesql'),
    Buffer.from([0x00, 0x00]),
    bVarChar('@stmt'), Buffer.from([0x00]), valorNvarchar('SELECT @p1 AS valor'),
    bVarChar('@params'), Buffer.from([0x00]), valorNvarchar('@p1 INT'),
    bVarChar('@p1'), Buffer.from([0x00]), valorInt(42)
  ]);
}

/** Monta um LOGIN7 minimo mas valido para TDS 7.4. */
function montarLogin7({ usuario = 'sa', senha = 'Senha123!', servidor = 'cluster-local', database = '' } = {}) {
  const campos = [
    ['hostName', 'maquina-teste'],
    ['userName', usuario],
    ['password', senha],
    ['appName', 'teste-tds'],
    ['serverName', servidor],
    ['extension', ''],
    ['ctlibLibrary', ''],
    ['locale', ''],
    ['database', database]
  ];

  const cabecalho = Buffer.alloc(36);
  cabecalho.writeUInt32LE(0x74000004, 4); // TDS 7.4 (após o campo Length)
  cabecalho.writeUInt32LE(4096, 8);

  const tabela = Buffer.alloc(campos.length * 4);
  let deslocamento = cabecalho.length + tabela.length;
  const dados = [];

  campos.forEach(([nome, valor], indice) => {
    const bytes = nome === 'password' ? ofuscarSenha(valor) : Buffer.from(valor, 'utf16le');
    tabela.writeUInt16LE(deslocamento, indice * 4);
    tabela.writeUInt16LE(valor.length, indice * 4 + 2);
    dados.push(bytes);
    deslocamento += bytes.length;
  });

  dados.push(Buffer.from([0xFF])); // terminador do FeatureExt
  return Buffer.concat([cabecalho, tabela, ...dados]);
}

describe('tds-packet', () => {
  test('buildPacket gera cabecalho de 8 bytes com tamanho, SPID e EOM', () => {
    const pacote = buildPacket(TYPE.SQLBATCH, Buffer.from('AB'), { spid: 7, packetId: 3 });

    expect(pacote.length).toBe(10);
    const cabecalho = parseHeader(pacote);
    expect(cabecalho.type).toBe(TYPE.SQLBATCH);
    expect(cabecalho.end).toBe(true);
    expect(cabecalho.length).toBe(10);
    expect(cabecalho.spid).toBe(7);
    expect(cabecalho.packetId).toBe(3);
    expect(cabecalho.window).toBe(0);
    expect(pacote.subarray(HEADER_SIZE).toString()).toBe('AB');
    expect(buildPacket(TYPE.SQLBATCH, 'X', { end: false }).readUInt8(1)).toBe(0x00);
  });

  test('PacketAssembler reune chunks fragmentados e multi-pacote', () => {
    const montador = new PacketAssembler();
    const primeiro = buildPacket(TYPE.SQLBATCH, Buffer.from('abc'), { end: false });
    const ultimo = buildPacket(TYPE.SQLBATCH, Buffer.from('def'), { end: true });

    expect(montador.push(primeiro.subarray(0, 3))).toHaveLength(0);
    expect(montador.push(primeiro.subarray(3))).toHaveLength(0);

    const mensagens = montador.push(ultimo);
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].type).toBe(TYPE.SQLBATCH);
    expect(mensagens[0].payload.toString()).toBe('abcdef');
  });

  test('buildPreloginResponse offsets apontam para ENCRYPTION NOT_SUP', () => {
    const payload = buildPreloginResponse();
    const offsetCriptografia = payload.readUInt16BE(1 * 5 + 1);
    const tamanhoCriptografia = payload.readUInt16BE(1 * 5 + 3);

    expect(payload.readUInt8(5 * 5)).toBe(0xFF);
    expect(tamanhoCriptografia).toBe(1);
    expect(payload.readUInt8(offsetCriptografia)).toBe(0x02);
  });

  test('parseLogin7 extrai TDSVersion, packetSize e credenciais', () => {
    const login = parseLogin7(montarLogin7({ usuario: 'usr', senha: 'pwd', servidor: 'srv', database: 'db' }));

    expect(login).not.toBeNull();
    expect(login.tdsVersion).toBe(0x74000004);
    expect(login.tdsVersionLabel).toBe('7.4');
    expect(login.packetSize).toBe(4096);
    expect(login.userName).toBe('usr');
    expect(login.password).toBe('pwd');
    expect(login.serverName).toBe('srv');
    expect(login.database).toBe('db');
    expect(login.hasFeatureExtTerminator).toBe(true);
  });
});

describe('tds-tokens / tds-types', () => {
  test('ENVCHANGE de database grava novo antes do antigo em UTF-16LE', () => {
    const token = databaseEnvChangeToken('antigo', 'novo');

    expect(token.readUInt8(0)).toBe(TOKEN.ENVCHANGE);
    expect(token.readUInt16LE(1)).toBe(token.length - 3);

    const corpo = token.subarray(3);
    expect(corpo.readUInt8(0)).toBe(0x01); // DATABASE
    expect(corpo.readUInt8(1)).toBe(4);    // 4 caracteres em "novo"
    expect(corpo.toString('utf16le', 2, 10)).toBe('novo');
    expect(corpo.readUInt8(10)).toBe(6);   // 6 caracteres em "antigo"
    expect(corpo.toString('utf16le', 11, 23)).toBe('antigo');
  });

  test('LOGINACK e ERROR usam os bytes de token corretos', () => {
    expect(loginAckToken('LOCAL').readUInt8(0)).toBe(TOKEN.LOGINACK);
    expect(errorToken(18456, 1, 14, 'falha', 'LOCAL').readUInt8(0)).toBe(TOKEN.ERROR);
  });

  test('doneToken usa rowcount de 8 bytes e o status MORE', () => {
    const token = doneToken({ rowcount: 2, more: true });

    expect(token.readUInt8(0)).toBe(TOKEN.DONE);
    expect(token.readUInt16LE(1)).toBe(DONE_STATUS.COUNT | DONE_STATUS.MORE);
    expect(token.readBigUInt64LE(5)).toBe(2n);
  });

  test('doneProc, doneInProc e rowcount inválido são codificados com segurança', () => {
    expect(doneProcToken({ rowcount: 3 }).readUInt8(0)).toBe(TOKEN.DONEPROC);
    expect(doneInProcToken({ rowcount: 2 }).readUInt8(0)).toBe(TOKEN.DONEINPROC);
    expect(doneToken({ rowcount: {} }).readBigUInt64LE(5)).toBe(0n);
  });

  test('ENVCHANGE binário e COLINFO cobrem os codificadores auxiliares', () => {
    const packetSize = envChangeToken(ENVCHANGE.PACKET_SIZE, 4096, 8192, { encoding: 'utf8' });
    expect(packetSize.readUInt8(0)).toBe(TOKEN.ENVCHANGE);
    expect(packetSize.readUInt8(3)).toBe(ENVCHANGE.PACKET_SIZE);

    const colInfo = colInfoToken([{ name: 'a' }, { name: 'b' }]);
    expect(colInfo.readUInt8(0)).toBe(0xA5); // ID fixo pela MS-TDS, não pela constante local
    expect(colInfo.readUInt8(0)).toBe(TOKEN.COLINFO);
    expect(colInfo.readUInt16LE(1)).toBe(6);
    expect(colInfo.readUInt8(5)).toBe(0x04);

    const metadata = colMetadataToken([
      { name: 'bit', type: TDS_TYPE.BITNTYPE, dataLength: 1 },
      { name: 'data', type: TDS_TYPE.DATETIMNTYPE, dataLength: 8 },
      { name: 'real', type: TDS_TYPE.FLTNTYPE, dataLength: 4 },
      { name: 'bin', type: TDS_TYPE.VARBINARYTYPE, maxLength: 100 },
      { name: 'outro', type: TDS_TYPE.NULL, dataLength: 4 }
    ]);
    expect(metadata.readUInt8(0)).toBe(0x81); // ID fixo pela MS-TDS, não pela constante local
    expect(metadata.readUInt8(0)).toBe(TOKEN.COLMETADATA);
    expect(metadata.readUInt16LE(1)).toBe(5);
    expect(metadata.includes(Buffer.from('bin', 'utf16le'))).toBe(true);
  });

  test('columnMetadata e encodeRow codificam INTN e NVARCHAR', () => {
    const colunas = [{ name: 'id', type: 'INTEGER' }, { name: 'nome', type: 'TEXT' }];
    const linhas = [{ id: 1, nome: 'Ana' }];
    const metadados = columnMetadata(colunas, linhas);

    expect(metadados[0].type).toBe(0x26);
    expect(metadados[1].type).toBe(0xE7);

    const token = encodeRow(linhas, colunas);
    expect(token.readUInt8(0)).toBe(TOKEN.ROW);
    expect(token.readUInt8(1)).toBe(4);
    expect(token.readInt32LE(2)).toBe(1);
    expect(token.readUInt16LE(6)).toBe(6);
    expect(token.toString('utf16le', 8, 14)).toBe('Ana');
  });
});

describe('TdsServer', () => {
  let servidor;
  let porta;
  let sockets;
  let clusterManager;
  let dbEngine;

  const cluster = {
    DBClusterIdentifier: 'cluster-local',
    DatabaseName: 'testdb',
    Port: 1433
  };

  beforeAll(async () => {
    clusterManager = {
      verifyCredentials: jest.fn((usuario, senha) => (
        usuario === 'sa' && senha === 'Senha123!' ? cluster : null
      ))
    };
    dbEngine = {
      execute: jest.fn((database, sql) => {
        if (/^\s*select/i.test(sql)) {
          return {
            type: 'select',
            columns: [{ name: 'valor', type: 'INTEGER' }],
            rows: [{ valor: 1 }],
            changes: 0
          };
        }
        return { type: 'ddl', columns: [], rows: [], changes: 1 };
      })
    };

    servidor = new TdsServer({
      port: 0,
      host: '127.0.0.1',
      clusterManager,
      dbEngine,
      logger: LOGGER_SILENCIOSO
    });
    porta = await servidor.start();
  });

  beforeEach(() => {
    sockets = [];
    clusterManager.verifyCredentials.mockClear();
    dbEngine.execute.mockClear();
  });

  afterEach(() => {
    for (const socket of sockets) {
      socket.destroy();
    }
  });

  afterAll(async () => {
    await servidor.stop();
  });

  function conectarNoServidor() {
    return conectar(porta).then((socket) => {
      sockets.push(socket);
      return socket;
    });
  }

  async function autenticar(socket) {
    return coletar(socket, () => {
      socket.write(buildPacket(TYPE.LOGIN7, montarLogin7()));
    });
  }

  test('start/getStatus/stop informam o estado do servidor', () => {
    const status = servidor.getStatus();
    expect(status.running).toBe(true);
    expect(status.port).toBe(porta);
    expect(status.host).toBe('127.0.0.1');
  });

  test('start é idempotente e closeSessions libera conexões ativas', async () => {
    await expect(servidor.start()).resolves.toBe(porta);

    const socket = await conectarNoServidor();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(servidor.getStatus().connections).toBe(1);

    const fechado = new Promise((resolve) => socket.once('close', resolve));
    servidor.closeSessions();
    expect(servidor.getStatus().connections).toBe(0);
    await fechado;
  });

  test('pacote SSPI devolve erro de autenticação integrada', async () => {
    const socket = await conectarNoServidor();
    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SSPI, Buffer.from([0x01])));
    });

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.includes(TOKEN.ERROR)).toBe(true);
    expect(resposta.includes(Buffer.from('autenticacao SQL Server', 'utf16le'))).toBe(true);
  });

  test('LOGIN7 incompleto e falha interna nas credenciais devolvem ERROR', async () => {
    const incompleto = await conectarNoServidor();
    const fechado = new Promise((resolve) => incompleto.once('close', resolve));
    const resposta = await coletar(incompleto, () => {
      incompleto.write(buildPacket(TYPE.LOGIN7, Buffer.alloc(8)));
    });

    expect(resposta.subarray(HEADER_SIZE).includes(TOKEN.ERROR)).toBe(true);
    await fechado;

    clusterManager.verifyCredentials.mockImplementationOnce(() => {
      throw new Error('KMS indisponível');
    });
    const socket = await conectarNoServidor();
    const erro = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.LOGIN7, montarLogin7()));
    });
    expect(erro.subarray(HEADER_SIZE).includes(TOKEN.ERROR)).toBe(true);
  });

  test('PRELOGIN responde com pacote 0x04, EOM e ENCRYPTION NOT_SUP', async () => {
    const socket = await conectarNoServidor();
    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.PRELOGIN, buildPreloginResponse()));
    });

    const cabecalho = parseHeader(resposta);
    expect(cabecalho.type).toBe(TYPE.TABULAR);
    expect(cabecalho.end).toBe(true);
    expect(cabecalho.length).toBe(resposta.length);

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.readUInt8(payload.readUInt16BE(6))).toBe(0x02);
  });

  test('LOGIN7 valido envia ENVCHANGE, LOGINACK, INFO e DONE', async () => {
    const socket = await conectarNoServidor();
    const resposta = await autenticar(socket);

    expect(resposta.readUInt8(0)).toBe(TYPE.TABULAR);
    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.includes(TOKEN.ENVCHANGE)).toBe(true);
    expect(payload.includes(TOKEN.LOGINACK)).toBe(true);
    expect(payload.includes(TOKEN.INFO)).toBe(true);
    expect(payload.includes(TOKEN.DONE)).toBe(true);
    expect(clusterManager.verifyCredentials).toHaveBeenCalledWith('sa', 'Senha123!', 'cluster-local');
  });

  test('LOGIN7 invalido envia ERROR e DONE e encerra a conexao', async () => {
    const socket = await conectarNoServidor();
    const fechado = new Promise((resolve) => socket.once('close', resolve));

    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.LOGIN7, montarLogin7({ usuario: 'errado' })));
    });

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.includes(TOKEN.ERROR)).toBe(true);
    expect(payload.includes(TOKEN.DONE)).toBe(true);
    await fechado;
  });

  test('SQL Batch SELECT 1 devolve COLMETADATA, ROW e DONE', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.from('SELECT 1', 'utf16le')));
    });

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.readUInt8(0)).toBe(0x81);
    expect(payload.includes(TOKEN.COLMETADATA)).toBe(true);
    expect(payload.includes(TOKEN.ROW)).toBe(true);
    expect(payload.includes(TOKEN.DONE)).toBe(true);
    expect(dbEngine.execute).toHaveBeenCalledWith('testdb', 'SELECT 1', []);
  });

  test('SQL Batch aceita IF EXISTS de inicialização do SSMS', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const tradutor = new SqlTranslator('sqlserver-se');
    let sqlTraduzido;
    dbEngine.execute.mockImplementationOnce((database, sql) => {
      sqlTraduzido = tradutor.translate(sql);
      return {
        type: 'select',
        columns: [{ name: 'ok', type: 'INTEGER' }],
        rows: [{ ok: 7 }],
        changes: 0
      };
    });

    const sql = "IF EXISTS (SELECT 1 FROM sys.databases WHERE name = 'master') SELECT 7 AS ok";
    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.from(sql, 'utf16le')));
    });

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.includes(TOKEN.ERROR)).toBe(false);
    expect(payload.includes(TOKEN.COLMETADATA)).toBe(true);
    expect(sqlTraduzido).toBe('SELECT 7 AS ok');
  });

  test('SQL Batch aceita o batch de descoberta de servidor do SSMS', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const tradutor = new SqlTranslator('sqlserver-se');
    let sqlTraduzido;
    dbEngine.execute.mockImplementationOnce((database, sql) => {
      sqlTraduzido = tradutor.translate(sql);
      return {
        type: 'select',
        columns: [{ name: 'Server_Name', type: 'NVARCHAR' }],
        rows: [{ Server_Name: 'LOCAL' }],
        changes: 0
      };
    });

    const sql = 'CREATE TABLE #SVer(ID int, Name sysname); INSERT #SVer EXEC master.dbo.xp_msver; ' +
      "SELECT CAST(serverproperty(N'Servername') AS sysname) AS [Server_Name]; DROP TABLE #SVer";
    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.from(sql, 'utf16le')));
    });

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.includes(TOKEN.ERROR)).toBe(false);
    expect(payload.includes(TOKEN.COLMETADATA)).toBe(true);
    expect(sqlTraduzido).toContain("'LOCAL' AS [Server_Name]");
  });

  test('SQL Batch ignora o bloco All Headers enviado por sqlcmd/ODBC', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const sql = 'SET QUOTED_IDENTIFIER OFF';
    const cabecalho = Buffer.alloc(22);
    cabecalho.writeUInt32LE(cabecalho.length, 0);

    await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.concat([
        cabecalho,
        Buffer.from(sql, 'utf16le')
      ])));
    });

    expect(dbEngine.execute).toHaveBeenCalledWith('testdb', sql, []);
  });

  test('SQL Batch vazio devolve DONE sem DONE_COUNT (compatibilidade ODBC)', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.alloc(0)));
    });

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.readUInt8(0)).toBe(TOKEN.DONE);
    expect(payload.readUInt16LE(1)).toBe(0);
    expect(dbEngine.execute).not.toHaveBeenCalled();
  });

  test('USE troca o database da sessao e emite ENVCHANGE', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const troca = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.from('USE outrodb', 'utf16le')));
    });
    expect(troca.subarray(HEADER_SIZE).includes(TOKEN.ENVCHANGE)).toBe(true);

    await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.from('SELECT 2', 'utf16le')));
    });
    expect(dbEngine.execute).toHaveBeenCalledWith('outrodb', 'SELECT 2', []);
  });

  test('GO separa multiplos lotes em um unico SQL Batch', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    await coletar(socket, () => {
      const sql = 'SELECT 1\nGO\nSELECT 2';
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.from(sql, 'utf16le')));
    });

    expect(dbEngine.execute).toHaveBeenCalledTimes(2);
  });

  test('erro do DbEngine vira ERROR + DONE na sessão TDS', async () => {
    dbEngine.execute.mockImplementationOnce(() => {
      throw new Error('tabela inexistente');
    });
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.from('SELECT * FROM tabela', 'utf16le')));
    });

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.includes(TOKEN.ERROR)).toBe(true);
    expect(payload.includes(TOKEN.DONE)).toBe(true);
    expect(resposta.includes(Buffer.from('tabela inexistente', 'utf16le'))).toBe(true);
  });

  test('lote sem comandos devolve apenas DONE', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.from('   ', 'utf16le')));
    });

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.includes(TOKEN.DONE)).toBe(true);
    expect(payload.includes(TOKEN.COLMETADATA)).toBe(false);
    expect(dbEngine.execute).not.toHaveBeenCalled();
  });

  test('resposta grande é fragmentada em múltiplos pacotes TDS', async () => {
    dbEngine.execute.mockImplementationOnce(() => ({
      type: 'select',
      columns: [{ name: 'txt', type: 'TEXT' }],
      rows: Array.from({ length: 120 }, (_, indice) => ({ txt: 'x'.repeat(120) + indice })),
      changes: 0
    }));
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.SQLBATCH, Buffer.from('SELECT txt FROM t', 'utf16le')));
    });

    const cabecalhos = [];
    let deslocamento = 0;
    while (deslocamento + HEADER_SIZE <= resposta.length) {
      const cabecalho = parseHeader(resposta.subarray(deslocamento));
      cabecalhos.push(cabecalho);
      deslocamento += cabecalho.length;
    }

    expect(cabecalhos.length).toBeGreaterThan(1);
    expect(cabecalhos[0].end).toBe(false);
    expect(cabecalhos[cabecalhos.length - 1].end).toBe(true);
    expect(deslocamento).toBe(resposta.length);
  });

  test('RPC sp_executesql executa SQL com parâmetros posicionais', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.RPC, montarRpcSpExecuteSql()));
    });

    expect(resposta.subarray(HEADER_SIZE).includes(TOKEN.COLMETADATA)).toBe(true);
    expect(dbEngine.execute).toHaveBeenCalledWith('testdb', 'SELECT @p1 AS valor', [42]);
  });

  test('RPC desconhecido devolve ERROR explicando para usar SQL Batch', async () => {
    const socket = await conectarNoServidor();
    await autenticar(socket);

    const nome = 'sp_ajuda';
    const cabecalho = Buffer.alloc(2);
    cabecalho.writeUInt16LE(nome.length, 0);
    const payloadRpc = Buffer.concat([cabecalho, Buffer.from(nome, 'utf16le'), Buffer.from([0x00, 0x00])]);

    const resposta = await coletar(socket, () => {
      socket.write(buildPacket(TYPE.RPC, payloadRpc));
    });

    const payload = resposta.subarray(HEADER_SIZE);
    expect(payload.includes(TOKEN.ERROR)).toBe(true);
    expect(resposta.includes(Buffer.from('use SQL Batch', 'utf16le'))).toBe(true);
  });
});
