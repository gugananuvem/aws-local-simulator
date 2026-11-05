# VPC Simulator - Quick Start Guide 🚀

## 5 Minutos para Entender o VPC Simulator

### Passo 1: Iniciar o Simulador

```bash
cd c:\Projetos\aws-local-simulator
npm start
```

Você verá:
```
✅ VPC Service inicializado
🔧 Management API rodando em http://localhost:9999
```

### Passo 2: Verificar Saúde do VPC

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

### Passo 3: Criar sua Primeira VPC

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

### Passo 4: Criar uma Subnet

```bash
VPC_ID="vpc-12345678"  # Substitua pelo seu

curl -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -H "Content-Type: application/json" \
  -d "{
    \"VpcId\": \"$VPC_ID\",
    \"CidrBlock\": \"10.0.1.0/24\",
    \"AvailabilityZone\": \"us-east-1a\"
  }"
```

Guarde o `SubnetId`

### Passo 5: Criar um Internet Gateway

```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/create \
  -H "Content-Type: application/json" \
  -d '{}'
```

Guarde o `InternetGatewayId`

### Passo 6: Anexar o Gateway à VPC

```bash
IGW_ID="igw-12345678"  # Substitua pelo seu
VPC_ID="vpc-12345678"  # Substitua pelo seu

curl -X POST http://localhost:4020/__admin/ec2/vpc/internet-gateways/$IGW_ID/attach \
  -H "Content-Type: application/json" \
  -d "{\"VpcId\": \"$VPC_ID\"}"
```

### Passo 7: Criar uma Tabela de Rotas

```bash
VPC_ID="vpc-12345678"  # Substitua pelo seu

curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/create \
  -H "Content-Type: application/json" \
  -d "{\"VpcId\": \"$VPC_ID\"}"
```

Guarde o `RouteTableId`

### Passo 8: Adicionar Rota Padrão (0.0.0.0/0 → IGW)

```bash
RT_ID="rtb-12345678"  # Substitua pelo seu
IGW_ID="igw-12345678"  # Substitua pelo seu

curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/$RT_ID/routes \
  -H "Content-Type: application/json" \
  -d "{
    \"DestinationCidrBlock\": \"0.0.0.0/0\",
    \"Target\": \"$IGW_ID\",
    \"TargetType\": \"igw\"
  }"
```

### Passo 9: Associar Subnet com Route Table

```bash
RT_ID="rtb-12345678"      # Substitua pelo seu
SUBNET_ID="subnet-12345678"  # Substitua pelo seu

curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/$RT_ID/associations \
  -H "Content-Type: application/json" \
  -d "{\"SubnetId\": \"$SUBNET_ID\"}"
```

### Passo 10: Visualizar Tudo que foi Criado

```bash
curl http://localhost:4020/__admin/ec2/resources | jq '.'
```

Você verá:
- 1 VPC
- 1 Subnet
- 1 Route Table
- 1 Internet Gateway
- Todas as rotas e associações

---

## Atalho: Script Completo

Se quer pular para uma arquitetura pronta:

```bash
node examples/vpc-example.js
```

Isso cria automaticamente:
- ✅ 1 VPC (10.0.0.0/16)
- ✅ 2 Subnets Públicas (10.0.1.0/24, 10.0.2.0/24)
- ✅ 1 Subnet Privada (10.0.10.0/24)
- ✅ 1 Internet Gateway
- ✅ 2 Route Tables
- ✅ 1 VPC Endpoint S3

---

## Próximos Passos

### 1. Criar um VPC Endpoint S3

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
VPC_ID="vpc-12345678"      # Substitua
RT_ID="rtb-12345678"        # Substitua

curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d "{
    \"VpcId\": \"$VPC_ID\",
    \"ServiceName\": \"com.amazonaws.us-east-1.s3\",
    \"VpcEndpointType\": \"Gateway\",
    \"RouteTableIds\": [\"$RT_ID\"]
  }"
```

### 2. Criar um VPC Endpoint de Interface (Lambda)

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
VPC_ID="vpc-12345678"      # Substitua
SUBNET_ID="subnet-12345678"  # Substitua

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

### 3. Modificar um VPC Endpoint

```bash
# Usando AWS CLI (recomendado)
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id vpce-12345678 \
  --add-route-table-ids rtb-87654321 \
  --endpoint-url http://localhost:4020

# Remover route table de um endpoint
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id vpce-12345678 \
  --remove-route-table-ids rtb-antigo \
  --endpoint-url http://localhost:4020

> **Nota:** O simulador processa AWS CLI internamente via Admin API. Use `--endpoint-url http://localhost:4020`

# Alternativa: Direto pela Admin API
EP_ID="vpce-12345678"  # Substitua
RT_ID="rtb-87654321"  # Novo Route Table

curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/$EP_ID/modify \
  -H "Content-Type: application/json" \
  -d "{
    \"RouteTableIds\": [\"$RT_ID\"]
  }"
```

---

## Exemplos de Erro (e Como Corrigir)

### ❌ "VPC not found"
Você usou um VPC ID que não existe.
- ✅ Solução: `curl http://localhost:4020/__admin/ec2/vpc/vpcs` para listar VPCs válidos

### ❌ "CIDR block overlaps with existing subnets"
Você tentou criar uma subnet com CIDR que sobrepõe outra.
- ✅ Solução: Use um CIDR diferente (ex: 10.0.2.0/24 em vez de 10.0.1.0/24)

### ❌ "Cannot delete VPC: VPC has subnets"
Você tentou deletar uma VPC com subnets.
- ✅ Solução: Delete as subnets primeiro, depois a VPC

### ❌ "Cannot delete Internet Gateway with attachments"
Você tentou deletar um IGW que ainda está anexado.
- ✅ Solução: Desanexe primeiro com POST `/detach`

---

## Conceitos-Chave

### VPC (Virtual Private Cloud)
Sua rede isolada na nuvem. Exemplo: `10.0.0.0/16`

### Subnet
Um segmento da VPC em uma zona de disponibilidade. Exemplo: `10.0.1.0/24` em `us-east-1a`

### Route Table
Regras de roteamento que definem para onde o tráfego vai. Exemplo: `0.0.0.0/0 → IGW`

### Internet Gateway (IGW)
O portão para a internet. Permite que recursos na VPC acessem a internet.

### VPC Endpoint
Conexão privada com serviços AWS sem sair da VPC. Tipos:
- **Gateway**: S3, DynamoDB
- **Interface**: Lambda, SQS, SNS, etc

---

## Arquitetura Típica

```
┌─────────────────────────────┐
│      VPC 10.0.0.0/16        │
├─────────────────────────────┤
│ Public Subnet 10.0.1.0/24   │
│  └─ Lambda (API)            │
│  └─ Rota: 0.0.0.0/0 → IGW   │
│  └─ IGW → Internet          │
├─────────────────────────────┤
│ Private Subnet 10.0.10.0/24 │
│  └─ Lambda (Database)       │
│  └─ Sem rota para internet  │
│  └─ VPC Endpoint DynamoDB   │
└─────────────────────────────┘
```

---

## Usando com AWS CLI

Você pode usar AWS CLI com o simulador:

```bash
# Configurar endpoint
export AWS_ENDPOINT_URL_EC2=http://localhost:4020

# Mas não use AWS CLI para VPC (use a API REST)
# A API REST é mais rápida neste simulador

curl http://localhost:4020/__admin/ec2/vpc/vpcs
```

---

## Troubleshooting Rápido

| Problema | Causa | Solução |
|----------|-------|---------|
| Conexão recusada | Porta 4020 em uso | Mude porta do serviço EC2 em `aws-local-simulator.json` |
| VPC não encontrado | ID inválido | Use `curl http://localhost:4020/__admin/ec2/vpc/vpcs` |
| Erro de CIDR | CIDR overlap | Escolha outro range (ex: 172.16.0.0/16) |
| Cannot delete | Dependências | Delete recursos associados primeiro |

---

## Dicas Profissionais

1. **Use tags** para organizar recursos
   ```json
   "Tags": [
     {"Key": "Environment", "Value": "dev"},
     {"Key": "Team", "Value": "backend"}
   ]
   ```

2. **Comece simples** com uma VPC, uma subnet, um IGW
3. **Use múltiplos subnets** em múltiplas availability zones para HA
4. **Sempre use VPC Endpoints** para serviços privados
5. **Documenta sua arquitetura** com nomes claros em tags

---

## Resumo dos Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/__admin/ec2/vpc/vpcs/create` | Criar VPC |
| GET | `/__admin/ec2/vpc/vpcs` | Listar VPCs |
| POST | `/__admin/ec2/vpc/subnets/create` | Criar Subnet |
| GET | `/__admin/ec2/vpc/subnets` | Listar Subnets |
| POST | `/__admin/ec2/vpc/route-tables/create` | Criar Route Table |
| POST | `/__admin/ec2/vpc/route-tables/{rtId}/routes` | Adicionar Rota |
| POST | `/__admin/ec2/vpc/internet-gateways/create` | Criar IGW |
| POST | `/__admin/ec2/vpc/internet-gateways/{igwId}/attach` | Anexar IGW |
| POST | `/__admin/ec2/vpc/vpc-endpoints/create` | Criar Endpoint |
| GET | `/__admin/ec2/resources` | Listar Tudo |

---

## Próximas Aulas

Leia também:
- 📖 [VPC_TEST_GUIDE.md](./VPC_TEST_GUIDE.md) - Guia completo de testes
- 📖 [INTEGRATION_VPC_GUIDE.md](./INTEGRATION_VPC_GUIDE.md) - Integrações com outros serviços
- 📖 [src/services/vpc/README.md](./src/services/vpc/README.md) - Documentação técnica

---

## Tempo de Aprendizado

⏱️ **5-10 minutos** - Entender conceitos básicos
⏱️ **15 minutos** - Criar sua primeira VPC
⏱️ **30 minutos** - Dominar todos os recursos
⏱️ **1 hora** - Integrar com Lambda, DynamoDB, S3

---

## Sucesso! 🎉

Você agora pode:
- ✅ Criar e gerenciar VPCs
- ✅ Criar subnets em múltiplas AZs
- ✅ Configurar roteamento
- ✅ Usar Internet Gateways
- ✅ Criar VPC Endpoints
- ✅ Construir arquiteturas completas

Bom desenvolvimento! 🚀
