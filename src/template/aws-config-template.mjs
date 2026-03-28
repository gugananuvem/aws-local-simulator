/**
 * AWS SDK v3 Configuration for Local Development (ES Module)
 * Gerado pelo AWS Local Simulator
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

// Configurações de ambiente
const isLocal = process.env.IS_LOCAL === 'true' || process.env.NODE_ENV === 'development';

// Endpoints locais
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

export {
  dynamoDB,
  dynamoDBClient,
  s3,
  sqs,
  sns,
  eventbridge,
  isLocal,
  endpoints,
  baseConfig as config
};

export default {
  dynamoDB,
  dynamoDBClient,
  s3,
  sqs,
  sns,
  eventbridge,
  isLocal,
  endpoints,
  config: baseConfig
};