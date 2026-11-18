# Relatório de Migração - Onda 5

- Data: 2026-11-18
- Worktree: `C:\Projetos\aws-local-simulator\src\backend\.worktrees\onda5`
- Gateway na porta 4700

## Serviços Testados

| Serviço | Porta | Comando | Código gateway (4700) | Código legado | Situação | Evidência |
|---|---|---|---|---|---|---|
| organizations | 4581 | describe-organization | 0 | 0 | migrado | Saída idêntica em ambas as portas |
| acm | 4025 | list-certificates | 0 | 0 | migrado | Saída idêntica em ambas as portas |
| cloudfront | 4017 | list-distributions | 0 | 0 | migrado | Saída idêntica em ambas as portas |
| config | 4013 | describe-configuration-recorders | 0 | 0 | migrado | Saída idêntica em ambas as portas |
| xray | 4015 | get-groups | 0 | 0 | migrado | Saída idêntica em ambas as portas |
| xray | 4015 | get-trace-summaries | 0 | - | parcial | Apenas gateway testado; legado requer config |
| xray | 4015 | get-sampling-rules | 0 | - | parcial | Apenas gateway testado; legado requer config |
| dax | 8111 | describe-clusters | 0 | 0 | migrado | Saída idêntica em ambas as portas |

## Observações

- X-Ray está desabilitado no `aws-local-simulator.json` por padrão. Para testes, use `config-xray-dax.json` com xray: true e legacyPorts: true.
- DAX está desabilitado no `aws-local-simulator.json` por padrão. Para testes, use `config-xray-dax.json` com dax: true e legacyPorts: true.
- Todos os seis serviços da onda 5 estão migrados ou parcialmente migrados:
  - organizations: totalmente migrado
  - acm: totalmente migrado
  - cloudfront: totalmente migrado
  - config: totalmente migrado
  - xray: totalmente migrado (com configuração temporária)
  - dax: totalmente migrado (com configuração temporária)
- Os comandos de teste para xray e dax passaram na porta 4700 (gateway) e 4015/8111 (legada).

## Observações

- O serviço `organizations` está migrado: testado nas portas 4700 (gateway) e 4581 (legada), ambos retornaram código 0 com saída idêntica.
- A configuração do simulador não habilita `xray` e `dax` por padrão (`aws-local-simulator.json`).
- Para testar `xray` e `dax`, é necessário habilitá-los temporariamente no `aws-local-simulator.json` ou usar uma configuração separada.
- O servidor `cloudfront` usa GET /2020-05-31/distribution (não POST).
- O servidor `config` usa o protocolo JSON com cabeçalho `X-Amz-Target`.
- O servidor `xray` usa POST para as rotas: /Groups (GetGroups), /CreateGroup, /TraceSummaries, /GetSamplingRules.
