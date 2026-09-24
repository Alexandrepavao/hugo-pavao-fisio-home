-- Teste do dashboard comercial do CRM (crm_dashboard_metrics/crm_card_detail, migration 042): um comercial
-- (sales) só vê os próprios negócios mesmo tentando forçar o filtro de responsável; gestor de unidade vê o
-- time inteiro e pode filtrar por responsável específico. Transação desfeita.
do $$
declare
  v_org uuid; v_ua uuid; u_sales1 uuid := gen_random_uuid(); u_sales2 uuid := gen_random_uuid(); u_um uuid := gen_random_uuid();
  pa1 uuid; pa2 uuid; pipe uuid; stage uuid; opp1 uuid; opp2 uuid; d jsonb; m1 jsonb; m2 jsonb; rep text := '';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_sales1,'authenticated','authenticated','crmtest1@t.local'),(u_sales2,'authenticated','authenticated','crmtest2@t.local'),(u_um,'authenticated','authenticated','crmtestum@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_sales1, v_org),(u_sales2, v_org),(u_um, v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_sales1, 'sales', v_ua),(v_org, u_sales2, 'sales', v_ua),(v_org, u_um, 'unit_manager', v_ua);
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Lead CRM Test 1') returning id into pa1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Lead CRM Test 2') returning id into pa2;
  select id into pipe from public.pipelines where org_id = v_org and kind = 'patients' limit 1;
  select id into stage from public.pipeline_stages where pipeline_id = pipe order by position limit 1;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, value_cents, status, created_by)
    values (v_org, v_ua, pa1, pipe, stage, u_sales1, 'Oportunidade CRM Test 1', 100000, 'open', u_sales1) returning id into opp1;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, value_cents, status, created_by)
    values (v_org, v_ua, pa2, pipe, stage, u_sales2, 'Oportunidade CRM Test 2', 200000, 'open', u_sales2) returning id into opp2;

  perform set_config('request.jwt.claims', json_build_object('sub', u_sales1, 'role','authenticated')::text, true);
  set local role authenticated;
  m1 := public.crm_dashboard_metrics(now() - interval '1 hour', now() + interval '1 hour', v_ua, null, null);
  rep := rep || format(E'\n[%s] comercial vê só a própria oportunidade em aberto (valor=%s, deveria ser 100000)', case when (m1->'open_value'->>'value')::numeric = 100000 then 'OK' else 'FALHA' end, m1->'open_value'->>'value');
  m1 := public.crm_dashboard_metrics(now() - interval '1 hour', now() + interval '1 hour', v_ua, u_sales2, null);
  rep := rep || format(E'\n[%s] comercial tentando ver dados de outro vendedor (p_owner) continua vendo só os próprios (valor=%s)', case when (m1->'open_value'->>'value')::numeric = 100000 then 'OK' else 'FALHA' end, m1->'open_value'->>'value');
  d := public.crm_card_detail('crm_open_deals', now() - interval '1 hour', now() + interval '1 hour', v_ua, null, null);
  rep := rep || format(E'\n[%s] crm_card_detail (comercial) só lista a própria oportunidade (%s item(ns))', case when jsonb_array_length(d->'items') = 1 then 'OK' else 'FALHA' end, jsonb_array_length(d->'items'));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_um, 'role','authenticated')::text, true);
  set local role authenticated;
  m2 := public.crm_dashboard_metrics(now() - interval '1 hour', now() + interval '1 hour', v_ua, null, null);
  rep := rep || format(E'\n[%s] gestor de unidade vê as duas oportunidades (valor=%s, deveria ser 300000)', case when (m2->'open_value'->>'value')::numeric = 300000 then 'OK' else 'FALHA' end, m2->'open_value'->>'value');
  m2 := public.crm_dashboard_metrics(now() - interval '1 hour', now() + interval '1 hour', v_ua, u_sales1, null);
  rep := rep || format(E'\n[%s] gestor de unidade filtra por responsável específico (valor=%s, deveria ser 100000)', case when (m2->'open_value'->>'value')::numeric = 100000 then 'OK' else 'FALHA' end, m2->'open_value'->>'value');
  reset role;

  raise exception E'RELATORIO_CRM_DASHBOARD (transação desfeita):%', rep;
end $$;
