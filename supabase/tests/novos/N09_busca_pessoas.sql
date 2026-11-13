-- NOVO — N09: busca global de pessoas e leads (migration 123). Transação sempre desfeita. Somente Dev/teste.
--  · entende tipo (fisioterapeuta, paciente, lead…), localização (bairro, cidade, UF, zona) e termos livres (nome, e-mail, telefone), sem acento nem caixa
--  · fisioterapeuta + zona vale para onde mora E para as zonas que atende; “regiões em que atende” entra na busca de cidade
--  · respeita as permissões de quem pesquisa (outra unidade, outra organização, anônimo); nunca lista todo mundo (busca vazia/curta não devolve nada)
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.names(r jsonb) returns text language sql as $$ select coalesce(string_agg(x ->> 'full_name', ' | ' order by x ->> 'full_name'), '') from jsonb_array_elements(r -> 'items') x $$;
do $$
declare
  rep text := ''; v_org uuid; v_org2 uuid; ua uuid; ub uuid; u_mgr uuid := gen_random_uuid(); u_sb uuid := gen_random_uuid(); u_mgr2 uuid := gen_random_uuid(); r jsonb;
  p_cop uuid; p_moe uuid; p_cam uuid; p_pac uuid; p_lead uuid; p_arq uuid; p_mrg uuid; prof uuid; prof2 uuid; prof3 uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N09)', 'n09-a') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (N09)', 'n09-b') returning id into ub;
  insert into public.organizations (name, slug) values ('Outra organização N09', 'n09-outra') returning id into v_org2;
  insert into public.units (org_id, name, slug) values (v_org2, 'Unidade Z (N09)', 'n09-z');
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n09.local'), (u_sb, 'authenticated', 'authenticated', 'sb@n09.local'), (u_mgr2, 'authenticated', 'authenticated', 'm2@n09.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N09'), (u_sb, v_org, null, 'Comercial B N09'), (u_mgr2, v_org2, null, 'Gestor 2 N09');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_sb, 'sales', ub), (v_org2, u_mgr2, 'manager', null);

  -- elenco: 3 fisioterapeutas (Rio/Copacabana, São Paulo/Moema, Campinas atende “Campinas e Valinhos”), 1 paciente em Pinheiros (SP), 1 lead em Campinas, 1 arquivado e 1 mesclado (não aparecem)
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Fisio Copacabana N09', 'Rio de Janeiro', 'RJ', 'Copacabana', 'rj-sul') returning id into p_cop;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Fisio Moema N09', 'São Paulo', 'SP', 'Moema', 'sul') returning id into p_moe;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Fisio Campinas N09', 'Campinas', 'SP', 'Cambuí', null) returning id into p_cam;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Paciente Pinheiros N09', 'São Paulo', 'SP', 'Pinheiros', 'oeste') returning id into p_pac;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, 'Lead Campinas N09', 'Campinas', 'SP', 'Taquaral', null) returning id into p_lead;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone, archived_at) values (v_org, ua, 'Fisio Arquivada Moema N09', 'São Paulo', 'SP', 'Moema', 'sul', now()) returning id into p_arq;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone, merged_into_id) values (v_org, ua, 'Fisio Mesclada Moema N09', 'São Paulo', 'SP', 'Moema', 'sul', p_moe) returning id into p_mrg;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ub, 'Paciente Unidade B N09', 'São Paulo', 'SP', 'Moema', 'sul');
  insert into public.people (org_id, unit_id, full_name, city, state_uf) values (v_org, ua, 'Maria Silva N09', 'São Paulo', 'SP');
  insert into public.person_kinds (person_id, kind) select id, 'patient' from public.people where full_name = 'Paciente Unidade B N09';
  insert into public.person_kinds (person_id, kind) values (p_cop, 'staff'), (p_moe, 'staff'), (p_cam, 'partner'), (p_pac, 'patient'), (p_lead, 'lead');
  insert into public.person_contacts (org_id, person_id, type, value, normalized, is_primary) values
    (v_org, p_cop, 'email', 'copa.fisio@n09.local', 'copa.fisio@n09.local', true), (v_org, p_cop, 'phone', '(21) 97777-1234', '5521977771234', true), (v_org, p_pac, 'phone', '(11) 96666-4321', '5511966664321', true);
  insert into public.professionals (org_id, display_name, person_id, active) values (v_org, 'Fisio Copacabana N09', p_cop, true) returning id into prof;
  insert into public.professionals (org_id, display_name, person_id, active) values (v_org, 'Fisio Moema N09', p_moe, true) returning id into prof2;
  insert into public.professionals (org_id, display_name, person_id, active) values (v_org, 'Fisio Campinas N09', p_cam, true) returning id into prof3;
  insert into public.professional_profiles (person_id, org_id, professional_id, work_as, service_zones) values (p_cop, v_org, prof, 'pf', array['rj-sul', 'rj-oeste']);
  insert into public.professional_profiles (person_id, org_id, professional_id, work_as, service_zones) values (p_moe, v_org, prof2, 'pf', array['sul']);
  insert into public.professional_profiles (person_id, org_id, professional_id, work_as, service_zones, service_regions) values (p_cam, v_org, prof3, 'pf', '{}', 'Campinas e Valinhos');

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  -- ============ tipo + bairro
  r := public.search_people('fisioterapeuta copacabana'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Copacabana N09' and (r -> 'filters' -> 'kinds') = '["Fisioterapeutas e parceiros"]'::jsonb, 'fisioterapeuta + bairro: só a fisioterapeuta de Copacabana, e o filtro entendido é mostrado');
  r := public.search_people('Fisioterapeuta em COPACABANA'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Copacabana N09', 'sem acento nem caixa e ignorando “em”');
  r := public.search_people('fisio moema'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Moema N09', 'abreviação “fisio”; fisioterapeuta arquivada e mesclada não aparecem');
  -- ============ zona (onde mora OU zonas que atende)
  r := public.search_people('fisioterapeuta zona sul'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Copacabana N09 | Fisio Moema N09' and (r -> 'filters' -> 'zones') = '["Zona Sul"]'::jsonb, 'fisioterapeuta + zona sul: Rio e São Paulo (as duas Zonas Sul), sem a de Campinas');
  r := public.search_people('fisioterapeuta zona sul rio de janeiro'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Copacabana N09', 'zona + cidade: só o Rio');
  r := public.search_people('fisioterapeuta zona oeste'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Copacabana N09', 'a fisioterapeuta de Copacabana (zona sul) aparece na zona oeste porque diz atender a zona oeste');
  r := public.search_people('zona oeste n09'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Copacabana N09 | Paciente Pinheiros N09', 'zona sem tipo: quem mora na zona oeste (paciente de Pinheiros) e quem a atende (fisioterapeuta do Rio)');
  r := public.search_people('paciente zona sul n09'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Paciente Unidade B N09', 'paciente + zona sul: só o paciente da zona sul (nenhuma fisioterapeuta)');
  -- ============ cidade, UF, regiões de atendimento
  r := public.search_people('campinas n09'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Campinas N09 | Lead Campinas N09', 'cidade: leads e fisioterapeutas de Campinas');
  r := public.search_people('fisioterapeuta valinhos'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Campinas N09', '“cidades/regiões em que atende” entra na busca (Valinhos)');
  r := public.search_people('lead campinas n09'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Lead Campinas N09', 'lead + cidade');
  r := public.search_people('SAO PAULO fisioterapeuta'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Moema N09', 'cidade com espaço, sem acento, em qualquer ordem');
  r := public.search_people('rj n09'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Copacabana N09', 'UF');
  r := public.search_people('paciente pinheiros n09'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Paciente Pinheiros N09', 'paciente + bairro');
  -- ============ nome, e-mail, telefone
  r := public.search_people('maria silva'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Maria Silva N09', 'nome (várias palavras)');
  r := public.search_people('copa.fisio@n09'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Copacabana N09', 'e-mail');
  r := public.search_people('97777 1234'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Fisio Copacabana N09', 'telefone por trechos de dígitos');
  r := public.search_people('96666'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Paciente Pinheiros N09', 'telefone do paciente');
  r := public.search_people('fisioterapeuta nomequenaoexiste'); rep := rep || pg_temp.chk(jsonb_array_length(r -> 'items') = 0 and (r ->> 'total')::int = 0, 'termo que não combina: nenhum resultado (todas as partes precisam combinar)');
  -- ============ nunca lista todo mundo
  rep := rep || pg_temp.chk(jsonb_array_length(public.search_people('') -> 'items') = 0 and jsonb_array_length(public.search_people('a') -> 'items') = 0 and jsonb_array_length(public.search_people('de em') -> 'items') = 0, 'busca vazia, de 1 letra ou só de palavras vazias não devolve ninguém');
  r := public.search_people('fisioterapeuta n09', 1); rep := rep || pg_temp.chk(jsonb_array_length(r -> 'items') = 1 and (r ->> 'total')::int >= 3, 'limite respeitado e o total real informado');
  -- ============ permissões e isolamento
  perform pg_temp.as_user(u_sb); r := public.search_people('moema n09'); rep := rep || pg_temp.chk(pg_temp.names(r) = 'Paciente Unidade B N09', 'comercial só da unidade B vê só a pessoa da própria unidade');
  perform pg_temp.as_user(u_mgr2); rep := rep || pg_temp.chk(jsonb_array_length(public.search_people('fisioterapeuta') -> 'items') = 0 and jsonb_array_length(public.search_people('campinas n09') -> 'items') = 0, 'outra organização não vê nada');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.search_people(''fisioterapeuta'')') like '42501%', 'anônimo não acessa a busca');
  reset role;
  raise exception 'RELATORIO_N09%', rep;
end $$;
