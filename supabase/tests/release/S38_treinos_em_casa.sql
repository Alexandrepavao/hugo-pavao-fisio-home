-- RELEASE v1 — S38: treinos em casa (migration 101): biblioteca, prescrição pelo fisio com vínculo, registro pelo paciente, sequência/adesão derivadas, alertas ao fisio e privacidade.
-- Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.headers', '{}', true); end $$;
do $$
declare
  v_org uuid; ua uuid; rep text := ''; j jsonb; s jsonb; n int; e text; ex1 uuid; ex2 uuid; ex3 uuid; ex_old uuid; pres uuid; pres2 uuid; id1 uuid; id2 uuid; it_a1 uuid; it_a2 uuid; it_b1 uuid;
  u_mgr uuid := gen_random_uuid(); u_ops uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid();
  pe_phy uuid; pe_phy2 uuid; p1 uuid; p2 uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade teste S38', 'teste-s38') returning id into ua;
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@s38.local' from unnest(array[u_mgr,u_ops,u_sales,u_phy,u_phy2,u_p1,u_p2]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S38 Um') returning id into pe_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S38 Dois') returning id into pe_phy2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S38 Um') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S38 Dois') returning id into p2;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor'),(u_ops, v_org, null, 'Adm'),(u_sales, v_org, null, 'Comercial'),(u_phy, v_org, pe_phy, 'Fisio Um'),(u_phy2, v_org, pe_phy2, 'Fisio Dois'),(u_p1, v_org, p1, 'Pac Um'),(u_p2, v_org, p2, 'Pac Dois');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org,u_mgr,'manager',null),(v_org,u_ops,'ops_admin',null),(v_org,u_sales,'sales',ua),(v_org,u_phy,'physio',ua),(v_org,u_phy2,'physio',ua),(v_org,u_p1,'member',null),(v_org,u_p2,'member',null);
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio S38 Um'),(v_org, u_phy2, pe_phy2, 'Fisio S38 Dois');
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id) values (v_org, ua, u_phy, p1),(v_org, ua, u_phy2, p2);

  set local role authenticated;
  -- ============ biblioteca
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err('select public.exercise_save(null, ''Agachamento'')') like '42501%', 'comercial NÃO cria exercício (42501)');
  perform pg_temp.as_user(u_p1); rep := rep || pg_temp.chk(pg_temp.err('select public.exercise_list()') like '42501%', 'paciente não lê a biblioteca (só a prescrição dele)');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select public.exercise_save(null, ''ab'')') like '%nome do exercício%', 'nome curto demais é recusado');
  rep := rep || pg_temp.chk(pg_temp.err('select public.exercise_save(null, ''Agachamento'', null, null, null, null, null, array[''astrologia''])') like '%especialidade inválida%', 'especialidade inválida é recusada');
  ex1 := public.exercise_save(null, 'Agachamento livre S38', 'Pés na largura dos ombros; desça até 90° mantendo a coluna reta.', 'Membros inferiores', 'iniciante', 'Sem equipamento', 'Evitar com dor aguda no joelho', array['ortopedica','geriatrica']);
  ex2 := public.exercise_save(null, 'Ponte glútea S38', 'Deitado, eleve o quadril contraindo o glúteo.', 'Quadril', 'iniciante', 'Colchonete', null, array['ortopedica']);
  ex3 := public.exercise_save(null, 'Prancha S38', 'Sustente o corpo alinhado apoiado nos antebraços.', 'Core', 'intermediario', null, 'Evitar com dor lombar aguda', '{}');
  ex_old := public.exercise_save(null, 'Exercício antigo S38');
  perform public.exercise_archive(ex_old);
  rep := rep || pg_temp.chk(jsonb_array_length(public.exercise_list()) >= 3 and not exists (select 1 from jsonb_array_elements(public.exercise_list()) x where x ->> 'id' = ex_old::text), 'biblioteca lista os ativos e esconde o arquivado');
  perform public.exercise_save(ex2, 'Ponte glútea S38', 'Deitado, eleve o quadril por 2 segundos.', 'Quadril', 'iniciante', 'Colchonete', null, array['ortopedica']);

  -- ============ prescrição
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prescription_save(%L, null, ''Plano S38'', 3, null, null, ''[]'')', p1)) like '%de 1 a 40 exercícios%', 'prescrição sem exercícios é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prescription_save(%L, null, ''Plano S38'', 0, null, null, ''[{"exercise_id":"%s","sets":3,"reps":10}]'')', p1, ex1)) like '%meta semanal%', 'meta semanal 0 é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prescription_save(%L, null, ''Plano S38'', 3, null, null, ''[{"exercise_id":"%s","sets":3}]'')', p1, ex1)) like '23514%', 'exercício sem repetições nem tempo é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prescription_save(%L, null, ''Plano S38'', 3, null, null, ''[{"exercise_id":"%s","sets":3,"reps":10}]'')', p1, ex_old)) like '%inexistente ou arquivado%', 'exercício arquivado não entra na prescrição');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prescription_save(%L, null, ''Plano S38'', 3, null, null, ''[{"exercise_id":"%s","sets":3,"reps":10}]'')', p1, ex1)) like '42501%', 'fisio SEM vínculo não prescreve (42501)');
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.prescription_save(%L, null, ''Plano S38'', 3, null, null, ''[{"exercise_id":"%s","sets":3,"reps":10}]'')', p1, ex1)) like '42501%', 'o paciente não prescreve para si');
  perform pg_temp.as_user(u_phy);
  pres := public.prescription_save(p1, null, 'Reabilitação do joelho S38', 3, null, 'Fazer em dias alternados', jsonb_build_array(
    jsonb_build_object('workout','A','exercise_id',ex1,'sets',3,'reps',12,'load_text','peso do corpo','rest_s',45),
    jsonb_build_object('workout','A','exercise_id',ex2,'sets',3,'reps',15),
    jsonb_build_object('workout','B','exercise_id',ex3,'sets',3,'duration_s',30,'rest_s',30)));
  reset role; select id into it_a1 from public.prescription_items where prescription_id = pres and workout = 'A' order by position limit 1; select id into it_a2 from public.prescription_items where prescription_id = pres and workout = 'A' order by position desc limit 1; select id into it_b1 from public.prescription_items where prescription_id = pres and workout = 'B'; set local role authenticated;

  -- ============ paciente: treino de hoje e registro
  perform pg_temp.as_user(u_p1); j := public.my_training();
  rep := rep || pg_temp.chk(j -> 'summary' -> 'today' ->> 'workout' = 'A' and (j -> 'summary' -> 'today' ->> 'total')::int = 2 and not (j -> 'summary' -> 'today' ->> 'completed')::boolean, 'treino de hoje: A, 2 exercícios, ainda não feito');
  rep := rep || pg_temp.chk(jsonb_array_length(j -> 'prescriptions') = 1 and position('Evitar com dor aguda' in j::text) = 0, 'o paciente vê a prescrição e NÃO as contraindicações (campo do fisio)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_workout_log(%L, ''C'')', pres)) like '%treino inexistente%', 'treino que não existe na prescrição é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_workout_log(%L, ''A'', array[%L]::uuid[])', pres, it_b1)) like '%não pertence a este treino%', 'exercício de outro treino é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_workout_log(%L, ''A'', array[]::uuid[], 5, 11)', pres)) like '%de 0 a 10%', 'dor 11 é recusada');
  id1 := public.my_workout_log(pres, 'A', array[it_a1, it_a2], 6, 2, 'senti o joelho firme', false, 'w1');
  id2 := public.my_workout_log(pres, 'A', array[it_a1, it_a2], 6, 2, 'senti o joelho firme', false, 'w1');
  rep := rep || pg_temp.chk(id1 = id2, 'repetir o envio com a mesma chave não duplica');
  rep := rep || pg_temp.chk(public.my_workout_log(pres, 'A', array[it_a1], 5, 1, null, false, 'w2') = id1, 'o mesmo treino no mesmo dia não vira dois registros');
  j := public.my_training();
  rep := rep || pg_temp.chk((j -> 'summary' -> 'today' ->> 'completed')::boolean and (j -> 'summary' ->> 'streak')::int = 1 and (j -> 'summary' ->> 'week_days')::int = 1 and (j -> 'summary' ->> 'week_pct')::int = 33, 'depois do registro: feito hoje, sequência 1, semana 1 de 3 (33%)');
  -- sequência: ontem e anteontem também treinaram (registros antigos criados como superusuário)
  reset role;
  insert into public.workout_logs (org_id, person_id, prescription_id, workout, done_on, items_done, logged_by) values (v_org, p1, pres, 'B', private.today_sp() - 1, '{}', u_p1),(v_org, p1, pres, 'A', private.today_sp() - 2, '{}', u_p1);
  set local role authenticated; perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk((public.my_training() -> 'summary' ->> 'streak')::int = 3 and (public.my_training() -> 'summary' ->> 'week_pct')::int = 100, 'sequência de 3 dias; semana 3 de 3 = 100% (limitado a 100)');
  rep := rep || pg_temp.chk((public.my_home() -> 'training' ->> 'streak')::int = 3, 'o Início do paciente mostra a sequência');
  perform pg_temp.as_user(u_p2); rep := rep || pg_temp.chk(jsonb_array_length(public.my_training() -> 'prescriptions') = 0 and public.my_training() -> 'summary' = 'null'::jsonb, 'o outro paciente não vê o treino do primeiro');

  -- ============ alertas e indicadores do fisio
  perform pg_temp.as_user(u_p1); perform public.my_workout_log(pres, 'B', array[it_b1], 8, 8, 'doeu forte ao final', false, 'w3');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(public.prof_home() -> 'alerts') a where a ->> 'kind' = 'dor_subindo' and a ->> 'patient' = 'Paciente S38 Um'), 'dor 8/10 durante o treino vira alerta ao fisio do paciente');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(public.prof_home() -> 'alerts') a where a ->> 'patient' = 'Paciente S38 Um'), 'o outro fisio não vê o alerta');
  perform pg_temp.as_user(u_phy2); pres2 := public.prescription_save(p2, null, 'Plano do Dois S38', 4, null, null, jsonb_build_array(jsonb_build_object('workout','A','exercise_id',ex1,'sets',2,'reps',10)));
  reset role; update public.exercise_prescriptions set starts_on = private.today_sp() - 10 where id = pres2; set local role authenticated; perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(public.prof_home() -> 'alerts') a where a ->> 'kind' = 'adesao_baixa' and a ->> 'patient' = 'Paciente S38 Dois'), 'prescrição sem nenhum treino há mais de 7 dias gera alerta de adesão baixa');
  s := public.prof_kpis(private.today_sp() - 6, private.today_sp());
  rep := rep || pg_temp.chk((s ->> 'adherence')::numeric = 0, 'adesão do fisio com prescrição e nenhum treino registrado = 0% (não é nula)');
  perform pg_temp.as_user(u_phy); s := public.prof_kpis(private.today_sp() - 6, private.today_sp());
  rep := rep || pg_temp.chk((s ->> 'adherence')::numeric > 0 and (s ->> 'adherence')::numeric <= 100, 'adesão do outro fisio calculada dos registros (entre 0 e 100)');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err('select public.prof_training(gen_random_uuid())') like '42501%', 'comercial não lê treinos');

  -- ============ leitura do fisio e do admin, com registro
  perform pg_temp.as_user(u_phy); j := public.prof_training(p1);
  rep := rep || pg_temp.chk(position('Evitar com dor aguda' in j::text) > 0 and jsonb_array_length(j -> 'logs') = 4, 'o fisio vê as contraindicações e os 4 registros do paciente');
  perform pg_temp.as_user(u_phy2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_training(%L)', p1)) like '42501%', 'fisio sem vínculo não lê (42501)');
  perform pg_temp.as_user(u_ops); rep := rep || pg_temp.chk(pg_temp.err(format('select public.admin_patient_training(%L)', p1)) like '42501%', 'adm. operacional não lê treino de paciente');
  perform pg_temp.as_user(u_mgr); j := public.admin_patient_training(p1); rep := rep || pg_temp.chk(jsonb_array_length(j -> 'prescriptions') = 1, 'gestor (dono) lê pelo caminho registrado');
  reset role; select count(*) into n from public.clinical_access_log where person_id = p1 and scope = 'training'; rep := rep || pg_temp.chk(n = 2, 'as leituras do fisio e do gestor ficaram registradas'); set local role authenticated;

  -- ============ encerrar a prescrição
  perform pg_temp.as_user(u_phy); perform public.prescription_set_status(pres, 'finished');
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(jsonb_array_length(public.my_training() -> 'prescriptions') = 0 and public.my_training() -> 'summary' = 'null'::jsonb, 'prescrição encerrada some do paciente');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_workout_log(%L, ''A'')', pres)) like '%não está ativa%', 'e não recebe mais registros');
  perform pg_temp.as_user(u_phy2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.prescription_set_status(%L, ''active'')', pres)) like '42501%', 'só o fisio autor reabre');

  -- ============ tabelas fechadas; anônimo
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.exercise_prescriptions') like '42501%' and pg_temp.err('select count(*) from public.workout_logs') like '42501%' and pg_temp.err('select count(*) from public.exercise_library') like '42501%', 'ninguém lê as tabelas direto');
  set local role anon;
  foreach e in array array['my_training()','exercise_list()','my_home()'] loop rep := rep || pg_temp.chk(pg_temp.err('select public.' || e) like '42501%', format('anônimo não executa %s', e)); end loop;
  raise exception 'RELATORIO_S38%', rep;
end $$;
