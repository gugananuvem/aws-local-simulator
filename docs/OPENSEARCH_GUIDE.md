# OpenSearch - Guia Completo

Simulador local de OpenSearch/Elasticsearch com suporte completo a indexação, busca e agregação.

## Começar Rápido

### Instalação

```bash
npm install @gugananuvem/aws-local-simulator
```

### Iniciar OpenSearch

```bash
node examples/opensearch-example.js
```

Ou em um arquivo Node.js:

```javascript
const { startServer } = require('aws-local-simulator');

const config = {
  services: { opensearch: true },
  ports: { opensearch: 9200 }
};

const { server } = await startServer(config);
```

## Porta Padrão

OpenSearch roda em **9200** (padrão Elasticsearch)

## API REST

### 1. Operações de Índice

#### Criar Índice

```bash
curl -X PUT http://localhost:9200/my-index \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 1
    },
    "mappings": {
      "properties": {
        "name": { "type": "text" },
        "age": { "type": "integer" }
      }
    }
  }'
```

**Resposta:**
```json
{
  "acknowledged": true,
  "shards_acknowledged": true,
  "index": "my-index"
}
```

#### Obter Informações do Índice

```bash
curl http://localhost:9200/my-index
```

#### Listar Todos os Índices

```bash
curl http://localhost:9200/__admin/opensearch/indices
```

#### Abrir/Fechar Índice

```bash
# Abrir
curl -X POST http://localhost:9200/my-index/_open

# Fechar
curl -X POST http://localhost:9200/my-index/_close
```

#### Deletar Índice

```bash
curl -X DELETE http://localhost:9200/my-index
```

### 2. Operações de Documento

#### Indexar Documento (Auto ID)

```bash
curl -X POST http://localhost:9200/products/_doc \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Laptop",
    "price": 999.99,
    "category": "Electronics"
  }'
```

**Resposta:**
```json
{
  "_index": "products",
  "_type": "_doc",
  "_id": "abc123...",
  "_version": 1,
  "result": "created"
}
```

#### Indexar Documento (Com ID Específico)

```bash
curl -X PUT http://localhost:9200/products/_doc/1 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mouse",
    "price": 29.99,
    "category": "Peripherals"
  }'
```

#### Obter Documento

```bash
curl http://localhost:9200/products/_doc/1
```

**Resposta:**
```json
{
  "_index": "products",
  "_type": "_doc",
  "_id": "1",
  "_version": 1,
  "found": true,
  "_source": {
    "name": "Mouse",
    "price": 29.99,
    "category": "Peripherals"
  }
}
```

#### Deletar Documento

```bash
curl -X DELETE http://localhost:9200/products/_doc/1
```

### 3. Busca

#### Busca Simples (Query String)

```bash
curl "http://localhost:9200/products/_search?q=Laptop"
```

#### Busca com JSON Query

```bash
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "match": {
        "name": "Laptop"
      }
    },
    "from": 0,
    "size": 10
  }'
```

#### Busca com Filtros (Bool Query)

```bash
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "bool": {
        "must": [
          { "match": { "category": "Electronics" } }
        ],
        "filter": [
          { "range": { "price": { "gte": 100, "lte": 1000 } } }
        ]
      }
    }
  }'
```

#### Full-Text Search

```bash
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "query_string": {
        "query": "laptop OR mouse"
      }
    }
  }'
```

#### Busca com Sorting

```bash
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "match_all": {} },
    "sort": [
      { "price": { "order": "desc" } }
    ]
  }'
```

### 4. Agregações

#### Agregação por Termos

```bash
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "aggs": {
      "categories": {
        "terms": {
          "field": "category",
          "size": 10
        }
      }
    }
  }'
```

**Resposta:**
```json
{
  "aggregations": {
    "categories": {
      "buckets": [
        { "key": "Electronics", "doc_count": 5 },
        { "key": "Peripherals", "doc_count": 3 }
      ]
    }
  }
}
```

#### Agregação Média/Soma

```bash
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "aggs": {
      "avg_price": {
        "avg": {
          "field": "price"
        }
      },
      "total_price": {
        "sum": {
          "field": "price"
        }
      }
    }
  }'
```

### 5. Update & Delete em Lote

#### Atualizar por Query

```bash
curl -X POST http://localhost:9200/products/_update_by_query \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "match": { "category": "Electronics" } },
    "script": {
      "price": 899.99
    }
  }'
```

#### Deletar por Query

```bash
curl -X POST http://localhost:9200/products/_delete_by_query \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "match": { "category": "Discontinued" } }
  }'
```

### 6. Health & Info

#### Health Check

```bash
curl http://localhost:9200/_cluster/health
```

**Resposta:**
```json
{
  "cluster_name": "opensearch-cluster",
  "status": "green",
  "number_of_nodes": 1,
  "active_primary_shards": 5,
  "active_shards": 10
}
```

#### Info do Cluster

```bash
curl http://localhost:9200/
```

#### Estatísticas

```bash
curl http://localhost:9200/_stats
```

## Configuração

### Via Config File

```javascript
const config = {
  opensearch: {
    indices: [
      {
        name: 'products',
        properties: {
          name: { type: 'text' },
          price: { type: 'float' },
          category: { type: 'keyword' }
        }
      }
    ]
  }
};
```

### Tipos de Campo Suportados

- `text` - Texto completo, analisado
- `keyword` - Exato, não analisado
- `integer` - Número inteiro
- `float` - Número decimal
- `date` - Data/timestamp
- `boolean` - Verdadeiro/falso

## Exemplos Completos

### Exemplo 1: E-Commerce

```bash
# Criar índice de produtos
curl -X PUT http://localhost:9200/products \
  -H "Content-Type: application/json" \
  -d '{
    "mappings": {
      "properties": {
        "name": { "type": "text" },
        "category": { "type": "keyword" },
        "price": { "type": "float" },
        "stock": { "type": "integer" }
      }
    }
  }'

# Adicionar produtos
curl -X POST http://localhost:9200/products/_doc \
  -H "Content-Type: application/json" \
  -d '{"name":"iPhone 14","category":"Smartphones","price":999,"stock":50}'

curl -X POST http://localhost:9200/products/_doc \
  -H "Content-Type: application/json" \
  -d '{"name":"Samsung Galaxy","category":"Smartphones","price":799,"stock":30}'

# Buscar smartphones com preço < 900
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "bool": {
        "must": [
          { "match": { "category": "Smartphones" } }
        ],
        "filter": [
          { "range": { "price": { "lt": 900 } } }
        ]
      }
    }
  }'

# Calcular preço médio por categoria
curl -X POST http://localhost:9200/products/_search \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "aggs": {
      "by_category": {
        "terms": { "field": "category" },
        "aggs": {
          "avg_price": { "avg": { "field": "price" } }
        }
      }
    }
  }'
```

### Exemplo 2: Logs

```bash
# Criar índice de logs
curl -X PUT http://localhost:9200/logs \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "number_of_shards": 1
    },
    "mappings": {
      "properties": {
        "level": { "type": "keyword" },
        "message": { "type": "text" },
        "service": { "type": "keyword" },
        "timestamp": { "type": "date" }
      }
    }
  }'

# Adicionar logs
curl -X POST http://localhost:9200/logs/_doc \
  -H "Content-Type: application/json" \
  -d '{"level":"ERROR","message":"Database connection failed","service":"api"}'

# Buscar errors
curl -X POST http://localhost:9200/logs/_search \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "match": { "level": "ERROR" } }
  }'

# Contar errors por serviço
curl -X POST http://localhost:9200/logs/_search \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "aggs": {
      "errors_by_service": {
        "terms": { "field": "service" }
      }
    }
  }'
```

### Exemplo 3: Python Client

```python
from elasticsearch import Elasticsearch

es = Elasticsearch(['http://localhost:9200'])

# Criar índice
es.indices.create(index='users', ignore=400)

# Indexar documento
es.index(index='users', id=1, body={
    'name': 'John Doe',
    'email': 'john@example.com',
    'age': 30
})

# Buscar
results = es.search(index='users', body={
    'query': {
        'match': {'name': 'John'}
    }
})

print(results['hits']['hits'])
```

## Características

✅ CRUD de índices e documentos  
✅ Busca full-text  
✅ Queries complexas (bool, range, etc)  
✅ Agregações (terms, avg, sum)  
✅ Update/Delete em lote  
✅ Paginação  
✅ Sorting  
✅ Persistência em JSON  
✅ Compatible com Elasticsearch/OpenSearch clients

## Limitações

⚠️ Sem análise avançada (tokenizers, stemmers customizados)  
⚠️ Sem suporte a nested queries (parcial)  
⚠️ Sem suporte a pipeline de ingestão  
⚠️ Sem cross-cluster search  

## Persistência

Dados são salvos em `.aws-local-simulator-data/opensearch/`:

```
.aws-local-simulator-data/opensearch/
├── __indices__.json      # Metadados dos índices
├── products.json         # Documentos do índice 'products'
├── users.json           # Documentos do índice 'users'
└── logs.json            # Documentos do índice 'logs'
```

## Performance

- Busca simples: < 10ms
- Agregações: < 50ms
- Indexação: < 5ms
- Ideal para desenvolvimento e testes

## Compatibilidade

- Elasticsearch 7.x
- OpenSearch 1.x, 2.x
- Clientes Python: `elasticsearch-py`
- Clientes Node: `@elastic/elasticsearch`
- Clientes Java: `org.opensearch.client:opensearch-java`
- Postman / curl

## Próximos Passos

1. Integrar com EC2/ALB para buscar dados
2. Usar com Lambda para processar eventos
3. Conectar com S3 para indexar documentos
4. Implementar Kibana-like dashboard

## Troubleshooting

### Índice não encontrado

```bash
# Verificar se índice existe
curl http://localhost:9200/__admin/opensearch/indices

# Ou
curl http://localhost:9200/_cat/indices
```

### Dados não persistem

Certificar que `.aws-local-simulator-data` tem permissões de escrita:

```bash
chmod -R 755 .aws-local-simulator-data
```

### Port 9200 já em uso

Mudar porta na config:

```javascript
ports: { opensearch: 9300 }
```

Depois acessar em `http://localhost:9300`

## Referências

- [Elasticsearch REST API](https://www.elastic.co/guide/en/elasticsearch/reference/current/rest-apis.html)
- [OpenSearch Documentation](https://opensearch.org/docs/)
