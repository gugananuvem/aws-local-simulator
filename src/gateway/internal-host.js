/**
 * Interface de escuta dos servicos internos.
 *
 * Com o gateway (padrao), os servicos so aceitam conexoes locais (127.0.0.1); o acesso externo
 * passa pela porta unica. Com legacyPorts ligado, cada servico volta a escutar em todas as
 * interfaces (0.0.0.0), como antes.
 *
 * O valor e definido uma vez pelo Server na inicializacao (configureInternalHost), porque
 * todos os servicos compartilham a mesma configuracao do processo.
 */

let internalHost = '127.0.0.1';

/** @param {object} config configuracao carregada (usa config.gateway.legacyPorts) */
function configureInternalHost(config) {
  internalHost = config?.gateway?.legacyPorts ? '0.0.0.0' : '127.0.0.1';
  return internalHost;
}

function getInternalHost() {
  return internalHost;
}

module.exports = { configureInternalHost, getInternalHost };
