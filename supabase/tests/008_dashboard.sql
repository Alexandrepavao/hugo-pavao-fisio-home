-- Teste do dashboard: indisponível sem dados, cálculo sobre dados reais, escopo por perfil/unidade. Transação desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; v_ub uuid; u_mgr uuid := gen_random_uuid(); u_umA uuid := gen_random_uuid(); u_umB uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid();
  pa uuid; prod uuid; acct uuid; s1 uuid; s2 uuid; r1 uuid; m jsonb; n int; ok boolean; rep text := ''; a jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste)', 'teste-b') returning id into v_ub;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@t.local'),(u_umA,'authenticated','authenticated','a@t.local'),(u_umB,'authenticated','authenticated','b@t.local'),(u_sales,'authenticated','authenticated','s@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_mgr, v_org),(u_umA, v_org),(u_umB, v_org),(u_sales, v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_umA, 'unit_manager', v_ua),(v_org, u_umB, 'unit_manager', v_ub),(v_org, u_sales, 'sales', v_ua);
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Cliente Dash') returning id into pa;
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'service', 'Serviço dash (teste)', 40000) returning id into prod;
  insert into public.financial_accounts (org_id, name) values (v_org, 'Conta dash') returning id into acct;

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  m := public.dashboard_metrics(now() - interval '30 days', now() + interval '1 day', v_ua);
  rep := rep || format(E'\n[%s] sem dados: visitas, recebimentos, NPS e custo de aquisição aparecem como indisponíveis (não zero)',
    case when not (m -> 'visits' ->> 'available')::boolean and not (m -> 'receipts_cents' ->> 'available')::boolean and not (m -> 'nps' ->> 'available')::boolean
              and not (m -> 'acquisition_cost' ->> 'available')::boolean and (m -> 'receipts_cents' -> 'value') = 'null'::jsonb then 'OK' else 'FALHA' end);
  s1 := public.sale_create(pa, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod)), 0, 2, current_date - 20);   -- 2 parcelas de 20000; só a 1ª está vencida
  perform public.sale_confirm(s1);
  reset role;
  select id into r1 from public.receivables where sale_id = s1 and installment_no = 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.payment_record(r1, 5000, now(), 'pix', acct, 'dash-1');
  m := public.dashboard_metrics(now() - interval '30 days', now() + interval '1 day', null);
  rep := rep || format(E'\n[%s] recebimentos calculados sobre pagamentos persistidos (%s)', case when (m -> 'receipts_cents' ->> 'value')::bigint = 5000 then 'OK' else 'FALHA' end, m -> 'receipts_cents' ->> 'value');
  rep := rep || format(E'\n[%s] ticket médio = total da venda confirmada (%s)', case when (m -> 'average_ticket_cents' ->> 'value')::bigint = 40000 then 'OK' else 'FALHA' end, m -> 'average_ticket_cents' ->> 'value');
  rep := rep || format(E'\n[%s] inadimplência = saldo vencido (15000 = 20000-5000) (%s)', case when (m -> 'overdue_cents' ->> 'value')::bigint = 15000 then 'OK' else 'FALHA' end, m -> 'overdue_cents' ->> 'value');
  rep := rep || format(E'\n[%s] previsão a receber (contratado) separada da projeção de mensalidades', case when m ? 'forecast_receivables_30d_cents' and m ? 'forecast_subscriptions_next_month_cents' then 'OK' else 'FALHA' end);
  a := public.dashboard_alerts(null);
  rep := rep || format(E'\n[%s] alertas acionáveis (cobranças vencidas=%s)', case when jsonb_array_length(a) = 6 and (a -> 1 ->> 'count')::int = 1 then 'OK' else 'FALHA' end, a -> 1 ->> 'count');
  select count(*) into n from public.cash_flow_monthly(current_date - 60, current_date + 60, null) where realized_in_cents = 5000;
  rep := rep || format(E'\n[%s] fluxo de caixa mensal traz realizado do mês', case when n = 1 then 'OK' else 'FALHA' end);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_umA, 'role','authenticated')::text, true);
  set local role authenticated;
  m := public.dashboard_metrics(now() - interval '30 days', now() + interval '1 day', null);
  rep := rep || format(E'\n[%s] gestor da unidade A vê números da sua unidade (%s)', case when (m -> 'receipts_cents' ->> 'value')::bigint = 5000 then 'OK' else 'FALHA' end, m -> 'receipts_cents' ->> 'value');
  ok := false; begin perform public.dashboard_metrics(now() - interval '30 days', now(), v_ub); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] gestor da unidade A não consulta a unidade B', case when ok then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_umB, 'role','authenticated')::text, true);
  set local role authenticated;
  m := public.dashboard_metrics(now() - interval '30 days', now() + interval '1 day', null);
  rep := rep || format(E'\n[%s] gestor da unidade B não enxerga recebimentos da A (indisponível)', case when not (m -> 'receipts_cents' ->> 'available')::boolean then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.dashboard_metrics(now() - interval '30 days', now(), null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial não acessa o dashboard consolidado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.dashboard_alerts(null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial não acessa alertas do gestor', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_DASHBOARD (transação desfeita):%', rep;
end $$;
