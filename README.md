# AWS Local Simulator

[![npm version](https://badge.fury.io/js/aws-local-simulator.svg)](https://badge.fury.io/js/aws-local-simulator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/aws-local-simulator.svg)](https://nodejs.org)

Simulador local completo para serviços AWS. Desenvolva e teste suas aplicações AWS localmente sem custos!

## 🚀 Começar Rápido

1. **Instalação**: `npm install --save-dev @gugananuvem/aws-local-simulator`
2. **Iniciar**: `npx aws-local-simulator start`
3. **Configurar**: Crie `aws-local-simulator.json`
4. **Conectar**: Use SDK AWS apontando para localhost

📚 **[Guia de Instalação Completo](docs/setup/installation.md)**

## 🔌 27+ Serviços Suportados

### Armazenamento & Dados
| Serviço | Porta | Link |
|---------|-------|------|
| **S3** | 4566 | [Documentação](docs/services/S3.md) |
| **DynamoDB** | 8000 | [Documentação](docs/services/DynamoDB.md) |
| **OpenSearch** | 9200 | [Documentação](docs/services/OpenSearch.md) |
| **Athena** | 4599 | [Documentação](docs/services/Athena.md) |

### Computação
| Serviço | Porta | Link |
|---------|-------|------|
| **Lambda** | 3001 | [Documentação](docs/services/Lambda.md) |
| **EC2** | 4020 | [Documentação](docs/services/EC2.md) |
| **ALB** | 4021 | [Documentação](docs/services/ALB.md) |
| **ASG** | 4022 | [Documentação](docs/services/ASG.md) |

### Mensageria & Eventos
| Serviço | Porta | Link |
|---------|-------|------|
| **SQS** | 9324 | [Documentação](docs/services/SQS.md) |
| **SNS** | 9911 | [Documentação](docs/services/SNS.md) |
| **Kinesis** | 4568+ | [Documentação](docs/services/Kinesis.md) |
| **EventBridge** | 4010 | [Documentação](docs/services/EventBridge.md) |

### Rede & Segurança
| Serviço | Porta | Link |
|---------|-------|------|
| **Route53** ⭐ | 4024 | [Documentação](docs/services/Route53.md) |
| **ACM** ⭐ | 4025 | [Documentação](docs/services/ACM.md) |
| **IAM** | 4003 | [Documentação](docs/services/IAM.md) |
| **Cognito** | 9229 | [Documentação](docs/services/Cognito.md) |

### Infraestrutura & Observabilidade
| Serviço | Porta | Link |
|---------|-------|------|
| **CloudFormation** | 4582 | [Documentação](docs/services/CloudFormation.md) |
| **Organizations** | 4581 | [Documentação](docs/services/Organizations.md) |
| **Control Tower** | 4581 | [Documentação](docs/services/Organizations.md) |
| **CloudWatch** | 4011 | [Documentação](docs/services/CloudWatch.md) |
| **AWS Config** | 4013 | [Documentação](docs/services/Config.md) |
| **API Gateway** | 4567 | [Documentação](docs/services/API_Gateway.md) |

**[Ver lista completa de portas →](docs/setup/ports.md)**

## 📚 Documentação por Serviço

Cada serviço tem documentação própria com:
- 📖 Visão geral e features
- 🚀 Quick Start com exemplos
- 📝 Exemplos completos de uso
- 🧪 Guia de testes

**Acesse**: `docs/services/<SERVIÇO>.md`

Exemplo: [docs/services/VPC.md](docs/services/VPC.md), [docs/services/Lambda.md](docs/services/Lambda.md)

## 🔧 Configuração

### Arquivo de Configuração

```json
{
  "services": {
    "s3": true,
    "dynamodb": true,
    "lambda": true,
    "ec2": true,
    "sqs": true,
    "cognito": true
  },
  "lambdas": [
    {
      "name": "my-function",
      "handler": "./src/handlers/index.js",
      "env": { "TABLE_NAME": "users-table" }
    }
  ],
  "dynamodb": {
    "tables": [
      {
        "TableName": "users-table",
        "KeySchema": [{ "AttributeName": "id", "KeyType": "HASH" }],
        "AttributeDefinitions": [{ "AttributeName": "id", "AttributeType": "S" }]
      }
    ]
  },
  "ports": {
    "s3": 4566,
    "lambda": 3001,
    "ec2": 4020
  }
}
```

### Lambda com runtime externo (poliglota: Python, Java, .NET, Ruby, Go)

Por padrão o simulador executa handlers **JavaScript** (via `require()`/`import()`).
Também é possível rodar handlers em **outras linguagens** encaminhando a invocação
por **HTTP** para um "runtime server" já em execução. O simulador faz um `POST` com
o `event` e o `context`; o processo externo executa o handler e devolve o resultado.

Lambdas JS continuam funcionando exatamente como antes. O caminho externo só é
ativado quando a configuração indica um runtime externo.

#### Declarando uma lambda externa

```json
{
  "lambdas": [
    {
      "name": "rag-chat-handler",
      "runtime": "python3.12",
      "runtimeEndpoint": "http://localhost:5001/invoke",
      "handler": "chat_handler.lambda_handler",
      "timeout": 60,
      "env": { "TABLE_NAME": "blog-table" }
    }
  ]
}
```

Campos relevantes:

- `runtimeEndpoint` (novo): URL do runtime server que recebe o `POST`. Quando
  presente, ativa o caminho externo **independentemente** do valor de `runtime`.
- `runtime`: se casar com `python*`, `java*`, `dotnet*`, `ruby*` ou `go*`, a lambda
  é tratada como externa mesmo sem `runtimeEndpoint` (nesse caso usa o endpoint
  default — veja abaixo).
- `handler`: apenas metadado do nome do handler-alvo (ex.: `chat_handler.lambda_handler`).
  Para runtimes externos **não** há arquivo `.js` em disco.

**Precedência de ativação:** `runtimeEndpoint` explícito → `codePath` (processo, veja abaixo) → `runtime` externo
(usa o default configurável) → caminho JS atual.

#### Endpoint default configurável

Se uma lambda tiver runtime externo mas não informar `runtimeEndpoint`, o simulador
usa o endpoint global:

```json
{
  "lambda": {
    "externalRuntime": {
      "defaultEndpoint": "http://localhost:5001/invoke"
    }
  }
}
```

Se **nenhum** endpoint for resolvível, a lambda é registrada como **não invocável**
(log de erro claro) e o boot dos demais serviços **não** é interrompido.

#### Contrato HTTP do runtime server

O processo externo deve expor:

```
POST {runtimeEndpoint}
Content-Type: application/json

Request body:
{
  "event":   <objeto do evento Lambda>,
  "context": {
    "awsRequestId":       "...",
    "functionName":       "...",
    "functionVersion":    "$LATEST",
    "invokedFunctionArn": "arn:aws:lambda:local:000000000000:function:...",
    "memoryLimitInMB":    "1024",
    "logGroupName":       "/aws/lambda/...",
    "logStreamName":      "...",
    "deadlineMs":         1700000000000
  }
}
```

O `context` contém apenas campos de dados (funções como `getRemainingTimeInMillis`
não são enviadas); `deadlineMs` é o timestamp (epoch ms) até o qual a invocação deve
terminar.

Resposta:

```
Response 200: o corpo é o RESULTADO da Lambda (JSON).
  - Para integração com API Gateway HTTP API, tipicamente:
    { "statusCode": 200, "headers": { ... }, "body": "..." }

Response >= 400: erro de execução. Idealmente:
  { "errorType": "...", "errorMessage": "...", "stackTrace": [ ... ] }
```

Timeout (baseado em `timeout` da lambda) e respostas `>= 400` viram **falha de
invocação** com mensagem clara (`Task timed out after N seconds` ou o `errorMessage`
retornado). O simulador não quebra nesses casos.

#### Convenção de logs do runtime externo

Os logs do handler externo saem no processo da outra linguagem, não no Node. Para
que o CloudWatch simulado continue útil, o runtime server pode responder com um
**envelope** (apenas no modo externo):

```json
{ "result": <resultado-da-lambda>, "logs": ["linha 1", "linha 2"] }
```

Quando o corpo da resposta for um objeto contendo **ambas** as chaves `result` e
`logs` (array de strings), o simulador trata `result` como o retorno real da Lambda
e anexa `logs` aos logs enviados ao CloudWatch. Caso contrário, o corpo é usado
diretamente como resultado. O caminho JS não é afetado por essa convenção.

#### Criação dinâmica via Admin API

`POST /__admin/functions` aceita lambdas externas: informe `runtime` externo e/ou
`runtimeEndpoint` (sem `code`) e a função é registrada como proxy HTTP, sem gravar
arquivo `.js`. `PUT` (update) também reconstrói o proxy ao receber `runtimeEndpoint`.
Também aceita `codePath`/`command` (modo processo, abaixo).

#### Execução por processo (`codePath`) — sem servidor HTTP

Em vez de subir um runtime server, aponte para a pasta do seu programa e o handler.
O simulador **spawna um processo por invocação**, envia `{ handler, event, context }`
em JSON pelo **stdin** e lê o resultado do stdout.

```json
{
  "name": "rag-chat-handler",
  "runtime": "python3.12",
  "handler": "chat_handler.lambda_handler",
  "codePath": "./lambdas/rag-chat",
  "command": "python",
  "timeout": 60,
  "env": { "TABLE_NAME": "blog-table" }
}
```

- `codePath`: pasta do programa (relativa ao `process.cwd()`, com fallback para o
  `dataDir`). Vira o `cwd` do processo e entra no `PYTHONPATH`.
- `handler`: `modulo.funcao`, como na AWS (`chat_handler.lambda_handler` →
  `chat_handler.py`; em Node, `index.handler` → `index.js|cjs|mjs`).
- `command` (opcional): sobrescreve o interpretador (`python`, `python3`, `py`, caminho
  de um venv...). Padrões: `python*` → `python` (Windows) / `python3` (Linux/macOS);
  `nodejs*` → o próprio Node do simulador. Os dois usam bootstraps embutidos
  (`src/services/lambda/runtimes/python/bootstrap.py` e `.../node/bootstrap.js`) com
  suporte a handlers sync e async. O `context` expõe `aws_request_id`, `function_name`,
  `function_version`, `invoked_function_arn`, `memory_limit_in_mb`, `log_group_name`,
  `log_stream_name` e `get_remaining_time_in_millis()` (Python) /
  `getRemainingTimeInMillis()` (Node, campos em camelCase).
- `env` é mesclado sobre `process.env` do simulador e passado ao processo.

**Modo `command` genérico (Java, .NET, Go, ...):** quando `command` contém o placeholder
`{handler}` (ou o `runtime` não é `python*`/`nodejs*`), ele é um template de comando,
ex.: `"java -jar app.jar {handler}"`. O template é dividido em argumentos (aspas
suportadas) e executado **sem shell**; o evento nunca entra na linha de comando, só no
stdin. Contrato do programa:

- stdin: o JSON `{ "handler", "event", "context": { awsRequestId, functionName, ..., deadlineMs } }`.
- stdout: o resultado como JSON. Para misturar logs e resultado, o simulador define a
  variável `AWS_LOCAL_SIM_MARKER`; escreva o resultado entre
  `<MARKER>:RESULT:BEGIN` e `<MARKER>:RESULT:END` (erros: `<MARKER>:ERROR:BEGIN`/`END`
  com `{ errorType, errorMessage, stackTrace }`). **Sem marcadores**, todo o stdout é
  tratado como o resultado JSON (se não for JSON válido, vira string); nesse caso envie
  logs para o stderr.
- Em executáveis Windows `.cmd`/`.bat` não há shell: use um `.exe` ou chame o interpretador.

**Logs e erros:** nos bootstraps o resultado sai entre marcadores únicos por invocação
(`AWS_LOCAL_SIM_MARKER`), então `print()`/`console.log` do usuário não corrompem o JSON.
Todo o stdout/stderr restante vira `logs` e segue o mesmo caminho do envelope HTTP até o
CloudWatch simulado. Exceções do handler viram erro de invocação com `errorMessage`
(além de `errorType`/`stackTrace` no erro). Saída com código ≠ 0 sem resultado inclui o
tail do stderr. Interpretador inexistente gera erro `ENOENT` citando o comando.
Timeout mata o processo (e filhos, inclusive no Windows via `taskkill /T`) com
`Task timed out after N seconds`.

**Validação no registro:** `codePath` inexistente, arquivo do handler ausente (Python/Node)
ou `command` ausente em runtimes estrangeiros registram a lambda como **não invocável**
(erro claro no log), sem derrubar os demais serviços. Interpretador fora do PATH gera apenas
aviso e falha com `ENOENT` na invocação.

**Precedência:** `runtimeEndpoint` (HTTP) → `codePath` (processo) → `defaultEndpoint`
(HTTP) → caminho JS.

> Custo: cada invocação cria um novo processo (e, em Python, reimporta o módulo). Isso é
> simples e isolado, mas mais lento que um runtime server persistente; para cargas pesadas
> prefira `runtimeEndpoint`.

### Variáveis de Ambiente

```bash
AWS_LOCAL_SIMULATOR_S3=true
AWS_LOCAL_SIMULATOR_S3_PORT=4566
AWS_LOCAL_SIMULATOR_DYNAMODB=true
AWS_LOCAL_SIMULATOR_DYNAMODB_PORT=8000
AWS_LOCAL_SIMULATOR_LAMBDA=true
AWS_LOCAL_SIMULATOR_LAMBDA_PORT=3001
```

[Todas as variáveis de ambiente →](docs/setup/environment.md)

## 📝 Comandos CLI

```bash
# Iniciar simulador
npx aws-local-simulator start [configPath]

# Parar
npx aws-local-simulator stop

# Reiniciar
npx aws-local-simulator restart

# Resetar dados
npx aws-local-simulator reset

# Status
npx aws-local-simulator status
```

## 🖥️ Management API

O simulador expõe Management API na porta `9999` para controlar serviços em tempo de execução:

```bash
# Listar serviços
curl http://localhost:9999/__admin/services

# Habilitar/desabilitar
curl -X POST http://localhost:9999/__admin/services/dynamodb/enable
curl -X POST http://localhost:9999/__admin/services/sqs/disable
```

[Documentação da Management API →](docs/guides/management-api.md)

## 📚 Guias Temáticos

- **[Integração Multi-Serviço](docs/guides/integration.md)** - Usar múltiplos serviços juntos
- **[Testes e Verificação](docs/guides/testing.md)** - Testar aplicações localmente
- **[Segurança e IAM](docs/guides/security.md)** - Policy enforcement e controle de acesso
- **[Troubleshooting](docs/guides/troubleshooting.md)** - Resolver problemas comuns
- **[Proxy Setup](docs/setup/proxy.md)** - Configurar proxy entre serviços

## 🔌 Configuração de Portas

Cada serviço usa uma porta padrão diferente:

| Serviço | Porta Padrão |
|---------|-------------|
| S3 | 4566 |
| DynamoDB | 8000 |
| Lambda | 3001 |
| EC2 (inclui VPC, ALB, ASG) | 4020-4022 |
| API Gateway | 4567 |
| Kinesis | 4568-4570 |
| Athena | 4599 |
| CloudFormation | 4582 |
| Organizations/Control Tower | 4581 |
| AWS Config | 4013 |

[Configuração completa de portas →](docs/setup/ports.md)

## 💡 Exemplos Rápidos

### S3
```bash
aws s3 ls --endpoint-url http://localhost:4566
aws s3 mb s3://my-bucket --endpoint-url http://localhost:4566
```

### DynamoDB
```bash
aws dynamodb list-tables --endpoint-url http://localhost:8000
aws dynamodb scan --table-name users --endpoint-url http://localhost:8000
```

### Lambda
```bash
aws lambda list-functions --endpoint-url http://localhost:3001
aws lambda invoke --function-name my-func output.json --endpoint-url http://localhost:3001
```

### VPC (parte do serviço EC2)

> ℹ️ **A VPC não é um serviço AWS separado**: todas as ações de VPC (`describe-vpcs`,
> `create-vpc`, subnets, route tables, internet gateways, VPC endpoints) fazem parte da API do
> **EC2**. Por isso elas são atendidas na porta **4020** (`http://localhost:4020`) e não existe
> mais uma porta dedicada `4014`. All VPC actions are handled on port `4020` (EC2).

**Usando AWS CLI (recomendado):**
```bash
aws ec2 describe-vpcs --endpoint-url http://localhost:4020
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --endpoint-url http://localhost:4020
```

**Criar VPC Endpoint DynamoDB (AWS CLI):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.us-east-1.dynamodb \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-xxxxx \
  --endpoint-url http://localhost:4020
```

**Criar VPC Endpoint S3 (AWS CLI):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.us-east-1.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-xxxxx \
  --endpoint-url http://localhost:4020
```

**Criar VPC Endpoint SQS (AWS CLI):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.us-east-1.sqs \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-xxxxx \
  --endpoint-url http://localhost:4020
```

**Criar VPC Endpoint SNS (AWS CLI):**
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.us-east-1.sns \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-xxxxx \
  --endpoint-url http://localhost:4020
```

### Athena
```bash
# Criar workgroup
aws athena create-work-group \
  --name my-workgroup \
  --configuration ResultConfiguration={OutputLocation=s3://my-bucket/results/} \
  --endpoint-url http://localhost:4599

# Executar query
aws athena start-query-execution \
  --query-string "SELECT * FROM my_table LIMIT 10" \
  --query-execution-context Database=default \
  --result-configuration OutputLocation=s3://my-bucket/results/ \
  --endpoint-url http://localhost:4599
```

### AWS Config
```bash
# Listar configuration recorders
aws configservice describe-configuration-recorders \
  --endpoint-url http://localhost:4013

# Descrever resources
aws configservice describe-config-resources \
  --endpoint-url http://localhost:4013

# Descrever compliance
aws configservice describe-compliance-by-config-rule \
  --endpoint-url http://localhost:4013
```

### AWS Organizations
```bash
# Listar roots
aws organizations list-roots \
  --endpoint-url http://localhost:4581

# Listar accounts
aws organizations list-accounts \
  --endpoint-url http://localhost:4581

# Criar account
aws organizations create-account \
  --email "newaccount@example.com" \
  --account-name "New Account" \
  --endpoint-url http://localhost:4581
```

### Control Tower
```bash
# Listar guardrails habilitados
aws controltower list-enabled-guardrails \
  --endpoint-url http://localhost:4581

# Listar registered OUs
aws controltower list-organizational-units \
  --endpoint-url http://localhost:4581
```

### Route53 ⭐ NEW

**Nota Importante:**
- O simulador processa AWS CLI através da API REST internamente
- Use `--endpoint-url http://localhost:4024` para todas as operações Route53
- **No Windows PowerShell:** Parâmetros JSON inline com single quotes não funcionam devido à interpretação diferente de quotes. Use file-based JSON como mostrado nos exemplos (arquivo separado com `file://`)
- **No Linux/macOS:** Ambos inline e file-based JSON funcionam normalmente

#### Criar Hosted Zone

Usando AWS CLI (recomendado):
```bash
aws route53 create-hosted-zone \
  --name example.com \
  --caller-reference $(date +%s) \
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl -X POST http://localhost:4024/2013-04-01/hostedzone \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "example.com.",
    "CallerReference": "unique-ref-001",
    "HostedZoneConfig": {
      "Comment": "Main hosted zone",
      "PrivateZone": false
    }
  }'
```

#### Listar Hosted Zones

Usando AWS CLI (recomendado):
```bash
aws route53 list-hosted-zones \
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl http://localhost:4024/2013-04-01/hostedzone
```

#### Obter Hosted Zone

Usando AWS CLI (recomendado):
```bash
aws route53 get-hosted-zone \
  --id zone-id \
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl http://localhost:4024/2013-04-01/hostedzone/zone-id
```

#### Criar Resource Record (A record)

Usando AWS CLI com file-based JSON (recomendado para Windows):
```bash
# Linux/macOS - inline JSON
aws route53 change-resource-record-sets \
  --hosted-zone-id zone-id \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "www.example.com",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "192.0.2.1"}]
      }
    }]
  }' \
  --endpoint-url http://localhost:4024

# Windows - use file-based approach
$batch = @{
  Changes = @(@{
    Action = "CREATE"
    ResourceRecordSet = @{
      Name = "www.example.com"
      Type = "A"
      TTL = 300
      ResourceRecords = @(@{ Value = "192.0.2.1" })
    }
  })
} | ConvertTo-Json -Depth 10
$batch | Out-File -FilePath change-batch.json
aws route53 change-resource-record-sets `
  --hosted-zone-id zone-id `
  --change-batch file://./change-batch.json `
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl -X POST http://localhost:4024/2013-04-01/hostedzone/zone-id/rrset \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "www.example.com",
    "Type": "A",
    "TTL": 300,
    "ResourceRecords": [
      {"Value": "192.0.2.1"}
    ]
  }'
```

#### Criar Resource Record com Weighted Routing

Usando AWS CLI com file-based JSON (recomendado para Windows):
```bash
# Linux/macOS - inline JSON
aws route53 change-resource-record-sets \
  --hosted-zone-id zone-id \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "api.example.com",
        "Type": "A",
        "TTL": 60,
        "SetIdentifier": "api-primary",
        "Weight": 70,
        "ResourceRecords": [{"Value": "192.0.2.10"}]
      }
    }]
  }' \
  --endpoint-url http://localhost:4024

# Windows - use file-based approach
$batch = @{
  Changes = @(@{
    Action = "CREATE"
    ResourceRecordSet = @{
      Name = "api.example.com"
      Type = "A"
      TTL = 60
      SetIdentifier = "api-primary"
      Weight = 70
      ResourceRecords = @(@{ Value = "192.0.2.10" })
    }
  })
} | ConvertTo-Json -Depth 10
$batch | Out-File -FilePath change-batch.json
aws route53 change-resource-record-sets `
  --hosted-zone-id zone-id `
  --change-batch file://./change-batch.json `
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl -X POST http://localhost:4024/2013-04-01/hostedzone/zone-id/rrset \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "api.example.com",
    "Type": "A",
    "TTL": 60,
    "SetIdentifier": "api-primary",
    "Weight": 70,
    "ResourceRecords": [
      {"Value": "192.0.2.10"}
    ]
  }'
```

#### Criar Health Check

Usando AWS CLI com file-based JSON (recomendado para Windows):
```bash
# Linux/macOS - inline JSON
aws route53 create-health-check \
  --caller-reference $(date +%s) \
  --health-check-config '{
    "Type": "HTTP",
    "Protocol": "HTTP",
    "IPAddress": "192.0.2.10",
    "Port": 80,
    "ResourcePath": "/health",
    "RequestInterval": 30,
    "FailureThreshold": 3,
    "MeasureLatency": true
  }' \
  --endpoint-url http://localhost:4024

# Windows - use file-based approach
$config = @{
  Type = "HTTP"
  Protocol = "HTTP"
  IPAddress = "192.0.2.10"
  Port = 80
  ResourcePath = "/health"
  RequestInterval = 30
  FailureThreshold = 3
  MeasureLatency = $true
} | ConvertTo-Json -Depth 10
$config | Out-File -FilePath health-check-config.json
aws route53 create-health-check `
  --caller-reference ([DateTime]::Now.Ticks) `
  --health-check-config file://./health-check-config.json `
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl -X POST http://localhost:4024/2013-04-01/healthcheck \
  -H "Content-Type: application/json" \
  -d '{
    "HealthCheckConfig": {
      "Type": "HTTP",
      "Protocol": "HTTP",
      "IPAddress": "192.0.2.10",
      "Port": 80,
      "ResourcePath": "/health",
      "RequestInterval": 30,
      "FailureThreshold": 3,
      "MeasureLatency": true
    }
  }'
```

#### Listar Health Checks

Usando AWS CLI (recomendado):
```bash
aws route53 list-health-checks \
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl http://localhost:4024/2013-04-01/healthcheck
```

#### Listar Resource Records

Usando AWS CLI (recomendado):
```bash
aws route53 list-resource-record-sets \
  --hosted-zone-id zone-id \
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl http://localhost:4024/2013-04-01/hostedzone/zone-id/rrset
```

#### Resolver DNS Query (Weighted) - Custom Endpoint

Esta operação é um endpoint customizado do simulador sem equivalente direto em AWS CLI:
```bash
curl "http://localhost:4024/2013-04-01/resolve/api.example.com/A?queryType=weighted"
```

#### Deletar Resource Record

Usando AWS CLI com file-based JSON (recomendado para Windows):
```bash
# Linux/macOS - inline JSON
aws route53 change-resource-record-sets \
  --hosted-zone-id zone-id \
  --change-batch '{
    "Changes": [{
      "Action": "DELETE",
      "ResourceRecordSet": {
        "Name": "www.example.com",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "192.0.2.1"}]
      }
    }]
  }' \
  --endpoint-url http://localhost:4024

# Windows - use file-based approach
$batch = @{
  Changes = @(@{
    Action = "DELETE"
    ResourceRecordSet = @{
      Name = "www.example.com"
      Type = "A"
      TTL = 300
      ResourceRecords = @(@{ Value = "192.0.2.1" })
    }
  })
} | ConvertTo-Json -Depth 10
$batch | Out-File -FilePath change-batch.json
aws route53 change-resource-record-sets `
  --hosted-zone-id zone-id `
  --change-batch file://./change-batch.json `
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl -X DELETE http://localhost:4024/2013-04-01/hostedzone/zone-id/rrset/www.example.com/A
```

#### Deletar Health Check

Usando AWS CLI (recomendado):
```bash
aws route53 delete-health-check \
  --health-check-id health-check-id \
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl -X DELETE http://localhost:4024/2013-04-01/healthcheck/health-check-id
```

#### Deletar Hosted Zone

Usando AWS CLI (recomendado):
```bash
aws route53 delete-hosted-zone \
  --id zone-id \
  --endpoint-url http://localhost:4024
```

Alternativa: Direto pela API REST
```bash
curl -X DELETE http://localhost:4024/2013-04-01/hostedzone/zone-id
```

### ACM (AWS Certificate Manager) ⭐ NEW

**Nota:** O simulador processa AWS CLI através da API REST internamente. Use `--endpoint-url http://localhost:4025` para todas as operações ACM.

#### Solicitar Certificado

Usando AWS CLI (recomendado):
```bash
aws acm request-certificate \
  --domain-name example.com \
  --subject-alternative-names "*.example.com" "www.example.com" \
  --validation-method DNS \
  --certificate-type AMAZON_ISSUED \
  --endpoint-url http://localhost:4025
```

Alternativa: Direto pela API REST
```bash
curl -X POST http://localhost:4025/acm/request-certificate \
  -H "Content-Type: application/json" \
  -d '{
    "DomainName": "example.com",
    "SubjectAlternativeNames": ["*.example.com", "www.example.com"],
    "ValidationMethod": "DNS",
    "CertificateType": "AMAZON_ISSUED"
  }'
```

#### Listar Certificados

Usando AWS CLI (recomendado):
```bash
aws acm list-certificates \
  --endpoint-url http://localhost:4025
```

Alternativa: Direto pela API REST
```bash
curl http://localhost:4025/acm/list-certificates
```

#### Listar Certificados com Filtro (Status)

Usando AWS CLI (recomendado):
```bash
aws acm list-certificates \
  --certificate-statuses ISSUED \
  --endpoint-url http://localhost:4025
```

Alternativa: Direto pela API REST
```bash
curl "http://localhost:4025/acm/list-certificates?Status=ISSUED"
```

#### Descrever Certificado

Usando AWS CLI (recomendado):
```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012 \
  --endpoint-url http://localhost:4025
```

Alternativa: Direto pela API REST
```bash
curl http://localhost:4025/acm/describe-certificate/arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012
```

#### Validar Domínio (DNS validation) - Custom Endpoint

Esta operação é um endpoint customizado do simulador sem equivalente direto em AWS CLI:
```bash
curl -X POST http://localhost:4025/acm/validate-domain \
  -H "Content-Type: application/json" \
  -d '{
    "CertificateArn": "arn:aws:acm:...",
    "DomainName": "example.com"
  }'
```

#### Adicionar Tags ao Certificado

Usando AWS CLI (recomendado):
```bash
aws acm add-tags-to-certificate \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012 \
  --tags Key=Environment,Value=production Key=Team,Value=platform \
  --endpoint-url http://localhost:4025
```

Alternativa: Direto pela API REST
```bash
curl -X POST http://localhost:4025/acm/add-tags-to-certificate \
  -H "Content-Type: application/json" \
  -d '{
    "CertificateArn": "arn:aws:acm:...",
    "Tags": [
      {"Key": "Environment", "Value": "production"},
      {"Key": "Team", "Value": "platform"}
    ]
  }'
```

#### Renovar Certificado

Usando AWS CLI (recomendado):
```bash
aws acm renew-certificate \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012 \
  --endpoint-url http://localhost:4025
```

Alternativa: Direto pela API REST
```bash
curl -X POST http://localhost:4025/acm/renew-certificate \
  -H "Content-Type: application/json" \
  -d '{
    "CertificateArn": "arn:aws:acm:..."
  }'
```

#### Listar Certificados por Domínio - Custom Endpoint

Esta operação é um endpoint customizado do simulador sem equivalente direto em AWS CLI:
```bash
curl http://localhost:4025/acm/certificate-by-domain/example.com
```

#### Estatísticas de Certificados - Custom Endpoint

Esta operação é um endpoint customizado do simulador sem equivalente direto em AWS CLI:
```bash
curl http://localhost:4025/acm/stats
```

#### Deletar Certificado

Usando AWS CLI (recomendado):
```bash
aws acm delete-certificate \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012 \
  --endpoint-url http://localhost:4025
```

Alternativa: Direto pela API REST
```bash
curl -X DELETE http://localhost:4025/acm/delete-certificate/arn:aws:acm:...
```

[Exemplos completos por serviço →](docs/services/)

## 📖 Glossário

| Termo | Descrição |
|-------|-----------|
| **VPC** | Virtual Private Cloud - rede isolada |
| **Subnet** | Segmento de VPC em uma availability zone |
| **Security Group** | Firewall virtual para instâncias |
| **Route Table** | Define rotas de rede dentro da VPC |
| **IAM** | Identity and Access Management - controle de acesso |
| **Lambda** | Computação serverless - execute funções sem gerenciar servidores |
| **DynamoDB** | Banco de dados NoSQL gerenciado |
| **SQS** | Simple Queue Service - fila de mensagens |
| **Kinesis** | Streaming de dados em tempo real |
| **Athena** | Consultas SQL interativas em dados armazenados no S3 |
| **AWS Config** | Rastreie configurações de recursos e conformidade |
| **AWS Organizations** | Gerenciar múltiplas contas AWS e aplicar políticas |
| **Control Tower** | Configurar e governar ambientes multi-conta em larga escala |
| **CloudFormation** | Infrastructure as Code - provisione recursos via templates |

## 🤝 Contribuindo

Veja [CONTRIBUTING.md](CONTRIBUTING.md)

## 📄 Licença

MIT - Licença completa em [LICENSE](LICENSE)

## 📞 Suporte

- 📚 [Documentação Completa](docs/)
- 🐛 [Reportar Issues](https://github.com/gugananuvem/aws-local-simulator/issues)
- 💬 [Discussões](https://github.com/gugananuvem/aws-local-simulator/discussions)

---

**Versão**: 1.0.0  
**Última atualização**: Outubro 2024

