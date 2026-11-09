-- RELEASE v1 — S37: repasse do fisio por SESSÃO ATENDIDA (migration 100): regra do admin, lançamento a cada sessão, troca de fisio, resíduo pago e não atendido, cobertura do parcelado,
-- máquina de estados, devolução de sessão, retroativo só a partir da vigência, extrato sem nome de paciente e indicadores. Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.headers', '{}', true); end $$;
do $$
declare
  v_org uuid; ua uuid; svc uuid; rep text := ''; j jsonb; n int; e text; r jsonb;
  u_mgr uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_y uuid := gen_random_uuid(); u_z uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid();
  pe_y uuid; pe_z uuid; p1 uuid; pr_y uuid; pr_z uuid; prod uuid; prod_free uuid; sale1 uuid; sale2 uuid; sale3 uuid; pkg1 uuid; pkg2 uuid; pkg3 uuid; ap uuid; pay1 uuid; i int; id_a uuid; id_b uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade teste S37', 'teste-s37') returning id into ua;
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@s37.local' from unnest(array[u_mgr,u_fin,u_sales,u_y,u_z,u_p1]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio Y S37') returning id into pe_y;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio Z S37') returning id into pe_z;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S37') returning id into p1;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor'),(u_fin, v_org, null, 'Financeiro'),(u_sales, v_org, null, 'Comercial'),(u_y, v_org, pe_y, 'Fisio Y'),(u_z, v_org, pe_z, 'Fisio Z'),(u_p1, v_org, p1, 'Paciente');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org,u_mgr,'manager',null),(v_org,u_fin,'finance',null),(v_org,u_sales,'sales',ua),(v_org,u_y,'physio',ua),(v_org,u_z,'physio',ua),(v_org,u_p1,'member',null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço S37', 30) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_y, pe_y, 'Fisio Y S37') returning id into pr_y;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_z, pe_z, 'Fisio Z S37') returning id into pr_z;
  insert into public.professional_units (professional_id, unit_id) values (pr_y, ua),(pr_z, ua);
  insert into public.products (org_id, kind, name, price_cents, sessions_count, validity_days, service_id) values (v_org, 'package', 'Pacote 10 S37', 160000, 10, 90, svc) returning id into prod;
  insert into public.products (org_id, kind, name, price_cents, sessions_count, validity_days, service_id) values (v_org, 'package', 'Pacote sem regra S37', 80000, 4, 90, svc) returning id into prod_free;
  -- pacote 1: pago por inteiro; pacote 2: pago pela METADE (parcelado); pacote 3: sem regra de repasse
  for i in 1..3 loop
    declare v_s uuid; v_r uuid; v_p uuid; v_prod uuid := case i when 3 then prod_free else prod end; v_tot int := case i when 3 then 80000 else 160000 end; v_paid int := case i when 1 then 160000 when 2 then 80000 else 80000 end; v_n int := case i when 3 then 4 else 10 end;
    begin
      insert into public.sales (org_id, unit_id, person_id, status, subtotal_cents, total_cents, sold_at) values (v_org, ua, p1, 'confirmed', v_tot, v_tot, now()) returning id into v_s;
      insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents, status) values (v_org, ua, v_s, p1, v_prod, 1, 1, current_date, date_trunc('month', current_date)::date, v_tot, 'paid') returning id into v_r;
      insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, idempotency_key) values (v_org, ua, v_r, 'payment', v_paid, 'pay37-' || i || gen_random_uuid()::text) returning id into v_p;
      insert into public.client_packages (org_id, unit_id, person_id, product_id, sale_id, total_sessions) values (v_org, ua, p1, v_prod, v_s, v_n) returning id into ap;
      insert into public.session_ledger (org_id, client_package_id, delta, reason) values (v_org, ap, v_n, 'grant');
      if i = 1 then pkg1 := ap; sale1 := v_s; elsif i = 2 then pkg2 := ap; sale2 := v_s; else pkg3 := ap; sale3 := v_s; end if;
    end;
  end loop;

  set local role authenticated;
  -- ============ regra do admin
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.product_share_set(%L, 10000)', prod)) like '42501%', 'comercial NÃO define repasse (42501)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.physio_payouts_list()') like '42501%', 'comercial não lista lançamentos');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.product_share_set(%L, 16001)', prod)) like '%não pode superar%', 'repasse acima do valor da sessão (R$ 160,00) é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.product_share_set(%L, -1)', prod)) like '%repasse por sessão%', 'repasse negativo é recusado');
  perform public.product_share_set(prod, 10000);
  r := (select x from jsonb_array_elements(public.physio_pricing_list()) x where x ->> 'id' = prod::text);
  rep := rep || pg_temp.chk((r ->> 'session_value_cents')::int = 16000 and (r ->> 'share_cents')::int = 10000 and (r ->> 'hp_cents')::int = 6000, 'tela de preços: sessão R$ 160 → fisio R$ 100 / HP R$ 60 (derivado do valor final do pacote ÷ sessões)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.product_price_set(%L, 90000)', prod)) like '%ficaria abaixo do repasse%', 'baixar o preço abaixo do repasse é recusado');
  perform public.product_price_set(prod, 200000); perform public.product_price_set(prod, 160000);
  perform pg_temp.as_user(u_fin); rep := rep || pg_temp.chk(pg_temp.err(format('select public.product_share_set(%L, 100)', prod)) like '42501%', 'financeiro lê mas não define a regra (42501)');

  -- ============ pacote 1: o fisio Y atende 3 sessões; Z é o responsável pelo pacote (novo fisio designado pelo admin)
  reset role;
  for i in 1..3 loop
    insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status) values (v_org, ua, pr_y, p1, svc, pkg1, tstzrange(now() - make_interval(days => 20 - i), now() - make_interval(days => 20 - i) + interval '30 minutes'), 'attended') returning id into ap;
    insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) values (v_org, pkg1, ap, -1, 'consume');
    if i = 1 then id_a := ap; end if;
  end loop;
  select count(*) into n from public.physio_payouts where professional_id = pr_y and kind = 'session' and amount_cents = 10000 and status = 'pending'; rep := rep || pg_temp.chk(n = 3, 'cada sessão atendida gera 1 lançamento de R$ 100 pendente para o fisio que ATENDEU (3)');
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status) values (v_org, ua, pr_z, p1, svc, pkg1, tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '30 minutes'), 'cancelled_by_patient') returning id into ap;
  select count(*) into n from public.physio_payouts where professional_id = pr_z; rep := rep || pg_temp.chk(n = 0, 'sessão cancelada sem consumo não gera repasse');
  update public.client_packages set responsible_professional_id = pr_z where id = pkg1;
  update public.client_packages set status = 'expired' where id = pkg1;
  select count(*) into n from public.physio_payouts where client_package_id = pkg1 and kind = 'residual' and professional_id = pr_z and amount_cents = 70000; rep := rep || pg_temp.chk(n = 1, 'pacote venceu com 3 de 10 atendidas: as 7 sessões PAGAS e não atendidas (R$ 700) vão ao fisio responsável Z');
  update public.client_packages set status = 'active' where id = pkg1; update public.client_packages set status = 'expired' where id = pkg1;
  select count(*) into n from public.physio_payouts where client_package_id = pkg1 and kind = 'residual'; rep := rep || pg_temp.chk(n = 1, 'o resíduo não duplica (idempotente)');
  select sum(amount_cents) into n from public.physio_payouts where client_package_id = pkg1 and status <> 'void'; rep := rep || pg_temp.chk(n = 100000, 'total do pacote = 10 sessões × R$ 100 = R$ 1.000, repartido: Y 300 + Z 700');
  set local role authenticated;

  -- ============ extrato do fisio: sem nome de paciente
  perform pg_temp.as_user(u_y); j := public.prof_commission_statement(current_date - 1, current_date + 1);
  rep := rep || pg_temp.chk((j -> 'totals' ->> 'pending_cents')::int = 30000 and (j -> 'totals' ->> 'sessions')::int = 3, 'extrato do Y: R$ 300 pendente, 3 sessões');
  rep := rep || pg_temp.chk(position('Paciente S37' in j::text) = 0, 'o extrato NÃO mostra o nome do paciente');
  perform pg_temp.as_user(u_z); j := public.prof_commission_statement(current_date - 1, current_date + 1);
  rep := rep || pg_temp.chk((j -> 'totals' ->> 'pending_cents')::int = 70000, 'extrato do Z: R$ 700 pendente (o resíduo)');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err('select public.prof_commission_statement()') like '42501%', 'quem não é profissional não vê extrato');

  -- ============ máquina de estados
  perform pg_temp.as_user(u_fin); j := public.physio_payouts_list('pending', null, null, null);
  rep := rep || pg_temp.chk((select count(*) from jsonb_array_elements(j) x where x ->> 'package_id' = pkg1::text) = 4 and exists (select 1 from jsonb_array_elements(j) x where x ->> 'patient' = 'Paciente S37'), 'o financeiro/admin vê os 4 lançamentos pendentes, com paciente e produto (conferência)');
  id_a := (select (x ->> 'id')::uuid from jsonb_array_elements(j) x where x ->> 'kind' = 'session' limit 1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.physio_payout_pay(%L)', id_a)) like '%pague apenas o que foi autorizado%', 'pagar antes de autorizar é recusado');
  perform public.physio_payout_authorize(id_a);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.physio_payout_authorize(%L)', id_a)) like '%transição inválida%', 'autorizar duas vezes é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.physio_payout_void(%L, ''erro'')', id_a)) like '%só lançamento pendente%', 'anular um autorizado é recusado (faz-se ajuste)');
  perform public.physio_payout_pay(id_a);
  id_b := (select (x ->> 'id')::uuid from jsonb_array_elements(j) x where x ->> 'kind' = 'session' and (x ->> 'id')::uuid <> id_a limit 1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.physio_payout_void(%L, null)', id_b)) like '%informe o motivo%', 'anular exige motivo');
  perform public.physio_payout_void(id_b, 'sessão lançada em duplicidade');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err(format('select public.physio_payout_authorize(%L)', id_a)) like '42501%', 'comercial não autoriza');
  perform pg_temp.as_user(u_y); rep := rep || pg_temp.chk(pg_temp.err(format('select public.physio_payout_authorize(%L)', id_a)) like '42501%', 'o próprio fisio não autoriza o repasse (42501)');

  -- ============ devolução de sessão: pendente é anulado; autorizado/pago gera estorno negativo
  reset role;
  select a.id into ap from public.appointments a where a.client_package_id = pkg1 and a.status = 'attended' and exists (select 1 from public.physio_payouts x where x.appointment_id = a.id and x.status = 'pending') limit 1;
  insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) values (v_org, pkg1, ap, 1, 'refund');
  select count(*) into n from public.physio_payouts where appointment_id = ap and status = 'void'; rep := rep || pg_temp.chk(n = 1, 'sessão devolvida com repasse PENDENTE: o lançamento é anulado');
  select p.appointment_id into ap from public.physio_payouts p where p.id = id_a;
  insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) values (v_org, pkg1, ap, 1, 'refund');
  select count(*) into n from public.physio_payouts where kind = 'reversal' and ref_payout_id = id_a and amount_cents = -10000 and status = 'pending'; rep := rep || pg_temp.chk(n = 1, 'sessão devolvida com repasse PAGO: nasce um estorno de −R$ 100 pendente (o pago não é reescrito)');
  set local role authenticated;

  -- ============ pacote 2 pago pela metade: só o coberto é liberado
  reset role;
  for i in 1..6 loop
    insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status) values (v_org, ua, pr_y, p1, svc, pkg2, tstzrange(now() - make_interval(hours => 30 + i * 2), now() - make_interval(hours => 30 + i * 2) + interval '30 minutes'), 'attended') returning id into ap;
    insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) values (v_org, pkg2, ap, -1, 'consume');
  end loop;
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  j := public.physio_payouts_list('pending', null, null, pr_y);
  rep := rep || pg_temp.chk((select count(*) from jsonb_array_elements(j) x where x ->> 'package_id' = pkg2::text and (x ->> 'covered')::boolean) = 5 and (select count(*) from jsonb_array_elements(j) x where x ->> 'package_id' = pkg2::text and not (x ->> 'covered')::boolean) = 1,
    'pacote pago pela metade (R$ 800 de R$ 1.600): 5 repasses cobertos (R$ 500) e o 6º sem cobertura');
  id_b := (select (x ->> 'id')::uuid from jsonb_array_elements(j) x where x ->> 'package_id' = pkg2::text and not (x ->> 'covered')::boolean limit 1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.physio_payout_authorize(%L)', id_b)) like '%ainda não pagou o suficiente%', 'repasse sem cobertura do pagamento não é autorizado');
  perform public.physio_payout_authorize((select (x ->> 'id')::uuid from jsonb_array_elements(j) x where x ->> 'package_id' = pkg2::text and (x ->> 'covered')::boolean limit 1));

  -- ============ sem regra: nada é inventado; regra nova vale a partir da vigência e o retroativo é explícito
  reset role;
  for i in 1..2 loop
    insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status) values (v_org, ua, pr_z, p1, svc, pkg3, tstzrange(now() - make_interval(days => 5 + i), now() - make_interval(days => 5 + i) + interval '30 minutes'), 'attended') returning id into ap;
    insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) values (v_org, pkg3, ap, -1, 'consume');
  end loop;
  select count(*) into n from public.physio_payouts where client_package_id = pkg3; rep := rep || pg_temp.chk(n = 0, 'produto SEM regra de repasse: nenhum lançamento é inventado (nem zero)');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(jsonb_array_length(public.physio_payouts_missing() -> 'sessions_without_payout') = 0, 'sem regra cadastrada, a pendência ainda não cobra o repasse (e lançamento anulado de propósito não volta como pendência)');
  perform public.product_share_set(prod_free, 8000);
  rep := rep || pg_temp.chk((public.physio_payouts_missing() -> 'sessions_without_payout' -> 0 ->> 'sessions')::int = 2, 'regra criada depois: a pendência mostra 2 sessões atendidas sem lançamento');
  rep := rep || pg_temp.chk(public.physio_payouts_backfill(prod_free) = 2 and public.physio_payouts_backfill(prod_free) = 0, 'o retroativo é uma ação do admin, gera 2 lançamentos e não repete');

  -- ============ atribuição e ajuste
  id_b := (select (x ->> 'id')::uuid from jsonb_array_elements(public.physio_payouts_list('pending', null, null, pr_z)) x where x ->> 'package_id' = pkg3::text limit 1);
  perform public.physio_payout_reassign(id_b, pr_y);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.physio_payout_reassign(%L, %L)', id_a, pr_z)) like '%só lançamento pendente%', 'lançamento pago não muda de fisio');
  perform public.physio_payout_adjust(pr_y, -2500, 'correção de sessão avulsa paga a mais');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.physio_payout_adjust(%L, 0, ''x'')', pr_y)) like '%valor do ajuste%' and pg_temp.err(format('select public.physio_payout_adjust(%L, 100, null)', pr_y)) like '%motivo%', 'ajuste exige valor e motivo');
  perform public.package_responsible_set(pkg3, pr_z);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.package_responsible_set(%L, %L)', pkg3, gen_random_uuid())) like '%profissional inválido%', 'fisio responsável inexistente é recusado');

  -- ============ indicadores do fisio
  perform pg_temp.as_user(u_y); j := public.prof_kpis(current_date - 30, current_date + 1);
  rep := rep || pg_temp.chk((j -> 'agenda' ->> 'attended')::int >= 8 and j -> 'agenda' -> 'attendance_rate' is not null, 'indicadores: atendimentos realizados e taxa de comparecimento');
  rep := rep || pg_temp.chk((j ->> 'revenue_generated_cents')::bigint > 0 and position('Paciente S37' in j::text) = 0, 'receita gerada pelas sessões atendidas, sem dado de paciente');
  rep := rep || pg_temp.chk(j -> 'adherence' = 'null'::jsonb and j ->> 'adherence_note' is not null and j -> 'outcome' ->> 'avg_pain_change' is null, 'adesão e variação de dor sem base: nulos (não inventa zero)');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err('select public.prof_kpis()') like '42501%', 'quem não é profissional não vê indicadores de fisio');
  set local role anon;
  foreach e in array array['physio_pricing_list()','prof_commission_statement()','prof_kpis()','physio_payouts_missing()'] loop rep := rep || pg_temp.chk(pg_temp.err('select public.' || e) like '42501%', format('anônimo não executa %s', e)); end loop;
  set local role authenticated; perform pg_temp.as_user(u_y);
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.physio_payouts') like '42501%' and pg_temp.err('select count(*) from public.product_physio_share') like '42501%', 'ninguém lê as tabelas direto');
  raise exception 'RELATORIO_S37%', rep;
end $$;
