-- RELEASE v1 — S09: linhas de negócio em Recorrência (MRR/ARR), Relatórios de eficiência e Conciliação bancária. Cobre a migration 060 (depende da 057).
-- Fixtures numa unidade NOVA, valores calculados à mão. Transação sempre desfeita. Somente Dev/teste.
--  RECORRÊNCIA (mês corrente M; "ontem" = fim de M-1):
--    c1 Fisio mensal 300,00 (expande a 350,00 em M) · c2 Academy anual 1.200,00 = 100,00/mês · c3 Fisio nova em M 200,00
--    c4 sem produto 50,00 (cancelada em M) · c5 Academy 80,00 (pausada em M-1, retomada em M → reativação)
--    → Fisio: inicial 300, novo 200, expansão 50, final 550 · Academy: inicial 100, reativação 80, final 180 · Não classificado: inicial 50, cancelamento 50, final 0 · Geral 730.
--  EFICIÊNCIA: venda V1 (Fisio 100 + Academy 50, desconto 15) com recebimento 50,00 e estorno 10,00 → líquido Fisio 26,66 / Academy 13,34.
--  CONCILIAÇÃO: extrato com 7 movimentos; a linha vem do lançamento conciliado ou da alocação manual; o extrato original nunca muda.
do $$
declare
  v_org uuid; uz uuid; uy uuid; u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_umy uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  pa uuid; pb uuid; prA uuid; prB uuid; prU uuid; prPk uuid; svc uuid; prof uuid; pkg uuid; s1 uuid; s2 uuid; s3 uuid; rc uuid; py1 uuid; py2 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; e1 uuid; e3 uuid; acc uuid; imp jsonb; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; l7 uuid;
  a1 uuid; a2 uuid; d date := current_date + 3; t10 timestamptz; t11 timestamptz;
  m0 date := date_trunc('month', current_date)::date; m1 date := (date_trunc('month', current_date) - interval '1 month')::date; m2 date := (date_trunc('month', current_date) - interval '2 month')::date; m3 date := (date_trunc('month', current_date) - interval '3 month')::date;
  j jsonb; j2 jsonb; n bigint; n2 bigint; n3 bigint; a bigint; ok boolean; rep text := ''; h1 text; h2 text; k text;
  p_from timestamptz := now() - interval '1 day'; p_to timestamptz := now() + interval '30 days';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Z (teste S09)', 'teste-z-s09') returning id into uz;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Y (teste S09)', 'teste-y-s09') returning id into uy;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s09.local'),(u_sales,'authenticated','authenticated','s@s09.local'),
    (u_fin,'authenticated','authenticated','f@s09.local'),(u_umy,'authenticated','authenticated','umy@s09.local'),(u_phy,'authenticated','authenticated','phy@s09.local');
  insert into public.user_accounts (user_id, org_id, person_id) values (u_mgr, v_org, null),(u_sales, v_org, null),(u_fin, v_org, null),(u_umy, v_org, null),(u_phy, v_org, null);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', uz),(v_org, u_fin, 'finance', uz),(v_org, u_umy, 'unit_manager', uy),(v_org, u_phy, 'physio', uz);
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Pessoa A S09') returning id into pa;
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Pessoa B S09') returning id into pb;
  insert into public.products (org_id, kind, name, price_cents, business_line) values (v_org, 'service', 'Produto Fisio S09', 10000, 'physio') returning id into prA;
  insert into public.products (org_id, kind, name, price_cents, business_line) values (v_org, 'course', 'Produto Academy S09', 5000, 'academy') returning id into prB;
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'service', 'Produto sem linha S09', 2000) returning id into prU;

  -- ============================================================ A) RECORRÊNCIA
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  c1 := public.recurring_contract_start(pa, uz, prA, 'monthly', 30000, 0, m2);
  perform public.recurring_contract_change(c1, 'expansion', m0, 35000, 0, null);
  c2 := public.recurring_contract_start(pa, uz, prB, 'annual', 120000, 0, m2);
  c3 := public.recurring_contract_start(pb, uz, prA, 'monthly', 20000, 0, m0);
  c4 := public.recurring_contract_start(pa, uz, null, 'monthly', 5000, 0, m2);
  perform public.recurring_contract_change(c4, 'cancel', m0, null, 0, 'encerrou (teste S09)');
  c5 := public.recurring_contract_start(pb, uz, prB, 'monthly', 8000, 0, m3);
  perform public.recurring_contract_change(c5, 'pause', m1, null, 0, null);
  perform public.recurring_contract_change(c5, 'resume', m0, 8000, 0, null);

  j := public.mrr_by_line(current_date, uz);
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'physio';
  rep := rep || format(E'\n[%s] Fisioterapia: inicial 300,00 · novo 200,00 · expansão 50,00 · final 550,00 · ARR 6.600,00 (%s / %s / %s / %s / %s)',
    case when (j2 ->> 'mrr_inicial_cents')::bigint = 30000 and (j2 ->> 'novo_cents')::bigint = 20000 and (j2 ->> 'expansao_cents')::bigint = 5000 and (j2 ->> 'mrr_cents')::bigint = 55000 and (j2 ->> 'arr_cents')::bigint = 660000 then 'OK' else 'FALHA' end,
    j2 ->> 'mrr_inicial_cents', j2 ->> 'novo_cents', j2 ->> 'expansao_cents', j2 ->> 'mrr_cents', j2 ->> 'arr_cents');
  rep := rep || format(E'\n[%s] Fisioterapia: a ponte fecha, 2 clientes, 2 contratos, receita média por cliente 275,00 (%s / %s / %s / %s)',
    case when (j2 ->> 'ponte_fecha')::boolean and (j2 ->> 'clientes')::int = 2 and (j2 ->> 'contratos')::int = 2 and (j2 ->> 'receita_media_cliente_cents')::bigint = 27500 then 'OK' else 'FALHA' end,
    j2 ->> 'ponte_fecha', j2 ->> 'clientes', j2 ->> 'contratos', j2 ->> 'receita_media_cliente_cents');
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'academy';
  rep := rep || format(E'\n[%s] Academy: contrato anual vira 100,00/mês · inicial 100,00 · reativação 80,00 · final 180,00 (%s / %s / %s)',
    case when (j2 ->> 'mrr_inicial_cents')::bigint = 10000 and (j2 ->> 'reativacao_cents')::bigint = 8000 and (j2 ->> 'mrr_cents')::bigint = 18000 and (j2 ->> 'ponte_fecha')::boolean then 'OK' else 'FALHA' end,
    j2 ->> 'mrr_inicial_cents', j2 ->> 'reativacao_cents', j2 ->> 'mrr_cents');
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'unclassified';
  rep := rep || format(E'\n[%s] Não classificado (contrato sem produto): inicial 50,00 · cancelamento −50,00 · final 0 · churn de receita 100%% · churn de clientes 100%% (%s / %s / %s / %s)',
    case when (j2 ->> 'mrr_inicial_cents')::bigint = 5000 and (j2 ->> 'cancelamento_cents')::bigint = -5000 and (j2 ->> 'mrr_cents')::bigint = 0 and (j2 ->> 'churn_receita_pct')::numeric = 100.0 and (j2 ->> 'churn_clientes_pct')::numeric = 100.0 then 'OK' else 'FALHA' end,
    j2 ->> 'mrr_inicial_cents', j2 ->> 'cancelamento_cents', j2 ->> 'mrr_cents', j2 ->> 'churn_receita_pct');
  rep := rep || format(E'\n[%s] Geral: MRR 730,00 · ARR 8.760,00 · clientes distintos = 2 (a soma das linhas é 4 porque a pessoa conta em cada linha) (%s / %s / %s)',
    case when (j -> 'total' ->> 'mrr_cents')::bigint = 73000 and (j -> 'total' ->> 'arr_cents')::bigint = 876000 and (j -> 'total' ->> 'clientes')::int = 2 then 'OK' else 'FALHA' end,
    j -> 'total' ->> 'mrr_cents', j -> 'total' ->> 'arr_cents', j -> 'total' ->> 'clientes');
  rep := rep || format(E'\n[%s] conferência: a soma das linhas bate com mrr_report (inicial, novo, expansão, reativação, contração, cancelamento, MRR final, ARR) (ok=%s)', case when (j -> 'reconciliation' ->> 'ok')::boolean then 'OK' else 'FALHA' end, j -> 'reconciliation' ->> 'ok');
  select (public.mrr_report(current_date, uz) -> 'mrr_cents' ->> 'value')::bigint into n;
  rep := rep || format(E'\n[%s] a tela consolidada (mrr_report) segue igual e dá o mesmo MRR final do Geral por linha (%s)', case when n = 73000 then 'OK' else 'FALHA' end, n);
  j := public.mrr_history_by_line(3, uz);
  select x into j2 from jsonb_array_elements(j) x order by x ->> 'month' desc limit 1;
  rep := rep || format(E'\n[%s] histórico por linha: mês atual Fisio 550,00 · Academy 180,00 · Não classificado 0 · total 730,00 (soma das linhas = total) (%s / %s / %s / %s)',
    case when (j2 ->> 'physio')::bigint = 55000 and (j2 ->> 'academy')::bigint = 18000 and (j2 ->> 'unclassified')::bigint = 0 and (j2 ->> 'total')::bigint = 73000
         and (j2 ->> 'physio')::bigint + (j2 ->> 'academy')::bigint + (j2 ->> 'unclassified')::bigint = (j2 ->> 'total')::bigint then 'OK' else 'FALHA' end,
    j2 ->> 'physio', j2 ->> 'academy', j2 ->> 'unclassified', j2 ->> 'total');
  rep := rep || format(E'\n[%s] histórico: 3 meses (M-2, M-1, M)', case when jsonb_array_length(j) = 3 then 'OK' else 'FALHA' end);
  -- reclassificar o produto Fisio para Academy move todo o MRR dele e a conferência continua ok
  perform public.product_set_line(prA, 'academy');
  j := public.mrr_by_line(current_date, uz);
  select (x ->> 'mrr_cents')::bigint into n from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'physio';
  select (x ->> 'mrr_cents')::bigint into n2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'academy';
  rep := rep || format(E'\n[%s] reclassificar o produto move o MRR (Fisio 0 / Academy 730,00) e a conferência segue ok (%s / %s)', case when n = 0 and n2 = 73000 - 0 - 0 and (j -> 'reconciliation' ->> 'ok')::boolean then 'OK' else 'FALHA' end, n, n2);
  perform public.product_set_line(prA, 'physio');
  -- permissões
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  ok := false; begin perform public.mrr_by_line(current_date, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial NÃO abre o MRR por linha', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_umy, 'role','authenticated')::text, true);
  ok := false; begin perform public.mrr_by_line(current_date, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] gestor de OUTRA unidade NÃO abre o MRR por linha desta unidade', case when ok then 'OK' else 'FALHA' end);
  reset role; set local role anon;
  ok := false; begin perform public.mrr_by_line(current_date, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa mrr_by_line', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.mrr_history_by_line(3, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa mrr_history_by_line', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- ============================================================ B) EFICIÊNCIA
  insert into public.sales (org_id, unit_id, person_id, discount_cents) values (v_org, uz, pa, 1500) returning id into s1;
  insert into public.sale_items (org_id, sale_id, product_id, description, qty, unit_price_cents) values (v_org, s1, prA, 'Item A', 1, 10000),(v_org, s1, prB, 'Item B', 1, 5000);
  update public.sales set status = 'confirmed', sold_at = now() where id = s1;
  insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
    values (v_org, uz, s1, pa, prA, 1, 1, current_date + 5, date_trunc('month', current_date)::date, 13500, 'partial') returning id into rc;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, idempotency_key) values (v_org, uz, rc, 'payment', 5000, 's09-pay-1') returning id into py1;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, refund_of, idempotency_key) values (v_org, uz, rc, 'refund', 1000, py1, 's09-ref-1') returning id into py2;
  insert into public.sales (org_id, unit_id, person_id) values (v_org, uz, pb) returning id into s2;     -- só produto sem linha
  insert into public.sale_items (org_id, sale_id, product_id, description, qty, unit_price_cents) values (v_org, s2, prU, 'Item U', 1, 2000);
  update public.sales set status = 'confirmed', sold_at = now() where id = s2;
  insert into public.sales (org_id, unit_id, person_id) values (v_org, uz, pa) returning id into s3;     -- segunda compra da pessoa A na linha Fisio (recompra)
  insert into public.sale_items (org_id, sale_id, product_id, description, qty, unit_price_cents) values (v_org, s3, prA, 'Item A2', 1, 10000);
  update public.sales set status = 'confirmed', sold_at = now() where id = s3;
  -- atendimentos realizados: um do pacote Fisio e um avulso (sem pacote)
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy, 'Fisio S09') returning id into prof;
  insert into public.professional_units values (prof, uz);
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time) select v_org, prof, uz, w, '08:00', '18:00' from generate_series(0, 6) w;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão S09', 60) returning id into svc;
  insert into public.products (org_id, kind, name, sessions_count, service_id, business_line) values (v_org, 'package', 'Pacote Fisio S09', 4, svc, 'physio') returning id into prPk;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, uz, pa, prPk, 4) returning id into pkg;
  insert into public.session_ledger (org_id, client_package_id, delta, reason) values (v_org, pkg, 4, 'grant');
  t10 := (d + time '10:00') at time zone 'America/Sao_Paulo'; t11 := (d + time '11:00') at time zone 'America/Sao_Paulo';
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  a1 := public.book_appointment(pa, uz, prof, svc, t10, pkg);
  a2 := public.book_appointment(pb, uz, prof, svc, t11);
  -- comparecimento só existe para horário que já passou: leva os dois atendimentos para poucas horas atrás (dentro da janela do relatório)
  reset role; update public.appointments set period = tstzrange(now() - interval '3 hours', now() - interval '2 hours') where id = a1;
  update public.appointments set period = tstzrange(now() - interval '5 hours', now() - interval '4 hours') where id = a2; set local role authenticated;
  perform public.set_appointment_status(a1, 'attended'); perform public.set_appointment_status(a2, 'attended');

  j := public.efficiency_by_line(p_from, p_to, uz);
  rep := rep || format(E'\n[%s] eficiência: conferência com o Geral (recebido líquido e atendimentos realizados) (ok=%s)', case when (j -> 'reconciliation' ->> 'ok')::boolean then 'OK' else 'FALHA' end, j -> 'reconciliation' ->> 'ok');
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'physio';
  rep := rep || format(E'\n[%s] Fisioterapia: recebido líquido 26,66 · 1 paciente pagante · 1 atendimento · receita por paciente 26,66 · por sessão 26,66 · recompra 100%% (%s / %s / %s / %s / %s / %s)',
    case when (j2 ->> 'net_received_cents')::bigint = 2666 and (j2 ->> 'paying_patients')::int = 1 and (j2 ->> 'attended_sessions')::int = 1 and (j2 ->> 'revenue_per_patient_cents')::bigint = 2666
         and (j2 ->> 'revenue_per_session_cents')::bigint = 2666 and (j2 ->> 'repurchase_pct')::numeric = 100.0 then 'OK' else 'FALHA' end,
    j2 ->> 'net_received_cents', j2 ->> 'paying_patients', j2 ->> 'attended_sessions', j2 ->> 'revenue_per_patient_cents', j2 ->> 'revenue_per_session_cents', j2 ->> 'repurchase_pct');
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'academy';
  rep := rep || format(E'\n[%s] Academy: recebido líquido 13,34 · 1 paciente pagante · 0 atendimentos (receita por sessão indisponível) · recompra 0%% (%s / %s / %s / %s / %s)',
    case when (j2 ->> 'net_received_cents')::bigint = 1334 and (j2 ->> 'paying_patients')::int = 1 and (j2 ->> 'attended_sessions')::int = 0 and j2 -> 'revenue_per_session_cents' = 'null'::jsonb and (j2 ->> 'repurchase_pct')::numeric = 0.0 then 'OK' else 'FALHA' end,
    j2 ->> 'net_received_cents', j2 ->> 'paying_patients', j2 ->> 'attended_sessions', j2 ->> 'revenue_per_session_cents', j2 ->> 'repurchase_pct');
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'unclassified';
  rep := rep || format(E'\n[%s] Não classificado: venda só de produto sem linha (1 paciente) e o atendimento avulso sem pacote (1) (%s / %s)', case when (j2 ->> 'paying_patients')::int = 1 and (j2 ->> 'attended_sessions')::int = 1 then 'OK' else 'FALHA' end, j2 ->> 'paying_patients', j2 ->> 'attended_sessions');
  rep := rep || format(E'\n[%s] Geral: recebido líquido 40,00 · 2 pacientes distintos (a soma das linhas é 3) · 2 atendimentos · 1 recomprador (%s / %s / %s / %s)',
    case when (j -> 'general' ->> 'net_received_cents')::bigint = 4000 and (j -> 'general' ->> 'paying_patients')::int = 2 and (j -> 'general' ->> 'attended_sessions')::int = 2 and (j -> 'general' ->> 'repeat_buyers')::int = 1 then 'OK' else 'FALHA' end,
    j -> 'general' ->> 'net_received_cents', j -> 'general' ->> 'paying_patients', j -> 'general' ->> 'attended_sessions', j -> 'general' ->> 'repeat_buyers');
  select count(*) into n from jsonb_array_elements(j -> 'concentration') x where x ->> 'product_name' = 'Produto Fisio S09' and x ->> 'business_line' = 'physio' and (x ->> 'received_cents')::bigint = 4000 and (x ->> 'share_pct_of_line')::numeric = 100.0;
  rep := rep || format(E'\n[%s] concentração por produto traz a linha do produto e a participação dentro da linha (Fisio 100%%)', case when n = 1 then 'OK' else 'FALHA' end);
  -- o relatório consolidado existente não mudou
  j2 := public.efficiency_report(p_from, p_to, uz);
  rep := rep || format(E'\n[%s] efficiency_report (consolidado) segue igual: receita por sessão = 40,00 ÷ 2 = 20,00 (%s)', case when (j2 -> 'receita_por_sessao_cents' ->> 'value')::bigint = 2000 then 'OK' else 'FALHA' end, j2 -> 'receita_por_sessao_cents' ->> 'value');
  j := public.efficiency_by_line(now() + interval '400 days', now() + interval '401 days', uz);
  rep := rep || format(E'\n[%s] período sem movimento: recebido e atendimentos zero, conferência ok, sem inventar índices', case when (j -> 'general' ->> 'net_received_cents')::bigint = 0 and (j -> 'reconciliation' ->> 'ok')::boolean and j -> 'general' -> 'revenue_per_session_cents' = 'null'::jsonb then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  ok := false; begin perform public.efficiency_by_line(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial NÃO abre a eficiência por linha', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_umy, 'role','authenticated')::text, true);
  ok := false; begin perform public.efficiency_by_line(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] gestor de OUTRA unidade NÃO abre a eficiência desta unidade', case when ok then 'OK' else 'FALHA' end);
  reset role; set local role anon;
  ok := false; begin perform public.efficiency_by_line(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa efficiency_by_line', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- ============================================================ C) CONCILIAÇÃO BANCÁRIA
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at, business_line) values (v_org, uz, 'Desp Fisio S09', 10000, current_date, date_trunc('month', current_date)::date, 'paid', now(), 'physio') returning id into e1;
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at, business_line) values (v_org, uz, 'Desp Rateada S09', 1000, current_date, date_trunc('month', current_date)::date, 'paid', now(), 'shared') returning id into e3;
  insert into public.payable_allocations (payable_id, line, basis_points) values (e3, 'physio', 6000),(e3, 'academy', 4000);
  insert into public.financial_accounts (org_id, unit_id, name) values (v_org, uz, 'Conta S09') returning id into acc;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  imp := public.bank_statement_import(acc, jsonb_build_array(
    jsonb_build_object('date', current_date, 'description', 'Recebimento S09', 'amount_cents', 5000, 'ref', 'R1'),
    jsonb_build_object('date', current_date, 'description', 'Pagamento Fisio S09', 'amount_cents', -10000, 'ref', 'R2'),
    jsonb_build_object('date', current_date, 'description', 'Pagamento rateado S09', 'amount_cents', -1000, 'ref', 'R3'),
    jsonb_build_object('date', current_date, 'description', 'Credito avulso S09', 'amount_cents', 2500, 'ref', 'R4'),
    jsonb_build_object('date', current_date, 'description', 'Tarifa S09', 'amount_cents', -333, 'ref', 'R5'),
    jsonb_build_object('date', current_date, 'description', 'Transferencia propria S09', 'amount_cents', -777, 'ref', 'R6'),
    jsonb_build_object('date', current_date, 'description', 'Credito pequeno S09', 'amount_cents', 100, 'ref', 'R7')));
  reset role;
  select id into l1 from public.bank_statement_lines where import_id = (imp ->> 'import_id')::uuid and external_ref = 'R1';
  select id into l2 from public.bank_statement_lines where import_id = (imp ->> 'import_id')::uuid and external_ref = 'R2';
  select id into l3 from public.bank_statement_lines where import_id = (imp ->> 'import_id')::uuid and external_ref = 'R3';
  select id into l4 from public.bank_statement_lines where import_id = (imp ->> 'import_id')::uuid and external_ref = 'R4';
  select id into l5 from public.bank_statement_lines where import_id = (imp ->> 'import_id')::uuid and external_ref = 'R5';
  select id into l6 from public.bank_statement_lines where import_id = (imp ->> 'import_id')::uuid and external_ref = 'R6';
  select id into l7 from public.bank_statement_lines where import_id = (imp ->> 'import_id')::uuid and external_ref = 'R7';
  select md5(string_agg(concat_ws('|', txn_date, description, amount_cents, external_ref), ';' order by external_ref)) into h1 from public.bank_statement_lines where import_id = (imp ->> 'import_id')::uuid;
  rep := rep || format(E'\n[%s] extrato importado: 7 movimentos', case when (imp ->> 'inserted')::int = 7 then 'OK' else 'FALHA' end);

  set local role authenticated;
  -- antes de qualquer conciliação/alocação: tudo "sem alocação"
  select count(*) into n from public.bank_line_shares(array[l1, l2, l3, l4, l5, l6, l7]) where bucket = 'unclassified' and origin = 'sem_alocacao';
  rep := rep || format(E'\n[%s] sem conciliação nem alocação, cada movimento é "Não classificado" (7 de 7: %s)', case when n = 7 then 'OK' else 'FALHA' end, n);
  -- alocação manual antes de conciliar e depois conciliar: a alocação sai (não conta duas vezes)
  perform public.bank_line_set_allocation(l1, '[{"line":"physio","basis_points":10000}]'::jsonb);
  select sum(cents) filter (where bucket = 'physio'), count(*) into n, n2 from public.bank_line_shares(array[l1]) where origin = 'alocacao_manual';
  rep := rep || format(E'\n[%s] alocação manual 100%% Fisio antes de conciliar vale 50,00 (%s)', case when n = 5000 and n2 = 1 then 'OK' else 'FALHA' end, n);
  perform public.bank_reconcile_confirm(l1, py1, null);
  select count(*) into n from public.bank_line_allocations where statement_line_id = l1;
  rep := rep || format(E'\n[%s] ao conciliar, a alocação manual é removida (não conta duas vezes) (%s restantes)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select cents into n from public.bank_line_shares(array[l1]) where bucket = 'physio' and origin = 'recebimento'; select cents into n2 from public.bank_line_shares(array[l1]) where bucket = 'academy' and origin = 'recebimento';
  rep := rep || format(E'\n[%s] recebimento conciliado herda a divisão da venda V1: 50,00 = Fisio 33,33 + Academy 16,67 (%s / %s)', case when n = 3333 and n2 = 1667 then 'OK' else 'FALHA' end, n, n2);
  ok := false; begin perform public.bank_line_set_allocation(l1, '[{"line":"academy","basis_points":10000}]'::jsonb); exception when others then ok := sqlerrm like '%conciliado%'; end;
  rep := rep || format(E'\n[%s] movimento conciliado NÃO aceita alocação manual (a linha vem do lançamento)', case when ok then 'OK' else 'FALHA' end);
  perform public.bank_reconcile_confirm(l2, null, e1);
  perform public.bank_reconcile_confirm(l3, null, e3);
  select sum(cents) into n from public.bank_line_shares(array[l2]) where bucket = 'physio' and origin = 'conta_a_pagar';
  rep := rep || format(E'\n[%s] conta paga conciliada: saída −100,00 inteira na linha Fisio, com sinal negativo (%s)', case when n = -10000 then 'OK' else 'FALHA' end, n);
  select cents into n from public.bank_line_shares(array[l3]) where bucket = 'physio'; select cents into n2 from public.bank_line_shares(array[l3]) where bucket = 'academy'; select sum(cents) into n3 from public.bank_line_shares(array[l3]);
  rep := rep || format(E'\n[%s] conta rateada 60/40 conciliada: −10,00 = Fisio −6,00 + Academy −4,00 (soma exata) (%s / %s / %s)', case when n = -600 and n2 = -400 and n3 = -1000 then 'OK' else 'FALHA' end, n, n2, n3);
  -- movimentos pendentes/ignorado com alocação manual
  perform public.bank_line_set_allocation(l4, '[{"line":"physio","basis_points":7000},{"line":"academy","basis_points":3000}]'::jsonb);
  select cents into n from public.bank_line_shares(array[l4]) where bucket = 'physio'; select cents into n2 from public.bank_line_shares(array[l4]) where bucket = 'academy';
  rep := rep || format(E'\n[%s] entrada pendente 25,00 alocada 70/30: Fisio 17,50 + Academy 7,50 (%s / %s)', case when n = 1750 and n2 = 750 then 'OK' else 'FALHA' end, n, n2);
  perform public.bank_line_set_allocation(l7, '[{"line":"physio","basis_points":3333},{"line":"academy","basis_points":6667}]'::jsonb);
  select cents into n from public.bank_line_shares(array[l7]) where bucket = 'physio'; select cents into n2 from public.bank_line_shares(array[l7]) where bucket = 'academy';
  rep := rep || format(E'\n[%s] 1,00 em 33,33%%/66,67%%: 0,33 + 0,67 (o centavo de resto vai à linha de maior resto; soma exata) (%s / %s)', case when n = 33 and n2 = 67 then 'OK' else 'FALHA' end, n, n2);
  perform public.bank_reconcile_ignore(l6, 'transferência entre contas próprias');
  perform public.bank_line_set_allocation(l6, '[{"line":"shared","basis_points":10000}]'::jsonb);
  select cents into n from public.bank_line_shares(array[l6]) where bucket = 'shared' and origin = 'alocacao_manual';
  rep := rep || format(E'\n[%s] movimento IGNORADO também pode ser alocado (saída −7,77 em compartilhado) (%s)', case when n = -777 then 'OK' else 'FALHA' end, n);
  -- validações
  ok := false; begin perform public.bank_line_set_allocation(l5, '[{"line":"physio","basis_points":5000},{"line":"academy","basis_points":4000}]'::jsonb); exception when others then ok := sqlerrm like '%somar 100%'; end;
  rep := rep || format(E'\n[%s] alocação que não soma 100%% é recusada', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.bank_line_set_allocation(l5, '[{"line":"physio","basis_points":5000},{"line":"physio","basis_points":5000}]'::jsonb); exception when others then ok := sqlerrm like '%repetida%'; end;
  rep := rep || format(E'\n[%s] alocação com linha repetida é recusada', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.bank_line_set_allocation(l5, '[{"line":"unclassified","basis_points":10000}]'::jsonb); exception when others then ok := sqlerrm like '%desconhecida%'; end;
  rep := rep || format(E'\n[%s] "não classificado" não é alocação (remove-se a alocação em vez disso)', case when ok then 'OK' else 'FALHA' end);
  perform public.bank_line_set_allocation(l5, '[{"line":"academy","basis_points":10000}]'::jsonb); perform public.bank_line_set_allocation(l5, null);
  select count(*) into n from public.bank_line_shares(array[l5]) where bucket = 'unclassified' and origin = 'sem_alocacao';
  rep := rep || format(E'\n[%s] remover a alocação devolve o movimento a "Não classificado"', case when n = 1 then 'OK' else 'FALHA' end);

  -- quadro por linha e conferência com o extrato
  j := public.bank_by_line(current_date, current_date + 1, uz, acc);
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'physio';
  rep := rep || format(E'\n[%s] Fisioterapia: entradas 51,16 (33,33 + 17,50 + 0,33) · saídas 106,00 (100,00 + 6,00) (%s / %s)', case when (j2 ->> 'inflow_cents')::bigint = 5116 and (j2 ->> 'outflow_cents')::bigint = 10600 then 'OK' else 'FALHA' end, j2 ->> 'inflow_cents', j2 ->> 'outflow_cents');
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'academy';
  rep := rep || format(E'\n[%s] Academy: entradas 24,84 (16,67 + 7,50 + 0,67) · saídas 4,00 (%s / %s)', case when (j2 ->> 'inflow_cents')::bigint = 2484 and (j2 ->> 'outflow_cents')::bigint = 400 then 'OK' else 'FALHA' end, j2 ->> 'inflow_cents', j2 ->> 'outflow_cents');
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'shared';
  rep := rep || format(E'\n[%s] Compartilhado: saídas 7,77 (movimento ignorado alocado) · entradas 0 (%s / %s)', case when (j2 ->> 'outflow_cents')::bigint = 777 and (j2 ->> 'inflow_cents')::bigint = 0 then 'OK' else 'FALHA' end, j2 ->> 'outflow_cents', j2 ->> 'inflow_cents');
  select x into j2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'unclassified';
  rep := rep || format(E'\n[%s] Não classificado: saída 3,33 (tarifa sem alocação) (%s)', case when (j2 ->> 'outflow_cents')::bigint = 333 and (j2 ->> 'inflow_cents')::bigint = 0 then 'OK' else 'FALHA' end, j2 ->> 'outflow_cents');
  rep := rep || format(E'\n[%s] Geral = extrato: entradas 76,00 · saídas 121,10 · saldo −45,10 — entradas e saídas separadas, sem compensar (%s / %s / %s)',
    case when (j -> 'total' ->> 'inflow_cents')::bigint = 7600 and (j -> 'total' ->> 'outflow_cents')::bigint = 12110 and (j -> 'total' ->> 'net_cents')::bigint = -4510 then 'OK' else 'FALHA' end,
    j -> 'total' ->> 'inflow_cents', j -> 'total' ->> 'outflow_cents', j -> 'total' ->> 'net_cents');
  rep := rep || format(E'\n[%s] conferência: soma das linhas = extrato original (entradas, saídas, saldo) (ok=%s)', case when (j -> 'reconciliation' ->> 'ok')::boolean then 'OK' else 'FALHA' end, j -> 'reconciliation' ->> 'ok');
  rep := rep || format(E'\n[%s] situação do extrato: 3 conciliados · 1 ignorado · 3 pendentes (%s / %s / %s); 1 movimento sem linha (%s)',
    case when (j -> 'statement' ->> 'matched')::int = 3 and (j -> 'statement' ->> 'ignored')::int = 1 and (j -> 'statement' ->> 'unmatched')::int = 3 and (j ->> 'unallocated_movements')::int = 1 then 'OK' else 'FALHA' end,
    j -> 'statement' ->> 'matched', j -> 'statement' ->> 'ignored', j -> 'statement' ->> 'unmatched', j ->> 'unallocated_movements');
  j := public.bank_by_line(current_date + 400, current_date + 401, uz, acc);
  rep := rep || format(E'\n[%s] período sem movimento: tudo zero e conferência ok', case when (j -> 'total' ->> 'inflow_cents')::bigint = 0 and (j -> 'total' ->> 'outflow_cents')::bigint = 0 and (j -> 'reconciliation' ->> 'ok')::boolean then 'OK' else 'FALHA' end);
  -- desfazer a conciliação: a linha volta a depender de alocação (não herda nada)
  perform public.bank_reconcile_undo(l1);
  select count(*) into n from public.bank_line_shares(array[l1]) where bucket = 'unclassified' and origin = 'sem_alocacao';
  rep := rep || format(E'\n[%s] desfazer a conciliação devolve o movimento a "Não classificado" (a alocação antiga já tinha saído) (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  perform public.bank_reconcile_confirm(l1, py1, null);

  -- o extrato original NUNCA é alterado pela linha de negócio
  reset role;
  select md5(string_agg(concat_ws('|', txn_date, description, amount_cents, external_ref), ';' order by external_ref)) into h2 from public.bank_statement_lines where import_id = (imp ->> 'import_id')::uuid;
  rep := rep || format(E'\n[%s] extrato original intacto: data, descrição, valor e referência idênticos depois de todas as alocações e conciliações', case when h1 = h2 then 'OK' else 'FALHA' end);
  select count(*) into n from public.audit_log where entity_type = 'bank_line_allocations' and actor_user_id = u_fin;
  rep := rep || format(E'\n[%s] alocações ficam auditadas com o autor (%s registros)', case when n >= 6 then 'OK' else 'FALHA' end, n);

  -- permissões
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.bank_line_set_allocation(l5, '[{"line":"physio","basis_points":10000}]'::jsonb); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial NÃO aloca movimento bancário', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.bank_line_shares(array[l1, l2, l3, l4, l5, l6, l7]);
  rep := rep || format(E'\n[%s] comercial não lê a linha dos movimentos (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_umy, 'role','authenticated')::text, true);
  ok := false; begin perform public.bank_line_set_allocation(l5, '[{"line":"physio","basis_points":10000}]'::jsonb); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] gestor de OUTRA unidade NÃO aloca movimento desta unidade', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.bank_line_shares(array[l1, l2, l3, l4, l5, l6, l7]);
  rep := rep || format(E'\n[%s] gestor de outra unidade não lê a linha dos movimentos (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  j := public.bank_by_line(current_date, current_date + 1, uz, acc);
  rep := rep || format(E'\n[%s] gestor de outra unidade vê zero movimento no quadro desta unidade (%s)', case when (j -> 'statement' ->> 'movements')::int = 0 then 'OK' else 'FALHA' end, j -> 'statement' ->> 'movements');
  select count(*) into n from public.bank_line_allocations;
  rep := rep || format(E'\n[%s] gestor de outra unidade não lê alocações (RLS) (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  ok := true; begin insert into public.bank_line_allocations (statement_line_id, line, basis_points) values (l5, 'physio', 10000); ok := false; exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] nem o financeiro escreve direto na tabela de alocações (só pela função validada)', case when ok then 'OK' else 'FALHA' end);
  reset role; set local role anon;
  ok := false; begin perform public.bank_line_set_allocation(l5, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa bank_line_set_allocation', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.bank_by_line(current_date, current_date + 1, uz, acc); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa bank_by_line', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform * from public.bank_line_shares(array[l1]); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa bank_line_shares', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_S09_LINHAS_RECORRENCIA_EFICIENCIA_CONCILIACAO (transação desfeita):%', rep;
end $$;
