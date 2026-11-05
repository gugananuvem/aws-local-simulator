# Organizations (AWS Organizations)

## Visão Geral

AWS Organizations é um serviço que permite gerenciar múltiplas contas AWS de forma centralizada. O simulador local oferece suporte a Organizations, permitindo criar e gerenciar OUs (Organizational Units), contas, políticas de controle de serviço (SCPs) e Control Tower guardrails.

**Principais Features:**
- Criar organizações e raízes
- Gerenciar contas e OUs
- Service Control Policies (SCPs)
- Control Tower guardrails
- Conformidade e auditoria
- Políticas de consolidação de faturamento

## Porta e Endpoint

**Porta Padrão:** `4581`  
**URL Base:** `http://localhost:4581`  
**Admin API:** `http://localhost:4581/__admin/organization`

## Quick Start

### 1. Listar Raízes da Organização

```bash
aws organizations list-roots --endpoint-url http://localhost:4581
```

### 2. Criar OU (Organizational Unit)

```bash
aws organizations create-organizational-unit \
  --parent-id r-xxxx \
  --name Production \
  --endpoint-url http://localhost:4581
```

### 3. Criar Conta

```bash
aws organizations create-account \
  --email "newaccount@example.com" \
  --account-name "Production Account" \
  --endpoint-url http://localhost:4581
```

### 4. Listar Contas

```bash
aws organizations list-accounts --endpoint-url http://localhost:4581
```

### 5. Listar OUs

```bash
aws organizations list-organizational-units-for-parent \
  --parent-id r-xxxx \
  --endpoint-url http://localhost:4581
```

## Operações Básicas

### Descrever Organização

```bash
aws organizations describe-organization --endpoint-url http://localhost:4581
```

### Mover Conta para OU

```bash
aws organizations move-account \
  --account-id 123456789012 \
  --source-parent-id r-xxxx \
  --destination-parent-id ou-yyyy \
  --endpoint-url http://localhost:4581
```

### Descrever Conta

```bash
aws organizations describe-account \
  --account-id 123456789012 \
  --endpoint-url http://localhost:4581
```

### Listar Contas em OU

```bash
aws organizations list-accounts-for-parent \
  --parent-id ou-xxxx \
  --endpoint-url http://localhost:4581
```

### Deletar OU

```bash
aws organizations delete-organizational-unit \
  --organizational-unit-id ou-xxxx \
  --endpoint-url http://localhost:4581
```

## Service Control Policies (SCPs)

### Criar Policy

```bash
aws organizations create-policy \
  --content '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Deny",
      "Action":"ec2:*",
      "Resource":"*"
    }]
  }' \
  --description "Deny EC2" \
  --type SERVICE_CONTROL_POLICY \
  --endpoint-url http://localhost:4581
```

### Anexar Policy

```bash
aws organizations attach-policy \
  --policy-id p-xxxx \
  --target-id ou-yyyy \
  --endpoint-url http://localhost:4581
```

### Listar Policies

```bash
aws organizations list-policies \
  --filter SERVICE_CONTROL_POLICY \
  --endpoint-url http://localhost:4581
```

## Policy Types

A tela **Policies** do dashboard lista os policy types suportados e permite
habilitar/desabilitar cada um. O estado fica persistido no snapshot da
organização e sobrevive ao restart. `SERVICE_CONTROL_POLICY` (SCP) já vem
habilitado.

### Habilitar um Policy Type

```bash
aws organizations enable-policy-type \
  --root-id r-xxxx \
  --policy-type RESOURCE_CONTROL_POLICY \
  --endpoint-url http://localhost:4581
```

### Desabilitar um Policy Type

```bash
aws organizations disable-policy-type \
  --root-id r-xxxx \
  --policy-type RESOURCE_CONTROL_POLICY \
  --endpoint-url http://localhost:4581
```

### Listar Raízes (inclui os PolicyTypes habilitados)

```bash
aws organizations list-roots --endpoint-url http://localhost:4581
```

### Admin API

```bash
# Lista os policy types habilitados
curl http://localhost:4581/__admin/policy-types

# Habilita / desabilita
curl -X POST http://localhost:4581/__admin/policy-types/enable \
  -H "Content-Type: application/json" \
  -d '{"PolicyType":"RESOURCE_CONTROL_POLICY"}'

curl -X POST http://localhost:4581/__admin/policy-types/disable \
  -H "Content-Type: application/json" \
  -d '{"PolicyType":"RESOURCE_CONTROL_POLICY"}'
```

## Serviços Integrados (Trusted Access)

A tela **Services** lista os serviços AWS integrados e permite habilitar/desabilitar
trusted access. O estado (`ServicePrincipal` + `DateEnabled`) é persistido em
`__service-access__.json` e sobrevive ao restart.

### Habilitar / Desabilitar (AWS CLI)

```bash
aws organizations enable-aws-service-access \
  --service-principal backup.amazonaws.com \
  --endpoint-url http://localhost:4581

aws organizations disable-aws-service-access \
  --service-principal backup.amazonaws.com \
  --endpoint-url http://localhost:4581
```

### Listar Serviços com Trusted Access

```bash
aws organizations list-aws-service-access-for-organization \
  --endpoint-url http://localhost:4581
```

### Admin API

```bash
# Lista os serviços habilitados (ISO DateEnabled)
curl http://localhost:4581/__admin/service-access

# Habilita / desabilita
curl -X POST http://localhost:4581/__admin/service-access/enable \
  -H "Content-Type: application/json" \
  -d '{"ServicePrincipal":"backup.amazonaws.com"}'

curl -X POST http://localhost:4581/__admin/service-access/disable \
  -H "Content-Type: application/json" \
  -d '{"ServicePrincipal":"backup.amazonaws.com"}'
```

## Exemplos de Uso

### Exemplo 1: Estrutura de Organizacao Multi-Nível

```bash
# Obter raiz
ROOT=$(aws organizations list-roots --endpoint-url http://localhost:4581 | jq -r '.Roots[0].Id')

# Criar OUs no primeiro nível
PRODUCTION=$(aws organizations create-organizational-unit \
  --parent-id $ROOT \
  --name Production \
  --endpoint-url http://localhost:4581 | jq -r '.OrganizationalUnit.Id')

STAGING=$(aws organizations create-organizational-unit \
  --parent-id $ROOT \
  --name Staging \
  --endpoint-url http://localhost:4581 | jq -r '.OrganizationalUnit.Id')

DEVELOPMENT=$(aws organizations create-organizational-unit \
  --parent-id $ROOT \
  --name Development \
  --endpoint-url http://localhost:4581 | jq -r '.OrganizationalUnit.Id')

# Criar sub-OUs
PROD_CORE=$(aws organizations create-organizational-unit \
  --parent-id $PRODUCTION \
  --name Core \
  --endpoint-url http://localhost:4581 | jq -r '.OrganizationalUnit.Id')

PROD_APPS=$(aws organizations create-organizational-unit \
  --parent-id $PRODUCTION \
  --name Applications \
  --endpoint-url http://localhost:4581 | jq -r '.OrganizationalUnit.Id')

echo "Root: $ROOT"
echo "Production: $PRODUCTION (Core: $PROD_CORE, Apps: $PROD_APPS)"
echo "Staging: $STAGING"
echo "Development: $DEVELOPMENT"
```

### Exemplo 2: Contas Organizacionais

```bash
# Criar contas em diferentes OUs
ROOT=$(aws organizations list-roots --endpoint-url http://localhost:4581 | jq -r '.Roots[0].Id')

PROD_OU=$(aws organizations list-organizational-units-for-parent \
  --parent-id $ROOT \
  --endpoint-url http://localhost:4581 | jq -r '.Children[] | select(.Name=="Production") | .Id')

# Criar conta de produção
PROD_ACCOUNT=$(aws organizations create-account \
  --email "production@example.com" \
  --account-name "Production Account" \
  --endpoint-url http://localhost:4581 | jq -r '.CreateAccountStatus.AccountId')

# Mover para Production OU
aws organizations move-account \
  --account-id $PROD_ACCOUNT \
  --source-parent-id $ROOT \
  --destination-parent-id $PROD_OU \
  --endpoint-url http://localhost:4581

echo "Production Account Created: $PROD_ACCOUNT"
```

### Exemplo 3: Service Control Policies - Deny EC2

```bash
# Policy que nega EC2
POLICY_CONTENT='{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Deny",
    "Action":"ec2:*",
    "Resource":"*"
  }]
}'

aws organizations create-policy \
  --content "$POLICY_CONTENT" \
  --description "Deny all EC2 actions" \
  --type SERVICE_CONTROL_POLICY \
  --endpoint-url http://localhost:4581
```

### Exemplo 4: Service Control Policy - Require Tags

```bash
# Policy que requer tags em recursos
POLICY_CONTENT='{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Deny",
    "Action":"*",
    "Resource":"*",
    "Condition":{
      "StringNotLike":{
        "aws:PrincipalTag/Environment":["production","staging","dev"]
      }
    }
  }]
}'

aws organizations create-policy \
  --content "$POLICY_CONTENT" \
  --description "Require Environment tag" \
  --type SERVICE_CONTROL_POLICY \
  --endpoint-url http://localhost:4581
```

### Exemplo 5: Service Control Policy - Restrict Regions

```bash
# Policy que restringe a regiões específicas
POLICY_CONTENT='{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Deny",
    "Action":"*",
    "Resource":"*",
    "Condition":{
      "StringNotEquals":{
        "aws:RequestedRegion":["us-east-1","us-west-2"]
      }
    }
  }]
}'

aws organizations create-policy \
  --content "$POLICY_CONTENT" \
  --description "Restrict to US-only regions" \
  --type SERVICE_CONTROL_POLICY \
  --endpoint-url http://localhost:4581
```

### Exemplo 6: Control Tower Guardrails

```bash
# Habilitar guardrail (simulado)
aws organizations create-policy \
  --content '{
    "version":"1.0",
    "id":"guardrail-s3-public-access",
    "title":"Block S3 Public Access",
    "rules":[{
      "resource":"AWS::S3::Bucket",
      "restriction":{
        "blockPublicAcls":true,
        "blockPublicPolicy":true,
        "ignorePublicAcls":true,
        "restrictPublicBuckets":true
      }
    }]
  }' \
  --description "Block S3 public access" \
  --type SERVICE_CONTROL_POLICY \
  --endpoint-url http://localhost:4581
```

## Policy Types

| Tipo | Descrição | Uso |
|------|-----------|-----|
| SERVICE_CONTROL_POLICY (SCP) | Controlar permissões entre contas | Auditoria e compliance |
| TAG_POLICY | Obrigar uso de tags | Governança |
| BACKUP_POLICY | Políticas de backup | Disaster recovery |
| AI_OPT_OUT_POLICY | Opt-out de AI services | Privacidade |

## Estrutura Recomendada

```
Root
├── Management
│   └── (Billing account)
├── Security
│   ├── Log Archive
│   └── Security Tooling
├── Production
│   ├── Core
│   └── Applications
├── Staging
├── Development
│   ├── QA
│   └── Dev
└── Sandbox
```

## Referências

- [AWS Organizations Documentation](https://docs.aws.amazon.com/organizations/)
- [Service Control Policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [Control Tower](https://docs.aws.amazon.com/controltower/)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
