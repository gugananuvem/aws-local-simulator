# Athena

## 📖 Visão Geral

**AWS Athena** é um serviço de consulta interativa que permite executar consultas SQL em dados armazenados no S3 sem necessidade de gerenciar infraestrutura.

**Porta**: `4599`  
**Endpoint**: `http://localhost:4599`

### Features Suportadas
- ✅ Workgroups
- ✅ Query execution
- ✅ Named queries
- ✅ Query results
- ✅ Databases and tables
- ✅ S3 result locations

---

## 🚀 Quick Start

### 1. Criar Workgroup

```bash
aws athena create-work-group \
  --name my-workgroup \
  --configuration ResultConfiguration={OutputLocation=s3://my-bucket/athena-results/} \
  --endpoint-url http://localhost:4599
```

**Resposta:**
```json
{
  "WorkGroup": {
    "Name": "my-workgroup",
    "Configuration": {
      "ResultConfiguration": {
        "OutputLocation": "s3://my-bucket/athena-results/"
      }
    },
    "CreationTime": 1234567890
  }
}
```

### 2. Executar Query

```bash
aws athena start-query-execution \
  --query-string "SELECT * FROM my_table LIMIT 10" \
  --query-execution-context Database=default \
  --result-configuration OutputLocation=s3://my-bucket/athena-results/ \
  --endpoint-url http://localhost:4599
```

**Resposta:**
```json
{
  "QueryExecutionId": "12345678-1234-1234-1234-123456789012"
}
```

### 3. Verificar Status da Query

```bash
aws athena get-query-execution \
  --query-execution-id 12345678-1234-1234-1234-123456789012 \
  --endpoint-url http://localhost:4599
```

**Resposta:**
```json
{
  "QueryExecution": {
    "QueryExecutionId": "12345678-1234-1234-1234-123456789012",
    "Query": "SELECT * FROM my_table LIMIT 10",
    "StatementType": "DML",
    "ExecutionContext": {
      "Database": "default"
    },
    "Status": {
      "State": "SUCCEEDED",
      "StateChangeReason": "Query completed",
      "SubmissionDateTime": 1234567890,
      "CompletionDateTime": 1234567891
    },
    "ResultConfiguration": {
      "OutputLocation": "s3://my-bucket/athena-results/12345678-1234-1234-1234-123456789012.csv"
    }
  }
}
```

### 4. Recuperar Resultados

```bash
aws athena get-query-results \
  --query-execution-id 12345678-1234-1234-1234-123456789012 \
  --endpoint-url http://localhost:4599
```

---

## 📝 Exemplos Avançados

### Criar Named Query

```bash
aws athena create-named-query \
  --name "my-saved-query" \
  --database default \
  --query-string "SELECT id, name, email FROM users WHERE status = 'active'" \
  --description "Get active users" \
  --endpoint-url http://localhost:4599
```

### Listar Named Queries

```bash
aws athena list-named-queries \
  --endpoint-url http://localhost:4599
```

### Listar Workgroups

```bash
aws athena list-work-groups \
  --endpoint-url http://localhost:4599
```

### Query com Aggregação

```bash
aws athena start-query-execution \
  --query-string "SELECT status, COUNT(*) as count FROM users GROUP BY status" \
  --query-execution-context Database=default \
  --result-configuration OutputLocation=s3://my-bucket/athena-results/ \
  --endpoint-url http://localhost:4599
```

### Query com JOIN

```bash
aws athena start-query-execution \
  --query-string "SELECT u.id, u.name, o.order_id FROM users u JOIN orders o ON u.id = o.user_id" \
  --query-execution-context Database=default \
  --result-configuration OutputLocation=s3://my-bucket/athena-results/ \
  --endpoint-url http://localhost:4599
```

---

## 🧪 Testing

### Teste 1: Criar e Listar Workgroups

```bash
# Criar workgroup
WG=$(aws athena create-work-group \
  --name test-wg \
  --configuration ResultConfiguration={OutputLocation=s3://test-bucket/results/} \
  --endpoint-url http://localhost:4599 \
  --query 'WorkGroup.Name' \
  --output text)

# Listar workgroups
aws athena list-work-groups --endpoint-url http://localhost:4599

# Verificar workgroup criado
echo "Workgroup criado: $WG"
```

### Teste 2: Executar e Verificar Query

```bash
# Executar query
QUERY_ID=$(aws athena start-query-execution \
  --query-string "SELECT 1 as test" \
  --query-execution-context Database=default \
  --result-configuration OutputLocation=s3://test-bucket/results/ \
  --endpoint-url http://localhost:4599 \
  --query 'QueryExecutionId' \
  --output text)

# Aguardar um pouco
sleep 1

# Verificar status
STATUS=$(aws athena get-query-execution \
  --query-execution-id $QUERY_ID \
  --endpoint-url http://localhost:4599 \
  --query 'QueryExecution.Status.State' \
  --output text)

echo "Query ID: $QUERY_ID"
echo "Status: $STATUS"

# Se SUCCEEDED, buscar resultados
if [ "$STATUS" = "SUCCEEDED" ]; then
  aws athena get-query-results \
    --query-execution-id $QUERY_ID \
    --endpoint-url http://localhost:4599
fi
```

### Teste 3: Criar e Usar Named Query

```bash
# Criar named query
NAMED_QUERY_ID=$(aws athena create-named-query \
  --name "test-query" \
  --database default \
  --query-string "SELECT 'Hello' as greeting" \
  --endpoint-url http://localhost:4599 \
  --query 'NamedQueryId' \
  --output text)

echo "Named Query ID: $NAMED_QUERY_ID"

# Listar named queries
aws athena list-named-queries --endpoint-url http://localhost:4599

# Buscar named query
aws athena get-named-query \
  --named-query-id $NAMED_QUERY_ID \
  --endpoint-url http://localhost:4599
```

---

## 📊 Configuração

### Arquivo aws-local-simulator.json

```json
{
  "services": {
    "athena": true
  },
  "ports": {
    "athena": 4599
  }
}
```

### Variáveis de Ambiente

```bash
export AWS_LOCAL_SIMULATOR_ATHENA=true
export AWS_LOCAL_SIMULATOR_ATHENA_PORT=4599
```

---

## 🔗 Integração com S3

Athena trabalha com dados armazenados no S3:

```bash
# 1. Criar bucket S3
aws s3 mb s3://my-data-bucket --endpoint-url http://localhost:4566

# 2. Upload de dados (CSV)
cat > data.csv << 'EOF'
id,name,email
1,João,joao@example.com
2,Maria,maria@example.com
3,Pedro,pedro@example.com
EOF

aws s3 cp data.csv s3://my-data-bucket/data.csv --endpoint-url http://localhost:4566

# 3. Criar tabela (external table em Athena apontando para S3)
aws athena start-query-execution \
  --query-string "CREATE EXTERNAL TABLE users (id INT, name STRING, email STRING) \
                  ROW FORMAT DELIMITED FIELDS TERMINATED BY ',' \
                  LOCATION 's3://my-data-bucket/'" \
  --query-execution-context Database=default \
  --result-configuration OutputLocation=s3://my-data-bucket/results/ \
  --endpoint-url http://localhost:4599

# 4. Consultar dados
aws athena start-query-execution \
  --query-string "SELECT * FROM users WHERE id > 1" \
  --query-execution-context Database=default \
  --result-configuration OutputLocation=s3://my-data-bucket/results/ \
  --endpoint-url http://localhost:4599
```

---

## 📋 Endpoints Disponíveis

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/` | Executar query (start-query-execution) |
| GET | `/` | Listar queries |
| GET | `/:id` | Obter detalhes de query |

---

## 🐛 Troubleshooting

### Query retorna erro "Database not found"

```bash
# Criar database primeiro
aws athena start-query-execution \
  --query-string "CREATE DATABASE my_database" \
  --result-configuration OutputLocation=s3://my-bucket/results/ \
  --endpoint-url http://localhost:4599
```

### OutputLocation inválido

```bash
# Garantir que S3 bucket existe
aws s3 mb s3://my-bucket --endpoint-url http://localhost:4566

# Usar em result-configuration
--result-configuration OutputLocation=s3://my-bucket/athena-results/
```

### Query pendente indefinidamente

```bash
# Verificar status
aws athena get-query-execution \
  --query-execution-id <ID> \
  --endpoint-url http://localhost:4599
```

---

## 📚 Referências

- **Amazon Athena Documentation**: https://docs.aws.amazon.com/athena/
- **AWS CLI Athena Commands**: https://docs.aws.amazon.com/cli/latest/reference/athena/
- **Integração com S3**: [S3 Documentation](S3.md)

---

**Versão**: 1.0.0  
**Última atualização**: Outubro 2024

