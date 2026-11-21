-- Desempenho de RLS nas tabelas de log (achado da regressão de 20/11, Dev).
-- Para quem NÃO é gestor, `private.is_manager()` era avaliado linha a linha (23.585 linhas de audit_log ≈ 8,9 s > statement_timeout),
-- e a API devolvia 500 em vez de lista vazia. `(select ...)` vira InitPlan: o papel é avaliado UMA vez por consulta.
-- A regra de acesso NÃO muda (mesmas condições, mesma organização ativa).

alter policy audit_read on public.audit_log
  using (org_id = private.current_org() and (select private.is_manager()));

alter policy events_read on public.domain_events
  using (private.in_org(org_id) and (select private.is_manager()));

alter policy runs_read on public.automation_runs
  using (exists (
    select 1 from public.domain_events e
    where e.id = automation_runs.event_id and private.in_org(e.org_id) and (select private.is_manager())
  ));
