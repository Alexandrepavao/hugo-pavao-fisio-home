-- NOVO — N03: módulo Marketing (migrations 104–107). Transação sempre desfeita. Somente Dev/teste. Usa RESPOSTAS SIMULADAS das plataformas (funções de ingestão chamadas como a Edge Function faria);
-- nada aqui prova a comunicação real com Meta/Google (ver docs/marketing-campanhas.md › “Verificação real pendente”).
--  · isolamento: organizações, unidades, papéis; credenciais inacessíveis; conta arbitrária não vincula
--  · rastreamento: utm/referrer higienizados, clique só com consentimento, origem histórica só-inserção, ligação a campanha por id/nome exato
--  · atribuição: último toque pago na janela, desempate, organic/no_touch, nada recalcula sozinho; vendas ligadas uma vez; novo × recompra × expansão; estorno; cancelamento
--  · gasto: idempotência, concorrência (trava), sobreposição manual × API, moeda, falha ≠ zero, entidades/detalhamentos fora da soma
--  · classificação: pendente, histórico, efeito explicado, “fora do dashboard” reconcilia
--  · indicadores: denominador zero = indisponível, taxas consolidadas, visão por evento × coorte, detalhe = cartão
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.kpi(res jsonb, k text) returns jsonb language sql as $$ select x from jsonb_array_elements(res -> 'kpis') x where x ->> 'key' = k $$;
create or replace function pg_temp.kv(res jsonb, k text) returns numeric language sql as $$ select (pg_temp.kpi(res, k) ->> 'value')::numeric $$;
create or replace function pg_temp.ka(res jsonb, k text) returns boolean language sql as $$ select (pg_temp.kpi(res, k) ->> 'available')::boolean $$;
do $$
declare
  v_org uuid; v_org2 uuid; ua uuid; ub uuid; ub2 uuid; u_mgr uuid := gen_random_uuid(); u_sa uuid := gen_random_uuid(); u_sb uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_mgr2 uuid := gen_random_uuid();
  rep text := ''; t text; n bigint; n2 bigint; res jsonb; res2 jsonb; cfg jsonb; d jsonb; r jsonb;
  pipe uuid; st_new uuid; st_q uuid; st_won uuid; st_lost uuid; svc_eval uuid; svc_sess uuid; prod_a uuid; prod_b uuid; prod_course uuid; prof uuid;
  conn_m uuid; conn_g uuid; acc_m uuid; acc_g uuid; acc_manual uuid; acc_other uuid; conn_other uuid; run1 uuid; run2 uuid; run3 uuid; camp_a uuid; camp_b uuid; camp_g uuid; camp_man uuid; camp_name uuid;
  front_f uuid; purp_p uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o_old uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s_old uuid; sale_c uuid; rec uuid; pay1 uuid; l1 uuid; l2 uuid;
  front_other uuid; v_today date := current_date; t1 uuid; t2 uuid; i int; jr jsonb; r2 jsonb; v_ver0 int;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N03)', 'n03-a') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (N03)', 'n03-b') returning id into ub;
  insert into public.organizations (name, slug) values ('Outra organização N03', 'n03-outra') returning id into v_org2;
  insert into public.units (org_id, name, slug) values (v_org2, 'Unidade Z (N03)', 'n03-z') returning id into ub2;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@n03.local'),(u_sa,'authenticated','authenticated','sa@n03.local'),(u_sb,'authenticated','authenticated','sb@n03.local'),
    (u_phy,'authenticated','authenticated','ph@n03.local'),(u_mgr2,'authenticated','authenticated','m2@n03.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N03'),(u_sa, v_org, null, 'Comercial A N03'),(u_sb, v_org, null, 'Comercial B N03'),(u_phy, v_org, null, 'Fisio N03'),(u_mgr2, v_org2, null, 'Gestor 2 N03');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sa, 'sales', ua),(v_org, u_sb, 'sales', ub),(v_org, u_phy, 'physio', ua),(v_org2, u_mgr2, 'manager', null);
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil N03', 'custom') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Novo', 1, 'open') returning id into st_new;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Qualificado', 2, 'open') returning id into st_q;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Ganha', 3, 'won') returning id into st_won;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Perdida', 4, 'lost') returning id into st_lost;
  insert into public.loss_reasons (org_id, name) values (v_org, 'Motivo N03') on conflict do nothing;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Avaliação N03', 60) returning id into svc_eval;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão N03', 45) returning id into svc_sess;
  insert into public.products (org_id, kind, name, price_cents, active) values (v_org, 'service', 'Produto A N03', 100000, true) returning id into prod_a;
  insert into public.products (org_id, kind, name, price_cents, active) values (v_org, 'service', 'Produto B N03', 50000, true) returning id into prod_b;
  insert into public.products (org_id, kind, name, price_cents, active) values (v_org, 'course', 'Curso N03', 80000, true) returning id into prod_course;
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_phy, 'Fisio N03') returning id into prof;
  perform private.mkt_seed_defaults(v_org); perform private.mkt_seed_defaults(v_org2); select id into front_other from public.mkt_fronts where org_id = v_org2 limit 1;

  -- ============ 1) PERMISSÕES E ISOLAMENTO
  set local role authenticated; perform pg_temp.as_user(u_phy);
  t := pg_temp.err('select public.mkt_config_get()'); rep := rep || pg_temp.chk(t like '42501%', 'fisioterapeuta NÃO acessa a configuração do Marketing');
  t := pg_temp.err('select public.mkt_kpis(current_date - 29, current_date)'); rep := rep || pg_temp.chk(t like '42501%', 'fisioterapeuta NÃO lê indicadores de Marketing');
  perform pg_temp.as_user(u_sa);
  t := pg_temp.err('select public.mkt_config_get()'); rep := rep || pg_temp.chk(t like '42501%', 'comercial NÃO configura o Marketing (só administrador)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_filters()') is null, 'comercial lê os filtros e os painéis (leitura)');
  t := pg_temp.err('select public.mkt_settings_set(''{"attribution_window_days": 10}''::jsonb)'); rep := rep || pg_temp.chk(t like '42501%', 'comercial NÃO altera as configurações');
  t := pg_temp.err('select count(*) from public.mkt_credentials'); rep := rep || pg_temp.chk(t like '42501%', 'credenciais: leitura direta negada ao usuário autenticado');
  t := pg_temp.err('select count(*) from public.mkt_oauth_states'); rep := rep || pg_temp.chk(t like '42501%', 'estados de OAuth: leitura direta negada ao usuário autenticado');
  t := pg_temp.err('insert into public.mkt_spend_daily (org_id, account_id, campaign_id, day, source, currency, tz, spend) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), current_date, ''manual'', ''BRL'', ''x'', 1)');
  rep := rep || pg_temp.chk(t like '42501%', 'ninguém grava gasto direto na tabela (só por função)');
  reset role;
  set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_config_get()') like '42501%', 'anônimo NÃO executa as funções de Marketing');
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.mkt_touches') like '42501%', 'anônimo não lê toques');
  reset role;
  t := pg_temp.err('set local role authenticated; select public.mkt_run_start(null,null,null,''manual'',null,null,null,null)'); rep := rep || pg_temp.chk(t like '42501%', 'funções de ingestão NÃO executam como usuário autenticado (só service role)'); reset role;

  -- ============ 2) CONFIGURAÇÃO, CONEXÕES E CONTAS (respostas simuladas da API)
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  cfg := public.mkt_config_get();
  rep := rep || pg_temp.chk(jsonb_array_length(cfg -> 'fronts') >= 3 and jsonb_array_length(cfg -> 'purposes') >= 5, 'padrões editáveis: 3 frentes e 5 finalidades (HP Fisioterapia, Academy, Tech…)');
  rep := rep || pg_temp.chk(not (cfg::text ilike '%token_enc%'), 'a configuração nunca devolve credenciais');
  perform public.mkt_connection_enable('meta', true); perform public.mkt_connection_enable('google', false);
  rep := rep || pg_temp.chk((select enabled from public.mkt_connections where org_id = v_org and platform = 'meta') and not (select enabled from public.mkt_connections where org_id = v_org and platform = 'google'), 'Meta e Google habilitam de forma independente');
  select id into front_f from public.mkt_fronts where org_id = v_org and label = 'HP Fisioterapia'; select id into purp_p from public.mkt_purposes where org_id = v_org and label = 'Captar pacientes';
  perform public.mkt_front_save(null, 'Outra frente N03', null, 9, true); rep := rep || pg_temp.chk(exists (select 1 from public.mkt_fronts where org_id = v_org and label = 'Outra frente N03'), 'frente cadastrável sem enum rígido (white label)');
  reset role;
  update public.mkt_connections set status = 'active', provider_user_label = 'usuario simulado', api_version = 'v26.0' where org_id = v_org and platform = 'meta' returning id into conn_m;
  update public.mkt_connections set status = 'active' where org_id = v_org and platform = 'google' returning id into conn_g;
  update public.mkt_connections set status = 'active', enabled = true where org_id = v_org2 and platform = 'meta' returning id into conn_other;
  perform public.mkt_accounts_upsert(conn_m, '[{"external_id":"act_111","name":"Conta Meta N03","currency":"brl","timezone":"America/Sao_Paulo","status":"ACTIVE"},{"external_id":"act_222","name":"Conta USD N03","currency":"usd","timezone":"America/New_York","status":"ACTIVE"}]'::jsonb);
  perform public.mkt_accounts_upsert(conn_other, '[{"external_id":"act_999","name":"Conta de outra organização","currency":"brl","timezone":"America/Sao_Paulo","status":"ACTIVE"}]'::jsonb);
  select id into acc_m from public.mkt_ad_accounts where org_id = v_org and external_id = 'act_111'; select id into acc_g from public.mkt_ad_accounts where org_id = v_org and external_id = 'act_222'; select id into acc_other from public.mkt_ad_accounts where org_id = v_org2 and external_id = 'act_999';
  rep := rep || pg_temp.chk(not (select selected from public.mkt_ad_accounts where id = acc_m) and (select currency from public.mkt_ad_accounts where id = acc_m) = 'BRL', 'conta descoberta NÃO nasce selecionada; moeda normalizada (BRL)');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  t := pg_temp.err(format('select public.mkt_account_select(%L, true, null)', acc_other)); rep := rep || pg_temp.chk(t like '42501%', 'não vincula conta de OUTRA organização informando o id');
  t := pg_temp.err(format('select public.mkt_account_select(%L, true, null)', gen_random_uuid())); rep := rep || pg_temp.chk(t like '42501%', 'não vincula conta arbitrária (id inventado)');
  perform public.mkt_account_select(acc_m, true, ua); perform public.mkt_account_select(acc_g, true, null);
  rep := rep || pg_temp.chk((select count(*) from public.mkt_ad_accounts where org_id = v_org and selected) = 2, 'administrador seleciona entre as contas descobertas');
  perform pg_temp.as_user(u_mgr2);
  t := pg_temp.err(format('select public.mkt_account_select(%L, true, null)', acc_m)); rep := rep || pg_temp.chk(t like '42501%', 'administrador de outra organização não seleciona contas desta');
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(public.mkt_config_get() -> 'accounts') a where a ->> 'external_id' = 'act_111'), 'a configuração de outra organização não enxerga estas contas');
  reset role;
  begin update public.mkt_ad_accounts set selected = true where id = acc_other; insert into public.mkt_ad_accounts (org_id, connection_id, platform, external_id, name, selected) values (v_org, conn_m, 'meta', 'act_999', 'duplicada', true);
    t := 'sem erro'; exception when unique_violation then t := 'unique'; end;
  rep := rep || pg_temp.chk(t = 'unique', 'a MESMA conta real não pode ser acompanhada por duas organizações');
  update public.mkt_ad_accounts set selected = false where id = acc_other;

  -- ============ 3) SINCRONIZAÇÃO: trava, idempotência, paginação simulada, falha ≠ zero
  run1 := public.mkt_run_start(v_org, conn_m, acc_m, 'backfill', v_today - 10, v_today, u_mgr, 'v26.0');
  rep := rep || pg_temp.chk(run1 is not null, 'execução inicia');
  rep := rep || pg_temp.chk(public.mkt_run_start(v_org, conn_m, acc_m, 'manual', v_today - 10, v_today, u_mgr, 'v26.0') is null, 'execução concorrente na mesma conta é descartada (trava)');
  update public.mkt_sync_runs set heartbeat_at = now() - interval '30 minutes' where id = run1;
  run2 := public.mkt_run_start(v_org, conn_m, acc_m, 'scheduled', v_today - 10, v_today, null, 'v26.0');
  rep := rep || pg_temp.chk(run2 is not null and (select status from public.mkt_sync_runs where id = run1) = 'error' and (select error_code from public.mkt_sync_runs where id = run1) = 'stale_lock', 'trava vencida é liberada e a nova execução assume');
  perform public.mkt_ingest_entities(run2, '[{"external_id":"1234567","name":"Camp Meta A","objective":"OUTCOME_LEADS","status":"ACTIVE","created_at":"2026-10-01T10:00:00Z"},{"external_id":"7654321","name":"Camp Meta B","objective":"OUTCOME_TRAFFIC","status":"PAUSED"}]'::jsonb,
    '[{"external_id":"11111","campaign_external_id":"1234567","name":"Conjunto 1","status":"ACTIVE"}]'::jsonb, '[{"external_id":"22222","campaign_external_id":"1234567","adset_external_id":"11111","name":"Anúncio 1","status":"ACTIVE","creative_ref":"c1","creative_name":"Criativo vídeo"}]'::jsonb);
  select id into camp_a from public.mkt_campaigns where account_id = acc_m and external_id = '1234567'; select id into camp_b from public.mkt_campaigns where account_id = acc_m and external_id = '7654321';
  rep := rep || pg_temp.chk((select state from public.mkt_campaign_class where campaign_id = camp_a) = 'pending', 'campanha nova nasce “Aguardando classificação” (nada inferido pelo nome)');
  rep := rep || pg_temp.chk((select platform_objective from public.mkt_campaigns where id = camp_a) = 'OUTCOME_LEADS' and (select platform_status from public.mkt_campaigns where id = camp_b) = 'PAUSED', 'objetivo e status ORIGINAIS da plataforma ficam guardados à parte');
  -- 5 dias de métricas da campanha A (R$ 100/dia, 10.000 impr., 200 cliques) e B (R$ 50/dia); detalhes por conjunto/anúncio e posicionamento
  for i in 1..5 loop
    perform public.mkt_ingest_metrics(run2, 'campaign', jsonb_build_array(
      jsonb_build_object('campaign_external_id','1234567','day', v_today - i,'spend',100,'impressions',10000,'link_clicks',200,'clicks_all',260,'reported_results',4,'reported_actions','{"lead":4}'::jsonb),
      jsonb_build_object('campaign_external_id','7654321','day', v_today - i,'spend',50,'impressions',4000,'link_clicks',40,'clicks_all',50,'reported_results',1)), 'BRL', 'America/Sao_Paulo', '{"fields":"spend,impressions,inline_link_clicks"}'::jsonb);
  end loop;
  perform public.mkt_ingest_metrics(run2, 'adset', jsonb_build_array(jsonb_build_object('entity_external_id','11111','day', v_today - 1,'spend',100,'impressions',10000,'link_clicks',200)), 'BRL', 'America/Sao_Paulo', '{}'::jsonb);
  perform public.mkt_ingest_metrics(run2, 'ad', jsonb_build_array(jsonb_build_object('entity_external_id','22222','day', v_today - 1,'spend',100,'impressions',10000,'link_clicks',200)), 'BRL', 'America/Sao_Paulo', '{}'::jsonb);
  perform public.mkt_ingest_metrics(run2, 'breakdown', jsonb_build_array(jsonb_build_object('campaign_external_id','1234567','day', v_today - 1,'kind','publisher_platform','value','instagram','spend',60,'impressions',6000,'link_clicks',120),
    jsonb_build_object('campaign_external_id','1234567','day', v_today - 1,'kind','publisher_platform','value','facebook','spend',40,'impressions',4000,'link_clicks',80)), 'BRL', 'America/Sao_Paulo', '{}'::jsonb);
  -- idempotência: repetir a mesma ingestão não duplica nem muda o total
  perform public.mkt_ingest_metrics(run2, 'campaign', jsonb_build_array(jsonb_build_object('campaign_external_id','1234567','day', v_today - 1,'spend',100,'impressions',10000,'link_clicks',200,'clicks_all',260,'reported_results',4)), 'BRL', 'America/Sao_Paulo', '{}'::jsonb);
  select count(*) into n from public.mkt_spend_daily where account_id = acc_m and source = 'api'; rep := rep || pg_temp.chk(n = 10, 'ingestão idempotente: 5 dias × 2 campanhas = 10 linhas (repetir não duplica)');
  rep := rep || pg_temp.chk((select sum(spend) from public.mkt_spend_daily where account_id = acc_m and source = 'api') = 750, 'total canônico = 5 × (100 + 50) = 750; conjunto/anúncio/posicionamento NÃO somam');
  rep := rep || pg_temp.chk((select count(*) from public.mkt_entity_daily where account_id = acc_m) = 2 and (select count(*) from public.mkt_breakdown_daily where account_id = acc_m) = 2, 'conjunto, anúncio e posicionamento ficam em tabelas separadas');
  t := pg_temp.err(format('select public.mkt_ingest_metrics(%L, ''campaign'', ''[]''::jsonb, null, ''x'', ''{}''::jsonb)', run2)); rep := rep || pg_temp.chk(t like '%moeda ausente%', 'resposta sem moeda é recusada (moeda é guardada com cada linha)');
  perform public.mkt_run_finish(run2, 'ok', 12, null, null, array(select (v_today - g)::date from generate_series(1, 5) g), '{}');
  rep := rep || pg_temp.chk((select count(*) from public.mkt_day_status where account_id = acc_m and status = 'ok') = 5, 'cobertura: 5 dias coletados com sucesso');
  -- falha: dia marcado como falho NÃO escreve gasto zero
  run3 := public.mkt_run_start(v_org, conn_m, acc_m, 'scheduled', v_today - 7, v_today - 6, null, 'v26.0');
  perform public.mkt_run_finish(run3, 'error', 0, 'rate_limit', 'limite de requisições atingido', '{}', array[(v_today - 7)::date, (v_today - 6)::date]);
  rep := rep || pg_temp.chk((select count(*) from public.mkt_day_status where account_id = acc_m and status = 'failed') = 2 and not exists (select 1 from public.mkt_spend_daily where account_id = acc_m and day in (v_today - 7, v_today - 6)), 'falha de sincronização marca o dia como FALHO e não escreve nenhuma linha de gasto (nunca zero)');
  rep := rep || pg_temp.chk((select last_error from public.mkt_connections where id = conn_m) like '%limite%', 'o erro fica visível na conexão');
  perform public.mkt_run_finish(public.mkt_run_start(v_org, conn_m, acc_m, 'scheduled', v_today - 7, v_today - 6, null, 'v26.0'), 'error', 0, 'auth_expired', 'token expirou', '{}', '{}');
  rep := rep || pg_temp.chk((select status from public.mkt_connections where id = conn_m) = 'reauth_required', 'acesso expirado/revogado → conexão pede reconexão');
  update public.mkt_connections set status = 'active' where id = conn_m;

  -- ============ 4) CLASSIFICAÇÃO INTERNA (com histórico) e RECONCILIAÇÃO
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  res := public.mkt_reconciliation(v_today - 29, v_today);
  rep := rep || pg_temp.chk((res ->> 'total')::numeric = 750 and (res ->> 'reconciles')::boolean, 'reconciliação: total 750 = soma das partes (tudo ainda “Aguardando classificação”)');
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(res -> 'parts') p where p ->> 'key' = 'pending' and (p ->> 'spend')::numeric = 750), '“Aguardando classificação / Não classificado” fica visível na reconciliação');
  d := public.mkt_class_save(camp_a, jsonb_build_object('front_id', front_f, 'purpose_id', purp_p, 'unit_id', ua, 'primary_result', 'evaluation_done'), true);
  rep := rep || pg_temp.chk((d ->> 'saved')::boolean is false and d ->> 'effect' like '%aplicada na leitura%' and d ->> 'effect' like '%todos os períodos%', 'pré-visualização explica o efeito da reclassificação nos relatórios (nada é gravado)');
  rep := rep || pg_temp.chk((select state from public.mkt_campaign_class where campaign_id = camp_a) = 'pending', 'a pré-visualização não alterou nada');
  d := public.mkt_class_save(camp_a, jsonb_build_object('front_id', front_f, 'purpose_id', purp_p, 'unit_id', ua, 'primary_result', 'evaluation_done'));
  rep := rep || pg_temp.chk((d ->> 'saved')::boolean and (select state from public.mkt_campaign_class where campaign_id = camp_a) = 'classified', 'classificar grava e marca como classificada');
  rep := rep || pg_temp.chk((select count(*) from public.mkt_campaign_class_history where campaign_id = camp_a) = 1 and jsonb_array_length(public.mkt_class_history(camp_a)) = 1, 'histórico de alterações registrado (antes, depois, efeito)');
  rep := rep || pg_temp.chk((select platform_objective from public.mkt_campaigns where id = camp_a) = 'OUTCOME_LEADS' and (select platform_status from public.mkt_campaigns where id = camp_a) = 'ACTIVE', 'classificar NÃO altera objetivo nem status originais da campanha');
  t := pg_temp.err(format('select public.mkt_class_save(%L, ''{"front_id":"%s"}''::jsonb)', camp_b, front_other)); rep := rep || pg_temp.chk(t like '%frente inválida%', 'frente de outra organização é recusada');
  perform public.mkt_class_save(camp_b, jsonb_build_object('front_id', front_f, 'purpose_id', purp_p, 'include_in_hub', false));
  res := public.mkt_reconciliation(v_today - 29, v_today);
  rep := rep || pg_temp.chk((res ->> 'reconciles')::boolean and exists (select 1 from jsonb_array_elements(res -> 'parts') p where p ->> 'key' = 'hidden' and (p ->> 'spend')::numeric = 250), 'campanha fora do dashboard (acompanhamento desligado) aparece como “Fora do dashboard” e a reconciliação fecha');
  res := public.mkt_kpis(v_today - 29, v_today);
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'spend') = 500, 'dashboard (escopo hub) soma só a campanha incluída: 500 (a B, desligada, fica de fora)');
  res2 := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk(pg_temp.kv(res2, 'spend') = 750, 'escopo “todas” traz 750 — a diferença é exatamente a campanha fora do dashboard');
  reset role;
  rep := rep || pg_temp.chk((select enabled from public.mkt_connections where id = conn_m) and (select platform_status from public.mkt_campaigns where id = camp_b) = 'PAUSED', 'desligar o acompanhamento no Hub não toca na campanha nem na conexão (nenhuma chamada à plataforma é feita)');

  -- ============ 5) RASTREAMENTO: higienização, consentimento, origem só-inserção
  set local role anon;
  res := public.quiz_start('atendimento', 'Lead Pago N03', 'lead.pago.n03@example.com', '(11) 98888-3001', 'contact-v1', '/avaliacao?token=abc123SECRETabc&email=a@b.com', 'avaliacao', 'https://www.facebook.com/l.php?u=https%3A%2F%2Fx&h=SEGREDO#frag',
    jsonb_build_object('utm_source','facebook','utm_medium','cpc','utm_campaign','Camp Meta A','hp_campaign_id','1234567','hp_adset_id','11111','hp_ad_id','22222','fbclid','IwAR_click_ID_123456','email','lixo@x.com','utm_content','a@b.com',
      'utm_term','AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDDEEEEEEEEEE','arbitrario','x'), null);
  l1 := (res ->> 'id')::uuid; reset role;
  select to_jsonb(q) into r from public.quiz_leads q where q.id = l1;
  rep := rep || pg_temp.chk(not (r -> 'utm' ? 'email') and not (r -> 'utm' ? 'arbitrario'), 'utm higienizado: chaves desconhecidas e “email” descartadas');
  rep := rep || pg_temp.chk(not (r -> 'utm' ? 'utm_content') and not (r -> 'utm' ? 'utm_term'), 'valor com e-mail e valor com cara de token são descartados');
  rep := rep || pg_temp.chk(not (r -> 'utm' ? 'fbclid'), 'identificador de clique (fbclid) NÃO é guardado sem consentimento de rastreamento');
  rep := rep || pg_temp.chk(r ->> 'origin_path' = '/avaliacao' and r ->> 'referrer' = 'www.facebook.com/l.php', 'origem e referenciador sem query, token, e-mail ou fragmento');
  rep := rep || pg_temp.chk(r -> 'utm' ->> 'hp_campaign_id' = '1234567' and r -> 'utm' ->> 'utm_source' = 'facebook', 'ids de campanha/conjunto/anúncio numéricos e UTMs válidos são mantidos');
  select to_jsonb(mt) into r from public.mkt_touches mt where mt.record_id = l1;
  rep := rep || pg_temp.chk(r ->> 'platform' = 'meta' and (r ->> 'is_paid')::boolean and r ->> 'paid_basis' = 'campaign_id', 'toque identificado como Meta paga (por id de campanha)');
  rep := rep || pg_temp.chk((r ->> 'campaign_id')::uuid = camp_a and r ->> 'campaign_link_basis' = 'campaign_id', 'toque ligado à campanha IMPORTADA por id (não por nome)');
  rep := rep || pg_temp.chk(r ->> 'ext_adset_id' = '11111' and r ->> 'click_id' is null and not (r ->> 'click_consent')::boolean, 'conjunto/anúncio guardados; clique ausente sem consentimento');
  set local role anon;
  res := public.quiz_start('atendimento', 'Lead Consentido N03', 'lead.cons.n03@example.com', '(11) 98888-3002', 'contact-v1', '/', 'avaliacao', null,
    jsonb_build_object('utm_source','google','utm_medium','cpc','gclid','Cj0KCQ_gclid_valid_123','hp_consent','tracking'), null); l2 := (res ->> 'id')::uuid; reset role;
  rep := rep || pg_temp.chk((select click_id from public.mkt_touches where record_id = l2) = 'Cj0KCQ_gclid_valid_123' and (select click_consent from public.mkt_touches where record_id = l2), 'com consentimento declarado o gclid é guardado (e marcado como consentido)');
  rep := rep || pg_temp.chk((select platform from public.mkt_touches where record_id = l2) = 'google' and (select is_paid from public.mkt_touches where record_id = l2), 'toque Google pago identificado pelo gclid');
  -- lead reenviado: mesma pessoa, sem duplicar; origem histórica preservada
  set local role anon;
  res := public.quiz_start('parceria', 'Lead Pago N03', 'lead.pago.n03@example.com', '(11) 98888-3001', 'contact-v1', '/', 'trabalhe-conosco', null, jsonb_build_object('utm_source','newsletter','utm_medium','email'), null); reset role;
  select person_id into p1 from public.quiz_leads where id = l1;
  rep := rep || pg_temp.chk((select count(distinct person_id) from public.quiz_leads where email = 'lead.pago.n03@example.com') = 1, 'lead que volta por outro formulário com o mesmo e-mail NÃO duplica a pessoa');
  rep := rep || pg_temp.chk((select count(*) from public.mkt_touches where person_id = p1) >= 2, 'o novo envio vira um NOVO toque');
  rep := rep || pg_temp.chk((select touch_id from public.mkt_person_origin where person_id = p1) = (select id from public.mkt_touches where record_id = l1), 'origem histórica da pessoa continua o PRIMEIRO toque (não é sobrescrita)');
  -- atribuição na criação (deferida ao commit; aqui forçamos o disparo)
  set constraints all immediate; set constraints all deferred;
  select opportunity_id into o1 from public.quiz_leads where id = l1;
  rep := rep || pg_temp.chk((select outcome from public.mkt_attributions where opportunity_id = o1) = 'attributed' and (select touch_id from public.mkt_attributions where opportunity_id = o1) = (select id from public.mkt_touches where record_id = l1), 'oportunidade do lead pago: atribuída ao toque pago do formulário');
  rep := rep || pg_temp.chk((select first_touch_id from public.mkt_attributions where opportunity_id = o1) = (select touch_id from public.mkt_person_origin where person_id = p1), 'a atribuição guarda também o primeiro toque');

  -- ============ 6) ATRIBUIÇÃO: janela, desempate, organic, sem origem, nada recalcula sozinho
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pessoa 2 N03') returning id into p2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pessoa 3 N03') returning id into p3;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pessoa 4 N03') returning id into p4;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pessoa 5 N03') returning id into p5;
  -- p2: dois toques pagos (Google há 12 dias, Meta há 3) → vence o ÚLTIMO (Meta)
  t1 := private.mkt_touch_upsert(v_org, ua, p2, null, now() - interval '12 days', 'form', 'form:n03', gen_random_uuid(), '{"utm_source":"google","utm_medium":"cpc","utm_campaign":"Camp Google"}'::jsonb, null, '/lp');
  t2 := private.mkt_touch_upsert(v_org, ua, p2, null, now() - interval '3 days', 'form', 'form:n03', gen_random_uuid(), '{"utm_source":"facebook","utm_medium":"cpc","hp_campaign_id":"1234567"}'::jsonb, null, '/lp');
  -- p3: só toque pago há 45 dias (fora da janela de 30) → organic
  perform private.mkt_touch_upsert(v_org, ua, p3, null, now() - interval '45 days', 'form', 'form:n03', gen_random_uuid(), '{"utm_source":"facebook","utm_medium":"cpc","hp_campaign_id":"1234567"}'::jsonb, null, '/lp');
  -- p4: toque não pago (newsletter) → organic;  p5: nenhum toque → no_touch
  perform private.mkt_touch_upsert(v_org, ua, p4, null, now() - interval '2 days', 'form', 'form:n03', gen_random_uuid(), '{"utm_source":"newsletter","utm_medium":"email"}'::jsonb, null, '/lp');
  select config_version into v_ver0 from public.mkt_settings where org_id = v_org;   -- a versão atual depende do histórico da organização
  set local role authenticated; perform pg_temp.as_user(u_sa);
  o2 := public.crm_create_opportunity(p2, pipe, ua, 'Opp P2', null, 0, u_sa, 'teste', null); o3 := public.crm_create_opportunity(p3, pipe, ua, 'Opp P3', null, 0, u_sa, 'teste', null);
  o4 := public.crm_create_opportunity(p4, pipe, ua, 'Opp P4', null, 0, u_sa, 'teste', null); o5 := public.crm_create_opportunity(p5, pipe, ua, 'Opp P5', null, 0, u_sa, 'teste', null);
  set constraints all immediate; set constraints all deferred; reset role;
  rep := rep || pg_temp.chk((select touch_id from public.mkt_attributions where opportunity_id = o2) = t2, 'dois toques pagos antes da oportunidade (Google, depois Meta): vence o ÚLTIMO (Meta), determinístico');
  rep := rep || pg_temp.chk((select outcome from public.mkt_attributions where opportunity_id = o3) = 'organic', 'toque pago ANTES da janela (45 dias > 30) não atribui: origem não paga');
  rep := rep || pg_temp.chk((select outcome from public.mkt_attributions where opportunity_id = o4) = 'organic', 'só toque não pago (newsletter): organic');
  rep := rep || pg_temp.chk((select outcome from public.mkt_attributions where opportunity_id = o5) = 'no_touch', 'sem nenhum toque rastreado: “sem origem” (não inventa)');
  rep := rep || pg_temp.chk((select window_days from public.mkt_attributions where opportunity_id = o2) = 30 and (select config_version from public.mkt_attributions where opportunity_id = o2) = v_ver0, 'a atribuição guarda a janela e a versão de configuração usadas');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  d := public.mkt_settings_set('{"attribution_window_days": 60}'::jsonb); rep := rep || pg_temp.chk((d ->> 'rules_changed')::boolean and (d ->> 'config_version')::int = v_ver0 + 1, 'mudar a janela sobe a versão da configuração e avisa que nada muda sozinho');
  reset role;
  rep := rep || pg_temp.chk((select outcome from public.mkt_attributions where opportunity_id = o3) = 'organic', 'alterar a configuração NÃO recalcula o histórico sozinho');
  set local role authenticated; perform pg_temp.as_user(u_mgr); d := public.mkt_attribution_recompute(v_today - 1, v_today); reset role;
  rep := rep || pg_temp.chk((select outcome from public.mkt_attributions where opportunity_id = o3) = 'attributed' and (select computed_by from public.mkt_attributions where opportunity_id = o3) = 'recompute', 'recalcular é ação EXPLÍCITA: com janela de 60 dias o toque de 45 dias passa a valer');
  rep := rep || pg_temp.chk(exists (select 1 from public.mkt_attribution_log where org_id = v_org and kind = 'recompute'), 'o recálculo fica no registro de auditoria');
  update public.mkt_settings set attribution_window_days = 30, config_version = 3 where org_id = v_org;
  set local role authenticated; perform pg_temp.as_user(u_mgr); perform public.mkt_attribution_recompute(v_today - 1, v_today); reset role;
  rep := rep || pg_temp.chk((select outcome from public.mkt_attributions where opportunity_id = o3) = 'organic', '(volta a janela de 30 dias e recalcula: organic de novo — comportamento determinístico)');

  -- ============ 7) VENDAS: uma vez, novo × recompra × expansão, parcelas, estorno, cancelamento
  set local role authenticated; perform pg_temp.as_user(u_sa);
  s1 := public.sale_create(p2, ua, o2, ('[{"product_id":"' || prod_a || '","qty":1}]')::jsonb, 0, 2, current_date, null, 'n03-s1'); perform public.sale_confirm(s1); perform public.sale_confirm(s1);
  reset role;
  update public.sales set sold_at = now() - interval '2 days' where id = s1;   -- a mesma transação de teste confirma tudo no mesmo instante; separa a ordem das compras
  rep := rep || pg_temp.chk((select count(*) from public.mkt_sale_attributions where sale_id = s1) = 1, 'venda confirmada duas vezes: UMA atribuição');
  rep := rep || pg_temp.chk((select customer_type from public.mkt_sale_attributions where sale_id = s1) = 'new' and (select outcome from public.mkt_sale_attributions where opportunity_id = o2 and sale_id = s1) = 'attributed' and (select link_basis from public.mkt_sale_attributions where sale_id = s1) = 'sale_opportunity', 'primeira compra: cliente NOVO, ligada pela oportunidade da venda');
  -- duas parcelas pagas + estorno parcial: o valor vendido não duplica; o recebido é líquido
  select id into rec from public.receivables where sale_id = s1 and installment_no = 1;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key) values (v_org, ua, rec, 'payment', 50000, now(), 'n03-p1') returning id into pay1;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key, refund_of) values (v_org, ua, rec, 'refund', 10000, now(), 'n03-r1', pay1);
  select id into rec from public.receivables where sale_id = s1 and installment_no = 2; insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key) values (v_org, ua, rec, 'payment', 50000, now(), 'n03-p2');
  set local role authenticated; perform pg_temp.as_user(u_sa);
  s2 := public.sale_create(p2, ua, o2, ('[{"product_id":"' || prod_a || '","qty":1}]')::jsonb, 0, 1, current_date, null, 'n03-s2'); perform public.sale_confirm(s2);
  s3 := public.sale_create(p2, ua, o2, ('[{"product_id":"' || prod_b || '","qty":1}]')::jsonb, 0, 1, current_date, null, 'n03-s3'); perform public.sale_confirm(s3);
  reset role;
  rep := rep || pg_temp.chk((select customer_type from public.mkt_sale_attributions where sale_id = s2) = 'repeat', 'mesmo produto de novo: RECOMPRA');
  rep := rep || pg_temp.chk((select customer_type from public.mkt_sale_attributions where sale_id = s3) = 'expansion', 'produto diferente para quem já comprou: EXPANSÃO');
  -- venda sem oportunidade → “sem oportunidade”; venda de pessoa sem origem → no_touch
  set local role authenticated; perform pg_temp.as_user(u_sa);
  s4 := public.sale_create(p5, ua, null, ('[{"product_id":"' || prod_b || '","qty":1}]')::jsonb, 0, 1, current_date, null, 'n03-s4'); perform public.sale_confirm(s4);
  reset role;
  rep := rep || pg_temp.chk((select link_basis from public.mkt_sale_attributions where sale_id = s4) = 'person_latest_opportunity' and (select outcome from public.mkt_sale_attributions where sale_id = s4) = 'no_touch', 'venda sem oportunidade informada: ligada à mais recente da pessoa (base registrada) e fica “sem origem” — não vira campanha');
  -- cancelamento: a venda deixa de contar
  set local role authenticated; perform pg_temp.as_user(u_sa); perform public.sale_cancel(s3, 'teste N03'); perform pg_temp.as_user(u_mgr);
  res := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'buyers') = 2, 'vendas atribuídas contadas UMA vez cada, canceladas fora: s1 e s2 (a s3 foi cancelada; a s4 não tem campanha)');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'sold') = 2000, 'valor vendido: R$ 1.000 + R$ 1.000 = 2.000 (a venda parcelada em 2 não duplica)');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'received') = 900, 'valor recebido líquido de estorno: 500 − 100 + 500 = 900');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'new_buyers') = 1 and pg_temp.kv(res, 'repeat_buyers') = 1 and pg_temp.kv(res, 'expansion_buyers') = 0, 'novo comprador 1, recompra 1, expansão 0 (a expansão foi cancelada)');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'avg_ticket') = 1000, 'ticket médio = vendido ÷ vendas = 1.000');
  res2 := public.mkt_quality(v_today - 29, v_today);
  rep := rep || pg_temp.chk((select (x ->> 'count')::int from jsonb_array_elements(res2 -> 'items') x where x ->> 'key' = 'sales_unattributed') >= 1, 'painel de qualidade lista vendas sem atribuição (explícitas, sem distribuir receita)');
  rep := rep || pg_temp.chk((select (x ->> 'count')::int from jsonb_array_elements(res2 -> 'items') x where x ->> 'key' = 'leads_no_origin') >= 1 and (select (x ->> 'count')::int from jsonb_array_elements(res2 -> 'items') x where x ->> 'key' = 'campaigns_pending') = 0, 'qualidade: leads sem origem contados; nenhuma campanha pendente (ambas classificadas)');
  reset role;

  -- ============ 8) SOBREPOSIÇÃO manual × API, MOEDA, CAMPANHA MANUAL
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  perform public.mkt_spend_manual_upsert(camp_a, v_today - 1, 80, 'BRL', null, null, 'lançado à mão', false);
  rep := rep || pg_temp.chk((select resolution from public.mkt_spend_daily where campaign_id = camp_a and day = v_today - 1 and source = 'manual') = 'superseded_by_api', 'dia JÁ coletado pela API: o lançamento manual do mesmo dia fica “substituído pela API” (fora da soma)');
  res := public.mkt_kpis(v_today - 29, v_today); rep := rep || pg_temp.chk(pg_temp.kv(res, 'spend') = 500, 'a soma continua 500: manual + API NÃO contam duas vezes');
  perform public.mkt_spend_manual_upsert(camp_a, v_today - 1, 80, 'BRL', null, null, 'prioridade manual', true);
  rep := rep || pg_temp.chk((select resolution from public.mkt_spend_daily where campaign_id = camp_a and day = v_today - 1 and source = 'api') = 'superseded_by_manual', 'o administrador pode PRIORIZAR o manual explicitamente: a API do dia sai da soma');
  res := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb); rep := rep || pg_temp.chk(pg_temp.kv(res, 'spend') = 750 - 150 + 80 - 0 and true, 'soma com prioridade manual = 750 − (100 + 50 da API no dia) + 80');
  perform public.mkt_spend_manual_delete((select id from public.mkt_spend_daily where campaign_id = camp_a and day = v_today - 1 and source = 'manual'));
  rep := rep || pg_temp.chk((select resolution from public.mkt_spend_daily where campaign_id = camp_a and day = v_today - 1 and source = 'api') = 'active', 'apagar o manual devolve a API do dia para a soma');
  t := pg_temp.err(format('select public.mkt_spend_manual_upsert(%L, current_date + 3, 10, ''BRL'')', camp_a)); rep := rep || pg_temp.chk(t like '%data futura%', 'gasto em data futura é recusado');
  t := pg_temp.err(format('select public.mkt_spend_manual_upsert(%L, current_date - 2, 10, ''USD'')', camp_a)); rep := rep || pg_temp.chk(t like '%moeda do lançamento%', 'moeda diferente da conta é recusada no lançamento manual');
  acc_manual := public.mkt_manual_account_create('google', 'Google manual N03', 'brl', 'America/Sao_Paulo', ua); camp_man := public.mkt_manual_campaign_create(acc_manual, 'Camp Manual');
  perform public.mkt_spend_manual_upsert(camp_man, v_today - 2, 40, 'BRL', 1000, 20, 'sem API ainda', false);
  rep := rep || pg_temp.chk((select resolution from public.mkt_spend_daily where campaign_id = camp_man) = 'active', 'conta sem API: o lançamento manual fica ativo');
  rep := rep || pg_temp.chk((select selected from public.mkt_ad_accounts where id = acc_manual) and (select origin from public.mkt_ad_accounts where id = acc_manual) = 'manual', 'conta manual marcada com origem “manual”');
  d := public.mkt_spend_manual_import(('[{"day":"' || (v_today - 3) || '","account":"Google manual N03","campaign":"Camp Manual","currency":"BRL","amount":"12,50"},{"day":"' || (v_today - 3) || '","account":"Conta inexistente","campaign":"X","currency":"BRL","amount":"5"}]')::jsonb);
  rep := rep || pg_temp.chk((d ->> 'imported')::int = 1 and jsonb_array_length(d -> 'errors') = 1, 'importação em lote: linha válida entra, linha com conta inexistente vira erro sem abortar');
  -- moeda: conta em USD não soma com BRL
  reset role;
  perform public.mkt_run_finish(public.mkt_run_start(v_org, conn_m, acc_g, 'manual', v_today - 2, v_today - 1, null, 'v26.0'), 'ok', 0, null, null, array[(v_today - 1)::date], '{}');
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  res := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk(res -> 'other_currencies' = '{}'::jsonb, 'sem gasto em outra moeda: nada separado');
  reset role;
  update public.mkt_spend_daily set currency = 'USD' where campaign_id = camp_man;
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  res := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk(res -> 'other_currencies' ? 'USD' and pg_temp.kv(res, 'spend') = 750, 'gasto em USD fica à parte (“outras moedas”) e NÃO entra na soma em BRL, sem conversão implícita');
  reset role;

  -- ============ 9) INDICADORES: denominador zero, taxas consolidadas, detalhe = cartão, evento × coorte
  update public.mkt_settings set qualified_stage_ids = array[st_q], evaluation_service_ids = array[svc_eval] where org_id = v_org;
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  res := public.mkt_kpis(v_today - 29, v_today, jsonb_build_object('scope','all','unit', ua::text));
  res := public.mkt_kpis(v_today - 29, v_today, jsonb_build_object('scope','all','campaign', camp_a::text));
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'spend') = 500 and pg_temp.kv(res, 'impressions') = 50000 and pg_temp.kv(res, 'clicks') = 1000, 'filtro por campanha: investimento 500, impressões 50.000, cliques 1.000');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'ctr') = 2.00 and pg_temp.kv(res, 'cpc') = 0.50 and pg_temp.kv(res, 'cpm') = 10.00, 'CTR 2,00%, CPC 0,50 e CPM 10,00 calculados pelos TOTAIS');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'reported_results') = 20, 'resultados reportados pela plataforma (20) ficam separados dos leads confirmados no Hub');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'leads') >= 1 and pg_temp.kv(res, 'cpl') = round(500 / pg_temp.kv(res, 'leads'), 2), 'CPL = investimento ÷ leads únicos');
  res := public.mkt_kpis(v_today - 29, v_today, jsonb_build_object('scope','all','campaign', camp_b::text));
  rep := rep || pg_temp.chk(not pg_temp.ka(res, 'cpl') and pg_temp.kpi(res, 'cpl') ->> 'reason' like '%denominador zero%' and pg_temp.kpi(res, 'cpl') -> 'value' = 'null'::jsonb, 'CPL sem leads: “Não disponível” com motivo, valor nulo (NÃO zero)');
  res := public.mkt_kpis(v_today + 100, v_today + 101); rep := rep || pg_temp.chk(not pg_temp.ka(res, 'spend') and pg_temp.kpi(res, 'spend') ->> 'reason' like '%não é gasto zero%', 'período sem cobertura: investimento “Não disponível”, não zero');
  res := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk((res -> 'coverage' ->> 'incomplete')::boolean and (res -> 'coverage' ->> 'failed_days')::int >= 1, 'cobertura incompleta e dias falhos informados; o investimento traz aviso de cobertura parcial');
  rep := rep || pg_temp.chk(pg_temp.kpi(res, 'spend') ->> 'warning' like 'Cobertura parcial%', 'aviso de cobertura parcial no cartão de investimento');
  rep := rep || pg_temp.chk(res -> 'model' ->> 'window_days' = '30' and res -> 'model' ->> 'name' ilike '%último toque pago%', 'o modelo e a janela de atribuição vão junto com os números');
  rep := rep || pg_temp.chk(not pg_temp.ka(res, 'result_after_media_payouts') and pg_temp.kpi(res, 'result_after_media_payouts') ->> 'reason' like '%coorte%', 'resultado após mídia e repasses: indisponível na visão por evento (bases de tempo incompatíveis)');
  rep := rep || pg_temp.chk(not pg_temp.ka(res, 'recurring_revenue'), 'receita recorrente: indisponível (sem contratos recorrentes atribuídos), parcelamento não é MRR');
  rep := rep || pg_temp.chk(pg_temp.kpi(res, 'media_cost_per_new_customer') ->> 'formula' like '%NÃO é o CAC completo%', 'custo de mídia por novo cliente não é chamado de CAC completo');
  -- detalhe reconcilia com o cartão
  d := public.mkt_indicator_detail('lead', v_today - 29, v_today, '{"scope":"all"}'::jsonb); rep := rep || pg_temp.chk((d ->> 'total_items')::int = pg_temp.kv(res, 'leads')::int and jsonb_array_length(d -> 'items') = (d ->> 'total_items')::int, 'detalhe de LEADS lista exatamente o que o cartão conta');
  d := public.mkt_indicator_detail('sale', v_today - 29, v_today, '{"scope":"all"}'::jsonb); rep := rep || pg_temp.chk((d ->> 'total_items')::int = pg_temp.kv(res, 'buyers')::int, 'detalhe de VENDAS bate com o cartão');
  d := public.mkt_indicator_detail('payment', v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk((select sum((x ->> 'amount_cents')::bigint) from jsonb_array_elements(d -> 'items') x where (x ->> 'amount_cents') is not null) >= 100000, 'detalhe de RECEBIMENTOS lista os pagamentos (estornos aparecem como linhas próprias)');
  d := public.mkt_indicator_detail('spend', v_today - 29, v_today, '{"scope":"all"}'::jsonb); rep := rep || pg_temp.chk((d ->> 'basis') like '%Gasto efetivo%', 'detalhe do investimento explica a base');
  -- coorte × evento: oportunidade antiga (45 dias atrás) com venda hoje
  reset role;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pessoa Antiga N03') returning id into p5;
  perform private.mkt_touch_upsert(v_org, ua, p5, null, now() - interval '46 days', 'form', 'form:n03', gen_random_uuid(), '{"utm_source":"facebook","utm_medium":"cpc","hp_campaign_id":"1234567"}'::jsonb, null, '/lp');
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title, created_at) values (v_org, ua, p5, pipe, st_new, 'Opp antiga N03', now() - interval '45 days') returning id into o_old;
  set constraints all immediate; set constraints all deferred;
  rep := rep || pg_temp.chk((select outcome from public.mkt_attributions where opportunity_id = o_old) = 'attributed', 'oportunidade antiga atribuída ao toque de 46 dias atrás (1 dia antes da criação)');
  set local role authenticated; perform pg_temp.as_user(u_sa);
  s_old := public.sale_create(p5, ua, o_old, ('[{"product_id":"' || prod_course || '","qty":1}]')::jsonb, 0, 1, current_date, null, 'n03-old'); perform public.sale_confirm(s_old);
  perform pg_temp.as_user(u_mgr);
  res := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb, 'event'); res2 := public.mkt_kpis(v_today - 60, v_today - 31, '{"scope":"all"}'::jsonb, 'cohort');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'buyers') = 3 and pg_temp.kv(res, 'enrollments') = 1, 'visão por EVENTO (mês atual): a venda do lead antigo conta aqui (3 vendas; 1 matrícula)');
  rep := rep || pg_temp.chk(pg_temp.kv(res2, 'leads') = 1 and pg_temp.kv(res2, 'buyers') = 1 and pg_temp.kv(res2, 'sold') = 800, 'visão por COORTE (mês da captação): o lead aparece com a venda posterior (1 lead, 1 venda, R$ 800)');
  rep := rep || pg_temp.chk(pg_temp.kv(public.mkt_kpis(v_today - 60, v_today - 31, '{"scope":"all"}'::jsonb, 'event'), 'buyers') = 0, 'a mesma janela por EVENTO não tem venda (ela aconteceu depois)');
  d := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb, 'cohort');
  rep := rep || pg_temp.chk(not pg_temp.ka(d, 'result_after_media_payouts') and pg_temp.kpi(d, 'result_after_media_payouts') ->> 'reason' like '%Cobertura%', 'na coorte, resultado após mídia e repasses só calcula com o gasto do período totalmente coberto (aqui há dias falhos)');
  rep := rep || pg_temp.chk(pg_temp.kpi(res2, 'result_after_media_payouts') ->> 'label' = 'Resultado após mídia e repasses' and not (pg_temp.kpi(res2, 'result_after_media_payouts') ->> 'label' ilike '%lucro%'), 'nunca chamado de lucro líquido');
  rep := rep || pg_temp.chk(jsonb_typeof(public.mkt_funnel(v_today - 29, v_today, '{"scope":"all"}'::jsonb) -> 'steps') = 'array' and jsonb_array_length(public.mkt_funnel(v_today - 29, v_today, '{"scope":"all"}'::jsonb) -> 'steps') = 6, 'funil com 6 etapas (lead → recebimento)');
  d := public.mkt_funnel(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk(d -> 'provider_reported' ->> 'note' ilike '%não são somados aos confirmados%' and d -> 'hub_confirmed' ? 'leads', 'conversões reportadas pelas plataformas e confirmadas no Hub aparecem SEPARADAS');
  -- escopo por unidade
  perform pg_temp.as_user(u_sb);
  res := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk(not pg_temp.ka(res, 'spend') and pg_temp.kv(res, 'leads') = 0, 'comercial da unidade B: não vê a conta/campanhas/leads da unidade A (isolamento por unidade)');
  perform pg_temp.as_user(u_sa); res := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'leads') >= 1 and pg_temp.kv(res, 'spend') = 750, 'comercial da unidade A vê o gasto e os leads da própria unidade');
  t := pg_temp.err('select public.mkt_kpis(current_date - 29, current_date, ''{"unit":"' || ub || '"}''::jsonb)'); rep := rep || pg_temp.chk(t like '42501%', 'comercial A pedindo a unidade B: sem permissão');
  perform pg_temp.as_user(u_mgr2); res := public.mkt_kpis(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk(not pg_temp.ka(res, 'spend') and pg_temp.kv(res, 'leads') = 0 and pg_temp.kv(res, 'sold') = 0, 'administrador de OUTRA organização não vê gasto, leads nem vendas desta');
  reset role;

  -- ============ 9b) FISIOTERAPIA, PARCEIROS, CRM e TELAS (comparativos, séries, filtros, detalhes de qualidade)
  update public.opportunities set stage_id = st_q, first_response_at = created_at + interval '30 minutes' where id = o2;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values
    (v_org, ua, prof, p2, svc_eval, tstzrange(now() - interval '3 days', now() - interval '3 days' + interval '60 minutes'), 'attended'),
    (v_org, ua, prof, p2, svc_sess, tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '45 minutes'), 'no_show'),
    (v_org, ua, prof, p2, svc_sess, tstzrange(now() - interval '1 days', now() - interval '1 days' + interval '45 minutes'), 'cancelled_by_patient');
  insert into public.partner_profiles (person_id, org_id, unit_id, status, approved_at) values (p2, v_org, ua, 'active', now());
  insert into public.referrals (org_id, unit_id, referrer_person_id, referred_person_id, code, direction) values (v_org, ua, p2, p3, 'n03code', 'inbound');
  update public.mkt_settings set partner_active_days = 30 where org_id = v_org;
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  res := public.mkt_kpis(v_today - 29, v_today, jsonb_build_object('scope','all','campaign', camp_a::text));
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'qualified') = 1 and pg_temp.kv(res, 'cpql') = 500, 'qualificado = oportunidade em etapa marcada como qualificação; custo por lead qualificado = 500 ÷ 1');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'eval_done') = 1 and pg_temp.kv(res, 'cost_per_eval') = 500, 'avaliação realizada só do serviço marcado como avaliação; custo por avaliação = 500 ÷ 1');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'attendance_rate') = 50 and pg_temp.kv(res, 'no_show') = 1 and pg_temp.kv(res, 'cancel_patient') = 1 and pg_temp.kv(res, 'cancel_clinic') = 0, 'comparecimento = realizados ÷ (realizados + faltas) = 50%; falta e cancelamento aparecem SEPARADOS');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'partner_approved') = 1 and pg_temp.kv(res, 'partner_active') = 1 and pg_temp.kv(res, 'cost_per_partner_approved') = 500, 'parceiro aprovado/ativo (critério configurado: indicou nos últimos 30 dias) e custo por parceiro aprovado');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'first_response_min') = 30, 'tempo até o primeiro contato humano registrado = 30 min (só quem tem registro)');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'leads') = 2 and pg_temp.kv(res, 'opportunities') = 3, 'leads únicos (2 pessoas) e oportunidades (3: a pessoa do 1º lead voltou por outro formulário e a nova oportunidade herda o último toque pago da janela) são contados à parte');
  rep := rep || pg_temp.chk(pg_temp.kv(res, 'media_cost_per_new_customer') = 250 and pg_temp.kv(res, 'roas_sales') = 5.6 and pg_temp.kv(res, 'return_on_receipts') = 1.8, 'custo de mídia por novo cliente 250 (500 ÷ 2 novos: s1 e a matrícula antiga); ROAS sobre vendas 5,6x (2.800 ÷ 500); retorno por recebimentos 1,8x (900 ÷ 500)');
  -- ---- gerenciador hierárquico (campanha → conjunto → anúncio), MQL/SAL/Venda, CPMQL e 7-3-1
  d := public.mkt_manager(v_today - 29, v_today, '{"scope":"all"}'::jsonb, 'event');
  rep := rep || pg_temp.chk((select adset_id is not null and ad_id is not null from public.mkt_touches where record_id = l1), 'o toque do link com ids foi ligado ao conjunto e ao anúncio IMPORTADOS da mesma campanha');
  r := (select x from jsonb_array_elements(d -> 'rows') x where x ->> 'level' = 'campaign' and x ->> 'name' = 'Camp Meta A');
  rep := rep || pg_temp.chk((r ->> 'leads')::int = 2 and (r ->> 'mql')::int = 1 and (r ->> 'sal')::int = 1 and (r ->> 'sales')::int = 3 and (r ->> 'sold')::numeric = 2800, 'campanha: leads 2, MQL 1, SAL 1, vendas 3 e R$ 2.800 (as mesmas do funil)');
  rep := rep || pg_temp.chk((r ->> 'cpl')::numeric = 250 and (r ->> 'cpmql')::numeric = 500 and (r ->> 'cpsal')::numeric = 500 and (r ->> 'roas')::numeric = 5.6, 'custos por etapa: CPL 250, CPMQL 500, CPSAL 500, ROAS 5,6 (consolidados pelos totais)');
  r2 := (select x from jsonb_array_elements(d -> 'rows') x where x ->> 'level' = 'adset' and x ->> 'name' = 'Conjunto 1'); res2 := (select x from jsonb_array_elements(d -> 'rows') x where x ->> 'level' = 'unidentified' and x ->> 'campaign_id' = camp_a::text);
  rep := rep || pg_temp.chk((r2 ->> 'leads')::int = 1 and (r2 ->> 'spend')::numeric = 100, 'conjunto: 1 lead (o do link com id) e gasto de 100 vindo do detalhamento da plataforma');
  rep := rep || pg_temp.chk((r2 ->> 'leads')::int + (res2 ->> 'leads')::int = (r ->> 'leads')::int and (r2 ->> 'sales')::int + (res2 ->> 'sales')::int = (r ->> 'sales')::int, 'conjunto + “Sem anúncio identificado” FECHAM com a campanha (leads e vendas)');
  rep := rep || pg_temp.chk((res2 ->> 'name') = 'Sem anúncio identificado' and (res2 ->> 'mql')::int = 1, 'quem não trouxe id fica em “Sem anúncio identificado” (inclusive o MQL)');
  rep := rep || pg_temp.chk((select (x ->> 'leads')::int = 1 and x ->> 'creative' = 'Criativo vídeo' from jsonb_array_elements(d -> 'rows') x where x ->> 'level' = 'ad'), 'anúncio: o lead chega ao criativo pelo id do anúncio no link');
  rep := rep || pg_temp.chk((r -> 'w' -> 'd7' ->> 'spend')::numeric = 500 and (r -> 'w' -> 'd3' ->> 'spend')::numeric = 200 and (r -> 'w' -> 'd7' ->> 'roas')::numeric = 5.6 and (r -> 'w' -> 'd3' ->> 'roas')::numeric = 14, 'janelas 7-3-1: gasto 500 / 200 e ROAS 5,6 / 14 (vendido na janela ÷ gasto na janela)');
  rep := rep || pg_temp.chk(r -> 'w' -> 'd1' -> 'roas' = 'null'::jsonb and (r -> 'w' -> 'd1' ->> 'sold')::numeric = 1800, 'janela do dia: sem gasto no dia → ROAS indisponível (não zero), mas o vendido do dia aparece');
  rep := rep || pg_temp.chk(cardinality(public.mkt_ad_tags_set((select id from public.mkt_ads where account_id = acc_m and external_id = '22222'), array['Vídeo', 'dor lombar', 'vídeo'])) = 2, 'etiquetas do criativo (administrador)');
  rep := rep || pg_temp.chk((select tags from public.mkt_ads where account_id = acc_m and external_id = '22222') = array['dor lombar', 'vídeo'], 'etiquetas normalizadas (minúsculas, sem repetição)');
  d := public.mkt_touches_relink(); rep := rep || pg_temp.chk((d ->> 'with_ad')::int >= 1, 'religar toques devolve quantos têm anúncio identificado');
  d := public.mkt_kpis(v_today - 29, v_today, '{}'::jsonb);
  rep := rep || pg_temp.chk(jsonb_array_length(d -> 'previous_kpis') = jsonb_array_length(d -> 'kpis') and d -> 'previous_period' ->> 'to' = (v_today - 30)::text, 'comparação com o período anterior equivalente (mesma duração, termina na véspera)');
  d := public.mkt_series(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk(jsonb_array_length(d -> 'points') = 30 and (select count(*) from jsonb_array_elements(d -> 'points') x where x -> 'spend' = 'null'::jsonb) >= 20, 'série diária: dias sem gasto coletado ficam SEM dado (nulo), não zero');
  d := public.mkt_campaign_table(v_today - 29, v_today, '{"scope":"all"}'::jsonb);
  rep := rep || pg_temp.chk((select (x ->> 'spend')::numeric from jsonb_array_elements(d -> 'rows') x where x ->> 'name' = 'Camp Meta A') = 500 and (select x ->> 'platform_objective' from jsonb_array_elements(d -> 'rows') x where x ->> 'name' = 'Camp Meta A') = 'OUTCOME_LEADS', 'comparativo de campanhas: investimento e objetivo ORIGINAL da plataforma ao lado da classificação interna');
  rep := rep || pg_temp.chk((select (x ->> 'cpl')::numeric from jsonb_array_elements(d -> 'rows') x where x ->> 'name' = 'Camp Meta A') = 250 and (select x -> 'cpl' from jsonb_array_elements(d -> 'rows') x where x ->> 'name' = 'Camp Meta B') = 'null'::jsonb, 'CPL por campanha: 500 ÷ 2 leads = 250; sem leads fica ausente (não zero)');
  d := public.mkt_ads_table(v_today - 29, v_today, '{"scope":"all"}'::jsonb, 'ad');
  rep := rep || pg_temp.chk((d -> 'rows' -> 0 ->> 'creative') = 'Criativo vídeo' and (d -> 'rows' -> 0 ->> 'spend')::numeric = 100 and jsonb_array_length(d -> 'breakdowns') = 2, 'comparativo de anúncios/criativos e detalhamento Facebook × Instagram, separados do total da campanha');
  d := public.mkt_filters(); rep := rep || pg_temp.chk(jsonb_array_length(d -> 'fronts') >= 3 and jsonb_array_length(d -> 'accounts') >= 1 and (d ->> 'is_admin')::boolean, 'opções de filtro: frentes, plataformas, contas, campanhas, produtos, funis, responsáveis');
  d := public.mkt_campaigns_admin(); rep := rep || pg_temp.chk(jsonb_array_length(d) >= 2, 'lista administrativa de campanhas para classificar');
  d := public.mkt_refresh_state(); rep := rep || pg_temp.chk(d ? 'allowed' and (d ->> 'min_minutes')::int = 15, 'atualização manual tem controle de frequência (15 min)');
  rep := rep || pg_temp.chk(not (public.mkt_refresh_state() ->> 'allowed')::boolean, 'logo após uma execução manual, nova atualização manual é barrada');
  d := public.mkt_history_backfill(); rep := rep || pg_temp.chk(d ? 'touches_created' and d ? 'attributions_created', 'preenchimento do histórico a partir do que já está gravado: ação explícita e idempotente');
  d := public.mkt_touches_relink(); rep := rep || pg_temp.chk(d ? 'linked_total', 'religar toques a campanhas importadas depois: ação explícita');
  for i in 1..11 loop
    d := public.mkt_indicator_detail((array['q_leads_no_origin','q_leads_organic','q_sales_unattributed','q_sales_person_link','q_paid_no_campaign','q_touch_name_link','q_campaigns_pending','q_sync_incomplete','q_stale','q_connections','q_overlap'])[i], v_today - 29, v_today, '{}'::jsonb);
    rep := rep || pg_temp.chk(d ? 'items' and (d ->> 'total_items')::int = jsonb_array_length(d -> 'items'), 'detalhe de qualidade responde: ' || (array['leads sem origem','leads orgânicos','vendas sem atribuição','vendas por vínculo da pessoa','toques pagos sem campanha','toques por nome','campanhas pendentes','sync incompleta','dados desatualizados','conexões','sobreposição'])[i]);
  end loop;
  d := public.mkt_quality(v_today - 29, v_today); rep := rep || pg_temp.chk(jsonb_array_length(d -> 'items') = 11, 'painel de qualidade com os 11 controles (origem, atribuição, classificação, sincronização, atualização, conexões, sobreposição)');
  t := pg_temp.err('select public.mkt_indicator_detail(''inventado'', current_date - 1, current_date)'); rep := rep || pg_temp.chk(t like '%indicador desconhecido%', 'indicador desconhecido é recusado');
  t := pg_temp.err('select public.mkt_kpis(current_date, current_date - 1)'); rep := rep || pg_temp.chk(t like '%período inválido%', 'período invertido é recusado');
  reset role;

  -- ============ 10) DESCONEXÃO e HISTÓRICO
  perform public.mkt_connection_set_state(conn_m, 'disconnected', null, null, null, null, null, null);
  rep := rep || pg_temp.chk(not exists (select 1 from public.mkt_ad_accounts where connection_id = conn_m and selected) and not exists (select 1 from public.mkt_credentials where connection_id = conn_m), 'desconectar: contas deixam de ser acompanhadas e as credenciais são apagadas');
  rep := rep || pg_temp.chk((select count(*) from public.mkt_spend_daily where account_id = acc_m) >= 10, 'o histórico de gasto já importado é preservado');
  raise exception 'RELATORIO_N03%', rep;
end $$;
