-- RELEASE v1 — S05: indicadores ampliados (Administrativo, CRM, Captação). Cobre a migration 056.
-- Tudo vive numa unidade NOVA (p_unit = essa unidade), então os números esperados são exatos mesmo no Dev acumulado.
-- Transação sempre desfeita ao final (raise exception com o relatório). Somente Dev/teste.
do $$
declare
  v_org uuid; uz uuid; uy uuid; v_pipe uuid; v_open uuid[]; s_won uuid; s_lost uuid; v_reason uuid;
  u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_uma uuid := gen_random_uuid(); u_umy uuid := gen_random_uuid(); u_none uuid := gen_random_uuid();
  pa uuid; pb uuid; pc uuid; pd uuid; e1 uuid; e2 uuid; o1 uuid; o2 uuid; o3 uuid; o4 uuid;
  pg uuid; fm uuid; svc uuid; prof uuid;
  p_from timestamptz := now() - interval '45 days'; p_to timestamptz := now() + interval '1 day';
  j jsonb; d jsonb; n int; n2 int; c1 int; c2 int; c3 int; c4 int; c5 numeric; dn numeric; dm numeric; ok boolean; rep text := '';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Z (teste S05)', 'teste-z-s05') returning id into uz;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Y (teste S05)', 'teste-y-s05') returning id into uy;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s05.local'),(u_sales,'authenticated','authenticated','s@s05.local'),
    (u_uma,'authenticated','authenticated','uma@s05.local'),(u_umy,'authenticated','authenticated','umy@s05.local'),(u_none,'authenticated','authenticated','n@s05.local');
  insert into public.user_accounts (user_id, org_id, person_id) values (u_mgr, v_org, null),(u_sales, v_org, null),(u_uma, v_org, null),(u_umy, v_org, null),(u_none, v_org, null);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', uz),(v_org, u_uma, 'unit_manager', uz),(v_org, u_umy, 'unit_manager', uy);

  -- ---------------- Administrativo: PF a (completa, ativo), b (sem documento e sem contato, pendente), c (completa, inativo); PJ e1 completa, e2 incompleta
  insert into public.people (org_id, unit_id, full_name, document_number, city, state_uf, registration_status) values (v_org, uz, 'PF A S05', lpad((floor(random() * 1e11))::bigint::text, 11, '0'), 'Santos', 'SP', 'ativo') returning id into pa;
  insert into public.people (org_id, unit_id, full_name, city, state_uf, registration_status) values (v_org, uz, 'PF B S05', 'Santos', 'SP', 'pendente') returning id into pb;
  insert into public.people (org_id, unit_id, full_name, document_number, city, state_uf, registration_status) values (v_org, uz, 'PF C S05', lpad((floor(random() * 1e11))::bigint::text, 11, '0'), 'Santos', 'SP', 'inativo') returning id into pc;
  insert into public.people (org_id, unit_id, full_name, document_number, city, state_uf, registration_status) values (v_org, uz, 'PF D S05', lpad((floor(random() * 1e11))::bigint::text, 11, '0'), 'Santos', 'SP', 'ativo') returning id into pd;
  insert into public.person_contacts (org_id, person_id, type, value) values (v_org, pa, 'email', 'a@s05.local'),(v_org, pc, 'email', 'c@s05.local'),(v_org, pd, 'email', 'd@s05.local');
  insert into public.person_kinds (person_id, kind) values (pa, 'patient'),(pb, 'lead'),(pc, 'patient'),(pc, 'partner'),(pd, 'lead');
  insert into public.legal_entities (org_id, legal_name, cnpj, city, state_uf, email_general, registration_status) values (v_org, 'Empresa Completa S05', lpad((floor(random() * 1e14))::bigint::text, 14, '0'), 'Santos', 'SP', 'e1@s05.local', 'ativo') returning id into e1;
  insert into public.legal_entities (org_id, legal_name, registration_status) values (v_org, 'Empresa Incompleta S05', 'pendente') returning id into e2;
  insert into public.legal_entity_units (legal_entity_id, unit_id) values (e1, uz),(e2, uz);

  -- ---------------- CRM: funil de pacientes; oportunidades com histórico de etapas em datas conhecidas
  select id into v_pipe from public.pipelines where org_id = v_org and kind = 'patients' and active order by created_at limit 1;
  select array_agg(id order by position) into v_open from public.pipeline_stages where pipeline_id = v_pipe and kind = 'open';
  select id into s_won from public.pipeline_stages where pipeline_id = v_pipe and kind = 'won' limit 1;
  select id into s_lost from public.pipeline_stages where pipeline_id = v_pipe and kind = 'lost' limit 1;
  select id into v_reason from public.loss_reasons where org_id = v_org order by name limit 1;
  if v_reason is null then insert into public.loss_reasons (org_id, name) values (v_org, 'Motivo S05') returning id into v_reason; end if;
  -- o1: s1 (20d atrás) -> s2 (10d) -> s3 (3d), em aberto, origem quiz
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, source) values (v_org, uz, pa, v_pipe, v_open[1], u_sales, 'Opp 1 S05', 'quiz') returning id into o1;
  update public.opportunities set stage_id = v_open[2] where id = o1; update public.opportunities set stage_id = v_open[3] where id = o1;
  -- o2: s1 (12d) -> s2 (5d) -> ganha (2d), origem quiz, valor 100,00
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, source, value_cents) values (v_org, uz, pc, v_pipe, v_open[1], u_sales, 'Opp 2 S05', 'quiz', 10000) returning id into o2;
  update public.opportunities set stage_id = v_open[2] where id = o2; update public.opportunities set stage_id = s_won where id = o2;
  -- o3: s1 (8d) -> perdida (1d), origem site
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, source) values (v_org, uz, pd, v_pipe, v_open[1], u_sales, 'Opp 3 S05', 'site') returning id into o3;
  update public.opportunities set stage_id = s_lost, lost_reason_id = v_reason where id = o3;
  -- o4: s1 (1d), em aberto, sem responsável nem origem
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, uz, pb, v_pipe, v_open[1], 'Opp 4 S05') returning id into o4;
  -- datas controladas: eventos (por ordem de criação) e datas da oportunidade
  update public.opportunity_events e set created_at = now() - make_interval(days => x.dd) from (select id, (array[20,10,3])[row_number() over (order by id)] dd from public.opportunity_events where opportunity_id = o1) x where e.id = x.id;
  update public.opportunity_events e set created_at = now() - make_interval(days => x.dd) from (select id, (array[12,5,2])[row_number() over (order by id)] dd from public.opportunity_events where opportunity_id = o2) x where e.id = x.id;
  update public.opportunity_events e set created_at = now() - make_interval(days => x.dd) from (select id, (array[8,1])[row_number() over (order by id)] dd from public.opportunity_events where opportunity_id = o3) x where e.id = x.id;
  update public.opportunity_events e set created_at = now() - interval '1 day' where e.opportunity_id = o4;
  update public.opportunities set created_at = now() - interval '20 days' where id = o1;
  update public.opportunities set created_at = now() - interval '12 days', closed_at = now() - interval '2 days' where id = o2;
  update public.opportunities set created_at = now() - interval '8 days', closed_at = now() - interval '1 day' where id = o3;
  update public.opportunities set created_at = now() - interval '1 day' where id = o4;

  -- ---------------- Captação: 4 quizzes (2 atendimento concluído/abandonado/em andamento + 1 parceria) e 1 formulário; atendimento realizado para a pessoa a
  insert into public.quiz_leads (org_id, unit_id, journey, version, status, step_reached, dedupe_key, person_id, opportunity_id, full_name, email, phone, contact_consent_version, utm, started_at, last_activity_at, completed_at, whatsapp_clicked_at)
    values (v_org, uz, 'atendimento', 'v1', 'completed', 10, 's05-q1', pa, o1, 'Quiz 1 S05', 'q1@s05.local', '11900000001', 't', '{"utm_source":"instagram","utm_campaign":"c1"}', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days');
  insert into public.quiz_leads (org_id, unit_id, journey, version, status, step_reached, dedupe_key, person_id, full_name, email, phone, contact_consent_version, utm, started_at, last_activity_at)
    values (v_org, uz, 'atendimento', 'v1', 'partial', 3, 's05-q2', pb, 'Quiz 2 S05', 'q2@s05.local', '11900000002', 't', '{}', now() - interval '3 days', now() - interval '3 days');
  insert into public.quiz_leads (org_id, unit_id, journey, version, status, step_reached, dedupe_key, full_name, email, phone, contact_consent_version, utm, started_at, last_activity_at)
    values (v_org, uz, 'atendimento', 'v1', 'partial', 5, 's05-q3', 'Quiz 3 S05', 'q3@s05.local', '11900000003', 't', '{"utm_source":"instagram","utm_campaign":"c1"}', now() - interval '1 hour', now() - interval '30 minutes');
  insert into public.quiz_leads (org_id, unit_id, journey, version, status, step_reached, dedupe_key, person_id, opportunity_id, full_name, email, phone, contact_consent_version, utm, started_at, last_activity_at, completed_at)
    values (v_org, uz, 'parceria', 'v1', 'completed', 10, 's05-q4', pc, o2, 'Quiz 4 S05', 'q4@s05.local', '11900000004', 't', '{"utm_source":"google","utm_campaign":"c2"}', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days');
  insert into public.pages (org_id, unit_id, slug, title) values (v_org, uz, 's05-' || substr(md5(random()::text), 1, 8), 'Página S05') returning id into pg;
  insert into public.forms (org_id, page_id, unit_id, name, fields) values (v_org, pg, uz, 'Form S05', '[{"key":"name","type":"text","label":"Nome"},{"key":"email","type":"email","label":"E-mail"}]') returning id into fm;
  insert into public.form_submissions (org_id, form_id, page_id, person_id, opportunity_id, answers, utm, dedupe_key, created_at)
    values (v_org, fm, pg, pd, o3, '{"name":"D"}', '{"utm_source":"instagram","utm_campaign":"c1"}', 's05-f1', now() - interval '1 day');
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço S05', 30) returning id into svc;
  insert into public.professionals (org_id, display_name) values (v_org, 'Prof S05') returning id into prof;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status)
    values (v_org, uz, prof, pa, svc, tstzrange(now() - interval '1 day', now() - interval '1 day' + interval '30 minutes'), 'attended');
  insert into public.sales (org_id, unit_id, person_id, status, total_cents, subtotal_cents, sold_at) values (v_org, uz, pa, 'confirmed', 10000, 10000, now() - interval '12 hours');

  -- =============================================================== ADMINISTRATIVO
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.adm_dashboard(p_from, p_to, uz);
  rep := rep || format(E'\n[%s] ADM: total=6 (4 PF + 2 PJ) na unidade de teste (obtido %s/%s/%s)', case when (j -> 'total' ->> 'value')::int = 6 and (j -> 'pf' ->> 'value')::int = 4 and (j -> 'pj' ->> 'value')::int = 2 then 'OK' else 'FALHA' end, j -> 'total' ->> 'value', j -> 'pf' ->> 'value', j -> 'pj' ->> 'value');
  rep := rep || format(E'\n[%s] ADM: novos no período = todos os criados agora (PF 4 + PJ 2 = 6)', case when (j -> 'new' ->> 'value')::int = 6 and (j ->> 'new_pf')::int = 4 and (j ->> 'new_pj')::int = 2 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] ADM: status cadastral — PF ativo 2 / pendente 1 / inativo 1; PJ ativo 1 / pendente 1', case when (j -> 'status' -> 0 ->> 'pf')::int = 2 and (j -> 'status' -> 1 ->> 'pf')::int = 1 and (j -> 'status' -> 2 ->> 'pf')::int = 1 and (j -> 'status' -> 0 ->> 'pj')::int = 1 and (j -> 'status' -> 1 ->> 'pj')::int = 1 and (j -> 'status' -> 2 ->> 'pj')::int = 0 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] ADM: incompletos = PF B + PJ e2 = 2 (obtido %s)', case when (j -> 'incomplete' ->> 'value')::int = 2 then 'OK' else 'FALHA' end, j -> 'incomplete' ->> 'value');
  rep := rep || format(E'\n[%s] ADM: campos faltantes — documento PF1/PJ1 (b sem documento; e2 sem CNPJ), cidade PF0/PJ1, UF PF0/PJ1, contato PF1/PJ1', case when
      (j -> 'missing' -> 0 ->> 'pf')::int = 1 and (j -> 'missing' -> 0 ->> 'pj')::int = 1 and (j -> 'missing' -> 1 ->> 'pf')::int = 0 and (j -> 'missing' -> 1 ->> 'pj')::int = 1
      and (j -> 'missing' -> 2 ->> 'pf')::int = 0 and (j -> 'missing' -> 2 ->> 'pj')::int = 1 and (j -> 'missing' -> 3 ->> 'pf')::int = 1 and (j -> 'missing' -> 3 ->> 'pj')::int = 1 then 'OK' else 'FALHA' end);
  select coalesce((x ->> 'n')::int, 0) into n from jsonb_array_elements(j -> 'by_kind') x where x ->> 'kind' = 'patient';
  select coalesce((x ->> 'n')::int, 0) into n2 from jsonb_array_elements(j -> 'by_kind') x where x ->> 'kind' = 'lead';
  rep := rep || format(E'\n[%s] ADM: por vínculo — paciente 2 (a, c), lead 2 (b, d); uma pessoa pode ter vários vínculos (obtido %s/%s)', case when n = 2 and n2 = 2 then 'OK' else 'FALHA' end, n, n2);
  rep := rep || format(E'\n[%s] ADM: por unidade — unidade de teste com PF 4 e PJ 2', case when (j -> 'by_unit' -> 0 ->> 'pf')::int = 4 and (j -> 'by_unit' -> 0 ->> 'pj')::int = 2 and jsonb_array_length(j -> 'by_unit') = 1 then 'OK' else 'FALHA' end);
  d := public.adm_indicator_detail('incomplete', null, p_from, p_to, uz);
  rep := rep || format(E'\n[%s] ADM detalhe: incompletos reconcilia com o cartão (lista=%s, cartão=%s)', case when (d ->> 'total_items')::int = (j -> 'incomplete' ->> 'value')::int and jsonb_array_length(d -> 'items') = 2 then 'OK' else 'FALHA' end, d ->> 'total_items', j -> 'incomplete' ->> 'value');
  d := public.adm_indicator_detail('pf', null, p_from, p_to, uz);   rep := rep || format(E'\n[%s] ADM detalhe: PF reconcilia (%s)', case when (d ->> 'total_items')::int = (j -> 'pf' ->> 'value')::int then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.adm_indicator_detail('pj', null, p_from, p_to, uz);   rep := rep || format(E'\n[%s] ADM detalhe: PJ reconcilia (%s)', case when (d ->> 'total_items')::int = 2 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.adm_indicator_detail('missing', 'contato', p_from, p_to, uz); rep := rep || format(E'\n[%s] ADM detalhe: sem contato = 2 (PF b e PJ e2) (%s)', case when (d ->> 'total_items')::int = 2 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.adm_indicator_detail('status', 'inativo', p_from, p_to, uz); rep := rep || format(E'\n[%s] ADM detalhe: inativos = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.adm_indicator_detail('kind', 'partner', p_from, p_to, uz); rep := rep || format(E'\n[%s] ADM detalhe: vínculo parceiro = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.adm_indicator_detail('new', null, p_from, p_to, uz);  rep := rep || format(E'\n[%s] ADM detalhe: novos = 6 (%s)', case when (d ->> 'total_items')::int = 6 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.adm_indicator_detail('new', null, now() + interval '2 days', now() + interval '3 days', uz); rep := rep || format(E'\n[%s] ADM detalhe: período sem cadastros = 0 (nada inventado) (%s)', case when (d ->> 'total_items')::int = 0 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.adm_indicator_detail('unit', uz::text, p_from, p_to, uz); rep := rep || format(E'\n[%s] ADM detalhe: por unidade = 6 (%s)', case when (d ->> 'total_items')::int = 6 then 'OK' else 'FALHA' end, d ->> 'total_items');
  ok := false; begin perform public.adm_indicator_detail('inexistente', null, p_from, p_to, uz); exception when others then ok := sqlerrm like '%desconhecido%'; end;
  rep := rep || format(E'\n[%s] ADM detalhe: indicador desconhecido é recusado', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_uma, 'role','authenticated')::text, true);
  j := public.adm_dashboard(p_from, p_to, uz);
  rep := rep || format(E'\n[%s] ADM: gestor da unidade vê a própria unidade (total %s)', case when (j -> 'total' ->> 'value')::int = 6 then 'OK' else 'FALHA' end, j -> 'total' ->> 'value');
  perform set_config('request.jwt.claims', json_build_object('sub', u_umy, 'role','authenticated')::text, true);
  ok := false; begin perform public.adm_dashboard(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] ADM: gestor de OUTRA unidade não abre o painel desta unidade', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_none, 'role','authenticated')::text, true);
  ok := false; begin perform public.adm_dashboard(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] ADM: usuário sem papel não abre o painel', case when ok then 'OK' else 'FALHA' end);

  -- =============================================================== CRM
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  j := public.crm_analytics(p_from, p_to, uz, null, v_pipe, 7);
  rep := rep || format(E'\n[%s] CRM: coorte = 4 criadas no período; em aberto agora = 2 (o1, o4)', case when (j -> 'cohort' ->> 'value')::int = 4 and (j -> 'open_total' ->> 'value')::int = 2 then 'OK' else 'FALHA' end);
  select (x ->> 'n')::int, (x ->> 'avg_days')::numeric into n, dn from jsonb_array_elements(j -> 'stage_now') x where x ->> 'stage_id' = v_open[3]::text;
  rep := rep || format(E'\n[%s] CRM: tempo na etapa atual — o1 está na 3ª etapa há ~3,0 dias (n=%s, média=%s)', case when n = 1 and dn between 2.9 and 3.1 then 'OK' else 'FALHA' end, n, dn);
  select (x ->> 'avg_days')::numeric into dn from jsonb_array_elements(j -> 'stage_now') x where x ->> 'stage_id' = v_open[1]::text;
  rep := rep || format(E'\n[%s] CRM: o4 está na 1ª etapa há ~1,0 dia (média=%s)', case when dn between 0.9 and 1.1 then 'OK' else 'FALHA' end, dn);
  select (x ->> 'n')::int, (x ->> 'avg_days')::numeric, (x ->> 'median_days')::numeric into n, dn, dm from jsonb_array_elements(j -> 'stage_history') x where x ->> 'stage_id' = v_open[1]::text;
  rep := rep || format(E'\n[%s] CRM: histórico da 1ª etapa — 3 passagens (10, 7 e 7 dias): média 8,0 e mediana 7,0 (n=%s média=%s mediana=%s)', case when n = 3 and dn between 7.9 and 8.1 and dm between 6.9 and 7.1 then 'OK' else 'FALHA' end, n, dn, dm);
  select (x ->> 'n')::int, (x ->> 'avg_days')::numeric into n, dn from jsonb_array_elements(j -> 'stage_history') x where x ->> 'stage_id' = v_open[2]::text;
  rep := rep || format(E'\n[%s] CRM: histórico da 2ª etapa — 2 passagens (7 e 3 dias): média 5,0 (n=%s média=%s)', case when n = 2 and dn between 4.9 and 5.1 then 'OK' else 'FALHA' end, n, dn);
  rep := rep || format(E'\n[%s] CRM: chegaram à 1ª/2ª/3ª etapa = 4/2/2 (a ganha conta em todas as etapas abertas; a perdida só onde esteve)', case when (j -> 'chain' -> 0 ->> 'reached')::int = 4 and (j -> 'chain' -> 1 ->> 'reached')::int = 2 and (j -> 'chain' -> 2 ->> 'reached')::int = 2 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] CRM: conversão da 2ª etapa sobre a anterior = 50,0%% e sobre a 1ª = 50,0%%', case when (j -> 'chain' -> 1 ->> 'conv_prev_pct')::numeric = 50.0 and (j -> 'chain' -> 1 ->> 'conv_first_pct')::numeric = 50.0 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] CRM: conversão geral = ganhas ÷ criadas = 1/4 = 25,0%% (obtido %s)', case when (j -> 'overall_conversion' ->> 'value')::numeric = 25.0 then 'OK' else 'FALHA' end, j -> 'overall_conversion' ->> 'value');
  rep := rep || format(E'\n[%s] CRM: taxa de ganho (fechadas) = 1/(1+1) = 50,0%% (obtido %s)', case when (j -> 'win_rate_closed' ->> 'value')::numeric = 50.0 then 'OK' else 'FALHA' end, j -> 'win_rate_closed' ->> 'value');
  rep := rep || format(E'\n[%s] CRM: ciclo de venda da ganha = 10 dias (média %s, mediana %s)', case when (j -> 'cycle_avg_days' ->> 'value')::numeric between 9.9 and 10.1 and (j -> 'cycle_median_days' ->> 'value')::numeric between 9.9 and 10.1 then 'OK' else 'FALHA' end, j -> 'cycle_avg_days' ->> 'value', j -> 'cycle_median_days' ->> 'value');
  rep := rep || format(E'\n[%s] CRM: motivos de perda — 1 perdida, 100%%', case when jsonb_array_length(j -> 'loss_reasons') = 1 and (j -> 'loss_reasons' -> 0 ->> 'n')::int = 1 and (j -> 'loss_reasons' -> 0 ->> 'pct')::numeric = 100.0 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] CRM: paradas com limite de 7 dias = 0; com limite de 2 dias = 1 (o1, 3 dias sem movimento)', case when (j -> 'stalled' ->> 'value')::int = 0 and ((public.crm_analytics(p_from, p_to, uz, null, v_pipe, 2)) -> 'stalled' ->> 'value')::int = 1 then 'OK' else 'FALHA' end);
  select (x ->> 'created')::int, (x ->> 'won')::int, (x ->> 'lost')::int, (x ->> 'open')::int, (x ->> 'conv_pct')::numeric into c1, c2, c3, c4, c5
    from jsonb_array_elements(j -> 'by_owner') x where x ->> 'owner_id' = u_sales::text;
  rep := rep || format(E'\n[%s] CRM: por responsável — criadas 3, ganhas 1, perdidas 1, em aberto 1, conversão 50,0%% (obtido %s/%s/%s/%s/%s)', case when c1 = 3 and c2 = 1 and c3 = 1 and c4 = 1 and c5 = 50.0 then 'OK' else 'FALHA' end, c1, c2, c3, c4, c5);
  select (x ->> 'created')::int, (x ->> 'open')::int into c1, c2 from jsonb_array_elements(j -> 'by_owner') x where x ->> 'owner_id' is null;
  rep := rep || format(E'\n[%s] CRM: oportunidade sem responsável aparece em linha própria (criadas 1, em aberto 1)', case when c1 = 1 and c2 = 1 then 'OK' else 'FALHA' end);
  select (x ->> 'created')::int, (x ->> 'won')::int, (x ->> 'conv_pct')::numeric into c1, c2, c5 from jsonb_array_elements(j -> 'by_source') x where x ->> 'source' = 'quiz';
  select (x ->> 'lost')::int, (x ->> 'conv_pct')::numeric::int into c3, c4 from jsonb_array_elements(j -> 'by_source') x where x ->> 'source' = 'site';
  rep := rep || format(E'\n[%s] CRM: por origem — quiz criadas 2 / ganhas 1 / conv 100,0%%; site perdidas 1 / conv 0,0%%', case when c1 = 2 and c2 = 1 and c5 = 100.0 and c3 = 1 and c4 = 0 then 'OK' else 'FALHA' end);
  select (x ->> 'created')::int into c1 from jsonb_array_elements(j -> 'by_source') x where x ->> 'source' = 'Sem origem';
  rep := rep || format(E'\n[%s] CRM: origem vazia vira "Sem origem" (criadas 1)', case when c1 = 1 then 'OK' else 'FALHA' end);

  d := public.crm_indicator_detail('created', null, null, p_from, p_to, uz, null, v_pipe, 7);
  rep := rep || format(E'\n[%s] CRM detalhe: criadas reconcilia com a coorte (lista=%s, cartão=%s)', case when (d ->> 'total_items')::int = (j -> 'cohort' ->> 'value')::int and (d ->> 'total_items')::int = 4 then 'OK' else 'FALHA' end, d ->> 'total_items', j -> 'cohort' ->> 'value');
  d := public.crm_indicator_detail('won', null, null, p_from, p_to, uz, null, v_pipe, 7);               rep := rep || format(E'\n[%s] CRM detalhe: ganhas = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.crm_indicator_detail('lost', 'reason', v_reason::text, p_from, p_to, uz, null, v_pipe, 7); rep := rep || format(E'\n[%s] CRM detalhe: perdidas pelo motivo = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.crm_indicator_detail('stalled', null, null, p_from, p_to, uz, null, v_pipe, 2);           rep := rep || format(E'\n[%s] CRM detalhe: paradas (limite 2 dias) = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.crm_indicator_detail('open', 'stage', v_open[3]::text, p_from, p_to, uz, null, v_pipe, 7); rep := rep || format(E'\n[%s] CRM detalhe: em aberto na 3ª etapa = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.crm_indicator_detail('won', 'owner', u_sales::text, p_from, p_to, uz, null, v_pipe, 7);   rep := rep || format(E'\n[%s] CRM detalhe: ganhas do responsável = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.crm_indicator_detail('created', 'source', 'Sem origem', p_from, p_to, uz, null, v_pipe, 7); rep := rep || format(E'\n[%s] CRM detalhe: criadas sem origem = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.crm_indicator_detail('created', 'owner', 'none', p_from, p_to, uz, null, v_pipe, 7);      rep := rep || format(E'\n[%s] CRM detalhe: criadas sem responsável = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  ok := false; begin perform public.crm_indicator_detail('inexistente', null, null, p_from, p_to, uz, null, v_pipe, 7); exception when others then ok := sqlerrm like '%desconhecido%'; end;
  rep := rep || format(E'\n[%s] CRM detalhe: indicador desconhecido é recusado', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  j := public.crm_analytics(p_from, p_to, uz, gen_random_uuid(), v_pipe, 7);
  rep := rep || format(E'\n[%s] CRM: comercial só enxerga os próprios negócios mesmo forçando o filtro de responsável (criadas %s, esperado 3)', case when (j -> 'cohort' ->> 'value')::int = 3 then 'OK' else 'FALHA' end, j -> 'cohort' ->> 'value');
  perform set_config('request.jwt.claims', json_build_object('sub', u_uma, 'role','authenticated')::text, true);
  j := public.crm_analytics(p_from, p_to, uz, null, v_pipe, 7);
  rep := rep || format(E'\n[%s] CRM: gestor da unidade enxerga o time inteiro (criadas %s, esperado 4)', case when (j -> 'cohort' ->> 'value')::int = 4 then 'OK' else 'FALHA' end, j -> 'cohort' ->> 'value');
  perform set_config('request.jwt.claims', json_build_object('sub', u_umy, 'role','authenticated')::text, true);
  ok := false; begin perform public.crm_analytics(p_from, p_to, uz, null, v_pipe, 7); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] CRM: gestor de OUTRA unidade não abre os indicadores desta unidade', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.crm_indicator_detail('created', null, null, p_from, p_to, uz, null, v_pipe, 7); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] CRM detalhe: gestor de outra unidade também é recusado', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_none, 'role','authenticated')::text, true);
  ok := false; begin perform public.crm_analytics(p_from, p_to, uz, null, v_pipe, 7); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] CRM: usuário sem papel não abre os indicadores', case when ok then 'OK' else 'FALHA' end);

  -- =============================================================== CAPTAÇÃO
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  j := public.capture_analytics(p_from, p_to, uz);
  rep := rep || format(E'\n[%s] CAPTAÇÃO: respostas = 5 (4 quizzes + 1 formulário), pessoas distintas = 4, oportunidades distintas = 3 (obtido %s/%s/%s)',
    case when (j -> 'responses' ->> 'value')::int = 5 and (j -> 'people' ->> 'value')::int = 4 and (j -> 'opportunities' ->> 'value')::int = 3 then 'OK' else 'FALHA' end, j -> 'responses' ->> 'value', j -> 'people' ->> 'value', j -> 'opportunities' ->> 'value');
  select (x ->> 'responses')::int, (x ->> 'people')::int, (x ->> 'opportunities')::int into c1, c2, c3 from jsonb_array_elements(j -> 'by_source') x where x ->> 'source_key' = 'quiz:atendimento';
  rep := rep || format(E'\n[%s] CAPTAÇÃO: quiz de atendimento — 3 respostas, 2 pessoas, 1 oportunidade (respostas ≠ pessoas ≠ oportunidades) (obtido %s/%s/%s)', case when c1 = 3 and c2 = 2 and c3 = 1 then 'OK' else 'FALHA' end, c1, c2, c3);
  select (x ->> 'responses')::int, (x ->> 'people')::int, (x ->> 'opportunities')::int into c1, c2, c3 from jsonb_array_elements(j -> 'by_source') x where x ->> 'source_key' = 'form:' || fm::text;
  rep := rep || format(E'\n[%s] CAPTAÇÃO: formulário — 1 resposta, 1 pessoa, 1 oportunidade', case when c1 = 1 and c2 = 1 and c3 = 1 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] CAPTAÇÃO: quizzes — iniciados 4, concluídos 2, abandonados 1 (parou na pergunta 3), em andamento 1', case when (j -> 'quiz' ->> 'started')::int = 4 and (j -> 'quiz' ->> 'completed')::int = 2 and (j -> 'quiz' ->> 'abandoned')::int = 1 and (j -> 'quiz' ->> 'in_progress')::int = 1
      and (j -> 'quiz' -> 'abandoned_by_step' -> 0 ->> 'step')::int = 3 then 'OK' else 'FALHA' end);
  rep := rep || format(E'\n[%s] CAPTAÇÃO: conclusão = 2/4 = 50,0%% e abandono = 1/4 = 25,0%% (obtido %s / %s)', case when (j -> 'quiz' ->> 'completion_rate_pct')::numeric = 50.0 and (j -> 'quiz' ->> 'abandon_rate_pct')::numeric = 25.0 then 'OK' else 'FALHA' end, j -> 'quiz' ->> 'completion_rate_pct', j -> 'quiz' ->> 'abandon_rate_pct');
  rep := rep || format(E'\n[%s] CAPTAÇÃO: cliques no WhatsApp = 1 (e o texto diz que clique não é mensagem enviada)', case when (j -> 'whatsapp_clicks' ->> 'value')::int = 1 and (j -> 'whatsapp_clicks' ->> 'basis') like '%NÃO é uma mensagem enviada%' then 'OK' else 'FALHA' end);
  select (x ->> 'responses')::int, (x ->> 'people')::int, (x ->> 'opportunities')::int into c1, c2, c3 from jsonb_array_elements(j -> 'by_origin') x where x ->> 'origin' = 'instagram';
  rep := rep || format(E'\n[%s] CAPTAÇÃO: origem instagram — 3 respostas, 2 pessoas, 2 oportunidades (obtido %s/%s/%s)', case when c1 = 3 and c2 = 2 and c3 = 2 then 'OK' else 'FALHA' end, c1, c2, c3);
  select (x ->> 'responses')::int into c1 from jsonb_array_elements(j -> 'by_origin') x where x ->> 'origin' = '(sem origem)';
  select (x ->> 'responses')::int into c2 from jsonb_array_elements(j -> 'by_campaign') x where x ->> 'campaign' = 'c1';
  rep := rep || format(E'\n[%s] CAPTAÇÃO: "(sem origem)" = 1 resposta; campanha c1 = 3 respostas', case when c1 = 1 and c2 = 3 then 'OK' else 'FALHA' end);
  select coalesce(sum((x ->> 'responses')::int), 0) into n from jsonb_array_elements(j -> 'series') x;
  rep := rep || format(E'\n[%s] CAPTAÇÃO: a evolução soma as mesmas 5 respostas (%s)', case when n = 5 then 'OK' else 'FALHA' end, n);
  rep := rep || format(E'\n[%s] CAPTAÇÃO: funil — capturadas 4, com oportunidade 3, atendimento agendado 1, realizado 1, venda 1', case when (j -> 'funnel' ->> 'captured')::int = 4 and (j -> 'funnel' ->> 'opportunity')::int = 3 and (j -> 'funnel' ->> 'scheduled')::int = 1
      and (j -> 'funnel' ->> 'attended')::int = 1 and (j -> 'funnel' ->> 'sold')::int = 1 then 'OK' else 'FALHA' end);
  d := public.capture_indicator_detail('responses', null, null, p_from, p_to, uz);  rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: respostas reconcilia (%s)', case when (d ->> 'total_items')::int = (j -> 'responses' ->> 'value')::int then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('completed', null, null, p_from, p_to, uz);  rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: concluídos = 2 (%s)', case when (d ->> 'total_items')::int = 2 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('abandoned', null, null, p_from, p_to, uz);  rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: abandonados = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('in_progress', null, null, p_from, p_to, uz); rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: em andamento = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('whatsapp', null, null, p_from, p_to, uz);   rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: cliques no WhatsApp = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('responses', 'origin', 'instagram', p_from, p_to, uz); rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: origem instagram = 3 (%s)', case when (d ->> 'total_items')::int = 3 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('responses', 'campaign', 'c2', p_from, p_to, uz);    rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: campanha c2 = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('responses', 'source', 'form:' || fm::text, p_from, p_to, uz); rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: fonte formulário = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('funnel', null, 'captured', p_from, p_to, uz);    rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: funil capturadas = 4 (%s)', case when (d ->> 'total_items')::int = 4 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('funnel', null, 'opportunity', p_from, p_to, uz); rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: funil com oportunidade = 3 (%s)', case when (d ->> 'total_items')::int = 3 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_indicator_detail('funnel', null, 'sold', p_from, p_to, uz);        rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: funil com venda = 1 (%s)', case when (d ->> 'total_items')::int = 1 then 'OK' else 'FALHA' end, d ->> 'total_items');
  d := public.capture_analytics(now() + interval '5 days', now() + interval '6 days', uz);
  rep := rep || format(E'\n[%s] CAPTAÇÃO: período sem respostas = 0 (nada inventado) e taxas indisponíveis', case when (d -> 'responses' ->> 'value')::int = 0 and (d -> 'quiz' ->> 'completion_rate_pct') is null then 'OK' else 'FALHA' end);
  ok := false; begin perform public.capture_indicator_detail('funnel', null, 'inexistente', p_from, p_to, uz); exception when others then ok := sqlerrm like '%desconhecida%'; end;
  rep := rep || format(E'\n[%s] CAPTAÇÃO detalhe: etapa de funil desconhecida é recusada', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  j := public.capture_analytics(p_from, p_to, uz);
  rep := rep || format(E'\n[%s] CAPTAÇÃO: comercial da unidade abre os indicadores (respostas %s)', case when (j -> 'responses' ->> 'value')::int = 5 then 'OK' else 'FALHA' end, j -> 'responses' ->> 'value');
  perform set_config('request.jwt.claims', json_build_object('sub', u_umy, 'role','authenticated')::text, true);
  ok := false; begin perform public.capture_analytics(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] CAPTAÇÃO: gestor de OUTRA unidade não abre os indicadores desta unidade', case when ok then 'OK' else 'FALHA' end);
  perform set_config('request.jwt.claims', json_build_object('sub', u_none, 'role','authenticated')::text, true);
  ok := false; begin perform public.capture_analytics(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] CAPTAÇÃO: usuário sem papel não abre os indicadores', case when ok then 'OK' else 'FALHA' end);

  -- =============================================================== superfície pública
  reset role; set local role anon;
  ok := false; begin perform public.adm_dashboard(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa adm_dashboard', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.crm_analytics(p_from, p_to, uz, null, v_pipe, 7); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa crm_analytics', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.capture_analytics(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa capture_analytics', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.adm_indicator_detail('total', null, p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa adm_indicator_detail', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.crm_indicator_detail('created', null, null, p_from, p_to, uz, null, v_pipe, 7); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa crm_indicator_detail', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.capture_indicator_detail('responses', null, null, p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] anon não executa capture_indicator_detail', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_S05_INDICADORES (transação desfeita):%', rep;
end $$;
