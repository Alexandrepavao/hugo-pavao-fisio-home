# Release v1 — primeira versão operacional do HP Group Hub

> Estado: **pronta para revisão, NÃO publicada.** Nada foi alterado em produção, DNS ou dados reais. A aprovação final é para publicar esta versão.
> Branch de entrega: `release/v1` (a partir do commit `93ac116`, sem o Contábil). O desenvolvimento continua em `feature/lead-quizzes` (PR #2) e em novas branches.

## 1. O que entra e o que fica de fora

| Escopo obrigatório | Situação nesta versão | Prova |
|---|---|---|
| Login, primeiro acesso, recuperação de senha, logout | ✅ Fluxos prontos. Envio pelo Resend: **nível 1 verificado no Dev** (aceito); entrega/clique dependem da caixa do destinatário autorizado; **produção não tem Resend nem hook configurados** (bloqueio, §9) | E2E 01; §7 |
| Equipe, papéis e permissões | ✅ | R02 (menu + rota + backend por papel), SQL S01 |
| Cadastro central (pacientes, parceiros, empresas) | ✅ Pessoas + ADM (PF/PJ, importação com prévia) | R01, N10/N11, SQL N01/N02 |
| Captação pelo site e quizzes → CRM | ✅ (agora também com indicação de parceiro pelo quiz) | R01, R03, E2E 02/08/09 |
| CRM (leads, responsáveis, oportunidades, etapas, tarefas, histórico) | ✅ | R01 |
| Agenda (agendar, remarcar, cancelar, **confirmação do paciente e do profissional**, comparecimento/falta) | ✅ (falta/comparecimento só após o horário; confirmação antecipada independente por parte, separada de presença e de consumo — §10) | R01, R04, SQL 004/S03 |
| Atendimento e acompanhamento restrito | ✅ Atendimento = agendamento realizado; **acompanhamento** (conteúdos e mensagens) só com vínculo. **Não existe ficha/evolução clínica** (ver §9) | R02, SQL 006 |
| Pacotes (sessões disponíveis/realizadas/canceladas, sem consumo duplicado) | ✅ | R01 passo 6 |
| Financeiro operacional (vendas, parcelas, recebimentos, contas a pagar, estornos, comissões) | ✅ | R01 passos 4–5, SQL S02 |
| Dashboard com indicadores reais e detalhes | ✅ | R01 passo 7 |
| Configurações essenciais (organização, unidades, serviços, preços, equipe, WhatsApp) | ✅ | Configurações + R02 |
| Área do paciente | ✅ atendimentos, pacotes, orientações, dados pessoais, mensagens — só o próprio | R03 |
| Área do parceiro | ✅ perfil, código e indicações (só 1º nome + etapa), repasses autorizados | R03 |

**Preservados e visíveis, sem ampliar escopo:** Academy, Pesquisas, Contas corporativas, Recorrência/DRE/Conciliação/Relatórios do Financeiro, Meu dia, metas do CRM.
**Fora da navegação e das rotas da v1** (perfil de entrega, `src/lib/release.ts`): CRM › *Disparo de mensagens* (exige provedor de envio automático que não existe; *Mensagens agendadas* foi **ligada na v1** como lembrete + registro manual, sem envio automático — `docs/conversas.md`), *Estado dos módulos* e os cartões *Pendente* de Configurações. **Fora desta release:** Contábil (pronto, em `feature/lead-quizzes`), Marketing, Jurídico, RH e provisionamento white label.
> Ocultar menu/rota **não é autorização**: nenhuma permissão depende dessa flag. O acesso a cada dado é decidido no banco (RLS e funções) e verificado por chamadas diretas à API no R02.

## 2. Bloqueios encontrados na jornada de aceite (e como foram resolvidos)

| # | Achado | Impacto | Correção |
|---|---|---|---|
| 1 | "Converter em venda" no CRM abria `/admin/financeiro` (visão geral), não a tela de vendas | Quebrava o passo lead → venda | Link corrigido para `/admin/financeiro/vendas` (clicado de verdade no R01) |
| 2 | Falta (`no_show`) podia ser marcada **antes do horário** e consumia sessão do pacote | Consumo indevido | Migration 052 (mesma regra do comparecimento) |
| 3 | Indicação de parceiro pelo quiz (`/avaliacao?ref=`) não era rastreada, embora o portal prometa "qualquer página" | Parceiro não via a indicação | Migration 053 + front envia `ref`; **`CREATE OR REPLACE` zerou o GRANT de `anon` em `quiz_start`** — pego pelo teste e restaurado na própria migration |
| 4 | Supabase **Dev** com Site URL `http://localhost:3000` e lista de redirecionamento vazia | Links de e-mail iriam para o localhost | Dev ajustado (§7). **Produção tem o mesmo defeito** — pendente (§9) |
| 5 | **O site de produção `hp-group-hub-producao` foi publicado com o banco DEV embutido no bundle** (só `fsvtz…` aparece; nunca `wfqkj…`) | Produção gravaria em banco de teste | Salvaguarda no build (`vite.config.ts`): produção só com o banco de produção e teste/preview nunca com o de produção; `netlify.toml` define `VITE_APP_ENV` por contexto; `version.json` registra commit, ambiente e banco. **Precisa republicar** (§8) |
| 6 | Site Dev `hp-group-hub` está **público** (200 sem login de equipe), contra o que os docs afirmam | Front de teste + banco Dev abertos | Registrado; ver §9 |
| 7 | Função temporária `diag-email-config` ainda no Dev | Superfície desnecessária | Removida |

## 3. Resultados dos testes
Executados contra o **Supabase Dev** (dados de QA), com o front local da branch `release/v1`. Comando de cada camada entre parênteses.

| Camada | Resultado |
|---|---|
| **Aceite — jornada operacional** `R01` (`npm run test:e2e:release`) | **8/8**: lead→CRM/cadastro sem duplicar→responsável→agenda (remarcar, comparecer)→venda de pacote→parcelas→recebimento parcial/duplo clique/excedente/estorno/comissão→sessões (comparecimento, falta, cancelamentos, esgotamento)→dashboard e histórico |
| **Aceite — permissões por papel** `R02` | **7/7** (5 papéis: menu + rotas proibidas; recursos incompletos fora; backend por chamada direta para comercial, financeiro, fisioterapeuta, gestor de unidade, parceiro e paciente) |
| **Aceite — portais** `R03` | **2/2** (paciente e parceiro, inclusive indicação rastreada pelo quiz) |
| ADM novos `N10`/`N11` (`npm run test:e2e:novos`) | **4/4** |
| **Regressão E2E 01–09** (`npm run test:e2e:regressao`) | **32/32** — 31 na bateria final + o `08` (1 teste) que esbarrou no limitador de segurança do quiz (8 inícios/10 min por IP) por causa das baterias seguidas; reexecutado após a janela virar: **passou** (junto com 02 e 09) |
| **SQL — isolamento por unidade** `S01` (`npm run test:sql:release`) | **16/16** |
| **SQL — vendas e financeiro** `S02` | **32/32** |
| SQL — ADM `N01`/`N02` (`npm run test:sql:novos`) | **39/39** |
| SQL legado reexecutado: agenda e pacotes `004` / Academy e acompanhamento `006` | **26/26** (com a trava nova) / `006` sem falhas |
| Unit (`npm test`) | **25/25** |
| `tsc` · `eslint` · `vite build` | tsc limpo · eslint = base (1 erro anterior em `auth-email-hook`, 19 avisos, **0 novos**) · build ok (`version.json` com commit/ambiente/banco) |
| Salvaguarda de ambiente | 4 cenários verificados: produção→Dev **recusado**; preview→produção **recusado**; produção→produção ok; dev→Dev ok |
| Revisão de desktop e celular (`e2e/tools/shots-release.mjs`) | 38 capturas (gestor, fisioterapeuta, paciente, parceiro, telas públicas) em 1440 px e 390 px: **0 px de overflow horizontal e 0 erros de console**. Ressalva: no celular, nas tabelas largas (Vendas, Agenda) as ações ficam à direita e exigem rolar a tabela |

**Não coberto / não provado:** entrega e clique dos e-mails (§7); convite por e-mail via Netlify; migrations numa cópia de produção; SQL legado 001–023 inteiro em base limpa (002, 003, 010, 012 falham por fixtures próprias; 001/005 têm cópias independentes de volume em `supabase/tests/release`); carga/concorrência além da restrição de exclusão da agenda.

## 4. Migrations para produção (ordem exata)
Produção está na **037** (37 migrations, sem dados: 0 usuários, 0 pessoas). Aplicar, **nesta ordem**, só estas 33 (todas já aplicadas no Dev e testadas por SQL; produção não foi tocada):

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | `20260924000038_lead_quizzes.sql` | Quizzes de captação, números de WhatsApp (seed), funções `quiz_*` e de gestão |
| 2 | `20260924000039_dashboard_card_detail.sql` | Detalhamento dos cartões (dashboard) |
| 3 | `20260924000040_audit_quiz_whatsapp_numbers.sql` | Auditoria dos números de WhatsApp |
| 4 | `20260924000041_dashboard_card_detail_expand.sql` | Detalhamento ampliado + correção do total |
| 5 | `20260924000042_crm_dashboard.sql` | Dashboard do CRM |
| 6 | `20260924000043_crm_goals.sql` | Metas do CRM |
| 7 | `20260924000044_crm_lists.sql` | Listas do CRM |
| 8 | `20260924000045_adm_directory.sql` | ADM: PJ, CPF/CNPJ, campos de PF |
| 9 | `20260924000046_adm_directory_rpc.sql` | ADM: listagem/indicadores/edição de PJ |
| 10 | `20260929000047_adm_import_views.sql` | ADM: importação de PJ, colunas por usuário |
| 11 | `20260930000052_appointment_status_guard.sql` | Trava de falta/comparecimento futuro |
| 12 | `20260930000053_quiz_partner_referral.sql` | Indicação de parceiro pelo quiz (+ GRANT) |
| 13 | `20260930000054_appointment_confirmations.sql` | Confirmação antecipada (paciente/profissional), falta do profissional, `my_appointments`/`my_day` ampliados (+ GRANT/REVOKE) |
| 14 | `20260930000055_patient_cancel_past_guard_team_day.sql` | Cancelamento pelo paciente no portal (prazo/consumo), bloqueio de horário passado em `book_appointment`/`reschedule_appointment`, `my_agenda_professionals`/`professional_day` (agendas por permissão), `my_appointments` ampliado (+ GRANT/REVOKE) |
| 15 | `20260930000056_indicators.sql` | Indicadores ampliados: Administrativo, CRM (tempo/conversão/ciclo/perdas/desempenho) e Captação — `docs/indicadores.md` |
| 16 | `20260930000057_business_lines.sql` | Financeiro por linha de negócio (HP Fisioterapia / HP Academy), rateio e conferência — `docs/financeiro-linhas-de-negocio.md` |
| 17 | `20260930000058_patient_journey.sql` | Jornada do paciente: objetivos, plano, avaliações, reavaliação, vídeos privados, renovação — `docs/jornada-do-paciente.md` |
| 18 | `20260930000059_calendars.sql` | Calendários: visão por intervalo, assinatura .ics, conexão Google — `docs/calendarios.md` |
| 19 | `20260930000060_business_lines_recurrence_efficiency_bank.sql` | Linhas de negócio em Recorrência (MRR/ARR), Relatórios de eficiência e Conciliação bancária (camada de alocação separada do extrato) — `docs/financeiro-linhas-de-negocio.md` |
| 20 | `20260930000061_google_oauth_state.sql` | `state` do OAuth do Google de **uso único** (nonce guardado no servidor e consumido no callback) — `docs/calendarios.md` |
| 21 | `20260930000062_admin_pending_center.sql` | Central de pendências administrativas: pendências com histórico, documentos, contratos administrativos, verificação de contato, requisitos e prazos configuráveis, indicadores e detalhes — `docs/indicadores-administrativo.md` |
| 22 | `20260930000063_google_calendar_auto_sync.sql` | Sincronização automática com o Google Calendar: gatilho de atendimento + job de 5 em 5 minutos (`pg_net`/`pg_cron`, segredo no Vault) — `docs/calendarios.md` |
| 23 | `20260930000064_adm_geo_and_directory_uf.sql` | Mapa do Brasil do Administrativo: `adm_geo` (cadastros PF+PJ por estado, mesmo escopo do painel) e filtro por estado em `adm_directory`/`adm_export`; a listagem passa a respeitar o escopo de unidade do gestor de unidade — `docs/interface-v2.md` |
| 24 | `20260930000065_corporate_cards.sql` | Cartões corporativos: `corporate_cards`, `card_invoices`, `card_purchases` (a compra é uma despesa em `payables`), vínculo fatura ↔ extrato, funções de cadastro/compra/fatura/conciliação; ajusta `payable_pay`, `bank_reconcile_*` e `bank_line_split` — `docs/cartoes-corporativos.md` |
| 25 | `20260930000066_card_update.sql` | Edição de cartão (`card_update`: limite, fechamento, vencimento, com motivo e auditoria); `private.card_cycle_for` (usa a fatura existente da data; novos dias só valem para faturas que ainda não existem); redefine `card_purchase_create` e `card_summary` (mesma assinatura) — `docs/cartoes-corporativos.md` §6 |
| 26 | `20260930000067_book_appointment_serialize.sql` | `book_appointment` passa a serializar reservas do mesmo profissional/pessoa com `pg_advisory_xact_lock` (evita deadlock entre as exclusion constraints e o `57014` do teste de concorrência) — `docs/diagnosticos/04-agenda-concurrency/README.md` |
| 27 | `20260930000068_professional_onboarding_patient_gaps.sql` | Jornadas Fisioterapeuta/Paciente: `professional_save` (pessoa do cadastro central + registro no conselho + unidades), `professional_availability_save/_remove`, `professional_grant_access`, `my_professional_summary`, `my_package_breakdown`; plano sem quantidade padrão (`patient_plan_save`); renovação só com orientação (`my_renewal_request`); convite com `professional_id`; gatilho do Auth liga o profissional à conta; auditoria de profissionais/disponibilidade — `docs/jornadas-fisioterapeuta-paciente-crm.md` |
| 28 | `20260930000069_crm_import.sql` | Importação CSV do CRM: `crm_import_check` (prévia), `crm_import_commit` (grava linha a linha, deduplica no servidor, conflito só com decisão explícita), `crm_imports` (histórico auditado) |
| 29 | `20260930000070_person_portal_access.sql` | `person_portal_access`: convite ou vínculo imediato do paciente/aluno à conta, com trava de e-mail cadastrado |
| 30 | `20260930000071_professional_summary_upcoming.sql` | “Agendados” do resumo do profissional conta todos os atendimentos futuros (não só os do período) |
| 31 | `20260930000072_grant_access_existing_confirmed_account.sql` | Conta já confirmada, mas sem `user_accounts`, é criada e ligada na hora (profissional e paciente); antes o convite nunca seria processado |
| 32 | `20260930000073_reassessment_decided_at_clock.sql` | `patient_reassessments.decided_at` usa `clock_timestamp()` (desempate determinístico da “última decisão”) |
| 33 | `20260930000074_crm_lists_rls_roles.sql` | **Correção de segurança:** listas do CRM (`crm_lead_lists`, `crm_lead_list_members`) só para papéis do CRM; antes paciente, parceiro e fisioterapeuta criavam/liam/apagavam listas pela API (`in_org` apenas) |
| 31b | `20260930000075_commission_detail_reconciliation.sql` | Repasses: `commission_entries.percent_bp` (percentual aplicado guardado), `h_payment_commission` grava o percentual, `my_professional_summary` com pendente/autorizado/pago/estornos/líquido e detalhamento (sem o paciente), `commission_reconciliation` (recálculo + conferência com a Visão geral) — `docs/repasses.md` |
| 31c | `20260930000076_commission_status_machine.sql` | Comissões: máquina de estados estrita (pendente → autorizada → paga; pago/estornado finais; repetir não muda) e auditoria de `commission_entries` — `docs/repasses.md` |
| 34 | `20260930000077_crm_conversations.sql` | Central de Conversas do CRM: conversas por pessoa/canal, multiatendimento, mensagens imutáveis, mensagens agendadas (lembrete + registro; sem envio automático) e ficha do lead por nicho (`opportunities.profile`) — `docs/conversas.md`. *(075/076 = Repasses, linhas 31b/31c acima.)* |
| 35 | `20260930000078_idempotent_sale_and_opportunity.sql` | Duplo clique e retentativa: `sale_create` ganha `p_idempotency_key` (mesma chave = mesma venda, inclusive em corrida) e uma oportunidade só pode ter UMA venda pendente; `crm_create_opportunity` recusa segunda oportunidade ABERTA da mesma pessoa no mesmo funil — `docs/integracao-ponta-a-ponta.md` |

**Contagem de migrations — Dev × produção (conferida em 2026-09-30 contra `supabase_migrations.schema_migrations` do Dev e contra os arquivos do repositório):**
| | Registros | Composição |
|---|---|---|
| Produção hoje | **37** | 001–037 |
| **Dev hoje** | **75** | 47 arquivos (001–047) + **1** (a 045 está registrada em duas partes: `adm_directory` e `adm_legal_entities`) + **4 só do Dev** (048–051: papel `accountant`/Contábil, sem arquivo nesta branch) + 23 (052–074) |
| **Produção depois da release** | **70** | 37 + 10 (038–047, um registro por arquivo) + 23 (052–074) |
**Diferença Dev − produção = 5** (75 − 70): as 4 migrations **048–051** (exclusivas do Dev; não há dependência da v1 nelas) + **1** registro extra porque a 045 foi aplicada no Dev em duas partes (o conteúdo é o mesmo do arquivo `045`, que entra em produção inteiro e de uma vez). Os números 61, 62 e 56/57 que aparecem nos relatórios são de bancos e momentos diferentes: 61 = Dev antes da 061 · 62 = Dev com a 061 · 63 = Dev com a 062 · **64 = Dev agora (com a 063)** · 56 = produção prevista antes da 061 · 57 = com a 061 · 58 = com a 062 · **59 = produção prevista agora**. As **22 migrations a aplicar em produção** são as da tabela acima; 056–063 são do escopo ampliado (a 061 tornou o `state` do Google de uso único; a 062 é a central de pendências administrativas; a 063 é a sincronização automática do Google Calendar).

**NÃO aplicar 048–051** (papel `accountant` e Contábil): existem no Dev e ficam na branch de desenvolvimento. Não há dependência da v1 nelas. Como a 052/053 têm versão maior que a 051, a ordem de aplicação em produção (…047 → 052 → 053) e a futura chegada de 048–051 são compatíveis (são independentes).
Como aplicar: uma a uma, em ordem, com `apply_migration` (nunca `db reset`), conferindo `list_migrations` (deve terminar em 70 registros) e rodando os testes SQL `supabase/tests/release` **contra o Dev** antes. As migrations foram aplicadas no Dev na mesma ordem; **não foram ensaiadas numa cópia de produção** (o plano do projeto não tem branch/PITR — ver §6).

## 5. Variáveis e configurações (somente nomes; valores ficam nos painéis)
| Onde | Nome | Observação |
|---|---|---|
| Netlify (site de produção) — build | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | **Do projeto de produção `HP Group Core`**. `VITE_APP_ENV=production` e `VITE_RELEASE_PROFILE=v1` já vêm do `netlify.toml` (contexto production) |
| Netlify — funções/edge | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (só servidor), `RESEND_API_KEY`, `EMAIL_FROM` | `send-email` (convite) e `social-meta` leem estas |
| Supabase produção — secrets das Edge Functions | `RESEND_API_KEY`, `EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET`, `PUBLIC_SITE_URL` | **Hoje nenhum está configurado em produção** |
| Supabase produção — Auth | Site URL = domínio final; Redirect URLs = `https://<domínio>/**`; Send Email Hook **habilitado** → `auth-email-hook`; limite de e-mails ≥ 30/h; senha mínima ≥ 10 (Dev está em 6) | Hoje: Site URL `http://localhost:3000`, lista vazia, hook desabilitado, limite 2/h |
| Resend | domínio `hpfisioterapia.com.br` verificado (DKIM; SPF **mesclado** ao existente do Hostinger) | ver `docs/integrations.md` |

## 6. Backup e recuperação antes da migração
- Produção **não tem backup automático nem PITR** (`backups: []`, `pitr_enabled: false`). Hoje o banco está **vazio de dados de negócio**, então migrar agora tem risco baixo: o que se perderia é só o schema, que é reproduzível pelos arquivos do repositório.
- Antes de aplicar: (1) registrar `list_migrations` (deve ser 37 até `20260923030432`); (2) exportar o inventário do schema (tabelas, funções e policies) por consulta e guardar no repositório privado; (3) **recomendado: subir o projeto para um plano com backup diário/PITR ANTES do primeiro dado real** — a partir do primeiro paciente cadastrado, "recuperação" deixa de ser reconstruir e passa a exigir backup.
- Recuperação se uma migration falhar no meio: cada arquivo roda em uma transação por chamada; se falhar, nada dela persiste. Parar, corrigir o arquivo, reaplicar. Não seguir para a próxima.
- Reversão das duas migrations que **substituem função**: 052 → reaplicar `set_appointment_status` do arquivo `20260921000006_directory_agenda.sql`; 053 → reaplicar `quiz_start` de `20260924000038_lead_quizzes.sql` **e o GRANT a `anon`**. As demais só adicionam objetos.
- Reversão da 054 (substitui 3 funções e recria `my_appointments`): `set_appointment_status` → arquivo 052; `my_appointments` → `20260921000012_portal_support.sql` (recriar exige `drop function` antes, e repetir o GRANT a `authenticated`); `my_day` → `20260922000019_productivity.sql`. As colunas de confirmação e o status `professional_no_show` só se removem se nenhuma linha os usar (a constraint de status volta à lista antiga).
- Reversão da 055 (substitui `book_appointment`, `reschedule_appointment` e recria `my_appointments`; cria funções novas): `book_appointment` e `reschedule_appointment` → arquivo `20260921000006_directory_agenda.sql` (isso **reabre** a brecha de horário passado); `my_appointments` → versão da 054 (`drop function` antes, repetir o GRANT); as funções novas (`my_appointment_cancel`, `my_agenda_professionals`, `professional_day`, `private.can_view_prof_agenda`) podem ser removidas com `drop function`.
- Reversão da 066 (adiciona `card_update` e `private.card_cycle_for`; redefine `card_purchase_create` e `card_summary`): `drop function public.card_update(...)` e reaplicar as duas funções do arquivo `20260930000065_corporate_cards.sql` (mesmos GRANTs); `drop function private.card_cycle_for(uuid, date)` depois.
- Reversão da 067 (só acrescenta dois `pg_advisory_xact_lock` em `book_appointment`): reaplicar a definição do arquivo `20260930000055_patient_cancel_past_guard_team_day.sql` e repetir o GRANT a `authenticated` (isso **reabre** o risco de deadlock em reservas simultâneas do mesmo horário).
- Reversão das 068–074 (aditivas, exceto a 074 que **restringe** políticas: reverter a 074 reabre a brecha das listas do CRM — não recomendado; as demais: funções novas, `crm_imports`, coluna `invitations.professional_id`, dois gatilhos de auditoria e o padrão de `decided_at`): redefinições — `patient_plan_save`/`my_renewal_request` → arquivo `20260930000058_patient_journey.sql`; gatilho `on_auth_user_confirmed` → `20260921000003_bootstrap_managers.sql` (repetir o GRANT/owner); as funções novas podem ficar sem uso. Reverter 068 **reabre** o “10 sessões por padrão” e a renovação sem orientação.

## 7. Verificação de login e e-mail (Resend) no Dev
- **Usuário de teste autorizado**: somente `jan.darioush@yahoo.com.br`. **Um** e-mail de recuperação enviado em 2026-09-30 02:04:30Z pelo fluxo real (`/auth/v1/recover` → hook → Resend): API respondeu 200, o Auth registrou `recovery_sent_at` 02:04:31Z — ou seja, o hook respondeu com sucesso, o que só acontece se o Resend aceitou o envio (**nível 1**).
- **Falta para os níveis 2 e 3** (entrega registrada no Resend e clique no link): conferir a caixa do destinatário (e o painel do Resend). Não tenho acesso a nenhum dos dois.
- Auth do **Dev** ajustado: Site URL `https://hp-group-hub.netlify.app`; Redirect URLs incluem também `http://127.0.0.1:5180/**` e `http://localhost:5180/**`.
- Nenhuma mensagem foi enviada a pacientes ou terceiros. Convite de equipe por e-mail (`send-email`, Netlify) **não foi testado** — depende de `RESEND_API_KEY` no Netlify e de login Netlify que esta sessão não tem.

## 8. Plano de publicação e reversão
**Pré-condição:** produção ainda não tem usuários; as duas manobras (banco e front) são de baixo risco agora e ficam perigosas depois do primeiro uso real — por isso a ordem abaixo importa.

Publicação (banco → configuração → front → verificação):
1. Backup/inventário (§6). Congelar mudanças de schema.
2. Aplicar as 33 migrations (§4), uma a uma. Rodar `npm run test:sql:release` **apontando para o Dev** e conferir em produção: `list_migrations` = 70; nenhuma função `acc_`/`adm_` executável por `anon`; lista de funções de `anon` = `get_public_page`, `track_page_visit`, `submit_public_form` + `quiz_*` (6).
3. Configurar o Supabase de produção (§5): secrets, hook, Site URL/Redirect URLs, limite de e-mail, senha mínima.
4. **Conectar o site Netlify de produção ao repositório**, branch `release/v1` (ou `main` após o merge), com as variáveis de produção — assim o **Netlify** compila (não a máquina de alguém) e cada deploy carrega o `COMMIT_REF`. Sem `.env.local` no build.
5. Deploy. Verificar `GET /version.json`: `commit` = commit aprovado, `environment` = `production`, `backend` = `produção`. Se não bater, **não abrir para a equipe**. A tela *Configurações* mostra a mesma linha e, fora de produção, aparece o selo "AMBIENTE DE TESTE".
6. Bootstrap: entrar como gestor pelo primeiro acesso (`contato@hpfisioterapia.com.br` ou `jan.darioush@yahoo.com.br`, ambos já na lista de bootstrap), convidar a equipe, criar a configuração mínima (§ guia) e só então divulgar o link.

Reversão:
- **Front:** Netlify → *Deploys* → publicar o deploy anterior (instantâneo). O front antigo funciona com o banco novo (as migrations só adicionam, exceto as duas funções acima, mantendo assinatura).
- **Banco:** as migrations são para frente; para desfazer use os arquivos de origem (§6) ou restaure backup (se existir). Enquanto não houver dado real, a saída mais limpa é reaplicar o schema.
- **E-mail:** desabilitar o hook volta ao remetente padrão do Supabase (limite baixo) — só como contingência.

## 9. Pendências que IMPEDEM o uso × melhorias futuras
**Impedem colocar em produção (precisam de ação sua/painéis):**
1. Republicar o front de produção com o banco de produção (hoje aponta para o Dev — §2 #5) e conectá-lo ao repositório.
2. Aplicar as 33 migrations em produção.
3. Configurar e-mail em produção: Resend (domínio, DKIM/SPF), secrets e hook do Supabase, Site URL/Redirect URLs, limite de e-mails (§5). Sem isso ninguém completa o primeiro acesso.
4. DNS de `hpfisioterapia.com.br` continua no GitHub Pages (HTTPS válido); o app não está no domínio oficial. Decidir subdomínio do app (ex.: `app.hpfisioterapia.com.br`) e apontar o DNS quando aprovado.
5. Proteger ou desligar o site Dev público `hp-group-hub` (§2 #6) e resolver o site Netlify não documentado `leafy-cascaron-325147` (ver `docs/deployment.md`).
6. Configuração mínima de operação (não existe em produção): serviços e preços, pacotes, profissionais e disponibilidade, conta financeira, regra de comissão, criação/publicação das páginas do site, convites da equipe. O guia (`docs/guia-operacao-v1.md`) lista onde fazer.
7. Backup/PITR antes do primeiro dado real (§6).

**Melhorias futuras (não bloqueiam):** ficha/evolução clínica por atendimento; agenda para celular com ações visíveis sem rolar a tabela (hoje as tabelas largas rolam na horizontal); remarcar com seletor de horários em vez de texto `AAAA-MM-DD HH:MM`; envio automático de lembretes (exige provedor de mensagens); testes SQL legados 001–023 reescritos para banco descartável; Contábil, Marketing, Jurídico, RH e provisionamento white label (roteiro pausado).

## 10. Confirmação antecipada, presença e consumo de sessão (migration 054)
Três coisas **separadas** (antes se misturavam no `status`):
| Conceito | Onde vive | Regra |
|---|---|---|
| **Confirmação antecipada** ("eu vou / eu atendo") | colunas `patient_confirmed_*` e `professional_confirmed_*` em `appointments` | Duas confirmações **independentes**. Paciente confirma só o próprio atendimento (portal, `my_appointment_confirm`); profissional só o dele (`professional_appointment_confirm`) — nem gestor confirma por ele. A recepção (gestor, admin, gestor de unidade, comercial da unidade) pode **registrar** a confirmação que o paciente deu por telefone (`appointment_confirm_for_patient`), marcada como `staff`. Só antes do horário e em atendimento ativo; idempotente. **Não muda o status, não consome sessão, não prova presença, não é pré-requisito.** Auditada (autor e instante). |
| **Presença efetiva** | `status` | `attended` (compareceu), `no_show` (**paciente** faltou sem cancelar), `professional_no_show` (**profissional** faltou). Só depois do horário. Falta do paciente nunca vira "realizado". |
| **Consumo de sessão** | `session_ledger` (handlers de evento) | Política do produto: `no_show` consome se `consume_on_no_show`; cancelamento tardio consome; **`professional_no_show` nunca consome** e, se uma falta do paciente marcada por engano já consumira, **devolve** (uma vez) e reativa o pacote. Libera o horário e cria tarefa "reagendar sem custo". |

Telas: portal do paciente (botão "Confirmar minha presença", confirmação do profissional, e nas faltas se a sessão foi ou não descontada), "Meu dia" do fisioterapeuta ("Confirmo o atendimento"), Agenda do gestor (colunas *Confirmações* e *Sessão do pacote*, "Registrar confirmação do paciente", "Profissional ausente").
Decisões: `professional_no_show` é estado final (corrigir pela marcação só de `no_show` → `professional_no_show`); o status legado `confirmed` segue aceito por compatibilidade, mas a confirmação nova não o usa.

**Verificação (Dev), estado honesto:**
- Migration 054 aplicada no Dev pelo SQL Editor (colunas, funções sem `anon`, handler registrado).
- **Verificação interina pela API com contas QA: 38/39** — a 1 falha era uma conferência errada do próprio script (o item antigo remarcado continua no histórico do paciente, como esperado). Cobre confirmações, independência, permissões (403), antes do horário, falta do paciente (consome, não é realizado), falta do profissional (não consome), devolução na correção, o que o portal mostra e auditoria.
- Telas conferidas com dados reais (portal, Meu dia, Agenda) e por captura de tela.
- Regressão E2E 01/03/04/05/06/07 + R02 + R03: **33/33** (o 04 estourou o tempo uma vez em bateria e passou isolado, flake já documentado).
- **NÃO executados (precisam do token do Dev):** `S03` (SQL, `supabase/tests/release`), `R04` (E2E das confirmações, inclusive "confirmou e faltou") e `R01` (usa deslocamento de horário). Escritos e compilando; rodar antes de publicar: `SUPABASE_ACCESS_TOKEN=… npm run test:sql:release` e `npm run test:e2e:release`.

### 10.1 Cancelamento pelo paciente, horário passado e agendas por permissão (migration 055)
- **Cancelamento pelo paciente no portal** (`my_appointment_cancel`): só o próprio paciente, só antes do início, idempotente. **Segue a política do produto do pacote**: cancelar com menos de `late_cancel_hours` (padrão 24 h) de antecedência **consome 1 sessão** (mesmo handler que já valia quando a equipe cancela "pelo paciente"); antes do prazo, não consome; sem pacote, não há o que consumir. O portal **avisa antes** (texto do prazo e diálogo de confirmação com a consequência) e depois mostra se a sessão foi descontada. Depois do início ou em atendimento encerrado/cancelado pela clínica, só pela equipe.
- **Horário passado**: `reschedule_appointment` recusa novo horário ≤ agora e `book_appointment` recusa qualquer início ≤ agora — **a antiga exceção de `p_rescheduled_from` foi removida** (chamando a função direto dava para criar atendimento no passado). A Agenda também recusa antes de chamar o servidor.
- **"Meu dia" com agenda própria + outras por permissão**: cada pessoa vê a própria agenda clínica; o seletor "Agenda clínica de" só aparece para quem o servidor autoriza — gestor e administrador operacional (toda a organização) e gestor de unidade (**só as unidades dele**). Fisioterapeuta, comercial, financeiro e paciente **não** abrem agenda alheia (403). Na agenda alheia nunca há ação de confirmar (a confirmação do profissional é só dele).
- **Kanban do CRM (arrastar e soltar)**: o card aparecia **duplicado por ~250 ms depois de soltar** (a cópia flutuante animava de volta à origem enquanto a atualização otimista já o colocava na coluna nova) e, durante o arrasto, o original esmaecido na origem parecia um segundo card. Corrigido: sem animação de retorno (`dropAnimation={null}`) e espaço tracejado na origem. **Não havia duplicação de dados** (mesma quantidade de oportunidades antes e depois). Teste de regressão `R06` (mede quadro a quadro; falha sem a correção).
- **ADM → Administrativo**: rótulo visível renomeado (menu, cabeçalhos, troca de app do CRM); as rotas `/admin/adm` não mudaram.
- **Testes escritos**: `S04` (SQL) e `R05` (E2E, sem token de gestão do Dev).
- **Resultados finais (Dev, 2026-09-30)**, migrations 054 e 055 aplicadas e registradas (56 migrations no Dev): **SQL `test:sql:release` 151/151** (S01 16 + S02 32 + S03 56 + S04 47); **aceite E2E `R01` 8/8, `R04` 4/4, `R05` 4/4**; regressão E2E 01–09 + `R02` + `R03` + `N10/N11` (Administrativo) **45/45**; unit 25/25; `tsc`/`eslint`/`build` ok.
- **Defeito real achado pelos testes e corrigido**: na Agenda, depois de marcar "Faltou", a coluna *Sessão do pacote* ficava com o valor antigo até recarregar (a consulta do livro não era invalidada junto com a agenda).
- **Ajustes só de teste**: `S03`/`S04` reservavam mais atendimentos ativos que sessões do pacote (a regra de saldo, corretamente, recusa); consultas ao livro/CRM feitas como fisioterapeuta eram escondidas por RLS (esperado); `R04` passou a usar horários únicos por execução e `R05` um seletor de texto exato. Observação operacional: rodadas muito seguidas de login de QA podem receber `429` do Auth (limite de taxa), o que não é defeito do produto.

## 11. Preview de revisão (site Dev `hp-group-hub`)
- **Como foi publicado**: `netlify deploy --build --context branch:release/v1 --alias release-v1 --site <hp-group-hub>` (rascunho, **sem `--prod`**; o deploy publicado do site Dev não muda). O contexto `branch:release/v1` é o que aplica `VITE_RELEASE_PROFILE=v1` do `netlify.toml`; com o contexto genérico `deploy-preview` o perfil sai `full`.
- **Backend**: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (Dev, chave publicável — não é segredo) estão como variáveis do site; o plano gratuito não aceita escopo por contexto, então valem para todos os contextos **desse site Dev** (`VITE_APP_ENV=preview` em todos; `vite.config.ts` recusa produção↔Dev). Nenhum valor foi gravado no repositório.
- **Verificação**: `version.json` = `commit 86f50f4 · profile v1 · environment preview · backend Dev (fsvtzowcwhvwtluwrhnb)`; o bundle enviado contém só a referência do Dev. Login, rotas, menus por papel e portais (`01`, `R02`, `R03`: 14/14) foram exercitados contra esse mesmo `dist/` servido localmente com o Supabase Dev.
- **Última publicação (2026-09-30, 6ª rodada)**: deploy `6abd3c27ec571eb924ec12b2` (branch-deploy `release-v1`, estado `ready`, `published_at` vazio = não entrou na URL principal), commit `bcc6db8f649f`, `version.json` do bundle: perfil `v1`, ambiente `preview`, backend `Dev`. Como a URL exige login da equipe, as telas foram conferidas servindo localmente o **mesmo `dist/`** do deploy: 32 E2E (R01, R02, R07–R10) verdes.
- **Limites**: a URL do rascunho é protegida pelo login de equipe do Netlify (abre só para quem está logado no time), por isso não foi aberta de fora. O Supabase Auth do Dev tem como Redirect URLs só `hp-group-hub.netlify.app` e `localhost`: **login por senha funciona no preview; e-mails de recuperação/convite apontam para outro endereço** e não devem ser testados ali.
- **Última publicação (2026-10-01, 13ª rodada)**: deploy `6abed1f6a20ecff377beff7e` (branch-deploy `release-v1`, rascunho), commit `ce5d4d7448ad`, `version.json`: perfil `v1`, ambiente `preview`, backend `Dev`; inclui as jornadas Fisioterapeuta/Paciente/CRM e a correção das listas do CRM (074). URL protegida por login da equipe.
- **Produção**: não tocada (site `hp-group-hub-producao`, domínio e DNS intactos).

## 12. Edge Functions e segredos do escopo ampliado (publicadas no Dev; Google Calendar configurado no Dev; segredos do Bunny **ainda não cadastrados**; produção não tocada)
| Função | Publicar | Precisa de |
|---|---|---|
| `bunny-playback` (vídeos privados) | `supabase functions deploy bunny-playback` (JWT ligado) | Secret `BUNNY_EMBED_TOKEN_KEY` (+ opcional `BUNNY_TOKEN_TTL_SECONDS`); ID da biblioteca em Configurações › Operação — `docs/jornada-do-paciente.md` |
| ~~`calendar-feed`~~ (assinatura .ics) | **aposentada** — não publicar; removida do repositório e despublicada no Dev | — |
| `google-calendar` (OAuth e sincronização automática) | `supabase functions deploy google-calendar --no-verify-jwt` | Secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENC_KEY`, `GOOGLE_RETURN_URL` (origem do app para voltar do Google; **não** é o `PUBLIC_SITE_URL` dos e-mails) e `CALENDAR_SYNC_SECRET`; Vault com `calendar_sync_url` e `calendar_sync_secret` (mesmo valor); cliente OAuth e tela de consentimento no Google Cloud — `docs/calendarios.md` |
Nenhum segredo é digitado no chat, gravado no repositório ou exposto ao navegador (`VITE_*`). Em produção, repetir no projeto `HP Group Core` só na hora da publicação.
