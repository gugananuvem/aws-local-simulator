# CloudFront Origin Routing - Real Service Integration

CloudFront agora redireciona **requisições reais** para origins configuradas (S3, API Gateway, ALB/EC2, Lambda, HTTP).

## 🎯 Suporte a Origins

### ✅ S3 (Amazon Simple Storage Service)
CloudFront acessa objetos diretamente do S3 quando a origin aponta para um bucket.

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'my-cdn-1',
  Origins: [{
    Id: 's3Origin',
    DomainName: 'mybucket.s3.amazonaws.com',
    S3OriginConfig: {
      OriginAccessIdentity: 'origin-access-identity/cloudfront/E123ABC'
    }
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 's3Origin',
    ViewerProtocolPolicy: 'https-only'
  },
  Enabled: true
});
```

**Como funciona:**
1. Requisição chega ao CloudFront: `GET /images/photo.jpg`
2. CloudFront roteia para S3: `GET mybucket/images/photo.jpg`
3. Retorna objeto do S3 com headers corretos
4. CloudFront cacheia a resposta (se TTL > 0)

**Exemplo:**
```javascript
// Supondo que há um objeto em S3
const response = simulator.processRequest({
  distributionId: distribution.id,
  path: '/images/photo.jpg',
  method: 'GET'
});

console.log(response.status);        // 200
console.log(response.headers);       // Content-Type, ETag, etc
console.log(response.body);          // Conteúdo do objeto S3
console.log(response.cached);        // false (primeira vez)

// Segunda requisição vem do cache
const cachedResponse = simulator.processRequest({
  distributionId: distribution.id,
  path: '/images/photo.jpg',
  method: 'GET'
});

console.log(cachedResponse.cacheStatus); // HIT
```

### ✅ API Gateway
CloudFront roteia para endpoints do API Gateway.

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'api-cdn-1',
  Origins: [{
    Id: 'apiOrigin',
    DomainName: 'api-id.execute-api.us-east-1.amazonaws.com',
    CustomOriginConfig: {
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: 'https-only'
    }
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 'apiOrigin',
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 0  // Sem cache para APIs
  },
  Enabled: true
});
```

**Como funciona:**
1. Requisição: `POST /api/users` com body JSON
2. CloudFront roteia para API Gateway
3. API Gateway processa a requisição (sem cache)
4. Retorna resposta para client

**Exemplo:**
```javascript
const response = simulator.processRequest({
  distributionId: distribution.id,
  path: '/api/users',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'John' })
});

console.log(response.status);     // 200 (do API Gateway)
console.log(response.body);       // Resposta da API
console.log(response.origin);     // 'apigateway'
```

### ✅ ALB / EC2 (Elastic Load Balancer com Target Group)
CloudFront roteia para ALB, que distribui para instâncias EC2.

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'app-cdn-1',
  Origins: [{
    Id: 'albOrigin',
    DomainName: 'my-alb-1234567890.us-east-1.elb.amazonaws.com',
    CustomOriginConfig: {
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: 'https-only'
    }
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 'albOrigin',
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 3600
  },
  Enabled: true
});
```

**Como funciona:**
1. Requisição: `GET /page.html`
2. CloudFront roteia para ALB
3. ALB roteia para target (EC2 instance)
4. EC2 retorna HTML/conteúdo
5. CloudFront cacheia por 3600s

**Exemplo:**
```javascript
const response = simulator.processRequest({
  distributionId: distribution.id,
  path: '/page.html',
  method: 'GET'
});

console.log(response.status);     // 200
console.log(response.body);       // HTML da instância EC2
console.log(response.origin);     // 'alb'
console.log(response.cached);     // false (primeira vez)
```

### ✅ Lambda
CloudFront roteia para funções Lambda.

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'lambda-cdn-1',
  Origins: [{
    Id: 'lambdaOrigin',
    DomainName: 'arn:aws:lambda:us-east-1:123456789012:function:my-function:1',
    CustomOriginConfig: {
      OriginProtocolPolicy: 'https-only'
    }
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 'lambdaOrigin',
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 0  // Sem cache para Lambdas dinâmicas
  },
  Enabled: true
});
```

**Como funciona:**
1. Requisição chega ao CloudFront
2. CloudFront invoca função Lambda com payload
3. Lambda processa e retorna resposta
4. CloudFront retorna ao client

**Exemplo:**
```javascript
const response = simulator.processRequest({
  distributionId: distribution.id,
  path: '/api/process?param=value',
  method: 'POST',
  body: JSON.stringify({ data: 'test' })
});

console.log(response.status);     // 200
console.log(response.body);       // Resposta da Lambda
console.log(response.origin);     // 'lambda'
```

### ✅ HTTP/HTTPS Externo
CloudFront roteia para servidores HTTP/HTTPS externos.

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'external-cdn-1',
  Origins: [{
    Id: 'httpOrigin',
    DomainName: 'external-api.example.com',
    CustomOriginConfig: {
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: 'https-only'
    }
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 'httpOrigin',
    ViewerProtocolPolicy: 'https-only'
  },
  Enabled: true
});
```

---

## 🔧 Configuração - Registrar Serviços

Para que CloudFront roteie para serviços reais, é necessário registrá-los:

### Opção 1: No servidor principal
```javascript
const server = new Server(config);
await server.initialize();
await server.start();

// Services são registrados automaticamente após inicialização
```

### Opção 2: Manualmente no CloudFront
```javascript
const simulator = cloudFrontService.getSimulator();

// Registrar serviço S3
simulator.registerService('s3', s3Service);

// Registrar serviço API Gateway
simulator.registerService('apigateway', apigatewayService);

// Registrar serviço EC2/ALB
simulator.registerService('ec2', ec2Service);

// Registrar serviço Lambda
simulator.registerService('lambda', lambdaService);
```

---

## 📋 Exemplos Práticos

### Exemplo 1: CDN para Website Estático (S3)

```javascript
// Criar bucket S3 com objetos
const s3 = s3Service.getSimulator();
s3.createBucket('my-website');
s3.putObject('my-website', 'index.html', '<html>Hello</html>');
s3.putObject('my-website', 'style.css', 'body { color: blue; }');

// Criar distribuição CloudFront
const cf = cloudFrontService.getSimulator();
const distribution = cf.createDistribution({
  CallerReference: 'website-1',
  Origins: [{
    Id: 's3',
    DomainName: 'my-website.s3.amazonaws.com'
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 's3',
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 86400
  },
  Enabled: true
});

// Requisições vão para S3
const html = cf.processRequest({
  distributionId: distribution.id,
  path: '/index.html'
});

const css = cf.processRequest({
  distributionId: distribution.id,
  path: '/style.css'
});

console.log(html.body); // '<html>Hello</html>'
console.log(css.body);  // 'body { color: blue; }'
```

### Exemplo 2: CDN Híbrida (Multi-Origin com Path Patterns)

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'hybrid-1',
  Origins: [
    {
      Id: 's3',
      DomainName: 'content.s3.amazonaws.com'
    },
    {
      Id: 'api',
      DomainName: 'api.execute-api.us-east-1.amazonaws.com'
    },
    {
      Id: 'web',
      DomainName: 'web-alb.us-east-1.elb.amazonaws.com'
    }
  ],
  DefaultCacheBehavior: {
    TargetOriginId: 'web',      // HTML do ALB/EC2
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 3600
  },
  CacheBehaviors: [
    {
      PathPattern: '/api/*',
      TargetOriginId: 'api',    // APIs não são cacheadas
      ViewerProtocolPolicy: 'https-only',
      DefaultTTL: 0
    },
    {
      PathPattern: '/images/*', // Imagens do S3 em cache por 30 dias
      TargetOriginId: 's3',
      ViewerProtocolPolicy: 'allow-all',
      DefaultTTL: 2592000
    }
  ],
  Enabled: true
});

// Requisições são roteadas corretamente:
cf.processRequest({
  distributionId: distribution.id,
  path: '/index.html'
}); // → ALB/EC2

cf.processRequest({
  distributionId: distribution.id,
  path: '/api/users'
}); // → API Gateway (sem cache)

cf.processRequest({
  distributionId: distribution.id,
  path: '/images/logo.png'
}); // → S3 (cacheia por 30 dias)
```

### Exemplo 3: Routing Dinâmico com Lambda

```javascript
const distribution = simulator.createDistribution({
  CallerReference: 'lambda-1',
  Origins: [{
    Id: 'lambda',
    DomainName: 'arn:aws:lambda:us-east-1:123456789012:function:router:1'
  }],
  DefaultCacheBehavior: {
    TargetOriginId: 'lambda',
    ViewerProtocolPolicy: 'https-only',
    DefaultTTL: 0,
    ForwardedValues: {
      QueryString: true,
      Headers: { Forward: 'all' }
    }
  },
  Enabled: true
});

// Lambda recebe requisição com query parameters
const response = cf.processRequest({
  distributionId: distribution.id,
  path: '/process?format=json&id=123',
  method: 'GET'
});

console.log(response.origin);      // 'lambda'
console.log(response.body);        // Resposta da Lambda
```

---

## 🔄 Fluxo de Requisição Real

```
CLIENT
  |
  v
CLOUDFRONT (CloudFront Simulator)
  - Check cache
  - Check geo-restrictions
  - Match behavior
  - Determine origin
  |
  +---> [S3] getObject() ---> Return object
  |
  +---> [API Gateway] processRequest() ---> Return JSON
  |
  +---> [ALB/EC2] handleRequest() ---> Return HTML
  |
  +---> [Lambda] invoke() ---> Return response
  |
  +---> [HTTP] HTTP request ---> Return response
  |
  v
CLOUDFRONT
  - Cache response (se TTL > 0)
  - Return ao cliente
  |
  v
CLIENT
```

---

## ⚙️ Comportamento Esperado

### S3
- Retorna objetos armazenados
- Headers: Content-Type, ETag, Last-Modified
- Status: 200 (OK) ou 404 (Not Found)

### API Gateway
- Processa requisições HTTP/REST
- Retorna JSON ou dados
- Sem cache por padrão (DefaultTTL: 0)

### ALB/EC2
- Roteia para instâncias EC2 via ALB
- Retorna HTML, conteúdo web
- Pode ser cacheado

### Lambda
- Invoca funções Lambda
- Retorna resultado da função
- Sem cache por padrão

### HTTP
- Faz requisições HTTP/HTTPS reais
- Retorna resposta do servidor
- Pode ser cacheado

---

## 🐛 Troubleshooting

### "Origin not available"
- Verifique se o serviço foi registrado com `registerService()`
- Confirm que o domain/ARN está correto

### "404 Not Found"
- Para S3: Verify se o objeto existe no bucket
- Para API Gateway: Verify se o endpoint está configurado
- Para ALB: Verify se há instâncias no target group

### "502 Bad Gateway"
- Serviço não está respondendo
- Verifique se o serviço foi inicializado
- Verifique a configuração da origin

### Responses vazias
- Verifique se o body está sendo retornado pela origin
- Confira o tipo de conteúdo

---

## 📊 Casos de Uso

### 1. Static Website Hosting
- Origin: S3
- Cache: 24 horas
- Ideal para: HTML, CSS, JS, imagens

### 2. REST API
- Origin: API Gateway
- Cache: 0 (sem cache)
- Ideal para: APIs RESTful dinâmicas

### 3. Web Application
- Origin: ALB/EC2
- Cache: 1 hora
- Ideal para: Aplicações web tradicionais

### 4. Microservices
- Multiple Origins + Path Patterns
- Cache: Diferente por tipo de conteúdo
- Ideal para: Arquiteturas complexas

### 5. Serverless App
- Origin: Lambda
- Cache: 0 (sem cache)
- Ideal para: Funções serverless dinâmicas

---

## ✅ Checklist de Implementação

- [x] Origin routing para S3
- [x] Origin routing para API Gateway
- [x] Origin routing para ALB/EC2
- [x] Origin routing para Lambda
- [x] Origin routing para HTTP
- [x] Caching de respostas
- [x] Invalidação de cache
- [x] Geo-restrictions
- [x] Error handling
- [x] Statistics

---

## 📝 Conclusão

CloudFront agora funciona como um **reverse proxy real**, roteando requisições para diferentes origins e cacheando respostas conforme configurado. Simule fluxos de requisição realistas no seu ambiente local!

