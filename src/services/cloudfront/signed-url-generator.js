const crypto = require('crypto');
const { DateTime } = require('luxon');

/**
 * Signed URL/Cookie Generator for CloudFront
 * Implements AWS CloudFront's signing mechanisms for URLs and cookies
 * Supports both Canned Policies (simple TTL) and Custom Policies (advanced restrictions)
 */
class SignedUrlGenerator {
  constructor() {
    this.algorithmIdentifier = 'AWS4-HMAC-SHA256';
  }

  /**
   * Generate a canned signed URL (simple TTL-based)
   * @param {string} distributionUrl - Base CloudFront distribution URL or CNAME
   * @param {string} resourcePath - Path to the resource (e.g., /videos/movie.mp4)
   * @param {string} privateKey - Private key in PEM format
   * @param {string} keyPairId - CloudFront key pair ID
   * @param {Date|number} expirationTime - When the URL expires (Date or Unix timestamp)
   * @returns {string} Signed URL with Signature, Key-Pair-Id, and Policy query parameters
   */
  generateCannedUrl(
    distributionUrl,
    resourcePath,
    privateKey,
    keyPairId,
    expirationTime
  ) {
    const expiration = this._normalizeExpiration(expirationTime);
    
    // Build the resource URL
    const baseUrl = this._normalizeUrl(distributionUrl);
    const fullUrl = baseUrl + resourcePath;

    // Create the policy string for canned policy
    const policy = {
      Statement: [
        {
          Resource: fullUrl,
          Condition: {
            DateLessThan: {
              'AWS:EpochTime': Math.floor(expiration / 1000)
            }
          }
        }
      ]
    };

    const policyString = JSON.stringify(policy);
    const signature = this._signPolicy(policyString, privateKey);
    const encodedPolicy = Buffer.from(policyString).toString('base64');
    const encodedSignature = this._sanitizeBase64(signature);

    // Build signed URL
    const separator = fullUrl.includes('?') ? '&' : '?';
    return `${fullUrl}${separator}Signature=${encodedSignature}&Key-Pair-Id=${keyPairId}`;
  }

  /**
   * Generate a custom signed URL (advanced policy with multiple restrictions)
   * @param {string} distributionUrl - Base CloudFront distribution URL or CNAME
   * @param {string} resourcePath - Path to the resource (wildcard paths supported)
   * @param {string} privateKey - Private key in PEM format
   * @param {string} keyPairId - CloudFront key pair ID
   * @param {object} options - Policy options
   * @param {Date|number} options.expirationTime - URL expiration time
   * @param {Date|number} [options.notBefore] - Time before which URL is not valid
   * @param {string|string[]} [options.ipRange] - Allowed IP address(es) (CIDR format)
   * @returns {object} Object with signed URL, policy, and signature
   */
  generateCustomUrl(
    distributionUrl,
    resourcePath,
    privateKey,
    keyPairId,
    options = {}
  ) {
    const expiration = this._normalizeExpiration(options.expirationTime);
    const baseUrl = this._normalizeUrl(distributionUrl);
    const fullUrl = baseUrl + resourcePath;

    // Build custom policy
    const condition = {
      DateLessThan: {
        'AWS:EpochTime': Math.floor(expiration / 1000)
      }
    };

    if (options.notBefore) {
      const notBefore = this._normalizeExpiration(options.notBefore);
      condition.DateGreaterThan = {
        'AWS:EpochTime': Math.floor(notBefore / 1000)
      };
    }

    if (options.ipRange) {
      const ipAddresses = Array.isArray(options.ipRange)
        ? options.ipRange
        : [options.ipRange];
      condition.IpAddress = {
        'AWS:SourceIp': ipAddresses
      };
    }

    const policy = {
      Statement: [
        {
          Resource: fullUrl,
          Condition: condition
        }
      ]
    };

    const policyString = JSON.stringify(policy);
    const signature = this._signPolicy(policyString, privateKey);
    const encodedPolicy = this._sanitizeBase64(Buffer.from(policyString).toString('base64'));
    const encodedSignature = this._sanitizeBase64(signature);

    // Build signed URL with custom policy
    const separator = fullUrl.includes('?') ? '&' : '?';
    const signedUrl = `${fullUrl}${separator}Policy=${encodedPolicy}&Signature=${encodedSignature}&Key-Pair-Id=${keyPairId}`;

    return {
      url: signedUrl,
      policy: policyString,
      signature: encodedSignature,
      keyPairId: keyPairId
    };
  }

  /**
   * Generate signed cookies (for multiple files or alternative to URL signing)
   * @param {string} privateKey - Private key in PEM format
   * @param {string} keyPairId - CloudFront key pair ID
   * @param {string} resourcePath - Path pattern (e.g., /private/*, /videos/*)
   * @param {Date|number} expirationTime - When cookies expire
   * @param {object} [options] - Additional options
   * @param {Date|number} [options.notBefore] - Time before which cookies are not valid
   * @param {string|string[]} [options.ipRange] - Allowed IP address(es)
   * @returns {object} Object with CloudFront-Policy, CloudFront-Signature, and CloudFront-Key-Pair-Id cookies
   */
  generateCookies(
    privateKey,
    keyPairId,
    resourcePath,
    expirationTime,
    options = {}
  ) {
    const expiration = this._normalizeExpiration(expirationTime);

    // Build policy for cookies
    const condition = {
      DateLessThan: {
        'AWS:EpochTime': Math.floor(expiration / 1000)
      }
    };

    if (options.notBefore) {
      const notBefore = this._normalizeExpiration(options.notBefore);
      condition.DateGreaterThan = {
        'AWS:EpochTime': Math.floor(notBefore / 1000)
      };
    }

    if (options.ipRange) {
      const ipAddresses = Array.isArray(options.ipRange)
        ? options.ipRange
        : [options.ipRange];
      condition.IpAddress = {
        'AWS:SourceIp': ipAddresses
      };
    }

    const policy = {
      Statement: [
        {
          Resource: resourcePath,
          Condition: condition
        }
      ]
    };

    const policyString = JSON.stringify(policy);
    const signature = this._signPolicy(policyString, privateKey);
    const encodedPolicy = this._sanitizeBase64(Buffer.from(policyString).toString('base64'));
    const encodedSignature = this._sanitizeBase64(signature);

    return {
      'CloudFront-Policy': encodedPolicy,
      'CloudFront-Signature': encodedSignature,
      'CloudFront-Key-Pair-Id': keyPairId,
      policyObject: policy
    };
  }

  /**
   * Verify a signed URL or validate its signature
   * @param {string} signedUrl - The signed URL to verify
   * @param {string} publicKey - Public key in PEM format
   * @returns {object} Verification result with isValid, policy, and error details
   */
  verifySignedUrl(signedUrl, publicKey) {
    try {
      const url = new URL(signedUrl);
      const params = new URLSearchParams(url.search);

      // Extract signature components
      const signature = params.get('Signature');
      const policy = params.get('Policy');
      const keyPairId = params.get('Key-Pair-Id');

      if (!signature || !keyPairId) {
        return {
          isValid: false,
          error: 'Missing required signature parameters'
        };
      }

      if (!policy) {
        return {
          isValid: false,
          error: 'Missing Policy parameter'
        };
      }

      // Decode policy
      const decodedPolicy = Buffer.from(policy, 'base64').toString('utf-8');
      let policyObject;
      try {
        policyObject = JSON.parse(decodedPolicy);
      } catch (e) {
        return {
          isValid: false,
          error: 'Invalid policy JSON'
        };
      }

      // Verify signature
      const isValid = this._verifySignature(decodedPolicy, signature, publicKey);

      if (!isValid) {
        return {
          isValid: false,
          error: 'Invalid signature'
        };
      }

      // Check expiration
      const statement = policyObject.Statement[0];
      if (statement && statement.Condition && statement.Condition.DateLessThan) {
        const expirationTimestamp = statement.Condition.DateLessThan['AWS:EpochTime'];
        const now = Math.floor(Date.now() / 1000);
        
        if (now >= expirationTimestamp) {
          return {
            isValid: false,
            error: 'URL has expired'
          };
        }
      }

      // Check not-before time
      if (statement && statement.Condition && statement.Condition.DateGreaterThan) {
        const notBeforeTimestamp = statement.Condition.DateGreaterThan['AWS:EpochTime'];
        const now = Math.floor(Date.now() / 1000);
        
        if (now < notBeforeTimestamp) {
          return {
            isValid: false,
            error: 'URL is not yet valid'
          };
        }
      }

      return {
        isValid: true,
        policy: policyObject,
        keyPairId: keyPairId,
        resource: statement?.Resource
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Verification failed: ${error.message}`
      };
    }
  }

  /**
   * Validate an IP against CIDR notation
   * @param {string} ip - IP address to check
   * @param {string} cidr - CIDR notation (e.g., 192.0.2.0/24)
   * @returns {boolean} True if IP is in CIDR range
   */
  isIpInCidr(ip, cidr) {
    try {
      const [network, bits] = cidr.split('/');
      const networkBits = parseInt(bits, 10);
      
      const ipParts = ip.split('.').map(Number);
      const networkParts = network.split('.').map(Number);

      for (let i = 0; i < 4; i++) {
        const ipBits = ipParts[i] * Math.pow(2, 8 - (i + 1) * 8);
        const networkBits_ = networkParts[i] * Math.pow(2, 8 - (i + 1) * 8);
        const mask = (0xffffffff << (32 - networkBits)) >>> 0;

        if ((ipBits & mask) !== (networkBits_ & mask)) {
          return false;
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Private Methods
   */

  _normalizeUrl(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }

  _normalizeExpiration(expirationTime) {
    if (typeof expirationTime === 'number') {
      // If it's less than 10^10, assume it's in seconds; otherwise milliseconds
      return expirationTime < 10000000000 ? expirationTime * 1000 : expirationTime;
    }
    if (expirationTime instanceof Date) {
      return expirationTime.getTime();
    }
    throw new Error('Expiration time must be a Date or Unix timestamp');
  }

  _signPolicy(policyString, privateKey) {
    const signature = crypto
      .createSign('RSA-SHA1')
      .update(policyString)
      .sign(privateKey, 'base64');
    return signature;
  }

  _verifySignature(policyString, signature, publicKey) {
    try {
      return crypto
        .createVerify('RSA-SHA1')
        .update(policyString)
        .verify(publicKey, signature, 'base64');
    } catch (e) {
      return false;
    }
  }

  _sanitizeBase64(base64String) {
    // CloudFront uses URL-safe base64: replace +/= with -_~
    return base64String
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '~');
  }

  _unsanitizeBase64(base64String) {
    // Reverse the URL-safe encoding
    return base64String
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/~/g, '=');
  }
}

module.exports = SignedUrlGenerator;
