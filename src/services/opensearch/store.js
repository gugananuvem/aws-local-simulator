/**
 * OpenSearch Store - Persistência de índices e documentos em JSON
 */

const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

class OpenSearchStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.indicesDir = path.join(dataDir, 'opensearch');
    this.metadataFile = path.join(this.indicesDir, '__indices__.json');

    if (!fs.existsSync(this.indicesDir)) {
      fs.mkdirSync(this.indicesDir, { recursive: true });
    }
  }

  /**
   * Carrega metadados de todos os índices
   */
  loadMetadata() {
    if (fs.existsSync(this.metadataFile)) {
      try {
        const data = fs.readFileSync(this.metadataFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler ${this.metadataFile}: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva metadados de todos os índices
   */
  saveMetadata(metadata) {
    try {
      fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2), 'utf8');
      logger.debug(`Metadados salvos em ${this.metadataFile}`);
    } catch (error) {
      logger.error(`Erro ao salvar ${this.metadataFile}: ${error.message}`);
    }
  }

  /**
   * Obtém caminho do arquivo de índice
   */
  getIndexPath(indexName) {
    return path.join(this.indicesDir, `${indexName}.json`);
  }

  /**
   * Carrega documentos de um índice
   */
  loadDocuments(indexName) {
    const indexPath = this.getIndexPath(indexName);

    if (!fs.existsSync(indexPath)) {
      return [];
    }

    try {
      const data = fs.readFileSync(indexPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.warn(`Erro ao ler índice ${indexName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Salva documentos de um índice
   */
  saveDocuments(indexName, documents) {
    try {
      const indexPath = this.getIndexPath(indexName);
      fs.writeFileSync(indexPath, JSON.stringify(documents, null, 2), 'utf8');
      logger.debug(`${documents.length} documentos salvos no índice ${indexName}`);
    } catch (error) {
      logger.error(`Erro ao salvar índice ${indexName}: ${error.message}`);
    }
  }

  /**
   * Adiciona documento ao índice
   */
  addDocument(indexName, document) {
    const documents = this.loadDocuments(indexName);
    
    // Remove se já existe (atualização)
    const index = documents.findIndex(doc => doc._id === document._id);
    if (index !== -1) {
      documents[index] = document;
    } else {
      documents.push(document);
    }

    this.saveDocuments(indexName, documents);
  }

  /**
   * Remove documento do índice
   */
  removeDocument(indexName, documentId) {
    const documents = this.loadDocuments(indexName);
    const filtered = documents.filter(doc => doc._id !== documentId);

    if (filtered.length < documents.length) {
      this.saveDocuments(indexName, filtered);
      return true;
    }

    return false;
  }

  /**
   * Deleta índice completamente
   */
  deleteIndex(indexName) {
    try {
      const indexPath = this.getIndexPath(indexName);
      if (fs.existsSync(indexPath)) {
        fs.unlinkSync(indexPath);
        logger.debug(`Índice ${indexName} deletado`);
      }
    } catch (error) {
      logger.error(`Erro ao deletar índice ${indexName}: ${error.message}`);
    }
  }

  /**
   * Calcula tamanho total do índice em bytes
   */
  getIndexSize(indexName) {
    const documents = this.loadDocuments(indexName);
    return documents.reduce((sum, doc) => sum + JSON.stringify(doc._source).length, 0);
  }

  /**
   * Limpa todos os índices
   */
  clear() {
    try {
      if (fs.existsSync(this.indicesDir)) {
        const files = fs.readdirSync(this.indicesDir);
        files.forEach(file => {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.indicesDir, file));
          }
        });
        logger.debug('Todos os índices foram limpos');
      }
    } catch (error) {
      logger.error(`Erro ao limpar índices: ${error.message}`);
    }
  }
}

module.exports = OpenSearchStore;
