-- Evolução da DRE (migration 027): classificação de categoria, custo direto opcionalmente atribuído a um
-- produto, cobertura de classificação, e a regra de reconhecimento de pacote (sessão realizada, não venda
-- inteira). Confirma: recebimento em mês diferente da competência da parcela, conta cancelada não entra em
-- nenhum total, lançamento sem categoria fica separado (nunca vira despesa operacional por padrão).
-- Transação sempre desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; u_fin uuid := gen_random_uuid();
  cat_custo uuid; cat_desp uuid; cat_semclass uuid;
  prof uuid; svc uuid; prod_pkg uuid; prod_plain uuid; pa uuid;
  sale_pkg uuid; sale_plain uuid; pkg_id uuid; recv_plain uuid; appt1 uuid;
  m_start timestamptz; m_end timestamptz; r jsonb; rep text := ''; mb jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_fin,'authenticated','authenticated','dre.audit@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_fin, v_org, 'DRE Audit');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_fin, 'finance', v_ua);

  insert into public.finance_categories (org_id, name, kind, dre_classification) values (v_org, 'Custo direto teste DRE', 'expense', 'custo_direto') returning id into cat_custo;
  insert into public.finance_categories (org_id, name, kind, dre_classification) values (v_org, 'Despesa operacional teste DRE', 'expense', 'despesa_operacional') returning id into cat_desp;
  insert into public.finance_categories (org_id, name, kind) values (v_org, 'Sem classificar teste DRE', 'expense') returning id into cat_semclass;

  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão DRE', 50) returning id into svc;
  insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id) values (v_org, 'package', 'Pacote DRE 4 sessões', 40000, 4, svc) returning id into prod_pkg;
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'service', 'Serviço avulso DRE', 20000) returning id into prod_plain;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente DRE') returning id into pa;
  insert into public.professionals (org_id, display_name) values (v_org, 'Fisio DRE') returning id into prof;
  insert into public.professional_units values (prof, v_ua);

  m_start := date_trunc('month', now()); m_end := m_start + interval '1 month';

  -- pacote de 4 sessões por R$400 (R$100/sessão) — só 1 sessão de fato realizada no período
  insert into public.sales (org_id, unit_id, person_id, status, total_cents, installments, sold_at) values (v_org, v_ua, pa, 'confirmed', 40000, 1, now()) returning id into sale_pkg;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, sale_id, total_sessions) values (v_org, v_ua, pa, prod_pkg, sale_pkg, 4) returning id into pkg_id;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status)
    values (v_org, v_ua, prof, pa, svc, pkg_id, tstzrange(m_start + interval '2 days', m_start + interval '2 days 1 hour'), 'attended') returning id into appt1;

  -- venda avulsa com parcela de competência antiga, mas RECEBIDA agora (mês do teste)
  insert into public.sales (org_id, unit_id, person_id, status, total_cents, installments, sold_at) values (v_org, v_ua, pa, 'confirmed', 20000, 1, m_start - interval '2 months') returning id into sale_plain;
  insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
    values (v_org, v_ua, sale_plain, pa, prod_plain, 1, 1, (m_start - interval '2 months')::date, (m_start - interval '2 months')::date, 20000, 'open') returning id into recv_plain;

  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.payment_record(recv_plain, 20000, now(), 'pix', null, 'dre-audit-pay');
  reset role;

  -- contas a pagar: custo direto (com produto atribuído), despesa operacional, sem classificar, e uma CANCELADA (não conta em nada)
  insert into public.payables (org_id, unit_id, category_id, product_id, description, amount_cents, due_date, competence_month, status, paid_at)
    values (v_org, v_ua, cat_custo, prod_pkg, 'Material do pacote DRE', 5000, now()::date, date_trunc('month', now())::date, 'paid', now());
  insert into public.payables (org_id, unit_id, category_id, description, amount_cents, due_date, competence_month, status, paid_at)
    values (v_org, v_ua, cat_desp, 'Aluguel teste DRE', 30000, now()::date, date_trunc('month', now())::date, 'paid', now());
  insert into public.payables (org_id, unit_id, category_id, description, amount_cents, due_date, competence_month, status, paid_at)
    values (v_org, v_ua, cat_semclass, 'Despesa sem classificar DRE', 7000, now()::date, date_trunc('month', now())::date, 'paid', now());
  insert into public.payables (org_id, unit_id, category_id, description, amount_cents, due_date, competence_month, status)
    values (v_org, v_ua, cat_desp, 'Cancelada teste DRE', 99999, now()::date, date_trunc('month', now())::date, 'cancelled');

  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  r := public.dre_report(m_start, m_end, v_ua);
  mb := public.margin_by_product(m_start, m_end, v_ua);
  reset role;

  -- pacote reconhece por sessão realizada (1 × R$100 = R$100), NÃO os R$400 inteiros da venda;
  -- o serviço avulso "reconhece" no recebimento (regra herdada, documentada como equivalente a caixa) — recebido
  -- agora, então entra: total = 100 + 200 = 300.
  rep := rep || format(E'\n[%s] receita reconhecida = R$100 (pacote, 1 sessão) + R$200 (avulso, recebido no período apesar da competência antiga) = R$300 (%s)', case when (r->'receita_reconhecida_cents'->>'value')::bigint = 30000 then 'OK' else 'FALHA' end, r->'receita_reconhecida_cents'->>'value');
  rep := rep || format(E'\n[%s] receita de caixa também inclui o recebimento, mesmo com competência de 2 meses atrás (%s)', case when (r->'receita_caixa_cents'->>'value')::bigint >= 20000 then 'OK' else 'FALHA' end, r->'receita_caixa_cents'->>'value');
  rep := rep || format(E'\n[%s] custo direto classificado = R$50 (%s)', case when (r->'custos_diretos_cents'->>'value')::bigint = 5000 then 'OK' else 'FALHA' end, r->'custos_diretos_cents'->>'value');
  rep := rep || format(E'\n[%s] despesa operacional classificada = R$300 (%s)', case when (r->'despesas_operacionais_cents'->>'value')::bigint = 30000 then 'OK' else 'FALHA' end, r->'despesas_operacionais_cents'->>'value');
  rep := rep || format(E'\n[%s] sem classificação = R$70, 1 lançamento — nunca vira despesa operacional por padrão (%s / %s)', case when (r->'sem_classificacao_cents'->>'value')::bigint = 7000 and (r->'sem_classificacao_cents'->>'count')::int = 1 then 'OK' else 'FALHA' end, r->'sem_classificacao_cents'->>'value', r->'sem_classificacao_cents'->>'count');
  rep := rep || format(E'\n[%s] conta cancelada (R$999,99) não entra em nenhum total (%s)', case when (r->'despesas_operacionais_totais_cents'->>'value')::bigint < 99999 then 'OK' else 'FALHA' end, r->'despesas_operacionais_totais_cents'->>'value');
  rep := rep || format(E'\n[%s] cobertura de classificação ≈ 83%% (3 de 4 lançamentos pagos) (%s)', case when (r->'cobertura_classificacao_pct'->>'value')::numeric > 80 and (r->'cobertura_classificacao_pct'->>'value')::numeric < 90 then 'OK' else 'FALHA' end, r->'cobertura_classificacao_pct'->>'value');
  rep := rep || format(E'\n[%s] margem de contribuição consolidada disponível (classificação configurada) (%s)', case when (r->'margem_contribuicao_cents'->>'available')::boolean then 'OK' else 'FALHA' end, r->'margem_contribuicao_cents');
  rep := rep || format(E'\n[%s] resultado operacional = 300 − 0(dedução) − 50(custo) − 300(despesa) = −50 (%s)', case when (r->'resultado_operacional_cents'->>'value')::bigint = -5000 then 'OK' else 'FALHA' end, r->'resultado_operacional_cents'->>'value');

  -- margem por produto: pacote tem custo atribuído (disponível); avulso não tem (indisponível — nunca inventa)
  rep := rep || format(E'\n[%s] margem por produto do pacote disponível = 100−50 = R$50 (%s)', case when exists (select 1 from jsonb_array_elements(mb) e where (e->>'product_id')::uuid = prod_pkg and (e->>'available')::boolean and (e->>'margin_cents')::bigint = 5000) then 'OK' else 'FALHA' end, mb);
  rep := rep || format(E'\n[%s] margem por produto do avulso fica indisponível (sem custo atribuído a ele)', case when not exists (select 1 from jsonb_array_elements(mb) e where (e->>'product_id')::uuid = prod_plain and (e->>'available')::boolean) then 'OK' else 'FALHA' end);

  raise exception E'RELATORIO_DRE_AUDIT (transação desfeita):%', rep;
end $$;
