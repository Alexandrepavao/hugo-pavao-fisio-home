-- RELEASE v1 — S35: evolução do paciente (migration 098): medidas por especialidade, registro rápido pós-sessão, linha do tempo por consulta, privacidade e imutabilidade.
-- Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, true); perform set_config('request.headers', '{}', true); end $$;
do $$
declare
  v_org uuid; ua uuid; svc uuid; pr uuid; pr2 uuid; p1 uuid; p2 uuid; pe_phy uuid; pe_phy2 uuid; rep text := ''; j jsonb; s jsonb; n int; id1 uuid; id2 uuid; a1 uuid; a2 uuid; a3 uuid; a_future uuid; a_other uuid; a_p2 uuid;
  u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_ops uuid := gen_random_uuid();
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade teste S35', 'teste-s35') returning id into ua;
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@s35.local' from unnest(array[u_phy,u_phy2,u_p1,u_p2,u_sales,u_mgr,u_ops]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S35 Um') returning id into pe_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S35 Dois') returning id into pe_phy2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S35 Um') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S35 Dois') returning id into p2;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_phy, v_org, pe_phy, 'Fisio Um'),(u_phy2, v_org, pe_phy2, 'Fisio Dois'),(u_p1, v_org, p1, 'Paciente Um'),(u_p2, v_org, p2, 'Paciente Dois'),
    (u_sales, v_org, null, 'Comercial'),(u_mgr, v_org, null, 'Gestor'),(u_ops, v_org, null, 'Adm');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org,u_phy,'physio',ua),(v_org,u_phy2,'physio',ua),(v_org,u_p1,'member',null),(v_org,u_p2,'member',null),(v_org,u_sales,'sales',ua),(v_org,u_mgr,'manager',null),(v_org,u_ops,'ops_admin',null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço S35', 30) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio S35 Um') returning id into pr;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy2, pe_phy2, 'Fisio S35 Dois') returning id into pr2;
  insert into public.professional_units (professional_id, unit_id) values (pr, ua),(pr2, ua);
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id) values (v_org, ua, u_phy, p1);
  insert into public.patient_plans (org_id, unit_id, person_id, planned_sessions, started_on) values (v_org, ua, p1, 6, current_date - 40);
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, ua, pr, p1, svc, tstzrange(now() - interval '30 days', now() - interval '30 days' + interval '30 minutes'), 'attended') returning id into a1;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, ua, pr, p1, svc, tstzrange(now() - interval '20 days', now() - interval '20 days' + interval '30 minutes'), 'attended') returning id into a2;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, ua, pr, p1, svc, tstzrange(now() - interval '10 days', now() - interval '10 days' + interval '30 minutes'), 'attended') returning id into a3;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, ua, pr, p1, svc, tstzrange(now() + interval '5 days', now() + interval '5 days' + interval '30 minutes'), 'scheduled') returning id into a_future;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, ua, pr2, p1, svc, tstzrange(now() - interval '8 days', now() - interval '8 days' + interval '30 minutes'), 'attended') returning id into a_other;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, ua, pr, p2, svc, tstzrange(now() - interval '7 days', now() - interval '7 days' + interval '30 minutes'), 'attended') returning id into a_p2;

  set local role authenticated;
  -- ============ catálogo
  perform pg_temp.as_user(u_p1); s := public.instruments_list();
  rep := rep || pg_temp.chk(jsonb_array_length(s) >= 18 and exists (select 1 from jsonb_array_elements(s) x where x ->> 'key' = 'nprs') and not exists (select 1 from jsonb_array_elements(s) x where x ->> 'source' is null), 'catálogo de medidas disponível, cada uma com fonte/licença descritas');
  set local role anon; rep := rep || pg_temp.chk(pg_temp.err('select public.instruments_list()') like '42501%', 'anônimo não lê o catálogo'); set local role authenticated;

  -- ============ registro rápido: validações
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_session_record(%L, %L, ''x'')', p2, a_p2)) like '42501%', 'sem vínculo com o paciente: recusado (42501)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_session_record(%L, %L, ''x'')', p1, a_other)) like '%entre os seus atendimentos%', 'atendimento de OUTRO profissional não recebe o meu registro');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_session_record(%L, %L, ''x'')', p1, a_future)) like '%perto ou depois%', 'atendimento daqui a 5 dias ainda não recebe registro');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_session_record(%L, %L)', p1, a1)) like '%ao menos um resumo%', 'registro vazio é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_session_record(%L, %L, null, null, null, ''[{"instrument":"nprs","value":11,"phase":"before"}]'')', p1, a1)) like '%fora da faixa%', 'dor 11 é recusada (faixa 0 a 10)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_session_record(%L, %L, null, null, null, ''[{"instrument":"goniometria","side":"D","value":90}]'')', p1, a1)) like '%nome do movimento%', 'goniometria sem o nome do movimento é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_session_record(%L, %L, null, null, null, ''[{"instrument":"goniometria","label":"Flexão do joelho","value":90}]'')', p1, a1)) like '%lado%', 'goniometria sem lado é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_session_record(%L, %L, null, null, null, ''[{"instrument":"nao_existe","value":1}]'')', p1, a1)) like '%inexistente%', 'instrumento inexistente é recusado');
  select count(*) into n from public.patient_measurements where person_id = p1; rep := rep || pg_temp.chk(n = 0, 'registro recusado não grava nada (nem a nota, nem medidas parciais)');

  -- ============ registro rápido válido (3 sessões) + idempotência
  id1 := public.prof_session_record(p1, a1, 'Mobilização e fortalecimento leve', 'Manter exercícios em casa', 'nota clínica restrita S35', '[{"instrument":"nprs","value":8,"phase":"before"},{"instrument":"nprs","value":6,"phase":"after"},{"instrument":"goniometria","label":"Flexão do joelho","side":"D","value":90}]', 'k1');
  id2 := public.prof_session_record(p1, a1, 'Mobilização e fortalecimento leve', 'Manter exercícios em casa', 'nota clínica restrita S35', '[{"instrument":"nprs","value":8,"phase":"before"}]', 'k1');
  rep := rep || pg_temp.chk(id1 = id2, 'repetir o registro com a mesma chave devolve o mesmo (sem duplicar)');
  select count(*) into n from public.patient_measurements where person_id = p1; rep := rep || pg_temp.chk(n = 3, 'medidas gravadas uma vez só (3), mesmo com o clique repetido');
  perform public.prof_session_record(p1, a2, 'Melhora da mobilidade', null, null, '[{"instrument":"nprs","value":6,"phase":"before"},{"instrument":"nprs","value":4,"phase":"after"},{"instrument":"goniometria","label":"Flexão do joelho","side":"D","value":100}]', 'k2');
  perform public.prof_session_record(p1, a3, 'Treino de marcha', 'Reavaliar na próxima', null, '[{"instrument":"nprs","value":4,"phase":"before"},{"instrument":"nprs","value":3,"phase":"after"},{"instrument":"goniometria","label":"Flexão do joelho","side":"D","value":112},{"instrument":"tug","value":14.5}]', 'k3');
  perform public.professional_assessment_add(p1, 'dor', 2, 'avaliação antiga', now() - interval '1 day');
  perform public.patient_plan_specialty_set(p1, 'ortopedica');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.patient_plan_specialty_set(%L, ''astrologia'')', p1)) like '%especialidade inválida%', 'especialidade inexistente é recusada');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.patient_plan_specialty_set(%L, ''ortopedica'')', p1)) like '42501%', 'fisio sem vínculo não define especialidade (42501)');

  -- ============ paciente: medidas próprias
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_measurement_add(''goniometria'', ''Flexão'', 100)') like '%registrada pelo fisioterapeuta%', 'paciente NÃO registra goniometria (é do fisio)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_measurement_add(''psfs'', null, 3)') like '%nome do movimento/atividade%', 'atividade do paciente exige nome');
  id1 := public.my_measurement_add('psfs', 'Subir escada', 3, null, 'p1'); id2 := public.my_measurement_add('psfs', 'Subir escada', 3, null, 'p1');
  reset role; select count(*) into n from public.patient_measurements where person_id = p1 and instrument_key = 'psfs'; set local role authenticated; rep := rep || pg_temp.chk(id1 = id2 and n = 1, 'paciente registra “o que quer voltar a fazer”; o clique repetido não duplica');
  perform public.my_measurement_add('psfs', 'Subir escada', 6); perform public.my_measurement_add('nprs', null, 2);

  -- ============ leitura do paciente
  j := public.my_evolution();
  rep := rep || pg_temp.chk(j ->> 'specialty_label' = 'Fisioterapia Ortopédica', 'a especialidade do plano aparece');
  s := (select x from jsonb_array_elements(j -> 'series') x where x ->> 'instrument' = 'nprs');
  rep := rep || pg_temp.chk((s ->> 'first')::numeric = 8 and (s ->> 'last')::numeric = 2 and (s ->> 'count')::int = 8, 'dor: primeira 8, última 2; 8 pontos (medidas antes/depois + avaliação antiga + autorrelato) na MESMA série');
  s := (select x from jsonb_array_elements(j -> 'series') x where x ->> 'instrument' = 'goniometria' and x ->> 'label' = 'Flexão do joelho' and x ->> 'side' = 'D');
  rep := rep || pg_temp.chk((s ->> 'first')::numeric = 90 and (s ->> 'last')::numeric = 112 and (s ->> 'count')::int = 3 and s ->> 'unit' = 'graus', 'amplitude do joelho D: 90° → 112° (3 medidas), com unidade');
  s := (select x from jsonb_array_elements(j -> 'series') x where x ->> 'instrument' = 'psfs');
  rep := rep || pg_temp.chk(s ->> 'label' = 'Subir escada' and (s ->> 'first')::numeric = 3 and (s ->> 'last')::numeric = 6, 'meta funcional “Subir escada”: 3 → 6');
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(j -> 'series') x where x ->> 'instrument' = 'tug' and (x ->> 'last')::numeric = 14.5), 'TUG de 14,5 s aparece');
  s := (select t from jsonb_array_elements(j -> 'timeline') t where (t ->> 'appointment_id')::uuid = a3);
  rep := rep || pg_temp.chk((s ->> 'session_no')::int = 3 and (s ->> 'pain_before')::numeric = 4 and (s ->> 'pain_after')::numeric = 3 and s ->> 'summary' = 'Treino de marcha' and s ->> 'next_step' = 'Reavaliar na próxima', 'linha do tempo: sessão 3, dor 4 → 3, resumo e próxima conduta');
  rep := rep || pg_temp.chk(position('nota clínica restrita' in j::text) = 0, 'a nota clínica restrita NUNCA chega ao paciente');
  rep := rep || pg_temp.chk((j -> 'plan' ->> 'attended')::int = 4 and (j -> 'plan' ->> 'planned_sessions')::int = 6, 'plano: realizadas / planejadas derivadas dos atendimentos (4 de 6)');
  perform pg_temp.as_user(u_p2); j := public.my_evolution();
  rep := rep || pg_temp.chk(jsonb_array_length(j -> 'series') = 0 and position('Treino de marcha' in j::text) = 0, 'o outro paciente não vê nada do primeiro');

  -- ============ leitura do fisio / admin / acessos
  perform pg_temp.as_user(u_phy); j := public.prof_patient_evolution(p1);
  rep := rep || pg_temp.chk(position('nota clínica restrita S35' in j::text) > 0, 'o fisio vinculado vê a nota clínica restrita');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_patient_evolution(%L)', p1)) like '42501%', 'fisio sem vínculo não lê a evolução (42501)');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_patient_evolution(%L)', p1)) like '42501%' and pg_temp.err(format('select public.admin_patient_evolution(%L)', p1)) like '42501%', 'comercial não lê (nem pelo caminho do admin)');
  perform pg_temp.as_user(u_ops);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.admin_patient_evolution(%L)', p1)) like '42501%', 'adm. operacional não lê dado clínico');
  perform pg_temp.as_user(u_mgr); j := public.admin_patient_evolution(p1);
  rep := rep || pg_temp.chk(position('nota clínica restrita S35' in j::text) > 0, 'gestor (dono) lê pelo caminho registrado');
  reset role; select count(*) into n from public.clinical_access_log where person_id = p1 and scope = 'evolution' and accessed_by_role in ('admin','professional'); rep := rep || pg_temp.chk(n = 2, 'as duas leituras (fisio e admin) ficaram registradas'); set local role authenticated;

  -- ============ imutabilidade
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('update public.patient_measurements set value = 1') like '42501%', 'ninguém altera medidas direto na tabela (corrigir = novo registro)');
  rep := rep || pg_temp.chk(pg_temp.err('delete from public.patient_measurements') like '42501%', 'ninguém apaga medidas');
  rep := rep || pg_temp.chk(pg_temp.err('insert into public.patient_measurements (org_id, unit_id, person_id, instrument_key, value, recorded_by_role) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), ''nprs'', 1, ''professional'')') like '42501%', 'escrita só pelas funções');
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk((select count(*) from public.patient_measurements) = 0, 'o paciente também não lê a tabela direto (só pela função)');
  set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_evolution()') like '42501%', 'anônimo não executa my_evolution');
  raise exception 'RELATORIO_S35%', rep;
end $$;
