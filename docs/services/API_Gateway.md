# API Gateway (AWS API Gateway)

## Visão Geral

AWS API Gateway é um serviço gerenciado que permite criar APIs REST e HTTP de forma rápida. O simulador local oferece suporte completo a API Gateway, permitindo criar endpoints, rotas, autenticadores e validadores localmente.

**Principais Features:**
- Criar APIs REST
- Definir recursos e métodos
- Integração com Lambda, DynamoDB, SNS e SQS
- Autorizadores (Cognito, Lambda)
- Request/Response transformations
- API Keys e throttling
- CORS configurável

## Porta e Endpoint

**Porta Padrão:** `4567`  
**URL Base:** `http://localhost:4567`  
**Admin API:** `http://localhost:4567/__admin/apis`

## Quick Start

### 1. Criar API REST

```bash
aws apigateway create-rest-api \
  --name my-api \
  --description "My REST API" \
  --endpoint-url http://localhost:4567
```

### 2. Criar Recurso

```bash
aws apigateway create-resource \
  --rest-api-id YOUR_API_ID \
  --parent-id ROOT_ID \
  --path-part users \
  --endpoint-url http://localhost:4567
```

### 3. Criar Método

```bash
aws apigateway put-method \
  --rest-api-id YOUR_API_ID \
  --resource-id RESOURCE_ID \
  --http-method GET \
  --authorization-type NONE \
  --endpoint-url http://localhost:4567
```

### 4. Configurar Integração

```bash
aws apigateway put-integration \
  --rest-api-id YOUR_API_ID \
  --resource-id RESOURCE_ID \
  --http-method GET \
  --type MOCK \
  --endpoint-url http://localhost:4567
```

### 5. Testar Endpoint

```bash
curl http://localhost:4567/users
```

## Operações Básicas

### Listar APIs

```bash
aws apigateway get-rest-apis --endpoint-url http://localhost:4567
```

### Descrever API

```bash
aws apigateway get-rest-api \
  --rest-api-id YOUR_API_ID \
  --endpoint-url http://localhost:4567
```

### Listar Recursos

```bash
aws apigateway get-resources \
  --rest-api-id YOUR_API_ID \
  --endpoint-url http://localhost:4567
```

### Listar Métodos

```bash
aws apigateway get-method \
  --rest-api-id YOUR_API_ID \
  --resource-id RESOURCE_ID \
  --http-method GET \
  --endpoint-url http://localhost:4567
```

### Deletar API

```bash
aws apigateway delete-rest-api \
  --rest-api-id YOUR_API_ID \
  --endpoint-url http://localhost:4567
```

## Exemplos de Uso

### Exemplo 1: API REST Simples

No arquivo `aws-local-simulator.json`:

```json
{
  "apigateway": {
    "apis": [
      {
        "name": "users-api",
        "routes": [
          {
            "path": "/users",
            "method": "GET",
            "handler": "lambda",
            "lambda": "get-users-function"
          },
          {
            "path": "/users",
            "method": "POST",
            "handler": "lambda",
            "lambda": "create-user-function"
          },
          {
            "path": "/users/{id}",
            "method": "GET",
            "handler": "lambda",
            "lambda": "get-user-function"
          },
          {
            "path": "/users/{id}",
            "method": "PUT",
            "handler": "lambda",
            "lambda": "update-user-function"
          }
        ]
      }
    ]
  },
  "lambdas": [
    {
      "name": "get-users-function",
      "handler": "./handlers/get-users.js"
    },
    {
      "name": "create-user-function",
      "handler": "./handlers/create-user.js"
    }
  ]
}
```

### Exemplo 2: API com Autenticação Cognito

```json
{
  "apigateway": {
    "apis": [
      {
        "name": "protected-api",
        "routes": [
          {
            "path": "/profile",
            "method": "GET",
            "authorizer": "cognito",
            "authorizerConfig": {
              "userPoolId": "us-east-1_xxxxx",
              "clientId": "client-id"
            },
            "handler": "lambda",
            "lambda": "get-profile-function"
          }
        ]
      }
    ]
  }
}
```

Chamar endpoint protegido:

```bash
# Obter token JWT
TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id us-east-1_xxxxx \
  --client-id client-id \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=user@example.com,PASSWORD=Password@123 \
  --endpoint-url http://localhost:9229 \
  | jq -r '.AuthenticationResult.IdToken')

# Usar token para acessar endpoint protegido
curl -H "Authorization: Bearer $TOKEN" http://localhost:4567/profile
```

### Exemplo 3: API com Lambda Authorizer

```json
{
  "apigateway": {
    "apis": [
      {
        "name": "api-with-custom-auth",
        "routes": [
          {
            "path": "/admin",
            "method": "GET",
            "authorizer": "lambda",
            "authorizerFunction": "authorize-lambda",
            "handler": "lambda",
            "lambda": "admin-function"
          }
        ]
      }
    ]
  },
  "lambdas": [
    {
      "name": "authorize-lambda",
      "handler": "./handlers/authorizer.js"
    }
  ]
}
```

Authorizer Lambda (`./handlers/authorizer.js`):

```javascript
exports.handler = async (event) => {
  const token = event.authorizationToken;
  
  if (token === 'valid-token') {
    return {
      principalId: 'user-123',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [{
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: event.methodArn
        }]
      }
    };
  }
  
  return {
    principalId: 'user',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: 'Deny',
        Resource: event.methodArn
      }]
    }
  };
};
```

### Exemplo 4: API com Request Validation

```json
{
  "apigateway": {
    "apis": [
      {
        "name": "validated-api",
        "routes": [
          {
            "path": "/items",
            "method": "POST",
            "requestModel": {
              "name": "string",
              "price": "number",
              "quantity": "integer"
            },
            "handler": "lambda",
            "lambda": "create-item-function"
          }
        ]
      }
    ]
  }
}
```

### Exemplo 5: API com CORS

```json
{
  "apigateway": {
    "apis": [
      {
        "name": "cors-api",
        "cors": {
          "allowedOrigins": ["*"],
          "allowedMethods": ["GET", "POST", "PUT", "DELETE"],
          "allowedHeaders": ["Content-Type", "Authorization"],
          "exposedHeaders": ["X-Custom-Header"]
        },
        "routes": [
          {
            "path": "/data",
            "method": "GET",
            "handler": "lambda",
            "lambda": "get-data-function"
          }
        ]
      }
    ]
  }
}
```

### Exemplo 6: API com API Keys

```bash
# Criar API Key
aws apigateway create-api-key \
  --name my-api-key \
  --enabled \
  --endpoint-url http://localhost:4567

# Usar API Key
curl -H "x-api-key: YOUR_API_KEY" http://localhost:4567/protected-endpoint
```

## Integration Types

| Tipo | Descrição | Uso |
|------|-----------|-----|
| AWS_PROXY | Lambda proxy integration | Recomendado para Lambda |
| AWS | AWS service integration | DynamoDB, SQS, SNS |
| HTTP | HTTP endpoint | URLs externas |
| HTTP_PROXY | HTTP proxy | Proxy de requests |
| MOCK | Mock response | Testes |

## Método de Autorização

| Tipo | Descrição |
|------|-----------|
| NONE | Sem autenticação |
| AWS_IAM | AWS IAM |
| CUSTOM_AUTHORIZER | Lambda customizado |
| COGNITO_USER_POOLS | Cognito User Pool |
| AWS_API_KEY | API Key |

## Request/Response Models

```json
{
  "apigateway": {
    "models": [
      {
        "name": "User",
        "schema": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "name": { "type": "string" },
            "email": { "type": "string", "format": "email" }
          },
          "required": ["id", "name", "email"]
        }
      }
    ]
  }
}
```

## Referências

- [AWS API Gateway Documentation](https://docs.aws.amazon.com/apigateway/)
- [API Gateway Authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-control-access-to-api.html)
- [Integrating with Lambda](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
