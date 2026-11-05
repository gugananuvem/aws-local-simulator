# Middleware Integration Guide

## Como integrar Policy Enforcement em qualquer serviço

### Passo 1: Importar os middlewares

```javascript
const { setupServiceMiddleware } = require('../../middleware');
```

### Passo 2: Setup no servidor (server.js)

```javascript
class YourServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.organizationsService = null;
    this.stsService = null;
  }

  // Injetar dependências
  injectDependencies(organizationsService, stsService) {
    this.organizationsService = organizationsService;
    this.stsService = stsService;
  }

  async initialize() {
    // ... código existente ...

    // ADICIONAR: Setup dos middlewares
    if (this.organizationsService) {
      setupServiceMiddleware(
        this.app,
        this.organizationsService,
        this.stsService,
        'your-service-name' // ex: 's3', 'sqs', 'dynamodb'
      );
    }

    this.setupRoutes();
  }
}
```

### Passo 3: Usar dados do principal nas rotas

```javascript
setupRoutes() {
  // Exemplo: CreateBucket com enforcement
  this.app.put('/:bucket', (req, res) => {
    try {
      // req.principal contém o usuário/role
      // req.accountId contém a account ID
      // req.roleArn contém o ARN do role
      // req.policyDecision contém {allowed, deniedBy, allowedBy}

      if (req.policyDecision && !req.policyDecision.allowed) {
        return res.status(403).json(req.policyDecision);
      }

      // Usar accountId para segregar dados por conta
      const result = this.simulator.createBucket(
        req.params.bucket,
        req.accountId || 'default'
      );

      res.status(200).send();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
```

---

## Configuração no Service Wrapper (index.js)

```javascript
class YourService {
  async initialize() {
    // ... código existente ...

    this.server = new YourServer(this.port, this.config);
    await this.server.initialize();
  }

  injectDependencies(server) {
    // Injetar Organizations e STS
    const organizationsService = server.servicesMap.get('organizations');
    const stsService = server.servicesMap.get('sts');

    this.server.injectDependencies(organizationsService, stsService);
  }
}
```

---

## Habilitação/Desabilitação

### Arquivo default-config.js

```javascript
{
  "organizationsPolicyEnforcement": {
    "enabled": true,  // ← Altere para false para desabilitar
    "requireAccountContext": false,
    "scpEvaluation": {
      "enabled": true,
      "cacheTTL": 60000,
      "logDenials": true
    }
  }
}
```

### Por serviço (opcional)

```javascript
const config = req.app.locals.organizationsPolicyEnforcement || {};

if (config.enabled && config.enforcedServices?.includes('s3')) {
  // Enforcement ativado para S3
} else {
  // Enforcement desativado
}
```

---

## Variáveis disponíveis nas rotas

```javascript
// Dados do principal
req.principal = {
  accountId: '123456789012',
  roleArn: 'arn:aws:iam::123456789012:role/developer',
  assumedRole: 'arn:aws:iam::123456789012:role/developer',
  sessionName: 'my-session',
  credentials: { accessKeyId, secretAccessKey, sessionToken },
  issuedAt: timestamp,
  expiresAt: timestamp,
  type: 'sts' | 'sigv4' | 'env' | 'custom'
}

// Account ID (extraído do role)
req.accountId = '123456789012'

// ARN do role
req.roleArn = 'arn:aws:iam::123456789012:role/developer'

// Credentials
req.credentials = {
  accessKeyId: 'ASIA...',
  secretAccessKey: 'xxx',
  sessionToken: 'JWT token'
}

// Decisão de policy
req.policyDecision = {
  allowed: true | false,
  principal: 'arn:aws:iam::123456789012:role/developer',
  action: 's3:CreateBucket',
  resource: 'arn:aws:s3:::my-bucket',
  account: '123456789012',
  deniedBy: [{type: 'SCP', ...}],
  allowedBy: [{type: 'IAM', ...}]
}

// Request ID para rastreamento
req.requestId = 'ABC123...'
```

---

## Teste rápido

### Com enforcement DESATIVADO (atual)

```bash
curl -X PUT http://localhost:4566/my-bucket
# ✅ Funciona normalmente
```

### Com enforcement ATIVADO

```bash
# 1. Assumir role
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/developer \
  --role-session-name test-session \
  --endpoint-url http://localhost:9326

# 2. Usar credentials
aws s3 mb s3://my-bucket \
  --aws-access-key-id ASIA... \
  --aws-secret-access-key ... \
  --aws-session-token ... \
  --endpoint-url http://localhost:4566

# Resultado:
# ✅ Se role tem SCP + IAM permitindo → Bucket criado
# ❌ Se SCP ou IAM nega → AccessDenied
```

---

## Suporte para Segregação por Conta

Cada serviço pode segregar dados por account ID:

```javascript
// Armazenar dados por conta
const bucketKey = `${req.accountId}:${req.params.bucket}`;
this.buckets.set(bucketKey, bucket);

// Listar apenas buckets da conta
const accountBuckets = Array.from(this.buckets.keys())
  .filter(key => key.startsWith(req.accountId))
  .map(key => key.split(':')[1]);
```

---

## Logging e Auditoria

Via CloudTrail (quando integrado):

```
Action: s3:CreateBucket
Principal: arn:aws:iam::123456789012:role/developer
Resource: arn:aws:s3:::my-bucket
Account: 123456789012
Region: us-east-1
Result: Success | AccessDenied
DeniedBy: [SCP] | [IAM]
AllowedBy: [SCP, IAM]
```

---

## Cache de Políticas

O cache é automático e configurável:

```javascript
// Via middleware, cache de 60s por padrão
// Invalidar cache quando política muda:

const { PolicyCache } = require('../../utils/policy-cache');
const cache = new PolicyCache();

// Invalidar todas ações de um principal
cache.invalidatePrincipal('arn:aws:iam::123456789012:role/developer');

// Invalidar um service + ação
cache.invalidateAction('s3:CreateBucket');

// Ver estatísticas
const stats = cache.getStats();
console.log(`Cache hit rate: ${stats.hitRate}`);
```

---

## Migração de Serviços

Para manter compatibilidade com testes rápidos, desabilite enforcement:

```javascript
// default-config.js
{
  "organizationsPolicyEnforcement": {
    "enabled": false  // ← Desabilitado durante desenvolvimento
  }
}
```

Depois ative gradualmente quando pronto:

```javascript
{
  "organizationsPolicyEnforcement": {
    "enabled": true,
    "enforcedServices": [
      "s3",      // Já testado
      // "sqs",   // Implementar depois
      // "sns"
    ]
  }
}
```
