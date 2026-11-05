# Test Guide: EC2, ALB e ASG

Guia completo para testar os simuladores de EC2, ALB e ASG.

## Preparação

### 1. Instalar dependências

```bash
npm install
```

### 2. Iniciar o simulador

```bash
node examples/ec2-alb-asg-example.js
```

Você deve ver:
```
✅ Serviços iniciados com sucesso!

📋 URLs disponíveis:
   EC2 Admin:  http://localhost:4020/__admin/ec2
   ALB Admin:  http://localhost:4021/__admin/alb
   ASG Admin:  http://localhost:4022/__admin/asg
   Management: http://localhost:9999
```

## Testes EC2

### Test 1: Verificar instâncias EC2 criadas pelo ASG

**Esperado:** 2 instâncias rodando (desiredCapacity=2)

```bash
curl http://localhost:4020/__admin/ec2/instances
```

**Validar:**
- [ ] Retorna array com 2 instâncias
- [ ] `State.Name` é "running"
- [ ] `InstanceType` é "t2.micro"
- [ ] `NetworkInterfaces[0].Port` está entre 8000-8999

### Test 2: Acessar página padrão de instância

**Esperado:** Página HTML com informações da instância

```bash
curl http://localhost:8000
```

**Validar:**
- [ ] Retorna HTML com `<html>`
- [ ] Contém `<h1>EC2 Instance Info</h1>`
- [ ] Mostra IP da instância
- [ ] Mostra status "running"

### Test 3: Criar nova instância manualmente

**Criar:**
```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/run \
  -H "Content-Type: application/json" \
  -d '{
    "ImageId": "ami-0c55b159cbfafe1f0",
    "MinCount": 1,
    "MaxCount": 1,
    "InstanceType": "t2.small",
    "Tags": [{"Key":"Name","Value":"test-instance"}]
  }'
```

**Validar:**
- [ ] Retorna `Instances` array
- [ ] Instância tem `InstanceId` único
- [ ] `State.Name` é "running"
- [ ] Porta está entre 8000-8999

### Test 4: Parar instância

**Parar (use InstanceId do Test 3):**
```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/{instanceId}/stop \
  -H "Content-Type: application/json"
```

**Validar:**
- [ ] Retorna sucesso
- [ ] Verificar status: `curl http://localhost:4020/__admin/ec2/instances`
- [ ] `State.Name` passa para "stopped"

### Test 5: Iniciar instância

```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/{instanceId}/start \
  -H "Content-Type: application/json"
```

**Validar:**
- [ ] `State.Name` volta para "running"
- [ ] Página da instância fica acessível novamente

### Test 6: Terminar instância

```bash
curl -X POST http://localhost:4020/__admin/ec2/instances/{instanceId}/terminate \
  -H "Content-Type: application/json"
```

**Validar:**
- [ ] `State.Name` fica "terminated"
- [ ] Instância sumiu da lista de running

### Test 7: Criar Security Group

```bash
curl -X POST http://localhost:4020/__admin/ec2/security-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "GroupName": "test-sg",
    "Description": "Test security group",
    "IpPermissions": [
      {
        "IpProtocol": "tcp",
        "FromPort": 22,
        "ToPort": 22,
        "IpRanges": [{"CidrIp": "0.0.0.0/0"}]
      }
    ]
  }'
```

**Validar:**
- [ ] Retorna `GroupId`
- [ ] Listar: `curl http://localhost:4020/__admin/ec2/security-groups`
- [ ] SG aparece na lista

## Testes ALB

### Test 1: Criar Load Balancer

```bash
curl -X POST http://localhost:4021/__admin/alb/load-balancers/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "test-alb",
    "Scheme": "internet-facing"
  }'
```

**Validar:**
- [ ] Retorna `LoadBalancer`
- [ ] Tem `LoadBalancerArn`
- [ ] `LoadBalancerName` é "test-alb"
- [ ] `State.Code` é "active"

**Guardar:** `LoadBalancerArn` para próximos testes

### Test 2: Criar Target Group

```bash
curl -X POST http://localhost:4021/__admin/alb/target-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "test-targets",
    "Protocol": "HTTP",
    "Port": 80
  }'
```

**Validar:**
- [ ] Retorna `TargetGroup`
- [ ] Tem `TargetGroupArn`
- [ ] `TargetGroupName` é "test-targets"

**Guardar:** `TargetGroupArn`

### Test 3: Registrar targets

**Get instância ID:**
```bash
curl http://localhost:4020/__admin/ec2/instances | jq '.[0].InstanceId'
```

**Registrar como target:**
```bash
curl -X POST http://localhost:4021/__admin/alb/target-groups/{targetGroupArn}/register-target \
  -H "Content-Type: application/json" \
  -d '{
    "TargetId": "i-xxxxxxxxxxxxx",
    "Port": 8000
  }'
```

**Validar:**
- [ ] Retorna `Target`
- [ ] `TargetId` corresponde
- [ ] `Port` é 8000

### Test 4: Verificar health dos targets

```bash
curl http://localhost:4021/__admin/alb/target-groups/{targetGroupArn}/health
```

**Validar:**
- [ ] `HealthDescriptions` array não vazio
- [ ] `HealthState` é "healthy"
- [ ] `TargetId` corresponde

### Test 5: Listar Load Balancers

```bash
curl http://localhost:4021/__admin/alb/load-balancers
```

**Validar:**
- [ ] Retorna array
- [ ] Contém o ALB criado

### Test 6: Rotear requisição através do ALB

```bash
# O ALB deve rotear para um target usando round-robin
curl -X GET http://localhost:4021/__admin/alb/load-balancers/{albArn}
```

**Validar:**
- [ ] Retorna info do ALB
- [ ] `TargetGroups` não vazio

### Test 7: Remover target

```bash
curl -X DELETE http://localhost:4021/__admin/alb/target-groups/{targetGroupArn}/targets/{targetId}
```

**Validar:**
- [ ] Sucesso
- [ ] Target sumiu da lista

## Testes ASG

### Test 1: Listar ASGs criadas

**Esperado:** 1 ASG "web-asg" com 2 instâncias

```bash
curl http://localhost:4022/__admin/asg/auto-scaling-groups
```

**Validar:**
- [ ] Retorna array
- [ ] Primeira ASG é "web-asg"
- [ ] `DesiredCapacity` é 2
- [ ] `MinSize` é 2, `MaxSize` é 4
- [ ] `Instances.length` é 2

### Test 2: Criar Launch Template

```bash
curl -X POST http://localhost:4022/__admin/asg/launch-templates/create \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "test-lt",
    "ImageId": "ami-test",
    "InstanceType": "t2.small",
    "securityGroupIds": ["test-sg"]
  }'
```

**Validar:**
- [ ] Retorna `LaunchTemplate`
- [ ] Tem `LaunchTemplateId`

### Test 3: Criar ASG

```bash
curl -X POST http://localhost:4022/__admin/asg/auto-scaling-groups/create \
  -H "Content-Type: application/json" \
  -d '{
    "AutoScalingGroupName": "test-asg",
    "LaunchTemplateId": "{launchTemplateId}",
    "minSize": 1,
    "maxSize": 3,
    "desiredCapacity": 1
  }'
```

**Validar:**
- [ ] Retorna `AutoScalingGroup`
- [ ] `DesiredCapacity` é 1
- [ ] `Instances.length` é 1

### Test 4: Escalar UP

```bash
curl -X PUT http://localhost:4022/__admin/asg/auto-scaling-groups/test-asg/desired-capacity \
  -H "Content-Type: application/json" \
  -d '{
    "DesiredCapacity": 2
  }'
```

**Validar:**
- [ ] ASG retornado tem `DesiredCapacity: 2`
- [ ] Esperar 1-2s
- [ ] `Instances.length` é 2
- [ ] Novas instâncias criadas no EC2:
```bash
curl http://localhost:4020/__admin/ec2/instances | jq '.[] | select(.State.Name=="running") | .InstanceId' | wc -l
```
- [ ] Contagem deve ser maior

### Test 5: Escalar DOWN

```bash
curl -X PUT http://localhost:4022/__admin/asg/auto-scaling-groups/test-asg/desired-capacity \
  -H "Content-Type: application/json" \
  -d '{
    "DesiredCapacity": 1
  }'
```

**Validar:**
- [ ] ASG tem `DesiredCapacity: 1`
- [ ] `Instances.length` é 1
- [ ] Uma instância foi terminada

### Test 6: Criar Scaling Policy

```bash
curl -X POST http://localhost:4022/__admin/asg/auto-scaling-groups/test-asg/scaling-policies \
  -H "Content-Type: application/json" \
  -d '{
    "PolicyName": "cpu-policy",
    "PolicyType": "TargetTrackingScaling",
    "targetValue": 70,
    "scaleOutCooldown": 60,
    "scaleInCooldown": 300
  }'
```

**Validar:**
- [ ] Retorna `ScalingPolicy`
- [ ] `PolicyName` é "cpu-policy"
- [ ] `Enabled` é true

### Test 7: Listar Scaling Policies

```bash
curl http://localhost:4022/__admin/asg/auto-scaling-groups/test-asg/scaling-policies
```

**Validar:**
- [ ] Retorna array
- [ ] Contém a policy criada

### Test 8: Avaliar Scaling Policies

```bash
curl -X POST http://localhost:4022/__admin/asg/auto-scaling-groups/test-asg/evaluate-policies \
  -H "Content-Type: application/json"
```

**Validar:**
- [ ] Retorna ASG
- [ ] Pode ter escalado automáticamente (aleatório)

### Test 9: Deletar ASG

```bash
curl -X DELETE "http://localhost:4022/__admin/asg/auto-scaling-groups/test-asg?forceDelete=true"
```

**Validar:**
- [ ] Retorna sucesso
- [ ] Instâncias são terminadas
- [ ] ASG sumiu da lista

## Testes de Integração

### Test 1: EC2 + ALB + ASG juntos

1. **Verificar que ASG criou instâncias:**
```bash
curl http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg | jq '.Instances | length'
```
**Esperado:** 2

2. **Criar Target Group no ALB:**
```bash
curl -X POST http://localhost:4021/__admin/alb/target-groups/create \
  -H "Content-Type: application/json" \
  -d '{"Name":"web-tg","Protocol":"HTTP","Port":80}'
```

3. **Registrar instâncias como targets:**
```bash
# Get instâncias
INSTANCES=$(curl http://localhost:4020/__admin/ec2/instances | jq '.[] | .InstanceId' -r)

# Registrar cada uma
for INSTANCE_ID in $INSTANCES; do
  curl -X POST http://localhost:4021/__admin/alb/target-groups/{tgArn}/register-target \
    -H "Content-Type: application/json" \
    -d "{\"TargetId\":\"$INSTANCE_ID\",\"Port\":8000}"
done
```

4. **Verificar health:**
```bash
curl http://localhost:4021/__admin/alb/target-groups/{tgArn}/health
```
**Esperado:** Todos healthy

5. **Escalar ASG:**
```bash
curl -X PUT http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg/desired-capacity \
  -H "Content-Type: application/json" \
  -d '{"DesiredCapacity":3}'
```

6. **Verificar nova instância:**
```bash
curl http://localhost:4020/__admin/ec2/instances | jq '.[] | select(.State.Name=="running") | .InstanceId' | wc -l
```
**Esperado:** 3

### Test 2: Múltiplos ALBs balanceando um ASG

1. Criar 2º Load Balancer
2. Criar 2º Target Group
3. Registrar mesmas instâncias em ambos
4. Ambos devem distribuir tráfego com round-robin

## Checklist Final

- [ ] EC2 instâncias iniciam e servem páginas
- [ ] ALB distribui tráfego com round-robin
- [ ] ASG cria instâncias automaticamente ao escalar
- [ ] ASG termina instâncias ao desescalar
- [ ] Health checks funcionam
- [ ] Scaling policies disparam corretamente
- [ ] Nenhuma instância fica órfã
- [ ] Logs aparecem corretamente

## Performance

Métricas esperadas:

| Operação | Tempo esperado |
|----------|---|
| Criar instância | < 100ms |
| Escalar ASG (+1 inst) | < 200ms |
| Rotear requisição no ALB | < 50ms |
| Health check | < 50ms |

## Troubleshooting

### Instâncias não escalamautomaticamente

```bash
# Verificar estado do ASG
curl http://localhost:4022/__admin/asg/auto-scaling-groups/web-asg

# Verificar se EC2Service está injetado
curl http://localhost:9999/status | jq '.services[] | select(.name=="ec2")'
```

### ALB não roteia tráfego

```bash
# Verificar targets health
curl http://localhost:4021/__admin/alb/target-groups/{arn}/health

# Verificar se targets estão registrados
curl http://localhost:4021/__admin/alb/resources | jq '.targetGroups'
```

### Porta de instância em conflito

```bash
# Verificar próxima porta disponível
curl http://localhost:4020/__admin/ec2/instances | jq '.[] | .NetworkInterfaces[0].Port'
```
