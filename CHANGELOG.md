# Changelog

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