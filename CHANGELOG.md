# Changelog

## [1.0.44]
### Corrigido
- Lambda: o `LambdaServer` reutiliza o `LambdaSimulator` injetado pelo `LambdaService` (instância única por serviço). Antes eram criados dois workers persistentes por Lambda: um deles (sem debugpy) atendia a API Invoke e sobrevivia ao `stop()`. Usado isoladamente, o `LambdaServer` cria o próprio simulador e encerra seus workers no `stop()`.
- Pacote: `__pycache__/` e `*.pyc` não são mais publicados (build, `.npmignore` e `.gitignore`).
- Lambda Invoke: segue o contrato da AWS. Função executada responde HTTP 200 (o `statusCode` do payload não vira status HTTP), erro de função responde 200 + `X-Amz-Function-Error: Unhandled` com `errorMessage/errorType/stackTrace`, `DryRun` responde 204 e `Event` 202. O API Gateway continua lendo o `statusCode` do payload.

## [1.0.0] - 2024-01-XX

### Adicionado
- Suporte inicial para todos os serviços AWS
- DynamoDB Simulator completo
- S3 Simulator com persistência
- SQS Simulator com suporte a batches
- Lambda Simulator com hot reload
- Cognito Simulator com JWT tokens
- API Gateway Simulator com REST e HTTP APIs
- ECS/Fargate Simulator com containers
- CLI para gerenciamento
- Configuração via arquivo JSON
- Suporte a variáveis de ambiente
- Endpoints admin para debug
- Persistência em disco com LocalStore
- Suporte CommonJS e ES Modules

### Melhorias
- Documentação completa
- Exemplos de uso
- Scripts de teste

### Correções
- Correção de bugs iniciais
- Melhorias de performance

## Package

# Navegue até a raiz do projeto
cd aws-local-simulator

# Verifique se há arquivos desnecessários
ls -la

# Limpe a pasta node_modules (opcional, mas recomendado)
rm -rf node_modules
rm package-lock.json

# Reinstale as dependências
npm install