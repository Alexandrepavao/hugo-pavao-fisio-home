-- Teste de permissão das metas do CRM (crm_goals/crm_goal_progress, migration 043): só quem gerencia
-- (manager/ops_admin/unit_manager) cadastra meta — um comercial comum não cria a própria meta nem vê a meta
-- de outra pessoa. Transação desfeita.
do $$
declare
  v_org uuid; v_ua uuid; u_sales uuid := gen_random_uuid(); u_um uuid := gen_random_uuid();
  ok boolean; rep text := '';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_sales,'authenticated','authenticated','crmgoaltest-s@t.local'),(u_um,'authenticated','authenticated','crmgoaltest-u@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_sales, v_org),(u_um, v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_sales, 'sales', v_ua),(v_org, u_um, 'unit_manager', v_ua);

  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.crm_goals (org_id, user_id, period_start, target_value_cents) values (v_org, u_sales, date_trunc('month', current_date)::date, 100000); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial não cria a própria meta (só quem gerencia cadastra)', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.crm_goal_progress(u_um, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial não vê a meta de outra pessoa via crm_goal_progress', case when ok then 'OK' else 'FALHA' end);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_um, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := true; begin insert into public.crm_goals (org_id, user_id, period_start, target_value_cents) values (v_org, u_sales, date_trunc('month', current_date)::date, 100000); exception when others then ok := false; end;
  rep := rep || format(E'\n[%s] gestor de unidade cria meta para um comercial', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_CRM_GOALS_PERMISSOES (transação desfeita):%', rep;
end $$;
