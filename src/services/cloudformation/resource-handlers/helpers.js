"use strict";

/**
 * Helpers compartilhados pelos handlers de recursos CloudFormation.
 *
 * Contrato de um handler (ver index.js):
 *   {
 *     requires: ['s3', ...],            // chaves de `sims` necessárias
 *     inPlace: ['Tags', ...],           // propriedades que podem mudar sem substituição (no-op)
 *     async create(ctx)  -> { physicalId, ref?, attrs? }
 *     async update(ctx)  -> { physicalId?, ref?, attrs? }   // opcional
 *     async delete(ctx)
 *   }
 *   ctx = { logicalId, stackName, props, sims, env, physicalId?, previous?: { props, attrs } , attrs? }
 *   env = { region, account, partition }
 */

/** Simuladores costumam devolver `{ error: { code, message } }` em vez de lançar. */
function assertOk(result, fallbackMessage = "Operation failed") {
  if (result && result.error) {
    const err = new Error(result.error.message || fallbackMessage);
    err.code = result.error.code;
    throw err;
  }
  return result;
}

const arn = (env, service, resource, { region = true, account = true } = {}) =>
  `arn:${env.partition || "aws"}:${service}:${region ? env.region : ""}:${account ? env.account : ""}:${resource}`;

/** Converte lista de tags CFN [{Key,Value}] -> objeto. */
const tagsToObject = (tags = []) => Object.fromEntries((tags || []).map((t) => [t.Key, t.Value]));

/** Converte string "true"/"false" (comum em templates YAML/JSON) em booleano. */
const toBool = (v, def = false) => (v === undefined || v === null ? def : v === true || String(v).toLowerCase() === "true");

const toNumber = (v, def) => (v === undefined || v === null || v === "" ? def : Number(v));

/** Nome físico gerado quando o template não define um. */
const generateName = (stackName, logicalId, { lower = false, max = 255 } = {}) => {
  let name = `${stackName}-${logicalId}`;
  if (lower) name = name.toLowerCase();
  return name.slice(0, max);
};

module.exports = { assertOk, arn, tagsToObject, toBool, toNumber, generateName };
