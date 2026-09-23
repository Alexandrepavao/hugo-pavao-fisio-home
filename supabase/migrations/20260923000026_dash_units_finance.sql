-- HP Group Hub — 026 Corrige private.dash_units(): só devolvia unidades para manager/ops_admin (org-wide) ou
-- unit_manager (suas unidades) — o papel "finance" ficava de fora, apesar de private.can_finance() e a rota
-- /admin/financeiro (App.tsx, R.finance) já incluírem "finance". Resultado real: um usuário só com o papel
-- financeiro batia "sem permissão para o painel" em TODAS as RPCs de relatório do Financeiro (mrr_report,
-- dre_report, cash_flow_monthly, overdue_aging, efficiency_report, revenue_by_unit, geo_distribution,
-- dashboard_metrics, dashboard_alerts) mesmo tendo acesso liberado pela navegação. Encontrado ao testar o
-- MRR com um usuário "finance" (ver supabase/tests/013_mrr_contracts.sql).
create or replace function private.dash_units(p_unit uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v uuid[];
begin
  if v_org is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  if private.has_org_role(array['manager','ops_admin']::public.app_role[]) then
    select array_agg(id) into v from public.units where org_id = v_org and (p_unit is null or id = p_unit);
  else
    select array_agg(distinct ra.unit_id) into v from public.role_assignments ra
     where ra.user_id = (select auth.uid()) and ra.role = any (array['unit_manager','finance']::public.app_role[]) and ra.unit_id is not null and ra.revoked_at is null
       and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()) and (p_unit is null or ra.unit_id = p_unit);
  end if;
  if v is null then raise exception 'sem permissão para o painel' using errcode = '42501'; end if;
  return v;
end $$;
