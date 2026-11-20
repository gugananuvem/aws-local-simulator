# Portas e gateway

Este guia cobre a porta única do simulador (gateway), como configurá-la, o modo de portas por serviço (compatibilidade) e o S3 em path-style. Cada valor citado foi conferido no código (`src/config/`, `src/server.js`, `src/gateway/`). Os exemplos marcados como testados rodaram com o AWS CLI 2.37.10 no Windows.

## Porta única (padrão 4700)

Com a configuração padrão, o gateway escuta em `4700` e encaminha cada requisição ao serviço certo. A inicialização mostra:

```
Gateway rodando em http://localhost:4700
Management API rodando em http://localhost:9999
```

Exemplos testados, sem `AWS_LOCAL_SIMULATOR_LEGACY_PORTS`:

```bash
aws dynamodb list-tables --endpoint-url http://localhost:4700
# { "TableNames": [] }
aws lambda list-functions --endpoint-url http://localhost:4700
aws sqs list-queues --endpoint-url http://localhost:4700
aws s3 ls --endpoint-url http://localhost:4700
aws opensearch list-domain-names --endpoint-url http://localhost:4700
aws sts get-caller-identity --endpoint-url http://localhost:4700
```

Os seis comandos retornaram código 0.

## Como configurar a porta

A primeira fonte definida vence:

1. `AWS_ENDPOINT_URL`. Host e porta vêm da URL. Vence `AWS_LOCAL_SIMULATOR_GATEWAY_PORT` (`src/config/env-loader.js`, `loadGateway`).
2. `AWS_LOCAL_SIMULATOR_GATEWAY_PORT` (`src/config/env-loader.js`, `loadGateway`).
3. `gateway.port` em `aws-local-simulator.json`. As variáveis de ambiente do gateway valem sobre o arquivo (`src/config/config-loader.js`, linhas 47 e 48).
4. Padrão `4700` (`src/config/default-config.js`).

### AWS_ENDPOINT_URL

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws dynamodb list-tables
```

Testado: o comando funcionou sem `--endpoint-url`.

#### Prefixo por serviço: RDS SQL Server

Alguns serviços precisam de um prefixo no caminho para não colidir com regras antigas do gateway.
É o caso do RDS SQL Server, porque `rds`, `rds-data` e `RDSDataService.*` são roteados para Aurora:

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700/rds-sqlserver"
aws rds describe-db-clusters
```

Testado: com `AWS_ENDPOINT_URL` contendo `/rds-sqlserver`, o AWS CLI 2.37.10 preservou o caminho
na requisição; o gateway encaminha para o serviço correto antes de analisar target/assinatura.
O serviço é opt-in (`AWS_LOCAL_SIMULATOR_RDS_SQLSERVER=true`) e abre também o listener TDS na
porta 1433. Ver [RDS SQL Server](../services/RDS-SQLServer.md).

### AWS_LOCAL_SIMULATOR_GATEWAY_PORT

```powershell
$env:AWS_LOCAL_SIMULATOR_GATEWAY_PORT = "4800"
aws dynamodb list-tables --endpoint-url http://localhost:4800
```

Testado: o gateway escuta em `4800` e o comando respondeu. Com `AWS_ENDPOINT_URL=http://localhost:4700` definido ao mesmo tempo, o gateway ficou em `4700` e `4800` não abriu.

### gateway.port no arquivo de configuração

Arquivo `aws-local-simulator.json` no diretório de onde o simulador é iniciado:

```json
{
  "gateway": {
    "port": 4900
  }
}
```

Testado: o gateway escuta em `4900` e `4700` fica fechada.

### Profile do AWS CLI

```ini
# ~/.aws/config
[profile als]
region = us-east-1
endpoint_url = http://localhost:4700
aws_access_key_id = test
aws_secret_access_key = test
```

Testado: `aws dynamodb list-tables --profile als` retornou código 0. Sem as credenciais no perfil, o CLI respondeu `NoCredentials`, mesmo com `AWS_ACCESS_KEY_ID` definido no ambiente. Com a autenticação desligada (padrão), o simulador aceita qualquer valor de chave.

## Exemplos por serviço

Os exemplos abaixo usam só a porta única (`AWS_ENDPOINT_URL`), sem a porta legada. Cada bloco foi executado no modo padrão, sem `AWS_LOCAL_SIMULATOR_LEGACY_PORTS`. Em 2026-11-17, na rodada com `AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true`, o mesmo comando com `--endpoint-url` para a porta legada do serviço deu código 0 e a mesma saída. Cada bloco traz esse resultado. Os logs dessas rodadas ficam em `inventory/onda1/logs/run-a-<servico>-*.txt` e em `inventory/onda2/logs/`, na pasta `.agents` (ignorada pelo git).

### IAM

Testado: código 0 na porta 4700. Porta legada 4003: código 0 e mesma saída.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws iam list-users
# { "Users": [] }
```

### KMS

Testado: código 0 na porta 4700. Porta legada 4000: código 0 e mesma saída.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws kms list-keys
# { "Keys": [] }
```

### Secrets Manager

Testado: código 0 na porta 4700. Porta legada 4001: código 0 e mesma saída.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws secretsmanager list-secrets
# { "SecretList": [] }
```

### Parameter Store

Testado: código 0 na porta 4700. Porta legada 4002: código 0 e mesma saída.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws ssm describe-parameters
# { "Parameters": [] }
```

### CloudTrail

Testado: código 0 na porta 4700. Porta legada 4012: código 0 e mesma saída. A saída lista a trilha padrão `local-default-trail`.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws cloudtrail describe-trails
# { "trailList": [ { "Name": "local-default-trail" } ] }
```

### DynamoDB

Testado: código 0 na porta 4700. Porta legada 8000: código 0 e mesma saída.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws dynamodb list-tables
# { "TableNames": [ ... ] }
```

### S3

Testado com `addressing_style = path` no arquivo de configuração do AWS CLI (ver a seção S3 em path-style abaixo): código 0 na porta 4700. Porta legada 4566: código 0 e mesma saída.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws s3 ls
# lista os buckets existentes
```

### Lambda

Testado: código 0 na porta 4700. Porta legada 3001: código 0 e mesma saída.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws lambda list-functions
# { "Functions": [ ... ] }
```

### API Gateway

Testado: código 0 na porta 4700. Porta legada 4567: código 0 e mesma saída. A saída lista as APIs existentes, e a API estática `static_0` aparece sempre.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws apigateway get-rest-apis
# { "items": [ ... ] }
```

### SQS

Testado: código 0 na porta 4700. Porta legada 9324: código 0 e mesma saída. Na criação, a `QueueUrl` usa a porta pela qual a requisição chegou, por isso uma fila criada pela porta legada traz `localhost:9324`.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws sqs list-queues
# { "QueueUrls": [ ... ] }
```

### SNS

Testado: código 0 na porta 4700. Porta legada 9911: código 0 e mesma saída.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws sns list-topics
# { "Topics": [] }
```

### STS

Testado: código 0 na porta 4700. Porta legada 9326: código 0 e mesma saída.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws sts get-caller-identity
# { "UserId": "AKIAIOSFODNN7EXAMPLE", "Account": "123456789012", "Arn": "arn:aws:iam::123456789012:user/local-simulator" }
```

### EC2

Testado: código 0 na porta 4700 para `describe-vpcs` e `describe-instances`. Porta legada 4020: código 0 e mesma saída nos dois comandos. O servidor de instância do EC2 (`instanceServer`) não passa pelo gateway e continua fora desta migração.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws ec2 describe-vpcs
# { "Vpcs": [ { "CidrBlock": "10.0.0.0/16", ... } ] }
aws ec2 describe-instances
# { "Reservations": [ ... ] }
```

### ALB

Testado: código 0 na porta 4700. Porta legada 4021: código 0 e mesma saída. Na medição, `create-load-balancer` e `delete-load-balancer` também responderam código 0 pela porta 4700.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws elbv2 describe-load-balancers
# { "LoadBalancers": [] }
```

## Exemplos da onda 3 (--endpoint-url)

Comandos rodados contra `http://localhost:4700` com `--endpoint-url`, a partir do worktree `migracao-onda3`, com `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test` e região `us-east-1`. Os comandos são somente leitura. A saída abaixo é a registrada na execução. Em `describe-vpcs`, a saída está abreviada.

### STS (--endpoint-url)

Testado: código de saída 0 na porta 4700.

```powershell
aws sts get-caller-identity --endpoint-url http://localhost:4700
# { "UserId": "AKIAIOSFODNN7EXAMPLE", "Account": "123456789012", "Arn": "arn:aws:iam::123456789012:user/local-simulator" }
# exit=0
```

### EC2 (--endpoint-url)

Testado: código de saída 0 na porta 4700 para os dois comandos.

```powershell
aws ec2 describe-vpcs --endpoint-url http://localhost:4700
# { "Vpcs": [ { "VpcId": "vpc-96b360dc", "CidrBlock": "10.0.0.0/16", "State": "available", "Tags": [ { "Key": "Name", "Value": "main-vpc" } ], ... } ] }
# exit=0

aws ec2 describe-instances --endpoint-url http://localhost:4700
# { "Reservations": [ { "ReservationId": "r-default", "OwnerId": "123456789012", "Groups": [], "Instances": [] } ] }
# exit=0
```

### ALB (--endpoint-url)

Testado: código de saída 0 na porta 4700.

```powershell
aws elbv2 describe-load-balancers --endpoint-url http://localhost:4700
# { "LoadBalancers": [] }
# exit=0
```

## Portas por serviço (compatibilidade)

Cada serviço sempre escuta na própria porta (`config.ports` ou o default do serviço). O que muda é a interface:

- Sem `legacyPorts` (padrão), cada serviço escuta apenas em loopback (`127.0.0.1`) e o acesso externo passa pelo gateway (`4700`).
- Com `AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true` (também aceita `1` ou `yes`) ou `"gateway": { "legacyPorts": true }` em `aws-local-simulator.json`, o serviço também aceita conexões de qualquer interface (`0.0.0.0`).

Ver `src/server.js` e `src/gateway/internal-host.js`.

Testado (modo padrão, sem `legacyPorts`): as portas respondem em `localhost`.

```bash
aws dynamodb list-tables --endpoint-url http://localhost:8000
aws lambda list-functions --endpoint-url http://localhost:3001
aws organizations list-roots --endpoint-url http://localhost:4581
```

Testado: `GET http://localhost:4566/__admin/buckets` e `GET http://localhost:8000/__admin/tables` retornaram 200.

Para mudar a porta de um serviço, use `ports` em `aws-local-simulator.json` (por exemplo `"ports": { "s3": 5000 }`).

## S3 em path-style (modo principal)

Configure o profile para o S3 usar path-style:

```ini
[profile als]
region = us-east-1
endpoint_url = http://localhost:4700
aws_access_key_id = test
aws_secret_access_key = test
s3 =
  addressing_style = path
```

```bash
aws s3 mb s3://bucket-teste --profile als
aws s3 cp ./arquivo.txt s3://bucket-teste/arquivo.txt --profile als
aws s3 ls s3://bucket-teste --profile als
```

Testado na porta 4700: os três comandos retornaram código 0. Com `--debug`, o CLI montou a URL `http://localhost:4700/bucket-teste`.

Sem `addressing_style`, o mesmo CLI também criou e listou um bucket na porta 4700 (testado). O path-style é o modo recomendado porque deixa explícito o formato da URL. O host virtual (`bucket.localhost:4700`) é aceito quando o bucket existe (`src/gateway/route-classifier.js`, regra R6). Esse caminho não foi testado com resolução de DNS.

URLs pré-assinadas do S3 também usam path-style sobre a URL pública (`src/services/s3/presigned-url-generator.js`).

## Como o simulador escolhe o serviço

O gateway aplica as regras na ordem abaixo (`src/gateway/route-classifier.js`):

1. Cabeçalho `X-Amz-Target` (protocolo JSON de DynamoDB, SQS, Secrets Manager e outros).
2. Escopo da assinatura SigV4 (`s3`, `lambda`, `sts`, `es` e os demais), no cabeçalho `Authorization` ou em `X-Amz-Credential`.
3. `Action` e `Version` do protocolo query, na query string ou no corpo de formulário.
4. Prefixo de caminho REST (`/2015-03-31/` do Lambda, `/restapis` do API Gateway, `/_cat` e `/_bulk` do OpenSearch, entre outros).
5. Sem assinatura: primeiro segmento do caminho é um bucket existente (path-style), ou `/{apiId}/{stage}/...` de um API existente.
6. Host `bucket.localhost:4700` (virtual-hosted), quando o bucket existe.

Requisição que não casa com nenhuma regra recebe HTTP 400 com `UnknownService`.

## Management API e rotas /__admin

- A Management API escuta em `adminPort`, padrão `9999` (`src/server.js`, `startManagementServer`). Testado: `GET http://localhost:9999/__admin/services` retornou a lista de serviços.
- O gateway não roteia `/__admin`. Testado: `GET http://localhost:4700/__admin/functions` retornou HTTP 400 `UnknownService`.
- Para as rotas `/__admin` de um serviço, use a porta do próprio serviço (por exemplo `GET http://localhost:4566/__admin/buckets`). Testado: `POST http://localhost:3001/__admin/functions` com corpo `{"name":"fn-url","code":"exports.handler = async () => ({ statusCode: 200, body: \"ok\" });"}` respondeu 201. Com corpo `{}`, a rota respondeu 400 (`src/services/lambda/server.js`, `setupAdminRoutes`).

## URL de função Lambda

`aws lambda create-function-url-config` monta a `FunctionUrl` com o host da requisição. Testado: com o gateway na porta 4900, a URL retornada foi `http://localhost:4900/2021-10-31/functions/fn-url/url`.

## Tabela de portas

Valores do `default-config.js`. Quando a chave não existe na configuração, o serviço usa o mesmo número como fallback no próprio `index.js`.

| Serviço | Porta legada | Observação |
|---------|--------------|------------|
| DynamoDB | 8000 | |
| DAX | 8111 | |
| S3 | 4566 | |
| Athena | 4599 | |
| Aurora | 4510 | |
| RDS SQL Server (HTTP) | 4511 | Requer `AWS_ENDPOINT_URL=http://localhost:4700/rds-sqlserver` no gateway |
| RDS SQL Server (TDS) | 1433 | Cliente nativo; fora do gateway |
| Lambda | 3001 | |
| Cognito | 9229 | |
| STS | 9326 | |
| SQS | 9324 | |
| SNS | 9911 | |
| EventBridge | 4010 | |
| API Gateway | 4567 | |
| KMS | 4000 | |
| Secrets Manager | 4001 | |
| Parameter Store | 4002 | |
| IAM | 4003 | |
| Kinesis Data Streams | 4568 | |
| Kinesis Firehose | 4569 | |
| Kinesis Analytics | 4570 | |
| EC2 | 4020 | |
| ALB | 4021 | |
| ASG | 4022 | |
| Route53 | 4024 | |
| ACM | 4025 | |
| CloudFront | 4017 | |
| CloudWatch | 4011 | |
| CloudTrail | 4012 | |
| AWS Config | 4013 | |
| X-Ray | 4015 | |
| CloudFormation | 4582 | |
| Organizations | 4581 | Padrão em `default-config.js`. O fallback `4580` em `src/services/organizations/index.js` só vale se `ports.organizations` faltar. |
| OpenSearch | 9200 | |
| Management API | 9999 | `adminPort`. Sempre ativa, fora do gateway. |

ECS (`8080`) fica desligado por padrão (`services.ecs: false`, `src/config/default-config.js`). O serviço ECS não está registrado em `src/server.js` (linha comentada), então nenhuma configuração abre essa porta hoje.

## Problemas comuns

- **Connection refused em uma porta de serviço.** Confirme que o serviço está habilitado e que a porta não está ocupada; cada serviço escuta sempre na própria porta (loopback no modo padrão).
- **Porta em uso.** Verifique no Windows com `Get-NetTCPConnection -State Listen -LocalPort 4700`. Em Linux/macOS, use `lsof -i :4700`.
- **AWS_ENDPOINT_URL inválida.** O simulador para na inicialização com a mensagem `AWS_ENDPOINT_URL invalida` (`src/config/env-loader.js`).
