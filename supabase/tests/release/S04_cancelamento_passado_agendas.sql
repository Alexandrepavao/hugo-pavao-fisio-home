-- RELEASE v1 — S04: cancelamento pelo paciente (prazo e consumo de sessão), bloqueio de horário passado e agendas de outros profissionais.
-- Cobre a migration 055. Transação sempre desfeita ao final (raise exception com o relatório). Somente Dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; v_ub uuid;
  u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_uma uuid := gen_random_uuid(); u_umb uuid := gen_random_uuid();
  u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid();
  pr uuid; pr2 uuid; svc uuid; prod uuid; pkg uuid; p1 uuid; p2 uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid; a8 uuid; a9 uuid;
  d date := current_date + 3; t10 timestamptz; t11 timestamptz; t12 timestamptz; t14 timestamptz; t15 timestamptz;
  n int; n2 int; ok boolean; rep text := ''; s1 text; r record; j jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S04)', 'teste-b-s04') returning id into v_ub;
  insert into auth.users (id, aud, role, email) values
    (u_mgr,'authenticated','authenticated','m@s04.local'),(u_sales,'authenticated','authenticated','s@s04.local'),(u_uma,'authenticated','authenticated','uma@s04.local'),
    (u_umb,'authenticated','authenticated','umb@s04.local'),(u_phy,'authenticated','authenticated','phy@s04.local'),(u_phy2,'authenticated','authenticated','phy2@s04.local'),
    (u_p1,'authenticated','authenticated','p1@s04.local'),(u_p2,'authenticated','authenticated','p2@s04.local');
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente S04 Um') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente S04 Dois') returning id into p2;
  insert into public.user_accounts (user_id, org_id, person_id) values (u_mgr, v_org, null),(u_sales, v_org, null),(u_uma, v_org, null),(u_umb, v_org, null),
    (u_phy, v_org, null),(u_phy2, v_org, null),(u_p1, v_org, p1),(u_p2, v_org, p2);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', v_ua),
    (v_org, u_uma, 'unit_manager', v_ua),(v_org, u_umb, 'unit_manager', v_ub),(v_org, u_phy, 'physio', v_ua),(v_org, u_phy2, 'physio', v_ua),
    (v_org, u_p1, 'member', null),(v_org, u_p2, 'member', null);
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy, 'Fisio A S04') returning id into pr;
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy2, 'Fisio B S04') returning id into pr2;
  insert into public.professional_units values (pr, v_ua),(pr2, v_ua),(pr2, v_ub);            -- Fisio B atende nas duas unidades
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time)
    select v_org, pr, v_ua, w, '08:00', '18:00' from generate_series(0, 6) w;
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time)
    select v_org, pr2, u, w, '08:00', '18:00' from unnest(array[v_ua, v_ub]) u, generate_series(0, 6) w;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão S04', 60) returning id into svc;
  insert into public.products (org_id, kind, name, sessions_count, service_id, consume_on_no_show, late_cancel_hours) values (v_org, 'package', 'Pacote 4 (S04)', 4, svc, true, 24) returning id into prod;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, v_ua, p1, prod, 4) returning id into pkg;
  insert into public.session_ledger (org_id, client_package_id, delta, reason) values (v_org, pkg, 4, 'grant');
  t10 := (d + time '10:00') at time zone 'America/Sao_Paulo'; t11 := (d + time '11:00') at time zone 'America/Sao_Paulo';
  t12 := (d + time '12:00') at time zone 'America/Sao_Paulo'; t14 := (d + time '14:00') at time zone 'America/Sao_Paulo'; t15 := (d + time '15:00') at time zone 'America/Sao_Paulo';

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  a1 := public.book_appointment(p1, v_ua, pr,  svc, t10, pkg);   -- cancelamento antecipado, com pacote
  a2 := public.book_appointment(p1, v_ua, pr,  svc, t11, pkg);   -- cancelamento tardio, com pacote
  a3 := public.book_appointment(p2, v_ua, pr,  svc, t12);        -- sem pacote
  a4 := public.book_appointment(p2, v_ua, pr2, svc, t14);        -- do paciente 2 (outro paciente não cancela)
  a5 := public.book_appointment(p1, v_ua, pr,  svc, t14, pkg);   -- para as recusas (já iniciado / encerrado)
  a6 := public.book_appointment(p1, v_ua, pr2, svc, t15, pkg);   -- remarcação
  a7 := public.book_appointment(p2, v_ub, pr2, svc, t10);        -- Fisio B na unidade B
  a8 := public.book_appointment(p1, v_ua, pr2, svc, t10 + interval '1 day', pkg);   -- cancelamento pela equipe (para a recusa)

  -- ============ 1) horário passado ============
  ok := false; begin perform public.book_appointment(p2, v_ua, pr, svc, now() - interval '3 hours'); exception when others then ok := sqlerrm = 'horário no passado'; end;
  rep := rep || format(E'\n[%s] agendar no passado é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.book_appointment(p2, v_ua, pr, svc, now() - interval '3 hours', null, null, null, a3); exception when others then ok := sqlerrm = 'horário no passado'; end;
  rep := rep || format(E'\n[%s] a exceção antiga (informar p_rescheduled_from) não burla mais a checagem', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.reschedule_appointment(a6, now() - interval '2 hours'); exception when others then ok := sqlerrm like '%horário passado%'; end;
  select status into s1 from public.appointments where id = a6;
  rep := rep || format(E'\n[%s] remarcar para o passado é recusado e o atendimento original permanece (%s)', case when ok and s1 = 'scheduled' then 'OK' else 'FALHA' end, s1);
  ok := false; begin perform public.reschedule_appointment(a6, now()); exception when others then ok := sqlerrm like '%horário passado%'; end;
  rep := rep || format(E'\n[%s] remarcar para "agora" também é recusado', case when ok then 'OK' else 'FALHA' end);
  a9 := public.reschedule_appointment(a6, (d + time '16:00') at time zone 'America/Sao_Paulo');
  rep := rep || format(E'\n[%s] remarcar para horário futuro continua funcionando', case when a9 is not null and (select status from public.appointments where id = a6) = 'rescheduled' then 'OK' else 'FALHA' end);

  -- ============ 2) paciente cancela: antecipado (sem custo) ============
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  select can_cancel, cancel_consumes, late_cancel_hours, uses_package into r from public.my_appointments() where id = a1;
  rep := rep || format(E'\n[%s] portal informa ANTES: pode cancelar, não consome, prazo do produto = 24 h (cancel=%s consome=%s prazo=%s)', case when r.can_cancel and not r.cancel_consumes and r.late_cancel_hours = 24 and r.uses_package then 'OK' else 'FALHA' end, r.can_cancel, r.cancel_consumes, r.late_cancel_hours);
  j := public.my_appointment_cancel(a1, null);
  select status, cancel_reason into r from public.appointments where id = a1; select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] cancelamento antecipado: status cancelled_by_patient, motivo padrão preenchido (%s)', case when r.status = 'cancelled_by_patient' and r.cancel_reason is not null then 'OK' else 'FALHA' end, r.status);
  rep := rep || format(E'\n[%s] cancelamento antecipado NÃO consome sessão (saldo=%s) e a resposta diz session_consumed=false', case when n = 4 and (j ->> 'session_consumed')::boolean is false then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  ok := false; begin perform public.book_appointment(p1, v_ua, pr, svc, t10); ok := true; exception when others then ok := false; end;
  rep := rep || format(E'\n[%s] o horário cancelado volta a ficar livre', case when ok then 'OK' else 'FALHA' end);

  -- ============ 3) paciente cancela: tardio (consome, conforme a política) ============
  reset role; update public.appointments set period = tstzrange(now() + interval '3 hours', now() + interval '4 hours') where id = a2; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  select can_cancel, cancel_consumes into r from public.my_appointments() where id = a2;
  rep := rep || format(E'\n[%s] dentro do prazo de 24 h o portal avisa que cancelar CONSUME sessão', case when r.can_cancel and r.cancel_consumes then 'OK' else 'FALHA' end);
  j := public.my_appointment_cancel(a2, 'imprevisto de trabalho');
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] cancelamento tardio consome 1 sessão (saldo=%s) e a resposta diz session_consumed=true', case when n = 3 and (j ->> 'session_consumed')::boolean is true then 'OK' else 'FALHA' end, n);
  select cancel_reason into s1 from public.appointments where id = a2;
  rep := rep || format(E'\n[%s] o motivo informado pelo paciente é guardado', case when s1 = 'imprevisto de trabalho' then 'OK' else 'FALHA' end);
  perform public.my_appointment_cancel(a2, null); select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] cancelar de novo é idempotente e não consome outra sessão (saldo=%s)', case when n = 3 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.session_ledger where appointment_id = a2 and reason = 'consume' and note like 'Cancelamento tardio%';
  rep := rep || format(E'\n[%s] o livro registra "Cancelamento tardio" uma única vez (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select session_consumed, status into r from public.my_appointments() where id = a2;
  rep := rep || format(E'\n[%s] o portal mostra o cancelado tardio como sessão consumida', case when r.session_consumed and r.status = 'cancelled_by_patient' then 'OK' else 'FALHA' end);
  select can_cancel into r from public.my_appointments() where id = a2;
  rep := rep || format(E'\n[%s] atendimento cancelado não oferece cancelar de novo', case when not r.can_cancel then 'OK' else 'FALHA' end);

  -- ============ 4) sem pacote: nada a consumir ============
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role','authenticated')::text, true);
  select cancel_consumes, uses_package into r from public.my_appointments() where id = a3;
  rep := rep || format(E'\n[%s] atendimento sem pacote: não consome e o portal não fala de prazo de sessão', case when not r.cancel_consumes and not r.uses_package then 'OK' else 'FALHA' end);
  perform public.my_appointment_cancel(a3, null);
  select count(*) into n from public.session_ledger where appointment_id = a3;
  rep := rep || format(E'\n[%s] cancelar atendimento sem pacote não gera lançamento no livro (%s)', case when n = 0 and (select status from public.appointments where id = a3) = 'cancelled_by_patient' then 'OK' else 'FALHA' end, n);

  -- ============ 5) permissões e recusas ============
  ok := false; begin perform public.my_appointment_cancel(a5, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] paciente 2 NÃO cancela atendimento do paciente 1', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  ok := false; begin perform public.my_appointment_cancel(a4, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] paciente 1 NÃO cancela atendimento do paciente 2', case when ok then 'OK' else 'FALHA' end);
  foreach s1 in array array[u_mgr::text, u_sales::text, u_uma::text, u_phy::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', s1::uuid, 'role','authenticated')::text, true);
    ok := false; begin perform public.my_appointment_cancel(a5, null); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || format(E'\n[%s] perfil de equipe (%s) não usa o cancelamento do paciente', case when ok then 'OK' else 'FALHA' end, (select role from public.role_assignments where user_id = s1::uuid limit 1));
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  perform public.set_appointment_status(a8, 'cancelled_by_clinic', 'teste');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  ok := false; begin perform public.my_appointment_cancel(a8, null); exception when others then ok := sqlerrm like '%não pode mais ser cancelado%'; end;
  rep := rep || format(E'\n[%s] cancelado pela clínica não pode ser cancelado pelo paciente', case when ok then 'OK' else 'FALHA' end);
  reset role; update public.appointments set period = tstzrange(now() - interval '30 minutes', now() + interval '30 minutes') where id = a5; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  ok := false; begin perform public.my_appointment_cancel(a5, null); exception when others then ok := sqlerrm like '%já começou%'; end;
  rep := rep || format(E'\n[%s] depois do início o paciente não cancela pelo portal (fala com a equipe)', case when ok then 'OK' else 'FALHA' end);
  select can_cancel into r from public.my_appointments() where id = a5;
  rep := rep || format(E'\n[%s] depois do início o portal não oferece cancelar', case when not r.can_cancel then 'OK' else 'FALHA' end);
  ok := false; begin perform public.my_appointment_cancel(a5, repeat('x', 501)); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] motivo longo demais é recusado (ou o atendimento já começou)', case when ok then 'OK' else 'FALHA' end);

  -- ============ 6) agendas de outros profissionais: só por permissão ============
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  select count(*) into n from public.my_agenda_professionals() where id in (pr, pr2) and not is_self;
  rep := rep || format(E'\n[%s] gestor vê as duas agendas (nenhuma é a própria)', case when n = 2 then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_uma, 'role','authenticated')::text, true);
  select count(*) into n from public.my_agenda_professionals() where id in (pr, pr2);
  rep := rep || format(E'\n[%s] gestor da unidade A vê os profissionais que atendem na unidade A (%s)', case when n = 2 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_umb, 'role','authenticated')::text, true);
  select count(*) into n from public.my_agenda_professionals() where id in (pr, pr2);
  rep := rep || format(E'\n[%s] gestor da unidade B vê só quem atende na unidade B (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  select count(*), count(*) filter (where is_self) into n, n2 from public.my_agenda_professionals();
  rep := rep || format(E'\n[%s] fisioterapeuta vê só a PRÓPRIA agenda na lista (%s, próprias=%s)', case when n = 1 and n2 = 1 then 'OK' else 'FALHA' end, n, n2);
  foreach s1 in array array[u_sales::text, u_p1::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', s1::uuid, 'role','authenticated')::text, true);
    select count(*) into n from public.my_agenda_professionals();
    rep := rep || format(E'\n[%s] %s não vê nenhuma agenda clínica (%s)', case when n = 0 then 'OK' else 'FALHA' end, case when s1::uuid = u_sales then 'comercial' else 'paciente' end, n);
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  j := public.professional_day(pr, (t10 at time zone 'UTC')::date);
  rep := rep || format(E'\n[%s] fisioterapeuta abre a própria agenda (is_self=true) com seus atendimentos', case when (j ->> 'is_self')::boolean and jsonb_array_length(j -> 'appointments') >= 1 then 'OK' else 'FALHA' end);
  select count(*) into n from jsonb_array_elements(j -> 'appointments') x where (x ->> 'can_confirm')::boolean;
  rep := rep || format(E'\n[%s] na própria agenda o profissional pode confirmar (%s atendimentos confirmáveis)', case when n >= 1 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.professional_day(pr2, (t10 at time zone 'UTC')::date); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta NÃO abre a agenda de outro fisioterapeuta', case when ok then 'OK' else 'FALHA' end);
  foreach s1 in array array[u_sales::text, u_p1::text, u_umb::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', s1::uuid, 'role','authenticated')::text, true);
    ok := false; begin perform public.professional_day(pr, (t10 at time zone 'UTC')::date); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || format(E'\n[%s] %s NÃO abre a agenda do fisioterapeuta A', case when ok then 'OK' else 'FALHA' end, case when s1::uuid = u_sales then 'comercial' when s1::uuid = u_p1 then 'paciente' else 'gestor da unidade B' end);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  j := public.professional_day(pr, (t10 at time zone 'UTC')::date);
  select count(*) into n from jsonb_array_elements(j -> 'appointments') x where (x ->> 'can_confirm')::boolean;
  rep := rep || format(E'\n[%s] gestor vê a agenda do fisioterapeuta A mas SEM ação de confirmar por ele (is_self=%s, confirmáveis=%s)', case when not (j ->> 'is_self')::boolean and jsonb_array_length(j -> 'appointments') >= 1 and n = 0 then 'OK' else 'FALHA' end, j ->> 'is_self', n);
  -- escopo de unidade: o Fisio B tem atendimento na unidade A e na B
  perform set_config('request.jwt.claims', json_build_object('sub', u_uma, 'role','authenticated')::text, true);
  j := public.professional_day(pr2, (t10 at time zone 'UTC')::date);
  select count(*) into n from jsonb_array_elements(j -> 'appointments') x where x ->> 'unit' like 'Unidade B%';
  rep := rep || format(E'\n[%s] gestor da unidade A, na agenda do Fisio B, NÃO vê os atendimentos da unidade B (%s)', case when n = 0 and jsonb_array_length(j -> 'appointments') >= 1 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  j := public.professional_day(pr2, (t10 at time zone 'UTC')::date);
  select count(*) into n from jsonb_array_elements(j -> 'appointments') x where x ->> 'unit' like 'Unidade B%';
  rep := rep || format(E'\n[%s] gestor (toda a organização) vê os atendimentos das duas unidades (unidade B=%s)', case when n = 1 then 'OK' else 'FALHA' end, n);

  -- ============ 7) superfície pública ============
  reset role; set local role anon;
  ok := false; begin perform public.my_appointment_cancel(a5, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa o cancelamento do paciente', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.professional_day(pr, d); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa professional_day', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform * from public.my_agenda_professionals(); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa my_agenda_professionals', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.reschedule_appointment(a3, t10); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa reschedule_appointment', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_S04_CANCELAMENTO_PASSADO_AGENDAS (transação desfeita):%', rep;
end $$;
