-- Teste de MRR/ARR (ponte de movimentação), DRE honesta e distribuição geográfica. Transação desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; u_mgr uuid := gen_random_uuid();
  svc uuid; prod uuid; p_new uuid; p_react uuid; p_expand uuid; p_contract uuid; p_churn uuid; p_steady uuid;
  m date := date_trunc('month', current_date)::date; m1 date := (date_trunc('month', current_date) - interval '1 month')::date; m2 date := (date_trunc('month', current_date) - interval '2 months')::date;
  r jsonb; n int; ok boolean; rep text := '';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','mrr.mgr@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_mgr, v_org, 'Gestor MRR');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão MRR (teste)', 50) returning id into svc;
  insert into public.products (org_id, kind, name, price_cents, recurrence) values (v_org, 'plan', 'Mensalidade MRR (teste)', 100000, 'monthly') returning id into prod;

  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Novo') returning id into p_new;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Reativado') returning id into p_react;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Expansão') returning id into p_expand;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Contração') returning id into p_contract;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Cancelado') returning id into p_churn;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'MRR Estável') returning id into p_steady;

  -- helper inline: uma venda confirmada + um recebível de competência/valor dados, por pessoa
  create or replace function pg_temp.mk(p_org uuid, p_unit uuid, p_prod uuid, p_person uuid, p_month date, p_amount bigint) returns void language plpgsql as $f$
    declare v_sale uuid;
    begin
      insert into public.sales (org_id, unit_id, person_id, status, total_cents, installments, sold_at) values (p_org, p_unit, p_person, 'confirmed', p_amount, 1, p_month) returning id into v_sale;
      insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
        values (p_org, p_unit, v_sale, p_person, p_prod, 1, 1, p_month, p_month, p_amount, 'open');
    end $f$;

  perform pg_temp.mk(v_org, v_ua, prod, p_new, m, 100000);                                       -- novo: só existe no mês atual
  perform pg_temp.mk(v_org, v_ua, prod, p_react, m2, 80000); perform pg_temp.mk(v_org, v_ua, prod, p_react, m, 80000);        -- reativado: existiu 2 meses atrás, sumiu no mês anterior, voltou agora
  perform pg_temp.mk(v_org, v_ua, prod, p_expand, m1, 100000); perform pg_temp.mk(v_org, v_ua, prod, p_expand, m, 150000);    -- expansão de 500
  perform pg_temp.mk(v_org, v_ua, prod, p_contract, m1, 100000); perform pg_temp.mk(v_org, v_ua, prod, p_contract, m, 60000); -- contração de 400
  perform pg_temp.mk(v_org, v_ua, prod, p_churn, m1, 100000);                                    -- cancelado: só existia no mês anterior
  perform pg_temp.mk(v_org, v_ua, prod, p_steady, m1, 100000); perform pg_temp.mk(v_org, v_ua, prod, p_steady, m, 100000);    -- estável: sem movimento

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  r := public.mrr_report(m, v_ua);
  reset role;

  rep := rep || format(E'\n[%s] MRR final = 1000+800+1500+600+1000 = 4900 reais em centavos (%s)', case when (r->'mrr_cents'->>'value')::bigint = 490000 then 'OK' else 'FALHA' end, r->'mrr_cents'->>'value');
  rep := rep || format(E'\n[%s] ARR = MRR × 12 (%s)', case when (r->'arr_cents'->>'value')::numeric = 490000 * 12 then 'OK' else 'FALHA' end, r->'arr_cents'->>'value');
  rep := rep || format(E'\n[%s] ponte fecha exatamente (mrr_inicial + novo + expansão + reativação − contração − cancelamento = mrr_final) (%s)', case when (r->'bridge'->>'fecha')::boolean then 'OK' else 'FALHA' end, r->'bridge');
  rep := rep || format(E'\n[%s] novo = 1000 (%s)', case when (r->'bridge'->>'novo_cents')::bigint = 100000 then 'OK' else 'FALHA' end, r->'bridge'->>'novo_cents');
  rep := rep || format(E'\n[%s] reativação = 800 (%s)', case when (r->'bridge'->>'reativacao_cents')::bigint = 80000 then 'OK' else 'FALHA' end, r->'bridge'->>'reativacao_cents');
  rep := rep || format(E'\n[%s] expansão = 500 (%s)', case when (r->'bridge'->>'expansao_cents')::bigint = 50000 then 'OK' else 'FALHA' end, r->'bridge'->>'expansao_cents');
  rep := rep || format(E'\n[%s] contração = −400 (%s)', case when (r->'bridge'->>'contracao_cents')::bigint = -40000 then 'OK' else 'FALHA' end, r->'bridge'->>'contracao_cents');
  rep := rep || format(E'\n[%s] cancelamento = −1000 (%s)', case when (r->'bridge'->>'cancelamento_cents')::bigint = -100000 then 'OK' else 'FALHA' end, r->'bridge'->>'cancelamento_cents');
  rep := rep || format(E'\n[%s] mrr_inicial = 1000(react-antes-não-conta)+1000(expand)+1000(contract)+1000(churn)+1000(estável) = 4000 (%s)', case when (r->'bridge'->>'mrr_inicial_cents')::bigint = 400000 then 'OK' else 'FALHA' end, r->'bridge'->>'mrr_inicial_cents');
  rep := rep || format(E'\n[%s] churn de clientes = 1 de 4 clientes recorrentes do mês anterior (expand/contract/churn/steady) = 25%% (%s)', case when (r->'churn_clientes_pct'->>'value')::numeric = 25.0 then 'OK' else 'FALHA' end, r->'churn_clientes_pct'->>'value');
  rep := rep || format(E'\n[%s] retenção líquida = (4000−400−1000+500)/4000 = 77.5%% (%s)', case when (r->'retencao_liquida_pct'->>'value')::numeric = 77.5 then 'OK' else 'FALHA' end, r->'retencao_liquida_pct'->>'value');
  rep := rep || format(E'\n[%s] retenção bruta = (4000−400−1000)/4000 = 65%% (sem contar expansão) (%s)', case when (r->'retencao_bruta_pct'->>'value')::numeric = 65.0 then 'OK' else 'FALHA' end, r->'retencao_bruta_pct'->>'value');

  -- mês sem nenhum recebível recorrente anterior: bases zero devem virar "não aplicável", nunca divisão por zero
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  r := public.mrr_report((m - interval '11 months')::date, v_ua);
  reset role;
  rep := rep || format(E'\n[%s] mês sem base anterior: churn de receita fica "indisponível" (não divide por zero) (%s)', case when (r->'churn_receita_pct'->>'available') = 'false' then 'OK' else 'FALHA' end, r->'churn_receita_pct');

  -- DRE: nunca inventa margem sem custo direto cadastrado
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  r := public.dre_report(now() - interval '1 day', now() + interval '1 day', v_ua);
  reset role;
  rep := rep || format(E'\n[%s] DRE: margem de contribuição fica marcada indisponível, nunca um número inventado (%s)', case when (r->'margem_contribuicao_cents'->>'available') = 'false' and (r->'margem_contribuicao_cents'->>'value') is null then 'OK' else 'FALHA' end, r->'margem_contribuicao_cents');
  rep := rep || format(E'\n[%s] DRE: resultado de caixa é rotulado como caixa, não como lucro (basis menciona "NÃO é lucro") (%s)', case when (r->'resultado_caixa_cents'->>'basis') ilike '%%NÃO é lucro%%' then 'OK' else 'FALHA' end, r->'resultado_caixa_cents'->>'basis');

  -- Geografia: sem cadastro de cidade/UF ainda -> soma bate e "sem_localizacao" = total
  update public.people set city = 'São Paulo', state_uf = 'SP' where id = p_new;
  insert into public.person_kinds (person_id, kind) values (p_new, 'patient'), (p_react, 'patient'), (p_expand, 'patient'), (p_contract, 'patient'), (p_churn, 'patient'), (p_steady, 'patient');
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  r := public.geo_distribution('patient', v_ua);
  reset role;
  -- Dev já tem outros pacientes de outras sessões/QA: não assume tabela vazia, só que nosso lote específico aparece corretamente.
  rep := rep || format(E'\n[%s] geo: total inclui pelo menos os 6 pacientes deste teste (%s)', case when (r->>'total')::int >= 6 then 'OK' else 'FALHA' end, r->>'total');
  rep := rep || format(E'\n[%s] geo: pelo menos os 5 sem cidade/UF deste lote entram em "sem_localizacao" (%s)', case when (r->>'sem_localizacao')::int >= 5 then 'OK' else 'FALHA' end, r->>'sem_localizacao');
  rep := rep || format(E'\n[%s] geo: total − sem_localizacao ≥ 1 (nosso paciente com SP entra na contagem de quem tem localização) (%s)', case when (r->>'total')::int - (r->>'sem_localizacao')::int >= 1 then 'OK' else 'FALHA' end, r);
  rep := rep || format(E'\n[%s] geo: SP aparece em by_state com ao menos 1 pessoa (%s)', case when exists (select 1 from jsonb_array_elements(r->'by_state') e where e->>'uf' = 'SP' and (e->>'count')::int >= 1) then 'OK' else 'FALHA' end, r->'by_state');

  raise exception E'RELATORIO_FINANCE_REPORTS_GEO (transação desfeita):%', rep;
end $$;
