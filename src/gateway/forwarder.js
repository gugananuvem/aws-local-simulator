/**
 * Encaminhamento streaming de uma requisicao HTTP para um servico interno (127.0.0.1).
 *
 * - O caminho (req.url) e os headers, inclusive Host, seguem sem alteracao: a assinatura
 *   SigV4 depende deles. So os headers hop-by-hop sao removidos.
 * - Status, headers de resposta e corpo passam em streaming, sem buffer.
 * - Erro de conexao com o servico interno: 503 no formato de erro do gateway.
 */

const http = require('http');

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
]);

const UPSTREAM_HOST = '127.0.0.1';

function sendJsonError(res, status, code, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify({ __type: code, message });
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'x-amzn-errortype': code,
  });
  res.end(body);
}

function requestHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/** rawHeaders (nome, valor, nome, valor...) sem os hop-by-hop. */
function responseRawHeaders(rawHeaders) {
  const out = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (!HOP_BY_HOP.has(String(rawHeaders[i]).toLowerCase())) {
      out.push(rawHeaders[i], rawHeaders[i + 1]);
    }
  }
  return out;
}

/**
 * Encaminha uma requisicao HTTP.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{ port: number, agent?: http.Agent, body?: Buffer }} options
 *        `body`: corpo ja lido (quando o gateway precisou ler). Sem ele, o corpo e transmitido.
 */
function forwardHttp(req, res, { port, agent, body }) {
  const upstream = http.request({
    host: UPSTREAM_HOST,
    port,
    method: req.method,
    path: req.url,
    headers: requestHeaders(req.headers),
    agent,
  });

  upstream.on('response', (upstreamRes) => {
    const headers = responseRawHeaders(upstreamRes.rawHeaders);
    const hasAllowOrigin = headers.some((name, index) => (
      index % 2 === 0 && String(name).toLowerCase() === 'access-control-allow-origin'
    ));
    if (!hasAllowOrigin) headers.push('Access-Control-Allow-Origin', '*');
    res.writeHead(upstreamRes.statusCode, headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', () => {
    sendJsonError(res, 503, 'ServiceUnavailable', 'The requested service is not available.');
  });

  req.on('aborted', () => upstream.destroy());

  if (body !== undefined) {
    upstream.end(body);
  } else {
    req.pipe(upstream);
  }
}

/**
 * Encaminha um upgrade (WebSocket ou similar) e faz o pipe dos dois sockets.
 * Nenhum servico registrado usa upgrade hoje; o caminho existe para manter o contrato.
 */
function forwardUpgrade(req, socket, head, { port }) {
  // Upgrade precisa de Connection/Upgrade no pedido: nao remove os hop-by-hop aqui.
  const upstream = http.request({
    host: UPSTREAM_HOST,
    port,
    method: req.method,
    path: req.url,
    headers: { ...req.headers },
  });

  upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    let response = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
    for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
      response += `${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}\r\n`;
    }
    socket.write(response + '\r\n');
    if (upstreamHead && upstreamHead.length) socket.write(upstreamHead);
    if (head && head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });

  upstream.on('response', (upstreamRes) => {
    // Servico nao aceitou o upgrade: devolve a resposta normal e fecha.
    let response = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
    for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
      response += `${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}\r\n`;
    }
    socket.end(response + '\r\n');
    upstreamRes.destroy();
  });

  upstream.on('error', () => {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
  });

  upstream.end();
}

module.exports = { forwardHttp, forwardUpgrade, sendJsonError, HOP_BY_HOP };
