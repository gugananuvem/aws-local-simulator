/**
 * ListFunctions (GET /2015-03-31/functions): conversão do registro interno para
 * FunctionConfiguration e paginação por Marker/MaxItems.
 */

const DEFAULT_MAX_ITEMS = 50;
const MAX_ITEMS_LIMIT = 10000;

function invalidMaxItems(value) {
  const err = new Error(`MaxItems must be an integer between 1 and ${MAX_ITEMS_LIMIT}, got ${value}`);
  err.statusCode = 400;
  return err;
}

function toFunctionConfiguration(entry) {
  const config = {
    FunctionName: entry.name,
    FunctionArn: `arn:aws:lambda:local:000000000000:function:${entry.name}`,
    Runtime: entry.runtime,
    Handler: entry.handlerName,
    CodeSize: entry.codeSize,
    Timeout: entry.timeout,
    MemorySize: entry.memorySize,
    LastModified: entry.registeredAt,
    Version: '$LATEST',
  };
  for (const key of Object.keys(config)) {
    if (config[key] === undefined || config[key] === null) delete config[key];
  }
  return config;
}

function parseMaxItems(maxItems) {
  if (maxItems === undefined) return DEFAULT_MAX_ITEMS;
  const value = typeof maxItems === 'string' && /^\d+$/.test(maxItems) ? Number(maxItems) : maxItems;
  if (!Number.isInteger(value) || value < 1 || value > MAX_ITEMS_LIMIT) {
    throw invalidMaxItems(maxItems);
  }
  return value;
}

/**
 * configs deve vir ordenado por FunctionName. A página traz os nomes maiores
 * que Marker; NextMarker aparece só quando sobra item depois da página.
 */
function paginateFunctions(configs, { MaxItems, Marker } = {}) {
  const limit = parseMaxItems(MaxItems);
  const start = Marker === undefined ? 0 : configs.findIndex((c) => c.FunctionName > Marker);
  const remaining = start < 0 ? [] : configs.slice(start);
  const page = remaining.slice(0, limit);
  const result = { Functions: page };
  if (remaining.length > limit) {
    result.NextMarker = page[page.length - 1].FunctionName;
  }
  return result;
}

module.exports = { toFunctionConfiguration, paginateFunctions };
