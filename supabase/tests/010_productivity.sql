-- Teste de produtividade pessoal (Meu dia / foco). Transação desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; u_mgr uuid := gen_random_uuid(); u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  prof uuid; svc uuid; pa uuid; opp uuid; day date := current_date; tA uuid; tPriv uuid; appt uuid; ct uuid; fs uuid;
  n int; ok boolean; rep text := ''; d jsonb; v_title text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@t.local'),(u_a,'authenticated','authenticated','a@t.local'),(u_b,'authenticated','authenticated','b@t.local'),(u_phy,'authenticated','authenticated','phy@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_mgr, v_org, 'Gestor'),(u_a, v_org, 'Fulana'),(u_b, v_org, 'Beltrano'),(u_phy, v_org, 'Fisio Prod');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_a, 'sales', v_ua),(v_org, u_b, 'sales', v_ua),(v_org, u_phy, 'physio', v_ua);
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy, 'Fisio Prod') returning id into prof;
  insert into public.professional_units values (prof, v_ua);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão prod (teste)', 60) returning id into svc;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente Prod') returning id into pa;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title)
    select v_org, v_ua, pa, id, s.id, 'Opp prod' from public.pipelines pl join public.pipeline_stages s on s.pipeline_id = pl.id and s.position = 1 where pl.org_id = v_org and pl.kind = 'patients' returning id into opp;
  insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, due_at) values (v_org, v_ua, opp, pa, u_a, 'follow_up', 'Ligar para paciente', now()) returning id into ct;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, v_ua, prof, pa, svc, tstzrange(now() + interval '1 hour', now() + interval '2 hours'), 'scheduled') returning id into appt;

  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.staff_tasks (org_id, owner_user_id, unit_id, title, task_date, start_time, opportunity_id, person_id, visibility)
    values (v_org, u_a, v_ua, 'Preparar proposta', day, '09:00', opp, pa, 'private') returning id into tPriv;
  insert into public.staff_tasks (org_id, owner_user_id, unit_id, title, task_date, visibility) values (v_org, u_a, v_ua, 'Tarefa privada A', day, 'private') returning id into tA;
  insert into public.staff_tasks (org_id, owner_user_id, unit_id, title, task_date, visibility) values (v_org, u_a, v_ua, 'Reunião de equipe', day, 'team');
  reset role;

  -- isolamento entre colegas
  perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.staff_tasks where visibility = 'private'; rep := rep || format(E'\n[%s] colega não vê tarefas privadas de outra pessoa (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.staff_tasks where visibility = 'team'; rep := rep || format(E'\n[%s] colega da mesma unidade vê a tarefa marcada como "equipe" (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.staff_task_toggle(tA); exception when others then ok := true; end;
  select count(*) into n from public.staff_tasks t where t.id = tA and t.completed_at is not null;
  rep := rep || format(E'\n[%s] colega não conclui tarefa alheia (tentativa silenciosa não altera nada, %s concluídas)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  -- visibilidade de equipe explícita: gestor NÃO vê a privada, mas vê a marcada "team"
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.staff_tasks where title = 'Tarefa privada A'; rep := rep || format(E'\n[%s] gestor NÃO vê tarefa privada de outra pessoa (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.staff_tasks where title = 'Reunião de equipe'; rep := rep || format(E'\n[%s] gestor vê tarefa marcada como "equipe" (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  d := public.team_day(day, v_ua); rep := rep || format(E'\n[%s] team_day() traz só as tarefas de equipe da unidade (%s)', case when jsonb_array_length(d) = 1 then 'OK' else 'FALHA' end, d);
  reset role;

  -- "Meu dia" combina sem duplicar: tarefa pessoal + tarefa de CRM atribuída + atendimento como profissional
  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role','authenticated')::text, true);
  set local role authenticated;
  d := public.my_day(day);
  rep := rep || format(E'\n[%s] Meu dia (comercial): 3 tarefas pessoais + 1 tarefa de CRM + 0 atendimentos (tarefas=%s crm=%s appts=%s)',
    case when jsonb_array_length(d -> 'tasks') = 3 and jsonb_array_length(d -> 'crm_tasks') = 1 and jsonb_array_length(d -> 'appointments') = 0 then 'OK' else 'FALHA' end,
    jsonb_array_length(d -> 'tasks'), jsonb_array_length(d -> 'crm_tasks'), jsonb_array_length(d -> 'appointments'));
  rep := rep || format(E'\n[%s] tarefa pessoal ligada à oportunidade mostra o título da oportunidade (%s)', case when (d -> 'tasks' -> 0 ->> 'opportunity_title') = 'Opp prod' or (d -> 'tasks' -> 1 ->> 'opportunity_title') = 'Opp prod' then 'OK' else 'FALHA' end, d -> 'tasks');
  perform public.staff_task_toggle(tPriv); perform public.staff_task_toggle(tPriv);   -- alterna 2x = volta ao estado original
  select completed_at is null into ok from public.staff_tasks where id = tPriv; rep := rep || format(E'\n[%s] alternar concluída funciona (liga/desliga)', case when ok then 'OK' else 'FALHA' end);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  set local role authenticated;
  d := public.my_day(day);
  rep := rep || format(E'\n[%s] Meu dia (fisioterapeuta) traz o atendimento clínico sem duplicar (appts=%s)', case when jsonb_array_length(d -> 'appointments') = 1 then 'OK' else 'FALHA' end, jsonb_array_length(d -> 'appointments'));

  -- sessão de foco: só uma ativa por vez
  fs := public.focus_start(null, 25);
  ok := false; begin perform public.focus_start(null, 25); ok := true; exception when others then ok := false; end;   -- não deve dar erro: encerra a anterior automaticamente
  select count(*) into n from public.focus_sessions where owner_user_id = u_phy and ended_at is null; rep := rep || format(E'\n[%s] iniciar novo foco encerra o anterior (só 1 sessão aberta, %s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select ended_at is not null into ok from public.focus_sessions where id = fs; rep := rep || format(E'\n[%s] sessão anterior foi encerrada automaticamente', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- edição/leitura direta de tarefa alheia via API é negada pela RLS
  perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role','authenticated')::text, true);
  set local role authenticated;
  update public.staff_tasks set title = 'hackeado' where id = tA;
  reset role;
  select title into v_title from public.staff_tasks where id = tA;
  rep := rep || format(E'\n[%s] UPDATE direto em tarefa alheia não altera nada (título continua "%s")', case when v_title = 'Tarefa privada A' then 'OK' else 'FALHA' end, v_title);

  raise exception E'RELATORIO_PRODUTIVIDADE (transação desfeita):%', rep;
end $$;
