# AWS Local Simulator - Configuração de Portas

> Guia completo sobre as portas utilizadas por cada serviço AWS no simulador local

## 📋 Tabela de Portas

| Serviço | Porta | Protocolo | URL | Descrição |
|---------|-------|-----------|-----|-----------|
| DynamoDB | 8000 | HTTP | http://localhost:8000 | Banco de dados NoSQL |
| S3 | 4566 | HTTP | http://localhost:4566 | Armazenamento de objetos, Website estático |
| Lambda | 3001 | HTTP | http://localhost:3001 | Invocação e gerenciamento de funções serverless |
| Cognito | 9229 | HTTP | http://localhost:9229 | Autenticação e autorização |
| STS | 9326 | HTTP | http://localhost:9326 | Credenciais temporárias e AssumeRole |
| SQS | 9324 | HTTP | http://localhost:9324 | Filas de mensagens |
| SNS | 9911 | HTTP | http://localhost:9911 | Notificações pub/sub |
| KMS | 4000 | HTTP | http://localhost:4000 | Gerenciamento de chaves |
| Secrets Manager | 4001 | HTTP | http://localhost:4001 | Gerenciamento de segredos |
| Parameter Store | 4002 | HTTP | http://localhost:4002 | Armazenamento de parâmetros |
| IAM | 4003 | HTTP | http://localhost:4003 | Identity and Access Management |
| EventBridge | 4010 | HTTP | http://localhost:4010 | Barramento de eventos |
| EC2 | 4020 | HTTP | http://localhost:4020 | Instâncias, AMIs, Security Groups, VPC, Subnets, Route Tables |
| ALB | 4021 | HTTP | http://localhost:4021 | Application Load Balancer |
| ASG | 4022 | HTTP | http://localhost:4022 | Auto Scaling Groups |
| CloudWatch | 4011 | HTTP | http://localhost:4011 | Logs, métricas e alarmes |
| CloudTrail | 4012 | HTTP | http://localhost:4012 | Auditoria de API calls |
| AWS Config | 4013 | HTTP | http://localhost:4013 | Conformidade e configuração |
| Athena | 4599 | HTTP | http://localhost:4599 | Consultas SQL em dados no S3 |
| X-Ray | 4015 | HTTP | http://localhost:4015 | Rastreamento distribuído |
| **CloudFormation** | **4582** | **HTTP** | **http://localhost:4582** | **Infraestrutura como código** |
| **Organizations** | **4581** | **HTTP** | **http://localhost:4581** | **OUs, Accounts, SCPs, Control Tower** |
| OpenSearch | 9200 | HTTP | http://localhost:9200 | Índices, Documentos, Busca Full-text |
| Kinesis Data Streams | 4568 | HTTP | http://localhost:4568 | Shards, Records, Consumers |
| Kinesis Firehose | 4569 | HTTP | http://localhost:4569 | Delivery Streams, Buffering |
| Kinesis Analytics | 4570 | HTTP | http://localhost:4570 | SQL Applications, Real-time Analytics |
| API Gateway | 4567 | HTTP | http://localhost:4567 | APIs REST e HTTP |
| Management API | 9999 | HTTP | http://localhost:9999 | Admin endpoints para gerenciamento |

---

## 🔧 Configurando Portas Customizadas

Você pode sobrescrever as portas padrão no arquivo `aws-local-simulator.json`:

```json
{
  "ports": {
    "dynamodb": 8000,
    "s3": 4566,
    "lambda": 3001,
    "cognito": 9229,
    "sts": 9326,
    "sqs": 9324,
    "sns": 9911,
    "kms": 4000,
    "secretManager": 4001,
    "parameterStore": 4002,
    "iam": 4003,
    "eventbridge": 4010,
    "cloudwatch": 4011,
    "cloudtrail": 4012,
    "config": 4013,
    "xray": 4015,
    "ec2": 4020,
    "alb": 4021,
    "asg": 4022,
    "opensearch": 9200,
    "kinesis-data-streams": 4568,
    "kinesis-firehose": 4569,
    "kinesis-analytics": 4570,
    "apigateway": 4567,
    "cloudformation": 4582,
    "organizations": 4581
  }
}
```

### Exemplo: Alterar Porta do S3

```json
{
  "ports": {
    "s3": 5000
  }
}
```

Agora S3 estará disponível em `http://localhost:5000`

---

## 🚀 Iniciando todos os serviços

```bash
# Iniciar o simulador com todas as portas padrão
npm start

# Ou especificamente:
node index.js
```

Você verá output como:

```
ℹ️ 🗄️  DynamoDB rodando em http://localhost:8000
ℹ️ 🗄️  S3 rodando em http://localhost:4566
ℹ️ 🚀 Lambda API rodando em http://localhost:3001
ℹ️ 🔐 Cognito rodando em http://localhost:9229
...
ℹ️ Ô£à Organizations Server iniciado na porta 4581
ℹ️ Ô£à CloudFormation Server iniciado na porta 4582
```

---

## 📌 Portas Reservadas do Sistema

> ⚠️ **Importante:** Se você receber erro `EADDRINUSE: address already in use`, significa que outra aplicação está usando a porta.

### Verificar quais processos estão usando as portas

#### No Windows (PowerShell):

```powershell
# Verificar porta específica
netstat -ano | findstr :4566

# Matar processo usando a porta (exemplo: porta 4566, PID 1234)
taskkill /PID 1234 /F
```

#### No Linux/macOS:

```bash
# Verificar porta específica
lsof -i :4566

# Matar processo
kill -9 <PID>
```

---

## 🔌 Conectando aos Serviços

### Com AWS CLI

```bash
# S3
aws s3 ls --endpoint-url http://localhost:4566

# DynamoDB
aws dynamodb list-tables --endpoint-url http://localhost:8000

# SQS
aws sqs list-queues --endpoint-url http://localhost:9324
```

### Com AWS SDK (Node.js)

```javascript
const AWS = require('aws-sdk');

// S3
const s3 = new AWS.S3({
  endpoint: 'http://localhost:4566',
  s3ForcePathStyle: true,
  accessKeyId: 'testing',
  secretAccessKey: 'testing'
});

// DynamoDB
const dynamodb = new AWS.DynamoDB({
  endpoint: 'http://localhost:8000',
  region: 'us-east-1',
  accessKeyId: 'testing',
  secretAccessKey: 'testing'
});

// Lambda
const lambda = new AWS.Lambda({
  endpoint: 'http://localhost:3001',
  region: 'us-east-1',
  accessKeyId: 'testing',
  secretAccessKey: 'testing'
});
```

### Com SDK v3 (@aws-sdk)

```javascript
const { S3Client, ListBucketsCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
  endpoint: "http://localhost:4566",
  region: "us-east-1",
  credentials: {
    accessKeyId: "testing",
    secretAccessKey: "testing"
  }
});

const command = new ListBucketsCommand({});
const response = await s3Client.send(command);
```

---

## 🏗️ Architetura de Portas

```
┌─────────────────────────────────────────────────────────┐
│          AWS LOCAL SIMULATOR - PORTAS                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  STORAGE & COMPUTE                                      │
│  ├─ DynamoDB ............... 8000                       │
│  ├─ S3 (+ Presigned URLs) .. 4566                       │
│  ├─ Lambda ................. 3001                       │
│  └─ EC2(+VPC)/ALB/ASG ...... 4020-4022                  │
│                                                         │
│  IDENTITY & AUTH                                        │
│  ├─ Cognito ................ 9229                       │
│  ├─ IAM .................... 4003                       │
│  ├─ STS .................... 9326                       │
│  └─ API Gateway ............ 4567                       │
│                                                         │
│  MESSAGING & EVENTS                                     │
│  ├─ SQS .................... 9324                       │
│  ├─ SNS .................... 9911                       │
│  ├─ EventBridge ............ 4010                       │
│  └─ Kinesis ................ 4568-4570                  │
│                                                         │
│  SECURITY & CONFIG                                      │
│  ├─ KMS .................... 4000                       │
│  ├─ Secrets Manager ........ 4001                       │
│  ├─ Parameter Store ........ 4002                       │
│  ├─ AWS Config ............. 4013                       │
│  └─ CloudTrail ............. 4012                       │
│                                                         │
│  INFRASTRUCTURE & MANAGEMENT                            │
│  ├─ CloudFormation ......... 4582 ← NOVO              │
│  ├─ Organizations .......... 4581 ← NOVO              │
│  ├─ CloudWatch ............. 4011                       │
│  ├─ OpenSearch ............. 9200                       │
│  ├─ X-Ray .................. 4015                       │
│  ├─ Athena ................. 4599                       │
│  └─ Management API ......... 9999                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 Estatísticas de Portas

| Faixa | Uso | Quantidade |
|-------|-----|-----------|
| 3000-3999 | Lambda | 1 |
| 4000-4999 | Serviços diversos | 22 |
| 8000-8999 | DynamoDB | 1 |
| 9000-9999 | Cognito, STS, SNS | 4 |

**Total de portas ativas:** 28+

---

## ⚠️ Resolução de Problemas

### Erro: `EADDRINUSE: address already in use :::4581`

**Solução:** Uma aplicação já está usando a porta 4581.

```powershell
# Windows - Encontrar e matar o processo
netstat -ano | findstr :4581
taskkill /PID <PID> /F

# Linux/macOS
lsof -i :4581
kill -9 <PID>
```

### Erro: `Connection refused` ao conectar em um serviço

**Verificar:**
1. Serviço está habilitado no `aws-local-simulator.json`
2. A porta está correta
3. O simulador foi iniciado: `npm start`
4. Não há firewall bloqueando a porta

### Porta padrão já está em uso

**Solução:** Configure uma porta diferente no arquivo de configuração:

```json
{
  "ports": {
    "s3": 5000,
    "dynamodb": 8001
  }
}
```

---

## 🔐 Usando Portas Seguras (HTTPS)

Por padrão, o simulador usa HTTP. Para ativar HTTPS:

```json
{
  "https": true,
  "ssl": {
    "cert": "/path/to/cert.pem",
    "key": "/path/to/key.pem"
  }
}
```

Depois acesse via:
```bash
https://localhost:4566
```

---

## 📚 Referências

- [AWS Local Simulator Repository](https://github.com/gugananuvem/aws-local-simulator)
- [AWS Documentation](https://docs.aws.amazon.com/)
- [LocalStack Documentation](https://docs.localstack.cloud/)
