-- Teste de conciliação bancária: importação, sugestão de casamento, confirmação (nunca cria lançamento novo),
-- ignorar e desfazer. Transação desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; u_fin uuid := gen_random_uuid();
  acct uuid; svc uuid; prod uuid; pa uuid; sale uuid; recv uuid; pay uuid; payable uuid;
  imp uuid; line_credit uuid; line_debit uuid; n int; rep text := ''; sug jsonb; before_status text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_fin,'authenticated','authenticated','rec.fin@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_fin, v_org, 'Financeiro Rec');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_fin, 'finance', v_ua);
  insert into public.financial_accounts (org_id, unit_id, name) values (v_org, v_ua, 'Conta teste conciliação') returning id into acct;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão rec (teste)', 50) returning id into svc;
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'service', 'Produto rec (teste)', 20000) returning id into prod;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente Rec') returning id into pa;
  insert into public.sales (org_id, unit_id, person_id, status, total_cents, installments, sold_at) values (v_org, v_ua, pa, 'confirmed', 20000, 1, current_date) returning id into sale;
  insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
    values (v_org, v_ua, sale, pa, prod, 1, 1, current_date, date_trunc('month', current_date)::date, 20000, 'open') returning id into recv;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, method, idempotency_key) values (v_org, v_ua, recv, 'payment', 20000, now(), 'pix', 'rec-test-pay') returning id into pay;
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at) values (v_org, v_ua, 'Conta rec (teste)', 15000, current_date, date_trunc('month', current_date)::date, 'paid', now()) returning id into payable;

  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;

  -- importação: uma linha de crédito (deve casar com o pagamento) e uma de débito (deve casar com a conta paga), mais uma inválida (descartada silenciosamente)
  imp := public.bank_statement_import(acct, jsonb_build_array(
    jsonb_build_object('date', current_date::text, 'description', 'Recebimento PIX teste', 'amount_cents', 20000, 'ref', 'X1'),
    jsonb_build_object('date', current_date::text, 'description', 'Pagamento fornecedor teste', 'amount_cents', -15000, 'ref', 'X2'),
    jsonb_build_object('date', current_date::text, 'description', '', 'amount_cents', 0, 'ref', null)
  ));
  select count(*) into n from public.bank_statement_lines where import_id = imp;
  rep := rep || format(E'\n[%s] importação: 2 linhas válidas persistidas, linha zerada descartada (%s)', case when n = 2 then 'OK' else 'FALHA' end, n);

  select id into line_credit from public.bank_statement_lines where import_id = imp and amount_cents > 0;
  select id into line_debit from public.bank_statement_lines where import_id = imp and amount_cents < 0;

  -- sugestão de casamento
  sug := public.bank_reconcile_suggestions(line_credit);
  rep := rep || format(E'\n[%s] sugestão para a linha de crédito encontra o pagamento certo (%s)', case when jsonb_array_length(sug) = 1 and (sug -> 0 ->> 'payment_id')::uuid = pay then 'OK' else 'FALHA' end, sug);

  -- confirmar: nunca cria pagamento novo, só aponta o já existente
  perform public.bank_reconcile_confirm(line_credit, pay, null);
  select status into before_status from public.bank_statement_lines where id = line_credit;
  rep := rep || format(E'\n[%s] confirmar concilia a linha (status=matched) sem criar pagamento novo (%s)', case when before_status = 'matched' then 'OK' else 'FALHA' end, before_status);
  select count(*) into n from public.payments where id = pay;
  rep := rep || format(E'\n[%s] o pagamento original continua único (não duplicado) (%s registro(s))', case when n = 1 then 'OK' else 'FALHA' end, n);

  -- confirmar a linha de débito com a conta a pagar
  perform public.bank_reconcile_confirm(line_debit, null, payable);
  select status into before_status from public.bank_statement_lines where id = line_debit;
  rep := rep || format(E'\n[%s] linha de débito concilia com a conta a pagar (%s)', case when before_status = 'matched' then 'OK' else 'FALHA' end, before_status);

  -- não pode conciliar a mesma linha duas vezes
  declare ok boolean := false; begin
    begin perform public.bank_reconcile_confirm(line_credit, pay, null); ok := true; exception when others then ok := false; end;
    rep := rep || format(E'\n[%s] confirmar uma linha já conciliada é rejeitado', case when not ok then 'OK' else 'FALHA' end);
  end;

  -- não pode conciliar OUTRA linha com o MESMO pagamento (índice único)
  declare imp2 uuid; line2 uuid; ok boolean := false; begin
    imp2 := public.bank_statement_import(acct, jsonb_build_array(jsonb_build_object('date', current_date::text, 'description', 'Duplicata teste', 'amount_cents', 20000, 'ref', 'X3')));
    select id into line2 from public.bank_statement_lines where import_id = imp2;
    begin perform public.bank_reconcile_confirm(line2, pay, null); ok := true; exception when others then ok := false; end;
    rep := rep || format(E'\n[%s] o mesmo pagamento não pode ser conciliado com uma segunda linha', case when not ok then 'OK' else 'FALHA' end);
  end;

  -- desfazer libera a linha de novo
  perform public.bank_reconcile_undo(line_credit);
  select status into before_status from public.bank_statement_lines where id = line_credit;
  rep := rep || format(E'\n[%s] desfazer volta a linha para "unmatched" (%s)', case when before_status = 'unmatched' then 'OK' else 'FALHA' end, before_status);

  -- ignorar exige motivo
  declare ok boolean := false; begin
    begin perform public.bank_reconcile_ignore(line_credit, ''); ok := true; exception when others then ok := false; end;
    rep := rep || format(E'\n[%s] ignorar sem motivo é rejeitado', case when not ok then 'OK' else 'FALHA' end);
  end;
  perform public.bank_reconcile_ignore(line_credit, 'transferência interna, motivo de teste');
  select status into before_status from public.bank_statement_lines where id = line_credit;
  rep := rep || format(E'\n[%s] ignorar com motivo funciona (%s)', case when before_status = 'ignored' then 'OK' else 'FALHA' end, before_status);

  reset role;

  -- não-financeiro não vê nem concilia
  declare u_sales uuid := gen_random_uuid(); begin
    insert into auth.users (id, aud, role, email) values (u_sales,'authenticated','authenticated','rec.sales@t.local');
    insert into public.user_accounts (user_id, org_id, display_name) values (u_sales, v_org, 'Vendas Rec');
    insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_sales, 'sales', v_ua);
    perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.bank_statement_lines where import_id = imp;
    reset role;
    rep := rep || format(E'\n[%s] papel "sales" (sem acesso financeiro) não lê as linhas do extrato (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  end;

  raise exception E'RELATORIO_BANK_RECONCILIATION (transação desfeita):%', rep;
end $$;
