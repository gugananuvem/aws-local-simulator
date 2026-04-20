# AWS Local Simulator

[![npm version](https://badge.fury.io/js/aws-local-simulator.svg)](https://badge.fury.io/js/aws-local-simulator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/aws-local-simulator.svg)](https://nodejs.org)

Simulador local completo para serviços AWS. Desenvolva e teste suas aplicações AWS localmente sem custos!

## 🚀 Serviços Suportados

| Serviço | Status | Porta Padrão | Descrição |
|---------|--------|--------------|-----------|
| DynamoDB | ✅ | 8000 | Banco de dados NoSQL |
| S3 | ✅ | 4566 | Armazenamento de objetos |
| SQS | ✅ | 9324 | Filas de mensagens |
| Lambda | ✅ | 3001 | Funções serverless |
| Cognito | ✅ | 9229 | Autenticação e autorização |
| API Gateway | ✅ | 4567 | APIs REST e HTTP |
| STS | ✅ | 9326 | Credenciais temporárias |
| SNS | ✅ | 9911 | Notificações pub/sub |
| EventBridge | ✅ | 4010 | Barramento de eventos |
| KMS | ✅ | 4000 | Gerenciamento de chaves |
| Secrets Manager | ✅ | 4001 | Gerenciamento de segredos |
| Parameter Store | ✅ | 4002 | Armazenamento de parâmetros |
| CloudWatch | ✅ | 4011 | Logs, métricas e alarmes |
| CloudTrail | ✅ | 4012 | Auditoria de API calls |
| AWS Config | ✅ | 4013 | Conformidade e configuração |
| CloudFormation | ✅ | 4580 | Infraestrutura como código |
| Athena | ✅ | 4599 | Consultas SQL em dados no S3 |
| X-Ray | ✅ | 4015 | Rastreamento distribuído |
| ECS/Fargate | 🚧 | 8080 | Orquestração de containers (em desenvolvimento) |

## 📦 Instalação

```bash
npm install --save-dev aws-local-simulator
```

## 🚀 Uso Rápido

### 1. Crie um arquivo de configuração `aws-local-simulator.json`:

```json
{
  "services": {
    "dynamodb": true,
    "s3": true,
    "sqs": true,
    "lambda": true,
    "cognito": true,
    "apigateway": true,
    "sts": true,
    "sns": true,
    "eventbridge": true,
    "kms": true,
    "secret-manager": true,
    "parameter-store": true,
    "cloudwatch": true,
    "cloudtrail": true,
    "cloudformation": true,
    "xray": true,
    "config": true,
    "athena": true
  },
  "lambdas": [
    {
      "name": "my-function",
      "handler": "./src/handlers/users.js",
      "env": {
        "TABLE_NAME": "users-table"
      }
    }
  ],
  "dynamodb": {
    "tables": [
      {
        "TableName": "users-table",
        "KeySchema": [{ "AttributeName": "id", "KeyType": "HASH" }],
        "AttributeDefinitions": [{ "AttributeName": "id", "AttributeType": "S" }]
      }
    ]
  },
  "s3": {
    "buckets": [
      { "name": "my-bucket", "region": "us-east-1" }
    ]
  },
  "sqs": {
    "queues": ["my-queue", "dead-letter-queue"]
  },
  "cognito": {
    "userPools": [
      {
        "PoolName": "my-user-pool",
        "AutoVerifiedAttributes": ["email"]
      }
    ]
  }
}
```

### 2. Inicie o simulador:

```bash
# Via CLI
npx aws-local-simulator start

# Ou via código
const { AWSLocalSimulator } = require('aws-local-simulator');
const simulator = new AWSLocalSimulator();
await simulator.start();
```

### 3. Configure seu código para usar os serviços locais:

```javascript
const { dynamoDB, s3, sqs, cognito } = require('aws-local-simulator/aws-config');

await dynamoDB.send(new PutCommand({
  TableName: 'users-table',
  Item: { id: '123', name: 'John' }
}));
```

## 🔧 Configuração por Variáveis de Ambiente

| Variável | Descrição | Padrão |
|---------|----------|-------|
| AWS_LOCAL_SIMULATOR_DYNAMODB | Habilita DynamoDB | true |
| AWS_LOCAL_SIMULATOR_S3 | Habilita S3 | true |
| AWS_LOCAL_SIMULATOR_SQS | Habilita SQS | true |
| AWS_LOCAL_SIMULATOR_LAMBDA | Habilita Lambda | true |
| AWS_LOCAL_SIMULATOR_COGNITO | Habilita Cognito | false |
| AWS_LOCAL_SIMULATOR_APIGATEWAY | Habilita API Gateway | false |
| AWS_LOCAL_SIMULATOR_STS | Habilita STS | true |
| AWS_LOCAL_SIMULATOR_SNS | Habilita SNS | false |
| AWS_LOCAL_SIMULATOR_EVENTBRIDGE | Habilita EventBridge | false |
| AWS_LOCAL_SIMULATOR_KMS | Habilita KMS | false |
| AWS_LOCAL_SIMULATOR_SECRET_MANAGER | Habilita Secrets Manager | false |
| AWS_LOCAL_SIMULATOR_PARAMETER_STORE | Habilita Parameter Store | false |
| AWS_LOCAL_SIMULATOR_CLOUDWATCH | Habilita CloudWatch | false |
| AWS_LOCAL_SIMULATOR_CLOUDTRAIL | Habilita CloudTrail | false |
| AWS_LOCAL_SIMULATOR_CLOUDFORMATION | Habilita CloudFormation | false |
| AWS_LOCAL_SIMULATOR_ATHENA | Habilita Athena | false |
| AWS_LOCAL_SIMULATOR_XRAY | Habilita X-Ray | false |
| AWS_LOCAL_SIMULATOR_CONFIG | Habilita AWS Config | false |
| AWS_LOCAL_SIMULATOR_ECS | Habilita ECS/Fargate | false |
| AWS_LOCAL_SIMULATOR_DYNAMODB_PORT | Porta DynamoDB | 8000 |
| AWS_LOCAL_SIMULATOR_S3_PORT | Porta S3 | 4566 |
| AWS_LOCAL_SIMULATOR_SQS_PORT | Porta SQS | 9324 |
| AWS_LOCAL_SIMULATOR_LAMBDA_PORT | Porta Lambda | 3001 |
| AWS_LOCAL_SIMULATOR_COGNITO_PORT | Porta Cognito | 9229 |
| AWS_LOCAL_SIMULATOR_APIGATEWAY_PORT | Porta API Gateway | 4567 |
| AWS_LOCAL_SIMULATOR_STS_PORT | Porta STS | 9326 |
| AWS_LOCAL_SIMULATOR_SNS_PORT | Porta SNS | 9911 |
| AWS_LOCAL_SIMULATOR_EVENTBRIDGE_PORT | Porta EventBridge | 4010 |
| AWS_LOCAL_SIMULATOR_KMS_PORT | Porta KMS | 4000 |
| AWS_LOCAL_SIMULATOR_SECRET_MANAGER_PORT | Porta Secrets Manager | 4001 |
| AWS_LOCAL_SIMULATOR_PARAMETER_STORE_PORT | Porta Parameter Store | 4002 |
| AWS_LOCAL_SIMULATOR_CLOUDWATCH_PORT | Porta CloudWatch | 4011 |
| AWS_LOCAL_SIMULATOR_CLOUDTRAIL_PORT | Porta CloudTrail | 4012 |
| AWS_LOCAL_SIMULATOR_CONFIG_PORT | Porta AWS Config | 4013 |
| AWS_LOCAL_SIMULATOR_XRAY_PORT | Porta X-Ray | 4015 |
| AWS_LOCAL_SIMULATOR_CLOUDFORMATION_PORT | Porta CloudFormation | 4580 |
| AWS_LOCAL_SIMULATOR_ATHENA_PORT | Porta Athena | 4599 |
| AWS_LOCAL_SIMULATOR_ECS_PORT | Porta ECS | 8080 |
| AWS_LOCAL_SIMULATOR_DATA | Diretório de dados | ./aws-local-simulator-data |
| AWS_LOCAL_SIMULATOR_LOG | Nível de log | info |

## 📝 Comandos CLI

```bash
# Iniciar simulador
npx aws-local-simulator start [configPath]

# Parar simulador
npx aws-local-simulator stop

# Reiniciar
npx aws-local-simulator restart

# Resetar dados
npx aws-local-simulator reset

# Status
npx aws-local-simulator status
```

## 🔌 Endpoints

| Serviço | Endpoint | Admin |
|---------|----------|-------|
| DynamoDB | http://localhost:8000 | http://localhost:8000/__admin/tables |
| S3 | http://localhost:4566 | http://localhost:4566/__admin/buckets |
| S3 Website | http://localhost:4566/website/{bucket}/ | — |
| SQS | http://localhost:9324 | http://localhost:9324/__admin/queues |
| Lambda | http://localhost:3001 | http://localhost:3001/__admin/functions |
| Cognito | http://localhost:9229 | http://localhost:9229/__admin/userpools |
| API Gateway | http://localhost:4567 | http://localhost:4567/__admin/apis |
| STS | http://localhost:9326 | — |
| SNS | http://localhost:9911 | http://localhost:9911/__admin/health |
| EventBridge | http://localhost:4010 | — |
| KMS | http://localhost:4000 | — |
| Secrets Manager | http://localhost:4001 | — |
| Parameter Store | http://localhost:4002 | — |
| CloudWatch | http://localhost:4011 | — |
| CloudTrail | http://localhost:4012 | — |
| AWS Config | http://localhost:4013 | — |
| X-Ray | http://localhost:4015 | — |
| CloudFormation | http://localhost:4580 | http://localhost:4580/__admin/stacks |
| Athena | http://localhost:4599 | http://localhost:4599/__admin/health |
| ECS | http://localhost:8080 | http://localhost:8080/__admin/clusters |

## 🧪 Testando com AWS CLI

```bash
# DynamoDB
aws dynamodb list-tables --endpoint-url http://localhost:8000

# S3
aws s3 ls --endpoint-url http://localhost:4566

# SQS
aws sqs list-queues --endpoint-url http://localhost:9324

# Lambda
aws lambda invoke \
  --function-name my-function \
  --payload '{"key":"value"}' \
  --endpoint-url http://localhost:3001 \
  output.json

# Cognito
aws cognito-idp list-user-pools --max-results 10 --endpoint-url http://localhost:9229

# Cognito cadastrar um usuario pelo adminstrador
aws cognito-idp admin-create-user \
  --user-pool-id us-east-xxxx\
  --username usuario@email.com \
  --user-attributes \
    Name=email,Value=usuario@email.com \
    Name=email_verified,Value=false \
    Name=name,Value="nome usuario" \
    Name=custom:role,Value="user" \
    temporary-password "Teste@123456" \
  --message-action SUPPRESS \
  --endpoint-url http://localhost:9229

# Cognito excluir um usuario
aws cognito-idp admin-delete-user \
  --user-pool-id us-east-xxxx \
  --username usuario@email.com
  --endpoint-url http://localhost:9229

# Cognito Registrar usuário
aws cognito-idp sign-up \
  --client-id $CLIENT_ID \
  --username usuario@email.com \
  --password "Teste@123456" \
  --user-attributes Name=email,Value=usuario@email.com Name=name,Value="nome usuario"
  --endpoint-url http://localhost:9229

# 2. Confirmar usuário administrativamente
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id us-east-xxxx \
  --username usuario@email.com
  --endpoint-url http://localhost:9229

# O código chega no e-mail do usuário. Algo como: "Your confirmation code is 123456"
aws cognito-idp confirm-sign-up \
  --client-id 3n4b5urk1ft4fl3mg5e62d9ado \
  --username usuario@email.com \
  --confirmation-code 123456
  --endpoint-url http://localhost:9229
  
# STS
aws sts get-caller-identity --endpoint-url http://localhost:9326
aws sts assume-role \
  --role-arn "arn:aws:iam::123456789012:role/my-role" \
  --role-session-name "my-session" \
  --endpoint-url http://localhost:9326

# SNS
aws sns list-topics --endpoint-url http://localhost:9911

# EventBridge
aws events list-event-buses --endpoint-url http://localhost:4010

# KMS
aws kms list-keys --endpoint-url http://localhost:4000

# Secrets Manager
aws secretsmanager list-secrets --endpoint-url http://localhost:4001

# Criar secret
aws secretsmanager create-secret \
  --name "local/app/db-credentials" \
  --description "Credenciais do banco" \
  --secret-string '{"username":"admin","password":"secret123"}' \
  --endpoint-url http://localhost:4001

# Ler secret
aws secretsmanager get-secret-value \
  --secret-id "local/app/db-credentials" \
  --endpoint-url http://localhost:4001

# Parameter Store
aws ssm describe-parameters --endpoint-url http://localhost:4002

# Criar parâmetro String
aws ssm put-parameter \
  --name "/local/app/config" \
  --value '{"timeout":30,"maxRetries":3}' \
  --type String \
  --endpoint-url http://localhost:4002

# Criar parâmetro SecureString
aws ssm put-parameter \
  --name "/local/app/api-key" \
  --value "my-secret-api-key" \
  --type SecureString \
  --endpoint-url http://localhost:4002

# Ler parâmetro
aws ssm get-parameter \
  --name "/local/app/config" \
  --endpoint-url http://localhost:4002

# CloudWatch
aws cloudwatch list-metrics --endpoint-url http://localhost:4011
aws logs describe-log-groups --endpoint-url http://localhost:4011

# CloudTrail
aws cloudtrail describe-trails --endpoint-url http://localhost:4012

# CloudFormation
aws cloudformation list-stacks --endpoint-url http://localhost:4580

# X-Ray
aws xray get-trace-summaries \
  --start-time $(date -d '1 hour ago' +%s) \
  --end-time $(date +%s) \
  --endpoint-url http://localhost:4015

# AWS Config
aws configservice describe-configuration-recorders --endpoint-url http://localhost:4013

# API Gateway
aws apigateway get-rest-apis --endpoint-url http://localhost:4567

# Cloudformation
aws cloudformation create-stack \
  --stack-name test-stack \
  --template-body file://templates/test-stack.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=local \
    ParameterKey=BucketName,ParameterValue=meu-bucket \
    ParameterKey=QueueName,ParameterValue=minha-fila \
    ParameterKey=TableName,ParameterValue=minha-tabela \
  --endpoint-url http://localhost:4580

# Ver Cloudformation resultado 
aws cloudformation describe-stacks \
  --stack-name test-stack \
  --endpoint-url http://localhost:4580  

# Athena
# Criar workgroup
aws athena create-work-group \
  --name my-workgroup \
  --configuration ResultConfiguration={OutputLocation=s3://meu-bucket/athena-results/} \
  --endpoint-url http://localhost:4599

# Listar workgroups
aws athena list-work-groups --endpoint-url http://localhost:4599

# Executar query
aws athena start-query-execution \
  --query-string "SELECT * FROM my_table LIMIT 10" \
  --query-execution-context Database=default \
  --result-configuration OutputLocation=s3://meu-bucket/athena-results/ \
  --endpoint-url http://localhost:4599

# Verificar status da query
aws athena get-query-execution \
  --query-execution-id <id-retornado> \
  --endpoint-url http://localhost:4599

# Buscar resultados
aws athena get-query-results \
  --query-execution-id <id-retornado> \
  --endpoint-url http://localhost:4599

# Criar named query
aws athena create-named-query \
  --name "my-saved-query" \
  --database default \
  --query-string "SELECT id, value FROM my_table WHERE status = 'active'" \
  --endpoint-url http://localhost:4599

# Listar named queries
aws athena list-named-queries --endpoint-url http://localhost:4599
```

## ⚙️ Configuração S3

### Buckets simples

```json
{
  "s3": {
    "buckets": [
      "my-bucket"
    ]
  }
}
```

### Buckets com região e website estático

```json
{
  "s3": {
    "buckets": [
      { "name": "my-bucket", "region": "us-east-1" },
      {
        "name": "my-site-bucket",
        "region": "us-east-1",
        "websiteConfiguration": {
          "IndexDocument": { "Suffix": "index.html" },
          "ErrorDocument": { "Key": "error.html" }
        }
      }
    ]
  }
}
```

Quando `websiteConfiguration` está presente, o bucket serve arquivos estáticos.

### URL do website estático

```
http://localhost:4566/website/{bucket-name}/
http://localhost:4566/website/{bucket-name}/caminho/pagina.html
```

Exemplos:
```
http://localhost:4566/website/my-site-bucket/           → serve index.html
http://localhost:4566/website/my-site-bucket/about.html → serve about.html
http://localhost:4566/website/my-site-bucket/app/       → serve app/index.html
```

### Gerenciar website config via AWS CLI

```bash
# Habilitar website em um bucket existente
aws s3api put-bucket-website \
  --bucket my-site-bucket \
  --website-configuration '{"IndexDocument":{"Suffix":"index.html"},"ErrorDocument":{"Key":"error.html"}}' \
  --endpoint-url http://localhost:4566

# Ver configuração de website
aws s3api get-bucket-website \
  --bucket my-site-bucket \
  --endpoint-url http://localhost:4566

# Remover website
aws s3api delete-bucket-website \
  --bucket my-site-bucket \
  --endpoint-url http://localhost:4566
```

## ⚙️ Configuração de Lambdas

Lambdas são registradas por **nome** e invocadas via API de invocação (igual à AWS real). O roteamento HTTP é feito pelo API Gateway.

```json
{
  "lambdas": [
    {
      "name": "my-user-function",
      "handler": "./src/handlers/my-user-function.js",
      "env": {
        "TABLE_NAME": "users-table",
        "BUCKET_NAME": "my-bucket"
      }
    }
  ]
}
```

## ⚙️ Configuração API GATEWAY

O valor do **lambdaName** deve igual ao nome Lambda que está registrada com o valor **name**. Ex: "my-user-function".

```json
{
  "apigateway": {
    "apis": [
      {
        "name": "Users API",
        "description": "API para gerenciamento de usuários",
        "endpoints": [
          {
            "path": "/user",
            "method": "GET",
            "lambdaName": "my-user-function",
            "integrationType": "lambda"
          },
          {
            "path": "/user",
            "method": "POST",
            "lambdaName": "my-user-function",
            "integrationType": "lambda"
          },
          {
            "path": "/user/{id}",
            "method": "GET",
            "lambdaName": "my-user-function",
            "integrationType": "lambda"
          },
          {
            "path": "/user/{id}",
            "method": "DELETE",
            "lambdaName": "my-user-function",
            "integrationType": "lambda"
          }
        ]
      }
    ]
  },

}
```

O handler deve exportar uma função padrão:

```javascript
exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello from Lambda!' })
  };
};
```

## 📁 Estrutura de Dados

Os dados são persistidos em:

```text
.aws-local-simulator-data/
├── dynamodb/
├── s3/
├── sqs/
├── cognito/
├── apigateway/
├── ecs/
├── kms/
├── secret-manager/
├── parameter-store/
├── cloudwatch/
├── cloudtrail/
├── cloudformation/
├── athena/
├── xray/
└── config/
```

## 🐛 Debug

```bash
AWS_LOCAL_SIMULATOR_LOG=verbose npx aws-local-simulator start
```

## 🤝 Contribuindo

1. Fork o projeto
2. Crie sua feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

MIT © Luiz Gustavo Ribeiro

## ⚠️ Limitações

- ECS/Fargate em desenvolvimento
- WebSocket APIs em desenvolvimento
- Para uso em desenvolvimento e testes apenas
