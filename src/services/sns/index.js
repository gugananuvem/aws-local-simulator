/**
 * SNS Service - Ponto de entrada (Stub para implementação futura)
 */

const logger = require('../../utils/logger');

class SNSService {
  constructor(config) {
    this.config = config;
    this.name = 'sns';
    this.port = config.ports.sns;
    this.isRunning = false;
    this.topics = new Map();
  }

  async initialize() {
    logger.debug(`Inicializando SNS Service na porta ${this.port}...`);
    logger.warn('⚠️ SNS Service ainda não está completamente implementado');
    
    // TODO: Implementar SNS simulator
    // Por enquanto, apenas cria um stub
    this.topics = new Map();
  }

  async start() {
    if (this.isRunning) return;
    
    // TODO: Iniciar servidor HTTP para SNS
    this.isRunning = true;
    logger.info(`📢 SNS Service stub rodando (porta ${this.port}) - Implementação em breve`);
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
  }

  async reset() {
    this.topics.clear();
    logger.debug('SNS: Todos os dados resetados');
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      implemented: false,
      topicsCount: this.topics.size
    };
  }

  // Métodos stub para compatibilidade
  async createTopic(topicName) {
    if (!this.topics.has(topicName)) {
      this.topics.set(topicName, {
        name: topicName,
        arn: `arn:aws:sns:local:000000000000:${topicName}`,
        subscriptions: [],
        createdAt: new Date().toISOString()
      });
    }
    return this.topics.get(topicName);
  }

  async publish(topicArn, message) {
    const topic = Array.from(this.topics.values()).find(t => t.arn === topicArn);
    if (!topic) {
      throw new Error(`Topic not found: ${topicArn}`);
    }
    logger.verboso(`SNS: Published message to ${topic.name}`);
    return { MessageId: Math.random().toString(36).substring(7) };
  }
}

module.exports = SNSService;