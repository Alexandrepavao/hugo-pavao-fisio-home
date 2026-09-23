-- Teste de vendas, recebimentos e projeção. Transação desfeita ao final. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; v_ub uuid; v_pipe uuid; v_edu uuid;
  u_mgr uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_finb uuid := gen_random_uuid(); u_mem uuid := gen_random_uuid();
  pa uuid; pb uuid; px uuid; py uuid; pz uuid; pw uuid; svc uuid; prod_pkg uuid; prod_sub uuid; prod_edu uuid; acct uuid;
  opp uuid; opp_edu uuid; s1 uuid; s2 uuid; sx uuid; sy uuid; sz uuid; sw uuid; sc uuid; r1 uuid; r2 uuid; r3 uuid; pay1 uuid; pay2 uuid; pay3 uuid; rx uuid; ry uuid; rz uuid;
  n bigint; m int; ok boolean; rep text := ''; st text; stage text; lm date := (date_trunc('month', current_date) - interval '1 month')::date; l2m date := (date_trunc('month', current_date) - interval '2 month')::date;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste)', 'teste-b') returning id into v_ub;
  select id into v_pipe from public.pipelines where org_id = v_org and kind = 'patients';
  select id into v_edu from public.pipelines where org_id = v_org and kind = 'education';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@t.local'),(u_fin,'authenticated','authenticated','f@t.local'),
    (u_sales,'authenticated','authenticated','s@t.local'),(u_finb,'authenticated','authenticated','fb@t.local'),(u_mem,'authenticated','authenticated','mem@t.local');
  insert into public.people (org_id, unit_id, full_name) select v_org, v_ua, x from unnest(array['Pessoa A','Pessoa B','Pessoa X','Pessoa Y','Pessoa Z','Pessoa W']) x;
  select id into pa from public.people where full_name = 'Pessoa A' and org_id = v_org order by created_at desc limit 1;
  select id into pb from public.people where full_name = 'Pessoa B' and org_id = v_org order by created_at desc limit 1;
  select id into px from public.people where full_name = 'Pessoa X' order by created_at desc limit 1; select id into py from public.people where full_name = 'Pessoa Y' order by created_at desc limit 1;
  select id into pz from public.people where full_name = 'Pessoa Z' order by created_at desc limit 1; select id into pw from public.people where full_name = 'Pessoa W' order by created_at desc limit 1;
  insert into public.user_accounts (user_id, org_id, person_id) values (u_mgr, v_org, null),(u_fin, v_org, null),(u_sales, v_org, null),(u_finb, v_org, null),(u_mem, v_org, pa);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_fin, 'finance', v_ua),(v_org, u_sales, 'sales', v_ua),(v_org, u_finb, 'finance', v_ub),(v_org, u_mem, 'member', null);
  insert into public.services (org_id, name, duration_min, price_cents) values (v_org, 'Sessão fin (teste)', 60, 15000) returning id into svc;
  insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id, validity_days) values (v_org, 'package', 'Pacote 10 (teste)', 100000, 10, svc, 180) returning id into prod_pkg;
  insert into public.products (org_id, kind, name, price_cents, recurrence) values (v_org, 'plan', 'Plano mensal (teste)', 30000, 'monthly') returning id into prod_sub;
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'mentoring', 'Mentoria (teste)', 200000) returning id into prod_edu;
  insert into public.financial_accounts (org_id, name) values (v_org, 'Conta teste') returning id into acct;
  insert into public.commission_rules (org_id, name, product_id, beneficiary_user_id, percent_bp) values (v_org, 'Comissão 10%', prod_pkg, u_sales, 1000);
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title)
    select v_org, v_ua, pa, v_pipe, id, 'Opp checkup' from public.pipeline_stages where pipeline_id = v_pipe and position = 1 returning id into opp;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title)
    select v_org, v_ua, pb, v_edu, id, 'Opp mentoria' from public.pipeline_stages where pipeline_id = v_edu and position = 1 returning id into opp_edu;

  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  -- JORNADA CHECKUP: pacote R$1.000,00 com 5.000 de desconto? (desconto 10000 => total 90000), 3 parcelas
  s1 := public.sale_create(pa, v_ua, opp, jsonb_build_array(jsonb_build_object('product_id', prod_pkg)), 10000, 3, current_date, 'venda teste');
  select total_cents into n from public.sales where id = s1;
  rep := rep || format(E'\n[%s] total = subtotal - desconto (%s centavos)', case when n = 90000 then 'OK' else 'FALHA' end, n);
  perform public.sale_confirm(s1); perform public.sale_confirm(s1);
  select count(*), sum(amount_cents) into m, n from public.receivables where sale_id = s1;
  rep := rep || format(E'\n[%s] 3 parcelas somam exatamente o total (parcelas=%s soma=%s), confirmar 2x não duplica', case when m = 3 and n = 90000 then 'OK' else 'FALHA' end, m, n);
  select count(*) into m from public.contracts where sale_id = s1; rep := rep || format(E'\n[%s] contrato criado uma vez (%s)', case when m = 1 then 'OK' else 'FALHA' end, m);
  reset role;
  select count(*) into m from public.domain_events where idempotency_key = 'sale.confirmed:' || s1; rep := rep || format(E'\n[%s] evento sale.confirmed único (%s)', case when m = 1 then 'OK' else 'FALHA' end, m);
  select private.package_balance(id) into m from public.client_packages where sale_id = s1;
  rep := rep || format(E'\n[%s] venda de pacote concede sessões no livro (saldo=%s)', case when m = 10 then 'OK' else 'FALHA' end, m);
  select s.name into stage from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id where o.id = opp;
  rep := rep || format(E'\n[%s] venda confirmada leva oportunidade a Contratou (%s)', case when stage = 'Contratou' then 'OK' else 'FALHA' end, stage);
  select id into r1 from public.receivables where sale_id = s1 and installment_no = 1; select id into r2 from public.receivables where sale_id = s1 and installment_no = 2;

  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  pay1 := public.payment_record(r1, 10000, now(), 'pix', acct, 'k-1');
  select status into st from public.receivables where id = r1;
  rep := rep || format(E'\n[%s] recebimento parcial deixa parcela como partial (%s)', case when st = 'partial' then 'OK' else 'FALHA' end, st);
  perform public.payment_record(r1, 10000, now(), 'pix', acct, 'k-1');
  select count(*) into m from public.payments where idempotency_key = 'k-1';
  rep := rep || format(E'\n[%s] mesma chave de idempotência não duplica recebimento (%s)', case when m = 1 then 'OK' else 'FALHA' end, m);
  ok := false; begin perform public.payment_record(r1, 999, now(), 'pix', acct, 'k-1'); exception when others then ok := sqlerrm like '%outros dados%'; end;
  rep := rep || format(E'\n[%s] chave reutilizada com outros dados é recusada', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.payment_record(r1, 25000, now(), 'pix', acct, 'k-2'); exception when others then ok := sqlerrm like '%excede%'; end;
  rep := rep || format(E'\n[%s] pagamento acima do saldo da parcela é recusado', case when ok then 'OK' else 'FALHA' end);
  pay2 := public.payment_record(r1, 20000, now(), 'pix', acct, 'k-3');
  select status into st from public.receivables where id = r1;
  rep := rep || format(E'\n[%s] parcela quitada fica paid (%s)', case when st = 'paid' then 'OK' else 'FALHA' end, st);
  select count(*) into m from public.commission_entries where sale_id = s1 and amount_cents > 0;
  select sum(amount_cents) into n from public.commission_entries where sale_id = s1;
  rep := rep || format(E'\n[%s] comissão de 10%% sobre o recebido (30000 -> %s)', case when n = 3000 then 'OK' else 'FALHA' end, n);
  -- estorno
  ok := false; begin perform public.payment_refund(pay2, 30000, 'x', 'r-0'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] estorno maior que o recebido é recusado', case when ok then 'OK' else 'FALHA' end);
  perform public.payment_refund(pay2, 20000, 'cliente desistiu', 'r-1');
  perform public.payment_refund(pay2, 20000, 'cliente desistiu', 'r-1');
  select status into st from public.receivables where id = r1;
  select sum(amount_cents) into n from public.commission_entries where sale_id = s1;
  rep := rep || format(E'\n[%s] estorno reverte comissão proporcional e não duplica (comissão=%s, parcela=%s)', case when n = 1000 and st = 'partial' then 'OK' else 'FALHA' end, n, st);
  ok := false; begin perform public.sale_cancel(s1, 'teste'); exception when others then ok := sqlerrm like '%recebimentos%'; end;
  rep := rep || format(E'\n[%s] venda com recebimentos não pode ser cancelada sem estorno', case when ok then 'OK' else 'FALHA' end);
  select count(*) into m from public.payments; rep := rep || format(E'\n[%s] financeiro da unidade A enxerga os recebimentos (%s)', case when m = 3 then 'OK' else 'FALHA' end, m);
  reset role;

  -- comercial não vê pagamentos; financeiro de outra unidade não vê nada
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into m from public.payments; rep := rep || format(E'\n[%s] comercial não lê recebimentos (%s)', case when m = 0 then 'OK' else 'FALHA' end, m);
  select count(*) into m from public.sales; rep := rep || format(E'\n[%s] comercial lê vendas da sua unidade (%s)', case when m >= 1 then 'OK' else 'FALHA' end, m);
  ok := false; begin perform public.payment_record(r2, 100, now(), 'pix', acct, 'k-9'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial não registra recebimento', case when ok then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_finb, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into m from public.sales; select count(*) + m into m from public.receivables; select count(*) + m into m from public.payments;
  rep := rep || format(E'\n[%s] financeiro da unidade B não vê dados da unidade A (%s)', case when m = 0 then 'OK' else 'FALHA' end, m);
  ok := false; begin perform public.payment_record(r2, 100, now(), 'pix', acct, 'k-8'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] financeiro da unidade B não registra recebimento na A', case when ok then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mem, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into m from public.receivables; rep := rep || format(E'\n[%s] paciente vê só as próprias parcelas (%s)', case when m = 3 then 'OK' else 'FALHA' end, m);
  select count(*) into m from public.payments; rep := rep || format(E'\n[%s] paciente não lê recebimentos (%s)', case when m = 0 then 'OK' else 'FALHA' end, m);
  reset role;

  -- cancelamento de venda sem recebimentos
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  sc := public.sale_create(pa, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod_sub)), 0, 1);
  perform public.sale_confirm(sc); perform public.sale_cancel(sc, 'desistência');
  select count(*) into m from public.receivables where sale_id = sc and status = 'cancelled';
  rep := rep || format(E'\n[%s] cancelar venda sem recebimento cancela parcelas (%s)', case when m = 1 then 'OK' else 'FALHA' end, m);

  -- JORNADA MENTORIA: venda -> Pagamento; pagamento -> Acesso liberado
  s2 := public.sale_create(pb, v_ua, opp_edu, jsonb_build_array(jsonb_build_object('product_id', prod_edu)), 0, 1);
  perform public.sale_confirm(s2);
  reset role;
  select s.name into stage from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id where o.id = opp_edu;
  rep := rep || format(E'\n[%s] mentoria: venda confirmada leva a "Pagamento" (%s)', case when stage = 'Pagamento' then 'OK' else 'FALHA' end, stage);
  select id into r3 from public.receivables where sale_id = s2;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.payment_record(r3, 200000, now(), 'pix', acct, 'k-mentoria');
  reset role;
  select s.name into stage from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id where o.id = opp_edu;
  rep := rep || format(E'\n[%s] mentoria: pagamento confirmado leva a "Acesso liberado" (%s)', case when stage = 'Acesso liberado' then 'OK' else 'FALHA' end, stage);
  select count(*) into m from public.person_kinds where person_id = pb and kind = 'student'; rep := rep || format(E'\n[%s] comprador de mentoria vira aluno (%s)', case when m = 1 then 'OK' else 'FALHA' end, m);

  -- PROJEÇÃO DE MENSALIDADES (competência = mês da primeira parcela)
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  sx := public.sale_create(px, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod_sub)), 0, 1, (lm + 9));   -- X: mensalidade do mês anterior, paga
  sy := public.sale_create(py, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod_sub)), 0, 1, (l2m + 9));  -- Y: pagou só há 2 meses
  sz := public.sale_create(pz, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod_sub)), 0, 1, (lm + 9));   -- Z: pagou e foi estornada
  sw := public.sale_create(pw, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod_sub)), 0, 1, (lm + 9));   -- W: pagou, mas já tem parcela contratada neste mês
  perform public.sale_confirm(sx); perform public.sale_confirm(sy); perform public.sale_confirm(sz); perform public.sale_confirm(sw);
  perform public.sale_confirm(public.sale_create(pw, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod_sub)), 0, 1, current_date));
  reset role;
  select id into rx from public.receivables where sale_id = sx; select id into ry from public.receivables where sale_id = sy; select id into rz from public.receivables where sale_id = sz;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.payment_record(rx, 30000, (lm + 10)::timestamptz, 'pix', acct, 'f-x');
  perform public.payment_record(ry, 30000, (l2m + 10)::timestamptz, 'pix', acct, 'f-y');
  pay3 := public.payment_record(rz, 30000, (lm + 10)::timestamptz, 'pix', acct, 'f-z');
  perform public.payment_refund(pay3, 30000, 'estorno total', 'f-z-r');
  perform public.payment_record((select id from public.receivables where sale_id = sw), 30000, (lm + 10)::timestamptz, 'pix', acct, 'f-w');
  select count(*) into m from public.subscription_forecast(date_trunc('month', current_date)::date) where person_id in (px, py, pz, pw);
  rep := rep || format(E'\n[%s] projeção inclui só X (pagou mês anterior): %s linha(s)', case when m = 1 then 'OK' else 'FALHA' end, m);
  select count(*) into m from public.subscription_forecast(date_trunc('month', current_date)::date) where person_id = px and projected_amount_cents = 30000 and origin_payment_id is not null;
  rep := rep || format(E'\n[%s] projeção mostra pessoa, produto, valor e pagamento de origem', case when m = 1 then 'OK' else 'FALHA' end);
  select count(*) into m from public.subscription_forecast(date_trunc('month', current_date)::date) where person_id = py;
  rep := rep || format(E'\n[%s] quem pagou só 2 meses atrás não entra automaticamente (%s)', case when m = 0 then 'OK' else 'FALHA' end, m);
  select count(*) into m from public.subscription_forecast(date_trunc('month', current_date)::date) where person_id = pz;
  rep := rep || format(E'\n[%s] pagamento estornado não gera projeção (%s)', case when m = 0 then 'OK' else 'FALHA' end, m);
  select count(*) into m from public.subscription_forecast(date_trunc('month', current_date)::date) where person_id = pw;
  rep := rep || format(E'\n[%s] já contratado no mês (conta a receber) não é duplicado como projeção (%s)', case when m = 0 then 'OK' else 'FALHA' end, m);
  reset role;

  raise exception E'RELATORIO_FINANCEIRO (transação desfeita):%', rep;
end $$;
