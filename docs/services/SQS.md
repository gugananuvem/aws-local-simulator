# SQS (Simple Queue Service)

## Visão Geral

Amazon SQS é um serviço de filas de mensagens que desacopla componentes de aplicações distribuídas. O simulador local oferece suporte completo a SQS, incluindo filas padrão, Dead Letter Queues (DLQ), triggers Lambda e RedrivePolicy para tratamento de falhas.

**Principais Features:**
- Criar e gerenciar filas de mensagens
- Enviar e receber mensagens
- Dead Letter Queues (DLQ) com RedrivePolicy
- Triggers automáticos com Lambda
- Visibilidade de mensagens (Visibility Timeout)
- Delay em mensagens
- Atributos personalizados

## Porta e Endpoint

**Porta Padrão:** `9324`  
**URL Base:** `http://localhost:9324`  
**Admin API:** `http://localhost:9324/__admin/queues`

## Quick Start

### 1. Criar Fila

```bash
aws sqs create-queue \
  --queue-name my-queue \
  --endpoint-url http://localhost:9324
```

### 2. Enviar Mensagem

```bash
aws sqs send-message \
  --queue-url http://localhost:9324/queue/my-queue \
  --message-body "Hello World" \
  --endpoint-url http://localhost:9324
```

### 3. Receber Mensagens

```bash
aws sqs receive-message \
  --queue-url http://localhost:9324/queue/my-queue \
  --max-number-of-messages 10 \
  --endpoint-url http://localhost:9324
```

### 4. Deletar Mensagem

```bash
aws sqs delete-message \
  --queue-url http://localhost:9324/queue/my-queue \
  --receipt-handle "xxxxx" \
  --endpoint-url http://localhost:9324
```

### 5. Deletar Fila

```bash
aws sqs delete-queue \
  --queue-url http://localhost:9324/queue/my-queue \
  --endpoint-url http://localhost:9324
```

## Operações Básicas

### Listar Filas

```bash
aws sqs list-queues --endpoint-url http://localhost:9324
```

### Obter URL da Fila

```bash
aws sqs get-queue-url \
  --queue-name my-queue \
  --endpoint-url http://localhost:9324
```

### Obter Atributos da Fila

```bash
aws sqs get-queue-attributes \
  --queue-url http://localhost:9324/queue/my-queue \
  --attribute-names All \
  --endpoint-url http://localhost:9324
```

### Definir Atributos da Fila

```bash
aws sqs set-queue-attributes \
  --queue-url http://localhost:9324/queue/my-queue \
  --attributes VisibilityTimeout=60,MessageRetentionPeriod=86400 \
  --endpoint-url http://localhost:9324
```

### Enviar Mensagem com Delay

```bash
aws sqs send-message \
  --queue-url http://localhost:9324/queue/my-queue \
  --message-body "Delayed message" \
  --delay-seconds 300 \
  --endpoint-url http://localhost:9324
```

### Enviar Batch de Mensagens

```bash
aws sqs send-message-batch \
  --queue-url http://localhost:9324/queue/my-queue \
  --entries '[
    {"Id":"1","MessageBody":"Message 1"},
    {"Id":"2","MessageBody":"Message 2"},
    {"Id":"3","MessageBody":"Message 3"}
  ]' \
  --endpoint-url http://localhost:9324
```

## Exemplos de Uso

### Exemplo 1: Fila Simples com Node.js

```javascript
const { SQSClient, SendMessageCommand, ReceiveMessageCommand } = require('@aws-sdk/client-sqs');

const sqs = new SQSClient({
  endpoint: 'http://localhost:9324',
  region: 'us-east-1'
});

// Enviar mensagem
async function sendMessage(queueUrl, message) {
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message)
  });
  
  return await sqs.send(command);
}

// Receber mensagens
async function receiveMessages(queueUrl) {
  const command = new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20
  });
  
  return await sqs.send(command);
}

// Usar
const queueUrl = 'http://localhost:9324/queue/my-queue';
await sendMessage(queueUrl, { userId: '123', action: 'login' });
const messages = await receiveMessages(queueUrl);
console.log(messages.Messages);
```

### Exemplo 2: Dead Letter Queue (DLQ) com RedrivePolicy

```bash
# Criar fila principal
aws sqs create-queue --queue-name my-queue --endpoint-url http://localhost:9324

# Criar Dead Letter Queue
aws sqs create-queue --queue-name my-queue-dlq --endpoint-url http://localhost:9324

# Obter ARNs das filas
QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url http://localhost:9324/queue/my-queue --attribute-names QueueArn --endpoint-url http://localhost:9324 | grep QueueArn | awk '{print $2}' | tr -d '",')

DLQ_ARN=$(aws sqs get-queue-attributes --queue-url http://localhost:9324/queue/my-queue-dlq --attribute-names QueueArn --endpoint-url http://localhost:9324 | grep QueueArn | awk '{print $2}' | tr -d '",')

# Configurar RedrivePolicy (após 3 falhas, move para DLQ)
aws sqs set-queue-attributes \
  --queue-url http://localhost:9324/queue/my-queue \
  --attributes RedrivePolicy="{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":3}" \
  --endpoint-url http://localhost:9324
```

### Exemplo 3: Worker que Processa Fila

```javascript
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');

const sqs = new SQSClient({
  endpoint: 'http://localhost:9324',
  region: 'us-east-1'
});

const QUEUE_URL = 'http://localhost:9324/queue/my-queue';

async function processQueue() {
  while (true) {
    try {
      const response = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20
      }));

      if (!response.Messages) {
        console.log('No messages...');
        continue;
      }

      for (const message of response.Messages) {
        try {
          const body = JSON.parse(message.Body);
          console.log('Processing:', body);

          // Processar mensagem
          await processMessage(body);

          // Deletar mensagem após sucesso
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle
          }));

          console.log('✅ Message processed');
        } catch (error) {
          console.error('❌ Error processing message:', error);
          // Mensagem voltará à fila após VisibilityTimeout
        }
      }
    } catch (error) {
      console.error('Error receiving messages:', error);
      await new Promise(r => setTimeout(r, 5000)); // Aguardar 5s antes de retry
    }
  }
}

async function processMessage(message) {
  // Lógica de processamento
  console.log('Message data:', message);
}

processQueue();
```

### Exemplo 4: Lambda Trigger com SQS

No arquivo `aws-local-simulator.json`:

```json
{
  "lambdas": [
    {
      "name": "process-queue",
      "handler": "./handlers/sqs-processor.js",
      "env": {
        "QUEUE_URL": "http://localhost:9324/queue/my-queue"
      }
    }
  ],
  "sqs": {
    "queues": ["my-queue"],
    "triggers": [
      {
        "queue": "my-queue",
        "lambda": "process-queue",
        "batchSize": 10
      }
    ]
  }
}
```

Handler (`./handlers/sqs-processor.js`):

```javascript
exports.handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      console.log('Processing:', message);

      // Processar mensagem
      await processMessage(message);
    } catch (error) {
      console.error('Error:', error);
      // Adicionar à lista de falhas para retry
      batchItemFailures.push({
        itemId: record.messageId
      });
    }
  }

  return { batchItemFailures };
};

async function processMessage(message) {
  // Sua lógica aqui
}
```

### Exemplo 5: Envio de Email com SQS

```bash
# Criar fila de emails
aws sqs create-queue --queue-name email-queue --endpoint-url http://localhost:9324

# Enviar email para fila
aws sqs send-message \
  --queue-url http://localhost:9324/queue/email-queue \
  --message-body '{
    "to": "user@example.com",
    "subject": "Welcome",
    "body": "Welcome to our service!"
  }' \
  --endpoint-url http://localhost:9324

# Receber e processar
aws sqs receive-message \
  --queue-url http://localhost:9324/queue/email-queue \
  --endpoint-url http://localhost:9324
```

## Atributos de Fila

| Atributo | Descrição | Padrão |
|----------|-----------|--------|
| VisibilityTimeout | Tempo de invisibilidade (segundos) | 30 |
| MessageRetentionPeriod | Retenção de mensagem (segundos) | 345600 (4 dias) |
| DelaySeconds | Delay padrão de mensagens | 0 |
| MaximumMessageSize | Tamanho máximo em bytes | 262144 (256 KB) |
| ReceiveMessageWaitTimeSeconds | Long polling timeout | 0 |

## Referências

- [AWS SQS Documentation](https://docs.aws.amazon.com/sqs/)
- [SQS Message Attributes](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-attributes.html)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
