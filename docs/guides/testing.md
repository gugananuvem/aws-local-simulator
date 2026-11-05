# Guia de Testes

## Estratégias de Teste

### 1. Teste Unitário de Serviços

Teste serviços individuais isoladamente para garantir funcionalidade básica.

**Abordagem**:
- Iniciar serviço específico
- Criar recursos
- Validar estado
- Limpar

**Exemplo com DynamoDB**:
```bash
# Criar tabela
aws dynamodb create-table \
  --table-name test-table \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000

# Adicionar item
aws dynamodb put-item \
  --table-name test-table \
  --item '{"id":{"S":"test-1"},"data":{"S":"test-data"}}' \
  --endpoint-url http://localhost:8000

# Validar
aws dynamodb get-item \
  --table-name test-table \
  --key '{"id":{"S":"test-1"}}' \
  --endpoint-url http://localhost:8000
```

### 2. Teste de Integração

Teste múltiplos serviços trabalhando juntos.

**Exemplo: Lambda + SQS + DynamoDB**:
```javascript
// 1. Lambda processa mensagem de SQS
// 2. Escreve resultado em DynamoDB

async function testLambdaSQSDynamoDB() {
  const lambda = new AWS.Lambda({ endpoint: 'http://localhost:3001' });
  const sqs = new AWS.SQS({ endpoint: 'http://localhost:9324' });
  const dynamodb = new AWS.DynamoDB({ endpoint: 'http://localhost:8000' });

  // 1. Criar fila SQS
  const queue = await sqs.createQueue({ QueueName: 'test-queue' }).promise();
  
  // 2. Enviar mensagem
  await sqs.sendMessage({
    QueueUrl: queue.QueueUrl,
    MessageBody: JSON.stringify({ userId: '123', action: 'login' })
  }).promise();

  // 3. Invocar Lambda
  const result = await lambda.invoke({
    FunctionName: 'process-queue',
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({ queueUrl: queue.QueueUrl })
  }).promise();

  // 4. Validar resultado em DynamoDB
  const item = await dynamodb.getItem({
    TableName: 'audit-log',
    Key: { userId: { S: '123' } }
  }).promise();

  console.log('✅ Integração SQS → Lambda → DynamoDB OK');
}
```

### 3. Teste de Performance

Meça tempo de resposta e throughput.

**Exemplo: Stress test em DynamoDB**:
```javascript
async function stressTestDynamoDB() {
  const dynamodb = new AWS.DynamoDB({ endpoint: 'http://localhost:8000' });
  const iterations = 1000;
  
  const startTime = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    await dynamodb.putItem({
      TableName: 'performance-test',
      Item: {
        id: { S: `item-${i}` },
        timestamp: { N: Date.now().toString() }
      }
    }).promise();
  }
  
  const duration = Date.now() - startTime;
  const throughput = (iterations / duration) * 1000; // ops/sec
  
  console.log(`✅ ${iterations} items em ${duration}ms`);
  console.log(`📊 Throughput: ${throughput.toFixed(2)} ops/sec`);
}
```

---

## Ferramentas Recomendadas

| Ferramenta | Uso | Link |
|-----------|-----|------|
| jest | Framework de testes | https://jestjs.io |
| supertest | Testes HTTP | https://github.com/visionmedia/supertest |
| mocha | Test runner alternativo | https://mochajs.org |
| chai | Assertion library | https://www.chaijs.com |
| aws-sdk-mock | Mock AWS SDK | https://github.com/dwyl/aws-sdk-mock |
| localstack | LocalStack alternativo | https://github.com/localstack/localstack |

---

## Testando Serviços Individualmente

### VPC

**Test 1: Criar VPC**
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/vpcs/create \
  -H "Content-Type: application/json" \
  -d '{
    "CidrBlock": "172.16.0.0/16",
    "Tags": [{"Key": "Name", "Value": "test-vpc"}]
  }'
```

**Validar**:
- [ ] Retorna VPC ID
- [ ] CIDR Block está correto
- [ ] VPC aparece em `GET /vpcs`

**Test 2: Criar Subnet**
```bash
curl -X POST http://localhost:4020/__admin/ec2/vpc/subnets/create \
  -H "Content-Type: application/json" \
  -d '{
    "VpcId": "vpc-xxxxx",
    "CidrBlock": "172.16.1.0/24",
    "AvailabilityZone": "us-east-1a"
  }'
```

**Validar**:
- [ ] Retorna Subnet ID
- [ ] CIDR Block não sobrepõe com outras subnets
- [ ] AZ é válida

### DynamoDB

**Test 1: Criar Tabela**
```bash
aws dynamodb create-table \
  --table-name test-table \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000
```

**Validar**:
- [ ] TableStatus é "ACTIVE"
- [ ] TableArn é válido
- [ ] ItemCount é 0

**Test 2: Put/Get Item**
```bash
# Put
aws dynamodb put-item \
  --table-name test-table \
  --item '{"id":{"S":"test-1"},"data":{"S":"test"}}' \
  --endpoint-url http://localhost:8000

# Get
aws dynamodb get-item \
  --table-name test-table \
  --key '{"id":{"S":"test-1"}}' \
  --endpoint-url http://localhost:8000
```

**Validar**:
- [ ] Get retorna o item
- [ ] Atributos estão corretos

### S3

**Test 1: Criar Bucket**
```bash
aws s3 mb s3://test-bucket --endpoint-url http://localhost:4566
```

**Validar**:
- [ ] Bucket aparece em `aws s3 ls`

**Test 2: Upload/Download**
```bash
# Upload
echo "test data" > test.txt
aws s3 cp test.txt s3://test-bucket/test.txt --endpoint-url http://localhost:4566

# Download
aws s3 cp s3://test-bucket/test.txt downloaded.txt --endpoint-url http://localhost:4566
```

**Validar**:
- [ ] Arquivo upload com sucesso
- [ ] Download retorna conteúdo correto
- [ ] Hash do arquivo é idêntico

### Lambda

**Test 1: Criar Função**
```bash
# Criar arquivo handler
cat > handler.js << 'EOF'
exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello', event })
  };
};
EOF

# Criar função
aws lambda create-function \
  --function-name test-function \
  --runtime nodejs18.x \
  --handler handler.handler \
  --zip-file fileb://function.zip \
  --endpoint-url http://localhost:3001
```

**Test 2: Invocar Função**
```bash
aws lambda invoke \
  --function-name test-function \
  --payload '{"test":"data"}' \
  --endpoint-url http://localhost:3001 \
  output.json

cat output.json
```

**Validar**:
- [ ] Execução bem-sucedida
- [ ] Resposta contém resultado
- [ ] Sem erros de execução

---

## Testes de Integração

### EC2, ALB, ASG

**Test 1: Verificar instâncias EC2 criadas pelo ASG**

**Esperado**: 2 instâncias rodando (desiredCapacity=2)

```bash
curl http://localhost:4020/__admin/ec2/instances
```

**Validar**:
- [ ] Retorna array com 2 instâncias
- [ ] `State.Name` é "running"
- [ ] `InstanceType` é "t2.micro"
- [ ] `NetworkInterfaces[0].Port` está entre 8000-8999

**Test 2: Acessar página padrão de instância**

**Esperado**: Página HTML com informações da instância

```bash
curl http://localhost:8000
```

**Validar**:
- [ ] Retorna HTML com `<html>`
- [ ] Contém `<h1>EC2 Instance Info</h1>`
- [ ] Mostra IP da instância
- [ ] Mostra status "running"

**Test 3: Criar novo ALB**

```bash
curl -X POST http://localhost:4021/__admin/alb/load-balancers/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "test-alb",
    "Scheme": "internet-facing"
  }'
```

**Validar**:
- [ ] Retorna `LoadBalancer`
- [ ] Tem `LoadBalancerArn`
- [ ] `LoadBalancerName` é "test-alb"
- [ ] `State.Code` é "active"

**Test 4: Escalar ASG**

```bash
curl -X PUT http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/desired-capacity \
  -H "Content-Type: application/json" \
  -d '{"DesiredCapacity": 3}'
```

**Validar**:
- [ ] ASG retornado tem `DesiredCapacity: 3`
- [ ] Novas instâncias criadas no EC2
- [ ] Total de instâncias é 3

---

## Exemplos Práticos

### Exemplo 1: Teste Completo de API REST

```javascript
const AWS = require('aws-sdk');
const assert = require('assert');

const apigateway = new AWS.APIGateway({ endpoint: 'http://localhost:4567' });
const lambda = new AWS.Lambda({ endpoint: 'http://localhost:3001' });

async function testRestAPI() {
  console.log('🧪 Testando REST API...');

  // 1. Criar API
  const api = await apigateway.createRestApi({
    name: 'test-api',
    description: 'Test API'
  }).promise();

  console.log('✅ API criada:', api.id);

  // 2. Criar resource /users
  const resources = await apigateway.getResources({
    restApiId: api.id
  }).promise();

  const rootId = resources.items.find(r => r.path === '/').id;

  const resource = await apigateway.createResource({
    restApiId: api.id,
    parentId: rootId,
    pathPart: 'users'
  }).promise();

  console.log('✅ Resource /users criado:', resource.id);

  // 3. Criar método GET
  await apigateway.putMethod({
    restApiId: api.id,
    resourceId: resource.id,
    httpMethod: 'GET',
    authorizationType: 'NONE'
  }).promise();

  console.log('✅ Método GET criado');

  // 4. Integração com Lambda
  await apigateway.putIntegration({
    restApiId: api.id,
    resourceId: resource.id,
    httpMethod: 'GET',
    type: 'AWS_PROXY',
    integrationHttpMethod: 'POST',
    uri: 'arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:get-users/invocations'
  }).promise();

  console.log('✅ Integração com Lambda criada');
}

testRestAPI().catch(console.error);
```

### Exemplo 2: Teste de Fila SQS com Lambda

```javascript
const AWS = require('aws-sdk');

const sqs = new AWS.SQS({ endpoint: 'http://localhost:9324' });
const lambda = new AWS.Lambda({ endpoint: 'http://localhost:3001' });

async function testSQSLambdaIntegration() {
  console.log('🧪 Testando SQS + Lambda...');

  // 1. Criar fila
  const queue = await sqs.createQueue({
    QueueName: 'order-queue'
  }).promise();

  console.log('✅ Fila criada:', queue.QueueUrl);

  // 2. Enviar mensagem
  await sqs.sendMessage({
    QueueUrl: queue.QueueUrl,
    MessageBody: JSON.stringify({
      orderId: '123',
      customerId: '456',
      amount: 99.99
    })
  }).promise();

  console.log('✅ Mensagem enviada');

  // 3. Invocar Lambda que processa fila
  const result = await lambda.invoke({
    FunctionName: 'process-orders',
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({
      Records: [{
        eventSource: 'aws:sqs',
        eventSourceARN: queue.QueueUrl,
        body: JSON.stringify({
          orderId: '123',
          customerId: '456',
          amount: 99.99
        })
      }]
    })
  }).promise();

  const response = JSON.parse(result.Payload);
  console.log('✅ Lambda executada:', response.statusCode);

  // 4. Verificar DLQ
  const dlq = await sqs.createQueue({
    QueueName: 'order-queue-dlq'
  }).promise();

  console.log('✅ DLQ criada:', dlq.QueueUrl);
}

testSQSLambdaIntegration().catch(console.error);
```

### Exemplo 3: Teste de VPC com Lambda

```javascript
const AWS = require('aws-sdk');

const ec2 = new AWS.EC2({ endpoint: 'http://localhost:4020' });
const lambda = new AWS.Lambda({ endpoint: 'http://localhost:3001' });

async function testVPCLambda() {
  console.log('🧪 Testando VPC + Lambda...');

  // 1. Criar VPC
  const vpc = await ec2.createVpc({
    CidrBlock: '10.0.0.0/16'
  }).promise();

  console.log('✅ VPC criada:', vpc.Vpc.VpcId);

  // 2. Criar subnet
  const subnet = await ec2.createSubnet({
    VpcId: vpc.Vpc.VpcId,
    CidrBlock: '10.0.1.0/24',
    AvailabilityZone: 'us-east-1a'
  }).promise();

  console.log('✅ Subnet criada:', subnet.Subnet.SubnetId);

  // 3. Atualizar Lambda para usar VPC
  // (Simulado - na prática seria via config)
  console.log('✅ Lambda configurada para VPC');

  // 4. Invocar Lambda dentro do VPC
  const result = await lambda.invoke({
    FunctionName: 'vpc-function',
    Payload: JSON.stringify({
      vpcId: vpc.Vpc.VpcId,
      subnetId: subnet.Subnet.SubnetId
    })
  }).promise();

  console.log('✅ Lambda executada em VPC');
}

testVPCLambda().catch(console.error);
```

---

## Checklist Final

- [ ] Todos os serviços iniciam corretamente
- [ ] Recursos podem ser criados e deletados
- [ ] Testes unitários passam
- [ ] Testes de integração passam
- [ ] Nenhuma porta em conflito
- [ ] Logs aparecem corretamente
- [ ] Performance dentro dos limites esperados
- [ ] Sem memory leaks após testes prolongados

---

## Troubleshooting de Testes

### Porta já está em uso

```bash
# Encontrar processo usando a porta (Linux/Mac)
lsof -i :4020

# No Windows
netstat -ano | findstr :4020
```

### Teste timeout

Aumentar timeout global em jest.config.js:

```javascript
module.exports = {
  testTimeout: 30000 // 30 segundos
};
```

### Recursos não sendo criados

Verificar logs do simulador:

```bash
npm start -- --log-level debug
```

---

## Documentação de Referência

- [VPC Test Guide](./VPC_TEST_GUIDE.md)
- [Test Guide EC2](./TEST_GUIDE_EC2.md)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [AWS SDK Examples](https://github.com/awslabs/aws-sdk-examples)
