-- RELEASE v1 — S03: confirmação antecipada (paciente e profissional), presença efetiva e consumo de sessão — três coisas separadas.
-- Cobre a migration 054. Transação sempre desfeita ao final (raise exception com o relatório). Somente Dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; v_ub uuid;
  u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_salesb uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid();
  u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid();
  pr uuid; pr2 uuid; svc uuid; prod uuid; prod_free uuid; pkg uuid; pkg_free uuid; p1 uuid; p2 uuid; p3 uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid; a8 uuid; a9 uuid;
  d date := current_date + 3; t10 timestamptz; t11 timestamptz; t12 timestamptz; t14 timestamptz;
  n int; n2 int; ok boolean; rep text := ''; s1 text; s2 text; ts1 timestamptz; ts2 timestamptz; r record; j jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S03)', 'teste-b-s03') returning id into v_ub;
  insert into auth.users (id, aud, role, email) values
    (u_mgr,'authenticated','authenticated','m@s03.local'),(u_sales,'authenticated','authenticated','s@s03.local'),(u_salesb,'authenticated','authenticated','sb@s03.local'),
    (u_fin,'authenticated','authenticated','f@s03.local'),(u_phy,'authenticated','authenticated','phy@s03.local'),(u_phy2,'authenticated','authenticated','phy2@s03.local'),
    (u_p1,'authenticated','authenticated','p1@s03.local'),(u_p2,'authenticated','authenticated','p2@s03.local');
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente S03 Um') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente S03 Dois') returning id into p2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente S03 Tres') returning id into p3;
  insert into public.user_accounts (user_id, org_id, person_id) values (u_mgr, v_org, null),(u_sales, v_org, null),(u_salesb, v_org, null),(u_fin, v_org, null),
    (u_phy, v_org, null),(u_phy2, v_org, null),(u_p1, v_org, p1),(u_p2, v_org, p2);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', v_ua),(v_org, u_salesb, 'sales', v_ub),
    (v_org, u_fin, 'finance', v_ua),(v_org, u_phy, 'physio', v_ua),(v_org, u_phy2, 'physio', v_ua),(v_org, u_p1, 'member', null),(v_org, u_p2, 'member', null);
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy, 'Fisio A S03') returning id into pr;
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy2, 'Fisio B S03') returning id into pr2;
  insert into public.professional_units values (pr, v_ua),(pr2, v_ua);
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time)
    select v_org, x, v_ua, w, '08:00', '18:00' from unnest(array[pr, pr2]) x, generate_series(0, 6) w;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão S03', 60) returning id into svc;
  insert into public.products (org_id, kind, name, sessions_count, service_id, consume_on_no_show, late_cancel_hours) values (v_org, 'package', 'Pacote 4 cobra falta (S03)', 4, svc, true, 24) returning id into prod;
  insert into public.products (org_id, kind, name, sessions_count, service_id, consume_on_no_show, late_cancel_hours) values (v_org, 'package', 'Pacote 4 não cobra falta (S03)', 4, svc, false, 24) returning id into prod_free;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, v_ua, p1, prod, 4) returning id into pkg;
  insert into public.session_ledger (org_id, client_package_id, delta, reason) values (v_org, pkg, 4, 'grant');
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, v_ua, p3, prod_free, 4) returning id into pkg_free;
  insert into public.session_ledger (org_id, client_package_id, delta, reason) values (v_org, pkg_free, 4, 'grant');
  t10 := (d + time '10:00') at time zone 'America/Sao_Paulo'; t11 := (d + time '11:00') at time zone 'America/Sao_Paulo';
  t12 := (d + time '12:00') at time zone 'America/Sao_Paulo'; t14 := (d + time '14:00') at time zone 'America/Sao_Paulo';

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  a1 := public.book_appointment(p1, v_ua, pr,  svc, t10, pkg);
  a2 := public.book_appointment(p2, v_ua, pr,  svc, t11);
  a3 := public.book_appointment(p1, v_ua, pr2, svc, t12, pkg);
  a4 := public.book_appointment(p1, v_ua, pr,  svc, t14, pkg);
  a5 := public.book_appointment(p3, v_ua, pr2, svc, t10, pkg_free);
  a6 := public.book_appointment(p1, v_ua, pr2, svc, t11, pkg);
  a8 := public.book_appointment(p2, v_ua, pr,  svc, t10 + interval '2 days');
  a9 := public.book_appointment(p2, v_ua, pr2, svc, t10 + interval '4 days');

  -- ============ 1) confirmação do paciente (portal): só do próprio atendimento, sem efeito em status nem em sessão ============
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  perform public.my_appointment_confirm(a1);
  select status, patient_confirmed_at, patient_confirmed_via into r from public.appointments where id = a1; ts1 := r.patient_confirmed_at;
  rep := rep || format(E'\n[%s] paciente confirma o próprio atendimento (via=%s)', case when ts1 is not null and r.patient_confirmed_via = 'portal' then 'OK' else 'FALHA' end, r.patient_confirmed_via);
  rep := rep || format(E'\n[%s] confirmar NÃO muda o status (%s) e NÃO confirma pelo profissional', case when r.status = 'scheduled' and (select professional_confirmed_at from public.appointments where id = a1) is null then 'OK' else 'FALHA' end, r.status);
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] confirmar NÃO consome sessão (saldo=%s)', case when n = 4 then 'OK' else 'FALHA' end, n);
  perform public.my_appointment_confirm(a1);
  select patient_confirmed_at into ts2 from public.appointments where id = a1;
  rep := rep || format(E'\n[%s] confirmação repetida é idempotente (mesmo instante)', case when ts1 = ts2 then 'OK' else 'FALHA' end);

  ok := false; begin perform public.my_appointment_confirm(a2); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] paciente NÃO confirma atendimento de outro paciente', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.professional_appointment_confirm(a1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] paciente NÃO confirma pelo profissional', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.appointment_confirm_for_patient(a3); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] paciente não usa a via da recepção', case when ok then 'OK' else 'FALHA' end);

  -- ============ 2) confirmação do profissional: independente e só do próprio ============
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  ok := false; begin perform public.professional_appointment_confirm(a2); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta B NÃO confirma atendimento da fisioterapeuta A', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  ok := false; begin perform public.professional_appointment_confirm(a2); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] gestor NÃO confirma em nome do profissional (independência)', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin perform public.my_appointment_confirm(a2); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta não confirma como se fosse o paciente', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.appointment_confirm_for_patient(a2); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta não registra confirmação do paciente', case when ok then 'OK' else 'FALHA' end);
  perform public.professional_appointment_confirm(a2);
  select patient_confirmed_at, professional_confirmed_at, status into r from public.appointments where id = a2;
  rep := rep || format(E'\n[%s] fisioterapeuta confirma o próprio atendimento; a confirmação do paciente continua pendente (independentes)', case when r.professional_confirmed_at is not null and r.patient_confirmed_at is null and r.status = 'scheduled' then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role','authenticated')::text, true);
  perform public.my_appointment_confirm(a2);
  select patient_confirmed_at, professional_confirmed_at into r from public.appointments where id = a2;
  rep := rep || format(E'\n[%s] depois o paciente confirma; as duas confirmações coexistem', case when r.patient_confirmed_at is not null and r.professional_confirmed_at is not null then 'OK' else 'FALHA' end);

  -- ============ 3) recepção registra a confirmação do paciente (marcada como "staff"), com escopo de unidade ============
  perform set_config('request.jwt.claims', json_build_object('sub', u_salesb, 'role','authenticated')::text, true);
  ok := false; begin perform public.appointment_confirm_for_patient(a3); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial de OUTRA unidade não registra confirmação', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  ok := false; begin perform public.appointment_confirm_for_patient(a3); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] financeiro não registra confirmação', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  perform public.appointment_confirm_for_patient(a3);
  select patient_confirmed_via, professional_confirmed_at into r from public.appointments where id = a3;
  rep := rep || format(E'\n[%s] comercial da unidade registra a confirmação do paciente (via=%s) sem confirmar pelo profissional', case when r.patient_confirmed_via = 'staff' and r.professional_confirmed_at is null then 'OK' else 'FALHA' end, r.patient_confirmed_via);

  -- ============ 4) confirmação só antes do horário e só em atendimento ativo ============
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  perform public.set_appointment_status(a9, 'cancelled_by_clinic', 'teste');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role','authenticated')::text, true);
  ok := false; begin perform public.my_appointment_confirm(a9); exception when others then ok := sqlerrm like '%não está ativo%'; end;
  rep := rep || format(E'\n[%s] atendimento cancelado não pode ser confirmado', case when ok then 'OK' else 'FALHA' end);
  reset role; update public.appointments set period = tstzrange(now() - interval '30 minutes', now() + interval '30 minutes') where id = a8; set local role authenticated;
  ok := false; begin perform public.my_appointment_confirm(a8); exception when others then ok := sqlerrm like '%antes do horário%'; end;
  rep := rep || format(E'\n[%s] depois do início a confirmação antecipada é recusada (paciente)', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin perform public.professional_appointment_confirm(a8); exception when others then ok := sqlerrm like '%antes do horário%'; end;
  rep := rep || format(E'\n[%s] depois do início a confirmação antecipada é recusada (profissional)', case when ok then 'OK' else 'FALHA' end);

  -- ============ 5) presença efetiva (status) separada da confirmação e do consumo ============
  -- 5a) confirmou, mas NÃO veio nem cancelou => falta do paciente (no_show), nunca "realizado"; consome conforme a política do produto
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  perform public.my_appointment_confirm(a4);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  ok := false; begin perform public.set_appointment_status(a4, 'no_show'); exception when others then ok := sqlerrm like '%antes do horário%'; end;
  rep := rep || format(E'\n[%s] falta não pode ser marcada antes do horário, mesmo com confirmação', case when ok then 'OK' else 'FALHA' end);
  reset role; update public.appointments set period = tstzrange(now() - interval '5 hours', now() - interval '4 hours') where id = a4; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  perform public.set_appointment_status(a4, 'no_show');
  select status into s1 from public.appointments where id = a4;
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] paciente confirmado que faltou sem cancelar fica como no_show (%s), não como realizado', case when s1 = 'no_show' then 'OK' else 'FALHA' end, s1);
  rep := rep || format(E'\n[%s] a falta consome 1 sessão conforme a política do produto (saldo=%s)', case when n = 3 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);   -- livro e tarefas de CRM não são legíveis pelo fisioterapeuta (RLS): conferir como gestor
  select count(*) into n from public.session_ledger where appointment_id = a4 and reason = 'consume' and note like 'Falta%';
  rep := rep || format(E'\n[%s] o livro registra a falta (não "Atendimento realizado")', case when n = 1 then 'OK' else 'FALHA' end);
  select count(*) into n from public.crm_tasks where kind = 'no_show' and person_id = p1;
  rep := rep || format(E'\n[%s] a falta gera tarefa de retorno ao paciente (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);

  -- 5b) política que NÃO cobra falta: no_show sem consumo
  reset role; update public.appointments set period = tstzrange(now() - interval '7 hours', now() - interval '6 hours') where id = a5; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  perform public.set_appointment_status(a5, 'no_show');
  select private.package_balance(pkg_free) into n;
  rep := rep || format(E'\n[%s] produto que não cobra falta: no_show sem consumir (saldo=%s)', case when n = 4 then 'OK' else 'FALHA' end, n);

  -- 5c) comparecimento: não depende de ter confirmado; consome uma vez
  reset role; update public.appointments set period = tstzrange(now() - interval '2 hours', now() - interval '1 hour') where id = a1; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  perform public.set_appointment_status(a1, 'attended'); perform public.set_appointment_status(a1, 'attended');
  select status into s1 from public.appointments where id = a1; select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] comparecimento efetivo = attended e consome 1 sessão uma única vez (saldo=%s)', case when s1 = 'attended' and n = 2 then 'OK' else 'FALHA' end, n);
  reset role; update public.appointments set period = tstzrange(now() - interval '9 hours', now() - interval '8 hours') where id = a3; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  perform public.set_appointment_status(a3, 'attended');
  select status into s1 from public.appointments where id = a3; select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] quem NÃO confirmou também é atendido normalmente (confirmação não é pré-requisito) (saldo=%s)', case when s1 = 'attended' and n = 1 then 'OK' else 'FALHA' end, n);

  -- ============ 6) falta do profissional: nunca penaliza o paciente ============
  ok := false; begin perform public.set_appointment_status(a6, 'professional_no_show'); exception when others then ok := sqlerrm like '%antes do horário%'; end;
  rep := rep || format(E'\n[%s] falta do profissional não pode ser marcada antes do horário', case when ok then 'OK' else 'FALHA' end);
  reset role; update public.appointments set period = tstzrange(now() - interval '12 hours', now() - interval '11 hours') where id = a6; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role','authenticated')::text, true);
  ok := false; begin perform public.set_appointment_status(a6, 'professional_no_show'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] paciente não marca falta do profissional', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  perform public.set_appointment_status(a6, 'professional_no_show');
  select status into s1 from public.appointments where id = a6; select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] profissional faltou: status próprio (%s), distinto de no_show e de attended', case when s1 = 'professional_no_show' then 'OK' else 'FALHA' end, s1);
  rep := rep || format(E'\n[%s] falta do profissional NÃO consome sessão (saldo=%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.session_ledger where appointment_id = a6;
  rep := rep || format(E'\n[%s] nenhum lançamento no livro para a falta do profissional (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.crm_tasks where kind = 'no_show' and person_id = p1 and dedupe_key = 'no_show:' || a6;
  rep := rep || format(E'\n[%s] falta do profissional NÃO gera a tarefa "paciente faltou"', case when n = 0 then 'OK' else 'FALHA' end);
  select count(*) into n from public.crm_tasks where dedupe_key = 'pro_no_show:' || a6;
  rep := rep || format(E'\n[%s] gera tarefa para reagendar o paciente sem custo (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.set_appointment_status(a6, 'attended'); exception when others then ok := sqlerrm like '%encerrado%'; end;
  rep := rep || format(E'\n[%s] falta do profissional não vira atendimento realizado', case when ok then 'OK' else 'FALHA' end);
  reset role;
  begin insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status)
          values (v_org, v_ua, pr2, p1, svc, tstzrange(now() - interval '12 hours', now() - interval '11 hours'), 'scheduled'); ok := true;
  exception when exclusion_violation then ok := false; end;
  rep := rep || format(E'\n[%s] a falta do profissional libera o horário (sem conflito de sobreposição)', case when ok then 'OK' else 'FALHA' end);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);

  -- 6b) correção: falta marcada como do paciente por engano (consumiu) e depois corrigida para falta do profissional => devolve
  a7 := public.book_appointment(p1, v_ua, pr2, svc, t10 + interval '1 day', pkg);   -- reservado só agora: a regra de saldo não deixa reservar mais atendimentos ativos do que sessões
  reset role; update public.appointments set period = tstzrange(now() - interval '15 hours', now() - interval '14 hours') where id = a7; set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  perform public.set_appointment_status(a7, 'no_show');
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] (preparo) falta do paciente consumiu (saldo=%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  perform public.set_appointment_status(a7, 'professional_no_show');
  select private.package_balance(pkg) into n;
  rep := rep || format(E'\n[%s] corrigir para falta do profissional DEVOLVE a sessão (saldo=%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select status into s1 from public.client_packages where id = pkg;
  rep := rep || format(E'\n[%s] pacote esgotado por engano volta a ficar ativo (%s)', case when s1 = 'active' then 'OK' else 'FALHA' end, s1);
  select count(*) into n from public.session_ledger where appointment_id = a7 and reason = 'refund';
  rep := rep || format(E'\n[%s] uma única devolução por atendimento (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);

  -- ============ 7) o que cada um enxerga ============
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  select count(*) into n from public.my_appointments();
  select count(*) into n2 from public.my_appointments() where id in (a2, a8, a9);
  rep := rep || format(E'\n[%s] o portal do paciente lista só os próprios atendimentos (%s, alheios=%s)', case when n >= 5 and n2 = 0 then 'OK' else 'FALHA' end, n, n2);
  select session_consumed, uses_package, status into r from public.my_appointments() where id = a4;
  rep := rep || format(E'\n[%s] o paciente vê que a falta sem cancelamento descontou a sessão (consumed=%s)', case when r.session_consumed and r.uses_package and r.status = 'no_show' then 'OK' else 'FALHA' end, r.session_consumed);
  select session_consumed, status into r from public.my_appointments() where id = a6;
  rep := rep || format(E'\n[%s] o paciente vê que a falta do profissional NÃO descontou (%s)', case when not r.session_consumed and r.status = 'professional_no_show' then 'OK' else 'FALHA' end, r.status);
  select session_consumed into r from public.my_appointments() where id = a7;
  rep := rep || format(E'\n[%s] sessão devolvida deixa de aparecer como consumida', case when not r.session_consumed then 'OK' else 'FALHA' end);
  select can_confirm into r from public.my_appointments() where id = a1;
  rep := rep || format(E'\n[%s] atendimento já realizado não oferece confirmação', case when not r.can_confirm then 'OK' else 'FALHA' end);

  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  j := public.my_day((t11 at time zone 'UTC')::date);
  select count(*) into n from jsonb_array_elements(j -> 'appointments') x where x ->> 'id' = a2::text and (x ->> 'can_confirm')::boolean is false and x ->> 'patient_confirmed_at' is not null;
  rep := rep || format(E'\n[%s] "Meu dia" do fisioterapeuta mostra as confirmações do atendimento', case when n = 1 then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  select count(*) into n from public.appointments where id = a2;
  rep := rep || format(E'\n[%s] fisioterapeuta B continua sem ver atendimento da fisioterapeuta A', case when n = 0 then 'OK' else 'FALHA' end);

  -- ============ 8) auditoria e superfície pública ============
  reset role;
  select count(*) into n from public.audit_log where entity_type = 'appointments' and entity_id::text = a1::text and action = 'update' and new_values ->> 'patient_confirmed_at' is not null and actor_user_id = u_p1;
  rep := rep || format(E'\n[%s] a confirmação do paciente fica no log de auditoria com o autor (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.audit_log where entity_type = 'appointments' and entity_id::text = a2::text and action = 'update' and new_values ->> 'professional_confirmed_at' is not null and actor_user_id = u_phy;
  rep := rep || format(E'\n[%s] a confirmação do profissional fica no log de auditoria com o autor (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.audit_log where entity_type = 'appointments' and entity_id::text = a3::text and action = 'update' and new_values ->> 'patient_confirmed_via' = 'staff' and actor_user_id = u_sales;
  rep := rep || format(E'\n[%s] a confirmação registrada pela recepção guarda o canal "staff" e quem registrou (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.audit_log where entity_type = 'appointments' and entity_id::text = a6::text and new_values ->> 'status' = 'professional_no_show';
  rep := rep || format(E'\n[%s] a falta do profissional fica auditada (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);

  set local role anon;
  ok := false; begin perform public.my_appointment_confirm(a1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa a confirmação do paciente', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.professional_appointment_confirm(a1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa a confirmação do profissional', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.appointment_confirm_for_patient(a1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa o registro pela recepção', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform * from public.my_appointments(); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa my_appointments', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.set_appointment_status(a1, 'no_show'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa set_appointment_status', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_S03_CONFIRMACAO_PRESENCA_CONSUMO (transação desfeita):%', rep;
end $$;
