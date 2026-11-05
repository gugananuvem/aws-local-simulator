/**
 * Exemplo: EC2 com Proxy para URL Externa
 * 
 * Este exemplo demonstra como usar EC2 como proxy para uma aplicação
 * rodando localmente na sua máquina.
 * 
 * Cenário:
 * - Você tem uma aplicação rodando em http://localhost:3000 (Node, React, etc)
 * - Quer acessá-la através do EC2 em http://localhost:8000
 * - O EC2 funciona como proxy, redirecionando requisições
 */

const path = require('path');
const http = require('http');
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
    ec2: true,
    alb: false,
    asg: false,
    vpc: false,
  },

  ports: {
    ec2: 4020,
    adminPort: 9999,
  },

  ec2: {
    // Instâncias pré-configuradas com proxy
    instances: [
      {
        ImageId: 'ami-proxy-app',
        InstanceType: 't2.micro',
        ProxyUrl: 'http://localhost:3000', // ← Aplicação local
        Tags: [
          { Key: 'Name', Value: 'proxy-instance-1' },
          { Key: 'Target', Value: 'localhost:3000' }
        ]
      },
      {
        ImageId: 'ami-proxy-api',
        InstanceType: 't2.micro',
        ProxyUrl: 'http://localhost:4000', // ← Outra aplicação local
        Tags: [
          { Key: 'Name', Value: 'proxy-instance-2' },
          { Key: 'Target', Value: 'localhost:4000' }
        ]
      }
    ]
  }
};

async function main() {
  try {
    console.log('🚀 Iniciando AWS Local Simulator com EC2 Proxy...\n');

    const { server, services } = await startServer(config);

    // Aguardar inicialização
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n✅ Serviço EC2 iniciado com sucesso!\n');
    console.log('📋 URLs disponíveis:');
    console.log(`   EC2 Admin:  http://localhost:4020/__admin/ec2`);
    console.log(`   Management: http://localhost:9999\n`);

    console.log('🎯 Instâncias com Proxy:');
    console.log('   Proxy 1: http://localhost:8000 → http://localhost:3000');
    console.log('   Proxy 2: http://localhost:8001 → http://localhost:4000\n');

    console.log('📝 Exemplos de uso:\n');

    console.log('1️⃣  Listar instâncias (verificar ProxyUrl):');
    console.log('   GET http://localhost:4020/__admin/ec2/instances\n');

    console.log('2️⃣  Ver metadados de uma instância:');
    console.log('   GET http://localhost:8000/__metadata\n');

    console.log('3️⃣  Acessar aplicação através do proxy:');
    console.log('   curl http://localhost:8000/');
    console.log('   (Redireciona para http://localhost:3000)\n');

    console.log('4️⃣  Criar nova instância com proxy dinamicamente:');
    console.log('   POST http://localhost:4020/__admin/ec2/instances/run');
    console.log('   Body: {');
    console.log('     "ImageId": "ami-custom",');
    console.log('     "MinCount": 1,');
    console.log('     "MaxCount": 1,');
    console.log('     "InstanceType": "t2.micro",');
    console.log('     "ProxyUrl": "http://localhost:5000"');
    console.log('   }\n');

    console.log('💡 Dicas:');
    console.log('   - Cada instância com proxy redirecionará automaticamente');
    console.log('   - Suporta todas as rotas da aplicação de origem');
    console.log('   - WebSocket é suportado');
    console.log('   - Headers são mantidos/propagados\n');

    console.log('🔧 Use caso - ALB com múltiplos proxies:');
    console.log('   1. Crie várias instâncias com proxy para diferentes apps');
    console.log('   2. Configure ALB com Target Group');
    console.log('   3. Registre as instâncias como targets');
    console.log('   4. ALB distribuirá entre os múltiplos proxies\n');

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
