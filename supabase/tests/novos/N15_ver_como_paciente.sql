-- NOVO — N15: "Ver como" paciente (migration 128). Transação sempre desfeita. Somente Dev/teste.
--  · ver como paciente: my_home() responde como o paciente, nada é gravado (somente leitura) e o acesso clínico fica registrado (escopo ver_como)
--  · encerrar a sessão (sem o cabeçalho) fecha a sessão; depois disso o cabeçalho antigo é recusado
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true); end $$;
create or replace function pg_temp.hdr(h text) returns void language plpgsql as $$ begin perform set_config('request.headers', json_build_object('x-view-as', h)::text, true); end $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; u_mgr uuid := gen_random_uuid(); u_pat uuid := gen_random_uuid(); p_pat uuid; s jsonb; s_id uuid; r jsonb; t text; n_before int;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N15)', 'n15-a') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n15.local'), (u_pat, 'authenticated', 'authenticated', 'p@n15.local');
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Paciente Visto N15', '1980-05-05') returning id into p_pat;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N15'), (u_pat, v_org, p_pat, 'Paciente Visto N15');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_pat, 'member', null);

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  s := public.view_as_start(u_pat); s_id := (s ->> 'session_id')::uuid;
  rep := rep || pg_temp.chk(s ->> 'kind' = 'patient' and s -> 'roles' -> 0 ->> 'role' = 'member', 'sessão aberta como paciente');
  reset role;
  rep := rep || pg_temp.chk((select count(*) from public.clinical_access_log where person_id = p_pat and accessed_by = u_mgr and scope = 'ver_como' and accessed_by_role = 'admin') = 1, 'ver como paciente grava o acesso clínico do gestor (escopo ver_como)');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  -- encerrar sem cabeçalho fecha a sessão
  perform public.view_as_end(s_id); reset role;
  rep := rep || pg_temp.chk((select ended_at is not null and ended_reason = 'encerrada' from public.view_as_sessions where id = s_id), 'encerrar fecha a sessão');
  set local role authenticated; perform pg_temp.as_user(u_mgr); perform pg_temp.hdr(s_id::text);
  rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'depois de encerrada, o cabeçalho é recusado');
  -- nova sessão: a anterior (se aberta) é fechada; uma sessão por gestor
  perform pg_temp.hdr(''); s := public.view_as_start(u_pat); s_id := (s ->> 'session_id')::uuid;
  perform public.view_as_start(u_pat); reset role;
  rep := rep || pg_temp.chk((select count(*) from public.view_as_sessions where viewer_user_id = u_mgr and ended_at is null) = 1 and (select ended_reason from public.view_as_sessions where id = s_id) = 'nova sessão', 'abrir outra sessão fecha a anterior (só uma aberta por gestor)');
  select id into s_id from public.view_as_sessions where viewer_user_id = u_mgr and ended_at is null;
  select count(*) into n_before from public.clinical_access_log where person_id = p_pat;

  -- visão do paciente
  set local role authenticated; perform pg_temp.as_user(u_mgr); perform pg_temp.hdr(s_id::text); perform public.hp_pre_request();
  rep := rep || pg_temp.chk((select auth.uid()) = u_pat and private.view_as_active() and current_setting('transaction_read_only') = 'on', 'cabeçalho válido: identidade do paciente e somente leitura');
  reset role; rep := rep || pg_temp.chk(private.current_person() = p_pat and private.has_role_any(array['member']::public.app_role[]) and not private.has_role_any(array['manager']::public.app_role[]), 'as funções do portal enxergam o paciente (current_person), não o gestor'); set local role authenticated;
  r := public.my_home(); rep := rep || pg_temp.chk(r is not null, 'my_home() responde como o paciente');
  reset role; perform private.log_clinical_access(p_pat, 'admin', 'teste');
  rep := rep || pg_temp.chk((select count(*) from public.clinical_access_log where person_id = p_pat) = n_before, 'em “ver como” o registro de acesso clínico não grava de novo (a sessão é o registro) e não dá erro');
  set local role authenticated; perform pg_temp.as_user(u_mgr); perform pg_temp.hdr(s_id::text); perform public.hp_pre_request();
  t := pg_temp.err(format('update public.people set full_name = ''Nao Deve Mudar'' where id = %L', p_pat)); rep := rep || pg_temp.chk(t like '25006%', 'gravar falha: somente leitura');
  t := pg_temp.err(format('insert into public.interactions (org_id, person_id, channel, summary) values (%L, %L, ''note'', ''x'')', v_org, p_pat)); rep := rep || pg_temp.chk(t like '25006%', 'inserir registro também falha');
  reset role;
  raise exception 'RELATORIO_N15%', rep;
end $$;
