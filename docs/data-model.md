# Modelo de dados

Migrations em `supabase/migrations/` (ordem por timestamp). Aplicadas hoje: **Dev**. Produção: nenhuma ainda.

## 001 foundation
| Tabela | Papel | Chaves / regras relevantes |
|---|---|---|
| `organizations` | Grupo | `slug` único |
| `units` | Unidades | `timezone` por unidade (padrão America/Sao_Paulo); `unique(org_id, slug)`; `ON DELETE RESTRICT` da org |
| `people` | Cadastro central | Separado do login. `document_number` único por org (parcial, ignorando mescladas). `merged_into_id` preserva histórico em mesclagens. Índice trigram no nome |
| `person_kinds` | lead/paciente/aluno/parceiro/equipe/contato | PK (pessoa, tipo): a mesma pessoa pode ter vários |
| `person_contacts` | e-mail/telefone/WhatsApp | **Não único** entre pessoas (contato compartilhado é legítimo); único por pessoa; `is_shared`; normalização por trigger |
| `user_accounts` | Conta → org (+ pessoa) | `person_id` único |
| `role_assignments` | Papéis por escopo | Índice único parcial para papéis ativos; CHECK de escopo |
| `invitations` | Convites | Expira em 14 dias; consumido no primeiro login confirmado |
| `audit_log` | Auditoria | Só nomes de colunas alteradas + valores de colunas não sensíveis explicitamente listadas no trigger |
| `tags`, `person_tags` | Segmentação | |
| `interactions` | Histórico de relacionamento | Somente inserção (sem update/delete concedidos) |
| `private.bootstrap_config` | E-mail do 1º gestor | fora da API |

Exclusão: `people`→`units` é `RESTRICT`; contatos/tipos/tags/interações apagam em cascata com a pessoa (pessoas normalmente são arquivadas, não excluídas — `archived_at`).

## 002 people_functions
`find_person_duplicates` (contato igual = possível compartilhado; nome com similaridade ≥ 0,6 = possível homônimo) e `create_person` (transacional; sem `p_force` devolve candidatos e não cria).

## Planejado (ver `implementation-plan.md`)
pages/page_versions/forms/submissions → pipelines/opportunities/tasks → services/products/contracts/sales/receivables/payments → appointments (exclusion constraint `tstzrange` por profissional) / packages / session_ledger → academy → partners → domain_events.
