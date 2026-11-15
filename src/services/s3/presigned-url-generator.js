/**
 * S3 Presigned URL Generator
 * Gera URLs assinadas para upload, download e operações custom
 * Permite acesso temporário a objetos S3 sem credenciais
 */

const crypto = require('crypto');
const { publicBaseUrl } = require('../../gateway/public-base');

class PresignedUrlGenerator {
  constructor(config = {}) {
    this.signatureVersion = 'AWS4-HMAC-SHA256';
    this.algorithm = 'AWS4-HMAC-SHA256';
    this.service = 's3';
    this.region = config.region || 'us-east-1';
  }

  /**
   * Gerar presigned URL para GET (download)
   * @param {string} bucket - Nome do bucket
   * @param {string} key - Chave/path do objeto
   * @param {object} options - Opções
   * @param {number} [options.expiresIn] - Tempo de expiração em segundos (default: 3600)
   * @param {object} [options.credentials] - AWS credentials {accessKeyId, secretAccessKey}
   * @returns {string} Presigned URL
   */
  generateGetUrl(bucket, key, options = {}) {
    const expiresIn = options.expiresIn || 3600;
    const credentials = options.credentials || this._getDefaultCredentials();

    return this._generatePresignedUrl('GET', bucket, key, expiresIn, credentials, {}, options.baseUrl);
  }

  /**
   * Gerar presigned URL para PUT (upload)
   * @param {string} bucket - Nome do bucket
   * @param {string} key - Chave/path do objeto
   * @param {object} options - Opções
   * @param {number} [options.expiresIn] - Tempo de expiração em segundos (default: 3600)
   * @param {object} [options.credentials] - AWS credentials
   * @param {string} [options.contentType] - Content-Type esperado
   * @param {object} [options.metadata] - Metadados (x-amz-meta-*)
   * @param {string} [options.serverSideEncryption] - Encryption type (AES256, aws:kms)
   * @returns {string} Presigned URL
   */
  generatePutUrl(bucket, key, options = {}) {
    const expiresIn = options.expiresIn || 3600;
    const credentials = options.credentials || this._getDefaultCredentials();
    const conditions = {};

    // Adicionar condições para validação
    if (options.contentType) {
      conditions['content-type'] = options.contentType;
    }

    if (options.serverSideEncryption) {
      conditions['x-amz-server-side-encryption'] = options.serverSideEncryption;
    }

    if (options.metadata) {
      Object.entries(options.metadata).forEach(([key, value]) => {
        conditions[`x-amz-meta-${key}`] = value;
      });
    }

    return this._generatePresignedUrl('PUT', bucket, key, expiresIn, credentials, conditions, options.baseUrl);
  }

  /**
   * Gerar presigned URL para DELETE
   * @param {string} bucket - Nome do bucket
   * @param {string} key - Chave/path do objeto
   * @param {object} options - Opções
   * @param {number} [options.expiresIn] - Tempo de expiração em segundos
   * @param {object} [options.credentials] - AWS credentials
   * @returns {string} Presigned URL
   */
  generateDeleteUrl(bucket, key, options = {}) {
    const expiresIn = options.expiresIn || 3600;
    const credentials = options.credentials || this._getDefaultCredentials();

    return this._generatePresignedUrl('DELETE', bucket, key, expiresIn, credentials, {}, options.baseUrl);
  }

  /**
   * Gerar presigned URL para HEAD (verificar objeto)
   * @param {string} bucket - Nome do bucket
   * @param {string} key - Chave/path do objeto
   * @param {object} options - Opções
   * @param {number} [options.expiresIn] - Tempo de expiração em segundos
   * @param {object} [options.credentials] - AWS credentials
   * @returns {string} Presigned URL
   */
  generateHeadUrl(bucket, key, options = {}) {
    const expiresIn = options.expiresIn || 3600;
    const credentials = options.credentials || this._getDefaultCredentials();

    return this._generatePresignedUrl('HEAD', bucket, key, expiresIn, credentials, {}, options.baseUrl);
  }

  /**
   * Validar presigned URL
   * @param {string} url - URL para validar
   * @param {string} method - HTTP method esperado
   * @param {object} [credentials] - Credentials para validação
   * @returns {object} Resultado da validação
   */
  validatePresignedUrl(url, method = 'GET', credentials = null) {
    try {
      const urlObj = new URL(url);
      const params = Object.fromEntries(urlObj.searchParams);

      const signature = params['X-Amz-Signature'];
      if (!signature) {
        return this._invalid('Signature missing');
      }

      const amzDate = params['X-Amz-Date'];
      const credential = params['X-Amz-Credential'] || '';
      const slash = credential.indexOf('/');
      const accessKeyId = slash > 0 ? credential.slice(0, slash) : '';
      const scope = slash > 0 ? credential.slice(slash + 1) : '';
      if (!amzDate || !accessKeyId || !scope) {
        return this._invalid('Malformed presigned URL');
      }

      // Expiração
      const requestTime = this._parseAmzDate(amzDate);
      const expiresIn = parseInt(params['X-Amz-Expires']) || 3600;
      const expireTime = new Date(requestTime.getTime() + expiresIn * 1000);
      if (new Date() > expireTime) {
        return this._invalid('URL expired');
      }

      // A assinatura só pode ser conferida com o segredo da chave.
      const secret = this._secretFor(accessKeyId, credentials);
      if (!secret) {
        return this._invalid('Unknown access key');
      }
      if (scope !== this._getCredentialScope(amzDate)) {
        return this._invalid('Credential scope mismatch');
      }

      // Recalcula exatamente o que _generatePresignedUrl assinou. O método entra no
      // canonical request, então a URL só é válida para o método com que foi assinada.
      const canonicalQuerystring = urlObj.search.slice(1)
        .split('&')
        .filter(part => part && !part.startsWith('X-Amz-Signature='))
        .sort()
        .join('&');
      const host = urlObj.host;
      const canonicalRequest = [
        method,
        urlObj.pathname,
        canonicalQuerystring,
        `host:${host}\n`,
        '',
        'host'
      ].join('\n');
      const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        scope,
        crypto.createHash('sha256').update(canonicalRequest).digest('hex')
      ].join('\n');
      const expected = this._calculateSignature(stringToSign, secret, amzDate.substring(0, 8));

      const a = Buffer.from(expected);
      const b = Buffer.from(String(signature));
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return this._invalid('Signature does not match');
      }

      return {
        isValid: true,
        valid: true,
        method: 'SIGNATURE_V4',
        expiresAt: expireTime
      };
    } catch (error) {
      return this._invalid(error.message);
    }
  }

  _invalid(error) {
    return { isValid: false, valid: false, error };
  }

  _secretFor(accessKeyId, credentials) {
    if (credentials && credentials.accessKeyId === accessKeyId) {
      return credentials.secretAccessKey;
    }
    const defaults = this._getDefaultCredentials();
    return defaults.accessKeyId === accessKeyId ? defaults.secretAccessKey : null;
  }

  /**
   * Gerar policy para upload direto (POST policy)
   * Usado por navegadores para upload direto sem backend
   * @param {string} bucket - Nome do bucket
   * @param {string} key - Chave/path do objeto
   * @param {object} options - Opções
   * @returns {object} {policy, signature, credentials}
   */
  generatePostPolicy(bucket, key, options = {}) {
    const expiresIn = options.expiresIn || 3600;
    const credentials = options.credentials || this._getDefaultCredentials();
    const contentLengthRange = options.contentLengthRange || [1, 104857600]; // 100MB default

    // Data no formato ISO8601
    const amzDate = new Date().toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';

    // Policy
    const policy = {
      expiration: new Date(Date.now() + expiresIn * 1000).toISOString(),
      conditions: [
        { bucket: bucket },
        { key: key },
        ['content-length-range', contentLengthRange[0], contentLengthRange[1]],
        { 'x-amz-credential': `${credentials.accessKeyId}/${this._getCredentialScope(amzDate)}` },
        { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
        { 'x-amz-date': amzDate }
      ]
    };

    // Adicionar condições customizadas
    if (options.contentType) {
      policy.conditions.push({ 'content-type': options.contentType });
    }

    if (options.metadata) {
      Object.entries(options.metadata).forEach(([k, v]) => {
        policy.conditions.push({ [`x-amz-meta-${k}`]: v });
      });
    }

    // Converter policy para base64
    const policyJson = JSON.stringify(policy);
    const policyB64 = Buffer.from(policyJson).toString('base64');

    // Gerar assinatura
    const signature = this._signPolicy(policyB64, credentials, amzDate);

    return {
      policy: policyB64,
      amzAlgorithm: 'AWS4-HMAC-SHA256',
      amzDate: amzDate,
      amzCredential: `${credentials.accessKeyId}/${this._getCredentialScope(amzDate)}`,
      signature: signature,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        algorithm: 'AWS4-HMAC-SHA256',
        date: amzDate,
        credentialScope: this._getCredentialScope(amzDate)
      },
      url: `${options.baseUrl || publicBaseUrl()}/${bucket}`,
      policyObject: policy
    };
  }

  /**
   * Private Methods
   */

  _generatePresignedUrl(method, bucket, key, expiresIn, credentials, conditions = {}, baseUrl) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
    const dateStamp = amzDate.substring(0, 8);

    // Construir canonical request
    // Path-style sobre a base publica (Host da requisicao ou AWS_ENDPOINT_URL).
    const base = new URL(baseUrl || publicBaseUrl());
    const host = base.host;
    const canonicalUri = `/${bucket}/${key}`;
    
    const canonicalQuerystring = [
      `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
      `X-Amz-Credential=${encodeURIComponent(credentials.accessKeyId)}/${this._getCredentialScope(amzDate)}`,
      `X-Amz-Date=${amzDate}`,
      `X-Amz-Expires=${expiresIn}`,
      `X-Amz-SignedHeaders=host`
    ].sort().join('&');

    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      '',
      signedHeaders
    ].join('\n');

    // Criar string para assinar
    const canonicalRequestHash = crypto
      .createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      this._getCredentialScope(amzDate),
      canonicalRequestHash
    ].join('\n');

    // Gerar assinatura
    const signature = this._calculateSignature(
      stringToSign,
      credentials.secretAccessKey,
      dateStamp
    );

    // Construir presigned URL
    const presignedUrl = `${base.protocol}//${host}${canonicalUri}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;

    return presignedUrl;
  }

  _getCredentialScope(amzDate) {
    const dateStamp = amzDate.substring(0, 8);
    return `${dateStamp}/${this.region}/${this.service}/aws4_request`;
  }

  _calculateSignature(stringToSign, secretAccessKey, dateStamp) {
    const kDate = crypto
      .createHmac('sha256', `AWS4${secretAccessKey}`)
      .update(dateStamp)
      .digest();

    const kRegion = crypto
      .createHmac('sha256', kDate)
      .update(this.region)
      .digest();

    const kService = crypto
      .createHmac('sha256', kRegion)
      .update(this.service)
      .digest();

    const kSigning = crypto
      .createHmac('sha256', kService)
      .update('aws4_request')
      .digest();

    const signature = crypto
      .createHmac('sha256', kSigning)
      .update(stringToSign)
      .digest('hex');

    return signature;
  }

  _signPolicy(policyB64, credentials, amzDate) {
    const dateStamp = amzDate.substring(0, 8);
    const signature = this._calculateSignature(policyB64, credentials.secretAccessKey, dateStamp);
    return signature;
  }

  _parseAmzDate(amzDate) {
    // Format: 20240115T103000Z
    const year = parseInt(amzDate.substring(0, 4));
    const month = parseInt(amzDate.substring(4, 6)) - 1;
    const day = parseInt(amzDate.substring(6, 8));
    const hour = parseInt(amzDate.substring(9, 11));
    const minute = parseInt(amzDate.substring(11, 13));
    const second = parseInt(amzDate.substring(13, 15));

    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  _getDefaultCredentials() {
    // Return default test credentials
    return {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    };
  }
}

module.exports = PresignedUrlGenerator;
