const crypto = require('crypto');

/**
 * Origin Validator and Restriction Checker for CloudFront
 * Validates origin accessibility, enforces origin restrictions, and manages Origin Custom Headers
 */
class OriginValidator {
  constructor() {
    this.validationCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Validate that an origin is reachable and compatible
   * @param {object} origin - Origin object from Distribution
   * @returns {Promise<object>} Validation result
   */
  async validateOrigin(origin) {
    const cacheKey = `${origin.domainName}-${origin.id}`;
    
    // Check cache
    const cached = this.validationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.result;
    }

    try {
      const result = await this._performValidation(origin);
      
      // Cache result
      this.validationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      return {
        isValid: false,
        error: error.message,
        originId: origin.id
      };
    }
  }

  /**
   * Check if a request should be allowed based on origin restrictions
   * @param {object} origin - Origin object
   * @param {object} request - Request object with headers, ip, etc.
   * @returns {object} Restriction check result
   */
  checkOriginRestrictions(origin, request = {}) {
    const violations = [];

    // Check origin custom headers
    if (origin.customHeaders && origin.customHeaders.length > 0) {
      for (const header of origin.customHeaders) {
        const requestValue = request.headers?.[header.headerName];
        if (requestValue !== header.headerValue) {
          violations.push({
            type: 'CUSTOM_HEADER_MISMATCH',
            header: header.headerName,
            expected: header.headerValue,
            received: requestValue
          });
        }
      }
    }

    // Check origin SSL/TLS requirements
    if (origin.originSslProtocols && request.protocol) {
      const allowedProtocols = origin.originSslProtocols;
      if (!allowedProtocols.includes(request.protocol)) {
        violations.push({
          type: 'SSL_PROTOCOL_NOT_ALLOWED',
          allowed: allowedProtocols,
          requested: request.protocol
        });
      }
    }

    // Check keep-alive timeout
    if (origin.originKeepAliveTimeout !== undefined) {
      // This is more of a configuration that affects how long connections stay open
      // Not a restriction per se, but recorded for monitoring
    }

    return {
      isAllowed: violations.length === 0,
      violations: violations,
      originId: origin.id
    };
  }

  /**
   * Get origin-specific headers that should be forwarded to the origin
   * @param {object} origin - Origin object
   * @param {object} behavior - Behavior object (may have header policies)
   * @returns {object} Headers to forward to origin
   */
  getOriginHeaders(origin, behavior = {}) {
    const headers = {};

    // Add custom headers from origin
    if (origin.customHeaders && origin.customHeaders.length > 0) {
      for (const header of origin.customHeaders) {
        headers[header.headerName] = header.headerValue;
      }
    }

    // Add origin path if specified
    if (origin.originPath) {
      // This is typically handled at request routing level, not as a header
      // But we include it for reference
      headers['X-Origin-Path'] = origin.originPath;
    }

    // Add Host header (for HTTP/S origins)
    if (origin.domainName) {
      headers['Host'] = origin.domainName;
    }

    return headers;
  }

  /**
   * Validate origin group failover configuration
   * @param {object} originGroup - OriginGroup object
   * @param {object} distribution - Distribution object (contains origins)
   * @returns {object} Validation result
   */
  validateOriginGroup(originGroup, distribution = {}) {
    const errors = [];

    // Check primary member
    if (!originGroup.members || originGroup.members.length === 0) {
      errors.push('OriginGroup must have at least one member');
    }

    // Validate all members exist in distribution
    const originIds = distribution.origins?.map(o => o.id) || [];
    for (const member of originGroup.members || []) {
      if (!originIds.includes(member.originId)) {
        errors.push(`Origin '${member.originId}' not found in distribution`);
      }
    }

    // Check failover criteria
    if (originGroup.failoverCriteria) {
      const { statusCodes } = originGroup.failoverCriteria;
      if (statusCodes && statusCodes.length === 0) {
        errors.push('Failover status codes cannot be empty');
      }

      // Validate status codes
      if (statusCodes) {
        for (const code of statusCodes) {
          if (!Number.isInteger(code) || code < 100 || code > 599) {
            errors.push(`Invalid HTTP status code: ${code}`);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
      originGroupId: originGroup.id
    };
  }

  /**
   * Check if origin should be used based on failover criteria
   * @param {object} originGroup - OriginGroup object
   * @param {number} statusCode - HTTP status code from origin
   * @param {number} [failureCount] - Number of consecutive failures
   * @returns {boolean} True if should failover to next origin
   */
  shouldFailover(originGroup, statusCode, failureCount = 1) {
    if (!originGroup.failoverCriteria) {
      return false;
    }

    const { statusCodes, quantity } = originGroup.failoverCriteria;
    
    // Check if status code matches failover criteria
    if (statusCodes && statusCodes.includes(statusCode)) {
      return true;
    }

    // Check if we've hit failure threshold
    if (quantity && failureCount >= quantity) {
      return true;
    }

    return false;
  }

  /**
   * Get the next origin in failover sequence
   * @param {object} originGroup - OriginGroup object
   * @param {object} currentOrigin - Current origin being used
   * @returns {object|null} Next origin member or null if no more failovers
   */
  getFailoverOrigin(originGroup, currentOrigin) {
    if (!originGroup.members || originGroup.members.length === 0) {
      return null;
    }

    const currentIndex = originGroup.members.findIndex(
      m => m.originId === currentOrigin.id
    );

    if (currentIndex === -1 || currentIndex >= originGroup.members.length - 1) {
      return null; // No more origins to failover to
    }

    return originGroup.members[currentIndex + 1];
  }

  /**
   * Validate S3 origin specific requirements
   * @param {object} origin - Origin object
   * @returns {object} Validation result
   */
  validateS3Origin(origin) {
    const errors = [];
    const warnings = [];

    // S3 domain should end with .s3.amazonaws.com or regional variant
    const domainPattern = /\.s3[.-]([a-z0-9-]+)?\.amazonaws\.com$/i;
    if (!domainPattern.test(origin.domainName)) {
      errors.push(
        `S3 origin domain '${origin.domainName}' does not match expected S3 format`
      );
    }

    // Check for origin access identity configuration
    if (!origin.s3OriginConfig?.originAccessIdentity) {
      warnings.push(
        'S3 origin does not use Origin Access Identity (OAI); bucket must be public or have bucket policy'
      );
    }

    // Warn if using website endpoint instead of REST endpoint
    if (origin.domainName.includes('.s3-website-')) {
      warnings.push(
        'S3 website endpoint detected; use REST endpoint for better CloudFront compatibility'
      );
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
      warnings: warnings,
      originType: 'S3'
    };
  }

  /**
   * Validate HTTP origin specific requirements
   * @param {object} origin - Origin object
   * @returns {object} Validation result
   */
  validateHttpOrigin(origin) {
    const errors = [];
    const warnings = [];

    // Validate domain format
    try {
      new URL(`https://${origin.domainName}`);
    } catch (e) {
      errors.push(`Invalid domain name: ${origin.domainName}`);
    }

    // Check port
    if (origin.customOriginConfig?.httpPort) {
      const port = origin.customOriginConfig.httpPort;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`Invalid HTTP port: ${port}`);
      }
    }

    if (origin.customOriginConfig?.httpsPort) {
      const port = origin.customOriginConfig.httpsPort;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`Invalid HTTPS port: ${port}`);
      }
    }

    // Validate origin protocol policy
    const validPolicies = [
      'http-only',
      'https-only',
      'match-viewer'
    ];
    if (
      origin.customOriginConfig?.originProtocolPolicy &&
      !validPolicies.includes(origin.customOriginConfig.originProtocolPolicy)
    ) {
      errors.push(
        `Invalid origin protocol policy: ${origin.customOriginConfig.originProtocolPolicy}`
      );
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
      warnings: warnings,
      originType: 'HTTP'
    };
  }

  /**
   * Validate Lambda@Edge origin
   * @param {object} origin - Origin object
   * @returns {object} Validation result
   */
  validateLambdaEdgeOrigin(origin) {
    const errors = [];

    // Lambda@Edge functions should have ARN format
    const arnPattern = /^arn:aws:lambda:[a-z0-9-]+:\d{12}:function:[a-zA-Z0-9_-]+$/;
    if (!arnPattern.test(origin.domainName)) {
      errors.push(`Invalid Lambda@Edge ARN format: ${origin.domainName}`);
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
      originType: 'Lambda@Edge'
    };
  }

  /**
   * Clear validation cache
   */
  clearCache() {
    this.validationCache.clear();
  }

  /**
   * Get validation cache stats
   */
  getCacheStats() {
    return {
      entries: this.validationCache.size,
      cacheExpiry: this.cacheExpiry
    };
  }

  /**
   * Private Methods
   */

  async _performValidation(origin) {
    const validations = [];

    // Basic structure validation
    if (!origin.id || !origin.domainName) {
      return {
        isValid: false,
        error: 'Origin must have id and domainName'
      };
    }

    // Type-specific validation
    if (origin.s3OriginConfig) {
      validations.push(this.validateS3Origin(origin));
    } else if (origin.customOriginConfig) {
      validations.push(this.validateHttpOrigin(origin));
    } else if (this._isLambdaEdgeOrigin(origin)) {
      validations.push(this.validateLambdaEdgeOrigin(origin));
    }

    // Check if any validation failed
    const failedValidation = validations.find(v => !v.isValid);
    if (failedValidation) {
      return {
        isValid: false,
        ...failedValidation
      };
    }

    return {
      isValid: true,
      validations: validations,
      originId: origin.id,
      timestamp: new Date().toISOString()
    };
  }

  _isLambdaEdgeOrigin(origin) {
    return origin.domainName?.startsWith('arn:aws:lambda:');
  }
}

module.exports = OriginValidator;
