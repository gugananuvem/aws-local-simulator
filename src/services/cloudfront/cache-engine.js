/**
 * CloudFront Cache Engine
 * Gerencia caching de objetos com TTL
 */

const logger = require('../../utils/logger');

class CacheEngine {
  constructor(config = {}) {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      bytesStored: 0
    };
    this.maxSize = config.maxSize || 100 * 1024 * 1024; // 100MB default
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Cleanup every minute
  }

  /**
   * Gerar chave de cache
   */
  generateKey(distributionId, path, queryString = '') {
    return `${distributionId}:${path}${queryString ? '?' + queryString : ''}`;
  }

  /**
   * Get com validação de TTL
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      logger.debug(`Cache MISS: ${key}`);
      return null;
    }

    // Verificar se expirou
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.stats.misses++;
      logger.debug(`Cache EXPIRED: ${key}`);
      return null;
    }

    // Hit
    this.stats.hits++;
    entry.hits++;
    entry.lastAccessed = Date.now();
    logger.debug(`Cache HIT: ${key} (hits: ${entry.hits})`);

    return {
      data: entry.data,
      headers: entry.headers,
      statusCode: entry.statusCode,
      cacheKey: key,
      xCache: 'Hit from cloudfront'
    };
  }

  /**
   * Set com TTL
   */
  set(key, data, headers = {}, statusCode = 200, ttl = 86400) {
    // Calcular tamanho aproximado
    const size = JSON.stringify({ data, headers }).length;

    // Verificar espaço disponível
    if (this.stats.bytesStored + size > this.maxSize) {
      this.evictLRU();
    }

    const now = Date.now();
    const entry = {
      data,
      headers,
      statusCode,
      createdAt: now,
      expiresAt: now + (ttl * 1000),
      lastAccessed: now,
      hits: 0,
      size
    };

    this.cache.set(key, entry);
    this.stats.bytesStored += size;

    logger.debug(`Cache SET: ${key} (TTL: ${ttl}s, size: ${size} bytes)`);
  }

  /**
   * Invalidar cache por padrão
   */
  invalidate(pattern) {
    let invalidated = 0;

    for (const key of this.cache.keys()) {
      if (this.pathMatches(key.split(':')[1], pattern)) {
        const entry = this.cache.get(key);
        this.stats.bytesStored -= entry.size;
        this.cache.delete(key);
        invalidated++;
      }
    }

    logger.info(`Cache INVALIDATE: ${pattern} (${invalidated} entries)`);
    return invalidated;
  }

  /**
   * Invalidar tudo de uma distribuição
   */
  invalidateDistribution(distributionId) {
    let invalidated = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(distributionId + ':')) {
        const entry = this.cache.get(key);
        this.stats.bytesStored -= entry.size;
        this.cache.delete(key);
        invalidated++;
      }
    }

    logger.info(`Cache INVALIDATE DISTRIBUTION: ${distributionId} (${invalidated} entries)`);
    return invalidated;
  }

  /**
   * Verificar se path corresponde ao padrão
   */
  pathMatches(path, pattern) {
    if (pattern === '*') return true;

    const regex = new RegExp(
      '^' + pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
    );

    return regex.test(path);
  }

  /**
   * Remover item menos recentemente acessado (LRU)
   */
  evictLRU() {
    let lruKey = null;
    let lruTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      const entry = this.cache.get(lruKey);
      this.stats.bytesStored -= entry.size;
      this.cache.delete(lruKey);
      this.stats.evictions++;
      logger.debug(`Cache LRU EVICTION: ${lruKey}`);
    }
  }

  /**
   * Cleanup de entries expiradas
   */
  cleanup() {
    const now = Date.now();
    let expired = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.stats.bytesStored -= entry.size;
        this.cache.delete(key);
        expired++;
      }
    }

    if (expired > 0) {
      logger.debug(`Cache CLEANUP: ${expired} expired entries removed`);
    }
  }

  /**
   * Obter estatísticas do cache
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      cacheSize: this.cache.size,
      bytesStored: this.stats.bytesStored,
      maxSize: this.maxSize
    };
  }

  /**
   * Limpar cache completamente
   */
  clear() {
    this.cache.clear();
    this.stats.bytesStored = 0;
    logger.debug('Cache CLEARED');
  }

  /**
   * Destruir e parar cleanup
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.clear();
  }
}

module.exports = CacheEngine;
