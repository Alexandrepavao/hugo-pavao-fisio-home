-- NOVO — N14: "Ver como" (migration 128). Transação sempre desfeita. Somente Dev/teste.
--  · só o gestor abre sessão; só se vê como fisioterapeuta (sem papel de gestão) ou paciente (sem papel de equipe); lista só quem tem acesso ao app
--  · hp_pre_request: sem cabeçalho não faz nada; com cabeçalho válido troca auth.uid() para a pessoa vista e liga o modo SOMENTE LEITURA; cabeçalho de outra pessoa, expirado, encerrado, inventado
--    ou de quem deixou de ser gestor é recusado (42501), nunca “cai” na identidade do gestor
--  · as funções do app respondem como ao fisioterapeuta visto (prof_home) e QUALQUER gravação falha no servidor (a parte do paciente está no N15)
--  · registro: sessão gravada; encerrar só sem o cabeçalho
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true); end $$;
create or replace function pg_temp.hdr(h text) returns void language plpgsql as $$ begin perform set_config('request.headers', json_build_object('x-view-as', h)::text, true); end $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; u_mgr uuid := gen_random_uuid(); u_mgr2 uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_pat uuid := gen_random_uuid(); u_ops uuid := gen_random_uuid(); u_sales_phy uuid := gen_random_uuid(); u_none uuid := gen_random_uuid();
  p_phy uuid; p_pat uuid; pf uuid; s_phy jsonb; s_pat jsonb; s_id uuid; t text; r jsonb; n int;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N14)', 'n14-a') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n14.local'), (u_mgr2, 'authenticated', 'authenticated', 'm2@n14.local'), (u_phy, 'authenticated', 'authenticated', 'f@n14.local'), (u_phy2, 'authenticated', 'authenticated', 'f2@n14.local'),
    (u_pat, 'authenticated', 'authenticated', 'p@n14.local'), (u_ops, 'authenticated', 'authenticated', 'o@n14.local'), (u_sales_phy, 'authenticated', 'authenticated', 'sf@n14.local'), (u_none, 'authenticated', 'authenticated', 'n@n14.local');
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio Vista N14') returning id into p_phy;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Paciente Visto N14', '1980-05-05') returning id into p_pat;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N14'), (u_mgr2, v_org, null, 'Gestor 2 N14'), (u_phy, v_org, p_phy, 'Fisio Vista N14'), (u_phy2, v_org, null, 'Fisio Dois N14'),
    (u_pat, v_org, p_pat, 'Paciente Visto N14'), (u_ops, v_org, null, 'Adm N14'), (u_sales_phy, v_org, null, 'Fisio Comercial N14');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_mgr2, 'manager', null), (v_org, u_phy, 'physio', ua), (v_org, u_phy2, 'physio', ua),
    (v_org, u_pat, 'member', null), (v_org, u_ops, 'ops_admin', null), (v_org, u_sales_phy, 'physio', ua), (v_org, u_sales_phy, 'sales', ua);
  insert into public.professionals (org_id, display_name, person_id, user_id, active) values (v_org, 'Fisio Vista N14', p_phy, u_phy, true) returning id into pf;

  -- ---------------- quem abre sessão e quem pode ser visto
  set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.view_as_start(%L)', u_pat)) like '42501%', 'fisioterapeuta não abre “ver como”');
  perform pg_temp.as_user(u_pat); rep := rep || pg_temp.chk(pg_temp.err(format('select public.view_as_start(%L)', u_phy)) like '42501%', 'paciente não abre “ver como”');
  perform pg_temp.as_user(u_ops); rep := rep || pg_temp.chk(pg_temp.err(format('select public.view_as_start(%L)', u_phy)) like '42501%', 'administrativo não abre “ver como” (só o gestor)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.view_as_targets(''physio'')') like '42501%', 'administrativo não lista quem pode ser visto');
  reset role; set local role anon; rep := rep || pg_temp.chk(pg_temp.err(format('select public.view_as_start(%L)', u_phy)) like '42501%', 'anônimo não abre “ver como”'); reset role;

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.view_as_start(%L)', u_mgr2)) like 'P0001%', 'não se vê como outro gestor');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.view_as_start(%L)', u_ops)) like 'P0001%', 'não se vê como administrativo');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.view_as_start(%L)', u_sales_phy)) like 'P0001%', 'fisioterapeuta que também tem papel de equipe (comercial) não entra no “ver como”');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.view_as_start(%L)', u_none)) like 'P0001%', 'quem não tem conta ativa não pode ser visto');
  r := public.view_as_targets('physio'); rep := rep || pg_temp.chk((select count(*) from jsonb_array_elements(r) x where x ->> 'name' like '%N14') = 2 and not exists (select 1 from jsonb_array_elements(r) x where x ->> 'name' in ('Gestor N14', 'Adm N14', 'Fisio Comercial N14')), 'lista de fisioterapeutas: só quem é fisioterapeuta puro e tem acesso');
  r := public.view_as_targets('patient', 'visto n14'); rep := rep || pg_temp.chk(jsonb_array_length(r) = 1 and r -> 0 ->> 'name' = 'Paciente Visto N14' and r -> 0 ->> 'email' = 'p@n14.local', 'lista de pacientes com busca por nome (traz e-mail)');

  -- ---------------- sessão de fisioterapeuta
  s_phy := public.view_as_start(u_phy); s_id := (s_phy ->> 'session_id')::uuid;
  rep := rep || pg_temp.chk(s_phy ->> 'kind' = 'physio' and (s_phy ->> 'target_user_id')::uuid = u_phy and s_phy -> 'roles' -> 0 ->> 'role' = 'physio', 'sessão aberta como fisioterapeuta (papéis da pessoa vista)');
  reset role; rep := rep || pg_temp.chk((select count(*) from public.view_as_sessions where id = s_id and viewer_user_id = u_mgr and target_user_id = u_phy and ended_at is null) = 1, 'sessão gravada (quem, como quem, quando)'); set local role authenticated; perform pg_temp.as_user(u_mgr);

  -- sem cabeçalho a função não faz nada
  perform public.hp_pre_request(); rep := rep || pg_temp.chk((select auth.uid()) = u_mgr and not private.view_as_active() and current_setting('transaction_read_only') = 'off', 'sem cabeçalho: nada muda (continua o gestor, transação normal)');
  -- cabeçalhos recusados
  perform pg_temp.hdr('nao-e-uuid'); rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'cabeçalho que não é uma sessão é recusado');
  perform pg_temp.hdr(gen_random_uuid()::text); rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'sessão inventada é recusada');
  perform pg_temp.as_user(u_mgr2); perform pg_temp.hdr(s_id::text); rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'sessão de outro gestor é recusada');
  perform pg_temp.as_user(u_phy); perform pg_temp.hdr(s_id::text); rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'a própria pessoa vista não consegue usar a sessão');
  reset role; update public.view_as_sessions set expires_at = now() - interval '1 minute' where id = s_id; set local role authenticated; perform pg_temp.as_user(u_mgr); perform pg_temp.hdr(s_id::text);
  rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'sessão expirada é recusada');
  reset role; update public.view_as_sessions set expires_at = now() + interval '4 hours' where id = s_id; update public.role_assignments set revoked_at = now() where user_id = u_mgr and role = 'manager'; set local role authenticated; perform pg_temp.as_user(u_mgr); perform pg_temp.hdr(s_id::text);
  rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'quem deixou de ser gestor perde a sessão');
  reset role; update public.role_assignments set revoked_at = null where user_id = u_mgr and role = 'manager'; set local role authenticated; perform pg_temp.as_user(u_mgr);

  -- ---------------- cabeçalho válido: identidade trocada + somente leitura (o resto da transação é a visão do fisioterapeuta)
  perform pg_temp.hdr(s_id::text); perform public.hp_pre_request();
  rep := rep || pg_temp.chk((select auth.uid()) = u_phy and private.view_as_active() and current_setting('transaction_read_only') = 'on' and (select auth.jwt() ->> 'view_as_by') = u_mgr::text, 'cabeçalho válido: auth.uid() passa a ser o do fisioterapeuta, a chamada fica marcada e a transação somente leitura');
  r := public.view_as_current(); rep := rep || pg_temp.chk(r ->> 'kind' = 'physio' and r ->> 'name' = 'Fisio Vista N14' and r ->> 'email' = 'f@n14.local', 'view_as_current devolve quem está sendo visto');
  r := public.prof_home(); rep := rep || pg_temp.chk(r is not null, 'prof_home() responde como o fisioterapeuta (sem “sem permissão”)');
  reset role; rep := rep || pg_temp.chk((select count(*) from public.professionals where user_id = u_phy) = 1 and private.has_role_any(array['physio']::public.app_role[]) and not private.has_role_any(array['manager']::public.app_role[]), 'as funções de papel enxergam o fisioterapeuta, não o gestor'); set local role authenticated;
  rep := rep || pg_temp.chk(pg_temp.err('select public.view_as_start(auth.uid())') like '42501%', 'dentro do “ver como” não dá para abrir outra sessão');
  rep := rep || pg_temp.chk(pg_temp.err('select public.view_as_end(gen_random_uuid())') like '42501%', 'encerrar com o cabeçalho é recusado (tem de ser como o gestor)');
  t := pg_temp.err(format('insert into public.people (org_id, unit_id, full_name) values (%L, %L, ''Nao Deve Gravar N14'')', v_org, ua)); rep := rep || pg_temp.chk(t like '25006%', 'gravar (insert) falha: transação somente leitura');
  t := pg_temp.err(format('update public.people set full_name = ''Nao Deve Mudar'' where id = %L', p_phy)); rep := rep || pg_temp.chk(t like '25006%', 'gravar (update) falha: transação somente leitura');
  reset role;
  raise exception 'RELATORIO_N14%', rep;
end $$;
