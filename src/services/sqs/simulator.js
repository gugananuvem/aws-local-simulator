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
    this.snsService = null;
    this.region = "local";
    this.accountId = "000000000000";
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR, 'sqs');
    this.store = new LocalStore(this.dataDir);
    this.queues = new Map();
  }

  setLambdaService(lambdaService) {
    this.lambdaService = lambdaService;
  }

  setSnsService(snsService) {
    this.snsService = snsService;
  }

  setRegion(region) {
    this.region = region;
  }

  setAccountId(accountId) {
    this.accountId = accountId;
  }

  async initialize() {
    logger.debug('Inicializando SQS Simulator...');
    this.loadQueues();
    this.reattachLambdaHandlers();
    logger.debug(`✅ SQS Simulator inicializado com ${this.queues.size} filas`);
  }

  reattachLambdaHandlers() {
    if (!this.lambdaService?.simulator) return;
    for (const [queueName, queue] of this.queues.entries()) {
      if (!queue.handler && queue.lambdaName) {
        this.attachLambdaToQueue(queueName, queue.lambdaName, { batchSize: queue.batchSize });
      }
    }
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
          const savedMessages = this.store.read(name) || [];
          queue.messages = savedMessages.map(msg => ({
            ...msg,
            messageReceiveTracking: new Map()  // Reinitialize tracking map
          }));
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
          const queue = { 
            ...data, 
            messages,
            messageReceiveTracking: new Map(),
            handler: null,
            lambdaName: data.lambdaName || null
          };
          this.queues.set(name, queue);
        } else {
          // Merge with existing queue, preserving RedrivePolicy from saved state
          const queue = this.queues.get(name);
          if (data.redrivePolicy) {
            queue.redrivePolicy = data.redrivePolicy;
          }
          if (data.isDLQ !== undefined) {
            queue.isDLQ = data.isDLQ;
          }
        }
      }
    }
  }

  createQueue(queueName, attributes = {}) {
    if (this.queues.has(queueName)) {
      return { error: { code: 'QueueAlreadyExists', message: 'Queue already exists' }, status: 409 };
    }

    const region = attributes.Region || this.region || "local";
    const accountId = attributes.AccountId || this.accountId || "000000000000";

    const queue = {
      name: queueName,
      url: `http://localhost:${this.config.ports.sqs}/queue/${queueName}`,
      arn: `arn:aws:sqs:${region}:${accountId}:${queueName}`,
      messages: [],
      handler: null,
      lambdaName: null,
      batchSize: parseInt(attributes.BatchSize || 10),
      visibilityTimeout: parseInt(attributes.VisibilityTimeout || 30),
      delaySeconds: parseInt(attributes.DelaySeconds || 0),
      messageRetentionPeriod: parseInt(attributes.MessageRetentionPeriod || 345600),
      
      // DLQ Support
      redrivePolicy: null,  // Will be set if RedrivePolicy is provided
      isDLQ: false,  // Flag to identify if this is a Dead Letter Queue
      
      createdAt: new Date().toISOString(),
      messageCount: 0,
      
      // Track message receive counts for DLQ handling
      messageReceiveTracking: new Map()  // messageId -> { receiveCount, firstReceivedAt, lastReceivedAt, receiptHandles: Set }
    };

    this.queues.set(queueName, queue);

    // Parse RedrivePolicy if provided
    if (attributes.RedrivePolicy) {
      try {
        const policy = typeof attributes.RedrivePolicy === 'string' 
          ? JSON.parse(attributes.RedrivePolicy) 
          : attributes.RedrivePolicy;
        queue.redrivePolicy = {
          deadLetterTargetArn: policy.deadLetterTargetArn,
          maxReceiveCount: parseInt(policy.maxReceiveCount || 3)
        };
        logger.debug(`✅ Fila ${queueName} configurada com DLQ: ${queue.redrivePolicy.deadLetterTargetArn}, maxReceiveCount: ${queue.redrivePolicy.maxReceiveCount}`);
      } catch (e) {
        logger.warn(`⚠️ RedrivePolicy inválida para ${queueName}: ${e.message}`);
      }
    }

    if (attributes.LambdaName) {
      queue.lambdaName = attributes.LambdaName;
      this.attachLambdaToQueue(queueName, attributes.LambdaName, { batchSize: queue.batchSize });
    }

    this.persistQueues();
    if (!this.store.read(queueName)) {
      this.store.write(queueName, []);
    }

    logger.debug(`✅ Fila SQS criada: ${queueName} com atributos: ${JSON.stringify(attributes)}`);

    return { queue };
  }

  handleRequest(action, req, res) {
    switch(action) {
      case 'CreateQueue':
        return this.createQueueAction(req);
      case 'SetQueueAttributes':
        return this.setQueueAttributesAction(req);
      case 'GetQueueAttributes':
        return this.getQueueAttributesAction(req);
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

  // Parses Attribute.N.Name and Attribute.N.Value from request body/query
  // Also supports direct attribute keys like RedrivePolicy
  extractAttributes(req) {
    const attributes = {};
    const source = req.body && Object.keys(req.body).length > 0 ? req.body : req.query;
    
    // First, look for Attribute.N.Name/Value pattern
    Object.keys(source).forEach(key => {
      if (key.startsWith('Attribute.') && key.endsWith('.Name')) {
        const index = key.split('.')[1];
        const name = source[key];
        const value = source[`Attribute.${index}.Value`];
        attributes[name] = value;
      }
    });

    // Also support direct keys like RedrivePolicy, DelaySeconds, etc.
    const directKeys = ['RedrivePolicy', 'DelaySeconds', 'VisibilityTimeout', 'MessageRetentionPeriod', 'BatchSize', 'LambdaName'];
    directKeys.forEach(key => {
      if (source[key] !== undefined) {
        attributes[key] = source[key];
      }
    });

    return attributes;
  }

  createQueueAction(req) {
    const queueName = req.query.QueueName || req.body.QueueName;
    const attributes = this.extractAttributes(req);
    const result = this.createQueue(queueName, attributes);

    if (result.error) {
      return result;
    }

    return { queueUrl: result.queue.url };
  }

  setQueueAttributesAction(req) {
    const queueName = this.resolveQueueName(req);
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    const attributes = this.extractAttributes(req);
    
    if (attributes.DelaySeconds !== undefined) queue.delaySeconds = parseInt(attributes.DelaySeconds);
    if (attributes.VisibilityTimeout !== undefined) queue.visibilityTimeout = parseInt(attributes.VisibilityTimeout);
    if (attributes.MessageRetentionPeriod !== undefined) queue.messageRetentionPeriod = parseInt(attributes.MessageRetentionPeriod);
    
    // Support for RedrivePolicy (Dead Letter Queue configuration)
    if (attributes.RedrivePolicy !== undefined) {
      if (attributes.RedrivePolicy) {
        try {
          const policy = typeof attributes.RedrivePolicy === 'string' 
            ? JSON.parse(attributes.RedrivePolicy) 
            : attributes.RedrivePolicy;
          queue.redrivePolicy = {
            deadLetterTargetArn: policy.deadLetterTargetArn,
            maxReceiveCount: parseInt(policy.maxReceiveCount || 3)
          };
          logger.debug(`✅ RedrivePolicy configurada para ${queueName}: ${JSON.stringify(queue.redrivePolicy)}`);
        } catch (e) {
          logger.warn(`⚠️ RedrivePolicy inválida para ${queueName}: ${e.message}`);
          return { error: { code: 'InvalidParameterValue', message: 'Invalid RedrivePolicy format' }, status: 400 };
        }
      } else {
        queue.redrivePolicy = null;
        logger.debug(`✅ RedrivePolicy removida de ${queueName}`);
      }
    }
    
    if (attributes.LambdaName !== undefined) {
      queue.lambdaName = attributes.LambdaName;
      if (attributes.LambdaName) {
        this.attachLambdaToQueue(queueName, attributes.LambdaName, { batchSize: queue.batchSize });
      } else {
        queue.handler = null;
      }
    }
    
    if (attributes.BatchSize !== undefined) {
      queue.batchSize = parseInt(attributes.BatchSize);
    }

    this.persistQueues();
    return { success: true };
  }

  getQueueAttributesAction(req) {
    const queueName = this.resolveQueueName(req);
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    // Build response with all attributes
    const attributes = {
      DelaySeconds: String(queue.delaySeconds),
      VisibilityTimeout: String(queue.visibilityTimeout),
      MessageRetentionPeriod: String(queue.messageRetentionPeriod),
      ApproximateNumberOfMessages: String(queue.messageCount),
      ApproximateNumberOfMessagesNotVisible: String(
        queue.messages.filter(m => m.invisibleUntil && m.invisibleUntil > Date.now()).length
      ),
      CreatedTimestamp: String(Math.floor(new Date(queue.createdAt).getTime() / 1000)),
      QueueArn: queue.arn
    };

    // Add RedrivePolicy if configured
    if (queue.redrivePolicy) {
      attributes.RedrivePolicy = JSON.stringify(queue.redrivePolicy);
    }

    return { attributes };
  }


  sendMessageAction(req) {
    const queueName = this.resolveQueueName(req);
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    const messageBody = req.query.MessageBody || req.body.MessageBody;
    return this.sendMessage({ QueueUrl: queue.url, MessageBody: messageBody });
  }

  sendMessage(params) {
    const { QueueUrl, MessageBody } = params;
    if (!QueueUrl || !MessageBody) {
      return { error: { code: 'MissingParameter', message: 'QueueUrl and MessageBody are required' }, status: 400 };
    }

    let queueName;
    const match = QueueUrl.match(/\/queue\/([^/?]+)/);
    if (match) {
      queueName = match[1];
    } else {
      const arnMatch = QueueUrl.match(/:([^:]+)$/);
      queueName = arnMatch ? arnMatch[1] : QueueUrl;
    }

    const queue = this.queues.get(queueName);
    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    const messageId = crypto.randomUUID();
    const receiptHandle = crypto.randomUUID();
    const md5 = crypto.createHash('md5').update(MessageBody).digest('hex');
    const nowMs = Date.now();

    const message = {
      MessageId: messageId,
      ReceiptHandle: receiptHandle,
      Body: MessageBody,
      MD5OfBody: md5,
      Attributes: {
        ApproximateReceiveCount: "0",  // Will be incremented when received
        SentTimestamp: String(nowMs),
        ApproximateFirstReceiveTimestamp: null,
        SenderId: "AIDAJDPLRKLG7UEXAMPLE",
        AWSTraceHeader: null
      },
      timestamp: nowMs,
      receiveCount: 0,  // Track internally how many times received
      invisibleUntil: null  // When message becomes visible again
    };

    queue.messages.push(message);
    queue.messageCount++;
    
    // Initialize receive tracking for this message
    queue.messageReceiveTracking.set(messageId, {
      receiveCount: 0,
      firstReceivedAt: null,
      lastReceivedAt: null,
      receiptHandles: new Set()
    });
    
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
    const nowMs = Date.now();
    
    // Collect visible messages (don't remove yet)
    const messagesToReturn = [];
    for (let i = 0; i < queue.messages.length && messagesToReturn.length < maxNumberOfMessages; i++) {
      const msg = queue.messages[i];
      if (!msg.invisibleUntil || msg.invisibleUntil <= nowMs) {
        messagesToReturn.push(msg);
      }
    }

    // Process each message
    for (const message of messagesToReturn) {
      // Generate new ReceiptHandle for this receive (unique per receive)
      const newReceiptHandle = crypto.randomUUID();
      message.ReceiptHandle = newReceiptHandle;
      
      // Increment receive count
      message.receiveCount++;
      message.Attributes.ApproximateReceiveCount = String(message.receiveCount);
      
      // Set approximate first receive timestamp on first receive
      if (!message.Attributes.ApproximateFirstReceiveTimestamp || message.Attributes.ApproximateFirstReceiveTimestamp === "null") {
        message.Attributes.ApproximateFirstReceiveTimestamp = String(nowMs);
      }
      
      // Set visibility timeout (make invisible for next visibility timeout seconds)
      message.invisibleUntil = nowMs + (queue.visibilityTimeout * 1000);
      
      // Update tracking
      const tracking = queue.messageReceiveTracking.get(message.MessageId);
      if (tracking) {
        tracking.receiveCount = message.receiveCount;
        tracking.lastReceivedAt = nowMs;
        if (!tracking.firstReceivedAt) {
          tracking.firstReceivedAt = nowMs;
        }
        tracking.receiptHandles.add(newReceiptHandle);
      }
      
      logger.verboso(`📬 Mensagem recebida ${message.MessageId} da fila ${queueName} (receiveCount: ${message.receiveCount})`);
    }

    // Update message count
    queue.messageCount = queue.messages.filter(m => !m.invisibleUntil || m.invisibleUntil <= nowMs).length;
    this.persistQueue(queueName);

    return { messages: messagesToReturn };
  }

  deleteMessageAction(req) {
    const queueName = this.resolveQueueName(req);
    const receiptHandle = req.query.ReceiptHandle || req.body.ReceiptHandle;
    const queue = this.queues.get(queueName);

    if (!queue) {
      return { error: { code: 'QueueDoesNotExist', message: 'Queue does not exist' }, status: 400 };
    }

    // Find message by current ReceiptHandle (which was set at receive time)
    const messageIndex = queue.messages.findIndex(m => m.ReceiptHandle === receiptHandle);
    if (messageIndex !== -1) {
      const deletedMessage = queue.messages.splice(messageIndex, 1)[0];
      queue.messageCount--;
      logger.verboso(`🗑️ Mensagem deletada: ${deletedMessage.MessageId} da fila ${queueName}`);
      this.persistQueue(queueName);
    } else {
      logger.warn(`⚠️ Mensagem com ReceiptHandle ${receiptHandle} não encontrada em ${queueName}`);
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

  _extractLambdaFunctionName(lambdaRef) {
    if (!lambdaRef || typeof lambdaRef === 'function') return null;
    if (typeof lambdaRef !== 'string') return null;
    const lambdaStr = lambdaRef.trim();
    const arnMatch = lambdaStr.match(/arn:aws:lambda:[^:]+:[^:]+:function:([^:]+)/);
    if (arnMatch) return arnMatch[1];
    if (lambdaStr.startsWith('function:')) return lambdaStr.slice(9);
    return lambdaStr;
  }

  attachLambdaToQueue(queueName, handler, options = {}) {
    const queue = this.queues.get(queueName);

    if (!queue) {
      this.createQueue(queueName);
      return this.attachLambdaToQueue(queueName, handler, options);
    }

    let resolvedHandler = handler;

    if (typeof handler === 'string') {
      const functionName = this._extractLambdaFunctionName(handler);
      queue.lambdaName = functionName || handler;

      if (this.lambdaService?.simulator) {
        const lambdaSim = this.lambdaService.simulator;
        if (functionName) {
          resolvedHandler = async (event) => {
            return lambdaSim.invoke(functionName, event, "Event");
          };
          logger.debug(`🔗 Lambda "${functionName}" (resolved via ARN/nome) associada à fila ${queueName}`);
        } else {
          resolvedHandler = async (event) => {
            return lambdaSim.invoke(handler, event, "Event");
          };
          logger.debug(`🔗 Lambda "${handler}" associada à fila ${queueName}`);
        }
      } else {
        logger.warn(`⚠️ Lambda service não disponível para resolver ${handler} na fila ${queueName}`);
        resolvedHandler = null;
      }
    } else if (typeof handler === 'function') {
      queue.lambdaName = options?.lambdaName || queue.lambdaName;
      logger.debug(`🔗 Handler direto associado à fila ${queueName}`);
    }

    queue.handler = resolvedHandler;
    queue.batchSize = options.batchSize || 10;
    this.persistQueue(queueName);

    return queue;
  }

  async moveMessageToDLQ(queue, message) {
    if (!queue.redrivePolicy) {
      logger.debug(`⚠️ Nenhuma DLQ configurada para ${queue.name}, mensagem ${message.MessageId} será descartada`);
      return;
    }

    const dlqArn = queue.redrivePolicy.deadLetterTargetArn;
    const dlqName = dlqArn.split(':').pop();
    const dlq = this.queues.get(dlqName);

    if (!dlq) {
      logger.error(`❌ DLQ não encontrada: ${dlqName}`);
      return;
    }

    // Create new message in DLQ with original body and metadata
    const dlqMessage = {
      MessageId: crypto.randomUUID(),
      ReceiptHandle: crypto.randomUUID(),
      Body: message.Body,
      MD5OfBody: message.MD5OfBody,
      Attributes: {
        ...message.Attributes,
        ApproximateReceiveCount: "0",  // Reset in DLQ
        ApproximateFirstReceiveTimestamp: null
      },
      timestamp: Date.now(),
      receiveCount: 0,
      invisibleUntil: null,
      originalMessageId: message.MessageId  // Reference to original
    };

    dlq.messages.push(dlqMessage);
    dlq.messageCount++;
    
    dlq.messageReceiveTracking.set(dlqMessage.MessageId, {
      receiveCount: 0,
      firstReceivedAt: null,
      lastReceivedAt: null,
      receiptHandles: new Set()
    });

    logger.warn(`🔄 Mensagem ${message.MessageId} movida para DLQ: ${dlqName}`);
    this.persistQueue(dlqName);
  }

  async checkAndMoveToDLQ(queue, message) {
    if (!queue.redrivePolicy) return false;

    const maxReceiveCount = queue.redrivePolicy.maxReceiveCount;
    const receiveCount = parseInt(message.Attributes.ApproximateReceiveCount || 0);

    if (receiveCount >= maxReceiveCount) {
      await this.moveMessageToDLQ(queue, message);
      return true;
    }

    return false;
  }

  async processQueueMessages(queue) {
    if (!queue.handler || queue.messages.length === 0) return;

    const visibleMessages = queue.messages.filter(m => 
      !m.invisibleUntil || m.invisibleUntil <= Date.now()
    );

    if (visibleMessages.length === 0) return;

    const messagesToProcess = visibleMessages.splice(0, queue.batchSize);
    const nowMs = Date.now();

    const event = {
      Records: messagesToProcess.map(msg => ({
        messageId: msg.MessageId,
        receiptHandle: msg.ReceiptHandle,
        body: msg.Body,
        attributes: {
          ApproximateReceiveCount: msg.Attributes.ApproximateReceiveCount || "0",
          SentTimestamp: String(msg.Attributes.SentTimestamp || msg.timestamp || nowMs),
          SenderId: msg.Attributes.SenderId || "AIDAJDPLRKLG7UEXAMPLE",
          ApproximateFirstReceiveTimestamp: msg.Attributes.ApproximateFirstReceiveTimestamp || String(nowMs),
          AWSTraceHeader: msg.Attributes?.AWSTraceHeader,
        },
        messageAttributes: {},
        md5OfBody: msg.MD5OfBody,
        md5OfMessageAttributes: null,
        eventSource: 'aws:sqs',
        eventSourceARN: queue.arn,
        awsRegion: this.region || 'local'
      }))
    };

    logger.verboso(`🔄 Processando ${messagesToProcess.length} mensagens da fila ${queue.name}`);

    try {
      const result = await queue.handler(event);

      if (result && result.batchItemFailures && result.batchItemFailures.length > 0) {
        // Only failed messages are returned to the queue
        const failedIds = new Set(result.batchItemFailures.map(f => f.itemIdentifier));
        const failedMessages = messagesToProcess.filter(msg => failedIds.has(msg.MessageId));
        const successMessages = messagesToProcess.filter(msg => !failedIds.has(msg.MessageId));

        // Remove successfully processed messages from queue
        for (const successMsg of successMessages) {
          const idx = queue.messages.findIndex(m => m.MessageId === successMsg.MessageId);
          if (idx !== -1) {
            queue.messages.splice(idx, 1);
          }
        }

        // Return failed messages to queue (will be reprocessed after visibility timeout)
        for (const msg of failedMessages) {
          // Check if should go to DLQ
          const shouldMoveToDLQ = await this.checkAndMoveToDLQ(queue, msg);
          if (!shouldMoveToDLQ) {
            // Message already in queue, just reset invisibility for retry
            msg.invisibleUntil = 0;
            logger.verboso(`↩️ Mensagem ${msg.MessageId} retornada à fila ${queue.name} (tentativa ${msg.receiveCount + 1})`);
          } else {
            // Message was moved to DLQ, remove it from current queue
            const idx = queue.messages.findIndex(m => m.MessageId === msg.MessageId);
            if (idx !== -1) {
              queue.messages.splice(idx, 1);
            }
          }
        }

        // Update message count
        queue.messageCount = queue.messages.filter(m => !m.invisibleUntil || m.invisibleUntil <= nowMs).length;
        
        logger.warn(`⚠️ ${failedMessages.length} mensagens falharam na fila ${queue.name}, ${successMessages.length} processadas com sucesso`);
      } else {
        // If no explicit batchItemFailures, treat all as successful (delete them)
        for (const msg of messagesToProcess) {
          const idx = queue.messages.findIndex(m => m.MessageId === msg.MessageId);
          if (idx !== -1) {
            queue.messages.splice(idx, 1);
          }
        }
        logger.verboso(`✅ ${messagesToProcess.length} mensagens da fila ${queue.name} processadas com sucesso`);
        queue.messageCount = queue.messages.filter(m => !m.invisibleUntil || m.invisibleUntil <= nowMs).length;
      }
    } catch (error) {
      logger.error(`❌ Erro ao processar mensagens da fila ${queue.name}:`, error);
      
      // On exception, return all messages to queue for retry
      for (const msg of messagesToProcess) {
        const shouldMoveToDLQ = await this.checkAndMoveToDLQ(queue, msg);
        if (!shouldMoveToDLQ) {
          // Message already in queue, just reset invisibility for retry
          msg.invisibleUntil = 0;
        } else {
          // Message was moved to DLQ, remove it from current queue
          const idx = queue.messages.findIndex(m => m.MessageId === msg.MessageId);
          if (idx !== -1) {
            queue.messages.splice(idx, 1);
          }
        }
      }
      queue.messageCount = queue.messages.filter(m => !m.invisibleUntil || m.invisibleUntil <= nowMs).length;
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
        delaySeconds: queue.delaySeconds,
        messageRetentionPeriod: queue.messageRetentionPeriod,
        lambdaName: queue.lambdaName,
        redrivePolicy: queue.redrivePolicy,  // Persist RedrivePolicy
        isDLQ: queue.isDLQ,
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
      createdAt: q.createdAt,
      delaySeconds: q.delaySeconds,
      visibilityTimeout: q.visibilityTimeout,
      messageRetentionPeriod: q.messageRetentionPeriod,
      lambdaName: q.lambdaName,
      batchSize: q.batchSize
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
