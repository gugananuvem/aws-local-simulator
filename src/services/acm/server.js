/**
 * ACM Server
 * REST API para gerenciamento de certificados SSL/TLS
 */

const express = require('express');
const logger = require('../../utils/logger');

class ACMServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      logger.info(`[ACM] ${req.method} ${req.path}`);
      next();
    });
  }

  async initialize(simulator) {
    this.simulator = simulator;
    this.setupRoutes();
  }

  setupRoutes() {
    // Certificates
    this.app.post('/acm/request-certificate', (req, res) => this.requestCertificate(req, res));
    this.app.get('/acm/list-certificates', (req, res) => this.listCertificates(req, res));
    this.app.get('/acm/describe-certificate/:arn', (req, res) => this.describeCertificate(req, res));
    this.app.post('/acm/validate-domain', (req, res) => this.validateDomain(req, res));
    this.app.delete('/acm/delete-certificate/:arn', (req, res) => this.deleteCertificate(req, res));
    this.app.post('/acm/renew-certificate', (req, res) => this.renewCertificate(req, res));
    this.app.post('/acm/add-tags-to-certificate', (req, res) => this.addTagsToCertificate(req, res));
    this.app.get('/acm/stats', (req, res) => this.getStats(req, res));
    this.app.get('/acm/certificate-by-domain/:domain', (req, res) => this.listByDomain(req, res));
  }

  async requestCertificate(req, res) {
    try {
      const { DomainName, SubjectAlternativeNames, ValidationMethod, Tags, CertificateType } = req.body;

      if (!DomainName) {
        return res.status(400).json({ error: 'DomainName is required' });
      }

      const certificate = this.simulator.requestCertificate(DomainName, {
        SubjectAlternativeNames,
        ValidationMethod,
        Tags,
        CertificateType,
      });

      res.status(201).json({
        CertificateArn: certificate.CertificateArn,
        Status: certificate.Status,
        ValidationMethod: certificate.ValidationMethod,
        DomainValidationOptions: certificate.DomainValidationOptions,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async listCertificates(req, res) {
    try {
      const { Status } = req.query;
      const certificates = this.simulator.listCertificates(Status);

      res.json({
        CertificateSummaryList: certificates.map(c => c.toJSONSummary()),
        NextToken: null,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async describeCertificate(req, res) {
    try {
      const arn = decodeURIComponent(req.params.arn);
      const certificate = this.simulator.describeCertificate(arn);

      res.json({
        Certificate: certificate.toJSON(),
      });
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async validateDomain(req, res) {
    try {
      const { CertificateArn, DomainName } = req.body;

      if (!CertificateArn || !DomainName) {
        return res.status(400).json({ error: 'CertificateArn and DomainName are required' });
      }

      const certificate = this.simulator.validateDomain(CertificateArn, DomainName);

      res.json({
        CertificateArn: certificate.CertificateArn,
        Status: certificate.Status,
        ValidatedDomains: certificate.DomainValidationOptions
          .filter(o => o.ValidationStatus === 'SUCCESS')
          .map(o => o.DomainName),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async deleteCertificate(req, res) {
    try {
      const arn = decodeURIComponent(req.params.arn);
      this.simulator.deleteCertificate(arn);

      res.json({
        CertificateArn: arn,
        Deleted: true,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async renewCertificate(req, res) {
    try {
      const { CertificateArn } = req.body;

      if (!CertificateArn) {
        return res.status(400).json({ error: 'CertificateArn is required' });
      }

      const newCertificate = this.simulator.renewCertificate(CertificateArn);

      res.status(201).json({
        CertificateArn: newCertificate.CertificateArn,
        OldCertificateArn: CertificateArn,
        Status: newCertificate.Status,
        DomainValidationOptions: newCertificate.DomainValidationOptions,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async addTagsToCertificate(req, res) {
    try {
      const { CertificateArn, Tags } = req.body;

      if (!CertificateArn || !Tags) {
        return res.status(400).json({ error: 'CertificateArn and Tags are required' });
      }

      const certificate = this.simulator.addTagsToCertificate(CertificateArn, Tags);

      res.json({
        CertificateArn: certificate.CertificateArn,
        Tags: certificate.Tags,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getStats(req, res) {
    try {
      const stats = this.simulator.getCertificateStats();

      res.json({
        Statistics: {
          TotalCertificates: stats.total,
          IssuedCertificates: stats.issued,
          PendingValidationCertificates: stats.pending,
          ExpiringInThirtyDaysCertificates: stats.expiring_soon,
          ExpiredCertificates: stats.expired,
        },
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async listByDomain(req, res) {
    try {
      const domain = decodeURIComponent(req.params.domain);
      const certificates = this.simulator.listCertificatesByDomain(domain);

      res.json({
        CertificateSummaryList: certificates.map(c => c.toJSONSummary()),
        Domain: domain,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`✅ ACM Server running on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}

module.exports = ACMServer;
