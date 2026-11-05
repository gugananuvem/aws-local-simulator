/**
 * Exemplo de uso de Dead Letter Queue (DLQ) com o simulador SQS
 * 
 * Este exemplo demonstra como usar RedrivePolicy, maxReceiveCount,
 * ApproximateReceiveCount e o processamento automático de mensagens.
 */

const SQSSimulator = require('../src/services/sqs/simulator');

const config = {
  ports: { sqs: 9324 },
  sqs: { queues: [] }
};

async function main() {
  const simulator = new SQSSimulator(config, null);
  await simulator.initialize();

  console.log('\n📦 === SQS Dead Letter Queue Example ===\n');

  // Step 1: Create DLQ
  console.log('1️⃣  Criando Dead Letter Queue (DLQ)...');
  simulator.createQueue('order-processing-dlq');
  console.log('   ✅ DLQ criada: order-processing-dlq\n');

  // Step 2: Create main queue with DLQ configuration
  console.log('2️⃣  Criando fila principal com RedrivePolicy...');
  const redrivePolicy = {
    deadLetterTargetArn: 'arn:aws:sqs:local:000000000000:order-processing-dlq',
    maxReceiveCount: 3  // Move para DLQ após 3 tentativas
  };

  simulator.createQueue('order-processing', {
    RedrivePolicy: JSON.stringify(redrivePolicy),
    VisibilityTimeout: 5,  // 5 segundos de visibility timeout
    BatchSize: 10
  });
  console.log('   ✅ Fila criada: order-processing');
  console.log('   ✅ RedrivePolicy: maxReceiveCount=3, DLQ=order-processing-dlq\n');

  // Step 3: Send messages
  console.log('3️⃣  Enviando 5 mensagens...');
  const messageIds = [];
  for (let i = 1; i <= 5; i++) {
    const { messageId } = simulator.sendMessage({
      QueueUrl: 'http://localhost:9324/queue/order-processing',
      MessageBody: JSON.stringify({
        orderId: `ORD-${i}`,
        amount: 100 * i,
        timestamp: new Date().toISOString()
      })
    });
    messageIds.push(messageId);
    console.log(`   📨 Mensagem ${i} enviada: ${messageId.substring(0, 8)}...`);
  }
  console.log();

  // Step 4: Mock Lambda handler that fails some messages
  console.log('4️⃣  Configurando handler Lambda que falhará em algumas mensagens...');
  const queue = simulator.queues.get('order-processing');
  
  let processingAttempt = 0;
  queue.handler = async (event) => {
    processingAttempt++;
    console.log(`\n   🔄 Tentativa de processamento #${processingAttempt}`);
    console.log(`   Recebidas ${event.Records.length} mensagens\n`);

    const batchItemFailures = [];

    for (const record of event.Records) {
      const order = JSON.parse(record.body);
      const receiveCount = parseInt(record.attributes.ApproximateReceiveCount);
      
      console.log(`   📋 Processando ${order.orderId} (receiveCount: ${receiveCount})`);

      // Simular falha para ordens 2 e 4
      if (order.orderId === 'ORD-2' || order.orderId === 'ORD-4') {
        console.log(`      ❌ FALHA: Erro ao processar ${order.orderId}`);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      } else {
        console.log(`      ✅ Sucesso: ${order.orderId} processada`);
      }
    }

    if (batchItemFailures.length > 0) {
      console.log(`\n   ⚠️  ${batchItemFailures.length} mensagens retornarão à fila\n`);
    }

    return { batchItemFailures };
  };

  // Step 5: Process messages
  console.log('5️⃣  Processando mensagens...\n');
  await simulator.processQueueMessages(queue);

  // Step 6: Check queue state after first attempt
  console.log('\n6️⃣  Estado das filas após primeira tentativa:\n');
  console.log(`   📊 Main Queue:');
  let mainQueue = simulator.getQueue('order-processing');
  console.log(`      Total de mensagens: ${queue.messages.length}`);
  
  // Count by receive count
  const receiveCounts = {};
  for (const msg of queue.messages) {
    const count = msg.Attributes.ApproximateReceiveCount;
    receiveCounts[count] = (receiveCounts[count] || 0) + 1;
  }
  for (const [count, quantity] of Object.entries(receiveCounts)) {
    console.log(`      Com receiveCount=${count}: ${quantity} mensagens`);
  }

  console.log(`\n   📊 DLQ:');
  const dlq = simulator.getQueue('order-processing-dlq');
  console.log(`      Mensagens: ${dlq.messages ? dlq.messages.length : 0}`);
  console.log();

  // Step 7: Process again with visibility timeout expired
  console.log('7️⃣  Simulando expiração de visibility timeout...\n');
  
  // Make all messages visible again
  for (const msg of queue.messages) {
    msg.invisibleUntil = 0;
  }

  console.log('   ⏱️  Visibility timeout expirado - recebendo novamente...\n');
  await simulator.processQueueMessages(queue);

  // Step 8: Process one more time
  console.log('\n8️⃣  Terceira tentativa...\n');
  
  // Make all messages visible again
  for (const msg of queue.messages) {
    msg.invisibleUntil = 0;
  }

  await simulator.processQueueMessages(queue);

  // Step 9: Final state
  console.log('\n9️⃣  Estado FINAL das filas:\n');
  console.log(`   📊 Main Queue (order-processing):'');
  mainQueue = simulator.getQueue('order-processing');
  console.log(`      Mensagens restantes: ${queue.messages.length}`);
  if (queue.messages.length > 0) {
    console.log(`      Mensagens:`);
    for (const msg of queue.messages) {
      const order = JSON.parse(msg.Body);
      console.log(`        - ${order.orderId}: receiveCount=${msg.Attributes.ApproximateReceiveCount}`);
    }
  }

  console.log(`\n   📊 DLQ (order-processing-dlq):'');
  const dlqQueue = simulator.getQueue('order-processing-dlq');
  console.log(`      Mensagens no DLQ: ${dlqQueue.messages ? dlqQueue.messages.length : 0}`);
  if (dlqQueue.messages && dlqQueue.messages.length > 0) {
    console.log(`      Mensagens:`);
    for (const msg of dlqQueue.messages) {
      const order = JSON.parse(msg.Body);
      console.log(`        - ${order.orderId}: originalMessageId=${msg.originalMessageId ? msg.originalMessageId.substring(0, 8) + '...' : 'N/A'}`);
    }
  }

  console.log('\n📊 === Resumo ===');
  console.log(`Total de mensagens enviadas: 5`);
  console.log(`Processadas com sucesso: 3 (ORD-1, ORD-3, ORD-5)`);
  console.log(`Movidas para DLQ: 2 (ORD-2, ORD-4 após ${redrivePolicy.maxReceiveCount} tentativas)`);
  console.log(`\n✅ Exemplo concluído!\n`);
}

// Run the example
main().catch(console.error);
