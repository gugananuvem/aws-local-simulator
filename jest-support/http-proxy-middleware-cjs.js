/**
 * Shim de `http-proxy-middleware` usado só pelo Jest.
 *
 * A versão 4 é ESM-only e o Jest não carrega ESM com require. Os testes só precisam que o
 * módulo de instância do EC2 seja carregado; o proxy de verdade não é exercitado aqui.
 */
module.exports = {
  createProxyMiddleware: () => (req, res, next) => next(),
};
