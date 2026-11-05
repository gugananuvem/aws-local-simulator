/**
 * Configurações padrão do simulador
 */

module.exports = {
  // Serviços habilitados por padrão
  services: {
    dynamodb: true,
    dax: true,
    s3: true,
    sqs: true,
    lambda: true,
    sns: true,
    eventbridge: true,
    ecs: false,
    cognito: true,
    apigateway: true,
    sts: true,
    "secret-manager": true,
    "parameter-store": true,
    kms: true,
    kinesis: true,
    ec2: true,
    alb: true,
    asg: true,
    opensearch: true,
    "kinesis-data-streams": true,
    "kinesis-firehose": true,
    "kinesis-analytics": true,
    organizations: true,
    route53: true,
    acm: true,
  },

  // Portas padrão
  ports: {
    dynamodb: 8000,
    dax: 8111,
    s3: 4566,
    sqs: 9324,
    lambda: 3001,
    sns: 9911,
    eventbridge: 4010,
    ecs: 8080,
    cognito: 9229,
    apigateway: 4567,
    sts: 9326,
    athena: 4599,
    secretManager: 4001,
    parameterStore: 4002,
    kms: 4000,
    kinesis: 4568,
    "kinesis-data-streams": 4568,
    "kinesis-firehose": 4569,
    "kinesis-analytics": 4570,
    ec2: 4020,
    alb: 4021,
    asg: 4022,
    opensearch: 9200,
    organizations: 4581,
    cloudformation: 4582,
    route53: 4024,
    acm: 4025,
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

  // Porta do servidor de administração (Management API)
  adminPort: 9999,

  // Organizations Policy Enforcement
  // Aplica SCP + IAM roles em todos os serviços (como na AWS real)
  organizationsPolicyEnforcement: {
    // Ativar/desativar validação de políticas globalmente
    enabled: false,

    // Exigir contexto de conta (STS AssumeRole)
    // Se true, requisições sem credenciais são negadas
    // Se false, requisições sem credenciais usam comportamento padrão
    requireAccountContext: false,

    // Configuração de avaliação de SCP
    scpEvaluation: {
      enabled: true,
      // Log tentativas negadas
      logDenials: true,
      // Log tentativas permitidas
      logAllowances: false,
      // TTL do cache de avaliações (em ms)
      cacheTTL: 60000, // 60 segundos
      // Timeout para avaliação (em ms)
      timeout: 5000
    },

    // Serviços que têm enforcement habilitado
    enforcedServices: [
      's3',
      'sqs',
      'sns',
      'dynamodb',
      'cognito',
      'kms',
      'lambda',
      'ec2',
      'apigateway',
      'cloudformation',
      'iam',
      'sts',
      'opensearch',
      'cloudwatch',
      'cloudtrail'
    ],

    // Duração padrão de temporary credentials (em segundos)
    credentialDuration: 3600, // 1 hora

    // Prefixo para SessionToken (para identificar tokens STS)
    sessionTokenPrefix: 'AQOD'
  },
};
