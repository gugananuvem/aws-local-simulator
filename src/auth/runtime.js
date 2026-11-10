/**
 * Referência global ao AuthContext do simulador.
 *
 * Os serviços chamam attachAuthGuard() ao criar o app HTTP, antes de o servidor existir.
 * Este módulo guarda o contexto criado pelo Server, para que cada serviço leia a
 * configuração na hora da requisição sem receber dependências por injeção.
 */

let current = null;

function setAuthContext(context) {
  current = context;
}

function getAuthContext() {
  return current;
}

module.exports = { setAuthContext, getAuthContext };
