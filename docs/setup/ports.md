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

## Exemplos por serviço (onda 1)

Os exemplos abaixo usam só a porta única (`AWS_ENDPOINT_URL`), sem a porta legada. Cada bloco rodou com código 0 na rodada B da onda 1. O registro de cada comando está em `.agents/tasks/migracao-porta-unica/inventory/onda1/logs/run-b-<servico>.txt`, e a comparação com a porta legada está em `inventory/onda1/onda1.md`.

### IAM

Testado (onda 1, rodada B): código 0. Registro: `run-b-iam.txt`.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws iam list-users
# { "Users": [] }
```

### KMS

Testado (onda 1, rodada B): código 0. Registro: `run-b-kms.txt`.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws kms list-keys
# { "Keys": [] }
```

### Secrets Manager

Testado (onda 1, rodada B): código 0. Registro: `run-b-secret-manager.txt`.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws secretsmanager list-secrets
# { "SecretList": [] }
```

### Parameter Store

Testado (onda 1, rodada B): código 0. Registro: `run-b-parameter-store.txt`.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws ssm describe-parameters
# { "Parameters": [] }
```

### CloudTrail

Testado (onda 1, rodada B): código 0. Registro: `run-b-cloudtrail.txt`. A saída lista a trilha padrão `local-default-trail`.

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:4700"
aws cloudtrail describe-trails
# { "trailList": [ { "Name": "local-default-trail" } ] }
```

## Portas por serviço (compatibilidade)

As portas por serviço só ficam abertas com uma destas opções:

- `AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true` (também aceita `1` ou `yes`).
- `"gateway": { "legacyPorts": true }` em `aws-local-simulator.json`.

Sem a opção, cada serviço escuta em uma porta livre de loopback (`127.0.0.1`) que só o gateway usa. Com a opção, cada serviço também escuta na própria porta, em todas as interfaces (`0.0.0.0`). Ver `serviceConfigFor` em `src/server.js` e `src/gateway/internal-host.js`.

Testado com `AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true`:

```bash
aws dynamodb list-tables --endpoint-url http://localhost:8000
aws lambda list-functions --endpoint-url http://localhost:3001
aws organizations list-roots --endpoint-url http://localhost:4581
```

Testado sem a opção: `http://localhost:3001/2015-03-31/functions` não conectou (código de saída do curl 7).

Para mudar a porta legada de um serviço, use `ports` em `aws-local-simulator.json` (por exemplo `"ports": { "s3": 5000 }`). Isso só vale com `legacyPorts` ligado. Não testado neste ciclo.

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
- Para as rotas `/__admin` de um serviço, use a porta legada com `legacyPorts` ligado. Testado: `POST http://localhost:3001/__admin/functions` com corpo `{"name":"fn-url","code":"exports.handler = async () => ({ statusCode: 200, body: \"ok\" });"}` respondeu 201. Com corpo `{}`, a rota respondeu 400 (`src/services/lambda/server.js`, `setupAdminRoutes`).

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

- **Connection refused em uma porta legada.** Confirme `AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true`. Sem essa opção, a porta do serviço não fica aberta.
- **Porta em uso.** Verifique no Windows com `Get-NetTCPConnection -State Listen -LocalPort 4700`. Em Linux/macOS, use `lsof -i :4700`.
- **AWS_ENDPOINT_URL inválida.** O simulador para na inicialização com a mensagem `AWS_ENDPOINT_URL invalida` (`src/config/env-loader.js`).
