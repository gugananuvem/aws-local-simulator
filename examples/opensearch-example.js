/**
 * Exemplo: OpenSearch - Simulador Elasticsearch/OpenSearch
 * 
 * Este exemplo demonstra como usar o serviço OpenSearch para:
 * 1. Criar índices
 * 2. Indexar documentos
 * 3. Buscar com queries
 * 4. Agregar dados
 */

const { startServer } = require('../src/index');

const config = {
  logLevel: 'info',

  services: {
    dynamodb: false,
    s3: false,
    sqs: false,
    lambda: false,
    sns: false,
    eventbridge: false,
    ecs: false,
    cognito: false,
    apigateway: false,
    sts: false,
    'secret-manager': false,
    'parameter-store': false,
    kms: false,
    kinesis: false,
    ec2: false,
    alb: false,
    asg: false,
    opensearch: true,
  },

  ports: {
    opensearch: 9200,
    adminPort: 9999,
  },

  opensearch: {
    indices: [
      {
        name: 'products',
        properties: {
          name: { type: 'text' },
          category: { type: 'keyword' },
          price: { type: 'float' },
          description: { type: 'text' }
        }
      },
      {
        name: 'users',
        properties: {
          username: { type: 'keyword' },
          email: { type: 'keyword' },
          age: { type: 'integer' },
          bio: { type: 'text' }
        }
      },
      {
        name: 'logs',
        properties: {
          level: { type: 'keyword' },
          message: { type: 'text' },
          timestamp: { type: 'date' },
          service: { type: 'keyword' }
        }
      }
    ]
  }
};

async function main() {
  try {
    console.log('🚀 Iniciando AWS Local Simulator com OpenSearch...\n');

    const { server, services } = await startServer(config);

    // Aguardar inicialização
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n✅ OpenSearch iniciado com sucesso!\n');
    console.log('📋 URLs disponíveis:');
    console.log(`   OpenSearch: http://localhost:9200`);
    console.log(`   Management: http://localhost:9999\n`);

    console.log('🎯 Índices pré-criados:');
    console.log('   - products');
    console.log('   - users');
    console.log('   - logs\n');

    console.log('📝 Exemplos de uso:\n');

    console.log('1️⃣  Criar índice:');
    console.log('   curl -X PUT http://localhost:9200/my-index -H "Content-Type: application/json"');
    console.log('   -d \'{"settings":{"number_of_shards":1}}\'\n');

    console.log('2️⃣  Indexar documento:');
    console.log('   curl -X POST http://localhost:9200/products/_doc -H "Content-Type: application/json"');
    console.log('   -d \'{"name":"Laptop","price":999.99,"category":"Electronics"}\'\n');

    console.log('3️⃣  Buscar documentos:');
    console.log('   curl -X GET "http://localhost:9200/products/_search?q=Laptop"\n');

    console.log('4️⃣  Busca com query JSON:');
    console.log('   curl -X POST http://localhost:9200/products/_search -H "Content-Type: application/json"');
    console.log('   -d \'{"query":{"match":{"name":"Laptop"}}}\'\n');

    console.log('5️⃣  Agregação (contar por categoria):');
    console.log('   curl -X POST http://localhost:9200/products/_search -H "Content-Type: application/json"');
    console.log('   -d \'{"aggs":{"categories":{"terms":{"field":"category"}}}}\'\n');

    console.log('6️⃣  Deletar por query:');
    console.log('   curl -X POST http://localhost:9200/products/_delete_by_query -H "Content-Type: application/json"');
    console.log('   -d \'{"query":{"match":{"category":"Electronics"}}}\'\n');

    console.log('7️⃣  Health check:');
    console.log('   curl http://localhost:9200/_cluster/health\n');

    console.log('8️⃣  Listar índices (admin):');
    console.log('   curl http://localhost:9200/__admin/opensearch/indices\n');

    console.log('💡 Dicas:');
    console.log('   - Use curl, Postman ou elasticsearch-py para testar');
    console.log('   - Documentos são persistidos em .aws-local-simulator-data/opensearch/');
    console.log('   - Suporta queries match, bool, query_string');
    console.log('   - Agregações: terms, avg, sum\n');

    console.log('⏹️  Pressione Ctrl+C para parar o servidor\n');

    await new Promise((resolve) => {
      process.on('SIGINT', () => {
        console.log('\n\n⏹️  Parando servidor...\n');
        server.close(() => {
          console.log('✅ Servidor parado\n');
          process.exit(0);
        });
      });
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

main();
