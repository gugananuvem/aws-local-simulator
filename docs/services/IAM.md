# IAM (Identity and Access Management)

## Visão Geral

AWS IAM é o serviço de gerenciamento de identidades e acessos que controla permissões de usuários, grupos e roles. O simulador local oferece suporte completo a IAM, incluindo criação de usuários, grupos, policies, roles e avaliação de políticas.

**Principais Features:**
- Criar e gerenciar usuários
- Criar e gerenciar grupos
- Criar e gerenciar roles (IAM roles)
- Criar e gerenciar policies
- Access keys para autenticação programática
- Avaliação de permissões
- Anexar policies a usuários, grupos e roles
- **✅ Persistência em disco** - Dados salvos automaticamente

## Persistência de Dados

⚡ **IAM persiste dados em disco automaticamente** assim como S3, SQS e outros serviços. Os dados são salvos em arquivos JSON no diretório `.aws-local-simulator-data/iam/`:

```
.aws-local-simulator-data/
└── iam/
    ├── users.json
    ├── groups.json
    ├── roles.json
    ├── policies.json
    ├── access-keys.json
    └── ... (outros arquivos de mapeamento)
```

Os dados persistidos incluem:
- Usuários (users)
- Grupos (groups)
- Roles (roles)
- Policies (policies)
- Access Keys
- Mapeamentos entre entidades

**Comportamento:**
- ✅ Dados são salvos automaticamente em cada operação
- ✅ Dados são carregados ao iniciar o serviço
- ✅ Reset limpa todos os dados persistidos
- ✅ Compatível com todas as operações CRUD

## Porta e Endpoint

**Porta Padrão:** `4003`  
**URL Base:** `http://localhost:4003`  
**Admin API:** `http://localhost:4003/__admin/users`

## Quick Start

### 1. Criar Usuário

```bash
aws iam create-user \
  --user-name developer \
  --endpoint-url http://localhost:4003
```

### 2. Criar Access Key

```bash
aws iam create-access-key \
  --user-name developer \
  --endpoint-url http://localhost:4003
```

### 3. Criar Policy

```bash
aws iam create-policy \
  --policy-name SQSFullAccess \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"sqs:*","Resource":"*"}]}' \
  --endpoint-url http://localhost:4003
```

### 4. Anexar Policy a Usuário

```bash
aws iam attach-user-policy \
  --user-name developer \
  --policy-arn arn:aws:iam::123456789012:policy/SQSFullAccess \
  --endpoint-url http://localhost:4003
```

### 5. Criar Role

```bash
aws iam create-role \
  --role-name lambda-execution-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"lambda.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }' \
  --endpoint-url http://localhost:4003
```

## Operações Básicas

### Listar Usuários

```bash
aws iam list-users --endpoint-url http://localhost:4003
```

### Obter Informações do Usuário

```bash
aws iam get-user --user-name developer --endpoint-url http://localhost:4003
```

### Deletar Usuário

```bash
# Primeiro, remover todas as policies
aws iam list-attached-user-policies --user-name developer --endpoint-url http://localhost:4003
aws iam detach-user-policy --user-name developer --policy-arn <policy-arn> --endpoint-url http://localhost:4003

# Depois deletar usuário
aws iam delete-user --user-name developer --endpoint-url http://localhost:4003
```

### Listar Grupos

```bash
aws iam list-groups --endpoint-url http://localhost:4003
```

### Criar Grupo

```bash
aws iam create-group --group-name developers --endpoint-url http://localhost:4003
```

### Adicionar Usuário ao Grupo

```bash
aws iam add-user-to-group \
  --group-name developers \
  --user-name developer \
  --endpoint-url http://localhost:4003
```

### Listar Roles

```bash
aws iam list-roles --endpoint-url http://localhost:4003
```

### Listar Policies

```bash
aws iam list-policies --scope Local --endpoint-url http://localhost:4003
```

## Exemplos de Uso

### Exemplo 1: Criar Usuário com Permissões para S3

```bash
# Criar usuário
aws iam create-user --user-name s3-user --endpoint-url http://localhost:4003

# Criar policy para S3
aws iam create-policy \
  --policy-name S3FullAccess \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":["s3:*"],
      "Resource":["*"]
    }]
  }' \
  --endpoint-url http://localhost:4003

# Anexar policy ao usuário
aws iam attach-user-policy \
  --user-name s3-user \
  --policy-arn arn:aws:iam::123456789012:policy/S3FullAccess \
  --endpoint-url http://localhost:4003

# Criar access key
aws iam create-access-key \
  --user-name s3-user \
  --endpoint-url http://localhost:4003
```

### Exemplo 2: Lambda Execution Role

```bash
# Criar role para Lambda
aws iam create-role \
  --role-name lambda-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"lambda.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }' \
  --endpoint-url http://localhost:4003

# Criar policy de acesso a DynamoDB e CloudWatch
aws iam create-policy \
  --policy-name lambda-policy \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[
      {
        "Effect":"Allow",
        "Action":["dynamodb:*"],
        "Resource":"arn:aws:dynamodb:*:*:table/*"
      },
      {
        "Effect":"Allow",
        "Action":["logs:*"],
        "Resource":"arn:aws:logs:*:*:*"
      }
    ]
  }' \
  --endpoint-url http://localhost:4003

# Anexar policy à role
aws iam attach-role-policy \
  --role-name lambda-role \
  --policy-arn arn:aws:iam::123456789012:policy/lambda-policy \
  --endpoint-url http://localhost:4003
```

### Exemplo 3: Criar Grupo com Políticas

```bash
# Criar grupo
aws iam create-group --group-name administrators --endpoint-url http://localhost:4003

# Criar policy de admin
aws iam create-policy \
  --policy-name AdministratorAccess \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":"*",
      "Resource":"*"
    }]
  }' \
  --endpoint-url http://localhost:4003

# Anexar policy ao grupo
aws iam attach-group-policy \
  --group-name administrators \
  --policy-arn arn:aws:iam::123456789012:policy/AdministratorAccess \
  --endpoint-url http://localhost:4003

# Adicionar usuários ao grupo
aws iam add-user-to-group --group-name administrators --user-name admin-user --endpoint-url http://localhost:4003
```

### Exemplo 4: Política com Restrições Específicas

```bash
# Policy que permite acesso apenas a uma tabela DynamoDB específica
aws iam create-policy \
  --policy-name DynamoDBSpecificTableAccess \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":[
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query"
      ],
      "Resource":"arn:aws:dynamodb:us-east-1:123456789012:table/users-table"
    }]
  }' \
  --endpoint-url http://localhost:4003
```

### Exemplo 5: Verificar Permissões (Policy Evaluation)

```bash
# Simular se um usuário tem permissão
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:user/developer \
  --action-names "s3:GetObject" \
  --resource-arns "arn:aws:s3:::my-bucket/*" \
  --endpoint-url http://localhost:4003
```

## Tipo de Policy

### Inline Policies
Políticas anexadas diretamente a um usuário, grupo ou role.

```bash
aws iam put-user-policy \
  --user-name developer \
  --policy-name inline-s3-policy \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":"s3:*",
      "Resource":"*"
    }]
  }' \
  --endpoint-url http://localhost:4003
```

### Managed Policies
Políticas independentes que podem ser reutilizadas.

```bash
aws iam create-policy \
  --policy-name managed-s3-policy \
  --policy-document '{...}' \
  --endpoint-url http://localhost:4003
```

## Gerenciamento de Dados Persistidos

### Limpar Todos os Dados IAM

Para resetar IAM e remover todos os usuários, grupos, roles e policies:

```bash
# Via CLI do simulador
npx aws-local-simulator reset

# Ou deletar manualmente os arquivos de dados
rm -rf .aws-local-simulator-data/iam/
```

### Fazer Backup dos Dados

```bash
# Copiar diretório de dados
cp -r .aws-local-simulator-data/iam/ ./iam-backup/

# Ou fazer zip
zip -r iam-backup.zip .aws-local-simulator-data/iam/
```

### Restaurar Dados de Backup

```bash
# Restaurar de backup
cp -r ./iam-backup/* .aws-local-simulator-data/iam/

# Reiniciar o serviço para carregar dados
npx aws-local-simulator restart
```

## Tipo de Policy
Políticas anexadas diretamente a um usuário, grupo ou role.

```bash
aws iam put-user-policy \
  --user-name developer \
  --policy-name inline-s3-policy \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":"s3:*",
      "Resource":"*"
    }]
  }' \
  --endpoint-url http://localhost:4003
```

### Managed Policies
Políticas independentes que podem ser reutilizadas.

```bash
aws iam create-policy \
  --policy-name managed-s3-policy \
  --policy-document '{...}' \
  --endpoint-url http://localhost:4003
```

## Exemplo de Policy Document

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/users-*"
    },
    {
      "Sid": "S3Access",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::my-bucket/*"
    },
    {
      "Sid": "DenyDeletion",
      "Effect": "Deny",
      "Action": [
        "dynamodb:DeleteTable",
        "s3:DeleteBucket"
      ],
      "Resource": "*"
    }
  ]
}
```

## Efeitos de Policy

| Efeito | Descrição |
|--------|-----------|
| Allow | Permite a ação |
| Deny | Nega a ação (tem precedência sobre Allow) |

## Operadores de Condição

| Operador | Descrição |
|----------|-----------|
| StringEquals | String exato |
| StringLike | String com wildcard |
| IpAddress | Endereço IP |
| DateGreaterThan | Data maior que |
| Bool | Valor booleano |

## Referências

- [AWS IAM Documentation](https://docs.aws.amazon.com/iam/)
- [IAM Policy Examples](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_examples.html)
- [Policy Evaluation Logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
