/**
 * Kinesis Data Analytics Store - Persistência de aplicações em JSON
 */

const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

class KinesisAnalyticsStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.applicationsDir = path.join(dataDir, 'kinesis-analytics');
    this.metadataFile = path.join(this.applicationsDir, '__applications__.json');

    if (!fs.existsSync(this.applicationsDir)) {
      fs.mkdirSync(this.applicationsDir, { recursive: true });
    }
  }

  /**
   * Carrega metadados de todas as aplicações
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
   * Salva metadados de todas as aplicações
   */
  saveMetadata(metadata) {
    try {
      fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2), 'utf8');
      logger.debug(`Metadados de aplicações salvos em ${this.metadataFile}`);
    } catch (error) {
      logger.error(`Erro ao salvar ${this.metadataFile}: ${error.message}`);
    }
  }

  /**
   * Obtém caminho do arquivo de aplicação
   */
  getApplicationPath(applicationName) {
    return path.join(this.applicationsDir, `${applicationName}.json`);
  }

  /**
   * Carrega código SQL de uma aplicação
   */
  loadApplicationCode(applicationName) {
    const appPath = this.getApplicationPath(applicationName);

    if (!fs.existsSync(appPath)) {
      return '';
    }

    try {
      const data = fs.readFileSync(appPath, 'utf8');
      const appData = JSON.parse(data);
      return appData.sqlCode || '';
    } catch (error) {
      logger.warn(`Erro ao ler aplicação ${applicationName}: ${error.message}`);
      return '';
    }
  }

  /**
   * Salva código SQL de uma aplicação
   */
  saveApplicationCode(applicationName, sqlCode) {
    try {
      const appPath = this.getApplicationPath(applicationName);
      const appData = {
        applicationName,
        sqlCode,
        lastModified: new Date().toISOString()
      };
      fs.writeFileSync(appPath, JSON.stringify(appData, null, 2), 'utf8');
      logger.debug(`Código da aplicação ${applicationName} salvo`);
    } catch (error) {
      logger.error(`Erro ao salvar aplicação ${applicationName}: ${error.message}`);
    }
  }

  /**
   * Carrega resultados de query
   */
  loadQueryResults(applicationName, queryId) {
    const appPath = this.getApplicationPath(applicationName);

    if (!fs.existsSync(appPath)) {
      return [];
    }

    try {
      const data = fs.readFileSync(appPath, 'utf8');
      const appData = JSON.parse(data);
      const queryResults = appData.queryResults || {};
      return queryResults[queryId] || [];
    } catch (error) {
      logger.warn(`Erro ao ler resultados de query ${queryId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Salva resultados de query
   */
  saveQueryResults(applicationName, queryId, results) {
    try {
      const appPath = this.getApplicationPath(applicationName);
      let appData = {};

      if (fs.existsSync(appPath)) {
        const data = fs.readFileSync(appPath, 'utf8');
        appData = JSON.parse(data);
      }

      if (!appData.queryResults) {
        appData.queryResults = {};
      }

      appData.queryResults[queryId] = results;
      appData.lastModified = new Date().toISOString();

      fs.writeFileSync(appPath, JSON.stringify(appData, null, 2), 'utf8');
      logger.debug(`Resultados da query ${queryId} salvos para aplicação ${applicationName}`);
    } catch (error) {
      logger.error(`Erro ao salvar resultados de query ${queryId}: ${error.message}`);
    }
  }

  /**
   * Deleta aplicação completamente
   */
  deleteApplication(applicationName) {
    try {
      const appPath = this.getApplicationPath(applicationName);
      if (fs.existsSync(appPath)) {
        fs.unlinkSync(appPath);
        logger.debug(`Aplicação ${applicationName} deletada`);
      }
    } catch (error) {
      logger.error(`Erro ao deletar aplicação ${applicationName}: ${error.message}`);
    }
  }

  /**
   * Limpa todas as aplicações
   */
  clear() {
    try {
      if (fs.existsSync(this.applicationsDir)) {
        const files = fs.readdirSync(this.applicationsDir);
        files.forEach(file => {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.applicationsDir, file));
          }
        });
        logger.debug('Todas as aplicações foram limpas');
      }
    } catch (error) {
      logger.error(`Erro ao limpar aplicações: ${error.message}`);
    }
  }
}

module.exports = KinesisAnalyticsStore;
