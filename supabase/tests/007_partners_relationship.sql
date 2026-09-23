-- Teste parceiros, indicação, repasses, pesquisas, corporativo e privilégios de anon. Transação desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; v_pipe_partner uuid; v_pipe_pat uuid; u_mgr uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_partner uuid := gen_random_uuid(); u_pat uuid := gen_random_uuid();
  pp uuid; ppat uuid; pnew uuid; opp uuid; opp2 uuid; page uuid; fm uuid; code text; pay uuid; n int; ok boolean; rep text := ''; r jsonb; acct uuid; i int; mp uuid; svy uuid; appt uuid; prof uuid; svc uuid; st text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  select id into v_pipe_partner from public.pipelines where org_id = v_org and kind = 'partners';
  select id into v_pipe_pat from public.pipelines where org_id = v_org and kind = 'patients';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@t.local'),(u_fin,'authenticated','authenticated','f@t.local'),(u_partner,'authenticated','authenticated','p@t.local'),(u_pat,'authenticated','authenticated','pat@t.local');
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Dra. Parceira Silva') returning id into pp;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente Indicado') returning id into ppat;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Candidata Nova') returning id into pnew;
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, pnew, 'email', 'candidata@example.com', true);
  insert into public.user_accounts (user_id, org_id, person_id) values (u_mgr, v_org, null),(u_fin, v_org, null),(u_partner, v_org, pp),(u_pat, v_org, ppat);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_fin, 'finance', v_ua),(v_org, u_partner, 'partner', null),(v_org, u_pat, 'member', null);

  -- privilégios de anon: só 3 RPCs públicas
  n := coalesce(array_length(private.anon_extra_functions(), 1), 0);
  rep := rep || format(E'\n[%s] anon executa somente as 3 RPCs públicas (extras: %s)', case when n = 0 then 'OK' else 'FALHA' end, n);

  -- aprovação de parceiro pelo funil
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title)
    select v_org, v_ua, pnew, v_pipe_partner, id, 'Inscrição parceiro' from public.pipeline_stages where pipeline_id = v_pipe_partner and position = 1 returning id into opp;
  update public.opportunities set stage_id = (select id from public.pipeline_stages where pipeline_id = v_pipe_partner and kind = 'won') where id = opp;
  select count(*) into n from public.partner_profiles where person_id = pnew and status = 'active';
  rep := rep || format(E'\n[%s] funil de parceiros: etapa Ativo cria perfil de parceiro ativo (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.invitations where email = 'candidata@example.com' and role = 'partner' and person_id = pnew;
  rep := rep || format(E'\n[%s] aprovação gera convite de acesso ao portal (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.domain_events where type = 'opportunity.won' and aggregate_id = opp and status = 'processed';
  rep := rep || format(E'\n[%s] evento opportunity.won processado', case when n = 1 then 'OK' else 'FALHA' end);

  -- indicação rastreável (código na URL -> formulário -> vínculo)
  perform set_config('request.jwt.claims', json_build_object('sub', u_partner, 'role','authenticated')::text, true);
  set local role authenticated;
  code := public.referral_code_get();
  rep := rep || format(E'\n[%s] parceiro obtém código de indicação estável', case when code is not null and code = public.referral_code_get() then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  page := public.page_create('indicacao-teste', 'Indicação teste', 'blank', '[{"type":"form","form_id":"__DEFAULT_FORM__"}]', v_ua, v_pipe_pat);
  perform public.page_publish(page);
  reset role;
  select id into fm from public.forms where page_id = page;
  set local role anon;
  r := public.submit_public_form(fm, '{"name":"Paciente Vindo Por Indicacao","phone":"11933332222"}', jsonb_build_object('ref', code));
  reset role;
  select count(*) into n from public.referrals where referrer_person_id = pp; rep := rep || format(E'\n[%s] envio com ?ref=CODIGO registra a indicação (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_partner, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.partner_my_referrals() where first_name = 'Paciente' and stage_name is not null;
  rep := rep || format(E'\n[%s] parceiro vê só primeiro nome e etapa do indicado (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.people where id <> pp; rep := rep || format(E'\n[%s] parceiro não lê cadastro de outras pessoas (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.opportunities; rep := rep || format(E'\n[%s] parceiro não lê oportunidades (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  -- repasses autorizados
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.partner_payouts (org_id, unit_id, partner_person_id, description, amount_cents, created_by) values (v_org, v_ua, pp, 'Repasse teste', 15000, u_fin) returning id into pay;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_partner, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.partner_payouts; rep := rep || format(E'\n[%s] parceiro não vê repasse pendente (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.payout_set_status(pay, 'paid'); exception when others then ok := true; end; rep := rep || format(E'\n[%s] não paga repasse sem autorizar', case when ok then 'OK' else 'FALHA' end);
  perform public.payout_set_status(pay, 'authorized');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_partner, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.partner_payouts; rep := rep || format(E'\n[%s] parceiro vê repasse autorizado (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  reset role;

  -- pesquisa de satisfação -> tarefa quando nota baixa
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão pesq (teste)', 60) returning id into svc;
  insert into public.professionals (org_id, display_name) values (v_org, 'Fisio Pesq') returning id into prof;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status)
    values (v_org, v_ua, prof, ppat, svc, tstzrange(now() - interval '3 hours', now() - interval '2 hours'), 'attended') returning id into appt;
  select id into svy from public.surveys where org_id = v_org limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.survey_submit(svy, appt, 3::smallint, 'demorou'); perform public.survey_submit(svy, appt, 3::smallint, 'demorou');
  reset role;
  select count(*) into n from public.survey_responses where person_id = ppat; rep := rep || format(E'\n[%s] resposta de pesquisa registrada uma vez (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.crm_tasks where person_id = ppat and title like 'Resposta de satisfação baixa%'; rep := rep || format(E'\n[%s] nota baixa gera tarefa de retorno (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);

  -- corporativo: k-anonimato
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.corporate_accounts (org_id, unit_id, name) values (v_org, v_ua, 'Empresa Teste') returning id into acct;
  insert into public.corporate_members (account_id, person_id) values (acct, ppat);
  select members into n from public.corporate_indicators(acct); rep := rep || format(E'\n[%s] com menos de 5 participantes nenhum indicador é devolvido (%s)', case when n is null then 'OK' else 'FALHA' end, coalesce(n::text, 'nulo'));
  reset role;
  for i in 1..5 loop
    insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Colaborador ' || i) returning id into mp;
    insert into public.corporate_members (account_id, person_id) values (acct, mp);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select members into n from public.corporate_indicators(acct); rep := rep || format(E'\n[%s] com 5+ participantes devolve apenas agregados (membros=%s)', case when n = 6 then 'OK' else 'FALHA' end, n);
  reset role;

  raise exception E'RELATORIO_PARCEIROS (transação desfeita):%', rep;
end $$;
