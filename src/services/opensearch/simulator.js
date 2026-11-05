/**
 * OpenSearch Simulator Core - Simulador Elasticsearch/OpenSearch
 */

const Index = require('./models/index');
const Document = require('./models/document');
const OpenSearchStore = require('./store');
const logger = require('../../utils/logger');
const path = require('path');

class OpenSearchSimulator {
  constructor(config) {
    this.config = config;
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'opensearch');

    this.store = new OpenSearchStore(dataDir);
    this.indices = new Map();
    this.indexCache = new Map();
  }

  async initialize() {
    logger.debug('Inicializando OpenSearch Simulator...');

    // Carrega metadados persistidos
    this.loadIndices();

    // Cria índices da configuração
    if (this.config.opensearch?.indices) {
      for (const indexConfig of this.config.opensearch.indices) {
        if (!this.indices.has(indexConfig.name)) {
          this.createIndex(indexConfig.name, indexConfig);
        }
      }
    }

    logger.debug(`✅ OpenSearch Simulator inicializado com ${this.indices.size} índices`);
  }

  /**
   * Carrega metadados de índices do disco
   */
  loadIndices() {
    const metadata = this.store.loadMetadata();

    for (const [indexName, indexDef] of Object.entries(metadata)) {
      const index = new Index(indexName, indexDef.settings);
      index.createdAt = indexDef.createdAt;
      index.docsCount = indexDef.docsCount || 0;
      index.storeSize = indexDef.storeSize || 0;
      this.indices.set(indexName, index);

      logger.debug(`Índice carregado: ${indexName}`);
    }
  }

  /**
   * Persiste metadados de índices
   */
  persistIndices() {
    const metadata = {};

    for (const [indexName, index] of this.indices) {
      metadata[indexName] = {
        name: index.name,
        settings: index.settings,
        mappings: index.mappings,
        aliases: index.aliases,
        createdAt: index.createdAt,
        docsCount: index.docsCount,
        storeSize: index.storeSize
      };
    }

    this.store.saveMetadata(metadata);
  }

  // ========== Operações de Índice ==========

  /**
   * Cria um novo índice
   */
  createIndex(name, config = {}) {
    if (this.indices.has(name)) {
      throw new Error(`Index '${name}' already exists`);
    }

    const index = new Index(name, config);
    this.indices.set(name, index);
    this.persistIndices();

    logger.info(`✅ Índice criado: ${name}`);

    return {
      acknowledged: true,
      shards_acknowledged: true,
      index: name
    };
  }

  /**
   * Deleta um índice
   */
  deleteIndex(name) {
    if (!this.indices.has(name)) {
      throw new Error(`Index '${name}' does not exist`);
    }

    this.indices.delete(name);
    this.indexCache.delete(name);
    this.store.deleteIndex(name);
    this.persistIndices();

    logger.info(`🗑️  Índice deletado: ${name}`);

    return {
      acknowledged: true
    };
  }

  /**
   * Obtém informações de um índice
   */
  getIndex(name) {
    const index = this.indices.get(name);
    if (!index) {
      throw new Error(`Index '${name}' does not exist`);
    }

    // Atualiza tamanho
    index.updateSize(this.store.getIndexSize(name));

    return {
      [name]: index.toJSON()
    };
  }

  /**
   * Lista todos os índices
   */
  listIndices() {
    const indices = [];

    for (const [name, index] of this.indices) {
      index.updateSize(this.store.getIndexSize(name));
      indices.push({
        name: name,
        status: index.status,
        docs: index.docsCount,
        size_mb: (index.storeSize / 1024 / 1024).toFixed(2),
        created_at: index.createdAt
      });
    }

    return indices;
  }

  /**
   * Abre um índice (simples - todos começam abertos)
   */
  openIndex(name) {
    const index = this.indices.get(name);
    if (!index) throw new Error(`Index '${name}' does not exist`);

    index.status = 'open';
    this.persistIndices();

    return { acknowledged: true };
  }

  /**
   * Fecha um índice
   */
  closeIndex(name) {
    const index = this.indices.get(name);
    if (!index) throw new Error(`Index '${name}' does not exist`);

    index.status = 'closed';
    this.persistIndices();

    return { acknowledged: true };
  }

  // ========== Operações de Documento ==========

  /**
   * Indexa um documento (PUT/POST)
   */
  indexDocument(indexName, document, documentId = null) {
    if (!this.indices.has(indexName)) {
      throw new Error(`Index '${indexName}' does not exist`);
    }

    // Cria objeto Document
    const doc = new Document(document, {
      _id: documentId || document._id,
      _index: indexName,
      _type: '_doc'
    });

    // Carrega documentos existentes
    let documents = this.store.loadDocuments(indexName);
    const existingIndex = documents.findIndex(d => d._id === doc._id);

    const isNew = existingIndex === -1;
    if (isNew) {
      documents.push(doc.toJSON());
      this.indices.get(indexName).addDocument();
    } else {
      documents[existingIndex] = doc.toJSON();
    }

    // Salva
    this.store.saveDocuments(indexName, documents);
    this.indexCache.delete(indexName);

    logger.verboso(`Documento ${isNew ? 'criado' : 'atualizado'}: ${indexName}/${doc._id}`);

    return {
      _index: indexName,
      _type: '_doc',
      _id: doc._id,
      _version: doc._version,
      result: isNew ? 'created' : 'updated',
      _shards: { total: 2, successful: 1, failed: 0 },
      _seq_no: doc._seq_no,
      _primary_term: doc._primary_term
    };
  }

  /**
   * Obtém um documento por ID
   */
  getDocument(indexName, documentId) {
    if (!this.indices.has(indexName)) {
      throw new Error(`Index '${indexName}' does not exist`);
    }

    const documents = this.store.loadDocuments(indexName);
    const doc = documents.find(d => d._id === documentId);

    if (!doc) {
      return {
        _index: indexName,
        _type: '_doc',
        _id: documentId,
        found: false
      };
    }

    logger.verboso(`Documento encontrado: ${indexName}/${documentId}`);

    return {
      _index: indexName,
      _type: '_doc',
      _id: documentId,
      _version: doc._version,
      _seq_no: doc._seq_no,
      _primary_term: doc._primary_term,
      found: true,
      _source: doc._source
    };
  }

  /**
   * Deleta um documento
   */
  deleteDocument(indexName, documentId) {
    if (!this.indices.has(indexName)) {
      throw new Error(`Index '${indexName}' does not exist`);
    }

    const deleted = this.store.removeDocument(indexName, documentId);

    if (deleted) {
      this.indices.get(indexName).removeDocument();
      this.indexCache.delete(indexName);
      logger.verboso(`Documento deletado: ${indexName}/${documentId}`);
    }

    return {
      _index: indexName,
      _type: '_doc',
      _id: documentId,
      _version: 2,
      result: deleted ? 'deleted' : 'not_found',
      _shards: { total: 2, successful: 1, failed: 0 },
      _seq_no: 1,
      _primary_term: 1
    };
  }

  /**
   * Busca documentos com query
   */
  search(indexName, queryParams = {}) {
    if (!this.indices.has(indexName)) {
      throw new Error(`Index '${indexName}' does not exist`);
    }

    let documents = this.store.loadDocuments(indexName);
    const {
      query = {},
      from = 0,
      size = 10,
      sort = [],
      highlight = false
    } = queryParams;

    let results = documents;

    // Aplicar query filter
    if (query.match) {
      const [field, value] = Object.entries(query.match)[0];
      results = results.filter(doc => {
        const fieldValue = doc._source[field];
        if (!fieldValue) return false;
        return String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
      });
    }

    if (query.bool) {
      // Suporte básico para bool queries
      if (query.bool.must) {
        for (const mustClause of query.bool.must) {
          if (mustClause.match) {
            const [field, value] = Object.entries(mustClause.match)[0];
            results = results.filter(doc => {
              const fieldValue = doc._source[field];
              if (!fieldValue) return false;
              return String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
            });
          }
        }
      }

      if (query.bool.should) {
        // OR logic
        const shouldMatches = [];
        for (const shouldClause of query.bool.should) {
          if (shouldClause.match) {
            const [field, value] = Object.entries(shouldClause.match)[0];
            shouldMatches.push(
              results.filter(doc => {
                const fieldValue = doc._source[field];
                if (!fieldValue) return false;
                return String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
              })
            );
          }
        }
        results = [...new Map(shouldMatches.flat().map(item => [item._id, item])).values()];
      }
    }

    if (query.query_string) {
      // Full-text search
      const text = query.query_string.query.toLowerCase();
      results = results.filter(doc => {
        for (const value of Object.values(doc._source)) {
          if (String(value).toLowerCase().includes(text)) return true;
        }
        return false;
      });
    }

    // Aplicar sorting
    if (sort.length > 0) {
      for (const sortSpec of sort) {
        if (typeof sortSpec === 'string') {
          results.sort((a, b) => {
            const aVal = a._source[sortSpec];
            const bVal = b._source[sortSpec];
            return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
          });
        } else if (typeof sortSpec === 'object') {
          const [field, direction] = Object.entries(sortSpec)[0];
          results.sort((a, b) => {
            const aVal = a._source[field];
            const bVal = b._source[field];
            const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return direction.order === 'desc' ? -cmp : cmp;
          });
        }
      }
    }

    // Paginação
    const total = results.length;
    const hits = results.slice(from, from + size);

    logger.verboso(`Busca em ${indexName}: ${total} resultados, retornando ${hits.length}`);

    return {
      took: 5,
      timed_out: false,
      _shards: { total: 5, successful: 5, skipped: 0, failed: 0 },
      hits: {
        total: { value: total, relation: 'eq' },
        max_score: hits.length > 0 ? 1.0 : null,
        hits: hits.map(doc => ({
          _index: indexName,
          _type: '_doc',
          _id: doc._id,
          _score: 1.0,
          _source: doc._source
        }))
      }
    };
  }

  /**
   * Busca agregada (simples)
   */
  aggregate(indexName, aggs = {}) {
    if (!this.indices.has(indexName)) {
      throw new Error(`Index '${indexName}' does not exist`);
    }

    const documents = this.store.loadDocuments(indexName);
    const result = { aggregations: {} };

    for (const [aggName, aggSpec] of Object.entries(aggs)) {
      if (aggSpec.terms) {
        // Agregação por termos
        const field = aggSpec.terms.field;
        const buckets = {};

        documents.forEach(doc => {
          const value = doc._source[field];
          if (value) {
            buckets[value] = (buckets[value] || 0) + 1;
          }
        });

        result.aggregations[aggName] = {
          buckets: Object.entries(buckets)
            .map(([key, count]) => ({ key, doc_count: count }))
            .sort((a, b) => b.doc_count - a.doc_count)
            .slice(0, aggSpec.terms.size || 10)
        };
      }

      if (aggSpec.avg || aggSpec.sum) {
        // Agregação numérica
        const spec = aggSpec.avg || aggSpec.sum;
        const field = spec.field;
        const values = documents.map(doc => Number(doc._source[field])).filter(v => !isNaN(v));

        if (aggSpec.avg) {
          result.aggregations[aggName] = {
            value: values.length > 0 ? values.reduce((a, b) => a + b) / values.length : 0
          };
        } else {
          result.aggregations[aggName] = {
            value: values.reduce((a, b) => a + b, 0)
          };
        }
      }
    }

    return result;
  }

  /**
   * Atualiza um documento por query
   */
  updateByQuery(indexName, updateScript, query = {}) {
    if (!this.indices.has(indexName)) {
      throw new Error(`Index '${indexName}' does not exist`);
    }

    let documents = this.store.loadDocuments(indexName);
    let updated = 0;

    documents = documents.map(doc => {
      let matches = true;

      if (Object.keys(query).length > 0) {
        for (const [field, value] of Object.entries(query)) {
          if (doc._source[field] !== value) {
            matches = false;
            break;
          }
        }
      }

      if (matches && updateScript) {
        // Simples: executar update script
        doc._source = { ...doc._source, ...updateScript };
        doc._version++;
        doc._updatedAt = new Date().toISOString();
        updated++;
      }

      return doc;
    });

    this.store.saveDocuments(indexName, documents);
    this.indexCache.delete(indexName);

    logger.info(`Atualizado ${updated} documentos em ${indexName}`);

    return {
      took: 10,
      timed_out: false,
      total: updated,
      updated: updated,
      deleted: 0,
      batches: 1,
      version_conflicts: 0,
      noops: 0,
      retries: { bulk: 0, search: 0 },
      throttled_millis: 0,
      requests_per_second: -1.0,
      throttled_until_millis: 0,
      failures: []
    };
  }

  /**
   * Deleta documentos por query
   */
  deleteByQuery(indexName, query = {}) {
    if (!this.indices.has(indexName)) {
      throw new Error(`Index '${indexName}' does not exist`);
    }

    let documents = this.store.loadDocuments(indexName);
    let deleted = 0;

    documents = documents.filter(doc => {
      let matches = true;

      for (const [field, value] of Object.entries(query)) {
        if (doc._source[field] !== value) {
          matches = false;
          break;
        }
      }

      if (matches) {
        deleted++;
        this.indices.get(indexName).removeDocument();
        return false;
      }

      return true;
    });

    this.store.saveDocuments(indexName, documents);
    this.indexCache.delete(indexName);

    logger.info(`Deletado ${deleted} documentos de ${indexName}`);

    return {
      took: 10,
      timed_out: false,
      total: deleted,
      deleted: deleted,
      batches: 1,
      version_conflicts: 0,
      noops: 0,
      retries: { bulk: 0, search: 0 },
      throttled_millis: 0,
      requests_per_second: -1.0,
      throttled_until_millis: 0,
      failures: []
    };
  }

  /**
   * Retorna estatísticas de cluster
   */
  getClusterStats() {
    let totalDocs = 0;
    let totalSize = 0;

    for (const index of this.indices.values()) {
      totalDocs += index.docsCount;
      totalSize += index.storeSize;
    }

    return {
      status: 'green',
      indices: this.indices.size,
      shards: this.indices.size * 2,
      replicas: this.indices.size,
      docs: totalDocs,
      size_mb: (totalSize / 1024 / 1024).toFixed(2)
    };
  }

  /**
   * Reset - limpa tudo
   */
  async reset() {
    this.indices.clear();
    this.indexCache.clear();
    this.store.clear();
    logger.info('🔄 OpenSearch resetado');
  }
}

module.exports = OpenSearchSimulator;
