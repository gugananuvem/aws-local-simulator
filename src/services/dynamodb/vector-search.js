/**
 * DynamoDB Vector Search - índices vetoriais e SearchVectors (busca exata por força bruta)
 *
 * Definição persistida na tabela:
 *   table.vectorIndexes[IndexName] = {
 *     attribute, dimensions, distanceFunction, searchSchema: [{AttributeName, SearchSchemaElementType}],
 *     projection: {ProjectionType, NonKeyAttributes}, createdAt
 *   }
 */

const DISTANCE_FUNCTIONS = ['COSINE', 'EUCLIDEAN', 'DOT_PRODUCT'];
const INDEX_NAME_RE = /^[a-zA-Z0-9_.-]+$/;
const MAX_VECTOR_INDEXES = 20;

function awsError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const validation = (msg) => awsError('ValidationException', msg);

/** Valida e normaliza uma definição de VectorIndex (CreateTable / UpdateTable.Create). */
function buildVectorIndexDefinition(def, attributeTypes = {}) {
  const { IndexName, VectorAttribute, Dimensions, DistanceFunction, SearchSchema, Projection } = def || {};

  if (!IndexName || IndexName.length < 3 || IndexName.length > 255 || !INDEX_NAME_RE.test(IndexName)) {
    throw validation(`Invalid vector index name: ${IndexName}`);
  }
  if (!VectorAttribute?.AttributeName) {
    throw validation('VectorAttribute.AttributeName is required');
  }
  if (!Number.isInteger(Number(Dimensions)) || Number(Dimensions) < 1) {
    throw validation('Dimensions must be an integer greater than or equal to 1');
  }
  if (!DISTANCE_FUNCTIONS.includes(DistanceFunction)) {
    throw validation(`DistanceFunction must be one of ${DISTANCE_FUNCTIONS.join(', ')}`);
  }
  if (!Projection?.ProjectionType || !['KEYS_ONLY', 'INCLUDE', 'ALL'].includes(Projection.ProjectionType)) {
    throw validation('Projection.ProjectionType must be one of KEYS_ONLY, INCLUDE, ALL');
  }

  let searchSchema = [];
  if (SearchSchema !== undefined) {
    if (!Array.isArray(SearchSchema) || SearchSchema.length < 1) {
      throw validation('SearchSchema must contain at least one element');
    }
    let hashCount = 0;
    for (const el of SearchSchema) {
      if (!['HASH', 'INLINE_FILTER'].includes(el?.SearchSchemaElementType)) {
        throw validation('SearchSchemaElementType must be HASH or INLINE_FILTER');
      }
      if (!el.AttributeName || attributeTypes[el.AttributeName] === undefined) {
        throw validation(`SearchSchema attribute ${el.AttributeName} must be declared in AttributeDefinitions`);
      }
      if (el.SearchSchemaElementType === 'HASH') hashCount++;
    }
    if (hashCount > 1) throw validation('SearchSchema can have at most one HASH element');
    searchSchema = SearchSchema.map((e) => ({
      AttributeName: e.AttributeName,
      SearchSchemaElementType: e.SearchSchemaElementType,
    }));
  }

  return {
    attribute: VectorAttribute.AttributeName,
    dimensions: Number(Dimensions),
    distanceFunction: DistanceFunction,
    searchSchema,
    projection: {
      ProjectionType: Projection.ProjectionType,
      ...(Projection.NonKeyAttributes ? { NonKeyAttributes: [...Projection.NonKeyAttributes] } : {}),
    },
    createdAt: new Date().toISOString(),
  };
}

function buildVectorIndexes(list = [], attributeTypes = {}) {
  if (list.length > MAX_VECTOR_INDEXES) {
    throw awsError('LimitExceededException', `Too many vector indexes (max ${MAX_VECTOR_INDEXES})`);
  }
  const indexes = {};
  for (const def of list) {
    if (indexes[def.IndexName]) throw validation(`Duplicate vector index name: ${def.IndexName}`);
    indexes[def.IndexName] = buildVectorIndexDefinition(def, attributeTypes);
  }
  return indexes;
}

/** Formato de resposta do DescribeTable. */
function describeVectorIndexes(vectorIndexes = {}) {
  return Object.entries(vectorIndexes).map(([indexName, v]) => ({
    IndexName: indexName,
    IndexStatus: 'ACTIVE',
    Backfilling: false,
    VectorAttribute: { AttributeName: v.attribute },
    Dimensions: v.dimensions,
    DistanceFunction: v.distanceFunction,
    ...(v.searchSchema?.length ? { SearchSchema: v.searchSchema } : {}),
    Projection: v.projection,
  }));
}

/** Aplica VectorIndexUpdates (Create/Delete) em uma tabela. */
function applyVectorIndexUpdates(table, updates = [], attributeDefinitions = []) {
  table.vectorIndexes = table.vectorIndexes || {};
  const types = { ...table.attributeTypes };
  for (const a of attributeDefinitions) types[a.AttributeName] = a.AttributeType;

  for (const update of updates) {
    if (update.Create) {
      const def = update.Create;
      if (table.vectorIndexes[def.IndexName]) {
        throw awsError('ValidationException', `Vector index ${def.IndexName} already exists`);
      }
      if (Object.keys(table.vectorIndexes).length >= MAX_VECTOR_INDEXES) {
        throw awsError('LimitExceededException', `Too many vector indexes (max ${MAX_VECTOR_INDEXES})`);
      }
      table.vectorIndexes[def.IndexName] = buildVectorIndexDefinition(def, types);
    } else if (update.Delete) {
      const name = update.Delete.IndexName;
      if (!table.vectorIndexes[name]) {
        throw awsError('ResourceNotFoundException', `Vector index ${name} does not exist`);
      }
      delete table.vectorIndexes[name];
    } else {
      throw validation('VectorIndexUpdate must specify Create or Delete');
    }
  }
  table.attributeTypes = types;
}

// ---------------------------------------------------------------------------
// SearchVectors
// ---------------------------------------------------------------------------

function toNumberArray(value) {
  if (!Array.isArray(value)) return null;
  const out = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    let n = value[i];
    if (n && typeof n === 'object') n = n.N !== undefined ? n.N : NaN; // AttributeValue
    n = Number(n);
    if (!Number.isFinite(n)) return null;
    out[i] = Math.fround(n); // float32 IEEE-754
  }
  return out;
}

function score(fn, a, b) {
  let dot = 0, na = 0, nb = 0, sq = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
    const d = a[i] - b[i];
    sq += d * d;
  }
  if (fn === 'DOT_PRODUCT') return dot;
  if (fn === 'EUCLIDEAN') return Math.sqrt(sq);
  // COSINE: 1 - cos_sim (0..2)
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 1;
  return Math.min(2, Math.max(0, 1 - dot / denom));
}

/** Converte a SearchConditionExpression ("#a = :v AND b = :w") em [{attr, value}]. */
function parseSearchCondition(expression, names, values, normalize) {
  if (!expression) return [];
  return expression.split(/\s+AND\s+/i).map((part) => {
    const m = part.trim().match(/^\(?\s*([#\w.-]+)\s*=\s*(:[\w-]+)\s*\)?$/);
    if (!m) {
      throw validation(`Invalid SearchConditionExpression: only equality (=) conditions joined by AND are supported (${part.trim()})`);
    }
    const attr = m[1].startsWith('#') ? names[m[1]] : m[1];
    if (!attr) throw validation(`An expression attribute name used in the document path is not defined: ${m[1]}`);
    if (values[m[2]] === undefined) {
      throw validation(`An expression attribute value used in expression is not defined: ${m[2]}`);
    }
    return { attr, value: normalize(values[m[2]]) };
  });
}

/**
 * Executa a busca. `sim` é o DynamoDBSimulator (fornece store, tables, normalizeValue, marshallItem, applyProjection).
 */
function searchVectors(sim, params) {
  const {
    TableName, IndexName, SearchVector, TopK,
    SearchConditionExpression, ProjectionExpression,
    ExpressionAttributeNames = {}, ExpressionAttributeValues = {},
    ReturnConsumedCapacity,
  } = params;

  if (!TableName) throw validation('TableName is required');
  const tableKey = String(TableName).startsWith('arn:') ? String(TableName).split('/')[1] : TableName;
  const table = sim.tables.get(tableKey);
  if (!table) throw awsError('ResourceNotFoundException', `Requested resource not found: Table: ${tableKey} not found`);

  const index = table.vectorIndexes?.[IndexName];
  if (!IndexName) throw validation('IndexName is required');
  if (!index) throw awsError('ResourceNotFoundException', `Requested resource not found: Vector index: ${IndexName} not found`);

  if (!Number.isInteger(TopK) || TopK < 1 || TopK > 100) {
    throw validation('TopK must be an integer between 1 and 100');
  }
  const query = toNumberArray(SearchVector);
  if (!query || query.length < 1 || query.length > 4096) {
    throw validation('SearchVector must be a list of 1 to 4096 numbers');
  }
  if (query.length !== index.dimensions) {
    throw validation(`SearchVector has ${query.length} dimensions but the vector index expects ${index.dimensions}`);
  }

  const normalize = (v) => sim.normalizeValue(v, table);
  const conditions = parseSearchCondition(SearchConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues, normalize);

  const hashEl = index.searchSchema.find((e) => e.SearchSchemaElementType === 'HASH');
  const schemaAttrs = new Set(index.searchSchema.map((e) => e.AttributeName));
  for (const c of conditions) {
    if (!schemaAttrs.has(c.attr)) {
      throw validation(`Attribute ${c.attr} is not part of the vector index search schema`);
    }
  }
  if (hashEl && !conditions.some((c) => c.attr === hashEl.AttributeName)) {
    throw validation(`SearchConditionExpression must include an equality condition on partition key ${hashEl.AttributeName}`);
  }

  // Atributos projetados no índice
  const projType = index.projection.ProjectionType;
  const projected = new Set([table.hashKey, index.attribute, ...schemaAttrs]);
  if (table.rangeKey) projected.add(table.rangeKey);
  if (projType === 'INCLUDE') (index.projection.NonKeyAttributes || []).forEach((a) => projected.add(a));

  const higherIsBetter = index.distanceFunction === 'DOT_PRODUCT';
  const scored = [];
  const items = sim.store.read(tableKey);
  for (const item of items) {
    const vec = toNumberArray(item[index.attribute]);
    if (!vec || vec.length !== index.dimensions) continue; // item esparso: não indexado
    if (!conditions.every((c) => item[c.attr] === c.value)) continue;
    scored.push({ item, score: score(index.distanceFunction, query, vec) });
  }
  scored.sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score));

  let results = scored.slice(0, TopK).map(({ item, score: s }) => {
    let visible = item;
    if (projType !== 'ALL') {
      visible = {};
      for (const k of Object.keys(item)) if (projected.has(k)) visible[k] = item[k];
    }
    return { Item: sim.marshallItem(visible, table), Score: s };
  });

  if (ProjectionExpression) {
    const projectedItems = sim.applyProjection(results.map((r) => r.Item), ProjectionExpression, ExpressionAttributeNames);
    results = results.map((r, i) => ({ Item: projectedItems[i], Score: r.Score }));
  }

  const response = { SearchResults: results };
  if (ReturnConsumedCapacity && ReturnConsumedCapacity !== 'NONE') {
    response.ConsumedCapacity = {
      VectorSearchRequestBytes: Math.max(1, Math.ceil(items.length * index.dimensions * 4 / 1024)),
      VectorWriteRequestBytes: 0,
    };
  }
  return response;
}

module.exports = {
  buildVectorIndexes,
  describeVectorIndexes,
  applyVectorIndexUpdates,
  searchVectors,
};
