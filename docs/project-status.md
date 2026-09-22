# HP Group Hub — Status do Projeto

Atualizado: 2026-09-22 (sessão 4) · Branch `feature/hp-group-hub` · [PR #1](https://github.com/Alexandrepavao/hugo-pavao-fisio-home/pull/1) em rascunho (sem merge na `main`)

> Todo o trabalho abaixo foi implementado e validado no ambiente **Dev** (banco + servidor local apontando para o Supabase Dev) e, nesta sessão, também por **16 testes E2E automatizados** (Playwright) cobrindo as jornadas críticas, incluindo a nova "Meu dia". O deploy publicado na Netlify **ainda não foi validado ao vivo** — está atrás da proteção de equipe da Netlify (ver bloqueio 1 abaixo), distinta do login do app. Produção (`HP Group Core`) segue vazia.

## Ambiente
| Recurso | Destino | Observação |
|---|---|---|
| Repositório | `Alexandrepavao/hugo-pavao-fisio-home` | branch `feature/hp-group-hub`, PR #1 em rascunho |
| Supabase Dev/Preview | `HP Group Dev` (`fsvtzowcwhvwtluwrhnb`) | migrations 001–019 aplicadas e testadas |
| Supabase Produção | `HP Group Core` (`wfqkjrpqkaarpavwagker`… `wfqkjrpqkaarpavjheoj`) | **vazio** |
| Netlify | site `hp-group-hub`, time "Hp Group" | preview publicado (commit mais recente), **protegido por SSO de equipe** (não confundir com `/login` do app) |
| Referências auditadas | `D:\Claude\hp-refs\*` (Brighter Core, Brighter Flow, Engage Nest, FocusSphere) | somente leitura; ver `docs/reference-audit.md` |

## O que mudou nesta sessão
- **Sistema visual HP** (`src/styles/app.css`, `src/components/hp/*`): sidebar azul institucional recolhível e persistida, drawer mobile, header compacto, busca Ctrl+K, tokens de cor/tipografia/espaçamento centralizados. Propagado a todas as telas do painel e dos portais.
- **CRM refeito**: colunas de largura fixa com rolagem restrita ao quadro, cards com hierarquia, menu de ações "⋯", arraste (`@dnd-kit`, com sobreposição de arraste e sensor de teclado) com atualização otimista e reversão em erro, painel lateral com abas.
- **Pessoas**: mesclagem com prévia de conflitos (bloqueios e avisos) e histórico preservado; importação CSV com validação, prévia de duplicidade e relatório final.
- **Academy**: módulos de aula, turmas (cohort) com concessão de acesso; portal do aluno com capa, "continuar de onde parou", comunidade em thread.
- **Produtividade pessoal — "Meu dia"** (migration 019, `src/pages/admin/Productivity.tsx`): tarefas pessoais com urgência/importância/categoria e visibilidade privada por padrão (opcionalmente "equipe"), sessão de foco (25/45/60min, uma ativa por vez), vínculo explícito a oportunidade/pessoa/atendimento já existente. `my_day()`/`team_day()` **combinam por leitura** tarefas pessoais + tarefas de CRM atribuídas + agenda clínica — nunca uma segunda fonte de compromissos. Inspirado no FocusSphere (ver `reference-audit.md`); diário emocional e prontuário de psicólogo ficaram explicitamente fora de escopo.
- **Correções de segurança do banco**: 10 funções (`dashboard_metrics`, `list_team` etc.) haviam nascido executáveis por `anon` apesar do `REVOKE` global da migration 010 — corrigido com guarda por *event trigger* (migration 015) que fecha automaticamente qualquer função nova.
- **Regra ESLint `no-unused-expressions` revisada**: estava totalmente desativada; agora ativa com `allowShortCircuit`/`allowTernary`, e as 35 ocorrências reais do idioma `cond ? erro() : (a(), b(), c())` (não coberto por essas opções) foram reescritas para `if/else` explícito em 10 arquivos — sem mudar lógica, só a forma da instrução.
- **Bugs encontrados pelos testes e corrigidos**: rastreio de visita não disparava (o builder do `supabase-js` não executa sem `.then`/`await`); após login a aluna caía em "Sem permissão" por corrida entre sessão e papéis carregando; funis abriam fora de ordem; `create_person` falhava com "violates row-level security" (RETURNING reavaliava a policy antes da linha existir) e não validava formato de contato; `["focus-open"]` do React Query retornava `undefined` em vez de `null` quando não havia sessão de foco ativa.

## Estado por módulo
| Módulo | Estado | Evidência |
|---|---|---|
| Fundação, bootstrap de gestores, autenticação | ✅ Dev | testes SQL 001–002; E2E `01-auth-and-routes` |
| HP Pages + formulários públicos | ✅ Dev | teste SQL 003 (30/30); E2E `02-checkup-journey` (jornada completa) |
| CRM | ✅ Dev | testes SQL 003/004; E2E (criação, kanban, mudança de etapa persistida) |
| Pessoas — mesclagem e importação | ✅ Dev | teste SQL 009 (novo, 21/21) |
| Agenda, pacotes, sessões | ✅ Dev | teste SQL 004 (26/26); **concorrência real** validada por 6 requisições HTTP simultâneas (E2E `04-agenda-concurrency`) |
| Financeiro | 🟡 | teste SQL 005 (33/33); telas de conciliação e regras de comissão ainda pendentes |
| Academy + Acompanhamento | ✅ Dev | teste SQL 006 (42/42); E2E `03-academy-and-isolation` (aulas, progresso, certificado, comunidade, revogação imediata) |
| Parceiros | 🟡 | teste SQL 007 (16/16, **reexecutado por inteiro** após a correção de segurança) |
| Dashboard | ✅ Dev | teste SQL 008 (12/12) |
| E-mail (Resend + SMTP Auth) | 🔒 | função pronta, não validada — bloqueio externo (ver `integrations.md`) |
| Deploy publicado na Netlify | 🔒 | preview atualizado, mas atrás da proteção de equipe — **ação sua necessária** (ver abaixo) |
| Produtividade/foco ("Meu dia", inspirado no FocusSphere) | ✅ Dev | teste SQL 010 (novo, 13/13); E2E `05-productivity` (criar→focar→concluir na interface, isolamento entre colegas pela API, bloqueio de anônimo) |
| Conciliação bancária, regras de comissão (tela), pesquisas, contas corporativas, retentativa de eventos, metadados sociais | ⬜ | ainda não implementados nesta sessão |

## Testes desta sessão
**Banco (SQL, Dev, transação desfeita):** 007 reexecutado por inteiro (16/16) após a correção de segurança; 009 (21/21) — mesclagem e importação; 010 novo — produtividade/foco (13/13, isolamento privado×equipe, alternância silenciosa em tarefa alheia, sessão única de foco).
**E2E (Playwright, Edge do sistema, contra o Supabase Dev real — não simulado):** `npm run test:e2e` com `HP_QA_PASSWORD` — **16/16 passando**, ~1min. Cobre tudo da sessão anterior mais a jornada "Meu dia": criar tarefa pela interface → iniciar/encerrar sessão de foco (cronômetro ao vivo) → concluir e persistir após recarregar, sem nenhum erro de console (a regressão original — `["focus-open"]` retornando `undefined` — era exatamente esse tipo de erro, invisível a um teste SQL puro); isolamento: pessoa não-staff não lê nem altera tarefa alheia pela API direta; visitante anônimo bloqueado.
**Front:** `tsc`, `eslint` (0 erros — regra `no-unused-expressions` revista e reativada, não mais desligada por completo), `vite build`, `vitest` (15/15, incluindo o novo parser CSV).
**Visual:** "Meu dia" capturado em 1440/1024/768/390 nesta sessão; sem *overflow* horizontal do documento em nenhuma largura.

## Bloqueios que dependem de você
1. **Proteção de equipe da Netlify** (não é o login do app): abri `https://hp-group-hub.netlify.app` no navegador embutido — entre com sua conta Netlify do time "Hp Group" quando eu pedir para retomar a validação do deploy publicado.
2. **Resend + SMTP do Supabase Auth**: conta, domínio verificado do HP Group, `RESEND_API_KEY`/`EMAIL_FROM` — sem isso não valido o fluxo real de e-mail (passo a passo em `docs/integrations.md`).
3. **Go-live**: destino de hospedagem definitivo e aplicação das migrations em produção — decisão sua, nada foi feito na `HP Group Core`.

## Próximo passo exato
1. Você conclui o login no navegador embutido → eu valido o deploy publicado (rotas diretas, login, formulários, CRM, Academy, Productivity, Functions, ausência de referência a produção).
2. Telas de conciliação bancária e regras de comissão (Financeiro); telas de pesquisas e contas corporativas (Parceiros); agendador de retentativa de eventos; metadados de pré-visualização social verificados de fato — bancos já prontos e testados desde a sessão anterior, telas ainda pendentes.
3. Configurar Resend/SMTP quando você tiver as credenciais; então testar recuperação de senha e primeiro acesso reais.
