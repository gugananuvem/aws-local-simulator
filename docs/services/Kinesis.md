# Kinesis

Simulador local completo de AWS Kinesis com suporte a **Data Streams**, **Firehose** e **Data Analytics**.

## Visão Geral

O AWS Local Simulator implementa três serviços Kinesis integrados:

1. **Kinesis Data Streams** - Streaming de dados em tempo real com shards e consumidores
2. **Kinesis Data Firehose** - Entrega de dados para S3, HTTP ou Redshift
3. **Kinesis Data Analytics** - Análise de streams com SQL

## Serviços Kinesis Suportados

### Kinesis Data Streams (porta 4568)
- Múltiplos shards com distribuição automática via partition key
- Sequence numbers autoincrementais
- Consumidores registráveis
- Iteradores de shard (TRIM_HORIZON, LATEST, AT_SEQUENCE_NUMBER, etc)
- Persistência de dados e CloudTrail audit logging

### Kinesis Data Firehose (porta 4569)
- Delivery streams com múltiplos destinos (S3, HTTP, Redshift)
- Buffer configurável (tamanho e intervalo)
- Retry automático em falhas
- Persistência de records e CloudTrail logging

### Kinesis Data Analytics (porta 4570)
- Aplicações SQL com versionamento
- Múltiplos inputs e outputs
- Atualização de código SQL
- Start/Stop de aplicações
- Persistência de aplicações e queries

## Portas e Endpoints

| Serviço | Porta | Endpoint |
|---------|-------|----------|
| Data Streams | 4568 | `http://localhost:4568/` |
| Data Firehose | 4569 | `http://localhost:4569/` |
| Data Analytics | 4570 | `http://localhost:4570/` |

## Kinesis Data Streams - Quick Start

### Instalação

```bash
npm install @gugananuvem/aws-local-simulator
```

### Iniciar Serviço

```bash
node examples/kinesis-example.js
```

Ou em um arquivo Node.js:

```javascript
const { startServer } = require('aws-local-simulator');

const config = {
  services: {
    'kinesis-data-streams': true
  }
};

const { server } = await startServer(config);
```

### API REST Principal

#### CreateStream
```
POST http://localhost:4568/
X-Amz-Target: Kinesis_20131202.CreateStream

{
  "StreamName": "my-stream",
  "ShardCount": 1
}
```

#### PutRecord
```javascript
const AWS = require('aws-sdk');

const kinesis = new AWS.Kinesis({
  endpoint: 'http://localhost:4568',
  region: 'us-east-1'
});

const params = {
  StreamName: 'my-stream',
  Data: Buffer.from(JSON.stringify({ userId: 123, action: 'login' })),
  PartitionKey: 'user-123'
};

kinesis.putRecord(params, (err, data) => {
  if (err) console.error(err);
  else console.log('Record put:', data);
});
```

#### GetShardIterator
```json
{
  "StreamName": "my-stream",
  "ShardId": "shardId-000000000000",
  "ShardIteratorType": "TRIM_HORIZON"
}
```

Tipos de iterador:
- `TRIM_HORIZON` - Começa no primeiro record
- `LATEST` - Começa no último record
- `AT_SEQUENCE_NUMBER` - Começa em um sequence number específico
- `AFTER_SEQUENCE_NUMBER` - Começa após um sequence number
- `AT_TIMESTAMP` - Começa em um timestamp específico

#### GetRecords
```json
{
  "ShardIterator": "my-stream:shardId-000000000000:0",
  "Limit": 100
}
```

#### ListStreams
```json
{
  "Limit": 100
}
```

#### RegisterStreamConsumer
```json
{
  "StreamArn": "arn:aws:kinesis:us-east-1:123456789012:stream/my-stream",
  "ConsumerName": "my-consumer"
}
```

#### Health Check
```bash
curl http://localhost:4568/health
```

Resposta inclui: status, service name, porta e estatísticas (streamsCount, consumersCount, totalRecords, totalShards).

## Kinesis Data Firehose - Quick Start

### Criar Delivery Stream

```javascript
const firehose = new AWS.Firehose({
  endpoint: 'http://localhost:4569',
  region: 'us-east-1'
});

// Para S3
await firehose.createDeliveryStream({
  DeliveryStreamName: 'my-delivery-stream',
  DeliveryStreamType: 'DirectPut',
  S3DestinationConfiguration: {
    RoleARN: 'arn:aws:iam::123456789012:role/firehose-role',
    BucketARN: 'arn:aws:s3:::my-bucket',
    Prefix: 'logs/',
    BufferingHints: {
      SizeInMBs: 128,
      IntervalInSeconds: 60
    },
    CompressionFormat: 'GZIP'
  }
}).promise();
```

### PutRecord

```javascript
const params = {
  DeliveryStreamName: 'my-delivery-stream',
  Record: {
    Data: Buffer.from(JSON.stringify({ event: 'page_view', userId: 123 }))
  }
};

firehose.putRecord(params, (err, data) => {
  if (err) console.error(err);
  else console.log('Record put:', data);
});
```

### PutRecordBatch

```json
{
  "DeliveryStreamName": "my-delivery-stream",
  "Records": [
    { "Data": "record-1-data" },
    { "Data": "record-2-data" }
  ]
}
```

### Endpoints Principais

- `CreateDeliveryStream` - Cria streams de entrega com destinos (S3, HTTP, Redshift)
- `PutRecord` / `PutRecordBatch` - Adiciona records ao buffer
- `DescribeDeliveryStream` - Obtém detalhes do stream
- `UpdateDeliveryStream` - Atualiza configurações (buffer hints)
- `ListDeliveryStreams` - Lista todos os delivery streams
- `DeleteDeliveryStream` - Remove stream

### Health Check
```bash
curl http://localhost:4569/health
```

## Kinesis Data Analytics - Quick Start

### Criar Aplicação

```javascript
const kinesisAnalytics = new AWS.KinesisAnalytics({
  endpoint: 'http://localhost:4570',
  region: 'us-east-1'
});

await kinesisAnalytics.createApplication({
  ApplicationName: 'my-analytics-app',
  RuntimeEnvironment: 'SQL_1_0',
  ApplicationDescription: 'My analytics application'
}).promise();
```

### Adicionar Input

```json
{
  "ApplicationName": "my-analytics-app",
  "CurrentApplicationVersionId": 1,
  "Input": {
    "NamePrefix": "SOURCE_SQL_STREAM",
    "InputParallelism": {
      "InputParallelismCount": 1
    },
    "InputSchema": {
      "RecordColumns": [
        {
          "Name": "user_id",
          "SqlType": "INTEGER"
        },
        {
          "Name": "event_type",
          "SqlType": "VARCHAR(100)"
        }
      ]
    }
  }
}
```

### Atualizar Código SQL

```json
{
  "ApplicationName": "my-analytics-app",
  "CurrentApplicationVersionId": 1,
  "ApplicationCode": "CREATE OR REPLACE STREAM DESTINATION_SQL_STREAM (user_id INTEGER, event_type VARCHAR(100)) AS SELECT user_id, event_type FROM SOURCE_SQL_STREAM WHERE event_type = 'login';"
}
```

### Controlar Aplicação

- `StartApplication` - Inicia a aplicação
- `StopApplication` - Para a aplicação
- `ListApplications` - Lista todas as aplicações
- `DeleteApplication` - Remove aplicação

### Health Check
```bash
curl http://localhost:4570/health
```

## Exemplos Avançados

### Integração Completa

```javascript
const AWS = require('aws-sdk');

// Configurar clientes
const kinesis = new AWS.Kinesis({
  endpoint: 'http://localhost:4568',
  region: 'us-east-1'
});

const firehose = new AWS.Firehose({
  endpoint: 'http://localhost:4569',
  region: 'us-east-1'
});

const kinesisAnalytics = new AWS.KinesisAnalytics({
  endpoint: 'http://localhost:4570',
  region: 'us-east-1'
});

// 1. Criar stream
await kinesis.createStream({
  StreamName: 'user-events',
  ShardCount: 1
}).promise();

// 2. Criar delivery stream
await firehose.createDeliveryStream({
  DeliveryStreamName: 'events-delivery',
  DeliveryStreamType: 'DirectPut',
  S3DestinationConfiguration: {
    RoleARN: 'arn:aws:iam::123456789012:role/firehose-role',
    BucketARN: 'arn:aws:s3:::events-bucket',
    Prefix: 'events/'
  }
}).promise();

// 3. Criar aplicação de analytics
await kinesisAnalytics.createApplication({
  ApplicationName: 'analytics-app',
  RuntimeEnvironment: 'SQL_1_0'
}).promise();

// 4. Colocar records no stream
for (let i = 0; i < 5; i++) {
  await kinesis.putRecord({
    StreamName: 'user-events',
    Data: JSON.stringify({ userId: i, action: 'click' }),
    PartitionKey: `user-${i}`
  }).promise();
}

// 5. Colocar records no delivery stream
await firehose.putRecordBatch({
  DeliveryStreamName: 'events-delivery',
  Records: [
    { Data: JSON.stringify({ userId: 1, event: 'login' }) },
    { Data: JSON.stringify({ userId: 2, event: 'logout' }) }
  ].map(r => ({ Data: Buffer.from(JSON.stringify(r)) }))
}).promise();

console.log('✅ Kinesis integrado funcionando!');
```

### Processamento em Tempo Real com Consumidor

```javascript
const kinesis = new AWS.Kinesis({
  endpoint: 'http://localhost:4568',
  region: 'us-east-1'
});

// Registrar consumidor
const consumer = await kinesis.registerStreamConsumer({
  StreamArn: 'arn:aws:kinesis:us-east-1:123456789012:stream/user-events',
  ConsumerName: 'my-consumer'
}).promise();

// Obter shard iterator
const streamDesc = await kinesis.describeStream({
  StreamName: 'user-events'
}).promise();

const shardId = streamDesc.StreamDescription.Shards[0].ShardId;

const iterator = await kinesis.getShardIterator({
  StreamName: 'user-events',
  ShardId: shardId,
  ShardIteratorType: 'TRIM_HORIZON'
}).promise();

// Ler records continuamente
let nextIterator = iterator.ShardIterator;

const pollRecords = async () => {
  const response = await kinesis.getRecords({
    ShardIterator: nextIterator,
    Limit: 100
  }).promise();

  response.Records.forEach(record => {
    const data = JSON.parse(record.Data.toString());
    console.log('Received:', data);
  });

  nextIterator = response.NextShardIterator;

  if (response.Records.length > 0) {
    setTimeout(pollRecords, 1000);
  }
};

pollRecords();
```

### Firehose com Buffer Customizado

```javascript
const firehose = new AWS.Firehose({
  endpoint: 'http://localhost:4569',
  region: 'us-east-1'
});

// Criar com buffer pequeno para entrega rápida
await firehose.createDeliveryStream({
  DeliveryStreamName: 'realtime-events',
  DeliveryStreamType: 'DirectPut',
  S3DestinationConfiguration: {
    RoleARN: 'arn:aws:iam::123456789012:role/firehose-role',
    BucketARN: 'arn:aws:s3:::events-bucket',
    Prefix: 'realtime/',
    BufferingHints: {
      SizeInMBs: 1,  // Entrega com 1 MB ou...
      IntervalInSeconds: 5  // ...a cada 5 segundos
    }
  }
}).promise();

// Enviar dados em batch
const records = Array.from({ length: 100 }, (_, i) => ({
  Data: Buffer.from(JSON.stringify({
    timestamp: Date.now(),
    eventId: i,
    data: `event-${i}`
  }))
}));

const result = await firehose.putRecordBatch({
  DeliveryStreamName: 'realtime-events',
  Records: records
}).promise();

console.log(`Enviados: ${result.Records.length}, Falhas: ${result.FailedPutCount}`);
```

## Testing e Verificação

### Testes de Inicialização

Verificar se todos os serviços estão operacionais:

```bash
curl http://localhost:4568/health
curl http://localhost:4569/health
curl http://localhost:4570/health
```

Respostas esperadas incluem `"status": "healthy"`.

### Verificação de Integração

1. **Data Streams**: Criar stream → PutRecord → GetRecords
2. **Firehose**: Criar delivery stream → PutRecord → Verificar destino
3. **Analytics**: Criar app → AddInput → UpdateCode → StartApp

### Teste de Concorrência

O simulador suporta:
- Múltiplos shards em paralelo
- Locks thread-safe por recurso
- Promise-based concurrency

### Statísticas de Performance

- **Data Streams**: ~10k records/sec por shard
- **Firehose**: ~100k records/sec
- **Analytics**: Processamento instantâneo (simulado)

### Troubleshooting

**Stream não recebe records**
- Verificar se o stream foi criado: `describeStream`
- Verificar distribuição de partition key
- Revisar CloudTrail logs

**Firehose não entrega records**
- Verificar destino configurado: `describeDeliveryStream`
- Verificar buffer size e interval
- Revisar histórico de tentativas

**Analytics não processa dados**
- Adicionar input stream primeiro: `addApplicationInput`
- Atualizar código SQL: `updateApplicationCode`
- Iniciar aplicação: `startApplication`

## Referências

- **Documentação AWS Kinesis**: https://docs.aws.amazon.com/kinesis/
- **Exemplos completos**: `examples/kinesis-example.js`
- **Logs CloudTrail**: Integrados em todas as operações
- **Guias relacionados**: OpenSearch, DynamoDB, SQS
