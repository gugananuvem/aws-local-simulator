/**
 * Key Pair Model
 *
 * Representa um par de chaves EC2. Ao criar, gera um par RSA real (como na
 * AWS, a chave privada só é retornada uma vez). Também suporta importação de
 * uma chave pública existente.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class KeyPair {
  constructor(name, publicKeyMaterial = null, config = {}) {
    this.KeyName = name;
    this.KeyPairId = `key-${uuidv4().replace(/-/g, '').substring(0, 17)}`;
    this.KeyType = 'rsa';
    this.CreatedAt = new Date().toISOString();
    this.Tags = config.Tags || [];
    this.PrivateKeyMaterial = null;

    if (publicKeyMaterial) {
      // Importação: apenas a chave pública é conhecida.
      const keyObject = crypto.createPublicKey(publicKeyMaterial);
      this.PublicKeyMaterial = keyObject.export({ type: 'spki', format: 'pem' });
      this.KeyFingerprint = this._fingerprint(keyObject);
    } else {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      this.PublicKeyMaterial = publicKey;
      this.PrivateKeyMaterial = privateKey;
      this.KeyFingerprint = this._fingerprint(crypto.createPublicKey(privateKey));
    }
  }

  /**
   * Fingerprint no formato da AWS: MD5 (hex com ':') do DER PKCS#1 da chave.
   */
  _fingerprint(keyObject) {
    const der = keyObject.export({ type: 'pkcs1', format: 'der' });
    return crypto
      .createHash('md5')
      .update(der)
      .digest('hex')
      .match(/.{1,2}/g)
      .join(':');
  }

  toJSON() {
    return {
      KeyName: this.KeyName,
      KeyPairId: this.KeyPairId,
      KeyType: this.KeyType,
      KeyFingerprint: this.KeyFingerprint,
      PublicKeyMaterial: this.PublicKeyMaterial,
      CreatedAt: this.CreatedAt,
      Tags: this.Tags
    };
  }
}

module.exports = KeyPair;
