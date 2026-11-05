/**
 * Utilitários para o AWS Query Protocol (chaves pontuadas).
 *
 * O `body-parser` (express.urlencoded) não habilita `allowDots` no qs, então
 * recebemos chaves planas como `Filter.1.Name` / `Targets.member.1.Id`.
 * Este módulo reconstrói a estrutura aninhada/em lista que os handlers esperam.
 */

/**
 * Converte um objeto plano de parâmetros em estrutura aninhada, tratando
 * índices numéricos como arrays (e compactando buracos deixados por índices 1-based).
 *
 * @param {Record<string, any>} flat
 * @returns {Record<string, any>}
 */
function parseAwsQuery(flat) {
  if (!flat || typeof flat !== 'object' || Array.isArray(flat)) {
    return flat;
  }

  for (const key of Object.keys(flat)) {
    if (typeof key !== 'string' || !key.includes('.')) {
      continue;
    }

    // Remove a chave plana; ela será reconstruída abaixo.
    const value = flat[key];
    delete flat[key];
    assignPath(flat, key.split('.'), value);
  }

  return compactArrays(flat);
}

function assignPath(root, parts, value) {
  let node = root;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    const nextIsIndex = !isLast && /^\d+$/.test(parts[i + 1]);

    if (isLast) {
      assignLeaf(node, part, value);
      return;
    }

    if (node[part] === undefined || node[part] === null) {
      node[part] = nextIsIndex ? [] : {};
    } else if (Array.isArray(node[part]) && !nextIsIndex) {
      // Já é um array mas agora precisa ser objeto: usa o último elemento.
      const lastIndex = node[part].length - 1;
      node[part][lastIndex] = node[part][lastIndex] || {};
      node = node[part][lastIndex];
      continue;
    } else if (!Array.isArray(node[part]) && typeof node[part] !== 'object') {
      node[part] = nextIsIndex ? [] : {};
    }

    node = node[part];
  }
}

function assignLeaf(node, key, value) {
  if (Object.prototype.hasOwnProperty.call(node, key)) {
    const existing = node[key];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      node[key] = [existing, value];
    }
  } else {
    node[key] = value;
  }
}

/**
 * Remove "buracos" de arrays (índices não preenchidos) recursivamente.
 */
function compactArrays(value) {
  if (Array.isArray(value)) {
    return value.filter(() => true).map(compactArrays);
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] = compactArrays(value[key]);
    }
  }

  return value;
}

/**
 * Extrai uma lista de um container no formato `{ member: [...] }` ou `{ Key: [...] }`.
 */
function toList(container) {
  if (container === undefined || container === null) {
    return [];
  }

  const member = container.member !== undefined ? container.member : container;
  if (Array.isArray(member)) {
    return member;
  }
  if (member && typeof member === 'object') {
    return Object.values(member);
  }
  return [member];
}

module.exports = { parseAwsQuery, toList };
