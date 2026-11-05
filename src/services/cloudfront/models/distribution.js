/**
 * CloudFront Distribution Model
 * Representa uma distribuição CloudFront completa
 */

const crypto = require('crypto');

class Distribution {
  constructor(params = {}) {
    this.Id = params.Id || this.generateId();
    this.ARN = `arn:aws:cloudfront::123456789012:distribution/${this.Id}`;
    this.DomainName = params.DomainName || `${this.Id}.cloudfront.net`;
    this.CallerReference = params.CallerReference || crypto.randomUUID();
    this.Comment = params.Comment || '';
    this.DefaultRootObject = params.DefaultRootObject || 'index.html';
    this.Enabled = params.Enabled !== false;
    this.Status = 'Deployed';
    this.CreatedTime = new Date();
    this.LastModifiedTime = new Date();
    this.LastModifiedBy = params.LastModifiedBy || 'simulator';
    this.ETag = this.generateETag();
    
    // Origins
    this.Origins = params.Origins || {
      Quantity: 0,
      Items: []
    };

    // Default Cache Behavior
    this.DefaultCacheBehavior = params.DefaultCacheBehavior || {
      TargetOriginId: this.Origins.Items?.[0]?.Id || 'default-origin',
      ViewerProtocolPolicy: 'allow-all',
      TrustedSigners: { Enabled: false, Quantity: 0 },
      ForwardedValues: {
        QueryString: false,
        Cookies: { Forward: 'none' },
        Headers: { Quantity: 0 }
      },
      MinTTL: 0,
      DefaultTTL: 86400,
      MaxTTL: 31536000,
      Compress: false,
      CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6'
    };

    // Cache Behaviors (path patterns)
    this.CacheBehaviors = params.CacheBehaviors || {
      Quantity: 0,
      Items: []
    };

    // Geo Restrictions
    this.GeoRestriction = params.GeoRestriction || {
      RestrictionType: 'none',
      Quantity: 0,
      Items: []
    };

    // WebACL
    this.WebACLId = params.WebACLId || '';

    // HTTP Version
    this.HttpVersion = params.HttpVersion || 'http2';

    // IPv6 Enabled
    this.IsIPV6Enabled = params.IsIPV6Enabled !== false;

    // Invalidations in progress
    this.InvalidationsInProgress = 0;

    // Cache statistics
    this.CacheStats = {
      Hits: 0,
      Misses: 0,
      BytesSent: 0,
      BytesUploaded: 0
    };

    // Origin Shield
    this.OriginShield = params.OriginShield || {
      Enabled: false,
      OriginShieldRegion: null
    };

    // Custom domain (CNAME)
    this.Aliases = params.Aliases || {
      Quantity: 0,
      Items: []
    };

    // SSL/TLS
    this.ViewerCertificate = params.ViewerCertificate || {
      CloudFrontDefaultCertificate: true,
      ACMCertificateArn: null,
      SSLSupportMethod: null,
      MinimumProtocolVersion: 'TLSv1'
    };

    // Logging
    this.Logging = params.Logging || {
      Enabled: false,
      IncludeCookies: false,
      Bucket: null,
      Prefix: ''
    };

    // Price Class
    this.PriceClass = params.PriceClass || 'PriceClass_All';
  }

  /**
   * Getter para origins (compatibilidade com simulador)
   * Converte Origins com Items para array com propriedades em minúsculas
   */
  get origins() {
    if (!this.Origins?.Items) return [];
    return this.Origins.Items.map(item => ({
      id: item.Id || item.id,
      domainName: item.DomainName || item.domainName,
      originPath: item.OriginPath || item.originPath || '',
      customOriginConfig: item.CustomOriginConfig || item.customOriginConfig,
      s3OriginConfig: item.S3OriginConfig || item.s3OriginConfig,
      ...item // Manter todas as outras propriedades
    }));
  }

  /**
   * Getter para cache behaviors
   */
  get cacheBehaviors() {
    if (!this.CacheBehaviors?.Items) return [];
    return this.CacheBehaviors.Items.map(item => ({
      pathPattern: item.PathPattern || item.pathPattern,
      targetOriginId: item.TargetOriginId || item.targetOriginId,
      viewerProtocolPolicy: item.ViewerProtocolPolicy || item.viewerProtocolPolicy,
      ...item
    }));
  }

  generateId() {
    return crypto.randomBytes(7).toString('hex').toUpperCase();
  }

  generateETag() {
    const data = JSON.stringify({
      Origins: this.Origins,
      DefaultCacheBehavior: this.DefaultCacheBehavior,
      CacheBehaviors: this.CacheBehaviors,
      Enabled: this.Enabled,
      LastModifiedTime: this.LastModifiedTime
    });
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Encontrar behavior que corresponde ao path
   */
  matchBehavior(path) {
    // Procurar em Cache Behaviors por path pattern (mais específico primeiro)
    if (this.CacheBehaviors?.Items) {
      const sorted = [...this.CacheBehaviors.Items].sort((a, b) => {
        // Path patterns mais específicos primeiro
        const aSpecificity = this.calculatePathSpecificity(a.PathPattern);
        const bSpecificity = this.calculatePathSpecificity(b.PathPattern);
        return bSpecificity - aSpecificity;
      });

      for (const behavior of sorted) {
        if (this.pathMatches(path, behavior.PathPattern)) {
          return behavior;
        }
      }
    }

    // Retornar default behavior
    return this.DefaultCacheBehavior;
  }

  /**
   * Verificar se path corresponde ao pattern
   * Suporta wildcards: *.jpg, /api/*, etc
   */
  pathMatches(path, pattern) {
    if (!pattern || pattern === '*') {
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
   * Calcular especificidade do path pattern
   * Mais específico = maior número
   */
  calculatePathSpecificity(pattern) {
    if (!pattern) return 0;
    if (pattern === '*') return 1;
    
    // Contar caracteres não-wildcard
    const nonWildcard = pattern.replace(/[*?]/g, '').length;
    return nonWildcard;
  }

  /**
   * Atualizar ETag após modificação
   */
  updateETag() {
    this.ETag = this.generateETag();
    this.LastModifiedTime = new Date();
  }

  /**
   * Retornar distribuição em formato AWS
   */
  toAWSFormat() {
    return {
      Id: this.Id,
      ARN: this.ARN,
      Status: this.Status,
      LastModifiedTime: this.LastModifiedTime,
      DomainName: this.DomainName,
      Aliases: this.Aliases,
      DefaultRootObject: this.DefaultRootObject,
      Origins: this.Origins,
      DefaultCacheBehavior: this.DefaultCacheBehavior,
      CacheBehaviors: this.CacheBehaviors,
      CustomErrorResponses: {
        Quantity: 0,
        Items: []
      },
      Logging: this.Logging,
      Enabled: this.Enabled,
      Comment: this.Comment,
      Restrictions: {
        GeoRestriction: this.GeoRestriction
      },
      WebACLId: this.WebACLId,
      HttpVersion: this.HttpVersion,
      IsIPV6Enabled: this.IsIPV6Enabled,
      PriceClass: this.PriceClass
    };
  }

  /**
   * Retornar config da distribuição
   */
  getConfig() {
    return {
      CallerReference: this.CallerReference,
      ...this.toAWSFormat()
    };
  }

  /**
   * Validar distribuição
   */
  validate() {
    const errors = [];

    if (!this.Origins?.Items || this.Origins.Items.length === 0) {
      errors.push('Distribution must have at least one origin');
    }

    if (!this.DefaultCacheBehavior?.TargetOriginId) {
      errors.push('DefaultCacheBehavior must have a TargetOriginId');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = Distribution;
