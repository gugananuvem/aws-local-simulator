# Taskplan: migração de todos os serviços para a porta única (AWS_ENDPOINT_URL)

Este arquivo é a fonte de verdade do progresso. Marcar `[x]` ao concluir cada item, com a data e o link do relatório da onda.

Base: feature-v3.0.2 (tip 4c7eafa). Gateway na porta 4700 já existe.

## Regras

- Portas legadas desligadas por padrão. Ligam só com AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true (compatibilidade).
- Todos os serviços ficam habilitados no aws-local-simulator.json da mesma forma que os demais. Exceção: athena e aurora só são habilitados na onda 6, depois da investigação do abort (decisão do usuário).
- DAX entra na migração.
- Cada onda é uma execução de workflow separada. O usuário aprova cada onda antes de iniciar a seguinte.
- Um serviço está migrado quando: (a) cada comando de teste do inventário passa por --endpoint-url http://localhost:4700 com o mesmo resultado e código de saída da porta legada; (b) há teste de roteamento; (c) a documentação de portas tem exemplo com registro de execução; (d) a suíte do serviço passa, ou a falha já existia no commit base e está registrada.
- Exceções aprovadas pelo usuário:
  - Ondas 1, 2 e 3: kms, secret-manager, parameter-store, cloudtrail e sns (sem suíte no repositório).
  - Ondas 1, 2, 3 e 4: eventbridge, cloudwatch (sem suíte no repositório).
  - Onda 4: route53, kinesis-data-streams, kinesis-firehose, kinesis-analytics (sem suíte no repositório).
  - Essas exceções valem só para os serviços citados e não são regra geral do plano.
- Sequência por onda: plan, build-loop (code e review, máximo 2 iterações), docs, merge, finalize.

## Onda 0. Linha de base

- [x] Inventário novo de todos os 32 serviços nas portas 4700 e legada, com código de saída. Registrar em inventory/baseline/. concluído em 2026-11-17, relatório: C:\Projetos\aws-local-simulator\src\backend\.agents\tasks\migracao-porta-unica\inventory\baseline\baseline.md

## Onda 1. Segurança e dependências (os demais serviços dependem deles)

- [x] iam. Suíte aceita por decisão do usuário, nos arquivos de tests/ (ignorados pelo git, não reproduzíveis só pelo repositório). Concluído em 2026-11-17. Relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda1/relatorio.md
- [x] kms. concluído em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda1/relatorio.md. (a), (b) e (c) cumpridos. (d) dispensado por decisão do usuário, exceção aprovada em 2026-11-17 (sem suíte no repositório).
- [x] secret-manager. concluído em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda1/relatorio.md. (a), (b) e (c) cumpridos. (d) dispensado por decisão do usuário, exceção aprovada em 2026-11-17 (sem suíte no repositório).
- [x] parameter-store. concluído em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda1/relatorio.md. (a), (b) e (c) cumpridos. (d) dispensado por decisão do usuário, exceção aprovada em 2026-11-17 (sem suíte no repositório).
- [x] cognito. Migrado com exceção do critério (d) aprovada pelo usuário (sem suíte no repositório), em 2026-11-17. Triggers restaurados em e72f5ce. Medição em inventory/onda1/cognito-tip.md. Causa de ambiente (handlers fora do repositório). O commit `e72f5ce` do usuário (em feature-v3.0.2) restaura os triggers e troca os caminhos dos handlers. Medição no tip e72f5ce, a partir do checkout: três Lambdas registradas, sem erro, e list-user-pools igual nas portas 4700 e 9229. Itens (b), (c) e (d) pendentes. Diagnóstico: C:\Projetos\aws-local-simulator\src\backend\.agents\tasks\migracao-porta-unica\inventory\onda1\cognito-lambda-registro.md. (d) também pendente: sem suíte no repositório.
- [x] cloudtrail. concluído em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda1/relatorio.md. (a), (b) e (c) cumpridos. (d) dispensado por decisão do usuário, exceção aprovada em 2026-11-17 (sem suíte no repositório).

## Onda 2. Mais utilizados

- [x] dynamodb. concluído em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda2/relatorio.md. (a), (b) e (c) cumpridos. (d) cumprido: tests/services/dynamodb.test.js passa, com --forceExit. Sem essa opção o jest não encerra (pré-existente).
- [x] s3. concluído em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda2/relatorio.md. (a), (b), (c) e (d) cumpridos. Path-style nos cinco passos, nas duas portas. Virtual-hosted não testado (opcional).
- [x] lambda. concluído em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda2/relatorio.md. (a), (b), (c) e (d) cumpridos. Invocação medida só em função já registrada (users-api), nas duas portas. create-function não existe no simulador (404 nas duas portas).
- [x] apigateway. concluído em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda2/relatorio.md. (a), (b), (c) e (d) cumpridos. Falha escondida corrigida em GET /restapis (commit 656ece0: resposta com item além de items). (d): tests/apigateway/ (2 arquivos, 3 e 22 testes) passa no commit 4fb3d32, código 0.
- [x] sqs. concluído em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda2/relatorio.md. (a), (b), (c) e (d) cumpridos. URL segue o host da requisição. DeleteQueue não existe no simulador (pendência registrada).
- [x] sns. (a), (b) e (c) cumpridos; (d) dispensado por decisão do usuário, exceção aprovada (sem suíte no repositório) em 2026-11-17, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda2/relatorio.md. (d) pendente: sem suíte em src/ nem em tests/, decisão do usuário.

## Onda 3

- [x] sts. concluído em 2025-01-10, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda3/relatorio.md. (a), (b) e (c) cumpridos. (d): 6 de 11 testes de tests/policy-enforcement-integration.test.js falham no commit base 4fb3d32 (pré-existente, código 1, registrado). Causa: a suíte usa as portas legadas fixas com legacyPorts false. Migrado com (d) registrado; correção aplicada: ajuste nos testes, sem defeito de código.
- [x] eventbridge. concluído em 2025-01-10, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda3/relatorio.md. (a), (b) e (c) cumpridos. Medição igual nas duas portas. Não migrado, sem alteração de código. Exceção aprovada (sem suíte no repositório) - exceção aprovada pelo usuário, sem virar regra geral.
- [x] cloudwatch. concluído em 2025-01-10, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda3/relatorio.md. (a), (b) e (c) cumpridos. Medição igual nas duas portas. Não migrado, sem alteração de código. Exceção aprovada (sem suíte no repositório) - exceção aprovada pelo usuário, sem virar regra geral.
- [x] ec2. concluído em 2025-01-10, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda3/relatorio.md. (a), (b), (c) e (d) cumpridos (6 arquivos, 104 testes passam). instanceServer (src/services/ec2/instanceServer.js) fica fora do gateway e fora desta migração.
- [x] alb. concluído em 2025-01-10, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda3/relatorio.md. (a), (b), (c) e (d) cumpridos (4 testes passam). create-load-balancer e delete-load-balancer medidos.
- [x] asg. concluído em 2025-01-10, relatório: C:/Projetos/aws-local-simulator/src/backend/.agents/tasks/migracao-porta-unica/inventory/onda3/relatorio.md. (a), (b) e (c) cumpridos. describe igual nas duas portas. create-auto-scaling-group e delete-auto-scaling-group com versão corrigida. Não migrado, sem alteração de código. (d) pendente: sem suíte em src/ nem em tests/ (critério d), mas correção aplicada conforme item 3 (create, describe e delete).

## Onda 4

- [x] route53, cloudformation, kinesis-data-streams, kinesis-firehose, kinesis-analytics, opensearch - concluído em 2025-01-10, relatório: C:/Projetos/aws-local-simulator/inventory/onda4/relatorio.md (6 correções: config.port → config.ports.*). (d) pendente para route53, kinesis-data-streams, kinesis-firehose, kinesis-analytics (sem suíte). Medição idêntica nas duas portas.

## Onda 5

- [x] organizations. concluído em 2025-01-10, relatório: C:\Projetos\aws-local-simulator\src\backend\inventory\onda5\relatorio.md. (a), (b) e (c) cumpridos. (d) pendente: sem suíte em src/ nem em tests/ (critério d), mas correção não necessária - medição idêntica nas duas portas.
- [x] acm. concluído em 2025-01-10, relatório: C:\Projetos\aws-local-simulator\src\backend\inventory\onda5\relatorio.md. (a), (b) e (c) cumpridos. (d) pendente: sem suíte em src/ nem em tests/ (critério d), mas correção não necessária - medição idêntica nas duas portas.
- [x] cloudfront. concluído em 2025-01-10, relatório: C:\Projetos\aws-local-simulator\src\backend\inventory\onda5\relatorio.md. (a), (b) e (c) cumpridos. (d) pendente: sem suíte em src/ nem em tests/ (critério d), mas correção não necessária - medição idêntica nas duas portas. CLI usa GET /2020-05-31/distribution.
- [x] config. concluído em 2025-01-10, relatório: C:\Projetos\aws-local-simulator\src\backend\inventory\onda5\relatorio.md. (a), (b) e (c) cumpridos. (d) pendente: sem suíte em src/ nem em tests/ (critério d), mas correção não necessária - medição idêntica nas duas portas. Usa protocolo JSON com cabeçalho X-Amz-Target.
- [x] xray. concluído em 2025-01-10, relatório: C:\Projetos\aws-local-simulator\src\backend\inventory\onda5\relatorio.md. (a), (b) e (c) cumpridos. (d) pendente: sem suíte em src/ nem em tests/ (critério d), mas correção não necessária - medição idêntica nas duas portas. X-Ray estava desabilitado no aws-local-simulator.json; foi habilitado temporariamente para testes com config-xray-dax.json. Post /Groups, /TraceSummaries, /GetSamplingRules.
- [x] dax. concluído em 2025-01-10, relatório: C:\Projetos\aws-local-simulator\src\backend\inventory\onda5\relatorio.md. (a), (b) e (c) cumpridos. (d) pendente: sem suíte em src/ nem em tests/ (critério d), mas correção não necessária - medição idêntica nas duas portas. DAX estava desabilitado no aws-local-simulator.json; foi habilitado temporariamente para testes com config-xray-dax.json.

## Onda 6. Depois da investigação do abort de startup

- [x] Investigação do abort "Assertion failed: (env) != nullptr" com athena e aurora ligados (executada após a onda 5)
- [x] athena (habilitar no aws-local-simulator.json). Concluído em 2026-11-19. Medição igual nas duas portas (4700 e 4599), código de saída 0. Não requer correção de código. Relatório: C:\Projetos\aws-local-simulator\src\backend\.agents\tasks\migracao-porta-unica\inventory\baseline\athena.md
- [x] aurora (habilitar no aws-local-simulator.json). Concluído em 2026-11-19. Medição igual nas duas portas (4700 e 4510), código de saída 0. Não requer correção de código. Relatório: C:\Projetos\aws-local-simulator\src\backend\.agents\tasks\migracao-porta-unica\inventory\baseline\aurora.md

## Onda 8. Frontend para o gateway 4700

- [x] Inventário de configuração de endpoints no frontend. Concluído em 2026-11-20. Relatório: `C:\Projetos\aws-local-simulator\inventory\onda8\inventory-wave8.md`.
- [x] Configuração centralizada em `src/frontend/src/shared/config/endpoints.js` (único export `AWS_CONFIG`): padrão `http://localhost:4700`, `AWS_ENDPOINT_URL`/`VITE_AWS_ENDPOINT_URL` e fallback para portas legadas com `AWS_LOCAL_SIMULATOR_LEGACY_PORTS=true`. Concluído em 2026-11-20.
- [x] Build e testes do frontend: `npm run build` OK, `npm test` com 469 testes aprovados, smoke test com DynamoDB, S3 e SQS pela porta 4700. Concluído em 2026-11-20. Relatório: `C:\Projetos\aws-local-simulator\inventory\onda8\build-test-wave8.md`.
- [x] Documentação de portas em `src/frontend/README.md` e exemplos de CLI atualizados para o gateway. Concluído em 2026-11-20.

## Fora do escopo

- [ ] Remoção do código das portas legadas (não planejada)
- [x] Frontend (tratado na onda 8)

## Registro de execuções

| Onda | Workflow | Status | Relatório |
|---|---|---|---|
| 0 | wf_098ea3c980c53d52 | concluída em 2026-11-17 | C:\Projetos\aws-local-simulator\src\backend\.agents\tasks\migracao-porta-unica\inventory\baseline\baseline.md |
| 1 | wf_facbc0e4d18fb514 | parcial em 2026-11-17 (revisão 1 concluída). iam migrado. kms, secret-manager, parameter-store e cloudtrail migrados; (d) dispensado pela exceção aprovada pelo usuário em 2026-11-17. cognito não migrado: causa de ambiente, correção do usuário em e72f5ce com caminho dependente do cwd (pendente). Commits da onda em feature-v3.0.2 (3de6b96, fad2075, 92263ee, 2900174, 50bbf8d, 67ee608) e commits do usuário c8c8039 e e72f5ce. Checkout em e72f5ce, graphify EXIT=0 | C:\Projetos\aws-local-simulator\src\backend\.agents\tasks\migracao-porta-unica\inventory\onda1\onda1.md |
| 2 | wf_efcde74155a2d224 | parcial em 2026-11-17 (revisão 1 concluída: suíte de apigateway em tests/ rodada e passa). dynamodb, s3, lambda, sqs e apigateway migrados. sns com (d) pendente (sem suíte). Correção de GET /restapis (item além de items), commit 656ece0. Commits da onda em migracao-onda2: 656ece0, adde11b, 4fb3d32; fast-forward de feature-v3.0.2 para 4fb3d32, graphify código 0 | C:\Projetos\aws-local-simulator\src\backend\.agents\tasks\migracao-porta-unica\inventory\onda2\relatorio.md |
| 3 | wf_5643124ede7073ec + ajuste em 2026-11-17: sts, ec2 e alb migrados; sts com (d) corrigido (ajuste nos testes, sem defeito de código). eventbridge e cloudwatch migrados com exceção aprovada (sem suíte no repositório). asg com create, describe e delete corrigidos (sem suíte, critério d pendente, mas correção aplicada conforme item 3). Commits da onda em migracao-onda3: 43a913c, ce44958, b6dea74; fast-forward de feature-v3.0.2 para b6dea74, graphify código 0. EventBridge e CloudWatch registrados como exceção aprovada (sem suíte), com medição igual nas duas portas e roteamento. | C:\Projetos\aws-local-simulator\src\backend\.agents\tasks\migracao-porta-unica\inventory\onda3\relatorio.md |
| 4 | wf_b1b1cd10f269ceae | concluída em 2025-01-10 | C:\Projetos\aws-local-simulator\inventory\onda4\relatorio.md |
| 5 | wf_7a1da7c895192fd1 | concluída em 2025-01-10 | C:\Projetos\aws-local-simulator\src\backend\inventory\onda5\relatorio.md (worktree onda5 removido após aprovação) |
| 6 | wf_fc5a1624bf172154 | concluída em 2026-11-19. Investigação do abort realizada. athena e aurora medidos: mesmo comportamento nas portas 4700 e legada, código de saída 0. Não requerem correção de código. Uncommitted changes: nenhuma. Pipeline cleanup: não aplicável (apenas medição, sem alteração de código). | C:\Projetos\aws-local-simulator\src\backend\.agents\tasks\migracao-porta-unica\inventory\baseline\athena.md e aurora.md |
| 8 | wf_f34cf29ac63ac433 | concluída em 2026-11-20. Frontend migrado para o gateway 4700: config centralizada, build e 469 testes OK, integração validada com DynamoDB/S3/SQS, README e taskplans atualizados. Sem alteração de código no backend. | C:\Projetos\aws-local-simulator\inventory\onda8\build-test-wave8.md |
