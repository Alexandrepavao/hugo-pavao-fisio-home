# Modelo de dados

Migrations em `supabase/migrations/` (ordem por timestamp). Aplicadas no **Dev** (001–023). **Produção: nenhuma.** Reaplicar em produção na mesma ordem, com advisors depois.
Convenções: dinheiro = `bigint` em centavos; percentuais = pontos-base; datas com fuso (`timestamptz`), fuso por unidade (`units.timezone`); exclusão em cascata só para dependentes sem valor próprio, `RESTRICT` para evidência financeira/operacional.

| # | Migration | Conteúdo principal |
|---|---|---|
| 001 | foundation | `organizations`, `units`, `people` (≠ login), `person_kinds`, `person_contacts` (não únicos: contato compartilhado), `user_accounts`, `role_assignments` (escopo org/unidade), `invitations`, `audit_log`, `tags`, `interactions`, funções `private.*` de autorização, RLS |
| 002 | people_functions | `find_person_duplicates`, `create_person`, `has_any_role` |
| 003 | bootstrap_managers | `private.manager_bootstrap_emails` (uso único, e-mail verificado, auditado) |
| 004 | catalog_crm_events | `services`, `products`, `pipelines`/`pipeline_stages` (4 modelos), `loss_reasons`, `opportunities` (+ `opportunity_events`), `crm_tasks` (chave de idempotência), `domain_events` + `automation_runs` + registro de handlers, distribuição de responsável |
| 005 | pages_forms | `pages` (+ `page_versions`), `forms`, `form_submissions`, `page_visits`, `private.rate_limits`; RPCs públicas `get_public_page`, `track_page_visit`, `submit_public_form`; funções do editor |
| 006 | directory_agenda | `professionals`, `availability_rules`, `time_blocks`, `appointments` (**EXCLUDE gist** profissional e paciente), `client_packages`, `session_ledger` (consumo único por agendamento), `waitlist`, `book_appointment`, `reschedule_appointment`, `set_appointment_status`, handlers de consumo |
| 007 | sales_finance | `sales`/`sale_items`, `contracts`, `receivables`, `payments` (idempotência, estorno), `payables`, `financial_accounts`, categorias, `commission_*`, `subscription_forecast` |
| 008 | academy_care | `courses`, módulos, `lessons`, `cohorts`, `entitlements`, progresso, `quizzes` (gabarito só no servidor), `certificates`, `community_posts`; `care_relationships`, `care_contents`, `care_assignments`, `care_activity`, `care_messages`; buckets **privados** + políticas de Storage |
| 009 | partners_hardening | `partner_profiles`, `referral_codes`/`referrals`, `partner_payouts`, `surveys`/`survey_responses`, `corporate_*` (k-anonimato); `EXECUTE` de `anon` restrito |
| 010 | function_privileges | reforço: `anon` só nas 3 RPCs públicas |
| 011 | dashboard | `dashboard_metrics`, `dashboard_alerts`, `cash_flow_monthly`, `results_by_product` |
| 012 | portal_support | `community_posts.author_name`, `my_appointments`, `my_packages`, `list_team` |
| 013 | care_names | `care_patient_names`, `list_care_links` |
| 014 | email_support | `can_send_transactional` |
| 015 | anon_surface_guard | re-`REVOKE`/re-`GRANT` de `EXECUTE` (10 funções haviam nascido executáveis por `anon`); `private.anon_extra_functions()` (teste reusável); *event trigger* que bloqueia automaticamente qualquer função nova em `public` que nasça executável por `anon`/`authenticated` fora da lista das 3 RPCs públicas |
| 016 | people_merge_import | `person_merges` (auditoria), `private.people_fk_columns()` (descoberta dinâmica de FKs), `merge_preview`/`merge_people` (mesclagem com prévia de conflitos, nunca exclui — arquiva), `import_people_check`/`import_people_commit` (importação CSV validada e idempotente) |
| 017 | fix_create_person | corrige `create_person`: UUID pré-gerado em vez de `RETURNING` (evitava falha de RLS ao reavaliar a política antes da linha existir de forma consistente) |
| 018 | create_person_validation | validação de formato de e-mail/telefone no servidor (antes só no formulário) |
| 019 | productivity | `staff_tasks` (tarefas pessoais, `visibility` privado/equipe, vínculo opcional a oportunidade/pessoa/atendimento/tarefa de CRM), `focus_sessions` (uma sessão aberta por vez, índice único parcial), `my_day()`/`team_day()` (combinam por leitura agenda clínica + tarefas de CRM + tarefas pessoais — nunca uma segunda fonte de compromissos), `staff_task_toggle`, `focus_start`/`focus_stop` |
| 020 | finance_reports_geo | `people.city`/`state_uf`/`country`; `mrr_report()`/`mrr_history()` (MRR/ARR com ponte de movimentação, sobre `products.recurrence`+`receivables.competence_month`); `dre_report()` (honesta: margem/custo direto sempre indisponíveis); `revenue_by_unit()`, `overdue_aging()` (envelhecimento 1-30/31-60/61-90/90+), `efficiency_report()` (CAC/LTV sempre indisponíveis), `geo_distribution()` |
| 021 | bank_reconciliation | `bank_statement_imports`, `bank_statement_lines` (índice único impede conciliar o mesmo pagamento/conta a pagar duas vezes); `bank_statement_import()`, `bank_reconcile_suggestions/confirm/ignore/undo()` — conciliação nunca cria lançamento novo, só aponta o existente |
| 022 | mrr_history_date_fix | corrige `mrr_history()`: `generate_series` devolvia timestamp completo em vez de *date* puro |
| 023 | academy_tracks | `learning_tracks`, `learning_track_courses` (agrupam cursos existentes em trilhas — nunca duplica `courses`/`lessons`); 8 trilhas semeadas como rascunho, sem curso vinculado |
| 037 | reserved_slug_confirmar | acrescenta `confirmar` aos slugs reservados |
| 038 | lead_quizzes | `quiz_leads` (sem GRANT direto — só via funções), `quiz_whatsapp_numbers` (seedada com os números reais já usados no site); RPCs `quiz_start/save_progress/set_health_consent/complete/log_whatsapp_click/whatsapp_number` (anon) e `list_quiz_leads/get_quiz_lead_detail/quiz_lead_metrics` (admin, mascarando respostas de saúde para `sales`); acrescenta `avaliacao`/`seja-parceiro` aos slugs reservados. Aplicada só no Dev — ver seção de sessão mais recente em `docs/project-status.md` |
| 039 | dashboard_card_detail | `dashboard_card_detail(p_kind, p_from, p_to, p_unit)` — detalhamento por cartão (receipts/overdue/new_patients/evaluations_scheduled/win_rate/overdue_tasks), reconcilia com `dashboard_metrics`/`dashboard_alerts` via `private.dash_units()` |
| 040 | audit_quiz_whatsapp_numbers | trigger de auditoria (`private.audit_row`) em `quiz_whatsapp_numbers` — mesmo padrão genérico já usado em people/units/role_assignments/invitations |

## Relações-chave (nada "só visual")
Formulário → `people` + `opportunities` (+ `crm_tasks`, `interactions`) → agendamento (`appointments.opportunity_id`) → comparecimento (evento) → `sales`/`contracts`/`receivables` → `payments` → `entitlements` (Academy) e `client_packages`/`session_ledger` (sessões) → `commission_entries`. Eventos em `domain_events` com `idempotency_key` única e execução por handler registrada em `automation_runs`.

## Regras de exclusão e integridade
`people` é arquivada (`archived_at`) ou mesclada (`merged_into_id`), não excluída; `people→units` `RESTRICT`; contatos/tipos/tags/interações em cascata com a pessoa; `payments`/`receivables`/`sales` sem exclusão (cancelamento e estorno geram novos registros); revogação de acesso e de vínculo assistencial é por `revoked_at` (histórico preservado).

## Índices/constraints relevantes
Trigram no nome de pessoa; único parcial de documento por org (ignora mescladas); `role_assignments` único ativo por (usuário, papel, unidade); `appointments` EXCLUDE por profissional e por pessoa (status ativos); `session_ledger` único de consumo por agendamento; `payments` único por `(org, idempotency_key)` e por `(org, provider, external_ref)`; `crm_tasks` único por `(org, dedupe_key)`; `entitlements` único ativo por (pessoa, curso, origem, referência).
