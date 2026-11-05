# Guia de Troubleshooting

## Problemas Comuns

### 1. Porta Já Está em Uso

**Erro**: `EADDRINUSE: address already in use :::4566`

**Causa**: Outra aplicação está usando a porta

**Solução**:

#### Linux/Mac
```bash
# Identificar processo
lsof -i :4566

# Matar processo (se necessário)
kill -9 <PID>
```

#### Windows (PowerShell)
```powershell
# Identificar processo
netstat -ano | findstr :4566

# Matar processo
taskkill /PID <PID> /F
```

**Alternativa**: Mudar porta no `aws-local-simulator.json`:

```json
{
  "ports": {
    "s3": 4567,
    "dynamodb": 8001
  }
}
```

---

### 2. Simulador Não Inicia

**Erro**: `Error: Cannot find module 'aws-sdk'`

**Causa**: Dependências não instaladas

**Solução**:
```bash
npm install
npm start
```

**Se persistir**:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### 3. Lambda Função Não Encontrada

**Erro**: `UnknownFunction: Could not find function`

**Causa**: Lambda não foi carregada na inicialização

**Solução**:

1. Verificar `aws-local-simulator.json`:
```json
{
  "lambdas": [
    {
      "name": "my-function",
      "handler": "./handlers/index.js",
      "env": {}
    }
  ]
}
```

2. Verificar se arquivo existe:
```bash
ls -la ./handlers/index.js
```

3. Verificar sintaxe do handler:
```javascript
// ✅ Correto
exports.handler = async (event) => {
  return { statusCode: 200, body: 'OK' };
};

// ❌ Errado
module.exports = async (event) => { // handler.handler não encontrará
  return { statusCode: 200 };
};
```

---

### 4. DynamoDB Tabela Não Encontrada

**Erro**: `ResourceNotFoundException: Requested resource not found`

**Causa**: Tabela não foi criada ou nome está incorreto

**Solução**:

1. Listar tabelas:
```bash
aws dynamodb list-tables --endpoint-url http://localhost:8000
```

2. Criar tabela:
```bash
aws dynamodb create-table \
  --table-name users-table \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000
```

3. Verificar status:
```bash
aws dynamodb describe-table \
  --table-name users-table \
  --endpoint-url http://localhost:8000 | jq '.Table.TableStatus'
```

---

### 5. S3 Bucket Acesso Negado

**Erro**: `AccessDenied: Access Denied`

**Causa**: Permissões IAM ou política de bucket

**Solução**:

1. Criar bucket corretamente:
```bash
aws s3 mb s3://my-bucket --endpoint-url http://localhost:4566
```

2. Listar buckets para confirmar:
```bash
aws s3 ls --endpoint-url http://localhost:4566
```

3. Se bucket existe mas acesso negado, verificar configuração:
```bash
aws s3api head-bucket \
  --bucket my-bucket \
  --endpoint-url http://localhost:4566
```

---

### 6. SQS Mensagem Não É Processada

**Erro**: Mensagem fica na fila, Lambda não é acionada

**Causa**: Event source não configurado

**Solução**:

1. Verificar se fila existe:
```bash
aws sqs list-queues --endpoint-url http://localhost:9324
```

2. Enviar mensagem manualmente:
```bash
aws sqs send-message \
  --queue-url http://localhost:9324/queue/my-queue \
  --message-body "test" \
  --endpoint-url http://localhost:9324
```

3. Receber mensagem:
```bash
aws sqs receive-message \
  --queue-url http://localhost:9324/queue/my-queue \
  --endpoint-url http://localhost:9324
```

4. Configurar Lambda trigger em `aws-local-simulator.json`:
```json
{
  "lambdas": [
    {
      "name": "process-queue",
      "handler": "./handler.js",
      "triggers": [
        {
          "type": "sqs",
          "source": "my-queue",
          "batchSize": 10
        }
      ]
    }
  ]
}
```

---

### 7. Timeout de Conexão

**Erro**: `RequestTimeout: Request timed out`

**Causa**: Serviço não responde ou está overloaded

**Solução**:

1. Verificar se serviço está rodando:
```bash
curl http://localhost:4566/__admin/ec2/health
```

2. Aumentar timeout no cliente:
```javascript
const s3 = new AWS.S3({
  endpoint: 'http://localhost:4566',
  httpOptions: {
    timeout: 30000 // 30 segundos
  }
});
```

3. Se timeout persistir, reiniciar serviço:
```bash
npm start -- --restart
```

---

### 8. VPC Subnet CIDR Overlap

**Erro**: `InvalidParameterValue: The CIDR '10.0.1.0/24' conflicts with existing CIDR in the VPC`

**Causa**: CIDR blocks se sobrepõem

**Solução**:

1. Verificar subnets existentes:
```bash
curl http://localhost:4020/__admin/ec2/vpc/subnets
```

2. Usar CIDR diferente:
```bash
# ❌ Conflita com 10.0.1.0/24
curl -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -d '{"VpcId":"vpc-xxx","CidrBlock":"10.0.1.128/25"}'

# ✅ OK
curl -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -d '{"VpcId":"vpc-xxx","CidrBlock":"10.0.2.0/24"}'
```

---

### 9. Lambda em VPC Não Consegue Acessar Recurso

**Erro**: `TimeoutError: Connection timeout`

**Causa**: Lambda não tem rota ou VPC Endpoint não configurado

**Solução**:

1. Verificar rota table:
```bash
curl "http://localhost:4020/__admin/ec2/vpc/route-tables?vpcIds=vpc-xxx"
```

2. Criar VPC Endpoint para serviço:
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpc-endpoints/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxx",
    "ServiceName": "com.amazonaws.us-east-1.dynamodb",
    "VpcEndpointType": "Gateway",
    "RouteTableIds": ["rtb-xxx"]
  }'
```

3. Adicionar rota default se necessário:
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/route-tables/rtb-xxx/routes \
  -d '{
    "DestinationCidrBlock": "0.0.0.0/0",
    "Target": "igw-xxx",
    "TargetType": "igw"
  }'
```

---

### 10. Credenciais Expiradas

**Erro**: `InvalidToken: The provided token is invalid`

**Causa**: SessionToken expirou

**Solução**:

1. Verificar token:
```bash
aws sts get-caller-identity \
  --aws-session-token <token> \
  --endpoint-url http://localhost:9326
```

2. Obter novo token:
```bash
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/developer \
  --role-session-name new-session \
  --endpoint-url http://localhost:9326
```

---

## Logs e Debugging

### Ver Logs do Simulador

```bash
# Debug detalhado
npm start -- --log-level debug

# Apenas warnings e errors
npm start -- --log-level warn
```

### Logs por Serviço

**CloudTrail**:
```bash
curl http://localhost:4012/__admin/events
```

**CloudWatch Logs**:
```bash
curl http://localhost:4011/__admin/log-groups
```

### Inspecionar Dados

**DynamoDB**:
```bash
curl http://localhost:8000/__admin/tables
```

**S3**:
```bash
curl http://localhost:4566/__admin/buckets
```

**SQS**:
```bash
curl http://localhost:9324/__admin/queues
```

**Lambda**:
```bash
curl http://localhost:3001/__admin/functions
```

**VPC**:
```bash
curl http://localhost:4020/__admin/ec2/resources
```

---

## Performance

### Problema: Respostas Lentas

**Verificações**:

1. CPU/Memória disponível:
```bash
# Linux/Mac
top

# Windows
Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 5
```

2. Conexões abertas:
```bash
lsof -p <pid>
```

3. Aumentar timeout:
```json
{
  "httpOptions": {
    "timeout": 60000,
    "keepAliveTimeout": 30000
  }
}
```

### Problema: Memory Leak

**Sintomas**: Uso de memória cresce com o tempo

**Solução**:

1. Reiniciar simulador periodicamente:
```bash
npm start -- --restart-interval 3600000 # 1 hora
```

2. Limpar dados entre testes:
```javascript
// Limpar tabelas DynamoDB
await dynamodb.deleteTable({ TableName: 'test-table' }).promise();

// Limpar buckets S3
await s3.deleteBucket({ Bucket: 'test-bucket' }).promise();
```

---

## Integração com CI/CD

### GitHub Actions

```yaml
name: Test

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Start simulator
        run: npm start &
        
      - name: Wait for services
        run: sleep 10
      
      - name: Run tests
        run: npm test
```

### GitLab CI

```yaml
image: node:18

services:
  - name: aws-simulator
    alias: simulator

stages:
  - test

test:
  stage: test
  script:
    - npm install
    - npm start &
    - sleep 10
    - npm test
  timeout: 30 minutes
```

---

## Checklist de Diagnóstico

Quando algo não funciona, execute em ordem:

- [ ] Verificar se simulador está rodando: `curl http://localhost:9999/__admin/services`
- [ ] Verificar se porta está em uso: `lsof -i :<port>`
- [ ] Verificar logs: `npm start -- --log-level debug`
- [ ] Verificar recurso existe: `curl http://localhost:<port>/__admin/ec2/resources`
- [ ] Verificar permissões: IAM, SCP, resource policy
- [ ] Verificar rede: Route tables, Security Groups, VPC Endpoints
- [ ] Verificar timeout: Aumentar em config
- [ ] Reiniciar simulador: `npm start`
- [ ] Limpar dados: `rm -rf aws-local-simulator-data`
- [ ] Reinstalar dependências: `rm -rf node_modules && npm install`

---

## Contato e Suporte

Para problemas não cobertos:

1. Consultar documentação: `docs/` folder
2. Verificar exemplos: `examples/` folder
3. Ver testes: `tests/` folder
4. Abrir issue com:
   - Versão do Node.js
   - Versão do simulador
   - Comando exato que falhou
   - Erro completo (stack trace)
   - Configuração utilizada (`aws-local-simulator.json`)
