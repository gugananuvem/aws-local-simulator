/**
 * ACM Certificate Model
 * Supports self-signed, email-validated, and DNS-validated certificates
 */

class Certificate {
  constructor(domainName, config = {}) {
    this.CertificateArn = this.generateArn();
    this.DomainName = domainName;
    this.SubjectAlternativeNames = config.SubjectAlternativeNames || [domainName];
    this.Serial = this.generateSerial();
    this.Subject = `CN=${domainName}`;
    this.Issuer = config.Issuer || 'AWS Certificate Manager';
    this.CreatedDate = new Date().toISOString();
    this.IssuedDate = null;
    this.Status = 'PENDING_VALIDATION';
    this.Type = config.Type || 'AMAZON_ISSUED';
    this.ValidationMethod = config.ValidationMethod || 'DNS';
    this.NotBefore = null;
    this.NotAfter = null;
    this.Signature = this.generateSignature();
    this.SignatureAlgorithm = 'sha256WithRSAEncryption';
    this.KeyAlgorithm = 'RSA_2048';
    this.Tags = config.Tags || [];
    this.ValidationEmails = [];
    this.DomainValidationOptions = [];
    this.InUseBy = [];
    this.KeyUsages = ['Digital Signature', 'Key Encipherment'];
    this.ExtendedKeyUsages = ['TLS Web Server Authentication'];
    this.RenewalEligibility = 'INELIGIBLE';
    this.Options = {
      CertificateTransparencyLoggingPreference: 'ENABLED',
    };

    // Initialize validation options
    this.initializeValidationOptions(domainName, this.SubjectAlternativeNames);
  }

  generateArn() {
    const accountId = '123456789012';
    const region = 'us-east-1';
    const random = Math.random().toString(36).substring(2, 15);
    return `arn:aws:acm:${region}:${accountId}:certificate/${random}`;
  }

  generateSerial() {
    let serial = '';
    for (let i = 0; i < 32; i++) {
      serial += Math.floor(Math.random() * 16).toString(16);
    }
    return serial.toUpperCase();
  }

  generateSignature() {
    let signature = '';
    for (let i = 0; i < 256; i++) {
      signature += Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, '0');
    }
    return signature.toUpperCase();
  }

  initializeValidationOptions(primaryDomain, altNames) {
    const domains = [primaryDomain, ...altNames];
    const uniqueDomains = [...new Set(domains)];

    for (const domain of uniqueDomains) {
      this.DomainValidationOptions.push({
        DomainName: domain,
        ValidationDomain: domain,
        ValidationStatus: 'PENDING_VALIDATION',
        ResourceRecord: {
          Name: `_${this.generateValidationId()}.${domain}.`,
          Type: 'CNAME',
          Value: `_${this.generateValidationId()}.acm-validations.aws.`,
        },
        ValidationEmails: [`admin@${domain}`, `webmaster@${domain}`],
      });
    }
  }

  generateValidationId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  /**
   * Validate certificate domain
   */
  validateDomain(domain) {
    const option = this.DomainValidationOptions.find(o => o.DomainName === domain);
    if (!option) {
      throw new Error(`Domain not found: ${domain}`);
    }

    option.ValidationStatus = 'SUCCESS';
    option.ValidationDate = new Date().toISOString();

    // Check if all domains are validated
    const allValidated = this.DomainValidationOptions.every(o => o.ValidationStatus === 'SUCCESS');
    if (allValidated) {
      this.Status = 'ISSUED';
      this.IssuedDate = new Date().toISOString();

      // Set expiration date (1 year from now)
      const expirationDate = new Date();
      expirationDate.setFullYear(expirationDate.getFullYear() + 1);

      this.NotBefore = new Date().toISOString();
      this.NotAfter = expirationDate.toISOString();
    }
  }

  /**
   * Check if certificate is valid
   */
  isValid() {
    if (this.Status !== 'ISSUED') return false;
    if (!this.NotAfter) return false;

    const expirationDate = new Date(this.NotAfter);
    return expirationDate > new Date();
  }

  /**
   * Check if certificate is expiring soon (30 days)
   */
  isExpiringsoon() {
    if (!this.NotAfter) return false;

    const expirationDate = new Date(this.NotAfter);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    return expirationDate <= thirtyDaysFromNow && expirationDate > new Date();
  }

  /**
   * Renew certificate
   */
  renew() {
    if (!this.isValid()) {
      throw new Error('Cannot renew invalid certificate');
    }

    // Create renewal certificate
    const newCert = new Certificate(this.DomainName, {
      SubjectAlternativeNames: this.SubjectAlternativeNames,
      Type: this.Type,
      ValidationMethod: this.ValidationMethod,
      Tags: this.Tags,
    });

    return newCert;
  }

  toJSON() {
    return {
      CertificateArn: this.CertificateArn,
      DomainName: this.DomainName,
      SubjectAlternativeNames: this.SubjectAlternativeNames,
      Serial: this.Serial,
      Subject: this.Subject,
      Issuer: this.Issuer,
      CreatedDate: this.CreatedDate,
      IssuedDate: this.IssuedDate,
      Status: this.Status,
      Type: this.Type,
      ValidationMethod: this.ValidationMethod,
      NotBefore: this.NotBefore,
      NotAfter: this.NotAfter,
      SignatureAlgorithm: this.SignatureAlgorithm,
      KeyAlgorithm: this.KeyAlgorithm,
      KeyUsages: this.KeyUsages,
      ExtendedKeyUsages: this.ExtendedKeyUsages,
      DomainValidationOptions: this.DomainValidationOptions,
      RenewalEligibility: this.RenewalEligibility,
      InUseBy: this.InUseBy,
      Tags: this.Tags,
      Options: this.Options,
    };
  }

  toJSONSummary() {
    return {
      CertificateArn: this.CertificateArn,
      DomainName: this.DomainName,
      Status: this.Status,
      CreatedDate: this.CreatedDate,
      IssuedDate: this.IssuedDate,
      NotAfter: this.NotAfter,
      Type: this.Type,
    };
  }
}

module.exports = Certificate;
