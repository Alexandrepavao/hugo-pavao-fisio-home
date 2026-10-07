-- RELEASE v1 — S21: repasse a PARCEIRO (decisão expressa do Financeiro) ligado ao Contas a pagar (migration 080): autorizar cria o compromisso (conta em aberto), pagar fecha a mesma conta,
-- cancelar cancela a conta, repetir não duplica, repasse legado (autorizado antes da 080) vira conta paga única, permissões. NÃO existe repasse automático por indicação. Transação desfeita.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; ua uuid; ub uuid; u_fin uuid := gen_random_uuid(); u_fin_b uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); p_par uuid; po1 uuid; po2 uuid; po3 uuid; po4 uuid; x record; n bigint; rep text := ''; legacy uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S21)', 'teste-a-s21') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S21)', 'teste-b-s21') returning id into ub;
  insert into auth.users (id, aud, role, email) values (u_fin,'authenticated','authenticated','f@s21.local'),(u_fin_b,'authenticated','authenticated','fb@s21.local'),(u_sales,'authenticated','authenticated','s@s21.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_fin, v_org, null, 'Financeiro S21'),(u_fin_b, v_org, null, 'Financeiro B S21'),(u_sales, v_org, null, 'Comercial S21');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_fin, 'finance', ua),(v_org, u_fin_b, 'finance', ub),(v_org, u_sales, 'sales', ua);
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Parceiro S21') returning id into p_par;
  insert into public.partner_profiles (person_id, org_id, unit_id, status) values (p_par, v_org, ua, 'active');
  set local role authenticated; perform pg_temp.as_user(u_fin);
  insert into public.partner_payouts (org_id, unit_id, partner_person_id, description, amount_cents, created_by) values (v_org, ua, p_par, 'Indicação S21', 25000, u_fin) returning id into po1;
  insert into public.partner_payouts (org_id, unit_id, partner_person_id, description, amount_cents, created_by) values (v_org, ua, p_par, 'Cancelar S21', 10000, u_fin) returning id into po2;
  insert into public.partner_payouts (org_id, unit_id, partner_person_id, description, amount_cents, created_by) values (v_org, ua, p_par, 'Cancelar autorizado S21', 8000, u_fin) returning id into po3;

  -- ============ 1) autorizar cria o compromisso
  rep := rep || pg_temp.chk((select count(*) from public.payables where description like '%Indicação S21') = 0, 'criar o repasse (pendente) ainda NÃO cria despesa');
  perform public.payout_set_status(po1, 'authorized'); perform public.payout_set_status(po1, 'authorized');
  select count(*) into n from public.payables where description = 'Repasse a parceiro: Indicação S21'; rep := rep || pg_temp.chk(n = 1, 'autorizar (e repetir o clique) cria UMA conta a pagar');
  select * into x from public.payables where description = 'Repasse a parceiro: Indicação S21';
  rep := rep || pg_temp.chk(x.status = 'open' and x.amount_cents = 25000 and x.supplier = 'Parceiro S21' and x.unit_id = ua and x.competence_month = date_trunc('month', current_date)::date, 'a conta nasce em aberto, com valor, fornecedor (o parceiro), unidade e competência do repasse');
  rep := rep || pg_temp.chk((select payable_id from public.partner_payouts where id = po1) = x.id, 'o repasse guarda o vínculo com a conta');
  -- ============ 2) pagar fecha a MESMA conta
  perform public.payout_set_status(po1, 'paid'); perform public.payout_set_status(po1, 'paid');
  select status, paid_at into x from public.payables where id = (select payable_id from public.partner_payouts where id = po1);
  rep := rep || pg_temp.chk(x.status = 'paid' and x.paid_at is not null, 'marcar pago fecha a conta (despesa paga entra no caixa/DRE)');
  select count(*) into n from public.payables where description = 'Repasse a parceiro: Indicação S21'; rep := rep || pg_temp.chk(n = 1, 'e continua UMA conta');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.payout_set_status(%L, ''cancelled'')', po1)) like '%transição inválida%', 'repasse pago não pode ser cancelado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.payout_set_status(%L, ''paid'')', po2)) like '%transição inválida%', 'pendente não pula a autorização');
  -- ============ 3) cancelar
  perform public.payout_set_status(po2, 'cancelled'); rep := rep || pg_temp.chk((select count(*) from public.payables where description like '%Cancelar S21') = 0, 'cancelar um repasse pendente não gera conta');
  perform public.payout_set_status(po3, 'authorized'); perform public.payout_set_status(po3, 'cancelled');
  rep := rep || pg_temp.chk((select status from public.payables where description = 'Repasse a parceiro: Cancelar autorizado S21') = 'cancelled', 'cancelar um repasse autorizado cancela a conta em aberto');
  -- ============ 4) legado: repasse autorizado antes da 080 (sem vínculo)
  reset role; insert into public.partner_payouts (org_id, unit_id, partner_person_id, description, amount_cents, status, created_by, authorized_by) values (v_org, ua, p_par, 'Legado S21', 5000, 'authorized', u_fin, u_fin) returning id into legacy;
  set local role authenticated; perform pg_temp.as_user(u_fin);
  perform public.payout_set_status(legacy, 'paid'); perform public.payout_set_status(legacy, 'paid');
  select count(*) into n from public.payables where description = 'Repasse a parceiro: Legado S21' and status = 'paid' and amount_cents = 5000; rep := rep || pg_temp.chk(n = 1, 'repasse legado (autorizado antes do vínculo): pagar cria UMA conta já paga');
  -- ============ 5) permissões
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.payout_set_status(%L, ''authorized'')', po2)) like '42501%', 'comercial NÃO autoriza repasse');
  perform pg_temp.as_user(u_fin_b);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.payout_set_status(%L, ''paid'')', po1)) like '42501%', 'financeiro de OUTRA unidade NÃO mexe no repasse');
  select count(*) into n from public.partner_payouts where id = po1; rep := rep || pg_temp.chk(n = 0, 'e nem o enxerga');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.partner_payouts (org_id, unit_id, partner_person_id, description, amount_cents, created_by) values (%L, %L, %L, ''x'', 100, %L)', v_org, ua, p_par, u_sales)) is not null, 'comercial NÃO cria repasse');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.payout_set_status(%L, ''paid'')', po1)) is not null, 'anônimo não executa');
  reset role;
  -- ============ 6) nada automático
  select count(*) into n from public.partner_payouts where partner_person_id = p_par and created_by <> u_fin; rep := rep || pg_temp.chk(n = 0, 'não existe repasse criado por regra/indicação: todos vieram de decisão do Financeiro');
  raise exception E'RELATORIO_S21_REPASSE_PARCEIRO (transação desfeita):%', rep;
end $$;
