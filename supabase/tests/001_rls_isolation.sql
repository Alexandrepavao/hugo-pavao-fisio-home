-- Teste de isolamento RLS. Roda numa transação DESFEITA ao final (raise exception com o relatório).
-- Executar SOMENTE em ambiente dev/teste. Requer a organização 'hp-group' semeada.
do $$
declare
  v_org uuid; v_ua uuid; v_ub uuid;
  u_mgr uuid := gen_random_uuid(); u_ua uuid := gen_random_uuid(); u_sb uuid := gen_random_uuid();
  u_mem uuid := gen_random_uuid(); u_out uuid := gen_random_uuid(); u_ops uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  p_a uuid; p_b uuid; p_self uuid;
  n int; ok boolean; rep text := '';

  procedure_dummy int;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org order by created_at limit 1;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste)', 'teste-b') returning id into v_ub;

  insert into auth.users (id, aud, role, email) values
    (u_mgr,'authenticated','authenticated','mgr@test.local'),(u_ua,'authenticated','authenticated','ua@test.local'),
    (u_sb,'authenticated','authenticated','sb@test.local'),(u_mem,'authenticated','authenticated','mem@test.local'),
    (u_out,'authenticated','authenticated','out@test.local'),(u_ops,'authenticated','authenticated','ops@test.local'),
    (u_phy,'authenticated','authenticated','phy@test.local');

  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Pessoa A') returning id into p_a;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ub, 'Pessoa B') returning id into p_b;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente Self') returning id into p_self;

  insert into public.user_accounts (user_id, org_id, person_id) values
    (u_mgr, v_org, null),(u_ua, v_org, null),(u_sb, v_org, null),(u_mem, v_org, p_self),(u_out, v_org, null),(u_ops, v_org, null),(u_phy, v_org, null);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values
    (v_org, u_mgr, 'manager', null),(v_org, u_ops, 'ops_admin', null),
    (v_org, u_ua, 'unit_manager', v_ua),(v_org, u_sb, 'sales', v_ub),
    (v_org, u_mem, 'member', null),(v_org, u_phy, 'physio', v_ua);
  insert into public.person_contacts (org_id, person_id, type, value) values (v_org, p_b, 'email', 'b@x.com');

  -- 1) unit_manager da unidade A vê A + self, não B
  perform set_config('request.jwt.claims', json_build_object('sub', u_ua, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.people;
  rep := rep || format(E'\n[%s] unit_manager A vê 2 pessoas (obtido %s)', case when n = 2 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.people where id = p_b;
  rep := rep || format(E'\n[%s] unit_manager A NÃO vê pessoa da unidade B (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.person_contacts;
  rep := rep || format(E'\n[%s] unit_manager A NÃO vê contatos da unidade B (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  ok := false; begin insert into public.people (org_id, unit_id, full_name, created_by) values (v_org, v_ub, 'Invasor', u_ua); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] unit_manager A não cria pessoa na unidade B', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin insert into public.role_assignments (org_id, user_id, role) values (v_org, u_ua, 'manager'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] unit_manager não se promove a gestor', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.audit_log;
  rep := rep || format(E'\n[%s] unit_manager não lê auditoria (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  -- 2) comercial da unidade B vê só B
  perform set_config('request.jwt.claims', json_build_object('sub', u_sb, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.people;
  rep := rep || format(E'\n[%s] sales B vê só 1 pessoa (obtido %s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  reset role;

  -- 3) gestor vê todos; auditoria legível
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.people;
  rep := rep || format(E'\n[%s] gestor vê 3 pessoas (obtido %s)', case when n = 3 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.audit_log;
  rep := rep || format(E'\n[%s] gestor lê auditoria (%s linhas)', case when n > 0 then 'OK' else 'FALHA' end, n);
  reset role;

  -- 4) ops_admin não concede gestor
  perform set_config('request.jwt.claims', json_build_object('sub', u_ops, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.role_assignments (org_id, user_id, role) values (v_org, u_out, 'manager'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] ops_admin não concede papel de gestor', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- 5) membro vê só o próprio cadastro
  perform set_config('request.jwt.claims', json_build_object('sub', u_mem, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.people;
  rep := rep || format(E'\n[%s] paciente/aluno vê só o próprio cadastro (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  reset role;

  -- 6) fisioterapeuta não lê cadastro administrativo (dados clínicos têm regra própria, futura)
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.people;
  rep := rep || format(E'\n[%s] fisioterapeuta não lê pessoas administrativas (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  -- 7) usuário autenticado sem conta/papel vê nada
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.people; rep := rep || format(E'\n[%s] usuário sem conta vê 0 pessoas (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.units; rep := rep || format(E'\n[%s] usuário sem conta vê 0 unidades (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  -- 8) anon não acessa
  set local role anon;
  ok := false; begin perform 1 from public.people limit 1; exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] anon sem permissão em people', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- 9) revogação: revogar papel do unit_manager A remove o acesso imediatamente
  update public.role_assignments set revoked_at = now() where user_id = u_ua;
  perform set_config('request.jwt.claims', json_build_object('sub', u_ua, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.people;
  rep := rep || format(E'\n[%s] após revogação, unit_manager A vê 0 pessoas (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  raise exception E'RELATORIO_RLS (transação desfeita):%', rep;
end $$;
