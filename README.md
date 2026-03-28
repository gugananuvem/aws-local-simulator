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
| ECS/Fargate |  🚧 | 8080 | Orquestração de containers (em desenvolvimento) |
| SNS | 🚧 | 9911 | Notificações (em desenvolvimento) |
| EventBridge | 🚧 | 4010 | Barramento de eventos (em desenvolvimento) |

## 📦 Instalação

```bash
npm install --save-dev aws-local-simulator
🚀 Uso Rápido
1. Crie um arquivo de configuração aws-local-simulator.json:
json
{
  "services": {
    "dynamodb": true,
    "s3": true,
    "sqs": true,
    "lambda": true,
    "cognito": true,
    "apigateway": true
  },
  "lambdas": [
    {
      "path": "/api/users",
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
        "KeySchema": [
          { "AttributeName": "id", "KeyType": "HASH" }
        ],
        "AttributeDefinitions": [
          { "AttributeName": "id", "AttributeType": "S" }
        ]
      }
    ]
  },
  "s3": {
    "buckets": ["my-bucket"]
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

# 2. Inicie o simulador:
## Via CLI
npx aws-local-simulator start

# Ou via código
const { AWSLocalSimulator } = require('aws-local-simulator');
const simulator = new AWSLocalSimulator();
await simulator.start();

# 3. Configure seu código para usar os serviços locais:

```javascript
// Importe a configuração AWS pronta
const { dynamoDB, s3, sqs, cognito, apigateway } = require('aws-local-simulator/aws-config');

// Use como normalmente faria
await dynamoDB.send(new PutCommand({
  TableName: 'users-table',
  Item: { id: '123', name: 'John' }
}));
🔧 Configuração por Variáveis de Ambiente
Variável	Descrição	Padrão
AWS_LOCAL_SIMULATOR_DYNAMODB	Habilita DynamoDB	true
AWS_LOCAL_SIMULATOR_S3	Habilita S3	true
AWS_LOCAL_SIMULATOR_SQS	Habilita SQS	true
AWS_LOCAL_SIMULATOR_LAMBDA	Habilita Lambda	true
AWS_LOCAL_SIMULATOR_COGNITO	Habilita Cognito	false
AWS_LOCAL_SIMULATOR_APIGATEWAY	Habilita API Gateway	false
AWS_LOCAL_SIMULATOR_ECS	Habilita ECS/Fargate	false
AWS_LOCAL_SIMULATOR_DYNAMODB_PORT	Porta DynamoDB	8000
AWS_LOCAL_SIMULATOR_S3_PORT	Porta S3	4566
AWS_LOCAL_SIMULATOR_SQS_PORT	Porta SQS	9324
AWS_LOCAL_SIMULATOR_LAMBDA_PORT	Porta Lambda	3001
AWS_LOCAL_SIMULATOR_COGNITO_PORT	Porta Cognito	9229
AWS_LOCAL_SIMULATOR_APIGATEWAY_PORT	Porta API Gateway	4567
AWS_LOCAL_SIMULATOR_ECS_PORT	Porta ECS	8080
AWS_LOCAL_SIMULATOR_DATA	Diretório de dados	./.aws-local-simulator-data
AWS_LOCAL_SIMULATOR_LOG	Nível de log	info
```

# 📝 Comandos CLI
bash
#### Iniciar simulador
npx aws-local-simulator start [configPath]

#### Parar simulador
npx aws-local-simulator stop

#### Reiniciar
npx aws-local-simulator restart

#### Resetar dados
npx aws-local-simulator reset

#### Status
npx aws-local-simulator status

# 🔌 Endpoints
# Serviço	Endpoint	Admin
DynamoDB	http://localhost:8000	http://localhost:8000/__admin/tables
S3	http://localhost:4566	http://localhost:4566/__admin/buckets
SQS	http://localhost:9324	http://localhost:9324/__admin/queues
Lambda	http://localhost:3001	http://localhost:3001/__admin/lambdas
Cognito	http://localhost:9229	http://localhost:9229/__admin/userpools
API Gateway	http://localhost:4567	http://localhost:4567/__admin/apis
ECS	http://localhost:8080	http://localhost:8080/__admin/clusters
🧪 Testando com AWS CLI
bash
# DynamoDB
aws dynamodb list-tables --endpoint-url http://localhost:8000

# S3
aws s3 ls --endpoint-url http://localhost:4566

# SQS
aws sqs list-queues --endpoint-url http://localhost:9324

# Cognito
aws cognito-idp list-user-pools --max-results 10 --endpoint-url http://localhost:9229

# API Gateway
aws apigateway get-rest-apis --endpoint-url http://localhost:4567
📁 Estrutura de Dados
Os dados são persistidos em:

text
.aws-local-simulator-data/
├── dynamodb/
├── s3/
├── sqs/
├── cognito/
├── apigateway/
└── ecs/
🐛 Debug
Para logs detalhados:

bash
AWS_LOCAL_SIMULATOR_LOG=verboso npx aws-local-simulator start
🤝 Contribuindo
Fork o projeto

Crie sua feature branch (git checkout -b feature/AmazingFeature)

Commit suas mudanças (git commit -m 'Add some AmazingFeature')

Push para a branch (git push origin feature/AmazingFeature)

Abra um Pull Request

📄 Licença
MIT © Luiz Gustavo Ribeiro

⚠️ Limitações
SNS e EventBridge em desenvolvimento

WebSocket APIs em desenvolvimento

Para uso em desenvolvimento e testes apenas
