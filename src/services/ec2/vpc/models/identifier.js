/**
 * Utilitários de geração de IDs de recursos de rede (VPC).
 *
 * Os recursos da AWS usam IDs no formato `<prefix>-<17 hex>`. Este helper
 * centraliza a geração desse sufixo para os novos recursos de VPC.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Gera um sufixo hexadecimal (padrão dos IDs de recursos AWS).
 * @param {number} length quantidade de caracteres
 */
function hexSuffix(length = 17) {
  return uuidv4().replace(/-/g, '').substring(0, length);
}

/**
 * Monta um ID de recurso no formato AWS: `<prefix>-<hex>`.
 * @param {string} prefix prefixo do recurso (ex.: 'eipalloc')
 * @param {number} length tamanho do sufixo hexadecimal
 */
function generateResourceId(prefix, length = 17) {
  return `${prefix}-${hexSuffix(length)}`;
}

module.exports = { hexSuffix, generateResourceId };
