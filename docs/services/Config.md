# AWS Config

## 📖 Visão Geral

**AWS Config** é um serviço que ajuda a rastrear as configurações dos seus recursos AWS e avaluar como essas configurações atendem às suas necessidades de conformidade.

**Porta**: `4013`  
**Endpoint**: `http://localhost:4013`

### Features Suportadas
- ✅ Configuration Recorders
- ✅ Config Rules
- ✅ Compliance by Config Rule
- ✅ Config Resources
- ✅ Config Items
- ✅ Configuration Snapshots

---

## 🚀 Quick Start

### 1. Descrever Configuration Recorders

```bash
aws configservice describe-configuration-recorders \
  --endpoint-url http://localhost:4013
```

**Resposta:**
```json
{
  "ConfigurationRecorders": []
}
```

### 2. Listar Config Rules

```bash
aws configservice describe-config-rules \
  --endpoint-url http://localhost:4013
```

**Resposta:**
```json
{
  "ConfigRules": []
}
```

### 3. Descrever Resources Configurados

```bash
aws configservice describe-config-resources \
  --endpoint-url http://localhost:4013
```

**Resposta:**
```json
{
  "ConfigurationItems": []
}
```

### 4. Verificar Compliance

```bash
aws configservice describe-compliance-by-config-rule \
  --endpoint-url http://localhost:4013
```

**Resposta:**
```json
{
  "ComplianceByConfigRules": []
}
```

---

## 📝 Exemplos Avançados

### Criar Config Rule para EC2

```bash
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "ec2-running-check",
    "Description": "Verifica se instâncias EC2 estão rodando",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "EC2_RUNNING_ON_DEMAND"
    },
    "Scope": {
      "ComplianceResourceTypes": [
        "AWS::EC2::Instance"
      ]
    }
  }' \
  --endpoint-url http://localhost:4013
```

### Criar Config Rule Customizada

```bash
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "required-tags",
    "Description": "Verifica se recursos têm tags obrigatórias",
    "Source": {
      "Owner": "CUSTOM_LAMBDA",
      "SourceIdentifier": "arn:aws:lambda:us-east-1:123456789012:function:check-tags",
      "SourceDetails": [
        {
          "EventSource": "aws.config",
          "MessageType": "ConfigurationItemChangeNotification"
        }
      ]
    },
    "Scope": {
      "ComplianceResourceTypes": [
        "AWS::EC2::Instance",
        "AWS::S3::Bucket"
      ]
    }
  }' \
  --endpoint-url http://localhost:4013
```

### Listar Regras de Compliance

```bash
aws configservice describe-config-rules \
  --endpoint-url http://localhost:4013 \
  --query 'ConfigRules[*].[ConfigRuleName,ConfigRuleState]'
```

### Obter Detalhes de Compliance

```bash
aws configservice describe-compliance-by-config-rule \
  --compliance-types COMPLIANT \
  --endpoint-url http://localhost:4013
```

### Listar Recursos Não-Conformes

```bash
aws configservice get-compliance-details-by-config-rule \
  --config-rule-name "required-tags" \
  --compliance-types NON_COMPLIANT \
  --endpoint-url http://localhost:4013
```

---

## 🧪 Testing

### Teste 1: Verificar Resources Configurados

```bash
# Descrever resources
RESOURCES=$(aws configservice describe-config-resources \
  --endpoint-url http://localhost:4013 \
  --query 'ConfigurationItems[*].[ResourceType,ResourceId]' \
  --output json)

echo "Resources encontrados:"
echo $RESOURCES

# Contar resources por tipo
aws configservice describe-config-resources \
  --endpoint-url http://localhost:4013 \
  --query 'ConfigurationItems[*].ResourceType' \
  --output text | tr ' ' '\n' | sort | uniq -c
```

### Teste 2: Criar e Verificar Config Rule

```bash
# Criar regra
RULE_NAME="test-rule-$(date +%s)"

aws configservice put-config-rule \
  --config-rule "{
    \"ConfigRuleName\": \"$RULE_NAME\",
    \"Description\": \"Test rule\",
    \"Source\": {
      \"Owner\": \"AWS\",
      \"SourceIdentifier\": \"EC2_RUNNING_ON_DEMAND\"
    }
  }" \
  --endpoint-url http://localhost:4013

# Verificar se foi criada
sleep 1

CREATED=$(aws configservice describe-config-rules \
  --config-rule-names "$RULE_NAME" \
  --endpoint-url http://localhost:4013 \
  --query 'ConfigRules[0].ConfigRuleName' \
  --output text)

echo "Regra criada: $CREATED"

# Deletar regra
aws configservice delete-config-rule \
  --config-rule-name "$RULE_NAME" \
  --endpoint-url http://localhost:4013
```

### Teste 3: Compliance Status

```bash
# Listar todas as regras e seus status
aws configservice describe-compliance-by-config-rule \
  --endpoint-url http://localhost:4013 \
  --query 'ComplianceByConfigRules[*].[ConfigRuleName,Compliance.ComplianceType]' \
  --output table

# Contar recursos conformes vs não-conformes
echo "Status de Compliance:"
aws configservice describe-compliance-by-config-rule \
  --endpoint-url http://localhost:4013 \
  --query 'ComplianceByConfigRules[*].Compliance.ComplianceType' \
  --output text | tr ' ' '\n' | sort | uniq -c
```

---

## 📊 Configuração

### Arquivo aws-local-simulator.json

```json
{
  "services": {
    "config": true
  },
  "ports": {
    "config": 4013
  }
}
```

### Variáveis de Ambiente

```bash
export AWS_LOCAL_SIMULATOR_CONFIG=true
export AWS_LOCAL_SIMULATOR_CONFIG_PORT=4013
```

---

## 🔗 Integração com Outros Serviços

### AWS Config + EC2

```bash
# 1. Criar instância EC2
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id ami-12345678 \
  --count 1 \
  --endpoint-url http://localhost:4020 \
  --query 'Instances[0].InstanceId' \
  --output text)

# 2. Descrever resource em Config
aws configservice describe-config-resources \
  --resource-types AWS::EC2::Instance \
  --endpoint-url http://localhost:4013

# 3. Criar regra para verificar instâncias
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "ec2-running",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "EC2_RUNNING_ON_DEMAND"
    },
    "Scope": {
      "ComplianceResourceTypes": ["AWS::EC2::Instance"]
    }
  }' \
  --endpoint-url http://localhost:4013
```

### AWS Config + IAM

```bash
# Criar regra para verificar IAM
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "iam-mfa-enabled",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "MFA_ENABLED_FOR_IAM_CONSOLE_ACCESS"
    },
    "Scope": {
      "ComplianceResourceTypes": ["AWS::IAM::User"]
    }
  }' \
  --endpoint-url http://localhost:4013
```

---

## 📋 Endpoints Disponíveis

| Método | Operação | Descrição |
|--------|----------|-----------|
| POST | DescribeConfigRules | Listar config rules |
| POST | PutConfigRule | Criar/atualizar config rule |
| POST | DeleteConfigRule | Deletar config rule |
| POST | DescribeComplianceByConfigRule | Verificar compliance |
| POST | GetComplianceDetailsByConfigRule | Detalhes de compliance |
| POST | DescribeConfigResources | Listar recursos |

---

## 🐛 Troubleshooting

### Config Rule não encontrada

```bash
# Listar todas as rules
aws configservice describe-config-rules \
  --endpoint-url http://localhost:4013
```

### Verificar se service está rodando

```bash
curl -X POST http://localhost:4013/ \
  -H "Content-Type: application/x-amz-json-1.1" \
  -H "X-Amz-Target: ConfigService_20141128.DescribeConfigRules" \
  -d '{}'
```

### Config Rule retorna erro de validação

```bash
# Garantir que a regra tem estrutura correta
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "test-rule",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "VALID_IDENTIFIER"
    }
  }' \
  --endpoint-url http://localhost:4013
```

---

## 📚 Referências

- **AWS Config Documentation**: https://docs.aws.amazon.com/config/
- **AWS CLI Config Commands**: https://docs.aws.amazon.com/cli/latest/reference/configservice/
- **Config Rules**: https://docs.aws.amazon.com/config/latest/developerguide/managed-rules-by-service.html
- **Integração com EC2**: [EC2 Documentation](EC2.md)
- **Integração com IAM**: [IAM Documentation](IAM.md)

---

**Versão**: 1.0.0  
**Última atualização**: Outubro 2024

