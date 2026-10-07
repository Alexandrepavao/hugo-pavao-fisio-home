-- RELEASE v1 — S08: calendários (visão por intervalo, assinatura .ics somente leitura com link revogável, conexão com o Google). Cobre a migration 059.
-- A integração real com o Google (OAuth e API) NÃO é coberta aqui (exige credenciais); este teste cobre o que vive no banco: permissões, privacidade e isolamento.
-- Transação sempre desfeita ao final (raise exception com o relatório). Somente Dev/teste.
do $$
declare
  v_org uuid; uz uuid; u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid();
  p1 uuid; p2 uuid; pr1 uuid; pr2 uuid; svc uuid; a1 uuid; a2 uuid; a3 uuid; b1 uuid;
  v_from timestamptz := date_trunc('day', now()) - interval '2 days'; v_to timestamptz := date_trunc('day', now()) + interval '10 days';
  tok1 text; tok2 text; tok3 text; h1 text; h2 text; ev jsonb; j jsonb; n int; n2 int; ok boolean; rep text := ''; s text; st text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Z (teste S08)', 'teste-z-s08') returning id into uz;
  insert into auth.users (id, aud, role, email) values (u_phy,'authenticated','authenticated','ph1@s08.local'),(u_phy2,'authenticated','authenticated','ph2@s08.local'),(u_mgr,'authenticated','authenticated','m@s08.local'),
    (u_sales,'authenticated','authenticated','s@s08.local'),(u_p1,'authenticated','authenticated','p1@s08.local');
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Paciente Confidencial S08') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Outra Paciente S08') returning id into p2;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_phy, v_org, null, 'Fisio Um S08'),(u_phy2, v_org, null, 'Fisio Dois S08'),(u_mgr, v_org, null, 'Gestor S08'),(u_sales, v_org, null, 'Comercial S08'),(u_p1, v_org, p1, 'Paciente Um');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_phy, 'physio', uz),(v_org, u_phy2, 'physio', uz),(v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', uz),(v_org, u_p1, 'member', null);
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy, 'Fisio Um S08') returning id into pr1;
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy2, 'Fisio Dois S08') returning id into pr2;
  insert into public.professional_units values (pr1, uz),(pr2, uz);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Pilates Clínico S08', 30) returning id into svc;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr1, p1, svc, tstzrange(now() + interval '1 day', now() + interval '1 day' + interval '30 minutes'), 'scheduled') returning id into a1;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr1, p1, svc, tstzrange(now() + interval '3 days', now() + interval '3 days' + interval '30 minutes'), 'cancelled_by_clinic') returning id into a2;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr1, p1, svc, tstzrange(now() - interval '1 day', now() - interval '1 day' + interval '30 minutes'), 'attended') returning id into a3;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr2, p2, svc, tstzrange(now() + interval '2 days', now() + interval '2 days' + interval '30 minutes'), 'scheduled') returning id into b1;
  insert into public.staff_tasks (org_id, owner_user_id, title, task_date, start_time) values (v_org, u_phy, 'Tarefa pessoal PRIVADA S08', current_date + 1, '09:00'),(v_org, u_mgr, 'Tarefa do gestor S08', current_date + 1, '10:00');
  insert into public.external_calendar_events (user_id, org_id, google_event_id, summary, starts_at, ends_at) values (u_phy, v_org, 'ext1', 'Dentista (externo)', now() + interval '1 day' + interval '4 hours', now() + interval '1 day' + interval '5 hours');

  -- ============ 1) visão por intervalo: agenda própria por padrão
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.my_calendar(v_from, v_to);
  select count(*) into n from jsonb_array_elements(j -> 'appointments') x where x ->> 'id' in (a1::text, a3::text);
  select count(*) into n2 from jsonb_array_elements(j -> 'appointments') x where x ->> 'id' in (a2::text, b1::text);
  rep := rep || format(E'\n[%s] agenda própria: traz o agendado e o realizado; NÃO traz o cancelado nem o atendimento de outro profissional (%s / %s)', case when n = 2 and n2 = 0 and (j ->> 'is_self')::boolean then 'OK' else 'FALHA' end, n, n2);
  select (x ->> 'can_confirm')::boolean into ok from jsonb_array_elements(j -> 'appointments') x where x ->> 'id' = a1::text;
  rep := rep || format(E'\n[%s] o profissional pode confirmar o PRÓPRIO atendimento futuro (can_confirm)', case when ok then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] tarefa pessoal e compromisso externo aparecem só na própria agenda (%s tarefa, %s externo)', case when jsonb_array_length(j -> 'tasks') = 1 and jsonb_array_length(j -> 'external') = 1 then 'OK' else 'FALHA' end, jsonb_array_length(j -> 'tasks'), jsonb_array_length(j -> 'external'));
  ok := false; begin perform public.my_calendar(v_from, v_from + interval '63 days'); exception when others then ok := sqlerrm like '%62 dias%'; end;
  rep := rep || format(E'\n[%s] intervalo maior que 62 dias é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.my_calendar(v_to, v_from); exception when others then ok := sqlerrm like '%intervalo inválido%'; end;
  rep := rep || format(E'\n[%s] intervalo invertido é recusado', case when ok then 'OK' else 'FALHA' end);

  -- ============ 2) agenda de outro profissional: só por permissão; nunca com confirmação, tarefas ou externos dele
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  ok := false; begin perform public.my_calendar(v_from, v_to, pr1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta NÃO abre a agenda de outro fisioterapeuta', case when ok then 'OK' else 'FALHA' end);
  foreach s in array array[u_sales::text, u_p1::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', s::uuid, 'role','authenticated')::text, true);
    ok := false; begin perform public.my_calendar(v_from, v_to, pr1); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || format(E'\n[%s] %s NÃO abre a agenda de fisioterapeuta', case when ok then 'OK' else 'FALHA' end, case s::uuid when u_sales then 'comercial' else 'paciente' end);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  j := public.my_calendar(v_from, v_to, pr1);
  select count(*) filter (where (x ->> 'can_confirm')::boolean) into n from jsonb_array_elements(j -> 'appointments') x;
  rep := rep || format(E'\n[%s] gestor vê a agenda do fisioterapeuta, SEM confirmar por ele e SEM as tarefas/externos dele (agenda alheia: is_self=%s, confirmáveis=%s, tarefas=%s, externos=%s)',
    case when not (j ->> 'is_self')::boolean and jsonb_array_length(j -> 'appointments') = 2 and n = 0 and jsonb_array_length(j -> 'tasks') = 0 and jsonb_array_length(j -> 'external') = 0 then 'OK' else 'FALHA' end,
    j ->> 'is_self', n, jsonb_array_length(j -> 'tasks'), jsonb_array_length(j -> 'external'));
  j := public.my_calendar(v_from, v_to);
  rep := rep || format(E'\n[%s] a agenda PRÓPRIA do gestor traz as tarefas dele (1) e nenhum atendimento (não é profissional)', case when jsonb_array_length(j -> 'tasks') = 1 and jsonb_array_length(j -> 'appointments') = 0 then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin insert into public.external_calendar_events (user_id, org_id, google_event_id, summary, starts_at, ends_at) values (u_phy, v_org, 'x', 'forjado', now(), now() + interval '1 hour'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] o navegador NÃO grava compromissos externos (só o servidor, via Google)', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.external_calendar_events;
  rep := rep || format(E'\n[%s] cada usuário lê só os próprios compromissos externos (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  select count(*) into n from public.external_calendar_events;
  rep := rep || format(E'\n[%s] outro usuário não lê os compromissos externos do fisioterapeuta (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);

  -- ============ 3) assinatura .ics: token só como hash, revogável, conteúdo mínimo
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  tok1 := public.calendar_feed_create('minimal');
  rep := rep || format(E'\n[%s] o link é um token secreto de 64 hex devolvido uma única vez', case when tok1 ~ '^[0-9a-f]{64}$' then 'OK' else 'FALHA' end);
  reset role; h1 := encode(sha256(convert_to(tok1, 'UTF8')), 'hex');
  select count(*) into n from public.calendar_feeds where token_hash = tok1; select count(*) into n2 from public.calendar_feeds where token_hash = h1 and user_id = u_phy and revoked_at is null;
  rep := rep || format(E'\n[%s] no banco fica só o HASH do token (token em claro: %s; hash: %s)', case when n = 0 and n2 = 1 then 'OK' else 'FALHA' end, n, n2);
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin perform public.calendar_feed_events(h1); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] o usuário NÃO lê o feed pela API (só o servidor, com service_role)', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform count(*) from public.calendar_feeds; exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] a tabela de feeds não é legível pelo navegador', case when ok then 'OK' else 'FALHA' end);
  select active, detail into ok, st from public.calendar_feed_status();
  rep := rep || format(E'\n[%s] status: link ativo com conteúdo mínimo', case when ok and st = 'minimal' then 'OK' else 'FALHA' end);
  reset role; set local role service_role;
  ev := public.calendar_feed_events(h1);
  select count(*) into n from jsonb_array_elements(ev -> 'events') x where x ->> 'uid' = 'appt-' || a1::text || '@hp-group-hub' and x ->> 'status' = 'CONFIRMED' and x ->> 'summary' = 'Atendimento HP';
  select count(*) into n2 from jsonb_array_elements(ev -> 'events') x where x ->> 'uid' = 'appt-' || a2::text || '@hp-group-hub' and x ->> 'status' = 'CANCELLED';
  rep := rep || format(E'\n[%s] feed mínimo: atendimento confirmado como "Atendimento HP" e o cancelado com o MESMO UID e STATUS CANCELLED (sem duplicar) (%s / %s)', case when n = 1 and n2 = 1 then 'OK' else 'FALHA' end, n, n2);
  rep := rep || format(E'\n[%s] feed mínimo NÃO contém nome de paciente, nome de serviço nem tarefa pessoal', case when ev::text not like '%Confidencial%' and ev::text not like '%Pilates%' and ev::text not like '%PRIVADA%' and ev::text not like '%Dentista%' then 'OK' else 'FALHA' end);
  select count(*) into n from jsonb_array_elements(ev -> 'events') x where x ->> 'uid' = 'appt-' || b1::text || '@hp-group-hub';
  rep := rep || format(E'\n[%s] o feed do fisioterapeuta não traz atendimento de outro profissional (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  rep := rep || format(E'\n[%s] token desconhecido devolve nulo (a função responde 404 sem revelar nada)', case when public.calendar_feed_events(repeat('0', 64)) is null then 'OK' else 'FALHA' end);
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  tok2 := public.calendar_feed_create('names');
  reset role; h2 := encode(sha256(convert_to(tok2, 'UTF8')), 'hex'); select count(*) into n from public.calendar_feeds where user_id = u_phy and revoked_at is null;
  rep := rep || format(E'\n[%s] gerar outro link revoga o anterior (1 ativo) e o novo é diferente', case when n = 1 and tok1 <> tok2 then 'OK' else 'FALHA' end);
  set local role service_role;
  rep := rep || format(E'\n[%s] o link ANTIGO deixa de funcionar imediatamente', case when public.calendar_feed_events(h1) is null then 'OK' else 'FALHA' end);
  ev := public.calendar_feed_events(h2);
  select count(*) into n from jsonb_array_elements(ev -> 'events') x where x ->> 'summary' = 'Atendimento: Paciente — Pilates Clínico S08';
  rep := rep || format(E'\n[%s] com a opção explícita "nomes": primeiro nome do paciente e serviço (nunca o sobrenome) (%s)', case when n >= 1 and ev::text not like '%Confidencial%' then 'OK' else 'FALHA' end, n);
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  perform public.calendar_feed_revoke();
  select active into ok from public.calendar_feed_status();
  reset role; set local role service_role;
  rep := rep || format(E'\n[%s] revogar desativa o link (status inativo e feed nulo)', case when not ok and public.calendar_feed_events(h2) is null then 'OK' else 'FALHA' end);
  reset role; select count(*) into n from public.audit_log where entity_type = 'calendar_feeds' and actor_user_id = u_phy;
  rep := rep || format(E'\n[%s] criação e revogação do link ficam auditadas, sem o token (%s registros)', case when n >= 3 and not exists (select 1 from public.audit_log where entity_type = 'calendar_feeds' and (new_values::text like '%' || tok1 || '%' or new_values::text like '%' || tok2 || '%')) then 'OK' else 'FALHA' end, n);

  -- feed do paciente: só as próprias consultas, mínimo
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role','authenticated')::text, true);
  tok3 := public.calendar_feed_create('minimal'); reset role;
  set local role service_role; ev := public.calendar_feed_events(encode(sha256(convert_to(tok3, 'UTF8')), 'hex'));
  select count(*) into n from jsonb_array_elements(ev -> 'events') x where x ->> 'summary' = 'Consulta HP';
  rep := rep || format(E'\n[%s] feed do paciente: só as próprias consultas ("Consulta HP", sem nome de profissional): %s evento(s), nenhum de outra paciente', case when n = 3 and ev::text not like '%Fisio%' and ev::text not like '%Outra Paciente%' and not exists (select 1 from jsonb_array_elements(ev -> 'events') x where x ->> 'uid' like '%' || b1::text || '%') then 'OK' else 'FALHA' end, n);
  reset role;

  -- ============ 4) Google: tabelas sem acesso do navegador; status e detalhe só do próprio usuário
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  select connected into ok from public.google_connection_status();
  rep := rep || format(E'\n[%s] sem conexão: status "não conectado"', case when not ok then 'OK' else 'FALHA' end);
  ok := false; begin perform count(*) from public.google_calendar_connections; exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] o navegador NÃO lê as conexões (onde ficam os tokens criptografados)', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform count(*) from public.calendar_event_links; exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] o navegador NÃO lê os vínculos de evento', case when ok then 'OK' else 'FALHA' end);
  reset role; set local role service_role;
  insert into public.google_calendar_connections (user_id, org_id, google_email, refresh_token_enc, scope) values (u_phy, v_org, 'fisio@example.com', 'iv.ciphertext', 'calendar.app.created');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  select connected, google_email into ok, st from public.google_connection_status();
  rep := rep || format(E'\n[%s] com conexão: status conectado com o e-mail da conta (%s), sem expor o token', case when ok and st = 'fisio@example.com' and (select count(*) from jsonb_object_keys(to_jsonb((select g from public.google_connection_status() g limit 1))) k where k like '%token%') = 0 then 'OK' else 'FALHA' end, st);
  perform public.google_connection_set_detail('names');
  reset role; select detail into st from public.google_calendar_connections where user_id = u_phy; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin perform public.google_connection_set_detail('tudo'); exception when others then ok := sqlerrm like '%inválido%'; end;
  rep := rep || format(E'\n[%s] o usuário ajusta o nível de detalhe (%s) e valor inválido é recusado', case when st = 'names' and ok then 'OK' else 'FALHA' end, st);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  select connected into ok from public.google_connection_status();
  rep := rep || format(E'\n[%s] a conexão de um usuário NÃO aparece para outro', case when not ok then 'OK' else 'FALHA' end);

  -- ============ 5) superfície pública
  reset role; set local role anon;
  foreach s in array array['calendar_feed_status','google_connection_status'] loop
    ok := false; begin execute format('select * from public.%I()', s); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || format(E'\n[%s] anon não executa %s', case when ok then 'OK' else 'FALHA' end, s);
  end loop;
  ok := false; begin perform public.my_calendar(v_from, v_to); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa my_calendar', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.calendar_feed_create('minimal'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não cria link de assinatura', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.calendar_feed_events(h2); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não lê o feed pela API', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_S08_CALENDARIOS (transação desfeita):%', rep;
end $$;
