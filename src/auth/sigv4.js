/**
 * Verificação de assinatura AWS Signature Version 4 no cabeçalho Authorization.
 *
 * Não verifica presigned URLs (assinatura na query string): essas requisições são recusadas
 * quando a autenticação está ligada.
 */

const crypto = require("crypto");

const ALGORITHM = "AWS4-HMAC-SHA256";
const MAX_SKEW_MS = 15 * 60 * 1000;

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** URI-encoding estrito da AWS (RFC 3986): também codifica !'()* */
function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function parseAuthorization(header) {
  if (typeof header !== "string" || !header.startsWith(ALGORITHM + " ")) return null;

  const fields = {};
  for (const piece of header.slice(ALGORITHM.length + 1).split(",")) {
    const i = piece.indexOf("=");
    if (i === -1) continue;
    fields[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  if (!fields.Credential || !fields.SignedHeaders || !fields.Signature) return null;

  const [accessKeyId, date, region, service, terminator] = fields.Credential.split("/");
  if (!accessKeyId || !date || !region || !service || terminator !== "aws4_request") return null;

  return {
    accessKeyId,
    date,
    region,
    service,
    signedHeaders: fields.SignedHeaders.split(";").map((h) => h.trim().toLowerCase()),
    signature: fields.Signature.toLowerCase(),
  };
}

function parseAmzDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(value || ""));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/**
 * Caminho canônico. O S3 usa o caminho como foi enviado; os demais serviços codificam de novo
 * cada segmento, como o SDK faz.
 */
function canonicalUri(rawPath, service) {
  if (!rawPath) return "/";
  if (service === "s3") return rawPath;
  return rawPath.split("/").map((seg) => encodeRfc3986(safeDecode(seg))).join("/");
}

function canonicalQuery(rawQuery) {
  if (!rawQuery) return "";
  const pairs = rawQuery
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      const key = i === -1 ? pair : pair.slice(0, i);
      const value = i === -1 ? "" : pair.slice(i + 1);
      return [encodeRfc3986(safeDecode(key)), encodeRfc3986(safeDecode(value))];
    });
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function canonicalHeaders(headers, signedHeaders) {
  return signedHeaders
    .map((name) => {
      const raw = headers[name];
      const value = Array.isArray(raw) ? raw.join(",") : raw ?? "";
      return `${name}:${String(value).trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");
}

/**
 * Verifica a assinatura de uma requisição.
 * @returns {{ ok: true, accessKeyId: string } | { ok: false, code: string }}
 */
function verifySignature({ method, rawPath, rawQuery, headers, body, authorization, secretAccessKey, now = Date.now() }) {
  const parsed = parseAuthorization(authorization);
  if (!parsed) return { ok: false, code: "IncompleteSignature" };

  const amzDate = headers["x-amz-date"];
  const requestTime = parseAmzDate(amzDate);
  if (requestTime === null) return { ok: false, code: "IncompleteSignature" };
  if (Math.abs(now - requestTime) > MAX_SKEW_MS) return { ok: false, code: "RequestTimeTooSkewed" };

  const payloadHash = headers["x-amz-content-sha256"] || sha256Hex(body || Buffer.alloc(0));

  const canonicalRequest = [
    method,
    canonicalUri(rawPath, parsed.service),
    canonicalQuery(rawQuery),
    canonicalHeaders(headers, parsed.signedHeaders),
    parsed.signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  const scope = `${parsed.date}/${parsed.region}/${parsed.service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac("AWS4" + secretAccessKey, parsed.date);
  const kRegion = hmac(kDate, parsed.region);
  const kService = hmac(kRegion, parsed.service);
  const kSigning = hmac(kService, "aws4_request");
  const expected = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(parsed.signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, code: "SignatureDoesNotMatch" };

  return { ok: true, accessKeyId: parsed.accessKeyId };
}


const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const MAX_PRESIGN_EXPIRES = 604800; // 7 dias, limite da AWS

function queryParts(rawQuery) {
  return (rawQuery || "").split("&").filter(Boolean);
}

function queryValue(parts, name) {
  for (const part of parts) {
    const i = part.indexOf("=");
    const key = i === -1 ? part : part.slice(0, i);
    if (safeDecode(key) === name) return safeDecode(i === -1 ? "" : part.slice(i + 1));
  }
  return null;
}

function deriveSigningKey(secretAccessKey, date, region, service) {
  const kDate = hmac("AWS4" + secretAccessKey, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Verifica uma URL pré-assinada (SigV4 na query string). O payload é UNSIGNED-PAYLOAD e o
 * método HTTP entra no canonical request, então a URL só vale para o método assinado.
 * @returns {{ ok: true, accessKeyId: string } | { ok: false, code: string, message?: string }}
 */
function verifyPresignedSignature({ method, rawPath, rawQuery, headers, secretAccessKey, now = Date.now() }) {
  const parts = queryParts(rawQuery);
  const algorithm = queryValue(parts, "X-Amz-Algorithm");
  const credential = queryValue(parts, "X-Amz-Credential");
  const amzDate = queryValue(parts, "X-Amz-Date");
  const expires = parseInt(queryValue(parts, "X-Amz-Expires"), 10);
  const signedHeaders = queryValue(parts, "X-Amz-SignedHeaders");
  const signature = queryValue(parts, "X-Amz-Signature");

  if (algorithm !== ALGORITHM || !credential || !amzDate || !signedHeaders || !signature) {
    return { ok: false, code: "AuthorizationQueryParametersError" };
  }
  const scopeParts = credential.split("/");
  if (scopeParts.length !== 5 || scopeParts[4] !== "aws4_request") {
    return { ok: false, code: "AuthorizationQueryParametersError" };
  }
  const [accessKeyId, date, region, service] = scopeParts;
  if (!(expires > 0 && expires <= MAX_PRESIGN_EXPIRES)) {
    return { ok: false, code: "AuthorizationQueryParametersError" };
  }

  const requestTime = parseAmzDate(amzDate);
  if (requestTime === null) return { ok: false, code: "AuthorizationQueryParametersError" };
  if (now > requestTime + expires * 1000) {
    return { ok: false, code: "AccessDenied", message: "Request has expired" };
  }
  if (requestTime - now > MAX_SKEW_MS) return { ok: false, code: "RequestTimeTooSkewed" };

  const signedList = signedHeaders.split(";").map((h) => h.trim().toLowerCase());
  const canonicalQs = canonicalQuery(
    parts.filter((p) => safeDecode(p.split("=")[0]) !== "X-Amz-Signature").join("&")
  );

  const canonicalRequest = [
    method,
    canonicalUri(rawPath, service),
    canonicalQs,
    canonicalHeaders(headers, signedList),
    signedList.join(";"),
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const expected = hmac(deriveSigningKey(secretAccessKey, date, region, service), stringToSign).toString("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).toLowerCase());
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "SignatureDoesNotMatch" };
  }
  return { ok: true, accessKeyId };
}

module.exports = { verifySignature, verifyPresignedSignature, parseAuthorization, encodeRfc3986, queryParts, queryValue };
