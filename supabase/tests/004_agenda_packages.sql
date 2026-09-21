-- Teste de agenda, pacotes e consumo de sessões. Transação desfeita ao final. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; v_ub uuid; v_pipe uuid;
  u_mgr uuid := gen_random_uuid(); u_sales_b uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_mem uuid := gen_random_uuid();
  pr uuid; pr2 uuid; svc uuid; prod uuid; prod_free uuid; pkg uuid; pkg_free uuid; p1 uuid; p2 uuid; p3 uuid; opp uuid;
  a1 uuid; a2 uuid; a3 uuid; d date := current_date + 3; t10 timestamptz; t11 timestamptz; t12 timestamptz; t14 timestamptz;
  n int; ok boolean; rep text := ''; msg text; stage text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste)', 'teste-b') returning id into v_ub;
  select id into v_pipe from public.pipelines where org_id = v_org and kind = 'patients';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@t.local'),(u_sales_b,'authenticated','authenticated','sb@t.local'),
    (u_phy,'authenticated','authenticated','phy@t.local'),(u_phy2,'authenticated','authenticated','phy2@t.local'),(u_mem,'authenticated','authenticated','mem@t.local');
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente Um') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente Dois') returning id into p2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente Tres') returning id into p3;
  insert into public.user_accounts (user_id, org_id, person_id) values (u_mgr, v_org, null),(u_sales_b, v_org, null),(u_phy, v_org, null),(u_phy2, v_org, null),(u_mem, v_org, p1);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales_b, 'sales', v_ub),
    (v_org, u_phy, 'physio', v_ua),(v_org, u_phy2, 'physio', v_ua),(v_org, u_mem, 'member', null);
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy, 'Fisio A') returning id into pr;
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy2, 'Fisio B') returning id into pr2;
  insert into public.professional_units values (pr, v_ua),(pr2, v_ua);
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time)
    select v_org, x, v_ua, w, '08:00', '18:00' from unnest(array[pr, pr2]) x, generate_series(0, 6) w;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão de teste', 60) returning id into svc;
  insert into public.products (org_id, kind, name, sessions_count, service_id, consume_on_no_show, late_cancel_hours) values (v_org, 'package', 'Pacote 4 (teste)', 4, svc, true, 24) returning id into prod;
  insert into public.products (org_id, kind, name, sessions_count, service_id, consume_on_no_show, late_cancel_hours) values (v_org, 'package', 'Pacote 4 sem cobrar falta (teste)', 4, svc, false, 24) returning id into prod_free;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, v_ua, p1, prod, 4) returning id into pkg;
  insert into public.session_ledger (org_id, client_package_id, delta, reason) values (v_org, pkg, 4, 'grant');
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, v_ua, p3, prod_free, 4) returning id into pkg_free;
  insert into public.session_ledger (org_id, client_package_id, delta, reason) values (v_org, pkg_free, 4, 'grant');
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title)
    select v_org, v_ua, p1, v_pipe, id, 'Opp teste' from public.pipeline_stages where pipeline_id = v_pipe and position = 1 returning id into opp;
  t10 := (d + time '10:00') at time zone 'America/Sao_Paulo'; t11 := (d + time '11:00') at time zone 'America/Sao_Paulo';
  t12 := (d + time '12:00') at time zone 'America/Sao_Paulo'; t14 := (d + time '14:00') at time zone 'America/Sao_Paulo';
  insert into public.time_blocks (org_id, professional_id, period) values (v_org, pr, tstzrange((d + time '16:00') at time zone 'America/Sao_Paulo', (d + time '17:00') at time zone 'America/Sao_Paulo'));

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;

  a1 := public.book_appointment(p1, v_ua, pr, svc, t10, pkg, opp);
  select s.name into stage from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id where o.id = opp;
  rep := rep || format(E'\n[%s] agenda cria agendamento e evento move oportunidade (etapa=%s)', case when stage = 'Avaliação agendada' then 'OK' else 'FALHA' end, stage);

  ok := false; begin perform public.book_appointment(p2, v_ua, pr, svc, t10); exception when others then ok := sqlerrm like 'Horário indisponível%'; end;
  rep := rep || format(E'\n[%s] mesmo profissional/horário é recusado pelo banco', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.book_appointment(p1, v_ua, pr2, svc, t10 + interval '30 minutes'); exception when others then ok := sqlerrm like 'Horário indisponível%'; end;
  rep := rep || format(E'\n[%s] mesmo paciente em dois profissionais sobrepostos é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.book_appointment(p2, v_ua, pr, svc, (d + time '03:00') at time zone 'America/Sao_Paulo'); exception when others then ok := sqlerrm like 'fora da disponibilidade%'; end;
  rep := rep || format(E'\n[%s] fora da disponibilidade é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.book_appointment(p2, v_ua, pr, svc, (d + time '16:00') at time zone 'America/Sao_Paulo'); exception when others then ok := sqlerrm = 'horário bloqueado'; end;
  rep := rep || format(E'\n[%s] bloqueio de agenda é respeitado', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.available_slots(pr, v_ua, svc, d) where slot_start = t10;
  rep := rep || format(E'\n[%s] horário ocupado não aparece nos slots livres', case when n = 0 then 'OK' else 'FALHA' end);
  select count(*) into n from public.available_slots(pr, v_ua, svc, d) where slot_start = t11;
  rep := rep || format(E'\n[%s] horário livre aparece nos slots', case when n = 1 then 'OK' else 'FALHA' end);

  -- remarcação atômica
  a2 := public.book_appointment(p2, v_ua, pr, svc, t12);
  ok := false; begin perform public.reschedule_appointment(a1, t12); exception when others then ok := true; end;
  select status into msg from public.appointments where id = a1;
  rep := rep || format(E'\n[%s] remarcação para horário ocupado falha e mantém o original (%s)', case when ok and msg = 'scheduled' then 'OK' else 'FALHA' end, msg);
  a3 := public.reschedule_appointment(a1, t14);
  select status into msg from public.appointments where id = a1;
  rep := rep || format(E'\n[%s] remarcação libera o horário antigo e cria novo (antigo=%s)', case when msg = 'rescheduled' and a3 is not null then 'OK' else 'FALHA' end, msg);
  a1 := a3;

  -- consumo: comparecimento
  reset role; update public.appointments set period = tstzrange(now() - interval '2 hours', now() - interval '1 hour') where id = a1; set local role authenticated;
  perform public.set_appointment_status(a1, 'attended');
  perform public.set_appointment_status(a1, 'attended');
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] comparecimento consome 1 sessão uma única vez (saldo=%s)', case when n = 3 then 'OK' else 'FALHA' end, n);
  reset role; perform private.consume_session(a1, 'tentativa duplicada'); set local role authenticated;
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] consumo duplicado do mesmo agendamento é impedido (saldo=%s)', case when n = 3 then 'OK' else 'FALHA' end, n);
  select s.name into stage from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id where o.id = opp;
  rep := rep || format(E'\n[%s] comparecimento move oportunidade para "Compareceu" (%s)', case when stage = 'Compareceu' then 'OK' else 'FALHA' end, stage);
  ok := false; begin perform public.set_appointment_status(a1, 'no_show'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] atendimento realizado não vira falta', case when ok then 'OK' else 'FALHA' end);

  -- falta com e sem cobrança
  reset role; update public.appointments set period = tstzrange(now() - interval '5 hours', now() - interval '4 hours') where id = a2; set local role authenticated;
  perform public.set_appointment_status(a2, 'no_show');
  select count(*) into n from public.crm_tasks where kind = 'no_show' and person_id = p2;
  rep := rep || format(E'\n[%s] falta gera tarefa de acompanhamento (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  a2 := public.book_appointment(p3, v_ua, pr2, svc, t10, pkg_free);
  reset role; update public.appointments set period = tstzrange(now() - interval '7 hours', now() - interval '6 hours') where id = a2; set local role authenticated;
  perform public.set_appointment_status(a2, 'no_show');
  select private.package_balance(pkg_free) into n;
  rep := rep || format(E'\n[%s] falta em produto que não cobra falta não consome (saldo=%s)', case when n = 4 then 'OK' else 'FALHA' end, n);

  -- cancelamentos
  a2 := public.book_appointment(p1, v_ua, pr2, svc, t11, pkg);
  perform public.set_appointment_status(a2, 'cancelled_by_patient', 'imprevisto');
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] cancelamento com antecedência não consome (saldo=%s)', case when n = 3 then 'OK' else 'FALHA' end, n);
  a2 := public.book_appointment(p1, v_ua, pr2, svc, t10 + interval '1 day', pkg);
  reset role; update public.appointments set period = tstzrange(now() + interval '3 hours', now() + interval '4 hours') where id = a2; set local role authenticated;
  perform public.set_appointment_status(a2, 'cancelled_by_patient', 'em cima da hora');
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] cancelamento tardio consome 1 sessão (saldo=%s)', case when n = 2 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.crm_tasks where kind = 'package_end' and person_id = p1;
  rep := rep || format(E'\n[%s] pacote próximo do fim gera tarefa comercial (%s)', case when n >= 1 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.adjust_package(pkg, 1, ''); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] ajuste de saldo exige motivo', case when ok then 'OK' else 'FALHA' end);
  perform public.adjust_package(pkg, 1, 'cortesia autorizada');
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] ajuste registrado no livro (saldo=%s)', case when n = 3 then 'OK' else 'FALHA' end, n);
  reset role;

  -- permissões
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales_b, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.appointments; rep := rep || format(E'\n[%s] comercial da unidade B não vê agenda da A (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.book_appointment(p2, v_ua, pr, svc, (d + interval '1 day' + time '09:00') at time zone 'America/Sao_Paulo'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial da unidade B não agenda na unidade A', case when ok then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mem, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.appointments where person_id <> p1; rep := rep || format(E'\n[%s] paciente só vê os próprios agendamentos (de outros: %s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.session_ledger; rep := rep || format(E'\n[%s] paciente vê o extrato do próprio pacote (%s linhas)', case when n > 0 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.set_appointment_status(a1, 'no_show'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] paciente não altera status de agendamento', case when ok then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.appointments where professional_id = pr; rep := rep || format(E'\n[%s] fisioterapeuta B não vê agendamentos da fisioterapeuta A (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  raise exception E'RELATORIO_AGENDA (transação desfeita):%', rep;
end $$;
