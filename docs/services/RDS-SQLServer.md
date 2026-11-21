# RDS SQL Server (simulador local)

> Serviço **opt-in**: habilite `"rds-sqlserver": true` em `services` no `aws-local-simulator.json`
> (ou `AWS_LOCAL_SIMULATOR_RDS_SQLSERVER=true`). Por padrão ele não sobe.

Simula a API de gerenciamento do Amazon RDS para SQL Server e uma Data API parcial, usando
SQLite como motor interno. O cliente nativo SQL Server é atendido por um listener TDS mínimo.

## Portas e endpoints

| Uso | Endereço | Observação |
|---|---|---|
| AWS CLI / SDK | `http://localhost:4700/rds-sqlserver` | Padrão. Use `AWS_ENDPOINT_URL` com o prefixo do caminho. |
| HTTP direto (legado) | `http://localhost:4511` | Disponível com `AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true`. |
| Cliente SQL Server (TDS) | `localhost:1433` | TCP, TDS 7.4, sem TLS. |
| Management API | `http://localhost:9999` | `GET /__admin/services` para/status. |

> O prefixo `/rds-sqlserver` é necessário porque o gateway roteia `rds`, `rds-data` e
> `RDSDataService.*` para o simulador Aurora. A regra do SQL Server é avaliada antes de target e
> assinatura. Foi validado com AWS CLI 2.37.10 que `AWS_ENDPOINT_URL` preserva o caminho.

## Habilitar

```json
{
  "services": {
    "rds-sqlserver": true
  },
  "ports": {
    "rds-sqlserver": 4511,
    "rds-sqlserver-tds": 1433
  }
}
```

Variáveis de ambiente:

```powershell
$env:AWS_LOCAL_SIMULATOR_RDS_SQLSERVER = "true"
$env:AWS_ENDPOINT_URL = "http://localhost:4700/rds-sqlserver"
$env:AWS_LOCAL_SIMULATOR_RDS_SQLSERVER_PORT = "4511"
$env:AWS_LOCAL_SIMULATOR_RDS_SQLSERVER_TDS_PORT = "1433"
```

Dependências registradas: KMS e Secrets Manager. CloudTrail e CloudWatch são opcionais e
usados quando habilitados.

## RDS Management API (AWS CLI)

Motores: `sqlserver-se`, `sqlserver-ex`, `sqlserver-web`, `sqlserver-ee`.
Versões: `14.00.3281.6.v1` (2017), `15.00.4388.7.v1` (2019), `16.00.4035.2.v1` (2022).

```powershell
aws rds create-db-cluster `
  --db-cluster-identifier sqlsrv-demo `
  --engine sqlserver-se `
  --engine-version 16.00.4035.2.v1 `
  --master-username admin `
  --master-user-password 'Senha123456' `
  --database-name master `
  --port 1433

aws rds create-db-instance `
  --db-cluster-identifier sqlsrv-demo `
  --db-instance-identifier sqlsrv-demo-1 `
  --db-instance-class db.t3.medium

aws rds describe-db-clusters
aws rds describe-db-instances
aws rds modify-db-cluster --db-cluster-identifier sqlsrv-demo --port 1434
aws rds stop-db-cluster --db-cluster-identifier sqlsrv-demo
aws rds start-db-cluster --db-cluster-identifier sqlsrv-demo

aws rds add-tags-to-resource `
  --resource-name arn:aws:rds:us-east-1:000000000000:cluster:sqlsrv-demo `
  --tags Key=Ambiente,Value=dev
aws rds list-tags-for-resource --resource-name arn:aws:rds:us-east-1:000000000000:cluster:sqlsrv-demo
aws rds remove-tags-from-resource --resource-name arn:aws:rds:us-east-1:000000000000:cluster:sqlsrv-demo --tag-keys Ambiente

aws rds delete-db-instance --db-instance-identifier sqlsrv-demo-1
aws rds delete-db-cluster --db-cluster-identifier sqlsrv-demo --skip-final-snapshot
```

Ações implementadas: `CreateDBCluster`, `DescribeDBClusters`, `DeleteDBCluster`,
`CreateDBInstance`, `DescribeDBInstances`, `DeleteDBInstance`, `ModifyDBCluster`,
`StopDBCluster`, `StartDBCluster`, `ListTagsForResource`, `AddTagsToResource` e
`RemoveTagsFromResource`.

O protocolo query da AWS CLI envia `ResourceName` (não `ResourceArn`) e codifica listas como
`Tags.Tag.N.Key` / `Tags.Tag.N.Value` e `TagKeys.member.N`. O handler aceita esses formatos e
também os objetos JSON enviados pelo SDK.

O cluster usa `master` como database padrão quando `DatabaseName` não é informado.
`DeleteDBCluster` remove metadados, instâncias e tags; os arquivos `.db` de usuário não são
apagados automaticamente — use `POST /__admin/reset` para limpar tudo.

## Data API

Targets: `RDSDataService.ExecuteStatement`, `BatchExecuteStatement`, `BeginTransaction`,
`CommitTransaction` e `RollbackTransaction`.

```bash
curl -s http://localhost:4700/rds-sqlserver \
  -H 'Content-Type: application/x-amz-json-1.1' \
  -H 'X-Amz-Target: RDSDataService.ExecuteStatement' \
  -d '{
    "resourceArn":"arn:aws:rds:us-east-1:000000000000:cluster:sqlsrv-demo",
    "secretArn":"arn:aws:secretsmanager:us-east-1:000000000000:secret:rds-demo",
    "database":"master",
    "sql":"SELECT TOP 10 id, nome FROM users WHERE nome = :nome",
    "parameters":[{"name":"nome","value":{"stringValue":"Ana"}}],
    "includeResultMetadata":true
  }'
```

Parâmetros `:nome` e `@nome` são ligados com segurança (literais e comentários são ignorados).
Transações expiram após 3 minutos com rollback automático.

## Cliente TDS (porta 1433)

Use as credenciais do cluster (`MasterUsername` / `MasterUserPassword`). O nome de servidor
informado no login é usado para escolher o cluster quando há mais de um com o mesmo usuário.

```powershell
sqlcmd -S tcp:localhost,1433 -U admin -P 'Senha123456' -d master -Q "SELECT GETDATE()"
```

> Validado com `sqlcmd` do Microsoft ODBC Driver 17: login, `CREATE TABLE`, `INSERT`,
> `SELECT` e `USE <database>`. Use uma instrução por `-Q` (o driver rejeita múltiplas).
> No `cmd.exe`, a senha deve ser passada com `-P "Senha123456"`. Conexões com `Encrypt=yes`
> não são suportadas (o servidor responde `NOT_SUP` no PRELOGIN).
> No **SSMS 19**, a opção `-P` não existe: digite a senha no diálogo `Password:` → `Senha123456`.
> `Initial Catalog` do LOGIN7 é respeitado — o SSMS abre uma conexão separada em `msdb` para
> avaliar a política de saúde.

Suporte atual:

- PRELOGIN/LOGIN7 com SQL Authentication e TDS 7.4; o LOGINACK anuncia a mesma versão do
  catálogo (`16.00.4035`), evitando que o `Microsoft.Data.SqlClient` 3.x do SSMS 19 monte o
  SMO com `ServerVersion` 11.00;
- SQL Batch (`SELECT`, DML, DDL, `USE <database>`), tokens COLMETADATA/ROW/DONE;
- RPC `sp_executesql` em melhor esforço; outros RPCs retornam erro explícito;
- colunas sem alias voltam com nome vazio (como no SQL Server). Nomes longos de expressões
  gerados pelo SQLite são normalizados: além de semanticamente corretos, estourariam o
  `B_VARCHAR` de 1 byte do TDS e corromperiam o stream;
- literais hex (`0x1000000`) são convertidos em decimal — o SQLite os leria como BLOB e
  quebraria cálculos de versão/bitmask do SMO;
- subconjunto procedural de inicialização de clientes (ver abaixo).

Limitações do listener: sem TLS, sem Windows/Integrated Auth, sem MARS. A compatibilidade com
`sqlcmd`, ODBC, JDBC e `tedious` é melhor esforço; o caminho mais previsível é SQL Batch.
`WHILE`, `GOTO`, `RETURN`, `THROW`, `RAISERROR` e `EXEC` arbitrário continuam rejeitados com erro
claro — apenas os batches conhecidos do SSMS/SMO têm shim.

## Catálogo de sistema

Cada cluster nasce com os databases `master`, `tempdb`, `model` e `msdb` (ids 1 a 4). O arquivo
do `master` é anexado como schema `sys` em toda conexão, então `sys.databases`,
`sys.configurations`, `sys.endpoints`, `sys.dm_exec_connections` e `sys.dm_exec_sessions`
funcionam de qualquer database corrente. O `msdb` contém a tabela `sysdac_instances`, usada
pelo DacWizard do SSMS para detectar suporte a DAC.

Funções T-SQL registradas no SQLite (não são interceptadas por regex): `SERVERPROPERTY`,
`CONNECTIONPROPERTY`, `IS_SRVROLEMEMBER`, `SUSER_SNAME`, `SUSER_ID`, `ORIGINAL_LOGIN`,
`IS_MEMBER`, `DB_ID`, `DB_NAME`, `CONVERT`, `QUOTENAME`, `FULLTEXTSERVICEPROPERTY`,
`OBJECT_ID` e `HAS_DBACCESS`. `HAS_DBACCESS` devolve `1` para os databases de sistema,
inclusive `msdb`.

A instância se apresenta como `Standard Edition (64-bit)` / `EngineEdition = 2`.

## Tradução T-SQL → SQLite

| Construto | Status |
|---|---|
| `GETDATE()`, `SYSDATETIME()`, `CURRENT_TIMESTAMP` | Suportado (`datetime('now')`) |
| `NEWID()`, `ISNULL()`, `LEN()` | Suportado |
| `TOP N` / `TOP (N)`, `IDENTITY(1,1)` | Suportado |
| Tipos `NVARCHAR`, `BIT`, `DATETIME`, `MONEY`, `VARBINARY`, etc. | Mapeados no DDL |
| CTE (`WITH ...`) | Suportado nativamente |
| `MERGE`, `UPDATE ... JOIN` simples | Reescrita para UPSERT/subquery |
| `CREATE VIEW`, `CREATE TRIGGER` | Repassados quando o SQLite suporta |
| `DECLARE`/`SET` literais e batches com `GO` | Subconjunto straight-line |
| `sysname` em DDL | Mapeado para `TEXT` |
| `IF EXISTS (...)` / `IF (...)` com comando simples ou bloco `BEGIN...END` | Condição descartada; corpo executado |
| `BEGIN TRY ... END TRY BEGIN CATCH ... END CATCH` | Executa o `TRY`, descarta o `CATCH` |
| `EXEC sp_executesql N'...'` (literal ou variável) | SQL extraído e executado |
| Batch de descoberta de servidor do SSMS (`xp_msver` + `#SVer`) | Substituído por resultset sintético |
| Batch de versão/protocolo do SSMS | Expandido em 3 resultsets (`Tables[0..2]`) |
| Batch de metadados do cliente (`xp_instance_regread`, `database_files`, `IsCaseSensitive`) | Substituído por resultset com paths/collation sintéticos |
| Verificação de AlwaysOn (`xp_qv`) | Devolve `AlwaysOn = -1` (instância não AlwaysOn) |
| `CAST(... AS sysname|UNIQUEIDENTIFIER|XML)` | Mapeado para `TEXT` |
| Literais hex `0x...` | Convertidos em decimal |
| `dbo.` / `[dbo].` em nomes de objetos | Removido (SQLite não tem esquemas) |
| `SET` de sessão do ODBC (`ANSI_WARNINGS`, `TEXTSIZE`, `XACT_ABORT`, etc.) | Ignorado |
| `WHILE`, `GOTO`, `RETURN`, `THROW`, `RAISERROR`, procedures com OUTPUT, CLR | Erro claro (`BadRequestException`) |

Erros de SQL são devolvidos como `BadRequestException` no JSON ou `<Code>BadRequestException</Code>`
no protocolo query.

## Admin e persistência

```bash
curl http://localhost:4700/rds-sqlserver/__admin/health
curl http://localhost:4700/rds-sqlserver/__admin/clusters
curl http://localhost:4700/rds-sqlserver/__admin/instances
curl http://localhost:4700/rds-sqlserver/__admin/databases
curl -X POST http://localhost:4700/rds-sqlserver/__admin/reset
```

Dados ficam em `.aws-local-simulator-data/rds-sqlserver/`:

- `metadata.db`: clusters, instâncias, tags e hash da senha;
- `__rds-sqlserver__.json`: cópia de recuperação via `LocalStore`;
- `<database>.db`: bancos de usuário (SQLite, WAL).

A senha é armazenada apenas como hash+salt (`scryptSync`) e nunca aparece nas respostas ou logs.

## Observações

- A tradução é centralizada no `DbEngine`; a Data API recebe T-SQL bruto.
- Múltiplos clusters com o mesmo usuário são suportados, mas o TDS escolhe pelo `ServerName` do login.
- `StopDBCluster`/`StartDBCluster` apenas alteram o status; o listener TDS não é desligado.
- Snapshots, backups, Multi-AZ, Parameter/Option Groups e Performance Insights não são simulados.
