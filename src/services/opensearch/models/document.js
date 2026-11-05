/**
 * OpenSearch Document Model - Equivalente ao Item no DynamoDB
 */

const { v4: uuidv4 } = require('uuid');

class Document {
  constructor(data = {}, config = {}) {
    this._id = config._id || uuidv4();
    this._type = config._type || '_doc';
    this._index = config._index || null;
    this._version = config._version || 1;
    this._seq_no = config._seq_no || 0;
    this._primary_term = config._primary_term || 1;
    this._score = config._score || null;

    // Metadados
    this._createdAt = config._createdAt || new Date().toISOString();
    this._updatedAt = config._updatedAt || new Date().toISOString();

    // Source - dados do documento
    this._source = data;

    // Highlights - para busca
    this.highlight = {};
  }

  /**
   * Atualiza documento
   */
  update(data = {}) {
    this._source = { ...this._source, ...data };
    this._version++;
    this._updatedAt = new Date().toISOString();
  }

  /**
   * Incrementa version
   */
  incrementVersion() {
    this._version++;
    this._updatedAt = new Date().toISOString();
  }

  /**
   * Retorna documento em formato Elasticsearch
   */
  toJSON() {
    return {
      _id: this._id,
      _type: this._type,
      _index: this._index,
      _version: this._version,
      _seq_no: this._seq_no,
      _primary_term: this._primary_term,
      _score: this._score,
      _source: this._source,
      highlight: Object.keys(this.highlight).length > 0 ? this.highlight : undefined
    };
  }

  /**
   * Retorna apenas _source
   */
  getSource() {
    return this._source;
  }

  /**
   * Retorna tamanho em bytes (aproximado)
   */
  getSize() {
    return JSON.stringify(this._source).length;
  }

  /**
   * Verifica se documento match em busca simples
   */
  matchesQuery(query = {}) {
    if (Object.keys(query).length === 0) return true;

    for (const [key, value] of Object.entries(query)) {
      if (key === '_id' && this._id !== value) return false;
      if (key === '_type' && this._type !== value) return false;
      if (!(key in this._source)) return false;

      const fieldValue = this._source[key];
      if (typeof fieldValue === 'string') {
        if (!fieldValue.toLowerCase().includes(String(value).toLowerCase())) return false;
      } else if (fieldValue !== value) {
        return false;
      }
    }

    return true;
  }

  /**
   * Busca full-text simples
   */
  matchesFullText(text = '') {
    if (!text) return true;

    const searchText = text.toLowerCase();
    for (const value of Object.values(this._source)) {
      if (typeof value === 'string' && value.toLowerCase().includes(searchText)) {
        return true;
      }
    }

    return false;
  }
}

module.exports = Document;
