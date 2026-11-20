/**
 * Carrega configurações de variáveis de ambiente
 */

const logger = require('../utils/logger');

const DEFAULT_GATEWAY_PORT = 4700;

/**
 * Interpreta AWS_ENDPOINT_URL (ex.: http://localhost:4700). Sem porta explicita, a porta
 * do gateway padrao (4700). URL invalida ou protocolo que nao seja http/https: erro.
 */
function parseEndpointUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`AWS_ENDPOINT_URL invalida: "${value}" (esperado http://host:porta)`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`AWS_ENDPOINT_URL deve usar http ou https: "${value}"`);
  }
  const explicit = /^https?:\/\/[^/]*:(\d+)/i.exec(String(value));
  const port = explicit ? parseInt(explicit[1], 10) : DEFAULT_GATEWAY_PORT;
  if (!(port >= 1 && port <= 65535)) {
    throw new Error(`AWS_ENDPOINT_URL com porta invalida: "${value}"`);
  }
  return {
    url: `${url.protocol}//${url.host}`,
    hostname: url.hostname,
    port,
  };
}

class EnvLoader {
  static load() {
    const config = {};
    
    // Carrega configuração de serviços
    config.services = {
      dynamodb: this.getEnvBool('AWS_LOCAL_SIMULATOR_DYNAMODB', true),
      s3: this.getEnvBool('AWS_LOCAL_SIMULATOR_S3', true),
      sqs: this.getEnvBool('AWS_LOCAL_SIMULATOR_SQS', true),
      sns: this.getEnvBool('AWS_LOCAL_SIMULATOR_SNS', false),
      lambda: this.getEnvBool('AWS_LOCAL_SIMULATOR_LAMBDA', true),
      apigateway: this.getEnvBool('AWS_LOCAL_SIMULATOR_APIGATEWAY', false),
      eventbridge: this.getEnvBool('AWS_LOCAL_SIMULATOR_EVENTBRIDGE', false),
      'rds-sqlserver': this.getEnvBool(
        'AWS_LOCAL_SIMULATOR_RDS_SQLSERVER',
        this.getEnvBool('AWS_LOCAL_SIMULATOR_RDS_SQLSERVER_ENABLED', false)
      )
    };
    
    // Carrega portas
    config.ports = {
      dynamodb: this.getEnvInt('AWS_LOCAL_SIMULATOR_DYNAMODB_PORT', 8000),
      s3: this.getEnvInt('AWS_LOCAL_SIMULATOR_S3_PORT', 4566),
      sqs: this.getEnvInt('AWS_LOCAL_SIMULATOR_SQS_PORT', 9324),
      lambda: this.getEnvInt('AWS_LOCAL_SIMULATOR_LAMBDA_PORT', 3001),
      sns: this.getEnvInt('AWS_LOCAL_SIMULATOR_SNS_PORT', 9911),
      apigateway: this.getEnvInt('AWS_LOCAL_SIMULATOR_APIGATEWAY_PORT', 4567),
      eventbridge: this.getEnvInt('AWS_LOCAL_SIMULATOR_EVENTBRIDGE_PORT', 4010),
      'rds-sqlserver': this.getEnvInt('AWS_LOCAL_SIMULATOR_RDS_SQLSERVER_PORT', 4511),
      'rds-sqlserver-tds': this.getEnvInt('AWS_LOCAL_SIMULATOR_RDS_SQLSERVER_TDS_PORT', 1433)
    };
    
    // Carrega diretório de dados
    config.dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA || './.aws-local-simulator-data';
    
    // Carrega nível de log
    config.logLevel = process.env.AWS_LOCAL_SIMULATOR_LOG || 'info';
    
    // Carrega CORS
    config.cors = this.getEnvBool('AWS_LOCAL_SIMULATOR_CORS', true);
    
    // Carrega auto-create
    config.autoCreateTables = this.getEnvBool('AWS_LOCAL_SIMULATOR_AUTO_CREATE_TABLES', true);
    config.autoCreateBuckets = this.getEnvBool('AWS_LOCAL_SIMULATOR_AUTO_CREATE_BUCKETS', true);

    // Ponto de entrada unico (gateway). So entram os valores definidos no ambiente.
    config.gateway = this.loadGateway();
    
    logger.debug('Variáveis de ambiente carregadas:', config);
    
    return config;
  }
  
  static loadGateway() {
    const gateway = {};
    if (process.env.AWS_LOCAL_SIMULATOR_GATEWAY_PORT !== undefined) {
      gateway.port = this.getEnvInt('AWS_LOCAL_SIMULATOR_GATEWAY_PORT', DEFAULT_GATEWAY_PORT);
    }
    if (process.env.AWS_LOCAL_SIMULATOR_LEGACY_PORTS !== undefined) {
      gateway.legacyPorts = this.getEnvBool('AWS_LOCAL_SIMULATOR_LEGACY_PORTS', false);
    }
    // AWS_ENDPOINT_URL vence AWS_LOCAL_SIMULATOR_GATEWAY_PORT: a porta vem da URL.
    if (process.env.AWS_ENDPOINT_URL) {
      const parsed = parseEndpointUrl(process.env.AWS_ENDPOINT_URL);
      gateway.endpointUrl = parsed.url;
      gateway.port = parsed.port;
    }
    return gateway;
  }

  static getEnvBool(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value === 'true' || value === '1' || value === 'yes';
  }
  
  static getEnvInt(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  
  static getEnvString(key, defaultValue) {
    return process.env[key] || defaultValue;
  }
}

EnvLoader.parseEndpointUrl = parseEndpointUrl;
EnvLoader.DEFAULT_GATEWAY_PORT = DEFAULT_GATEWAY_PORT;
module.exports = EnvLoader;