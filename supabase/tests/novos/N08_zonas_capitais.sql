-- NOVO — N08: zonas e bairros nas capitais (migration 122) — Rio de Janeiro liberado, além de São Paulo. Transação sempre desfeita. Somente Dev/teste.
--  · geo_zones: a divisão oficial de cada capital liberada; leitura pública, escrita só pela migration
--  · quiz e onboarding: zona validada pela CIDADE (zona de outra cidade é recusada); cidade que não é capital, ou capital não liberada, ignora zona e bairro
--  · cadastro da pessoa e zonas que o fisioterapeuta atende: aceitam as zonas cadastradas (São Paulo mantém os ids antigos; as demais, prefixo)
--  · CRM: lista de contatos de uma capital com a zona e o bairro de cada um; permissões
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.su_person(i uuid) returns public.people language sql security definer as $$ select * from public.people where id = i $$;
create or replace function pg_temp.su_lead(i uuid) returns public.quiz_leads language sql security definer as $$ select * from public.quiz_leads where id = i $$;
create or replace function pg_temp.as_anon(n int) returns void language plpgsql as $$ begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.5.' || n || '.1')::text, true); perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); end $$;
create or replace function pg_temp.fisio(over jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object(
  'full_name','Fernanda Zona Teste N08','preferred_name','Fe','birth_date','1990-05-10','cpf','529.982.247-25','rg','12.345.678-9','email','fisio.n08@n08.local','phone','(11) 98888-7777',
  'cep','01310-100','street','Avenida Teste','street_number','100','neighborhood','Bela Vista','city','São Paulo','state_uf','SP','council_number','123456-F','council_uf','SP',
  'specialties', jsonb_build_array('Ortopedia'),'work_as','pf','pix_key_type','cpf','pix_key','52998224725') || over $$;
create or replace function pg_temp.pac(over jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object(
  'full_name','Paulo Zona Teste N08','preferred_name','Paulo','birth_date','1950-03-02','cpf','111.444.777-35','email','paciente.n08@n08.local','phone','(11) 97777-6666',
  'cep','01310-100','street','Avenida do Paciente','street_number','50','neighborhood','Bela Vista','city','São Paulo','state_uf','SP','address_reference','portão azul',
  'emergency_name','Marta Souza','emergency_phone','(11) 96666-5555','emergency_relation','Filha','main_complaint','','how_found','indicação') || over $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; u_mgr uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); v_res jsonb; v_id uuid; lead public.quiz_leads; pe public.people; pipe uuid; stg uuid;
  tk text; r jsonb; t text; pr uuid; ps uuid; n int;
begin
  -- ---------------- tabela de zonas e funções de reconhecimento
  rep := rep || pg_temp.chk((select count(*) from public.geo_zones) >= 9 and (select count(*) from public.geo_zones where city_key = 'riodejaneiro' and uf = 'RJ') = 4 and (select count(*) from public.geo_zones where city_key = 'saopaulo' and uf = 'SP') = 5, 'geo_zones traz as 5 zonas de São Paulo e as 4 do Rio de Janeiro (Sul, Norte, Oeste, Centro)');
  rep := rep || pg_temp.chk(private.zone_city_ok('Rio de Janeiro', 'RJ') and private.zone_city_ok(' RIO  de janeiro ', 'rj') and private.zone_city_ok('São Paulo', 'SP')
      and not private.zone_city_ok('Niterói', 'RJ') and not private.zone_city_ok('Rio de Janeiro', 'SP') and not private.zone_city_ok('Salvador', 'BA') and not private.zone_city_ok(null, 'RJ') and not private.zone_city_ok('Rio de Janeiro', null),
      'reconhece só capital liberada (Rio e São Paulo, em qualquer grafia); Niterói, capital ainda não liberada (Salvador) e UF trocada não valem');
  rep := rep || pg_temp.chk(private.zone_valid_for('Rio de Janeiro', 'RJ', 'rj-sul') and not private.zone_valid_for('Rio de Janeiro', 'RJ', 'sul') and not private.zone_valid_for('São Paulo', 'SP', 'rj-sul') and private.zone_valid_for('São Paulo', 'SP', 'sul') and private.zone_valid_any('rj-oeste') and not private.zone_valid_any('rj-marte'),
      'a zona tem que ser da própria cidade (rj-sul não vale em São Paulo; sul não vale no Rio)');
  set local role anon; rep := rep || pg_temp.chk((select count(*) from public.geo_zones) >= 9, 'qualquer pessoa lê a lista de zonas (dado de referência)');
  rep := rep || pg_temp.chk(pg_temp.err('insert into public.geo_zones (city_key, uf, zone_id, label) values (''x'', ''XX'', ''x-sul'', ''X'')') like '42501%', 'ninguém grava zonas pela API (só a migration)'); reset role;

  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N08)', 'n08-a') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n08.local'), (u_phy, 'authenticated', 'authenticated', 'f@n08.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N08'), (u_phy, v_org, null, 'Fisio N08');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_phy, 'physio', ua);

  -- ---------------- quiz no Rio de Janeiro
  set local role anon;
  v_res := public.quiz_start('atendimento', 'Lead Rio N08', 'lead.rio.n08@t.local', '21999990808', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null); v_id := (v_res ->> 'id')::uuid;
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 4, ''{}''::jsonb, ''Rio de Janeiro'', ''RJ'', ''Copacabana'', ''sul'')', v_id));
  rep := rep || pg_temp.chk(t like '%zona inválida%', 'no Rio, a zona de São Paulo (sul) é recusada');
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 4, ''{}''::jsonb, ''Rio de Janeiro'', ''RJ'', ''Copacabana'', ''rj-marte'')', v_id));
  rep := rep || pg_temp.chk(t like '%zona inválida%', 'zona inventada é recusada');
  perform public.quiz_save_progress(v_id, 4, '{}'::jsonb, 'rio de janeiro', 'RJ', 'Copacabana', 'rj-sul'); reset role;
  lead := pg_temp.su_lead(v_id); rep := rep || pg_temp.chk(lead.neighborhood = 'Copacabana' and lead.zone = 'rj-sul', 'quiz no Rio grava bairro e zona (Copacabana · rj-sul), em qualquer grafia da cidade');
  pe := pg_temp.su_person(lead.person_id); rep := rep || pg_temp.chk(pe.zone = 'rj-sul' and pe.neighborhood = 'Copacabana', 'bairro e zona do quiz vão para o cadastro da pessoa');
  set local role anon; perform public.quiz_save_progress(v_id, 4, '{}'::jsonb, 'Niterói', 'RJ', 'Icaraí', 'rj-sul'); reset role; lead := pg_temp.su_lead(v_id);
  rep := rep || pg_temp.chk(lead.zone is null and lead.neighborhood is null, 'Niterói (não é capital) ignora bairro e zona enviados por API');
  set local role anon; v_res := public.quiz_start('atendimento', 'Lead Salvador N08', 'lead.ssa.n08@t.local', '71999990808', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null);
  perform public.quiz_save_progress((v_res ->> 'id')::uuid, 4, '{}'::jsonb, 'Salvador', 'BA', 'Barra', 'rj-sul'); reset role;
  lead := pg_temp.su_lead((v_res ->> 'id')::uuid); rep := rep || pg_temp.chk(lead.zone is null and lead.neighborhood is null, 'capital ainda não liberada (Salvador) continua só com a cidade');

  -- ---------------- onboarding
  set local role anon; perform pg_temp.as_anon(1);
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac('{"city":"Rio de Janeiro","state_uf":"RJ","neighborhood":"Tijuca","cpf":"111.444.777-35","email":"pac.rio.n08@n08.local"}')::text));
  rep := rep || pg_temp.chk(t like '%Informe a zona da cidade%', 'paciente do Rio sem zona é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac('{"city":"Rio de Janeiro","state_uf":"RJ","neighborhood":"Tijuca","zone":"sul","cpf":"111.444.777-35","email":"pac.rio.n08@n08.local"}')::text));
  rep := rep || pg_temp.chk(t like '%Informe a zona da cidade%', 'paciente do Rio com zona de outra cidade é recusado');
  perform pg_temp.as_anon(2); perform public.onboarding_submit_patient(pg_temp.pac('{"city":"Rio de Janeiro","state_uf":"RJ","neighborhood":"Tijuca","zone":"rj-norte","cpf":"111.444.777-35","email":"pac.rio.n08@n08.local"}'), 'v1'); reset role;
  select * into pe from public.people where document_number in ('11144477735', '111.444.777-35') order by created_at desc limit 1;
  rep := rep || pg_temp.chk(pe.zone = 'rj-norte' and pe.city = 'Rio de Janeiro' and pe.neighborhood = 'Tijuca', 'paciente do Rio grava a zona (Tijuca · Zona Norte) no cadastro');
  rep := rep || pg_temp.chk(private.onb_address(pg_temp.pac('{"city":"Niterói","state_uf":"RJ","zone":"rj-sul"}')) ->> 'zone' is null and private.onb_address(pg_temp.pac('{"city":"Santo André","zone":"sul"}')) ->> 'zone' is null, 'fora das capitais liberadas a zona enviada é ignorada (sem exigir)');
  set local role authenticated; perform pg_temp.as_user(u_mgr); r := public.onboarding_link_create('fisio.n08@n08.local', null, ua, 14); tk := r ->> 'token'; reset role;
  set local role anon; perform pg_temp.as_anon(3);
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk, pg_temp.fisio('{"city":"Rio de Janeiro","state_uf":"RJ","zone":"rj-oeste","email":"fisio.n08@n08.local","service_zones":["rj-sul","rj-marte"]}')::text));
  rep := rep || pg_temp.chk(t like '%Zona de atendimento inválida%', 'zona de atendimento inventada é recusada');
  perform public.onboarding_submit_physio(tk, pg_temp.fisio('{"city":"Rio de Janeiro","state_uf":"RJ","zone":"rj-oeste","email":"fisio.n08@n08.local","service_zones":["rj-oeste","rj-sul","rj-oeste","sul"]}'), 'v1'); reset role;
  select p.* into pe from public.people p join public.person_contacts c on c.person_id = p.id and c.type = 'email' where lower(c.value) = 'fisio.n08@n08.local' limit 1;   -- (os envios da transação têm o mesmo created_at)
  rep := rep || pg_temp.chk(pe.zone = 'rj-oeste' and pe.city = 'Rio de Janeiro', 'fisioterapeuta do Rio grava a zona onde mora');
  rep := rep || pg_temp.chk((select service_zones from public.professional_profiles where person_id = pe.id) = array['rj-oeste', 'rj-sul', 'sul'], 'fisioterapeuta guarda as zonas que atende, de qualquer capital liberada, sem repetir');

  -- ---------------- o banco também barra valor inválido gravado direto
  rep := rep || pg_temp.chk(pg_temp.err('update public.people set zone = ''rj-marte'' where id = ' || quote_literal(pe.id)) like '23514%', 'check do cadastro recusa zona que não existe em geo_zones');
  rep := rep || pg_temp.chk(pg_temp.err('update public.professional_profiles set service_zones = array[''rj-sul'', ''marte''] where person_id = ' || quote_literal(pe.id)) like '23514%', 'check das zonas de atendimento recusa zona que não existe');

  -- ---------------- CRM: contatos de uma capital, com a zona e o bairro de cada um
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil N08', 'patients') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Novo', 1, 'open') returning id into stg;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Paciente Rio Sul N08', 'Rio de Janeiro', 'RJ', 'Ipanema', 'rj-sul') returning id into pr;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Paciente Rio Sem Zona N08', 'rio de janeiro', 'RJ', null, null) returning id into ps;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) select v_org, ua, x, pipe, stg, 'Opp N08' from unnest(array[pr, ps, pe.id]) x;
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  select count(*) into n from public.crm_capital_contacts('riodejaneiro', 'RJ', null, ua);
  rep := rep || pg_temp.chk(n = 3 and (select zone from public.crm_capital_contacts('riodejaneiro', 'RJ', null, ua) where full_name = 'Paciente Rio Sul N08') = 'rj-sul' and (select neighborhood from public.crm_capital_contacts('riodejaneiro', 'RJ', null, ua) where full_name = 'Paciente Rio Sul N08') = 'Ipanema'
      and (select zone from public.crm_capital_contacts('riodejaneiro', 'RJ', null, ua) where full_name = 'Paciente Rio Sem Zona N08') is null, 'lista do Rio: 3 contatos, cada um com a zona e o bairro que cadastrou (e um sem zona, sem inventar)');
  rep := rep || pg_temp.chk((select count(*) from public.crm_capital_contacts('saopaulo', 'SP', null, ua)) = 0 and (select count(*) from public.crm_capital_contacts('riodejaneiro', 'SP', null, ua)) = 0, 'a lista é só da cidade pedida (São Paulo não traz o Rio; UF trocada não traz nada)');
  rep := rep || pg_temp.chk(pg_temp.err('select * from public.crm_capital_contacts('''', ''RJ'')') like '%informe a cidade%', 'cidade em branco é recusada');
  perform pg_temp.as_user(u_phy); rep := rep || pg_temp.chk(pg_temp.err('select * from public.crm_capital_contacts(''riodejaneiro'', ''RJ'')') like '42501%', 'fisioterapeuta não acessa a lista do CRM');
  reset role; set local role anon; rep := rep || pg_temp.chk(pg_temp.err('select * from public.crm_capital_contacts(''riodejaneiro'', ''RJ'')') like '42501%', 'anônimo não acessa a lista do CRM'); reset role;
  raise exception 'RELATORIO_N08%', rep;
end $$;
