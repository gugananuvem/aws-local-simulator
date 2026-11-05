# Quick Start: EC2, ALB e ASG

Guia rápido para começar a usar os simuladores de EC2, Application Load Balancer (ALB) e Auto Scaling Group (ASG).

## Instalação

```bash
npm install @gugananuvem/aws-local-simulator
```

## Iniciar o Simulador

### Opção 1: CLI padrão (recomendado)

```bash
aws-local-simulator start --services ec2,alb,asg
```

### Opção 2: Usar o exemplo

```bash
node examples/ec2-alb-asg-example.js
```

### Opção 3: Programaticamente

```javascript
const { startServer } = require('aws-local-simulator');

const config = {
  services: {
    ec2: true,
    alb: true,
    asg: true,
  },
  ports: {
    ec2: 4020,
    alb: 4021,
    asg: 4022,
  },
};

const { server } = await startServer(config);
```

## Portas Padrão

| Serviço | Porta | URL Admin |
|---------|-------|-----------|
| EC2     | 4020  | http://localhost:4020/__admin/ec2 |
| ALB     | 4021  | http://localhost:4021/__admin/alb |
| ASG     | 4022  | http://localhost:4022/__admin/asg |

## Workflows Comuns

### 1. Criar e listar instâncias EC2

**Criar instância:**
```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/run \
  -H "Content-Type: application/json" \
  -d '{
    "ImageId": "ami-0c55b159cbfafe1f0",
    "MinCount": 1,
    "MaxCount": 1,
    "InstanceType": "t2.micro",
    "SecurityGroupIds": ["web-sg"],
    "WebServerDir": "/var/www/html"
  }'
```

**Listar instâncias:**
```bash
curl http://localhost:4020/__admin/ec2/instances
```

**Acessar página padrão da instância:**
```bash
# A instância serve na porta 8000 (primeira), 8001 (segunda), etc.
curl http://localhost:8000
```

### 2. Configurar ALB com Target Group

**Criar Load Balancer:**
```bash
curl -X POST http://localhost:4021/__admin/alb/load-balancers/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "my-alb",
    "Scheme": "internet-facing"
  }'
```

**Criar Target Group:**
```bash
curl -X POST http://localhost:4021/__admin/alb/target-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "web-targets",
    "Protocol": "HTTP",
    "Port": 80
  }'
```

**Registrar instância como target:**
```bash
curl -X POST http://localhost:4021/__admin/alb/target-groups/{targetGroupArn}/register-target \
  -H "Content-Type: application/json" \
  -d '{
    "TargetId": "i-0123456789abcdef0",
    "Port": 8000
  }'
```

### 3. Usar Auto Scaling Group

**Criar Launch Template:**
```bash
curl -X POST http://localhost:4022/__admin/asg/launch-templates/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "web-template",
    "ImageId": "ami-0c55b159cbfafe1f0",
    "InstanceType": "t2.micro",
    "securityGroupIds": ["web-sg"]
  }'
```

**Criar Auto Scaling Group:**
```bash
curl -X POST http://localhost:4022/__admin/asg/auto-scaling-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "AutoScalingGroupName": "web-asg",
    "LaunchTemplateId": "{templateId}",
    "minSize": 2,
    "maxSize": 4,
    "desiredCapacity": 2
  }'
```

**Escalar manualmente:**
```bash
curl -X PUT http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/desired-capacity \
  -H "Content-Type: application/json" \
  -d '{
    "DesiredCapacity": 3
  }'
```

### 4. Criar Scaling Policy

**Target Tracking (recomendado):**
```bash
curl -X POST http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/scaling-policies \
  -H "Content-Type: application/json" \
  -d '{
    "PolicyName": "cpu-scaling",
    "PolicyType": "TargetTrackingScaling",
    "targetValue": 70,
    "predefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "scaleOutCooldown": 300,
    "scaleInCooldown": 300
  }'
```

**Step Scaling:**
```bash
curl -X POST http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/scaling-policies \
  -H "Content-Type: application/json" \
  -d '{
    "PolicyName": "step-scaling",
    "PolicyType": "StepScaling",
    "adjustmentType": "ChangeInCapacity",
    "stepAdjustments": [
      {
        "metricIntervalLowerBound": 0,
        "metricIntervalUpperBound": 10,
        "scalingAdjustment": 1
      },
      {
        "metricIntervalLowerBound": 10,
        "scalingAdjustment": 2
      }
    ]
  }'
```

## Configuração com Arquivo .env

```env
# EC2
AWS_EC2_PORT=4020
AWS_EC2_DEFAULT_INSTANCE_TYPE=t2.micro

# ALB
AWS_ALB_PORT=4021

# ASG
AWS_ASG_PORT=4022
```

## Recursos da EC2

- ✅ Rodar instâncias com AMI customizadas
- ✅ Gerenciar segurança com Security Groups
- ✅ Configurar Network Interfaces (ENI)
- ✅ Suportar sites HTML/Angular/React
- ✅ Servir arquivos estáticos de diretório
- ✅ Endpoints: start, stop, reboot, terminate

## Recursos do ALB

- ✅ Load Balancers internos e internet-facing
- ✅ Target Groups com HTTP/HTTPS
- ✅ Round-robin load balancing
- ✅ Health checks de targets
- ✅ Listeners com roteamento

## Recursos do ASG

- ✅ Launch Templates com AMI e tipo de instância
- ✅ Scaling automático por políticas
- ✅ Target Tracking e Step Scaling
- ✅ Integração com ALB
- ✅ Health Check Grace Period
- ✅ Cooldown periods para scale-up/down

## Exemplos Avançados

### Escalar uma aplicação completa

```javascript
const axios = require('axios');

// 1. Criar launch template
const lt = await axios.post('http://localhost:4022/__admin/asg/launch-templates/create', {
  Name: 'app-template',
  ImageId: 'ami-myapp',
  InstanceType: 't2.small',
  securityGroupIds: ['app-sg'],
});

// 2. Criar ASG
const asg = await axios.post('http://localhost:4022/__admin/asg/auto-scaling-groups/create', {
  AutoScalingGroupName: 'app-asg',
  LaunchTemplateId: lt.data.LaunchTemplate.LaunchTemplateId,
  minSize: 1,
  maxSize: 10,
  desiredCapacity: 2,
  targetGroupARNs: ['arn:...'],
});

// 3. Criar scaling policy
await axios.post(`http://localhost:4022/__admin/asg/auto-scaling-groups/app-asg/scaling-policies`, {
  PolicyName: 'cpu-tracking',
  PolicyType: 'TargetTrackingScaling',
  targetValue: 50,
});

// 4. Avaliar políticas (dispara scaling se necessário)
await axios.post(`http://localhost:4022/__admin/asg/auto-scaling-groups/app-asg/evaluate-policies`);
```

## Troubleshooting

### Instâncias não iniciam

1. Verifique se o Security Group existe:
```bash
curl http://localhost:4020/__admin/ec2/security-groups
```

2. Verifique logs:
```bash
aws-local-simulator logs ec2
```

### ALB não distribui tráfego

1. Verifique se target group tem targets registrados:
```bash
curl http://localhost:4021/__admin/alb/target-groups/{arn}/health
```

2. Verifique health status:
```bash
curl http://localhost:4021/__admin/alb/resources
```

### ASG não cria instâncias

1. Verifique desiredCapacity vs currentCount:
```bash
curl http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg
```

2. Verifique se EC2Service está disponível:
```bash
curl http://localhost:9999/status
```

## Próximos Passos

- 📚 Veja [TEST_GUIDE_EC2.md](./TEST_GUIDE_EC2.md) para testes detalhados
- 🔧 Configure a [integração com VPC](./docs/vpc.md)
- 📊 Use [CloudWatch](./docs/cloudwatch.md) para monitorar recursos
