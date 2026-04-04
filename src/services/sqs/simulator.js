/**
 * SQS Simulator Core
 */

const crypto = require('crypto');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');
const path = require('path');

class SQSSimulator {
  constructor(config, lambdaService) {
    this.config = config;
    this.lambdaService = lambdaService;
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR, 'sqs');
    this.store = new LocalStore(this.dataDir);
    this.queues = new Map();
  }

  async initialize() {
    logger.debug('Inicializando SQS Simulator...');
    this.loadQueues();
    logger.debug(`✅ SQS Simulator inicializado com ${this.queues.size} filas`);
  }

  loadQueues() {
    // Carrega filas da configuração
    if (this.config.sqs?.queues) {
      for (const queueConfig of this.config.sqs.queues) {
        const name = typeof queueConfig === 'string' ? queueConfig : queueConfig.name;
        this.createQueue(name);
        // Restore persisted messages for this queue
        const queue = this.queues.get(name);
        if (queue) {
          queue.messages = this.store.read(name) || [];
          queue.messageCount = queue.messages.length;
        }
      }
    }

    // Carrega filas existentes do disco
    const savedQueues = this.store.read('__queues__');
    if (savedQueues) {
      for (const [name, data] of Object.entries(savedQueues)) {
        if (!this.queues.has(name)) {
          const messages = this.store.read(name) || [];
          this.queues.set(name, { ...data, messages });
        }
      }
    }
  }

  createQueue(queueName) {
    if (this.queues.has(queueName)) {
      return { error: { code: 'QueueAlreadyExists', message: 'Queue already exists' }, status: 409 };
    }

    const queue = {
      name: queueName,
      url: `http://localhost:${this.config.ports.sqs}/queue/${queueName}`,
      arn: `arn:aws:sqs:local:000000000000:${queueName}`,
      messages: [],
      handler: null,
      batchSize: 10,
      visibilityTimeout: 30,
      createdAt: new Date().toISOString(),
      messageCount: 0
    };

    this.queues.set(queueName, queue);
    this.persistQueues();
    // Only initialize message store if it doesn't already exist
    if (!this.store.read(queueName)) {
      this.store.write(queueName, []);
    }

    logger.debug(`✅ Fila SQS criada: ${queueName}`);

    return { queue };
  }

  handleRequest(action, req, res) {
    switch(action) {
      case 'CreateQueue':
        return this.createQueueAction(req);
      case 'SendMessage':
        return this.sendMessageAction(req);
      case 'SendMessageBatch':
        return this.sendMessageBatchAction(req);
      case 'ReceiveMessage':
        return this.receiveMessageAction(req);
      case 'DeleteMessage':
        return this.deleteMessageAction(req);
      case 'GetQueueUrl':
        return this.getQueueUrlAction(req);
      case 'ListQueues':
        return this.listQueuesAction(req);
      default:
        return { error: { code: 'InvalidAction', message: `Action ${action} not supported` }, status: 400 };
    }
  }

  // Extracts queue name from QueueName param or QueueUrl (AWS CLI v2 JSON protocol sends QueueUrl)
  resolveQueueName(req) {
    const name = req.query.QueueName || req.body.QueueName;
    if (name) return name;
    const url = req.query.QueueUrl || req.body.QueueUrl;
    if (url) return url.split('/').pop();
    return undefined;
  }

  createQueueAction(req) {
    const queueName = req.query.QueueName || req.body.QueueName;
    const result = this.createQueue(queueName);

    if (result.error) {
      return result;
    }

    return { queueUrl: result.queue.url };
  }

  sendMessageAction(req) {
    const queueName = this.resolveQueueName(req);
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    const messageBody = req.query.MessageBody || req.body.MessageBody;
    const messageId = crypto.randomUUID();
    const receiptHandle = crypto.randomUUID();
    const md5 = crypto.createHash('md5').update(messageBody).digest('hex');

    const message = {
      MessageId: messageId,
      ReceiptHandle: receiptHandle,
      Body: messageBody,
      MD5OfBody: md5,
      Attributes: {},
      timestamp: Date.now()
    };

    queue.messages.push(message);
    queue.messageCount++;
    this.persistQueue(queueName);

    logger.verboso(`📨 Mensagem enviada para ${queueName}: ${messageId}`);

    if (queue.handler) {
      this.processQueueMessages(queue);
    }

    return { messageId, md5 };
  }

  sendMessageBatchAction(req) {
    const queueName = this.resolveQueueName(req);
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    const entries = req.query.SendMessageBatchRequestEntry || req.body.SendMessageBatchRequestEntry;
    const batchEntries = Array.isArray(entries) ? entries : [entries];

    const successful = [];
    const failed = [];

    for (const entry of batchEntries) {
      try {
        const messageId = crypto.randomUUID();
        const receiptHandle = crypto.randomUUID();
        const md5 = crypto.createHash('md5').update(entry.MessageBody).digest('hex');

        const message = {
          MessageId: messageId,
          ReceiptHandle: receiptHandle,
          Body: entry.MessageBody,
          MD5OfBody: md5,
          Attributes: {},
          timestamp: Date.now()
        };

        queue.messages.push(message);
        queue.messageCount++;

        successful.push({
          Id: entry.Id,
          MessageId: messageId,
          MD5OfMessageBody: md5
        });
      } catch (error) {
        failed.push({
          Id: entry.Id,
          Code: 'InternalError',
          Message: error.message
        });
      }
    }

    this.persistQueue(queueName);

    if (queue.handler && successful.length > 0) {
      this.processQueueMessages(queue);
    }

    return { successful, failed };
  }

  receiveMessageAction(req) {
    const queueName = this.resolveQueueName(req);
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    const maxNumberOfMessages = parseInt(req.query.MaxNumberOfMessages || req.body.MaxNumberOfMessages || 1);
    const messages = queue.messages.splice(0, maxNumberOfMessages);

    if (messages.length > 0) {
      queue.messageCount -= messages.length;
      this.persistQueue(queueName);
    }

    return { messages };
  }

  deleteMessageAction(req) {
    const queueName = this.resolveQueueName(req);
    const receiptHandle = req.query.ReceiptHandle || req.body.ReceiptHandle;
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    const index = queue.messages.findIndex(m => m.ReceiptHandle === receiptHandle);
    if (index !== -1) {
      queue.messages.splice(index, 1);
      queue.messageCount--;
      this.persistQueue(queueName);
    }

    return { success: true };
  }

  getQueueUrlAction(req) {
    const queueName = this.resolveQueueName(req);
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    return { queueUrl: queue.url };
  }

  listQueuesAction(req) {
    const queues = Array.from(this.queues.values()).map(q => ({
      name: q.name,
      url: q.url,
      messageCount: q.messageCount
    }));

    return { queues };
  }

  attachLambdaToQueue(queueName, handler, options = {}) {
    const queue = this.queues.get(queueName);

    if (!queue) {
      this.createQueue(queueName);
      return this.attachLambdaToQueue(queueName, handler, options);
    }

    queue.handler = handler;
    queue.batchSize = options.batchSize || 10;
    this.persistQueue(queueName);

    logger.debug(`🔗 Lambda associada à fila ${queueName}`);

    return queue;
  }

  async processQueueMessages(queue) {
    if (!queue.handler || queue.messages.length === 0) return;

    const messagesToProcess = queue.messages.splice(0, queue.batchSize);

    const event = {
      Records: messagesToProcess.map(msg => ({
        messageId: msg.MessageId,
        receiptHandle: msg.ReceiptHandle,
        body: msg.Body,
        attributes: msg.Attributes,
        messageAttributes: {},
        md5OfBody: msg.MD5OfBody,
        eventSource: 'aws:sqs',
        eventSourceARN: queue.arn,
        awsRegion: 'local'
      }))
    };

    logger.verboso(`🔄 Processando ${messagesToProcess.length} mensagens da fila ${queue.name}`);

    try {
      const result = await queue.handler(event);

      if (result && result.batchItemFailures && result.batchItemFailures.length > 0) {
        const failedIds = new Set(result.batchItemFailures.map(f => f.itemIdentifier));
        const failedMessages = messagesToProcess.filter(msg => failedIds.has(msg.MessageId));
        queue.messages.unshift(...failedMessages);
        logger.warn(`⚠️ ${failedMessages.length} mensagens falharam`);
      } else {
        queue.messageCount -= messagesToProcess.length;
      }
    } catch (error) {
      logger.error(`❌ Erro ao processar mensagens:`, error);
      queue.messages.unshift(...messagesToProcess);
    }

    this.persistQueue(queue.name);
  }

  persistQueues() {
    const queuesObj = {};
    for (const [name, queue] of this.queues.entries()) {
      queuesObj[name] = {
        name: queue.name,
        url: queue.url,
        arn: queue.arn,
        batchSize: queue.batchSize,
        visibilityTimeout: queue.visibilityTimeout,
        createdAt: queue.createdAt,
        messageCount: queue.messageCount
      };
    }
    this.store.write('__queues__', queuesObj);
  }

  persistQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      this.store.write(queueName, queue.messages);
      this.persistQueues();
    }
  }

  deleteQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      this.store.delete(queueName);
      this.queues.delete(queueName);
      this.persistQueues();
    }
  }

  purgeQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      queue.messages = [];
      queue.messageCount = 0;
      this.persistQueue(queueName);
    }
  }

  listQueues() {
    return Array.from(this.queues.values()).map(q => ({
      name: q.name,
      url: q.url,
      messagesCount: q.messageCount,
      createdAt: q.createdAt
    }));
  }

  getQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return null;

    return {
      name: queue.name,
      url: queue.url,
      messagesCount: queue.messageCount,
      messages: queue.messages.slice(0, 10),
      createdAt: queue.createdAt
    };
  }

  getMessages(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return [];
    return queue.messages;
  }

  getQueuesCount() {
    return this.queues.size;
  }

  getTotalMessagesCount() {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.messageCount;
    }
    return total;
  }

  getStats() {
    return {
      queuesCount: this.queues.size,
      totalMessages: this.getTotalMessagesCount(),
      queues: Array.from(this.queues.keys())
    };
  }

  async reset() {
    for (const [name] of this.queues) {
      this.store.write(name, []);
      const queue = this.queues.get(name);
      if (queue) {
        queue.messages = [];
        queue.messageCount = 0;
      }
    }
    this.persistQueues();
    logger.debug('SQS: Todos os dados resetados');
  }

  generateErrorResponse(code, message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${code}</Code>
  <Message>${message}</Message>
  <RequestId>${crypto.randomUUID()}</RequestId>
</Error>`;
  }
}

module.exports = SQSSimulator;
