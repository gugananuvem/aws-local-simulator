# CloudFront + S3 Bucket Policy - Access Control

CloudFront agora **valida permissões** quando tenta acessar objetos em buckets S3. Se o bucket tem uma política que **não permite** acesso do CloudFront, a requisição retorna **403 Access Denied**.

## 🔒 Como Funciona

```
Client → CloudFront → S3 Bucket
              ↓
        Verificar bucket policy
              ↓
        ✅ Permitido → Retorna objeto
        ❌ Negado → 403 Access Denied
```

## 📋 S3 Bucket Policy

Existem 3 tipos de política no S3:

### 1️⃣ Sem Política (Padrão - Bucket Privado)
```javascript
// Criar bucket SEM política = privado
const bucket = s3.createBucket('my-bucket');

// CloudFront tenta acessar
cloudfront.processRequest({
  distributionId: distribution.id,
  path: '/document.pdf'
});

// Resultado: 403 Access Denied (sem política = privado)
```

### 2️⃣ Política Pública
```javascript
const s3 = s3Service.getSimulator();
s3.createBucket('my-bucket');

// Definir política pública
s3.putBucketPolicy('my-bucket', {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: '*',  // Qualquer um
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::my-bucket/*'
  }]
});

// CloudFront acessa com sucesso
cloudfront.processRequest({
  distributionId: distribution.id,
  path: '/document.pdf'
});

// Resultado: 200 OK + arquivo
```

### 3️⃣ Política Específica para CloudFront

#### Opção A: Com CloudFront Service Principal
```javascript
s3.putBucketPolicy('my-bucket', {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: {
      Service: 'cloudfront.amazonaws.com'
    },
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::my-bucket/*'
  }]
});
```

#### Opção B: Com Origin Access Identity (OAI)
```javascript
// Criar distribuição com OAI
const distribution = simulator.createDistribution({
  CallerReference: 'my-app-1',
  Origins: [{
    Id: 's3Origin',
    DomainName: 'my-bucket.s3.amazonaws.com',
    S3OriginConfig: {
      OriginAccessIdentity: 'origin-access-identity/cloudfront/ABCDEFG1234567'
    }
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 's3Origin',
    DefaultTTL: 86400
  },
  Enabled: true
});

// Política permite apenas a OAI específica
s3.putBucketPolicy('my-bucket', {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: {
      AWS: 'arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity/ABCDEFG1234567'
    },
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::my-bucket/*'
  }]
});

// CloudFront consegue acessar (OAI está autorizada)
const response = simulator.processRequest({
  distributionId: distribution.id,
  path: '/document.pdf'
});
// Resultado: 200 OK
```

---

## 📊 Exemplos Práticos

### Exemplo 1: Bucket Privado (Sem Acesso)

```javascript
// 1. Criar bucket (SEM política = privado)
const s3 = s3Service.getSimulator();
s3.createBucket('private-bucket');
s3.putObject('private-bucket', 'secret.txt', 'Secret content');

// 2. Registrar S3 no CloudFront
const cf = cloudFrontService.getSimulator();
cf.registerService('s3', s3Service);

// 3. Criar distribuição apontando para bucket privado
const distribution = cf.createDistribution({
  Origins: [{
    Id: 's3',
    DomainName: 'private-bucket.s3.amazonaws.com'
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 's3',
    ViewerProtocolPolicy: 'https-only'
  },
  Enabled: true
});

// 4. Tentar acessar (vai falhar)
const response = cf.processRequest({
  distributionId: distribution.id,
  path: '/secret.txt'
});

console.log(response.status);  // 403
console.log(response.error);   // "Access Denied to S3 bucket: private-bucket..."
```

### Exemplo 2: Bucket Público

```javascript
// 1. Criar bucket
const s3 = s3Service.getSimulator();
s3.createBucket('public-bucket');
s3.putObject('public-bucket', 'document.pdf', <buffer>);

// 2. Definir política pública
s3.putBucketPolicy('public-bucket', {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: '*',
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::public-bucket/*'
  }]
});

// 3. Registrar S3 no CloudFront
const cf = cloudFrontService.getSimulator();
cf.registerService('s3', s3Service);

// 4. Criar distribuição
const distribution = cf.createDistribution({
  Origins: [{
    Id: 's3',
    DomainName: 'public-bucket.s3.amazonaws.com'
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 's3',
    DefaultTTL: 86400
  },
  Enabled: true
});

// 5. Acessar (sucesso!)
const response = cf.processRequest({
  distributionId: distribution.id,
  path: '/document.pdf'
});

console.log(response.status);    // 200
console.log(response.body);      // <conteúdo do PDF>
console.log(response.cached);    // false (primeira vez)

// 6. Segunda requisição (do cache!)
const cached = cf.processRequest({
  distributionId: distribution.id,
  path: '/document.pdf'
});

console.log(cached.cacheStatus); // HIT
console.log(cached.cached);      // true
```

### Exemplo 3: Bucket com OAI

```javascript
// 1. Criar bucket
const s3 = s3Service.getSimulator();
s3.createBucket('oai-bucket');
s3.putObject('oai-bucket', 'image.jpg', <buffer>);

// 2. Criar distribuição com OAI
const cf = cloudFrontService.getSimulator();
cf.registerService('s3', s3Service);

const distribution = cf.createDistribution({
  CallerReference: 'with-oai-1',
  Origins: [{
    Id: 's3',
    DomainName: 'oai-bucket.s3.amazonaws.com',
    S3OriginConfig: {
      OriginAccessIdentity: 'origin-access-identity/cloudfront/E123ABC456'
    }
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 's3',
    DefaultTTL: 86400
  },
  Enabled: true
});

// 3. Definir política do bucket para OAI
s3.putBucketPolicy('oai-bucket', {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: {
      AWS: 'arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity/E123ABC456'
    },
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::oai-bucket/*'
  }]
});

// 4. Acessar (sucesso! OAI tem permissão)
const response = cf.processRequest({
  distributionId: distribution.id,
  path: '/image.jpg'
});

console.log(response.status); // 200
console.log(response.origin); // 's3'
```

### Exemplo 4: Adicionar e Remover Política

```javascript
const s3 = s3Service.getSimulator();
s3.createBucket('test-bucket');

// Sem política = privado
console.log(s3.getBucketPolicy('test-bucket'));
// { error: { code: 'NoSuchBucketPolicy', ... }, status: 404 }

// Adicionar política
s3.putBucketPolicy('test-bucket', {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: '*',
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::test-bucket/*'
  }]
});

// Verificar que foi adicionada
const policy = s3.getBucketPolicy('test-bucket');
console.log(policy.policy.Statement[0].Effect); // 'Allow'

// Remover política
s3.deleteBucketPolicy('test-bucket');

// Voltou a ser privado
console.log(s3.getBucketPolicy('test-bucket'));
// { error: { code: 'NoSuchBucketPolicy', ... }, status: 404 }
```

---

## 🔐 Validação de Política

CloudFront valida:

1. ✅ **Effect** - Deve ser `Allow` (não suporta `Deny`)
2. ✅ **Action** - Verifica se inclui `s3:GetObject` ou `s3:*`
3. ✅ **Principal** - Verifica se permite CloudFront:
   - `"*"` (público)
   - `"Service": "cloudfront.amazonaws.com"`
   - `"AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity/..."`
4. ✅ **Resource** - Verifica permissões para objetos

---

## 🚫 Casos de Access Denied

CloudFront retorna **403 Access Denied** quando:

```javascript
// ❌ Bucket sem política (privado por padrão)
s3.createBucket('private');
// CloudFront: 403 Access Denied

// ❌ Política com Effect: Deny
s3.putBucketPolicy('bucket', {
  Statement: [{
    Effect: 'Deny',  // Negação não é processada como Allow
    Principal: '*',
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::bucket/*'
  }]
});
// CloudFront: 403 Access Denied

// ❌ Política sem GetObject
s3.putBucketPolicy('bucket', {
  Statement: [{
    Effect: 'Allow',
    Principal: '*',
    Action: 's3:PutObject',  // Apenas PUT, não GET
    Resource: 'arn:aws:s3:::bucket/*'
  }]
});
// CloudFront: 403 Access Denied

// ❌ OAI incorreta
s3.putBucketPolicy('bucket', {
  Statement: [{
    Effect: 'Allow',
    Principal: {
      AWS: 'arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity/WRONG'
    },
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::bucket/*'
  }]
});
// CloudFront com OAI diferente: 403 Access Denied
```

---

## 📋 S3 API Methods

### putBucketPolicy(bucketName, policy)
Define política de acesso ao bucket.

```javascript
s3.putBucketPolicy('my-bucket', {
  Version: '2012-10-17',
  Statement: [...]
});
```

### getBucketPolicy(bucketName)
Obtém política do bucket.

```javascript
const result = s3.getBucketPolicy('my-bucket');
console.log(result.policy);  // Objeto da política ou erro 404
```

### deleteBucketPolicy(bucketName)
Remove política do bucket.

```javascript
s3.deleteBucketPolicy('my-bucket');
// Volta a ser privado
```

---

## 🔄 Fluxo Real

```
1. CloudFront recebe requisição: GET /file.pdf

2. CloudFront roteia para S3:
   - Detecta que origin é S3
   - Chama _routeToS3()

3. S3 retorna o objeto

4. CloudFront valida bucket policy:
   - Chama _checkS3BucketPolicy()
   - Verifica se há política
   - Valida se CloudFront tem acesso

5. ✅ Se autorizado:
   - Retorna objeto com status 200
   - Cacheia se TTL > 0

6. ❌ Se negado:
   - Retorna 403 Access Denied
   - Não cacheia
```

---

## 🎯 Casos de Uso

### Website Estático Público
- Bucket: Público (Principal: "*")
- CloudFront: Caches todos os acessos
- Usuários: Acessam via CloudFront

### Conteúdo Privado
- Bucket: Privado (sem política)
- CloudFront: Com OAI autorizada
- Usuários: Acessam apenas via CloudFront (não direto ao S3)

### Conteúdo Semi-Público
- Bucket: Específico (apenas CloudFront autorizado)
- CloudFront: Caches com OAI
- Usuários: Acessam via CloudFront

---

## ✅ Checklist

- [x] Adicionar campo `policy` em buckets S3
- [x] Implementar `putBucketPolicy()`
- [x] Implementar `getBucketPolicy()`
- [x] Implementar `deleteBucketPolicy()`
- [x] Validação de política em CloudFront
- [x] Suporte para Principal: "*"
- [x] Suporte para Service Principal
- [x] Suporte para OAI
- [x] Retornar 403 se negado
- [x] Documentação

---

## 📝 Conclusão

Agora CloudFront **respeita permissões do S3**:
- ✅ Buckets públicos → CloudFront acessa
- ✅ Buckets privados → CloudFront negado (403)
- ✅ Buckets com OAI → Apenas CloudFront autorizado acessa

Simule cenários reais de controle de acesso no seu ambiente local!

