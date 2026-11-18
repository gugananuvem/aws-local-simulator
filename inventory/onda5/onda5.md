# Relatório de Migração - Onda 5

- Data: 2026-11-18
- Worktree: `C:\Projetos\aws-local-simulator\src\backend\.worktrees\onda5`
- Gateway na porta 4700

## Serviços Testados

| Serviço | Porta | Comando | Código gateway (4700) | Código legado | Situação | Evidência |
|---|---|---|---|---|---|---|
| organizations | 4581 | describe-organization | 0 | 0 | migrado | Saída idêntica em ambas as portas |
| acm | 4025 | list-certificates | - | - | pendente | - |
| cloudfront | 4017 | list-distributions | - | - | pendente | - |
| config | 4013 | describe-configuration-recorders | - | - | pendente | - |
| xray | 4015 | get-groups | - | - | pendente | - |
| dax | 8111 | describe-clusters | - | - | pendente | - |

## Observações

- O serviço `organizations` está migrado: testado nas portas 4700 (gateway) e 4581 (legada), ambos retornaram código 0 com saída idêntica.
- A configuração do simulador não habilita `xray` e `dax` por padrão (`aws-local-simulator.json`).
- Para testar `xray` e `dax`, é necessário habilitá-los temporariamente no `aws-local-simulator.json` ou usar uma configuração separada.
- O servidor `cloudfront` usa GET /2020-05-31/distribution (não POST).
- O servidor `config` usa o protocolo JSON com cabeçalho `X-Amz-Target`.
- O servidor `xray` usa POST para as rotas: /Groups (GetGroups), /CreateGroup, /TraceSummaries, /GetSamplingRules.
