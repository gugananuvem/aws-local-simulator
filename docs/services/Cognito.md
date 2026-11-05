# Cognito (Amazon Cognito)

## Visão Geral

Amazon Cognito é um serviço de autenticação e autorização que oferece gerenciamento de usuários, autenticação multi-fator e integração com provedores sociais. O simulador local oferece suporte a Cognito User Pools, permitindo desenvolver e testar fluxos de autenticação localmente.

**Principais Features:**
- Criar e gerenciar User Pools
- Registrar e confirmar usuários
- Autenticação e login
- Password reset
- Multi-factor authentication (MFA)
- Integração com aplicações Web e Mobile
- Tokens JWT para autorização

## Porta e Endpoint

**Porta Padrão:** `9229`  
**URL Base:** `http://localhost:9229`  
**Admin API:** `http://localhost:9229/__admin/userpools`

## Quick Start

### 1. Criar User Pool

```bash
aws cognito-idp create-user-pool \
  --pool-name my-user-pool \
  --endpoint-url http://localhost:9229
```

### 2. Criar App Client

```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id us-east-1_xxxxx \
  --client-name my-app \
  --endpoint-url http://localhost:9229
```

### 3. Registrar Usuário

```bash
aws cognito-idp sign-up \
  --client-id YOUR_CLIENT_ID \
  --username usuario@example.com \
  --password "Temp@123456" \
  --user-attributes Name=email,Value=usuario@example.com Name=name,Value="John Doe" \
  --endpoint-url http://localhost:9229
```

### 4. Confirmar Usuário (Admin)

```bash
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@example.com \
  --endpoint-url http://localhost:9229
```

### 5. Autenticar

```bash
aws cognito-idp admin-initiate-auth \
  --user-pool-id us-east-1_xxxxx \
  --client-id YOUR_CLIENT_ID \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=usuario@example.com,PASSWORD="Temp@123456" \
  --endpoint-url http://localhost:9229
```

## Operações Básicas

### Listar User Pools

```bash
aws cognito-idp list-user-pools \
  --max-results 10 \
  --endpoint-url http://localhost:9229
```

### Descrever User Pool

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id us-east-1_xxxxx \
  --endpoint-url http://localhost:9229
```

### Listar Usuários

```bash
aws cognito-idp list-users \
  --user-pool-id us-east-1_xxxxx \
  --endpoint-url http://localhost:9229
```

### Criar Usuário (Admin)

```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@example.com \
  --user-attributes Name=email,Value=usuario@example.com Name=name,Value="John Doe" \
  --temporary-password "TempPass@123" \
  --message-action SUPPRESS \
  --endpoint-url http://localhost:9229
```

### Deletar Usuário (Admin)

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@example.com \
  --endpoint-url http://localhost:9229
```

### Limpar Listar Pool

```bash
aws cognito-idp delete-user-pool \
  --user-pool-id us-east-1_xxxxx \
  --endpoint-url http://localhost:9229
```

## Exemplos de Uso

### Exemplo 1: Fluxo de Registro e Login com Node.js

```javascript
const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  AdminInitiateAuthCommand
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({
  endpoint: 'http://localhost:9229',
  region: 'us-east-1'
});

const USER_POOL_ID = 'us-east-1_xxxxx';
const CLIENT_ID = 'your-client-id';

// Registrar usuário
async function signUp(email, password, name) {
  const command = new SignUpCommand({
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'name', Value: name }
    ]
  });

  return await cognito.send(command);
}

// Confirmar usuário (admin)
async function confirmUser(email) {
  const command = new AdminConfirmSignUpCommand({
    UserPoolId: USER_POOL_ID,
    Username: email
  });

  return await cognito.send(command);
}

// Autenticar
async function authenticate(email, password) {
  const command = new AdminInitiateAuthCommand({
    UserPoolId: USER_POOL_ID,
    ClientId: CLIENT_ID,
    AuthFlow: 'ADMIN_NO_SRP_AUTH',
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password
    }
  });

  return await cognito.send(command);
}

// Usar
await signUp('user@example.com', 'Password@123', 'John Doe');
await confirmUser('user@example.com');
const authResult = await authenticate('user@example.com', 'Password@123');
console.log('Access Token:', authResult.AuthenticationResult.AccessToken);
```

### Exemplo 2: Change Password

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@example.com \
  --password "NewPassword@123" \
  --permanent \
  --endpoint-url http://localhost:9229
```

### Exemplo 3: Reset Password

```bash
# Admin forgot password
aws cognito-idp admin-reset-user-password \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@example.com \
  --endpoint-url http://localhost:9229

# User forgot password
aws cognito-idp forgot-password \
  --client-id YOUR_CLIENT_ID \
  --username usuario@example.com \
  --endpoint-url http://localhost:9229
```

### Exemplo 4: User Attributes

```bash
# Atualizar atributos do usuário
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@example.com \
  --user-attributes \
    Name=name,Value="John Updated" \
    Name=email,Value="newemail@example.com" \
    Name=phone_number,Value="+5511999999999" \
  --endpoint-url http://localhost:9229
```

### Exemplo 5: Integração com API Gateway

No arquivo `aws-local-simulator.json`:

```json
{
  "cognito": {
    "userPools": [
      {
        "PoolName": "my-user-pool",
        "AutoVerifiedAttributes": ["email"]
      }
    ]
  },
  "apigateway": {
    "apis": [
      {
        "name": "my-api",
        "routes": [
          {
            "path": "/protected",
            "method": "GET",
            "authorizer": "cognito",
            "authorizerConfig": {
              "userPoolId": "us-east-1_xxxxx",
              "clientId": "YOUR_CLIENT_ID"
            }
          }
        ]
      }
    ]
  }
}
```

Então, para acessar o endpoint protegido:

```bash
# Obter token
TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id us-east-1_xxxxx \
  --client-id YOUR_CLIENT_ID \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=user@example.com,PASSWORD=Password@123 \
  --endpoint-url http://localhost:9229 \
  | grep IdToken | awk '{print $2}' | tr -d '",')

# Chamar endpoint protegido
curl -H "Authorization: Bearer $TOKEN" http://localhost:4567/protected
```

### Exemplo 6: Listar Grupos de Usuários

```bash
# Criar grupo
aws cognito-idp create-group \
  --group-name administrators \
  --user-pool-id us-east-1_xxxxx \
  --description "Admin users" \
  --endpoint-url http://localhost:9229

# Adicionar usuário ao grupo
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@example.com \
  --group-name administrators \
  --endpoint-url http://localhost:9229

# Listar grupos do usuário
aws cognito-idp admin-list-groups-for-user \
  --user-pool-id us-east-1_xxxxx \
  --username usuario@example.com \
  --endpoint-url http://localhost:9229
```

## Atributos de Usuário Padrão

| Atributo | Descrição | Mutável |
|----------|-----------|---------|
| email | Email do usuário | Sim |
| name | Nome completo | Sim |
| given_name | Primeiro nome | Sim |
| family_name | Sobrenome | Sim |
| phone_number | Telefone | Sim |
| picture | URL da foto | Sim |
| website | Website | Sim |
| gender | Gênero | Sim |
| birthdate | Data de nascimento | Sim |
| address | Endereço | Sim |
| locale | Localidade | Sim |
| updated_at | Última atualização | Não |
| email_verified | Email verificado | Não |

## JWT Tokens

Cognito retorna três tipos de tokens:

- **ID Token**: Informações sobre o usuário (autenticação)
- **Access Token**: Autorização para acessar recursos
- **Refresh Token**: Renovar access token expirado

## Referências

- [AWS Cognito Documentation](https://docs.aws.amazon.com/cognito/)
- [Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pools.html)
- [Cognito Authentication Flow](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow.html)
- [AWS Local Simulator](https://github.com/gugananuvem/aws-local-simulator)
