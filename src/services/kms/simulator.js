'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { CloudTrailAudit } = require('../../utils/cloudtrail-audit');

/**
 * KMS Simulator - Criptografia real com crypto nativo
 */
class KMSSimulator {
  constructor(store, logger, config) {
    this.store = store;
    this.logger = logger;
    this.config = config;
    this.keys = new Map();
    this.aliases = new Map();
    this.keyMaterial = new Map();
    this.audit = new CloudTrailAudit('kms.amazonaws.com');
  }

  async initialize() {
    try {
      const keys = await this.store.read('kms/keys');
      if (Array.isArray(keys)) {
        for (const k of keys) {
          this.keys.set(k.KeyId, k);
          // Re-gerar material da chave a partir do seed
          if (k._keySeed) {
            this.keyMaterial.set(k.KeyId, Buffer.from(k._keySeed, 'hex'));
          }
        }
      }
      const aliases = await this.store.read('kms/aliases');
      if (Array.isArray(aliases)) {
        for (const a of aliases) this.aliases.set(a.AliasName, a);
      }
      this.logger.info('KMS: dados carregados', 'kms');
    } catch { this.logger.debug('KMS: sem dados anteriores', 'kms'); }
  }

  async _persistKeys() {
    await this.store.write('kms/keys', null, Array.from(this.keys.values()));
  }

  async _persistAliases() {
    await this.store.write('kms/aliases', null, Array.from(this.aliases.values()));
  }

  _requireKey(keyId) {
    // Resolver alias
    if (keyId.startsWith('alias/')) {
      const alias = this.aliases.get(keyId);
      if (!alias) { const err = new Error(`Alias not found: ${keyId}`); err.code = 'NotFoundException'; throw err; }
      keyId = alias.TargetKeyId;
    }
    // Resolver por ARN
    if (keyId.startsWith('arn:')) {
      keyId = keyId.split('/').pop();
    }
    const key = this.keys.get(keyId);
    if (!key) { const err = new Error(`Key not found: ${keyId}`); err.code = 'NotFoundException'; throw err; }
    if (key.KeyState === 'Disabled') { const err = new Error('Key is disabled'); err.code = 'DisabledException'; throw err; }
    if (key.KeyState === 'PendingDeletion') { const err = new Error('Key is pending deletion'); err.code = 'KMSInvalidStateException'; throw err; }
    return key;
  }

  async createKey(params) {
    const { Description, KeyUsage = 'ENCRYPT_DECRYPT', KeySpec = 'SYMMETRIC_DEFAULT', Tags = [], MultiRegion = false } = params || {};
    const keyId = uuidv4();
    const keyArn = `arn:aws:kms:local:000000000000:key/${keyId}`;
    let keyMaterial;
    let publicKey = null;
    let privateKey = null;

    if (KeySpec === 'SYMMETRIC_DEFAULT') {
      keyMaterial = crypto.randomBytes(32);
    } else if (KeySpec.startsWith('RSA_')) {
      const bits = KeySpec === 'RSA_2048' ? 2048 : KeySpec === 'RSA_3072' ? 3072 : 4096;
      const pair = crypto.generateKeyPairSync('rsa', {
        modulusLength: bits,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      publicKey = pair.publicKey;
      privateKey = pair.privateKey;
      keyMaterial = Buffer.from(privateKey);
    } else if (KeySpec.startsWith('ECC_')) {
      const curve = KeySpec.includes('P256') ? 'prime256v1' : KeySpec.includes('P384') ? 'secp384r1' : 'secp521r1';
      const pair = crypto.generateKeyPairSync('ec', {
        namedCurve: curve,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      publicKey = pair.publicKey;
      privateKey = pair.privateKey;
      keyMaterial = Buffer.from(privateKey);
    } else {
      keyMaterial = crypto.randomBytes(32);
    }

    this.keyMaterial.set(keyId, keyMaterial);
    const key = {
      KeyId: keyId,
      KeyArn: keyArn,
      Description: Description || '',
      KeyUsage,
      KeySpec,
      KeyState: 'Enabled',
      Enabled: true,
      CreationDate: new Date().toISOString(),
      MultiRegion,
      Tags,
      PublicKey: publicKey,
      _keySeed: keyMaterial.toString('hex')
    };
    this.keys.set(keyId, key);
    await this._persistKeys();
    this.logger.info(`KMS: chave criada: ${keyId}`, 'kms');
    this.audit.record({ eventName: 'CreateKey', readOnly: false, resources: [{ ARN: keyArn, type: 'AWS::KMS::Key' }], requestParameters: { description: Description, keyUsage: KeyUsage, keySpec: KeySpec } });
    return { KeyMetadata: this._sanitizeKey(key) };
  }

  async describeKey(params) {
    const key = this._requireKey(params.KeyId);
    return { KeyMetadata: this._sanitizeKey(key) };
  }

  async listKeys(params) {
    const { Limit = 100 } = params || {};
    const keys = Array.from(this.keys.values()).slice(0, Limit);
    return { Keys: keys.map(k => ({ KeyId: k.KeyId, KeyArn: k.KeyArn })) };
  }

  async enableKey(params) {
    const key = this._requireKey(params.KeyId);
    key.KeyState = 'Enabled'; key.Enabled = true;
    await this._persistKeys();
    return {};
  }

  async disableKey(params) {
    const key = this._requireKey(params.KeyId);
    key.KeyState = 'Disabled'; key.Enabled = false;
    await this._persistKeys();
    return {};
  }

  async scheduleKeyDeletion(params) {
    const { KeyId, PendingWindowInDays = 30 } = params;
    const key = this._requireKey(KeyId);
    key.KeyState = 'PendingDeletion';
    key.DeletionDate = new Date(Date.now() + PendingWindowInDays * 86400000).toISOString();
    await this._persistKeys();
    return { KeyId: key.KeyId, DeletionDate: key.DeletionDate };
  }

  async cancelKeyDeletion(params) {
    const keyId = params.KeyId.startsWith('arn:') ? params.KeyId.split('/').pop() : params.KeyId;
    const key = this.keys.get(keyId);
    if (!key) { const err = new Error('Key not found'); err.code = 'NotFoundException'; throw err; }
    key.KeyState = 'Disabled'; key.DeletionDate = null;
    await this._persistKeys();
    return { KeyId: key.KeyId };
  }

  async createAlias(params) {
    const { AliasName, TargetKeyId } = params;
    const key = this._requireKey(TargetKeyId);
    if (!AliasName.startsWith('alias/')) {
      const err = new Error('Alias must start with alias/'); err.code = 'InvalidAliasNameException'; throw err;
    }
    const alias = { AliasName, TargetKeyId: key.KeyId, AliasArn: `arn:aws:kms:local:000000000000:${AliasName}`, CreationDate: new Date().toISOString() };
    this.aliases.set(AliasName, alias);
    await this._persistAliases();
    return {};
  }

  async deleteAlias(params) {
    this.aliases.delete(params.AliasName);
    await this._persistAliases();
    return {};
  }

  async listAliases(params) {
    const { KeyId } = params || {};
    let aliases = Array.from(this.aliases.values());
    if (KeyId) aliases = aliases.filter(a => a.TargetKeyId === KeyId);
    return { Aliases: aliases };
  }

  // ===================== CRYPTO OPERATIONS =====================

  async encrypt(params) {
    const { KeyId, Plaintext, EncryptionContext } = params;
    const key = this._requireKey(KeyId);
    if (key.KeyUsage !== 'ENCRYPT_DECRYPT') {
      const err = new Error('Key not for encryption'); err.code = 'InvalidKeyUsageException'; throw err;
    }
    const material = this.keyMaterial.get(key.KeyId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', material.slice(0, 32), iv);
    const plainBuf = Buffer.isBuffer(Plaintext) ? Plaintext : Buffer.from(Plaintext, 'base64');
    const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: iv(12) + tag(16) + ciphertext
    const ciphertext = Buffer.concat([iv, tag, encrypted]);
    this.audit.record({ eventName: 'Encrypt', readOnly: false, isDataEvent: true, resources: [{ ARN: key.KeyArn, type: 'AWS::KMS::Key' }], requestParameters: { keyId: key.KeyId } });
    return {
      KeyId: key.KeyId,
      CiphertextBlob: ciphertext.toString('base64'),
      EncryptionAlgorithm: 'SYMMETRIC_DEFAULT'
    };
  }

  async decrypt(params) {
    const { KeyId, CiphertextBlob, EncryptionContext } = params;
    let key;
    if (KeyId) {
      key = this._requireKey(KeyId);
    } else {
      // Tentar todas as chaves simétricas
      key = Array.from(this.keys.values()).find(k => k.KeySpec === 'SYMMETRIC_DEFAULT' && k.KeyState === 'Enabled');
      if (!key) { const err = new Error('No key available'); err.code = 'NotFoundException'; throw err; }
    }
    const material = this.keyMaterial.get(key.KeyId);
    const buf = Buffer.isBuffer(CiphertextBlob) ? CiphertextBlob : Buffer.from(CiphertextBlob, 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const ciphertext = buf.slice(28);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', material.slice(0, 32), iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return { KeyId: key.KeyId, Plaintext: decrypted.toString('base64'), EncryptionAlgorithm: 'SYMMETRIC_DEFAULT' };
    } catch (e) {
      const err = new Error('Decryption failed - invalid ciphertext or wrong key'); err.code = 'InvalidCiphertextException'; throw err;
    }
  }

  async generateDataKey(params) {
    const { KeyId, KeySpec = 'AES_256', NumberOfBytes } = params;
    const key = this._requireKey(KeyId);
    const dataKeyBytes = NumberOfBytes || (KeySpec === 'AES_128' ? 16 : 32);
    const plaintext = crypto.randomBytes(dataKeyBytes);
    const encrypted = await this.encrypt({ KeyId: key.KeyId, Plaintext: plaintext });
    return {
      KeyId: key.KeyId,
      Plaintext: plaintext.toString('base64'),
      CiphertextBlob: encrypted.CiphertextBlob
    };
  }

  async generateDataKeyWithoutPlaintext(params) {
    const result = await this.generateDataKey(params);
    const { Plaintext, ...rest } = result;
    return rest;
  }

  async generateDataKeyPair(params) {
    const { KeyId, KeyPairSpec } = params;
    const key = this._requireKey(KeyId);
    const bits = KeyPairSpec === 'RSA_2048' ? 2048 : 4096;
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: bits,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const encrypted = await this.encrypt({ KeyId: key.KeyId, Plaintext: Buffer.from(pair.privateKey) });
    return {
      KeyId: key.KeyId,
      KeyPairSpec,
      PublicKey: Buffer.from(pair.publicKey).toString('base64'),
      PrivateKeyPlaintext: Buffer.from(pair.privateKey).toString('base64'),
      PrivateKeyCiphertextBlob: encrypted.CiphertextBlob
    };
  }

  async sign(params) {
    const { KeyId, Message, MessageType = 'RAW', SigningAlgorithm } = params;
    const key = this._requireKey(KeyId);
    if (key.KeyUsage !== 'SIGN_VERIFY') {
      const err = new Error('Key not for signing'); err.code = 'InvalidKeyUsageException'; throw err;
    }
    const material = this.keyMaterial.get(key.KeyId);
    const msgBuf = Buffer.isBuffer(Message) ? Message : Buffer.from(Message, 'base64');
    const sign = crypto.createSign('SHA256');
    sign.update(msgBuf);
    const signature = sign.sign(material.toString(), 'base64');
    return { KeyId: key.KeyId, Signature: signature, SigningAlgorithm };
  }

  async verify(params) {
    const { KeyId, Message, Signature, SigningAlgorithm } = params;
    const key = this._requireKey(KeyId);
    const material = this.keyMaterial.get(key.KeyId);
    const msgBuf = Buffer.isBuffer(Message) ? Message : Buffer.from(Message, 'base64');
    const verify = crypto.createVerify('SHA256');
    verify.update(msgBuf);
    try {
      const valid = verify.verify(material.toString(), Signature, 'base64');
      return { KeyId: key.KeyId, SignatureValid: valid, SigningAlgorithm };
    } catch { return { KeyId: key.KeyId, SignatureValid: false, SigningAlgorithm }; }
  }

  async generateRandom(params) {
    const { NumberOfBytes = 32 } = params;
    const bytes = crypto.randomBytes(NumberOfBytes);
    return { Plaintext: bytes.toString('base64') };
  }

  _sanitizeKey(key) {
    const { _keySeed, PublicKey: pk, ...clean } = key;
    return clean;
  }

  async reset() {
    this.keys.clear();
    this.aliases.clear();
    this.keyMaterial.clear();
    await this.store.clear('kms');
  }
}

module.exports = { KMSSimulator };
