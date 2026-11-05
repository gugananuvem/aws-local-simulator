# AWS Policy Enforcement Guide

## 🎯 Overview

A partir de agora, o AWS Local Simulator suporta **enforcement real de políticas** - exatamente como funciona em produção AWS.

Quando habilitado, **todas as operações** em qualquer serviço (S3, SQS, SNS, DynamoDB, KMS, etc.) serão validadas contra:

1. **Service Control Policies (SCPs)** - Definidas na organização
2. **IAM Policies** - Definidas no role/user
3. **Conditions** - Region, IP, time, etc.

---

## 🚀 Começar

### 1. Habilitar Policy Enforcement

Edite `src/config/default-config.js`:

```javascript
{
  "organizationsPolicyEnforcement": {
    "enabled": true,  // ← Mudar para true
    "requireAccountContext": true,
    "scpEvaluation": {
      "enabled": true,
      "logDenials": true,
      "cacheTTL": 60000  // 60 segundos
    }
  }
}
```

### 2. Iniciar o Simulador

```bash
npm start
```

### 3. Usar STS AssumeRole (como em produção)

```bash
# Step 1: Assumir role via STS
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/developer \
  --role-session-name my-session \
  --endpoint-url http://localhost:9326

# Resultado:
{
  "Credentials": {
    "AccessKeyId": "ASIA...",
    "SecretAccessKey": "...",
    "SessionToken": "eyJhbGc..."
  }
}

# Step 2: Usar credentials para criar bucket
aws s3 mb s3://my-bucket \
  --aws-access-key-id ASIA... \
  --aws-secret-access-key ... \
  --aws-session-token eyJhbGc... \
  --endpoint-url http://localhost:4566
```

---

## 📋 Fluxo de Validação

```
1. Request chega em qualquer serviço (S3, SQS, etc)
                ↓
2. Extract principal (via SigV4 ou SessionToken)
                ↓
3. Validate credentials (não expiradas, role existe)
                ↓
4. Get applicable policies:
   ├─ SCPs (Organization hierarchy)
   ├─ IAM policies (role/user)
   └─ Resource-based policies
                ↓
5. Evaluate (AWS order):
   ├─ Explicit DENY → DENY (shortcircuit)
   ├─ Explicit ALLOW + Conditions → ALLOW
   └─ Default DENY → DENY
                ↓
6. Log to CloudTrail (allowed/denied)
                ↓
7. Execute or reject action
```

---

## 🔐 Tipos de Credenciais Suportadas

### 1. STS AssumeRole (Recomendado)

```javascript
const sts = new AWS.STS({ endpoint: 'http://localhost:9326' });

const credentials = await sts.assumeRole({
  RoleArn: 'arn:aws:iam::123456789012:role/developer',
  RoleSessionName: 'my-session',
  DurationSeconds: 3600
}).promise();

// Usar credentials em outros serviços
const s3 = new AWS.S3({
  accessKeyId: credentials.Credentials.AccessKeyId,
  secretAccessKey: credentials.Credentials.SecretAccessKey,
  sessionToken: credentials.Credentials.SessionToken
});
```

### 2. SigV4 Authorization Header

```bash
# AWS CLI já faz isso automaticamente
aws s3 mb s3://my-bucket --endpoint-url http://localhost:4566
```

### 3. Headers Customizados (Desenvolvimento)

```javascript
const s3 = new AWS.S3({
  httpOptions: {
    agent: new https.Agent(),
    agentOptions: {}
  }
});

// Adicionar headers custom
const params = {
  Bucket: 'my-bucket'
};

// Antes de chamar, adicionar headers (se usar SDK customizado)
// X-Account-Id: 123456789012
// X-Role-Arn: arn:aws:iam::123456789012:role/developer
// X-Session-Name: custom-session
```

### 4. Environment Variables (AWS CLI)

```bash
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...
export AWS_ACCOUNT_ID=123456789012
export AWS_ROLE_ARN=arn:aws:iam::123456789012:role/developer

aws s3 mb s3://my-bucket --endpoint-url http://localhost:4566
```

---

## 🛡️ Configurar Políticas

### 1. Criar Organização

```javascript
const orgs = new AWS.Organizations({ endpoint: 'http://localhost:4580' });

// Criar organização
await orgs.createOrganization({ FeatureSet: 'ALL' }).promise();

// Criar OUs
const securityOu = await orgs.createOrganizationalUnit({
  ParentId: 'ou-0000-root',
  Name: 'Security'
}).promise();

// Criar conta
const account = await orgs.createAccount({
  Email: 'dev@example.com',
  AccountName: 'Development',
  ParentOuId: securityOu.OrganizationalUnit.Id
}).promise();
```

### 2. Criar Service Control Policy

```javascript
// Restringir EC2 a us-east-1 apenas
const policy = await orgs.createPolicy({
  Content: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Action: 'ec2:*',
      Resource: '*',
      Condition: {
        StringEquals: { 'aws:RequestedRegion': 'us-east-1' }
      }
    }]
  }),
  Name: 'EC2-Region-Restriction',
  Type: 'SERVICE_CONTROL_POLICY'
}).promise();

// Anexar ao account
await orgs.attachPolicy({
  PolicyId: policy.Policy.PolicySummary.Id,
  TargetId: account.CreateAccountStatus.AccountId
}).promise();
```

### 3. Criar IAM Role com Permissões

```javascript
const iam = new AWS.IAM({ endpoint: 'http://localhost:4003' });

// Criar role
const role = await iam.createRole({
  RoleName: 'developer',
  AssumeRolePolicyDocument: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { AWS: 'arn:aws:iam::123456789012:root' },
      Action: 'sts:AssumeRole'
    }]
  })
}).promise();

// Adicionar permissões
await iam.putRolePolicy({
  RoleName: 'developer',
  PolicyName: 'S3-Access',
  PolicyDocument: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Action: ['s3:*'],
      Resource: '*'
    }]
  })
}).promise();
```

---

## 🧪 Teste com Exemplos

### Exemplo 1: Permitir e Denegar

```javascript
async function testPolicyEnforcement() {
  const orgs = new AWS.Organizations({ endpoint: 'http://localhost:4580' });
  const sts = new AWS.STS({ endpoint: 'http://localhost:9326' });
  const s3 = new AWS.S3({ endpoint: 'http://localhost:4566' });

  // Setup
  await orgs.createOrganization({ FeatureSet: 'ALL' }).promise();

  // Criar SCP que nega S3 em us-west-2
  const denyPolicy = await orgs.createPolicy({
    Content: JSON.stringify({
      Statement: [{
        Effect: 'Deny',
        Action: 's3:*',
        Resource: '*',
        Condition: {
          StringEquals: { 'aws:RequestedRegion': 'us-west-2' }
        }
      }]
    }),
    Name: 'DenyS3UsWest2',
    Type: 'SERVICE_CONTROL_POLICY'
  }).promise();

  // Assumir role
  const credentials = await sts.assumeRole({
    RoleArn: 'arn:aws:iam::123456789012:role/developer',
    RoleSessionName: 'test'
  }).promise();

  // Tentar criar bucket em us-east-1 (deveria funcionar)
  const s3East = new AWS.S3({
    region: 'us-east-1',
    accessKeyId: credentials.Credentials.AccessKeyId,
    secretAccessKey: credentials.Credentials.SecretAccessKey,
    sessionToken: credentials.Credentials.SessionToken
  });

  try {
    await s3East.createBucket({ Bucket: 'test-east' }).promise();
    console.log('✅ S3 em us-east-1 funcionou (permitido)');
  } catch (e) {
    console.log('❌ S3 em us-east-1 falhou (não deveria)');
  }

  // Tentar criar bucket em us-west-2 (deveria falhar)
  const s3West = new AWS.S3({
    region: 'us-west-2',
    accessKeyId: credentials.Credentials.AccessKeyId,
    secretAccessKey: credentials.Credentials.SecretAccessKey,
    sessionToken: credentials.Credentials.SessionToken
  });

  try {
    await s3West.createBucket({ Bucket: 'test-west' }).promise();
    console.log('❌ S3 em us-west-2 funcionou (não deveria)');
  } catch (e) {
    console.log('✅ S3 em us-west-2 foi bloqueado corretamente (AccessDenied)');
  }
}
```

### Exemplo 2: Verificar CloudTrail

```javascript
async function checkAuditTrail() {
  const orgs = new AWS.Organizations({ endpoint: 'http://localhost:4580' });
  const cloudtrail = new AWS.CloudTrail({ endpoint: 'http://localhost:4012' });

  // Verificar eventos
  const events = await cloudtrail.lookupEvents({
    LookupAttributes: [{
      AttributeKey: 'EventName',
      AttributeValue: 'CreateBucket'
    }]
  }).promise();

  console.log('Eventos de CreateBucket:');
  events.Events.forEach(event => {
    console.log(`  - ${event.EventTime}: ${event.EventName}`);
    console.log(`    Principal: ${event.Username}`);
    console.log(`    Status: ${event.CloudTrailEvent.requestStatus}`);
  });
}
```

---

## 🔧 Configuração Avançada

### Cache de Políticas

Políticas são cacheadas por 60 segundos por padrão:

```javascript
// Mudar TTL em default-config.js
{
  "organizationsPolicyEnforcement": {
    "scpEvaluation": {
      "cacheTTL": 120000  // 2 minutos
    }
  }
}
```

### Logging Detalhado

```javascript
{
  "organizationsPolicyEnforcement": {
    "scpEvaluation": {
      "logDenials": true,      // Log tentativas negadas
      "logAllowances": true,   // Log tentativas permitidas (verbose)
      "timeout": 5000          // Timeout de avaliação (ms)
    }
  }
}
```

### Credenciais Temporárias

```javascript
{
  "organizationsPolicyEnforcement": {
    "credentialDuration": 3600,        // 1 hora
    "sessionTokenPrefix": "AQOD"       // Prefixo para reconhecer STS tokens
  }
}
```

---

## 🚨 Troubleshooting

### "AccessDenied" mesmo com permissões

1. Verificar se SCP foi anexado corretamente:
```javascript
const org = new AWS.Organizations({ endpoint: 'http://localhost:4580' });
const policies = await org.listPolicies({ Filter: 'SERVICE_CONTROL_POLICY' }).promise();
console.log('Policies:', policies.Policies);
```

2. Verificar se role existe:
```javascript
const iam = new AWS.IAM({ endpoint: 'http://localhost:4003' });
const role = await iam.getRole({ RoleName: 'developer' }).promise();
console.log('Role:', role.Role.Arn);
```

3. Testar policy sem role:
```javascript
const orgs = new AWS.Organizations({ endpoint: 'http://localhost:4580' });
const evaluation = await orgs.evaluateSCPs({
  AccountId: '123456789012',
  Action: 's3:CreateBucket',
  Resource: 'arn:aws:s3:::my-bucket'
}).promise();
console.log('SCP Evaluation:', evaluation);
```

### Credentials expiraram

SessionTokens expiram após duração configurada (default: 1 hora):

```bash
# Verificar expiração
aws sts get-caller-identity \
  --aws-access-key-id ASIA... \
  --aws-secret-access-key ... \
  --aws-session-token eyJ... \
  --endpoint-url http://localhost:9326

# Se expirou, fazer novo AssumeRole
```

### Cache afetando testes

Limpar cache entre testes:

```javascript
// Desabilitar cache em testes
{
  "organizationsPolicyEnforcement": {
    "scpEvaluation": {
      "cacheTTL": 0  // Cache desabilidado
    }
  }
}
```

---

## 📊 Monitoramento

### Ver Estatísticas de Cache

Adicionar endpoint de admin:

```bash
curl http://localhost:9999/__admin/services/organizations
```

Retorna status incluindo:
- Políticas criadas
- Accounts na organização
- OUs
- Guardrails habilitados

### Verificar CloudTrail

```bash
# Listar eventos
curl http://localhost:4012/__admin/events
```

---

## ⚙️ Habilitação Gradual

Você pode habilitar enforcement seletivamente:

```javascript
{
  "organizationsPolicyEnforcement": {
    "enabled": true,
    "enforcedServices": [
      "s3",
      // "sqs",   // Habilitar depois
      // "dynamodb"
    ]
  }
}
```

---

## 🎓 Comparação com AWS Real

| Aspecto | Local Simulator | AWS Real |
|---------|-----------------|----------|
| SCP Evaluation | ✅ Igual | ✅ Idêntico |
| IAM Policies | ✅ Igual | ✅ Idêntico |
| Conditions | ✅ Region, IP, Time | ✅ Igual |
| SessionToken | ✅ JWT com info | ✅ Igual |
| Cache | ✅ 60s TTL | ✅ Igual |
| CloudTrail Logging | ✅ Sim | ✅ Sim |
| Error Format | ✅ AWS format | ✅ Idêntico |

---

## 📚 Documentação Relacionada

- [Organizations Guide](./ORGANIZATIONS_GUIDE.md) - Criação de organizações e SCPs
- [Middleware Integration](../src/services/MIDDLEWARE_INTEGRATION_GUIDE.md) - Como integrar em novos serviços
- [IAM Guide](./IAM_GUIDE.md) - Criação de roles/users
- [Examples](../examples/) - Exemplos práticos

---

## 🤝 Support

Para problemas ou dúvidas:

1. Verificar logs: `npm start -- --log-level debug`
2. Consultar testes: `tests/policy-enforcement-integration.test.js`
3. Abrir issue com detalhes (config, steps, erro esperado)
