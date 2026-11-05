'use strict';

/**
 * @fileoverview CloudFormation Service
 * Porta padrão: 4582
 */

const http = require('http');
const path = require('path');
const { CloudFormationSimulator } = require('./simulador');
const { createCloudFormationServer } = require('./server');
const LocalStore = require('../../utils/local-store');

class CloudFormationService {
  constructor(config) {
    this.config = config;
    this.logger = require('../../utils/logger');
    this.name = 'cloudformation';
    this.port = config?.ports?.cloudformation || config?.services?.cloudformation?.port || 4582;
    this.store = null;
    this.simulator = null;
    this._server = null;
    this.isRunning = false;
  }

  async initialize() {
    this.logger.debug(`Inicializando CloudFormation Service na porta ${this.port}...`);
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
    this.store = new LocalStore(path.join(dataDir, 'cloudformation'));
    this.simulator = new CloudFormationSimulator(this.config, this.store, this.logger);
    await this.simulator.load();
    this.logger.debug('CloudFormation Service inicializado');
  }

  injectDependencies(server) {
    const ct = server.getService('cloudtrail');
    if (ct?.simulator) this.simulator.audit.setTrail(ct.simulator);

    // Chave usada pelos resource handlers -> nome do serviço registrado
    const SIM_SERVICES = {
      s3: 's3',
      sqs: 'sqs',
      dynamodb: 'dynamodb',
      kms: 'kms',
      secrets: 'secret-manager',
      parameterStore: 'parameter-store',
      athena: 'athena',
      ec2: 'ec2',
      iam: 'iam',
      organizations: 'organizations',
      lambda: 'lambda',
      sns: 'sns',
      apigateway: 'apigateway',
      cognito: 'cognito',
      eventbridge: 'eventbridge',
      kinesis: 'kinesis-data-streams',
      firehose: 'kinesis-firehose',
      kinesisAnalytics: 'kinesis-analytics',
      cloudwatch: 'cloudwatch',
      route53: 'route53',
      alb: 'alb',
      asg: 'asg',
      ecs: 'ecs',
      cloudfront: 'cloudfront',
      acm: 'acm',
      opensearch: 'opensearch',
      aurora: 'aurora',
      dax: 'dax',
      config: 'config',
      cloudtrail: 'cloudtrail',
      xray: 'xray',
    };
    for (const [key, serviceName] of Object.entries(SIM_SERVICES)) {
      const svc = server.getService(serviceName);
      const sim = svc?.simulator || svc?.getSimulator?.() || svc?.[key + 'Simulator'] || (key === 'aurora' ? svc?.rdsApiHandler : undefined);
      if (sim) this.simulator.sims[key] = sim;
      if (serviceName === 'ec2' && svc?.getVpcSimulator?.()) this.simulator.sims.vpc = svc.getVpcSimulator();
    }
  }
  async start() {
    if (this.isRunning) return;
    const app = createCloudFormationServer(this.simulator, this.config, this.logger);
    this._server = http.createServer(app);
    return new Promise((resolve, reject) => {
      this._server.listen(this.port, () => {
        this.isRunning = true;
        this.logger.debug(`CloudFormation rodando na porta ${this.port}`);
        resolve();
      });
      this._server.once('error', reject);
    });
  }

  async stop() {
    if (!this.isRunning || !this._server) return;
    return new Promise((resolve, reject) => {
      this._server.close((err) => {
        if (err) return reject(err);
        this.isRunning = false;
        resolve();
      });
    });
  }

  async reset() {
    await this.simulator.reset();
  }

  getStatus() {
    const stats = this.simulator?.getStats() || {};
    return {
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      ...stats,
    };
  }

  getSimulator() { return this.simulator; }

  async createStack(params) { return this.simulator.createStack(params); }
  describeStacks(params) { return this.simulator.describeStacks(params); }
}

module.exports = CloudFormationService;
