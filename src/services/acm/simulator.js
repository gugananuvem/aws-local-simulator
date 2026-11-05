/**
 * ACM Simulator
 * AWS Certificate Manager with DNS validation, renewal, and expiration tracking
 */

const path = require('path');
const Certificate = require('./models/certificate');
const LocalStore = require('../../utils/local-store');
const logger = require('../../utils/logger');

class ACMSimulator {
  constructor(config = {}) {
    this.config = config;
    this.certificates = new Map(); // arn -> certificate
    this.certificatesByDomain = new Map(); // domain -> [arns]

    // Inicializar persistência
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'acm');
    this.store = new LocalStore(this.dataDir);

    // Renewal check interval
    this.renewalCheckInterval = null;
  }

  async initialize() {
    // 1. Carregar dados persistidos
    await this.loadFromPersistence();

    // 2. Criar certificados padrão se configurado
    if (this.certificates.size === 0 && this.config.certificates && Array.isArray(this.config.certificates)) {
      logger.info('📚 Carregando Certificados ACM da configuração inicial...');
      for (const certConfig of this.config.certificates) {
        this.requestCertificate(certConfig.DomainName, certConfig);
      }
    }

    // 3. Iniciar verificação de renovação
    this.startRenewalCheckInterval();
  }

  /**
   * Carrega dados persistidos do storage
   */
  async loadFromPersistence() {
    try {
      const certificatesData = this.store.read('certificates');
      if (Array.isArray(certificatesData)) {
        logger.info(`📂 Carregando ${certificatesData.length} Certificados ACM do storage...`);
        for (const certData of certificatesData) {
          const cert = new Certificate(certData.DomainName, {
            SubjectAlternativeNames: certData.SubjectAlternativeNames,
            Type: certData.Type,
            ValidationMethod: certData.ValidationMethod,
            Tags: certData.Tags,
          });

          // Restaurar estado do certificado
          cert.CertificateArn = certData.CertificateArn;
          cert.Serial = certData.Serial;
          cert.Status = certData.Status;
          cert.IssuedDate = certData.IssuedDate;
          cert.CreatedDate = certData.CreatedDate;
          cert.NotBefore = certData.NotBefore;
          cert.NotAfter = certData.NotAfter;
          cert.DomainValidationOptions = certData.DomainValidationOptions;
          cert.InUseBy = certData.InUseBy || [];

          this.certificates.set(cert.CertificateArn, cert);

          // Indexar por domínio
          if (!this.certificatesByDomain.has(cert.DomainName)) {
            this.certificatesByDomain.set(cert.DomainName, []);
          }
          this.certificatesByDomain.get(cert.DomainName).push(cert.CertificateArn);
        }
      }
    } catch (error) {
      logger.error(`Erro ao carregar persistência ACM: ${error.message}`);
    }
  }

  /**
   * Persiste dados para storage
   */
  persistData() {
    try {
      const certificatesData = Array.from(this.certificates.values()).map(cert => cert.toJSON());
      this.store.write('certificates', certificatesData);
    } catch (error) {
      logger.error(`Erro ao persistir ACM: ${error.message}`);
    }
  }

  /**
   * Solicita novo certificado
   */
  requestCertificate(domainName, config = {}) {
    // Validar domínio
    if (!domainName || typeof domainName !== 'string') {
      throw new Error('DomainName is required');
    }

    const certificate = new Certificate(domainName, {
      SubjectAlternativeNames: config.SubjectAlternativeNames || [domainName],
      Type: config.CertificateType || 'AMAZON_ISSUED',
      ValidationMethod: config.ValidationMethod || 'DNS',
      Tags: config.Tags || [],
    });

    this.certificates.set(certificate.CertificateArn, certificate);

    // Indexar por domínio
    if (!this.certificatesByDomain.has(domainName)) {
      this.certificatesByDomain.set(domainName, []);
    }
    this.certificatesByDomain.get(domainName).push(certificate.CertificateArn);

    this.persistData();
    logger.info(`✅ Certificado solicitado: ${domainName} (${certificate.CertificateArn})`);
    return certificate;
  }

  /**
   * Lista certificados
   */
  listCertificates(statusFilter = null) {
    let certs = Array.from(this.certificates.values());

    if (statusFilter) {
      certs = certs.filter(c => c.Status === statusFilter);
    }

    return certs;
  }

  /**
   * Descreve certificado
   */
  describeCertificate(arn) {
    const certificate = this.certificates.get(arn);
    if (!certificate) {
      throw new Error(`Certificate not found: ${arn}`);
    }

    return certificate;
  }

  /**
   * Valida domínio do certificado
   */
  validateDomain(arn, domain) {
    const certificate = this.certificates.get(arn);
    if (!certificate) {
      throw new Error(`Certificate not found: ${arn}`);
    }

    certificate.validateDomain(domain);
    this.persistData();
    logger.info(`✅ Domínio validado: ${domain} no certificado ${arn}`);
    return certificate;
  }

  /**
   * Deleta certificado
   */
  deleteCertificate(arn) {
    const certificate = this.certificates.get(arn);
    if (!certificate) {
      throw new Error(`Certificate not found: ${arn}`);
    }

    if (certificate.InUseBy && certificate.InUseBy.length > 0) {
      throw new Error(`Cannot delete certificate in use by ${certificate.InUseBy.length} resources`);
    }

    // Remove da indexação por domínio
    const domainArns = this.certificatesByDomain.get(certificate.DomainName);
    if (domainArns) {
      const index = domainArns.indexOf(arn);
      if (index > -1) {
        domainArns.splice(index, 1);
      }
    }

    this.certificates.delete(arn);
    this.persistData();
    logger.info(`✅ Certificado deletado: ${arn}`);
    return true;
  }

  /**
   * Renova certificado
   */
  renewCertificate(arn) {
    const oldCertificate = this.certificates.get(arn);
    if (!oldCertificate) {
      throw new Error(`Certificate not found: ${arn}`);
    }

    if (!oldCertificate.isValid()) {
      throw new Error(`Cannot renew invalid certificate`);
    }

    const newCertificate = oldCertificate.renew();
    this.certificates.set(newCertificate.CertificateArn, newCertificate);

    // Indexar por domínio
    if (!this.certificatesByDomain.has(newCertificate.DomainName)) {
      this.certificatesByDomain.set(newCertificate.DomainName, []);
    }
    this.certificatesByDomain.get(newCertificate.DomainName).push(newCertificate.CertificateArn);

    this.persistData();
    logger.info(`✅ Certificado renovado: ${newCertificate.CertificateArn}`);
    return newCertificate;
  }

  /**
   * Adiciona tag ao certificado
   */
  addTagsToCertificate(arn, tags) {
    const certificate = this.certificates.get(arn);
    if (!certificate) {
      throw new Error(`Certificate not found: ${arn}`);
    }

    for (const tag of tags) {
      const existingTag = certificate.Tags.find(t => t.Key === tag.Key);
      if (existingTag) {
        existingTag.Value = tag.Value;
      } else {
        certificate.Tags.push(tag);
      }
    }

    this.persistData();
    return certificate;
  }

  /**
   * Lista certificados com filtro por domínio
   */
  listCertificatesByDomain(domainName) {
    const arns = this.certificatesByDomain.get(domainName) || [];
    return arns.map(arn => this.certificates.get(arn));
  }

  /**
   * Obter estatísticas de certificados
   */
  getCertificateStats() {
    const certs = Array.from(this.certificates.values());
    return {
      total: certs.length,
      issued: certs.filter(c => c.Status === 'ISSUED').length,
      pending: certs.filter(c => c.Status === 'PENDING_VALIDATION').length,
      expiring_soon: certs.filter(c => c.isExpiringsoon()).length,
      expired: certs.filter(c => !c.isValid()).length,
    };
  }

  /**
   * Inicia verificação de renovação periódica
   */
  startRenewalCheckInterval() {
    if (this.renewalCheckInterval) clearInterval(this.renewalCheckInterval);

    this.renewalCheckInterval = setInterval(() => {
      const certificatesToRenew = Array.from(this.certificates.values()).filter(c => c.isExpiringsoon());

      for (const cert of certificatesToRenew) {
        try {
          this.renewCertificate(cert.CertificateArn);
        } catch (error) {
          logger.warn(`Failed to auto-renew certificate: ${error.message}`);
        }
      }
    }, 300000); // 5 minutos
  }

  /**
   * Para verificação de renovação periódica
   */
  stopRenewalCheckInterval() {
    if (this.renewalCheckInterval) {
      clearInterval(this.renewalCheckInterval);
      this.renewalCheckInterval = null;
    }
  }
}

module.exports = ACMSimulator;
