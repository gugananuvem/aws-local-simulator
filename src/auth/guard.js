/**
 * Autenticação e autorização no modelo AWS, aplicadas a cada serviço HTTP.
 *
 * Com `authentication.enabled` desligado, nada é lido nem alterado (bypass). Ligado, cada
 * requisição precisa de assinatura SigV4 válida e de autorização, exceto OPTIONS, /health e
 * as rotas listadas em `exempt` (dados públicos, como o conteúdo de um CloudFront).
 * As rotas /__admin só aceitam a conta root.
 *
 * Como a assinatura depende dos bytes do corpo, o corpo é lido uma vez e entregue de novo
 * ao serviço por um IncomingMessage recriado. Assim os parsers de cada serviço continuam
 * funcionando sem mudanças.
 */

const http = require("http");
const querystring = require("querystring");
const { AuthError, describeRequest, pathOf, queryOf } = require("./auth-context");
const { getAuthContext } = require("./runtime");

const PUBLIC_PATHS = new Set(["/health", "/__admin/health"]);

function collectBody(req) {
  return new Promise((resolve, reject) => {
    if (req.readableEnded) return resolve(Buffer.alloc(0));
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Recria a requisição com o corpo já lido, pronta para os parsers do serviço. */
function replayRequest(req, raw) {
  const replay = new http.IncomingMessage(req.socket);
  replay.headers = req.headers;
  replay.rawHeaders = req.rawHeaders;
  replay.method = req.method;
  replay.url = req.url;
  replay.httpVersion = req.httpVersion;
  replay.httpVersionMajor = req.httpVersionMajor;
  replay.httpVersionMinor = req.httpVersionMinor;
  // complete = true evita que o Node trate o fim da leitura como requisição abortada, o que
  // derrubaria o socket da conexão original.
  replay.complete = true;
  if (raw.length) replay.push(raw);
  replay.push(null);
  return replay;
}

/** Visão da requisição usada pelo autorizador (path, query, corpo já interpretado). */
function buildView(req, raw) {
  const url = req.url || "/";
  const type = String(req.headers["content-type"] || "").toLowerCase();
  let body;
  if (raw.length && type.includes("json")) {
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      body = undefined;
    }
  } else if (raw.length && type.includes("x-www-form-urlencoded")) {
    body = querystring.parse(raw.toString("utf8"));
  }
  return {
    method: req.method,
    headers: req.headers,
    path: pathOf(url),
    query: querystring.parse(queryOf(url)),
    body,
  };
}

/** Formato do erro: segue o protocolo que o cliente usou, quando dá para saber. */
function errorFormat(defaultFormat, view) {
  if (view.headers["x-amz-target"]) return "json";
  if (view.query.Action || (view.body && view.body.Action)) return "query";
  return defaultFormat;
}

function xmlEscape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sendError(res, format, code, message, status = 403) {
  const requestId = Date.now().toString(16);
  let contentType;
  let body;
  if (format === "query") {
    contentType = "text/xml";
    body = `<?xml version="1.0" encoding="UTF-8"?>\n<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error><RequestId>${requestId}</RequestId></ErrorResponse>`;
  } else if (format === "xml") {
    contentType = "application/xml";
    body = `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message><RequestId>${requestId}</RequestId></Error>`;
  } else {
    contentType = "application/json";
    body = JSON.stringify({ __type: code, message });
  }
  res.writeHead(status, { "Content-Type": contentType, "x-amzn-errortype": code });
  res.end(body);
}

/** Autentica e autoriza. Retorna o principal ou lança AuthError. */
function evaluate(auth, service, req, raw) {
  const view = buildView(req, raw);
  const principal = auth.authenticate({ method: req.method, headers: req.headers, originalUrl: req.url }, raw);

  const { action, resource, admin } = describeRequest(service, view, (name) => auth.bucketExists(name));
  if (admin) {
    if (principal.type !== "root") {
      throw new AuthError("AccessDenied", "Only the root account can use the administration API.");
    }
  } else if (!auth.authorize(principal, { action, resource })) {
    throw new AuthError("AccessDenied", `User: ${principal.arn} is not authorized to perform: ${action} on resource: ${resource}`);
  }
  return principal;
}

/**
 * Decide se a requisição passa. Retorna a requisição a usar (a original quando o bypass
 * está ativo, ou a recriada com o corpo) ou null quando a resposta de erro já foi enviada.
 */
async function admit(req, res, { service, format, exempt }) {
  const auth = getAuthContext();
  if (!auth || !auth.enabled) return req;
  if (req.method === "OPTIONS" || PUBLIC_PATHS.has(pathOf(req.url || "/"))) return req;
  if (exempt && exempt(req)) return req;

  let raw = Buffer.alloc(0);
  try {
    raw = await collectBody(req);
    const principal = evaluate(auth, service, req, raw);
    const replay = replayRequest(req, raw);
    replay.principal = principal;
    return replay;
  } catch (err) {
    const view = buildView(req, raw);
    sendError(res, errorFormat(format, view), err.code || "AccessDenied", err.message, err.status || 403);
    return null;
  }
}

/**
 * Protege um app Express. O guarda fica em app.handle, que é chamado antes de qualquer
 * middleware do app (inclusive os parsers de corpo). Com o bypass ativo, o app é chamado
 * sem nenhuma etapa adicional.
 *
 * @param {Function} app   app Express do serviço
 * @param {object}  options
 * @param {string}  options.service  nome IAM do serviço (ex.: "sqs", "secretsmanager")
 * @param {'json'|'query'|'xml'} [options.format='json']  formato do erro padrão
 * @param {(req) => boolean} [options.exempt]  rotas públicas do serviço
 */
function attachAuthGuard(app, { service, format = "json", exempt = null }) {
  const originalHandle = app.handle;
  app.handle = function authGuardHandle(req, res, callback) {
    const auth = getAuthContext();
    if (!auth || !auth.enabled) return originalHandle.call(this, req, res, callback);

    const self = this;
    admit(req, res, { service, format, exempt }).then((admitted) => {
      if (admitted) originalHandle.call(self, admitted, res, callback);
    });
  };
  return app;
}

/**
 * Versão para servidores HTTP sem Express. Retorna a requisição a usar, ou null quando
 * a resposta de erro já foi enviada. Com o bypass ativo, devolve a própria requisição.
 */
function authorizeRequest(req, res, options) {
  return admit(req, res, options);
}

module.exports = { attachAuthGuard, authorizeRequest };
