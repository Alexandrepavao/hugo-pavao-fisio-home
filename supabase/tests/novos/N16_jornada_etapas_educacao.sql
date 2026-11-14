-- NOVO — N16: jornada do paciente definida pelo fisioterapeuta e conteúdos educativos (migration 129). Transação sempre desfeita. Somente Dev/teste.
--  · só o fisioterapeuta COM vínculo define etapas e etapa atual (3 a 7 etapas, nomes válidos, etapa atual dentro da lista); histórico de cada mudança; nada avança sozinho com as sessões
--  · o paciente lê só a própria jornada (nunca a de outro); sem etapas definidas devolve nulo (a tela mostra o estado honesto)
--  · conteúdos educativos: publicar/revogar só por quem tem vínculo; o paciente lê os do próprio cadastro; gestor/comercial/anônimo não escrevem nem leem como paciente
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true); end $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; svc uuid; pr uuid; p1 uuid; p2 uuid; pe_phy uuid; pe_phy2 uuid; j jsonb; e1 uuid; n int;
  u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid();
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade N16', 'n16-a') returning id into ua;
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@n16.local' from unnest(array[u_phy, u_phy2, u_p1, u_p2, u_sales, u_mgr]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio N16 Um') returning id into pe_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio N16 Dois') returning id into pe_phy2;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Paciente N16 Um', '1980-01-01') returning id into p1;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Paciente N16 Dois', '1980-01-01') returning id into p2;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_phy, v_org, pe_phy, 'Fisio Um'), (u_phy2, v_org, pe_phy2, 'Fisio Dois'), (u_p1, v_org, p1, 'Paciente Um'), (u_p2, v_org, p2, 'Paciente Dois'), (u_sales, v_org, null, 'Comercial'), (u_mgr, v_org, null, 'Gestor');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_phy, 'physio', ua), (v_org, u_phy2, 'physio', ua), (v_org, u_p1, 'member', null), (v_org, u_p2, 'member', null), (v_org, u_sales, 'sales', ua), (v_org, u_mgr, 'manager', null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço N16', 30) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio N16 Um') returning id into pr;
  insert into public.professional_units (professional_id, unit_id) values (pr, ua);
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id) values (v_org, ua, u_phy, p1);
  insert into public.patient_goals (org_id, unit_id, person_id, title) values (v_org, ua, p1, 'Voltar a caminhar com conforto');

  set local role authenticated;
  -- ---------------- sem plano: o fisioterapeuta é orientado a definir o plano antes
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''Avaliação'',''Cuidado inicial'',''Movimento''], 0)', p1)) like '%Defina primeiro o plano%', 'sem plano de sessões ativo, as etapas não são definidas (pede o plano antes)');
  reset role; insert into public.patient_plans (org_id, unit_id, person_id, planned_sessions, started_on) values (v_org, ua, p1, 10, current_date - 20); set local role authenticated; perform pg_temp.as_user(u_p1);
  j := public.my_journey_plan();
  rep := rep || pg_temp.chk(j -> 'stages' = 'null'::jsonb and j -> 'current' = 'null'::jsonb and (j -> 'plan' ->> 'planned_sessions')::int = 10 and j -> 'goal' ->> 'title' = 'Voltar a caminhar com conforto', 'plano sem etapas definidas: o paciente recebe etapas nulas (a tela mostra estado honesto), o plano e o objetivo');

  -- ---------------- definir etapas: só quem tem vínculo e dados válidos
  perform pg_temp.as_user(u_phy2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''A'',''B'',''C''], 0)', p1)) like '42501%', 'fisioterapeuta SEM vínculo não define a jornada');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''Avaliação'',''Cuidado'',''Movimento''], 0)', p1)) like '42501%', 'comercial não define a jornada');
  perform pg_temp.as_user(u_mgr); rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''Avaliação'',''Cuidado'',''Movimento''], 0)', p1)) like '42501%', 'gestor não define a jornada (é decisão clínica do fisioterapeuta)');
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''Avaliação'',''Cuidado''], 0)', p1)) like '%3 a 7 etapas%', 'menos de 3 etapas é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''A1'',''B2'',''C3'',''D4'',''E5'',''F6'',''G7'',''H8''], 0)', p1)) like '%3 a 7 etapas%', 'mais de 7 etapas é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''Avaliação'',''x'',''Movimento''], 0)', p1)) like '%2 a 40%', 'nome de etapa curto demais é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''Avaliação'',''avaliação'',''Movimento''], 0)', p1)) like '%não podem se repetir%', 'etapas repetidas são recusadas');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''Avaliação'',''Cuidado inicial'',''Movimento''], 3)', p1)) like '%etapa atual%', 'etapa atual fora da lista é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.plan_journey_set(%L, array[''Avaliação'',''Cuidado inicial'',''Movimento''], null)', p1)) like '%etapa atual%', 'etapa atual em branco é recusada');
  j := public.plan_journey_set(p1, array['Avaliação', 'Cuidado inicial', 'Movimento', 'Atividades', 'Reavaliação'], 2);
  rep := rep || pg_temp.chk((j ->> 'current')::int = 2 and jsonb_array_length(j -> 'stages') = 5, 'o fisioterapeuta com vínculo define 5 etapas e a etapa atual (Movimento)');

  -- ---------------- o paciente vê o que o profissional registrou; não avança sozinho com as sessões
  perform pg_temp.as_user(u_p1); j := public.my_journey_plan();
  rep := rep || pg_temp.chk((j ->> 'current')::int = 2 and j -> 'stages' ->> 2 = 'Movimento' and j -> 'stages' ->> 0 = 'Avaliação', 'o paciente vê as etapas e a etapa atual exatamente como o profissional registrou');
  reset role; insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) select v_org, ua, pr, p1, svc, tstzrange(now() - (g || ' days')::interval, now() - (g || ' days')::interval + interval '30 minutes'), 'attended' from generate_series(1, 6) g;
  set local role authenticated; perform pg_temp.as_user(u_p1); j := public.my_journey_plan();
  rep := rep || pg_temp.chk((j ->> 'current')::int = 2, '6 sessões realizadas a mais NÃO mudam a etapa (nada avança por quantidade de sessões)');
  perform pg_temp.as_user(u_phy); j := public.plan_journey_set(p1, array['Avaliação', 'Cuidado inicial', 'Movimento', 'Atividades', 'Reavaliação'], 3);
  j := public.prof_journey_plan(p1); rep := rep || pg_temp.chk((j ->> 'current')::int = 3 and jsonb_array_length(j -> 'history') = 2 and j -> 'history' -> 0 ->> 'stage_name' = 'Atividades', 'o profissional avança a etapa e o histórico guarda as duas mudanças');
  perform pg_temp.as_user(u_phy2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.prof_journey_plan(%L)', p1)) like '42501%', 'fisioterapeuta sem vínculo não lê a jornada do paciente');
  perform pg_temp.as_user(u_p2); j := public.my_journey_plan(); rep := rep || pg_temp.chk(j -> 'plan' = 'null'::jsonb and j -> 'goal' = 'null'::jsonb and j -> 'stages' = 'null'::jsonb, 'outro paciente não vê a jornada nem o objetivo do primeiro (só os próprios dados)');
  set local role anon; rep := rep || pg_temp.chk(pg_temp.err('select public.my_journey_plan()') like '42501%' and pg_temp.err(format('select public.plan_journey_set(%L, array[''Avaliação'',''Cuidado'',''Movimento''], 0)', p1)) like '42501%', 'anônimo não acessa a jornada'); set local role authenticated;

  -- ---------------- conteúdos educativos
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.education_publish(%L, ''promessa'', ''Titulo'', ''Texto com mais de dez caracteres'')', p1)) like '%Tema inválido%', 'tema fora dos quatro é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.education_publish(%L, ''rotina'', ''T'', ''Texto com mais de dez caracteres'')', p1)) like '%título%', 'título curto demais é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.education_publish(%L, ''rotina'', ''Título'', ''curto'')', p1)) like '%texto%', 'texto curto demais é recusado');
  e1 := public.education_publish(p1, 'rotina', 'Por que a rotina em casa importa', 'A rotina prescrita complementa as consultas. Ela é ajustada pelo seu fisioterapeuta a cada reavaliação.');
  perform public.education_publish(p1, 'reavaliacao', 'Como se preparar para a reavaliação', 'Leve suas dúvidas e anote como foi a semana. A reavaliação decide os próximos passos com você.');
  rep := rep || pg_temp.chk(jsonb_array_length(public.prof_education(p1)) = 2, 'o fisioterapeuta com vínculo publica dois conteúdos');
  perform pg_temp.as_user(u_phy2); rep := rep || pg_temp.chk(pg_temp.err(format('select public.education_publish(%L, ''rotina'', ''Título ok'', ''Texto com mais de dez caracteres'')', p1)) like '42501%' and pg_temp.err(format('select public.education_revoke(%L)', e1)) like '42501%' and pg_temp.err(format('select public.prof_education(%L)', p1)) like '42501%', 'sem vínculo: não publica, não revoga e não lê');
  perform pg_temp.as_user(u_sales); rep := rep || pg_temp.chk(pg_temp.err(format('select public.education_publish(%L, ''rotina'', ''Título ok'', ''Texto com mais de dez caracteres'')', p1)) like '42501%', 'comercial não publica conteúdo');
  perform pg_temp.as_user(u_p1); j := public.my_education(); rep := rep || pg_temp.chk(jsonb_array_length(j) = 2 and exists (select 1 from jsonb_array_elements(j) x where x ->> 'topic' = 'reavaliacao'), 'o paciente lê os próprios conteúdos');
  perform pg_temp.as_user(u_p2); rep := rep || pg_temp.chk(public.my_education() = '[]'::jsonb, 'outro paciente não vê os conteúdos do primeiro');
  perform pg_temp.as_user(u_phy); perform public.education_revoke(e1); perform pg_temp.as_user(u_p1); rep := rep || pg_temp.chk(jsonb_array_length(public.my_education()) = 1, 'revogar um conteúdo o tira da vista do paciente');
  set local role anon; rep := rep || pg_temp.chk(pg_temp.err('select public.my_education()') like '42501%', 'anônimo não lê conteúdos'); reset role;
  -- as tabelas novas não têm leitura nem escrita direta pela API
  set local role authenticated; perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.patient_education') like '42501%' and pg_temp.err('select count(*) from public.plan_stage_events') like '42501%', 'as tabelas novas só se leem por funções (sem acesso direto)'); reset role;
  raise exception 'RELATORIO_N16%', rep;
end $$;
