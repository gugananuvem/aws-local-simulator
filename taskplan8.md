# Taskplan 8: Frontend Migration to Gateway Port 4700

Este arquivo é a fonte de verdade do progresso da Wave 8. Marcar `[x]` ao concluir cada item, com a data e o link do relatatório da onda.

**Base:** feature-v3.0.2 (tip 8b937ec). Gateway backend na porta 4700 já existe e está completo (Waves 0-7).

## Regras
- Backend gateway na porta 4700 (todos os serviços acessíveis através dele)
- Portas legadas mantidas no backend para compatibilidade (AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true)
- Frontend deve usar http://localhost:4700 como endpoint padrão
- Respeitar variáveis de ambiente para configuração customizada (AWS_ENDPOINT_URL, etc.)
- Cada onda é uma execução de workflow separada. O usuário aprova cada onda antes de iniciar a seguinte.

## Objetivo da Wave 8
Atualizar o frontend (React/Vite) para usar a porta 4700 como padrão para todas as chamadas AWS SDK.

## Subtarefas

### 8.1 Inventário de Endpoint Configuration
- [x] Identificar todos os arquivos no frontend onde endpoints AWS são configurados
- [x] Mapear portas atuais usadas (ex: 4566, 4575, 4585, etc.)
- [x] Documentar padrão atual de configuração de endpoint

**Arquivos principais para verificar:**
- src/services/* (AWS SDK configurations)
- src/hooks/* (custom hooks com endpoints)
- src/lib/* (utility functions)
- Variáveis de ambiente (.env, .env.local, etc.)

**Entregável:** Relatório `inventory-wave8.md` com lista completa de arquivos e portas atuais

### 8.2 Atualização de Endpoint Configuration
- [x] Criar arquivo de configuração centralizado para endpoints (ex: src/config/endpoints.js)
- [x] Definir padrão: `AWS_ENDPOINT_URL=http://localhost:4700`
- [x] Adicionar suporte para AWS_ENDPOINT_URL variável de ambiente
- [x] Atualizar todos os serviços AWS SDK para usar a configuração centralizada
- [x] Adicionar fallback para portas legadas quando AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true

**Entregável:** Código-fonte atualizado com configuração centralizada. Concluído em 2026-11-20: `src/frontend/src/shared/config/endpoints.js` (único export `AWS_CONFIG`), clientes AWS SDK e hooks atualizados; fallback legado coberto por `endpoints.test.js`.

### 8.3 Build & Test Verification
- [x] Rodar `npm run build` no frontend - deve passar
- [x] Verificar que o frontend conecta corretamente ao backend na porta 4700
- [x] Testar pelo menos 3 serviços diferentes (ex: DynamoDB, S3, SQS)
- [x] Documentar qualquer quebra encontrada

**Entregável:** Relatório `build-test-wave8.md` com resultados dos testes. Concluído em 2026-11-20: build OK, 469 testes OK, smoke test com DynamoDB/S3/SQS pela porta 4700. Relatório: `C:\Projetos\aws-local-simulator\inventory\onda8\build-test-wave8.md`.

### 8.4 Documentação
- [x] Atualizar README.md do frontend com instruções de configuração de portas
- [x] Documentar variáveis de ambiente suportadas (AWS_ENDPOINT_URL, AWS_LOCAL_SIMULATOR_LEGACY_PORTS)
- [x] Adicionar seção "Port Configuration" com exemplos
- [x] Documentar como usar com o gateway (porta 4700) vs portas legadas

**Entregável:** README.md atualizado com documentação de portas. Concluído em 2026-11-20: `src/frontend/README.md` com seção "Port Configuration", variáveis suportadas, exemplos e troubleshooting.

### 8.5 Merge & Finalize
- [ ] Commit com mensagens convencionais (feat(frontend): update to gateway port 4700)
- [ ] Merge para feature-v3.0.2
- [ ] Atualizar taskplan8.md com status de conclusão
- [ ] Atualizar taskplan.md principal com Wave 8 completa

**Entregável:** Branch feature-v3.0.2 atualizado com changes da Wave 8

## Suas exceções (aprovadas pelo usuário)
- Nenhuma exceção prevista para Wave 8

## Sequência por onda
Plan → Build-loop (code + review, máximo 2 iterações) → Docs → Merge → Finalize

## Registro de execuções
| Onda | Workflow | Status | Relatório |
|---|---|---|---|
| 8 | wf_f34cf29ac63ac433 | concluída em 2026-11-20 | `C:\Projetos\aws-local-simulator\inventory\onda8\inventory-wave8.md` e `C:\Projetos\aws-local-simulator\inventory\onda8\build-test-wave8.md` |

## Contexto adicional
- Backend Wave 7 completada: better-sqlite3 upgraded, DbEngine.close() idempotent, ClusterManager.close() implemented, athena/aurora enabled
- Backend branch: feature-v3.0.2 (tip 8b937ec)
- Frontend path: c:\Projetos\aws-local-simulator\src\frontend
- Frontend stack: React 18 + Vite + AWS SDK v3
