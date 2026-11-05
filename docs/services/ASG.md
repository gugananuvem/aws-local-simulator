# ASG (Auto Scaling Group)

## Visão Geral

O simulador de ASG (Auto Scaling Group) permite criar e gerenciar grupos de auto-escalonamento, launch templates, políticas de scaling e atividades de scaling. Ele integra-se com o EC2 (para criação de instâncias) e com o ALB (para registro automático de targets).

### Recursos Principais
- **Launch Templates**: Definição de configuração de instância (AMI, InstanceType, UserData, SecurityGroups, etc.)
- **Auto Scaling Groups**: Gerenciamento de capacidade mínima/máxima/desejada
- **Scaling Policies**: Target Tracking e Step Scaling (simulados)
- **Integration com ALB**: Registro automático de instâncias como targets no Target Group
- **Scaling Activities**: Histórico de atividades de escalonamento
- **Query Protocol**: Totalmente compatível com o AWS CLI (`aws autoscaling --endpoint-url http://localhost:4022`)

## Porta e Endpoint

- **Porta**: `4022`
- **URL Base**: `http://localhost:4022`
- **AWS Service Namespace**: `autoscaling` (API Version: `2011-01-01`)
- **Admin Console**: `http://localhost:4022/__admin/asg`

### Health Check Admin

```bash
curl http://localhost:4022/__admin/health
```

Resposta esperada:
```json
{
  "status": "ok",
  "service": "asg"
}
```

## Dependências

O ASG depende do **EC2** (para criar instâncias via `RunInstances`) e opcionalmente do **ALB** (para registrar targets). Ambas as dependências são resolvidas automaticamente no registro de serviços.

## Ações do Query Protocol (AWS CLI)

O endpoint `POST http://localhost:4022/` suporta as seguintes ações:

| Ação | Descrição |
|------|-----------|
| `CreateLaunchTemplate` | Cria um Launch Template |
| `DescribeLaunchTemplates` | Lista os Launch Templates |
| `DeleteLaunchTemplate` | Remove um Launch Template |
| `CreateAutoScalingGroup` | Cria um Auto Scaling Group |
| `DescribeAutoScalingGroups` | Lista os Auto Scaling Groups |
| `UpdateAutoScalingGroup` | Atualiza configurações (min/max/desired, cooldown, etc.) |
| `DeleteAutoScalingGroup` | Remove um Auto Scaling Group |
| `SetDesiredCapacity` | Define a capacidade desejada |
| `PutScalingPolicy` | Cria uma política de scaling (Step/Target Tracking) |
| `DescribePolicies` | Lista as políticas de scaling |
| `DeletePolicy` | Remove uma política de scaling |
| `DescribeScalingActivities` | Lista atividades de scaling |

## Quick Start

### Passo 1: Iniciar o Simulador

```bash
cd c:\Projetos\aws-local-simulator\src\backend
npm start
```

### Passo 2: Verificar o serviço

```bash
aws autoscaling describe-auto-scaling-groups --endpoint-url http://localhost:4022
```

## Exemplos com AWS CLI

### 1. Criar um Launch Template

```bash
aws autoscaling create-launch-template \
  --launch-template-name my-template \
  --version-description "v1" \
  --launch-template-data '{"ImageId":"ami-test","InstanceType":"t2.micro"}' \
  --endpoint-url http://localhost:4022
```

### 2. Criar um Auto Scaling Group

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name my-asg \
  --launch-template LaunchTemplateName=my-template,Version=1 \
  --min-size 0 \
  --max-size 5 \
  --desired-capacity 2 \
  --vpc-zone-identifier "subnet-12345678,subnet-87654321" \
  --target-group-arns arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-target-group/1234567890123456 \
  --endpoint-url http://localhost:4022
```

### 3. Alterar capacidade desejada

```bash
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name my-asg \
  --desired-capacity 3 \
  --endpoint-url http://localhost:4022
```

### 4. Criar uma Scaling Policy

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name my-asg \
  --policy-name scale-up \
  --policy-type StepScaling \
  --adjustment-type ChangeInCapacity \
  --step-adjustments '{"MetricIntervalLowerBound":0,"ScalingAdjustment":1}' \
  --endpoint-url http://localhost:4022
```

### 5. Ver atividades de scaling

```bash
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name my-asg \
  --endpoint-url http://localhost:4022
```

## Notas Importantes

- **Integração com EC2**: Ao criar ou escalar o ASG (com `desiredCapacity > 0`), o simulador chama `EC2Simulator.runInstances()` (via serviço EC2) para criar as instâncias. Se o EC2 estiver indisponível, o ASG registra um aviso e pode não criar todas as instâncias.
- **Integração com ALB**: Quando um `TargetGroupARN` é informado no ASG, as instâncias recém-criadas são registradas automaticamente como targets no ALB correspondente.
- **Capacidades com valor 0**: O simulador respeita `minSize`, `maxSize` e `desiredCapacity` iguais a `0`.
- **Query Protocol**: Utiliza middleware de normalização de parâmetros (`aws-query.js`) para suportar tanto arrays com índices (`Instances.1.InstanceId`) quanto listas compactas, garantindo compatibilidade com o AWS CLI.
- **O ASG roda na porta 4022**.