/**
 * Kinesis Data Firehose Server - Servidor HTTP REST/JSON para Firehose
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');

class KinesisFirehoseServer {
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
      const target = req.headers['x-amz-target'];
      if (target) {
        const [, action] = target.split('.');
        req.action = action;
      }

      logger.debug(`Kinesis Firehose: ${req.method} ${req.path} - Action: ${req.action || 'none'}`);
      next();
    });
  }

  async initialize() {
    logger.debug(`Inicializando Kinesis Firehose Server na porta ${this.port}`);
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.post('/', (req, res) => {
      const action = req.action || req.body.Action;

      try {
        switch (action) {
          case 'CreateDeliveryStream':
            return this.createDeliveryStream(req, res);
          case 'DescribeDeliveryStream':
            return this.describeDeliveryStream(req, res);
          case 'ListDeliveryStreams':
            return this.listDeliveryStreams(req, res);
          case 'DeleteDeliveryStream':
            return this.deleteDeliveryStream(req, res);
          case 'PutRecord':
            return this.putRecord(req, res);
          case 'PutRecordBatch':
            return this.putRecordBatch(req, res);
          case 'UpdateDeliveryStream':
            return this.updateDeliveryStream(req, res);
          case 'DescribeDestination':
            return this.describeDestination(req, res);
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
        service: 'kinesis-firehose',
        port: this.port,
        stats: this.simulator.getStats()
      });
    });
  }

  async createDeliveryStream(req, res) {
    const {
      DeliveryStreamName,
      DeliveryStreamType = 'DirectPut',
      S3DestinationConfiguration,
      HttpEndpointDestinationConfiguration,
      RedshiftDestinationConfiguration
    } = req.body;

    if (!DeliveryStreamName) {
      throw new Error('DeliveryStreamName is required');
    }

    const result = await this.simulator.createDeliveryStream(DeliveryStreamName, {
      deliveryStreamType: DeliveryStreamType,
      s3DestinationConfiguration: S3DestinationConfiguration,
      httpEndpointDestinationConfiguration: HttpEndpointDestinationConfiguration,
      redshiftDestinationConfiguration: RedshiftDestinationConfiguration
    });

    res.status(201).json(result);
  }

  async describeDeliveryStream(req, res) {
    const { DeliveryStreamName } = req.body;

    if (!DeliveryStreamName) {
      throw new Error('DeliveryStreamName is required');
    }

    const result = this.simulator.describeDeliveryStream(DeliveryStreamName);
    res.json(result);
  }

  async listDeliveryStreams(req, res) {
    const { Limit, ExclusiveStartDeliveryStreamName } = req.body;

    const result = this.simulator.listDeliveryStreams({
      Limit,
      ExclusiveStartDeliveryStreamName
    });

    res.json(result);
  }

  async deleteDeliveryStream(req, res) {
    const { DeliveryStreamName } = req.body;

    if (!DeliveryStreamName) {
      throw new Error('DeliveryStreamName is required');
    }

    const result = await this.simulator.deleteDeliveryStream(DeliveryStreamName);
    res.json(result);
  }

  async putRecord(req, res) {
    const { DeliveryStreamName, Record } = req.body;

    if (!DeliveryStreamName || !Record) {
      throw new Error('DeliveryStreamName and Record are required');
    }

    const result = await this.simulator.putRecord(DeliveryStreamName, Record);
    res.json(result);
  }

  async putRecordBatch(req, res) {
    const { DeliveryStreamName, Records } = req.body;

    if (!DeliveryStreamName || !Records || !Array.isArray(Records)) {
      throw new Error('DeliveryStreamName and Records array are required');
    }

    const result = await this.simulator.putRecordBatch(DeliveryStreamName, Records);
    res.json(result);
  }

  async updateDeliveryStream(req, res) {
    const { DeliveryStreamName, ...config } = req.body;

    if (!DeliveryStreamName) {
      throw new Error('DeliveryStreamName is required');
    }

    const result = this.simulator.updateDeliveryStream(DeliveryStreamName, config);
    res.json(result);
  }

  async describeDestination(req, res) {
    const { DeliveryStreamName, DestinationId } = req.body;

    if (!DeliveryStreamName || !DestinationId) {
      throw new Error('DeliveryStreamName and DestinationId are required');
    }

    const result = this.simulator.describeDestination(DeliveryStreamName, DestinationId);
    res.json(result);
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info(`✅ Kinesis Firehose Server iniciado na porta ${this.port}`);
          resolve();
        });
      } catch (error) {
        logger.error(`❌ Erro ao iniciar Kinesis Firehose Server: ${error.message}`);
        reject(error);
      }
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            logger.error(`Erro ao parar Kinesis Firehose Server: ${err.message}`);
            reject(err);
          } else {
            logger.info('Kinesis Firehose Server parado');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = KinesisFirehoseServer;
