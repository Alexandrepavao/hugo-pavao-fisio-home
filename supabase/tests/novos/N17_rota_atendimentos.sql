-- NOVO — N17: Rota de atendimentos (migration 130). Transação sempre desfeita. Somente Dev/teste.
--  · locais (unidade/paciente/profissional): só por RPC com permissão; tabelas sem acesso direto; coordenadas validadas (Brasil, CEP sempre aproximado); auditoria sem coordenadas
--  · snapshot do local no atendimento: editar o cadastro depois NÃO muda atendimentos já marcados; remarcar herda formato e local
--  · route_day: só quem pode ver a agenda; dia pelo fuso da unidade; remoto sem ponto
--  · route_apply: desatualizada / confirmado / fixo / passado / outro dia / trocas que se bloqueiam → recusa TUDO; ordem de execução resolve cadeias; registro e auditoria
--  · contador de uso: teto atômico, só service_role; cache sem leitura direta
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true); end $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; svc uuid; pr uuid; p1 uuid; p2 uuid; p3 uuid; pe_phy uuid; pe_phy2 uuid; j jsonb; n int; v_other_org uuid; v_other_person uuid; v_other_unit uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; v_log uuid; v_snap text; v_new uuid;
  u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid();
  d date := date '2027-03-01';   -- segunda
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade N17', 'n17-a') returning id into ua;
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@n17.local' from unnest(array[u_phy, u_phy2, u_sales, u_mgr]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio N17 Um') returning id into pe_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio N17 Dois') returning id into pe_phy2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente N17 Um') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente N17 Dois') returning id into p2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente N17 Tres') returning id into p3;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_phy, v_org, pe_phy, 'Fisio Um'), (u_phy2, v_org, pe_phy2, 'Fisio Dois'), (u_sales, v_org, null, 'Comercial'), (u_mgr, v_org, null, 'Gestor');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_phy, 'physio', ua), (v_org, u_phy2, 'physio', ua), (v_org, u_sales, 'sales', ua), (v_org, u_mgr, 'manager', null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço N17', 30) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio N17 Um') returning id into pr;
  insert into public.professional_units (professional_id, unit_id) values (pr, ua);
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time) select v_org, pr, ua, w, time '00:00', time '23:30' from generate_series(0, 6) w;
  -- outra organização (isolamento)
  insert into public.organizations (name, slug) values ('Org N17 Outra', 'n17-outra') returning id into v_other_org;
  insert into public.units (org_id, name, slug) values (v_other_org, 'Unidade Outra N17', 'n17-b') returning id into v_other_unit;
  insert into public.people (org_id, unit_id, full_name) values (v_other_org, v_other_unit, 'Paciente Outra Org') returning id into v_other_person;
  -- atendimentos do dia (fuso de São Paulo = -03): 09:00 domiciliar p1, 09:30 domiciliar p2, 11:00 remoto p3, 16:00 clínica p1 e um de 22:30 do dia ANTERIOR (01:30Z de 01/03 = 22:30 de 28/02 local)
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, service_mode, visit_lat, visit_lng, visit_precision)
    values (v_org, ua, pr, p1, svc, tstzrange(timestamptz '2027-03-01 09:00-03', timestamptz '2027-03-01 09:30-03'), 'home_visit', -23.50, -46.62, 'exact') returning id into a1;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, service_mode, visit_lat, visit_lng, visit_precision)
    values (v_org, ua, pr, p2, svc, tstzrange(timestamptz '2027-03-01 09:30-03', timestamptz '2027-03-01 10:00-03'), 'home_visit', -23.60, -46.66, 'cep') returning id into a2;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, service_mode)
    values (v_org, ua, pr, p3, svc, tstzrange(timestamptz '2027-03-01 11:00-03', timestamptz '2027-03-01 11:30-03'), 'remote') returning id into a3;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period)
    values (v_org, ua, pr, p3, svc, tstzrange(timestamptz '2027-03-01 01:30+00', timestamptz '2027-03-01 02:00+00')) returning id into a4;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period)
    values (v_org, ua, pr, p1, svc, tstzrange(timestamptz '2027-03-01 16:00-03', timestamptz '2027-03-01 16:30-03')) returning id into a5;
  insert into public.route_places (org_id, owner_kind, owner_id, lat, lng, precision, source) values (v_org, 'unit', ua, -23.5614, -46.6559, 'exact', 'manual_pin');

  -- ---------------- tabelas internas: nenhum acesso direto pela API
  set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.route_places') like '42501%' and pg_temp.err('select count(*) from public.route_leg_cache') like '42501%'
    and pg_temp.err('select count(*) from public.route_usage') like '42501%' and pg_temp.err('select count(*) from public.professional_route_prefs') like '42501%', 'locais, cache, contador e preferências não têm leitura direta (só RPC)');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.route_places (org_id, owner_kind, owner_id, lat, lng, precision, source) values (%L, ''person'', %L, -23.5, -46.6, ''exact'', ''manual_pin'')', v_org, p1)) like '42501%', 'ninguém grava local direto na tabela');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_usage_hit(%L, ''matrix'', 1, 10)', v_org)) like '42501%', 'o contador de uso só é chamado pelo backend (service_role)');

  -- ---------------- locais: permissão e validação
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''person'', %L, -23.55, -46.63, ''exact'', ''manual_pin'', null)', p1)) is null, 'fisio com atendimento do paciente define o local dele');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''person'', %L, -46.63, -23.55, ''exact'', ''manual_pin'', null)', p1)) like '%fora do Brasil%', 'latitude/longitude trocadas são recusadas');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''person'', %L, 40.7, -74.0, ''exact'', ''manual_pin'', null)', p1)) like '%fora do Brasil%', 'ponto fora do Brasil é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''person'', %L, -23.55, -46.63, ''cep'', ''manual_pin'', null)', p1)) like '%CEP é sempre aproximada%', 'precisão "cep" só com fonte "cep_approx"');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''person'', %L, -23.55, -46.63, ''exact'', ''cep_approx'', null)', p1)) like '%CEP é sempre aproximada%', 'fonte "cep_approx" nunca vira precisão exata');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''person'', %L, -23.55, -46.63, ''exact'', ''manual_pin'', %L)', p1, repeat('x', 301))) like '%muito longa%', 'orientação de acesso tem limite (300)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''person'', %L, -23.55, -46.63, ''exact'', ''manual_pin'', null)', v_other_person)) like '42501%', 'paciente de OUTRA organização não é alcançável');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''person'', %L, -23.55, -46.63, ''exact'', ''manual_pin'', null)', p3)) is null, 'fisio com atendimento (mesmo remoto) do paciente 3 pode definir o local');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_get(''person'', %L)', p1)) like '42501%' and pg_temp.err(format('select public.route_place_set(''person'', %L, -23.5, -46.6, ''exact'', ''manual_pin'', null)', p1)) like '42501%', 'fisio SEM relação com o paciente não lê nem grava o local');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''person'', %L, -23.55, -46.63, ''exact'', ''manual_pin'', null)', p1)) is null, 'comercial da unidade registra o local do paciente (cadastro)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''unit'', %L, -23.5, -46.6, ''exact'', ''manual_pin'', null)', ua)) like '42501%', 'comercial NÃO muda o local da unidade (só gestão)');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_place_set(''unit'', %L, -23.5614, -46.6559, ''exact'', ''manual_pin'', ''Sede'')', ua)) is null, 'gestão define o local da unidade');
  rep := rep || pg_temp.chk((public.route_place_get('unit', ua) ->> 'precision') = 'exact', 'leitura devolve precisão');
  reset role;
  rep := rep || pg_temp.chk(not exists (select 1 from public.audit_log where action like 'route.%' and (new_values is not null and new_values::text ~ '-2[0-9]\.[0-9]') and created_at > now() - interval '1 minute'), 'auditoria da rota NÃO registra coordenadas');
  rep := rep || pg_temp.chk(exists (select 1 from public.audit_log where action = 'route.place_set' and changed_columns @> array['lat'] and old_values is null and new_values is null), 'auditoria registra só os NOMES dos campos alterados');

  -- ---------------- snapshot do local no atendimento + formato
  set local role authenticated; perform pg_temp.as_user(u_phy);
  perform public.route_place_set('person', p1, -23.55, -46.63, 'exact', 'manual_pin', null);
  j := public.appointment_set_mode(a5, 'home_visit');
  rep := rep || pg_temp.chk((j ->> 'has_place')::boolean, 'domiciliar copia o local atual do paciente para o atendimento');
  perform public.route_place_set('person', p1, -23.70, -46.70, 'exact', 'manual_pin', null);       -- paciente "mudou de endereço"
  j := public.route_day(pr, d);
  rep := rep || pg_temp.chk((select (x ->> 'lat')::numeric from jsonb_array_elements(j -> 'appointments') x where x ->> 'id' = a5::text) = -23.55, 'editar o cadastro do paciente NÃO muda o local de atendimento já marcado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.appointment_set_mode(%L, ''spa'')', a5)) like '%formato inválido%', 'formato inválido é recusado');
  perform pg_temp.as_user(u_phy2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.appointment_set_mode(%L, ''remote'')', a5)) like '42501%', 'quem não é do atendimento não muda o formato');
  perform pg_temp.as_user(u_phy);
  reset role; update public.appointments set status = 'confirmed' where id = a1; set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.appointment_set_mode(%L, ''remote'')', a1)) like '%ciência explícita%', 'confirmado: mudar o formato exige ciência explícita (nada em silêncio)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.appointment_set_mode(%L, ''in_clinic'', null, true)', a1)) is null, 'com ciência explícita, muda');
  perform public.appointment_set_mode(a1, 'home_visit', null, true);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.appointment_set_mode(%L, ''home_visit'', true)', a1)) is null, 'marcar horário como fixo não depende de ciência (não muda o formato)');
  perform public.appointment_set_mode(a1, 'home_visit', false);
  reset role; update public.appointments set status = 'scheduled', visit_lat = -23.50, visit_lng = -46.62, visit_precision = 'exact', service_mode = 'home_visit' where id = a1; set local role authenticated; perform pg_temp.as_user(u_phy);

  -- ---------------- route_day: permissão, fuso, remoto
  j := public.route_day(pr, d);
  rep := rep || pg_temp.chk((select count(*) from jsonb_array_elements(j -> 'appointments')) = 4, 'o dia de 01/03 tem 4 atendimentos (09:00, 09:30, 11:00 remoto, 16:00)');
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(j -> 'appointments') x where x ->> 'id' = a4::text), 'atendimento de 22:30 do dia ANTERIOR no fuso da unidade (01:30Z) NÃO entra no dia 01/03 (usa o fuso da unidade, não UTC)');
  rep := rep || pg_temp.chk((select x ->> 'lat' from jsonb_array_elements(j -> 'appointments') x where x ->> 'id' = a3::text) is null and (select x ->> 'mode' from jsonb_array_elements(j -> 'appointments') x where x ->> 'id' = a3::text) = 'remote', 'remoto não tem ponto/endereço');
  rep := rep || pg_temp.chk(j -> 'start' ->> 'kind' = 'unit' and (j ->> 'is_self')::boolean and j -> 'prefs' ->> 'profile' = 'driving-car' and (j -> 'prefs' ->> 'buffer_min')::int = 10, 'partida padrão = unidade (sem exigir endereço do profissional); preferências padrão');
  perform pg_temp.as_user(u_phy2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_day(%L, %L)', pr, d)) like '42501%', 'outro fisio não lê a rota de colega');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_day(%L, %L)', pr, d)) like '42501%', 'comercial não lê a rota do fisio');
  perform pg_temp.as_user(u_mgr); rep := rep || pg_temp.chk((public.route_day(pr, d) ->> 'is_self')::boolean = false, 'gestão lê a rota (sem ser a própria agenda)');
  set local role anon; rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_day(%L, %L)', pr, d)) like '42501%', 'anônimo não lê rota'); reset role;
  set local role authenticated; perform pg_temp.as_user(u_phy);
  select count(*) into n from public.appointments where professional_id = pr; v_snap := (select md5(string_agg(id::text || lower(period)::text || status, ',' order by id)) from public.appointments where professional_id = pr);
  perform public.route_day(pr, d); perform public.route_day(pr, d + 1);
  rep := rep || pg_temp.chk(v_snap = (select md5(string_agg(id::text || lower(period)::text || status, ',' order by id)) from public.appointments where professional_id = pr), 'ler/simular a rota NÃO modifica nenhum atendimento');

  -- ---------------- preferências
  perform public.route_prefs_set(pr, 'foot-walking', 20, 'unit');
  rep := rep || pg_temp.chk(public.route_day(pr, d) -> 'prefs' ->> 'profile' = 'foot-walking' and (public.route_day(pr, d) -> 'prefs' ->> 'buffer_min')::int = 20, 'preferências do próprio fisio são gravadas');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_prefs_set(%L, ''driving-car'', 999, ''unit'')', pr)) like '%preferência inválida%', 'folga fora do limite é recusada');
  perform public.route_prefs_set(pr, 'driving-car', 10, 'unit');
  perform pg_temp.as_user(u_phy2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_prefs_set(%L, ''driving-car'', 10, ''unit'')', pr)) like '42501%', 'outro fisio não muda preferências de colega');
  perform pg_temp.as_user(u_phy);

  -- ---------------- route_apply: recusas (tudo ou nada)
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a1, 'expected_start', '2027-03-01 08:00-03', 'new_start', '2027-03-01 12:00-03')))) like '%ROTA_DESATUALIZADA%', 'agenda mudou depois da simulação → recusa (desatualizada)');
  reset role; update public.appointments set status = 'confirmed' where id = a2; set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a2, 'expected_start', '2027-03-01 09:30-03', 'new_start', '2027-03-01 12:00-03')))) like '%ROTA_STATUS%', 'atendimento CONFIRMADO nunca é movido por aqui');
  reset role; update public.appointments set status = 'scheduled' where id = a2; update public.appointments set route_fixed = true where id = a5; set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a5, 'expected_start', '2027-03-01 16:00-03', 'new_start', '2027-03-01 17:00-03')))) like '%ROTA_FIXO%', 'horário FIXO nunca é movido');
  reset role; update public.appointments set route_fixed = false where id = a5; set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a5, 'expected_start', '2027-03-01 16:00-03', 'new_start', '2027-03-02 10:00-03')))) like '%ROTA_DIA%', 'mudança que sai do dia da rota é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a5, 'expected_start', '2027-03-01 16:00-03', 'new_start', '2020-03-01 10:00-03')))) like '%ROTA_%', 'horário no passado é recusado');
  -- conflito: o destino é ocupado por um atendimento que NÃO está na lista → recusa e a agenda fica intacta
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a5, 'expected_start', '2027-03-01 16:00-03', 'new_start', '2027-03-01 09:30-03')))) like '%ROTA_CONFLITO%',
      'destino ocupado por outro atendimento fora da lista é recusado');
  rep := rep || pg_temp.chk((select lower(period) from public.appointments where id = a5) = timestamptz '2027-03-01 16:00-03' and (select lower(period) from public.appointments where id = a2) = timestamptz '2027-03-01 09:30-03', 'recusa por conflito deixa a agenda INTACTA (tudo ou nada)');
  -- bloqueio de horário e disponibilidade (as mesmas regras do book_appointment)
  reset role; insert into public.time_blocks (org_id, professional_id, period) values (v_org, pr, tstzrange(timestamptz '2027-03-01 18:00-03', timestamptz '2027-03-01 19:00-03')); set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a5, 'expected_start', '2027-03-01 16:00-03', 'new_start', '2027-03-01 18:30-03')))) like '%ROTA_BLOQUEIO%', 'horário bloqueado do profissional é recusado');
  reset role; delete from public.time_blocks where professional_id = pr; update public.availability_rules set end_time = time '17:00' where professional_id = pr and weekday = 1; set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a5, 'expected_start', '2027-03-01 16:00-03', 'new_start', '2027-03-01 17:30-03')))) like '%ROTA_DISPONIBILIDADE%', 'fora da disponibilidade do profissional é recusado');
  reset role; update public.availability_rules set end_time = time '23:30' where professional_id = pr and weekday = 1; set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, ''[]''::jsonb)', pr, d)) like '%ROTA_ENTRADA%', 'lista vazia é recusada');
  perform pg_temp.as_user(u_phy2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a5, 'expected_start', '2027-03-01 16:00-03', 'new_start', '2027-03-01 17:00-03')))) like '42501%', 'outro fisio não aplica na agenda de colega');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err(format('select public.route_apply(%L, %L, %L::jsonb)', pr, d, jsonb_build_array(jsonb_build_object('id', a5, 'expected_start', '2027-03-01 16:00-03', 'new_start', '2027-03-01 17:00-03')))) like '42501%', 'comercial não aplica rota');
  perform pg_temp.as_user(u_phy);

  -- ---------------- route_apply: sucesso — TROCA A↔B (ciclo) e cadeia; o MESMO atendimento muda de horário
  j := public.route_apply(pr, d, jsonb_build_array(
      jsonb_build_object('id', a1, 'expected_start', '2027-03-01 09:00-03', 'new_start', '2027-03-01 09:30-03'),
      jsonb_build_object('id', a2, 'expected_start', '2027-03-01 09:30-03', 'new_start', '2027-03-01 09:00-03')));
  rep := rep || pg_temp.chk(jsonb_array_length(j -> 'applied') = 2, 'troca A↔B (cada um ocupa o horário do outro) é aplicada: estacionamento resolve o ciclo');
  rep := rep || pg_temp.chk((select lower(period) from public.appointments where id = a1) = timestamptz '2027-03-01 09:30-03' and (select lower(period) from public.appointments where id = a2) = timestamptz '2027-03-01 09:00-03'
      and (select count(*) from public.appointments where id in (a1, a2) and status = 'scheduled') = 2, 'a troca vale e os dois continuam "agendado" (mesmos atendimentos, mesmos ids)');
  rep := rep || pg_temp.chk((select count(*) from public.appointments where professional_id = pr and lower(period) > timestamptz '2900-01-01') = 0, 'nenhum período "estacionado" sobra');
  rep := rep || pg_temp.chk((select service_mode || visit_lat::text from public.appointments where id = a1) = 'home_visit-23.5' and (select upper(period) - lower(period) from public.appointments where id = a1) = interval '30 minutes', 'formato e local mantidos (mesmo atendimento) e duração preservada (nunca encurta)');
  j := public.route_apply(pr, d, jsonb_build_array(
      jsonb_build_object('id', a1, 'expected_start', '2027-03-01 09:30-03', 'new_start', '2027-03-01 13:00-03'),
      jsonb_build_object('id', a2, 'expected_start', '2027-03-01 09:00-03', 'new_start', '2027-03-01 09:30-03')));
  rep := rep || pg_temp.chk((select lower(period) from public.appointments where id = a1) = timestamptz '2027-03-01 13:00-03' and (select lower(period) from public.appointments where id = a2) = timestamptz '2027-03-01 09:30-03', 'cadeia (um sai do horário que o outro assume) é aplicada');
  reset role; v_log := (j ->> 'log_id')::uuid;
  rep := rep || pg_temp.chk(exists (select 1 from public.route_apply_log where id = v_log and jsonb_array_length(changes) = 2 and changes::text !~ '-23\.'), 'antes/depois registrado SEM nomes nem coordenadas');
  rep := rep || pg_temp.chk((select count(*) from public.route_apply_log where professional_id = pr) = 2, 'cada aplicação gera um registro');
  rep := rep || pg_temp.chk(exists (select 1 from public.audit_log where action = 'route.apply' and entity_id = v_log::text), 'aplicação auditada');
  rep := rep || pg_temp.chk(not exists (select 1 from public.appointments where professional_id = pr and status = 'rescheduled'), 'aplicar NÃO cria atendimentos novos nem "remarcados" (move o próprio atendimento)');

  -- ---------------- remarcação manual (fluxo já existente) também herda
  set local role authenticated; perform pg_temp.as_user(u_phy);
  a6 := public.reschedule_appointment(a1, timestamptz '2027-03-01 15:00-03');
  rep := rep || pg_temp.chk((select service_mode || visit_lat::text from public.appointments where id = a6) = 'home_visit-23.5', 'remarcação manual pela agenda também herda formato e local');
  reset role;

  -- ---------------- contador de uso (service_role): atômico e com teto
  rep := rep || pg_temp.chk(public.route_usage_hit(v_org, 'matrix', 1, 2) and public.route_usage_hit(v_org, 'matrix', 1, 2) and not public.route_usage_hit(v_org, 'matrix', 1, 2), 'contador: 2 chamadas cabem, a 3ª excede o teto e é recusada');
  rep := rep || pg_temp.chk(not public.route_usage_hit(v_org, 'directions', 5, 2), 'pedido maior que o teto é recusado de saída');
  rep := rep || pg_temp.chk((select calls from public.route_usage where org_id = v_org and kind = 'matrix' and day = (now() at time zone 'America/Sao_Paulo')::date) = 2, 'o contador não passa do teto');
  -- ---------------- Google Calendar: nada novo dispara sincronização
  rep := rep || pg_temp.chk(exists (select 1 from pg_trigger where tgname = 'appointments_google_kick' and pg_get_triggerdef(oid) not like '%service_mode%' and pg_get_triggerdef(oid) not like '%visit_%' and pg_get_triggerdef(oid) not like '%route_fixed%'),
    'mudar formato/local/horário-fixo NÃO dispara a sincronização do Google (sem evento duplicado e sem endereço no evento)');
  raise exception 'RELATORIO_N17%', rep;
end $$;
