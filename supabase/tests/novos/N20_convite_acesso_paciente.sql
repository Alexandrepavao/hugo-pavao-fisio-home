-- NOVO — N20: primeiro acesso do paciente pendente — convite seguro e estado do acesso (migration 133). Transação sempre desfeita. Somente Dev/teste.
--  · a fisioterapeuta com vínculo só convida um e-mail JÁ cadastrado; outra pessoa/fisioterapeuta/paciente não consulta nem convida
--  · conta existente é reutilizada (sem redefinir senha) e só liga se o e-mail for cadastrado da pessoa; nunca move conta ligada a outra pessoa
--  · sem e-mail: estado "sem e-mail", nada é desfeito; vínculo encerrado: convite antigo não reativa
--  · registro do envio sem e-mail completo; reenvio limitado a 10 min depois de aceito; convite vencido gera novo
--  · a função de execução só roda com service_role
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true); end $$;
create or replace function pg_temp.own(sql text) returns text language plpgsql security definer as $$ declare r text; begin execute sql into r; return r; end $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; v_pat uuid; st_new uuid; st_sched uuid; st_lost uuid; v_lr uuid; svc uuid; prof uuid; j jsonb; n int; o1 uuid; o2 uuid; e1 uuid;
  u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_ex uuid := gen_random_uuid(); u_ex2 uuid := gen_random_uuid();
  pe_phy uuid; pe_phy2 uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; v_inv uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade N20', 'n20-a') returning id into ua;
  select id into v_lr from public.loss_reasons where org_id = v_org limit 1;
  select id into v_pat from public.pipelines where org_id = v_org and kind = 'patients' limit 1;
  select id into st_new from public.pipeline_stages where pipeline_id = v_pat and key = 'new_contact'; select id into st_sched from public.pipeline_stages where pipeline_id = v_pat and key = 'evaluation_scheduled';
  select id into st_lost from public.pipeline_stages where pipeline_id = v_pat and kind = 'lost' order by position limit 1;
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u_phy, 'authenticated', 'authenticated', 'phy@n20.local', now()), (u_phy2, 'authenticated', 'authenticated', 'phy2@n20.local', now()), (u_mgr, 'authenticated', 'authenticated', 'mgr@n20.local', now()),
    (u_sales, 'authenticated', 'authenticated', 'sales@n20.local', now()), (u_p2, 'authenticated', 'authenticated', 'p2@n20.local', now()),
    (u_ex, 'authenticated', 'authenticated', 'existente@n20.local', now()), (u_ex2, 'authenticated', 'authenticated', 'naocadastrado@n20.local', now());
  insert into public.people (org_id, unit_id, full_name) select v_org, ua, x from unnest(array['Fisio N20', 'Fisio N20 Dois', 'Paciente N20 Um', 'Paciente N20 Dois', 'Paciente N20 Tres', 'Paciente N20 Quatro']) x;
  select id into pe_phy from public.people where org_id = v_org and full_name = 'Fisio N20' order by created_at desc limit 1; select id into pe_phy2 from public.people where org_id = v_org and full_name = 'Fisio N20 Dois' order by created_at desc limit 1;
  select id into p1 from public.people where org_id = v_org and full_name = 'Paciente N20 Um' order by created_at desc limit 1; select id into p2 from public.people where org_id = v_org and full_name = 'Paciente N20 Dois' order by created_at desc limit 1;
  select id into p3 from public.people where org_id = v_org and full_name = 'Paciente N20 Tres' order by created_at desc limit 1; select id into p4 from public.people where org_id = v_org and full_name = 'Paciente N20 Quatro' order by created_at desc limit 1;
  insert into public.person_contacts (org_id, person_id, type, value) values (v_org, p1, 'email', 'paciente.um@n20.local'), (v_org, p3, 'email', 'existente@n20.local'), (v_org, p4, 'email', 'outra.pessoa@n20.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_phy, v_org, pe_phy, 'Fisio'), (u_phy2, v_org, pe_phy2, 'Fisio2'), (u_mgr, v_org, null, 'Gestor'), (u_sales, v_org, null, 'Com'), (u_p2, v_org, p2, 'P2');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_phy, 'physio', ua), (v_org, u_phy2, 'physio', ua), (v_org, u_mgr, 'manager', null), (v_org, u_sales, 'sales', ua), (v_org, u_p2, 'member', null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Avaliação N20', 50) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio N20') returning id into prof;
  insert into public.professional_units (professional_id, unit_id) values (prof, ua);
  -- vínculos pendentes (avaliação agendada com a fisio 1) de p1 (com e-mail), p2 (sem e-mail; já tem conta), p3 (e-mail de conta existente), p4
  for n in 1..4 loop
    insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) select v_org, ua, (array[p1, p2, p3, p4])[n], v_pat, st_new, 'Opp N20 ' || n returning id into o1;
    insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, opportunity_id) values (v_org, ua, prof, (array[p1, p2, p3, p4])[n], svc, tstzrange(now() + make_interval(days => 1 + n), now() + make_interval(days => 1 + n, mins => 50)), o1);
    update public.opportunities set stage_id = st_sched where id = o1;
  end loop;

  -- ---------------- 1. autorização do estado e do convite
  set local role authenticated; perform pg_temp.as_user(u_phy);
  j := public.portal_access_state(p1);
  rep := rep || pg_temp.chk((j ->> 'has_email')::boolean and j ->> 'account' = 'none' and (j ->> 'email_masked') = 'p***@n***.local' and not (j::text like '%paciente.um@%'), 'a fisioterapeuta com vínculo vê o estado do acesso; o e-mail vem MASCARADO');
  rep := rep || pg_temp.chk((public.portal_access_state(p2) ->> 'has_email')::boolean = false, 'sem e-mail cadastrado: has_email = false ("Acesso pendente — cadastrar e-mail")');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_portal_access(%L, ''digitado.na.hora@n20.local'')', p1)) like '%e-mail já cadastrado%', 'fisioterapeuta NÃO convida um e-mail digitado na hora (só o cadastrado da pessoa)');
  perform pg_temp.as_user(u_phy2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.portal_access_state(%L)', p1)) like '42501%' and pg_temp.err(format('select public.person_portal_access(%L, ''paciente.um@n20.local'')', p1)) like '42501%', 'outra fisioterapeuta (sem vínculo) não consulta nem convida');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.portal_access_state(%L)', p1)) like '42501%', 'comercial não consulta o acesso');
  perform pg_temp.as_user(u_p2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.portal_access_state(%L)', p1)) like '42501%', 'paciente não consulta o acesso de outro');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.person_portal_access(%L, ''paciente.um@n20.local'')', p1)) is null, 'a gestão continua podendo convidar (comportamento anterior preservado)');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.portal_invite_run(%L, %L)', p1, u_phy)) is not null and pg_temp.err(format('select public.portal_invite_result(%L, ''accepted'', null)', gen_random_uuid())) is not null, 'a execução do convite NÃO é chamável pelo navegador (só service_role)');
  reset role;

  -- ---------------- 2. execução (como a Edge Function, com service_role): convite novo
  j := public.portal_invite_run(p1, u_phy);
  rep := rep || pg_temp.chk(j ->> 'status' = 'invited' and j ->> 'email' = 'paciente.um@n20.local' and j ->> 'invite_id' is not null, 'conta inexistente + e-mail cadastrado: convite registrado (o e-mail completo só vai à função que envia)');
  v_inv := (j ->> 'invite_id')::uuid;
  rep := rep || pg_temp.chk((select count(*) from public.invitations where person_id = p1 and role = 'member' and accepted_at is null and revoked_at is null) = 1, 'um convite aberto, ligado à pessoa certa');
  rep := rep || pg_temp.chk(not exists (select 1 from public.portal_invites where person_id = p1 and (email_masked like '%paciente.um%')) and (select email_masked from public.portal_invites where id = v_inv) = 'p***@n***.local' and (select outcome from public.portal_invites where id = v_inv) = 'pending', 'o registro do envio guarda só o e-mail mascarado e começa "pendente"');
  perform public.portal_invite_result(v_inv, 'accepted', null);
  rep := rep || pg_temp.chk((select outcome from public.portal_invites where id = v_inv) = 'accepted', 'envio ACEITO pelo serviço de e-mail é registrado (entrega confirmada não é rastreada)');
  rep := rep || pg_temp.chk(public.portal_invite_run(p1, u_phy) ->> 'status' = 'throttled', 'reenvio em menos de 10 min depois de aceito é limitado (sem spam)');
  update public.portal_invites set requested_at = now() - interval '11 minutes' where id = v_inv;
  rep := rep || pg_temp.chk(public.portal_invite_run(p1, u_phy) ->> 'status' = 'invited' and (select count(*) from public.invitations where person_id = p1 and role = 'member' and accepted_at is null and revoked_at is null) = 1, 'depois de 10 min o reenvio reaproveita o MESMO convite aberto (não duplica)');
  update public.invitations set expires_at = now() - interval '1 day' where person_id = p1 and role = 'member' and accepted_at is null;
  update public.portal_invites set requested_at = now() - interval '2 hours' where person_id = p1;
  j := public.portal_invite_run(p1, u_phy);
  rep := rep || pg_temp.chk(j ->> 'status' = 'invited' and (j ->> 'reused') = 'false' and (select count(*) from public.invitations where person_id = p1 and role = 'member') = 2, 'convite VENCIDO: o reenvio cria um convite novo (o vencido não é reativado)');

  -- ---------------- 3. conta existente, sem e-mail, vínculo encerrado
  j := public.portal_invite_run(p3, u_phy);
  rep := rep || pg_temp.chk(j ->> 'status' = 'linked' and (j ->> 'email') is null, 'conta existente com e-mail cadastrado da pessoa: identidade REUTILIZADA (ligada), nenhum e-mail enviado');
  rep := rep || pg_temp.chk(exists (select 1 from public.user_accounts where user_id = u_ex and person_id = p3) and exists (select 1 from public.role_assignments where user_id = u_ex and role = 'member'), 'a conta existente passa a ser o acesso desta pessoa (papel paciente)');
  rep := rep || pg_temp.chk((select encrypted_password from auth.users where id = u_ex) is null, 'a senha da conta existente NÃO é tocada');
  rep := rep || pg_temp.chk(public.portal_invite_run(p2, u_phy) ->> 'status' = 'no_email', 'sem e-mail cadastrado: "no_email" — nada é desfeito, a avaliação e a prévia seguem');
  rep := rep || pg_temp.chk(pg_temp.err(format('select private.person_portal_access_core(%L, %L, ''naocadastrado@n20.local'', %L)', v_org, p4, u_phy)) like '%cadastrados desta pessoa%', 'conta cujo e-mail NÃO é cadastrado da pessoa nunca é vinculada por coincidência');
  insert into public.person_contacts (org_id, person_id, type, value) values (v_org, p4, 'email', 'p2@n20.local');
  rep := rep || pg_temp.chk(pg_temp.err(format('select private.person_portal_access_core(%L, %L, ''p2@n20.local'', %L)', v_org, p4, u_phy)) like '%ligada a outra pessoa%', 'conta já ligada a OUTRA pessoa nunca é movida, mesmo com o e-mail cadastrado');
  -- vínculo encerrado por perda: convite antigo não reativa
  select id into o2 from public.opportunities where person_id = p4 and org_id = v_org limit 1;
  update public.opportunities set stage_id = st_lost, status = 'lost', lost_reason_id = v_lr where id = o2;
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where person_id = p4) = 'ended' and public.portal_invite_run(p4, u_phy) ->> 'status' = 'no_enrollment', 'vínculo encerrado: não há convite (acesso antigo não é reativado)');
  raise exception 'RELATORIO_N20%', rep;
end $$;
