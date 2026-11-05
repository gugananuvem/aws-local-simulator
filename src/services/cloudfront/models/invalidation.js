/**
 * CloudFront Invalidation Model
 * Gerencia invalidação de cache
 */

const crypto = require('crypto');

class Invalidation {
  constructor(params = {}) {
    this.Id = params.Id || this.generateId();
    this.DistributionId = params.DistributionId;
    this.CreateTime = new Date();
    this.Status = params.Status || 'InProgress';
    this.CallerReference = params.CallerReference || crypto.randomUUID();
    
    // Paths to invalidate
    this.Paths = params.Paths || {
      Quantity: 0,
      Items: []
    };

    // Progress (0-100)
    this.Progress = params.Progress !== undefined ? params.Progress : 0;

    // Estimated completion time (após 5 minutos é normalmente completo)
    this.EstimatedCompletionTime = new Date(Date.now() + 5 * 60 * 1000);
  }

  generateId() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
  }

  /**
   * Marcar como concluída
   */
  complete() {
    this.Status = 'Completed';
    this.Progress = 100;
  }

  /**
   * Verificar se path deve ser invalidado
   */
  shouldInvalidate(path) {
    if (!this.Paths?.Items) {
      return false;
    }

    for (const invalidationPath of this.Paths.Items) {
      if (this.pathMatches(path, invalidationPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Verificar se path corresponde ao padrão de invalidação
   * Suporta wildcards: *.jpg, /api/*, etc
   */
  pathMatches(path, pattern) {
    if (pattern === '*') {
      return true;
    }

    // Converter glob pattern para regex
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
   * Retornar invalidação em formato AWS
   */
  toAWSFormat() {
    return {
      Id: this.Id,
      DistributionId: this.DistributionId,
      CreateTime: this.CreateTime,
      Status: this.Status,
      Paths: this.Paths,
      InvalidationBatch: {
        Paths: this.Paths,
        CallerReference: this.CallerReference
      },
      Progress: this.Progress
    };
  }

  /**
   * Obter invalidation em formato para resposta
   */
  getSummary() {
    return {
      Id: this.Id,
      CreateTime: this.CreateTime,
      Status: this.Status
    };
  }
}

module.exports = Invalidation;
