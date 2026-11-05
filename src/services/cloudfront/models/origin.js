/**
 * CloudFront Origin Model
 * Suporta S3, HTTP, e Lambda@Edge origins
 */

class Origin {
  constructor(params = {}) {
    this.Id = params.Id || 'default-origin';
    this.DomainName = params.DomainName || 'example.com';
    this.OriginPath = params.OriginPath || '';
    this.CustomHeaders = params.CustomHeaders || {
      Quantity: 0,
      Items: []
    };

    // Tipo de origem
    this.OriginType = this.detectOriginType(params.DomainName);

    // S3 Origin
    if (this.OriginType === 's3') {
      this.S3OriginConfig = params.S3OriginConfig || {
        OriginAccessIdentity: ''
      };
    }

    // HTTP/HTTPS Origin
    if (this.OriginType === 'http' || this.OriginType === 'lambda') {
      this.CustomOriginConfig = params.CustomOriginConfig || {
        HTTPPort: 80,
        HTTPSPort: 443,
        OriginProtocolPolicy: 'https-only',
        OriginSslProtocols: {
          Quantity: 3,
          Items: ['TLSv1', 'TLSv1.1', 'TLSv1.2']
        },
        OriginReadTimeout: 30,
        OriginKeepaliveTimeout: 5
      };
    }

    // Origin Shield
    this.OriginShield = params.OriginShield || {
      Enabled: false,
      OriginShieldRegion: null
    };

    // Origin Groups (para failover)
    this.OriginGroupId = params.OriginGroupId || null;

    // Lambda@Edge
    this.LambdaFunctionAssociations = params.LambdaFunctionAssociations || {
      Quantity: 0,
      Items: []
    };

    // Origin Access Control
    this.OriginAccessControlId = params.OriginAccessControlId || null;

    // Connection settings
    this.ConnectionAttempts = params.ConnectionAttempts || 3;
    this.ConnectionTimeout = params.ConnectionTimeout || 10;
  }

  /**
   Detectar tipo de origem
   */
  detectOriginType(domainName) {
    if (!domainName) return 'http';

    if (domainName.includes('.s3') || domainName.includes('s3.amazonaws.com')) {
      return 's3';
    }

    if (domainName.includes('.lambda.') || domainName.includes('lambda-url')) {
      return 'lambda';
    }

    return 'http';
  }

  /**
   * Validar origem
   */
  validate() {
    const errors = [];

    if (!this.Id) {
      errors.push('Origin Id is required');
    }

    if (!this.DomainName) {
      errors.push('Origin DomainName is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Retornar origem em formato AWS
   */
  toAWSFormat() {
    const origin = {
      Id: this.Id,
      DomainName: this.DomainName,
      OriginPath: this.OriginPath,
      CustomHeaders: this.CustomHeaders,
      ConnectionAttempts: this.ConnectionAttempts,
      ConnectionTimeout: this.ConnectionTimeout
    };

    if (this.OriginType === 's3') {
      origin.S3OriginConfig = this.S3OriginConfig;
    } else {
      origin.CustomOriginConfig = this.CustomOriginConfig;
    }

    if (this.OriginShield?.Enabled) {
      origin.OriginShield = this.OriginShield;
    }

    if (this.LambdaFunctionAssociations?.Quantity > 0) {
      origin.LambdaFunctionAssociations = this.LambdaFunctionAssociations;
    }

    if (this.OriginAccessControlId) {
      origin.OriginAccessControlId = this.OriginAccessControlId;
    }

    return origin;
  }

  /**
   * Obter URL completa do origin
   */
  getOriginUrl(path = '/') {
    const protocol = this.OriginType === 's3' || this.CustomOriginConfig?.OriginProtocolPolicy === 'https-only'
      ? 'https'
      : 'http';

    const port = protocol === 'https'
      ? (this.CustomOriginConfig?.HTTPSPort || 443)
      : (this.CustomOriginConfig?.HTTPPort || 80);

    const portString = (protocol === 'https' && port === 443) || (protocol === 'http' && port === 80)
      ? ''
      : `:${port}`;

    return `${protocol}://${this.DomainName}${portString}${this.OriginPath}${path}`;
  }
}

module.exports = Origin;
