/**
 * Servidor do ponto de entrada unico. Escuta uma porta, classifica cada requisicao com
 * route-classifier e encaminha para a porta interna do servico (forwarder).
 *
 * O corpo so e lido quando a classificacao depende de um formulario (ver needsFormBody),
 * com limite de 1 MiB. Acima disso, resposta 413.
 */

const http = require('http');
const querystring = require('querystring');
const { classify, needsFormBody } = require('./route-classifier');
const { forwardHttp, forwardUpgrade, sendJsonError } = require('./forwarder');
const logger = require('../utils/logger');

const MAX_FORM_BODY_BYTES = 1024 * 1024;
const CORS_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';

function sendPreflight(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Max-Age': '600',
    'Vary': 'Access-Control-Request-Headers',
  };
  const requestedHeaders = req.headers['access-control-request-headers'];
  if (requestedHeaders) {
    headers['Access-Control-Allow-Headers'] = requestedHeaders;
  }
  res.writeHead(204, headers);
  res.end();
}

/** Le o corpo ate o limite. Resolve { buffer } ou { tooLarge: true }. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? { tooLarge: true } : { buffer: Buffer.concat(chunks) }));
    req.on('error', reject);
  });
}

class GatewayServer {
  /**
   * @param {object} options
   * @param {number} options.port                    porta de escuta do gateway
   * @param {string} [options.host='0.0.0.0']        interface de escuta
   * @param {(name: string) => number|undefined} options.resolvePort   porta interna do servico
   * @param {{bucketExists?: Function, apiExists?: Function}} [options.lookup]
   */
  constructor({ port, host = '0.0.0.0', resolvePort, lookup = {} }) {
    this.port = port;
    this.host = host;
    this.resolvePort = resolvePort;
    this.lookup = lookup;
    this.agent = new http.Agent({ keepAlive: true });
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        logger.error('Gateway: erro ao encaminhar requisicao', error);
        sendJsonError(res, 500, 'InternalFailure', 'The gateway could not process the request.');
      });
    });
    this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', reject);
        logger.info(`🚪 Gateway rodando em http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server.listening) return resolve();
      this.server.close(() => resolve());
      this.agent.destroy();
    });
  }

  classifyRequest(req, form) {
    return classify({ method: req.method, url: req.url, headers: req.headers, form }, this.lookupFns());
  }

  lookupFns() {
    return {
      bucketExists: (name) => !!this.lookup.bucketExists?.(name),
      apiExists: (id) => !!this.lookup.apiExists?.(id),
    };
  }

  async handle(req, res) {
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      return sendPreflight(req, res);
    }

    let form;
    let body;
    if (needsFormBody(req)) {
      const read = await readBody(req, MAX_FORM_BODY_BYTES);
      if (read.tooLarge) {
        res.setHeader('Connection', 'close');
        req.resume();
        return sendJsonError(res, 413, 'RequestEntityTooLarge', 'Request body is larger than 1 MiB.');
      }
      body = read.buffer;
      form = querystring.parse(body.toString('utf8'));
    }

    const result = this.classifyRequest(req, form);
    if (result.error) {
      return sendJsonError(res, result.error.status, result.error.code, result.error.message);
    }

    const port = this.resolvePort(result.service);
    if (!port) {
      return sendJsonError(res, 503, 'ServiceUnavailable', `Service ${result.service} is not running.`);
    }
    return forwardHttp(req, res, { port, agent: this.agent, body });
  }

  handleUpgrade(req, socket, head) {
    const result = this.classifyRequest(req, undefined);
    const port = result.error ? undefined : this.resolvePort(result.service);
    if (!port) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    forwardUpgrade(req, socket, head, { port });
  }
}

module.exports = { GatewayServer, MAX_FORM_BODY_BYTES };
