# Lambda (AWS Lambda)

## Visão Geral

AWS Lambda é um serviço de computação serverless que executa código em resposta a eventos sem necessidade de gerenciar servidores. O simulador local permite desenvolver e testar funções Lambda localmente, com suporte a invocações síncronas, assíncronas e integração com outros serviços AWS locais.

**Principais Features:**
- Criar e gerenciar funções serverless
- Invocar funções de forma síncrona e assíncrona
- Variáveis de ambiente e logs
- Suporte a batchItemFailures para SQS
- Integração com eventos de outros serviços (S3, SQS, EventBridge)
- Suporte a Node.js, Python e outras runtimes

## Porta e Endpoint

**Porta Padrão:** `3001`  
**URL Base:** `http://localhost:3001`  
**Admin API:** `http://localhost:3001/__admin/functions`

## Quick Start

### 1. Configurar Função Lambda

No arquivo `aws-local-simulator.json`:

```json
{
  "lambdas": [
    {
      "name": "my-function",
      "handler": "./src/handlers/index.js",
      "env": {
        "TABLE_NAME": "users-table",
        "QUEUE_URL": "http://localhost:9324/queue/my-queue"
      }
    }
  ]
}
```

### 2. Criar Handler

Arquivo `./src/handlers/index.js`:

```javascript
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event));
  
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello from Lambda!' })
  };
};
```

### 3. Invocar Função

```bash
aws lambda invoke \
  --function-name my-function \
  --payload '{"key":"value"}' \
  --endpoint-url http://localhost:3001 \
  output.json

cat output.json
```

### 4. Listar Funções

```bash
aws lambda list-functions --endpoint-url http://localhost:3001
```

## Operações Básicas

### Descrever Função

```bash
aws lambda get-function \
  --function-name my-function \
  --endpoint-url http://localhost:3001
```

### Deletar Função

```bash
aws lambda delete-function \
  --function-name my-function \
  --endpoint-url http://localhost:3001
```

### Atualizar Código

```bash
aws lambda update-function-code \
  --function-name my-function \
  --zip-file fileb://function.zip \
  --endpoint-url http://localhost:3001
```

### Atualizar Variáveis de Ambiente

```bash
aws lambda update-function-configuration \
  --function-name my-function \
  --environment Variables={TABLE_NAME=new-table} \
  --endpoint-url http://localhost:3001
```

### Invocar com Payload JSON

```bash
aws lambda invoke \
  --function-name my-function \
  --invocation-type RequestResponse \
  --payload '{"userId":"123","action":"login"}' \
  --endpoint-url http://localhost:3001 \
  output.json
```

## Exemplos de Uso

### Exemplo 1: Função Simples que Retorna JSON

```javascript
exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Success',
      timestamp: new Date().toISOString()
    })
  };
};
```

Invocar:
```bash
aws lambda invoke --function-name my-function --endpoint-url http://localhost:3001 output.json
```

### Exemplo 2: Função que Acessa DynamoDB

```javascript
const { DynamoDBClient, GetCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({
  endpoint: 'http://localhost:8000',
  region: 'us-east-1'
});

exports.handler = async (event) => {
  const userId = event.userId;
  
  const command = new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { id: { S: userId } }
  });
  
  const result = await dynamodb.send(command);
  return result.Item;
};
```

### Exemplo 3: Função com SQS Trigger

```javascript
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const sqs = new SQSClient({
  endpoint: 'http://localhost:9324',
  region: 'us-east-1'
});

exports.handler = async (event) => {
  // Processar mensagens do SQS
  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    console.log('Processing:', body);
    
    // Enviar para fila de processamento
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.QUEUE_URL,
      MessageBody: JSON.stringify({ processed: true, data: body })
    }));
  }
  
  return { statusCode: 200, message: 'Processed' };
};
```

### Exemplo 4: Função com Tratamento de Erros

```javascript
exports.handler = async (event) => {
  try {
    const result = await processData(event);
    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function processData(event) {
  // Lógica de processamento
  return { processed: true };
}
```

## Configuração Avançada

### Variables de Ambiente

```json
{
  "lambdas": [
    {
      "name": "my-function",
      "handler": "./src/handlers/index.js",
      "env": {
        "NODE_ENV": "development",
        "LOG_LEVEL": "debug",
        "DATABASE_URL": "http://localhost:8000",
        "API_KEY": "secret-key"
      }
    }
  ]
}
```

### Timeouts

Lambda por padrão tem timeout de 30 segundos (configurável).

### Memory

Configurar memória da função (pode afetar CPU alocado).

## Referências

- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [Lambda Invocation Types](https://docs.aws.amazon.com/lambda/latest/dg/invocation-sync.html)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
