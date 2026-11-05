/**
 * Kinesis Data Firehose - DeliveryStream Model
 * Representa um stream de entrega (delivery stream)
 */

const { v4: uuidv4 } = require('uuid');

class DeliveryStream {
  constructor(deliveryStreamName, config = {}) {
    this.deliveryStreamName = deliveryStreamName;
    this.deliveryStreamArn = `arn:aws:firehose:us-east-1:123456789012:deliverystream/${deliveryStreamName}`;
    this.deliveryStreamStatus = 'ACTIVE';
    this.deliveryStreamType = config.deliveryStreamType || 'DirectPut';
    this.deliveryStreamCreationTimestamp = new Date().toISOString();
    this.lastUpdateTimestamp = new Date().toISOString();

    // Fonte de dados (pode ser Kinesis Data Stream)
    this.sourceDescription = config.sourceDescription || null;

    // Destinos (S3, HTTP, Redshift, etc)
    this.destinations = [];
    this.failedDestinationCount = 0;

    // Configurações de destino
    this.s3DestinationDescription = config.s3DestinationDescription || null;
    this.httpDestinationDescription = config.httpDestinationDescription || null;
    this.redshiftDestinationDescription = config.redshiftDestinationDescription || null;

    // Versão
    this.versionId = config.versionId || '1';

    // Buffer de entrega
    this.deliveryBuffer = new DeliveryBuffer();

    // Estatísticas
    this.recordCount = 0;
    this.deliveredRecordCount = 0;
    this.failedDeliveryRecordCount = 0;
    this.incomingRecords = 0;
    this.incomingBytes = 0;
    this.deliveredBytes = 0;

    // Tags
    this.tags = config.tags || {};
  }

  /**
   * Adiciona destino
   */
  addDestination(destination) {
    this.destinations.push(destination);
    if (destination.type === 's3') {
      this.s3DestinationDescription = destination;
    } else if (destination.type === 'http') {
      this.httpDestinationDescription = destination;
    } else if (destination.type === 'redshift') {
      this.redshiftDestinationDescription = destination;
    }
    this.lastUpdateTimestamp = new Date().toISOString();
  }

  /**
   * Obtém primeira destination
   */
  getFirstDestination() {
    return this.destinations[0] || null;
  }

  /**
   * Adiciona record ao buffer
   */
  addRecordToBuffer(recordData) {
    if (!recordData) {
      throw new Error('recordData is required');
    }

    const record = {
      recordId: uuidv4(),
      data: recordData,
      timestamp: new Date().toISOString(),
      deliveryAttempts: 0,
      deliveryStatus: 'PENDING'
    };

    this.deliveryBuffer.addRecord(record);
    this.recordCount++;
    this.incomingRecords++;
    
    // Calcula tamanho do record
    try {
      const dataStr = typeof recordData === 'string' ? recordData : JSON.stringify(recordData);
      this.incomingBytes += Buffer.byteLength(dataStr);
    } catch (e) {
      // Fallback para tamanho aproximado se conversão falhar
      this.incomingBytes += 100;
    }

    return record;
  }

  /**
   * Obtém records pendentes do buffer
   */
  getPendingRecords(limit = 500) {
    return this.deliveryBuffer.getPendingRecords(limit);
  }

  /**
   * Marca record como entregue
   */
  markRecordAsDelivered(recordId) {
    const record = this.deliveryBuffer.getRecord(recordId);
    if (record) {
      record.deliveryStatus = 'DELIVERED';
      this.deliveredRecordCount++;
      this.deliveredBytes += Buffer.byteLength(JSON.stringify(record.data));
      this.lastUpdateTimestamp = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Marca record como falha de entrega
   */
  markRecordAsFailed(recordId) {
    const record = this.deliveryBuffer.getRecord(recordId);
    if (record) {
      record.deliveryAttempts++;
      record.deliveryStatus = 'FAILED';
      this.failedDeliveryRecordCount++;
      this.lastUpdateTimestamp = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Retorna descrição do delivery stream
   */
  describe() {
    return {
      DeliveryStreamDescription: {
        DeliveryStreamName: this.deliveryStreamName,
        DeliveryStreamArn: this.deliveryStreamArn,
        DeliveryStreamStatus: this.deliveryStreamStatus,
        DeliveryStreamType: this.deliveryStreamType,
        VersionId: this.versionId,
        CreationTimestamp: this.deliveryStreamCreationTimestamp,
        LastUpdateTimestamp: this.lastUpdateTimestamp,
        Source: this.sourceDescription,
        Destinations: this.destinations.map(d => ({
          DestinationId: d.destinationId || 'destination-1',
          DestinationStatus: d.destinationStatus || 'ACTIVE',
          S3DestinationDescription: d.type === 's3' ? d : undefined,
          HttpEndpointDestinationDescription: d.type === 'http' ? d : undefined,
          RedshiftDestinationDescription: d.type === 'redshift' ? d : undefined
        })),
        HasMoreDestinations: false,
        FailureDescription: null
      }
    };
  }

  toJSON() {
    return {
      deliveryStreamName: this.deliveryStreamName,
      deliveryStreamArn: this.deliveryStreamArn,
      deliveryStreamStatus: this.deliveryStreamStatus,
      deliveryStreamType: this.deliveryStreamType,
      creationTimestamp: this.deliveryStreamCreationTimestamp,
      lastUpdateTimestamp: this.lastUpdateTimestamp,
      recordCount: this.recordCount,
      deliveredRecordCount: this.deliveredRecordCount,
      failedDeliveryRecordCount: this.failedDeliveryRecordCount,
      incomingRecords: this.incomingRecords,
      incomingBytes: this.incomingBytes,
      deliveredBytes: this.deliveredBytes
    };
  }
}

/**
 * DeliveryBuffer Model - Buffer de records a serem entregues
 */
class DeliveryBuffer {
  constructor(config = {}) {
    this.bufferSizeMB = config.bufferSizeMB || 128;
    this.bufferIntervalSeconds = config.bufferIntervalSeconds || 60;
    this.records = new Map();
    this.createdAt = new Date();
    this.lastFlushTime = new Date();
  }

  /**
   * Adiciona record ao buffer
   */
  addRecord(record) {
    this.records.set(record.recordId, record);
  }

  /**
   * Obtém record
   */
  getRecord(recordId) {
    return this.records.get(recordId);
  }

  /**
   * Obtém records pendentes
   */
  getPendingRecords(limit = 500) {
    const pending = Array.from(this.records.values())
      .filter(r => r.deliveryStatus === 'PENDING')
      .slice(0, limit);
    return pending;
  }

  /**
   * Obtém todos os records
   */
  getAllRecords() {
    return Array.from(this.records.values());
  }

  /**
   * Remove record
   */
  removeRecord(recordId) {
    return this.records.delete(recordId);
  }

  /**
   * Limpa buffer (para reset)
   */
  clear() {
    this.records.clear();
    this.createdAt = new Date();
    this.lastFlushTime = new Date();
  }

  /**
   * Obtém estatísticas do buffer
   */
  getStats() {
    const records = Array.from(this.records.values());
    const totalRecords = records.length;
    const pendingRecords = records.filter(r => r.deliveryStatus === 'PENDING').length;
    const deliveredRecords = records.filter(r => r.deliveryStatus === 'DELIVERED').length;
    const failedRecords = records.filter(r => r.deliveryStatus === 'FAILED').length;

    return {
      totalRecords,
      pendingRecords,
      deliveredRecords,
      failedRecords,
      bufferAge: Date.now() - this.createdAt.getTime()
    };
  }
}

module.exports = {
  DeliveryStream,
  DeliveryBuffer
};
