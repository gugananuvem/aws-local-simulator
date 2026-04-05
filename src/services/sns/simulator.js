/**
 * @fileoverview SNS Simulator - Completo
 * Simula o Amazon Simple Notification Service com todas as operações
 *
 * Operações implementadas:
 * - Topics: CreateTopic, DeleteTopic, ListTopics, GetTopicAttributes, SetTopicAttributes
 * - Subscriptions: Subscribe, Unsubscribe, ConfirmSubscription, ListSubscriptions,
 *                  ListSubscriptionsByTopic, GetSubscriptionAttributes, SetSubscriptionAttributes
 * - Publish: Publish, PublishBatch
 * - Tags: TagResource, UntagResource, ListTagsForResource
 * - Platform: CreatePlatformApplication, DeletePlatformApplication,
 *             CreatePlatformEndpoint, DeleteEndpoint
 * - Opt-in: CheckIfPhoneNumberIsOptedOut, ListPhoneNumbersOptedOut, OptInPhoneNumber
 * - SMS: SetSMSAttributes, GetSMSAttributes
 * - Wire Protocol: Query XML (compatível AWS SDK v3)
 */

'use strict';

const crypto = require('crypto');

/**
 * SNS Simulator completo
 */
class SNSSimulator {
  /**
   * @param {Object} config - Service configuration
   * @param {Object} store  - LocalStore instance
   * @param {Object} logger - Logger instance
   */
  constructor(config, store, logger) {
    this.config = config;
    this.store  = store;
    this.logger = logger;

    /** @type {Map<string,Object>} Topics indexados por ARN */
    this.topics = new Map();

    /** @type {Map<string,Object>} Subscriptions indexadas por ARN */
    this.subscriptions = new Map();

    /** @type {Map<string,string>} Tokens de confirmação pendentes → SubscriptionArn */
    this.pendingTokens = new Map();

    /** @type {Map<string,Object>} Platform applications por ARN */
    this.platformApps = new Map();

    /** @type {Map<string,Object>} Platform endpoints por ARN */
    this.platformEndpoints = new Map();

    /** @type {Map<string,string[]>} Tags por ARN de recurso */
    this.tags = new Map();

    /** @type {Object} SMS attributes globais */
    this.smsAttributes = { DefaultSMSType: 'Transactional', MonthlySpendLimit: '1' };

    /** @type {Set<string>} Números optados por sair */
    this.optedOutNumbers = new Set();

    /** @type {Object|null} Lambda service para protocolo lambda */
    this.lambdaService = null;

    /** @type {Object|null} SQS service para protocolo sqs */
    this.sqsService    = null;

    /** @type {Array} Log de mensagens publicadas (últimas 500) */
    this.publishLog = [];

    this.region    = 'us-east-1';
    this.accountId = '123456789012';
  }

  // ─────────────────────────────────────────────
  //  Injeção de dependências
  // ─────────────────────────────────────────────

  /** @param {Object} lambdaService */
  setLambdaService(lambdaService) { this.lambdaService = lambdaService; }

  /** @param {Object} sqsService */
  setSqsService(sqsService) { this.sqsService = sqsService; }

  // ─────────────────────────────────────────────
  //  Persistência
  // ─────────────────────────────────────────────

  /** Carrega dados persistidos */
  async load() {
    try {
      const topics = await this.store.read('sns/topics');
      if (Array.isArray(topics)) topics.forEach(t => this.topics.set(t.TopicArn, t));

      const subs = await this.store.read('sns/subscriptions');
      if (Array.isArray(subs)) subs.forEach(s => this.subscriptions.set(s.SubscriptionArn, s));

      const apps = await this.store.read('sns/platform-apps');
      if (Array.isArray(apps)) apps.forEach(a => this.platformApps.set(a.PlatformApplicationArn, a));

      const endpoints = await this.store.read('sns/platform-endpoints');
      if (Array.isArray(endpoints)) endpoints.forEach(e => this.platformEndpoints.set(e.EndpointArn, e));

      const tagsData = await this.store.read('sns/tags');
      if (tagsData && typeof tagsData === 'object' && !Array.isArray(tagsData)) {
        Object.entries(tagsData).forEach(([k, v]) => this.tags.set(k, v));
      }

      this.logger.debug('SNS', `Loaded ${this.topics.size} topics, ${this.subscriptions.size} subscriptions`);
    } catch {
      this.logger.debug('SNS', 'No persisted data, starting fresh');
    }
  }

  /** Persiste todos os dados */
  async _save() {
    await Promise.all([
      this.store.write('sns/topics',            null, Array.from(this.topics.values())),
      this.store.write('sns/subscriptions',     null, Array.from(this.subscriptions.values())),
      this.store.write('sns/platform-apps',     null, Array.from(this.platformApps.values())),
      this.store.write('sns/platform-endpoints',null, Array.from(this.platformEndpoints.values())),
      this.store.write('sns/tags',              null, Object.fromEntries(this.tags.entries()))
    ]);
  }

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────

  /** @param {string} name @returns {string} */
  _topicArn(name) {
    return `arn:aws:sns:${this.region}:${this.accountId}:${name}`;
  }

  /** @param {string} topicArn @returns {string} */
  _subscriptionArn(topicArn) {
    return `${topicArn}:${crypto.randomUUID()}`;
  }

  /**
   * Cria erro no padrão AWS
   * @param {string} code
   * @param {string} message
   * @returns {Error}
   */
  _error(code, message) {
    const err    = new Error(message);
    err.code     = code;
    err.__type   = code;
    err.statusCode = code === 'NotFound' || code === 'ResourceNotFoundException' ? 404 : 400;
    return err;
  }

  /**
   * Valida nome de tópico
   * @param {string} name
   */
  _validateTopicName(name) {
    if (!name) throw this._error('InvalidParameter', 'Topic name is required');
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(name.replace(/\.fifo$/, ''))) {
      throw this._error('InvalidParameter', 'Invalid topic name. Use alphanumeric, hyphens, underscores (max 256 chars)');
    }
  }

  // ─────────────────────────────────────────────
  //  Topic Operations
  // ─────────────────────────────────────────────

  /**
   * CreateTopic — cria um tópico SNS
   * @param {Object} params
   * @param {string} params.Name
   * @param {Object} [params.Attributes]
   * @param {Array}  [params.Tags]
   * @returns {Promise<{TopicArn: string}>}
   */
  async createTopic(params) {
    const { Name, Attributes = {}, Tags = [] } = params;

    this._validateTopicName(Name);

    const isFifo  = Name.endsWith('.fifo');
    const topicArn = this._topicArn(Name);

    // Idempotente: retorna ARN existente
    if (this.topics.has(topicArn)) {
      return { TopicArn: topicArn };
    }

    const now = new Date().toISOString();

    const topic = {
      TopicArn:  topicArn,
      Name,
      Attributes: {
        TopicArn:                     topicArn,
        Owner:                        this.accountId,
        Policy:                       JSON.stringify({ Version: '2012-10-17', Statement: [] }),
        DisplayName:                  Attributes.DisplayName || '',
        SubscriptionsPending:         '0',
        SubscriptionsConfirmed:       '0',
        SubscriptionsDeleted:         '0',
        DeliveryPolicy:               '{}',
        EffectiveDeliveryPolicy:      '{}',
        KmsMasterKeyId:               Attributes.KmsMasterKeyId || '',
        FifoTopic:                    String(isFifo),
        ContentBasedDeduplication:    Attributes.ContentBasedDeduplication || 'false',
        ArchivePolicy:                Attributes.ArchivePolicy || '',
        BeginningArchiveTime:         '',
        SignatureVersion:             '1',
        TracingConfig:               Attributes.TracingConfig || 'PassThrough',
        ...Attributes
      },
      Tags,
      CreatedAt: now
    };

    this.topics.set(topicArn, topic);

    // Persistir tags separadamente
    if (Tags.length > 0) {
      this.tags.set(topicArn, Tags);
    }

    await this._save();

    this.logger.info('SNS', `Created topic: ${Name}${isFifo ? ' (FIFO)' : ''}`);
    return { TopicArn: topicArn };
  }

  /**
   * DeleteTopic — remove um tópico e todas as suas subscriptions
   * @param {Object} params
   * @param {string} params.TopicArn
   * @returns {Promise<void>}
   */
  async deleteTopic(params) {
    const { TopicArn } = params;

    if (!this.topics.has(TopicArn)) {
      throw this._error('NotFound', `Topic not found: ${TopicArn}`);
    }

    // Remove subscriptions associadas
    let removedSubs = 0;
    for (const [arn, sub] of this.subscriptions.entries()) {
      if (sub.TopicArn === TopicArn) {
        this.subscriptions.delete(arn);
        removedSubs++;
      }
    }

    // Remove tokens pendentes
    for (const [token, subArn] of this.pendingTokens.entries()) {
      const sub = this.subscriptions.get(subArn);
      if (!sub || sub.TopicArn === TopicArn) {
        this.pendingTokens.delete(token);
      }
    }

    this.topics.delete(TopicArn);
    this.tags.delete(TopicArn);

    await this._save();

    this.logger.info('SNS', `Deleted topic: ${TopicArn} (removed ${removedSubs} subscriptions)`);
  }

  /**
   * ListTopics — lista tópicos paginados (100 por página)
   * @param {Object} [params]
   * @param {string} [params.NextToken]
   * @returns {{Topics: Array, NextToken?: string}}
   */
  listTopics(params = {}) {
    const { NextToken } = params;
    const allTopics = Array.from(this.topics.values());
    const pageSize  = 100;
    let startIdx    = 0;

    if (NextToken) {
      try {
        startIdx = parseInt(Buffer.from(NextToken, 'base64').toString('utf8'), 10) || 0;
      } catch { startIdx = 0; }
    }

    const page      = allTopics.slice(startIdx, startIdx + pageSize);
    const nextIdx   = startIdx + pageSize;
    const nextToken = nextIdx < allTopics.length
      ? Buffer.from(String(nextIdx)).toString('base64')
      : undefined;

    return {
      Topics: page.map(t => ({ TopicArn: t.TopicArn })),
      ...(nextToken && { NextToken: nextToken })
    };
  }

  /**
   * GetTopicAttributes — retorna atributos de um tópico
   * @param {Object} params
   * @param {string} params.TopicArn
   * @returns {{Attributes: Object}}
   */
  getTopicAttributes(params) {
    const { TopicArn } = params;
    const topic = this.topics.get(TopicArn);
    if (!topic) throw this._error('NotFound', `Topic not found: ${TopicArn}`);

    // Calcular contadores em tempo real
    const subs      = Array.from(this.subscriptions.values()).filter(s => s.TopicArn === TopicArn);
    const confirmed = subs.filter(s => s.PendingConfirmation === 'false').length;
    const pending   = subs.filter(s => s.PendingConfirmation === 'true').length;

    return {
      Attributes: {
        ...topic.Attributes,
        SubscriptionsConfirmed: String(confirmed),
        SubscriptionsPending:   String(pending),
        SubscriptionsDeleted:   topic.Attributes.SubscriptionsDeleted || '0'
      }
    };
  }

  /**
   * SetTopicAttributes — atualiza um atributo do tópico
   * @param {Object} params
   * @param {string} params.TopicArn
   * @param {string} params.AttributeName
   * @param {string} params.AttributeValue
   * @returns {Promise<void>}
   */
  async setTopicAttributes(params) {
    const { TopicArn, AttributeName, AttributeValue } = params;
    const topic = this.topics.get(TopicArn);
    if (!topic) throw this._error('NotFound', `Topic not found: ${TopicArn}`);

    const readOnly = ['TopicArn', 'Owner', 'SubscriptionsConfirmed', 'SubscriptionsPending', 'SubscriptionsDeleted'];
    if (readOnly.includes(AttributeName)) {
      throw this._error('InvalidParameter', `Attribute ${AttributeName} is read-only`);
    }

    topic.Attributes[AttributeName] = AttributeValue;
    await this._save();

    this.logger.debug('SNS', `SetTopicAttributes: ${AttributeName}=${AttributeValue} on ${TopicArn}`);
  }

  // ─────────────────────────────────────────────
  //  Subscription Operations
  // ─────────────────────────────────────────────

  /**
   * Subscribe — inscreve um endpoint em um tópico
   * @param {Object} params
   * @param {string} params.TopicArn
   * @param {string} params.Protocol
   * @param {string} [params.Endpoint]
   * @param {Object} [params.Attributes]
   * @param {boolean} [params.ReturnSubscriptionArn]
   * @returns {Promise<{SubscriptionArn: string}>}
   */
  async subscribe(params) {
    const { TopicArn, Protocol, Endpoint = '', Attributes = {}, ReturnSubscriptionArn = false } = params;

    if (!this.topics.has(TopicArn)) {
      throw this._error('NotFound', `Topic not found: ${TopicArn}`);
    }

    const validProtocols = ['lambda', 'sqs', 'http', 'https', 'email', 'email-json', 'sms', 'application', 'firehose'];
    if (!validProtocols.includes(Protocol)) {
      throw this._error('InvalidParameter', `Invalid protocol: ${Protocol}. Must be one of: ${validProtocols.join(', ')}`);
    }

    // Verifica se já existe subscrição idêntica
    for (const sub of this.subscriptions.values()) {
      if (sub.TopicArn === TopicArn && sub.Protocol === Protocol && sub.Endpoint === Endpoint) {
        return { SubscriptionArn: sub.SubscriptionArn };
      }
    }

    const subscriptionArn = this._subscriptionArn(TopicArn);
    const now = new Date().toISOString();

    // Protocolos que não requerem confirmação
    const autoConfirmed = ['lambda', 'sqs', 'application', 'firehose'];
    const pendingConfirmation = autoConfirmed.includes(Protocol) ? 'false' : 'true';

    let filterPolicy = null;
    if (Attributes.FilterPolicy) {
      try { filterPolicy = JSON.parse(Attributes.FilterPolicy); }
      catch { throw this._error('InvalidParameter', 'FilterPolicy must be valid JSON'); }
    }

    let filterPolicyScope = Attributes.FilterPolicyScope || 'MessageAttributes';

    const subscription = {
      SubscriptionArn:               subscriptionArn,
      TopicArn,
      Protocol,
      Endpoint,
      Owner:                         this.accountId,
      ConfirmationWasAuthenticated:  'true',
      PendingConfirmation:           pendingConfirmation,
      FilterPolicy:                  filterPolicy,
      FilterPolicyScope:             filterPolicyScope,
      RawMessageDelivery:            Attributes.RawMessageDelivery || 'false',
      RedrivePolicy:                 Attributes.RedrivePolicy || null,
      DeliveryPolicy:                Attributes.DeliveryPolicy || null,
      SubscriptionRoleArn:           Attributes.SubscriptionRoleArn || '',
      CreatedAt:                     now
    };

    this.subscriptions.set(subscriptionArn, subscription);

    // Gerar token de confirmação para protocolos http/https/email/sms
    if (pendingConfirmation === 'true') {
      const token = crypto.randomBytes(64).toString('hex');
      this.pendingTokens.set(token, subscriptionArn);
      this.logger.info('SNS', `[CONFIRMATION MOCK] Token for ${Protocol}:${Endpoint}: ${token.substring(0, 16)}...`);
    }

    await this._save();

    this.logger.info('SNS', `Subscribed ${Protocol}:${Endpoint} → ${TopicArn}`);

    // Se ReturnSubscriptionArn=true OU auto-confirmado → retorna ARN real
    // Senão retorna 'PendingConfirmation'
    const returnArn = (ReturnSubscriptionArn || pendingConfirmation === 'false')
      ? subscriptionArn
      : 'PendingConfirmation';

    return { SubscriptionArn: returnArn };
  }

  /**
   * ConfirmSubscription — confirma uma subscrição via token
   * @param {Object} params
   * @param {string} params.TopicArn
   * @param {string} params.Token
   * @param {string} [params.AuthenticateOnUnsubscribe]
   * @returns {{SubscriptionArn: string}}
   */
  async confirmSubscription(params) {
    const { TopicArn, Token } = params;

    if (!this.topics.has(TopicArn)) {
      throw this._error('NotFound', `Topic not found: ${TopicArn}`);
    }

    const subscriptionArn = this.pendingTokens.get(Token);
    if (!subscriptionArn) {
      throw this._error('InvalidParameter', 'Invalid confirmation token');
    }

    const sub = this.subscriptions.get(subscriptionArn);
    if (!sub || sub.TopicArn !== TopicArn) {
      throw this._error('InvalidParameter', 'Token does not match topic');
    }

    sub.PendingConfirmation = 'false';
    sub.ConfirmationWasAuthenticated = 'true';
    this.pendingTokens.delete(Token);

    await this._save();

    this.logger.info('SNS', `Confirmed subscription: ${subscriptionArn}`);
    return { SubscriptionArn: subscriptionArn };
  }

  /**
   * Unsubscribe — remove uma subscrição
   * @param {Object} params
   * @param {string} params.SubscriptionArn
   * @returns {Promise<void>}
   */
  async unsubscribe(params) {
    const { SubscriptionArn } = params;

    const sub = this.subscriptions.get(SubscriptionArn);
    if (!sub) throw this._error('NotFound', `Subscription not found: ${SubscriptionArn}`);

    this.subscriptions.delete(SubscriptionArn);

    // Incrementar contador de deletadas no tópico
    const topic = this.topics.get(sub.TopicArn);
    if (topic) {
      const deleted = parseInt(topic.Attributes.SubscriptionsDeleted || '0');
      topic.Attributes.SubscriptionsDeleted = String(deleted + 1);
    }

    await this._save();

    this.logger.info('SNS', `Unsubscribed: ${SubscriptionArn}`);
  }

  /**
   * ListSubscriptions — lista todas as subscrições paginadas
   * @param {Object} [params]
   * @returns {{Subscriptions: Array, NextToken?: string}}
   */
  listSubscriptions(params = {}) {
    return this._paginateSubscriptions(Array.from(this.subscriptions.values()), params.NextToken);
  }

  /**
   * ListSubscriptionsByTopic — lista subscrições de um tópico
   * @param {Object} params
   * @param {string} params.TopicArn
   * @returns {{Subscriptions: Array, NextToken?: string}}
   */
  listSubscriptionsByTopic(params) {
    const { TopicArn, NextToken } = params;
    if (!this.topics.has(TopicArn)) throw this._error('NotFound', `Topic not found: ${TopicArn}`);

    const subs = Array.from(this.subscriptions.values()).filter(s => s.TopicArn === TopicArn);
    return this._paginateSubscriptions(subs, NextToken);
  }

  /**
   * Pagina lista de subscriptions
   * @param {Array} subs
   * @param {string} [nextToken]
   * @returns {{Subscriptions: Array, NextToken?: string}}
   * @private
   */
  _paginateSubscriptions(subs, nextToken) {
    const pageSize = 100;
    let startIdx   = 0;

    if (nextToken) {
      try { startIdx = parseInt(Buffer.from(nextToken, 'base64').toString('utf8'), 10) || 0; }
      catch { startIdx = 0; }
    }

    const page    = subs.slice(startIdx, startIdx + pageSize);
    const nextIdx = startIdx + pageSize;
    const token   = nextIdx < subs.length
      ? Buffer.from(String(nextIdx)).toString('base64')
      : undefined;

    return {
      Subscriptions: page.map(s => ({
        SubscriptionArn: s.SubscriptionArn,
        TopicArn:        s.TopicArn,
        Protocol:        s.Protocol,
        Endpoint:        s.Endpoint,
        Owner:           s.Owner
      })),
      ...(token && { NextToken: token })
    };
  }

  /**
   * GetSubscriptionAttributes — retorna atributos de uma subscrição
   * @param {Object} params
   * @param {string} params.SubscriptionArn
   * @returns {{Attributes: Object}}
   */
  getSubscriptionAttributes(params) {
    const { SubscriptionArn } = params;
    const sub = this.subscriptions.get(SubscriptionArn);
    if (!sub) throw this._error('NotFound', `Subscription not found: ${SubscriptionArn}`);

    return {
      Attributes: {
        SubscriptionArn:               sub.SubscriptionArn,
        TopicArn:                      sub.TopicArn,
        Protocol:                      sub.Protocol,
        Endpoint:                      sub.Endpoint,
        Owner:                         sub.Owner,
        FilterPolicy:                  sub.FilterPolicy ? JSON.stringify(sub.FilterPolicy) : '',
        FilterPolicyScope:             sub.FilterPolicyScope || 'MessageAttributes',
        RawMessageDelivery:            sub.RawMessageDelivery,
        ConfirmationWasAuthenticated:  sub.ConfirmationWasAuthenticated,
        PendingConfirmation:           sub.PendingConfirmation,
        RedrivePolicy:                 sub.RedrivePolicy ? JSON.stringify(sub.RedrivePolicy) : '',
        DeliveryPolicy:                sub.DeliveryPolicy ? JSON.stringify(sub.DeliveryPolicy) : '',
        SubscriptionRoleArn:           sub.SubscriptionRoleArn || ''
      }
    };
  }

  /**
   * SetSubscriptionAttributes — atualiza atributos de uma subscrição
   * @param {Object} params
   * @param {string} params.SubscriptionArn
   * @param {string} params.AttributeName
   * @param {string} [params.AttributeValue]
   * @returns {Promise<void>}
   */
  async setSubscriptionAttributes(params) {
    const { SubscriptionArn, AttributeName, AttributeValue } = params;
    const sub = this.subscriptions.get(SubscriptionArn);
    if (!sub) throw this._error('NotFound', `Subscription not found: ${SubscriptionArn}`);

    const editableAttrs = ['FilterPolicy', 'FilterPolicyScope', 'RawMessageDelivery', 'RedrivePolicy', 'DeliveryPolicy', 'SubscriptionRoleArn'];
    if (!editableAttrs.includes(AttributeName)) {
      throw this._error('InvalidParameter', `Attribute ${AttributeName} is not editable`);
    }

    if (AttributeName === 'FilterPolicy') {
      try { sub.FilterPolicy = AttributeValue ? JSON.parse(AttributeValue) : null; }
      catch { throw this._error('InvalidParameter', 'FilterPolicy must be valid JSON'); }
    } else {
      sub[AttributeName] = AttributeValue || '';
    }

    await this._save();
    this.logger.debug('SNS', `SetSubscriptionAttributes: ${AttributeName} on ${SubscriptionArn}`);
  }

  // ─────────────────────────────────────────────
  //  Publish Operations
  // ─────────────────────────────────────────────

  /**
   * Publish — publica uma mensagem em um tópico ou endpoint
   * @param {Object} params
   * @param {string} [params.TopicArn]
   * @param {string} [params.TargetArn]
   * @param {string} [params.PhoneNumber]
   * @param {string} params.Message
   * @param {string} [params.Subject]
   * @param {string} [params.MessageStructure]
   * @param {Object} [params.MessageAttributes]
   * @param {string} [params.MessageGroupId]
   * @param {string} [params.MessageDeduplicationId]
   * @returns {Promise<{MessageId: string, SequenceNumber?: string}>}
   */
  async publish(params) {
    const {
      TopicArn, TargetArn, PhoneNumber,
      Message, Subject,
      MessageStructure, MessageAttributes = {},
      MessageGroupId, MessageDeduplicationId
    } = params;

    // SMS direto para número
    if (PhoneNumber) {
      if (this.optedOutNumbers.has(PhoneNumber)) {
        throw this._error('OptedOut', `Number ${PhoneNumber} has opted out`);
      }
      const messageId = crypto.randomUUID();
      this.logger.info('SNS', `[SMS MOCK] To: ${PhoneNumber}, Message: ${String(Message).substring(0, 160)}`);
      this._logPublish(null, messageId, Message, PhoneNumber);
      return { MessageId: messageId };
    }

    const arn = TopicArn || TargetArn;
    if (!arn) throw this._error('InvalidParameter', 'TopicArn, TargetArn, or PhoneNumber is required');
    if (!Message) throw this._error('InvalidParameter', 'Message is required');
    if (Message.length > 262144) throw this._error('InvalidParameter', 'Message too large (max 256KB)');

    // Entrega para endpoint de plataforma
    if (TargetArn && !TopicArn) {
      const endpoint = this.platformEndpoints.get(TargetArn);
      if (!endpoint) throw this._error('NotFound', `Endpoint not found: ${TargetArn}`);
      const messageId = crypto.randomUUID();
      this.logger.info('SNS', `[PLATFORM MOCK] Endpoint: ${TargetArn}, Message: ${String(Message).substring(0, 100)}`);
      this._logPublish(TargetArn, messageId, Message);
      return { MessageId: messageId };
    }

    const topic = this.topics.get(arn);
    if (!topic) throw this._error('NotFound', `Topic not found: ${arn}`);

    const messageId = crypto.randomUUID();

    // Parse de mensagem estruturada
    let messagePayload = Message;
    if (MessageStructure === 'json') {
      try { messagePayload = JSON.parse(Message); }
      catch { throw this._error('InvalidParameter', 'Message is not valid JSON for MessageStructure=json'); }
    }

    this._logPublish(arn, messageId, Message, null, MessageAttributes);

    this.logger.debug('SNS', `Publishing messageId=${messageId} to ${arn} (${topic.Name})`);

    // Coletar subscriptions confirmadas do tópico
    const topicSubs = Array.from(this.subscriptions.values())
      .filter(s => s.TopicArn === arn && s.PendingConfirmation === 'false');

    // Entrega assíncrona (fire and forget)
    Promise.all(
      topicSubs.map(sub =>
        this._deliver(sub, messagePayload, MessageStructure, Subject, MessageAttributes, messageId)
          .catch(err => this.logger.warn('SNS', `Delivery failed [${sub.Protocol}:${sub.Endpoint}]: ${err.message}`))
      )
    );

    return {
      MessageId: messageId,
      ...(MessageGroupId && { SequenceNumber: String(Date.now()).padStart(20, '0') })
    };
  }

  /**
   * PublishBatch — publica múltiplas mensagens em um tópico
   * @param {Object} params
   * @param {string} params.TopicArn
   * @param {Array}  params.PublishBatchRequestEntries
   * @returns {Promise<{Successful: Array, Failed: Array}>}
   */
  async publishBatch(params) {
    const { TopicArn, PublishBatchRequestEntries = [] } = params;

    if (!this.topics.has(TopicArn)) {
      throw this._error('NotFound', `Topic not found: ${TopicArn}`);
    }

    if (PublishBatchRequestEntries.length === 0) {
      throw this._error('InvalidParameter', 'At least one entry is required');
    }

    if (PublishBatchRequestEntries.length > 10) {
      throw this._error('TooManyEntriesInBatchRequest', 'Maximum 10 entries per batch');
    }

    const successful = [];
    const failed     = [];

    for (const entry of PublishBatchRequestEntries) {
      try {
        const result = await this.publish({
          TopicArn,
          Message:                  entry.Message,
          Subject:                  entry.Subject,
          MessageStructure:         entry.MessageStructure,
          MessageAttributes:        entry.MessageAttributes,
          MessageGroupId:           entry.MessageGroupId,
          MessageDeduplicationId:   entry.MessageDeduplicationId
        });

        successful.push({
          Id:               entry.Id,
          MessageId:        result.MessageId,
          SequenceNumber:   result.SequenceNumber
        });
      } catch (err) {
        failed.push({
          Id:          entry.Id,
          Code:        err.code || 'InternalFailure',
          Message:     err.message,
          SenderFault: true
        });
      }
    }

    return { Successful: successful, Failed: failed };
  }

  // ─────────────────────────────────────────────
  //  Delivery Engine
  // ─────────────────────────────────────────────

  /**
   * Entrega mensagem para um subscriber
   * @param {Object} subscription
   * @param {*}      message
   * @param {string} [messageStructure]
   * @param {string} [subject]
   * @param {Object} [messageAttributes]
   * @param {string} messageId
   * @returns {Promise<void>}
   * @private
   */
  async _deliver(subscription, message, messageStructure, subject, messageAttributes = {}, messageId) {
    // Aplicar FilterPolicy
    if (subscription.FilterPolicy) {
      const scope     = subscription.FilterPolicyScope || 'MessageAttributes';
      const matchData = scope === 'MessageBody'
        ? (typeof message === 'string' ? JSON.parse(message) : message)
        : messageAttributes;

      if (!this._matchesFilterPolicy(subscription.FilterPolicy, matchData, scope)) {
        this.logger.debug('SNS', `Message filtered for ${subscription.SubscriptionArn}`);
        return;
      }
    }

    // Resolver conteúdo para o protocolo (MessageStructure=json)
    let content = message;
    if (messageStructure === 'json' && typeof message === 'object') {
      content = message[subscription.Protocol] || message.default || '';
    }

    // Construir envelope SNS
    const envelope = subscription.RawMessageDelivery === 'true'
      ? (typeof content === 'string' ? content : JSON.stringify(content))
      : {
          Type:             'Notification',
          MessageId:        messageId,
          TopicArn:         subscription.TopicArn,
          Subject:          subject || 'Amazon SNS',
          Message:          typeof content === 'string' ? content : JSON.stringify(content),
          Timestamp:        new Date().toISOString(),
          SignatureVersion: '1',
          Signature:        'LOCAL_SIMULATOR_NO_SIGNATURE',
          SigningCertURL:   `https://sns.${this.region}.amazonaws.com/SimpleNotificationService.pem`,
          UnsubscribeURL:   `http://localhost:${this.config.services?.sns?.port || 9911}/?Action=Unsubscribe&SubscriptionArn=${subscription.SubscriptionArn}`,
          MessageAttributes: messageAttributes
        };

    switch (subscription.Protocol) {
      case 'lambda':
        await this._deliverToLambda(subscription.Endpoint, envelope, messageId, subscription.SubscriptionArn);
        break;

      case 'sqs':
        await this._deliverToSqs(subscription.Endpoint, envelope, subscription.RawMessageDelivery === 'true');
        break;

      case 'http':
      case 'https':
        await this._deliverToHttp(subscription.Endpoint, envelope, subscription.Protocol);
        break;

      case 'email':
        this.logger.info('SNS', `[EMAIL MOCK] To: ${subscription.Endpoint} | Subject: ${subject || 'No subject'} | Body: ${String(content).substring(0, 200)}`);
        break;

      case 'email-json':
        this.logger.info('SNS', `[EMAIL-JSON MOCK] To: ${subscription.Endpoint} | Payload: ${JSON.stringify(envelope).substring(0, 200)}`);
        break;

      case 'sms':
        if (!this.optedOutNumbers.has(subscription.Endpoint)) {
          this.logger.info('SNS', `[SMS MOCK] To: ${subscription.Endpoint} | Message: ${String(content).substring(0, 160)}`);
        }
        break;

      case 'application':
        this.logger.info('SNS', `[PUSH MOCK] Endpoint: ${subscription.Endpoint} | Payload: ${String(content).substring(0, 200)}`);
        break;

      default:
        this.logger.warn('SNS', `Unsupported protocol: ${subscription.Protocol}`);
    }
  }

  /**
   * Entrega para função Lambda via SNS Records
   * @param {string} endpoint - Lambda ARN
   * @param {Object|string} envelope
   * @param {string} messageId
   * @param {string} subscriptionArn
   * @returns {Promise<void>}
   * @private
   */
  async _deliverToLambda(endpoint, envelope, messageId, subscriptionArn) {
    if (!this.lambdaService) {
      this.logger.warn('SNS', 'Lambda service not available for delivery');
      return;
    }

    const funcMatch = endpoint.match(/function:([^:]+)/);
    if (!funcMatch) {
      this.logger.warn('SNS', `Cannot parse Lambda ARN: ${endpoint}`);
      return;
    }

    const functionName = funcMatch[1];
    const isRaw        = typeof envelope === 'string';
    const snsPayload   = isRaw ? { Message: envelope } : envelope;

    const event = {
      Records: [{
        EventSource:            'aws:sns',
        EventVersion:           '1.0',
        EventSubscriptionArn:   subscriptionArn,
        Sns: {
          Type:             snsPayload.Type || 'Notification',
          MessageId:        messageId,
          TopicArn:         snsPayload.TopicArn || endpoint,
          Subject:          snsPayload.Subject   || '',
          Message:          snsPayload.Message   || '',
          Timestamp:        snsPayload.Timestamp || new Date().toISOString(),
          SignatureVersion: snsPayload.SignatureVersion || '1',
          Signature:        snsPayload.Signature || 'LOCAL_SIMULATOR',
          MessageAttributes: snsPayload.MessageAttributes || {}
        }
      }]
    };

    try {
      await this.lambdaService.simulator.invokeFunction(functionName, event);
      this.logger.debug('SNS', `Delivered to Lambda: ${functionName}`);
    } catch (err) {
      this.logger.error('SNS', `Lambda delivery failed [${functionName}]: ${err.message}`);
      throw err;
    }
  }

  /**
   * Entrega mensagem para fila SQS
   * @param {string} endpoint - SQS URL ou ARN
   * @param {Object|string} envelope
   * @param {boolean} rawDelivery
   * @returns {Promise<void>}
   * @private
   */
  async _deliverToSqs(endpoint, envelope, rawDelivery) {
    if (!this.sqsService) {
      this.logger.warn('SNS', 'SQS service not available for delivery');
      return;
    }

    const messageBody = rawDelivery
      ? (typeof envelope === 'string' ? envelope : JSON.stringify(envelope))
      : JSON.stringify(envelope);

    try {
      await this.sqsService.simulator.sendMessage({ QueueUrl: endpoint, MessageBody: messageBody });
      this.logger.debug('SNS', `Delivered to SQS: ${endpoint}`);
    } catch (err) {
      this.logger.error('SNS', `SQS delivery failed [${endpoint}]: ${err.message}`);
      throw err;
    }
  }

  /**
   * Entrega mensagem via HTTP/HTTPS
   * @param {string} endpoint
   * @param {Object|string} envelope
   * @param {string} protocol
   * @returns {Promise<void>}
   * @private
   */
  async _deliverToHttp(endpoint, envelope, protocol) {
    const httpModule  = require(protocol === 'https' ? 'https' : 'http');
    const body        = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);

    return new Promise((resolve) => {
      try {
        const url = new URL(endpoint);
        const req = httpModule.request({
          hostname: url.hostname,
          port:     url.port || (protocol === 'https' ? 443 : 80),
          path:     url.pathname + url.search,
          method:   'POST',
          headers: {
            'Content-Type':             'application/json',
            'Content-Length':           Buffer.byteLength(body),
            'x-amz-sns-message-type':   'Notification',
            'x-amz-sns-topic-arn':      envelope.TopicArn || '',
            'x-amz-sns-message-id':     envelope.MessageId || ''
          }
        }, (res) => {
          this.logger.debug('SNS', `HTTP delivery to ${endpoint}: HTTP ${res.statusCode}`);
          resolve();
        });

        req.on('error', (err) => {
          this.logger.warn('SNS', `HTTP delivery failed [${endpoint}]: ${err.message}`);
          resolve(); // não propagar erro
        });

        req.setTimeout(5000, () => {
          req.destroy();
          this.logger.warn('SNS', `HTTP delivery timeout [${endpoint}]`);
          resolve();
        });

        req.write(body);
        req.end();
      } catch (err) {
        this.logger.warn('SNS', `HTTP delivery error: ${err.message}`);
        resolve();
      }
    });
  }

  // ─────────────────────────────────────────────
  //  Filter Policy
  // ─────────────────────────────────────────────

  /**
   * Verifica se os atributos/body da mensagem correspondem ao FilterPolicy
   * @param {Object} filterPolicy
   * @param {Object} data  - MessageAttributes ou body da mensagem
   * @param {string} scope - 'MessageAttributes' | 'MessageBody'
   * @returns {boolean}
   * @private
   */
  _matchesFilterPolicy(filterPolicy, data, scope = 'MessageAttributes') {
    for (const [key, conditions] of Object.entries(filterPolicy)) {
      let value;

      if (scope === 'MessageBody') {
        value = this._getNestedValue(data, key);
      } else {
        const attr = data[key];
        if (!attr) return false;
        value = attr.Value || attr.StringValue || attr.NumberValue;
      }

      if (value === undefined || value === null) return false;

      if (!Array.isArray(conditions)) continue;

      const matched = conditions.some(cond => {
        // Valor direto (string)
        if (typeof cond === 'string') return String(value) === cond;

        // Valor nulo
        if (cond === null) return value === null || value === undefined;

        // Objeto de condição
        if (typeof cond === 'object') {
          if ('prefix' in cond)        return String(value).startsWith(cond.prefix);
          if ('suffix' in cond)        return String(value).endsWith(cond.suffix);
          if ('numeric' in cond)       return this._checkNumeric(parseFloat(value), cond.numeric);
          if ('anything-but' in cond)  return !cond['anything-but'].includes(value);
          if ('exists' in cond)        return cond.exists ? (value !== undefined) : (value === undefined);
        }

        return false;
      });

      if (!matched) return false;
    }

    return true;
  }

  /**
   * Obtém valor aninhado em objeto usando notação de ponto
   * @param {Object} obj
   * @param {string} key
   * @returns {*}
   * @private
   */
  _getNestedValue(obj, key) {
    return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
  }

  /**
   * Verifica condição numérica do FilterPolicy
   * @param {number} value
   * @param {Array}  conditions  - ex: ['>', 5, '<=', 10]
   * @returns {boolean}
   * @private
   */
  _checkNumeric(value, conditions) {
    if (isNaN(value)) return false;

    for (let i = 0; i < conditions.length; i += 2) {
      const op        = conditions[i];
      const threshold = conditions[i + 1];
      if (op === '='  && value !== threshold) return false;
      if (op === '>'  && value <= threshold)  return false;
      if (op === '>=' && value <  threshold)  return false;
      if (op === '<'  && value >= threshold)  return false;
      if (op === '<=' && value >  threshold)  return false;
    }

    return true;
  }

  // ─────────────────────────────────────────────
  //  Tags
  // ─────────────────────────────────────────────

  /**
   * TagResource — adiciona tags a um recurso SNS
   * @param {Object} params
   * @param {string} params.ResourceArn
   * @param {Array}  params.Tags - [{Key, Value}]
   * @returns {Promise<void>}
   */
  async tagResource(params) {
    const { ResourceArn, Tags = [] } = params;

    if (!this.topics.has(ResourceArn) && !this.platformApps.has(ResourceArn)) {
      throw this._error('ResourceNotFoundException', `Resource not found: ${ResourceArn}`);
    }

    const existing = this.tags.get(ResourceArn) || [];
    const merged   = [...existing];

    for (const tag of Tags) {
      const idx = merged.findIndex(t => t.Key === tag.Key);
      if (idx >= 0) merged[idx] = tag;
      else merged.push(tag);
    }

    this.tags.set(ResourceArn, merged);
    await this._save();

    this.logger.debug('SNS', `Tagged resource ${ResourceArn}: ${Tags.map(t => `${t.Key}=${t.Value}`).join(', ')}`);
  }

  /**
   * UntagResource — remove tags de um recurso SNS
   * @param {Object} params
   * @param {string} params.ResourceArn
   * @param {Array}  params.TagKeys
   * @returns {Promise<void>}
   */
  async untagResource(params) {
    const { ResourceArn, TagKeys = [] } = params;

    if (!this.topics.has(ResourceArn) && !this.platformApps.has(ResourceArn)) {
      throw this._error('ResourceNotFoundException', `Resource not found: ${ResourceArn}`);
    }

    const existing = this.tags.get(ResourceArn) || [];
    this.tags.set(ResourceArn, existing.filter(t => !TagKeys.includes(t.Key)));
    await this._save();

    this.logger.debug('SNS', `Untagged resource ${ResourceArn}: ${TagKeys.join(', ')}`);
  }

  /**
   * ListTagsForResource — lista tags de um recurso
   * @param {Object} params
   * @param {string} params.ResourceArn
   * @returns {{Tags: Array}}
   */
  listTagsForResource(params) {
    const { ResourceArn } = params;

    if (!this.topics.has(ResourceArn) && !this.platformApps.has(ResourceArn)) {
      throw this._error('ResourceNotFoundException', `Resource not found: ${ResourceArn}`);
    }

    return { Tags: this.tags.get(ResourceArn) || [] };
  }

  // ─────────────────────────────────────────────
  //  Platform Applications (Push Notifications)
  // ─────────────────────────────────────────────

  /**
   * CreatePlatformApplication — cria aplicação de plataforma (APNs/FCM/GCM)
   * @param {Object} params
   * @returns {Promise<{PlatformApplicationArn: string}>}
   */
  async createPlatformApplication(params) {
    const { Name, Platform, Attributes = {} } = params;

    if (!Name || !Platform) {
      throw this._error('InvalidParameter', 'Name and Platform are required');
    }

    const validPlatforms = ['ADM', 'APNS', 'APNS_SANDBOX', 'GCM', 'FCM', 'BAIDU', 'WNS', 'MPNS'];
    if (!validPlatforms.includes(Platform)) {
      throw this._error('InvalidParameter', `Invalid platform: ${Platform}`);
    }

    const arn = `arn:aws:sns:${this.region}:${this.accountId}:app/${Platform}/${Name}`;

    const app = {
      PlatformApplicationArn: arn,
      Name,
      Platform,
      Attributes: {
        Enabled:         'true',
        SuccessFeedbackRoleArn: '',
        FailureFeedbackRoleArn: '',
        ...Attributes
      },
      CreatedAt: new Date().toISOString()
    };

    this.platformApps.set(arn, app);
    await this._save();

    this.logger.info('SNS', `Created platform application: ${Name} (${Platform})`);
    return { PlatformApplicationArn: arn };
  }

  /**
   * DeletePlatformApplication — remove uma aplicação de plataforma
   * @param {Object} params
   * @param {string} params.PlatformApplicationArn
   * @returns {Promise<void>}
   */
  async deletePlatformApplication(params) {
    const { PlatformApplicationArn } = params;

    if (!this.platformApps.has(PlatformApplicationArn)) {
      throw this._error('NotFound', `Platform application not found: ${PlatformApplicationArn}`);
    }

    // Remover endpoints associados
    for (const [arn, ep] of this.platformEndpoints.entries()) {
      if (ep.PlatformApplicationArn === PlatformApplicationArn) {
        this.platformEndpoints.delete(arn);
      }
    }

    this.platformApps.delete(PlatformApplicationArn);
    await this._save();

    this.logger.info('SNS', `Deleted platform application: ${PlatformApplicationArn}`);
  }

  /**
   * ListPlatformApplications — lista aplicações de plataforma
   * @param {Object} [params]
   * @returns {{PlatformApplications: Array, NextToken?: string}}
   */
  listPlatformApplications(params = {}) {
    const apps     = Array.from(this.platformApps.values());
    const pageSize = 100;
    let startIdx   = 0;

    if (params.NextToken) {
      try { startIdx = parseInt(Buffer.from(params.NextToken, 'base64').toString('utf8'), 10) || 0; }
      catch { startIdx = 0; }
    }

    const page    = apps.slice(startIdx, startIdx + pageSize);
    const nextIdx = startIdx + pageSize;
    const token   = nextIdx < apps.length ? Buffer.from(String(nextIdx)).toString('base64') : undefined;

    return {
      PlatformApplications: page.map(a => ({
        PlatformApplicationArn: a.PlatformApplicationArn,
        Attributes:             a.Attributes
      })),
      ...(token && { NextToken: token })
    };
  }

  /**
   * CreatePlatformEndpoint — cria endpoint de dispositivo
   * @param {Object} params
   * @returns {Promise<{EndpointArn: string}>}
   */
  async createPlatformEndpoint(params) {
    const { PlatformApplicationArn, Token, CustomUserData = '', Attributes = {} } = params;

    if (!this.platformApps.has(PlatformApplicationArn)) {
      throw this._error('NotFound', `Platform application not found: ${PlatformApplicationArn}`);
    }

    if (!Token) throw this._error('InvalidParameter', 'Token is required');

    const endpointId = crypto.randomUUID();
    const app        = this.platformApps.get(PlatformApplicationArn);
    const arn        = `arn:aws:sns:${this.region}:${this.accountId}:endpoint/${app.Platform}/${app.Name}/${endpointId}`;

    const endpoint = {
      EndpointArn:            arn,
      PlatformApplicationArn,
      Token,
      CustomUserData,
      Attributes: {
        Enabled: 'true',
        Token,
        CustomUserData,
        ...Attributes
      },
      CreatedAt: new Date().toISOString()
    };

    this.platformEndpoints.set(arn, endpoint);
    await this._save();

    this.logger.info('SNS', `Created platform endpoint: ${arn}`);
    return { EndpointArn: arn };
  }

  /**
   * DeleteEndpoint — remove endpoint de dispositivo
   * @param {Object} params
   * @param {string} params.EndpointArn
   * @returns {Promise<void>}
   */
  async deleteEndpoint(params) {
    const { EndpointArn } = params;

    if (!this.platformEndpoints.has(EndpointArn)) {
      throw this._error('NotFound', `Endpoint not found: ${EndpointArn}`);
    }

    this.platformEndpoints.delete(EndpointArn);
    await this._save();

    this.logger.info('SNS', `Deleted endpoint: ${EndpointArn}`);
  }

  /**
   * GetEndpointAttributes — retorna atributos de um endpoint
   * @param {Object} params
   * @param {string} params.EndpointArn
   * @returns {{Attributes: Object}}
   */
  getEndpointAttributes(params) {
    const { EndpointArn } = params;
    const ep = this.platformEndpoints.get(EndpointArn);
    if (!ep) throw this._error('NotFound', `Endpoint not found: ${EndpointArn}`);
    return { Attributes: ep.Attributes };
  }

  /**
   * SetEndpointAttributes — atualiza atributos de um endpoint
   * @param {Object} params
   * @returns {Promise<void>}
   */
  async setEndpointAttributes(params) {
    const { EndpointArn, Attributes = {} } = params;
    const ep = this.platformEndpoints.get(EndpointArn);
    if (!ep) throw this._error('NotFound', `Endpoint not found: ${EndpointArn}`);

    Object.assign(ep.Attributes, Attributes);
    await this._save();
  }

  /**
   * ListEndpointsByPlatformApplication — lista endpoints de uma plataforma
   * @param {Object} params
   * @returns {{Endpoints: Array, NextToken?: string}}
   */
  listEndpointsByPlatformApplication(params) {
    const { PlatformApplicationArn, NextToken } = params;

    if (!this.platformApps.has(PlatformApplicationArn)) {
      throw this._error('NotFound', `Platform application not found: ${PlatformApplicationArn}`);
    }

    const eps      = Array.from(this.platformEndpoints.values())
      .filter(e => e.PlatformApplicationArn === PlatformApplicationArn);
    const pageSize = 100;
    let startIdx   = 0;

    if (NextToken) {
      try { startIdx = parseInt(Buffer.from(NextToken, 'base64').toString('utf8'), 10) || 0; }
      catch { startIdx = 0; }
    }

    const page    = eps.slice(startIdx, startIdx + pageSize);
    const nextIdx = startIdx + pageSize;
    const token   = nextIdx < eps.length ? Buffer.from(String(nextIdx)).toString('base64') : undefined;

    return {
      Endpoints: page.map(e => ({ EndpointArn: e.EndpointArn, Attributes: e.Attributes })),
      ...(token && { NextToken: token })
    };
  }

  // ─────────────────────────────────────────────
  //  SMS Opt-out
  // ─────────────────────────────────────────────

  /**
   * CheckIfPhoneNumberIsOptedOut — verifica se número optou por sair
   * @param {Object} params
   * @param {string} params.phoneNumber
   * @returns {{isOptedOut: boolean}}
   */
  checkIfPhoneNumberIsOptedOut(params) {
    return { isOptedOut: this.optedOutNumbers.has(params.phoneNumber) };
  }

  /**
   * ListPhoneNumbersOptedOut — lista números que optaram por sair
   * @returns {{phoneNumbers: Array}}
   */
  listPhoneNumbersOptedOut() {
    return { phoneNumbers: Array.from(this.optedOutNumbers) };
  }

  /**
   * OptInPhoneNumber — reincluir número que optou por sair
   * @param {Object} params
   * @param {string} params.phoneNumber
   * @returns {Promise<void>}
   */
  async optInPhoneNumber(params) {
    this.optedOutNumbers.delete(params.phoneNumber);
    this.logger.info('SNS', `Opted-in: ${params.phoneNumber}`);
  }

  // ─────────────────────────────────────────────
  //  SMS Attributes
  // ─────────────────────────────────────────────

  /**
   * SetSMSAttributes — configura atributos SMS globais
   * @param {Object} params
   * @param {Object} params.attributes
   * @returns {Promise<void>}
   */
  async setSmsAttributes(params) {
    Object.assign(this.smsAttributes, params.attributes || {});
    this.logger.debug('SNS', `SMS attributes updated`);
  }

  /**
   * GetSMSAttributes — retorna atributos SMS globais
   * @param {Object} [params]
   * @returns {{attributes: Object}}
   */
  getSmsAttributes(params = {}) {
    const { attributes = [] } = params;

    if (!attributes.length) return { attributes: { ...this.smsAttributes } };

    const filtered = {};
    for (const key of attributes) {
      if (key in this.smsAttributes) filtered[key] = this.smsAttributes[key];
    }

    return { attributes: filtered };
  }

  // ─────────────────────────────────────────────
  //  Publish Log (Admin)
  // ─────────────────────────────────────────────

  /**
   * Registra publicação no log interno
   * @param {string|null} topicArn
   * @param {string}      messageId
   * @param {string}      message
   * @param {string|null} [phoneNumber]
   * @param {Object}      [messageAttributes]
   * @private
   */
  _logPublish(topicArn, messageId, message, phoneNumber = null, messageAttributes = {}) {
    this.publishLog.unshift({
      messageId,
      topicArn,
      phoneNumber,
      message:           String(message).substring(0, 500),
      messageAttributes,
      timestamp:         new Date().toISOString()
    });

    // Manter apenas as últimas 500
    if (this.publishLog.length > 500) this.publishLog.pop();
  }

  // ─────────────────────────────────────────────
  //  Reset
  // ─────────────────────────────────────────────

  /**
   * Limpa todos os dados do simulador
   * @returns {Promise<void>}
   */
  async reset() {
    this.topics.clear();
    this.subscriptions.clear();
    this.pendingTokens.clear();
    this.platformApps.clear();
    this.platformEndpoints.clear();
    this.tags.clear();
    this.publishLog = [];
    this.optedOutNumbers.clear();
    this.smsAttributes = { DefaultSMSType: 'Transactional', MonthlySpendLimit: '1' };

    await this._save();
    this.logger.info('SNS', 'Data reset complete');
  }
}

module.exports = { SNSSimulator };
