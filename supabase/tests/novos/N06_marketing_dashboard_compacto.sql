-- NOVO — N06: Marketing — dashboard compacto (migration 119). Transação sempre desfeita. Somente Dev/teste.
--  · evento "contato realizado" (primeiro contato humano) em visão por data e por coorte, com detalhamento
--  · funil por coorte: lead → contato → agendamento → comparecimento → venda (cada etapa conta quem a atingiu; sem dividir eventos independentes)
--  · série com impressões, cliques e valor vendido; comparação por canal pelos totais (CPL/ROAS recalculados), "sem base" quando falta gasto/lead
--  · permissões e isolamento (anônimo, outra unidade, outra organização)
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.step(f jsonb, k text) returns jsonb language sql as $$ select x from jsonb_array_elements(f -> 'steps') x where x ->> 'kind' = k $$;
create or replace function pg_temp.chan(o jsonb, p text) returns jsonb language sql as $$ select x from jsonb_array_elements(o -> 'channels') x where x ->> 'platform' = p $$;
do $$
declare
  v_org uuid; v_org2 uuid; ua uuid; ub uuid; u_mgr uuid := gen_random_uuid(); u_sb uuid := gen_random_uuid(); u_mgr2 uuid := gen_random_uuid();
  rep text := ''; res jsonb; fl jsonb; fid uuid; d jsonb; ov jsonb; se jsonb;
  pipe uuid; st_new uuid; st_q uuid; svc uuid; prod uuid; prof uuid; acc_m uuid; acc_g uuid; camp_m uuid; camp_g uuid; front uuid; purpose uuid;
  person uuid[] := '{}'; opp uuid[] := '{}'; p uuid; i int; sale uuid; rec uuid; v_today date := current_date; f_all jsonb := '{"scope":"all"}'::jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N06)', 'n06-a') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (N06)', 'n06-b') returning id into ub;
  insert into public.organizations (name, slug) values ('Outra organização N06', 'n06-outra') returning id into v_org2;
  insert into public.units (org_id, name, slug) values (v_org2, 'Unidade Z (N06)', 'n06-z');
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n06.local'), (u_sb, 'authenticated', 'authenticated', 'sb@n06.local'), (u_mgr2, 'authenticated', 'authenticated', 'm2@n06.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N06'), (u_sb, v_org, null, 'Comercial B N06'), (u_mgr2, v_org2, null, 'Gestor 2 N06');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_sb, 'sales', ub), (v_org2, u_mgr2, 'manager', null);
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil N06', 'custom') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Novo', 1, 'open') returning id into st_new;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Qualificado', 2, 'open') returning id into st_q;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão N06', 45) returning id into svc;
  insert into public.products (org_id, kind, name, price_cents, active) values (v_org, 'service', 'Produto N06', 100000, true) returning id into prod;
  insert into public.professionals (org_id, display_name) values (v_org, 'Fisio N06') returning id into prof;
  perform private.mkt_seed_defaults(v_org); perform private.mkt_seed_defaults(v_org2); perform private.mkt_score_seed(v_org); perform private.mkt_score_seed(v_org2);
  update public.mkt_settings set qualified_stage_ids = array[st_q] where org_id = v_org;

  -- duas contas manuais (Meta e Google), uma campanha cada, 5 dias de gasto: Meta 100/dia (1.000 impr., 20 cliques) · Google 50/dia (600 impr., 12 cliques)
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  acc_m := public.mkt_manual_account_create('meta', 'Conta Meta N06', 'BRL', 'America/Sao_Paulo', ua); camp_m := public.mkt_manual_campaign_create(acc_m, 'Camp Meta N06');
  acc_g := public.mkt_manual_account_create('google', 'Conta Google N06', 'BRL', 'America/Sao_Paulo', ua); camp_g := public.mkt_manual_campaign_create(acc_g, 'Camp Google N06');
  select id into front from public.mkt_fronts where org_id = v_org and label = 'HP Fisioterapia'; select id into purpose from public.mkt_purposes where org_id = v_org and label = 'Captar pacientes';
  perform public.mkt_class_save(camp_m, jsonb_build_object('front_id', front, 'purpose_id', purpose, 'unit_id', ua)); perform public.mkt_class_save(camp_g, jsonb_build_object('front_id', front, 'purpose_id', purpose, 'unit_id', ua));
  for i in 1..5 loop perform public.mkt_spend_manual_upsert(camp_m, v_today - i, 100, 'BRL', 1000, 20, 'N06', false); perform public.mkt_spend_manual_upsert(camp_g, v_today - i, 50, 'BRL', 600, 12, 'N06', false); end loop;
  reset role;

  -- 10 leads pagos: 6 da Meta e 4 do Google (toque ligado à campanha pelo nome exato)
  for i in 1..10 loop
    insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Lead N06 ' || i) returning id into p; person := person || p;
    perform private.mkt_touch_upsert(v_org, ua, p, null, now() - interval '3 days', 'form', 'form:n06', gen_random_uuid(),
      case when i <= 6 then '{"utm_source":"facebook","utm_medium":"cpc","utm_campaign":"Camp Meta N06"}' else '{"utm_source":"google","utm_medium":"cpc","utm_campaign":"Camp Google N06"}' end::jsonb, null, '/lp');
  end loop;
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  for i in 1..10 loop opp := opp || public.crm_create_opportunity(person[i], pipe, ua, 'Opp N06 ' || i, null, 0, u_mgr, 'teste', null); end loop;
  set constraints all immediate; set constraints all deferred; reset role;
  rep := rep || pg_temp.chk((select count(*) from public.mkt_attributions where opportunity_id = any (opp) and outcome = 'attributed') = 10, 'os 10 leads ficaram atribuídos às campanhas (6 Meta, 4 Google)');

  -- andamento: contato realizado em 6 (Meta 1–4, Google 1–2); agendados 4 (Meta 1–3, Google 1); compareceram 2 (Meta 1, Google 1); vendas 2 (Meta 1, Google 1)
  update public.opportunities set first_response_at = created_at + interval '10 minutes' where id = any (array[opp[1], opp[2], opp[3], opp[4], opp[7], opp[8]]);
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, opportunity_id, period, status)
    select v_org, ua, prof, person[k], svc, opp[k], tstzrange(now() - make_interval(days => 1, hours => k), now() - make_interval(days => 1, hours => k) + interval '45 minutes'), case when k in (1, 7) then 'attended' else 'scheduled' end from unnest(array[1, 2, 3, 7]) k;
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  for i in select unnest(array[1, 7]) loop
    sale := public.sale_create(person[i], ua, opp[i], ('[{"product_id":"' || prod || '","qty":1}]')::jsonb, 0, 1, current_date, null, 'n06-s' || i); perform public.sale_confirm(sale);
  end loop; reset role;

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  -- ============ evento "contato realizado"
  d := public.mkt_indicator_detail('contacted', v_today - 29, v_today, f_all, 'event');
  rep := rep || pg_temp.chk((d ->> 'total_items')::int = 6 and d ->> 'label' = 'Leads com contato realizado', 'detalhamento "contato realizado": 6 leads, com rótulo próprio (por data do evento)');
  d := public.mkt_indicator_detail('contacted', v_today - 29, v_today, f_all, 'cohort'); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 6, 'o mesmo em coorte (leads captados no período)');
  d := public.mkt_indicator_detail('contacted', v_today + 1, v_today + 2, f_all, 'event'); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 0, 'fora do período: zero contatos');

  -- ============ funis padrão por coorte
  fl := public.mkt_funnels_list();
  rep := rep || pg_temp.chk(jsonb_array_length(fl -> 'step_types') = 19 and exists (select 1 from jsonb_array_elements(fl -> 'step_types') s where s ->> 'key' = 'contacted'), 'catálogo de etapas ganhou "Contato realizado" (19 etapas)');
  rep := rep || pg_temp.chk((select count(*) from jsonb_array_elements(fl -> 'funnels') f where f ->> 'name' like '%(coorte)') = 3, 'três funis padrão por coorte (Pacientes, Academy, Geral)');
  fid := (select (f ->> 'id')::uuid from jsonb_array_elements(fl -> 'funnels') f where f ->> 'name' like 'Pacientes:%(coorte)');
  res := public.mkt_funnel_run(fid, v_today - 29, v_today, f_all, 'cohort');
  rep := rep || pg_temp.chk((pg_temp.step(res, 'lead') ->> 'count')::int = 10 and (pg_temp.step(res, 'contacted') ->> 'count')::int = 6 and (pg_temp.step(res, 'scheduled') ->> 'count')::int = 4
      and (pg_temp.step(res, 'attended') ->> 'count')::int = 2 and (pg_temp.step(res, 'sold') ->> 'count')::int = 2, 'funil por coorte: 10 leads → 6 contatos → 4 agendados → 2 compareceram → 2 vendas');
  rep := rep || pg_temp.chk((pg_temp.step(res, 'contacted') ->> 'rate_from_previous')::numeric = 60 and (pg_temp.step(res, 'scheduled') ->> 'rate_from_previous')::numeric = 66.67 and (pg_temp.step(res, 'sold') ->> 'rate_from_first')::numeric = 20,
      'conversões pelos totais da coorte: 60% contato, 66,67% agendamento, 20% do início até a venda');
  rep := rep || pg_temp.chk(res ->> 'view' = 'cohort' and res ->> 'basis' like 'Coorte:%', 'o funil declara a coorte (leads captados no período e o que aconteceu com eles até hoje)');

  -- ============ série com impressões, cliques e valor vendido
  se := public.mkt_series(v_today - 6, v_today, f_all, 'event');
  rep := rep || pg_temp.chk((select sum((x ->> 'spend')::numeric) from jsonb_array_elements(se -> 'points') x) = 750 and (select sum((x ->> 'impressions')::numeric) from jsonb_array_elements(se -> 'points') x) = 8000
      and (select sum((x ->> 'clicks')::numeric) from jsonb_array_elements(se -> 'points') x) = 160, 'série: gasto 750, impressões 8.000 e cliques 160 (Meta + Google)');
  rep := rep || pg_temp.chk((select sum((x ->> 'sold')::numeric) from jsonb_array_elements(se -> 'points') x) = 2000 and (select sum((x ->> 'sales')::int) from jsonb_array_elements(se -> 'points') x) = 2, 'série: 2 vendas e R$ 2.000 vendidos');
  rep := rep || pg_temp.chk((select count(*) from jsonb_array_elements(se -> 'points') x where x -> 'spend' = 'null'::jsonb) = 2, 'dias sem gasto coletado vêm sem valor (nulo), não zero (hoje e o dia 6 antes do período de gasto)');

  -- ============ comparação por canal
  ov := public.mkt_overview(v_today - 29, v_today, f_all, 'event');
  rep := rep || pg_temp.chk((pg_temp.chan(ov, 'meta') ->> 'spend')::numeric = 500 and (pg_temp.chan(ov, 'meta') ->> 'leads')::int = 6 and (pg_temp.chan(ov, 'meta') ->> 'sales')::int = 1 and (pg_temp.chan(ov, 'meta') ->> 'sold')::numeric = 1000, 'Meta: gasto 500, 6 leads, 1 venda, R$ 1.000');
  rep := rep || pg_temp.chk((pg_temp.chan(ov, 'google') ->> 'spend')::numeric = 250 and (pg_temp.chan(ov, 'google') ->> 'leads')::int = 4 and (pg_temp.chan(ov, 'google') ->> 'sales')::int = 1, 'Google: gasto 250, 4 leads, 1 venda');
  rep := rep || pg_temp.chk((pg_temp.chan(ov, 'meta') ->> 'cpl')::numeric = 83.33 and (pg_temp.chan(ov, 'google') ->> 'cpl')::numeric = 62.5 and (pg_temp.chan(ov, 'meta') ->> 'roas')::numeric = 2 and (pg_temp.chan(ov, 'google') ->> 'roas')::numeric = 4,
      'CPL e ROAS recalculados pelos totais de cada canal (83,33 / 62,50 · 2x / 4x)');
  res := public.mkt_kpis(v_today - 29, v_today, f_all, 'event');
  rep := rep || pg_temp.chk((select (k ->> 'value')::numeric from jsonb_array_elements(res -> 'kpis') k where k ->> 'key' = 'spend') = (select sum((c ->> 'spend')::numeric) from jsonb_array_elements(ov -> 'channels') c)
      and (select (k ->> 'value')::numeric from jsonb_array_elements(res -> 'kpis') k where k ->> 'key' = 'leads') = (select sum((c ->> 'leads')::numeric) from jsonb_array_elements(ov -> 'channels') c), 'o total dos canais confere com os indicadores (investimento e leads únicos)');
  rep := rep || pg_temp.chk((ov ->> 'sales_total')::int = 2 and (ov ->> 'sold_total')::numeric = 2000, 'vendas atribuídas (2) e receita atribuída (R$ 2.000) do período');
  ov := public.mkt_overview(v_today - 29, v_today, jsonb_build_object('scope', 'all', 'campaign', camp_m::text), 'event');
  rep := rep || pg_temp.chk(not (pg_temp.chan(ov, 'google') ->> 'has_campaigns')::boolean and pg_temp.chan(ov, 'google') -> 'spend' = 'null'::jsonb and pg_temp.chan(ov, 'google') -> 'cpl' = 'null'::jsonb, 'com a campanha Meta no filtro, o Google fica sem base (gasto e CPL nulos, não zero)');
  ov := public.mkt_overview(v_today + 1, v_today + 2, f_all, 'event');
  rep := rep || pg_temp.chk(pg_temp.chan(ov, 'meta') -> 'spend' = 'null'::jsonb and (pg_temp.chan(ov, 'meta') ->> 'leads')::int = 0 and pg_temp.chan(ov, 'meta') -> 'cpl' = 'null'::jsonb and pg_temp.chan(ov, 'meta') -> 'roas' = 'null'::jsonb, 'período sem gasto nem leads: gasto, CPL e ROAS nulos');
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_overview(current_date, current_date - 1)') like '%período inválido%' and pg_temp.err('select public.mkt_overview(current_date - 1, current_date, ''{}''::jsonb, ''x'')') like '%visão inválida%', 'período invertido e visão desconhecida são recusados');

  -- ============ campanhas: todos os eventos por campanha e objetivo "Reconhecimento"
  res := public.mkt_campaign_table(v_today - 29, v_today, f_all, 'event');
  d := (select x from jsonb_array_elements(res -> 'rows') x where x ->> 'campaign_id' = camp_m::text);
  rep := rep || pg_temp.chk((d -> 'events' ->> 'lead')::int = 6 and (d -> 'events' ->> 'contacted')::int = 4 and (d -> 'events' ->> 'scheduled')::int = 3 and (d -> 'events' ->> 'attended')::int = 1 and (d -> 'events' ->> 'sale')::int = 1,
      'linha da campanha traz todos os eventos: 6 leads, 4 contatos, 3 agendados, 1 compareceu, 1 venda (Meta)');
  rep := rep || pg_temp.chk(d ->> 'primary_result' = 'evaluation_done', 'resultado principal efetivo: sem escolha na campanha vale o padrão da finalidade (Captar pacientes → avaliação realizada)');
  d := (select x from jsonb_array_elements(res -> 'rows') x where x ->> 'campaign_id' = camp_g::text);
  rep := rep || pg_temp.chk((d -> 'events' ->> 'lead')::int = 4 and (d -> 'events' ->> 'contacted')::int = 2 and not (d -> 'events' ? 'qualified'), 'campanha sem eventos de um tipo não traz o tipo (a tela mostra "sem base", não zero inventado)');
  reset role; rep := rep || pg_temp.chk(exists (select 1 from public.mkt_event_types where key = 'awareness' and label = 'Reconhecimento de marca'), 'objetivo "Reconhecimento de marca" disponível para o administrador classificar campanhas');
  set local role authenticated; perform pg_temp.as_user(u_mgr);

  -- ============ permissões e isolamento
  perform pg_temp.as_user(u_sb); ov := public.mkt_overview(v_today - 29, v_today, f_all, 'event');
  rep := rep || pg_temp.chk((pg_temp.chan(ov, 'meta') ->> 'leads')::int = 0 and (ov ->> 'sales_total')::int = 0, 'comercial de outra unidade não vê os leads/vendas da unidade A');
  perform pg_temp.as_user(u_mgr2); ov := public.mkt_overview(v_today - 29, v_today, f_all, 'event');
  rep := rep || pg_temp.chk((pg_temp.chan(ov, 'meta') ->> 'leads')::int = 0 and pg_temp.chan(ov, 'meta') -> 'spend' = 'null'::jsonb and not (pg_temp.chan(ov, 'meta') ->> 'has_campaigns')::boolean, 'outra organização não vê nada');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_overview(current_date - 1, current_date)') like '42501%' and pg_temp.err('select public.mkt_funnels_list()') like '42501%', 'anônimo não acessa a visão por canal nem os funis');
  reset role;
  raise exception 'RELATORIO_N06%', rep;
end $$;
