/**
 * OpenSearch Index Model - Equivalente à Table no DynamoDB
 */

const { v4: uuidv4 } = require('uuid');

class Index {
  constructor(name, config = {}) {
    this.name = name;
    this.settings = {
      number_of_shards: config.number_of_shards || 1,
      number_of_replicas: config.number_of_replicas || 1,
      analysis: config.analysis || {
        analyzer: {
          default: {
            type: 'standard'
          }
        }
      }
    };

    // Mappings - Define tipos de campos
    this.mappings = {
      properties: config.properties || {
        _id: { type: 'keyword' },
        _type: { type: 'keyword' },
        _source: { type: 'text' }
      }
    };

    this.aliases = config.aliases || {};
    this.createdAt = new Date().toISOString();
    this.status = 'open';
    this.docsCount = 0;
    this.storeSize = 0;
  }

  toJSON() {
    return {
      name: this.name,
      settings: this.settings,
      mappings: this.mappings,
      aliases: this.aliases,
      status: this.status,
      createdAt: this.createdAt,
      docsCount: this.docsCount,
      storeSize: this.storeSize
    };
  }

  /**
   * Adiciona documento - incrementa contador
   */
  addDocument() {
    this.docsCount++;
  }

  /**
   * Remove documento - decrementa contador
   */
  removeDocument() {
    if (this.docsCount > 0) this.docsCount--;
  }

  /**
   * Atualiza tamanho do índice
   */
  updateSize(totalSize) {
    this.storeSize = totalSize;
  }
}

module.exports = Index;
