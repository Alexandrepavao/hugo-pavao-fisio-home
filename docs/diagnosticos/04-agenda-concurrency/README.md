# Diagnóstico: `57014` (statement timeout) em `e2e/04-agenda-concurrency.spec.ts`

> 2026-10-01 · Dev apenas · o timeout **não foi aumentado** (continua 8 s para `authenticated`/`authenticator`) · correção: migration `20260930000067_book_appointment_serialize.sql`.

## Conclusão
- **Origem: bloqueio no banco (deadlock), provocado pela implementação de `book_appointment`** — não é o ambiente nem o valor do timeout. O `57014` é só a consequência: o limite de 8 s corta uma espera que o próprio banco não consegue resolver.
- **Mecanismo:** `book_appointment` não serializa reservas do mesmo profissional; ela só confia nas duas *exclusion constraints* GiST de `appointments` (pessoa + período e profissional + período). Quando duas ou mais requisições chegam ao
  Postgres no mesmo instante, cada `INSERT` grava a sua tupla e só depois confere a constraint; cada uma enxerga a tupla **ainda não confirmada** da outra e espera o `xid` dela — um ciclo. O Postgres detecta o deadlock (`deadlock_timeout` = 1 s) e
  aborta uma sessão com `40P01`. O PostgREST **reexecuta** a transação quando recebe `40P01`/`40001` ([comportamento documentado pela Supabase](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b.md)),
  então as sessões entram de novo na mesma corrida, formam outro ciclo, e assim por diante até o `statement_timeout`. Por isso uma única chamada pode demorar 44–125 s e voltar como `57014` (ou `504` do gateway).
- **Por que é intermitente:** o ciclo só nasce quando duas requisições passam pela janela “tupla inserida, constraint ainda não conferida” ao mesmo tempo. Em condições normais a primeira termina antes da segunda chegar; com o ambiente
  mais carregado a janela fica maior (2 ocorrências em 70 iterações ≈ 3%; no teste real, 1 em cada ~3 execuções do conjunto completo).

## Evidências (artefatos preservados nesta pasta)
| Arquivo | O que mostra |
|---|---|
| `execucao-1.json` | 30 iterações × 6 requisições simultâneas pelo mesmo horário (o mesmo cenário do teste). **1 iteração travou**: três respostas `57014` (44, 112 e 113 s), uma vencedora e duas `P0409` só aos 117 s. 70 amostras de `pg_stat_activity` mostram as 6 sessões em `Lock/transactionid`, a cada ~1 s com `xid` novo (transações sendo reexecutadas). |
| `execucao-2.json` | 40 iterações, agora com `pg_blocking_pids` e contadores. **1 iteração travou** (`504` ×5 e `57014`, 125 s, ninguém venceu). `pg_stat_database.deadlocks` subiu **+154** nessa execução, todos na iteração travada; o grafo de bloqueio fecha ciclo (ex.: `1100915 ← 1100918 ← 1100915`) e os mesmos processos aparecem com `xid` renovado. |
| `deadlock-direto-banco.json` | **Prova sem PostgREST e sem `book_appointment`:** 6 sessões inserindo o mesmo profissional/período por 20 s, tentativas desfeitas. Variante *livre* (como hoje): **27 deadlocks `40P01` em 33 tentativas**, tentativa mais longa 7,0 s. Variante com `pg_advisory_xact_lock` por profissional: **0 deadlocks em 970 tentativas**, mais longa 173 ms. |
| `execucao-3-com-lock.json` | Depois da migration 067: **100 iterações × 6 requisições, 0 resultados inesperados, 0 deadlocks**, pior requisição 214 ms. O teste real `04-agenda-concurrency` repetido 10 vezes: 10/10 (0,8–4,1 s). |

Ferramentas (versionadas): `e2e/tools/diag-concorrencia-agenda.mjs` (repete o cenário e amostra o banco) e `e2e/tools/diag-deadlock-exclusao.mjs` (reprodução direta no banco). Ambas só rodam contra o Dev e removem os dados que criam.
Como reexecutar: `SUPABASE_ACCESS_TOKEN=… HP_QA_PASSWORD=… node e2e/tools/diag-concorrencia-agenda.mjs 40 saida.json 6`.

## O que foi descartado
- **Valor do timeout:** 8 s é o limite de `authenticated`/`authenticator` (e `lock_timeout` 8 s no `authenticator`); aumentar só prolongaria o laço. Não foi alterado.
- **Quiz/limitador, conexões (`max_connections` 60), triggers de Google Calendar/auditoria:** nenhuma sessão ficou parada neles; todas as esperas eram `Lock/transactionid` entre as próprias reservas.
- **Ambiente puro:** com a reprodução direta no banco, a falha acontece sem rede, gateway ou navegador; e some com a serialização.

## Correção (migration 067) e seu efeito
`book_appointment` agora pega `pg_advisory_xact_lock` do profissional e depois da pessoa (ordem fixa, para não criar ciclo entre os próprios locks) imediatamente antes do `INSERT`. Quem perde a corrida espera a transação do vencedor
terminar (milissegundos) e recebe `P0409` na hora. Nada mais mudou: assinatura, permissões, mensagens e validações são as da migration 055; só reservas do **mesmo** profissional/pessoa se serializam.

## O que continua sem diagnóstico
- **Qual camada reexecuta** (PostgREST ou o gateway) não foi isolada: a documentação da Supabase descreve a reexecução do PostgREST em `40P01`, e os dados (mesmos processos, `xid` novo a cada ~1 s, 154 deadlocks para 6 requisições) são coerentes com isso, mas não li a versão do PostgREST do projeto.
- **Logs do Postgres:** a API de logs da Supabase não respondeu de forma utilizável, então não tenho a linha `DETAIL` do deadlock; a prova é `pg_stat_database.deadlocks` + `pg_blocking_pids` + a reprodução direta.
- A falha da bateria longa em `07`/`08` (documentada em `docs/project-status.md`) **não** foi relacionada a este achado: eram telas sem reserva simultânea.
