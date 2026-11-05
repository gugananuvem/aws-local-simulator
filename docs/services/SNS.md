# SNS (Simple Notification Service)

## Visão Geral

Amazon SNS é um serviço de notificações pub/sub totalmente gerenciado. O simulador local oferece suporte completo a SNS, permitindo criar tópicos, publicar mensagens e inscrever aplicações para receber notificações em tempo real.

**Principais Features:**
- Criar e gerenciar tópicos
- Publicar mensagens para tópicos
- Inscrições a tópicos (Email, SQS, Lambda, HTTP)
- Filtros de mensagens
- Message attributes para metadados
- Entrega garantida de mensagens

## Porta e Endpoint

**Porta Padrão:** `9911`  
**URL Base:** `http://localhost:9911`  
**Admin API:** `http://localhost:9911/__admin/health`

## Quick Start

### 1. Criar Tópico

```bash
aws sns create-topic \
  --name my-topic \
  --endpoint-url http://localhost:9911
```

### 2. Publicar Mensagem

```bash
aws sns publish \
  --topic-arn arn:aws:sns:us-east-1:123456789012:my-topic \
  --message "Hello from SNS" \
  --endpoint-url http://localhost:9911
```

### 3. Inscrever-se no Tópico

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:my-topic \
  --protocol sqs \
  --notification-endpoint "arn:aws:sqs:us-east-1:123456789012:my-queue" \
  --endpoint-url http://localhost:9911
```

### 4. Listar Tópicos

```bash
aws sns list-topics --endpoint-url http://localhost:9911
```

### 5. Deletar Tópico

```bash
aws sns delete-topic \
  --topic-arn arn:aws:sns:us-east-1:123456789012:my-topic \
  --endpoint-url http://localhost:9911
```

## Operações Básicas

### Listar Inscrições

```bash
aws sns list-subscriptions --endpoint-url http://localhost:9911
```

### Listar Inscrições por Tópico

```bash
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:123456789012:my-topic \
  --endpoint-url http://localhost:9911
```

### Desinscrever

```bash
aws sns unsubscribe \
  --subscription-arn arn:aws:sns:us-east-1:123456789012:my-topic:12345678-1234-1234-1234-123456789012 \
  --endpoint-url http://localhost:9911
```

### Obter Atributos do Tópico

```bash
aws sns get-topic-attributes \
  --topic-arn arn:aws:sns:us-east-1:123456789012:my-topic \
  --endpoint-url http://localhost:9911
```

### Publicar com Message Attributes

```bash
aws sns publish \
  --topic-arn arn:aws:sns:us-east-1:123456789012:my-topic \
  --message "Notification" \
  --message-attributes '[
    {"Name":"priority","Value":{"DataType":"String","StringValue":"high"}},
    {"Name":"userId","Value":{"DataType":"String","StringValue":"user-123"}}
  ]' \
  --endpoint-url http://localhost:9911
```

## Exemplos de Uso

### Exemplo 1: Pub/Sub Básico com Node.js

```javascript
const { SNSClient, CreateTopicCommand, PublishCommand, SubscribeCommand } = require('@aws-sdk/client-sns');

const sns = new SNSClient({
  endpoint: 'http://localhost:9911',
  region: 'us-east-1'
});

// Criar tópico
async function createTopic(topicName) {
  const command = new CreateTopicCommand({ Name: topicName });
  const response = await sns.send(command);
  return response.TopicArn;
}

// Publicar mensagem
async function publishMessage(topicArn, message) {
  const command = new PublishCommand({
    TopicArn: topicArn,
    Message: JSON.stringify(message),
    Subject: 'New Notification'
  });
  
  return await sns.send(command);
}

// Inscrever ao tópico
async function subscribe(topicArn, protocol, endpoint) {
  const command = new SubscribeCommand({
    TopicArn: topicArn,
    Protocol: protocol,
    Endpoint: endpoint
  });
  
  return await sns.send(command);
}

// Usar
const topicArn = await createTopic('notifications');
await subscribe(topicArn, 'sqs', 'arn:aws:sqs:us-east-1:123456789012:my-queue');
await publishMessage(topicArn, { userId: '123', action: 'login' });
```

### Exemplo 2: SNS → SQS Integração

```bash
# Criar tópico
SNS_TOPIC=$(aws sns create-topic --name events --endpoint-url http://localhost:9911 | grep TopicArn | awk '{print $2}' | tr -d '",')

# Criar fila
SQS_QUEUE_URL=$(aws sqs create-queue --queue-name events-queue --endpoint-url http://localhost:9324 | grep QueueUrl | awk '{print $2}' | tr -d '",')

# Obter ARN da fila
SQS_ARN=$(aws sqs get-queue-attributes --queue-url $SQS_QUEUE_URL --attribute-names QueueArn --endpoint-url http://localhost:9324 | grep QueueArn | awk '{print $2}' | tr -d '",')

# Inscrever fila ao tópico
aws sns subscribe \
  --topic-arn $SNS_TOPIC \
  --protocol sqs \
  --notification-endpoint $SQS_ARN \
  --endpoint-url http://localhost:9911

# Publicar mensagem no tópico
aws sns publish \
  --topic-arn $SNS_TOPIC \
  --message "New event occurred" \
  --endpoint-url http://localhost:9911

# Receber mensagem da fila
aws sqs receive-message --queue-url $SQS_QUEUE_URL --endpoint-url http://localhost:9324
```

### Exemplo 3: Notificações de Eventos

```javascript
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const sns = new SNSClient({
  endpoint: 'http://localhost:9911',
  region: 'us-east-1'
});

async function notifyUserLogin(userId) {
  await sns.send(new PublishCommand({
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:user-events',
    Message: JSON.stringify({
      event: 'user.login',
      userId,
      timestamp: new Date().toISOString()
    }),
    MessageAttributes: {
      eventType: {
        DataType: 'String',
        StringValue: 'user.login'
      },
      priority: {
        DataType: 'String',
        StringValue: 'high'
      }
    }
  }));
}

async function notifyOrderCreated(orderId, amount) {
  await sns.send(new PublishCommand({
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:order-events',
    Message: JSON.stringify({
      event: 'order.created',
      orderId,
      amount,
      timestamp: new Date().toISOString()
    }),
    Subject: `New Order: $${amount}`
  }));
}

// Usar
await notifyUserLogin('user-123');
await notifyOrderCreated('order-456', 99.99);
```

### Exemplo 4: SNS com Lambda

No arquivo `aws-local-simulator.json`:

```json
{
  "lambdas": [
    {
      "name": "process-notification",
      "handler": "./handlers/sns-processor.js"
    }
  ]
}
```

Handler (`./handlers/sns-processor.js`):

```javascript
exports.handler = async (event) => {
  // SNS envia o evento em Records
  for (const record of event.Records) {
    const sns = record.Sns;
    const message = JSON.parse(sns.Message);
    
    console.log('Received notification:', message);
    console.log('Subject:', sns.Subject);
    console.log('Attributes:', sns.MessageAttributes);
    
    // Processar notificação
    await processNotification(message);
  }
  
  return { statusCode: 200, message: 'Processed' };
};

async function processNotification(message) {
  // Sua lógica aqui
}
```

### Exemplo 5: Fan-Out Pattern (SNS + SQS)

```bash
# Criar tópico para eventos
TOPIC=$(aws sns create-topic --name order-events --endpoint-url http://localhost:9911 | grep TopicArn | awk '{print $2}' | tr -d '",')

# Criar múltiplas filas para diferentes serviços
EMAIL_QUEUE=$(aws sqs create-queue --queue-name order-email-queue --endpoint-url http://localhost:9324 | grep QueueUrl | awk '{print $2}' | tr -d '",')
INVENTORY_QUEUE=$(aws sqs create-queue --queue-name order-inventory-queue --endpoint-url http://localhost:9324 | grep QueueUrl | awk '{print $2}' | tr -d '",')
ANALYTICS_QUEUE=$(aws sqs create-queue --queue-name order-analytics-queue --endpoint-url http://localhost:9324 | grep QueueUrl | awk '{print $2}' | tr -d '",')

# Inscrever todas as filas ao tópico
EMAIL_ARN=$(aws sqs get-queue-attributes --queue-url $EMAIL_QUEUE --attribute-names QueueArn --endpoint-url http://localhost:9324 | grep QueueArn | awk '{print $2}' | tr -d '",')
aws sns subscribe --topic-arn $TOPIC --protocol sqs --notification-endpoint $EMAIL_ARN --endpoint-url http://localhost:9911

INVENTORY_ARN=$(aws sqs get-queue-attributes --queue-url $INVENTORY_QUEUE --attribute-names QueueArn --endpoint-url http://localhost:9324 | grep QueueArn | awk '{print $2}' | tr -d '",')
aws sns subscribe --topic-arn $TOPIC --protocol sqs --notification-endpoint $INVENTORY_ARN --endpoint-url http://localhost:9911

ANALYTICS_ARN=$(aws sqs get-queue-attributes --queue-url $ANALYTICS_QUEUE --attribute-names QueueArn --endpoint-url http://localhost:9324 | grep QueueArn | awk '{print $2}' | tr -d '",')
aws sns subscribe --topic-arn $TOPIC --protocol sqs --notification-endpoint $ANALYTICS_ARN --endpoint-url http://localhost:9911

# Publicar um evento
aws sns publish \
  --topic-arn $TOPIC \
  --message '{"orderId":"12345","amount":99.99,"customerId":"cust-1"}' \
  --endpoint-url http://localhost:9911

# Todos os three workers recebem a mensagem
# Worker de email processa
aws sqs receive-message --queue-url $EMAIL_QUEUE --endpoint-url http://localhost:9324

# Worker de inventory processa
aws sqs receive-message --queue-url $INVENTORY_QUEUE --endpoint-url http://localhost:9324

# Worker de analytics processa
aws sqs receive-message --queue-url $ANALYTICS_QUEUE --endpoint-url http://localhost:9324
```

## Protocolos de Subscrição

| Protocolo | Uso | Exemplo |
|-----------|-----|---------|
| sqs | AWS SQS Queue | `arn:aws:sqs:us-east-1:123456789012:queue-name` |
| lambda | AWS Lambda | `arn:aws:lambda:us-east-1:123456789012:function:function-name` |
| http | HTTP Endpoint | `http://example.com/endpoint` |
| https | HTTPS Endpoint | `https://example.com/endpoint` |
| email | Email | `user@example.com` |
| sms | SMS (simulado) | `+55 11 99999-9999` |

## Referências

- [AWS SNS Documentation](https://docs.aws.amazon.com/sns/)
- [SNS Message Filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
