/**
 * Kinesis Data Firehose Simulator
 * Simulador de Kinesis Data Firehose com suporte a delivery streams e buffering
 */

const { DeliveryStream } = require('./models/delivery-stream');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');
const path = require('path');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');
const { v4: uuidv4 } = require('uuid');

class KinesisFirehoseSimulator {
  constructor(config) {
    this.config = config;
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'kinesis-firehose');

    this.store = new LocalStore(this.dataDir);
    this.deliveryStreams = new Map();
    this.audit = new CloudTrailAudit('firehose.amazonaws.com');

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
    logger.debug('Inicializando Kinesis Data Firehose Simulator...');
    this.loadDeliveryStreams();

    // Cria delivery streams da configuração
    if (this.config['kinesis-firehose']?.deliveryStreams) {
      for (const streamConfig of this.config['kinesis-firehose'].deliveryStreams) {
        if (!this.deliveryStreams.has(streamConfig.name)) {
          this.createDeliveryStream(streamConfig.name, streamConfig);
        }
      }
    }

    logger.debug(`✅ Kinesis Data Firehose Simulator inicializado com ${this.deliveryStreams.size} delivery streams`);
  }

  /**
   * Carrega delivery streams persistidos
   */
  loadDeliveryStreams() {
    const metadata = this.store.read('__delivery_streams__');
    if (!metadata) return;

    for (const [streamName, streamData] of Object.entries(metadata)) {
      const stream = new DeliveryStream(streamName, streamData);
      this.deliveryStreams.set(streamName, stream);
    }

    logger.debug(`Carregados ${this.deliveryStreams.size} delivery streams`);
  }

  /**
   * Persiste metadados de delivery streams
   */
  persistDeliveryStreams() {
    const metadata = {};

    for (const [streamName, stream] of this.deliveryStreams) {
      metadata[streamName] = stream.toJSON();
    }

    this.store.write('__delivery_streams__', metadata);
  }

  /**
   * Cria um novo delivery stream
   */
  createDeliveryStream(deliveryStreamName, config = {}) {
    if (this.deliveryStreams.has(deliveryStreamName)) {
      throw new Error(`DeliveryStream '${deliveryStreamName}' already exists`);
    }

    const stream = new DeliveryStream(deliveryStreamName, config);

    // Adiciona destinos (S3, HTTP, Redshift)
    if (config.s3DestinationConfiguration) {
      stream.addDestination({
        type: 's3',
        destinationId: uuidv4(),
        arn: config.s3DestinationConfiguration.RoleArn,
        bucketArn: config.s3DestinationConfiguration.BucketARN,
        prefix: config.s3DestinationConfiguration.Prefix || '',
        errorOutputPrefix: config.s3DestinationConfiguration.ErrorOutputPrefix || '',
        bufferingHints: {
          sizeInMBs: config.s3DestinationConfiguration.BufferingHints?.SizeInMBs || 128,
          intervalInSeconds: config.s3DestinationConfiguration.BufferingHints?.IntervalInSeconds || 60
        },
        compressionFormat: config.s3DestinationConfiguration.CompressionFormat || 'UNCOMPRESSED',
        destinationStatus: 'ACTIVE'
      });
    }

    if (config.httpEndpointDestinationConfiguration) {
      stream.addDestination({
        type: 'http',
        destinationId: uuidv4(),
        url: config.httpEndpointDestinationConfiguration.EndpointConfiguration?.Url,
        name: config.httpEndpointDestinationConfiguration.EndpointConfiguration?.Name,
        roleArn: config.httpEndpointDestinationConfiguration.RoleARN,
        bufferingHints: {
          sizeInMBs: config.httpEndpointDestinationConfiguration.BufferingHints?.SizeInMBs || 128,
          intervalInSeconds: config.httpEndpointDestinationConfiguration.BufferingHints?.IntervalInSeconds || 60
        },
        processingConfiguration: config.httpEndpointDestinationConfiguration.ProcessingConfiguration || null,
        destinationStatus: 'ACTIVE'
      });
    }

    if (config.redshiftDestinationConfiguration) {
      stream.addDestination({
        type: 'redshift',
        destinationId: uuidv4(),
        clusterArn: config.redshiftDestinationConfiguration.ClusterARN,
        roleArn: config.redshiftDestinationConfiguration.RoleARN,
        username: config.redshiftDestinationConfiguration.Username,
        databaseName: config.redshiftDestinationConfiguration.DatabaseName,
        tableName: config.redshiftDestinationConfiguration.TableName,
        s3DestinationDescription: config.redshiftDestinationConfiguration.S3DestinationConfiguration,
        destinationStatus: 'ACTIVE'
      });
    }

    this.deliveryStreams.set(deliveryStreamName, stream);
    this.persistDeliveryStreams();

    this.audit.record({
      eventName: 'CreateDeliveryStream',
      readOnly: false,
      resources: [{
        ARN: stream.deliveryStreamArn,
        type: 'AWS::Firehose::DeliveryStream'
      }],
      requestParameters: { deliveryStreamName }
    });

    logger.info(`✅ Delivery Stream criado: ${deliveryStreamName}`);

    return {
      DeliveryStreamArn: stream.deliveryStreamArn
    };
  }

  /**
   * Descreve um delivery stream
   */
  describeDeliveryStream(deliveryStreamName) {
    const stream = this.deliveryStreams.get(deliveryStreamName);
    if (!stream) {
      throw new Error(`DeliveryStream '${deliveryStreamName}' not found`);
    }

    return stream.describe();
  }

  /**
   * Lista delivery streams
   */
  listDeliveryStreams(params = {}) {
    const { Limit = 100, ExclusiveStartDeliveryStreamName } = params;
    const streamNames = Array.from(this.deliveryStreams.keys());

    let startIndex = 0;
    if (ExclusiveStartDeliveryStreamName) {
      const index = streamNames.indexOf(ExclusiveStartDeliveryStreamName);
      if (index !== -1) startIndex = index + 1;
    }

    const result = streamNames.slice(startIndex, startIndex + Limit);

    return {
      DeliveryStreamNames: result,
      HasMoreDeliveryStreams: result.length === Limit
    };
  }

  /**
   * Deleta um delivery stream
   */
  deleteDeliveryStream(deliveryStreamName) {
    const stream = this.deliveryStreams.get(deliveryStreamName);
    if (!stream) {
      throw new Error(`DeliveryStream '${deliveryStreamName}' not found`);
    }

    this.deliveryStreams.delete(deliveryStreamName);
    this.persistDeliveryStreams();

    this.audit.record({
      eventName: 'DeleteDeliveryStream',
      readOnly: false,
      resources: [{
        ARN: stream.deliveryStreamArn,
        type: 'AWS::Firehose::DeliveryStream'
      }],
      requestParameters: { deliveryStreamName }
    });

    logger.info(`✅ Delivery Stream deletado: ${deliveryStreamName}`);

    return {};
  }

  /**
   * Coloca um record no delivery stream (PutRecord)
   */
  async putRecord(deliveryStreamName, record) {
    const stream = this.deliveryStreams.get(deliveryStreamName);
    if (!stream) {
      throw new Error(`DeliveryStream '${deliveryStreamName}' not found`);
    }

    return this._withStreamLock(deliveryStreamName, () => {
      const addedRecord = stream.addRecordToBuffer(record.Data);

      this.persistDeliveryStreams();

      this.audit.record({
        eventName: 'PutRecord',
        readOnly: false,
        isDataEvent: true,
        resources: [{
          ARN: stream.deliveryStreamArn,
          type: 'AWS::Firehose::DeliveryStream'
        }],
        requestParameters: { deliveryStreamName }
      });

      return {
        RecordId: addedRecord.recordId,
        Encrypted: false
      };
    });
  }

  /**
   * Coloca múltiplos records no delivery stream (PutRecordBatch)
   */
  async putRecordBatch(deliveryStreamName, records) {
    const stream = this.deliveryStreams.get(deliveryStreamName);
    if (!stream) {
      throw new Error(`DeliveryStream '${deliveryStreamName}' not found`);
    }

    return this._withStreamLock(deliveryStreamName, () => {
      const results = [];
      let failedCount = 0;

      for (const record of records) {
        try {
          const addedRecord = stream.addRecordToBuffer(record.Data);
          results.push({
            RecordId: addedRecord.recordId,
            ErrorCode: null,
            ErrorMessage: null
          });
        } catch (error) {
          failedCount++;
          results.push({
            RecordId: null,
            ErrorCode: 'InternalFailure',
            ErrorMessage: error.message
          });
        }
      }

      this.persistDeliveryStreams();

      this.audit.record({
        eventName: 'PutRecordBatch',
        readOnly: false,
        isDataEvent: true,
        resources: [{
          ARN: stream.deliveryStreamArn,
          type: 'AWS::Firehose::DeliveryStream'
        }],
        requestParameters: { deliveryStreamName, recordCount: records.length }
      });

      return {
        FailedPutCount: failedCount,
        Encrypted: false,
        Records: results
      };
    });
  }

  /**
   * Obtém informações de destino
   */
  describeDestination(deliveryStreamName, destinationId) {
    const stream = this.deliveryStreams.get(deliveryStreamName);
    if (!stream) {
      throw new Error(`DeliveryStream '${deliveryStreamName}' not found`);
    }

    const destination = stream.destinations.find(d => d.destinationId === destinationId);
    if (!destination) {
      throw new Error(`Destination '${destinationId}' not found`);
    }

    return {
      DestinationDescription: destination
    };
  }

  /**
   * Atualiza delivery stream
   */
  updateDeliveryStream(deliveryStreamName, config) {
    const stream = this.deliveryStreams.get(deliveryStreamName);
    if (!stream) {
      throw new Error(`DeliveryStream '${deliveryStreamName}' not found`);
    }

    // Atualiza configurações
    if (config.deliveryStreamStatus) {
      stream.deliveryStreamStatus = config.deliveryStreamStatus;
    }

    if (config.s3DestinationUpdate) {
      const dest = stream.destinations[0];
      if (dest && dest.type === 's3') {
        Object.assign(dest, {
          bufferingHints: config.s3DestinationUpdate.BufferingHints || dest.bufferingHints,
          prefix: config.s3DestinationUpdate.Prefix || dest.prefix
        });
      }
    }

    stream.lastUpdateTimestamp = new Date().toISOString();
    this.persistDeliveryStreams();

    logger.info(`✅ Delivery Stream atualizado: ${deliveryStreamName}`);

    return {};
  }

  /**
   * Obtém estatísticas do simulator
   */
  getStats() {
    const stats = {
      deliveryStreamsCount: this.deliveryStreams.size,
      totalRecords: 0,
      totalDeliveredRecords: 0,
      totalFailedRecords: 0,
      deliveryStreams: []
    };

    for (const [streamName, stream] of this.deliveryStreams) {
      const streamStats = stream.toJSON();
      stats.totalRecords += streamStats.recordCount;
      stats.totalDeliveredRecords += streamStats.deliveredRecordCount;
      stats.totalFailedRecords += streamStats.failedDeliveryRecordCount;
      stats.deliveryStreams.push(streamStats);
    }

    return stats;
  }

  /**
   * Reset - limpa todos os dados
   */
  async reset() {
    this.deliveryStreams.clear();
    this.store.write('__delivery_streams__', {});

    logger.info('✅ Kinesis Data Firehose Simulator resetado');
  }
}

module.exports = KinesisFirehoseSimulator;
