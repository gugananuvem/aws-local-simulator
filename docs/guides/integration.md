# Guia de Integração entre Serviços

Este guia mostra como integrar múltiplos serviços AWS Local Simulator.

## Índice

- [Visão Geral](#visão-geral)
- [Integrações Implementadas](#integrações-implementadas)
- [Cenários de Uso](#cenários-de-uso)
- [Configuração Completa](#configuração-completa)
- [Troubleshooting](#troubleshooting)

---

## Visão Geral

O VPC Simulator fornece a camada de rede para toda a arquitetura local. Outros serviços podem:
- Operar dentro de VPCs específicas
- Usar subnets para isolamento
- Acessar recursos via VPC Endpoints
- Ser expostos através de Internet Gateways

---

## Integrações Implementadas

### 1. VPC + Lambda

Lambdas podem ser executadas dentro de uma VPC específica:

```json
{
  "lambdas": [
    {
      "name": "my-function",
      "handler": "./handler.js",
      "vpc": {
        "VpcId": "vpc-xxxxx",
        "SubnetIds": ["subnet-xxxxx"],
        "SecurityGroupIds": ["sg-xxxxx"]
      }
    }
  ]
}
```

**Benefícios**:
- Acesso privado a recursos no VPC
- Comunicação com RDS, ElastiCache, etc
- Isolamento de rede

### 2. VPC + API Gateway

API Gateway pode ser associado a subnets específicas:

```json
{
  "apigateway": {
    "apis": [
      {
        "name": "Private API",
        "vpcId": "vpc-xxxxx",
        "endpoints": [
          {
            "path": "/api/users",
            "method": "GET",
            "lambdaName": "my-function"
          }
        ]
      }
    ]
  }
}
```

**Benefícios**:
- APIs restritas a VPC (privadas)
- VPC Endpoints para acesso seguro
- Integração com Lambda em VPC

### 3. VPC + DynamoDB

Crie um VPC Endpoint Gateway para DynamoDB:

**Usando AWS CLI (recomendado):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.us-east-1.dynamodb \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-xxxxx \
  --endpoint-url http://localhost:4020
```

**Alternativa: Direto pela Admin API:**
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "ServiceName": "com.amazonaws.us-east-1.dynamodb",
    "VpcEndpointType": "Gateway",
    "RouteTableIds": ["rtb-xxxxx"]
  }'
```

**Nota:** O simulador local processa o comando AWS CLI através da Admin API internamente. Use `--endpoint-url http://localhost:4020` para direcionar para o simulador.

**Benefícios**:
- Acesso a DynamoDB sem sair do VPC
- Rota privada (sem internet)
- Melhor segurança e performance

### 4. VPC + S3

Crie um VPC Endpoint Gateway para S3:

**Usando AWS CLI (recomendado):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.us-east-1.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-xxxxx \
  --endpoint-url http://localhost:4020
```

**Alternativa: Direto pela Admin API:**
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

**Nota:** O simulador local processa o comando AWS CLI através da Admin API internamente. Use `--endpoint-url http://localhost:4020` para direcionar para o simulador.

**Benefícios**:
- Lambda em VPC acessa S3 sem NAT Gateway
- Economiza custos de transferência
- Rota privada

### 5. VPC + SQS

Crie um VPC Endpoint Interface para SQS:

**Usando AWS CLI (recomendado):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.us-east-1.sqs \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-xxxxx \
  --endpoint-url http://localhost:4020
```

**Alternativa: Direto pela Admin API:**
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "ServiceName": "com.amazonaws.us-east-1.sqs",
    "VpcEndpointType": "Interface",
    "SubnetIds": ["subnet-xxxxx"],
    "PrivateDnsEnabled": true
  }'
```

**Nota:** O simulador local processa o comando AWS CLI através da Admin API internamente. Use `--endpoint-url http://localhost:4020` para direcionar para o simulador.

**Benefícios**:
- Lambda acessa SQS via endpoint privado
- Resolução DNS automática
- Segurança de rede

### 6. VPC + SNS

Crie um VPC Endpoint Interface para SNS:

**Usando AWS CLI (recomendado):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.us-east-1.sns \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-xxxxx \
  --endpoint-url http://localhost:4020
```

**Alternativa: Direto pela Admin API:**
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "ServiceName": "com.amazonaws.us-east-1.sns",
    "VpcEndpointType": "Interface",
    "SubnetIds": ["subnet-xxxxx"],
    "PrivateDnsEnabled": true
  }'
```

**Nota:** O simulador local processa o comando AWS CLI através da Admin API internamente. Use `--endpoint-url http://localhost:4020` para direcionar para o simulador.

### 7. VPC + CloudFormation

CloudFormation pode criar recursos VPC via templates:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyVPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
      EnableDnsHostnames: true
      Tags:
        - Key: Name
          Value: cf-vpc

  PublicSubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref MyVPC
      CidrBlock: 10.0.1.0/24
      AvailabilityZone: us-east-1a
      MapPublicIpOnLaunch: true

  InternetGateway:
    Type: AWS::EC2::InternetGateway

  AttachGateway:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties:
      VpcId: !Ref MyVPC
      InternetGatewayId: !Ref InternetGateway

  RouteTable:
    Type: AWS::EC2::RouteTable
    Properties:
      VpcId: !Ref MyVPC

  Route:
    Type: AWS::EC2::Route
    Properties:
      RouteTableId: !Ref RouteTable
      DestinationCidrBlock: 0.0.0.0/0
      GatewayId: !Ref InternetGateway

  SubnetAssociation:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties:
      SubnetId: !Ref PublicSubnet
      RouteTableId: !Ref RouteTable

Outputs:
  VpcId:
    Value: !Ref MyVPC
  SubnetId:
    Value: !Ref PublicSubnet
```

---

## Cenários de Uso

### Cenário 1: Arquitetura Web com Banco de Dados Privado

```
┌─────────────────────────────────────┐
│           VPC 10.0.0.0/16           │
├─────────────────────────────────────┤
│ Public Subnets (1a, 1b)             │
│   └─ Lambda (API)                   │
│   └─ API Gateway                    │
│   └─ IGW → Internet                 │
├─────────────────────────────────────┤
│ Private Subnets (1a, 1b)            │
│   └─ Lambda (Database)              │
│   └─ RDS/DynamoDB                   │
│   └─ VPC Endpoint DynamoDB          │
└─────────────────────────────────────┘
```

**Implementação**:

```bash
# 1. Criar VPC
VPC=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/vpcs/create \
  -d '{"CidrBlock":"10.0.0.0/16"}' | jq -r '.Vpc.VpcId')

# 2. Criar subnets públicas
SUBNET_PUBLIC=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -d "{\"VpcId\":\"$VPC\",\"CidrBlock\":\"10.0.1.0/24\",\"AvailabilityZone\":\"us-east-1a\",\"MapPublicIpOnLaunch\":true}" | jq -r '.Subnet.SubnetId')

# 3. Criar subnets privadas
SUBNET_PRIVATE=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -d "{\"VpcId\":\"$VPC\",\"CidrBlock\":\"10.0.10.0/24\",\"AvailabilityZone\":\"us-east-1a\"}" | jq -r '.Subnet.SubnetId')

# 4. Criar IGW e anexar
IGW=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/create | jq -r '.InternetGateway.InternetGatewayId')
curl -s -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/$IGW/attach -d "{\"VpcId\":\"$VPC\"}"

# 5. Criar route tables
RT_PUBLIC=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/create \
  -d "{\"VpcId\":\"$VPC\"}" | jq -r '.RouteTable.RouteTableId')

RT_PRIVATE=$(curl -s -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/create \
  -d "{\"VpcId\":\"$VPC\"}" | jq -r '.RouteTable.RouteTableId')

# 6. Adicionar rotas
curl -s -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/$RT_PUBLIC/routes \
  -d "{\"DestinationCidrBlock\":\"0.0.0.0/0\",\"Target\":\"$IGW\",\"TargetType\":\"igw\"}"

# 7. Associar subnets
curl -s -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/$RT_PUBLIC/associations \
  -d "{\"SubnetId\":\"$SUBNET_PUBLIC\"}"

curl -s -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/$RT_PRIVATE/associations \
  -d "{\"SubnetId\":\"$SUBNET_PRIVATE\"}"

# 8. Criar VPC Endpoints
curl -s -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -d "{\"VpcId\":\"$VPC\",\"ServiceName\":\"com.amazonaws.us-east-1.dynamodb\",\"VpcEndpointType\":\"Gateway\",\"RouteTableIds\":[\"$RT_PRIVATE\"]}"

# 9. Atualizar config de Lambda
# Adicionar VPC à função Lambda que acessa DynamoDB
```

### Cenário 2: Microserviços com Service Mesh

```
┌──────────────────────────────┐
│    VPC 10.0.0.0/16           │
├──────────────────────────────┤
│ Service 1 (Subnet 1)         │
│  └─ Lambda (Users)           │
│  └─ VPC Endpoint SQS         │
├──────────────────────────────┤
│ Service 2 (Subnet 2)         │
│  └─ Lambda (Orders)          │
│  └─ VPC Endpoint SNS         │
├──────────────────────────────┤
│ Data Layer (Subnet 3)        │
│  └─ Lambda (Data Processor)  │
│  └─ VPC Endpoint DynamoDB    │
└──────────────────────────────┘
```

### Cenário 3: Arquitetura Híbrida (On-Premises + VPC)

```
On-Premises           AWS
────────────         ─────
Data Center  ←─VPN─→ VPC
  (Network)         10.0.0.0/16
                    VPN Gateway
                    Customer Gateway
```

---

## Configuração Completa

```json
{
  "services": {
    "vpc": true,
    "lambda": true,
    "dynamodb": true,
    "s3": true,
    "sqs": true,
    "apigateway": true
  },
  "vpc": {
    "vpcs": [
      {
        "CidrBlock": "10.0.0.0/16",
        "Tags": [{"Key": "Name", "Value": "production-vpc"}]
      }
    ],
    "subnets": [
      {
        "VpcId": "vpc-prod",
        "CidrBlock": "10.0.1.0/24",
        "AvailabilityZone": "us-east-1a",
        "MapPublicIpOnLaunch": true,
        "Tags": [{"Key": "Name", "Value": "public-1a"}]
      },
      {
        "VpcId": "vpc-prod",
        "CidrBlock": "10.0.10.0/24",
        "AvailabilityZone": "us-east-1a",
        "MapPublicIpOnLaunch": false,
        "Tags": [{"Key": "Name", "Value": "private-1a"}]
      }
    ]
  },
  "lambdas": [
    {
      "name": "api-handler",
      "handler": "./handlers/api.js",
      "vpc": {
        "VpcId": "vpc-prod",
        "SubnetIds": ["subnet-public-1a"]
      },
      "env": {
        "DYNAMODB_TABLE": "users"
      }
    },
    {
      "name": "database-processor",
      "handler": "./handlers/processor.js",
      "vpc": {
        "VpcId": "vpc-prod",
        "SubnetIds": ["subnet-private-1a"]
      }
    }
  ],
  "dynamodb": {
    "tables": [
      {
        "TableName": "users",
        "KeySchema": [{"AttributeName": "id", "KeyType": "HASH"}],
        "AttributeDefinitions": [{"AttributeName": "id", "AttributeType": "S"}]
      }
    ]
  }
}
```

---

## Troubleshooting

### Lambda não consegue acessar DynamoDB via VPC Endpoint

**Problema**: Lambda em VPC mas sem endpoint

**Solução**: Crie VPC Endpoint Gateway para DynamoDB na route table da subnet

### API Gateway não consegue atingir Lambda em VPC

**Problema**: API Gateway configurado para VPC diferente

**Solução**: Ambos devem estar no mesmo VPC e subnets conectadas

### Timeout ao acessar recurso privado

**Problema**: Rota não configurada corretamente

**Solução**: Verificar route table e endpoints

---

## Documentação de Referência

- [VPC Service README](./src/services/vpc/README.md)
- [VPC Test Guide](./VPC_TEST_GUIDE.md)
- [AWS VPC Documentation](https://docs.aws.amazon.com/vpc/)
