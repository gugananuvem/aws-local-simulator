/**
 * Exemplo de uso do VPC Simulator
 * Demonstra como criar e gerenciar uma arquitetura VPC completa
 */

const http = require('http');

// Função auxiliar para fazer requisições HTTP
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 4014,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function main() {
  console.log('🚀 VPC Simulator - Exemplo Completo\n');
  console.log('Este exemplo cria uma arquitetura VPC com:');
  console.log('  - 1 VPC\n  - 2 Subnets públicas\n  - 1 Subnet privada');
  console.log('  - 1 Internet Gateway\n  - 2 Route Tables');
  console.log('  - 1 VPC Endpoint S3\n');

  try {
    // 1. Criar VPC
    console.log('📦 Criando VPC...');
    const vpcResult = await makeRequest('POST', '/__admin/vpcs/create', {
      CidrBlock: '10.0.0.0/16',
      Tags: [
        { Key: 'Name', Value: 'exemplo-vpc' },
        { Key: 'Environment', Value: 'demo' }
      ],
      EnableDnsHostnames: true,
      EnableDnsSupport: true
    });

    if (!vpcResult.Vpc) {
      throw new Error('Erro ao criar VPC');
    }

    const vpcId = vpcResult.Vpc.VpcId;
    console.log(`✅ VPC criado: ${vpcId}\n`);

    // 2. Criar Internet Gateway
    console.log('🌐 Criando Internet Gateway...');
    const igwResult = await makeRequest('POST', '/__admin/internet-gateways/create', {
      Tags: [
        { Key: 'Name', Value: 'exemplo-igw' }
      ]
    });

    if (!igwResult.InternetGateway) {
      throw new Error('Erro ao criar IGW');
    }

    const igwId = igwResult.InternetGateway.InternetGatewayId;
    console.log(`✅ Internet Gateway criado: ${igwId}\n`);

    // 3. Anexar IGW à VPC
    console.log('🔗 Anexando IGW à VPC...');
    await makeRequest('POST', `/__admin/internet-gateways/${igwId}/attach`, {
      VpcId: vpcId
    });
    console.log('✅ IGW anexado\n');

    // 4. Criar Subnets Públicas
    console.log('🏗️ Criando Subnets...');
    const subnet1Result = await makeRequest('POST', '/__admin/subnets/create', {
      VpcId: vpcId,
      CidrBlock: '10.0.1.0/24',
      AvailabilityZone: 'us-east-1a',
      Tags: [
        { Key: 'Name', Value: 'public-subnet-1a' },
        { Key: 'Type', Value: 'Public' }
      ],
      MapPublicIpOnLaunch: true
    });

    if (!subnet1Result.Subnet) {
      throw new Error('Erro ao criar subnet 1');
    }

    const subnet1Id = subnet1Result.Subnet.SubnetId;
    console.log(`✅ Subnet 1 criado: ${subnet1Id}`);

    const subnet2Result = await makeRequest('POST', '/__admin/subnets/create', {
      VpcId: vpcId,
      CidrBlock: '10.0.2.0/24',
      AvailabilityZone: 'us-east-1b',
      Tags: [
        { Key: 'Name', Value: 'public-subnet-1b' },
        { Key: 'Type', Value: 'Public' }
      ],
      MapPublicIpOnLaunch: true
    });

    if (!subnet2Result.Subnet) {
      throw new Error('Erro ao criar subnet 2');
    }

    const subnet2Id = subnet2Result.Subnet.SubnetId;
    console.log(`✅ Subnet 2 criado: ${subnet2Id}`);

    // 5. Criar Subnet Privada
    const subnet3Result = await makeRequest('POST', '/__admin/subnets/create', {
      VpcId: vpcId,
      CidrBlock: '10.0.10.0/24',
      AvailabilityZone: 'us-east-1a',
      Tags: [
        { Key: 'Name', Value: 'private-subnet-1a' },
        { Key: 'Type', Value: 'Private' }
      ],
      MapPublicIpOnLaunch: false
    });

    if (!subnet3Result.Subnet) {
      throw new Error('Erro ao criar subnet 3');
    }

    const subnet3Id = subnet3Result.Subnet.SubnetId;
    console.log(`✅ Subnet 3 (privada) criado: ${subnet3Id}\n`);

    // 6. Criar Route Table Pública
    console.log('📋 Criando Route Tables...');
    const publicRtResult = await makeRequest('POST', '/__admin/route-tables/create', {
      VpcId: vpcId,
      Tags: [
        { Key: 'Name', Value: 'public-rt' }
      ]
    });

    if (!publicRtResult.RouteTable) {
      throw new Error('Erro ao criar route table pública');
    }

    const publicRtId = publicRtResult.RouteTable.RouteTableId;
    console.log(`✅ Public Route Table criado: ${publicRtId}`);

    // 7. Adicionar Rota Padrão à Route Table Pública
    console.log('➕ Adicionando rota padrão (0.0.0.0/0 → IGW)...');
    await makeRequest('POST', `/__admin/route-tables/${publicRtId}/routes`, {
      DestinationCidrBlock: '0.0.0.0/0',
      Target: igwId,
      TargetType: 'igw'
    });
    console.log('✅ Rota adicionada\n');

    // 8. Associar Subnets Públicas com Route Table Pública
    console.log('🔗 Associando Subnets com Route Tables...');
    await makeRequest('POST', `/__admin/route-tables/${publicRtId}/associations`, {
      SubnetId: subnet1Id
    });
    console.log(`✅ Subnet 1 associado com public-rt`);

    await makeRequest('POST', `/__admin/route-tables/${publicRtId}/associations`, {
      SubnetId: subnet2Id
    });
    console.log(`✅ Subnet 2 associado com public-rt\n`);

    // 9. Criar Route Table Privada (sem rota padrão para internet)
    const privateRtResult = await makeRequest('POST', '/__admin/route-tables/create', {
      VpcId: vpcId,
      Tags: [
        { Key: 'Name', Value: 'private-rt' }
      ]
    });

    if (!privateRtResult.RouteTable) {
      throw new Error('Erro ao criar route table privada');
    }

    const privateRtId = privateRtResult.RouteTable.RouteTableId;
    console.log(`✅ Private Route Table criado: ${privateRtId}`);

    // 10. Associar Subnet Privada com Route Table Privada
    await makeRequest('POST', `/__admin/route-tables/${privateRtId}/associations`, {
      SubnetId: subnet3Id
    });
    console.log(`✅ Subnet 3 (privada) associado com private-rt\n`);

    // 11. Criar VPC Endpoint S3
    console.log('📦 Criando VPC Endpoints...');
    const s3EndpointResult = await makeRequest('POST', '/__admin/vpc-endpoints/create', {
      VpcId: vpcId,
      ServiceName: 'com.amazonaws.us-east-1.s3',
      VpcEndpointType: 'Gateway',
      RouteTableIds: [publicRtId, privateRtId]
    });

    if (!s3EndpointResult.VpcEndpoint) {
      throw new Error('Erro ao criar S3 endpoint');
    }

    const s3EndpointId = s3EndpointResult.VpcEndpoint.VpcEndpointId;
    console.log(`✅ S3 Endpoint criado: ${s3EndpointId}\n`);

    // 12. Listar todos os recursos criados
    console.log('📊 Resumo da Arquitetura Criada:\n');
    console.log(`VPC: ${vpcId}`);
    console.log(`  - CIDR: 10.0.0.0/16`);
    console.log(`  - DNS Hostnames: Habilitado`);
    console.log(`  - DNS Support: Habilitado\n`);

    console.log('Internet Gateway:');
    console.log(`  - ID: ${igwId}`);
    console.log(`  - Anexado à: ${vpcId}\n`);

    console.log('Subnets:');
    console.log(`  1. ${subnet1Id} (10.0.1.0/24) - Pública - us-east-1a`);
    console.log(`  2. ${subnet2Id} (10.0.2.0/24) - Pública - us-east-1b`);
    console.log(`  3. ${subnet3Id} (10.0.10.0/24) - Privada - us-east-1a\n`);

    console.log('Route Tables:');
    console.log(`  1. ${publicRtId} (Pública)`);
    console.log(`     - Rota: 0.0.0.0/0 → ${igwId}`);
    console.log(`     - Associada: ${subnet1Id}, ${subnet2Id}`);
    console.log(`  2. ${privateRtId} (Privada)`);
    console.log(`     - Sem rota padrão para internet`);
    console.log(`     - Associada: ${subnet3Id}\n`);

    console.log('VPC Endpoints:');
    console.log(`  - ${s3EndpointId} (S3 Gateway)`);
    console.log(`    - Rotas: ${publicRtId}, ${privateRtId}\n`);

    // 13. Listar todos os recursos
    console.log('📋 Listando todos os recursos via API:\n');
    const resources = await makeRequest('GET', '/__admin/resources');
    
    console.log(`Total de VPCs: ${resources.vpcs.length}`);
    console.log(`Total de Subnets: ${resources.subnets.length}`);
    console.log(`Total de Route Tables: ${resources.routeTables.length}`);
    console.log(`Total de Internet Gateways: ${resources.internetGateways.length}`);
    console.log(`Total de VPC Endpoints: ${resources.vpcEndpoints.length}\n`);

    console.log('✨ Arquitetura VPC criada com sucesso!\n');
    console.log('Teste os endpoints:');
    console.log(`  curl http://localhost:4014/__admin/vpcs/${vpcId}`);
    console.log(`  curl http://localhost:4014/__admin/subnets?vpcIds=${vpcId}`);
    console.log(`  curl http://localhost:4014/__admin/route-tables?vpcIds=${vpcId}`);
    console.log(`  curl http://localhost:4014/__admin/vpc-endpoints?vpcIds=${vpcId}`);
    console.log('\n');

  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

// Executar
main();
