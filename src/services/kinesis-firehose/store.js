/**
 * Kinesis Data Firehose Store - Persistência de delivery streams em JSON
 */

const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

class KinesisFirehoseStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.streamsDir = path.join(dataDir, 'kinesis-firehose');
    this.metadataFile = path.join(this.streamsDir, '__delivery_streams__.json');

    if (!fs.existsSync(this.streamsDir)) {
      fs.mkdirSync(this.streamsDir, { recursive: true });
    }
  }

  /**
   * Carrega metadados de todos os delivery streams
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
   * Salva metadados de todos os delivery streams
   */
  saveMetadata(metadata) {
    try {
      fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2), 'utf8');
      logger.debug(`Metadados de delivery streams salvos em ${this.metadataFile}`);
    } catch (error) {
      logger.error(`Erro ao salvar ${this.metadataFile}: ${error.message}`);
    }
  }

  /**
   * Obtém caminho do arquivo de delivery stream
   */
  getDeliveryStreamPath(deliveryStreamName) {
    return path.join(this.streamsDir, `${deliveryStreamName}.json`);
  }

  /**
   * Carrega records de um delivery stream
   */
  loadDeliveryStreamRecords(deliveryStreamName) {
    const streamPath = this.getDeliveryStreamPath(deliveryStreamName);

    if (!fs.existsSync(streamPath)) {
      return [];
    }

    try {
      const data = fs.readFileSync(streamPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.warn(`Erro ao ler delivery stream ${deliveryStreamName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Salva records de um delivery stream
   */
  saveDeliveryStreamRecords(deliveryStreamName, records) {
    try {
      const streamPath = this.getDeliveryStreamPath(deliveryStreamName);
      fs.writeFileSync(streamPath, JSON.stringify(records, null, 2), 'utf8');
      logger.debug(`${records.length} records salvos no delivery stream ${deliveryStreamName}`);
    } catch (error) {
      logger.error(`Erro ao salvar delivery stream ${deliveryStreamName}: ${error.message}`);
    }
  }

  /**
   * Adiciona record ao delivery stream
   */
  addRecord(deliveryStreamName, record) {
    const records = this.loadDeliveryStreamRecords(deliveryStreamName);
    records.push(record);
    this.saveDeliveryStreamRecords(deliveryStreamName, records);
  }

  /**
   * Adiciona múltiplos records
   */
  addRecords(deliveryStreamName, newRecords) {
    const records = this.loadDeliveryStreamRecords(deliveryStreamName);
    records.push(...newRecords);
    this.saveDeliveryStreamRecords(deliveryStreamName, records);
  }

  /**
   * Remove record do delivery stream
   */
  removeRecord(deliveryStreamName, recordId) {
    const records = this.loadDeliveryStreamRecords(deliveryStreamName);
    const filtered = records.filter(r => r.recordId !== recordId);

    if (filtered.length < records.length) {
      this.saveDeliveryStreamRecords(deliveryStreamName, filtered);
      return true;
    }

    return false;
  }

  /**
   * Deleta delivery stream completamente
   */
  deleteDeliveryStream(deliveryStreamName) {
    try {
      const streamPath = this.getDeliveryStreamPath(deliveryStreamName);
      if (fs.existsSync(streamPath)) {
        fs.unlinkSync(streamPath);
        logger.debug(`Delivery Stream ${deliveryStreamName} deletado`);
      }
    } catch (error) {
      logger.error(`Erro ao deletar delivery stream ${deliveryStreamName}: ${error.message}`);
    }
  }

  /**
   * Calcula tamanho total do delivery stream em bytes
   */
  getDeliveryStreamSize(deliveryStreamName) {
    const records = this.loadDeliveryStreamRecords(deliveryStreamName);
    return records.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record.data)), 0);
  }

  /**
   * Limpa todos os delivery streams
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
        logger.debug('Todos os delivery streams foram limpos');
      }
    } catch (error) {
      logger.error(`Erro ao limpar delivery streams: ${error.message}`);
    }
  }
}

module.exports = KinesisFirehoseStore;
