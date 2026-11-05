/**
 * OpenSearch Server - Servidor HTTP REST para OpenSearch/Elasticsearch
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');

class OpenSearchServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.simulator = null;
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(cors());
    this.app.use(express.json());

    // Logging
    this.app.use((req, res, next) => {
      logger.debug(`OpenSearch: ${req.method} ${req.path}`);
      next();
    });
  }

  async initialize() {
    logger.debug(`Inicializando OpenSearch Server na porta ${this.port}`);
    this.setupRoutes();
  }

  setupRoutes() {
    // ========== Índices ==========

    // PUT /{index} - Criar índice
    this.app.put('/:index([a-z0-9_-]+)$', (req, res) => {
      try {
        const { index } = req.params;
        const settings = req.body.settings || {};
        const mappings = req.body.mappings || {};

        const result = this.simulator.createIndex(index, { ...settings, mappings });
        res.status(201).json(result);
      } catch (error) {
        res.status(400).json({ error: { type: 'index_already_exists_exception', reason: error.message } });
      }
    });

    // DELETE /{index} - Deletar índice
    this.app.delete('/:index([a-z0-9_-]+)$', (req, res) => {
      try {
        const result = this.simulator.deleteIndex(req.params.index);
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: { type: 'index_not_found_exception', reason: error.message } });
      }
    });

    // GET /{index} - Obter informações do índice
    this.app.get('/:index([a-z0-9_-]+)$', (req, res) => {
      try {
        const result = this.simulator.getIndex(req.params.index);
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: { type: 'index_not_found_exception', reason: error.message } });
      }
    });

    // POST /{index}/_open - Abrir índice
    this.app.post('/:index([a-z0-9_-]+)/_open', (req, res) => {
      try {
        const result = this.simulator.openIndex(req.params.index);
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: { type: 'index_not_found_exception', reason: error.message } });
      }
    });

    // POST /{index}/_close - Fechar índice
    this.app.post('/:index([a-z0-9_-]+)/_close', (req, res) => {
      try {
        const result = this.simulator.closeIndex(req.params.index);
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: { type: 'index_not_found_exception', reason: error.message } });
      }
    });

    // ========== Documentos ==========

    // POST /{index}/_doc - Indexar documento (auto ID)
    this.app.post('/:index([a-z0-9_-]+)/_doc', (req, res) => {
      try {
        const result = this.simulator.indexDocument(req.params.index, req.body);
        res.status(201).json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // PUT /{index}/_doc/{id} - Indexar documento (com ID)
    this.app.put('/:index([a-z0-9_-]+)/_doc/:id', (req, res) => {
      try {
        const result = this.simulator.indexDocument(req.params.index, req.body, req.params.id);
        res.status(req.body._created ? 201 : 200).json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // GET /{index}/_doc/{id} - Obter documento
    this.app.get('/:index([a-z0-9_-]+)/_doc/:id', (req, res) => {
      try {
        const result = this.simulator.getDocument(req.params.index, req.params.id);
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // DELETE /{index}/_doc/{id} - Deletar documento
    this.app.delete('/:index([a-z0-9_-]+)/_doc/:id', (req, res) => {
      try {
        const result = this.simulator.deleteDocument(req.params.index, req.params.id);
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // ========== Busca ==========

    // GET /{index}/_search - Buscar documentos
    this.app.get('/:index([a-z0-9_-]+)/_search', (req, res) => {
      try {
        const query = {};

        if (req.query.q) {
          query.query_string = { query: req.query.q };
        }

        const from = parseInt(req.query.from || 0);
        const size = parseInt(req.query.size || 10);

        const result = this.simulator.search(req.params.index, { query, from, size });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // POST /{index}/_search - Buscar com body query
    this.app.post('/:index([a-z0-9_-]+)/_search', (req, res) => {
      try {
        const result = this.simulator.search(req.params.index, req.body);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Update/Delete ==========

    // POST /{index}/_update_by_query - Atualizar por query
    this.app.post('/:index([a-z0-9_-]+)/_update_by_query', (req, res) => {
      try {
        const result = this.simulator.updateByQuery(req.params.index, req.body.script, req.body.query);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // POST /{index}/_delete_by_query - Deletar por query
    this.app.post('/:index([a-z0-9_-]+)/_delete_by_query', (req, res) => {
      try {
        const result = this.simulator.deleteByQuery(req.params.index, req.body.query);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Agregações ==========

    // POST /{index}/_search?agg - Buscar com agregação
    this.app.post('/:index([a-z0-9_-]+)/_search', (req, res) => {
      try {
        if (req.body.aggs) {
          const result = this.simulator.aggregate(req.params.index, req.body.aggs);
          res.json(result);
        } else {
          const result = this.simulator.search(req.params.index, req.body);
          res.json(result);
        }
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Admin / Info ==========

    // GET / - Health check
    this.app.get('/', (req, res) => {
      res.json({
        name: 'opensearch-simulator',
        cluster_name: 'opensearch-cluster',
        cluster_uuid: 'abc123',
        version: {
          number: '2.0.0',
          build_flavor: 'oss',
          build_type: 'tar',
          build_hash: 'abc123',
          build_date: new Date().toISOString(),
          build_snapshot: false,
          lucene_version: '9.0.0',
          minimum_wire_compatibility_version: '7.17.0',
          minimum_index_compatibility_version: '7.0.0'
        },
        tagline: 'The OpenSearch Project'
      });
    });

    // GET /_cluster/health - Cluster health
    this.app.get('/_cluster/health', (req, res) => {
      const stats = this.simulator.getClusterStats();
      res.json({
        cluster_name: 'opensearch-cluster',
        status: 'green',
        timed_out: false,
        number_of_nodes: 1,
        number_of_data_nodes: 1,
        active_primary_shards: stats.shards,
        active_shards: stats.shards * 2,
        relocating_shards: 0,
        initializing_shards: 0,
        unassigned_shards: 0,
        delayed_unassigned_shards: 0,
        number_of_pending_tasks: 0,
        number_of_in_flight_fetch: 0,
        task_max_waiting_in_queue_millis: 0,
        active_shards_percent_as_number: 100.0
      });
    });

    // GET /_cat/indices - Listar índices (admin)
    this.app.get('/__admin/opensearch/indices', (req, res) => {
      const indices = this.simulator.listIndices();
      res.json({ indices });
    });

    // GET /_stats - Estatísticas
    this.app.get('/_stats', (req, res) => {
      const stats = this.simulator.getClusterStats();
      res.json({
        _shards: { total: stats.shards, successful: stats.shards, failed: 0 },
        _all: {
          primaries: {
            docs: { count: stats.docs, deleted: 0 },
            store: { size_in_bytes: stats.size_mb * 1024 * 1024 },
            indexing: { index_total: stats.docs, index_time_in_millis: 0 },
            search: { query_total: 0, query_time_in_millis: 0 }
          },
          total: {
            docs: { count: stats.docs, deleted: 0 },
            store: { size_in_bytes: stats.size_mb * 1024 * 1024 }
          }
        },
        indices: {}
      });
    });

    // 404
    this.app.use((req, res) => {
      res.status(404).json({
        error: {
          type: 'index_not_found_exception',
          reason: `no such index [${req.path}]`
        }
      });
    });
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🔍 OpenSearch rodando em http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('OpenSearch servidor parado');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = OpenSearchServer;
