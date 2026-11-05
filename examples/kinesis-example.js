/**
 * Exemplo completo de uso de Kinesis (Data Streams, Firehose, Analytics)
 * 
 * Demonstra:
 * - Criação de streams
 * - Put records (individual e batch)
 * - Consumo de records
 * - Firehose delivery
 * - Analytics processing
 */

const AWS = require('aws-sdk');

// Configurar AWS SDK para usar simulador local
const awsConfig = {
  region: 'us-east-1',
  accessKeyId: 'test',
  secretAccessKey: 'test'
};

// Clientes Kinesis
const kinesis = new AWS.Kinesis({
  ...awsConfig,
  endpoint: 'http://localhost:4568' // Data Streams
});

const firehose = new AWS.Firehose({
  ...awsConfig,
  endpoint: 'http://localhost:4569' // Firehose
});

const kinesisAnalytics = new AWS.KinesisAnalytics({
  ...awsConfig,
  endpoint: 'http://localhost:4570' // Analytics
});

async function main() {
  try {
    console.log('\n🚀 Iniciando exemplo completo de Kinesis...\n');

    // ==================== KINESIS DATA STREAMS ====================
    console.log('📌 === KINESIS DATA STREAMS ===\n');

    // 1. Criar stream
    console.log('1️⃣  Criando stream "user-events"...');
    const streamName = 'user-events';
    
    try {
      const createStreamResult = await kinesis.createStream({
        StreamName: streamName,
        ShardCount: 1
      }).promise();
      console.log('✅ Stream criado!\n');
    } catch (err) {
      if (err.code === 'ResourceInUseException') {
        console.log('⚠️  Stream já existe, pulando criação\n');
      } else {
        throw err;
      }
    }

    // 2. Descrever stream
    console.log('2️⃣  Descrevendo stream...');
    const describeResult = await kinesis.describeStream({
      StreamName: streamName
    }).promise();
    
    console.log(`   Stream ARN: ${describeResult.StreamDescription.StreamArn}`);
    console.log(`   Status: ${describeResult.StreamDescription.StreamStatus}`);
    console.log(`   Shards: ${describeResult.StreamDescription.Shards.length}`);
    console.log(`   Retention: ${describeResult.StreamDescription.RetentionPeriod} horas\n`);

    // 3. Colocar record individual
    console.log('3️⃣  Colocando record individual no stream...');
    const putRecordResult = await kinesis.putRecord({
      StreamName: streamName,
      Data: JSON.stringify({
        userId: 123,
        action: 'login',
        timestamp: new Date().toISOString()
      }),
      PartitionKey: 'user-123'
    }).promise();
    
    console.log(`   Shard ID: ${putRecordResult.ShardId}`);
    console.log(`   Sequence Number: ${putRecordResult.SequenceNumber}\n`);

    // 4. Colocar múltiplos records
    console.log('4️⃣  Colocando múltiplos records em batch...');
    const events = [
      { userId: 123, action: 'click', page: '/dashboard' },
      { userId: 124, action: 'click', page: '/settings' },
      { userId: 125, action: 'logout', timestamp: new Date().toISOString() },
      { userId: 123, action: 'click', page: '/profile' },
      { userId: 124, action: 'search', query: 'aws kinesis' }
    ];

    const putRecordsResult = await kinesis.putRecords({
      StreamName: streamName,
      Records: events.map(event => ({
        Data: JSON.stringify(event),
        PartitionKey: `user-${event.userId}`
      }))
    }).promise();

    console.log(`   Records colocados: ${putRecordsResult.Records.length}`);
    console.log(`   Falhas: ${putRecordsResult.FailedRecordCount}\n`);

    // 5. Obter shard iterator
    console.log('5️⃣  Obtendo shard iterator para leitura...');
    const shards = describeResult.StreamDescription.Shards;
    const shardId = shards[0].ShardId;

    const iteratorResult = await kinesis.getShardIterator({
      StreamName: streamName,
      ShardId: shardId,
      ShardIteratorType: 'TRIM_HORIZON' // Começa do primeiro record
    }).promise();

    const shardIterator = iteratorResult.ShardIterator;
    console.log(`   Shard Iterator obtido\n`);

    // 6. Ler records
    console.log('6️⃣  Lendo records do stream...');
    const getRecordsResult = await kinesis.getRecords({
      ShardIterator: shardIterator,
      Limit: 10
    }).promise();

    console.log(`   Records lidos: ${getRecordsResult.Records.length}`);
    getRecordsResult.Records.forEach((record, index) => {
      const data = JSON.parse(record.Data);
      console.log(`     ${index + 1}. ${data.action} by user-${data.userId}`);
    });
    console.log('');

    // ==================== KINESIS DATA FIREHOSE ====================
    console.log('📌 === KINESIS DATA FIREHOSE ===\n');

    // 1. Criar delivery stream
    console.log('1️⃣  Criando delivery stream para S3...');
    const deliveryStreamName = 'events-delivery';

    try {
      const createDeliveryStreamResult = await firehose.createDeliveryStream({
        DeliveryStreamName: deliveryStreamName,
        DeliveryStreamType: 'DirectPut',
        S3DestinationConfiguration: {
          RoleARN: 'arn:aws:iam::123456789012:role/firehose-role',
          BucketARN: 'arn:aws:s3:::events-bucket',
          Prefix: 'events/',
          BufferingHints: {
            SizeInMBs: 128,
            IntervalInSeconds: 60
          },
          CompressionFormat: 'GZIP'
        }
      }).promise();

      console.log(`   Delivery Stream ARN: ${createDeliveryStreamResult.DeliveryStreamArn}\n`);
    } catch (err) {
      if (err.code === 'ResourceInUseException') {
        console.log('⚠️  Delivery stream já existe, pulando criação\n');
      } else {
        throw err;
      }
    }

    // 2. Descrever delivery stream
    console.log('2️⃣  Descrevendo delivery stream...');
    const describeDeliveryResult = await firehose.describeDeliveryStream({
      DeliveryStreamName: deliveryStreamName
    }).promise();

    console.log(`   Status: ${describeDeliveryResult.DeliveryStreamDescription.DeliveryStreamStatus}`);
    console.log(`   Type: ${describeDeliveryResult.DeliveryStreamDescription.DeliveryStreamType}`);
    console.log(`   Destinations: ${describeDeliveryResult.DeliveryStreamDescription.Destinations.length}\n`);

    // 3. Colocar record no Firehose
    console.log('3️⃣  Colocando record no Firehose...');
    const firehosePutResult = await firehose.putRecord({
      DeliveryStreamName: deliveryStreamName,
      Record: {
        Data: JSON.stringify({
          userId: 123,
          event: 'purchase',
          amount: 99.99,
          timestamp: new Date().toISOString()
        })
      }
    }).promise();

    console.log(`   Record ID: ${firehosePutResult.RecordId}\n`);

    // 4. Colocar múltiplos records no Firehose
    console.log('4️⃣  Colocando múltiplos records em batch...');
    const firehoseEvents = [
      { userId: 123, event: 'view_product', product: 'laptop' },
      { userId: 124, event: 'add_to_cart', product: 'mouse' },
      { userId: 125, event: 'checkout', total: 149.98 },
      { userId: 123, event: 'payment', status: 'success' }
    ];

    const firehosePutBatchResult = await firehose.putRecordBatch({
      DeliveryStreamName: deliveryStreamName,
      Records: firehoseEvents.map(event => ({
        Data: Buffer.from(JSON.stringify(event))
      }))
    }).promise();

    console.log(`   Records entregues: ${firehosePutBatchResult.Records.length}`);
    console.log(`   Falhas: ${firehosePutBatchResult.FailedPutCount}\n`);

    // ==================== KINESIS DATA ANALYTICS ====================
    console.log('📌 === KINESIS DATA ANALYTICS ===\n');

    // 1. Criar aplicação
    console.log('1️⃣  Criando aplicação de Analytics...');
    const analyticsAppName = 'event-analytics';

    try {
      const createAppResult = await kinesisAnalytics.createApplication({
        ApplicationName: analyticsAppName,
        RuntimeEnvironment: 'SQL_1_0',
        ApplicationDescription: 'Análise de eventos em tempo real'
      }).promise();

      console.log(`   Application ARN: ${createAppResult.ApplicationSummary.ApplicationArn}\n`);
    } catch (err) {
      if (err.code === 'ResourceInUseException') {
        console.log('⚠️  Aplicação já existe, pulando criação\n');
      } else {
        throw err;
      }
    }

    // 2. Descrever aplicação
    console.log('2️⃣  Descrevendo aplicação...');
    const describeAppResult = await kinesisAnalytics.describeApplication({
      ApplicationName: analyticsAppName
    }).promise();

    console.log(`   Status: ${describeAppResult.ApplicationDetail.ApplicationStatus}`);
    console.log(`   Runtime: ${describeAppResult.ApplicationDetail.RuntimeEnvironment}`);
    console.log(`   Version: ${describeAppResult.ApplicationDetail.ApplicationVersionId}\n`);

    // 3. Adicionar input (stream de entrada)
    console.log('3️⃣  Adicionando input stream...');
    try {
      await kinesisAnalytics.addApplicationInput({
        ApplicationName: analyticsAppName,
        CurrentApplicationVersionId: 1,
        Input: {
          NamePrefix: 'SOURCE_SQL_STREAM',
          InputParallelism: { InputParallelismCount: 1 },
          InputSchema: {
            RecordColumns: [
              { Name: 'user_id', SqlType: 'INTEGER' },
              { Name: 'action', SqlType: 'VARCHAR(100)' },
              { Name: 'timestamp', SqlType: 'VARCHAR(50)' }
            ],
            RecordFormat: { RecordFormatType: 'JSON' }
          }
        }
      }).promise();

      console.log('   Input adicionado\n');
    } catch (err) {
      console.log('⚠️  Input já existe ou erro ao adicionar\n');
    }

    // 4. Atualizar código SQL
    console.log('4️⃣  Atualizando código SQL...');
    try {
      await kinesisAnalytics.updateApplicationCode({
        ApplicationName: analyticsAppName,
        CurrentApplicationVersionId: 1,
        ApplicationCode: `
          CREATE OR REPLACE STREAM DESTINATION_SQL_STREAM AS
          SELECT user_id, action, COUNT(*) as event_count
          FROM SOURCE_SQL_STREAM
          GROUP BY user_id, action;
        `
      }).promise();

      console.log('   Código SQL atualizado\n');
    } catch (err) {
      console.log('⚠️  Erro ao atualizar código\n');
    }

    // 5. Iniciar aplicação
    console.log('5️⃣  Iniciando aplicação...');
    try {
      await kinesisAnalytics.startApplication({
        ApplicationName: analyticsAppName,
        RunConfiguration: {
          InputStartingPositionConfiguration: {
            InputStartingPosition: 'NOW'
          }
        }
      }).promise();

      console.log('   Aplicação iniciada\n');
    } catch (err) {
      console.log('⚠️  Erro ao iniciar aplicação\n');
    }

    // 6. Listar aplicações
    console.log('6️⃣  Listando todas as aplicações...');
    const listAppsResult = await kinesisAnalytics.listApplications({
      Limit: 50
    }).promise();

    console.log(`   Total de aplicações: ${listAppsResult.ApplicationSummaries.length}`);
    listAppsResult.ApplicationSummaries.forEach(app => {
      console.log(`     - ${app.ApplicationName} (${app.ApplicationStatus})`);
    });
    console.log('');

    // ==================== RESUMO ====================
    console.log('📊 === RESUMO ===\n');

    // Health checks
    const streamHealth = await fetch('http://localhost:4568/health').then(r => r.json());
    const firehoseHealth = await fetch('http://localhost:4569/health').then(r => r.json());
    const analyticsHealth = await fetch('http://localhost:4570/health').then(r => r.json());

    console.log('Kinesis Data Streams:');
    console.log(`  - Streams: ${streamHealth.stats.streamsCount}`);
    console.log(`  - Total Records: ${streamHealth.stats.totalRecords}`);
    console.log(`  - Total Shards: ${streamHealth.stats.totalShards}\n`);

    console.log('Kinesis Data Firehose:');
    console.log(`  - Delivery Streams: ${firehoseHealth.stats.deliveryStreamsCount}`);
    console.log(`  - Total Records: ${firehoseHealth.stats.totalRecords}`);
    console.log(`  - Delivered: ${firehoseHealth.stats.totalDeliveredRecords}\n`);

    console.log('Kinesis Data Analytics:');
    console.log(`  - Applications: ${analyticsHealth.stats.applicationsCount}`);
    console.log(`  - Total Inputs: ${analyticsHealth.stats.totalInputs}`);
    console.log(`  - Total Outputs: ${analyticsHealth.stats.totalOutputs}\n`);

    console.log('✅ Exemplo completo finalizado com sucesso!\n');

  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Executar
main();
