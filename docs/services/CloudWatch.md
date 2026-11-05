# CloudWatch (Amazon CloudWatch)

## Visão Geral

Amazon CloudWatch é um serviço de monitoramento e observabilidade que fornece logs, métricas e alarmes para aplicações e infraestrutura. O simulador local oferece suporte a CloudWatch, permitindo capturar logs, registrar métricas e criar alarmes.

**Principais Features:**
- Criar e gerenciar log groups e streams
- Publicar métricas customizadas
- Criar alarmes baseados em métricas
- Listar e consultar logs
- Filtros de logs
- Integração com aplicações locais

## Porta e Endpoint

**Porta Padrão:** `4011`  
**URL Base:** `http://localhost:4011`  
**Admin API:** Não possui admin API específica

## Quick Start

### 1. Criar Log Group

```bash
aws logs create-log-group \
  --log-group-name /aws/lambda/my-function \
  --endpoint-url http://localhost:4011
```

### 2. Criar Log Stream

```bash
aws logs create-log-stream \
  --log-group-name /aws/lambda/my-function \
  --log-stream-name 2024-01-01-[execution-id] \
  --endpoint-url http://localhost:4011
```

### 3. Publicar Logs

```bash
aws logs put-log-events \
  --log-group-name /aws/lambda/my-function \
  --log-stream-name 2024-01-01-[execution-id] \
  --log-events '[{"timestamp":'$(date +%s000)',"message":"Application started"}]' \
  --endpoint-url http://localhost:4011
```

### 4. Listar Log Groups

```bash
aws logs describe-log-groups --endpoint-url http://localhost:4011
```

### 5. Listar Log Streams

```bash
aws logs describe-log-streams \
  --log-group-name /aws/lambda/my-function \
  --endpoint-url http://localhost:4011
```

## Operações Básicas

### Listar Logs

```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/my-function \
  --endpoint-url http://localhost:4011
```

### Filtrar por Padrão

```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/my-function \
  --filter-pattern "ERROR" \
  --endpoint-url http://localhost:4011
```

### Deletar Log Group

```bash
aws logs delete-log-group \
  --log-group-name /aws/lambda/my-function \
  --endpoint-url http://localhost:4011
```

### Deletar Log Stream

```bash
aws logs delete-log-stream \
  --log-group-name /aws/lambda/my-function \
  --log-stream-name 2024-01-01-[execution-id] \
  --endpoint-url http://localhost:4011
```

### Publicar Métrica

```bash
aws cloudwatch put-metric-data \
  --namespace MyApp \
  --metric-name RequestCount \
  --value 1 \
  --unit Count \
  --endpoint-url http://localhost:4011
```

## Exemplos de Uso

### Exemplo 1: Lambda com CloudWatch Logs

```javascript
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event));
  
  try {
    // Sua lógica aqui
    console.log('✅ Processing completed');
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Success' })
    };
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
```

Logs aparecem automaticamente em CloudWatch:
```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/my-function \
  --filter-pattern "Error" \
  --endpoint-url http://localhost:4011
```

### Exemplo 2: Métricas Customizadas com Node.js

```javascript
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

const cloudwatch = new CloudWatchClient({
  endpoint: 'http://localhost:4011',
  region: 'us-east-1'
});

async function recordMetric(metricName, value, unit = 'Count') {
  const command = new PutMetricDataCommand({
    Namespace: 'MyApplication',
    MetricData: [{
      MetricName: metricName,
      Value: value,
      Unit: unit,
      Timestamp: new Date()
    }]
  });

  return await cloudwatch.send(command);
}

// Usar
await recordMetric('RequestCount', 1, 'Count');
await recordMetric('ResponseTime', 125, 'Milliseconds');
await recordMetric('ErrorRate', 2.5, 'Percent');
```

### Exemplo 3: Application Logging com Estrutura

```javascript
const { CloudWatchClient, PutLogEventsCommand } = require('@aws-sdk/client-logs');

const logs = new CloudWatchClient({
  endpoint: 'http://localhost:4011',
  region: 'us-east-1'
});

class Logger {
  constructor(logGroupName, logStreamName) {
    this.logGroupName = logGroupName;
    this.logStreamName = logStreamName;
  }

  async log(level, message, data = {}) {
    const logEvent = {
      timestamp: Date.now(),
      message: JSON.stringify({
        level,
        message,
        data,
        timestamp: new Date().toISOString()
      })
    };

    const command = new PutLogEventsCommand({
      logGroupName: this.logGroupName,
      logStreamName: this.logStreamName,
      logEvents: [logEvent]
    });

    await logs.send(command);
  }

  async info(message, data) {
    await this.log('INFO', message, data);
  }

  async error(message, data) {
    await this.log('ERROR', message, data);
  }

  async warning(message, data) {
    await this.log('WARNING', message, data);
  }
}

// Usar
const logger = new Logger('/myapp/logs', '2024-01-01');
await logger.info('User logged in', { userId: '123' });
await logger.error('Database connection failed', { error: 'ECONNREFUSED' });
```

### Exemplo 4: Alarmes com Métricas

```bash
# Publicar métricas
for i in {1..10}; do
  aws cloudwatch put-metric-data \
    --namespace MyApp \
    --metric-name CPUUtilization \
    --value $((RANDOM % 100)) \
    --unit Percent \
    --endpoint-url http://localhost:4011
done

# Criar alarme
aws cloudwatch put-metric-alarm \
  --alarm-name high-cpu \
  --alarm-description "Alert on high CPU" \
  --metric-name CPUUtilization \
  --namespace MyApp \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "arn:aws:sns:us-east-1:123456789012:notifications" \
  --endpoint-url http://localhost:4011
```

### Exemplo 5: Filter Log Patterns

```bash
# Padrão simples
aws logs filter-log-events \
  --log-group-name /aws/lambda/my-function \
  --filter-pattern "ERROR" \
  --endpoint-url http://localhost:4011

# Padrão com espaço
aws logs filter-log-events \
  --log-group-name /aws/lambda/my-function \
  --filter-pattern "[ERROR]" \
  --endpoint-url http://localhost:4011

# Padrão JSON
aws logs filter-log-events \
  --log-group-name /aws/lambda/my-function \
  --filter-pattern '{ $.level = "ERROR" }' \
  --endpoint-url http://localhost:4011

# Múltiplos padrões
aws logs filter-log-events \
  --log-group-name /aws/lambda/my-function \
  --filter-pattern '[ERROR, WARN]' \
  --endpoint-url http://localhost:4011
```

### Exemplo 6: Insights Query

```bash
# Simular query com grep
aws logs filter-log-events \
  --log-group-name /aws/lambda/my-function \
  --filter-pattern "{ $.statusCode = 500 }" \
  --start-time $(($(date +%s) - 3600 * 1000)) \
  --end-time $(date +%s000) \
  --endpoint-url http://localhost:4011
```

### Exemplo 7: Log Retention

```bash
# Configurar retenção de 7 dias
aws logs put-retention-policy \
  --log-group-name /aws/lambda/my-function \
  --retention-in-days 7 \
  --endpoint-url http://localhost:4011

# Remover política de retenção
aws logs delete-retention-policy \
  --log-group-name /aws/lambda/my-function \
  --endpoint-url http://localhost:4011
```

## Namespaces Comuns

| Namespace | Serviço |
|-----------|---------|
| AWS/Lambda | Lambda functions |
| AWS/DynamoDB | DynamoDB tables |
| AWS/SQS | SQS queues |
| AWS/S3 | S3 buckets |
| AWS/ApiGateway | API Gateway |
| AWS/RDS | RDS databases |
| MyApplication | Métricas customizadas |

## Estatísticas Disponíveis

| Estatística | Descrição |
|-------------|-----------|
| Average | Média dos valores |
| Sum | Soma dos valores |
| Minimum | Valor mínimo |
| Maximum | Valor máximo |
| SampleCount | Contagem de amostras |

## Unidades

| Unidade | Descrição |
|---------|-----------|
| Seconds | Segundos |
| Milliseconds | Milissegundos |
| Count | Contagem |
| Percent | Percentual |
| Bytes | Bytes |
| Kilobytes | Kilobytes |

## Referências

- [AWS CloudWatch Documentation](https://docs.aws.amazon.com/cloudwatch/)
- [CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/)
- [CloudWatch Metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/working_with_metrics.html)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
