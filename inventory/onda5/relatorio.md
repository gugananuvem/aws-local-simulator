# Relatório de Migração - Onda 5

- Data: 2026-11-18
- Worktree: `C:\Projetos\aws-local-simulator\src\backend\.worktrees\onda5`
- Base: `cdfc2d2`
- Branch: `migracao-onda5`

## Resumo

Esta onda migrou o serviço **organizations** para a porta única (AWS_ENDPOINT_URL). Os demais serviços (acm, cloudfront, config, xray, dax) ficaram pendentes de verificação.

## Serviços Migrados

### organizations
- **Porta legada:** 4581
- **Status:** Migrado
- **Comando:** `aws organizations describe-organization`
- **Resultados:**
  - Gateway (4700): Código 0
  - Legado (4581): Código 0
  - Saída: Idêntica em ambas as portas

## Pendências

### acm
- **Porta legada:** 4025
- **Comando:** `aws acm list-certificates`
- **Status:** Pendente de teste

### cloudfront
- **Porta legada:** 4017
- **Comando:** `aws cloudfront list-distributions`
- **Observação:** CLI usa GET /2020-05-31/distribution
- **Status:** Pendente de teste

### config
- **Porta legada:** 4013
- **Comando:** `aws configservice describe-configuration-recorders`
- **Status:** Pendente de teste

### xray
- **Porta legada:** 4015
- **Comandos:** `aws xray get-groups`, `get-trace-summaries`, `get-sampling-rules`
- **Observação:** X-Ray está desabilitado no `aws-local-simulator.json` (false)
- **Status:** Pendente de teste (requer configuração temporária)

### dax
- **Porta legada:** 8111
- **Comando:** `aws dax describe-clusters`
- **Observação:** DAX está desabilitado no `aws-local-simulator.json` (false)
- **Status:** Pendente de teste (requer configuração temporária)

## Defeitos Corrigidos

Nenhum defeito encontrado na onda 5.

## Limpeza

- Não houveram alterações no arquivo `aws-local-simulator.json`
- Arquivo temporário `aws-local-simulator-legacy.json` criado para testes com legacy ports (pode ser removido)