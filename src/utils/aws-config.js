// src/utils/aws-config.js

/**
 * Cria configuração para AWS SDK baseada no ambiente
 */
function createAWSConfig(options = {}) {
  const isLocal = process.env.NODE_ENV === 'development' || process.env.IS_LOCAL === 'true';
  
  const config = {
    region: options.region || process.env.AWS_REGION || 'us-east-1',
    credentials: options.credentials || {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local'
    }
  };
  
  if (isLocal || options.forceLocal) {
    config.endpoints = {
      dynamoDB: options.dynamoDBEndpoint || process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
      s3: options.s3Endpoint || process.env.S3_ENDPOINT || 'http://localhost:4566',
      sqs: options.sqsEndpoint || process.env.SQS_ENDPOINT || 'http://localhost:9324',
      lambda: options.lambdaEndpoint || process.env.LAMBDA_ENDPOINT || 'http://localhost:3001'
    };
  }
  
  return config;
}

/**
 * Cria cliente DynamoDB configurado
 */
function createDynamoDBClient(options = {}) {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const config = createAWSConfig(options);
  
  const clientConfig = {
    region: config.region,
    credentials: config.credentials
  };
  
  if (config.endpoints?.dynamoDB) {
    clientConfig.endpoint = config.endpoints.dynamoDB;
  }
  
  return new DynamoDBClient(clientConfig);
}

/**
 * Cria cliente S3 configurado
 */
function createS3Client(options = {}) {
  const { S3Client } = require('@aws-sdk/client-s3');
  const config = createAWSConfig(options);
  
  const clientConfig = {
    region: config.region,
    credentials: config.credentials
  };
  
  if (config.endpoints?.s3) {
    clientConfig.endpoint = config.endpoints.s3;
    clientConfig.forcePathStyle = true; // Necessário para S3 local
  }
  
  return new S3Client(clientConfig);
}

/**
 * Cria cliente SQS configurado
 */
function createSQSClient(options = {}) {
  const { SQSClient } = require('@aws-sdk/client-sqs');
  const config = createAWSConfig(options);
  
  const clientConfig = {
    region: config.region,
    credentials: config.credentials
  };
  
  if (config.endpoints?.sqs) {
    clientConfig.endpoint = config.endpoints.sqs;
  }
  
  return new SQSClient(clientConfig);
}

module.exports = {
  createAWSConfig,
  createDynamoDBClient,
  createS3Client,
  createSQSClient
};