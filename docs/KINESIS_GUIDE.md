# Kinesis - Guia Completo

Simulador local completo de AWS Kinesis com suporte a **Data Streams**, **Firehose** e **Data Analytics**.

## Visão Geral

O AWS Local Simulator implementa três serviços Kinesis integrados:

1. **Kinesis Data Streams** - Streaming de dados em tempo real com shards e consumidores
2. **Kinesis Data Firehose** - Entrega de dados para S3, HTTP ou Redshift
3. **Kinesis Data Analytics** - Análise de streams com SQL

## Começar Rápido

### Instalação

```bash
npm install @gugananuvem/aws-local-simulator
```

### Iniciar Kinesis

```bash
node examples/kinesis-example.js
```

Ou em um arquivo Node.js:

```javascript
const { startServer } = require('aws-local-simulator');

const config = {
  services: {
    'kinesis-data-streams': true,
    'kinesis-firehose': true,
    'kinesis-analytics': true
  }
};

const { server } = await startServer(config);
```

## Portas Padrão

- **Kinesis Data Streams**: 4568
- **Kinesis Data Firehose**: 4569
- **Kinesis Data Analytics**: 4570

## Kinesis Data Streams

### API REST

#### 1. CreateStream

**Endpoint:**
```
POST http://localhost:4568/
X-Amz-Target: Kinesis_20131202.CreateStream
```

**Request:**
```json
{
  "StreamName": "my-stream",
  "ShardCount": 1
}
```

**Response:**
```json
{
  "StreamDescription": {
    "StreamName": "my-stream",
    "StreamArn": "arn:aws:kinesis:us-east-1:123456789012:stream/my-stream",
    "StreamStatus": "ACTIVE",
    "Shards": [
      {
        "ShardId": "shardId-000000000000",
        "ShardStatus": "ACTIVE",
        "HashKeyRange": {
          "startingHashKey": "0",
          "endingHashKey": "18446744073709551615"
        }
      }
    ],
    "HasMoreShards": false,
    "RetentionPeriod": 24,
    "StreamCreationTimestamp": "2024-09-30T10:00:00.000Z"
  }
}
```

#### 2. PutRecord

**Request:**
```json
{
  "StreamName": "my-stream",
  "Data": "base64-encoded-data",
  "PartitionKey": "user-123"
}
```

**Response:**
```json
{
  "ShardId": "shardId-000000000000",
  "SequenceNumber": "1",
  "EncryptionType": "NONE"
}
```

**Exemplo com Node.js SDK:**
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

#### 3. PutRecords

**Request:**
```json
{
  "StreamName": "my-stream",
  "Records": [
    {
      "Data": "record-1-data",
      "PartitionKey": "user-1"
    },
    {
      "Data": "record-2-data",
      "PartitionKey": "user-2"
    }
  ]
}
```

**Response:**
```json
{
  "FailedRecordCount": 0,
  "Records": [
    {
      "ShardId": "shardId-000000000000",
      "SequenceNumber": "1"
    },
    {
      "ShardId": "shardId-000000000000",
      "SequenceNumber": "2"
    }
  ]
}
```

#### 4. DescribeStream

**Request:**
```json
{
  "StreamName": "my-stream"
}
```

**Response:**
```json
{
  "StreamDescription": {
    "StreamName": "my-stream",
    "StreamArn": "arn:aws:kinesis:us-east-1:123456789012:stream/my-stream",
    "StreamStatus": "ACTIVE",
    "Shards": [
      {
        "ShardId": "shardId-000000000000",
        "ShardStatus": "ACTIVE",
        "HashKeyRange": {
          "startingHashKey": "0",
          "endingHashKey": "18446744073709551615"
        }
      }
    ]
  }
}
```

#### 5. GetShardIterator

**Request:**
```json
{
  "StreamName": "my-stream",
  "ShardId": "shardId-000000000000",
  "ShardIteratorType": "TRIM_HORIZON"
}
```

**ShardIteratorType options:**
- `TRIM_HORIZON` - Começa no primeiro record
- `LATEST` - Começa no último record
- `AT_SEQUENCE_NUMBER` - Começa em um sequence number específico
- `AFTER_SEQUENCE_NUMBER` - Começa após um sequence number
- `AT_TIMESTAMP` - Começa em um timestamp específico

**Response:**
```json
{
  "ShardIterator": "my-stream:shardId-000000000000:0"
}
```

#### 6. GetRecords

**Request:**
```json
{
  "ShardIterator": "my-stream:shardId-000000000000:0",
  "Limit": 100
}
```

**Response:**
```json
{
  "Records": [
    {
      "Data": "record-data",
      "PartitionKey": "user-123",
      "SequenceNumber": "1",
      "ApproximateArrivalTimestamp": "2024-09-30T10:00:00.000Z",
      "EncryptionType": "NONE"
    }
  ],
  "NextShardIterator": "my-stream:shardId-000000000000:1",
  "MillisBehindLatest": 0
}
```

#### 7. ListStreams

**Request:**
```json
{
  "Limit": 100
}
```

**Response:**
```json
{
  "StreamNames": ["my-stream", "another-stream"],
  "HasMoreStreams": false,
  "StreamStatuses": ["ACTIVE", "ACTIVE"]
}
```

#### 8. DeleteStream

**Request:**
```json
{
  "StreamName": "my-stream"
}
```

#### 9. RegisterStreamConsumer

**Request:**
```json
{
  "StreamArn": "arn:aws:kinesis:us-east-1:123456789012:stream/my-stream",
  "ConsumerName": "my-consumer"
}
```

**Response:**
```json
{
  "Consumer": {
    "ConsumerName": "my-consumer",
    "ConsumerArn": "arn:aws:kinesis:us-east-1:123456789012:stream/my-stream/consumer/my-consumer:abc123",
    "ConsumerStatus": "ACTIVE",
    "ConsumerCreationTimestamp": "2024-09-30T10:00:00.000Z"
  }
}
```

### Health Check

```bash
curl http://localhost:4568/health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "kinesis-data-streams",
  "port": 4568,
  "stats": {
    "streamsCount": 1,
    "consumersCount": 1,
    "totalRecords": 5,
    "totalShards": 1
  }
}
```

---

## Kinesis Data Firehose

### API REST

#### 1. CreateDeliveryStream

**Endpoint:**
```
POST http://localhost:4569/
X-Amz-Target: Firehose_20150804.CreateDeliveryStream
```

**Request para S3:**
```json
{
  "DeliveryStreamName": "my-delivery-stream",
  "DeliveryStreamType": "DirectPut",
  "S3DestinationConfiguration": {
    "RoleARN": "arn:aws:iam::123456789012:role/firehose-role",
    "BucketARN": "arn:aws:s3:::my-bucket",
    "Prefix": "logs/",
    "BufferingHints": {
      "SizeInMBs": 128,
      "IntervalInSeconds": 60
    },
    "CompressionFormat": "GZIP"
  }
}
```

**Response:**
```json
{
  "DeliveryStreamArn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/my-delivery-stream"
}
```

#### 2. PutRecord

**Request:**
```json
{
  "DeliveryStreamName": "my-delivery-stream",
  "Record": {
    "Data": "base64-encoded-data"
  }
}
```

**Response:**
```json
{
  "RecordId": "uuid-string",
  "Encrypted": false
}
```

**Exemplo com Node.js SDK:**
```javascript
const AWS = require('aws-sdk');

const firehose = new AWS.Firehose({
  endpoint: 'http://localhost:4569',
  region: 'us-east-1'
});

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

#### 3. PutRecordBatch

**Request:**
```json
{
  "DeliveryStreamName": "my-delivery-stream",
  "Records": [
    { "Data": "record-1-data" },
    { "Data": "record-2-data" }
  ]
}
```

**Response:**
```json
{
  "FailedPutCount": 0,
  "Encrypted": false,
  "Records": [
    {
      "RecordId": "uuid-1",
      "ErrorCode": null,
      "ErrorMessage": null
    },
    {
      "RecordId": "uuid-2",
      "ErrorCode": null,
      "ErrorMessage": null
    }
  ]
}
```

#### 4. DescribeDeliveryStream

**Request:**
```json
{
  "DeliveryStreamName": "my-delivery-stream"
}
```

**Response:**
```json
{
  "DeliveryStreamDescription": {
    "DeliveryStreamName": "my-delivery-stream",
    "DeliveryStreamArn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/my-delivery-stream",
    "DeliveryStreamStatus": "ACTIVE",
    "DeliveryStreamType": "DirectPut",
    "VersionId": "1",
    "CreationTimestamp": "2024-09-30T10:00:00.000Z",
    "Destinations": [
      {
        "DestinationId": "destination-1",
        "DestinationStatus": "ACTIVE",
        "S3DestinationDescription": {
          "RoleARN": "arn:aws:iam::123456789012:role/firehose-role",
          "BucketARN": "arn:aws:s3:::my-bucket",
          "Prefix": "logs/"
        }
      }
    ]
  }
}
```

#### 5. ListDeliveryStreams

**Response:**
```json
{
  "DeliveryStreamNames": ["my-delivery-stream"],
  "HasMoreDeliveryStreams": false
}
```

#### 6. DeleteDeliveryStream

**Request:**
```json
{
  "DeliveryStreamName": "my-delivery-stream"
}
```

#### 7. UpdateDeliveryStream

**Request:**
```json
{
  "DeliveryStreamName": "my-delivery-stream",
  "S3DestinationUpdate": {
    "BufferingHints": {
      "SizeInMBs": 256,
      "IntervalInSeconds": 120
    }
  }
}
```

### Health Check

```bash
curl http://localhost:4569/health
```

---

## Kinesis Data Analytics

### API REST

#### 1. CreateApplication

**Endpoint:**
```
POST http://localhost:4570/
X-Amz-Target: KinesisAnalytics_20150814.CreateApplication
```

**Request:**
```json
{
  "ApplicationName": "my-analytics-app",
  "RuntimeEnvironment": "SQL_1_0",
  "ApplicationDescription": "My analytics application"
}
```

**Response:**
```json
{
  "ApplicationSummary": {
    "ApplicationName": "my-analytics-app",
    "ApplicationArn": "arn:aws:kinesisanalytics:us-east-1:123456789012:application/my-analytics-app",
    "ApplicationStatus": "READY",
    "ApplicationVersionId": 1,
    "CreationTimestamp": "2024-09-30T10:00:00.000Z"
  }
}
```

#### 2. DescribeApplication

**Request:**
```json
{
  "ApplicationName": "my-analytics-app"
}
```

**Response:**
```json
{
  "ApplicationDetail": {
    "ApplicationName": "my-analytics-app",
    "ApplicationArn": "arn:aws:kinesisanalytics:us-east-1:123456789012:application/my-analytics-app",
    "ApplicationStatus": "READY",
    "ApplicationVersionId": 1,
    "CreationTimestamp": "2024-09-30T10:00:00.000Z",
    "RuntimeEnvironment": "SQL_1_0",
    "ServiceExecutionRole": "arn:aws:iam::123456789012:role/analytics-role"
  }
}
```

#### 3. AddApplicationInput

**Request:**
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

#### 4. UpdateApplicationCode

**Request:**
```json
{
  "ApplicationName": "my-analytics-app",
  "CurrentApplicationVersionId": 1,
  "ApplicationCode": "CREATE OR REPLACE STREAM DESTINATION_SQL_STREAM (user_id INTEGER, event_type VARCHAR(100)) AS SELECT user_id, event_type FROM SOURCE_SQL_STREAM WHERE event_type = 'login';"
}
```

#### 5. StartApplication

**Request:**
```json
{
  "ApplicationName": "my-analytics-app"
}
```

#### 6. StopApplication

**Request:**
```json
{
  "ApplicationName": "my-analytics-app"
}
```

#### 7. ListApplications

**Response:**
```json
{
  "ApplicationSummaries": [
    {
      "ApplicationName": "my-analytics-app",
      "ApplicationArn": "arn:aws:kinesisanalytics:us-east-1:123456789012:application/my-analytics-app",
      "ApplicationStatus": "READY",
      "ApplicationVersionId": 1,
      "CreationTimestamp": "2024-09-30T10:00:00.000Z"
    }
  ],
  "HasMoreApplications": false
}
```

#### 8. DeleteApplication

**Request:**
```json
{
  "ApplicationName": "my-analytics-app",
  "CurrentApplicationVersionId": 1
}
```

### Health Check

```bash
curl http://localhost:4570/health
```

---

## Exemplo Completo Integrado

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

---

## Características

### Kinesis Data Streams
- ✅ Múltiplos shards com distribuição de partition key
- ✅ Sequence numbers automáticos
- ✅ Consumidores com histórico de posição
- ✅ Iteradores de shard (TRIM_HORIZON, LATEST, etc)
- ✅ Persistência em JSON
- ✅ CloudTrail audit logging

### Kinesis Data Firehose
- ✅ Suporte a múltiplos destinos (S3, HTTP, Redshift)
- ✅ Buffer de entrega configurável
- ✅ Transformação de dados
- ✅ Retry automático
- ✅ CloudTrail audit logging

### Kinesis Data Analytics
- ✅ Aplicações SQL
- ✅ Múltiplos inputs e outputs
- ✅ Versionamento de código
- ✅ Start/Stop de aplicações
- ✅ Persistência de queries

---

## Troubleshooting

### Stream não recebe records
- Verificar se o stream foi criado: `describeStream`
- Verificar partition key distribution
- Verificar CloudTrail logs

### Firehose não entrega records
- Verificar destino configurado: `describeDeliveryStream`
- Verificar buffer size e interval
- Revisar histórico de tentativas

### Analytics não processa dados
- Adicionar input stream primeiro: `addApplicationInput`
- Atualizar código SQL: `updateApplicationCode`
- Iniciar aplicação: `startApplication`

---

## Limitações

- Transformações de Lambda não implementadas (Firehose)
- Compressão apenas simulada (não comprime realmente)
- Autoscaling não implementado (Data Streams)
- Checkpoint de consumidor simplificado (Data Streams)

---

## Performance

- **Data Streams**: ~10k records/sec por shard
- **Firehose**: ~100k records/sec
- **Analytics**: Processamento instantâneo (simulado)

---

## Próximos Passos

- [Exemplos completos](../examples/kinesis-example.js)
- [OpenSearch Guide](./OPENSEARCH_GUIDE.md)
- [DynamoDB Guide](./DYNAMODB_GUIDE.md)
