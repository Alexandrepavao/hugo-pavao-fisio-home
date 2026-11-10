-- NOVO — N05: zonas de São Paulo capital (migration 118). Transação sempre desfeita. Somente Dev/teste.
--  · is_sp_capital: só São Paulo/SP (qualquer grafia); outras cidades/UF não
--  · quiz: bairro e zona gravados só para SP capital; zona inválida recusada; mudar de cidade limpa; vai para o cadastro da pessoa sem sobrescrever
--  · onboarding: zona obrigatória em SP capital (paciente e fisioterapeuta) e ignorada fora dela; fisioterapeuta guarda as zonas que atende
--  · CRM: distribuição e lista por zona, "sem zona", fisioterapeutas por zona, permissões
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.su_person(i uuid) returns public.people language sql security definer as $$ select * from public.people where id = i $$;
create or replace function pg_temp.su_lead(i uuid) returns public.quiz_leads language sql security definer as $$ select * from public.quiz_leads where id = i $$;
create or replace function pg_temp.as_anon(n int) returns void language plpgsql as $$ begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.5.' || n || '.1')::text, true); perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); end $$;
create or replace function pg_temp.fisio(over jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object(
  'full_name','Fernanda Zona Teste N05','preferred_name','Fe','birth_date','1990-05-10','cpf','529.982.247-25','rg','12.345.678-9','email','fisio.n05@n05.local','phone','(11) 98888-7777',
  'cep','01310-100','street','Avenida Teste','street_number','100','neighborhood','Bela Vista','city','São Paulo','state_uf','SP','council_number','123456-F','council_uf','SP',
  'specialties', jsonb_build_array('Ortopedia'),'work_as','pf','pix_key_type','cpf','pix_key','52998224725') || over $$;
create or replace function pg_temp.pac(over jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object(
  'full_name','Paulo Zona Teste N05','preferred_name','Paulo','birth_date','1950-03-02','cpf','111.444.777-35','email','paciente.n05@n05.local','phone','(11) 97777-6666',
  'cep','01310-100','street','Avenida do Paciente','street_number','50','neighborhood','Bela Vista','city','São Paulo','state_uf','SP','address_reference','portão azul',
  'emergency_name','Marta Souza','emergency_phone','(11) 96666-5555','emergency_relation','Filha','main_complaint','','how_found','indicação') || over $$;
 do $$
declare
  rep text := ''; v_org uuid; ua uuid; u_mgr uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); res jsonb; v_res jsonb; v_id uuid; lead public.quiz_leads; pe public.people; pipe uuid; stg uuid;
  tk text; r jsonb; p1 uuid; p2 uuid; p3 uuid; pq uuid; t text; prof uuid; per uuid; z jsonb;
begin
  -- ---------------- função de reconhecimento
  rep := rep || pg_temp.chk(private.is_sp_capital('São Paulo', 'SP') and private.is_sp_capital('sao paulo', 'sp') and private.is_sp_capital(' SÃO  PAULO ', 'SP') and private.is_sp_capital('Sao Paulo', 'Sp'), 'reconhece São Paulo/SP em qualquer grafia (acento, caixa, espaços)');
  rep := rep || pg_temp.chk(not private.is_sp_capital('São Paulo', 'RJ') and not private.is_sp_capital('Campinas', 'SP') and not private.is_sp_capital('Guarulhos', 'SP') and not private.is_sp_capital(null, 'SP') and not private.is_sp_capital('São Paulo', null), 'não confunde outras cidades, outra UF ou valores vazios');
  rep := rep || pg_temp.chk(private.sp_zone_valid('sul') and private.sp_zone_valid('centro') and not private.sp_zone_valid('sudeste') and not private.sp_zone_valid(''), 'só as 5 zonas válidas (sul, norte, leste, oeste, centro)');

  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N05)', 'n05-a') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n05.local'), (u_phy, 'authenticated', 'authenticated', 'f@n05.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N05'), (u_phy, v_org, null, 'Fisio N05');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_phy, 'physio', ua);

  -- ---------------- quiz (anônimo, como no site)
  set local role anon;
  v_res := public.quiz_start('atendimento', 'Lead Zona N05', 'lead.zona.n05@t.local', '11999990505', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null); v_id := (v_res ->> 'id')::uuid;
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 4, ''{}''::jsonb, ''São Paulo'', ''SP'', ''Pinheiros'', ''sudeste'')', v_id));
  rep := rep || pg_temp.chk(t like '%zona inválida%', 'zona inventada é recusada');
  t := pg_temp.err(format('select public.quiz_save_progress(%L, 4, ''{}''::jsonb, ''São Paulo'', ''SP'', %L, ''oeste'')', v_id, repeat('x', 101)));
  rep := rep || pg_temp.chk(t like '%bairro muito longo%', 'bairro com mais de 100 caracteres é recusado');
  perform public.quiz_save_progress(v_id, 4, '{}'::jsonb, 'São Paulo', 'SP', 'Pinheiros', 'oeste');
  reset role; lead := pg_temp.su_lead(v_id);
  rep := rep || pg_temp.chk(lead.neighborhood = 'Pinheiros' and lead.zone = 'oeste', 'quiz em São Paulo/SP grava bairro e zona');
  pq := lead.person_id; pe := pg_temp.su_person(pq);
  rep := rep || pg_temp.chk(pe.zone = 'oeste' and pe.neighborhood = 'Pinheiros' and pe.city = 'São Paulo', 'bairro e zona do quiz vão para o cadastro da pessoa');
  set local role anon; perform public.quiz_save_progress(v_id, 4, '{}'::jsonb, 'São Paulo', 'SP', 'Moema', 'sul'); reset role; pe := pg_temp.su_person(lead.person_id);
  rep := rep || pg_temp.chk(pe.zone = 'oeste' and pe.neighborhood = 'Pinheiros', 'o cadastro já preenchido NÃO é sobrescrito pelo quiz');
  set local role anon; perform public.quiz_save_progress(v_id, 4, '{}'::jsonb, 'Campinas', 'SP', 'Cambuí', 'sul'); reset role; lead := pg_temp.su_lead(v_id);
  rep := rep || pg_temp.chk(lead.neighborhood is null and lead.zone is null, 'mudar para outra cidade limpa bairro e zona do envio (zona só existe em São Paulo capital)');
  set local role anon; v_res := public.quiz_start('atendimento', 'Lead Fora N05', 'lead.fora.n05@t.local', '11999990506', 'contact-v1', '/', '/avaliacao', '', '{}'::jsonb, null);
  perform public.quiz_save_progress((v_res ->> 'id')::uuid, 4, '{}'::jsonb, 'Santo André', 'SP', 'Centro', 'leste'); reset role;
  lead := pg_temp.su_lead((v_res ->> 'id')::uuid); rep := rep || pg_temp.chk(lead.zone is null and lead.neighborhood is null, 'cidade fora da capital ignora zona enviada por API');
  set local role anon; rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.quiz_leads') like '42501%', 'anônimo continua sem ler a tabela do quiz'); reset role;

  -- ---------------- onboarding (fisioterapeuta e paciente): a zona é exigida só em São Paulo capital
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  r := public.onboarding_link_create('fisio.n05@n05.local', null, ua, 14); tk := r ->> 'token'; reset role;
  set local role anon; perform pg_temp.as_anon(1);
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk, pg_temp.fisio()::text));
  rep := rep || pg_temp.chk(t like '%zona de São Paulo%', 'fisioterapeuta de São Paulo capital sem zona é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk, pg_temp.fisio('{"zone":"sudeste"}')::text));
  rep := rep || pg_temp.chk(t like '%zona de São Paulo%', 'zona inventada no endereço é recusada');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk, pg_temp.fisio('{"zone":"leste","service_zones":["leste","norte","marte"]}')::text));
  rep := rep || pg_temp.chk(t like '%Zona de atendimento inválida%', 'zona de atendimento inventada é recusada');
  perform public.onboarding_submit_physio(tk, pg_temp.fisio('{"zone":"leste","service_zones":["leste","norte","norte"]}'), 'v1'); reset role;
  select * into pe from public.people where id = (select person_id from public.onboarding_submissions order by created_at desc limit 1);
  rep := rep || pg_temp.chk(pe.zone = 'leste' and pe.neighborhood = 'Bela Vista' and pe.city = 'São Paulo', 'fisioterapeuta grava a zona onde mora no cadastro');
  rep := rep || pg_temp.chk((select service_zones from public.professional_profiles where person_id = pe.id) = array['leste', 'norte'], 'fisioterapeuta grava as zonas que atende (sem repetir)');
  set local role anon; perform pg_temp.as_anon(2);
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac()::text));
  rep := rep || pg_temp.chk(t like '%zona de São Paulo%', 'paciente de São Paulo capital sem zona é recusado');
  perform public.onboarding_submit_patient(pg_temp.pac('{"zone":"sul"}'), 'v1'); reset role;
  select * into pe from public.people where document_number = '11144477735' or document_number = '111.444.777-35' order by created_at desc limit 1;
  rep := rep || pg_temp.chk(pe.zone = 'sul', 'paciente grava a zona no cadastro');
  rep := rep || pg_temp.chk(private.onb_address(pg_temp.pac('{"city":"Santo André","zone":"sul"}')) ->> 'zone' is null, 'fora da capital a zona enviada é ignorada (sem exigir)');

  -- ---------------- CRM: contatos com oportunidade
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil N05', 'patients') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Novo', 1, 'open') returning id into stg;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Paciente Sul N05', 'São Paulo', 'SP', 'Santo Amaro', 'sul') returning id into p1;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Paciente Sem Zona N05', 'sao paulo', 'SP', null, null) returning id into p2;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Paciente Campinas N05', 'Campinas', 'SP', null, null) returning id into p3;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) select v_org, ua, x, pipe, stg, 'Opp N05' from unnest(array[p1, p2, p3, pq]) x;
  -- fisioterapeuta ativo que atende zona sul e oeste
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio Zona N05') returning id into per;
  insert into public.professionals (org_id, display_name, person_id, active) values (v_org, 'Fisio Zona N05', per, true) returning id into prof;
  insert into public.professional_profiles (person_id, org_id, professional_id, work_as, service_zones) values (per, v_org, prof, 'pf', array['sul', 'oeste']);
  rep := rep || pg_temp.chk(pg_temp.err('insert into public.professional_profiles (person_id, org_id, professional_id, work_as, service_zones) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), ''pf'', array[''zona-x''])') like '23%', 'zona inválida em "zonas que atende" é recusada pelo banco');

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  res := public.crm_zone_distribution(null, ua);
  rep := rep || pg_temp.chk((res ->> 'total_sp')::int = 3 and (res ->> 'sem_zona')::int = 1, 'conta só contatos de São Paulo capital (3) e separa os sem zona (1); Campinas fica de fora');
  z := (select x from jsonb_array_elements(res -> 'zones') x where x ->> 'zone' = 'sul'); rep := rep || pg_temp.chk((z ->> 'count')::int = 1 and (z ->> 'physios')::int = 1, 'zona sul: 1 contato e 1 fisioterapeuta atende');
  z := (select x from jsonb_array_elements(res -> 'zones') x where x ->> 'zone' = 'oeste'); rep := rep || pg_temp.chk((z ->> 'count')::int = 1 and (z ->> 'physios')::int = 1, 'zona oeste: 1 contato (o lead do quiz) e 1 fisioterapeuta atende');
  z := (select x from jsonb_array_elements(res -> 'zones') x where x ->> 'zone' = 'norte'); rep := rep || pg_temp.chk((z ->> 'count')::int = 0 and (z ->> 'physios')::int = 1, 'zona norte: nenhum contato, mas 1 fisioterapeuta (o do onboarding) atende — aparece mesmo sem contatos');
  rep := rep || pg_temp.chk(jsonb_array_length(res -> 'zones') = 5 and exists (select 1 from jsonb_array_elements(res -> 'neighborhoods') n where n ->> 'neighborhood' = 'Santo Amaro'), 'sempre 5 zonas; bairros mais citados listados');
  rep := rep || pg_temp.chk((select count(*) from public.crm_zone_contacts('sul', null, ua)) = 1 and (select full_name from public.crm_zone_contacts('sul', null, ua)) = 'Paciente Sul N05', 'lista os contatos da zona sul');
  rep := rep || pg_temp.chk((select count(*) from public.crm_zone_contacts('none', null, ua)) = 1, 'lista os de São Paulo capital sem zona');
  rep := rep || pg_temp.chk(pg_temp.err('select * from public.crm_zone_contacts(''nordeste'', null, null)') like '%zona inválida%', 'zona inválida na consulta é recusada');
  perform pg_temp.as_user(u_phy); rep := rep || pg_temp.chk(pg_temp.err('select public.crm_zone_distribution()') like '42501%' and pg_temp.err('select * from public.crm_zone_contacts(''sul'')') like '42501%', 'fisioterapeuta não acessa a distribuição do CRM');
  reset role; set local role anon; rep := rep || pg_temp.chk(pg_temp.err('select public.crm_zone_distribution()') like '42501%', 'anônimo não acessa a distribuição por zona'); reset role;

  raise exception 'RELATORIO_N05%', rep;
end $$;
