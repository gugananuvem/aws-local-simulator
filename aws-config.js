// lambda/layer/utils/aws-config.js
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { SQSClient } = require('@aws-sdk/client-sqs');
const { LambdaClient } = require('@aws-sdk/client-lambda');
const { CognitoIdentityProviderClient } = require("@aws-sdk/client-cognito-identity-provider");

// Services adicionais
const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { SystemsManagerClient } = require('@aws-sdk/client-ssm');
const { KMSClient } = require('@aws-sdk/client-kms');
const { AuroraDataAPIClient } = require('@aws-sdk/client-aurora-data-api');
const { KinesisClient } = require('@aws-sdk/client-kinesis');
const { SESClient } = require('@aws-sdk/client-ses');
const { EventBridgeClient } = require('@aws-sdk/client-eventbridge');
const { SNSClient } = require('@aws-sdk/client-sns');
const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
const { CloudWatchClient } = require('@aws-sdk/client-cloudwatch');
const { XRayClient } = require('@aws-sdk/client-xray');
const { AthenaClient } = require('@aws-sdk/client-athena');
const { ConfigServiceClient } = require('@aws-sdk/client-config');

// Detecta ambiente local
const isLocal = process.env.IS_LOCAL === 'true' ||
  process.env.NODE_ENV === 'development' ||
  process.env.AWS_SAM_LOCAL === 'true';

const isLocalS3 = process.env.IS_LOCAL_S3 === 'true';
const isLocalSQS = process.env.IS_LOCAL_SQS === 'true';
const isLocalDynamoDB = process.env.IS_LOCAL_DYNAMODB === 'true';
const isLocalLambda = process.env.IS_LOCAL_LAMBDA === 'true';
const isLocalCognito = process.env.IS_LOCAL_COGNITO === 'true';
const isLocalSecretsManager = process.env.IS_LOCAL_SECRETS_MANAGER === 'true';
const isLocalSystemsManager = process.env.IS_LOCAL_SSM === 'true';
const isLocalKMS = process.env.IS_LOCAL_KMS === 'true';
const isLocalAurora = process.env.IS_LOCAL_AURORA === 'true';
const isLocalKinesis = process.env.IS_LOCAL_KINESIS === 'true';
const isLocalSES = process.env.IS_LOCAL_SES === 'true';
const isLocalEventBridge = process.env.IS_LOCAL_EVENTBRIDGE === 'true';
const isLocalSNS = process.env.IS_LOCAL_SNS === 'true';
const isLocalCloudWatchLogs = process.env.IS_LOCAL_CLOUDWATCH_LOGS === 'true';
const isLocalCloudWatch = process.env.IS_LOCAL_CLOUDWATCH === 'true';
const isLocalXRay = process.env.IS_LOCAL_XRAY === 'true';
const isLocalAthena = process.env.IS_LOCAL_ATHENA === 'true';
const isLocalConfig = process.env.IS_LOCAL_CONFIG === 'true';

// Endpoints locais (configuráveis via variáveis de ambiente)
const localEndpoints = {
  dynamodb: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
  s3: process.env.S3_ENDPOINT || 'http://localhost:4566',
  sqs: process.env.SQS_ENDPOINT || 'http://localhost:9324',
  lambda: process.env.LAMBDA_ENDPOINT || 'http://localhost:3001',
  cognito: process.env.LOCAL_COGNITO || 'http://localhost:9229',
  secretsManager: process.env.SECRETS_MANAGER_ENDPOINT || 'http://localhost:4566',
  systemsManager: process.env.SSM_ENDPOINT || 'http://localhost:4566',
  kms: process.env.KMS_ENDPOINT || 'http://localhost:4566',
  aurora: process.env.AURORA_ENDPOINT || 'http://localhost:3306',
  kinesis: process.env.KINESIS_ENDPOINT || 'http://localhost:4566',
  ses: process.env.SES_ENDPOINT || 'http://localhost:4566',
  eventbridge: process.env.EVENTBRIDGE_ENDPOINT || 'http://localhost:4566',
  sns: process.env.SNS_ENDPOINT || 'http://localhost:4566',
  cloudwatchLogs: process.env.CLOUDWATCH_LOGS_ENDPOINT || 'http://localhost:4566',
  cloudwatch: process.env.CLOUDWATCH_ENDPOINT || 'http://localhost:4566',
  xray: process.env.XRAY_ENDPOINT || 'http://localhost:4566',
  athena: process.env.ATHENA_ENDPOINT || 'http://localhost:4566',
  config: process.env.CONFIG_ENDPOINT || 'http://localhost:4566'
};

// Credenciais para ambiente local (não são validadas)
const localCredentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
  sessionToken: process.env.AWS_SESSION_TOKEN || undefined
};

// Configuração base para todos os clients
const baseConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: isLocal ? localCredentials : undefined
};

// ============ DynamoDB Client ============
const dynamoDBClient = new DynamoDBClient({
  ...baseConfig,
  endpoint: isLocalDynamoDB ? localEndpoints.dynamodb : undefined,
  region: process.env.AWS_REGION || "us-east-1"
});

const dynamoDBDocClient = DynamoDBDocumentClient.from(dynamoDBClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false
  },
  unmarshallOptions: {
    wrapNumbers: false
  }
});

const cognitoClient = new CognitoIdentityProviderClient({
    ...baseConfig,
    endpoint: isLocalCognito ? localEndpoints.cognito : undefined,
    region: process.env.AWS_REGION || 'us-east-1'
});

// ============ Secrets Manager Client ============
const secretsManagerClient = new SecretsManagerClient({
  ...baseConfig,
  endpoint: isLocalSecretsManager ? localEndpoints.secretsManager : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ Systems Manager (SSM) Client ============
const systemsManagerClient = new SystemsManagerClient({
  ...baseConfig,
  endpoint: isLocalSystemsManager ? localEndpoints.systemsManager : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ KMS Client ============
const kmsClient = new KMSClient({
  ...baseConfig,
  endpoint: isLocalKMS ? localEndpoints.kms : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ Aurora Data API Client ============
const auroraClient = new AuroraDataAPIClient({
  ...baseConfig,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ Kinesis Client ============
const kinesisClient = new KinesisClient({
  ...baseConfig,
  endpoint: isLocalKinesis ? localEndpoints.kinesis : undefined
});

// ============ SES Client ============
const sesClient = new SESClient({
  ...baseConfig,
  endpoint: isLocalSES ? localEndpoints.ses : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ EventBridge Client ============
const eventBridgeClient = new EventBridgeClient({
  ...baseConfig,
  endpoint: isLocalEventBridge ? localEndpoints.eventbridge : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ SNS Client ============
const snsClient = new SNSClient({
  ...baseConfig,
  endpoint: isLocalSNS ? localEndpoints.sns : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ CloudWatch Logs Client ============
const cloudWatchLogsClient = new CloudWatchLogsClient({
  ...baseConfig,
  endpoint: isLocalCloudWatchLogs ? localEndpoints.cloudwatchLogs : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ CloudWatch Client ============
const cloudWatchClient = new CloudWatchClient({
  ...baseConfig,
  endpoint: isLocalCloudWatch ? localEndpoints.cloudwatch : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ X-Ray Client ============
const xRayClient = new XRayClient({
  ...baseConfig,
  endpoint: isLocalXRay ? localEndpoints.xray : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ Athena Client ============
const athenaClient = new AthenaClient({
  ...baseConfig,
  endpoint: isLocalAthena ? localEndpoints.athena : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ Config Service Client ============
const configClient = new ConfigServiceClient({
  ...baseConfig,
  endpoint: isLocalConfig ? localEndpoints.config : undefined,
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============ S3 Client ============
const s3Client = new S3Client({
  ...baseConfig,
  endpoint: isLocalS3 ? localEndpoints.s3 : undefined,
  forcePathStyle: true, // Necessário para S3 local (LocalStack, MinIO, etc)
  // Para S3 real, não usar forcePathStyle
  ...(isLocalS3 ? {} : { forcePathStyle: false })
});

// ============ SQS Client ============
const sqsClient = new SQSClient({
  ...baseConfig,
  endpoint: isLocalSQS ? localEndpoints.sqs : undefined
});

// ============ Lambda Client ============
const lambdaClient = new LambdaClient({
  ...baseConfig,
  endpoint: isLocalLambda ? localEndpoints.lambda : undefined
});

// Log de configuração (apenas em desenvolvimento)
if (isLocalDynamoDB || isLocalS3 || isLocalSQS || isLocalLambda || isLocalSecretsManager || isLocalSystemsManager || isLocalKMS || isLocalAurora || isLocalKinesis || isLocalSES || isLocalEventBridge || isLocalSNS || isLocalCloudWatchLogs || isLocalCloudWatch || isLocalXRay || isLocalAthena || isLocalConfig) {
  console.log('🔧 Ambiente LOCAL detectado:');
  console.log(`   Region: ${baseConfig.region}`);
}

if (isLocalDynamoDB) {
  console.log(`   DynamoDB: ${localEndpoints.dynamodb}`);
}
if (isLocalS3) {
  console.log(`   S3: ${localEndpoints.s3} (forcePathStyle: true)`);
}
if (isLocalSQS) {
  console.log(`   SQS: ${localEndpoints.sqs}`);
}
if (isLocalLambda) {
  console.log(`   Lambda: ${localEndpoints.lambda}`);
}
if (isLocalCognito){
  console.log(`   Cognito: ${localEndpoints.cognito}`);
}
if (isLocalSecretsManager) {
  console.log(`   Secrets Manager: ${localEndpoints.secretsManager}`);
}
if (isLocalSystemsManager) {
  console.log(`   SSM: ${localEndpoints.systemsManager}`);
}
if (isLocalKMS) {
  console.log(`   KMS: ${localEndpoints.kms}`);
}
if (isLocalAurora) {
  console.log(`   Aurora: ${localEndpoints.aurora}`);
}
if (isLocalKinesis) {
  console.log(`   Kinesis: ${localEndpoints.kinesis}`);
}
if (isLocalSES) {
  console.log(`   SES: ${localEndpoints.ses}`);
}
if (isLocalEventBridge) {
  console.log(`   EventBridge: ${localEndpoints.eventbridge}`);
}
if (isLocalSNS) {
  console.log(`   SNS: ${localEndpoints.sns}`);
}
if (isLocalCloudWatchLogs) {
  console.log(`   CloudWatch Logs: ${localEndpoints.cloudwatchLogs}`);
}
if (isLocalCloudWatch) {
  console.log(`   CloudWatch: ${localEndpoints.cloudwatch}`);
}
if (isLocalXRay) {
  console.log(`   X-Ray: ${localEndpoints.xray}`);
}
if (isLocalAthena) {
  console.log(`   Athena: ${localEndpoints.athena}`);
}
if (isLocalConfig) {
  console.log(`   Config: ${localEndpoints.config}`);
}

module.exports = {
  // Clients
  dynamoDB: dynamoDBDocClient,
  cognitoClient,
  dynamoDBClient,
  s3: s3Client,
  sqs: sqsClient,
  lambda: lambdaClient,
  secretsManager: secretsManagerClient,
  systemsManager: systemsManagerClient,
  kms: kmsClient,
  aurora: auroraClient,
  kinesis: kinesisClient,
  ses: sesClient,
  eventBridge: eventBridgeClient,
  sns: snsClient,
  cloudWatchLogs: cloudWatchLogsClient,
  cloudWatch: cloudWatchClient,
  xRay: xRayClient,
  athena: athenaClient,
  config: configClient,

  // Utilitários
  isLocal,
  localEndpoints,

  // Configuração
  config: {
    region: baseConfig.region,
    isLocal,
    endpoints: localEndpoints
  },

  // Função para criar clients customizados (útil para testes)
  createS3Client: (customEndpoint) => {
    return new S3Client({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.s3,
      forcePathStyle: true
    });
  },

  createDynamoDBClient: (customEndpoint) => {
    return new DynamoDBClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.dynamodb
    });
  },

  createSecretsManagerClient: (customEndpoint) => {
    return new SecretsManagerClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.secretsManager
    });
  },

  createSystemsManagerClient: (customEndpoint) => {
    return new SystemsManagerClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.systemsManager
    });
  },

  createKMSClient: (customEndpoint) => {
    return new KMSClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.kms
    });
  },

  createKinesisClient: (customEndpoint) => {
    return new KinesisClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.kinesis
    });
  },

  createSESClient: (customEndpoint) => {
    return new SESClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.ses
    });
  },

  createEventBridgeClient: (customEndpoint) => {
    return new EventBridgeClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.eventbridge
    });
  },

  createSNSClient: (customEndpoint) => {
    return new SNSClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.sns
    });
  },

  createCloudWatchLogsClient: (customEndpoint) => {
    return new CloudWatchLogsClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.cloudwatchLogs
    });
  },

  createCloudWatchClient: (customEndpoint) => {
    return new CloudWatchClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.cloudwatch
    });
  },

  createXRayClient: (customEndpoint) => {
    return new XRayClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.xray
    });
  },

  createAthenaClient: (customEndpoint) => {
    return new AthenaClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.athena
    });
  },

  createConfigClient: (customEndpoint) => {
    return new ConfigServiceClient({
      ...baseConfig,
      endpoint: customEndpoint || localEndpoints.config
    });
  }
};