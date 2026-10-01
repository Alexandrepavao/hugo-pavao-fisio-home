-- RELEASE v1 — S18: REPASSES com valor positivo (migrations 075–076). Cenário próprio, valores calculados à mão: regra 20% para o fisioterapeuta; pacote de R$ 1.000,00 em 2 parcelas;
-- recebimentos de R$ 500,00, R$ 300,00 e R$ 100,00; estorno de R$ 100,00 do primeiro. Esperado: comissões 100,00 / 60,00 / 20,00 e estorno −20,00 → líquido 160,00 (20% de R$ 800,00 líquidos).
-- Confere: percentual guardado, estados e transições, resumo do profissional (sem dado do paciente), reconciliação (recálculo + total igual ao Financeiro), regra alterada depois, entradas legadas,
-- duas regras casando, permissões. Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; uu uuid; svc uuid; prod uuid; prod2 uuid; acct uuid; rule1 uuid; rule2 uuid; pe uuid; prof uuid; prof2 uuid;
  u_mgr uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid();
  s1 uuid; s2 uuid; r1 uuid; r2 uuid; r3 uuid; payA uuid; payB uuid; payC uuid; payD uuid; eA uuid; eB uuid; eC uuid; eR uuid; j jsonb; p jsonb; rc jsonb; n bigint; n2 bigint; ok boolean; e text; rep text := '';
  w_from timestamptz := now() - interval '1 day'; w_to timestamptz := now() + interval '1 day'; d1 date := current_date - 1; d2 date := current_date + 1;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade repasses (teste S18)', 'teste-s18') returning id into uu;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s18.local'),(u_fin,'authenticated','authenticated','f@s18.local'),(u_phy,'authenticated','authenticated','p1@s18.local'),
    (u_phy2,'authenticated','authenticated','p2@s18.local'),(u_sales,'authenticated','authenticated','s@s18.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S18'),(u_fin, v_org, null, 'Financeiro S18'),(u_phy, v_org, null, 'Fisio Um S18'),(u_phy2, v_org, null, 'Fisio Dois S18'),(u_sales, v_org, null, 'Comercial S18');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_fin, 'finance', uu),(v_org, u_phy, 'physio', uu),(v_org, u_phy2, 'physio', uu),(v_org, u_sales, 'sales', uu);
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy, 'Fisio Um S18') returning id into prof;
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy2, 'Fisio Dois S18') returning id into prof2;
  insert into public.professional_units (professional_id, unit_id) values (prof, uu), (prof2, uu);
  insert into public.people (org_id, unit_id, full_name) values (v_org, uu, 'Paciente Sigiloso S18') returning id into pe;
  insert into public.services (org_id, name, duration_min, price_cents) values (v_org, 'Sessão S18', 60, 10000) returning id into svc;
  insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id) values (v_org, 'package', 'Pacote Repasse S18', 100000, 10, svc) returning id into prod;
  insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id) values (v_org, 'package', 'Pacote Dois S18', 50000, 5, svc) returning id into prod2;
  insert into public.financial_accounts (org_id, unit_id, name, kind) values (v_org, uu, 'Conta S18', 'bank') returning id into acct;
  insert into public.commission_rules (org_id, name, product_id, beneficiary_user_id, percent_bp) values (v_org, 'Repasse 20% S18', prod, u_phy, 2000) returning id into rule1;

  -- ============ 1) venda, recebimentos, estados e estorno
  set local role authenticated; perform pg_temp.as_user(u_sales);
  s1 := public.sale_create(pe, uu, null, jsonb_build_array(jsonb_build_object('product_id', prod)), 0, 2, current_date, 'venda S18'); perform public.sale_confirm(s1);
  select id into r1 from public.receivables where sale_id = s1 and installment_no = 1; select id into r2 from public.receivables where sale_id = s1 and installment_no = 2;
  perform pg_temp.as_user(u_fin);
  payA := public.payment_record(r1, 50000, now(), 'pix', acct, 'a-' || s1);
  payB := public.payment_record(r2, 30000, now(), 'pix', acct, 'b-' || s1);
  payC := public.payment_record(r2, 10000, now(), 'pix', acct, 'c-' || s1);
  reset role;
  select id into eA from public.commission_entries where payment_id = payA; select id into eB from public.commission_entries where payment_id = payB; select id into eC from public.commission_entries where payment_id = payC;
  rep := rep || pg_temp.chk((select amount_cents from public.commission_entries where id = eA) = 10000 and (select amount_cents from public.commission_entries where id = eB) = 6000 and (select amount_cents from public.commission_entries where id = eC) = 2000,
    '20% de R$ 500,00 = 100,00 · de R$ 300,00 = 60,00 · de R$ 100,00 = 20,00 (todos pendentes)');
  rep := rep || pg_temp.chk((select bool_and(percent_bp = 2000 and beneficiary_user_id = u_phy and status = 'pending') from public.commission_entries where sale_id = s1), 'cada lançamento GUARDA o percentual aplicado (20,00%) e vai ao beneficiário da regra');
  set local role authenticated; perform pg_temp.as_user(u_fin);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.commission_set_status(%L, ''paid'')', eA)) like '%transição inválida%', 'pendente NÃO pode ir direto a pago (precisa ser autorizado antes)');
  perform public.commission_set_status(eA, 'authorized'); perform public.commission_set_status(eA, 'authorized');
  perform public.commission_set_status(eB, 'authorized'); perform public.commission_set_status(eB, 'paid');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.commission_set_status(%L, ''authorized'')', eB)) like '%transição inválida%', 'pago é final: não volta a autorizado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.commission_set_status(%L, ''pending'')', eA)) like '%transição inválida%', 'não existe volta a pendente');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.commission_set_status(%L, ''authorized'')', eC)) like '42501%', 'o próprio beneficiário NÃO autoriza a sua comissão (42501)');
  perform pg_temp.as_user(u_fin); perform public.payment_refund(payA, 10000, 'estorno S18', 'r-' || s1); perform public.payment_refund(payA, 10000, 'estorno S18', 'r-' || s1);
  reset role;
  select id into eR from public.commission_entries where sale_id = s1 and status = 'reversed';
  select count(*) into n from public.commission_entries where sale_id = s1 and status = 'reversed';
  rep := rep || pg_temp.chk(n = 1 and (select amount_cents from public.commission_entries where id = eR) = -2000 and (select percent_bp from public.commission_entries where id = eR) = 2000, 'estorno de R$ 100,00 gera UM lançamento de −20,00 (e repetir não duplica)');
  select sum(amount_cents) into n from public.commission_entries where sale_id = s1; rep := rep || pg_temp.chk(n = 16000, 'líquido = 100 + 60 + 20 − 20 = R$ 160,00 = 20% de R$ 800,00 líquidos');
  select count(*) into n from public.audit_log where entity_type = 'commission_entries' and entity_id in (eA::text, eB::text) and action = 'update'; rep := rep || pg_temp.chk(n >= 3, 'cada mudança de estado foi auditada (A autorizada; B autorizada e paga)');

  -- ============ 2) resumo do profissional: pendente, autorizado, pago, estornos, líquido e detalhe (sem o paciente)
  set local role authenticated; perform pg_temp.as_user(u_phy);
  j := public.my_professional_summary(d1, d2); p := j -> 'payouts';
  rep := rep || pg_temp.chk((p ->> 'authorized_cents')::bigint = 10000 and (p ->> 'paid_cents')::bigint = 6000 and (p ->> 'pending_cents')::bigint = 2000 and (p ->> 'reversed_cents')::bigint = -2000 and (p ->> 'net_cents')::bigint = 16000 and (p ->> 'available')::boolean,
    'resumo do fisioterapeuta: autorizado 100,00 · pago 60,00 · pendente 20,00 · estornos −20,00 · líquido 160,00');
  rep := rep || pg_temp.chk(jsonb_array_length(p -> 'entries') = 4, 'detalhamento com os 4 lançamentos');
  select count(*) into n from jsonb_array_elements(p -> 'entries') x where (x ->> 'percent_bp')::int = 2000 and x ->> 'rule' = 'Repasse 20% S18' and x ->> 'products' = 'Pacote Repasse S18' and (x ->> 'base_cents')::bigint in (50000, 30000, 10000);
  rep := rep || pg_temp.chk(n = 4, 'cada linha traz base (valor do recebimento ou do estorno), percentual, regra e produto');
  select count(*) into n from jsonb_array_elements(p -> 'entries') x where x ->> 'kind' = 'refund' and (x ->> 'amount_cents')::bigint = -2000 and (x ->> 'base_cents')::bigint = 10000; rep := rep || pg_temp.chk(n = 1, 'o estorno aparece como tal: base R$ 100,00 → −20,00');
  rep := rep || pg_temp.chk(position('Paciente Sigiloso' in p::text) = 0 and position(pe::text in p::text) = 0, 'o detalhamento NÃO traz nome nem identificador do paciente');
  rep := rep || pg_temp.chk((select coalesce(sum((x ->> 'amount_cents')::bigint), 0) from jsonb_array_elements(p -> 'entries') x) = (p ->> 'net_cents')::bigint, 'a soma das linhas fecha com o líquido');
  perform pg_temp.as_user(u_phy2); p := public.my_professional_summary(d1, d2) -> 'payouts';
  rep := rep || pg_temp.chk(not (p ->> 'available')::boolean and (p ->> 'net_cents')::bigint = 0 and jsonb_array_length(p -> 'entries') = 0, 'outro fisioterapeuta não vê nada desses repasses (indisponível, zero lançamentos)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_professional_summary(%L, %L, %L)', d1, d2, prof)) like '42501%', 'nem consegue abrir o resumo do colega');
  perform pg_temp.as_user(u_mgr); p := public.my_professional_summary(d1, d2, prof) -> 'payouts';
  rep := rep || pg_temp.chk(not (p ->> 'visible')::boolean, 'gestor vê os atendimentos do profissional, mas NÃO os repasses dele');

  -- ============ 3) reconciliação financeira
  perform pg_temp.as_user(u_fin); rc := public.commission_reconciliation(w_from, w_to, uu);
  rep := rep || pg_temp.chk((rc ->> 'entries')::int = 4 and (rc ->> 'total_cents')::bigint = 16000 and (rc ->> 'recomputed_cents')::bigint = 16000 and (rc ->> 'mismatch_count')::int = 0, 'reconciliação: 4 lançamentos; total R$ 160,00 = recálculo (base × percentual) R$ 160,00; 0 divergências');
  rep := rep || pg_temp.chk((rc ->> 'finance_total_cents')::bigint = 16000 and (rc ->> 'diff_vs_finance_cents')::bigint = 0 and (rc ->> 'ok')::boolean, 'o total confere com a linha “Comissões” da Visão geral (finance_by_line): diferença 0');
  rep := rep || pg_temp.chk((rc ->> 'authorized_cents')::bigint = 10000 and (rc ->> 'paid_cents')::bigint = 6000 and (rc ->> 'pending_cents')::bigint = 2000 and (rc ->> 'reversed_cents')::bigint = -2000, 'por estado: autorizado 100,00 · pago 60,00 · pendente 20,00 · estornado −20,00 (soma = total)');
  rep := rep || pg_temp.chk(((public.finance_by_line(w_from, w_to, uu) -> 'total' ->> 'commissions_cents')::bigint = 16000) and ((public.finance_by_line(w_from, w_to, uu) -> 'reconciliation' ->> 'ok')::boolean), 'e a própria reconciliação interna do Financeiro continua ok (consolidado = linhas)');
  perform pg_temp.as_user(u_phy); rep := rep || pg_temp.chk(pg_temp.err(format('select public.commission_reconciliation(%L, %L, %L)', w_from, w_to, uu)) like '42501%', 'fisioterapeuta NÃO abre a reconciliação (42501)');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err(format('select public.commission_reconciliation(%L, %L, %L)', w_from, w_to, uu)) like '42501%', 'comercial NÃO abre a reconciliação (42501)');
  reset role; set local role anon; rep := rep || pg_temp.chk(pg_temp.err(format('select public.commission_reconciliation(%L, %L, %L)', w_from, w_to, uu)) like '42501%', 'anon NÃO abre a reconciliação');
  reset role;

  -- ============ 4) regra alterada DEPOIS e lançamentos legados (sem percentual guardado)
  update public.commission_rules set percent_bp = 3000 where id = rule1;
  set local role authenticated; perform pg_temp.as_user(u_fin); rc := public.commission_reconciliation(w_from, w_to, uu);
  rep := rep || pg_temp.chk((rc ->> 'mismatch_count')::int = 0 and (rc ->> 'ok')::boolean, 'mudar o percentual da regra DEPOIS não quebra a conferência: o lançamento usa o percentual guardado (20%), não o atual (30%)');
  reset role; update public.commission_entries set percent_bp = null where id = eB;
  set local role authenticated; perform pg_temp.as_user(u_fin); rc := public.commission_reconciliation(w_from, w_to, uu);
  rep := rep || pg_temp.chk((rc ->> 'estimated_percent_count')::int = 1 and (rc ->> 'mismatch_count')::int = 1 and not (rc ->> 'ok')::boolean, 'lançamento LEGADO (sem percentual guardado) é recalculado pelo percentual ATUAL, marcado como estimado e a divergência aparece (60,00 × 90,00) em vez de ser escondida');
  perform pg_temp.as_user(u_phy); p := public.my_professional_summary(d1, d2) -> 'payouts';
  select count(*) into n from jsonb_array_elements(p -> 'entries') x where (x ->> 'percent_estimated')::boolean; rep := rep || pg_temp.chk(n = 1, 'o resumo do profissional marca o percentual do lançamento legado como estimado');
  reset role; update public.commission_entries set percent_bp = 2000 where id = eB; update public.commission_rules set percent_bp = 2000 where id = rule1;

  -- ============ 5) duas regras casando na mesma venda: AMBAS geram lançamento (cada uma para o seu beneficiário)
  insert into public.commission_rules (org_id, name, product_id, beneficiary_user_id, percent_bp) values (v_org, 'Regra geral 5% S18', null, u_phy2, 500) returning id into rule2;
  set local role authenticated; perform pg_temp.as_user(u_sales);
  s2 := public.sale_create(pe, uu, null, jsonb_build_array(jsonb_build_object('product_id', prod)), 0, 1, current_date, 'venda S18 b'); perform public.sale_confirm(s2);
  perform pg_temp.as_user(u_fin); select id into r3 from public.receivables where sale_id = s2; payD := public.payment_record(r3, 100000, now(), 'pix', acct, 'd-' || s2); reset role;
  select count(*) into n from public.commission_entries where payment_id = payD; select sum(amount_cents) into n2 from public.commission_entries where payment_id = payD;
  rep := rep || pg_temp.chk(n = 2 and n2 = 20000 + 5000 and (select count(distinct beneficiary_user_id) from public.commission_entries where payment_id = payD) = 2, 'regra do produto (20%) e regra geral (5%) casam: DOIS lançamentos (R$ 200,00 + R$ 50,00), um por beneficiário — todas as regras ativas que casam se somam');
  set local role authenticated; perform pg_temp.as_user(u_fin); rc := public.commission_reconciliation(w_from, w_to, uu);
  rep := rep || pg_temp.chk((rc ->> 'entries')::int = 6 and (rc ->> 'ok')::boolean and (rc ->> 'total_cents')::bigint = 16000 + 25000, 'a reconciliação continua fechando com as duas regras (6 lançamentos, R$ 410,00)');
  reset role;

  raise exception E'RELATORIO_S18_REPASSES (transação desfeita):%', rep;
end $$;
