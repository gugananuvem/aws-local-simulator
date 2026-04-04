/**
 * SQS Server - Servidor HTTP para SQS
 */

const express = require('express');
const crypto = require('crypto');
const SQSSimulator = require('./simulator');
const logger = require('../../utils/logger');

class SQSServer {
  constructor(port, config, lambdaService) {
    this.port = port;
    this.config = config;
    this.lambdaService = lambdaService;
    this.app = express();
    this.simulator = null;
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(express.json({ type: ['application/json', 'application/x-amz-json-1.0'] }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Logging de requisições
    if (logger.currentLogLevel === 'verboso') {
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.verboso(`SQS: ${req.query.Action || req.method} - ${duration}ms`);
        });
        next();
      });
    }
  }

  async initialize() {
    this.simulator = new SQSSimulator(this.config, this.lambdaService);
    await this.simulator.initialize();
    this.setupRoutes();
  }

  setupRoutes() {
    // Endpoint principal
    this.app.use((req, res, next) => {
      logger.info(`SQS incoming: ${req.method} ${req.path} headers=${JSON.stringify(req.headers)} query=${JSON.stringify(req.query)} body=${JSON.stringify(req.body)}`);
      next();
    });

    this.app.post('/', (req, res) => {
      const action = req.query.Action || req.body.Action ||
        (req.headers['x-amz-target'] && req.headers['x-amz-target'].split('.')[1]);
      logger.info(`SQS action resolved: ${action}`);
      const result = this.simulator.handleRequest(action, req, res);
      const isJsonProtocol = req.headers['content-type'] && req.headers['content-type'].includes('application/x-amz-json-1.0');

      if (result && result.error) {
        const isJsonProtocol = req.headers['content-type'] && req.headers['content-type'].includes('application/x-amz-json-1.0');
        if (isJsonProtocol) {
          res.status(result.status).json({ __type: result.error.code, message: result.error.message });
        } else {
          res.status(result.status).send(this.simulator.generateErrorResponse(result.error.code, result.error.message));
        }
      } else if (result) {
        if (isJsonProtocol) {
          res.set('Content-Type', 'application/x-amz-json-1.0');
          res.json(this.generateJsonResponse(action, result));
        } else {
          const xml = this.generateResponse(action, result);
          logger.info(`SQS response for ${action}: ${xml}`);
          res.set('Content-Type', 'application/xml');
          res.send(xml);
        }
      }
    });
    
    // Endpoint alternativo com nome da fila
    this.app.post('/queue/:queueName', (req, res) => {
      const action = req.query.Action;
      if (action) {
        // Adiciona o nome da fila ao body
        req.body.QueueName = req.params.queueName;
        this.app.handle(req, res);
      } else {
        res.status(400).send(this.simulator.generateErrorResponse('InvalidAction', 'Missing Action parameter'));
      }
    });
    
    // Admin endpoints
    this.setupAdminRoutes();
  }

  setupAdminRoutes() {
    this.app.get('/__admin/queues', (req, res) => {
      res.json(this.simulator.listQueues());
    });
    
    this.app.get('/__admin/queues/:queueName', (req, res) => {
      const queue = this.simulator.getQueue(req.params.queueName);
      if (queue) {
        res.json(queue);
      } else {
        res.status(404).json({ error: 'Queue not found' });
      }
    });
    
    this.app.get('/__admin/queues/:queueName/messages', (req, res) => {
      const messages = this.simulator.getMessages(req.params.queueName);
      res.json(messages);
    });
    
    this.app.delete('/__admin/queues/:queueName', (req, res) => {
      this.simulator.deleteQueue(req.params.queueName);
      res.json({ message: `Queue ${req.params.queueName} deleted` });
    });
    
    this.app.delete('/__admin/queues/:queueName/messages', (req, res) => {
      this.simulator.purgeQueue(req.params.queueName);
      res.json({ message: `Queue ${req.params.queueName} purged` });
    });
    
    this.app.get('/__admin/stats', (req, res) => {
      res.json(this.simulator.getStats());
    });
  }

  generateJsonResponse(action, result) {
    switch (action) {
      case 'CreateQueue':
        return { QueueUrl: result.queueUrl };
      case 'SendMessage':
        return { MD5OfMessageBody: result.md5, MessageId: result.messageId };
      case 'SendMessageBatch':
        return {
          Successful: (result.successful || []).map(s => ({ Id: s.Id, MessageId: s.MessageId, MD5OfMessageBody: s.MD5OfMessageBody })),
          Failed: result.failed || []
        };
      case 'ReceiveMessage':
        return {
          Messages: (result.messages || []).map(m => ({
            MessageId: m.MessageId,
            ReceiptHandle: m.ReceiptHandle,
            MD5OfBody: m.MD5OfBody,
            Body: m.Body
          }))
        };
      case 'DeleteMessage':
        return {};
      case 'GetQueueUrl':
        return { QueueUrl: result.queueUrl };
      case 'ListQueues':
        return { QueueUrls: (result.queues || []).map(q => q.url) };
      default:
        return result;
    }
  }

  generateResponse(action, result) {
    switch(action) {
      case 'CreateQueue':
        return this.generateCreateQueueResponse(result.queueUrl);
      case 'SendMessage':
        return this.generateSendMessageResponse(result.messageId, result.md5);
      case 'SendMessageBatch':
        return this.generateSendMessageBatchResponse(result.successful, result.failed);
      case 'ReceiveMessage':
        return this.generateReceiveMessageResponse(result.messages);
      case 'DeleteMessage':
        return this.generateDeleteMessageResponse();
      case 'GetQueueUrl':
        return this.generateGetQueueUrlResponse(result.queueUrl);
      case 'ListQueues':
        return this.generateListQueuesResponse(result.queues);
      default:
        return '';
    }
  }

  generateCreateQueueResponse(queueUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<CreateQueueResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <CreateQueueResult>
    <QueueUrl>${queueUrl}</QueueUrl>
  </CreateQueueResult>
  <ResponseMetadata><RequestId>${crypto.randomUUID()}</RequestId></ResponseMetadata>
</CreateQueueResponse>`;
  }

  generateSendMessageResponse(messageId, md5) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<SendMessageResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <SendMessageResult>
    <MD5OfMessageBody>${md5}</MD5OfMessageBody>
    <MessageId>${messageId}</MessageId>
  </SendMessageResult>
  <ResponseMetadata><RequestId>${crypto.randomUUID()}</RequestId></ResponseMetadata>
</SendMessageResponse>`;
  }

  generateSendMessageBatchResponse(successful, failed) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<SendMessageBatchResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <SendMessageBatchResult>`;
    
    for (const s of successful) {
      xml += `
    <SendMessageBatchResultEntry>
      <Id>${s.Id}</Id>
      <MessageId>${s.MessageId}</MessageId>
      <MD5OfMessageBody>${s.MD5OfMessageBody}</MD5OfMessageBody>
    </SendMessageBatchResultEntry>`;
    }
    
    for (const f of failed) {
      xml += `
    <BatchResultErrorEntry>
      <Id>${f.Id}</Id>
      <Code>${f.Code}</Code>
      <Message>${f.Message}</Message>
    </BatchResultErrorEntry>`;
    }
    
    xml += `
  </SendMessageBatchResult>
  <ResponseMetadata><RequestId>${crypto.randomUUID()}</RequestId></ResponseMetadata>
</SendMessageBatchResponse>`;
    
    return xml;
  }

  generateReceiveMessageResponse(messages) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<ReceiveMessageResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <ReceiveMessageResult>`;
    
    for (const msg of messages) {
      xml += `
    <Message>
      <MessageId>${msg.MessageId}</MessageId>
      <ReceiptHandle>${msg.ReceiptHandle}</ReceiptHandle>
      <MD5OfBody>${msg.MD5OfBody}</MD5OfBody>
      <Body>${this.escapeXml(msg.Body)}</Body>
    </Message>`;
    }
    
    xml += `
  </ReceiveMessageResult>
  <ResponseMetadata><RequestId>${crypto.randomUUID()}</RequestId></ResponseMetadata>
</ReceiveMessageResponse>`;
    
    return xml;
  }

  generateDeleteMessageResponse() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<DeleteMessageResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <ResponseMetadata>
    <RequestId>${crypto.randomUUID()}</RequestId>
  </ResponseMetadata>
</DeleteMessageResponse>`;
  }

  generateGetQueueUrlResponse(queueUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<GetQueueUrlResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <GetQueueUrlResult>
    <QueueUrl>${queueUrl}</QueueUrl>
  </GetQueueUrlResult>
  <ResponseMetadata><RequestId>${crypto.randomUUID()}</RequestId></ResponseMetadata>
</GetQueueUrlResponse>`;
  }

  generateListQueuesResponse(queues) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListQueuesResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <ListQueuesResult>`;
    
    for (const queue of queues) {
      xml += `<QueueUrl>${queue.url}</QueueUrl>`;
    }
    
    xml += `
  </ListQueuesResult>
  <ResponseMetadata><RequestId>${crypto.randomUUID()}</RequestId></ResponseMetadata>
</ListQueuesResponse>`;
    
    return xml;
  }

  escapeXml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`📦 SQS rodando em http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getStatus() {
    return {
      running: !!this.server,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      queuesCount: this.simulator?.getQueuesCount() || 0,
      messagesCount: this.simulator?.getTotalMessagesCount() || 0
    };
  }
}

module.exports = SQSServer;