# AWS Local Simulator

[![npm version](https://badge.fury.io/js/aws-local-simulator.svg)](https://badge.fury.io/js/aws-local-simulator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/aws-local-simulator.svg)](https://nodejs.org)

Simulador local completo para serviços AWS. Desenvolva e teste suas aplicações AWS localmente sem custos!

## 🚀 Serviços Suportados

| Serviço | Status | Porta Padrão | Features |
|---------|--------|--------------|----------|
| DynamoDB | ✅ | 8000 | Banco de dados NoSQL |
| S3 | ✅ | 4566 | Armazenamento de objetos, Website estático |
| SQS | ✅ | 9324 | Filas de mensagens, **DLQ com RedrivePolicy**, Lambda Trigger |
| Lambda | ✅ | 3001 | Funções serverless, batchItemFailures |
| Cognito | ✅ | 9229 | Autenticação e autorização |
| API Gateway | ✅ | 4567 | APIs REST e HTTP, Cognito Authorizer, API Keys |
| STS | ✅ | 9326 | Credenciais temporárias |
| SNS | ✅ | 9911 | Notificações pub/sub |
| EventBridge | ✅ | 4010 | Barramento de eventos |
| KMS | ✅ | 4000 | Gerenciamento de chaves |
| Secrets Manager | ✅ | 4001 | Gerenciamento de segredos |
| Parameter Store | ✅ | 4002 | Armazenamento de parâmetros |
| CloudWatch | ✅ | 4011 | Logs, métricas e alarmes |
| CloudTrail | ✅ | 4012 | Auditoria de API calls |
| AWS Config | ✅ | 4013 | Conformidade e configuração |
| CloudFormation | ✅ | 4582 | Infraestrutura como código |
| Athena | ✅ | 4599 | Consultas SQL em dados no S3 |
| X-Ray | ✅ | 4015 | Rastreamento distribuído |
| IAM | ✅ | 4003 | Identity and Access Management — users, groups, roles, policies, policy evaluation |
| **VPC** | **✅** | **4014** | **VPCs, Subnets, Route Tables, Internet Gateways, VPC Endpoints, NAT Gateways** |
| **EC2** | **✅** | **4020** | **Instâncias, AMIs, Security Groups, Network Interfaces, Web servers, Proxy** |
| **ALB** | **✅** | **4021** | **Load Balancers, Target Groups, Health Checks, Round-robin routing** |
| **ASG** | **✅** | **4022** | **Auto Scaling Groups, Launch Templates, Scaling Policies, Target Tracking** |
| **OpenSearch** | **✅** | **9200** | **Índices, Documentos, Busca Full-text, Agregações, Queries** |
| **Kinesis Data Streams** | **✅** | **4568** | **Shards, Records, Consumers, PutRecord, GetRecords** |
| **Kinesis Data Firehose** | **✅** | **4569** | **Delivery Streams, S3/HTTP/Redshift Destinations, Buffering** |
| **Kinesis Data Analytics** | **✅** | **4570** | **SQL Applications, Inputs/Outputs, Real-time Analytics** |
| **Organizations** | **✅** | **4581** | **OUs, Accounts, Service Control Policies, Control Tower Guardrails, Compliance** |
| **CloudFront** | **✅** | **4566** | **Distributions, Caching, Invalidation, Geo-restrictions, Signed URLs, Origins** |

## 🔌 Portas dos Serviços

Cada serviço roda em uma porta padrão diferente. Para detalhes completos sobre configuração de portas, veja [**📚 Documentação de Portas**](docs/PORTS_CONFIGURATION.md).

**Resumo das portas principais:**

| Serviço | Porta | URL |
|---------|-------|-----|
| S3 (com Presigned URLs) | 4566 | http://localhost:4566 |
| DynamoDB | 8000 | http://localhost:8000 |
| Lambda | 3001 | http://localhost:3001 |
| API Gateway | 4567 | http://localhost:4567 |
| **CloudFormation** | **4582** | **http://localhost:4582** |
| **Organizations + Control Tower** | **4581** | **http://localhost:4581** |
| Cognito | 9229 | http://localhost:9229 |
| OpenSearch | 9200 | http://localhost:9200 |
| Kinesis Streams | 4568 | http://localhost:4568 |
| Kinesis Firehose | 4569 | http://localhost:4569 |
| Kinesis Analytics | 4570 | http://localhost:4570 |

**ℹ️ Nota:** Você pode customizar as portas no arquivo `aws-local-simulator.json` usando a chave `ports`.

## 📦 Instalação

```bash
npm install --save-dev @gugananuvem/aws-local-simulator
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
    "eventbridge": false,
    "kms": true,
    "secret-manager": true,
    "parameter-store": true,
    "cloudwatch": true,
    "cloudtrail": true,
    "cloudformation": true,
    "xray": true,
    "config": true,
    "athena": true,
    "iam": true,
    "vpc": true,
    "ec2": true,
    "alb": true,
    "asg": true,
    "opensearch": true,
    "kinesis-data-streams": true,
    "kinesis-firehose": true,
    "kinesis-analytics": true,
    "organizations": true
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
  },
  "vpc": {
    "vpcs": [
      {
        "CidrBlock": "10.0.0.0/16",
        "Tags": [{"Key": "Name", "Value": "main-vpc"}]
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
| AWS_LOCAL_SIMULATOR_IAM | Habilita IAM | false |
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
| AWS_LOCAL_SIMULATOR_IAM_PORT | Porta IAM | 4003 |
| AWS_LOCAL_SIMULATOR_VPC | Habilita VPC | false |
| AWS_LOCAL_SIMULATOR_VPC_PORT | Porta VPC | 4014 |
| AWS_LOCAL_SIMULATOR_ECS_PORT | Porta ECS | 8080 |
| AWS_LOCAL_SIMULATOR_OPENSEARCH | Habilita OpenSearch | false |
| AWS_LOCAL_SIMULATOR_OPENSEARCH_PORT | Porta OpenSearch | 9200 |
| AWS_LOCAL_SIMULATOR_KINESIS_DATA_STREAMS | Habilita Kinesis Data Streams | false |
| AWS_LOCAL_SIMULATOR_KINESIS_DATA_STREAMS_PORT | Porta Kinesis Data Streams | 4568 |
| AWS_LOCAL_SIMULATOR_KINESIS_FIREHOSE | Habilita Kinesis Data Firehose | false |
| AWS_LOCAL_SIMULATOR_KINESIS_FIREHOSE_PORT | Porta Kinesis Data Firehose | 4569 |
| AWS_LOCAL_SIMULATOR_KINESIS_ANALYTICS | Habilita Kinesis Data Analytics | false |
| AWS_LOCAL_SIMULATOR_KINESIS_ANALYTICS_PORT | Porta Kinesis Data Analytics | 4570 |
| AWS_LOCAL_SIMULATOR_ORGANIZATIONS | Habilita Organizations | false |
| AWS_LOCAL_SIMULATOR_ORGANIZATIONS_PORT | Porta Organizations | 4580 |
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

## 🖥️ Management API

O simulador expõe uma API de gerenciamento em tempo de execução na porta `9999` (configurável via `adminPort`). Ela permite habilitar e desabilitar serviços individualmente sem reiniciar o processo.

### Endpoints da Management API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/__admin/services` | Lista todos os 19 serviços com status |
| GET | `/__admin/services/:name` | Status de um serviço específico |
| POST | `/__admin/services/:name/enable` | Habilita um serviço parado |
| POST | `/__admin/services/:name/disable` | Desabilita um serviço em execução |

### Exemplos

```bash
# Listar todos os serviços
curl http://localhost:9999/__admin/services

# Habilitar DynamoDB
curl -X POST http://localhost:9999/__admin/services/dynamodb/enable

# Desabilitar SQS
curl -X POST http://localhost:9999/__admin/services/sqs/disable

# Status de um serviço
curl http://localhost:9999/__admin/services/lambda
```

### Configuração da porta admin

```json
{
  "adminPort": 9999
}
```

Ou via variável de ambiente:
```bash
AWS_LOCAL_SIMULATOR_ADMIN_PORT=9999 npx aws-local-simulator start
```

> A Management API nunca persiste alterações em disco — todo o estado é mantido em memória. Para uso em desenvolvimento local apenas.

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
| IAM | http://localhost:4003 | http://localhost:4003/__admin/users |
| **VPC** | **http://localhost:4014** | **http://localhost:4014/__admin/resources** |
| **Organizations** | **http://localhost:4580** | **http://localhost:4580/__admin/organization** |
| Management API | http://localhost:9999 | http://localhost:9999/__admin/services |

## 🧪 Testando com AWS CLI

## 🧪 Testando com AWS CLI - Exemplos Completos por Serviço

### DynamoDB
```bash
# Listar tabelas
aws dynamodb list-tables --endpoint-url http://localhost:8000

# Descrever tabela
aws dynamodb describe-table --table-name users-table --endpoint-url http://localhost:8000

# Adicionar item
aws dynamodb put-item \
  --table-name users-table \
  --item '{"id":{"S":"user-1"},"name":{"S":"João"},"email":{"S":"joao@example.com"}}' \
  --endpoint-url http://localhost:8000

# Listar itens
aws dynamodb scan --table-name users-table --endpoint-url http://localhost:8000

# Obter item
aws dynamodb get-item \
  --table-name users-table \
  --key '{"id":{"S":"user-1"}}' \
  --endpoint-url http://localhost:8000

# Deletar item
aws dynamodb delete-item \
  --table-name users-table \
  --key '{"id":{"S":"user-1"}}' \
  --endpoint-url http://localhost:8000
```

### S3
```bash
# Listar buckets
aws s3 ls --endpoint-url http://localhost:4566

# Criar bucket
aws s3 mb s3://my-bucket --endpoint-url http://localhost:4566

# Listar objetos
aws s3 ls s3://my-bucket --endpoint-url http://localhost:4566

# Upload de arquivo
aws s3 cp myfile.txt s3://my-bucket/myfile.txt --endpoint-url http://localhost:4566

# Download de arquivo
aws s3 cp s3://my-bucket/myfile.txt ./myfile.txt --endpoint-url http://localhost:4566

# Deletar objeto
aws s3 rm s3://my-bucket/myfile.txt --endpoint-url http://localhost:4566

# Gerar URL pré-assinada (presigned URL)
aws s3 presign s3://my-bucket/myfile.txt --endpoint-url http://localhost:4566
```

### SQS
```bash
# Listar filas
aws sqs list-queues --endpoint-url http://localhost:9324

# Criar fila
aws sqs create-queue --queue-name my-queue --endpoint-url http://localhost:9324

# Enviar mensagem
aws sqs send-message \
  --queue-url http://localhost:9324/queue/my-queue \
  --message-body "Hello World" \
  --endpoint-url http://localhost:9324

# Receber mensagens
aws sqs receive-message \
  --queue-url http://localhost:9324/queue/my-queue \
  --max-number-of-messages 10 \
  --endpoint-url http://localhost:9324

# Deletar mensagem
aws sqs delete-message \
  --queue-url http://localhost:9324/queue/my-queue \
  --receipt-handle "xxxxx" \
  --endpoint-url http://localhost:9324

# Deletar fila
aws sqs delete-queue --queue-url http://localhost:9324/queue/my-queue --endpoint-url http://localhost:9324
```

### Lambda
```bash
# Listar funções
aws lambda list-functions --endpoint-url http://localhost:3001

# Invocar função
aws lambda invoke \
  --function-name my-function \
  --payload '{"key":"value"}' \
  --endpoint-url http://localhost:3001 \
  output.json

# Descrever função
aws lambda get-function --function-name my-function --endpoint-url http://localhost:3001

# Deletar função
aws lambda delete-function --function-name my-function --endpoint-url http://localhost:3001
```

### Cognito
```bash
# Listar user pools
aws cognito-idp list-user-pools --max-results 10 --endpoint-url http://localhost:9229

# Registrar usuário
aws cognito-idp sign-up \
  --client-id YOUR_CLIENT_ID \
  --username usuario@email.com \
  --password "Teste@123456" \
  --user-attributes Name=email,Value=usuario@email.com \
  --endpoint-url http://localhost:9229

# Criar usuário (admin)
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@email.com \
  --user-attributes Name=email,Value=usuario@email.com Name=name,Value="Full Name" \
  --temporary-password "Teste@123456" \
  --message-action SUPPRESS \
  --endpoint-url http://localhost:9229

# Confirmar usuário (admin)
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@email.com \
  --endpoint-url http://localhost:9229

# Deletar usuário (admin)
aws cognito-idp admin-delete-user \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@email.com \
  --endpoint-url http://localhost:9229

# Listar usuários
aws cognito-idp list-users --user-pool-id us-east-1_xxxxx --endpoint-url http://localhost:9229
```

### API Gateway
```bash
# Listar APIs
aws apigateway get-rest-apis --endpoint-url http://localhost:4567

# Criar API REST
aws apigateway create-rest-api \
  --name my-api \
  --description "My API" \
  --endpoint-url http://localhost:4567

# Testar endpoint da API
curl http://localhost:4567/users

# Com autenticação via API Key
curl http://localhost:4567/protected \
  -H "x-api-key: minha-chave-secreta"
```

### SNS
```bash
# Listar tópicos
aws sns list-topics --endpoint-url http://localhost:9911

# Criar tópico
aws sns create-topic --name my-topic --endpoint-url http://localhost:9911

# Publicar mensagem
aws sns publish \
  --topic-arn arn:aws:sns:us-east-1:123456789012:my-topic \
  --message "Hello from SNS" \
  --endpoint-url http://localhost:9911

# Listar inscrições
aws sns list-subscriptions --endpoint-url http://localhost:9911
```

### EventBridge
```bash
# Listar event buses
aws events list-event-buses --endpoint-url http://localhost:4010

# Listar rules
aws events list-rules --endpoint-url http://localhost:4010

# Enviar evento
aws events put-events \
  --entries '[{"Source":"myapp","DetailType":"userAction","Detail":"{\"userId\":123,\"action\":\"login\"}"}]' \
  --endpoint-url http://localhost:4010
```

### STS
```bash
# Obter identidade do chamador
aws sts get-caller-identity --endpoint-url http://localhost:9326

# Assumir role
aws sts assume-role \
  --role-arn "arn:aws:iam::123456789012:role/my-role" \
  --role-session-name "my-session" \
  --endpoint-url http://localhost:9326
```

### KMS
```bash
# Listar chaves
aws kms list-keys --endpoint-url http://localhost:4000

# Criar chave
aws kms create-key --description "My Key" --endpoint-url http://localhost:4000

# Encriptar dados
aws kms encrypt \
  --key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012 \
  --plaintext "Hello World" \
  --endpoint-url http://localhost:4000
```

### Secrets Manager
```bash
# Listar secrets
aws secretsmanager list-secrets --endpoint-url http://localhost:4001

# Criar secret
aws secretsmanager create-secret \
  --name "db/credentials" \
  --secret-string '{"username":"admin","password":"secret123"}' \
  --endpoint-url http://localhost:4001

# Obter secret
aws secretsmanager get-secret-value --secret-id "db/credentials" --endpoint-url http://localhost:4001

# Deletar secret
aws secretsmanager delete-secret --secret-id "db/credentials" --endpoint-url http://localhost:4001
```

### Parameter Store (SSM)
```bash
# Listar parâmetros
aws ssm describe-parameters --endpoint-url http://localhost:4002

# Criar parâmetro
aws ssm put-parameter \
  --name "/app/config" \
  --value '{"timeout":30}' \
  --type String \
  --endpoint-url http://localhost:4002

# Obter parâmetro
aws ssm get-parameter --name "/app/config" --endpoint-url http://localhost:4002

# Deletar parâmetro
aws ssm delete-parameter --name "/app/config" --endpoint-url http://localhost:4002
```

### CloudWatch
```bash
# Listar métricas
aws cloudwatch list-metrics --endpoint-url http://localhost:4011

# Listar logs
aws logs describe-log-groups --endpoint-url http://localhost:4011

# Listar alarmes
aws cloudwatch describe-alarms --endpoint-url http://localhost:4011
```

### CloudTrail
```bash
# Listar trails
aws cloudtrail describe-trails --endpoint-url http://localhost:4012

# Listar eventos
aws cloudtrail lookup-events --endpoint-url http://localhost:4012
```

### AWS Config
```bash
# Descrever resources
aws configservice describe-config-resources --endpoint-url http://localhost:4013

# Listar compliance
aws configservice describe-compliance-by-config-rule --endpoint-url http://localhost:4013
```

### CloudFormation
```bash
# Listar stacks
aws cloudformation list-stacks --endpoint-url http://localhost:4582

# Criar stack
aws cloudformation create-stack \
  --stack-name my-stack \
  --template-body file://template.json \
  --endpoint-url http://localhost:4582

# Descrever stack
aws cloudformation describe-stacks --stack-name my-stack --endpoint-url http://localhost:4582

# Deletar stack
aws cloudformation delete-stack --stack-name my-stack --endpoint-url http://localhost:4582
```

### Organizations
```bash
# Listar organizações
aws organizations list-roots --endpoint-url http://localhost:4581

# Listar OUs
aws organizations list-organizational-units-for-parent \
  --parent-id r-xxxx \
  --endpoint-url http://localhost:4581

# Listar accounts
aws organizations list-accounts --endpoint-url http://localhost:4581

# Criar account
aws organizations create-account \
  --email "newaccount@example.com" \
  --account-name "New Account" \
  --endpoint-url http://localhost:4581

### EC2
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

# IAM
aws iam create-user --user-name developer --endpoint-url http://localhost:4003

aws iam create-role \
  --role-name lambda-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --endpoint-url http://localhost:4003

aws iam create-policy \
  --policy-name SQSFullAccess \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"sqs:*","Resource":"*"}]}' \
  --endpoint-url http://localhost:4003

aws iam attach-user-policy \
  --user-name developer \
  --policy-arn arn:aws:iam::123456789012:policy/SQSFullAccess \
  --endpoint-url http://localhost:4003

aws iam attach-role-policy \
  --role-name lambda-role \
  --policy-arn arn:aws:iam::123456789012:policy/SQSFullAccess \
  --endpoint-url http://localhost:4003

aws iam list-users --endpoint-url http://localhost:4003

aws iam list-roles --endpoint-url http://localhost:4003

aws iam create-access-key --user-name developer --endpoint-url http://localhost:4003

# VPC
# Criar VPC
aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=meu-vpc}]' \
  --endpoint-url http://localhost:4014

# VPC - Com suporte completo a AWS CLI (EC2 Query Protocol) ✅
# Agora você pode usar comandos AWS CLI padrão directamente!

# Listar VPCs
aws ec2 describe-vpcs --endpoint-url http://localhost:4014

# Criar VPC
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --endpoint-url http://localhost:4014

# Deletar VPC
aws ec2 delete-vpc --vpc-id vpc-xxxxx --endpoint-url http://localhost:4014

# Descrever Subnets
aws ec2 describe-subnets --endpoint-url http://localhost:4014

# Criar Subnet
aws ec2 create-subnet --vpc-id vpc-xxxxx --cidr-block 10.0.1.0/24 --availability-zone us-east-1a --endpoint-url http://localhost:4014

# Deletar Subnet
aws ec2 delete-subnet --subnet-id subnet-xxxxx --endpoint-url http://localhost:4014

# Descrever Internet Gateways
aws ec2 describe-internet-gateways --endpoint-url http://localhost:4014

# Criar Internet Gateway
aws ec2 create-internet-gateway --endpoint-url http://localhost:4014

# Anexar Internet Gateway à VPC
aws ec2 attach-internet-gateway --internet-gateway-id igw-xxxxx --vpc-id vpc-xxxxx --endpoint-url http://localhost:4014

# Desanexar Internet Gateway
aws ec2 detach-internet-gateway --internet-gateway-id igw-xxxxx --vpc-id vpc-xxxxx --endpoint-url http://localhost:4014

# Deletar Internet Gateway
aws ec2 delete-internet-gateway --internet-gateway-id igw-xxxxx --endpoint-url http://localhost:4014

# Descrever Route Tables
aws ec2 describe-route-tables --endpoint-url http://localhost:4014

# Criar Route Table
aws ec2 create-route-table --vpc-id vpc-xxxxx --endpoint-url http://localhost:4014

# Criar rota para Internet Gateway (default route)
aws ec2 create-route --route-table-id rtb-xxxxx --destination-cidr-block 0.0.0.0/0 --gateway-id igw-xxxxx --endpoint-url http://localhost:4014

# Deletar Route Table
aws ec2 delete-route-table --route-table-id rtb-xxxxx --endpoint-url http://localhost:4014

# Opcional: Usar endpoints via variáveis de ambiente
export AWS_ENDPOINT_URL_EC2=http://localhost:4014
aws ec2 describe-vpcs
aws ec2 create-vpc --cidr-block 10.1.0.0/16

# EC2 - Gerenciar Instâncias
aws ec2 describe-instances --endpoint-url http://localhost:4020

# Executar Instância
aws ec2 run-instances --image-id ami-0c55b159cbfafe1f0 --count 1 --instance-type t2.micro \
  --endpoint-url http://localhost:4020

# Iniciar Instância
aws ec2 start-instances --instance-ids i-xxxxx --endpoint-url http://localhost:4020

# Parar Instância
aws ec2 stop-instances --instance-ids i-xxxxx --endpoint-url http://localhost:4020

# Reiniciar Instância
aws ec2 reboot-instances --instance-ids i-xxxxx --endpoint-url http://localhost:4020

# Terminar Instância
aws ec2 terminate-instances --instance-ids i-xxxxx --endpoint-url http://localhost:4020

# ALB (Application Load Balancer) - Admin Endpoints (REST API)
# Criar Load Balancer
curl -X POST http://localhost:4021/__admin/alb/load-balancers/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name":"my-alb",
    "Subnets":["subnet-12345","subnet-67890"],
    "Scheme":"internet-facing",
    "Tags":[{"Key":"Name","Value":"My ALB"}]
  }'

# Listar Load Balancers
curl http://localhost:4021/__admin/alb/load-balancers

# Descrever ALB específico
curl http://localhost:4021/__admin/alb/load-balancers/arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/xxxxx

# Criar Target Group
curl -X POST http://localhost:4021/__admin/alb/target-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name":"my-targets",
    "Protocol":"HTTP",
    "Port":80,
    "VpcId":"vpc-12345"
  }'

# Listar Target Groups
curl http://localhost:4021/__admin/alb/target-groups

# Registrar Targets
curl -X POST http://localhost:4021/__admin/alb/target-groups/arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-targets/xxxxx/targets \
  -H "Content-Type: application/json" \
  -d '{
    "Targets":[
      {"Id":"i-12345","Port":80},
      {"Id":"i-67890","Port":80}
    ]
  }'

# Desregistrar Targets
curl -X DELETE http://localhost:4021/__admin/alb/target-groups/arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-targets/xxxxx/targets \
  -H "Content-Type: application/json" \
  -d '{"Targets":[{"Id":"i-12345"}]}'

# Criar Listener
curl -X POST http://localhost:4021/__admin/alb/load-balancers/arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/xxxxx/listeners \
  -H "Content-Type: application/json" \
  -d '{
    "Protocol":"HTTP",
    "Port":80,
    "DefaultActions":[{
      "Type":"forward",
      "TargetGroupArn":"arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-targets/xxxxx"
    }]
  }'

# Deletar Load Balancer
curl -X DELETE http://localhost:4021/__admin/alb/load-balancers/arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/xxxxx

# Deletar Target Group
curl -X DELETE http://localhost:4021/__admin/alb/target-groups/arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-targets/xxxxx

# ASG (Auto Scaling Groups) - Admin Endpoints (REST API)
# Criar Launch Template
curl -X POST http://localhost:4022/__admin/asg/launch-templates/create \
  -H "Content-Type: application/json" \
  -d '{
    "LaunchTemplateName":"my-template",
    "LaunchTemplateData":{
      "ImageId":"ami-0c55b159cbfafe1f0",
      "InstanceType":"t2.micro"
    }
  }'

# Listar Launch Templates
curl http://localhost:4022/__admin/asg/launch-templates

# Obter Launch Template
curl http://localhost:4022/__admin/asg/launch-templates/lt-12345

# Deletar Launch Template
curl -X DELETE http://localhost:4022/__admin/asg/launch-templates/lt-12345

# Criar Auto Scaling Group
curl -X POST http://localhost:4022/__admin/asg/auto-scaling-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "AutoScalingGroupName":"my-asg",
    "LaunchTemplateId":"lt-12345",
    "MinSize":1,
    "MaxSize":5,
    "DesiredCapacity":2,
    "AvailabilityZones":["us-east-1a","us-east-1b"]
  }'

# Listar Auto Scaling Groups
curl http://localhost:4022/__admin/asg/auto-scaling-groups

# Obter ASG Específico
curl http://localhost:4022/__admin/asg/auto-scaling-groups/my-asg

# Definir Desired Capacity
curl -X PUT http://localhost:4022/__admin/asg/auto-scaling-groups/my-asg/desired-capacity \
  -H "Content-Type: application/json" \
  -d '{"DesiredCapacity":3}'

# Criar Scaling Policy
curl -X POST http://localhost:4022/__admin/asg/scaling-policies/create \
  -H "Content-Type: application/json" \
  -d '{
    "AutoScalingGroupName":"my-asg",
    "PolicyName":"scale-up-policy",
    "PolicyType":"TargetTrackingScaling",
    "TargetValue":70.0
  }'

# Listar Scaling Policies
curl http://localhost:4022/__admin/asg/auto-scaling-groups/my-asg/scaling-policies

# Deletar Scaling Policy
curl -X DELETE http://localhost:4022/__admin/asg/scaling-policies/my-asg:scale-up-policy

# Deletar Auto Scaling Group
curl -X DELETE http://localhost:4022/__admin/asg/auto-scaling-groups/my-asg?forceDelete=true

# Kinesis Data Streams - Admin Endpoints (REST API)
# Criar Stream
curl -X POST http://localhost:4568/__admin/streams/create \
  -H "Content-Type: application/json" \
  -d '{
    "StreamName":"my-stream",
    "ShardCount":1
  }'

# Listar Streams
curl http://localhost:4568/__admin/streams

# Descrever Stream
curl http://localhost:4568/__admin/streams/my-stream

# Enviar Um Registro
curl -X POST http://localhost:4568/__admin/streams/my-stream/records \
  -H "Content-Type: application/json" \
  -d '{
    "Data":"{\"id\":1,\"name\":\"João\",\"timestamp\":1234567890}",
    "PartitionKey":"user-1"
  }'

# Enviar Múltiplos Registros (Batch)
curl -X POST http://localhost:4568/__admin/streams/my-stream/records-batch \
  -H "Content-Type: application/json" \
  -d '{
    "Records":[
      {"Data":"{\"id\":2,\"name\":\"Maria\"}","PartitionKey":"user-2"},
      {"Data":"{\"id\":3,\"name\":\"Pedro\"}","PartitionKey":"user-3"}
    ]
  }'

# Registrar Consumer
curl -X POST http://localhost:4568/__admin/streams/my-stream/consumers \
  -H "Content-Type: application/json" \
  -d '{"ConsumerName":"my-consumer"}'

# Listar Consumers
curl http://localhost:4568/__admin/streams/my-stream/consumers

# Obter Shard Iterator
curl -X POST http://localhost:4568/__admin/streams/my-stream/shard-iterator \
  -H "Content-Type: application/json" \
  -d '{
    "ShardId":"shardId-000000000000",
    "ShardIteratorType":"TRIM_HORIZON"
  }'

# Listar Shards
curl http://localhost:4568/__admin/streams/my-stream/shards

# Deletar Stream
curl -X DELETE http://localhost:4568/__admin/streams/my-stream

# Kinesis Data Firehose - Admin Endpoints (REST API)
# Criar Delivery Stream (para S3)
curl -X POST http://localhost:4569/__admin/delivery-streams/create \
  -H "Content-Type: application/json" \
  -d '{
    "DeliveryStreamName":"my-firehose",
    "S3DestinationConfiguration":{
      "RoleARN":"arn:aws:iam::123456789012:role/firehose-role",
      "BucketARN":"arn:aws:s3:::my-bucket",
      "Prefix":"firehose/",
      "BufferingHints":{"SizeInMBs":128,"IntervalInSeconds":60}
    }
  }'

# Criar Delivery Stream (para HTTP)
curl -X POST http://localhost:4569/__admin/delivery-streams/create \
  -H "Content-Type: application/json" \
  -d '{
    "DeliveryStreamName":"my-http-firehose",
    "HttpEndpointDestinationConfiguration":{
      "EndpointConfiguration":{"Url":"https://example.com/endpoint"},
      "BufferingHints":{"SizeInMBs":128,"IntervalInSeconds":60},
      "RetryConfiguration":{"DurationInSeconds":3600}
    }
  }'

# Listar Delivery Streams
curl http://localhost:4569/__admin/delivery-streams

# Descrever Delivery Stream
curl http://localhost:4569/__admin/delivery-streams/my-firehose

# Enviar Registro
curl -X POST http://localhost:4569/__admin/delivery-streams/my-firehose/record \
  -H "Content-Type: application/json" \
  -d '{
    "Record":{"Data":"{\"id\":1,\"event\":\"click\",\"timestamp\":1234567890}"}
  }'

# Enviar Múltiplos Registros (Batch)
curl -X POST http://localhost:4569/__admin/delivery-streams/my-firehose/records-batch \
  -H "Content-Type: application/json" \
  -d '{
    "Records":[
      {"Data":"{\"id\":1,\"event\":\"click\"}"},
      {"Data":"{\"id\":2,\"event\":\"purchase\"}"}
    ]
  }'

# Deletar Delivery Stream
curl -X DELETE http://localhost:4569/__admin/delivery-streams/my-firehose

# Kinesis Analytics - Admin Endpoints (REST API)
# Criar SQL Application
curl -X POST http://localhost:4570/__admin/applications/create \
  -H "Content-Type: application/json" \
  -d '{
    "ApplicationName":"my-analytics-app",
    "ApplicationCode":"SELECT * FROM SOURCE_SQL_STREAM_001;"
  }'

# Listar Applications
curl http://localhost:4570/__admin/applications

# Descrever Application
curl http://localhost:4570/__admin/applications/my-analytics-app

# Iniciar Application
curl -X POST http://localhost:4570/__admin/applications/my-analytics-app/start

# Parar Application
curl -X POST http://localhost:4570/__admin/applications/my-analytics-app/stop

# Deletar Application
curl -X DELETE http://localhost:4570/__admin/applications/my-analytics-app

# Kinesis Firehose
# NOTA: Firehose usa admin endpoints, não os padrão AWS CLI
# Criar Delivery Stream para S3 (via admin endpoint)
curl -X POST http://localhost:4569/__admin/delivery-streams/create \
  -H "Content-Type: application/json" \
  -d '{"DeliveryStreamName":"meu-firehose","DeliveryStreamType":"DirectPut","ExtendedS3DestinationConfiguration":{"RoleARN":"arn:aws:iam::123456789012:role/firehose-role","BucketARN":"arn:aws:s3:::meu-bucket","Prefix":"firehose-data/"}}'

# Listar Delivery Streams (via admin endpoint)
curl http://localhost:4569/__admin/delivery-streams

# Descrever Delivery Stream (via admin endpoint)
curl http://localhost:4569/__admin/delivery-streams/meu-firehose

# Enviar registro (via admin endpoint)
curl -X POST http://localhost:4569/__admin/delivery-streams/meu-firehose/records \
  -H "Content-Type: application/json" \
  -d '{"Record":{"Data":"{\"id\":2,\"data\":\"algo\"}"}}'

# Enviar múltiplos registros (via admin endpoint)
curl -X POST http://localhost:4569/__admin/delivery-streams/meu-firehose/records-batch \
  -H "Content-Type: application/json" \
  -d '{"Records":[{"Data":"{\"id\":3,\"data\":\"algo\"}"}]}'

# Deletar Delivery Stream (via admin endpoint)
curl -X DELETE http://localhost:4569/__admin/delivery-streams/meu-firehose

# Organizations
# NOTA: Organizations usa rotas REST com POST/GET
# Criar Organização
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"CreateOrganization","FeatureSet":"ALL"}'

# Descrever Organização
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"DescribeOrganization"}'

# Listar Contas
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"ListAccounts"}'

# Criar Conta
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"CreateAccount","Email":"nova-conta@exemplo.com","AccountName":"Conta de Desenvolvimento"}'

# Criar Unidade Organizacional (OU)
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"CreateOrganizationalUnit","ParentId":"r-xxxxx","Name":"Desenvolvimento"}'

# Listar OUs
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"ListOrganizationalUnitsForParent","ParentId":"r-xxxxx"}'

# Mover Conta entre OUs
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"MoveAccount","AccountId":"123456789012","SourceParentId":"r-xxxxx","DestinationParentId":"ou-yyyyy"}'

# Criar Policy (SCP)
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"CreatePolicy","Name":"DenyEC2Termination","Type":"SERVICE_CONTROL_POLICY","Content":"{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Deny\",\"Action\":\"ec2:TerminateInstances\",\"Resource\":\"*\"}]}"}'

# Listar Policies
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"ListPolicies","Filter":"SERVICE_CONTROL_POLICY"}'

# Anexar Policy a um alvo
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"AttachPolicy","PolicyId":"p-xxxxx","TargetId":"ou-yyyyy"}'

# Listar Policies anexadas a um alvo
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"ListPoliciesForTarget","TargetId":"ou-xxxxx","Filter":"SERVICE_CONTROL_POLICY"}'

# Desanexar Policy
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"DetachPolicy","PolicyId":"p-xxxxx","TargetId":"ou-yyyyy"}'

# Avaliar SCPs para uma ação
curl -X POST http://localhost:4581/ \
  -H "Content-Type: application/json" \
  -d '{"Action":"EvaluateSCPs","Policies":"{\"PolicyType\":\"SERVICE_CONTROL_POLICY\"}","AccountId":"123456789012","Action":"ec2:*"}'
```

## ⚙️ Configuração IAM

O IAM service permite pré-provisionar users, groups, roles e policies via configuração. Os recursos são criados automaticamente ao iniciar o simulador.

```json
{
  "services": {
    "iam": true
  },
  "iam": {
    "policies": [
      {
        "PolicyName": "SQSFullAccess",
        "Path": "/",
        "Document": {
          "Version": "2012-10-17",
          "Statement": [
            {
              "Effect": "Allow",
              "Action": "sqs:*",
              "Resource": "*"
            }
          ]
        }
      },
      {
        "PolicyName": "S3ReadOnly",
        "Path": "/",
        "Document": {
          "Version": "2012-10-17",
          "Statement": [
            {
              "Effect": "Allow",
              "Action": ["s3:GetObject", "s3:ListBucket"],
              "Resource": "*"
            }
          ]
        }
      }
    ],
    "users": [
      {
        "UserName": "developer",
        "Path": "/",
        "Policies": ["arn:aws:iam::123456789012:policy/SQSFullAccess"],
        "generateAccessKeys": true
      },
      {
        "UserName": "readonly-user",
        "Path": "/",
        "Policies": ["arn:aws:iam::123456789012:policy/S3ReadOnly"],
        "generateAccessKeys": true
      }
    ],
    "groups": [
      {
        "GroupName": "developers",
        "Members": ["developer"],
        "Policies": ["arn:aws:iam::123456789012:policy/SQSFullAccess"]
      }
    ],
    "roles": [
      {
        "RoleName": "lambda-execution-role",
        "Path": "/service-role/",
        "AssumeRolePolicyDocument": {
          "Version": "2012-10-17",
          "Statement": [
            {
              "Effect": "Allow",
              "Principal": { "Service": "lambda.amazonaws.com" },
              "Action": "sts:AssumeRole"
            }
          ]
        },
        "Policies": ["arn:aws:iam::123456789012:policy/SQSFullAccess"]
      }
    ]
  }
}
```

- **policies**: Define IAM policies com nome e documento JSON de permissões
- **users**: Cria usuários com políticas anexadas. Use `generateAccessKeys: true` para gerar credenciais automaticamente (AccessKeyId é exibido no console ao iniciar)
- **groups**: Cria grupos com membros e políticas compartilhadas
- **roles**: Cria roles assumíveis via STS com trust policy e políticas anexadas

Quando o IAM está habilitado, as requisições aos serviços SQS, SNS, Lambda e S3 são validadas contra as políticas IAM. Requisições sem credenciais válidas recebem `403 AccessDenied`.

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

### 🔗 S3 Presigned URLs

Presigned URLs permitem acesso temporário a objetos do S3 sem precisar compartilhar credenciais permanentes. O simulador suporta geração de presigned URLs com assinatura AWS Signature V4 completa.

#### Endpoints de Presigned URLs

Todos os endpoints estão disponíveis em `/__admin/presigned-urls/`:

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/get` | POST | Gerar URL para download (GET) |
| `/put` | POST | Gerar URL para upload (PUT) |
| `/delete` | POST | Gerar URL para deletar objeto (DELETE) |
| `/head` | POST | Gerar URL para verificar metadados (HEAD) |
| `/post-policy` | POST | Gerar política para upload via formulário HTML |
| `/validate` | POST | Validar se uma presigned URL é válida |

#### Gerar Presigned URL para Download

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/get \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "documents/report.pdf",
    "expiresIn": 3600
  }'
```

**Resposta:**
```json
{
  "presignedUrl": "http://localhost:4566/my-bucket/documents/report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...",
  "expiresIn": 3600,
  "expiresAt": "2026-09-30T20:00:00.000Z"
}
```

Você pode então compartilhar esta URL sem credenciais:
```bash
# Qualquer pessoa pode fazer download
curl "http://localhost:4566/my-bucket/documents/report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&..."
```

#### Gerar Presigned URL para Upload

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/put \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "uploads/user-photo.jpg",
    "contentType": "image/jpeg",
    "expiresIn": 1800
  }'
```

Usar a URL para upload:
```bash
curl -X PUT \
  -H "Content-Type: image/jpeg" \
  --data-binary @photo.jpg \
  "http://localhost:4566/my-bucket/uploads/user-photo.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&..."
```

#### Gerar Presigned URL para Deletar

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/delete \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "temp/old-file.txt",
    "expiresIn": 300
  }'
```

Deletar usando a URL:
```bash
curl -X DELETE "http://localhost:4566/my-bucket/temp/old-file.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&..."
```

#### Presigned POST Policy para Upload via Formulário HTML

Para uploads diretos via formulário HTML (útil para aplicações web):

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/post-policy \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "uploads/form-upload.jpg",
    "expiresIn": 3600,
    "conditions": [
      ["content-length-range", 0, 10485760],
      ["starts-with", "$Content-Type", "image/"]
    ]
  }'
```

**Resposta:**
```json
{
  "policy": "eyJleHBpcmF0aW9uIjoiMjAyNi0wOS0zMFQxOTowMDowMFoiLCJjb25kaXRpb25zIjp...",
  "signature": "abcdef123456...",
  "amzAlgorithm": "AWS4-HMAC-SHA256",
  "amzDate": "20260930T180000Z",
  "amzCredential": "AKIAIOSFODNN7EXAMPLE/20260930/us-east-1/s3/aws4_request",
  "expiresIn": 3600,
  "expiresAt": "2026-09-30T19:00:00.000Z"
}
```

Usar em um formulário HTML:
```html
<form action="http://localhost:4566/my-bucket" method="POST" enctype="multipart/form-data">
  <!-- Campos da política, gerados pela resposta acima -->
  <input type="hidden" name="policy" value="eyJleXBpcmF0aW9uIjoiMjAyNi0wOS0zMFQxOTowMDowMFoiLCJjb25kaXRpb25zIjp...">
  <input type="hidden" name="X-Amz-Algorithm" value="AWS4-HMAC-SHA256">
  <input type="hidden" name="X-Amz-Credential" value="AKIAIOSFODNN7EXAMPLE/20260930/us-east-1/s3/aws4_request">
  <input type="hidden" name="X-Amz-Date" value="20260930T180000Z">
  <input type="hidden" name="X-Amz-Signature" value="abcdef123456...">
  
  <!-- Campo do arquivo -->
  <input type="file" name="file">
  <button type="submit">Upload</button>
</form>
```

#### Validar Presigned URL

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/validate \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:4566/my-bucket/documents/report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
    "method": "GET"
  }'
```

**Resposta (válida):**
```json
{
  "valid": true,
  "expiresAt": "2026-09-30T20:00:00.000Z",
  "remainingSeconds": 3597
}
```

#### Via AWS SDK (Node.js)

Use o AWS SDK para gerar presigned URLs programaticamente:

```javascript
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3Client = new S3Client({ 
  endpoint: 'http://localhost:4566',
  region: 'us-east-1'
});

// Presigned GET URL
const getCommand = new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'documents/report.pdf'
});

const presignedGetUrl = await getSignedUrl(s3Client, getCommand, {
  expiresIn: 3600 // 1 hora
});

console.log('Download URL:', presignedGetUrl);

// Presigned PUT URL
const putCommand = new PutObjectCommand({
  Bucket: 'my-bucket',
  Key: 'uploads/user-photo.jpg',
  ContentType: 'image/jpeg'
});

const presignedPutUrl = await getSignedUrl(s3Client, putCommand, {
  expiresIn: 1800 // 30 minutos
});

console.log('Upload URL:', presignedPutUrl);
```

#### Recursos de Segurança

- **Assinatura AWS Signature V4**: Todas as presigned URLs usam assinatura completa AWS Signature V4
- **Expiração Configurável**: Controle tempo de vida da URL (`expiresIn` em segundos)
- **Validação de Método**: URLs são vinculadas ao método HTTP específico (GET, PUT, DELETE, HEAD)
- **Credenciais Personalizadas**: Suporte para credenciais customizadas na geração
- **POST Policies**: Policies podem incluir condições (content-type, content-length, etc.)

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

## ⚙️ Configuração SQS com Lambda Trigger e Dead Letter Queue (DLQ)

Para disparar uma Lambda automaticamente quando uma mensagem chega na fila, use o formato de objeto na lista de filas com `lambdaName`:

```json
{
  "lambdas": [
    {
      "name": "process-orders",
      "handler": "./src/handlers/process-orders.js"
    }
  ],
  "sqs": {
    "queues": [
      "simple-queue",
      {
        "name": "orders-dlq"
      },
      {
        "name": "orders-queue",
        "lambdaName": "process-orders",
        "batchSize": 5
      }
    ]
  }
}
```

- Filas simples (string) são criadas sem trigger
- Filas com objeto aceitam `lambdaName` (nome da Lambda registrada) e `batchSize` (padrão: 10)
- Quando uma mensagem é enviada para `orders-queue`, a Lambda `process-orders` é invocada automaticamente com o evento no formato SQS padrão da AWS

### Dead Letter Queue (DLQ)

O simulador suporta configuração de Dead Letter Queue com `RedrivePolicy`. Configure a DLQ via `SetQueueAttributes`:

```javascript
// Criar DLQ
const dlqResult = await sqs.send(new CreateQueueCommand({
  QueueName: 'orders-dlq'
}));

// Configurar fila principal com RedrivePolicy
const mainQueueResult = await sqs.send(new CreateQueueCommand({
  QueueName: 'orders-queue'
}));

const queueUrl = mainQueueResult.QueueUrl;
await sqs.send(new SetQueueAttributesCommand({
  QueueUrl: queueUrl,
  Attributes: {
    RedrivePolicy: JSON.stringify({
      deadLetterTargetArn: 'arn:aws:sqs:local:000000000000:orders-dlq',
      maxReceiveCount: '3'  // Move para DLQ após 3 tentativas
    }),
    VisibilityTimeout: '30'
  }
}));
```

**Comportamento de DLQ:**

1. Mensagem chega na fila principal
2. Lambda recebe e processa (ApproximateReceiveCount = 1)
3. Se falhar: mensagem retorna à fila (invisível por VisibilityTimeout segundos)
4. Lambda recebe novamente (ApproximateReceiveCount = 2)
5. Se falhar novamente, volta à fila (ApproximateReceiveCount = 3)
6. Terceira falha: mensagem move automaticamente para DLQ
7. Mensagens podem ser consultadas em DLQ para análise e reprocessamento

### Lambda Handler com Batch Item Failures

O handler recebe o evento no formato padrão AWS SQS:

```javascript
exports.handler = async (event) => {
  const batchItemFailures = [];
  
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      console.log('Processando pedido:', body);
      
      // Processar pedido...
      await processPedido(body);
      
      console.log('Pedido processado com sucesso:', record.messageId);
    } catch (error) {
      console.error('Erro ao processar pedido:', error);
      
      // Adicionar à lista de falhas para reprocessamento
      batchItemFailures.push({
        itemIdentifier: record.messageId
      });
    }
  }

  // Retornar apenas as mensagens que falharam
  // Mensagens com sucesso serão deletadas automaticamente
  return { batchItemFailures };
};
```

**Atributos de Mensagem Disponíveis:**

```javascript
exports.handler = async (event) => {
  for (const record of event.Records) {
    console.log('MessageId:', record.messageId);
    console.log('ReceiptHandle:', record.receiptHandle);
    console.log('ApproximateReceiveCount:', 
      record.attributes.ApproximateReceiveCount);  // Número de tentativas
    console.log('ApproximateFirstReceiveTimestamp:', 
      record.attributes.ApproximateFirstReceiveTimestamp);
    console.log('SentTimestamp:', 
      record.attributes.SentTimestamp);
  }
};
```

**Consultar DLQ:**

```bash
# Listar mensagens na DLQ
aws sqs receive-message \
  --queue-url http://localhost:9324/queue/orders-dlq \
  --endpoint-url http://localhost:9324

# Consultar atributos da fila incluindo RedrivePolicy
aws sqs get-queue-attributes \
  --queue-url http://localhost:9324/queue/orders-queue \
  --attribute-names All \
  --endpoint-url http://localhost:9324
```

**Documentação Completa:**

Para informações detalhadas sobre DLQ, veja:
- [MIGRATION_GUIDE_SQS_DLQ.md](./MIGRATION_GUIDE_SQS_DLQ.md) - Guia passo-a-passo de migração
- [SQS_DLQ_IMPLEMENTATION.md](./SQS_DLQ_IMPLEMENTATION.md) - Documentação técnica completa
- [VALIDATION_SQS_DLQ.md](./VALIDATION_SQS_DLQ.md) - Matriz de compatibilidade com AWS
- [examples/sqs-dlq-example.js](./examples/sqs-dlq-example.js) - Exemplo prático funcional

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
          },
          {
            "path": "/user/{id}",
            "method": "ANY",
            "lambdaName": "my-user-function",
            "integrationType": "lambda"
          }
        ]
      }
    ]
  }
}
```

### Método ANY

Use `"method": "ANY"` para registrar um endpoint que aceita todos os verbos HTTP (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS) — equivalente ao `ANY` do AWS API Gateway real.

```json
{
  "path": "/webhook",
  "method": "ANY",
  "lambdaName": "my-webhook-handler",
  "integrationType": "lambda"
}
```

### API Key

O API Gateway suporta validação de API Key via header `x-api-key`. Para proteger um endpoint, declare as `apiKeys` na configuração e use `"apiKeyRequired": true` no endpoint:

```json
{
  "apigateway": {
    "apiKeys": [
      {
        "name": "my-app-key",
        "value": "minha-chave-secreta-123"
      }
    ],
    "apis": [
      {
        "name": "Protected API",
        "endpoints": [
          {
            "path": "/protected",
            "method": "GET",
            "lambdaName": "my-user-function",
            "integrationType": "lambda",
            "apiKeyRequired": true
          },
          {
            "path": "/public",
            "method": "GET",
            "lambdaName": "my-user-function",
            "integrationType": "lambda"
          }
        ]
      }
    ]
  }
}
```

Ao chamar um endpoint protegido, envie o header:

```bash
curl http://localhost:4567/protected \
  -H "x-api-key: minha-chave-secreta-123"

# Sem a key → 403 Forbidden
curl http://localhost:4567/protected
```

> **Nota:** A validação de API Key só está ativa no fluxo de proxy (`/:apiId/:stageName/*`). Endpoints declarados diretamente no `aws-local-simulator.json` via `setupConfigRoutes` não aplicam a validação de API Key no momento.

### Cognito Authorizer

O API Gateway suporta autenticação via Cognito User Pools. Configure um `authorizer` na API e marque os endpoints protegidos com `"authorizerRequired": true`:

```json
{
  "cognito": {
    "userPools": [
      {
        "PoolName": "my-user-pool",
        "UserPoolId": "us-east-XXXXX",
        "ClientId": "XXXXXX",
        "AutoVerifiedAttributes": ["email"]
      }
    ]
  },
  "apigateway": {
    "apis": [
      {
        "name": "My API",
        "authorizer": {
          "type": "COGNITO_USER_POOLS",
          "userPoolId": "us-east-XXXXX"
        },
        "endpoints": [
          {
            "path": "/profile",
            "method": "GET",
            "lambdaName": "my-user-function",
            "integrationType": "lambda",
            "authorizerRequired": true
          },
          {
            "path": "/public",
            "method": "GET",
            "lambdaName": "my-user-function",
            "integrationType": "lambda"
          }
        ]
      }
    ]
  }
}
```

O simulador valida o JWT do Cognito local no header `Authorization: Bearer <token>`. Se o token for inválido ou ausente, retorna `401 Unauthorized`.

```bash
# 1. Autenticar e obter o token
TOKEN=$(curl -s -X POST http://localhost:9229/ \
  -H "Content-Type: application/x-amz-json-1.1" \
  -H "X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth" \
  -d '{
    "AuthFlow": "USER_PASSWORD_AUTH",
    "ClientId": "XXXXXX",
    "AuthParameters": {
      "USERNAME": "usuario@email.com",
      "PASSWORD": "Senha@123"
    }
  }' | jq -r '.AuthenticationResult.IdToken')

# 2. Chamar endpoint protegido com o token
curl http://localhost:4567/profile \
  -H "Authorization: Bearer $TOKEN"

# Sem token → 401 Unauthorized
curl http://localhost:4567/profile
```

O token decodificado fica disponível no Lambda em `event.requestContext.authorizer.claims`:

```javascript
exports.handler = async (event) => {
  const claims = event.requestContext.authorizer?.claims;
  const userId = claims?.sub;
  const email = claims?.email;

  return {
    statusCode: 200,
    body: JSON.stringify({ userId, email })
  };
};
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
├── config/
└── iam/
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


## ⚙️ Configuração VPC

O VPC service permite gerenciar Virtual Private Clouds, Subnets, Route Tables, Internet Gateways e VPC Endpoints.

### Criar VPC via Configuração

```json
{
  "services": {
    "vpc": true
  },
  "vpc": {
    "vpcs": [
      {
        "CidrBlock": "10.0.0.0/16",
        "Tags": [{"Key": "Name", "Value": "main-vpc"}],
        "EnableDnsHostnames": true,
        "EnableDnsSupport": true
      }
    ],
    "subnets": [
      {
        "VpcId": "vpc-xxxxx",
        "CidrBlock": "10.0.1.0/24",
        "AvailabilityZone": "us-east-1a",
        "MapPublicIpOnLaunch": true
      }
    ]
  }
}
```

### Testar VPC

```bash
# Health Check
curl http://localhost:4014/__admin/health

# Criar VPC
curl -X POST http://localhost:4014/__admin/vpcs/create \
  -H "Content-Type: application/json" \
  -d '{"CidrBlock":"10.0.0.0/16"}'

# Listar VPCs
curl http://localhost:4014/__admin/vpcs

# Criar Subnet
curl -X POST http://localhost:4014/__admin/subnets/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId":"vpc-xxxxx",
    "CidrBlock":"10.0.1.0/24",
    "AvailabilityZone":"us-east-1a"
  }'

# Criar Internet Gateway
curl -X POST http://localhost:4014/__admin/internet-gateways/create

# Listar Todos os Recursos
curl http://localhost:4014/__admin/resources
```

### Exemplo Completo

Execute o exemplo prático que cria uma arquitetura VPC completa:

```bash
node examples/vpc-example.js
```

Este script cria:
- 1 VPC (10.0.0.0/16)
- 2 Subnets Públicas
- 1 Subnet Privada
- 1 Internet Gateway
- 2 Route Tables
- 1 VPC Endpoint S3

### Recursos VPC

- ✅ **VPCs**: Create, Read, Update, Delete com Tags
- ✅ **Subnets**: Multi-AZ com validação de CIDR overlap
- ✅ **Route Tables**: Múltiplas rotas, associações de subnets
- ✅ **Internet Gateways**: Attach/Detach de VPCs
- ✅ **VPC Endpoints**: Gateway (S3, DynamoDB) e Interface (Lambda, SQS, SNS)
- ✅ **NAT Gateways**: Suporte básico

### Endpoints VPC

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/__admin/vpcs/create` | Criar VPC |
| GET | `/__admin/vpcs` | Listar VPCs |
| GET | `/__admin/vpcs/{vpcId}` | Obter VPC |
| DELETE | `/__admin/vpcs/{vpcId}` | Deletar VPC |
| POST | `/__admin/subnets/create` | Criar Subnet |
| GET | `/__admin/subnets` | Listar Subnets |
| POST | `/__admin/route-tables/create` | Criar Route Table |
| POST | `/__admin/route-tables/{rtId}/routes` | Adicionar Rota |
| POST | `/__admin/internet-gateways/create` | Criar Internet Gateway |
| POST | `/__admin/internet-gateways/{igwId}/attach` | Anexar IGW |
| POST | `/__admin/vpc-endpoints/create` | Criar VPC Endpoint |

### Documentação VPC

Para guias completos, veja:
- [QUICK_START_VPC.md](./QUICK_START_VPC.md) - Começar em 5 minutos
- [VPC_TEST_GUIDE.md](./VPC_TEST_GUIDE.md) - Guia de testes completo
- [INTEGRATION_VPC_GUIDE.md](./INTEGRATION_VPC_GUIDE.md) - Integrações com outros serviços
- [src/services/vpc/README.md](./src/services/vpc/README.md) - Documentação técnica



---

## ⚙️ Configuração EC2, ALB e ASG

### EC2 (Elastic Compute Cloud)

O simulador EC2 oferece suporte completo para gerenciar instâncias virtuais localmente.

**Features:**
- ✅ Rodar instâncias com AMI customizadas
- ✅ Security Groups com regras de ingress/egress
- ✅ Network Interfaces (ENI) por instância
- ✅ Servir sites HTML/Angular/React/Vue
- ✅ Páginas padrão com informações da instância
- ✅ Estados: running, stopped, terminated

**Criar Instância:**

```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/run \
  -H "Content-Type: application/json" \
  -d '{
    "ImageId": "ami-0c55b159cbfafe1f0",
    "MinCount": 1,
    "MaxCount": 1,
    "InstanceType": "t2.micro",
    "Tags": [{"Key":"Name","Value":"web-server"}]
  }'
```

**Acessar Página da Instância:**
```bash
# Cada instância serve na porta 8000, 8001, 8002, etc.
curl http://localhost:8000
```

**Operações Disponíveis:**
- `POST /__admin/ec2/instances/run` - Rodar instância
- `GET /__admin/ec2/instances` - Listar instâncias
- `GET /__admin/ec2/instances/{id}` - Detalhes da instância
- `POST /__admin/ec2/instances/{id}/start` - Iniciar
- `POST /__admin/ec2/instances/{id}/stop` - Parar
- `POST /__admin/ec2/instances/{id}/reboot` - Reiniciar
- `POST /__admin/ec2/instances/{id}/terminate` - Terminar

### ALB (Application Load Balancer)

Distribua tráfego entre instâncias EC2 com load balancing automático.

**Features:**
- ✅ Load Balancers internet-facing e internos
- ✅ Target Groups com HTTP/HTTPS
- ✅ Round-robin load balancing
- ✅ Health checks de targets
- ✅ Listeners com roteamento automático

**Criar Load Balancer:**

```bash
curl -X POST http://localhost:4021/__admin/alb/load-balancers/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "web-alb",
    "Scheme": "internet-facing"
  }'
```

**Criar Target Group:**

```bash
curl -X POST http://localhost:4021/__admin/alb/target-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "web-targets",
    "Protocol": "HTTP",
    "Port": 80
  }'
```

**Registrar Target:**

```bash
curl -X POST http://localhost:4021/__admin/alb/target-groups/{tgArn}/register-target \
  -H "Content-Type: application/json" \
  -d '{
    "TargetId": "i-0123456789abcdef0",
    "Port": 8000
  }'
```

**Operações Disponíveis:**
- `POST /__admin/alb/load-balancers/create` - Criar ALB
- `GET /__admin/alb/load-balancers` - Listar ALBs
- `POST /__admin/alb/target-groups/create` - Criar Target Group
- `GET /__admin/alb/target-groups` - Listar Target Groups
- `POST /__admin/alb/target-groups/{arn}/register-target` - Registrar target
- `GET /__admin/alb/target-groups/{arn}/health` - Health check

### ASG (Auto Scaling Group)

Escale automaticamente suas instâncias EC2 com base em demanda.

**Features:**
- ✅ Launch Templates com AMI e tipo de instância
- ✅ Scaling automático por políticas
- ✅ Target Tracking e Step Scaling
- ✅ Integração com ALB
- ✅ Health Check Grace Period
- ✅ Cooldown periods para scale-up/down

**Criar Launch Template:**

```bash
curl -X POST http://localhost:4022/__admin/asg/launch-templates/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "web-template",
    "ImageId": "ami-0c55b159cbfafe1f0",
    "InstanceType": "t2.micro"
  }'
```

**Criar Auto Scaling Group:**

```bash
curl -X POST http://localhost:4022/__admin/asg/auto-scaling-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "AutoScalingGroupName": "web-asg",
    "LaunchTemplateId": "{templateId}",
    "minSize": 1,
    "maxSize": 5,
    "desiredCapacity": 2
  }'
```

**Escalar Manualmente:**

```bash
curl -X PUT http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/desired-capacity \
  -H "Content-Type: application/json" \
  -d '{
    "DesiredCapacity": 3
  }'
```

**Criar Scaling Policy:**

```bash
curl -X POST http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/scaling-policies \
  -H "Content-Type: application/json" \
  -d '{
    "PolicyName": "cpu-scaling",
    "PolicyType": "TargetTrackingScaling",
    "targetValue": 70
  }'
```

**Operações Disponíveis:**
- `POST /__admin/asg/launch-templates/create` - Criar Launch Template
- `GET /__admin/asg/launch-templates` - Listar Launch Templates
- `POST /__admin/asg/auto-scaling-groups/create` - Criar ASG
- `GET /__admin/asg/auto-scaling-groups` - Listar ASGs
- `PUT /__admin/asg/auto-scaling-groups/{name}/desired-capacity` - Escalar
- `POST /__admin/asg/auto-scaling-groups/{name}/scaling-policies` - Criar policy
- `POST /__admin/asg/auto-scaling-groups/{name}/evaluate-policies` - Avaliar policies

### Exemplo Completo

Execute o exemplo prático que cria EC2, ALB e ASG funcionando juntos:

```bash
node examples/ec2-alb-asg-example.js
```

Este exemplo:
1. Cria Security Group com regras HTTP/HTTPS
2. Cria Auto Scaling Group com 2 instâncias iniciais
3. Prepara ALB e Target Groups
4. Demonstra escalamento automático

### Proxy para Aplicações Locais

Use EC2 como proxy reverso para aplicações rodando na sua máquina:

```bash
# 1. Inicie sua aplicação localmente (ex: React em :3000)
npm start  # ou similar

# 2. Crie instância EC2 apontando para a aplicação
curl -X POST http://localhost:4020/__admin/ec2/instances/run \
  -H "Content-Type: application/json" \
  -d '{
    "ImageId": "ami-app",
    "ProxyUrl": "http://localhost:3000"
  }'

# 3. Acesse via EC2 (proxy automático)
curl http://localhost:8000  # → redirecionado para localhost:3000
```

**Use Case:** Testar múltiplas instâncias com ALB

```bash
# Criar 3 instâncias que fazem proxy para a mesma app
for i in 1 2 3; do
  curl -X POST http://localhost:4020/__admin/ec2/instances/run \
    -H "Content-Type: application/json" \
    -d '{
      "ImageId": "ami-app",
      "ProxyUrl": "http://localhost:3000"
    }'
done

# Registrar todas no ALB
# ALB distribuirá entre as 3 instâncias (simulando scale horizontal)
```

### Documentação Detalhada

- [QUICK_START_EC2.md](./docs/QUICK_START_EC2.md) - Guia rápido de início
- [TEST_GUIDE_EC2.md](./docs/TEST_GUIDE_EC2.md) - Matriz completa de testes
- **[PROXY_SETUP.md](./docs/PROXY_SETUP.md)** - **Guia de Proxy Reverso**
- **[OPENSEARCH_GUIDE.md](./docs/OPENSEARCH_GUIDE.md)** - **Guia Completo do OpenSearch**


---

## 🔍 OpenSearch

Simulador completo de Elasticsearch/OpenSearch com suporte a indexação, busca full-text e agregações.

### Criar Índice

```bash
curl -X PUT http://localhost:9200/products \
  -H "Content-Type: application/json" \
  -d '{
    "mappings": {
      "properties": {
        "name": { "type": "text" },
        "price": { "type": "float" },
        "category": { "type": "keyword" }
      }
    }
  }'
```

### Indexar Documento

```bash
curl -X POST http://localhost:9200/products/_doc \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Laptop",
    "price": 999.99,
    "category": "Electronics"
  }'
```

### Buscar Documentos

```bash
# Busca simples
curl "http://localhost:9200/products/_search?q=Laptop"

# Busca com query JSON
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "match": { "name": "Laptop" } },
    "from": 0,
    "size": 10
  }'
```

### Agregações

```bash
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "aggs": {
      "categories": {
        "terms": { "field": "category", "size": 10 }
      },
      "avg_price": {
        "avg": { "field": "price" }
      }
    }
  }'
```

### Features

- ✅ CRUD de índices e documentos
- ✅ Busca full-text com múltiplos tipos de query
- ✅ Agregações (terms, avg, sum)
- ✅ Update/Delete em lote
- ✅ Paginação e sorting
- ✅ Persistência em JSON
- ✅ Compatible com clientes Elasticsearch/OpenSearch

### Começar

```bash
# Exemplo completo
node examples/opensearch-example.js
```

### Documentação

Veja [OPENSEARCH_GUIDE.md](./docs/OPENSEARCH_GUIDE.md) para guia completo com exemplos.



## 🌐 CloudFront (Content Delivery Network)

Distribua conteúdo globalmente com cache e aceleração de performance, com suporte real a múltiplos origins.

### Features

**Distribuições:**
- ✅ Gerenciamento completo de distribuições (CRUD)
- ✅ Comportamentos customizáveis com path patterns
- ✅ Caching com TTL configurável e LRU eviction
- ✅ Invalidação de cache com wildcards
- ✅ ETag versioning e statistics

**Origins (Real Routing):**
- ✅ **S3** - Acesso direto a objetos com validação de bucket policy
- ✅ **API Gateway** - Roteia para APIs REST/HTTP
- ✅ **ALB/EC2** - Roteia para Load Balancer e instâncias EC2
- ✅ **Lambda** - Invoca funções Lambda
- ✅ **HTTP/HTTPS** - Requisições para servidores externos

**Segurança:**
- ✅ Geo-restrictions (whitelist/blacklist por país)
- ✅ Signed URLs com RSA-SHA1 (canned e custom policies)
- ✅ Signed cookies para autenticação
- ✅ Origin Access Identity (OAI) support
- ✅ S3 bucket policy validation

### Configuração

```json
{
  "cloudfront": true,
  "ports": {
    "cloudfront": 4566
  }
}
```

### Exemplo: CDN com S3 + API Gateway

```javascript
const cf = cloudFrontService.getSimulator();

// Registrar serviços
cf.registerService('s3', s3Service);
cf.registerService('apigateway', apigatewayService);

// 1. Criar distribuição multi-origin
const distribution = cf.createDistribution({
  CallerReference: 'my-app-1',
  Comment: 'Multi-origin CDN',
  Origins: [
    {
      Id: 's3Origin',
      DomainName: 'my-bucket.s3.amazonaws.com',
      S3OriginConfig: { OriginAccessIdentity: 'origin-access-identity/cloudfront/E123ABC' }
    },
    {
      Id: 'apiOrigin',
      DomainName: 'api-123.execute-api.us-east-1.amazonaws.com',
      CustomOriginConfig: { OriginProtocolPolicy: 'https-only' }
    }
  ],
  DefaultCacheBehavior: {
    TargetOriginId: 's3Origin',
    ViewerProtocolPolicy: 'redirect-to-https',
    DefaultTTL: 86400
  },
  CacheBehaviors: [
    {
      PathPattern: '/api/*',
      TargetOriginId: 'apiOrigin',
      DefaultTTL: 0  // Sem cache para APIs
    }
  ],
  Enabled: true
});

// 2. Definir S3 bucket policy
const s3 = s3Service.getSimulator();
s3.putBucketPolicy('my-bucket', {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: {
      AWS: 'arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity/E123ABC'
    },
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::my-bucket/*'
  }]
});

// 3. Processa requisições (roteadas para origins corretos)
// GET /images/logo.png → S3 (cacheado por 1 dia)
const response1 = cf.processRequest({
  distributionId: distribution.id,
  path: '/images/logo.png'
});

// GET /api/users → API Gateway (sem cache)
const response2 = cf.processRequest({
  distributionId: distribution.id,
  path: '/api/users',
  method: 'GET'
});

console.log(response1.status);      // 200
console.log(response1.cacheStatus); // MISS (primeira vez)
console.log(response2.status);      // 200 (do API Gateway)
```

### S3 Bucket Policy + CloudFront

CloudFront respeita bucket policies S3:

```javascript
// Bucket PÚBLICO
s3.putBucketPolicy('bucket', {
  Statement: [{
    Effect: 'Allow',
    Principal: '*',  // Qualquer um
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::bucket/*'
  }]
});
// CloudFront: ✅ 200 OK

// Bucket PRIVADO (sem política)
// CloudFront: ❌ 403 Access Denied

// Bucket com OAI ESPECÍFICA
s3.putBucketPolicy('bucket', {
  Statement: [{
    Effect: 'Allow',
    Principal: {
      AWS: 'arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity/E123ABC'
    },
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::bucket/*'
  }]
});
// CloudFront (com OAI E123ABC): ✅ 200 OK
// CloudFront (com OAI diferente): ❌ 403 Access Denied
```

### Geo-Restrictions

Bloqueie acesso por país:

```javascript
const distribution = cf.createDistribution({
  // ... config ...
  Restrictions: {
    GeoRestriction: {
      RestrictionType: 'blacklist',  // 'whitelist' ou 'blacklist'
      Quantity: 3,
      Locations: ['CN', 'RU', 'KP']  // ISO 3166-1 alpha-2
    }
  }
});

// Requisição de China: ❌ 403 (bloqueada)
// Requisição de EUA: ✅ 200 (permitida)
```

### Signed URLs

Crie URLs assinadas para conteúdo privado:

```javascript
const generator = new SignedUrlGenerator();

// URL válida por 1 hora
const signedUrl = generator.generateCannedUrl(
  'dxxxxxxxx.cloudfront.net',
  '/private/document.pdf',
  privateKey,
  'APKAEXAMPLE',
  new Date(Date.now() + 3600000)
);

// Enviar para cliente: https://dxxxxxxxx.cloudfront.net/private/document.pdf?...

// Custom policy com restrições IP
const customUrl = generator.generateCustomUrl(
  'dxxxxxxxx.cloudfront.net',
  '/private/*',
  privateKey,
  'APKAEXAMPLE',
  {
    expirationTime: new Date(Date.now() + 3600000),
    ipRange: ['192.0.2.0/24']  // Apenas essa subnet
  }
);
```

### API Endpoints

```bash
# Criar distribuição
POST http://localhost:4566/distribution
Content-Type: application/json

{
  "CallerReference": "my-app-1",
  "Origins": [...],
  "DefaultCacheBehavior": {...},
  "Enabled": true
}

# Listar distribuições
GET http://localhost:4566/distribution

# Obter distribuição
GET http://localhost:4566/distribution/{id}

# Invalidar cache
POST http://localhost:4566/distribution/{id}/invalidation
Content-Type: application/json

{ "paths": ["/images/*", "/index.html"] }

# Gerar Signed URL
POST http://localhost:4566/distribution/{id}/signed-url
Content-Type: application/json

{
  "resourcePath": "/private/file.pdf",
  "privateKey": "-----BEGIN RSA PRIVATE KEY-----...",
  "keyPairId": "APKAEXAMPLE",
  "expirationTime": 3600
}

# Estatísticas
GET http://localhost:4566/distribution/{id}/stats

# Conteúdo
GET http://localhost:4566/{distributionId}/path/to/file
```

### Documentação Detalhada

Para mais informações, consulte:
- `src/services/cloudfront/CLOUDFRONT_GUIDE.md` - Features completas
- `src/services/cloudfront/ORIGIN_ROUTING.md` - Multi-origin routing
- `src/services/cloudfront/S3_BUCKET_POLICY.md` - Validação S3
- `examples/cloudfront-example.js` - 7 exemplos práticos



## 🏢 AWS Organizations + Control Tower + SCP

Implemente governança centralizada com controle de políticas em múltiplas contas e SCPs em tempo real.

### Features

**Organizations:**
- ✅ Criar organização com raiz
- ✅ Criar OUs (Organizational Units) hierárquicas
- ✅ Criar contas dentro de OUs
- ✅ Listar e deletar contas
- ✅ Move contas entre OUs

**Control Tower:**
- ✅ Guardrails obrigatórios e de melhor prática
- ✅ Validação automática de compliance
- ✅ SCPs aplicadas automaticamente
- ✅ Detecção de violações em tempo real

**Service Control Policies (SCP):**
- ✅ **Negação explícita** - Bloqueia ações específicas
- ✅ **Permissão explícita** - Apenas ações listadas
- ✅ **Herança de políticas** - SCPs herdadas de OUs pai
- ✅ **Aplicação em tempo real** - Validação ao processar requisições
- ✅ **Avaliação de políticas** - Verifica s3:GetObject, dynamodb:PutItem, etc

**IAM + SCP Integration:**
- ✅ IAM policies + SCPs = permissões finais
- ✅ SCP bloqueia mesmo com IAM permissão
- ✅ Validação em todos os serviços (S3, SQS, DynamoDB, Lambda, etc)
- ✅ Audit logging de negações (CloudTrail)

### Configuração

```json
{
  "organizations": true,
  "ports": {
    "organizations": 4580
  },
  "organizationsPolicyEnforcement": {
    "enabled": true,
    "enforceSCP": true,
    "enforceIAM": true,
    "auditLogging": true
  }
}
```

### Exemplo: Organização Hierárquica com SCPs

```javascript
const org = organizationsService.getSimulator();
const iam = iamService.getSimulator();

// 1. Criar organização
const organization = org.createOrganization({
  FeatureSet: 'ALL'
});

// 2. Criar OUs
const prodOU = org.createOrganizationalUnit({
  ParentId: organization.RootId,
  Name: 'Production'
});

const devOU = org.createOrganizationalUnit({
  ParentId: organization.RootId,
  Name: 'Development'
});

// 3. Criar contas
const prodAccount = org.createAccount({
  Email: 'prod@company.com',
  AccountName: 'Production'
});

const devAccount = org.createAccount({
  Email: 'dev@company.com',
  AccountName: 'Development'
});

// 4. Mover contas para OUs
org.moveAccount({
  AccountId: prodAccount.Id,
  SourceParentId: organization.RootId,
  DestinationParentId: prodOU.Id
});

org.moveAccount({
  AccountId: devAccount.Id,
  SourceParentId: organization.RootId,
  DestinationParentId: devOU.Id
});

// 5. Criar SCP restritiva para Development
const devSCP = org.putPolicy({
  Content: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Deny',
        Action: [
          's3:DeleteBucket',
          'rds:DeleteDBInstance',
          'dynamodb:DeleteTable'
        ],
        Resource: '*'
      },
      {
        Effect: 'Allow',
        Action: '*',
        Resource: '*'
      }
    ]
  },
  Description: 'Bloqueia exclusão de recursos em Development',
  Name: 'DenyDeleteResources',
  Type: 'SERVICE_CONTROL_POLICY'
});

// 6. Anexar SCP à OU Development
org.attachPolicy({
  PolicyId: devSCP.PolicySummary.Id,
  TargetId: devOU.Id
});

// 7. Testar: Tentar deletar DynamoDB table em Development
const dynamodbSim = dynamodbService.getSimulator();

// Simular requisição da conta Development
const deleteAttempt = dynamodbSim.deleteTable({
  TableName: 'users',
  // CloudTrail headers indicam que é de Development
  'CloudTrail-Account': devAccount.Id
});

console.log(deleteAttempt.error); // "Denied by SCP: DeleteTable not allowed"
console.log(deleteAttempt.status); // 403
```

### Scenario: S3 Access Control com SCP + IAM

```javascript
// 1. Usuário tem IAM permission para s3:GetObject
iam.putUserPolicy({
  UserName: 'developer',
  PolicyName: 'S3ReadAccess',
  PolicyDocument: {
    Statement: [{
      Effect: 'Allow',
      Action: 's3:GetObject',
      Resource: 'arn:aws:s3:::*/*'
    }]
  }
});

// 2. Mas SCP nega acesso a buckets "production-*"
org.putPolicy({
  Content: {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Deny',
      Action: 's3:GetObject',
      Resource: 'arn:aws:s3:::production-*/*'
    }]
  },
  Name: 'DenyProdBuckets',
  Type: 'SERVICE_CONTROL_POLICY'
});

// 3. Tentar acessar arquivo
const s3 = s3Service.getSimulator();

// ✅ Acesso permitido
s3.getObject('dev-bucket', 'file.txt');
// { Body: <buffer>, status: 200 }

// ❌ Acesso negado (SCP bloqueia)
s3.getObject('production-bucket', 'secret.txt');
// { Error: 'Access Denied: Denied by SCP policy', status: 403 }
```

### Scenario: Control Tower Guardrails

```javascript
// Control Tower aplica guardrails automaticamente
const org = organizationsService.getSimulator();

// 1. Criar organização com Control Tower
const organization = org.createOrganization({
  FeatureSet: 'ALL',
  ControlTower: {
    EnableGuardrails: true
  }
});

// 2. Guardrails obrigatórios são aplicados automaticamente
// - Deny CloudTrail disabling
// - Deny GuardDuty disabling
// - Require CloudTrail enabled
// - etc.

// 3. Tentar desabilitar CloudTrail (será bloqueado)
const cloudtrail = cloudtrailService.getSimulator();
cloudtrail.stopLogging({
  TrailName: 'organization-trail'
});
// { Error: 'Denied by Control Tower Guardrail', status: 403 }

// 4. Tentar criar bucket público em conta protegida
// Também será bloqueado por guardrail
```

### SCP Policies - Exemplos

#### 1. Deny Deletion de Recursos Críticos
```javascript
{
  Version: '2012-10-17',
  Statement: [{
    Sid: 'DenyDeletion',
    Effect: 'Deny',
    Action: [
      's3:DeleteBucket',
      'rds:DeleteDBInstance',
      'dynamodb:DeleteTable',
      'lambda:DeleteFunction'
    ],
    Resource: '*'
  }]
}
```

#### 2. Require Encryption
```javascript
{
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'DenyUnencryptedUploads',
      Effect: 'Deny',
      Action: 's3:PutObject',
      Resource: '*',
      Condition: {
        StringNotEquals: {
          's3:x-amz-server-side-encryption': 'AES256'
        }
      }
    }
  ]
}
```

#### 3. Restrict Regions
```javascript
{
  Version: '2012-10-17',
  Statement: [{
    Sid: 'RestrictRegions',
    Effect: 'Deny',
    Action: '*',
    Resource: '*',
    Condition: {
      StringNotEquals: {
        'aws:RequestedRegion': ['us-east-1', 'us-west-2']
      }
    }
  }]
}
```

#### 4. Implicit Deny All (Whitelist Only)
```javascript
{
  Version: '2012-10-17',
  Statement: [{
    Sid: 'AllowOnlyEC2',
    Effect: 'Allow',
    Action: [
      'ec2:*',
      'cloudwatch:*',
      'logs:*'
    ],
    Resource: '*'
  }]
}
```

### API Endpoints

```bash
# Criar organização
POST http://localhost:4580/__admin/organization/create
Content-Type: application/json

{ "FeatureSet": "ALL" }

# Criar OU
POST http://localhost:4580/__admin/organization/create-ou
Content-Type: application/json

{
  "ParentId": "r-xxxx",
  "Name": "Production"
}

# Criar conta
POST http://localhost:4580/__admin/organization/create-account
Content-Type: application/json

{
  "Email": "prod@company.com",
  "AccountName": "Production"
}

# Criar SCP
POST http://localhost:4580/__admin/organization/put-policy
Content-Type: application/json

{
  "Content": { ... policy document ... },
  "Description": "...",
  "Name": "...",
  "Type": "SERVICE_CONTROL_POLICY"
}

# Anexar SCP
POST http://localhost:4580/__admin/organization/attach-policy
Content-Type: application/json

{
  "PolicyId": "p-xxx",
  "TargetId": "ou-xxx"
}

# Listar organização
GET http://localhost:4580/__admin/organization
```

### Validação de SCP em Tempo Real

Quando uma requisição é feita a qualquer serviço (S3, DynamoDB, SQS, Lambda, etc):

1. **Extrair contexto**: Account ID, IAM user, OU
2. **Obter SCPs**: Encontrar SCPs anexadas à conta/OU/raiz
3. **Avaliar políticas**:
   - ❌ Se Deny explícito → Bloquear (403)
   - ✅ Se Allow explícito → Permitir
   - ❌ Se nenhuma permite → Bloquear (implícito Deny)
4. **Retornar resultado** com auditoria

### Documentação Completa

Para mais informações:
- `src/services/organizations/ORGANIZATIONS_GUIDE.md` - Features completas
- `src/middleware/policy-enforcement.md` - Como SCPs são validadas
- `examples/organizations-example.js` - Exemplos de uso


