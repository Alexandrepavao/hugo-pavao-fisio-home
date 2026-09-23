-- Teste do bootstrap de gestores. Transação desfeita ao final. Somente dev/teste.
do $$
declare
  v_org uuid; u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  n int; rep text := '';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  -- e-mail da lista, NÃO verificado, com metadados tentando forçar papel
  insert into auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (u1, 'authenticated', 'authenticated', 'contato@hpfisioterapia.com.br', '{"role":"manager"}', '{"role":"manager"}');
  select count(*) into n from public.role_assignments where user_id = u1;
  rep := rep || format(E'\n[%s] e-mail não verificado (mesmo na lista e com metadata "manager") não recebe papel (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);

  -- verificação do e-mail => gestor
  update auth.users set email_confirmed_at = now() where id = u1;
  select count(*) into n from public.role_assignments where user_id = u1 and role = 'manager' and unit_id is null and revoked_at is null;
  rep := rep || format(E'\n[%s] e-mail verificado da lista vira gestor (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.audit_log where action = 'bootstrap_manager' and entity_id = u1::text;
  rep := rep || format(E'\n[%s] bootstrap auditado (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from private.manager_bootstrap_emails where email = 'contato@hpfisioterapia.com.br' and consumed_at is not null;
  rep := rep || format(E'\n[%s] entrada da lista consumida (uso único)', case when n = 1 then 'OK' else 'FALHA' end);

  -- e-mail fora da lista, verificado => sem conta e sem papel
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data)
    values (u2, 'authenticated', 'authenticated', 'intruso@example.com', now(), '{"role":"manager"}');
  select count(*) into n from public.role_assignments where user_id = u2;
  select count(*) + n into n from public.user_accounts where user_id = u2;
  rep := rep || format(E'\n[%s] e-mail fora da lista, verificado, não recebe conta nem papel (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);

  -- segundo gestor da lista
  insert into auth.users (id, aud, role, email, email_confirmed_at)
    values (u3, 'authenticated', 'authenticated', 'jan.darioush@yahoo.com.br', now());
  select count(*) into n from public.role_assignments where user_id = u3 and role = 'manager';
  rep := rep || format(E'\n[%s] segundo e-mail da lista também vira gestor (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);

  -- usuário autenticado comum não consegue ler a allowlist pela API
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform 1 from private.manager_bootstrap_emails; n := 1; exception when others then n := 0; end;
  reset role;
  rep := rep || format(E'\n[%s] allowlist inacessível a authenticated', case when n = 0 then 'OK' else 'FALHA' end);

  raise exception E'RELATORIO_BOOTSTRAP (transação desfeita):%', rep;
end $$;
