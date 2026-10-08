-- RELEASE v1 — S24: o nome mostrado de um usuário é o nome do cadastro de pessoa dele (migration 085). Transação sempre desfeita. Somente Dev/teste.
--  · conta ligada a uma pessoa: nome = nome de preferência do cadastro, na falta dele o nome completo; acompanha mudanças do cadastro
--  · ligar a conta depois, criar já ligada, e conta sem pessoa continuam funcionando; edição direta do nome de conta ligada é recusada
--  · Configurações: com pessoa ligada, "o nome" edita o nome de preferência (vazio = nome completo); sem pessoa, o nome de exibição (S23)
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; u_mgr uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_new uuid := gen_random_uuid(); u_solo uuid := gen_random_uuid();
  p_phy uuid; p_new uuid; rep text := ''; t text; nm text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s24.local'),(u_phy,'authenticated','authenticated','p@s24.local'),(u_new,'authenticated','authenticated','n@s24.local'),(u_solo,'authenticated','authenticated','solo@s24.local');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_phy, 'physio', null),(v_org, u_solo, 'physio', null);
  insert into public.people (org_id, full_name) values (v_org, 'Marina Costa Teste S24') returning id into p_phy;
  insert into public.people (org_id, full_name, preferred_name) values (v_org, 'Roberto Lima Teste S24', 'Beto') returning id into p_new;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S24'),(u_solo, v_org, null, 'Sem Cadastro S24');

  -- 1) criar a conta já ligada: o nome vem do cadastro (e não do que foi passado)
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_new, v_org, p_new, 'qualquer coisa');
  select display_name into nm from public.user_accounts where user_id = u_new;
  rep := rep || pg_temp.chk(nm = 'Beto', 'conta criada já ligada a uma pessoa mostra o nome de preferência do cadastro (Beto), não o texto passado');

  -- 2) ligar depois: passa a mostrar o nome completo (sem preferência)
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_phy, v_org, null, 'Fisio S24');
  update public.user_accounts set person_id = p_phy where user_id = u_phy;
  select display_name into nm from public.user_accounts where user_id = u_phy;
  rep := rep || pg_temp.chk(nm = 'Marina Costa Teste S24', 'ligar a conta a uma pessoa troca o nome para o nome completo do cadastro');

  -- 3) o cadastro muda: a conta acompanha
  update public.people set preferred_name = 'Mari' where id = p_phy;
  select display_name into nm from public.user_accounts where user_id = u_phy; rep := rep || pg_temp.chk(nm = 'Mari', 'definir o nome de preferência no cadastro muda o nome da conta');
  update public.people set preferred_name = null where id = p_phy;
  select display_name into nm from public.user_accounts where user_id = u_phy; rep := rep || pg_temp.chk(nm = 'Marina Costa Teste S24', 'limpar a preferência volta ao nome completo');
  update public.people set full_name = 'Marina Costa Souza Teste S24' where id = p_phy;
  select display_name into nm from public.user_accounts where user_id = u_phy; rep := rep || pg_temp.chk(nm = 'Marina Costa Souza Teste S24', 'corrigir o nome completo no cadastro muda o nome da conta');

  -- 4) edição direta do nome de conta ligada é recusada; de conta sem pessoa é permitida (gestor)
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  t := pg_temp.err(format('update public.user_accounts set display_name = ''Outro Nome'' where user_id = %L', u_phy));
  rep := rep || pg_temp.chk(t like '%vem do cadastro de pessoa%', 'gestor não consegue renomear diretamente uma conta ligada a pessoa');
  t := pg_temp.err(format('update public.user_accounts set display_name = ''Nome Novo S24'' where user_id = %L', u_solo));
  reset role; select display_name into nm from public.user_accounts where user_id = u_solo;
  rep := rep || pg_temp.chk(t is null and nm = 'Nome Novo S24', 'gestor continua podendo renomear uma conta SEM pessoa ligada');
  select display_name into nm from public.user_accounts where user_id = u_phy; rep := rep || pg_temp.chk(nm = 'Marina Costa Souza Teste S24', 'a conta ligada manteve o nome do cadastro');

  -- 5) Configurações da conta: com pessoa, edita o nome de preferência
  set local role authenticated; perform pg_temp.as_user(u_phy);
  perform public.my_account_update('  Mari   Souza ');
  reset role;
  select preferred_name into nm from public.people where id = p_phy; rep := rep || pg_temp.chk(nm = 'Mari Souza', 'my_account_update com pessoa ligada grava o nome de preferência normalizado no cadastro');
  select display_name into nm from public.user_accounts where user_id = u_phy; rep := rep || pg_temp.chk(nm = 'Mari Souza', 'e o nome da conta acompanha na hora');
  select full_name into nm from public.people where id = p_phy; rep := rep || pg_temp.chk(nm = 'Marina Costa Souza Teste S24', 'o nome completo NÃO é alterado pela própria pessoa');
  set local role authenticated; perform pg_temp.as_user(u_phy);
  perform public.my_account_update('');
  reset role; select display_name into nm from public.user_accounts where user_id = u_phy;
  rep := rep || pg_temp.chk(nm = 'Marina Costa Souza Teste S24', 'em branco = volta a usar o nome completo');
  set local role authenticated; perform pg_temp.as_user(u_phy);
  t := pg_temp.err('select public.my_account_update(''A'')'); rep := rep || pg_temp.chk(t like '%2 caracteres%', 'um caractere é recusado');
  t := pg_temp.err(format('select public.my_account_update(%L)', repeat('x', 81))); rep := rep || pg_temp.chk(t like '%muito longo%', 'mais de 80 caracteres é recusado');
  -- sem pessoa continua como antes (nome de exibição da conta)
  perform pg_temp.as_user(u_solo); perform public.my_account_update('Sem Cadastro Editado');
  reset role; select display_name into nm from public.user_accounts where user_id = u_solo;
  rep := rep || pg_temp.chk(nm = 'Sem Cadastro Editado', 'conta sem pessoa edita o nome de exibição da própria conta');
  set local role authenticated; perform pg_temp.as_user(u_solo);
  t := pg_temp.err('select public.my_account_update('''')'); rep := rep || pg_temp.chk(t like '%2 caracteres%', 'conta sem pessoa não pode ficar sem nome');
  reset role;

  -- 6) anônimo e funções internas não são acessíveis
  rep := rep || pg_temp.chk(not has_function_privilege('anon', 'public.my_account_update(text)', 'execute'), 'anônimo não executa my_account_update');
  rep := rep || pg_temp.chk(not has_function_privilege('authenticated', 'private.person_account_name(uuid)', 'execute'), 'a função interna de nome não é chamável por usuários');

  raise exception E'RELATORIO_S24_NOME_DA_CONTA_VEM_DO_CADASTRO (transação desfeita):%', rep;
end $$;
