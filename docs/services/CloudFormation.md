# CloudFormation (AWS CloudFormation)

## Visão Geral

AWS CloudFormation é um serviço de Infraestrutura como Código (IaC) que permite provisionar e gerenciar recursos AWS usando templates. O simulador local oferece suporte a CloudFormation, permitindo criar stacks de recursos localmente e testar infraestrutura.

**Principais Features:**
- Criar e gerenciar stacks
- Suporte a templates JSON e YAML
- Gerenciar recursos de forma declarativa
- Stack updates e rollbacks
- Outputs e parâmetros
- Integração com serviços locais (S3, DynamoDB, SQS, Lambda)

## Porta e Endpoint

**Porta Padrão:** `4582`  
**URL Base:** `http://localhost:4582`  
**Admin API:** `http://localhost:4582/__admin/stacks`

## Quick Start

### 1. Criar Template CloudFormation

Arquivo `template.yaml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Simple S3 Bucket Stack'

Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-test-bucket

Outputs:
  BucketName:
    Value: !Ref MyBucket
    Export:
      Name: MyBucketName
```

### 2. Criar Stack

```bash
aws cloudformation create-stack \
  --stack-name my-stack \
  --template-body file://template.yaml \
  --endpoint-url http://localhost:4582
```

### 3. Listar Stacks

```bash
aws cloudformation list-stacks --endpoint-url http://localhost:4582
```

### 4. Descrever Stack

```bash
aws cloudformation describe-stacks \
  --stack-name my-stack \
  --endpoint-url http://localhost:4582
```

### 5. Deletar Stack

```bash
aws cloudformation delete-stack \
  --stack-name my-stack \
  --endpoint-url http://localhost:4582
```

## Operações Básicas

### Descrever Recursos

```bash
aws cloudformation describe-stack-resources \
  --stack-name my-stack \
  --endpoint-url http://localhost:4582
```

### Validar Template

```bash
aws cloudformation validate-template \
  --template-body file://template.yaml \
  --endpoint-url http://localhost:4582
```

### Atualizar Stack

```bash
aws cloudformation update-stack \
  --stack-name my-stack \
  --template-body file://template-updated.yaml \
  --endpoint-url http://localhost:4582
```

### Obter Template

```bash
aws cloudformation get-template \
  --stack-name my-stack \
  --endpoint-url http://localhost:4582
```

## Exemplos de Uso

### Exemplo 1: Stack com DynamoDB e S3

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'DynamoDB Table and S3 Bucket'

Parameters:
  TableName:
    Type: String
    Default: users-table
    Description: Nome da tabela DynamoDB

Resources:
  UsersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Ref TableName
      AttributeDefinitions:
        - AttributeName: id
          AttributeType: S
      KeySchema:
        - AttributeName: id
          KeyType: HASH
      BillingMode: PAY_PER_REQUEST

  DataBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub 'data-bucket-${AWS::StackName}'

Outputs:
  TableName:
    Value: !Ref UsersTable
    Export:
      Name: !Sub '${AWS::StackName}-TableName'
  
  BucketName:
    Value: !Ref DataBucket
    Export:
      Name: !Sub '${AWS::StackName}-BucketName'
```

Criar stack:

```bash
aws cloudformation create-stack \
  --stack-name my-app-stack \
  --template-body file://template.yaml \
  --parameters ParameterKey=TableName,ParameterValue=my-users-table \
  --endpoint-url http://localhost:4582
```

### Exemplo 2: Stack com Lambda e SQS

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Lambda with SQS Queue'

Resources:
  ProcessQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: process-queue
      VisibilityTimeout: 60

  DeadLetterQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: process-queue-dlq

  LambdaFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: queue-processor
      Runtime: nodejs16.x
      Handler: index.handler
      Code:
        ZipFile: |
          exports.handler = async (event) => {
            console.log('Processing messages:', event);
            return { statusCode: 200 };
          };
      Environment:
        Variables:
          QUEUE_URL: !Ref ProcessQueue

Outputs:
  QueueUrl:
    Value: !Ref ProcessQueue
  
  FunctionArn:
    Value: !GetAtt LambdaFunction.Arn
```

### Exemplo 3: Stack com Cognito

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Cognito User Pool'

Resources:
  UserPool:
    Type: AWS::Cognito::UserPool
    Properties:
      UserPoolName: my-app-users
      AutoVerifiedAttributes:
        - email

  UserPoolClient:
    Type: AWS::Cognito::UserPoolClient
    Properties:
      ClientName: my-app-client
      UserPoolId: !Ref UserPool
      ExplicitAuthFlows:
        - ADMIN_NO_SRP_AUTH
        - USER_PASSWORD_AUTH

Outputs:
  UserPoolId:
    Value: !Ref UserPool
  
  ClientId:
    Value: !Ref UserPoolClient
```

### Exemplo 4: Stack com Parâmetros e Condições

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Multi-environment Stack'

Parameters:
  Environment:
    Type: String
    AllowedValues:
      - dev
      - prod
    Default: dev
  
  CreateProdResources:
    Type: String
    AllowedValues:
      - 'true'
      - 'false'
    Default: 'false'

Conditions:
  IsProduction: !Equals [!Ref Environment, 'prod']
  CreateProd: !Equals [!Ref CreateProdResources, 'true']

Resources:
  DevBucket:
    Type: AWS::S3::Bucket
    Condition: !Not [IsProduction]
    Properties:
      BucketName: !Sub 'dev-bucket-${AWS::StackName}'

  ProdBucket:
    Type: AWS::S3::Bucket
    Condition: IsProduction
    Properties:
      BucketName: !Sub 'prod-bucket-${AWS::StackName}'

  OptionalTable:
    Type: AWS::DynamoDB::Table
    Condition: CreateProd
    Properties:
      TableName: optional-table
      AttributeDefinitions:
        - AttributeName: id
          AttributeType: S
      KeySchema:
        - AttributeName: id
          KeyType: HASH
      BillingMode: PAY_PER_REQUEST

Outputs:
  EnvironmentType:
    Value: !Ref Environment
```

Criar com parâmetros:

```bash
aws cloudformation create-stack \
  --stack-name my-stack \
  --template-body file://template.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=prod \
    ParameterKey=CreateProdResources,ParameterValue=true \
  --endpoint-url http://localhost:4582
```

### Exemplo 5: Stack com Outputs Exportados

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Stack with Exports'

Resources:
  SharedTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: shared-resources-table
      AttributeDefinitions:
        - AttributeName: id
          AttributeType: S
      KeySchema:
        - AttributeName: id
          KeyType: HASH
      BillingMode: PAY_PER_REQUEST

Outputs:
  TableArn:
    Value: !GetAtt SharedTable.Arn
    Export:
      Name: SharedTableArn
```

Usar exports em outro stack:

```yaml
Resources:
  Consumer:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: consumer
      Runtime: nodejs16.x
      Handler: index.handler
      Code:
        ZipFile: |
          exports.handler = async () => {
            return { statusCode: 200 };
          };
      Environment:
        Variables:
          TABLE_ARN: !ImportValue SharedTableArn
```

## Tipos de Recursos Suportados

| Tipo | Recurso |
|------|---------|
| AWS::S3::Bucket | S3 Bucket |
| AWS::DynamoDB::Table | DynamoDB Table |
| AWS::SQS::Queue | SQS Queue |
| AWS::SNS::Topic | SNS Topic |
| AWS::Lambda::Function | Lambda Function |
| AWS::Cognito::UserPool | Cognito User Pool |
| AWS::Cognito::UserPoolClient | Cognito Client |
| AWS::EC2::VPC | VPC |
| AWS::EC2::Subnet | Subnet |

## Funções Intrínsecas

| Função | Descrição |
|--------|-----------|
| !Ref | Referência a recurso |
| !GetAtt | Obter atributo de recurso |
| !Sub | Substituição de string |
| !Join | Concatenar valores |
| !Split | Dividir string |
| !If | Condicional |
| !Equals | Comparação |
| !And | AND lógico |
| !Or | OR lógico |
| !Not | NOT lógico |

## Referências

- [AWS CloudFormation Documentation](https://docs.aws.amazon.com/cloudformation/)
- [CloudFormation Template Reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-template-resource-type-ref.html)
- [CloudFormation Best Practices](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/best-practices.html)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
