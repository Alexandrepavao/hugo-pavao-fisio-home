-- NOVO — N24: ciclo de vida do convite do administrador (migration 144): validade, revogação, reenvio (renovação), consumo de vários convites, conta existente em outra organização,
-- papel concedido, cadastro antigo não confirmado, marca do e-mail por organização e evidência em níveis. Transação sempre desfeita. Nenhum e-mail é enviado. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid, org uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('app.active_org', coalesce(org::text, ''), true);
end $$;
create or replace function pg_temp.answers(p_name text, p_sub text, p_email text) returns jsonb language sql as $$
  select jsonb_build_object(
    'company', jsonb_build_object('name', p_name, 'segment', 'fisioterapia', 'responsible', jsonb_build_object('name', 'Responsável ' || p_name, 'email', p_email), 'city', 'São Paulo', 'state', 'SP', 'units', jsonb_build_array(jsonb_build_object('name', 'Sede ' || p_name, 'city', 'São Paulo'))),
    'operation', jsonb_build_object('services', jsonb_build_array('Avaliação'), 'modes', jsonb_build_array('in_clinic'), 'flow', 'Avaliação, plano e sessões', 'sales_models', jsonb_build_array('single')),
    'team', jsonb_build_object('users_count', 2, 'roles', jsonb_build_array(jsonb_build_object('role', 'manager', 'count', 1))),
    'customers', jsonb_build_object('crm', true, 'capture', false, 'forms', false, 'proposals', false, 'portal', true, 'import', jsonb_build_object('needed', false)),
    'modules', '[]'::jsonb,
    'brand', jsonb_build_object('app_name', p_name || ' App', 'color_primary', '#123456', 'color_accent', '#ff8800', 'subdomain', p_sub),
    'integrations', jsonb_build_array('email'),
    'plan', jsonb_build_object('plan_key', 'essencial', 'implementation', 'standard', 'import_assisted', false, 'training', false))
$$;
do $$
declare
  rep text := ''; pa uuid := gen_random_uuid(); u_other uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); u_exist uuid := gen_random_uuid(); u_stale uuid := gen_random_uuid();
  o1 uuid; o2 uuid; o3 uuid; r1 uuid; r2 uuid; r3 uuid; j jsonb; n int; v_inv uuid; v_ev uuid; ev jsonb; v_pers uuid;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (pa, 'authenticated', 'authenticated', 'plataforma@n24.local', now()), (u_other, 'authenticated', 'authenticated', 'outro@n24.local', now()),
    (u_exist, 'authenticated', 'authenticated', 'ja.tem.conta@n24.local', now());
  insert into public.platform_admins (user_id) values (pa);
  set local role authenticated; perform pg_temp.as_user(pa);
  j := public.provisioning_draft_save('n24-um-0001', pg_temp.answers('Clínica Um N24', 'um-n24', 'novo.admin@n24.local')); j := public.provisioning_submit('n24-um-0001'); r1 := (j ->> 'id')::uuid; o1 := (j ->> 'org_id')::uuid;
  j := public.provisioning_draft_save('n24-dois-0002', pg_temp.answers('Clínica Dois N24', 'dois-n24', 'novo.admin@n24.local')); j := public.provisioning_submit('n24-dois-0002'); r2 := (j ->> 'id')::uuid; o2 := (j ->> 'org_id')::uuid;
  j := public.provisioning_draft_save('n24-tres-0003', pg_temp.answers('Clínica Três N24', 'tres-n24', 'ja.tem.conta@n24.local')); j := public.provisioning_submit('n24-tres-0003'); r3 := (j ->> 'id')::uuid; o3 := (j ->> 'org_id')::uuid;
  reset role;
  rep := rep || pg_temp.chk(r1 is not null and o1 is not null and o2 is not null and o3 is not null, 'três organizações pelo questionário (duas com o MESMO e-mail de administrador novo, uma com conta existente)');
  rep := rep || pg_temp.chk((select count(*) from private.manager_bootstrap_emails where org_id in (o1, o2)) = 2 and (select count(*) from public.invitations where org_id = o3 and role = 'manager') = 1, 'convite novo (bootstrap) e convite de conta existente preparados');
  rep := rep || pg_temp.chk((select expires_at from private.manager_bootstrap_emails where org_id = o1) > now() + interval '29 days', 'convite novo vale 30 dias');

  -- 1. prepare só para service_role; devolve slug, existing_user e (se for o caso) cadastro antigo seguro de recriar
  rep := rep || pg_temp.chk(not has_function_privilege('authenticated', 'public.provisioning_invite_prepare(uuid)', 'execute') and has_function_privilege('service_role', 'public.provisioning_invite_prepare(uuid)', 'execute'), 'prepare é só do servidor');
  set local role service_role; j := public.provisioning_invite_prepare(r1); reset role;
  rep := rep || pg_temp.chk(j ->> 'status' = 'ready' and j ->> 'slug' = 'um-n24' and not (j ->> 'existing_user')::boolean and j ->> 'stale_user_id' is null, 'prepare: pronto, slug da organização, conta nova, sem cadastro antigo');
  set local role service_role; j := public.provisioning_invite_prepare(r3); reset role;
  rep := rep || pg_temp.chk((j ->> 'existing_user')::boolean and (select count(*) from public.invitations where org_id = o3 and role = 'manager' and accepted_at is null and revoked_at is null) = 1, 'conta existente: vínculo pendente, sem duplicar convite ao repetir');

  -- 2. revogação: depois de revogado, confirmar o e-mail NÃO concede papel
  set local role authenticated; perform pg_temp.as_user(u_other); rep := rep || pg_temp.chk(pg_temp.err(format('select public.provisioning_invite_revoke(%L)', r1)) like '42501%', 'não-administrador da plataforma não revoga convite');
  perform pg_temp.as_user(pa); j := public.provisioning_invite_revoke(r1); reset role;
  rep := rep || pg_temp.chk((j ->> 'revoked')::int = 1 and (select admin_invite ->> 'state' from public.provisioning_requests where id = r1) = 'revoked', 'convite revogado (estado registrado)');
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u1, 'authenticated', 'authenticated', 'novo.admin@n24.local', now());
  select count(*) into n from public.role_assignments where user_id = u1 and org_id = o1; rep := rep || pg_temp.chk(n = 0, 'e-mail confirmado com convite REVOGADO: nenhum papel na organização revogada');
  select count(*) into n from public.role_assignments where user_id = u1 and org_id = o2 and role = 'manager'; rep := rep || pg_temp.chk(n = 1, 'o convite válido da OUTRA organização foi consumido normalmente');
  delete from public.role_assignments where user_id = u1; delete from public.org_memberships where user_id = u1; delete from public.user_accounts where user_id = u1; delete from auth.users where id = u1;
  update private.manager_bootstrap_emails set consumed_at = null, consumed_by = null where org_id = o2;

  -- 3. reenvio renova (reabre revogado) e vale 30 dias; vencido não concede papel
  set local role service_role; j := public.provisioning_invite_prepare(r1); reset role;
  rep := rep || pg_temp.chk(j ->> 'status' = 'ready' and (select revoked_at from private.manager_bootstrap_emails where org_id = o1) is null and (select expires_at from private.manager_bootstrap_emails where org_id = o1) > now() + interval '29 days', 'reenviar renova o convite revogado');
  update private.manager_bootstrap_emails set expires_at = now() - interval '1 hour' where org_id in (o1, o2);
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u1, 'authenticated', 'authenticated', 'novo.admin@n24.local', now());
  select count(*) into n from public.role_assignments where user_id = u1 and role = 'manager' and org_id in (o1, o2); rep := rep || pg_temp.chk(n = 0, 'convite VENCIDO não concede papel');
  delete from auth.users where id = u1;
  update private.manager_bootstrap_emails set expires_at = now() + interval '5 days' where org_id in (o1, o2);

  -- 4. vários convites do MESMO e-mail novo: todos são consumidos na confirmação (um vínculo por organização), com o papel certo
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u1, 'authenticated', 'authenticated', 'novo.admin@n24.local', now());
  select count(*) into n from public.org_memberships where user_id = u1 and org_id in (o1, o2) and status = 'active'; rep := rep || pg_temp.chk(n = 2, 'um único usuário ficou vinculado às DUAS organizações (sem duplicar identidade)');
  select count(*) into n from public.role_assignments where user_id = u1 and role = 'manager' and org_id in (o1, o2) and revoked_at is null; rep := rep || pg_temp.chk(n = 2, 'papel concedido pelo convite: gestor, em cada organização');
  select count(*) into n from auth.users where lower(email) = 'novo.admin@n24.local'; rep := rep || pg_temp.chk(n = 1, 'uma identidade só para o e-mail');
  rep := rep || pg_temp.chk((select admin_invite ->> 'state' from public.provisioning_requests where id = r1) = 'accepted' and (select admin_invite ->> 'state' from public.provisioning_requests where id = r2) = 'accepted', 'a solicitação registra o convite como aceito');
  set local role service_role; j := public.provisioning_invite_prepare(r1); reset role;
  rep := rep || pg_temp.chk(j ->> 'status' = 'already_accepted', 'convite já usado: reenvio é recusado (already_accepted)');
  set local role authenticated; perform pg_temp.as_user(pa);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.provisioning_invite_revoke(%L)', r1)) like '%já aceito%', 'convite já aceito não pode ser revogado por esta via');
  reset role;

  -- 5. conta que já existe aceita o vínculo SEM duplicar identidade, sem perder o vínculo anterior e sem tocar na senha
  update auth.users set encrypted_password = 'hash-fake-n24-nao-muda' where id = u_exist;
  insert into public.org_memberships (user_id, org_id, status, is_default) values (u_exist, o1, 'active', true);
  insert into public.role_assignments (org_id, user_id, role) values (o1, u_exist, 'physio');
  set local role authenticated; perform pg_temp.as_user(u_exist, o1);
  j := public.my_pending_invitations();
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 1 and j -> 0 ->> 'org_name' = 'Clínica Três N24 App' and j -> 0 ->> 'role' = 'manager', 'conta existente vê o convite pendente da outra organização, com a função oferecida');
  v_inv := (j -> 0 ->> 'id')::uuid;
  perform pg_temp.as_user(u_other, o1); rep := rep || pg_temp.chk(pg_temp.err(format('select public.invitation_accept(%L)', v_inv)) like '42501%', 'outra pessoa não aceita convite que não é dela');
  perform pg_temp.as_user(u_exist, o1); j := public.invitation_accept(v_inv); reset role;
  rep := rep || pg_temp.chk((j ->> 'org_id')::uuid = o3 and (select count(*) from public.org_memberships where user_id = u_exist and status = 'active') = 2, 'aceite cria o novo vínculo e MANTÉM o anterior');
  rep := rep || pg_temp.chk((select count(*) from public.role_assignments where user_id = u_exist and org_id = o3 and role = 'manager') = 1 and (select count(*) from public.role_assignments where user_id = u_exist and org_id = o1 and role = 'physio') = 1, 'papel concedido pelo convite só na organização do convite; papel anterior intacto');
  rep := rep || pg_temp.chk((select count(*) from auth.users where lower(email) = 'ja.tem.conta@n24.local') = 1 and (select encrypted_password from auth.users where id = u_exist) = 'hash-fake-n24-nao-muda', 'mesma identidade e senha NÃO redefinida pelo aceite');
  rep := rep || pg_temp.chk((select admin_invite ->> 'state' from public.provisioning_requests where id = r3) = 'accepted', 'solicitação registra o aceite');
  set local role authenticated; perform pg_temp.as_user(u_exist, o1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.invitation_accept(%L)', v_inv)) like '42501%', 'convite já utilizado não pode ser reutilizado');
  reset role;
  -- revogado / vencido: não aparece e não aceita
  insert into public.invitations (org_id, email, role, invited_by, revoked_at) values (o2, 'ja.tem.conta@n24.local', 'manager', pa, now()) returning id into v_inv;
  set local role authenticated; perform pg_temp.as_user(u_exist, o1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.invitation_accept(%L)', v_inv)) like '42501%', 'convite revogado não é aceito');
  reset role;
  update public.invitations set revoked_at = null, expires_at = now() - interval '1 day' where id = v_inv;
  set local role authenticated; perform pg_temp.as_user(u_exist, o1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.invitation_accept(%L)', v_inv)) like '42501%' and jsonb_array_length(public.my_pending_invitations()) = 0, 'convite vencido não é aceito nem listado');
  reset role;

  -- 6. cadastro antigo NÃO confirmado e sem vínculos pode ser recriado com segurança; com vínculos, não
  set local role authenticated; perform pg_temp.as_user(pa);
  j := public.provisioning_draft_save('n24-quatro-0004', pg_temp.answers('Clínica Quatro N24', 'quatro-n24', 'stale@n24.local')); j := public.provisioning_submit('n24-quatro-0004');
  reset role;
  insert into auth.users (id, aud, role, email) values (u_stale, 'authenticated', 'authenticated', 'stale@n24.local');
  set local role service_role; j := public.provisioning_invite_prepare((select id from public.provisioning_requests where idempotency_key = 'n24-quatro-0004')); reset role;
  rep := rep || pg_temp.chk((j ->> 'stale_user_id')::uuid = u_stale, 'cadastro antigo não confirmado e sem vínculos: marcado como seguro de recriar');
  insert into public.org_memberships (user_id, org_id, status) values (u_stale, o1, 'active');
  set local role service_role; j := public.provisioning_invite_prepare((select id from public.provisioning_requests where idempotency_key = 'n24-quatro-0004')); reset role;
  rep := rep || pg_temp.chk(j ->> 'stale_user_id' is null, 'se o cadastro tem vínculo, NÃO é marcado para recriação');

  -- 7. marca do e-mail por organização: o slug só vale se o endereço tem ligação real com a organização
  set local role service_role;
  rep := rep || pg_temp.chk(public.email_brand_for_address('ja.tem.conta@n24.local', 'tres-n24') ->> 'slug' = 'tres-n24' and public.email_brand_for_address('ja.tem.conta@n24.local', 'um-n24') ->> 'slug' = 'um-n24', 'com slug e vínculo real: marca da organização pedida');
  rep := rep || pg_temp.chk(coalesce(public.email_brand_for_address('ja.tem.conta@n24.local', 'quatro-n24') ->> 'slug', '') <> 'quatro-n24', 'slug de organização SEM ligação com o endereço não veste o e-mail');
  rep := rep || pg_temp.chk((public.email_brand_for_address('ninguem@n24.local', 'um-n24') ->> 'found')::boolean = false, 'endereço sem nenhuma ligação: sem marca (e-mail padrão)');
  reset role;

  -- 8. eventos de e-mail e evidência em níveis (só plataforma; nunca o e-mail completo)
  set local role service_role;
  v_ev := public.email_event_log(o3, r3, 'admin_invite', 'ja.tem.conta@n24.local', 'requested');
  v_ev := public.email_event_log(o3, r3, 'admin_invite_notice', 'ja.tem.conta@n24.local', 'accepted', 'prov-n24-123');
  perform public.email_event_delivery(v_ev, 'delivered', now());
  rep := rep || pg_temp.chk(not has_function_privilege('authenticated', 'public.email_event_log(uuid, uuid, text, text, text, text, text)', 'execute') and has_function_privilege('service_role', 'public.email_event_log(uuid, uuid, text, text, text, text, text)', 'execute'), 'registrar evento de e-mail é só do servidor');
  reset role;
  set local role authenticated; perform pg_temp.as_user(u_other); rep := rep || pg_temp.chk(pg_temp.err(format('select public.provisioning_access_evidence(%L)', r3)) like '42501%', 'evidência só para administrador da plataforma');
  perform pg_temp.as_user(pa); ev := public.provisioning_access_evidence(r3); reset role;
  rep := rep || pg_temp.chk((ev -> '1_requested' ->> 'count')::int = 1 and (ev -> '2_provider_accepted' ->> 'count')::int = 1 and ev -> '3_delivery' ->> 'state' = 'delivered', 'níveis 1–3: pedido registrado, aceito pelo provedor, entrega informada');
  rep := rep || pg_temp.chk((ev ->> '4_link_used')::boolean and (ev -> '5_access' ->> 'membership')::boolean and (ev -> '5_access' ->> 'manager_role')::boolean and ev ->> 'mode' = 'existing_user', 'níveis 4–5 (conta existente): aceite feito e acesso com papel de gestor');
  rep := rep || pg_temp.chk(position('ja.tem.conta' in ev::text) = 0 and position('prov-n24' in ev::text) = 0, 'a evidência não devolve e-mail completo nem o id do provedor');
  rep := rep || pg_temp.chk((select email_masked from private.email_events where id = v_ev) = 'j***@n24.local' and (select count(*) from private.email_events where email_masked like '%ja.tem.conta%') = 0, 'o evento guarda só o e-mail mascarado e o hash');
  set local role authenticated; perform pg_temp.as_user(pa); ev := public.provisioning_access_evidence(r2); reset role;
  rep := rep || pg_temp.chk(ev ->> 'mode' = 'new_user' and (ev ->> '4_link_used')::boolean and (ev ->> '5_password_set')::boolean = false and (ev -> '5_access' ->> 'membership')::boolean, 'conta nova: link usado e acesso, mas SEM senha cadastrada ainda → o nível 5 de senha continua falso (não declara sucesso)');
  -- 9. gestor de uma organização não lê nem convida pessoa de OUTRA (achado do N40, migration 148)
  insert into public.people (org_id, full_name) select o3, 'Pessoa da Três N24' returning id into v_pers;
  set local role authenticated; perform pg_temp.as_user(u1, o1);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.portal_access_state(%L)', v_pers)) like '42501%', 'gestor da organização 1 não lê o acesso ao portal de pessoa da organização 3');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_portal_access(%L, %L)', v_pers, 'x@n24.local')) like '42501%', 'gestor da organização 1 não convida pessoa da organização 3');
  reset role;
  raise exception 'RELATORIO_N24%', rep;
end $$;
