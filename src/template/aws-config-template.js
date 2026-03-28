/**
 * AWS SDK v3 Configuration for Local Development
 * Gerado pelo AWS Local Simulator
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { SQSClient } = require('@aws-sdk/client-sqs');
const { SNSClient } = require('@aws-sdk/client-sns');
const { EventBridgeClient } = require('@aws-sdk/client-eventbridge');

// Configurações de ambiente
const isLocal = process.env.IS_LOCAL === 'true' || process.env.NODE_ENV === 'development';

// Endpoints locais (configuráveis via variáveis de ambiente)
const endpoints = {
  dynamodb: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
  s3: process.env.S3_ENDPOINT || 'http://localhost:4566',
  sqs: process.env.SQS_ENDPOINT || 'http://localhost:9324',
  sns: process.env.SNS_ENDPOINT || 'http://localhost:9911',
  eventbridge: process.env.EVENTBRIDGE_ENDPOINT || 'http://localhost:4010'
};

// Credenciais locais
const localCredentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local'
};

const baseConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: isLocal ? localCredentials : undefined
};

// DynamoDB Client
const dynamoDBClient = new DynamoDBClient({
  ...baseConfig,
  endpoint: isLocal ? endpoints.dynamodb : undefined
});

const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

// S3 Client
const s3 = new S3Client({
  ...baseConfig,
  endpoint: isLocal ? endpoints.s3 : undefined,
  forcePathStyle: isLocal
});

// SQS Client
const sqs = new SQSClient({
  ...baseConfig,
  endpoint: isLocal ? endpoints.sqs : undefined
});

// SNS Client
const sns = new SNSClient({
  ...baseConfig,
  endpoint: isLocal ? endpoints.sns : undefined
});

// EventBridge Client
const eventbridge = new EventBridgeClient({
  ...baseConfig,
  endpoint: isLocal ? endpoints.eventbridge : undefined
});

module.exports = {
  // Clients
  dynamoDB,
  dynamoDBClient,
  s3,
  sqs,
  sns,
  eventbridge,
  
  // Utilitários
  isLocal,
  endpoints,
  
  // Configuração
  config: {
    region: baseConfig.region,
    isLocal,
    endpoints
  }
};