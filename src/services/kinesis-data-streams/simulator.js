/**
 * Kinesis Data Streams Simulator
 * Simulador de Kinesis Data Streams com suporte a shards, records, e consumidores
 */

const { Stream, Shard } = require('./models/stream');
const Record = require('./models/record');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');
const path = require('path');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');
const { v4: uuidv4 } = require('uuid');

class KinesisDataStreamsSimulator {
  constructor(config) {
    this.config = config;
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'kinesis-data-streams');

    this.store = new LocalStore(this.dataDir);
    this.streams = new Map();
    this.consumers = new Map();
    this.audit = new CloudTrailAudit('kinesis.amazonaws.com');

    // Mutexes por stream para operações thread-safe
    this._streamLocks = new Map();
  }

  /**
   * Executa operação com lock exclusivo por stream
   */
  _withStreamLock(streamName, fn) {
    const prev = this._streamLocks.get(streamName) || Promise.resolve();
    const next = prev.then(() => fn());
    this._streamLocks.set(streamName, next.catch(() => {}));
    return next;
  }

  async initialize() {
    logger.debug('Inicializando Kinesis Data Streams Simulator...');
    this.loadStreams();
    
    // Cria streams da configuração se não existirem
    if (this.config['kinesis-data-streams']?.streams) {
      for (const streamConfig of this.config['kinesis-data-streams'].streams) {
        if (!this.streams.has(streamConfig.name)) {
          this.createStream(streamConfig.name, streamConfig);
        }
      }
    }

    logger.debug(`✅ Kinesis Data Streams Simulator inicializado com ${this.streams.size} streams`);
  }

  /**
   * Carrega streams persistidos
   */
  loadStreams() {
    const metadata = this.store.read('__streams__');
    if (!metadata) return;

    for (const [streamName, streamData] of Object.entries(metadata)) {
      const stream = new Stream(streamName, streamData);
      stream.shards = streamData.shards.map(shardData => {
        const shard = new Shard(0, streamName);
        shard.shardId = shardData.shardId;
        shard.shardStatus = shardData.shardStatus;
        shard.records = (streamData.records || []).filter(r => r.shardId === shard.shardId);
        shard.recordCount = shard.records.length;
        shard.lastSequenceNumber = shardData.lastSequenceNumber || 0;
        return shard;
      });
      this.streams.set(streamName, stream);
    }

    logger.debug(`Carregados ${this.streams.size} streams`);
  }

  /**
   * Persiste metadados de streams
   */
  persistStreams() {
    const metadata = {};

    for (const [streamName, stream] of this.streams) {
      metadata[streamName] = {
        streamName: stream.streamName,
        streamStatus: stream.streamStatus,
        streamModeDetails: stream.streamModeDetails,
        shardCount: stream.shardCount,
        creationTimestamp: stream.creationTimestamp,
        retentionPeriod: stream.retentionPeriod,
        shards: stream.shards.map(s => ({
          shardId: s.shardId,
          shardStatus: s.shardStatus,
          lastSequenceNumber: s.lastSequenceNumber
        })),
        records: Array.from(stream.shards).flatMap(s => 
          s.records.map(r => ({
            recordId: r.recordId,
            shardId: s.shardId,
            data: r.data,
            partitionKey: r.partitionKey,
            sequenceNumber: r.sequenceNumber,
            timestamp: r.timestamp
          }))
        )
      };
    }

    this.store.write('__streams__', metadata);
  }

  /**
   * Cria um novo stream
   */
  createStream(streamName, config = {}) {
    if (this.streams.has(streamName)) {
      throw new Error(`Stream '${streamName}' already exists`);
    }

    const stream = new Stream(streamName, config);
    this.streams.set(streamName, stream);
    this.persistStreams();

    this.audit.record({
      eventName: 'CreateStream',
      readOnly: false,
      resources: [{
        ARN: stream.streamArn,
        type: 'AWS::Kinesis::Stream'
      }],
      requestParameters: { streamName, shardCount: stream.shardCount }
    });

    logger.info(`✅ Stream criado: ${streamName}`);

    return {
      StreamDescription: stream.describe().StreamDescription
    };
  }

  /**
   * Descreve um stream
   */
  describeStream(streamName) {
    const stream = this.streams.get(streamName);
    if (!stream) {
      throw new Error(`Stream '${streamName}' not found`);
    }

    return stream.describe();
  }

  /**
   * Lista todos os streams
   */
  listStreams(params = {}) {
    const { Limit = 100, ExclusiveStartStreamName } = params;
    const streamNames = Array.from(this.streams.keys());

    let startIndex = 0;
    if (ExclusiveStartStreamName) {
      const index = streamNames.indexOf(ExclusiveStartStreamName);
      if (index !== -1) startIndex = index + 1;
    }

    const result = streamNames.slice(startIndex, startIndex + Limit);

    return {
      StreamNames: result,
      HasMoreStreams: result.length === Limit,
      StreamCreationTimestamps: result.map(name => {
        const stream = this.streams.get(name);
        return stream?.creationTimestamp || new Date().toISOString();
      }),
      StreamStatuses: result.map(() => 'ACTIVE')
    };
  }

  /**
   * Deleta um stream
   */
  deleteStream(streamName) {
    const stream = this.streams.get(streamName);
    if (!stream) {
      throw new Error(`Stream '${streamName}' not found`);
    }

    this.streams.delete(streamName);
    this.persistStreams();

    // Remove consumidores do stream
    for (const [consumerArn] of this.consumers) {
      if (consumerArn.includes(streamName)) {
        this.consumers.delete(consumerArn);
      }
    }

    this.audit.record({
      eventName: 'DeleteStream',
      readOnly: false,
      resources: [{
        ARN: stream.streamArn,
        type: 'AWS::Kinesis::Stream'
      }],
      requestParameters: { streamName }
    });

    logger.info(`✅ Stream deletado: ${streamName}`);

    return {};
  }

  /**
   * Coloca um record no stream
   */
  async putRecord(streamName, data, partitionKey, config = {}) {
    const stream = this.streams.get(streamName);
    if (!stream) {
      throw new Error(`Stream '${streamName}' not found`);
    }

    return this._withStreamLock(streamName, () => {
      const shard = stream.selectShardByPartitionKey(partitionKey);
      if (!shard) {
        throw new Error(`No shards available in stream '${streamName}'`);
      }

      const record = new Record(data, partitionKey, {
        shardId: shard.shardId,
        encryptionType: config.encryptionType || 'NONE'
      });

      shard.addRecord(record);
      stream.recordPutRecord(data);
      this.persistStreams();

      this.audit.record({
        eventName: 'PutRecord',
        readOnly: false,
        isDataEvent: true,
        resources: [{
          ARN: stream.streamArn,
          type: 'AWS::Kinesis::Stream'
        }],
        requestParameters: { streamName, partitionKey }
      });

      return {
        ShardId: shard.shardId,
        SequenceNumber: record.sequenceNumber,
        EncryptionType: record.encryptionType
      };
    });
  }

  /**
   * Coloca múltiplos records no stream
   */
  async putRecords(streamName, records) {
    const stream = this.streams.get(streamName);
    if (!stream) {
      throw new Error(`Stream '${streamName}' not found`);
    }

    return this._withStreamLock(streamName, () => {
      const results = [];
      let failedRecordCount = 0;

      for (const recordData of records) {
        try {
          const shard = stream.selectShardByPartitionKey(recordData.PartitionKey);
          const record = new Record(recordData.Data, recordData.PartitionKey, {
            shardId: shard.shardId
          });

          shard.addRecord(record);
          stream.recordPutRecord(recordData.Data);

          results.push({
            ShardId: shard.shardId,
            SequenceNumber: record.sequenceNumber
          });
        } catch (error) {
          failedRecordCount++;
          results.push({
            ErrorCode: 'InternalFailure',
            ErrorMessage: error.message
          });
        }
      }

      this.persistStreams();

      this.audit.record({
        eventName: 'PutRecords',
        readOnly: false,
        isDataEvent: true,
        resources: [{
          ARN: stream.streamArn,
          type: 'AWS::Kinesis::Stream'
        }],
        requestParameters: { streamName, recordCount: records.length }
      });

      return {
        FailedRecordCount: failedRecordCount,
        Records: results
      };
    });
  }

  /**
   * Obtém records de um shard
   */
  getRecords(shardIterator, config = {}) {
    const { Limit = 100 } = config;
    
    // Parse iterator (formato simplificado: streamName:shardId:startSeqNum)
    const [streamName, shardId, startSeqNum] = shardIterator.split(':');

    const stream = this.streams.get(streamName);
    if (!stream) {
      throw new Error(`Stream '${streamName}' not found`);
    }

    const shard = stream.getShard(shardId);
    if (!shard) {
      throw new Error(`Shard '${shardId}' not found in stream '${streamName}'`);
    }

    const records = shard.getRecords(startSeqNum, Limit);
    const lastSeqNum = shard.getLastSequenceNumber();

    // Gera novo iterator
    const nextSeqNum = records.length > 0 
      ? parseInt(records[records.length - 1].sequenceNumber)
      : parseInt(startSeqNum || 0);

    const nextShardIterator = `${streamName}:${shardId}:${nextSeqNum}`;

    this.audit.record({
      eventName: 'GetRecords',
      readOnly: true,
      isDataEvent: true,
      resources: [{
        ARN: stream.streamArn,
        type: 'AWS::Kinesis::Stream'
      }],
      requestParameters: { streamName, shardId }
    });

    return {
      Records: records.map(r => r.toJSON()),
      NextShardIterator: nextShardIterator,
      MillisBehindLatest: 0
    };
  }

  /**
   * Obtém shard iterator
   */
  getSharIterator(streamName, shardId, shardIteratorType, config = {}) {
    const stream = this.streams.get(streamName);
    if (!stream) {
      throw new Error(`Stream '${streamName}' not found`);
    }

    const shard = stream.getShard(shardId);
    if (!shard) {
      throw new Error(`Shard '${shardId}' not found in stream '${streamName}'`);
    }

    let startSeqNum = '0';

    switch (shardIteratorType) {
      case 'TRIM_HORIZON':
        startSeqNum = '0';
        break;
      case 'LATEST':
        startSeqNum = shard.getLastSequenceNumber();
        break;
      case 'AT_SEQUENCE_NUMBER':
        startSeqNum = config.StartingSequenceNumber || '0';
        break;
      case 'AFTER_SEQUENCE_NUMBER':
        startSeqNum = (parseInt(config.StartingSequenceNumber || '0') + 1).toString();
        break;
      case 'AT_TIMESTAMP':
        // Implementação simplificada
        startSeqNum = '0';
        break;
      default:
        throw new Error(`Invalid ShardIteratorType: ${shardIteratorType}`);
    }

    const shardIterator = `${streamName}:${shardId}:${startSeqNum}`;

    return {
      ShardIterator: shardIterator
    };
  }

  /**
   * Registra um consumidor
   */
  registerStreamConsumer(streamArn, consumerName) {
    const streamName = streamArn.split(':').pop();
    const stream = this.streams.get(streamName);
    
    if (!stream) {
      throw new Error(`Stream not found: ${streamName}`);
    }

    const consumerArn = `${streamArn}/consumer/${consumerName}:${uuidv4().substring(0, 8)}`;
    const consumer = stream.registerConsumer(consumerArn, consumerName);

    this.consumers.set(consumerArn, {
      consumerArn,
      consumerName,
      streamArn,
      streamName,
      creationTimestamp: new Date().toISOString(),
      consumerStatus: 'ACTIVE'
    });

    logger.info(`✅ Consumidor registrado: ${consumerName} para stream ${streamName}`);

    return {
      Consumer: {
        ConsumerName: consumerName,
        ConsumerArn: consumerArn,
        ConsumerStatus: 'ACTIVE',
        ConsumerCreationTimestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Descreve um consumidor
   */
  describeStreamConsumer(consumerArn) {
    const consumer = this.consumers.get(consumerArn);
    if (!consumer) {
      throw new Error(`Consumer not found: ${consumerArn}`);
    }

    return {
      ConsumerDescription: {
        ConsumerName: consumer.consumerName,
        ConsumerArn: consumer.consumerArn,
        ConsumerStatus: consumer.consumerStatus,
        ConsumerCreationTimestamp: consumer.creationTimestamp
      }
    };
  }

  /**
   * Lista consumidores
   */
  listStreamConsumers(streamArn) {
    const streamName = streamArn.split(':').pop();
    const consumers = Array.from(this.consumers.values())
      .filter(c => c.streamName === streamName);

    return {
      Consumers: consumers.map(c => ({
        ConsumerName: c.consumerName,
        ConsumerArn: c.consumerArn,
        ConsumerStatus: c.consumerStatus,
        ConsumerCreationTimestamp: c.creationTimestamp
      }))
    };
  }

  /**
   * Obtém estatísticas do simulator
   */
  getStats() {
    const stats = {
      streamsCount: this.streams.size,
      consumersCount: this.consumers.size,
      totalRecords: 0,
      totalShards: 0,
      streams: []
    };

    for (const [streamName, stream] of this.streams) {
      const streamStats = stream.toJSON();
      stats.totalRecords += streamStats.recordCount;
      stats.totalShards += stream.shards.length;
      stats.streams.push({
        ...streamStats,
        shardCount: stream.shards.length
      });
    }

    return stats;
  }

  /**
   * Reset - limpa todos os dados
   */
  async reset() {
    this.streams.clear();
    this.consumers.clear();
    this.store.write('__streams__', {});
    
    logger.info('✅ Kinesis Data Streams Simulator resetado');
  }
}

module.exports = KinesisDataStreamsSimulator;
