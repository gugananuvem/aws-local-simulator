/**
 * Kinesis Data Streams - Stream Model
 * Representa um stream Kinesis com seus shards, registros e metadados
 */

const { v4: uuidv4 } = require('uuid');

class Stream {
  constructor(streamName, config = {}) {
    this.streamName = streamName;
    this.streamArn = `arn:aws:kinesis:us-east-1:123456789012:stream/${streamName}`;
    this.streamStatus = 'ACTIVE';
    this.streamModeDetails = {
      streamMode: config.streamMode || 'PROVISIONED'
    };

    // Configuração de shards (só para PROVISIONED)
    this.shardCount = config.shardCount || 1;
    this.shards = [];
    this.initializeShards();

    // Metadados
    this.creationTimestamp = new Date().toISOString();
    this.lastUpdateTimestamp = new Date().toISOString();
    this.retentionPeriod = config.retentionPeriod || 24; // horas
    this.enhancedMonitoring = config.enhancedMonitoring || ['ALL'];

    // Consumidores
    this.consumers = new Map();
    this.consumerCount = 0;

    // Estatísticas
    this.recordCount = 0;
    this.incomingRecords = 0;
    this.incomingBytes = 0;

    // Tags
    this.tags = config.tags || {};
  }

  /**
   * Inicializa shards
   */
  initializeShards() {
    this.shards = [];
    for (let i = 0; i < this.shardCount; i++) {
      this.shards.push(new Shard(i, this.streamName));
    }
  }

  /**
   * Adiciona um shard
   */
  addShard() {
    const newShard = new Shard(this.shards.length, this.streamName);
    this.shards.push(newShard);
    this.shardCount++;
    this.lastUpdateTimestamp = new Date().toISOString();
    return newShard;
  }

  /**
   * Remove um shard (merge com outro)
   */
  removeShard(shardId) {
    const index = this.shards.findIndex(s => s.shardId === shardId);
    if (index !== -1) {
      this.shards.splice(index, 1);
      this.shardCount--;
      this.lastUpdateTimestamp = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Obtém shard por ID
   */
  getShard(shardId) {
    return this.shards.find(s => s.shardId === shardId);
  }

  /**
   * Obtém todos os shards
   */
  getAllShards() {
    return this.shards;
  }

  /**
   * Seleciona shard baseado em partition key
   */
  selectShardByPartitionKey(partitionKey) {
    if (this.shards.length === 0) return null;
    
    // Hash simples para distribuição uniforme
    let hash = 0;
    for (let i = 0; i < partitionKey.length; i++) {
      const char = partitionKey.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Converte para 32-bit
    }
    
    const shardIndex = Math.abs(hash) % this.shards.length;
    return this.shards[shardIndex];
  }

  /**
   * Registra um consumidor
   */
  registerConsumer(consumerArn, consumerName) {
    if (!this.consumers.has(consumerArn)) {
      this.consumers.set(consumerArn, {
        consumerArn,
        consumerName,
        consumerStatus: 'ACTIVE',
        consumerCreationTimestamp: new Date().toISOString(),
        shardConsumers: new Map() // Map de shardId -> lastSequenceNumber
      });
      this.consumerCount++;
    }
    return this.consumers.get(consumerArn);
  }

  /**
   * Remove consumidor
   */
  removeConsumer(consumerArn) {
    if (this.consumers.has(consumerArn)) {
      this.consumers.delete(consumerArn);
      this.consumerCount--;
      return true;
    }
    return false;
  }

  /**
   * Obtém consumidor
   */
  getConsumer(consumerArn) {
    return this.consumers.get(consumerArn);
  }

  /**
   * Atualiza estatísticas de incoming records
   */
  recordPutRecord(recordData) {
    this.recordCount++;
    this.incomingRecords++;
    this.incomingBytes += Buffer.byteLength(JSON.stringify(recordData));
    this.lastUpdateTimestamp = new Date().toISOString();
  }

  /**
   * Retorna descrição do stream
   */
  describe() {
    return {
      StreamDescription: {
        StreamName: this.streamName,
        StreamArn: this.streamArn,
        StreamStatus: this.streamStatus,
        StreamModeDetails: this.streamModeDetails,
        StreamCreationTimestamp: this.creationTimestamp,
        Shards: this.shards.map(s => s.toJSON()),
        HasMoreShards: false,
        RetentionPeriod: this.retentionPeriod,
        StreamLastUpdateTimestamp: this.lastUpdateTimestamp,
        EnhancedMonitoring: this.enhancedMonitoring,
        EncryptionType: 'NONE',
        KeyId: null
      }
    };
  }

  toJSON() {
    return {
      streamName: this.streamName,
      streamArn: this.streamArn,
      streamStatus: this.streamStatus,
      streamModeDetails: this.streamModeDetails,
      creationTimestamp: this.creationTimestamp,
      lastUpdateTimestamp: this.lastUpdateTimestamp,
      shardCount: this.shardCount,
      consumerCount: this.consumerCount,
      retentionPeriod: this.retentionPeriod,
      recordCount: this.recordCount,
      incomingRecords: this.incomingRecords,
      incomingBytes: this.incomingBytes
    };
  }
}

/**
 * Shard Model - Partição dentro de um stream
 */
class Shard {
  constructor(shardIndex, streamName) {
    this.shardId = `shardId-${String(shardIndex).padStart(12, '0')}`;
    this.shardName = `${streamName}-shard-${shardIndex}`;
    this.shardStatus = 'ACTIVE';
    this.parentShardId = null;
    this.adjacentParentShardId = null;
    
    // Range de partition keys que este shard cobre
    this.hashKeyRange = {
      startingHashKey: '0',
      endingHashKey: '18446744073709551615' // uint64 max
    };

    // Seqüência de números
    this.sequenceNumberRange = {
      startingSequenceNumber: '0',
      endingSequenceNumber: null
    };

    this.creationTimestamp = new Date().toISOString();
    
    // Records armazenados neste shard
    this.records = [];
    this.recordCount = 0;
    this.lastSequenceNumber = 0;
  }

  /**
   * Adiciona um record ao shard
   */
  addRecord(record) {
    record.sequenceNumber = (++this.lastSequenceNumber).toString();
    this.records.push(record);
    this.recordCount++;
    return record;
  }

  /**
   * Obtém records a partir de um sequence number
   */
  getRecords(startingSequenceNumber = null, limit = 100) {
    let startIndex = 0;
    
    if (startingSequenceNumber) {
      const seqNum = parseInt(startingSequenceNumber);
      startIndex = this.records.findIndex(r => parseInt(r.sequenceNumber) > seqNum);
      if (startIndex === -1) {
        startIndex = this.records.length;
      }
    }

    return this.records.slice(startIndex, startIndex + limit);
  }

  /**
   * Obtém último record
   */
  getLastSequenceNumber() {
    return this.lastSequenceNumber.toString();
  }

  /**
   * Retorna todos os records
   */
  getAllRecords() {
    return this.records;
  }

  toJSON() {
    return {
      ShardId: this.shardId,
      ShardStatus: this.shardStatus,
      HashKeyRange: this.hashKeyRange,
      SequenceNumberRange: this.sequenceNumberRange,
      CreationTimestamp: this.creationTimestamp
    };
  }
}

module.exports = {
  Stream,
  Shard
};
