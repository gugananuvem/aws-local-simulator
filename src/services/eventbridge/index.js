/**
 * EventBridge Service - Ponto de entrada (Stub para implementação futura)
 */

const logger = require('../../utils/logger');

class EventBridgeService {
  constructor(config) {
    this.config = config;
    this.name = 'eventbridge';
    this.port = config.ports.eventbridge;
    this.isRunning = false;
    this.buses = new Map();
    this.events = [];
  }

  async initialize() {
    logger.debug(`Inicializando EventBridge Service na porta ${this.port}...`);
    logger.warn('⚠️ EventBridge Service ainda não está completamente implementado');
    
    // TODO: Implementar EventBridge simulator
    this.buses = new Map();
    this.events = [];
  }

  async start() {
    if (this.isRunning) return;
    
    // TODO: Iniciar servidor HTTP para EventBridge
    this.isRunning = true;
    logger.info(`🎯 EventBridge Service stub rodando (porta ${this.port}) - Implementação em breve`);
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
  }

  async reset() {
    this.buses.clear();
    this.events = [];
    logger.debug('EventBridge: Todos os dados resetados');
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      implemented: false,
      busesCount: this.buses.size,
      eventsCount: this.events.length
    };
  }

  // Métodos stub para compatibilidade
  async createEventBus(name) {
    if (!this.buses.has(name)) {
      this.buses.set(name, {
        name,
        arn: `arn:aws:events:local:000000000000:event-bus/${name}`,
        createdAt: new Date().toISOString()
      });
    }
    return this.buses.get(name);
  }

  async putEvents(entries) {
    const results = [];
    for (const entry of entries) {
      const eventId = Math.random().toString(36).substring(7);
      this.events.push({
        ...entry,
        eventId,
        time: new Date().toISOString(),
        receivedAt: new Date().toISOString()
      });
      results.push({ EventId: eventId });
      logger.verboso(`EventBridge: Event ${eventId} published to ${entry.EventBusName || 'default'}`);
    }
    return { Entries: results, FailedEntryCount: 0 };
  }
}

module.exports = EventBridgeService;