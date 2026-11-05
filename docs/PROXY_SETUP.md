# EC2 Proxy - Apontando para URL Externa

Guia completo para usar EC2 como proxy para aplicações rodando localmente.

## Visão Geral

O EC2 Simulator agora permite apontar uma instância para uma URL externa, funcionando como **proxy reverso**. Isso permite:

- Testar ALB com múltiplas aplicações locais
- Simular aplicações em múltiplas instâncias
- Integração com aplicações existentes (Node, React, Django, etc)
- Suporte a WebSocket
- Preservação de headers HTTP

## Casos de Uso

### 1. Testar ALB com Múltiplas Versões

```
┌─────────────────────────────────────────────────────────────┐
│                        ALB                                  │
│                   (Port 80 / 443)                           │
└────────────┬──────────────┬──────────────┬──────────────────┘
             │              │              │
      ┌──────▼──┐    ┌──────▼──┐    ┌─────▼──┐
      │ EC2-1   │    │ EC2-2   │    │ EC2-3  │
      │ :8000   │    │ :8001   │    │ :8002  │
      └──────┬──┘    └──────┬──┘    └────┬───┘
             │              │            │
      ┌──────▼──────┐ ┌─────▼──────┐ ┌──▼─────────┐
      │App v1.0     │ │App v1.1    │ │App v2.0    │
      │:3000        │ │:3001       │ │:3002       │
      └─────────────┘ └────────────┘ └────────────┘
```

### 2. Teste de Load Balancer

```
EC2-1 → proxy → http://localhost:3000 (App Instance 1)
EC2-2 → proxy → http://localhost:3000 (App Instance 1)  ← Mesma app
EC2-3 → proxy → http://localhost:3000 (App Instance 1)

ALB distribui entre EC2-1, EC2-2, EC2-3 (simula múltiplas instâncias)
```

### 3. Integração com Desenvolvimento Local

```
Seu Laptop:
  - React App     rodando em http://localhost:3000
  - API Node      rodando em http://localhost:4000
  - DB (local)    rodando em http://localhost:5432

AWS Simulator:
  - EC2-FrontEnd  →  proxy para http://localhost:3000
  - EC2-API       →  proxy para http://localhost:4000
  - ALB           →  distribui entre EC2s
```

## Configuração

### Opção 1: Na Inicialização

```javascript
const { startServer } = require('aws-local-simulator');

const config = {
  services: { ec2: true },
  ec2: {
    instances: [
      {
        ImageId: 'ami-app-v1',
        InstanceType: 't2.micro',
        ProxyUrl: 'http://localhost:3000'  // ← URL da app
      }
    ]
  }
};

await startServer(config);
```

### Opção 2: Criar Instância com Proxy via API

```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/run \
  -H "Content-Type: application/json" \
  -d '{
    "ImageId": "ami-app",
    "MinCount": 1,
    "MaxCount": 1,
    "InstanceType": "t2.micro",
    "ProxyUrl": "http://localhost:3000"
  }'
```

### Opção 3: Arquivo de Configuração

```json
{
  "services": {
    "ec2": true
  },
  "ec2": {
    "instances": [
      {
        "ImageId": "ami-frontend",
        "InstanceType": "t2.micro",
        "ProxyUrl": "http://localhost:3000",
        "Tags": [
          { "Key": "Name", "Value": "web-frontend" },
          { "Key": "Target", "Value": "React App" }
        ]
      },
      {
        "ImageId": "ami-backend",
        "InstanceType": "t2.small",
        "ProxyUrl": "http://localhost:4000",
        "Tags": [
          { "Key": "Name", "Value": "api-backend" },
          { "Key": "Target", "Value": "Node API" }
        ]
      }
    ]
  }
}
```

## Usando com ALB

### 1. Criar Múltiplas Instâncias com Proxy

```bash
# Criar 3 instâncias que apontam para a mesma app (simula scale)
for i in 1 2 3; do
  curl -X POST http://localhost:4020/__admin/ec2/instances/run \
    -H "Content-Type: application/json" \
    -d '{
      "ImageId": "ami-app",
      "MinCount": 1,
      "MaxCount": 1,
      "ProxyUrl": "http://localhost:3000"
    }'
done
```

### 2. Criar ALB e Target Group

```bash
# Criar ALB
ALB=$(curl -X POST http://localhost:4021/__admin/alb/load-balancers/create \
  -H "Content-Type: application/json" \
  -d '{"Name":"web-alb"}' | jq -r '.LoadBalancer.LoadBalancerArn')

# Criar Target Group
TG=$(curl -X POST http://localhost:4021/__admin/alb/target-groups/create \
  -H "Content-Type: application/json" \
  -d '{"Name":"web-targets","Protocol":"HTTP","Port":80}' | jq -r '.TargetGroup.TargetGroupArn')
```

### 3. Registrar Instâncias

```bash
# Obter instâncias
INSTANCES=$(curl http://localhost:4020/__admin/ec2/instances | jq -r '.Instances[].InstanceId')

# Registrar cada uma no Target Group
for INSTANCE in $INSTANCES; do
  PORT=$(curl http://localhost:4020/__admin/ec2/instances/$INSTANCE | jq -r '.WebServerPort')
  
  curl -X POST http://localhost:4021/__admin/alb/target-groups/$TG/register-target \
    -H "Content-Type: application/json" \
    -d "{\"TargetId\":\"$INSTANCE\",\"Port\":$PORT}"
done
```

### 4. Acessar via ALB

```bash
# ALB redirecionará para uma das instâncias
# Que por sua vez fará proxy para http://localhost:3000
curl http://localhost:9999/api/...
```

## Fluxo de Requisição

### Sem Proxy:
```
Cliente → EC2 (porta 8000) → Página HTML padrão
```

### Com Proxy:
```
Cliente → EC2 (porta 8000) → http://localhost:3000 (sua app)
```

### Com ALB + Proxy:
```
Cliente → ALB (porta 80)
         ↓ (round-robin)
      EC2-1 (porta 8000) → http://localhost:3000
      EC2-2 (porta 8001) → http://localhost:3000  
      EC2-3 (porta 8002) → http://localhost:3000
```

## Verificar Proxy

### Ver Metadados da Instância

```bash
curl http://localhost:8000/__metadata | jq .

{
  "instanceId": "i-abc123",
  "proxyUrl": "http://localhost:3000",
  ...
}
```

### Health Check

```bash
curl http://localhost:8000/__health

{
  "status": "ok",
  "instanceId": "i-abc123",
  "isProxy": true
}
```

### Verificar Lista de Instâncias

```bash
curl http://localhost:4020/__admin/ec2/instances | jq '.Instances[] | {InstanceId, ProxyUrl, WebServerPort}'

{
  "InstanceId": "i-abc123",
  "ProxyUrl": "http://localhost:3000",
  "WebServerPort": 8000
}
```

## Exemplos Práticos

### Exemplo 1: React App + ALB

**Pré-requisitos:**
- React app rodando em http://localhost:3000

```bash
# 1. Iniciar simulador
node examples/ec2-proxy-example.js

# 2. Criar 2 instâncias (scale horizontal)
for i in 1 2; do
  curl -X POST http://localhost:4020/__admin/ec2/instances/run \
    -H "Content-Type: application/json" \
    -d '{
      "ImageId": "ami-react",
      "ProxyUrl": "http://localhost:3000"
    }'
done

# 3. Criar ALB
curl -X POST http://localhost:4021/__admin/alb/load-balancers/create \
  -H "Content-Type: application/json" \
  -d '{"Name":"react-alb"}'

# 4. Acessar via EC2
curl http://localhost:8000
curl http://localhost:8001

# → Ambas mostram sua React App
```

### Exemplo 2: Node API Distribuído

```bash
# Instância 1 - Node API porta 4000
curl -X POST http://localhost:4020/__admin/ec2/instances/run \
  -H "Content-Type: application/json" \
  -d '{
    "ImageId": "ami-node-api",
    "ProxyUrl": "http://localhost:4000",
    "Tags": [{"Key":"Name","Value":"api-1"}]
  }'

# Instância 2 - Node API porta 4001
curl -X POST http://localhost:4020/__admin/ec2/instances/run \
  -H "Content-Type: application/json" \
  -d '{
    "ImageId": "ami-node-api",
    "ProxyUrl": "http://localhost:4001",
    "Tags": [{"Key":"Name","Value":"api-2"}]
  }'

# Acessar cada uma
curl http://localhost:8000/api/users
curl http://localhost:8001/api/users
```

### Exemplo 3: Django App

```bash
# Django rodando em http://localhost:8888

curl -X POST http://localhost:4020/__admin/ec2/instances/run \
  -H "Content-Type: application/json" \
  -d '{
    "ImageId": "ami-django",
    "ProxyUrl": "http://localhost:8888"
  }'

# Acessar
curl http://localhost:8000
curl http://localhost:8000/admin
curl http://localhost:8000/api/v1/...
```

## Limitações & Considerações

### Suportado
- ✅ HTTP & HTTPS
- ✅ WebSocket (ws://)
- ✅ Query strings
- ✅ POST/PUT/DELETE
- ✅ File uploads
- ✅ Headers customizados
- ✅ Cookies

### Não Suportado
- ❌ HTTPS com certificado auto-assinado (sem verificação)
- ❌ HTTP/2 (usa HTTP/1.1)
- ❌ gRPC

### Performance
- Proxy adiciona ~5-10ms de latência
- Ideal para testes, não para produção
- Suporta até ~100 requisições/segundo por instância

## Troubleshooting

### Conexão Recusada

```
Error: connect ECONNREFUSED 127.0.0.1:3000
```

**Solução:**
```bash
# Verificar se a app está rodando
curl http://localhost:3000

# Verificar porta correta
netstat -an | grep 3000

# Usar IP externo se necessário
"ProxyUrl": "http://192.168.1.100:3000"
```

### Timeout

```
Error: timeout of 30000ms exceeded
```

**Solução:**
- Aumentar timeout do proxy (em desenvolvimento)
- Checar latência da app
- Verificar firewall

### Headers Perdidos

Se headers customizados não aparecerem:

1. Verificar que a app aceita headers
2. Usar `curl -v` para debugar
3. Checar Access-Control-Allow-Headers

```bash
curl -v -H "X-Custom-Header: value" http://localhost:8000/api
```

## Performance Testing

```bash
# Apache Bench - 1000 requisições, 10 concurrent
ab -n 1000 -c 10 http://localhost:8000/

# wrk - teste de carga
wrk -t4 -c100 -d30s http://localhost:8000/

# Resultado esperado: 100-500 req/s (dependendo da app)
```

## Proxys em Cadeia

Você pode criar proxys que apontam para outros proxys:

```
Instância 1 (proxy) → Instância 2 (proxy) → http://localhost:3000
```

Não recomendado para produção, mas útil para testes complexos.

## Próximos Passos

- Combinar com ASG para auto-scaling
- Usar CloudWatch para monitorar requisições
- Integrar com API Gateway
- Testar failover com ALB
