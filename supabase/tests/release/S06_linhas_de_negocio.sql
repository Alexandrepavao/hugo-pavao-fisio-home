-- RELEASE v1 — S06: financeiro por linha de negócio (HP Fisioterapia / HP Academy). Cobre a migration 057.
-- Fixtures numa unidade NOVA (p_unit = essa unidade), com valores calculados à mão. Transação sempre desfeita. Somente Dev/teste.
--   Venda V1: item A (Fisioterapia) 100,00 + item B (Academy) 50,00, desconto da venda 15,00 → total 135,00 (divisão: Fisio 90,00 / Academy 45,00).
--   Recebimento parcial 50,00 → Fisio 33,33 / Academy 16,67 (o centavo de resto vai à linha de maior resto: Academy). Estorno 10,00 → Fisio 6,67 / Academy 3,33.
--   Saldo em aberto 95,00 → Fisio 63,33 / Academy 31,67. Comissão 1,00 → Fisio 0,67 / Academy 0,33.
--   Despesas pagas: Fisio 100,00; Academy 50,00; compartilhada 10,00 com rateio 60/40; compartilhada 7,00 SEM rateio; não classificada 3,00.
do $$
declare
  v_org uuid; uz uuid; uy uuid; u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_umy uuid := gen_random_uuid();
  pa uuid; pb uuid; pu uuid; prA uuid; prB uuid; prU uuid; s1 uuid; s2 uuid; rc uuid; py1 uuid; py2 uuid; rule uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid;
  p_from timestamptz := now() - interval '1 day'; p_to timestamptz := now() + interval '30 days';
  j jsonb; n bigint; n2 bigint; n3 bigint; ok boolean; rep text := '';
  k text; a bigint;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Z (teste S06)', 'teste-z-s06') returning id into uz;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Y (teste S06)', 'teste-y-s06') returning id into uy;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s06.local'),(u_sales,'authenticated','authenticated','s@s06.local'),
    (u_fin,'authenticated','authenticated','f@s06.local'),(u_umy,'authenticated','authenticated','umy@s06.local');
  insert into public.user_accounts (user_id, org_id, person_id) values (u_mgr, v_org, null),(u_sales, v_org, null),(u_fin, v_org, null),(u_umy, v_org, null);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', uz),(v_org, u_fin, 'finance', uz),(v_org, u_umy, 'unit_manager', uy);
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Pessoa S06') returning id into pa;
  insert into public.products (org_id, kind, name, price_cents, business_line) values (v_org, 'service', 'Produto Fisio S06', 10000, 'physio') returning id into prA;
  insert into public.products (org_id, kind, name, price_cents, business_line) values (v_org, 'course', 'Produto Academy S06', 5000, 'academy') returning id into prB;
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'service', 'Produto sem linha S06', 2000) returning id into prU;

  -- V1 (itens das duas linhas). Itens entram com a venda pendente; depois a venda é confirmada diretamente (o trigger bloqueia itens em venda confirmada).
  insert into public.sales (org_id, unit_id, person_id, discount_cents) values (v_org, uz, pa, 1500) returning id into s1;
  insert into public.sale_items (org_id, sale_id, product_id, description, qty, unit_price_cents) values (v_org, s1, prA, 'Item A', 1, 10000),(v_org, s1, prB, 'Item B', 1, 5000);
  update public.sales set status = 'confirmed', sold_at = now() where id = s1;
  insert into public.receivables (org_id, unit_id, sale_id, person_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
    values (v_org, uz, s1, pa, 1, 1, current_date + 5, date_trunc('month', current_date)::date, 13500, 'partial') returning id into rc;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, idempotency_key) values (v_org, uz, rc, 'payment', 5000, 's06-pay-1') returning id into py1;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, refund_of, idempotency_key) values (v_org, uz, rc, 'refund', 1000, py1, 's06-ref-1') returning id into py2;
  insert into public.commission_rules (org_id, name, percent_bp) values (v_org, 'Regra S06', 1000) returning id into rule;
  insert into public.commission_entries (org_id, unit_id, rule_id, sale_id, payment_id, beneficiary_user_id, amount_cents) values (v_org, uz, rule, s1, py1, u_sales, 100);
  -- V2: venda só de produto sem linha (deve aparecer em "Não classificado")
  insert into public.sales (org_id, unit_id, person_id) values (v_org, uz, pa) returning id into s2;
  insert into public.sale_items (org_id, sale_id, product_id, description, qty, unit_price_cents) values (v_org, s2, prU, 'Item U', 1, 2000);
  update public.sales set status = 'confirmed', sold_at = now() where id = s2;

  -- despesas pagas agora
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at, business_line) values (v_org, uz, 'Desp Fisio', 10000, current_date, date_trunc('month', current_date)::date, 'paid', now(), 'physio') returning id into e1;
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at, business_line) values (v_org, uz, 'Desp Academy', 5000, current_date, date_trunc('month', current_date)::date, 'paid', now(), 'academy') returning id into e2;
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at, business_line) values (v_org, uz, 'Desp Rateada', 1000, current_date, date_trunc('month', current_date)::date, 'paid', now(), 'shared') returning id into e3;
  insert into public.payable_allocations (payable_id, line, basis_points) values (e3, 'physio', 6000),(e3, 'academy', 4000);
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at, business_line) values (v_org, uz, 'Desp Compartilhada sem rateio', 700, current_date, date_trunc('month', current_date)::date, 'paid', now(), 'shared') returning id into e4;
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at) values (v_org, uz, 'Desp sem linha', 300, current_date, date_trunc('month', current_date)::date, 'paid', now()) returning id into e5;

  -- ============ 1) divisão exata em centavos (soma das linhas = valor original, sempre)
  select sum(cents) into n from private.split_sale_amount(s1, 13500);
  rep := rep || format(E'\n[%s] venda mista: a soma das linhas = total da venda 135,00 (%s)', case when n = 13500 then 'OK' else 'FALHA' end, n);
  select cents into n from private.split_sale_amount(s1, 13500) where line = 'physio'; select cents into n2 from private.split_sale_amount(s1, 13500) where line = 'academy';
  rep := rep || format(E'\n[%s] venda mista com desconto diluído: Fisio 90,00 / Academy 45,00 (%s / %s)', case when n = 9000 and n2 = 4500 then 'OK' else 'FALHA' end, n, n2);
  select cents into n from private.split_sale_amount(s1, 5000) where line = 'physio'; select cents into n2 from private.split_sale_amount(s1, 5000) where line = 'academy';
  rep := rep || format(E'\n[%s] recebimento parcial 50,00: Fisio 33,33 / Academy 16,67 (o resto de centavo vai à linha de maior resto) (%s / %s)', case when n = 3333 and n2 = 1667 then 'OK' else 'FALHA' end, n, n2);
  ok := true;
  foreach a in array array[1, 2, 3, 7, 99, 100, 333, 4999, 13500, -1, -333, -1000] loop
    select sum(cents) into n from private.split_sale_amount(s1, a);
    if n is distinct from a then ok := false; end if;
  end loop;
  rep := rep || format(E'\n[%s] para 12 valores (inclusive negativos/estornos) a soma das linhas é EXATAMENTE o valor original', case when ok then 'OK' else 'FALHA' end);
  select sum(cents) into n from private.split_sale_amount(s2, 2000); select cents into n2 from private.split_sale_amount(s2, 2000) where line = 'unclassified';
  rep := rep || format(E'\n[%s] venda só com produto sem linha vai inteira para "Não classificado" (%s)', case when n = 2000 and n2 = 2000 then 'OK' else 'FALHA' end, n2);
  select cents into n from private.split_payable(e3, 1000) where bucket = 'physio'; select cents into n2 from private.split_payable(e3, 1000) where bucket = 'academy'; select cents into n3 from private.split_payable(e3, 1000) where bucket = 'shared';
  rep := rep || format(E'\n[%s] despesa compartilhada COM rateio 60/40: Fisio 6,00 / Academy 4,00, nada em "não alocado" (%s / %s / %s)', case when n = 600 and n2 = 400 and n3 is null then 'OK' else 'FALHA' end, n, n2, n3);
  select cents into n from private.split_payable(e4, 700) where bucket = 'shared';
  rep := rep || format(E'\n[%s] despesa compartilhada SEM rateio fica inteira em "compartilhado/não alocado" (%s)', case when n = 700 then 'OK' else 'FALHA' end, n);

  -- ============ 2) quadro por linha (gestor) e conferência com os totais diretos
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.finance_by_line(p_from, p_to, uz);
  rep := rep || format(E'\n[%s] conferência: o total das linhas bate com os totais diretos das tabelas em TODAS as métricas (ok=%s)', case when (j -> 'reconciliation' ->> 'ok')::boolean then 'OK' else 'FALHA' end, j -> 'reconciliation' ->> 'ok');
  select (x ->> 'sales_cents')::bigint, (x ->> 'receipts_cents')::bigint, (x ->> 'refunds_cents')::bigint, (x ->> 'net_receipts_cents')::bigint, (x ->> 'forecast_receivables_cents')::bigint, (x ->> 'commissions_cents')::bigint
    into n, n2, n3, a, a, a from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'physio';
  rep := rep || format(E'\n[%s] Fisioterapia: vendas 90,00 · recebimentos 33,33 · estornos 6,67 (vendas=%s recebimentos=%s estornos=%s)', case when n = 9000 and n2 = 3333 and n3 = 667 then 'OK' else 'FALHA' end, n, n2, n3);
  select (x ->> 'sales_cents')::bigint, (x ->> 'receipts_cents')::bigint, (x ->> 'refunds_cents')::bigint into n, n2, n3 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'academy';
  rep := rep || format(E'\n[%s] Academy: vendas 45,00 · recebimentos 16,67 · estornos 3,33 (vendas=%s recebimentos=%s estornos=%s)', case when n = 4500 and n2 = 1667 and n3 = 333 then 'OK' else 'FALHA' end, n, n2, n3);
  select (x ->> 'net_receipts_cents')::bigint, (x ->> 'forecast_receivables_cents')::bigint, (x ->> 'commissions_cents')::bigint into n, n2, n3 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'physio';
  rep := rep || format(E'\n[%s] Fisioterapia: recebido líquido 26,66 · previsão a receber 63,33 · comissões 0,67 (%s / %s / %s)', case when n = 2666 and n2 = 6333 and n3 = 67 then 'OK' else 'FALHA' end, n, n2, n3);
  select (x ->> 'net_receipts_cents')::bigint, (x ->> 'forecast_receivables_cents')::bigint, (x ->> 'commissions_cents')::bigint into n, n2, n3 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'academy';
  rep := rep || format(E'\n[%s] Academy: recebido líquido 13,34 · previsão a receber 31,67 · comissões 0,33 (%s / %s / %s)', case when n = 1334 and n2 = 3167 and n3 = 33 then 'OK' else 'FALHA' end, n, n2, n3);
  select (x ->> 'sales_cents')::bigint into n from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'unclassified';
  rep := rep || format(E'\n[%s] Não classificado: a venda V2 (produto sem linha) aparece inteira, 20,00 (%s)', case when n = 2000 then 'OK' else 'FALHA' end, n);
  select (x ->> 'expenses_paid_cents')::bigint into n from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'physio';
  select (x ->> 'expenses_paid_cents')::bigint into n2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'academy';
  select (x ->> 'expenses_paid_cents')::bigint into n3 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'shared';
  select (x ->> 'expenses_paid_cents')::bigint into a from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'unclassified';
  rep := rep || format(E'\n[%s] Despesas pagas: Fisio 106,00 (100 + 60%% de 10) · Academy 54,00 (50 + 40%% de 10) · compartilhado/não alocado 7,00 · não classificado 3,00 (%s / %s / %s / %s)', case when n = 10600 and n2 = 5400 and n3 = 700 and a = 300 then 'OK' else 'FALHA' end, n, n2, n3, a);
  rep := rep || format(E'\n[%s] Geral: despesas pagas 170,00 = soma das quatro colunas (%s)', case when (j -> 'total' ->> 'expenses_paid_cents')::bigint = 17000 then 'OK' else 'FALHA' end, j -> 'total' ->> 'expenses_paid_cents');
  rep := rep || format(E'\n[%s] Geral: recebimentos 50,00, estornos 10,00, recebido líquido 40,00 (sem duplicar) (%s / %s / %s)', case when (j -> 'total' ->> 'receipts_cents')::bigint = 5000 and (j -> 'total' ->> 'refunds_cents')::bigint = 1000 and (j -> 'total' ->> 'net_receipts_cents')::bigint = 4000 then 'OK' else 'FALHA' end,
    j -> 'total' ->> 'receipts_cents', j -> 'total' ->> 'refunds_cents', j -> 'total' ->> 'net_receipts_cents');
  rep := rep || format(E'\n[%s] Geral: vendas 155,00 (135 + 20) e previsão a receber 95,00', case when (j -> 'total' ->> 'sales_cents')::bigint = 15500 and (j -> 'total' ->> 'forecast_receivables_cents')::bigint = 9500 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] alertas: produtos sem linha ≥ 1 e 1 despesa compartilhada sem rateio (%s / %s)', case when (j ->> 'unclassified_products')::int >= 1 and (j ->> 'shared_without_allocation')::int = 1 then 'OK' else 'FALHA' end, j ->> 'unclassified_products', j ->> 'shared_without_allocation');
  j := public.finance_by_line(now() + interval '400 days', now() + interval '401 days', uz);
  rep := rep || format(E'\n[%s] período sem movimento: tudo zero e a conferência continua ok (nada inventado)', case when (j -> 'total' ->> 'sales_cents')::bigint = 0 and (j -> 'total' ->> 'expenses_paid_cents')::bigint = 0 and (j -> 'reconciliation' ->> 'ok')::boolean then 'OK' else 'FALHA' end);

  -- ============ 3) classificação: permissões, validação do rateio, auditoria
  perform public.payable_set_line(e5, 'academy');
  select business_line into k from public.payables where id = e5;
  rep := rep || format(E'\n[%s] gestor classifica a despesa sem linha como Academy (%s)', case when k = 'academy' then 'OK' else 'FALHA' end, k);
  ok := false; begin perform public.payable_set_line(e5, 'shared', '[{"line":"physio","basis_points":5000},{"line":"academy","basis_points":4000}]'::jsonb); exception when others then ok := sqlerrm like '%somar 100%'; end;
  rep := rep || format(E'\n[%s] rateio que não soma 100%% é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.payable_set_line(e5, 'shared', '[{"line":"physio","basis_points":5000},{"line":"physio","basis_points":5000}]'::jsonb); exception when others then ok := sqlerrm like '%repetida%'; end;
  rep := rep || format(E'\n[%s] rateio com linha repetida é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.payable_set_line(e5, 'physio', '[{"line":"physio","basis_points":10000}]'::jsonb); exception when others then ok := sqlerrm like '%só se aplica%'; end;
  rep := rep || format(E'\n[%s] rateio em despesa que não é compartilhada é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.payable_set_line(e5, 'inexistente'); exception when others then ok := sqlerrm like '%inválida%'; end;
  rep := rep || format(E'\n[%s] linha desconhecida é recusada', case when ok then 'OK' else 'FALHA' end);
  perform public.payable_set_line(e5, 'shared', '[{"line":"physio","basis_points":7000},{"line":"academy","basis_points":3000}]'::jsonb);
  select count(*) into n from public.payable_allocations where payable_id = e5;
  rep := rep || format(E'\n[%s] rateio 70/30 gravado (2 linhas) e depois removido ao voltar para "Física": ', case when n = 2 then 'OK' else 'FALHA' end);
  perform public.payable_set_line(e5, 'physio'); select count(*) into n from public.payable_allocations where payable_id = e5;
  rep := rep || format(E'\n[%s] ao trocar a linha, o rateio anterior some (%s restantes)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role; select count(*) into n from public.audit_log where entity_type = 'payable_allocations' and entity_id = e5::text and actor_user_id = u_mgr;
  rep := rep || format(E'\n[%s] a classificação e o rateio ficam auditados com o autor (%s registros)', case when n >= 3 then 'OK' else 'FALHA' end, n);
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  perform public.product_set_line(prU, 'academy');
  select business_line into k from public.products where id = prU;
  j := public.finance_by_line(p_from, p_to, uz);
  select (x ->> 'sales_cents')::bigint into n from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'academy';
  select (x ->> 'sales_cents')::bigint into n2 from jsonb_array_elements(j -> 'lines') x where x ->> 'key' = 'unclassified';
  rep := rep || format(E'\n[%s] classificar o produto reclassifica o histórico dele: Academy passa a 65,00 (45 + 20) e "não classificado" zera (%s / %s / produto=%s)', case when n = 6500 and n2 = 0 and k = 'academy' then 'OK' else 'FALHA' end, n, n2, k);
  rep := rep || format(E'\n[%s] depois da reclassificação a conferência continua ok', case when (j -> 'reconciliation' ->> 'ok')::boolean then 'OK' else 'FALHA' end);

  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  ok := false; begin perform public.payable_set_line(e5, 'academy'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial NÃO classifica despesa', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.product_set_line(prU, 'physio'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial NÃO classifica produto', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.finance_by_line(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial NÃO abre o quadro financeiro por linha', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.sale_line_shares(array[s1]);
  rep := rep || format(E'\n[%s] comercial da unidade vê a linha das vendas (2 linhas na V1)', case when n = 2 then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  ok := false; begin perform public.finance_by_line(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] financeiro NÃO abre o quadro (mesmo escopo do painel financeiro existente: gestor, administrador operacional e gestor de unidade)', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.sale_line_shares(array[s1]);
  rep := rep || format(E'\n[%s] financeiro da unidade vê a linha das vendas (2 linhas na V1)', case when n = 2 then 'OK' else 'FALHA' end);
  perform public.payable_set_line(e5, 'academy');
  rep := rep || format(E'\n[%s] financeiro da unidade classifica despesa da própria unidade', 'OK');
  perform set_config('request.jwt.claims', json_build_object('sub', u_umy, 'role','authenticated')::text, true);
  ok := false; begin perform public.finance_by_line(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] gestor de OUTRA unidade NÃO abre o quadro desta unidade', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.payable_set_line(e5, 'physio'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] gestor de OUTRA unidade NÃO classifica despesa desta unidade', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.sale_line_shares(array[s1]);
  rep := rep || format(E'\n[%s] gestor de outra unidade não lê a linha das vendas desta unidade (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.payable_allocations;
  rep := rep || format(E'\n[%s] gestor de outra unidade não lê rateios de despesas desta unidade (RLS)', case when n = 0 then 'OK' else 'FALHA' end);

  -- ============ 4) superfície pública
  reset role; set local role anon;
  ok := false; begin perform public.finance_by_line(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa finance_by_line', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.payable_set_line(e5, 'physio'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa payable_set_line', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.product_set_line(prU, 'physio'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa product_set_line', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform * from public.sale_line_shares(array[s1]); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa sale_line_shares', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_S06_LINHAS_DE_NEGOCIO (transação desfeita):%', rep;
end $$;
