-- Auditoria semântica do MRR/ARR (migration 024/025): confirma que o MRR vem de CONTRATO recorrente explícito,
-- não de parcela/pagamento. Cobre os cenários pedidos: contrato anual normalizado, venda avulsa parcelada
-- excluída, pagamento atrasado ≠ cancelamento, cancelamento com data futura, expansão/contração, estorno sem
-- efeito no MRR, reativação, e mudança de hoje não reescrevendo o histórico de meses passados.
-- Também confirma a correção de private.dash_units() (migration 026): usuário só com papel "finance" (sem
-- manager/unit_manager) já consegue chamar mrr_report() — antes batia "sem permissão para o painel".
-- Transação sempre desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; u_fin uuid := gen_random_uuid();
  svc uuid; prod uuid;
  p_novo uuid; p_react uuid; p_expand uuid; p_contract uuid; p_cancel uuid; p_steady uuid; p_annual uuid; p_late uuid; p_futurecancel uuid; p_immut uuid; p_avulso uuid;
  c_react uuid; c_expand uuid; c_contract uuid; c_cancel uuid; c_steady uuid; c_annual uuid; c_late uuid; c_futurecancel uuid; c_immut uuid;
  m date := date_trunc('month', current_date)::date; m1 date := (date_trunc('month', current_date) - interval '1 month')::date; m2 date := (date_trunc('month', current_date) - interval '2 months')::date;
  mnext date := (date_trunc('month', current_date) + interval '1 month')::date;
  r jsonb; rep text := ''; n int; sale_id uuid; recv_id uuid; pay_id uuid; mrr_before bigint; mrr_after bigint;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_fin,'authenticated','authenticated','mrr.audit@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_fin, v_org, 'Financeiro Audit');
  -- de propósito só "finance" (sem manager/unit_manager) — testa a correção de private.dash_units() junto.
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_fin, 'finance', v_ua);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão MRR audit', 50) returning id into svc;
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'plan', 'Plano MRR audit', 10000) returning id into prod;

  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Novo') returning id into p_novo;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Reativado') returning id into p_react;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Expansão') returning id into p_expand;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Contração') returning id into p_contract;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Cancelado') returning id into p_cancel;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Estável') returning id into p_steady;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Anual') returning id into p_annual;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Atrasado') returning id into p_late;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR CancelamentoFuturo') returning id into p_futurecancel;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Imutável') returning id into p_immut;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Avulso') returning id into p_avulso;

  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;

  -- NOVO: contrato começa dentro do mês atual
  perform public.recurring_contract_start(p_novo, v_ua, prod, 'monthly', 100000, 0, m, null, 'teste novo');

  -- REATIVAÇÃO: começou 2 meses atrás, cancelou no mês anterior, retomou agora
  c_react := public.recurring_contract_start(p_react, v_ua, prod, 'monthly', 80000, 0, m2, null, 'teste reativação');
  perform public.recurring_contract_change(c_react, 'cancel', m1, null, 0, 'cancelou mês passado');
  perform public.recurring_contract_change(c_react, 'resume', m, 80000, 0, null);

  -- EXPANSÃO: 1000 -> 1500
  c_expand := public.recurring_contract_start(p_expand, v_ua, prod, 'monthly', 100000, 0, m1, null, null);
  perform public.recurring_contract_change(c_expand, 'expansion', m, 150000, 0, null);

  -- CONTRAÇÃO: 1000 -> 600
  c_contract := public.recurring_contract_start(p_contract, v_ua, prod, 'monthly', 100000, 0, m1, null, null);
  perform public.recurring_contract_change(c_contract, 'contraction', m, 60000, 0, 'pediu redução');

  -- CANCELAMENTO: 1000 -> cancelado neste mês
  c_cancel := public.recurring_contract_start(p_cancel, v_ua, prod, 'monthly', 100000, 0, m1, null, null);
  perform public.recurring_contract_change(c_cancel, 'cancel', m, 0, 0, 'pediu cancelamento');

  -- ESTÁVEL: sem mudanças
  c_steady := public.recurring_contract_start(p_steady, v_ua, prod, 'monthly', 100000, 0, m1, null, null);

  -- ANUAL NORMALIZADO: R$1200/ano -> deve virar R$100/mês = 10000 centavos
  c_annual := public.recurring_contract_start(p_annual, v_ua, prod, 'annual', 120000, 0, m1, null, 'plano anual');

  -- ATRASADO: contrato ativo com recebível vencido e NÃO pago — MRR não pode cair por causa de inadimplência
  c_late := public.recurring_contract_start(p_late, v_ua, prod, 'monthly', 100000, 0, m1, null, null);
  reset role;
  insert into public.sales (org_id, unit_id, person_id, status, total_cents, installments, sold_at) values (v_org, v_ua, p_late, 'confirmed', 100000, 1, m1) returning id into sale_id;
  insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
    values (v_org, v_ua, sale_id, p_late, prod, 1, 1, m1, m1, 100000, 'open') returning id into recv_id;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;

  -- CANCELAMENTO COM DATA FUTURA: ainda ativo este mês, cancela só no mês que vem
  c_futurecancel := public.recurring_contract_start(p_futurecancel, v_ua, prod, 'monthly', 100000, 0, m1, null, null);
  perform public.recurring_contract_change(c_futurecancel, 'cancel', mnext, 0, 0, 'cancelamento agendado');

  -- IMUTABILIDADE: começou 2 meses atrás com 500; hoje (dentro do mês atual) uma expansão para 2000
  c_immut := public.recurring_contract_start(p_immut, v_ua, prod, 'monthly', 50000, 0, m2, null, 'teste imutabilidade');
  perform public.recurring_contract_change(c_immut, 'expansion', current_date, 200000, 0, null);

  -- VENDA AVULSA PARCELADA: nenhuma linha em recurring_contracts — não pode aparecer no MRR de jeito nenhum
  reset role;
  insert into public.sales (org_id, unit_id, person_id, status, total_cents, installments, sold_at) values (v_org, v_ua, p_avulso, 'confirmed', 600000, 6, m1) returning id into sale_id;
  for n in 1..6 loop
    insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
      values (v_org, v_ua, sale_id, p_avulso, prod, n, 6, m1 + make_interval(months => n-1), m1 + make_interval(months => n-1), 100000, 'open');
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  r := public.mrr_report(m, v_ua);   -- confirma de brinde que "finance" sozinho já consegue chamar (fix da migration 026)
  reset role;

  rep := rep || format(E'\n[%s] ponte fecha (%s)', case when (r->'bridge'->>'fecha')::boolean then 'OK' else 'FALHA' end, r->'bridge');
  rep := rep || format(E'\n[%s] novo = 1000 (%s)', case when (r->'bridge'->>'novo_cents')::bigint = 100000 then 'OK' else 'FALHA' end, r->'bridge'->>'novo_cents');
  rep := rep || format(E'\n[%s] reativação = 800 (%s)', case when (r->'bridge'->>'reativacao_cents')::bigint = 80000 then 'OK' else 'FALHA' end, r->'bridge'->>'reativacao_cents');
  -- expansão total do mês = c_expand (500) + c_immut (1500, ver "imutabilidade" abaixo) = 2000
  rep := rep || format(E'\n[%s] expansão total = 2000 (c_expand 500 + c_immut 1500) (%s)', case when (r->'bridge'->>'expansao_cents')::bigint = 200000 then 'OK' else 'FALHA' end, r->'bridge'->>'expansao_cents');
  rep := rep || format(E'\n[%s] contração = -400 (%s)', case when (r->'bridge'->>'contracao_cents')::bigint = -40000 then 'OK' else 'FALHA' end, r->'bridge'->>'contracao_cents');
  rep := rep || format(E'\n[%s] cancelamento = -1000 (%s)', case when (r->'bridge'->>'cancelamento_cents')::bigint = -100000 then 'OK' else 'FALHA' end, r->'bridge'->>'cancelamento_cents');

  select amount_cents into n from private.mrr_base(m) where contract_id = c_annual;
  rep := rep || format(E'\n[%s] contrato anual normalizado = R$100/mês (%s centavos)', case when n = 10000 then 'OK' else 'FALHA' end, n);

  select count(*) into n from private.mrr_base(m) where contract_id = c_late;
  rep := rep || format(E'\n[%s] contrato com pagamento atrasado continua no MRR — inadimplência ≠ cancelamento (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);

  select count(*) into n from private.mrr_base(m) where contract_id = c_futurecancel;
  rep := rep || format(E'\n[%s] cancelamento com data futura: ainda ativo neste mês (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from private.mrr_base(mnext) where contract_id = c_futurecancel;
  rep := rep || format(E'\n[%s] cancelamento com data futura: some do MRR no mês agendado (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);

  select count(*) into n from private.mrr_base(m1) where person_id = p_avulso;
  rep := rep || format(E'\n[%s] venda avulsa parcelada (sem contrato) nunca entra no MRR (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);

  select amount_cents into n from private.mrr_base(m2) where contract_id = c_immut;
  rep := rep || format(E'\n[%s] mudança lançada hoje não reescreve o MRR de 2 meses atrás (ainda 500, não 2000) (%s)', case when n = 50000 then 'OK' else 'FALHA' end, n);
  select amount_cents into n from private.mrr_base(m) where contract_id = c_immut;
  rep := rep || format(E'\n[%s] mês atual já reflete a expansão lançada hoje (2000) (%s)', case when n = 200000 then 'OK' else 'FALHA' end, n);

  -- estorno não mexe no MRR: recebe e estorna um pagamento vinculado ao contrato "atrasado"
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  mrr_before := (public.mrr_report(m, v_ua)->'mrr_cents'->>'value')::bigint;
  select public.payment_record(recv_id, 100000, now(), 'pix', null, 'mrr-audit-pay') into pay_id;
  perform public.payment_refund(pay_id, 100000, 'estorno teste auditoria', 'mrr-audit-refund');
  r := public.mrr_report(m, v_ua);
  reset role;
  mrr_after := (r->'mrr_cents'->>'value')::bigint;
  rep := rep || format(E'\n[%s] estorno de pagamento não altera o MRR (antes=%s depois=%s)', case when mrr_before = mrr_after then 'OK' else 'FALHA' end, mrr_before, mrr_after);

  raise exception E'RELATORIO_MRR_AUDIT (transação desfeita):%', rep;
end $$;
