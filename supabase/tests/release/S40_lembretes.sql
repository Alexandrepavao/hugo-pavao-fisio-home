-- RELEASE v1 — S40: lembretes por e-mail e push (migration 103): fila idempotente, preferências, aparelhos, menor de idade (vai ao responsável), WhatsApp reservado, só o servidor gera/consome a fila.
-- Transação sempre desfeita. Somente Dev/teste. O ENVIO real (Edge Function) não é exercitado aqui.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.headers', '{}', true); end $$;
do $$
declare
  v_org uuid; ua uuid; svc uuid; pr uuid; rep text := ''; j jsonb; n int; e text; ap uuid; pres uuid; ex uuid;
  u_p1 uuid := gen_random_uuid(); u_mae uuid := gen_random_uuid(); u_p3 uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_p4 uuid := gen_random_uuid();
  pe_phy uuid; p1 uuid; p_mae uuid; p_kid uuid; p3 uuid; p4 uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade teste S40', 'teste-s40') returning id into ua;
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@s40.local' from unnest(array[u_p1,u_mae,u_p3,u_phy,u_p4]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S40') returning id into pe_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S40') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Mãe S40') returning id into p_mae;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Criança S40', current_date - interval '8 years') returning id into p_kid;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente Treino S40') returning id into p3;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente Plano S40') returning id into p4;
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, p1, 'email', 'paciente.s40@t.local', true),(v_org, p_mae, 'email', 'mae.s40@t.local', true);
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_p1, v_org, p1, 'P1'),(u_mae, v_org, p_mae, 'Mae'),(u_p3, v_org, p3, 'P3'),(u_phy, v_org, pe_phy, 'Fisio'),(u_p4, v_org, p4, 'P4');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org,u_p1,'member',null),(v_org,u_mae,'member',null),(v_org,u_p3,'member',null),(v_org,u_phy,'physio',ua),(v_org,u_p4,'member',null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço S40', 30) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio S40') returning id into pr;
  insert into public.care_representations (org_id, unit_id, patient_person_id, representative_person_id, kind, can_agenda, status, verified_at) values (v_org, ua, p_kid, p_mae, 'responsavel_legal', true, 'verified', now());
  -- consultas amanhã: do adulto e da criança
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, ua, pr, p1, svc, tstzrange(now() + interval '22 hours', now() + interval '22 hours 30 minutes'), 'scheduled') returning id into ap;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, ua, pr, p_kid, svc, tstzrange(now() + interval '23 hours', now() + interval '23 hours 30 minutes'), 'scheduled');
  -- treino: p3 tem prescrição ativa e nenhum treino recente; plano antigo de p4 sem check-in
  insert into public.exercise_library (org_id, title) values (v_org, 'Ex S40') returning id into ex;
  insert into public.exercise_prescriptions (org_id, unit_id, person_id, professional_user_id, title) values (v_org, ua, p3, u_phy, 'Plano S40') returning id into pres;
  insert into public.prescription_items (prescription_id, exercise_id, sets, reps) values (pres, ex, 3, 10);
  insert into public.patient_plans (org_id, unit_id, person_id, planned_sessions, started_on) values (v_org, ua, p4, 6, current_date - 10);

  set local role authenticated;
  -- ============ preferências
  perform pg_temp.as_user(u_p1); j := public.my_notification_prefs();
  rep := rep || pg_temp.chk((select (x ->> 'enabled')::boolean from jsonb_array_elements(j -> 'prefs') x where x ->> 'channel' = 'email' and x ->> 'kind' = 'appointment') and not (select (x ->> 'enabled')::boolean from jsonb_array_elements(j -> 'prefs') x where x ->> 'channel' = 'push' and x ->> 'kind' = 'appointment'),
    'padrão: e-mail ligado e push desligado (push exige ativar o aparelho)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_notification_pref_set(''whatsapp'', ''appointment'', true)') like '%WhatsApp está reservado%', 'WhatsApp é reservado: não aceita preferência nem envia');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_notification_pref_set(''email'', ''oferta'', true)') like '%tipo inválido%', 'oferta não é um tipo de lembrete (não há marketing por aqui)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.push_subscribe(''http://inseguro'', ''a'', ''b'')') like '%aparelho inválido%', 'aparelho com endereço não-HTTPS é recusado');

  -- ============ só o servidor gera e consome a fila
  rep := rep || pg_temp.chk(pg_temp.err('select public.notifications_enqueue_due()') like '42501%' and pg_temp.err('select public.notifications_pending(10)') like '42501%' and pg_temp.err('select public.notification_mark(gen_random_uuid(), ''sent'')') like '42501%', 'usuário comum NÃO gera nem consome a fila (42501)');
  set local role anon; rep := rep || pg_temp.chk(pg_temp.err('select public.my_notification_prefs()') like '42501%', 'anônimo não lê preferências'); set local role authenticated;

  -- ============ geração (como o servidor)
  reset role; set local role service_role; n := public.notifications_enqueue_due(); reset role;
  rep := rep || pg_temp.chk(n >= 4, 'o servidor gera os lembretes devidos (consulta do adulto e da criança, treino, check-in)');
  select count(*) into n from public.notification_queue where dedupe_key = 'appt:' || ap and channel = 'email' and recipient_person_id = p1; rep := rep || pg_temp.chk(n = 1, 'lembrete de consulta por e-mail para o paciente');
  select count(*) into n from public.notification_queue where person_id = p_kid and kind = 'appointment' and recipient_person_id = p_mae; rep := rep || pg_temp.chk(n = 1, 'a criança de 8 anos NÃO recebe: o lembrete vai ao responsável legal');
  select count(*) into n from public.notification_queue where person_id = p3 and kind = 'training'; rep := rep || pg_temp.chk(n = 1, 'treino em casa sem registro recente gera lembrete');
  select count(*) into n from public.notification_queue where person_id = p4 and kind = 'checkin'; rep := rep || pg_temp.chk(n = 1, 'check-in da semana pendente gera lembrete');
  select count(*) into n from public.notification_queue where person_id in (p1, p_kid, p3, p4) and channel = 'push'; rep := rep || pg_temp.chk(n = 0, 'sem aparelho cadastrado não há push');
  select count(*) into n from public.notification_queue where channel = 'whatsapp'; rep := rep || pg_temp.chk(n = 0, 'nada é enfileirado para WhatsApp');
  reset role; set local role service_role; n := public.notifications_enqueue_due(); reset role;
  select count(*) into n from public.notification_queue where person_id in (p1, p_kid, p3, p4); rep := rep || pg_temp.chk(n = 4, 'rodar de novo não duplica (idempotente por dedupe_key)'); set local role authenticated;

  -- ============ push: o paciente ativa o aparelho e o tipo; desliga e-mail de treino
  perform pg_temp.as_user(u_p1);
  perform public.push_subscribe('https://push.example/s40', 'p256-key', 'auth-key', 'teste');
  perform public.my_notification_pref_set('push', 'appointment', true); perform public.my_notification_pref_set('email', 'checkin', false);
  perform pg_temp.as_user(u_p4); perform public.my_notification_pref_set('email', 'checkin', false);
  reset role; delete from public.notification_queue where person_id in (p1, p4); set local role service_role; perform public.notifications_enqueue_due(); reset role;
  select count(*) into n from public.notification_queue where person_id = p1 and channel = 'push' and kind = 'appointment'; rep := rep || pg_temp.chk(n = 1, 'com aparelho e preferência ligada, o lembrete também vai por push');
  select count(*) into n from public.notification_queue where person_id = p4 and kind = 'checkin' and channel = 'email'; rep := rep || pg_temp.chk(n = 0, 'e-mail de check-in desligado pelo paciente: não é gerado');

  -- ============ entrega (simulada): pendentes, marcação, falha
  update public.notification_queue set run_at = now() - interval '1 minute' where person_id in (p1, p_kid, p3, p4);   -- os lembretes de consulta só ficam devidos ~20 h antes; aqui forçamos o horário
  set local role service_role; j := public.notifications_pending(100); reset role;
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(j) x where x ->> 'channel' = 'email' and x ->> 'email' = 'paciente.s40@t.local') and exists (select 1 from jsonb_array_elements(j) x where x ->> 'channel' = 'push' and jsonb_array_length(x -> 'devices') = 1), 'a Edge Function recebe e-mail do destinatário e os aparelhos');
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(j) x where x ->> 'email' = 'mae.s40@t.local'), 'o lembrete da criança sai para o e-mail da mãe');
  set local role service_role; perform public.notification_mark((select id from public.notification_queue where person_id = p1 and channel = 'email' and kind = 'appointment'), 'sent'); reset role;
  select count(*) into n from public.notification_queue where person_id = p1 and channel = 'email' and kind = 'appointment' and status = 'sent' and sent_at is not null and attempts = 1; rep := rep || pg_temp.chk(n = 1, 'marcar como enviado registra data e tentativa');
  set local role service_role; j := public.notifications_pending(100); reset role;
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(j) x where (x ->> 'id')::uuid = (select id from public.notification_queue where person_id = p1 and channel = 'email' and kind = 'appointment')), 'o que já foi enviado não volta para a fila');

  -- ============ aparelhos e tabelas fechadas
  perform pg_temp.as_user(u_p3); perform public.push_unsubscribe('https://push.example/s40');
  reset role; select count(*) into n from public.push_subscriptions where endpoint = 'https://push.example/s40'; rep := rep || pg_temp.chk(n = 1, 'outro usuário não remove o aparelho alheio'); set local role authenticated;
  perform pg_temp.as_user(u_p1); perform public.push_unsubscribe('https://push.example/s40');
  reset role; select count(*) into n from public.push_subscriptions where endpoint = 'https://push.example/s40'; rep := rep || pg_temp.chk(n = 0, 'o dono remove o próprio aparelho'); set local role authenticated; perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.notification_queue') like '42501%' and pg_temp.err('select count(*) from public.push_subscriptions') like '42501%' and pg_temp.err('select count(*) from public.notification_prefs') like '42501%', 'ninguém lê as tabelas direto');
  raise exception 'RELATORIO_S40%', rep;
end $$;
