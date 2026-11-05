# VPC (Virtual Private Cloud)

## Visão Geral

O VPC Simulator fornece a camada de rede para toda a arquitetura local. Ele permite criar e gerenciar redes isoladas, subnets, gateways e endpoints, emulando o comportamento da AWS VPC na sua máquina.

> ℹ️ **A VPC faz parte do serviço EC2.** Na AWS, a VPC não é um serviço separado — suas ações
> pertencem à API do EC2 (`aws ec2 ...`). Neste simulador, as ações de VPC são atendidas na
> **porta 4020**, junto com o EC2, e as rotas administrativas ficam sob `/__admin/ec2/vpc/...`.
> Não existe mais a porta dedicada `4014`. O VPC é atendido na porta `4020` (junto com o EC2).

**Responsabilidades**:
- Criar e deletar VPCs
- Gerenciar subnets em múltiplas availability zones
- Configurar roteamento via route tables
- Gerenciar Internet Gateways
- Criar VPC Endpoints (Gateway e Interface)

## Porta e Endpoint

- **Porta**: `4020` (compartilhada com o EC2)
- **URL Base**: `http://localhost:4020`
- **Health Check**: `GET http://localhost:4020/__admin/ec2/health`

Exemplo de verificação:

```bash
curl http://localhost:4020/__admin/ec2/health
```

Resposta esperada:

```json
{
  "status": "ok",
  "service": "ec2"
}
```

## Quick Start

### Passo 1: Iniciar o Simulador

```bash
cd c:\Projetos\aws-local-simulator
npm start
```

### Passo 2: Criar sua Primeira VPC

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpcs/create \
  -H "Content-Type: application/json" \
  -d '{
    "CidrBlock": "10.0.0.0/16",
    "Tags": [
      {"Key": "Name", "Value": "minha-vpc"}
    ]
  }'
```

Guarde o `VpcId` da resposta (ex: `vpc-12345678`)

### Passo 3: Criar uma Subnet

```bash
VPC_ID="vpc-12345678"

curl -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -H "Content-Type: application/json" \
  -d "{
    \"VpcId\": \"$VPC_ID\",
    \"CidrBlock\": \"10.0.1.0/24\",
    \"AvailabilityZone\": \"us-east-1a\"
  }"
```

### Passo 4: Criar Internet Gateway e Anexar

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/create \
  -H "Content-Type: application/json" \
  -d '{}'

# Guarde o InternetGatewayId

curl -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/igw-12345678/attach \
  -H "Content-Type: application/json" \
  -d "{\"VpcId\": \"$VPC_ID\"}"
```

### Passo 5: Criar Route Table e Adicionar Rota Padrão

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/create \
  -H "Content-Type: application/json" \
  -d "{\"VpcId\": \"$VPC_ID\"}"

# Guarde o RouteTableId

curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/rtb-12345678/routes \
  -H "Content-Type: application/json" \
  -d "{
    \"DestinationCidrBlock\": \"0.0.0.0/0\",
    \"Target\": \"igw-12345678\",
    \"TargetType\": \"igw\"
  }"
```

### Passo 6: Associar Subnet com Route Table

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/rtb-12345678/associations \
  -H "Content-Type: application/json" \
  -d "{\"SubnetId\": \"subnet-12345678\"}"
```

## Recursos Suportados

### Ações do EC2 Query Protocol (AWS CLI)

As ações de VPC são atendidas pelo mesmo endpoint do EC2 (`POST http://localhost:4020/`), com
`Version=2016-11-15`:

| Ação | Descrição |
|------|-----------|
| `DescribeVpcs` / `CreateVpc` / `DeleteVpc` | Ciclo de vida das VPCs |
| `DescribeSubnets` / `CreateSubnet` / `DeleteSubnet` | Subnets |
| `DescribeRouteTables` / `CreateRouteTable` / `CreateRoute` / `DeleteRouteTable` | Route tables e rotas |
| `DescribeInternetGateways` / `CreateInternetGateway` / `AttachInternetGateway` / `DetachInternetGateway` / `DeleteInternetGateway` | Internet gateways |

> ℹ️ Ações de VPC Endpoint ainda não estão expostas no Query Protocol — use as rotas
> administrativas (`/__admin/ec2/vpc/vpc-endpoints/...`).

### VPCs (Admin API)

| Operação | Endpoint | Método |
|----------|----------|--------|
| Criar | `/__admin/ec2/vpc/vpcs/create` | POST |
| Listar | `/__admin/ec2/vpc/vpcs` | GET |
| Obter | `/__admin/ec2/vpc/vpcs/{vpcId}` | GET |
| Modificar atributos | `/__admin/ec2/vpc/vpcs/{vpcId}/attributes` | POST |
| Deletar | `/__admin/ec2/vpc/vpcs/{vpcId}` | DELETE |

### Subnets

| Operação | Endpoint | Método |
|----------|----------|--------|
| Criar | `/__admin/ec2/vpc/subnets/create` | POST |
| Listar | `/__admin/ec2/vpc/subnets` | GET |
| Obter | `/__admin/ec2/vpc/subnets/{subnetId}` | GET |
| Deletar | `/__admin/ec2/vpc/subnets/{subnetId}` | DELETE |

### Route Tables

| Operação | Endpoint | Método |
|----------|----------|--------|
| Criar | `/__admin/ec2/vpc/route-tables/create` | POST |
| Listar | `/__admin/ec2/vpc/route-tables` | GET |
| Adicionar rota | `/__admin/ec2/vpc/route-tables/{rtId}/routes` | POST |
| Remover rota | `/__admin/ec2/vpc/route-tables/{rtId}/routes/{cidr}` | DELETE |
| Associar subnet | `/__admin/ec2/vpc/route-tables/{rtId}/associations` | POST |
| Desassociar | `/__admin/ec2/vpc/route-tables/{rtId}/associations/{subnetId}` | DELETE |

### Internet Gateways

| Operação | Endpoint | Método |
|----------|----------|--------|
| Criar | `/__admin/ec2/vpc/internet-gateways/create` | POST |
| Listar | `/__admin/ec2/vpc/internet-gateways` | GET |
| Obter | `/__admin/ec2/vpc/internet-gateways/{igwId}` | GET |
| Anexar | `/__admin/ec2/vpc/internet-gateways/{igwId}/attach` | POST |
| Desanexar | `/__admin/ec2/vpc/internet-gateways/{igwId}/detach` | POST |
| Deletar | `/__admin/ec2/vpc/internet-gateways/{igwId}` | DELETE |

### VPC Endpoints

| Operação | Endpoint | Método |
|----------|----------|--------|
| Criar | `/__admin/ec2/vpc/vpc-endpoints/create` | POST |
| Listar | `/__admin/ec2/vpc/vpc-endpoints` | GET |
| Obter | `/__admin/ec2/vpc/vpc-endpoints/{vpceId}` | GET |
| Modificar | `/__admin/ec2/vpc/vpc-endpoints/{vpceId}/modify` | POST |
| Deletar | `/__admin/ec2/vpc/vpc-endpoints/{vpceId}` | DELETE |

## Exemplos de Uso

### Criar VPC Endpoint S3

**Usando AWS CLI (recomendado):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --service-name com.amazonaws.us-east-1.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-12345678 \
  --endpoint-url http://localhost:4020
```

**Alternativa: Direto pela Admin API:**
```bash
VPC_ID="vpc-12345678"
RT_ID="rtb-12345678"

curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d "{
    \"VpcId\": \"$VPC_ID\",
    \"ServiceName\": \"com.amazonaws.us-east-1.s3\",
    \"VpcEndpointType\": \"Gateway\",
    \"RouteTableIds\": [\"$RT_ID\"]
  }"
```

**Nota:** O simulador local processa o comando AWS CLI através da Admin API internamente.

### Criar VPC Endpoint Interface (Lambda)

**Usando AWS CLI (recomendado):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --service-name com.amazonaws.us-east-1.lambda \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-12345678 \
  --endpoint-url http://localhost:4020
```

**Alternativa: Direto pela Admin API:**
```bash
VPC_ID="vpc-12345678"
SUBNET_ID="subnet-12345678"

curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d "{
    \"VpcId\": \"$VPC_ID\",
    \"ServiceName\": \"com.amazonaws.us-east-1.lambda\",
    \"VpcEndpointType\": \"Interface\",
    \"SubnetIds\": [\"$SUBNET_ID\"],
    \"PrivateDnsEnabled\": true
  }"
```

**Nota:** O simulador local processa o comando AWS CLI através da Admin API internamente.

### Criar VPC Endpoint DynamoDB

**Usando AWS CLI (recomendado):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --service-name com.amazonaws.us-east-1.dynamodb \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-12345678 \
  --endpoint-url http://localhost:4020
```

**Alternativa: Direto pela Admin API:**
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-12345678",
    "ServiceName": "com.amazonaws.us-east-1.dynamodb",
    "VpcEndpointType": "Gateway",
    "RouteTableIds": ["rtb-12345678"]
  }'
```

**Nota:** O simulador local processa o comando AWS CLI através da Admin API internamente.

### Visualizar Todos os Recursos

```bash
curl http://localhost:4020/__admin/ec2/resources | jq '.'
```

## Integração Básica

### Lambda + VPC

Lambdas podem executar dentro de uma VPC específica para acessar recursos privados:

```json
{
  "lambdas": [
    {
      "name": "my-function",
      "handler": "./handler.js",
      "vpc": {
        "VpcId": "vpc-xxxxx",
        "SubnetIds": ["subnet-xxxxx"]
      }
    }
  ]
}
```

### VPC + DynamoDB via Endpoint

```bash
# 1. Criar VPC Endpoint Gateway para DynamoDB
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -d '{
    "VpcId": "vpc-12345678",
    "ServiceName": "com.amazonaws.us-east-1.dynamodb",
    "VpcEndpointType": "Gateway",
    "RouteTableIds": ["rtb-12345678"]
  }'

# 2. Lambda em VPC acessa DynamoDB sem internet
# (não é necessário NAT Gateway ou Internet Gateway)
```

## Testing

### Testar Criação de VPC

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpcs/create \
  -H "Content-Type: application/json" \
  -d '{
    "CidrBlock": "172.16.0.0/16",
    "Tags": [{"Key": "Name", "Value": "test-vpc"}]
  }'
```

### Testar Subnet

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "CidrBlock": "172.16.1.0/24",
    "AvailabilityZone": "us-east-1a",
    "Tags": [{"Key": "Name", "Value": "subnet-1"}]
  }'
```

### Testar Route Table

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "Tags": [{"Key": "Name", "Value": "main-rt"}]
  }'
```

### Testar Internet Gateway

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/create \
  -H "Content-Type: application/json" \
  -d '{"Tags": [{"Key": "Name", "Value": "main-igw"}]}'
```

### Testar VPC Endpoint

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "ServiceName": "com.amazonaws.us-east-1.s3",
    "VpcEndpointType": "Gateway",
    "RouteTableIds": ["rtb-xxxxx"]
  }'
```

### Troubleshooting

| Problema | Solução |
|----------|---------|
| "VPC not found" | Use `curl http://localhost:4020/__admin/ec2/vpc/vpcs` para listar VPCs válidos |
| "CIDR block overlaps" | Escolha um CIDR diferente, ex: 172.16.0.0/16 |
| "Cannot delete VPC" | Delete subnets e gateways anexados antes |
| "Port 4020 in use" | Mude a porta do serviço EC2 em `aws-local-simulator.json` |
| "Cannot delete IGW" | Desanexe primeiro com POST `/detach` |

## Referências

- **EC2.md** - Serviço host (EC2 + VPC)
- **QUICK_START_VPC.md** - Guia completo de quick start
- **VPC_TEST_GUIDE.md** - Exemplos avançados de testes
- **INTEGRATION_VPC_GUIDE.md** - Integrações com Lambda, DynamoDB, S3, SQS, SNS
- **AWS VPC Docs** - https://docs.aws.amazon.com/vpc/
