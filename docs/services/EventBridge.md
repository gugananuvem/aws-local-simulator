# EventBridge (Amazon EventBridge)

## Visão Geral

Amazon EventBridge é um barramento de eventos serverless que conecta aplicações usando eventos. O simulador local oferece suporte completo a EventBridge, permitindo criar regras, publicar eventos e integrar com outros serviços AWS.

**Principais Features:**
- Criar e gerenciar event buses
- Criar regras de eventos
- Publicar eventos personalizados
- Padrões de eventos (pattern matching)
- Integração com Lambda, SQS, SNS
- Scheduled rules (cron/rate)
- Dead Letter Queues para falhas

## Porta e Endpoint

**Porta Padrão:** `4010`  
**URL Base:** `http://localhost:4010`  
**Admin API:** Não possui admin API específica

## Quick Start

### 1. Listar Event Buses

```bash
aws events list-event-buses --endpoint-url http://localhost:4010
```

### 2. Criar Rule

```bash
aws events put-rule \
  --name my-rule \
  --event-pattern '{"source":["myapp"],"detail-type":["Order Placed"]}' \
  --state ENABLED \
  --endpoint-url http://localhost:4010
```

### 3. Adicionar Target

```bash
aws events put-targets \
  --rule my-rule \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:123456789012:function:process-order" \
  --endpoint-url http://localhost:4010
```

### 4. Publicar Evento

```bash
aws events put-events \
  --entries '[{
    "Source":"myapp",
    "DetailType":"Order Placed",
    "Detail":"{\"orderId\":\"123\",\"amount\":99.99}"
  }]' \
  --endpoint-url http://localhost:4010
```

### 5. Listar Rules

```bash
aws events list-rules --endpoint-url http://localhost:4010
```

## Operações Básicas

### Descrever Rule

```bash
aws events describe-rule --name my-rule --endpoint-url http://localhost:4010
```

### Listar Targets

```bash
aws events list-targets-by-rule \
  --rule my-rule \
  --endpoint-url http://localhost:4010
```

### Remover Rule

```bash
aws events delete-rule --name my-rule --force --endpoint-url http://localhost:4010
```

### Desabilitar Rule

```bash
aws events disable-rule --name my-rule --endpoint-url http://localhost:4010
```

### Habilitar Rule

```bash
aws events enable-rule --name my-rule --endpoint-url http://localhost:4010
```

## Exemplos de Uso

### Exemplo 1: Event Pattern Matching

```bash
# Regra que captura todos os eventos de Order
aws events put-rule \
  --name order-events-rule \
  --event-pattern '{
    "source":["order-service"],
    "detail-type":["Order Event"],
    "detail":{
      "status":["Placed","Completed"]
    }
  }' \
  --state ENABLED \
  --endpoint-url http://localhost:4010

# Publicar eventos
aws events put-events \
  --entries '[
    {
      "Source":"order-service",
      "DetailType":"Order Event",
      "Detail":"{\"orderId\":\"123\",\"status\":\"Placed\",\"amount\":99.99}"
    },
    {
      "Source":"order-service",
      "DetailType":"Order Event",
      "Detail":"{\"orderId\":\"124\",\"status\":\"Completed\",\"amount\":149.99}"
    }
  ]' \
  --endpoint-url http://localhost:4010
```

### Exemplo 2: Scheduled Rule (Cron)

```bash
# Regra que executa a cada hora
aws events put-rule \
  --name hourly-sync \
  --schedule-expression "rate(1 hour)" \
  --state ENABLED \
  --endpoint-url http://localhost:4010

# Ou usar cron
aws events put-rule \
  --name daily-report \
  --schedule-expression "cron(0 9 ? * MON-FRI *)" \
  --state ENABLED \
  --endpoint-url http://localhost:4010

# Adicionar Lambda como target
aws events put-targets \
  --rule daily-report \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:123456789012:function:generate-report" \
  --endpoint-url http://localhost:4010
```

### Exemplo 3: EventBridge → SQS

```bash
# Criar regra
aws events put-rule \
  --name send-to-queue \
  --event-pattern '{
    "source":["myapp"],
    "detail-type":["Task"]
  }' \
  --state ENABLED \
  --endpoint-url http://localhost:4010

# Adicionar SQS como target
aws events put-targets \
  --rule send-to-queue \
  --targets \
    "Id"="1",\
    "Arn"="arn:aws:sqs:us-east-1:123456789012:task-queue",\
    "RoleArn"="arn:aws:iam::123456789012:role/EventBridgeRole" \
  --endpoint-url http://localhost:4010
```

### Exemplo 4: EventBridge → Lambda

```bash
# Regra para eventos de um tópico específico
aws events put-rule \
  --name user-events-rule \
  --event-pattern '{
    "source":["user-service"],
    "detail-type":["User Action"],
    "detail":{
      "action":["created","updated","deleted"]
    }
  }' \
  --state ENABLED \
  --endpoint-url http://localhost:4010

# Adicionar Lambda como target
aws events put-targets \
  --rule user-events-rule \
  --targets \
    "Id"="1",\
    "Arn"="arn:aws:lambda:us-east-1:123456789012:function:process-user-action",\
    "RoleArn"="arn:aws:iam::123456789012:role/EventBridgeRole" \
  --endpoint-url http://localhost:4010

# Publicar evento
aws events put-events \
  --entries '[{
    "Source":"user-service",
    "DetailType":"User Action",
    "Detail":"{\"userId\":\"123\",\"action\":\"created\",\"name\":\"John Doe\"}"
  }]' \
  --endpoint-url http://localhost:4010
```

### Exemplo 5: Dead Letter Queue para Falhas

```bash
# Criar regra com DLQ
aws events put-targets \
  --rule my-rule \
  --targets \
    "Id"="1",\
    "Arn"="arn:aws:lambda:us-east-1:123456789012:function:process-event",\
    "RoleArn"="arn:aws:iam::123456789012:role/EventBridgeRole",\
    "DeadLetterConfig"="{\"Arn\":\"arn:aws:sqs:us-east-1:123456789012:dlq\"}" \
  --endpoint-url http://localhost:4010
```

### Exemplo 6: Event Transformation

```bash
# Regra com transformação de entrada
aws events put-targets \
  --rule my-rule \
  --targets \
    "Id"="1",\
    "Arn"="arn:aws:sqs:us-east-1:123456789012:my-queue",\
    "RoleArn"="arn:aws:iam::123456789012:role/EventBridgeRole",\
    "InputTransformer"="{
      \"InputPathsMap\":{\"detail\":\"$.detail\"},
      \"InputTemplate\":\"{ \\\"event\\\": <detail> }\"
    }" \
  --endpoint-url http://localhost:4010
```

### Exemplo 7: Event com Node.js

```javascript
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const eventbridge = new EventBridgeClient({
  endpoint: 'http://localhost:4010',
  region: 'us-east-1'
});

async function publishEvent(source, detailType, detail) {
  const command = new PutEventsCommand({
    Entries: [{
      Source: source,
      DetailType: detailType,
      Detail: JSON.stringify(detail)
    }]
  });

  return await eventbridge.send(command);
}

// Usar
await publishEvent(
  'order-service',
  'Order Placed',
  {
    orderId: '12345',
    customerId: 'cust-1',
    amount: 99.99,
    timestamp: new Date().toISOString()
  }
);
```

## Event Pattern

```json
{
  "source": ["order-service"],
  "detail-type": ["Order Placed", "Order Cancelled"],
  "detail": {
    "status": ["completed", "pending"],
    "amount": [{ "numeric": [">", 100] }]
  }
}
```

## Schedule Expressions

### Rate

```
rate(1 hour)
rate(5 minutes)
rate(30 days)
```

### Cron

```
cron(0 12 * * ? *)      # Todos os dias ao meio-dia
cron(0 9 ? * MON-FRI *) # Seg-Sex às 9AM
cron(0/15 * * * ? *)    # A cada 15 minutos
cron(30 2 * * ? *)      # 2:30 AM diariamente
```

## Target Types

| Tipo | Descrição |
|------|-----------|
| Lambda | AWS Lambda functions |
| SQS | SQS queues |
| SNS | SNS topics |
| Kinesis | Kinesis streams |
| EventBridge | Outro event bus |
| HTTP | HTTP endpoints |
| Logs | CloudWatch Logs |

## Referências

- [AWS EventBridge Documentation](https://docs.aws.amazon.com/eventbridge/)
- [EventBridge Rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html)
- [Event Patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
