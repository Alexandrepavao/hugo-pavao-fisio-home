-- RELEASE v1 — S28: Distribuição geográfica do CRM junta variações do nome da cidade e lista os contatos de cada cidade (migration 089). Transação sempre desfeita. Somente Dev/teste.
--  · "Vila Ficticia", "vila  ficticia" e "Vila Ficticia " contam como UMA cidade (mesma regra para "São Paulo", "sao paulo" e "Saopaulo")
--  · crm_geo_contacts: nome, telefone e e-mail dos contatos da cidade/UF; cidade de outro estado não entra; permissões
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.as_anon(n int) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.28.0.' || n)::text, true); end $$;
create or replace function pg_temp.lead(nm text, em text, ph text, city text, uf text) returns uuid language plpgsql as $$
declare res jsonb; lid uuid; begin
  perform pg_temp.as_anon(1); set local role anon;
  res := public.quiz_start('atendimento', nm, em, ph, 'contact-v1', '/', '/avaliacao', null, '{}'::jsonb, null); lid := (res ->> 'id')::uuid;
  perform public.quiz_save_progress(lid, 4, '{}'::jsonb, city, uf);
  reset role; return lid; end $$;
do $$
declare
  v_org uuid; u_mgr uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); g jsonb; c jsonb; rep text := ''; n int; m int;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s28.local'),(u_phy,'authenticated','authenticated','p@s28.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S28'),(u_phy, v_org, null, 'Fisio S28');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_phy, 'physio', (select id from public.units where org_id = v_org order by created_at limit 1));
  -- cidade fictícia (para não misturar com dados do Dev) escrita de três jeitos + uma homônima em outro estado
  perform pg_temp.lead('Ana S28', 'ana.s28@example.com', '(11) 98888-2801', 'Vila Ficticia dos Testes', 'SP');
  perform pg_temp.lead('Beto S28', 'beto.s28@example.com', '(11) 98888-2802', 'vila  ficticia dos testes', 'sp');
  perform pg_temp.lead('Carla S28', 'carla.s28@example.com', '(11) 98888-2803', 'Vila Ficticia dos Testes ', 'SP');
  perform pg_temp.lead('Davi S28', 'davi.s28@example.com', '(21) 98888-2804', 'Vila Ficticia dos Testes', 'RJ');

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  g := public.crm_geo_distribution('patients', null);
  select count(*), (array_agg(x))[1] into n, c from jsonb_array_elements(g -> 'by_city') x where x ->> 'uf' = 'SP' and x ->> 'key' = 'vilaficticiadostestes';
  rep := rep || pg_temp.chk(n = 1 and (c ->> 'count')::int = 3, 'as três grafias em SP viram UMA cidade com 3 contatos');
  rep := rep || pg_temp.chk(c ->> 'city' = 'Vila Ficticia Dos Testes', 'nome mostrado com iniciais maiúsculas (' || coalesce(c ->> 'city', '?') || ')');
  select count(*) into m from jsonb_array_elements(g -> 'by_city') x where x ->> 'uf' = 'RJ' and x ->> 'key' = 'vilaficticiadostestes';
  rep := rep || pg_temp.chk(m = 1, 'a homônima do RJ é outra linha (cidade + UF)');

  select count(*) into n from public.crm_geo_contacts('vilaficticiadostestes', 'SP', 'patients', null);
  rep := rep || pg_temp.chk(n = 3, 'lista da cidade em SP: 3 contatos');
  select count(*) into n from public.crm_geo_contacts('vilaficticiadostestes', 'sp', 'patients', null) where full_name = 'Ana S28' and phone = '(11) 98888-2801' and email = 'ana.s28@example.com';
  rep := rep || pg_temp.chk(n = 1, 'cada contato traz nome, telefone e e-mail (UF em minúsculas também funciona)');
  select count(*) into n from public.crm_geo_contacts('vilaficticiadostestes', 'RJ', 'patients', null);
  rep := rep || pg_temp.chk(n = 1 and exists (select 1 from public.crm_geo_contacts('vilaficticiadostestes', 'RJ', 'patients', null) where full_name = 'Davi S28'), 'a cidade do RJ lista só o Davi');
  select count(*) into n from public.crm_geo_contacts('vilaficticiadostestes', 'SP', 'partners', null);
  rep := rep || pg_temp.chk(n = 0, 'filtro por tipo de lead vale (parceiros: 0 nessa cidade)');
  rep := rep || pg_temp.chk(pg_temp.err('select * from public.crm_geo_contacts('''', ''SP'', null, null)') like '%informe a cidade%', 'cidade em branco é recusada');

  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select * from public.crm_geo_contacts(''vilaficticiadostestes'', ''SP'', null, null)') like '42501%', 'fisioterapeuta NÃO lista os contatos');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select * from public.crm_geo_contacts(''vilaficticiadostestes'', ''SP'', null, null)') is not null, 'anônimo NÃO lista os contatos');
  reset role;

  raise exception E'RELATORIO_S28_GEO_CRM_CIDADES_CONTATOS (transação desfeita):%', rep;
end $$;
