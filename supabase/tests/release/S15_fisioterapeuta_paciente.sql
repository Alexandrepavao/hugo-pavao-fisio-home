-- RELEASE v1 — S15: jornadas do FISIOTERAPEUTA e do PACIENTE (migration 068): cadastro do profissional (pessoa do cadastro central, registro, unidades), disponibilidade,
-- convite com vínculo, resumo individual e repasses, isolamento entre pacientes e sessões separadas (contratadas, realizadas, faltas, cancelamentos tardios, devolvidas, saldo).
-- Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; ua uuid; ub uuid; svc uuid; prod uuid; cpk uuid; cpk2 uuid;
  u_mgr uuid := gen_random_uuid(); u_ops uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_um uuid := gen_random_uuid();
  u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_new uuid := gen_random_uuid(); u_old uuid := gen_random_uuid();
  pe_phy uuid; pe_phy2 uuid; pe_new uuid; p1 uuid; p2 uuid; p3 uuid; pr uuid; pr2 uuid; pr3 uuid; av uuid; av2 uuid; rule uuid; j jsonb; c jsonb; e text; n bigint; n2 bigint; ok boolean; rep text := ''; r record; x jsonb;
  a_att1 uuid; a_att2 uuid; u_new2 uuid; p4 uuid; p5 uuid; pr4 uuid; u_semacc uuid := gen_random_uuid(); u_semprof uuid := gen_random_uuid(); a_ns uuid; a_cl uuid; w_from date := current_date - 30; w_to date := current_date + 30;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S15)', 'teste-a-s15') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S15)', 'teste-b-s15') returning id into ub;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s15.local'),(u_ops,'authenticated','authenticated','o@s15.local'),(u_sales,'authenticated','authenticated','s@s15.local'),
    (u_phy,'authenticated','authenticated','ph1@s15.local'),(u_phy2,'authenticated','authenticated','ph2@s15.local'),(u_um,'authenticated','authenticated','um@s15.local'),
    (u_p1,'authenticated','authenticated','p1@s15.local'),(u_p2,'authenticated','authenticated','p2@s15.local');
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pessoa Fisio Um S15') returning id into pe_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pessoa Fisio Dois S15') returning id into pe_phy2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S15 Um') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S15 Dois') returning id into p2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S15 Tres') returning id into p3;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S15'),(u_ops, v_org, null, 'Adm S15'),(u_sales, v_org, null, 'Comercial S15'),(u_phy, v_org, null, 'Fisio Um S15'),
    (u_phy2, v_org, null, 'Fisio Dois S15'),(u_um, v_org, null, 'Gestor da unidade A S15'),(u_p1, v_org, p1, 'Paciente Um'),(u_p2, v_org, p2, 'Paciente Dois');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_ops, 'ops_admin', null),(v_org, u_sales, 'sales', ua),(v_org, u_phy, 'physio', ua),(v_org, u_phy2, 'physio', ua),
    (v_org, u_um, 'unit_manager', ua),(v_org, u_p1, 'member', null),(v_org, u_p2, 'member', null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço S15', 30) returning id into svc;

  -- ============ 1) cadastro do profissional: permissões e validações
  set local role authenticated;
  foreach e in array array['sales','physio','unit_manager'] loop
    perform pg_temp.as_user(case e when 'sales' then u_sales when 'physio' then u_phy else u_um end);
    rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_save(null, %L, null, ''CREFITO-3 111111-F'', array[%L]::uuid[])', pe_phy, ua)) like '42501%', format('%s NÃO cadastra profissional (42501)', e));
  end loop;
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err('select public.professional_save(null, null, null, null, array[]::uuid[])') like '%ao menos uma unidade%', 'sem unidade é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_save(null, null, null, null, array[%L]::uuid[])', ua)) like '%escolha uma pessoa%', 'sem pessoa e sem nome é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_save(null, %L, null, ''ab'', array[%L]::uuid[])', pe_phy, ua)) like '%registro profissional inválido%', 'registro profissional curto demais é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_save(null, %L, null, null, array[%L]::uuid[])', pe_phy, gen_random_uuid())) like '%unidade inválida%', 'unidade inexistente é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_save(null, %L, null, null, array[%L]::uuid[])', gen_random_uuid(), ua)) like '%pessoa não encontrada%', 'pessoa inexistente no cadastro central é recusada');
  pr := public.professional_save(null, pe_phy, null, 'CREFITO-3 111111-F', array[ua]);
  select (person_id = pe_phy and display_name = 'Pessoa Fisio Um S15' and council_registration = 'CREFITO-3 111111-F' and active) into ok from public.professionals where id = pr;
  rep := rep || pg_temp.chk(ok, 'gestor cadastra o profissional reaproveitando a PESSOA do cadastro central (nome herdado, registro salvo)');
  select count(*) into n from public.person_kinds where person_id = pe_phy and kind = 'staff'; rep := rep || pg_temp.chk(n = 1, 'a pessoa ganha o vínculo “equipe” sem duplicar o cadastro');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_save(null, %L, null, null, array[%L]::uuid[])', pe_phy, ua)) like '%já está cadastrada como profissional%', 'a mesma pessoa não vira dois profissionais');
  perform pg_temp.as_user(u_ops);
  pr2 := public.professional_save(null, null, 'Profissional Novo S15', null, array[ua, ub]);
  select person_id into pe_new from public.professionals where id = pr2; select count(*) into n from public.professional_units where professional_id = pr2;
  rep := rep || pg_temp.chk(pe_new is not null and n = 2, 'administrador operacional cadastra profissional novo: a pessoa é criada no cadastro central e as duas unidades ficam vinculadas');
  select count(*) into n from public.people where id = pe_new and full_name = 'Profissional Novo S15'; rep := rep || pg_temp.chk(n = 1, 'a pessoa criada aparece em Pessoas');
  pr3 := public.professional_save(null, pe_phy2, null, null, array[ua]);

  -- ============ 2) disponibilidade
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_availability_save(null, %L, %L, 1, ''08:00'', ''12:00'')', pr, ua)) like '42501%', 'comercial NÃO cadastra disponibilidade (42501)');
  perform pg_temp.as_user(u_mgr);
  av := public.professional_availability_save(null, pr, ua, 1, '08:00', '12:00');
  rep := rep || pg_temp.chk(av is not null, 'disponibilidade de segunda 08–12 cadastrada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_availability_save(null, %L, %L, 1, ''12:00'', ''08:00'')', pr, ua)) like '%horário final%', 'fim antes do início é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_availability_save(null, %L, %L, 1, ''11:00'', ''14:00'')', pr, ua)) like '%se sobrepõe%', 'sobreposição do mesmo profissional é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_availability_save(null, %L, %L, 1, ''12:00'', ''18:00'')', pr, ua)) is null, 'faixa seguinte (12–18) é aceita');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_availability_save(null, %L, %L, 2, ''08:00'', ''12:00'')', pr, ub)) like '%não atende nesta unidade%', 'unidade em que o profissional não atende é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_availability_save(null, %L, %L, 9, ''08:00'', ''12:00'')', pr, ua)) like '%dia da semana%', 'dia da semana inválido é recusado');
  av2 := public.professional_availability_save(av, pr, ua, 1, '07:00', '12:00');
  select (start_time = '07:00') into ok from public.availability_rules where id = av; rep := rep || pg_temp.chk(av2 = av and ok, 'editar a disponibilidade altera a mesma regra');
  select id into rule from public.availability_rules where professional_id = pr and start_time = '12:00';
  perform public.professional_availability_remove(rule); select count(*) into n from public.availability_rules where professional_id = pr; rep := rep || pg_temp.chk(n = 1, 'remover disponibilidade');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_availability_remove(%L)', av)) like '42501%', 'o próprio fisioterapeuta NÃO remove a disponibilidade (só gestão)');
  select count(*) into n from public.audit_log where entity_type = 'availability_rules' and entity_id = av::text; reset role; select count(*) into n from public.audit_log where entity_type = 'availability_rules' and entity_id = av::text;
  rep := rep || pg_temp.chk(n >= 2, 'cadastro e edição da disponibilidade foram auditados');
  select count(*) into n from public.audit_log where entity_type = 'professionals' and entity_id = pr::text; rep := rep || pg_temp.chk(n >= 1, 'o cadastro do profissional foi auditado');
  set local role authenticated;

  -- ============ 3) trocar unidades: não retira unidade com atendimento futuro
  perform pg_temp.as_user(u_mgr);
  reset role;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, ub, pr2, p1, svc, tstzrange(now() + interval '3 days', now() + interval '3 days 30 minutes'), 'scheduled');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_save(%L, null, null, null, array[%L]::uuid[])', pr2, ua)) like '%atendimentos futuros%', 'retirar a unidade B com atendimento futuro é recusado');
  select count(*) into n from public.professional_units where professional_id = pr2; rep := rep || pg_temp.chk(n = 2, 'e nada mudou (atômico)');
  reset role; update public.appointments set status = 'cancelled_by_clinic' where professional_id = pr2; set local role authenticated; perform pg_temp.as_user(u_mgr);
  perform public.professional_save(pr2, null, null, 'CREFITO-4 222222-F', array[ua]);
  select count(*) into n from public.professional_units where professional_id = pr2; select council_registration into e from public.professionals where id = pr2;
  rep := rep || pg_temp.chk(n = 1 and e = 'CREFITO-4 222222-F', 'sem atendimento futuro a unidade sai e o registro é atualizado');

  -- ============ 4) convite com vínculo: aceitar liga o profissional à conta; conta já existente é ligada na hora
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_grant_access(%L, ''novo@s15.local'')', pr2)) like '42501%', 'comercial NÃO libera acesso de profissional (42501)');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_grant_access(%L, ''sem-arroba'')', pr2)) like '%e-mail inválido%', 'e-mail inválido é recusado');
  j := public.professional_grant_access(pr2, 'Novo.Fisio@S15.local');
  reset role; select count(*), bool_and(role = 'physio' and professional_id = pr2 and person_id = pe_new and email = 'novo.fisio@s15.local') into n, ok from public.invitations where professional_id = pr2 and accepted_at is null;
  rep := rep || pg_temp.chk(j ->> 'status' = 'invited' and n = 1 and ok, 'sem conta: gera 1 convite “fisioterapeuta” (um por unidade) ligado à pessoa e ao profissional');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  j := public.professional_grant_access(pr2, 'novo.fisio@s15.local'); reset role; select count(*) into n from public.invitations where professional_id = pr2 and accepted_at is null;
  rep := rep || pg_temp.chk((j ->> 'invitations')::int = 0 and n = 1, 'repetir o convite não duplica');
  -- a pessoa cria a senha e confirma o e-mail (simulado: usuário com e-mail confirmado dispara o mesmo gatilho do Supabase Auth)
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u_new, 'authenticated', 'authenticated', 'novo.fisio@s15.local', now());
  select (user_id = u_new) into ok from public.professionals where id = pr2; rep := rep || pg_temp.chk(ok, 'ao confirmar o e-mail, o convite liga a CONTA ao cadastro profissional');
  select count(*) into n from public.role_assignments where user_id = u_new and role = 'physio' and unit_id = ua and revoked_at is null; rep := rep || pg_temp.chk(n = 1, 'e concede o papel de fisioterapeuta na unidade');
  select (person_id = pe_new) into ok from public.user_accounts where user_id = u_new; rep := rep || pg_temp.chk(ok, 'a conta fica ligada à PESSOA correta do cadastro central');
  select count(*) into n from public.invitations where professional_id = pr2 and accepted_at is not null; rep := rep || pg_temp.chk(n = 1, 'o convite aparece como aceito');
  -- conta já existente: vínculo imediato, sem convite
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u_old, 'authenticated', 'authenticated', 'conta.antiga@s15.local', now());
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_old, v_org, null, 'Conta antiga S15') on conflict do nothing;
  set local role authenticated; perform pg_temp.as_user(u_ops);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_grant_access(%L, ''novo.fisio@s15.local'')', pr3)) like '%já está ligada a outro profissional%', 'uma conta já ligada a outro profissional não é reaproveitada');
  j := public.professional_grant_access(pr3, 'conta.antiga@s15.local'); reset role;
  select (user_id = u_old) into ok from public.professionals where id = pr3; select count(*) into n from public.role_assignments where user_id = u_old and role = 'physio' and revoked_at is null;
  rep := rep || pg_temp.chk(j ->> 'status' = 'linked' and ok and n = 1, 'conta já existente: vínculo e papel na hora (sem esperar convite)');
  select (person_id = pe_phy2) into ok from public.user_accounts where user_id = u_old; rep := rep || pg_temp.chk(ok, 'e a conta passa a apontar para a pessoa do profissional');
  update public.professionals set user_id = u_phy where id = pr; update public.professionals set active = true where id = pr3;   -- u_phy é o fisioterapeuta de teste dos próximos blocos

  -- ============ 5) resumo individual
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values
    (v_org, ua, pr, p1, svc, tstzrange(date_trunc('day', now()) - interval '1 days' + interval '9 hours', date_trunc('day', now()) - interval '1 days' + interval '9 hours 30 minutes'), 'attended'),
    (v_org, ua, pr, p1, svc, tstzrange(date_trunc('day', now()) - interval '2 days' + interval '9 hours', date_trunc('day', now()) - interval '2 days' + interval '9 hours 30 minutes'), 'attended'),
    (v_org, ua, pr, p2, svc, tstzrange(date_trunc('day', now()) - interval '3 days' + interval '9 hours', date_trunc('day', now()) - interval '3 days' + interval '9 hours 30 minutes'), 'attended'),
    (v_org, ua, pr, p2, svc, tstzrange(date_trunc('day', now()) - interval '4 days' + interval '9 hours', date_trunc('day', now()) - interval '4 days' + interval '9 hours 30 minutes'), 'no_show'),
    (v_org, ua, pr, p3, svc, tstzrange(date_trunc('day', now()) - interval '5 days' + interval '9 hours', date_trunc('day', now()) - interval '5 days' + interval '9 hours 30 minutes'), 'professional_no_show'),
    (v_org, ua, pr, p3, svc, tstzrange(date_trunc('day', now()) - interval '6 days' + interval '9 hours', date_trunc('day', now()) - interval '6 days' + interval '9 hours 30 minutes'), 'cancelled_by_patient'),
    (v_org, ua, pr, p3, svc, tstzrange(date_trunc('day', now()) - interval '7 days' + interval '9 hours', date_trunc('day', now()) - interval '7 days' + interval '9 hours 30 minutes'), 'cancelled_by_clinic'),
    (v_org, ua, pr, p1, svc, tstzrange(date_trunc('day', now()) + interval '2 days' + interval '9 hours', date_trunc('day', now()) + interval '2 days' + interval '9 hours 30 minutes'), 'scheduled'),
    (v_org, ua, pr, p2, svc, tstzrange(date_trunc('day', now()) + interval '3 days' + interval '9 hours', date_trunc('day', now()) + interval '3 days' + interval '9 hours 30 minutes'), 'confirmed'),
    (v_org, ua, pr3, p3, svc, tstzrange(date_trunc('day', now()) - interval '1 days' + interval '9 hours', date_trunc('day', now()) - interval '1 days' + interval '9 hours 30 minutes'), 'attended');   -- de OUTRO profissional
  set local role authenticated; perform pg_temp.as_user(u_phy);
  c := public.my_professional_summary(w_from, w_to)  -> 'counts';
  rep := rep || pg_temp.chk((c ->> 'attended')::int = 3 and (c ->> 'patient_no_show')::int = 1 and (c ->> 'professional_no_show')::int = 1 and (c ->> 'cancelled_by_patient')::int = 1 and (c ->> 'cancelled_by_clinic')::int = 1
      and (c ->> 'scheduled')::int = 2 and (c ->> 'patients_attended')::int = 2 and (c ->> 'total')::int = 9, 'resumo do fisioterapeuta: 3 realizados, 1 falta do paciente, 1 do profissional, 1+1 cancelamentos, 2 agendados, 2 pacientes atendidos (distintos), 9 no total — só os dele');
  c := public.my_professional_summary(current_date - 3, current_date - 1) -> 'counts';
  rep := rep || pg_temp.chk((c ->> 'attended')::int = 3 and (c ->> 'total')::int = 3, 'o período filtra os números (últimos 3 dias: 3 realizados)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_professional_summary(current_date, current_date - 1)') like '%período inválido%', 'período invertido é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_professional_summary(null, null, %L)', pr3)) like '42501%', 'fisioterapeuta NÃO vê o resumo de outro profissional (42501)');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_professional_summary()') like 'P0002%', 'quem não é profissional não tem resumo individual (P0002)');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_professional_summary(null, null, %L)', pr)) like '42501%', 'comercial NÃO vê o resumo do profissional (42501)');
  perform pg_temp.as_user(u_um);
  j := public.my_professional_summary(w_from, w_to, pr);
  rep := rep || pg_temp.chk((j -> 'counts' ->> 'attended')::int = 3 and not (j -> 'payouts' ->> 'visible')::boolean, 'gestor da unidade vê os números do profissional da própria unidade, mas NÃO os repasses');
  perform pg_temp.as_user(u_phy);
  j := public.my_professional_summary(w_from, w_to);
  rep := rep || pg_temp.chk((j -> 'payouts' ->> 'visible')::boolean and not (j -> 'payouts' ->> 'available')::boolean and (j -> 'payouts' ->> 'authorized_cents')::bigint = 0, 'sem regra e sem repasse: “repasses” indisponível (não inventa zero como dado)');
  -- repasses autorizados: regra + entradas reais (FKs de venda/pagamento dispensadas só neste teste)
  reset role; set local session_replication_role = replica;
  insert into public.commission_rules (id, org_id, name, beneficiary_user_id, percent_bp) values (gen_random_uuid(), v_org, 'Repasse fisio S15', u_phy, 3000) returning id into rule;
  insert into public.commission_entries (org_id, unit_id, rule_id, sale_id, payment_id, beneficiary_user_id, amount_cents, status) values
    (v_org, ua, rule, gen_random_uuid(), gen_random_uuid(), u_phy, 15000, 'authorized'), (v_org, ua, rule, gen_random_uuid(), gen_random_uuid(), u_phy, 9000, 'paid'),
    (v_org, ua, rule, gen_random_uuid(), gen_random_uuid(), u_phy, 7000, 'pending'), (v_org, ua, rule, gen_random_uuid(), gen_random_uuid(), u_phy2, 4000, 'authorized');
  set local session_replication_role = origin; set local role authenticated; perform pg_temp.as_user(u_phy);
  j := public.my_professional_summary(w_from, w_to) -> 'payouts';
  rep := rep || pg_temp.chk((j ->> 'available')::boolean and (j ->> 'authorized_cents')::bigint = 15000 and (j ->> 'paid_cents')::bigint = 9000 and (j ->> 'rules')::int = 1 and jsonb_array_length(j -> 'entries') = 2,
    'repasses: só os AUTORIZADOS (R$ 150,00) e PAGOS (R$ 90,00) dele; o pendente (R$ 70,00) e o de outro profissional não entram');

  -- ============ 6) paciente: isolamento entre pacientes e sessões separadas
  reset role;
  insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id) values (v_org, 'package', 'Pacote S15', 0, 10, svc) returning id into prod;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, ua, p1, prod, 10) returning id into cpk;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, ua, p2, prod, 5) returning id into cpk2;
  select id into a_att1 from public.appointments where professional_id = pr and person_id = p1 and status = 'attended' order by lower(period) limit 1;
  select id into a_att2 from public.appointments where professional_id = pr and person_id = p1 and status = 'attended' order by lower(period) desc limit 1;
  select id into a_ns from public.appointments where professional_id = pr and person_id = p2 and status = 'no_show' limit 1;
  select id into a_cl from public.appointments where professional_id = pr and person_id = p3 and status = 'cancelled_by_patient' limit 1;
  update public.appointments set client_package_id = cpk where id in (a_att1, a_att2);
  insert into public.session_ledger (org_id, client_package_id, delta, reason, note) values (v_org, cpk, 10, 'grant', 'compra'), (v_org, cpk, 1, 'adjust', 'cortesia'), (v_org, cpk2, 5, 'grant', 'compra');
  insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) values (v_org, cpk, a_att1, -1, 'consume'), (v_org, cpk, a_att2, -1, 'consume');
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status) values
    (v_org, ua, pr, p1, svc, cpk, tstzrange(now() - interval '30 days', now() - interval '30 days' + interval '30 minutes'), 'no_show') returning id into a_ns;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status) values
    (v_org, ua, pr, p1, svc, cpk, tstzrange(now() - interval '31 days', now() - interval '31 days' + interval '30 minutes'), 'cancelled_by_patient') returning id into a_cl;
  insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) values (v_org, cpk, a_ns, -1, 'consume'), (v_org, cpk, a_cl, -1, 'consume');
  insert into public.session_ledger (org_id, client_package_id, delta, reason, note) values (v_org, cpk, 1, 'refund', 'devolução por ausência do profissional');
  set local role authenticated; perform pg_temp.as_user(u_p1);
  j := public.my_package_breakdown() -> 0;
  rep := rep || pg_temp.chk((j ->> 'contracted')::int = 10 and (j ->> 'adjusted')::int = 1 and (j ->> 'attended')::int = 2 and (j ->> 'no_show')::int = 1 and (j ->> 'late_cancel')::int = 1 and (j ->> 'refunded')::int = 1 and (j ->> 'balance')::int = 8,
    'paciente vê SEPARADOS: 10 contratadas, 1 de ajuste, 2 realizadas, 1 consumida por falta, 1 por cancelamento tardio, 1 devolvida e saldo 8 (10 + 1 − 4 + 1)');
  rep := rep || pg_temp.chk(jsonb_array_length(public.my_package_breakdown()) = 1 and public.my_package_breakdown() -> 0 ->> 'product_name' = 'Pacote S15', 'só o pacote dele aparece (1)');
  perform pg_temp.as_user(u_p2);
  j := public.my_package_breakdown() -> 0;
  rep := rep || pg_temp.chk((j ->> 'contracted')::int = 5 and (j ->> 'balance')::int = 5 and (j ->> 'attended')::int = 0, 'o outro paciente vê só o próprio pacote (5 contratadas, saldo 5, nada realizado)');
  select count(*) into n from public.client_packages; select count(*) into n2 from public.appointments; rep := rep || pg_temp.chk(n = 1 and n2 > 0 and not exists (select 1 from public.appointments where person_id <> p2), 'leitura direta: o paciente 2 só enxerga o próprio pacote e os próprios atendimentos');
  select count(*) into n from public.session_ledger; rep := rep || pg_temp.chk(n = 1, 'e só o próprio livro de sessões (1 lançamento)');
  select count(*) into n from public.people; rep := rep || pg_temp.chk(n = 1, 'e só o próprio cadastro de pessoa');
  select count(*) into n from public.my_appointments(); select count(*) into n2 from public.my_appointments() where id in (select id from public.appointments where person_id <> p2);
  rep := rep || pg_temp.chk(n2 = 0, 'my_appointments nunca traz atendimento de outro paciente');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_appointment_cancel(%L, null)', a_ns)) is not null, 'o paciente 2 NÃO cancela atendimento do paciente 1');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_appointment_confirm(%L)', a_ns)) is not null, 'nem confirma presença no atendimento dele');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.patient_plan_save(%L, 5)', p1)) like '42501%', 'paciente NÃO define plano de sessões (só o profissional vinculado)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.professional_save(null, null, ''X Y'', null, array[]::uuid[])') like '42501%', 'paciente NÃO cadastra profissional');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_professional_summary()') is not null, 'paciente NÃO tem resumo de profissional');
  -- ============ 7) portal: convite ou vínculo imediato (migration 070)
  reset role; insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S15 Quatro') returning id into p4;
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, p3, 'email', 'paciente3@s15.local', true), (v_org, p4, 'email', 'novo.paciente1@s15.local', true);
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (gen_random_uuid(), 'authenticated', 'authenticated', 'paciente3@s15.local', now()) returning id into u_new2;
  insert into public.user_accounts (user_id, org_id, person_id) values (u_new2, v_org, null);
  set local role authenticated; perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_portal_access(%L, ''paciente3@s15.local'')', p3)) like '42501%', 'comercial NÃO libera portal (só gestor/administrador operacional)');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_portal_access(%L, ''outro@s15.local'')', gen_random_uuid())) like '%pessoa não encontrada%', 'pessoa inexistente é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_portal_access(%L, ''sem-arroba'')', p3)) like '%e-mail inválido%', 'e-mail inválido é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_portal_access(%L, ''paciente3@s15.local'')', p4)) like '%e-mails cadastrados desta pessoa%', 'conta existente NÃO é ligada a uma pessoa cujo e-mail cadastrado é outro (trava anti-vínculo errado)');
  j := public.person_portal_access(p3, 'Paciente3@S15.local');
  reset role; select (person_id = p3) into ok from public.user_accounts where user_id = u_new2; select count(*) into n from public.role_assignments where user_id = u_new2 and role = 'member' and revoked_at is null;
  rep := rep || pg_temp.chk(j ->> 'status' = 'linked' and ok and n = 1, 'conta já existente com o e-mail cadastrado: vínculo imediato à pessoa certa e papel de paciente/aluno');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  j := public.person_portal_access(p3, 'paciente3@s15.local'); rep := rep || pg_temp.chk(j ->> 'status' = 'linked', 'repetir é idempotente');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_portal_access(%L, ''paciente3@s15.local'')', p4)) like '%ligada a outra pessoa%', 'a conta já ligada ao paciente 3 não é movida para outro paciente');
  j := public.person_portal_access(p4, 'novo.paciente1@s15.local'); reset role; select count(*) into n from public.invitations where email = 'novo.paciente1@s15.local' and person_id = p4 and role = 'member' and accepted_at is null;
  rep := rep || pg_temp.chk(j ->> 'status' = 'invited' and n = 1, 'sem conta: gera 1 convite ligado ao paciente');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  j := public.person_portal_access(p4, 'novo.paciente1@s15.local'); reset role; select count(*) into n from public.invitations where email = 'novo.paciente1@s15.local' and accepted_at is null;
  rep := rep || pg_temp.chk((j ->> 'reused')::boolean and n = 1, 'repetir o convite reaproveita o aberto (sem duplicar)');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_portal_access(%L, ''novo.paciente1@s15.local'')', p2)) like '%ligado a outra pessoa%', 'convite aberto de outra pessoa não é reaproveitado');
  reset role; insert into auth.users (id, aud, role, email, email_confirmed_at) values (gen_random_uuid(), 'authenticated', 'authenticated', 'novo.paciente1@s15.local', now()) returning id into u_new2;
  select (person_id = p4) into ok from public.user_accounts where user_id = u_new2; rep := rep || pg_temp.chk(ok, 'ao confirmar o e-mail, o convite liga a conta ao paciente correto (gatilho)');
  -- ============ 8) conta confirmada SEM registro em user_accounts (sem papel): o vínculo é imediato (migration 072); convite nunca seria processado
  reset role; insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S15 Cinco') returning id into p5;
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, p5, 'email', 'semconta5@s15.local', true);
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u_semacc, 'authenticated', 'authenticated', 'semconta5@s15.local', now());
  select count(*) into n from public.user_accounts where user_id = u_semacc; rep := rep || pg_temp.chk(n = 0, 'cenário: conta confirmada sem nenhum registro em user_accounts (como quem se cadastrou e ainda não tinha convite)');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  j := public.person_portal_access(p5, 'semconta5@s15.local'); reset role;
  select (person_id = p5) into ok from public.user_accounts where user_id = u_semacc; select count(*) into n from public.role_assignments where user_id = u_semacc and role = 'member' and revoked_at is null;
  rep := rep || pg_temp.chk(j ->> 'status' = 'linked' and ok and n = 1, 'portal: a conta sem registro é criada em user_accounts, ligada à pessoa e recebe o papel de paciente/aluno na hora');
  select count(*) into n from public.invitations where email = 'semconta5@s15.local'; rep := rep || pg_temp.chk(n = 0, 'e nenhum convite “fantasma” é criado');
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u_semprof, 'authenticated', 'authenticated', 'semprof@s15.local', now());
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  pr4 := public.professional_save(null, null, 'Profissional Quatro S15', null, array[ua]);
  j := public.professional_grant_access(pr4, 'semprof@s15.local'); reset role;
  select (user_id = u_semprof) into ok from public.professionals where id = pr4; select count(*) into n from public.user_accounts where user_id = u_semprof;
  rep := rep || pg_temp.chk(j ->> 'status' = 'linked' and ok and n = 1, 'profissional: idem — a conta sem registro é criada, ligada à pessoa do profissional e recebe o papel de fisioterapeuta');
  reset role; set local role anon;
  foreach e in array array['my_package_breakdown','my_professional_summary'] loop
    rep := rep || pg_temp.chk(pg_temp.err(format('select public.%I()', e)) like '42501%', format('anon não executa %s (42501)', e));
  end loop;
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.professional_grant_access(%L, ''x@y.zz'')', pr)) like '42501%', 'anon não libera acesso de profissional');
  reset role;

  raise exception E'RELATORIO_S15_FISIO_PACIENTE (transação desfeita):%', rep;
end $$;
