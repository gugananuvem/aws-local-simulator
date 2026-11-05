/**
 * Policy Cache - TTL configurable
 * 
 * Cacheia resultados de avaliação de políticas para evitar
 * re-avaliação desnecessária (default: 60 segundos)
 */

const logger = require('./logger');

class PolicyCache {
  constructor(ttl = 60000) {
    this.cache = new Map();
    this.ttl = ttl; // milliseconds
    this.hits = 0;
    this.misses = 0;
    this.stats = {
      totalGets: 0,
      totalSets: 0,
      totalDeletes: 0,
      averageHitRate: 0
    };

    // Cleanup de entries expiradas a cada 30 segundos
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
  }

  /**
   * Get com verificação de expiração
   */
  get(key) {
    this.stats.totalGets++;
    
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      this.updateHitRate();
      return null;
    }

    // Verificar se expirou
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.misses++;
      this.updateHitRate();
      return null;
    }

    this.hits++;
    this.updateHitRate();
    entry.lastAccessed = Date.now();
    entry.accessCount++;

    logger.debug(`Cache HIT: ${key}`);
    return entry.value;
  }

  /**
   * Set com TTL automático
   */
  set(key, value) {
    this.stats.totalSets++;

    const now = Date.now();
    this.cache.set(key, {
      value,
      createdAt: now,
      expiresAt: now + this.ttl,
      lastAccessed: now,
      accessCount: 0
    });

    logger.debug(`Cache SET: ${key} (expires in ${this.ttl}ms)`);
  }

  /**
   * Invalidar entrada específica
   */
  delete(key) {
    this.stats.totalDeletes++;
    this.cache.delete(key);
    logger.debug(`Cache DELETE: ${key}`);
  }

  /**
   * Invalidar todas entries de um padrão
   * Ex: "123456789012|*" → deleta todas ações desse principal
   */
  deletePattern(pattern) {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    let deleted = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }

    logger.debug(`Cache DELETE PATTERN: ${pattern} (deleted ${deleted} entries)`);
    return deleted;
  }

  /**
   * Clear tudo
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    logger.debug(`Cache CLEAR: removed ${size} entries`);
  }

  /**
   * Cleanup de entries expiradas
   */
  cleanup() {
    const now = Date.now();
    let expired = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
        expired++;
      }
    }

    if (expired > 0) {
      logger.debug(`Cache CLEANUP: removed ${expired} expired entries`);
    }
  }

  /**
   * Retorna estatísticas do cache
   */
  getStats() {
    this.updateHitRate();

    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      totalRequests: this.hits + this.misses,
      hitRate: this.stats.averageHitRate.toFixed(2) + '%',
      ttl: this.ttl,
      stats: {
        ...this.stats,
        hits: this.hits,
        misses: this.misses
      }
    };
  }

  /**
   * Atualizar hit rate
   */
  updateHitRate() {
    const total = this.hits + this.misses;
    if (total > 0) {
      this.stats.averageHitRate = (this.hits / total) * 100;
    }
  }

  /**
   * Set TTL
   */
  setTTL(ttl) {
    this.ttl = ttl;
    logger.info(`Cache TTL updated to ${ttl}ms`);
  }

  /**
   * Get TTL
   */
  getTTL() {
    return this.ttl;
  }

  /**
   * Destruir e parar cleanup
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
    logger.debug('Cache destroyed');
  }

  /**
   * Invalidar cache de um principal
   * Útil quando uma role tem suas políticas atualizadas
   */
  invalidatePrincipal(principal) {
    const pattern = `${principal}|*`;
    return this.deletePattern(pattern);
  }

  /**
   * Invalidar cache de uma ação
   * Útil quando uma SCP afetando uma ação é modificada
   */
  invalidateAction(action) {
    const pattern = `*|${action}|*`;
    return this.deletePattern(pattern);
  }

  /**
   * Invalidar cache de um recurso
   * Útil quando permissões em um recurso mudam
   */
  invalidateResource(resource) {
    const pattern = `*|*|${resource}`;
    return this.deletePattern(pattern);
  }
}

module.exports = PolicyCache;
