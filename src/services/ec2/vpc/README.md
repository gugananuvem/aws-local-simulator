# VPC - Simulador de Virtual Private Cloud (parte do serviço EC2)

Simulador completo de AWS VPC com suporte a rotas, subnets, Internet Gateways, VPC Endpoints e VPC Gateways.

> ℹ️ **A VPC não é um serviço AWS separado.** Na AWS, as ações de VPC fazem parte da API do
> EC2 (`aws ec2 ...`). Após a fusão, este código vive dentro do serviço **EC2**
> (`src/services/ec2/vpc/`) e é atendido na **porta 4020**. Não existe mais uma porta/registro
> de serviço dedicado ao VPC.

## Características

✅ **VPCs**: Criar, listar, deletar, modificar atributos
✅ **Subnets**: Criar subnets por VPC com validação de CIDR  
✅ **Route Tables**: Tabelas de rotas com múltiplas regras de roteamento
✅ **Internet Gateways**: Criar e associar a VPCs
✅ **VPC Endpoints**: S3, DynamoDB, Lambda, SQS, SNS (Gateway e Interface)
✅ **VPC Endpoint Services**: Serviços PrivateLink (configurações de serviço)
✅ **VPC Peering Connections**: Conexões entre VPCs (create/accept/reject/delete)
✅ **NAT Gateways**: Gerenciar gateways para subnets privadas
✅ **DHCP Option Sets**: Conjunto padrão + conjuntos personalizados
✅ **Elastic IPs**: Alocação, associação e liberação
✅ **Egress-only Internet Gateways**: Saída IPv6
✅ **Managed Prefix Lists**: Listas de prefixos gerenciadas (CIDRs reutilizáveis)
✅ **Customer Gateways**: Gateways de cliente (VPN site-to-site)
✅ **Virtual Private Gateways**: Gateways virtuais (VPN site-to-site)
✅ **VPN Connections**: Conexões site-to-site (create/delete)
✅ **Client VPN Endpoints**: VPN de cliente (com certificado do ACM)
✅ **Tags**: Suporte completo para tags em todos os recursos

## Arquitetura

```
src/services/ec2/vpc/
├── vpcRoutes.js          # Rotas admin (/__admin/ec2/vpc) + handlers do EC2 Query Protocol
├── simulator.js          # Lógica de simulação VPCSimulator (+ persistência e migração)
├── models/
│   ├── vpc.js            # Modelo de VPC
│   ├── subnet.js         # Modelo de Subnet
│   ├── routeTable.js     # Modelo de RouteTable
│   ├── internetGateway.js # Modelo de IGW
│   ├── vpcEndpoint.js    # Modelo de VPC Endpoint
│   ├── vpcEndpointService.js # Modelo de VPC Endpoint Service (PrivateLink)
│   ├── vpcPeeringConnection.js # Modelo de VPC Peering Connection
│   ├── elasticIp.js      # Modelo de Elastic IP
│   ├── egressOnlyInternetGateway.js # Modelo de Egress-only IGW
│   ├── dhcpOptions.js    # Modelo de DHCP option set
│   ├── managedPrefixList.js # Modelo de Managed Prefix List
│   ├── clientVpnEndpoint.js # Modelo de Client VPN endpoint
│   ├── identifier.js     # Geração de IDs no padrão AWS (`<prefix>-<hex>`)
│   └── vpcGateway.js     # Modelo de NAT/Customer/VPN Gateways e VPN Connections
└── README.md             # Este arquivo
```

O ciclo de vida do serviço é gerenciado por `src/services/ec2/index.js` (`EC2Service`), que
instancia o `EC2Simulator` (instâncias) e o `VPCSimulator` (rede).

## Configuração

### arquivo `aws-local-simulator.json`

```json
{
  "services": {
    "ec2": true
  },
  "vpc": {
    "vpcs": [
      {
        "CidrBlock": "10.0.0.0/16",
        "Tags": [
          { "Key": "Name", "Value": "main-vpc" }
        ],
        "EnableDnsHostnames": true,
        "EnableDnsSupport": true
      }
    ],
    "subnets": [
      {
        "VpcId": "vpc-xxxxx",
        "CidrBlock": "10.0.1.0/24",
        "AvailabilityZone": "us-east-1a",
        "Tags": [
          { "Key": "Name", "Value": "public-subnet" }
        ],
        "MapPublicIpOnLaunch": true
      }
    ]
  }
}
```

### Variáveis de Ambiente

A VPC é habilitada/desabilitada junto com o EC2 (não há mais variável dedicada):

```bash
# Habilitar/Desabilitar o serviço EC2 (que inclui a VPC)
export AWS_LOCAL_SIMULATOR_EC2=true

# Porta (padrão: 4020), compartilhada com o EC2
export AWS_LOCAL_SIMULATOR_EC2_PORT=4020
```

### Persistência

Os recursos de rede são persistidos em `dataDir/ec2/vpc`. Na primeira inicialização, dados
legados de `dataDir/vpc` (quando presentes) são migrados automaticamente.

## API REST

### VPCs

#### Criar VPC
```
POST /__admin/ec2/vpc/vpcs/create
Content-Type: application/json

{
  "CidrBlock": "10.0.0.0/16",
  "Tags": [
    { "Key": "Name", "Value": "my-vpc" }
  ],
  "EnableDnsHostnames": true,
  "EnableDnsSupport": true
}
```

#### Listar VPCs
```
GET /__admin/ec2/vpc/vpcs
GET /__admin/ec2/vpc/vpcs?vpcIds=vpc-xxxxx
```

#### Obter VPC
```
GET /__admin/ec2/vpc/vpcs/{vpcId}
```

#### Modificar VPC
```
POST /__admin/ec2/vpc/vpcs/{vpcId}/attributes
Content-Type: application/json

{
  "attribute": "enableDnsHostnames|enableDnsSupport",
  "value": true/false
}
```

#### Deletar VPC
```
DELETE /__admin/ec2/vpc/vpcs/{vpcId}
```

### Subnets

#### Criar Subnet
```
POST /__admin/ec2/vpc/subnets/create
Content-Type: application/json

{
  "VpcId": "vpc-xxxxx",
  "CidrBlock": "10.0.1.0/24",
  "AvailabilityZone": "us-east-1a",
  "Tags": [],
  "MapPublicIpOnLaunch": true
}
```

#### Listar Subnets
```
GET /__admin/ec2/vpc/subnets
GET /__admin/ec2/vpc/subnets?vpcIds=vpc-xxxxx
```

#### Obter Subnet
```
GET /__admin/ec2/vpc/subnets/{subnetId}
```

#### Deletar Subnet
```
DELETE /__admin/ec2/vpc/subnets/{subnetId}
```

### Route Tables

#### Criar Route Table
```
POST /__admin/ec2/vpc/route-tables/create
Content-Type: application/json

{
  "VpcId": "vpc-xxxxx",
  "Tags": []
}
```

#### Listar Route Tables
```
GET /__admin/ec2/vpc/route-tables
GET /__admin/ec2/vpc/route-tables?vpcIds=vpc-xxxxx
```

#### Obter Route Table
```
GET /__admin/ec2/vpc/route-tables/{rtId}
```

#### Adicionar Rota
```
POST /__admin/ec2/vpc/route-tables/{rtId}/routes
Content-Type: application/json

{
  "DestinationCidrBlock": "0.0.0.0/0",
  "Target": "igw-xxxxx",
  "TargetType": "igw|nat|vpce|instance"
}
```

#### Remover Rota
```
DELETE /__admin/ec2/vpc/route-tables/{rtId}/routes/{cidr}
```

#### Associar com Subnet
```
POST /__admin/ec2/vpc/route-tables/{rtId}/associations
Content-Type: application/json

{
  "SubnetId": "subnet-xxxxx"
}
```

#### Desassociar Subnet
```
DELETE /__admin/ec2/vpc/route-tables/{rtId}/associations/{subnetId}
```

#### Deletar Route Table
```
DELETE /__admin/ec2/vpc/route-tables/{rtId}
```

### Internet Gateways

#### Criar IGW
```
POST /__admin/ec2/vpc/internet-gateways/create
Content-Type: application/json

{
  "Tags": []
}
```

#### Listar IGWs
```
GET /__admin/ec2/vpc/internet-gateways
```

#### Obter IGW
```
GET /__admin/ec2/vpc/internet-gateways/{igwId}
```

#### Anexar a VPC
```
POST /__admin/ec2/vpc/internet-gateways/{igwId}/attach
Content-Type: application/json

{
  "VpcId": "vpc-xxxxx"
}
```

#### Desanexar de VPC
```
POST /__admin/ec2/vpc/internet-gateways/{igwId}/detach
Content-Type: application/json

{
  "VpcId": "vpc-xxxxx"
}
```

#### Deletar IGW
```
DELETE /__admin/ec2/vpc/internet-gateways/{igwId}
```

### VPC Endpoints

#### Criar Endpoint (Gateway)
```
POST /__admin/ec2/vpc/vpc-endpoints/create
Content-Type: application/json

{
  "VpcId": "vpc-xxxxx",
  "ServiceName": "com.amazonaws.region.s3|dynamodb",
  "VpcEndpointType": "Gateway",
  "RouteTableIds": ["rtb-xxxxx"]
}
```

#### Criar Endpoint (Interface)
```
POST /__admin/ec2/vpc/vpc-endpoints/create
Content-Type: application/json

{
  "VpcId": "vpc-xxxxx",
  "ServiceName": "com.amazonaws.region.lambda",
  "VpcEndpointType": "Interface",
  "SubnetIds": ["subnet-xxxxx"],
  "SecurityGroupIds": ["sg-xxxxx"],
  "PrivateDnsEnabled": true
}
```

#### Listar Endpoints
```
GET /__admin/ec2/vpc/vpc-endpoints
GET /__admin/ec2/vpc/vpc-endpoints?vpcIds=vpc-xxxxx
GET /__admin/ec2/vpc/vpc-endpoints?vpcEndpointIds=vpce-xxxxx
```

#### Obter Endpoint
```
GET /__admin/ec2/vpc/vpc-endpoints/{epId}
```

#### Modificar Endpoint
```
POST /__admin/ec2/vpc/vpc-endpoints/{epId}/modify
Content-Type: application/json

{
  "RouteTableIds": ["rtb-xxxxx"],
  "SubnetIds": ["subnet-xxxxx"],
  "PolicyDocument": {}
}
```

#### Deletar Endpoint
```
DELETE /__admin/ec2/vpc/vpc-endpoints/{epId}
```

### VPC Peering Connections

#### Criar Peering Connection
```
POST /__admin/ec2/vpc/peering-connections/create
Content-Type: application/json

{
  "VpcId": "vpc-xxxxx",
  "PeerVpcId": "vpc-yyyyy",
  "Tags": []
}
```

#### Listar Peering Connections
```
GET /__admin/ec2/vpc/peering-connections
```

#### Aceitar Peering Connection
```
POST /__admin/ec2/vpc/peering-connections/{pcxId}/accept
```

#### Rejeitar Peering Connection
```
POST /__admin/ec2/vpc/peering-connections/{pcxId}/reject
```

#### Deletar Peering Connection
```
DELETE /__admin/ec2/vpc/peering-connections/{pcxId}
```

### VPC Endpoint Services

#### Criar Endpoint Service
```
POST /__admin/ec2/vpc/endpoint-services/create
Content-Type: application/json

{
  "NetworkLoadBalancerArns": ["arn:aws:elasticloadbalancing:..."],
  "AcceptanceRequired": true,
  "Tags": []
}
```

#### Listar Endpoint Services
```
GET /__admin/ec2/vpc/endpoint-services
```

#### Deletar Endpoint Service
```
DELETE /__admin/ec2/vpc/endpoint-services/{serviceId}
```

### Managed Prefix Lists

```
POST /__admin/ec2/vpc/managed-prefix-lists/create   # { PrefixListName, AddressFamily, MaxEntries, Entries, Tags }
GET  /__admin/ec2/vpc/managed-prefix-lists
GET  /__admin/ec2/vpc/managed-prefix-lists/{prefixListId}/entries
DELETE /__admin/ec2/vpc/managed-prefix-lists/{prefixListId}
```

Uma lista padrão (`com.amazonaws.us-east-1.s3`) com `OwnerId: "AWS"` é criada na
inicialização e **não pode ser removida**. Listas criadas pelo usuário usam o prefixo de
ID `pl-`.

### Customer Gateways (VPN)

```
POST /__admin/ec2/vpc/customer-gateways/create   # { Type, BgpAsn, IpAddress, Tags }
GET  /__admin/ec2/vpc/customer-gateways
DELETE /__admin/ec2/vpc/customer-gateways/{customerGatewayId}
```

### Virtual Private Gateways (VPN)

```
POST /__admin/ec2/vpc/vpn-gateways/create        # { Type, AmazonSideAsn, Tags }
GET  /__admin/ec2/vpc/vpn-gateways
POST /__admin/ec2/vpc/vpn-gateways/{vpnGatewayId}/attach   # { VpcId }
POST /__admin/ec2/vpc/vpn-gateways/{vpnGatewayId}/detach   # { VpcId }
DELETE /__admin/ec2/vpc/vpn-gateways/{vpnGatewayId}
```

### Site-to-site VPN Connections

```
POST /__admin/ec2/vpc/vpn-connections/create     # { Type, CustomerGatewayId, VpnGatewayId, Options, Tags }
GET  /__admin/ec2/vpc/vpn-connections
DELETE /__admin/ec2/vpc/vpn-connections/{vpnConnectionId}
```

### Client VPN Endpoints

```
POST /__admin/ec2/vpc/client-vpn-endpoints/create           # { ClientCidrBlock, ServerCertificateArn, VpcId, Tags }
GET  /__admin/ec2/vpc/client-vpn-endpoints
POST /__admin/ec2/vpc/client-vpn-endpoints/{id}/associate   # { SubnetId }
DELETE /__admin/ec2/vpc/client-vpn-endpoints/{id}
```

### Recursos

#### Listar Todos os Recursos
```
GET /__admin/ec2/resources
```

Response inclui: VPCs, Subnets, RouteTables, InternetGateways, VPCEndpoints,
VPCEndpointServices, VPCPeeringConnections, NATGateways, ElasticIPs, EgressOnlyIGWs,
DhcpOptions, ManagedPrefixLists, CustomerGateways, VpnGateways, VpnConnections e
ClientVpnEndpoints.

### Health Check

```
GET /__admin/ec2/health
```

Response: `{ "status": "ok", "service": "ec2" }`

## Exemplos

### Criar uma arquitetura VPC completa

```bash
# 1. Criar VPC
VPC=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/vpcs/create \
  -H "Content-Type: application/json" \
  -d '{"CidrBlock":"10.0.0.0/16"}' | jq -r '.Vpc.VpcId')

# 2. Criar Subnets
SUBNET_1=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -H "Content-Type: application/json" \
  -d "{\"VpcId\":\"$VPC\",\"CidrBlock\":\"10.0.1.0/24\",\"AvailabilityZone\":\"us-east-1a\"}" | jq -r '.Subnet.SubnetId')

# 3. Criar Internet Gateway
IGW=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/create \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.InternetGateway.InternetGatewayId')

# 4. Anexar IGW à VPC
curl -s -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/$IGW/attach \
  -H "Content-Type: application/json" \
  -d "{\"VpcId\":\"$VPC\"}"

# 5. Criar Route Table
RT=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/create \
  -H "Content-Type: application/json" \
  -d "{\"VpcId\":\"$VPC\"}" | jq -r '.RouteTable.RouteTableId')

# 6. Adicionar rota padrão
curl -s -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/$RT/routes \
  -H "Content-Type: application/json" \
  -d "{\"DestinationCidrBlock\":\"0.0.0.0/0\",\"Target\":\"$IGW\",\"TargetType\":\"igw\"}"

# 7. Associar Subnet com Route Table
curl -s -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/$RT/associations \
  -H "Content-Type: application/json" \
  -d "{\"SubnetId\":\"$SUBNET_1\"}"

# 8. Criar VPC Endpoint S3
curl -s -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d "{\"VpcId\":\"$VPC\",\"ServiceName\":\"com.amazonaws.us-east-1.s3\",\"VpcEndpointType\":\"Gateway\",\"RouteTableIds\":[\"$RT\"]}"

echo "Arquitetura criada com sucesso!"
echo "VPC: $VPC"
echo "Subnet: $SUBNET_1"
echo "IGW: $IGW"
echo "Route Table: $RT"
```

## Validações

- **CIDR Overlap**: Evita subnets com CIDR blocks sobrepostos na mesma VPC
- **Dependências**: Valida dependências ao deletar recursos
- **Associações**: Evita associações duplicadas de subnets em route tables
- **Attachments**: Permite um único IGW por VPC, múltiplos por IGW

## Limites

- Max 5 VPCs por simulador (configurável)
- Max 10 subnets por VPC (configurável)
- Max 20 rotes por route table
- Max 5 endpoints por VPC
- Sem limite de tags por recurso

## Status da Implementação

- ✅ VPCs (CRUD completo)
- ✅ Subnets (CRUD completo)
- ✅ Route Tables (CRUD + associações)
- ✅ Internet Gateways (CRUD + attach/detach)
- ✅ VPC Endpoints (CRUD + modificações + query protocol)
- ✅ VPC Endpoint Services (configurações PrivateLink)
- ✅ VPC Peering Connections (create/accept/reject/delete)
- ✅ NAT Gateways (CRUD + persistência)
- ✅ Elastic IPs (allocate/associate/disassociate/release)
- ✅ Egress-only Internet Gateways (CRUD)
- ✅ DHCP Option Sets (padrão + personalizados)
- ✅ Managed Prefix Lists (CRUD + entradas + lista padrão da AWS)
- ✅ Customer Gateways (VPN site-to-site)
- ✅ Virtual Private Gateways (CRUD + attach/detach)
- ✅ VPN Connections (site-to-site)
- ✅ Client VPN Endpoints (com certificado do ACM)
- ⏳ Network ACLs (futuro)
- ⏳ Security Groups (futuro)

## Integração com CloudFormation

O serviço VPC será integrado com CloudFormation para criar recursos via templates.

## Notas Importantes

1. O simulador VPC não faz roteamento real de tráfego - apenas simula o estado
2. Subnets e VPCs são apenas gerenciamento de estado, não há isolamento real de rede
3. Os dados são armazenados em memória e perdidos ao reiniciar
4. Para persistência, implemente storage backend (arquivo, banco de dados)

## Troubleshooting

### "VPC not found"
- Verifique se o VPC ID está correto
- Use `GET /__admin/ec2/vpc/vpcs` para listar IDs

### "Cannot delete VPC: VPC has subnets"
- Delete as subnets primeiro ou desassocie as subnets

### "CIDR block overlaps with existing subnets"
- Escolha um CIDR block que não sobrescreva subnets existentes
- Use subnets de 10.0.0.0/8 de forma não sobreposta

### "Cannot delete Internet Gateway with attachments"
- Desanexe o IGW da VPC primeiro com POST `/detach`

## Contribuindo

Para adicionar mais funcionalidades:

1. Adicione o modelo em `models/`
2. Implemente operações no `simulator.js`
3. Adicione rotas no `server.js`
4. Atualize este README

## Licença

MIT
