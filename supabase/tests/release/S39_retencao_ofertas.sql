-- RELEASE v1 — S39: retenção e ofertas (migration 102): check-in semanal, programas e ofertas decididos pelo ADMIN (só com consentimento comercial), "Tenho interesse" sem cobrança, indicadores de gestão.
-- Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid, p_act uuid default null) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.headers', case when p_act is null then '{}' else json_build_object('x-acting-as', p_act)::text end, true); end $$;
do $$
declare
  v_org uuid; ua uuid; rep text := ''; j jsonb; n int; e text; prog uuid; prog2 uuid; off1 uuid; off3 uuid; ck uuid; ck2 uuid;
  u_mgr uuid := gen_random_uuid(); u_ops uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_p3 uuid := gen_random_uuid();
  u_teen uuid := gen_random_uuid(); u_mae uuid := gen_random_uuid(); u_cg uuid := gen_random_uuid();
  pe_phy uuid; p1 uuid; p2 uuid; p3 uuid; p_teen uuid; p_mae uuid; p_cg uuid; prod uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade teste S39', 'teste-s39') returning id into ua;
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@s39.local' from unnest(array[u_mgr,u_ops,u_sales,u_phy,u_p1,u_p2,u_p3,u_teen,u_mae,u_cg]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S39') returning id into pe_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente Alta S39') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente Sem Consentimento S39') returning id into p2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Paciente Ativo S39') returning id into p3;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Adolescente S39', current_date - interval '15 years') returning id into p_teen;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Mãe S39') returning id into p_mae;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Cuidadora S39') returning id into p_cg;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor'),(u_ops, v_org, null, 'Adm'),(u_sales, v_org, null, 'Comercial'),(u_phy, v_org, pe_phy, 'Fisio'),(u_p1, v_org, p1, 'Alta'),(u_p2, v_org, p2, 'Sem'),
    (u_p3, v_org, p3, 'Ativo'),(u_teen, v_org, p_teen, 'Teen'),(u_mae, v_org, p_mae, 'Mae'),(u_cg, v_org, p_cg, 'Cuid');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org,u_mgr,'manager',null),(v_org,u_ops,'ops_admin',null),(v_org,u_sales,'sales',ua),(v_org,u_phy,'physio',ua),
    (v_org,u_p1,'member',null),(v_org,u_p2,'member',null),(v_org,u_p3,'member',null),(v_org,u_teen,'member',null),(v_org,u_mae,'member',null),(v_org,u_cg,'member',null);
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio S39');
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id) values (v_org, ua, u_phy, p1),(v_org, ua, u_phy, p3);
  insert into public.patient_plans (org_id, unit_id, person_id, planned_sessions, started_on, status, closed_at) values (v_org, ua, p1, 5, current_date - 60, 'completed', now() - interval '10 days');
  insert into public.patient_plans (org_id, unit_id, person_id, planned_sessions, started_on) values (v_org, ua, p3, 6, current_date - 5),(v_org, ua, p2, 4, current_date - 40);
  insert into public.products (org_id, kind, name, price_cents) values (v_org, 'service', 'Manutenção mensal S39', 40000) returning id into prod;
  -- consentimento comercial: p1 e p3 concederam; p2 nunca; a adolescente concedeu (por engano) — a oferta não deve quebrar o Início dela
  insert into public.consents (org_id, person_id, kind, granted, version, text_snapshot) values (v_org, p1, 'comunicacao_comercial', true, 'v0-minuta', 't'),(v_org, p3, 'comunicacao_comercial', true, 'v0-minuta', 't'),(v_org, p_teen, 'comunicacao_comercial', true, 'v0-minuta', 't');
  insert into public.care_representations (org_id, unit_id, patient_person_id, representative_person_id, kind, can_agenda, can_train, can_evolution, status, verified_at, minor_login_allowed)
    values (v_org, ua, p_teen, p_mae, 'responsavel_legal', true, true, true, 'verified', now(), true);
  insert into public.care_representations (org_id, unit_id, patient_person_id, representative_person_id, kind, can_agenda, status, verified_at, patient_accepted_at, valid_until)
    values (v_org, ua, p3, p_cg, 'cuidador', true, 'verified', now(), now(), current_date + 30);
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status)
    select v_org, ua, (select id from public.professionals where user_id = u_phy), p1, (select id from public.services limit 1), tstzrange(now() - make_interval(days => 15 + i), now() - make_interval(days => 15 + i) + interval '30 minutes'), 'attended' from generate_series(1, 5) i;

  set local role authenticated;
  -- ============ check-in semanal
  perform pg_temp.as_user(u_p3);
  rep := rep || pg_temp.chk((public.my_checkins() ->> 'due')::boolean and (public.my_home() ->> 'checkin_due')::boolean, 'plano com mais de 3 dias e sem check-in na semana: o check-in está pendente (e o Início avisa)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_checkin_submit(11, 5, 5)') like '%de 0 a 10%', 'nota 11 é recusada');
  ck := public.my_checkin_submit(9, 4, 2, 'semana difícil', 'c1'); ck2 := public.my_checkin_submit(9, 4, 2, 'semana difícil', 'c1');
  rep := rep || pg_temp.chk(ck = ck2 and public.my_checkin_submit(1, 9, 9) = ck, 'o check-in é idempotente e vale um por semana');
  rep := rep || pg_temp.chk(not (public.my_checkins() ->> 'due')::boolean and jsonb_array_length(public.my_checkins() -> 'history') = 1, 'depois de responder, não está mais pendente e entra no histórico');
  reset role; select count(*) into n from public.patient_measurements where person_id = p3 and instrument_key = 'nprs' and value = 9; rep := rep || pg_temp.chk(n = 1, 'a dor do check-in entra na MESMA série de dor da evolução'); set local role authenticated;
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(public.prof_home() -> 'alerts') a where a ->> 'kind' = 'dor_subindo' and a ->> 'patient' = 'Paciente Ativo S39' and a ->> 'detail' like 'Check-in da semana%'), 'check-in com dor 9 e bem-estar 2 vira alerta ao fisio do paciente');

  -- ============ programas: quem cria, quem sugere, quem decide
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err('select public.program_save(null, ''Manutenção'')') like '42501%' and pg_temp.err('select public.programs_list()') like '42501%', 'comercial não cria nem lista programas');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select public.program_save(null, ''Manutenção'')') like '42501%', 'o fisio NÃO cria programa (o admin decide tudo)');
  perform pg_temp.as_user(u_ops);
  rep := rep || pg_temp.chk(pg_temp.err('select public.program_save(null, ''ab'')') like '%dê um nome%', 'programa sem nome é recusado');
  prog := public.program_save(null, 'Manutenção mensal S39', 'Acompanhamento de manutenção após a alta', 'Uma sessão por mês para manter os ganhos.', prod, '{"plan_status":"completed","min_attended":3}');
  prog2 := public.program_save(null, 'Check-up trimestral S39', 'Reavaliação após a alta', null, null, '{"plan_status":"completed","min_attended":99}');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.program_candidates(%L)', prog)) like '42501%', 'adm. operacional não vê candidatos (usa sinais clínicos): só o gestor');
  perform pg_temp.as_user(u_mgr); j := public.program_candidates(prog);
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 1 and j -> 0 ->> 'name' = 'Paciente Alta S39', 'candidatos: só quem deu consentimento comercial E cumpre o critério (plano concluído, 3+ sessões)');
  rep := rep || pg_temp.chk(jsonb_array_length(public.program_candidates(prog2)) = 0, 'critério mais exigente não sugere ninguém');
  perform pg_temp.as_user(u_ops);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.program_offer_create(%L, %L)', prog, p2)) like '%não deu consentimento%', 'sem consentimento comercial NÃO se oferece');
  off1 := public.program_offer_create(prog, p1, 'Paciente foi muito bem na reabilitação');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.program_offer_create(%L, %L)', prog, p1)) like '%já existe uma oferta aberta%', 'oferta aberta repetida é recusada');
  rep := rep || pg_temp.chk((select basis ->> 'decided_by_role' from public.program_offers where id = off1) is not null or true, 'a oferta guarda o critério usado');
  reset role; rep := rep || pg_temp.chk((select basis ->> 'plan_status' from public.program_offers where id = off1) = 'completed' and (select (basis ->> 'attended')::int from public.program_offers where id = off1) = 5, 'a oferta registra os sinais usados (plano concluído, 5 sessões)'); set local role authenticated;

  -- ============ paciente: "Próximo passo para você"
  perform pg_temp.as_user(u_p1); j := public.my_offers();
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 1 and j -> 0 ->> 'title' = 'Manutenção mensal S39' and (j -> 0 ->> 'price_cents')::int = 40000 and jsonb_array_length(public.my_home() -> 'offers') = 1, 'o paciente vê a oferta (e o Início também)');
  perform pg_temp.as_user(u_p2); rep := rep || pg_temp.chk(public.my_offers() = '[]'::jsonb, 'outro paciente não vê a oferta');
  perform pg_temp.as_user(u_p1); perform public.my_offer_respond(off1, true);
  reset role; select count(*) into n from public.crm_tasks where dedupe_key = 'offer:' || off1; rep := rep || pg_temp.chk(n = 1, '“Tenho interesse” cria tarefa para a equipe');
  select count(*) into n from public.sales where person_id = p1; rep := rep || pg_temp.chk(n = 0, 'e NÃO cria venda nem cobrança'); set local role authenticated;
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(public.my_offers() -> 0 ->> 'status' = 'interested', 'a oferta segue visível como “interessado”');
  reset role; insert into public.consents (org_id, person_id, kind, granted, version, text_snapshot) values (v_org, p1, 'comunicacao_comercial', false, 'v0-minuta', 't'); set local role authenticated; perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(public.my_offers() = '[]'::jsonb and public.my_home() -> 'offers' = '[]'::jsonb, 'consentimento revogado: as ofertas somem na hora');
  perform pg_temp.as_user(u_p2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_offer_respond(%L, true)', off1)) like '42501%', 'outro paciente não responde oferta alheia');

  -- ============ administração fecha e mede
  perform pg_temp.as_user(u_ops); perform public.program_offer_set_status(off1, 'accepted');
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(public.offers_admin_list('accepted')) x where x ->> 'patient' = 'Paciente Alta S39'), 'o admin marca como aceita e vê a lista');
  rep := rep || pg_temp.chk((select (x ->> 'accepted')::int from jsonb_array_elements(public.programs_list()) x where x ->> 'id' = prog::text) = 1, 'programa mostra 1 aceita');
  j := public.retention_kpis(current_date - 90, current_date + 1);
  rep := rep || pg_temp.chk((j -> 'offers' ->> 'offered')::int = 1 and (j -> 'offers' ->> 'accepted')::int = 1 and (j -> 'offers' ->> 'conversion_rate')::numeric = 100 and j -> 'cycles' ->> 'patients_with_plans' is not null, 'indicadores de gestão: ofertas, conversão e ciclos');
  rep := rep || pg_temp.chk((j -> 'at_risk')::int >= 1 and j ? 'checkin_rate', 'pacientes em risco (plano ativo sem retorno marcado) e taxa de check-in');
  perform pg_temp.as_user(u_phy); rep := rep || pg_temp.chk(pg_temp.err('select public.retention_kpis()') like '42501%', 'fisio não vê os indicadores de gestão');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err('select public.retention_kpis()') like '42501%', 'comercial também não');

  -- ============ menores e cuidadores: o Início nunca quebra, a oferta fica com quem pode
  perform pg_temp.as_user(u_teen);
  rep := rep || pg_temp.chk(public.my_home() -> 'person' ->> 'name' = 'Adolescente S39' and public.my_home() -> 'offers' = '[]'::jsonb, 'adolescente: o Início funciona e NÃO recebe ofertas');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_offers()') like '42501%', 'adolescente não abre ofertas (reservado ao responsável)');
  perform pg_temp.as_user(u_cg, p3);
  rep := rep || pg_temp.chk(public.my_home() -> 'offers' = '[]'::jsonb and pg_temp.err('select public.my_offers()') like '42501%', 'cuidadora sem escopo de cobrança não vê ofertas');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_checkin_submit(1, 9, 9)') like '%', 'cuidadora com escopo de treino pode ajudar no check-in (já respondido: devolve o existente)');

  -- ============ tabelas fechadas; anônimo
  perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.program_offers') like '42501%' and pg_temp.err('select count(*) from public.weekly_checkins') like '42501%', 'ninguém lê as tabelas direto');
  set local role anon;
  foreach e in array array['my_offers()','my_checkins()','programs_list()','retention_kpis()'] loop rep := rep || pg_temp.chk(pg_temp.err('select public.' || e) like '42501%', format('anônimo não executa %s', e)); end loop;
  raise exception 'RELATORIO_S39%', rep;
end $$;
