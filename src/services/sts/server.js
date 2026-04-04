const express = require('express');
const crypto = require('crypto');
const STSSimulator = require('./simulator');
const logger = require('../../utils/logger');

class STSServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.simulator = new STSSimulator(config);
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(express.raw({ type: '*/*', limit: '10mb' }));
    this.app.use((req, res, next) => {
      if (req.body && Buffer.isBuffer(req.body)) {
        const str = req.body.toString('utf8');
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/x-www-form-urlencoded')) {
          req.body = Object.fromEntries(new URLSearchParams(str));
        } else {
          try { req.body = JSON.parse(str); } catch (e) { req.body = {}; }
        }
      } else { req.body = req.body || {}; }
      next();
    });
  }

  async initialize() {
    await this.simulator.initialize();
    this.setupRoutes();
    logger.debug('STS Server inicializado');
  }

  setupRoutes() {
    this.app.post('/', (req, res) => {
      // STS uses query protocol: Action in body or query string
      const action = req.query.Action || req.body.Action ||
        (req.headers['x-amz-target'] && req.headers['x-amz-target'].split('.')[1]);

      logger.debug(`STS action: ${action}`);

      try {
        const result = this.handleAction(action, req.body);
        const xml = this.generateXmlResponse(action, result);
        res.set('Content-Type', 'text/xml');
        res.send(xml);
      } catch (err) {
        logger.error('STS Error:', err.message);
        res.status(400).send(this.simulator.generateErrorResponse('InvalidAction', err.message));
      }
    });
  }

  handleAction(action, params) {
    switch (action) {
      case 'AssumeRole': return this.simulator.assumeRole(params);
      case 'GetCallerIdentity': return this.simulator.getCallerIdentity(params);
      case 'GetSessionToken': return this.simulator.getSessionToken(params);
      case 'AssumeRoleWithWebIdentity': return this.simulator.assumeRoleWithWebIdentity(params);
      case 'AssumeRoleWithSAML': return this.simulator.assumeRoleWithSAML(params);
      default: throw new Error(`Unsupported STS action: ${action}`);
    }
  }

  generateXmlResponse(action, result) {
    const requestId = crypto.randomUUID();
    switch (action) {
      case 'AssumeRole':
      case 'AssumeRoleWithWebIdentity':
      case 'AssumeRoleWithSAML':
        return `<?xml version="1.0" encoding="UTF-8"?>
<${action}Response xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <${action}Result>
    <Credentials>
      <AccessKeyId>${result.Credentials.AccessKeyId}</AccessKeyId>
      <SecretAccessKey>${result.Credentials.SecretAccessKey}</SecretAccessKey>
      <SessionToken>${result.Credentials.SessionToken}</SessionToken>
      <Expiration>${result.Credentials.Expiration}</Expiration>
    </Credentials>
    <AssumedRoleUser>
      <AssumedRoleId>${result.AssumedRoleUser.AssumedRoleId}</AssumedRoleId>
      <Arn>${result.AssumedRoleUser.Arn}</Arn>
    </AssumedRoleUser>
  </${action}Result>
  <ResponseMetadata><RequestId>${requestId}</RequestId></ResponseMetadata>
</${action}Response>`;

      case 'GetCallerIdentity':
        return `<?xml version="1.0" encoding="UTF-8"?>
<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <GetCallerIdentityResult>
    <UserId>${result.UserId}</UserId>
    <Account>${result.Account}</Account>
    <Arn>${result.Arn}</Arn>
  </GetCallerIdentityResult>
  <ResponseMetadata><RequestId>${requestId}</RequestId></ResponseMetadata>
</GetCallerIdentityResponse>`;

      case 'GetSessionToken':
        return `<?xml version="1.0" encoding="UTF-8"?>
<GetSessionTokenResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <GetSessionTokenResult>
    <Credentials>
      <AccessKeyId>${result.Credentials.AccessKeyId}</AccessKeyId>
      <SecretAccessKey>${result.Credentials.SecretAccessKey}</SecretAccessKey>
      <SessionToken>${result.Credentials.SessionToken}</SessionToken>
      <Expiration>${result.Credentials.Expiration}</Expiration>
    </Credentials>
  </GetSessionTokenResult>
  <ResponseMetadata><RequestId>${requestId}</RequestId></ResponseMetadata>
</GetSessionTokenResponse>`;

      default: return '';
    }
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🔑 STS rodando em http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }

  getStatus() {
    return { running: !!this.server, port: this.port, endpoint: `http://localhost:${this.port}` };
  }
}

module.exports = STSServer;
