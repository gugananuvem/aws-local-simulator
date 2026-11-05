/**
 * CloudFront Behavior Model
 * Define como CloudFront comporta-se para diferentes paths
 */

class Behavior {
  constructor(params = {}) {
    this.PathPattern = params.PathPattern || '*';  // null for default
    this.TargetOriginId = params.TargetOriginId;
    this.ViewerProtocolPolicy = params.ViewerProtocolPolicy || 'allow-all';
    this.AllowedMethods = params.AllowedMethods || {
      Quantity: 2,
      Items: ['GET', 'HEAD']
    };
    this.CachedMethods = params.CachedMethods || {
      Quantity: 2,
      Items: ['GET', 'HEAD']
    };
    
    // Caching
    this.CachePolicyId = params.CachePolicyId || '658327ea-f89d-4fab-a63d-7e88639e58f6';
    this.OriginRequestPolicyId = params.OriginRequestPolicyId || null;
    this.ResponseHeadersPolicyId = params.ResponseHeadersPolicyId || null;
    
    // TTL (deprecated, for backwards compatibility)
    this.MinTTL = params.MinTTL || 0;
    this.DefaultTTL = params.DefaultTTL || 86400;
    this.MaxTTL = params.MaxTTL || 31536000;
    
    // Compression
    this.Compress = params.Compress !== false;
    
    // Forwarded values
    this.ForwardedValues = params.ForwardedValues || {
      QueryString: true,
      Cookies: { Forward: 'all' },
      Headers: { Quantity: 0, Items: [] }
    };
    
    // Trusted signers (for signed URLs/cookies)
    this.TrustedSigners = params.TrustedSigners || {
      Enabled: false,
      Quantity: 0,
      Items: []
    };
    
    // Field-level encryption
    this.FieldLevelEncryptionId = params.FieldLevelEncryptionId || null;
    
    // Lambda@Edge
    this.LambdaFunctionAssociations = params.LambdaFunctionAssociations || {
      Quantity: 0,
      Items: []
    };
    
    // Realtime logs
    this.RealtimeLogConfigArn = params.RealtimeLogConfigArn || null;
  }

  /**
   * Validar behavior
   */
  validate() {
    const errors = [];

    if (!this.TargetOriginId) {
      errors.push('TargetOriginId is required');
    }

    if (!['allow-all', 'https-only', 'redirect-to-https'].includes(this.ViewerProtocolPolicy)) {
      errors.push('Invalid ViewerProtocolPolicy');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Obter política de cache baseada no CachePolicyId
   */
  getCachePolicy() {
    const managedPolicies = {
      '658327ea-f89d-4fab-a63d-7e88639e58f6': {
        name: 'CachingOptimized',
        ttl: { min: 0, default: 86400, max: 31536000 }
      },
      '4135ea3d-c35d-4c5f-bc95-6f532eef9d81': {
        name: 'CachingDisabled',
        ttl: { min: 0, default: 0, max: 0 }
      },
      '08627262-05a9-4f76-9ded-b50ec2b5fbf0': {
        name: 'Elemental',
        ttl: { min: 0, default: 0, max: 0 }
      }
    };

    return managedPolicies[this.CachePolicyId] || {
      name: 'Custom',
      ttl: { min: this.MinTTL, default: this.DefaultTTL, max: this.MaxTTL }
    };
  }

  /**
   * Verificar se request é cacheável
   */
  isCacheable(method = 'GET', statusCode = 200) {
    // GET e HEAD são cacheáveis por padrão
    if (!['GET', 'HEAD'].includes(method)) {
      return false;
    }

    // Apenas respostas 200 são cacheadas (simplificado)
    if (statusCode !== 200) {
      return false;
    }

    const cachePolicy = this.getCachePolicy();
    if (cachePolicy.name === 'CachingDisabled') {
      return false;
    }

    return true;
  }

  /**
   * Obter TTL baseado na política
   */
  getTTL() {
    const policy = this.getCachePolicy();
    return policy.ttl.default;
  }

  /**
   * Retornar behavior em formato AWS
   */
  toAWSFormat() {
    return {
      PathPattern: this.PathPattern,
      TargetOriginId: this.TargetOriginId,
      ViewerProtocolPolicy: this.ViewerProtocolPolicy,
      AllowedMethods: this.AllowedMethods,
      CachedMethods: this.CachedMethods,
      Compress: this.Compress,
      CachePolicyId: this.CachePolicyId,
      OriginRequestPolicyId: this.OriginRequestPolicyId,
      ResponseHeadersPolicyId: this.ResponseHeadersPolicyId,
      MinTTL: this.MinTTL,
      DefaultTTL: this.DefaultTTL,
      MaxTTL: this.MaxTTL,
      ForwardedValues: this.ForwardedValues,
      TrustedSigners: this.TrustedSigners
    };
  }
}

module.exports = Behavior;
