'use strict';

/**
 * Extrai o AccessKeyId da requisição (cabeçalho Authorization ou query params).
 * Usado apenas para identificar a chave; a verificação está em src/auth.
 */
function extractCredentials(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('AWS4-HMAC-SHA256')) {
    const credMatch = authHeader.match(/Credential=([A-Za-z0-9]+)\//);
    if (credMatch) return credMatch[1];
  }

  const xAmzCredential = req.query && req.query['X-Amz-Credential'];
  if (xAmzCredential) {
    const parts = xAmzCredential.split('/');
    if (parts.length > 0) return parts[0];
  }

  if (req.query && req.query['AWSAccessKeyId']) {
    return req.query['AWSAccessKeyId'];
  }

  return null;
}

/**
 * Antigo enforcement parcial do IAM (conferia só se a chave existia e não validava a assinatura).
 * Foi substituído pela autenticação no modelo AWS (src/auth, ligada por authentication.enabled).
 * Mantido como bypass para não alterar os serviços que ainda o instalam.
 *
 * @returns {function} middleware que apenas segue adiante
 */
function createIAMEnforcementMiddleware() {
  return (req, res, next) => next();
}

module.exports = { createIAMEnforcementMiddleware, extractCredentials };
