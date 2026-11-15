/**
 * Base de URL publica usada nas respostas do simulador (QueueUrl, presigned URLs, etc.).
 *
 * Ordem:
 *   1. AWS_ENDPOINT_URL (gateway.endpointUrl), quando definido.
 *   2. Host pelo qual a requisicao chegou, quando ha requisicao no contexto.
 *   3. http://localhost:<porta do gateway>, quando nao ha requisicao (ex.: geracao fora de uma
 *      requisicao HTTP).
 */

let gatewayConfig = { port: 4700, endpointUrl: null };

/** Registra a configuracao do gateway (chamado pelo Server na inicializacao). */
function configurePublicBase(gateway) {
  gatewayConfig = { port: 4700, endpointUrl: null, ...(gateway || {}) };
}

/**
 * @param {object} [req] requisicao HTTP (Express ou http nativo), quando existe
 * @returns {string} base sem barra final, ex.: "http://localhost:4700"
 */
function publicBaseUrl(req) {
  if (gatewayConfig.endpointUrl) return gatewayConfig.endpointUrl.replace(/\/+$/, '');
  const host = req?.headers?.host;
  if (host) return `http://${host}`;
  return `http://localhost:${gatewayConfig.port}`;
}

module.exports = { publicBaseUrl, configurePublicBase };
