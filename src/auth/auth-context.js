/**
 * Contexto de autenticação no modelo da AWS (ligado por `authentication.enabled`).
 *
 * - Identidades: a conta root (chave e segredo do config) e os usuários IAM (chaves ativas
 *   guardadas pelo serviço IAM).
 * - Autenticação: verifica a assinatura SigV4 com o segredo da chave.
 * - Autorização: root tem acesso total; usuário IAM usa o avaliador de políticas do IAM
 *   (políticas do usuário e dos grupos, com Deny explícito).
 */

const { verifySignature, parseAuthorization } = require("./sigv4");

const MESSAGES = {
  MissingAuthenticationToken: "Missing Authentication Token",
  IncompleteSignature: "The request signature does not conform to AWS standards.",
  InvalidClientTokenId: "The security token included in the request is invalid.",
  SignatureDoesNotMatch: "The request signature we calculated does not match the signature you provided.",
  RequestTimeTooSkewed: "The difference between the request time and the current time is too large.",
  AccessDenied: "Access Denied",
};

class AuthError extends Error {
  constructor(code, message) {
    super(message || MESSAGES[code] || code);
    this.code = code;
    this.status = 403;
  }
}

function pathOf(originalUrl) {
  const i = originalUrl.indexOf("?");
  return i === -1 ? originalUrl : originalUrl.slice(0, i);
}

function queryOf(originalUrl) {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i + 1);
}

class AuthContext {
  /**
   * @param {object} config            bloco `authentication` do config
   * @param {function} getIam          () => simulador do IAM (ou null)
   */
  constructor(config, getIam) {
    this.config = config || {};
    this.getIam = getIam || (() => null);
  }

  get enabled() {
    return this.config.enabled === true;
  }

  get rootAccountId() {
    return this.config.rootAccountId || "000000000000";
  }

  /** Procura o segredo e a identidade de uma chave de acesso. */
  _lookupKey(accessKeyId) {
    if (accessKeyId === this.config.rootAccessKeyId && this.config.rootSecretAccessKey) {
      return {
        secret: this.config.rootSecretAccessKey,
        principal: {
          type: "root",
          accountId: this.rootAccountId,
          accessKeyId,
          arn: `arn:aws:iam::${this.rootAccountId}:root`,
        },
      };
    }

    const iam = this.getIam();
    const record = iam?.accessKeys?.get(accessKeyId);
    if (!record || record.Status !== "Active") return null;

    return {
      secret: record.SecretAccessKey,
      principal: {
        type: "user",
        accountId: this.rootAccountId,
        accessKeyId,
        userName: record.UserName,
        arn: `arn:aws:iam::${this.rootAccountId}:user/${record.UserName}`,
      },
    };
  }

  /**
   * Autentica a requisição. Retorna o principal ou lança AuthError.
   * @param {object} req      requisição do Express (originalUrl, method, headers)
   * @param {Buffer} body     corpo bruto da requisição
   */
  authenticate(req, body) {
    const authorization = req.headers.authorization;
    if (!authorization) throw new AuthError("MissingAuthenticationToken");

    const parsed = parseAuthorization(authorization);
    if (!parsed) throw new AuthError("IncompleteSignature");

    const found = this._lookupKey(parsed.accessKeyId);
    if (!found) throw new AuthError("InvalidClientTokenId");

    const result = verifySignature({
      method: req.method,
      rawPath: pathOf(req.originalUrl),
      rawQuery: queryOf(req.originalUrl),
      headers: req.headers,
      body,
      authorization,
      secretAccessKey: found.secret,
    });
    if (!result.ok) throw new AuthError(result.code);

    return found.principal;
  }

  /**
   * Autoriza uma ação. Root sempre pode; usuário IAM depende das políticas.
   * `sts:GetCallerIdentity` é permitido a qualquer principal autenticado, como na AWS.
   */
  authorize(principal, { action, resource }) {
    if (principal.type === "root") return true;
    if (action === "sts:GetCallerIdentity") return true;

    const iam = this.getIam();
    if (!iam || typeof iam.evaluateAccess !== "function") return false;

    return iam.evaluateAccess({ accessKeyId: principal.accessKeyId, action, resource, context: {} }) === "Allow";
  }
}

/**
 * Descreve a ação e o recurso de uma requisição, por serviço, no formato do IAM.
 * @returns {{ action: string, resource: string, admin?: boolean }}
 */
function describeRequest(service, req) {
  if (req.path.startsWith("/__admin")) return { action: `${service}:Admin`, resource: "*", admin: true };

  switch (service) {
    case "dynamodb": {
      const target = String(req.headers["x-amz-target"] || "");
      const [prefix = "", operation = "Unknown"] = target.split(".");
      const family = prefix.startsWith("DynamoDBStreams") ? "dynamodbstreams" : "dynamodb";
      const table = req.body && typeof req.body === "object" ? req.body.TableName : undefined;
      return {
        action: `${family}:${operation}`,
        resource: table ? `arn:aws:dynamodb:us-east-1:000000000000:table/${table}` : "*",
      };
    }

    case "s3": {
      const parts = req.path.split("/").filter(Boolean);
      const bucket = parts[0];
      const key = parts.slice(1).join("/");
      if (!bucket) return { action: "s3:ListAllMyBuckets", resource: "*" };

      const hasKey = key.length > 0;
      const op = {
        GET: hasKey ? "GetObject" : "ListBucket",
        HEAD: hasKey ? "GetObject" : "ListBucket",
        PUT: hasKey ? "PutObject" : "CreateBucket",
        POST: "PutObject",
        DELETE: hasKey ? "DeleteObject" : "DeleteBucket",
      }[req.method] || "Unknown";
      return {
        action: `s3:${op}`,
        resource: hasKey ? `arn:aws:s3:::${bucket}/${key}` : `arn:aws:s3:::${bucket}`,
      };
    }

    case "iam":
    case "sts": {
      const action = (req.body && req.body.Action) || req.query.Action || "Unknown";
      return { action: `${service}:${action}`, resource: "*" };
    }

    default: {
      // Protocolo JSON (X-Amz-Target: Servico_Versao.Operacao) ou Query (campo Action).
      const target = String(req.headers["x-amz-target"] || "");
      if (target) {
        const operation = target.split(".").pop() || "Unknown";
        return { action: `${service}:${operation}`, resource: "*" };
      }
      const action = (req.body && req.body.Action) || (req.query && req.query.Action);
      if (action) return { action: `${service}:${action}`, resource: "*" };
      // REST (ex.: Lambda, API Gateway): sem operação no cabeçalho, usa o serviço inteiro.
      return { action: `${service}:*`, resource: "*" };
    }
  }
}

module.exports = { AuthContext, AuthError, describeRequest, pathOf, queryOf };
