/**
 * Configurações padrão do simulador
 */

module.exports = {
  // Serviços habilitados por padrão
  services: {
    dynamodb: true,
    s3: true,
    sqs: true,
    lambda: true,
    sns: false,
    eventbridge: false,
    ecs: false,
    cognito: false,
    apigateway: false,
  },

  // Portas padrão
  ports: {
    dynamodb: 8000,
    s3: 4566,
    sqs: 9324,
    lambda: 3001,
    sns: 9911,
    eventbridge: 4010,
    ecs: 8080,
    cognito: 9229,
    apigateway: 4567,
  },
  apigateway: {
    defaultCors: {
      allowOrigins: ["*"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["*"],
      maxAge: 300,
    },
    defaultThrottling: {
      burstLimit: 100,
      rateLimit: 10,
    },
    enableAccessLogging: true,
    autoDeploy: true,
  },
  // Configurações de persistência
  dataDir: "./.aws-local-simulator-data",

  // Configurações de logging
  logLevel: "info", // silent, info, debug, verboso

  // Configurações das Lambdas
  lambdas: [], // Será preenchido pelo usuário

  // Configurações de CORS
  cors: true,

  // Auto-criação de tabelas DynamoDB
  autoCreateTables: true,

  // Auto-criação de buckets S3
  autoCreateBuckets: true,

  // Configurações adicionais
  additional: {},
};
