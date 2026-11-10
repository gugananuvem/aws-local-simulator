/**
 * Shim CJS de `uuid` usado só pelo Jest.
 *
 * uuid@14 é ESM-only: o Node 24 carrega com require(esm), mas o Jest não. Os serviços usam
 * apenas `v4`, que aqui vem de crypto.randomUUID (o mesmo formato RFC 4122).
 */
const crypto = require('crypto');

module.exports = {
  v4: () => crypto.randomUUID(),
};
