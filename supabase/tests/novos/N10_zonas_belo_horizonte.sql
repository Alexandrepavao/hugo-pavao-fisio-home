-- NOVO — N10: Belo Horizonte liberada como capital com regionais (migration 124). Transação sempre desfeita. Somente Dev/teste.
--  · geo_zones traz as 9 regionais oficiais, com ids prefixados (bh-…); a regional tem que ser da própria cidade
--  · quiz e onboarding (paciente) validam a regional pela CIDADE; as outras capitais seguem como estavam (Rio, São Paulo)
--  · CRM: lista de contatos de BH com a regional de cada um
--  · busca: “regional barreiro”, “fisioterapeuta regional norte belo horizonte” (a frase da zona sai dos termos livres); as buscas por zona de SP/Rio continuam iguais
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.su_person(i uuid) returns public.people language sql security definer as $$ select * from public.people where id = i $$;
create or replace function pg_temp.su_lead(i uuid) returns public.quiz_leads language sql security definer as $$ select * from public.quiz_leads where id = i $$;
create or replace function pg_temp.as_anon(n int) returns void language plpgsql as $$ begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.10.' || n || '.1')::text, true); perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); end $$;
create or replace function pg_temp.names(r jsonb) returns text language sql as $$ select coalesce(string_agg(x ->> 'full_name', ' | ' order by x ->> 'full_name'), '') from jsonb_array_elements(r -> 'items') x $$;
create or replace function pg_temp.pac(over jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object(
  'full_name','Paulo BH Teste N10','preferred_name','Paulo','birth_date','1950-03-02','cpf','111.444.777-35','email','paciente.n10@n10.local','phone','(31) 97777-6666',
  'cep','30130-000','street','Avenida do Paciente','street_number','50','neighborhood','Savassi','city','Belo Horizonte','state_uf','MG','address_reference','portão azul',
  'emergency_name','Marta Souza','emergency_phone','(31) 96666-5555','emergency_relation','Filha','main_complaint','','how_found','indicação') || over $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; u_mgr uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); v_res jsonb; v_id uuid; lead public.quiz_leads; pe public.people; pipe uuid; stg uuid;
  t text; r jsonb; p_nor uuid; p_bar uuid; p_sp uuid; p_rj uuid; p_sem uuid; n int; prof uuid; prof2 uuid;
begin
  -- ---------------- tabela de zonas
  rep := rep || pg_temp.chk((select count(*) from public.geo_zones where city_key = 'belohorizonte' and uf = 'MG') = 9 and (select count(*) from public.geo_zones where city_key = 'riodejaneiro') = 4 and (select count(*) from public.geo_zones where city_key = 'saopaulo') = 5,
      'geo_zones traz as 9 regionais de Belo Horizonte, as 4 zonas do Rio e as 5 de São Paulo');
  rep := rep || pg_temp.chk((select string_agg(zone_id, ',' order by position) from public.geo_zones where city_key = 'belohorizonte') = 'bh-barreiro,bh-centrosul,bh-leste,bh-nordeste,bh-noroeste,bh-norte,bh-oeste,bh-pampulha,bh-vendanova', 'ids das regionais: barreiro, centro-sul, leste, nordeste, noroeste, norte, oeste, pampulha, venda nova');
  rep := rep || pg_temp.chk(private.zone_city_ok('Belo Horizonte', 'MG') and private.zone_city_ok(' BELO  horizonte ', 'mg') and not private.zone_city_ok('Contagem', 'MG') and not private.zone_city_ok('Belo Horizonte', 'SP') and not private.zone_city_ok('Belo Horizonte', null),
      'reconhece Belo Horizonte em qualquer grafia; Contagem (não é capital) e UF trocada não valem');
  rep := rep || pg_temp.chk(private.zone_valid_for('Belo Horizonte', 'MG', 'bh-norte') and not private.zone_valid_for('Belo Horizonte', 'MG', 'norte') and not private.zone_valid_for('Belo Horizonte', 'MG', 'rj-norte') and not private.zone_valid_for('São Paulo', 'SP', 'bh-norte') and not private.zone_valid_for('Rio de Janeiro', 'RJ', 'bh-sul'),
      'a regional tem que ser da própria cidade (bh-norte não vale em São Paulo; norte e rj-norte não valem em BH)');

  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N10)', 'n10-a') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n10.local'), (u_phy, 'authenticated', 'authenticated', 'f@n10.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N10'), (u_phy, v_org, null, 'Fisio N10');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_phy, 'physio', ua);

  -- ---------------- quiz em Belo Horizonte
  set local role anon; perform pg_temp.as_anon(1);
  v_res := public.quiz_start('atendimento', 'Lead BH N10', 'lead.bh.n10@t.local', '31999990810', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null); v_id := (v_res ->> 'id')::uuid;
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 4, ''{}''::jsonb, ''Belo Horizonte'', ''MG'', ''Savassi'', ''sul'')', v_id));
  rep := rep || pg_temp.chk(t like '%zona inválida%', 'em BH, a zona de São Paulo (sul) é recusada');
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 4, ''{}''::jsonb, ''Belo Horizonte'', ''MG'', ''Savassi'', ''rj-sul'')', v_id));
  rep := rep || pg_temp.chk(t like '%zona inválida%', 'a zona do Rio também é recusada');
  perform public.quiz_save_progress(v_id, 4, '{}'::jsonb, 'belo horizonte', 'MG', 'Savassi', 'bh-centrosul'); reset role;
  lead := pg_temp.su_lead(v_id); rep := rep || pg_temp.chk(lead.neighborhood = 'Savassi' and lead.zone = 'bh-centrosul', 'quiz em BH grava bairro digitado e regional (Savassi · bh-centrosul), em qualquer grafia da cidade');
  pe := pg_temp.su_person(lead.person_id); rep := rep || pg_temp.chk(pe.zone = 'bh-centrosul' and pe.neighborhood = 'Savassi', 'bairro e regional do quiz vão para o cadastro da pessoa');
  set local role anon; perform pg_temp.as_anon(2); perform public.quiz_save_progress(v_id, 4, '{}'::jsonb, 'Contagem', 'MG', 'Eldorado', 'bh-norte'); reset role; lead := pg_temp.su_lead(v_id);
  rep := rep || pg_temp.chk(lead.zone is null and lead.neighborhood is null, 'Contagem (não é capital) ignora bairro e regional enviados por API');

  -- ---------------- onboarding do paciente
  set local role anon; perform pg_temp.as_anon(3);
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac('{}')::text));
  rep := rep || pg_temp.chk(t like '%Informe a zona da cidade%', 'paciente de BH sem regional é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac('{"zone":"sul"}')::text));
  rep := rep || pg_temp.chk(t like '%Informe a zona da cidade%', 'paciente de BH com zona de outra cidade é recusado');
  perform pg_temp.as_anon(4); perform public.onboarding_submit_patient(pg_temp.pac('{"zone":"bh-pampulha","neighborhood":"Itapoã"}'), 'v1'); reset role;
  select * into pe from public.people where document_number in ('11144477735', '111.444.777-35') order by created_at desc limit 1;
  rep := rep || pg_temp.chk(pe.zone = 'bh-pampulha' and pe.city = 'Belo Horizonte' and pe.neighborhood = 'Itapoã', 'paciente de BH grava a regional (Itapoã · Pampulha) no cadastro');
  rep := rep || pg_temp.chk(pg_temp.err('update public.people set zone = ''bh-marte'' where id = ' || quote_literal(pe.id)) like '23514%', 'check do cadastro recusa regional que não existe em geo_zones');

  -- ---------------- CRM: contatos de BH com a regional de cada um
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil N10', 'patients') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Novo', 1, 'open') returning id into stg;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Fisio Norte BH N10', 'Belo Horizonte', 'MG', 'Jaraguá', 'bh-norte') returning id into p_nor;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Fisio Barreiro BH N10', 'Belo Horizonte', 'MG', 'Barreiro', 'bh-barreiro') returning id into p_bar;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Fisio Sul SP N10', 'São Paulo', 'SP', 'Moema', 'sul') returning id into p_sp;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Fisio Sul RJ N10', 'Rio de Janeiro', 'RJ', 'Copacabana', 'rj-sul') returning id into p_rj;
  insert into public.people (org_id, unit_id, full_name, city, state_uf) values (v_org, ua, 'Paciente BH Sem Regional N10', 'belo horizonte', 'MG') returning id into p_sem;
  insert into public.person_kinds (person_id, kind) values (p_nor, 'staff'), (p_bar, 'staff'), (p_sp, 'partner'), (p_rj, 'partner'), (p_sem, 'patient');
  insert into public.professionals (org_id, display_name, person_id, active) values (v_org, 'Fisio Norte BH N10', p_nor, true) returning id into prof;
  insert into public.professional_profiles (person_id, org_id, professional_id, work_as, service_zones) values (p_nor, v_org, prof, 'pf', array['bh-norte', 'bh-pampulha']);
  insert into public.professionals (org_id, display_name, person_id, active) values (v_org, 'Fisio Barreiro BH N10', p_bar, true) returning id into prof2;
  insert into public.professional_profiles (person_id, org_id, professional_id, work_as, service_zones) values (p_bar, v_org, prof2, 'pf', array['bh-barreiro']);
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) select v_org, ua, x, pipe, stg, 'Opp N10' from unnest(array[p_nor, p_bar, p_sem]) x;
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  select count(*) into n from public.crm_capital_contacts('belohorizonte', 'MG', null, ua);
  rep := rep || pg_temp.chk(n = 3 and (select zone from public.crm_capital_contacts('belohorizonte', 'MG', null, ua) where full_name = 'Fisio Norte BH N10') = 'bh-norte' and (select neighborhood from public.crm_capital_contacts('belohorizonte', 'MG', null, ua) where full_name = 'Fisio Norte BH N10') = 'Jaraguá'
      and (select zone from public.crm_capital_contacts('belohorizonte', 'MG', null, ua) where full_name = 'Paciente BH Sem Regional N10') is null, 'lista de BH: 3 contatos, cada um com a regional e o bairro que cadastrou (e um sem regional, sem inventar)');
  rep := rep || pg_temp.chk((select count(*) from public.crm_capital_contacts('belohorizonte', 'SP', null, ua)) = 0 and (select count(*) from public.crm_capital_contacts('riodejaneiro', 'RJ', null, ua)) = 0, 'a lista é só da cidade pedida (UF trocada não traz nada; o Rio não aparece em BH)');
  perform pg_temp.as_user(u_phy); rep := rep || pg_temp.chk(pg_temp.err('select * from public.crm_capital_contacts(''belohorizonte'', ''MG'')') like '42501%', 'fisioterapeuta não acessa a lista do CRM');

  -- ---------------- busca: regional na mesma frase
  perform pg_temp.as_user(u_mgr);
  r := public.search_people('regional barreiro n10'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Barreiro BH N10' and (r -> 'filters' -> 'zones') = '["Regional Barreiro"]'::jsonb and (r -> 'filters' -> 'terms') = '["n10"]'::jsonb, '“regional barreiro”: quem mora ou atende no Barreiro; a frase da regional não sobra como termo livre');
  r := public.search_people('fisioterapeuta regional norte belo horizonte n10'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Norte BH N10' and (r -> 'filters' -> 'kinds') = '["Fisioterapeutas e parceiros"]'::jsonb, 'fisioterapeuta + regional + cidade (com acento e caixa livres)');
  r := public.search_people('fisioterapeuta REGIONAL pampulha n10'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Norte BH N10', 'a fisioterapeuta do Norte aparece na Pampulha porque diz atender a Pampulha');
  r := public.search_people('fisioterapeuta zona sul n10'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Sul RJ N10 | Fisio Sul SP N10', '“zona sul” continua sendo só São Paulo e Rio (BH não entra)');
  r := public.search_people('fisioterapeuta belo horizonte n10'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Barreiro BH N10 | Fisio Norte BH N10', 'cidade sem regional continua funcionando');
  reset role;
  raise exception 'RELATORIO_N10%', rep;
end $$;
