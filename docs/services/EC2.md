# EC2 / ALB / ASG

## Visão Geral

Simuladores para EC2 (máquinas virtuais), ALB (Application Load Balancer) e ASG (Auto Scaling Groups). Suportam instâncias com AMI customizadas, balanceamento de tráfego com round-robin e escalamento automático por políticas.

### Recursos Principais

**EC2:** Rodar instâncias, gerenciar segurança (Security Groups), configurar Network Interfaces, servir sites estáticos.

**ALB:** Load balancers internos e internet-facing, target groups HTTP/HTTPS, health checks, listeners com roteamento.

**ASG:** Launch templates, scaling automático (Target Tracking e Step Scaling), integração com ALB, cooldown periods.

## Portas e Endpoints

| Serviço | Porta | Admin Console |
|---------|-------|---------------|
| EC2     | 4020  | http://localhost:4020/__admin/ec2 |
| ALB     | 4021  | http://localhost:4021/__admin/alb |
| ASG     | 4022  | http://localhost:4022/__admin/asg |

Instâncias EC2 servem nas portas 8000, 8001, 8002, etc.

## Quick Start EC2

### Instalação

```bash
npm install @gugananuvem/aws-local-simulator
```

### Iniciar o Simulador

```bash
aws-local-simulator start --services ec2,alb,asg
```

Ou programaticamente:

```javascript
const { startServer } = require('aws-local-simulator');

const config = {
  services: { ec2: true, alb: true, asg: true },
  ports: { ec2: 4020, alb: 4021, asg: 4022 },
};

await startServer(config);
```

### Criar e Listar Instâncias

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

**Acessar página da instância:**

```bash
curl http://localhost:8000
```

### Gerenciar Ciclo de Vida

**Parar instância:**

```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/{instanceId}/stop \
  -H "Content-Type: application/json"
```

**Iniciar instância:**

```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/{instanceId}/start \
  -H "Content-Type: application/json"
```

**Terminar instância:**

```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/{instanceId}/terminate \
  -H "Content-Type: application/json"
```

## Quick Start ALB

### Criar Load Balancer e Target Group

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

### Registrar Targets

**Registrar instância como target:**

```bash
curl -X POST http://localhost:4021/__admin/alb/target-groups/{targetGroupArn}/register-target \
  -H "Content-Type: application/json" \
  -d '{
    "TargetId": "i-0123456789abcdef0",
    "Port": 8000
  }'
```

**Verificar health dos targets:**

```bash
curl http://localhost:4021/__admin/alb/target-groups/{targetGroupArn}/health
```

## Quick Start ASG

### Criar Launch Template

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

### Criar Auto Scaling Group

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

### Escalar Manualmente

```bash
curl -X PUT http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/desired-capacity \
  -H "Content-Type: application/json" \
  -d '{"DesiredCapacity": 3}'
```

## Exemplos de Uso

### Criar Security Group

```bash
curl -X POST http://localhost:4020/__admin/ec2/security-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "GroupName": "test-sg",
    "Description": "Test security group",
    "IpPermissions": [{
      "IpProtocol": "tcp",
      "FromPort": 22,
      "ToPort": 22,
      "IpRanges": [{"CidrIp": "0.0.0.0/0"}]
    }]
  }'
```

### Scaling Policy - Target Tracking

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

### Integração EC2 + ALB + ASG

1. ASG cria instâncias EC2 automaticamente
2. Registrar instâncias como targets no ALB
3. ALB distribui tráfego com round-robin
4. ASG escala baseado em métricas

## Testing

### Verificar Instâncias EC2 Criadas

```bash
curl http://localhost:4020/__admin/ec2/instances
```

Validar:
- Array com instâncias em estado "running"
- `InstanceType` conforme especificado
- `NetworkInterfaces[0].Port` entre 8000-8999

### Testar Escalamento ASG

```bash
# Verificar estado atual
curl http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg

# Escalar UP
curl -X PUT http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/desired-capacity \
  -H "Content-Type: application/json" \
  -d '{"DesiredCapacity": 3}'

# Verificar novas instâncias criadas no EC2
curl http://localhost:4020/__admin/ec2/instances
```

### Testar ALB Health

```bash
curl http://localhost:4021/__admin/alb/target-groups/{targetGroupArn}/health
```

Validar: `HealthState` é "healthy" para todos os targets.

## Referências

- [AWS EC2 Documentation](https://docs.aws.amazon.com/ec2/)
- [AWS ALB Documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/)
- [AWS ASG Documentation](https://docs.aws.amazon.com/autoscaling/)

## Configuração com .env

```env
AWS_EC2_PORT=4020
AWS_EC2_DEFAULT_INSTANCE_TYPE=t2.micro
AWS_ALB_PORT=4021
AWS_ASG_PORT=4022
```

## Troubleshooting

**Instâncias não iniciam:** Verifique se o Security Group existe (`curl http://localhost:4020/__admin/ec2/security-groups`) e valide logs.

**ALB não distribui tráfego:** Verifique se target group tem targets registrados e health status está "healthy".

**ASG não cria instâncias:** Valide desiredCapacity vs currentCount e verifique se EC2Service está disponível.
