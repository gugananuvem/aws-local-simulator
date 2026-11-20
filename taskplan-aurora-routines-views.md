# Taskplan — Procedures, Functions e Views no Aurora

**Data:** 2026-11-20  
**Repositório:** `src/backend`  
**Status:** concluído

## Fase 1 — Fundação: parser + catálogo

- [x] Criar `routines/sql-bindings.js` com `bindNamedValues`, `splitTopLevel` e `normalizeType`.
- [x] Criar `routines/routine-parser.js` com tokenizer próprio e parser de `CREATE`, `DROP`, `CALL` e corpo procedural.
- [x] Criar `routines/routine-store.js` com `__aurora_routines` e `__aurora_session_vars`.
- [x] Persistir definição normalizada, SQL original, engine, `created_at` e `updated_at`.
- [x] Spike de UDF no `better-sqlite3`: `db.function(name, null)` **não remove**; a solução foi substituir a UDF por uma função que falha e manter as definições em memória.

## Fase 2 — Executor

- [x] Implementar ambiente com `params`, `vars` e variáveis de sessão.
- [x] Implementar `DECLARE`, `SET`/`:=`, `IF/THEN/ELSEIF/ELSE`, `WHILE ... DO/END WHILE`, `LOOP`, `REPEAT ... UNTIL`, `LEAVE`, `ITERATE`.
- [x] Implementar `SELECT ... INTO`, DML/SELECT com binds, `CALL` aninhado, `RETURN`, `SIGNAL`/`RAISE`.
- [x] Aplicar limites `MAX_ITERATIONS`, `MAX_STATEMENTS` e `MAX_CALL_DEPTH`.
- [x] Registrar functions como UDF por database e em conexões reabertas.
- [x] Isoleamento da execução da UDF em conexão separada para o mesmo `.db`.

## Fase 3 — Integração com Data API

- [x] Classificar rotinas antes da tradução SQL em `RoutineService.classify`.
- [x] Interceptar `CREATE`, `DROP`, `CALL`, `SHOW ... STATUS` e `SELECT @var` em `executeStatement`.
- [x] Reutilizar `bindParameters` da Data API para `CALL` com parâmetros tipados.
- [x] Responder `ExecuteStatement` com `records`/`columnMetadata` via `formatExecutionResult`.
- [x] Suportar `BatchExecuteStatement` com `CALL` por parameter set.
- [x] Usar a conexão da transação quando `transactionId` é informado.

## Fase 4 — Views

- [x] Traduzir `CREATE OR REPLACE VIEW` e `ALTER VIEW` para recreate no `SqlTranslator`.
- [x] Manter `DROP VIEW` nativo.
- [x] Expor `RoutineService.listViews()` com `name` e `sql`.
- [x] Garantir browse read-only no frontend (entrega da Fase 6).

## Fase 5 — API administrativa

- [x] `GET /__admin/routines`
- [x] `GET /__admin/routines/:kind/:name`
- [x] `DELETE /__admin/routines/:kind/:name`
- [x] `GET /__admin/views`
- [x] Validação de `database` e `kind`, com respostas `400/404/503` apropriadas.

## Fase 6 — Frontend (entregue em paralelo)

- [x] `use-aurora-routines.js`
- [x] Filtro `__aurora_%` em `use-aurora-databases.js`
- [x] Grupos Procedures/Functions e ações no `database-browser.jsx`
- [x] Templates por dialeto do cluster
- [x] Browse read-only de views
- [x] Keywords e assinaturas no autocomplete

## Fase 7 — Testes, docs e validação

- [x] `routines/routines.test.js` — parser, catálogo, executor e Data API.
- [x] `routines/admin-endpoints.test.js` — endpoints administrativos.
- [x] Testes frontend de autocomplete e filtro de schema.
- [x] `npx jest src/services/aurora/routines --forceExit` — 15 testes aprovados.
- [x] `npx eslint src/services/aurora --ext .js` — 0 erros.
- [x] `npm run lint` / `npm test` / `npm run build` no frontend.
- [x] Documentação: PRD, taskplan, relatório e README.
- [x] Atualização dos grafos Graphify.
- [ ] Push/merge — **não executado, aguardando confirmação**.
