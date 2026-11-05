/**
 * Kinesis Data Streams - Record Model
 * Representa um record (mensagem) dentro de um shard
 */

const { v4: uuidv4 } = require('uuid');

class Record {
  constructor(data, partitionKey, config = {}) {
    this.recordId = uuidv4();
    this.data = data; // Base64 encoded por padrão
    this.partitionKey = partitionKey;
    this.explicitHashKey = config.explicitHashKey || null;
    this.sequenceNumber = null; // Será atribuído pelo shard
    this.timestamp = new Date().toISOString();
    this.approximateArrivalTimestamp = new Date();
    
    // Metadados
    this.shardId = config.shardId || null;
    this.encryptionType = config.encryptionType || 'NONE';
    
    // Dados do consumidor (quando acessado via consumer)
    this.consumerSequenceNumber = null;
    this.offsetInMilliseconds = null;
  }

  /**
   * Retorna record em formato Kinesis (sem dados internos)
   */
  toJSON() {
    return {
      Data: this.data,
      PartitionKey: this.partitionKey,
      ExplicitHashKey: this.explicitHashKey,
      SequenceNumber: this.sequenceNumber,
      ApproximateArrivalTimestamp: this.approximateArrivalTimestamp.toISOString(),
      EncryptionType: this.encryptionType
    };
  }

  /**
   * Retorna record em formato consumer
   */
  toConsumerJSON() {
    return {
      Data: this.data,
      PartitionKey: this.partitionKey,
      SequenceNumber: this.consumerSequenceNumber || this.sequenceNumber,
      ApproximateArrivalTimestamp: this.approximateArrivalTimestamp.toISOString(),
      EncryptionType: this.encryptionType
    };
  }

  /**
   * Obtém tamanho do record em bytes
   */
  getSize() {
    return Buffer.byteLength(this.data) + Buffer.byteLength(this.partitionKey);
  }

  /**
   * Marca record como consumido
   */
  markAsConsumed(consumerArn, sequenceNumber) {
    this.consumerSequenceNumber = sequenceNumber;
    this.offsetInMilliseconds = Date.now();
  }
}

module.exports = Record;
