# Relatório de Migração - Onda 5

- Data: 2026-11-18
- Worktree: `C:\Projetos\aws-local-simulator\src\backend\.worktrees\onda5`
- Base: `cdfc2d2`
- Branch: `migracao-onda5`

## Resumo

Esta onda migrou os seis serviços especificados para a porta única (AWS_ENDPOINT_URL):

1. **organizations** - totalmente migrado
2. **acm** - totalmente migrado
3. **cloudfront** - totalmente migrado
4. **config** - totalmente migrado
5. **xray** - totalmente migrado (requer configuração temporária)
6. **dax** - totalmente migrado (requer configuração temporária)

## Serviços Migrados

### organizations
- **Porta legada:** 4581
- **Status:** Migrado
- **Comando:** `aws organizations describe-organization`
- **Resultados:**
  - Gateway (4700): Código 0
  - Legado (4581): Código 0
  - Saída: Idêntica em ambas as portas

### acm
- **Porta legada:** 4025
- **Status:** Migrado
- **Comando:** `aws acm list-certificates`
- **Resultados:**
  - Gateway (4700): Código 0
  - Legado (4025): Código 0
  - Saída: Idêntica em ambas as portas

### cloudfront
- **Porta legada:** 4017
- **Status:** Migrado
- **Comando:** `aws cloudfront list-distributions`
- **Resultados:**
  - Gateway (4700): Código 0
  - Legado (4017): Código 0
  - Saída: Idêntica em ambas as portas
- **Observação:** CLI usa GET /2020-05-31/distribution

### config
- **Porta legada:** 4013
- **Status:** Migrado
- **Comando:** `aws configservice describe-configuration-recorders`
- **Resultados:**
  - Gateway (4700): Código 0
  - Legado (4013): Código 0
  - Saída: Idêntica em ambas as portas
- **Observação:** Usa protocolo JSON com cabeçalho `X-Amz-Target`

### xray
- **Porta legada:** 4015
- **Status:** Migrado
- **Comandos:** 
  - `aws xray get-groups`
  - `aws xray get-trace-summaries`
  - `aws xray get-sampling-rules`
- **Resultados:**
  - Gateway (4700): Código 0 (todos os comandos)
  - Legado (4015): Código 0
  - Saída: Idêntica em ambas as portas
- **Observação:** X-Ray está desabilitado no `aws-local-simulator.json` (false). Requer configuração temporária com `config-xray-dax.json`.

### dax
- **Porta legada:** 8111
- **Status:** Migrado
- **Comando:** `aws dax describe-clusters`
- **Resultados:**
  - Gateway (4700): Código 0
  - Legado (8111): Código 0
  - Saída: Idêntica em ambas as portas
- **Observação:** DAX está desabilitado no `aws-local-simulator.json` (false). Requer configuração temporária com `config-xray-dax.json`.

## Configurações Temporárias

Para testar xray e dax, foram criadas as seguintes configurações:

1. **aws-local-simulator-xray-dax.json** - Configuração completa com xray: true, dax: true, legacyPorts: true
2. **config-xray-dax.json** - Configuração simplificada com os mesmos serviços habilitados

Ambas as configurações permitem testar os serviços na porta legada e no gateway.

## Defeitos Corrigidos

Nenhum defeito encontrado na onda 5. Todos os serviços funcionaram corretamente nas portas 4700 (gateway) e legada.

## Limpeza

- Não houveram alterações no arquivo `aws-local-simulator.json`
- Arquivos temporários criados para testes:
  - `aws-local-simulator-legacy.json`
  - `aws-local-simulator-xray-temp.json`
  - `aws-local-simulator-xray-dax.json`
  - `aws-local-simulator-xray.json`
  - `config-xray-dax.json`
  - Scripts PowerShell: `add-dax.ps1`, `add-dax-fix.ps1`
- Todos os arquivos temporários podem ser removidos após a aprovação da onda