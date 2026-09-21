# Modelo de dados

Migrations em `supabase/migrations/` (ordem por timestamp). Aplicadas no **Dev** (001–014). **Produção: nenhuma.** Reaplicar em produção na mesma ordem, com advisors depois.
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

## Relações-chave (nada "só visual")
Formulário → `people` + `opportunities` (+ `crm_tasks`, `interactions`) → agendamento (`appointments.opportunity_id`) → comparecimento (evento) → `sales`/`contracts`/`receivables` → `payments` → `entitlements` (Academy) e `client_packages`/`session_ledger` (sessões) → `commission_entries`. Eventos em `domain_events` com `idempotency_key` única e execução por handler registrada em `automation_runs`.

## Regras de exclusão e integridade
`people` é arquivada (`archived_at`) ou mesclada (`merged_into_id`), não excluída; `people→units` `RESTRICT`; contatos/tipos/tags/interações em cascata com a pessoa; `payments`/`receivables`/`sales` sem exclusão (cancelamento e estorno geram novos registros); revogação de acesso e de vínculo assistencial é por `revoked_at` (histórico preservado).

## Índices/constraints relevantes
Trigram no nome de pessoa; único parcial de documento por org (ignora mescladas); `role_assignments` único ativo por (usuário, papel, unidade); `appointments` EXCLUDE por profissional e por pessoa (status ativos); `session_ledger` único de consumo por agendamento; `payments` único por `(org, idempotency_key)` e por `(org, provider, external_ref)`; `crm_tasks` único por `(org, dedupe_key)`; `entitlements` único ativo por (pessoa, curso, origem, referência).
