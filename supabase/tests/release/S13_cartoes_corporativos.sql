-- RELEASE v1 — S13: cartões corporativos (migration 065): permissões e escopo, cálculo do ciclo, limite/disponível, bloqueio, compra = UMA despesa (DRE/linha de negócio),
-- pagamento da fatura, conciliação da fatura (só aponta, sem duplicar despesa nem alterar o extrato), auditoria. Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
do $$
declare
  v_org uuid; ua uuid; ub uuid; acc_a uuid; acc_a2 uuid; acc_b uuid; cat uuid;
  u_mgr uuid := gen_random_uuid(); u_fa uuid := gen_random_uuid(); u_fb uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  card uuid; card2 uuid; cardb uuid; pur1 uuid; pur2 uuid; pur3 uuid; pay1 uuid; inv_closed uuid; inv_open uuid;
  t date := private.card_today(); v_close int; v_due int; v_cc date; rep text := ''; s jsonb; j jsonb; e text; n bigint; n2 bigint; ok boolean;
  w_from timestamptz := now() - interval '120 days'; w_to timestamptz := now() + interval '3 days';
  line_all0 bigint; line_all1 bigint; phy0 bigint; phy1 bigint; imp uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; tot bigint; snap1 text; snap2 text; cnt_p0 bigint; cnt_p1 bigint; dre0 jsonb; dre1 jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S13)', 'teste-a-s13') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S13)', 'teste-b-s13') returning id into ub;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s13.local'),(u_fa,'authenticated','authenticated','fa@s13.local'),(u_fb,'authenticated','authenticated','fb@s13.local'),(u_sales,'authenticated','authenticated','s@s13.local'),(u_phy,'authenticated','authenticated','p@s13.local');
  insert into public.user_accounts (user_id, org_id, person_id, status) values (u_mgr, v_org, null, 'active'),(u_fa, v_org, null, 'active'),(u_fb, v_org, null, 'active'),(u_sales, v_org, null, 'active'),(u_phy, v_org, null, 'active');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_fa, 'finance', ua),(v_org, u_fb, 'finance', ub),(v_org, u_sales, 'sales', ua),(v_org, u_phy, 'physio', ua);
  insert into public.financial_accounts (org_id, unit_id, name, kind) values (v_org, ua, 'Conta A1 S13', 'bank') returning id into acc_a;
  insert into public.financial_accounts (org_id, unit_id, name, kind) values (v_org, ua, 'Conta A2 S13', 'bank') returning id into acc_a2;
  insert into public.financial_accounts (org_id, unit_id, name, kind) values (v_org, ub, 'Conta B S13', 'bank') returning id into acc_b;
  insert into public.finance_categories (org_id, name, kind) values (v_org, 'Categoria cartão S13', 'expense') returning id into cat;
  v_close := ((extract(day from t)::int + 6) % 28) + 1;                      -- nunca coincide com o dia de hoje: a fatura corrente está sempre aberta
  v_due := ((v_close + 9) % 28) + 1;
  select closing_date into v_cc from private.card_cycle(v_close, v_due, t);

  -- ============ 1) ciclo (função pura)
  rep := rep || pg_temp.chk((select (cycle_start, closing_date, due_date) = ('2026-02-16'::date, '2026-03-15'::date, '2026-03-25'::date) from private.card_cycle(15, 25, '2026-03-10')), 'compra antes do fechamento: entra na fatura que fecha no mês (16/02 a 15/03), vence 25/03');
  rep := rep || pg_temp.chk((select closing_date = '2026-03-15'::date from private.card_cycle(15, 25, '2026-03-15')), 'compra NO dia do fechamento ainda entra na fatura que fecha nesse dia');
  rep := rep || pg_temp.chk((select (cycle_start, closing_date, due_date) = ('2026-03-16'::date, '2026-04-15'::date, '2026-04-25'::date) from private.card_cycle(15, 25, '2026-03-16')), 'compra no dia seguinte ao fechamento vai para a próxima fatura (16/03 a 15/04)');
  rep := rep || pg_temp.chk((select (closing_date, due_date) = ('2026-12-25'::date, '2027-01-05'::date) from private.card_cycle(25, 5, '2026-12-20')), 'vencimento antes do fechamento (dia 5 < 25): cai no mês seguinte ao fechamento, atravessando o ano');
  rep := rep || pg_temp.chk((select (cycle_start, closing_date) = ('2026-12-26'::date, '2027-01-25'::date) from private.card_cycle(25, 5, '2026-12-26')), 'virada de ano: 26/12 vai para a fatura de 25/01');
  rep := rep || pg_temp.chk((select closing_date = '2028-02-28'::date from private.card_cycle(28, 10, '2028-02-20')), 'dia 28 funciona em fevereiro de ano bissexto');

  -- ============ 2) segurança do cadastro: nenhuma coluna de número completo/CVV
  rep := rep || pg_temp.chk(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('corporate_cards','card_invoices','card_purchases') and column_name ~* '(cvv|cvc|pan|number|numero|card_no|senha|password|token|pin)'), 'nenhuma coluna guarda número completo, CVV ou dado de autenticação');

  -- ============ 3) permissões de escrita (cadastro)
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  card := public.card_create(ua, 'Cartão Marketing S13', 'Banco Teste', 'visa', 500000, v_close, v_due, '4321', 'Responsável Teste', acc_a);
  rep := rep || pg_temp.chk(card is not null, 'financeiro da unidade A cadastra cartão da unidade A (limite R$ 5.000,00)');
  e := pg_temp.err(format('select public.card_create(%L,''X Cartão S13'',''Banco'',''visa'',1000,5,10)', ub)); rep := rep || pg_temp.chk(e like '42501%', 'financeiro da unidade A NÃO cadastra cartão na unidade B (42501)');
  e := pg_temp.err(format('select public.card_create(%L,''Cartão Longo S13'',''Banco'',''visa'',1000,5,10,''4111111111111111'')', ua)); rep := rep || pg_temp.chk(e like '%4 últimos dígitos%', 'número completo é recusado: só os 4 últimos dígitos');
  e := pg_temp.err(format('select public.card_create(%L,''Cartão Dia S13'',''Banco'',''visa'',1000,29,10)', ua)); rep := rep || pg_temp.chk(e like '%entre os dias 1 e 28%', 'fechamento fora de 1–28 é recusado');
  e := pg_temp.err(format('select public.card_create(%L,''Cartão Zero S13'',''Banco'',''visa'',0,5,10)', ua)); rep := rep || pg_temp.chk(e like '%maior que zero%', 'limite zero é recusado');
  e := pg_temp.err(format('select public.card_create(%L,''Cartão Marketing S13'',''Banco'',''visa'',1000,5,10)', ua)); rep := rep || pg_temp.chk(e like '%já existe um cartão%', 'apelido duplicado é recusado');
  e := pg_temp.err(format('select public.card_create(%L,''Cartão Bandeira S13'',''Banco'',''diners'',1000,5,10)', ua)); rep := rep || pg_temp.chk(e like '%bandeira inválida%', 'bandeira desconhecida é recusada');
  e := pg_temp.err(format('insert into public.corporate_cards (org_id, unit_id, nickname, issuer, brand, credit_limit_cents, closing_day, due_day) values (%L, %L, ''Direto S13'', ''Banco'', ''visa'', 1000, 5, 10)', v_org, ua)); rep := rep || pg_temp.chk(e like '42501%', 'escrita direta na tabela é bloqueada (só por função)');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  e := pg_temp.err(format('select public.card_create(%L,''Cartão Vendas S13'',''Banco'',''visa'',1000,5,10)', ua)); rep := rep || pg_temp.chk(e like '42501%', 'comercial NÃO cadastra cartão (42501)');
  select count(*) into n from public.corporate_cards where org_id = v_org; rep := rep || pg_temp.chk(n = 0, 'comercial não enxerga cartões (RLS)');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  e := pg_temp.err(format('select public.card_create(%L,''Cartão Fisio S13'',''Banco'',''visa'',1000,5,10)', ua)); rep := rep || pg_temp.chk(e like '42501%', 'fisioterapeuta NÃO cadastra cartão (42501)');
  n := jsonb_array_length(public.card_summary(null)); rep := rep || pg_temp.chk(n = 0, 'fisioterapeuta recebe lista vazia de cartões');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fb, 'role','authenticated')::text, true);
  select count(*) into n from public.corporate_cards where org_id = v_org; rep := rep || pg_temp.chk(n = 0, 'financeiro da unidade B não enxerga o cartão da unidade A (RLS)');
  rep := rep || pg_temp.chk(jsonb_array_length(public.card_summary(null)) = 0, 'nem pelo resumo');
  e := pg_temp.err(format('select public.card_purchase_create(%L, current_date, 1000, ''Compra'')', card)); rep := rep || pg_temp.chk(e like '42501%', 'nem registra compra no cartão da unidade A (42501)');
  cardb := public.card_create(ub, 'Cartão B S13', 'Banco B', 'mastercard', 100000, 10, 20);
  rep := rep || pg_temp.chk(cardb is not null, 'financeiro da unidade B cadastra o cartão da própria unidade');

  -- ============ 4) compras: uma despesa por compra, limite, bloqueio
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  dre0 := public.dre_report(w_from, w_to, ua);
  select (l ->> 'expenses_competence_cents')::bigint into phy0 from jsonb_array_elements(public.finance_by_line(w_from, w_to, ua) -> 'lines') l where l ->> 'key' = 'physio';
  select coalesce(sum((l ->> 'expenses_competence_cents')::bigint), 0) into line_all0 from jsonb_array_elements(public.finance_by_line(w_from, w_to, ua) -> 'lines') l;
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  pur1 := public.card_purchase_create(card, t - 60, 30000, 'Anúncio campanha S13', 'Plataforma Ads', cat, 'physio');
  select payable_id into pay1 from public.card_purchases where id = pur1;
  rep := rep || pg_temp.chk(pur1 is not null, 'compra de R$ 300,00 registrada (data, valor, categoria, unidade e linha de negócio)');
  reset role; select count(*) into n from public.payables where id = pay1; select count(*) into n2 from public.card_purchases where payable_id = pay1;
  rep := rep || pg_temp.chk(n = 1 and n2 = 1, 'a compra é exatamente UMA despesa no livro (1 payable ↔ 1 compra)');
  select (b.status = 'open' and b.business_line = 'physio' and b.competence_month = date_trunc('month', t - 60)::date and b.unit_id = ua and b.category_id = cat and b.supplier = 'Plataforma Ads' and b.due_date = i.due_date) into ok
    from public.payables b join public.card_purchases cp on cp.payable_id = b.id join public.card_invoices i on i.id = cp.invoice_id where b.id = pay1;
  rep := rep || pg_temp.chk(ok, 'despesa em aberto, competência = mês da compra, vencimento = da fatura, linha physio, categoria e fornecedor');
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  select (l ->> 'expenses_competence_cents')::bigint into phy1 from jsonb_array_elements(public.finance_by_line(w_from, w_to, ua) -> 'lines') l where l ->> 'key' = 'physio';
  select coalesce(sum((l ->> 'expenses_competence_cents')::bigint), 0) into line_all1 from jsonb_array_elements(public.finance_by_line(w_from, w_to, ua) -> 'lines') l;
  rep := rep || pg_temp.chk(phy1 - phy0 = 30000 and line_all1 - line_all0 = 30000, format('na linha de negócio e no total a despesa de competência subiu exatamente R$ 300,00, uma vez (physio +%s, total +%s)', phy1 - phy0, line_all1 - line_all0));
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  pur2 := public.card_purchase_create(card, t, 50000, 'Software S13', 'Loja Soft', cat, 'shared', '[{"line":"physio","basis_points":6000},{"line":"academy","basis_points":4000}]'::jsonb);
  reset role; select count(*) into n from public.payable_allocations a join public.card_purchases cp on cp.payable_id = a.payable_id where cp.id = pur2;
  rep := rep || pg_temp.chk(n = 2, 'compra compartilhada com rateio explícito 60/40 usa o mesmo rateio das despesas');
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  e := pg_temp.err(format('select public.card_purchase_create(%L, current_date, 5000000, ''Estoura limite'')', card)); rep := rep || pg_temp.chk(e like '%limite insuficiente%', 'compra acima do disponível é recusada');
  e := pg_temp.err(format('select public.card_purchase_create(%L, current_date, 0, ''Zero'')', card)); rep := rep || pg_temp.chk(e like '%valor da compra inválido%', 'valor zero é recusado');
  e := pg_temp.err(format('select public.card_purchase_create(%L, current_date + 30, 1000, ''Futura'')', card)); rep := rep || pg_temp.chk(e like '%data da compra inválida%', 'data futura é recusada');
  e := pg_temp.err(format('select public.card_purchase_create(%L, current_date, 1000, ''Linha ruim'', null, null, ''x'')', card)); rep := rep || pg_temp.chk(e like '%linha de negócio inválida%', 'linha de negócio inválida é recusada');
  e := pg_temp.err(format('select public.card_purchase_create(%L, current_date, 1000, ''Categoria ruim'', null, %L)', card, gen_random_uuid())); rep := rep || pg_temp.chk(e like '%categoria de despesa inválida%', 'categoria inexistente é recusada');
  s := (select x from jsonb_array_elements(public.card_summary(ua)) x where x ->> 'id' = card::text);
  rep := rep || pg_temp.chk((s ->> 'credit_limit_cents')::bigint = 500000 and (s ->> 'unpaid_cents')::bigint = 80000 and (s ->> 'available_cents')::bigint = 420000, format('limite R$ 5.000,00 − R$ 800,00 em aberto = disponível R$ 4.200,00 (obtido %s)', s ->> 'available_cents'));
  rep := rep || pg_temp.chk((s ->> 'spent_cycle_cents')::bigint = 50000, format('gasto do ciclo atual = só a compra de hoje, R$ 500,00 (obtido %s)', s ->> 'spent_cycle_cents'));
  rep := rep || pg_temp.chk(((s ->> 'closing_date')::date >= t) and ((s ->> 'closing_date')::date - t <= 31) and (s ->> 'closing_date')::date = v_cc, 'o resumo traz o fechamento e o vencimento do ciclo atual');
  rep := rep || pg_temp.chk(not (s ? 'number') and not (s ? 'cvv') and (s ->> 'last4') = '4321', 'o resumo só traz os 4 últimos dígitos, nunca número completo');
  -- bloqueio
  e := pg_temp.err(format('select public.card_set_status(%L, ''blocked'', '''')', card)); rep := rep || pg_temp.chk(e like '%motivo do bloqueio%', 'bloquear exige motivo');
  perform public.card_set_status(card, 'blocked', 'Suspeita de fraude');
  e := pg_temp.err(format('select public.card_purchase_create(%L, current_date, 1000, ''Com cartão bloqueado'')', card)); rep := rep || pg_temp.chk(e like '%bloqueado%', 'cartão bloqueado NÃO aceita compra');
  perform public.card_set_status(card, 'active');
  pur3 := public.card_purchase_create(card, t, 1000, 'Depois de desbloquear S13');
  rep := rep || pg_temp.chk(pur3 is not null, 'desbloqueado, volta a aceitar compras');
  -- cancelar compra
  perform public.card_purchase_cancel(pur3, 'lançada por engano');
  reset role; select b.status into e from public.payables b join public.card_purchases cp on cp.payable_id = b.id where cp.id = pur3;
  rep := rep || pg_temp.chk(e = 'cancelled', 'compra cancelada vira despesa cancelada (some da DRE e libera o limite)');
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  s := (select x from jsonb_array_elements(public.card_summary(ua)) x where x ->> 'id' = card::text);
  rep := rep || pg_temp.chk((s ->> 'unpaid_cents')::bigint = 80000, 'o cancelamento não deixa resíduo no limite');

  -- ============ 5) fatura: pagar
  select (i ->> 'id')::uuid into inv_closed from jsonb_array_elements(public.card_invoices_list(card)) i where (i ->> 'closing_date')::date < t;
  select (i ->> 'id')::uuid into inv_open from jsonb_array_elements(public.card_invoices_list(card)) i where (i ->> 'closing_date')::date >= t;
  rep := rep || pg_temp.chk(inv_closed is not null and inv_open is not null, 'o cartão tem uma fatura fechada (compra de 60 dias atrás) e uma aberta (compra de hoje)');
  e := pg_temp.err(format('select public.payable_pay(%L, %L)', pay1, acc_a)); rep := rep || pg_temp.chk(e like '%compra de cartão%', 'a despesa de cartão NÃO é paga isoladamente em Contas a pagar (paga-se a fatura)');
  e := pg_temp.err(format('select public.card_invoice_pay(%L, %L)', inv_open, acc_a)); rep := rep || pg_temp.chk(e like '%ainda está aberta%', 'fatura ainda aberta não pode ser paga');
  e := pg_temp.err(format('select public.card_invoice_pay(%L, %L)', inv_closed, acc_b)); rep := rep || pg_temp.chk(e like '%conta financeira inválida%', 'conta de outra unidade é recusada');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fb, 'role','authenticated')::text, true);
  e := pg_temp.err(format('select public.card_invoice_pay(%L, %L)', inv_closed, acc_b)); rep := rep || pg_temp.chk(e like '42501%', 'financeiro da unidade B NÃO paga a fatura da unidade A (42501)');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  perform public.card_invoice_pay(inv_closed, acc_a, (t - 5)::timestamptz + interval '12 hours');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  dre1 := public.dre_report(w_from, w_to, ua);
  rep := rep || pg_temp.chk((dre1 -> 'sem_classificacao_cents' ->> 'count')::bigint - (dre0 -> 'sem_classificacao_cents' ->> 'count')::bigint = 1 and (dre1 -> 'sem_classificacao_cents' ->> 'value')::bigint - (dre0 -> 'sem_classificacao_cents' ->> 'value')::bigint = 30000, format('na DRE a despesa da fatura paga entra UMA vez (1 lançamento, +R$ 300,00) (obtido +%s)', (dre1 -> 'sem_classificacao_cents' ->> 'value')::bigint - (dre0 -> 'sem_classificacao_cents' ->> 'value')::bigint));
  reset role;
  select count(*) filter (where b.status = 'paid' and b.financial_account_id = acc_a and b.paid_at::date = t - 5), count(*) into n, n2 from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.invoice_id = inv_closed;
  rep := rep || pg_temp.chk(n = 1 and n2 = 1, 'pagar a fatura paga a despesa do ciclo na conta e na data informadas (sem criar despesa nova)');
  select count(*) into n from public.payables where org_id = v_org and unit_id = ua and description in ('Anúncio campanha S13','Software S13','Depois de desbloquear S13');
  rep := rep || pg_temp.chk(n = 3, 'continuam só as 3 despesas das compras (nenhuma duplicada pelo pagamento)');
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  e := pg_temp.err(format('select public.card_invoice_pay(%L, %L)', inv_closed, acc_a)); rep := rep || pg_temp.chk(e like '%já foi paga%', 'pagar duas vezes a mesma fatura é recusado');
  e := pg_temp.err(format('select public.card_purchase_cancel(%L, ''tarde demais'')', pur1)); rep := rep || pg_temp.chk(e like '%fatura paga%', 'compra de fatura paga não pode ser cancelada');
  s := (select x from jsonb_array_elements(public.card_summary(ua)) x where x ->> 'id' = card::text);
  rep := rep || pg_temp.chk((s ->> 'unpaid_cents')::bigint = 50000 and (s ->> 'available_cents')::bigint = 450000, 'fatura paga libera o limite: em aberto R$ 500,00, disponível R$ 4.500,00');
  e := pg_temp.err(format('select public.card_purchase_create(%L, %L, 1000, ''No ciclo já pago'')', card, t - 60)); rep := rep || pg_temp.chk(e like '%já foi paga%', 'não se lança compra em ciclo cuja fatura já foi paga');
  rep := rep || pg_temp.chk((select (x ->> 'state') = 'paga' and (x ->> 'total_cents')::bigint = 30000 from jsonb_array_elements(public.card_invoices_list(card)) x where (x ->> 'id')::uuid = inv_closed), 'a lista de faturas mostra a fatura paga, total R$ 300,00');
  rep := rep || pg_temp.chk((select (x ->> 'state') = 'aberta' and (x ->> 'total_cents')::bigint = 50000 from jsonb_array_elements(public.card_invoices_list(card)) x where (x ->> 'id')::uuid = inv_open), 'e a fatura aberta, total R$ 500,00');
  rep := rep || pg_temp.chk((select jsonb_array_length(public.card_purchases_list(card, inv_closed)) = 1), 'lista de compras por fatura');

  -- ============ 6) conciliação da fatura (só aponta)
  reset role; insert into public.bank_statement_imports (org_id, unit_id, account_id, filename, row_count, imported_by) values (v_org, ua, acc_a, 'extrato S13', 4, u_fa) returning id into imp;
  insert into public.bank_statement_lines (org_id, unit_id, import_id, txn_date, description, amount_cents, external_ref) values (v_org, ua, imp, t - 5, 'DEBITO FATURA CARTAO S13', -30000, 'F1') returning id into l1;
  insert into public.bank_statement_lines (org_id, unit_id, import_id, txn_date, description, amount_cents) values (v_org, ua, imp, t - 5, 'OUTRO VALOR S13', -29999) returning id into l2;
  insert into public.bank_statement_lines (org_id, unit_id, import_id, txn_date, description, amount_cents) values (v_org, ua, imp, t - 5, 'DEBITO FATURA DUPLICADA S13', -30000) returning id into l3;
  insert into public.bank_statement_imports (org_id, unit_id, account_id, filename, row_count, imported_by) values (v_org, ua, acc_a2, 'extrato outra conta S13', 1, u_fa) returning id into imp;
  insert into public.bank_statement_lines (org_id, unit_id, import_id, txn_date, description, amount_cents) values (v_org, ua, imp, t - 5, 'DEBITO OUTRA CONTA S13', -30000) returning id into l4;
  select count(*), coalesce(sum(amount_cents), 0) into cnt_p0, tot from public.payables where org_id = v_org and unit_id = ua;
  select string_agg(format('%s|%s|%s|%s|%s', id, txn_date, description, amount_cents, coalesce(external_ref, '')), ';' order by id) into snap1 from public.bank_statement_lines where id in (l1, l2, l3, l4);
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  j := public.card_invoice_suggestions(l1);
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 1 and (j -> 0 ->> 'invoice_id')::uuid = inv_closed and (j -> 0 ->> 'amount_cents')::bigint = 30000, 'a linha de R$ 300,00 sugere a fatura paga de R$ 300,00 (mesma conta)');
  rep := rep || pg_temp.chk(jsonb_array_length(public.card_invoice_suggestions(l2)) = 0 and jsonb_array_length(public.card_invoice_suggestions(l4)) = 0, 'valor diferente ou outra conta bancária: nenhuma sugestão');
  rep := rep || pg_temp.chk(jsonb_array_length(public.bank_reconcile_suggestions(l1)) = 0, 'a conciliação comum NÃO sugere a compra do cartão como se fosse conta paga isolada');
  e := pg_temp.err(format('select public.bank_reconcile_confirm(%L, null, %L)', l1, pay1)); rep := rep || pg_temp.chk(e like '%compra de cartão%', 'conciliar a compra isolada é recusado (concilia-se a fatura)');
  e := pg_temp.err(format('select public.card_invoice_reconcile(%L, %L)', l1, inv_open)); rep := rep || pg_temp.chk(e like '%registre o pagamento da fatura%' or e like '%não corresponde%', 'fatura não paga não pode ser conciliada');
  e := pg_temp.err(format('select public.card_invoice_reconcile(%L, %L)', l2, inv_closed)); rep := rep || pg_temp.chk(e like '%não corresponde%', 'valor diferente é recusado');
  e := pg_temp.err(format('select public.card_invoice_reconcile(%L, %L)', l4, inv_closed)); rep := rep || pg_temp.chk(e like '%outra conta bancária%', 'extrato de outra conta bancária é recusado');
  perform public.card_invoice_reconcile(l1, inv_closed);
  e := pg_temp.err(format('select public.card_invoice_reconcile(%L, %L)', l3, inv_closed)); rep := rep || pg_temp.chk(e like '%já foi conciliada%', 'a mesma fatura não é conciliada com duas linhas (sem duplicidade)');
  reset role;
  select count(*), coalesce(sum(amount_cents), 0) into cnt_p1, n from public.payables where org_id = v_org and unit_id = ua;
  rep := rep || pg_temp.chk(cnt_p1 = cnt_p0 and n = tot, 'conciliar não criou nem alterou nenhuma despesa (mesma quantidade e mesmo total)');
  select string_agg(format('%s|%s|%s|%s|%s', id, txn_date, description, amount_cents, coalesce(external_ref, '')), ';' order by id) into snap2 from public.bank_statement_lines where id in (l1, l2, l3, l4);
  rep := rep || pg_temp.chk(snap1 = snap2, 'o extrato original não mudou (data, descrição, valor e referência intactos)');
  select (status = 'matched' and matched_invoice_id = inv_closed and matched_payment_id is null and matched_payable_id is null) into ok from public.bank_statement_lines where id = l1;
  rep := rep || pg_temp.chk(ok, 'a linha ficou conciliada com a fatura (e com nenhum outro lançamento)');
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  select coalesce(sum(cents), 0), min(bucket) into tot, e from public.bank_line_shares(array[l1]);
  rep := rep || pg_temp.chk(tot = -30000 and e = 'physio', format('na visão por linha de negócio a saída bancária conciliada é R$ −300,00, uma vez, na linha physio (obtido %s %s)', tot, e));
  rep := rep || pg_temp.chk((select (x -> 'bank_line' ->> 'id')::uuid = l1 from jsonb_array_elements(public.card_invoices_list(card)) x where (x ->> 'id')::uuid = inv_closed), 'a lista de faturas mostra a linha do extrato ligada');
  perform public.bank_reconcile_undo(l1);
  reset role; select (status = 'unmatched' and matched_invoice_id is null) into ok from public.bank_statement_lines where id = l1;
  select count(*) into n from public.payables where org_id = v_org and unit_id = ua and status = 'paid' and description = 'Anúncio campanha S13';
  rep := rep || pg_temp.chk(ok and n = 1, 'desfazer a conciliação só solta a ligação; a fatura e a despesa continuam pagas');
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  perform public.card_invoice_reconcile(l3, inv_closed);
  rep := rep || pg_temp.chk(true, 'depois de desfeita, a fatura pode ser conciliada de novo com outra linha');
  perform public.bank_reconcile_undo(l3);

  -- ============ 7) auditoria
  reset role;
  select count(*) into n from public.audit_log where org_id = v_org and entity_type = 'corporate_cards' and entity_id = card::text and action = 'insert';
  rep := rep || pg_temp.chk(n = 1, 'o cadastro do cartão foi auditado');
  select count(*) into n from public.audit_log where org_id = v_org and entity_type = 'corporate_cards' and entity_id = card::text and new_values ->> 'reason' = 'Suspeita de fraude';
  rep := rep || pg_temp.chk(n >= 1, 'o bloqueio foi auditado com o motivo');
  select count(*) into n from public.audit_log where org_id = v_org and entity_type = 'card_invoices' and entity_id = inv_closed::text and action = 'update';
  rep := rep || pg_temp.chk(n >= 1, 'o pagamento da fatura foi auditado');
  select count(*) into n from public.audit_log where org_id = v_org and entity_type = 'card_purchases' and action = 'insert';
  rep := rep || pg_temp.chk(n = 3, 'as 3 compras (inclusive a cancelada) foram auditadas');

  -- ============ 8) superfície pública
  set local role anon;
  e := pg_temp.err(format('select public.card_summary(%L)', ua)); rep := rep || pg_temp.chk(e like '42501%', 'anon não lê o resumo de cartões (42501)');
  e := pg_temp.err(format('select public.card_create(%L,''Anon S13'',''Banco'',''visa'',1000,5,10)', ua)); rep := rep || pg_temp.chk(e like '42501%', 'anon não cadastra cartão');
  e := pg_temp.err('select count(*) from public.corporate_cards'); rep := rep || pg_temp.chk(e like '42501%', 'anon não lê a tabela de cartões');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_fa, 'role','authenticated')::text, true);
  e := pg_temp.err('select private.card_cycle(5, 10, current_date)'); rep := rep || pg_temp.chk(e like '42501%', 'funções privadas não são chamadas pelo navegador');
  reset role;

  raise exception E'RELATORIO_S13_CARTOES_CORPORATIVOS (transação desfeita):%', rep;
end $$;
