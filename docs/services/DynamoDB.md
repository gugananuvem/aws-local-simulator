# DynamoDB (Amazon DynamoDB)

## Visão Geral

Amazon DynamoDB é um banco de dados NoSQL gerenciado, rápido e flexível. O simulador local oferece compatibilidade completa com a API DynamoDB, permitindo desenvolver e testar aplicações com tabelas, índices e operações CRUD localmente sem custos.

**Principais Features:**
- Tabelas NoSQL com hash e range keys
- Índices secundários (Global e Local)
- Operações CRUD (Create, Read, Update, Delete)
- Queries e scans com filtros
- Batch operations
- TTL (Time To Live) para expiração automática
- Streams para capturar mudanças

## Porta e Endpoint

**Porta Padrão:** `8000`  
**URL Base:** `http://localhost:8000`  
**Admin API:** `http://localhost:8000/__admin/tables`

## Quick Start

### 1. Criar Tabela

```bash
aws dynamodb create-table \
  --table-name users-table \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000
```

### 2. Adicionar Item

```bash
aws dynamodb put-item \
  --table-name users-table \
  --item '{"id":{"S":"user-1"},"name":{"S":"João"},"email":{"S":"joao@example.com"}}' \
  --endpoint-url http://localhost:8000
```

### 3. Obter Item

```bash
aws dynamodb get-item \
  --table-name users-table \
  --key '{"id":{"S":"user-1"}}' \
  --endpoint-url http://localhost:8000
```

### 4. Listar Itens

```bash
aws dynamodb scan --table-name users-table --endpoint-url http://localhost:8000
```

### 5. Deletar Item

```bash
aws dynamodb delete-item \
  --table-name users-table \
  --key '{"id":{"S":"user-1"}}' \
  --endpoint-url http://localhost:8000
```

## Operações Básicas

### Listar Tabelas

```bash
aws dynamodb list-tables --endpoint-url http://localhost:8000
```

### Descrever Tabela

```bash
aws dynamodb describe-table \
  --table-name users-table \
  --endpoint-url http://localhost:8000
```

### Atualizar Item

```bash
aws dynamodb update-item \
  --table-name users-table \
  --key '{"id":{"S":"user-1"}}' \
  --attribute-updates '{"email":{"Action":"PUT","Value":{"S":"newemail@example.com"}}}' \
  --endpoint-url http://localhost:8000
```

### Query com Condição

```bash
aws dynamodb query \
  --table-name users-table \
  --key-condition-expression "id = :uid" \
  --expression-attribute-values '{":uid":{"S":"user-1"}}' \
  --endpoint-url http://localhost:8000
```

### Scan com Filtro

```bash
aws dynamodb scan \
  --table-name users-table \
  --filter-expression "attribute_exists(email)" \
  --endpoint-url http://localhost:8000
```

### Deletar Tabela

```bash
aws dynamodb delete-table \
  --table-name users-table \
  --endpoint-url http://localhost:8000
```

## Exemplos de Uso

### Exemplo 1: Tabela de Usuários com Node.js

```javascript
const { DynamoDBClient, PutCommand, GetCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({
  endpoint: 'http://localhost:8000',
  region: 'us-east-1'
});

// Adicionar usuário
async function addUser(userId, name, email) {
  await dynamodb.send(new PutCommand({
    TableName: 'users-table',
    Item: {
      id: { S: userId },
      name: { S: name },
      email: { S: email },
      createdAt: { N: Date.now().toString() }
    }
  }));
}

// Obter usuário
async function getUser(userId) {
  const response = await dynamodb.send(new GetCommand({
    TableName: 'users-table',
    Key: { id: { S: userId } }
  }));
  return response.Item;
}

// Usar
await addUser('user-1', 'João Silva', 'joao@example.com');
const user = await getUser('user-1');
console.log(user);
```

### Exemplo 2: Tabela com Sort Key (Posts por Usuário)

```bash
# Criar tabela
aws dynamodb create-table \
  --table-name posts-table \
  --attribute-definitions \
    AttributeName=userId,AttributeType=S \
    AttributeName=createdAt,AttributeType=N \
  --key-schema \
    AttributeName=userId,KeyType=HASH \
    AttributeName=createdAt,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000

# Adicionar post
aws dynamodb put-item \
  --table-name posts-table \
  --item '{"userId":{"S":"user-1"},"createdAt":{"N":"1630000000"},"title":{"S":"First Post"},"content":{"S":"Hello World"}}' \
  --endpoint-url http://localhost:8000

# Query posts de um usuário (últimos 10)
aws dynamodb query \
  --table-name posts-table \
  --key-condition-expression "userId = :uid" \
  --expression-attribute-values '{":uid":{"S":"user-1"}}' \
  --limit 10 \
  --scan-index-forward false \
  --endpoint-url http://localhost:8000
```

### Exemplo 3: Batch Write Operations

```javascript
const { DynamoDBClient, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({
  endpoint: 'http://localhost:8000',
  region: 'us-east-1'
});

async function batchInsertUsers(users) {
  const params = {
    RequestItems: {
      'users-table': users.map(user => ({
        PutRequest: {
          Item: {
            id: { S: user.id },
            name: { S: user.name },
            email: { S: user.email }
          }
        }
      }))
    }
  };

  await dynamodb.send(new BatchWriteItemCommand(params));
}

// Usar
await batchInsertUsers([
  { id: 'user-1', name: 'João', email: 'joao@example.com' },
  { id: 'user-2', name: 'Maria', email: 'maria@example.com' },
  { id: 'user-3', name: 'Pedro', email: 'pedro@example.com' }
]);
```

### Exemplo 4: Scan com Paginação

```bash
# Primeiro scan
aws dynamodb scan \
  --table-name users-table \
  --limit 10 \
  --endpoint-url http://localhost:8000

# Próxima página (usar LastEvaluatedKey da resposta anterior)
aws dynamodb scan \
  --table-name users-table \
  --limit 10 \
  --exclusive-start-key '{"id":{"S":"user-10"}}' \
  --endpoint-url http://localhost:8000
```

### Exemplo 5: Índice Global Secundário

```bash
# Criar tabela com GSI para busca por email
aws dynamodb create-table \
  --table-name users-table \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=email,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    'IndexName=email-index,Keys=[{AttributeName=email,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5}' \
  --billing-mode PROVISIONED \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --endpoint-url http://localhost:8000

# Query por email usando GSI
aws dynamodb query \
  --table-name users-table \
  --index-name email-index \
  --key-condition-expression "email = :email" \
  --expression-attribute-values '{":email":{"S":"joao@example.com"}}' \
  --endpoint-url http://localhost:8000
```

## Tipos de Dados

| Tipo | Símbolo | Exemplo |
|------|---------|---------|
| String | S | `{"name":{"S":"John"}}` |
| Number | N | `{"age":{"N":"30"}}` |
| Binary | B | `{"data":{"B":"base64data"}}` |
| Boolean | BOOL | `{"active":{"BOOL":true}}` |
| List | L | `{"items":{"L":[{"S":"item1"}]}}` |
| Map | M | `{"address":{"M":{"city":{"S":"NY"}}}}` |
| String Set | SS | `{"tags":{"SS":["tag1","tag2"]}}` |
| Number Set | NS | `{"numbers":{"NS":["1","2","3"]}}` |
| Null | NULL | `{"field":{"NULL":true}}` |

## Referências

- [AWS DynamoDB Documentation](https://docs.aws.amazon.com/dynamodb/)
- [DynamoDB API Reference](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
