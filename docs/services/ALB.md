# ALB (Application Load Balancer)

## Visão Geral

O simulador de ALB (Application Load Balancer) permite criar e gerenciar load balancers, target groups e listeners. Ele suporta múltiplos protocolos (HTTP/HTTPS), health checks, targets registrados e integração com o ASG.

### Recursos Principais
- **Load Balancers**: Internet-facing e internal
- **Target Groups**: HTTP/HTTPS com health checks configuráveis
- **Targets**: Registro/desregistro de instâncias EC2
- **Listeners**: Regras de roteamento baseadas em path, method, host-header, query-string e headers
- **Health Checks**: Verificação de saúde dos targets
- **Query Protocol**: Totalmente compatível com o AWS CLI (`aws elbv2 --endpoint-url http://localhost:4021`)

## Porta e Endpoint

- **Porta**: `4021`
- **URL Base**: `http://localhost:4021`
- **AWS Service Namespace**: `elasticloadbalancing` (API Version: `2015-12-01`)
- **Admin Console**: `http://localhost:4021/__admin/alb`

### Health Check Admin

```bash
curl http://localhost:4021/__admin/health
```

Resposta esperada:
```json
{
  "status": "ok",
  "service": "alb"
}
```

## Ações do Query Protocol (AWS CLI)

O endpoint `POST http://localhost:4021/` suporta as seguintes ações (via AWS CLI):

| Ação | Descrição |
|------|-----------|
| `CreateLoadBalancer` | Cria um Application Load Balancer |
| `DeleteLoadBalancer` | Remove um Load Balancer |
| `DescribeLoadBalancers` | Lista os Load Balancers |
| `CreateTargetGroup` | Cria um Target Group |
| `DeleteTargetGroup` | Remove um Target Group |
| `DescribeTargetGroups` | Lista os Target Groups |
| `RegisterTargets` | Registra targets (instâncias) em um Target Group |
| `DeregisterTargets` | Remove targets de um Target Group |
| `DescribeTargetHealth` | Consulta o estado de saúde dos targets |
| `CreateListener` | Cria um listener para um Load Balancer |
| `DeleteListener` | Remove um listener |
| `DescribeListeners` | Lista os listeners |

## Quick Start

### Passo 1: Iniciar o Simulador

```bash
cd c:\Projetos\aws-local-simulator\src\backend
npm start
```

### Passo 2: Verificar o serviço

```bash
aws elbv2 describe-load-balancers --endpoint-url http://localhost:4021
```

## Exemplos com AWS CLI

### 1. Criar um Load Balancer

```bash
aws elbv2 create-load-balancer \
  --name my-alb \
  --subnets subnet-12345678 subnet-87654321 \
  --scheme internet-facing \
  --type application \
  --endpoint-url http://localhost:4021
```

### 2. Criar um Target Group

```bash
aws elbv2 create-target-group \
  --name my-target-group \
  --protocol HTTP \
  --port 80 \
  --vpc-id vpc-12345678 \
  --health-check-protocol HTTP \
  --health-check-path / \
  --endpoint-url http://localhost:4021
```

### 3. Criar um Listener

```bash
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/1234567890123456 \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-target-group/1234567890123456 \
  --endpoint-url http://localhost:4021
```

### 4. Registrar Targets

```bash
aws elbv2 register-targets \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-target-group/1234567890123456 \
  --targets Id=i-12345678,Port=80 \
  --endpoint-url http://localhost:4021
```

## Notas

- O ALB roda na **porta 4021** e utiliza o mesmo mecanismo de middleware de Query Protocol (`aws-query.js`) para normalização de parâmetros com pontos.
- Para integração com ASG, o ASG registra targets automaticamente no ALB (via ARN ou configurações do target group).
- Os ARNs são gerados sinteticamente no simulador, seguindo um formato similar ao AWS.