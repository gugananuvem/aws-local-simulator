# AWS VPC Simulator - Guia de Testes

## 1. Iniciar o Simulador

```bash
npm start
```

O serviço VPC estará disponível em `http://localhost:4020`

## 2. Testar VPCs

### Criar uma VPC
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpcs/create \
  -H "Content-Type: application/json" \
  -d '{
    "CidrBlock": "172.16.0.0/16",
    "Tags": [
      { "Key": "Name", "Value": "test-vpc" }
    ]
  }'
```

### Listar todas as VPCs
```bash
curl http://localhost:4020/__admin/ec2/vpc/vpcs
```

### Obter VPC específica
```bash
curl http://localhost:4020/__admin/ec2/vpc/vpcs/vpc-xxxxx
```

### Modificar atributos da VPC
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpcs/vpc-xxxxx/attributes \
  -H "Content-Type: application/json" \
  -d '{
    "attribute": "enableDnsHostnames",
    "value": true
  }'
```

### Deletar VPC
```bash
curl -X DELETE http://localhost:4020/__admin/ec2/vpc/vpcs/vpc-xxxxx
```

## 3. Testar Subnets

### Criar Subnet
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "CidrBlock": "172.16.1.0/24",
    "AvailabilityZone": "us-east-1a",
    "Tags": [
      { "Key": "Name", "Value": "subnet-1" }
    ]
  }'
```

### Listar Subnets
```bash
curl "http://localhost:4020/__admin/ec2/vpc/subnets?vpcIds=vpc-xxxxx"
```

### Obter Subnet
```bash
curl http://localhost:4020/__admin/ec2/vpc/subnets/subnet-xxxxx
```

### Deletar Subnet
```bash
curl -X DELETE http://localhost:4020/__admin/ec2/vpc/subnets/subnet-xxxxx
```

## 4. Testar Route Tables

### Criar Route Table
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "Tags": [
      { "Key": "Name", "Value": "main-rt" }
    ]
  }'
```

### Listar Route Tables
```bash
curl "http://localhost:4020/__admin/ec2/vpc/route-tables?vpcIds=vpc-xxxxx"
```

### Adicionar Rota (Internet Gateway)
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/rtb-xxxxx/routes \
  -H "Content-Type: application/json" \
  -d '{
    "DestinationCidrBlock": "0.0.0.0/0",
    "Target": "igw-xxxxx",
    "TargetType": "igw"
  }'
```

### Adicionar Rota (NAT Gateway)
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/rtb-xxxxx/routes \
  -H "Content-Type: application/json" \
  -d '{
    "DestinationCidrBlock": "0.0.0.0/0",
    "Target": "natgw-xxxxx",
    "TargetType": "nat"
  }'
```

### Remover Rota
```bash
curl -X DELETE "http://localhost:4020/__admin/ec2/vpc/route-tables/rtb-xxxxx/routes/0.0.0.0%2F0"
```

### Associar Route Table com Subnet
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/rtb-xxxxx/associations \
  -H "Content-Type: application/json" \
  -d '{
    "SubnetId": "subnet-xxxxx"
  }'
```

### Desassociar Route Table
```bash
curl -X DELETE http://localhost:4020/__admin/ec2/vpc/route-tables/rtb-xxxxx/associations/subnet-xxxxx
```

## 5. Testar Internet Gateways

### Criar Internet Gateway
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/create \
  -H "Content-Type: application/json" \
  -d '{
    "Tags": [
      { "Key": "Name", "Value": "main-igw" }
    ]
  }'
```

### Listar Internet Gateways
```bash
curl http://localhost:4020/__admin/ec2/vpc/internet-gateways
```

### Obter Internet Gateway
```bash
curl http://localhost:4020/__admin/ec2/vpc/internet-gateways/igw-xxxxx
```

### Anexar Internet Gateway
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/igw-xxxxx/attach \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx"
  }'
```

### Desanexar Internet Gateway
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/igw-xxxxx/detach \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx"
  }'
```

### Deletar Internet Gateway
```bash
curl -X DELETE http://localhost:4020/__admin/ec2/vpc/internet-gateways/igw-xxxxx
```

## 6. Testar VPC Endpoints

### Criar VPC Endpoint (Gateway - S3)

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

### Criar VPC Endpoint (Gateway - DynamoDB)

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

### Criar VPC Endpoint (Interface - Lambda)

**Usando AWS CLI (recomendado):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.us-east-1.lambda \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-xxxxx \
  --security-group-ids sg-xxxxx \
  --endpoint-url http://localhost:4020
```

**Alternativa: Direto pela Admin API:**
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "ServiceName": "com.amazonaws.us-east-1.lambda",
    "VpcEndpointType": "Interface",
    "SubnetIds": ["subnet-xxxxx"],
    "SecurityGroupIds": ["sg-xxxxx"],
    "PrivateDnsEnabled": true
  }'
```

### Listar VPC Endpoints
```bash
curl "http://localhost:4020/__admin/ec2/vpc/vpc-endpoints?vpcIds=vpc-xxxxx"
```

### Obter VPC Endpoint
```bash
curl http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/vpce-xxxxx
```

### Modificar VPC Endpoint

```bash
# Usando AWS CLI (recomendado)
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id vpce-xxxxx \
  --add-route-table-ids rtb-xxxxx \
  --endpoint-url http://localhost:4020

# Remover route table de um endpoint
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id vpce-xxxxx \
  --remove-route-table-ids rtb-antigo \
  --endpoint-url http://localhost:4020

> **Nota:** O simulador processa AWS CLI internamente via Admin API. Use `--endpoint-url http://localhost:4020`

# Alternativa: Direto pela Admin API
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/vpce-xxxxx/modify \
  -H "Content-Type: application/json" \
  -d '{
    "RouteTableIds": ["rtb-xxxxx", "rtb-yyyyy"]
  }'
```

### Deletar VPC Endpoint

```bash
# Usando AWS CLI (recomendado)
aws ec2 delete-vpc-endpoints \
  --vpc-endpoint-ids vpce-xxxxx \
  --endpoint-url http://localhost:4020

> **Nota:** O simulador processa AWS CLI internamente via Admin API. Use `--endpoint-url http://localhost:4020`

# Alternativa: Direto pela Admin API
curl -X DELETE http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/vpce-xxxxx
```

## 7. Testar Health Check

```bash
curl http://localhost:4020/__admin/ec2/health
```

## 8. Listar Todos os Recursos

```bash
curl http://localhost:4020/__admin/ec2/resources
```

## 9. Usar AWS CLI

O simulador VPC suporta AWS CLI quando configurado:

```bash
# Configurar endpoint
export AWS_ENDPOINT_URL_VPC=http://localhost:4020

# Listar VPCs (nota: não é um comando padrão da AWS CLI, use a API)
curl http://localhost:4020/__admin/ec2/vpc/vpcs
```

## Exemplos PowerShell

Se usar PowerShell, as sintaxes são:

```powershell
# Criar VPC
$body = @{
  CidrBlock = "172.16.0.0/16"
  Tags = @(@{ Key = "Name"; Value = "test-vpc" })
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:4020/__admin/ec2/vpc/vpcs/create" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body

# Listar VPCs
Invoke-WebRequest -Uri "http://localhost:4020/__admin/ec2/vpc/vpcs" | ConvertFrom-Json
```

## Notas Importantes

1. **Dependências de Recurso**: Você não pode deletar uma VPC enquanto houver subnets ou IGWs anexados
2. **Route Tables**: Toda VPC tem uma route table principal com a rota local automaticamente
3. **CIDR Blocks**: O simulador valida sobreposição de CIDR blocks entre subnets
4. **VPC Endpoints**: S3 e DynamoDB são Gateway endpoints, Lambda/SQS/SNS são Interface endpoints
5. **Tags**: Todos os recursos suportam tags para melhor organização

## Troubleshooting

- **Porta 4020 já está em uso**: Mude a porta do serviço EC2 no `aws-local-simulator.json`
- **Erro ao deletar**: Verifique dependências (subnets, gateways associados)
- **CIDR Overlap**: Confirme que os ranges não se sobrepõem
