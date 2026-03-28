/**
 * Carrega configurações de variáveis de ambiente
 */

const logger = require('../utils/logger');

class EnvLoader {
  static load() {
    const config = {};
    
    // Carrega configuração de serviços
    config.services = {
      dynamodb: this.getEnvBool('AWS_LOCAL_SIMULATOR_DYNAMODB', true),
      s3: this.getEnvBool('AWS_LOCAL_SIMULATOR_S3', true),
      sqs: this.getEnvBool('AWS_LOCAL_SIMULATOR_SQS', true),
      lambda: this.getEnvBool('AWS_LOCAL_SIMULATOR_LAMBDA', true),
      sns: this.getEnvBool('AWS_LOCAL_SIMULATOR_SNS', false),
      eventbridge: this.getEnvBool('AWS_LOCAL_SIMULATOR_EVENTBRIDGE', false)
    };
    
    // Carrega portas
    config.ports = {
      dynamodb: this.getEnvInt('AWS_LOCAL_SIMULATOR_DYNAMODB_PORT', 8000),
      s3: this.getEnvInt('AWS_LOCAL_SIMULATOR_S3_PORT', 4566),
      sqs: this.getEnvInt('AWS_LOCAL_SIMULATOR_SQS_PORT', 9324),
      lambda: this.getEnvInt('AWS_LOCAL_SIMULATOR_LAMBDA_PORT', 3001),
      sns: this.getEnvInt('AWS_LOCAL_SIMULATOR_SNS_PORT', 9911),
      eventbridge: this.getEnvInt('AWS_LOCAL_SIMULATOR_EVENTBRIDGE_PORT', 4010)
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
    
    logger.debug('Variáveis de ambiente carregadas:', config);
    
    return config;
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

module.exports = EnvLoader;