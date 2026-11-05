/**
 * Kinesis Data Streams Server - Servidor HTTP REST/JSON para Kinesis
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');

class KinesisDataStreamsServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.simulator = null;
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));

    // Custom header parsing para AWS SDK
    this.app.use((req, res, next) => {
      // Parsa target header (X-Amz-Target: Kinesis_20131202.DescribeStream)
      const target = req.headers['x-amz-target'];
      if (target) {
        const [, action] = target.split('.');
        req.action = action;
      }

      logger.debug(`Kinesis Data Streams: ${req.method} ${req.path} - Action: ${req.action || 'none'}`);
      next();
    });
  }

  async initialize() {
    logger.debug(`Inicializando Kinesis Data Streams Server na porta ${this.port}`);
    this.setupRoutes();
  }

  setupRoutes() {
    // Rota padrão para operações (AWS SDK usa POST com X-Amz-Target)
    this.app.post('/', (req, res) => {
      const action = req.action || req.body.Action;

      try {
        switch (action) {
          case 'CreateStream':
            return this.createStream(req, res);
          case 'DescribeStream':
            return this.describeStream(req, res);
          case 'ListStreams':
            return this.listStreams(req, res);
          case 'DeleteStream':
            return this.deleteStream(req, res);
          case 'PutRecord':
            return this.putRecord(req, res);
          case 'PutRecords':
            return this.putRecords(req, res);
          case 'GetRecords':
            return this.getRecords(req, res);
          case 'GetShardIterator':
            return this.getShardIterator(req, res);
          case 'RegisterStreamConsumer':
            return this.registerStreamConsumer(req, res);
          case 'DescribeStreamConsumer':
            return this.describeStreamConsumer(req, res);
          case 'ListStreamConsumers':
            return this.listStreamConsumers(req, res);
          default:
            res.status(400).json({ __type: 'UnknownAction', message: `Unknown action: ${action}` });
        }
      } catch (error) {
        res.status(400).json({ __type: 'InternalFailure', message: error.message });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'kinesis-data-streams',
        port: this.port,
        stats: this.simulator.getStats()
      });
    });
  }

  async createStream(req, res) {
    const { StreamName, ShardCount = 1, StreamModeDetails } = req.body;

    if (!StreamName) {
      throw new Error('StreamName is required');
    }

    const result = await this.simulator.createStream(StreamName, {
      shardCount: ShardCount,
      streamMode: StreamModeDetails?.StreamMode || 'PROVISIONED'
    });

    res.status(201).json(result);
  }

  async describeStream(req, res) {
    const { StreamName } = req.body;

    if (!StreamName) {
      throw new Error('StreamName is required');
    }

    const result = this.simulator.describeStream(StreamName);
    res.json(result);
  }

  async listStreams(req, res) {
    const { Limit, ExclusiveStartStreamName } = req.body;

    const result = this.simulator.listStreams({
      Limit,
      ExclusiveStartStreamName
    });

    res.json(result);
  }

  async deleteStream(req, res) {
    const { StreamName } = req.body;

    if (!StreamName) {
      throw new Error('StreamName is required');
    }

    const result = await this.simulator.deleteStream(StreamName);
    res.json(result);
  }

  async putRecord(req, res) {
    const { StreamName, Data, PartitionKey, ExplicitHashKey } = req.body;

    if (!StreamName || !Data || !PartitionKey) {
      throw new Error('StreamName, Data, and PartitionKey are required');
    }

    const result = await this.simulator.putRecord(StreamName, Data, PartitionKey, {
      explicitHashKey: ExplicitHashKey
    });

    res.json(result);
  }

  async putRecords(req, res) {
    const { StreamName, Records } = req.body;

    if (!StreamName || !Records || !Array.isArray(Records)) {
      throw new Error('StreamName and Records array are required');
    }

    const result = await this.simulator.putRecords(StreamName, Records);
    res.json(result);
  }

  async getRecords(req, res) {
    const { ShardIterator, Limit } = req.body;

    if (!ShardIterator) {
      throw new Error('ShardIterator is required');
    }

    const result = this.simulator.getRecords(ShardIterator, { Limit });
    res.json(result);
  }

  async getShardIterator(req, res) {
    const { StreamName, ShardId, ShardIteratorType, StartingSequenceNumber, Timestamp } = req.body;

    if (!StreamName || !ShardId || !ShardIteratorType) {
      throw new Error('StreamName, ShardId, and ShardIteratorType are required');
    }

    const result = this.simulator.getSharIterator(StreamName, ShardId, ShardIteratorType, {
      StartingSequenceNumber,
      Timestamp
    });

    res.json(result);
  }

  async registerStreamConsumer(req, res) {
    const { StreamArn, ConsumerName } = req.body;

    if (!StreamArn || !ConsumerName) {
      throw new Error('StreamArn and ConsumerName are required');
    }

    const result = this.simulator.registerStreamConsumer(StreamArn, ConsumerName);
    res.status(201).json(result);
  }

  async describeStreamConsumer(req, res) {
    const { ConsumerArn } = req.body;

    if (!ConsumerArn) {
      throw new Error('ConsumerArn is required');
    }

    const result = this.simulator.describeStreamConsumer(ConsumerArn);
    res.json(result);
  }

  async listStreamConsumers(req, res) {
    const { StreamArn } = req.body;

    if (!StreamArn) {
      throw new Error('StreamArn is required');
    }

    const result = this.simulator.listStreamConsumers(StreamArn);
    res.json(result);
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info(`✅ Kinesis Data Streams Server iniciado na porta ${this.port}`);
          resolve();
        });
      } catch (error) {
        logger.error(`❌ Erro ao iniciar Kinesis Data Streams Server: ${error.message}`);
        reject(error);
      }
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            logger.error(`Erro ao parar Kinesis Data Streams Server: ${err.message}`);
            reject(err);
          } else {
            logger.info('Kinesis Data Streams Server parado');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = KinesisDataStreamsServer;
