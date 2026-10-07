# HP Group Hub — Transferência para outra conta ou organização do Claude Code

> Gerado em **2026-10-01** (fuso de Brasília, BRT = UTC−3) a partir das **conversas salvas nesta máquina**, das memórias do Claude Code, do histórico Git/GitHub e dos documentos do repositório. Nada aqui contém senha, token, chave ou `.env`.
> Resumo: o HP Group Hub foi construído em `D:\Claude\hugo-pavao-fisio-home` por esta conta desde **2026-09-21**; o último estado confirmado é a branch **`release/v1`** (PR **#3**, rascunho), commit **`ce5d4d7`**, **tudo commitado e enviado** e preview publicado (seção 5). A rodada de 01/10 (tarde) concluiu a auditoria e as lacunas das jornadas Fisioterapeuta, Paciente e CRM; o que resta está na seção 7.

## 1. Evidências e limites do histórico

**Fontes usadas** (todas locais): transcrições `*.jsonl` em `%USERPROFILE%\.claude\projects\` (pastas `D--Claude-Code` e `D--Claude-hugo-pavao-fisio-home`), memórias em `…\D--Claude-hugo-pavao-fisio-home\memory\`, `git log --all`, `gh pr list/view`, consulta de leitura ao registro de migrations do **Dev**, e os documentos do repositório.

**Como a conta foi identificada.** O Claude Code anexa o e-mail da conta ativa a cada sessão; ele está gravado nas transcrições. Com isso:

| Período (UTC → BRT) | Conta (e-mail anexado pelo Claude Code) | Onde está a evidência |
|---|---|---|
| 2026-09-21 21:32Z (18:32 BRT) até 2026-09-23 14:40Z (11:40 BRT) | `jan.darioush@gmail.com` | conversa `1d25674c…` (pasta `D--Claude-Code`), 1ª mensagem do projeto |
| 2026-09-23 14:40Z → 23:29Z (11:40–20:29 BRT) | `contato@hpfisioterapia.com.br` | mesma conversa (quizzes, redesign “Mosaic”, início do app CRM) |
| 2026-09-23 23:29Z (20:29 BRT) até 2026-10-01 16:15Z | `jan.darioush@gmail.com` | conversas `1d25674c…`, `bed3789a…`, `80a3644b…` |
| 2026-10-01 16:15Z → 18:08Z (13:15–15:08 BRT) | `contato@hpfisioterapia.com.br` | `80a3644b…`, após um `/login`; nesse intervalo só houve “Continua” e uma interrupção, sem trabalho |
| 2026-10-01 18:08Z em diante | `jan.darioush@gmail.com` | `80a3644b…`; houve mais dois `/login` (19:56Z e 19:59Z, um deles “interrompido”): **a conta ativa depois disso não foi confirmada** |

**Limitações (não inventar):**
- A transcrição **não grava a organização nem o plano** da conta; só o e-mail. Não é possível provar de qual *organização* veio cada sessão.
- Não há como saber se existiu trabalho **neste repositório** em outra máquina ou antes de 2026-09-21 20:47 por outra conta: as transcrições locais só começam em 2026-09-21 21:32Z e o primeiro commit de autoria `jandaarioush` é de 2026-09-21 19:02 BRT. **A data do primeiro commit não é usada como prova de início nesta conta**; a prova é a transcrição.
- O repositório é anterior ao trabalho (64 commits de 2025-08-19 a 2026-09-02, ver 2). O dono do repositório no GitHub é `Alexandrepavao`; a conta `gh` autenticada nesta máquina é `jandaarioush`.
- As conversas de outros projetos (Brighter, Lumina, Focus…) na mesma pasta `projects` **não** foram lidas além de confirmar que não tratam do HP Group Hub.
- O arquivo `1d25674c…` foi lido por inteiro só nas mensagens do usuário (pedidos e decisões); o conteúdo técnico detalhado está nos commits e nos documentos.

## 2. Estado do projeto quando o trabalho começou (2026-09-21)
- Repositório `Alexandrepavao/hugo-pavao-fisio-home`: **site institucional** Vite + React + TypeScript + Tailwind/shadcn (21 arquivos versionados), criado na plataforma Lovable (`gpt-engineer-app[bot]`, 59 commits desde 2025-08-19) e ajustado por `Alexandrepavao` (5 commits; o último, em 2026-09-02, adiciona o deploy no **GitHub Pages** com `CNAME` `hpfisioterapia.com.br`).
- **Sem** banco, autenticação, painel, CRM, agenda, financeiro, testes ou Netlify/Supabase vinculados.
- Não havia `CLAUDE.md` nem `AGENTS.md` (o `CLAUDE.md` citado em prompts antigos nunca existiu até esta transferência).
- Pedido inaugural (2026-09-21 18:32 BRT): “Você será o responsável técnico por construir o HP Group Hub…” — plataforma única com site institucional, HP Pages (landing pages), HP Core (pessoas), CRM, agenda, financeiro, área do paciente, Academy, portal de parceiros e painel do gestor; infraestrutura GitHub + Supabase + Netlify + Claude Code; ambientes dev/preview/produção explícitos; **nunca alterar projetos da Brighter, nunca instalar em C:, nunca DNS/produção sem autorização**.

## 3. Cronologia do trabalho desta conta
Horários em BRT. “PR” = GitHub `Alexandrepavao/hugo-pavao-fisio-home`.

**Fase A — fundação e módulos (21–22/09).** Branch `feature/hp-group-hub`, PR **#1** (aberto 21/09 20:23). Commits `f983290` (21/09 19:02) … `75dc083` (22/09 17:30): autenticação, RLS, pessoas, bootstrap restrito de gestores, catálogo, CRM, eventos, HP Pages e formulários públicos, agenda, vendas/financeiro, Academy, acompanhamento, parceiros, dashboard, portais, shell administrativo, mesclagem/importação de pessoas, produtividade (“Meu dia”), MRR/ARR/DRE/conciliação, trilhas do Academy, Pesquisas, Contas corporativas, retentativa de eventos, metadados sociais. Migrations **001–037** (Dev). Conferência final de prontidão (`docs/release-readiness.md`) em 22/09 17:30.
**Fase B — e-mail e produção (22–23/09).** Resend como único provedor, hook de e-mail de autenticação como Edge Function do Supabase, correção do “esqueci minha senha” e investigação do limite 429 (commits 22/09 20:57–23:11). **Cutover de produção executado** (autorizado em 22/09 23:21): migrations **001→037** aplicadas em `HP Group Core` (`wfqkjrpqkaarpavjheoj`, sem dados reais), site Netlify `hp-group-hub-producao` criado, auto-deploy do GitHub Pages desativado, PR **#1 mesclado em `main`** (23/09 00:12). **DNS não foi alterado** (`hpfisioterapia.com.br` continua no GitHub Pages; nameservers em `dns-parking.com`). `docs/go-live-plan.md` e `docs/deployment.md`.
**Fase C — quizzes, redesign e CRM (23–24/09).** Branch `feature/lead-quizzes`, PR **#2** (rascunho, 23/09 12:32): quizzes de captação (atendimento/parceria), CTA com destino, redesign “Mosaic” (filtros compactos, cards clicáveis, Configurações), app HP CRM com sidebar própria (24/09 11:36). Migrations 038–044. Pedido de 24/09 16:11: ampliar com Administrativo (ADM), Contábil, Marketing, Jurídico e RH.
**Fase D — ADM e Contábil (29/09).** Commits `ec70712`/`2896f61` (ADM, planilha PF/PJ — migrations 045–046), depois `a840917`, `004db03`, `93ac116`, `8a6e93d` (22:13): Contábil (papel `accountant`, competências, documentos, fechamento — migrations 048–051, **só no Dev e em `feature/lead-quizzes`**), importação CSV de PJ e colunas por usuário (047). **Primeira conversa gravada na pasta do repositório** (`bed3789a…`, 29/09 20:57).
**Fase E — mudança de prioridade: release v1 (29/09 22:15 → 30/09).** Usuário pausou Contábil/Marketing/Jurídico/RH/white label; branch **`release/v1`** (PR **#3**, rascunho, aberto 29/09 23:32), sem Contábil. Jornada de aceite R01, permissões R02, portais R03, salvaguarda de ambiente no build, selo “AMBIENTE DE TESTE”. Em 30/09: confirmação independente de paciente/profissional, falta do profissional, consumo de sessão (054); cancelamento pelo paciente e horário passado (055); preview no site Dev `hp-group-hub`; escopo ampliado — indicadores (056), financeiro por linha de negócio (057, 060), jornada do paciente e Bunny (058), calendários (059), `google-calendar` com `state` de uso único (061), central de pendências administrativas (062), Google Calendar como única integração com sincronização automática (063), mapa do Brasil (064).
**Fase F — nova interface (30/09 noite → 01/10).** `a0b7d73`, `ab156cd`: header em largura total, filtro único, cartões em níveis, mapa, sidebar contextual; depois `e5e46f4`/`734dec5`: **8 aplicativos** com sidebar exclusiva e app ativo pela URL, linha de negócio no filtro, **Cartões corporativos** (065), Calendário (Dia/Semana/Mês, só Google). `1b858fc`: diagnóstico da falha do teste 07 (causa não determinada).
**Fase G — rodadas de 01/10.** `030753d` (12:34): filtro único nos 6 módulos restantes, **edição de cartão** (066), diagnóstico e correção do `57014` da agenda (067, deadlock — `docs/diagnosticos/04-agenda-concurrency/`). Preview republicado (deploy `6abe7e58d75717d063c8cc93`). **Fase H — jornadas (01/10, tarde):** commits `98c22cb` e `ce5d4d7`: Hub sem “Seus aplicativos”; jornadas Fisioterapeuta, Paciente e CRM auditadas e concluídas (migrations 068–074, S15–S17, R15–R18, `docs/jornadas-fisioterapeuta-paciente-crm.md`), correção de segurança das listas do CRM (074); preview republicado (deploy `6abed1f6a20ecff377beff7e`).

### Pedidos, decisões e mudanças de escopo (ordem cronológica)
1. 21/09 — escopo geral do ecossistema; regras de ouro: só em `D:`, nada da Brighter, sem DNS/produção sem apresentar impacto, segredos nunca no chat.
2. 21–22/09 — gestores de bootstrap: `contato@hpfisioterapia.com.br` e `jan.darioush@yahoo.com.br`; sidebar aprovada pelo usuário (preservar visual).
3. 22–23/09 — Resend único provedor (`HP Group <contato@hpfisioterapia.com.br>`); autorizada a entrada em produção (banco, deploy, merge); **DNS ficou fora**.
4. 23/09 — quizzes de captação, redesign Mosaic, app CRM com sidebar exclusiva; PR #2 em rascunho.
5. 24/09 — ampliar para ADM/Contábil/Marketing/Jurídico/RH (só ADM e Contábil foram feitos).
6. 29/09 — **mudança de prioridade**: pausar expansão; entregar a primeira versão operacional (release v1) sem Contábil; PR #3 em rascunho.
7. 30/09 — autorizados: confirmação paciente/profissional, cancelamento pelo paciente, bloqueio de reagendamento ao passado, commit/push em `release/v1`, preview Dev; **sem merge, produção ou DNS**. Escopo ampliado “não pedir nova aprovação”: indicadores, financeiro por linha, jornada do paciente (vídeos Bunny privados por decisão), calendários.
8. 30/09 — Google Calendar **única** integração de calendário (removidos iPhone/Apple/`.ics`); credenciais configuradas no Dev pelo usuário.
9. 30/09–01/10 — redesign: “a mudança visual foi superficial” → reformulação real; depois 8 aplicativos contextuais, Cartões corporativos, calendário; filtro único em todos os módulos; edição de cartão; investigação do `57014` (“não aumentar o timeout apenas para fazer passar”).
10. 01/10 — remover o bloco “Seus aplicativos” do dashboard do Hub; auditar e concluir as jornadas **Fisioterapeuta**, **Paciente** e **CRM** (última tarefa autorizada, seção 7).

## 4. O que já existia × o que esta conta produziu
- **Antes (não é trabalho desta conta):** site institucional Lovable/GitHub Pages (64 commits até 2026-09-02).
- **Desta conta (78 commits de `jandaarioush`, 21/09–01/10):** todo o HP Group Hub: migrations numeradas até 069 (as 068–069 ainda não versionadas), 3 Edge Functions do Supabase (`auth-email-hook`, `bunny-playback`, `google-calendar`) e 1 função Netlify (`send-email`), documentação em `docs/`, suítes SQL (S01–S17) e E2E (R01–R14, N10–N11, 01–09), 3 PRs, ambientes Dev/produção/preview.
- **Da conta `contato@…` no intervalo 23/09 11:40–20:29 BRT:** os commits de quizzes, redesign Mosaic e início do app CRM caem nessa janela; não há como separar “contas” por commit (o autor Git é sempre `jandaarioush`).

## 5. Estado real conferido em 2026-10-01 (evidências)

> **Atenção:** 5.1–5.7 são o retrato de 01/10 (até `ce5d4d7`). O estado atual, reconciliado em 02/10 e reconferido em 06/10, está em **5.8** e prevalece onde diferir.

### 5.8 Reconciliação entre sessões (02/10, reconferida em 06/10) — estado atual
| Item | Valor (conferido nos arquivos, no Git e no Dev) |
|---|---|
| HEAD | `bee5317` em `release/v1`; `origin/release/v1` = HEAD (0 à frente/atrás); working tree limpo (só `.claude/`, não versionado); sem stash; worktree extra `D:/Claude/hp-before` (HEAD solto `819bca5`, de 21/09, sem processo ligado) |
| Commits depois de `ce5d4d7` | Conversas (`d73e938`, `a50a8bf`) · Repasses (`2bd5060`) · venda/oportunidade idempotentes (`8f98d59`, `5ff8a60`) · Academy (`ca2efdc`) · Parceiros (`5346ad3`) · correção do seletor do `R04` + capturas (`a5376dc`) · reconciliação e matriz (`bee5317`) |
| Por que a rodada anterior ficou incompleta | a sessão anterior chegou ao **limite de uso** (mensagem “session limit” no fim da transcrição local `4fb2b85e…`, 02/10 00:24Z), no meio de commits já feitos mas **sem push, sem docs e sem relatório final**; não houve erro, perda de dados nem commit quebrado |
| Último prompt de integração | “Retome o HP Group Hub e conclua a integração operacional dos aplicativos…” (transcrição local `4fb2b85e…`, 01/10 23:30Z, `release/v1`). Foi **implementado e commitado** o que está acima; o que **só estava planejado** era a matriz `docs/integracao-ponta-a-ponta.md` (referenciada pelo `release-v1.md`, nunca criada) — **agora criada** |
| Correção do “último estado conhecido” | Repasses **não** está pendente (commitado, `docs/repasses.md`); as migrations 075/076 **estão** no repositório e idênticas ao Dev; Conversas = 077, idempotência = 078, Academy = 079, repasse a parceiro = 080 |
| Dev `fsvtzowcwhvwtluwrhnb` | última migration **`20260930000080`**; repositório e Dev batem (048–051 só no Dev, por desenho) |
| Contas/sessões | a identificação da conta de cada sessão **não está disponível com evidência**; trabalho de duas contas no mesmo clone já foi preservado (nada foi descartado). A transcrição desta rodada fica em outra pasta de projeto do Claude Code (`D--Claude-Code`) |
| Testes executados nesta rodada (contra o Dev) | SQL `test:sql:release` **S01–S21 = 1056/1056**; `S18` 30/30 e E2E `R20` 8/8 isolados (caso de valor positivo pela interface do profissional e do Financeiro); E2E `@release` completo com **1 worker = 174/174** (a 1ª tentativa com 2 workers deu falhas de concorrência em R09/R11/R12/R20 e **não vale**: contraria a regra de 1 worker; uma falha única `500` em `adm_central` não reproduziu — chamada direta 200 e `R11` isolado 9/9; tratada como transitória, **sem prova de causa**) |
| Matriz das 9 jornadas | [`docs/integracao-ponta-a-ponta.md`](integracao-ponta-a-ponta.md): 7 validadas ponta a ponta; **vídeo Bunny** e **Google Calendar** bloqueados por configuração/autorização externa |
| Publicado | **Nada novo publicado.** O preview `release-v1` continua o de `ce5d4d7`; publicar `bee5317` exige `netlify login` (a CLI não tem sessão nem `NETLIFY_AUTH_TOKEN`; o conector MCP não aceita `--context/--alias`, por isso não foi usado) |

### 5.1 Git, remoto e PR (conferido ao final da rodada de 01/10)
| Item | Valor |
|---|---|
| Pasta | `D:\Claude\hugo-pavao-fisio-home` |
| Branch atual / remoto | `release/v1` → `origin` = `https://github.com/Alexandrepavao/hugo-pavao-fisio-home.git` |
| HEAD | `ce5d4d7` (“R17: BOM como escape no teste (lint)”), logo após `98c22cb` (jornadas) e `030753d` (rodada anterior); `origin/release/v1` = HEAD |
| PR **#3** | `release/v1 → main`, **ABERTO, RASCUNHO**, mesclável; corpo atualizado |
| PR #2 | `feature/lead-quizzes → main`, aberto, rascunho (Contábil + redesign antigo) |
| PR #1 | `feature/hp-group-hub → main`, **mesclado** em 23/09 — **não voltar a essa branch** |
| `main` | `64add39`; `release/v1` está bem à frente |

### 5.2 Trabalho local
Nada pendente de envio, exceto o arquivo não versionado `.claude/launch.json` (configuração local do servidor de desenvolvimento, sem segredos). Os arquivos da rodada anterior (migrations 068–069, telas, S15–S17) foram **commitados** em `98c22cb`. `git stash list` vazio.

### 5.3 Funcionalidades
**Concluídas, comprovadas por teste e enviadas:** tudo o que consta em `docs/project-status.md` até a 12ª rodada **mais** a 13ª: Hub sem “Seus aplicativos”; jornada do **fisioterapeuta** (cadastro com pessoa do cadastro central, registro, unidades, disponibilidade, liberação de acesso, Meu resumo, repasses reais, isolamento); jornada do **paciente** (vínculo ao paciente certo, portal, confirmação/cancelamento, sessões separadas, plano definido pelo profissional, renovação só com orientação, vídeo, isolamento, celular); jornada do **CRM** (importação CSV com prévia/conflitos/idempotência, listas, oportunidades, tarefas, metas, KPIs por recálculo independente). Detalhe item a item: [`docs/jornadas-fisioterapeuta-paciente-crm.md`](jornadas-fisioterapeuta-paciente-crm.md).
**Correção de segurança desta rodada:** listas do CRM estavam abertas a paciente, parceiro e fisioterapeuta pela API → migration 074.
**Parciais / limites conhecidos:** repasses do profissional provados em SQL e, na tela, só no estado “indisponível”; histórico do portal mostra os 100 atendimentos mais recentes; importação CSV limitada a 500 linhas/1 MB (origem/campanha de pessoa existente não são alteradas); registro profissional é texto livre.
**Pendentes (precisam de você ou de configuração externa):** ver 5.7 e a seção 7.

### 5.4 Testes (resultado ao final da rodada, contra o Dev)
| Suíte | Resultado |
|---|---|
| SQL `supabase/tests/release/S01–S17` | todos OK (S01 16, S02 32, S03 56, S04 47, S05 82, S06 44, S07 63, S08 39, S09 61, S10 127, S11 19, S12 26, S13 80, S14 43, S15 78, S16 55, S17 22) |
| E2E novos desta rodada | R15 (fisioterapeuta) 10/10 · R16 (paciente) 10/10 · R17 (importação CSV) 9/9 · R18 (CRM: listas, oportunidade, tarefas, metas, permissões) 7/7 |
| E2E regressão | R01–R14, N10–N11 e gerais 01–09 (inclui `04-agenda-concurrency`): verdes em grupos pequenos; R13 adaptado ao Hub sem lançador; R02/R07/R12/R17 reexecutados depois da migration 074 |
| `tsc` / `vite build` | limpos |
| `eslint` dos arquivos novos | limpo (restam os 23 erros antigos em arquivos não tocados: funções do Supabase e `R06`) |
| `vitest` | 1 suíte antiga falha (`supabase/tests/functions/google-sync-plan.test.mjs` chama `process.exit`; pré-existente) |
| Capturas | `docs/screenshots/jornadas/` (Hub, profissionais, disponibilidade, 4 passos da importação CSV, Meu resumo, portal do paciente; 1440 e 390 px; sem rolagem lateral nem erros de console) |
**Falhas sem causa determinada (antigas, não reapareceram):** `07`/`08` na bateria longa de 01/10 01:32–01:37; um `fill` de 150 s no R04. Não classificar como “instabilidade” sem prova.
**Falhas desta rodada, todas com causa conhecida e corrigida:** `S07` instável por empate de `decided_at` (073); “Agendados” sem futuras (071); convite para conta confirmada sem papel (072); listas do CRM abertas (074); seletores de teste ajustados (sem enfraquecer verificações).
Máquina com pouca memória: rodar E2E em grupos pequenos, 1 worker; não reiniciar servidores em segundo plano sozinho.

### 5.5 Migrations: escritas × aplicadas
| Ambiente | Situação |
|---|---|
| **Repositório** | 70 arquivos versionados em `release/v1` (001–047 e 052–074); 048–051 (Contábil) só em `feature/lead-quizzes` |
| **Dev** `fsvtzowcwhvwtluwrhnb` | **75 registros** (verificado em 01/10), última `20260930000074`; 068–074 aplicadas pela Management API **antes** de serem versionadas. As 001–046 estão registradas com carimbos de data diferentes dos nomes dos arquivos (aplicadas por ferramenta): compare por **número/nome** |
| **Produção** `HP Group Core` `wfqkjrpqkaarpavjheoj` | pelos documentos: **37 migrations** (001–037), sem dados reais; **nada além disso** (não consultada nesta rodada) |
| A aplicar em produção (quando autorizado) | 038→047 e 052→074 = **33 migrations**; `list_migrations` final esperado = **70**. Nunca aplicar 048–051. `docs/release-v1.md` §4 já está atualizado |

### 5.6 Preview mais recente
- Site Netlify **`hp-group-hub`** (id `2c2d11bc-f62c-42b7-bae6-4cf3b6f35756`), rascunho de branch `release-v1`: https://release-v1--hp-group-hub.netlify.app (protegido por login do time Netlify: 401 sem sessão).
- Deploy `6abed1f6a20ecff377beff7e`, commit **`ce5d4d7448ad`**, `version.json`: perfil `v1`, ambiente `preview`, backend `Dev` (`fsvtzowcwhvwtluwrhnb`). Contém todo o trabalho desta rodada.
- A URL exige login de equipe: as telas do preview foram validadas servindo o **mesmo `dist`** localmente contra o Dev (E2E e capturas), não pelo endereço publicado.
- Produção (`hp-group-hub-producao`, domínio, DNS) intactos.

### 5.7 Dependências externas e configurações pendentes (separadas do que foi comprovado)
| Item | Estado |
|---|---|
| **Resend / entrega de e-mail** | hook do Supabase Auth e Edge Function implementados no Dev; envio real validado só para `jan.darioush@yahoo.com.br`. Os E2E provam o **registro** do convite, a conta (criada já confirmada no Auth do Dev) e a tela de nova senha — **não** a chegada do e-mail. **Produção:** `RESEND_API_KEY`, domínio (DKIM/SPF), Site URL/Redirect URLs e limite de e-mail pendentes |
| **Bunny (vídeos)** | atribuição, revogação, validade, log, isolamento e função `bunny-playback` prontos; **segredo `BUNNY_EMBED_TOKEN_KEY` e ID da biblioteca não cadastrados** → reprodução real **não testada** (tela: “indisponível por configuração”) |
| **Google Calendar** | Dev configurado (OAuth, segredos, Vault, sincronização automática); teste real de autorização depende de conta Google de teste. **Produção:** repetir segredos e callback em `HP Group Core` |
| **DNS** `hpfisioterapia.com.br` | **não alterado** (GitHub Pages; nameservers em `dns-parking.com`) — fora do alcance |
| **Painel Supabase de produção** | Auth Site URL/Redirect URLs, hook, limite de e-mails, PITR/backup |
| **Netlify** | proteção de equipe nos previews; site duplicado público `leafy-cascaron-325147` (não usar); site de produção a reconectar ao repositório |
| **WhatsApp/pagamentos** | só links `wa.me`; sem API oficial/gateway |

## 6. Decisões que devem ser preservadas
1. **Branch e PR:** trabalhar em **`release/v1`** (PR #3, rascunho). Não voltar a `feature/hp-group-hub` (já mesclada, só aparece em prompts antigos). `feature/lead-quizzes` (PR #2) guarda o Contábil e o redesign antigo; reconciliar depois da v1.
2. **Dev somente.** Supabase **Dev** `fsvtzowcwhvwtluwrhnb`. **Sem merge, sem publicação em produção, sem DNS**, sem migrations em `HP Group Core`, sem republicar `hp-group-hub-producao`, nunca `leafy-cascaron-325147`. Preview só com `netlify deploy --build --context branch:release/v1 --alias release-v1 --site 2c2d11bc-f62c-42b7-bae6-4cf3b6f35756` (sem `--prod`).
3. **Segredos:** nunca no chat, no Git, em documentos ou em `VITE_*`. `SUPABASE_ACCESS_TOKEN` e `HP_QA_PASSWORD` ficam nas variáveis do **usuário Windows**; não pedir token pelo chat nem procurá-lo no histórico de conversas. **Tokens do Supabase foram colados no chat nesta conta (30/09, mais de uma vez) e ficaram gravados nas transcrições locais — considere-os comprometidos, revogue-os em https://supabase.com/dashboard/account/tokens e gere um novo; não copie conversas antigas para a nova conta.**
4. **Honestidade:** não declarar integração concluída (Bunny, Google, e-mail) sem teste real; não chamar falha de “instabilidade” porque passou isolada; registrar causa não determinada como tal; não inventar dados nem zeros em indicadores (documentar fórmula, período e denominador).
5. **Produto:** Google Calendar é a única integração de calendário (sem iPhone/Apple/`.ics`); vídeos privados via backend; financeiro por linha de negócio (Geral/HP Fisioterapia/HP Academy) na mesma organização; clique no WhatsApp ≠ mensagem; compra de cartão = 1 despesa; faturas existentes nunca mudam com a edição do cartão; reservas serializadas por profissional (migration 067) — **não aumentar timeouts para fazer teste passar**; o **plano de sessões é sempre decidido pelo profissional** (nada de “10 por padrão”).
6. **Interface:** filtro único (período/unidade visíveis, demais em “Filtros”, contador, “Limpar filtros”); app ativo decidido pela URL; um aplicativo nunca concede permissão (RLS e funções decidem); inspirações visuais (Shadcn Admin, TailAdmin, Mosaic) **sem copiar código, marca ou texto**; sidebar aprovada pelo usuário.
7. **Testes:** só atualizar expectativa por mudança **intencional** de interface; novos testes separados da regressão (`supabase/tests/novos|release`, `e2e/novos|release`); E2E em grupos pequenos; antes de culpar limitador/instabilidade, conferir o banco.
8. **Convenções de ambiente:** só `D:` (nada em `C:`), nunca tocar projetos da Brighter; e-mail de teste autorizado = `jan.darioush@yahoo.com.br`; ao redefinir função SQL partir da definição **mais recente** e repetir `GRANT`.
9. **Relatórios:** sempre lembrar ao usuário de revogar o token do Supabase ao final.

## 7. Pendências e próximos passos, em ordem
**Atualização 06/10:** a integração operacional das 9 jornadas foi conferida e fechada no código (ver 5.8). **Falta só publicar o preview de `bee5317`** (precisa de `netlify login` ou `NETLIFY_AUTH_TOKEN` no ambiente do usuário) e as ações externas abaixo. Antes: a tarefa autorizada de 01/10 foi concluída (jornadas Fisioterapeuta, Paciente e CRM, Hub sem “Seus aplicativos”, testes, documentação, capturas, commit/push, PR #3 em rascunho e preview). Não há tarefa de código em aberto. Próximos passos, **dependem de ação sua ou de nova autorização**:
0. **Ação mínima sua agora:** (a) `netlify login` (ou definir `NETLIFY_AUTH_TOKEN` nas variáveis do usuário) para eu publicar o rascunho; (b) revogar o token do Supabase comprometido; (c) para fechar Google: abrir **Operação › Meu dia › Conectar Google Calendar** com uma conta de teste e conceder a permissão; (d) para fechar Bunny: cadastrar `BUNNY_EMBED_TOKEN_KEY` nos Secrets do Supabase Dev e o ID da biblioteca em Configurações › Operação.
1. **Revisão do PR #3** (continua em rascunho) e decisão sobre o que entra na primeira versão de produção.
2. **Configurações externas** (seção 5.7): Bunny (segredo e biblioteca), e-mail em produção (Resend, DKIM/SPF, hook, URLs), Google em produção, backup/PITR.
3. **Teste real das dependências externas** assim que configuradas: e-mail de convite/recuperação, vídeo no Bunny, autorização Google.
4. **Produção (só com autorização explícita):** aplicar as 33 migrations (038→047, 052→074) uma a uma, conferir `list_migrations` = 70, publicar o front de produção com o banco de produção, DNS.
5. **Melhorias conhecidas:** histórico do portal além de 100 atendimentos, teste de tela com repasse positivo, importação CSV acima de 500 linhas, validação do registro profissional por conselho, reconciliar `feature/lead-quizzes` (Contábil) com `release/v1`, corrigir os 23 erros de `eslint` antigos e a suíte `vitest` que chama `process.exit`.
6. Ao final de qualquer rodada, lembrar da revogação do token do Supabase.

## 8. Como retomar na nova conta
1. Abrir o Claude Code em `D:\Claude\hugo-pavao-fisio-home` (não em `D:\Claude Code`). Ler `CLAUDE.md`, este arquivo, `docs/project-status.md` (seção mais recente) e `docs/release-v1.md`.
2. `git status --short --branch`, `git log -1`, `git fetch`, `gh pr view 3`. Confirmar `release/v1`, HEAD `ce5d4d7` (ou um commit de documentação posterior) e que não há alterações locais além de `.claude/`. **Não** usar `reset`, `clean`, `checkout` que descarte arquivos nem `stash` sem avisar.
3. Conferir variáveis (sem exibir valores): `SUPABASE_ACCESS_TOKEN` e `HP_QA_PASSWORD` no escopo **Usuário** do Windows; `gh auth status`; `netlify status` (time “Hp Group”); `supabase --version`.
4. Servidor local: `node node_modules/vite/bin/vite.js --port 5180 --host 127.0.0.1` (o Playwright também sobe sozinho). E2E: `npx playwright test <arquivo>` com 1 worker.
5. SQL no Dev: scripts em `supabase/tests/release/*.sql` rodam em transação desfeita (relatório sai no erro `RELATORIO_…`). Aplicar migration no Dev só se pendente, uma a uma, e nunca em produção.
6. Seguir a seção 7.
7. As **memórias** do Claude Code ficam em `%USERPROFILE%\.claude\projects\D--Claude-hugo-pavao-fisio-home\memory\` (convenções, acesso ao Dev); em outra máquina/conta elas **não** acompanham — o conteúdo essencial está neste documento e em `CLAUDE.md`.

## 9. Acessos e integrações a reconectar (sem valores)
- **GitHub:** `gh auth login` com uma conta que escreva em `Alexandrepavao/hugo-pavao-fisio-home` (hoje: `jandaarioush`, escopos `repo`, `workflow`, `read:org`, `gist`). Git local com `user.name=jandaarioush`.
- **Supabase:** token pessoal (variável `SUPABASE_ACCESS_TOKEN`, escopo Usuário) da conta dona do projeto **HP Group Dev**; produção (`HP Group Core`) só quando autorizado. `supabase login --token` não funciona em shell sem TTY: usar a variável de ambiente.
- **Netlify:** `netlify login` (usuário/time “Hp Group”; hoje logada como `contato@hpfisioterapia.com.br`); projeto `hp-group-hub`. Variáveis do site Dev: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_APP_ENV=preview` (nomes só). Funções/edge do Netlify: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (só servidor), `RESEND_API_KEY`, `EMAIL_FROM`.
- **Senha das contas de QA do Dev:** variável `HP_QA_PASSWORD` (contas `qa.*@hp-test.dev`: manager, gestorunidade, comercial, financeiro, fisio, paciente, parceiro, aluno, contador).
- **Segredos das Edge Functions no Supabase Dev (só nomes):** `RESEND_API_KEY`, `EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET`, `PUBLIC_SITE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENC_KEY`, `GOOGLE_RETURN_URL`, `CALENDAR_SYNC_SECRET`; **pendente:** `BUNNY_EMBED_TOKEN_KEY` (+ `BUNNY_TOKEN_TTL_SECONDS` opcional).
- **Resend:** conta com o domínio `hpfisioterapia.com.br` verificado (DKIM/SPF) e a API key.
- **Google Cloud:** projeto “HPGroupCalendario”, Calendar API, cliente OAuth Web; callback `https://fsvtzowcwhvwtluwrhnb.supabase.co/functions/v1/google-calendar/callback`.
- **Bunny Stream:** biblioteca e chave de token de incorporação (ainda não cadastradas).
- **Repositórios de referência** (só para estudar organização; **nunca copiar código, dados ou marca**): `jandaarioush/brightercore-4d41cb1d` (gestão/financeiro), `jandaarioush/brighter-flow-20722354` (CRM Pro), `jandaarioush/engage-nest-space-71c70a06` (Academy/Iaguara), `jandaarioush/focussphere-51789` (produtividade), `jandaarioush/brighter-vision-finance`. Clonar fora do projeto.

## 10. Prompt de retomada (colar na nova conta)
```
Retome o HP Group Hub em D:\Claude\hugo-pavao-fisio-home (futura plataforma ERP white label; hoje a prioridade é a release v1 do HP Group).

1) Leia, nesta ordem: CLAUDE.md, docs/transferencia-claude.md, docs/project-status.md (seção mais recente) e docs/release-v1.md.
2) Confira o estado real antes de qualquer alteração: git status --short --branch, git log -1, git fetch, gh pr view 3. Último estado conhecido: branch release/v1, PR #3 em RASCUNHO, HEAD ce5d4d7 (tudo commitado e enviado; só .claude/ não é versionado). Preserve todas as alterações locais: não use reset, clean, checkout que descarte arquivos nem stash sem me avisar. Não troque para feature/hp-group-hub (já mesclada).
3) Restrições: trabalhe somente no Supabase Dev (fsvtzowcwhvwtluwrhnb); sem merge, sem produção (HP Group Core), sem DNS, sem usar o site leafy-cascaron-325147; preview só com o comando de deploy de rascunho documentado. Não peça nem exiba tokens/senhas; SUPABASE_ACCESS_TOKEN e HP_QA_PASSWORD vêm das variáveis do usuário Windows (confira sem mostrar o valor). Se faltar acesso, diga qual ação eu devo fazer.
4) Primeiro informe brevemente onde paramos e o que depende de mim. A última tarefa autorizada (jornadas Fisioterapeuta, Paciente e CRM; Hub sem “Seus aplicativos”) está CONCLUÍDA; não há tarefa em aberto: confirme comigo o próximo passo entre os listados na seção 7 do docs/transferencia-claude.md antes de implementar.
5) Seja honesto nos relatórios: não declare concluída integração apenas preparada (Bunny, Google, e-mail), não classifique falha como instabilidade sem prova e registre causas não determinadas. Lembre-me ao final de revogar o token do Supabase.
```
