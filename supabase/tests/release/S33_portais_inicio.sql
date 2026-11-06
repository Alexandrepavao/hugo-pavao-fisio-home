-- RELEASE v1 — S33: Início dos portais (migration 096): my_home (paciente) e prof_home (fisio). Isolamento, números derivados de registros reais, alertas só de pacientes com vínculo.
-- Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; ua uuid; svc uuid; pr uuid; pr2 uuid; p1 uuid; p2 uuid; pe_phy uuid; pe_phy2 uuid; h jsonb; n int; rep text := '';
  u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid();
  d0 timestamptz := date_trunc('hour', now()) + interval '1 hour';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade teste S33', 'teste-s33') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_phy,'authenticated','authenticated','f1@s33.local'),(u_phy2,'authenticated','authenticated','f2@s33.local'),(u_p1,'authenticated','authenticated','p1@s33.local'),
    (u_p2,'authenticated','authenticated','p2@s33.local'),(u_sales,'authenticated','authenticated','s@s33.local');
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S33 Um') returning id into pe_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S33 Dois') returning id into pe_phy2;
  insert into public.people (org_id, unit_id, full_name, preferred_name) values (v_org, ua, 'Paciente S33 Um', 'Pac Um') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente S33 Dois') returning id into p2;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_phy, v_org, pe_phy, 'Fisio Um'),(u_phy2, v_org, pe_phy2, 'Fisio Dois'),(u_p1, v_org, p1, 'Paciente Um'),(u_p2, v_org, p2, 'Paciente Dois'),(u_sales, v_org, null, 'Comercial');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_phy,'physio',ua),(v_org, u_phy2,'physio',ua),(v_org, u_p1,'member',null),(v_org, u_p2,'member',null),(v_org, u_sales,'sales',ua);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço S33', 30) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio S33 Um') returning id into pr;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy2, pe_phy2, 'Fisio S33 Dois') returning id into pr2;
  insert into public.professional_units (professional_id, unit_id) values (pr, ua),(pr2, ua);
  -- vínculo: Fisio Um atende o paciente 1; o paciente 2 NÃO tem vínculo com ninguém
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id) values (v_org, ua, u_phy, p1);
  -- paciente 1: plano de 3 sessões com 3 realizadas (=> alerta "plano acabando"), 1 consulta futura
  insert into public.patient_plans (org_id, unit_id, person_id, planned_sessions, started_on) values (v_org, ua, p1, 3, current_date - 40);
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values
    (v_org, ua, pr, p1, svc, tstzrange(now() - interval '30 days', now() - interval '30 days' + interval '30 minutes'), 'attended'),
    (v_org, ua, pr, p1, svc, tstzrange(now() - interval '20 days', now() - interval '20 days' + interval '30 minutes'), 'attended'),
    (v_org, ua, pr, p1, svc, tstzrange(now() - interval '10 days', now() - interval '10 days' + interval '30 minutes'), 'attended'),
    (v_org, ua, pr, p1, svc, tstzrange(now() + interval '5 days', now() + interval '5 days' + interval '30 minutes'), 'scheduled');
  -- paciente 2 (sem vínculo): também plano acabando e uma falta recente com o Fisio Um — NÃO deve aparecer nos alertas dele
  insert into public.patient_plans (org_id, unit_id, person_id, planned_sessions, started_on) values (v_org, ua, p2, 1, current_date - 40);
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values
    (v_org, ua, pr, p2, svc, tstzrange(now() - interval '25 days', now() - interval '25 days' + interval '30 minutes'), 'attended'),
    (v_org, ua, pr, p2, svc, tstzrange(now() - interval '3 days', now() - interval '3 days' + interval '30 minutes'), 'no_show');

  -- ============ my_home (paciente)
  set local role authenticated;
  perform pg_temp.as_user(u_p1);
  h := public.my_home();
  rep := rep || pg_temp.chk(h -> 'person' ->> 'name' = 'Pac Um', 'my_home devolve o nome de preferência do próprio paciente');
  rep := rep || pg_temp.chk((h -> 'plan' ->> 'attended')::int = 3 and (h -> 'plan' ->> 'planned_sessions')::int = 3, 'plano: 3 de 3 sessões realizadas (derivado dos atendimentos)');
  rep := rep || pg_temp.chk(h -> 'next_appointment' ->> 'service' = 'Serviço S33', 'próxima consulta vem da agenda');
  rep := rep || pg_temp.chk(h -> 'pain' = 'null'::jsonb or h -> 'pain' is null, 'sem avaliação de dor: não inventa número (pain nulo)');
  perform pg_temp.as_user(u_phy);
  perform public.professional_assessment_add(p1, 'dor', 8, 'inicio', now() - interval '20 days');
  perform public.professional_assessment_add(p1, 'dor', 3, 'agora', now() - interval '1 day');
  perform pg_temp.as_user(u_p1);
  h := public.my_home();
  rep := rep || pg_temp.chk((h -> 'pain' ->> 'first')::numeric = 8 and (h -> 'pain' ->> 'last')::numeric = 3 and (h -> 'pain' ->> 'count')::int = 2, 'dor: primeira 8, última 3, 2 registros reais');
  perform pg_temp.as_user(u_p2);
  h := public.my_home();
  rep := rep || pg_temp.chk(h -> 'person' ->> 'name' = 'Paciente S33 Dois' and (h -> 'pain') is not distinct from 'null'::jsonb, 'o paciente 2 vê só o próprio Início (sem a dor do paciente 1)');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(public.my_home() -> 'person' ->> 'name' = 'Fisio S33 Um', 'my_home do fisio devolve só o cadastro dele mesmo (nunca o de um paciente)');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'usuário sem pessoa vinculada não executa my_home (42501)');
  set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'anônimo não executa my_home (42501)');
  set local role authenticated;

  -- ============ prof_home (fisio)
  perform pg_temp.as_user(u_phy);
  h := public.prof_home();
  rep := rep || pg_temp.chk((h ->> 'patients_active')::int = 1, 'carteira: só 1 paciente com vínculo ativo');
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(h -> 'alerts') a where a ->> 'kind' = 'plano_acabando' and a ->> 'patient' = 'Paciente S33 Um'), 'alerta “plano acabando” do paciente com vínculo');
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(h -> 'alerts') a where a ->> 'patient' = 'Paciente S33 Dois'), 'paciente SEM vínculo não aparece nos alertas (nem plano acabando nem falta)');
  rep := rep || pg_temp.chk(h -> 'professional' ->> 'name' = 'Fisio S33 Um', 'identifica o profissional logado');
  rep := rep || pg_temp.chk((h -> 'week' ->> 'attended')::int >= 0 and (h -> 'week' ->> 'scheduled')::int >= 1, 'semana: conta agendadas futuras');
  perform pg_temp.as_user(u_phy2);
  h := public.prof_home();
  rep := rep || pg_temp.chk((h ->> 'patients_active')::int = 0 and jsonb_array_length(h -> 'alerts') = 0 and jsonb_array_length(h -> 'today') = 0, 'outro fisio, sem vínculo e sem atendimentos, vê tudo vazio (nada dos pacientes do colega)');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err('select public.prof_home()') like '42501%', 'comercial não executa prof_home (42501)');
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err('select public.prof_home()') like '42501%', 'paciente não executa prof_home (42501)');
  set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.prof_home()') like '42501%', 'anônimo não executa prof_home (42501)');
  raise exception 'RELATORIO_S33%', rep;
end $$;
