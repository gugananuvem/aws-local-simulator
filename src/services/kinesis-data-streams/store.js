/**
 * Kinesis Data Streams Store - Persistência de streams e records em JSON
 */

const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

class KinesisDataStreamsStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.streamsDir = path.join(dataDir, 'kinesis-data-streams');
    this.metadataFile = path.join(this.streamsDir, '__streams__.json');

    if (!fs.existsSync(this.streamsDir)) {
      fs.mkdirSync(this.streamsDir, { recursive: true });
    }
  }

  /**
   * Carrega metadados de todos os streams
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
   * Salva metadados de todos os streams
   */
  saveMetadata(metadata) {
    try {
      fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2), 'utf8');
      logger.debug(`Metadados de streams salvos em ${this.metadataFile}`);
    } catch (error) {
      logger.error(`Erro ao salvar ${this.metadataFile}: ${error.message}`);
    }
  }

  /**
   * Obtém caminho do arquivo de stream
   */
  getStreamPath(streamName) {
    return path.join(this.streamsDir, `${streamName}.json`);
  }

  /**
   * Carrega records de um stream
   */
  loadStreamRecords(streamName) {
    const streamPath = this.getStreamPath(streamName);

    if (!fs.existsSync(streamPath)) {
      return [];
    }

    try {
      const data = fs.readFileSync(streamPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.warn(`Erro ao ler stream ${streamName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Salva records de um stream
   */
  saveStreamRecords(streamName, records) {
    try {
      const streamPath = this.getStreamPath(streamName);
      fs.writeFileSync(streamPath, JSON.stringify(records, null, 2), 'utf8');
      logger.debug(`${records.length} records salvos no stream ${streamName}`);
    } catch (error) {
      logger.error(`Erro ao salvar stream ${streamName}: ${error.message}`);
    }
  }

  /**
   * Adiciona record ao stream
   */
  addRecord(streamName, record) {
    const records = this.loadStreamRecords(streamName);
    records.push(record);
    this.saveStreamRecords(streamName, records);
  }

  /**
   * Adiciona múltiplos records
   */
  addRecords(streamName, newRecords) {
    const records = this.loadStreamRecords(streamName);
    records.push(...newRecords);
    this.saveStreamRecords(streamName, records);
  }

  /**
   * Remove record do stream
   */
  removeRecord(streamName, recordId) {
    const records = this.loadStreamRecords(streamName);
    const filtered = records.filter(r => r.recordId !== recordId);

    if (filtered.length < records.length) {
      this.saveStreamRecords(streamName, filtered);
      return true;
    }

    return false;
  }

  /**
   * Deleta stream completamente
   */
  deleteStream(streamName) {
    try {
      const streamPath = this.getStreamPath(streamName);
      if (fs.existsSync(streamPath)) {
        fs.unlinkSync(streamPath);
        logger.debug(`Stream ${streamName} deletado`);
      }
    } catch (error) {
      logger.error(`Erro ao deletar stream ${streamName}: ${error.message}`);
    }
  }

  /**
   * Calcula tamanho total do stream em bytes
   */
  getStreamSize(streamName) {
    const records = this.loadStreamRecords(streamName);
    return records.reduce((sum, record) => sum + Buffer.byteLength(record.data), 0);
  }

  /**
   * Limpa todos os streams
   */
  clear() {
    try {
      if (fs.existsSync(this.streamsDir)) {
        const files = fs.readdirSync(this.streamsDir);
        files.forEach(file => {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.streamsDir, file));
          }
        });
        logger.debug('Todos os streams foram limpos');
      }
    } catch (error) {
      logger.error(`Erro ao limpar streams: ${error.message}`);
    }
  }
}

module.exports = KinesisDataStreamsStore;
