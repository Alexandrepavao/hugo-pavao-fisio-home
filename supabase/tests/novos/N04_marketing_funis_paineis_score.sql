-- NOVO — N04: Marketing — funis personalizados, painéis personalizáveis e lead scoring (migrations 115–116). Transação sempre desfeita. Somente Dev/teste.
--  · funil: etapas do catálogo, conversão pelos totais, custo por etapa, gargalo só com volume, validação, permissões
--  · painéis: pessoal × compartilhado, validação dos widgets, quem edita, duplicar, isolamento entre organizações
--  · scoring: pontos explicáveis, limites 0–100, faixas e conversão observada, pesos só do administrador, sem dado de saúde
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.step(f jsonb, k text) returns jsonb language sql as $$ select x from jsonb_array_elements(f -> 'steps') x where x ->> 'kind' = k $$;
create or replace function pg_temp.su_dash(i uuid) returns public.mkt_dashboards language sql security definer as $$ select * from public.mkt_dashboards where id = i $$;
create or replace function pg_temp.su_dash_shared(o uuid) returns uuid language sql security definer as $$ select id from public.mkt_dashboards where org_id = o and shared order by created_at limit 1 $$;
create or replace function pg_temp.su_funnel_exists(i uuid) returns boolean language sql security definer as $$ select exists (select 1 from public.mkt_funnels where id = i) $$;
do $$
declare
  v_org uuid; v_org2 uuid; ua uuid; ub uuid; ub2 uuid; u_mgr uuid := gen_random_uuid(); u_sa uuid := gen_random_uuid(); u_sb uuid := gen_random_uuid(); u_mgr2 uuid := gen_random_uuid();
  rep text := ''; t text; res jsonb; d jsonb; fl jsonb; fid uuid; did uuid; did2 uuid;
  pipe uuid; st_new uuid; st_q uuid; svc uuid; prod uuid; prof uuid; acc uuid; camp uuid; front uuid; purpose uuid; person uuid[] := '{}'; opp uuid[] := '{}'; p uuid; o uuid; i int; sale uuid; rec uuid; s_ver int;
  v_today date := current_date;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N04)', 'n04-a') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (N04)', 'n04-b') returning id into ub;
  insert into public.organizations (name, slug) values ('Outra organização N04', 'n04-outra') returning id into v_org2;
  insert into public.units (org_id, name, slug) values (v_org2, 'Unidade Z (N04)', 'n04-z') returning id into ub2;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@n04.local'),(u_sa,'authenticated','authenticated','sa@n04.local'),(u_sb,'authenticated','authenticated','sb@n04.local'),(u_mgr2,'authenticated','authenticated','m2@n04.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N04'),(u_sa, v_org, null, 'Comercial A N04'),(u_sb, v_org, null, 'Comercial B N04'),(u_mgr2, v_org2, null, 'Gestor 2 N04');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sa, 'sales', ua),(v_org, u_sb, 'sales', ub),(v_org2, u_mgr2, 'manager', null);
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil N04', 'custom') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Novo', 1, 'open') returning id into st_new;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Qualificado', 2, 'open') returning id into st_q;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Perdida', 3, 'lost') returning id into st_new;
  select id into st_new from public.pipeline_stages where pipeline_id = pipe and name = 'Novo';
  insert into public.loss_reasons (org_id, name) values (v_org, 'Motivo N04') on conflict do nothing;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão N04', 45) returning id into svc;
  insert into public.products (org_id, kind, name, price_cents, active) values (v_org, 'service', 'Produto N04', 100000, true) returning id into prod;
  insert into public.professionals (org_id, display_name) values (v_org, 'Fisio N04') returning id into prof;
  perform private.mkt_seed_defaults(v_org); perform private.mkt_seed_defaults(v_org2); perform private.mkt_score_seed(v_org); perform private.mkt_score_seed(v_org2);
  select config_version into s_ver from public.mkt_settings where org_id = v_org;
  update public.mkt_settings set qualified_stage_ids = array[st_q] where org_id = v_org;

  -- conta manual + campanha classificada + 5 dias de gasto (100/dia, 1.000 impressões, 20 cliques)
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  acc := public.mkt_manual_account_create('meta', 'Conta N04', 'BRL', 'America/Sao_Paulo', ua); camp := public.mkt_manual_campaign_create(acc, 'Camp N04');
  select id into front from public.mkt_fronts where org_id = v_org and label = 'HP Fisioterapia'; select id into purpose from public.mkt_purposes where org_id = v_org and label = 'Captar pacientes';
  perform public.mkt_class_save(camp, jsonb_build_object('front_id', front, 'purpose_id', purpose, 'unit_id', ua));
  for i in 1..5 loop perform public.mkt_spend_manual_upsert(camp, v_today - i, 100, 'BRL', 1000, 20, 'N04', false); end loop;
  reset role;

  -- 12 leads pagos da campanha (toque Meta pago ligado por nome exato), com 2 toques no lead 12 (engajamento)
  for i in 1..12 loop
    insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Lead N04 ' || i) returning id into p; person := person || p;
    perform private.mkt_touch_upsert(v_org, ua, p, null, now() - interval '3 days', 'form', 'form:n04', gen_random_uuid(), '{"utm_source":"facebook","utm_medium":"cpc","utm_campaign":"Camp N04"}'::jsonb, null, '/lp');
  end loop;
  perform private.mkt_touch_upsert(v_org, ua, person[1], null, now() - interval '2 days', 'form', 'form:n04', gen_random_uuid(), '{"utm_source":"facebook","utm_medium":"cpc","utm_campaign":"Camp N04"}'::jsonb, null, '/lp');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  for i in 1..12 loop opp := opp || public.crm_create_opportunity(person[i], pipe, ua, 'Opp N04 ' || i, null, 0, u_mgr, 'teste', null); end loop;
  set constraints all immediate; set constraints all deferred; reset role;
  rep := rep || pg_temp.chk((select count(*) from public.mkt_attributions where opportunity_id = any (opp) and outcome = 'attributed') = 12, 'os 12 leads ficaram atribuídos à campanha');
  -- andamento: 6 qualificados (leads 1–6); 3 agendados (1–3); 1 compareceu (1); 1 venda (1) com recebimento
  update public.opportunities set stage_id = st_q where id = any (opp[1:6]);
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, opportunity_id, period, status)
    select v_org, ua, prof, person[k], svc, opp[k], tstzrange(now() - make_interval(days => k), now() - make_interval(days => k) + interval '45 minutes'), case when k = 1 then 'attended' when k = 2 then 'no_show' else 'scheduled' end from generate_series(1, 3) k;
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  sale := public.sale_create(person[1], ua, opp[1], ('[{"product_id":"' || prod || '","qty":1}]')::jsonb, 0, 1, current_date, null, 'n04-s1'); perform public.sale_confirm(sale); reset role;
  select id into rec from public.receivables where sale_id = sale limit 1; insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key) values (v_org, ua, rec, 'payment', 100000, now(), 'n04-p1');

  -- ============ FUNIS
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  fl := public.mkt_funnels_list(); rep := rep || pg_temp.chk(jsonb_array_length(fl -> 'funnels') >= 3 and jsonb_array_length(fl -> 'step_types') = 18, 'três funis padrão (Pacientes, Parceiros, Academy) e o catálogo de 18 etapas');
  fid := (select (x ->> 'id')::uuid from jsonb_array_elements(fl -> 'funnels') x where x ->> 'name' like 'Pacientes%');
  res := public.mkt_funnel_run(fid, v_today - 29, v_today, jsonb_build_object('scope', 'all', 'campaign', camp::text), 'event');
  rep := rep || pg_temp.chk((pg_temp.step(res, 'impressions') ->> 'count')::int = 5000 and (pg_temp.step(res, 'clicks') ->> 'count')::int = 100 and (pg_temp.step(res, 'lead') ->> 'count')::int = 12, 'etapas de mídia (impressões 5.000, cliques 100) e Hub (12 leads)');
  rep := rep || pg_temp.chk((pg_temp.step(res, 'qualified') ->> 'count')::int = 6 and (pg_temp.step(res, 'scheduled') ->> 'count')::int = 3 and (pg_temp.step(res, 'attended') ->> 'count')::int = 1 and (pg_temp.step(res, 'sold') ->> 'count')::int = 1 and (pg_temp.step(res, 'received') ->> 'count')::int = 1, 'MQL 6, agendamento 3, compareceu 1, venda 1, recebimento 1');
  rep := rep || pg_temp.chk((pg_temp.step(res, 'qualified') ->> 'rate_from_previous')::numeric = 50 and (pg_temp.step(res, 'scheduled') ->> 'rate_from_previous')::numeric = 50 and (pg_temp.step(res, 'attended') ->> 'rate_from_first')::numeric = round(100.0 / 5000, 2) is not null, 'conversão etapa a etapa pelos totais (lead→MQL 50%, MQL→agendado 50%)');
  rep := rep || pg_temp.chk((pg_temp.step(res, 'lead') ->> 'cost_per_step')::numeric = round(500 / 12.0, 2) and (pg_temp.step(res, 'sold') ->> 'cost_per_step')::numeric = 500, 'custo por etapa = investimento ÷ contagem (lead 41,67; venda 500)');
  rep := rep || pg_temp.chk((res ->> 'bottleneck_index')::int = 4, 'gargalo apontado só onde há volume (≥10 no passo anterior): lead → qualificado');
  rep := rep || pg_temp.chk(res -> 'notes' ->> 0 like '%eventos de mídia%', 'o funil explica que mídia e Hub têm unidades diferentes');
  -- personalizar
  fid := public.mkt_funnel_save(null, 'Meu funil N04', '[{"kind":"clicks","label":"Visitas"},{"kind":"lead"},{"kind":"sold","label":"Compraram"}]'::jsonb);
  res := public.mkt_funnel_run(fid, v_today - 29, v_today, jsonb_build_object('scope', 'all', 'campaign', camp::text), 'event');
  rep := rep || pg_temp.chk(jsonb_array_length(res -> 'steps') = 3 and (pg_temp.step(res, 'clicks') ->> 'label') = 'Visitas' and (res ->> 'bottleneck_index')::int = 3, 'funil personalizado com rótulos próprios; o gargalo é lead → venda (o passo de mídia → lead não é apontado: unidades diferentes)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_funnel_save(null, ''Curto'', ''[{"kind":"lead"}]''::jsonb)') like '%etapas inválidas%', 'funil com 1 etapa é recusado');
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_funnel_save(null, ''Falso'', ''[{"kind":"lead"},{"kind":"inventada"}]''::jsonb)') like '%etapas inválidas%', 'etapa fora do catálogo é recusada');
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_funnel_save(null, ''Longo'', (select jsonb_agg(jsonb_build_object(''kind'', ''lead'')) from generate_series(1, 13))::jsonb)') like '%etapas inválidas%', 'mais de 12 etapas é recusado');
  perform public.mkt_funnel_delete(fid); rep := rep || pg_temp.chk(not pg_temp.su_funnel_exists(fid), 'administrador exclui o funil');
  perform pg_temp.as_user(u_sa);
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_funnel_save(null, ''Do comercial'', ''[{"kind":"lead"},{"kind":"sold"}]''::jsonb)') like '42501%', 'comercial NÃO cria funil (só administrador)');
  rep := rep || pg_temp.chk(jsonb_array_length(public.mkt_funnels_list() -> 'funnels') >= 3, 'comercial lê os funis');
  perform pg_temp.as_user(u_mgr2); rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(public.mkt_funnels_list() -> 'funnels') x where x ->> 'name' = 'Meu funil N04') and pg_temp.err(format('select public.mkt_funnel_run(%L, current_date - 1, current_date)', fid)) like '%funil não encontrado%', 'funis de outra organização não aparecem nem executam');
  reset role;

  -- ============ PAINÉIS
  set local role authenticated; perform pg_temp.as_user(u_sa);
  d := public.mkt_dashboards_list(); rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(d) x where x ->> 'name' = 'Resumo executivo' and (x ->> 'shared')::boolean and not (x ->> 'can_edit')::boolean), 'painel compartilhado “Resumo executivo” disponível para a equipe, sem edição pelo comercial');
  did := public.mkt_dashboard_save(null, 'Meu painel N04', '[{"id":"a1","type":"kpi","key":"spend"},{"id":"a2","type":"series","metric":"leads","span":"2"},{"id":"a3","type":"campaigns","top":"5","sort":"roas"},{"id":"a4","type":"note","text":"Foco em avaliações"}]'::jsonb, false);
  rep := rep || pg_temp.chk(did is not null, 'comercial cria um painel pessoal');
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_dashboard_save(null, ''Script'', ''[{"id":"x","type":"script","code":"alert(1)"}]''::jsonb, false)') like '%widgets inválidos%', 'widget de tipo desconhecido é recusado');
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_dashboard_save(null, ''Chave ruim'', ''[{"id":"x","type":"kpi","key":"Spend; drop"}]''::jsonb, false)') like '%widgets inválidos%', 'parâmetro fora do padrão é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.mkt_dashboard_save(null, ''Compartilhado'', ''[]''::jsonb, true)')) like '42501%', 'comercial NÃO compartilha painel com a equipe');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.mkt_dashboard_save(%L, ''Invadindo'', ''[]''::jsonb, false)', pg_temp.su_dash_shared(v_org))) like '42501%', 'comercial não edita o painel compartilhado');
  did2 := public.mkt_dashboard_duplicate(pg_temp.su_dash_shared(v_org)); rep := rep || pg_temp.chk((select (pg_temp.su_dash(did2)).name like '%(cópia)' and not (pg_temp.su_dash(did2)).shared and (pg_temp.su_dash(did2)).owner_user_id = u_sa), 'duplicar um painel compartilhado cria uma cópia PESSOAL');
  perform pg_temp.as_user(u_sb); rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(public.mkt_dashboards_list()) x where x ->> 'name' = 'Meu painel N04'), 'painel pessoal não aparece para outra pessoa');
  perform public.mkt_dashboard_delete(did); rep := rep || pg_temp.chk((pg_temp.su_dash(did)).id is not null, 'outra pessoa não exclui o painel alheio');
  perform pg_temp.as_user(u_mgr); did2 := public.mkt_dashboard_save(null, 'Painel da equipe N04', '[{"id":"b1","type":"quality"},{"id":"b2","type":"reconciliation","span":"2"}]'::jsonb, true);
  rep := rep || pg_temp.chk((pg_temp.su_dash(did2)).shared, 'administrador compartilha um painel');
  perform pg_temp.as_user(u_sb); rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(public.mkt_dashboards_list()) x where x ->> 'name' = 'Painel da equipe N04'), 'todos com acesso ao Marketing veem o painel compartilhado');
  perform pg_temp.as_user(u_mgr2); rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(public.mkt_dashboards_list()) x where x ->> 'name' in ('Painel da equipe N04', 'Meu painel N04')), 'outra organização não vê painéis desta');
  reset role;

  -- ============ LEAD SCORING
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  d := public.mkt_score_get(); rep := rep || pg_temp.chk(jsonb_array_length(d -> 'rules') = 11 and (d -> 'settings' ->> 'base')::int = 20 and (d -> 'settings' ->> 'hot_min')::int = 70, 'pesos padrão: 11 fatores, base 20, quente ≥ 70, morna ≥ 40');
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(d -> 'rules') r where r ->> 'factor' ~* '(sintoma|diagn|dor|saude|saúde|resposta)'), 'nenhum fator usa dado de saúde ou respostas de questionário');
  reset role;
  insert into public.person_contacts (org_id, person_id, type, value, normalized, is_primary) values (v_org, person[1], 'email', 'lead1@n04.test', 'lead1@n04.test', true), (v_org, person[1], 'phone', '11999990001', '11999990001', false);
  update public.opportunities set first_response_at = created_at + interval '10 minutes' where id = opp[1];
  update public.opportunities set stage_id = (select id from public.pipeline_stages where pipeline_id = pipe and name = 'Perdida'), status = 'lost', lost_reason_id = (select id from public.loss_reasons where org_id = v_org and name = 'Motivo N04' limit 1) where id = opp[12];
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  res := public.mkt_lead_scores(v_today - 29, v_today, jsonb_build_object('scope', 'all', 'campaign', camp::text));
  rep := rep || pg_temp.chk((res ->> 'total')::int = 12, 'pontua os 12 leads da campanha');
  d := (select x from jsonb_array_elements(res -> 'leads') x where x ->> 'name' = 'Lead N04 1');
  rep := rep || pg_temp.chk((d ->> 'score')::int = 95 and d ->> 'band' = 'hot' and (d ->> 'sold')::boolean, 'lead 1 = 20 base + rápido 15 + contato 10 + repetido 10 + qualificado 15 + agendado 15 + compareceu 10 = 95 (quente, com venda)');
  d := (select x from jsonb_array_elements(res -> 'leads') x where x ->> 'name' = 'Lead N04 12');
  rep := rep || pg_temp.chk((d ->> 'score')::int = 0 and d ->> 'band' = 'cold', 'lead perdido: 20 − 20 = 0 (nunca abaixo de 0), faixa fria');
  d := (select x from jsonb_array_elements(res -> 'leads') x where x ->> 'name' = 'Lead N04 8'); rep := rep || pg_temp.chk((d ->> 'score')::int = 20 and jsonb_array_length(d -> 'factors') = 0, 'lead sem nenhum fator: só a base (20), sem fatores listados');
  d := (select x from jsonb_array_elements(res -> 'leads') x where x ->> 'name' = 'Lead N04 2'); rep := rep || pg_temp.chk((d ->> 'score')::int = 20 + 15 + 15 - 15 and exists (select 1 from jsonb_array_elements(d -> 'factors') f where f ->> 'factor' = 'no_show' and (f ->> 'points')::int = -15), 'lead 2: qualificado + agendado − falta = 50; o detrator aparece explicado');
  rep := rep || pg_temp.chk((res -> 'bands' -> 'hot' ->> 'n')::int = 1 and (res -> 'bands' -> 'hot' ->> 'conversion_pct')::numeric = 100 and (res -> 'bands' -> 'cold' ->> 'sold')::int = 0, 'faixas: 1 quente com 100% de conversão observada; frias sem venda (associação observada, não promessa)');
  rep := rep || pg_temp.chk(jsonb_array_length(res -> 'distribution') = 11 and (select sum((x ->> 'n')::int) from jsonb_array_elements(res -> 'distribution') x) = 12 and res -> 'notes' ->> 1 like '%não prova%', 'distribuição por faixas de 10 pontos fecha em 12 e o aviso de não-causalidade acompanha');
  -- pesos
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_score_set(''{"rules":[{"factor":"quick_response","points":-5}]}''::jsonb)') like '%positivos%', 'fator positivo com pontos negativos é recusado');
  perform public.mkt_score_set('{"base":30,"rules":[{"factor":"scheduled","points":25},{"factor":"attended","enabled":false}]}'::jsonb);
  res := public.mkt_lead_scores(v_today - 29, v_today, jsonb_build_object('scope', 'all', 'campaign', camp::text)); d := (select x from jsonb_array_elements(res -> 'leads') x where x ->> 'name' = 'Lead N04 8');
  rep := rep || pg_temp.chk((d ->> 'score')::int = 30, 'administrador mudou a base para 30 e o lead sem fatores passou a 30');
  d := (select x from jsonb_array_elements(res -> 'leads') x where x ->> 'name' = 'Lead N04 3'); rep := rep || pg_temp.chk((d ->> 'score')::int = 30 + 15 + 25, 'fator “agendado” com 25 pontos; “compareceu” desligado deixa de somar');
  perform pg_temp.as_user(u_sa); rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_score_set(''{"base":99}''::jsonb)') like '42501%', 'comercial NÃO altera os pesos');
  res := public.mkt_lead_scores(v_today - 29, v_today, '{"scope":"all"}'::jsonb); rep := rep || pg_temp.chk((res ->> 'total')::int = 12, 'comercial da unidade A lê os leads da própria unidade');
  perform pg_temp.as_user(u_sb); res := public.mkt_lead_scores(v_today - 29, v_today, '{"scope":"all"}'::jsonb); rep := rep || pg_temp.chk((res ->> 'total')::int = 0, 'comercial da unidade B não vê leads da unidade A');
  perform pg_temp.as_user(u_mgr2); res := public.mkt_lead_scores(v_today - 29, v_today, '{"scope":"all"}'::jsonb); rep := rep || pg_temp.chk((res ->> 'total')::int = 0, 'outra organização não vê estes leads');
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_lead_scores(current_date, current_date - 1)') like '%período inválido%', 'período invertido é recusado');
  reset role; set local role anon; rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_lead_scores(current_date - 1, current_date)') like '42501%' and pg_temp.err('select public.mkt_dashboards_list()') like '42501%', 'anônimo não executa as funções'); reset role;
  raise exception 'RELATORIO_N04%', rep;
end $$;
