/**
 * Exemplo: EC2 + ALB + ASG - Simulador completo
 * 
 * Este exemplo demonstra como usar os serviços EC2, ALB e ASG juntos:
 * 1. Criar instâncias EC2 que servem um site HTML
 * 2. Usar ALB para distribuir tráfego entre as instâncias
 * 3. Usar ASG para dimensionar automaticamente
 */

const path = require('path');
const http = require('http');
const { startServer } = require('../src/index');

const config = {
  logLevel: 'info',

  // Habilitar EC2, ALB e ASG
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
    alb: true,
    asg: true,
    vpc: true,
  },

  // Portas dos serviços
  ports: {
    ec2: 4020,
    alb: 4021,
    asg: 4022,
    vpc: 4018,
    adminPort: 9999,
  },

  // Configuração EC2
  ec2: {
    // Pre-criar uma VPC para as instâncias
    vpcs: [
      {
        CidrBlock: '10.0.0.0/16',
        Tags: [{ Key: 'Name', Value: 'default-vpc' }],
      },
    ],
    // Pre-criar um security group
    securityGroups: [
      {
        GroupName: 'web-sg',
        Description: 'Security group para servidores web',
        VpcId: null, // Será atribuído à VPC padrão
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 80,
            ToPort: 80,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP' }],
          },
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTPS' }],
          },
        ],
      },
    ],
  },

  // Configuração ALB
  alb: {
    loadBalancers: [
      {
        Name: 'web-alb',
        Scheme: 'internet-facing',
        IpAddressType: 'ipv4',
      },
    ],
  },

  // Configuração ASG
  asg: {
    autoScalingGroups: [
      {
        AutoScalingGroupName: 'web-asg',
        launchTemplateName: 'web-lt',
        imageId: 'ami-0c55b159cbfafe1f0',
        instanceType: 't2.micro',
        minSize: 2,
        maxSize: 4,
        desiredCapacity: 2,
        launchTemplateConfig: {
          securityGroupIds: ['web-sg'],
        },
        tags: [
          { Key: 'Name', Value: 'web-server' },
          { Key: 'Environment', Value: 'dev' },
        ],
      },
    ],
  },
};

async function main() {
  try {
    console.log('🚀 Iniciando AWS Local Simulator com EC2, ALB e ASG...\n');

    const { server, services } = await startServer(config);

    // Aguardar inicialização
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n✅ Serviços iniciados com sucesso!\n');
    console.log('📋 URLs disponíveis:');
    console.log(`   EC2 Admin:  http://localhost:4020/__admin/ec2`);
    console.log(`   ALB Admin:  http://localhost:4021/__admin/alb`);
    console.log(`   ASG Admin:  http://localhost:4022/__admin/asg`);
    console.log(`   Management: http://localhost:9999\n`);

    // ========== Exemplos de requisições ==========

    console.log('📝 Exemplos de requisições:\n');

    // 1. Listar instâncias EC2
    console.log('1️⃣  Listar todas as instâncias EC2:');
    console.log('   GET http://localhost:4020/__admin/ec2/instances\n');

    // 2. Listar Auto Scaling Groups
    console.log('2️⃣  Listar Auto Scaling Groups:');
    console.log('   GET http://localhost:4022/__admin/asg/auto-scaling-groups\n');

    // 3. Escalar manualmente
    console.log('3️⃣  Aumentar desiredCapacity para 3:');
    console.log('   PUT http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/desired-capacity');
    console.log('   Body: { "DesiredCapacity": 3 }\n');

    // 4. Criar Target Group para ALB
    console.log('4️⃣  Criar Target Group:');
    console.log('   POST http://localhost:4021/__admin/alb/target-groups/create');
    console.log('   Body: { "Name": "web-targets", "Protocol": "HTTP", "Port": 80 }\n');

    // 5. Registrar targets no ALB
    console.log('5️⃣  Registrar instância como target no ALB:');
    console.log('   POST http://localhost:4021/__admin/alb/target-groups/{tgArn}/register-target');
    console.log('   Body: { "TargetId": "{instanceId}", "Port": 8000 }\n');

    // 6. Criar Scaling Policy
    console.log('6️⃣  Criar Scaling Policy (Target Tracking):');
    console.log('   POST http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/scaling-policies');
    console.log('   Body: {');
    console.log('     "PolicyName": "cpu-scaling",');
    console.log('     "PolicyType": "TargetTrackingScaling",');
    console.log('     "targetValue": 70');
    console.log('   }\n');

    console.log('💡 Dicas:');
    console.log('   - Cada instância EC2 serve uma página HTML padrão na porta 8000-8999');
    console.log('   - Se configurar WebServerDir, a instância serve arquivos do diretório');
    console.log('   - ALB usa round-robin para distribuir tráfego entre targets');
    console.log('   - ASG cria/termina instâncias automaticamente\n');

    console.log('⏹️  Pressione Ctrl+C para parar o servidor\n');

    // ========== Loop para manter o servidor rodando ==========
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
