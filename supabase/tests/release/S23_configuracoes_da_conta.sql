-- RELEASE v1 — S23: Configurações da conta (migration 084). Transação sempre desfeita. Somente Dev/teste.
--  · qualquer usuário da equipe (não só gestor) altera o PRÓPRIO nome de exibição; nunca o de outra pessoa, nunca papel/e-mail/status
--  · validações (mínimo, máximo, espaços repetidos, caracteres de controle), sessão ausente e conta inativa
--  · auditoria com valor antigo e novo; sem mudança = sem registro; anônimo não executa
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; u_phy uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_off uuid := gen_random_uuid(); rep text := '';
  t text; nm text; n bigint; ov jsonb; nv jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into auth.users (id, aud, role, email) values (u_phy,'authenticated','authenticated','p@s23.local'),(u_mgr,'authenticated','authenticated','m@s23.local'),(u_off,'authenticated','authenticated','o@s23.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name, status) values (u_phy, v_org, null, 'Fisio S23', 'active'),(u_mgr, v_org, null, 'Gestor S23', 'active'),(u_off, v_org, null, 'Inativo S23', 'suspended');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_phy, 'physio', null),(v_org, u_mgr, 'manager', null);

  -- 1) fisioterapeuta (não gestor) renomeia a si mesmo
  set local role authenticated; perform pg_temp.as_user(u_phy);
  t := pg_temp.err('update public.user_accounts set display_name = ''Direto S23'' where user_id = ''' || u_phy || '''');
  reset role; select display_name into nm from public.user_accounts where user_id = u_phy;
  rep := rep || pg_temp.chk(nm = 'Fisio S23', 'sem a função, não-gestor NÃO consegue alterar o nome (a política só vale para gestor)');
  set local role authenticated; perform pg_temp.as_user(u_phy);
  perform public.my_account_update('  Ana   Paula   Souza  ');
  reset role; select display_name into nm from public.user_accounts where user_id = u_phy;
  rep := rep || pg_temp.chk(nm = 'Ana Paula Souza', 'com a função, não-gestor altera o próprio nome e os espaços repetidos são normalizados');

  -- 2) nunca toca a conta de outra pessoa nem outro campo
  select display_name into nm from public.user_accounts where user_id = u_mgr;
  rep := rep || pg_temp.chk(nm = 'Gestor S23', 'a conta do gestor continua intacta');
  select count(*) into n from public.role_assignments where user_id = u_phy and role = 'physio';
  rep := rep || pg_temp.chk(n = 1, 'papéis continuam como estavam');

  -- 3) validações
  set local role authenticated; perform pg_temp.as_user(u_phy);
  t := pg_temp.err('select public.my_account_update(''A'')'); rep := rep || pg_temp.chk(t like '%2 caracteres%', 'nome com 1 letra é recusado');
  t := pg_temp.err('select public.my_account_update(''    '')'); rep := rep || pg_temp.chk(t like '%2 caracteres%', 'nome só com espaços é recusado');
  t := pg_temp.err('select public.my_account_update(null)'); rep := rep || pg_temp.chk(t like '%2 caracteres%', 'nome nulo é recusado');
  t := pg_temp.err(format('select public.my_account_update(%L)', repeat('x', 81))); rep := rep || pg_temp.chk(t like '%muito longo%', 'nome com mais de 80 caracteres é recusado');
  t := pg_temp.err(format('select public.my_account_update(%L)', 'Ana' || chr(7) || 'Souza')); rep := rep || pg_temp.chk(t like '%caracteres inválidos%', 'caractere de controle é recusado');
  perform public.my_account_update(repeat('y', 80)); rep := rep || pg_temp.chk(true, 'exatamente 80 caracteres é aceito');
  perform public.my_account_update('Ana Paula Souza');

  -- 4) sessão ausente e conta inativa
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  t := pg_temp.err('select public.my_account_update(''Fulano Teste'')'); rep := rep || pg_temp.chk(t like '42501%', 'sem usuário na sessão é recusado (42501)');
  perform pg_temp.as_user(u_off);
  t := pg_temp.err('select public.my_account_update(''Fulano Teste'')'); rep := rep || pg_temp.chk(t like '42501%', 'conta não ativa é recusada (42501)');

  -- 5) anônimo não executa
  reset role; set local role anon; perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  t := pg_temp.err('select public.my_account_update(''Anonimo Teste'')'); rep := rep || pg_temp.chk(t like '42501%', 'anônimo não pode executar a função');

  -- 6) auditoria
  reset role;
  select old_values, new_values into ov, nv from public.audit_log where entity_type = 'user_accounts' and entity_id = u_phy::text and actor_user_id = u_phy order by id limit 1;
  rep := rep || pg_temp.chk(ov ->> 'display_name' = 'Fisio S23' and nv ->> 'display_name' = 'Ana Paula Souza', 'auditoria guarda o nome antigo e o novo, com o autor');
  select count(*) into n from public.audit_log where entity_type = 'user_accounts' and entity_id = u_phy::text;
  set local role authenticated; perform pg_temp.as_user(u_phy);
  perform public.my_account_update('Ana Paula Souza');
  reset role;
  rep := rep || pg_temp.chk((select count(*) from public.audit_log where entity_type = 'user_accounts' and entity_id = u_phy::text) = n, 'repetir o mesmo nome não gera novo registro de auditoria');

  raise exception E'RELATORIO_S23_CONFIGURACOES_DA_CONTA (transação desfeita):%', rep;
end $$;
