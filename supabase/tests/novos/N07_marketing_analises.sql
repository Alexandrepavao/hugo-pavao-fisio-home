-- NOVO — N07: Marketing — Análises (migration 120). Transação sempre desfeita. Somente Dev/teste.
--  · tempo até cada etapa, onde os leads se perdem, qualidade por campanha, região, dia/horário e retorno por mês de captação
--  · tudo por grupo de leads (pessoas captadas no período), com filtros, período sem leads e permissões/isolamento
--  · tempos conhecidos: as oportunidades são recuadas para 10 dias atrás e os eventos recebem datas fixas

create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.mono(j jsonb) returns boolean language sql as $$ select coalesce(bool_and(a <= b), true) from (select e::text::numeric a, lead(e::text::numeric) over () b from jsonb_array_elements(j) e) z where b is not null $$;
do $$
declare
  v_org uuid; v_org2 uuid; ua uuid; ub uuid; u_mgr uuid := gen_random_uuid(); u_sb uuid := gen_random_uuid(); u_mgr2 uuid := gen_random_uuid();
  rep text := ''; an jsonb; s1 uuid; pay1 uuid; lr uuid; lr2 uuid; res jsonb; fl jsonb; fid uuid; d jsonb; ov jsonb; se jsonb;
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

  -- ---------------- andamento do grupo de leads (datas deslocadas para dar tempos conhecidos)
  -- todos os leads chegaram há 10 dias: 1–6 (Meta) às 09:30 e 7–10 (Google) às 20:00, horário de Brasília
  update public.opportunities set created_at = (((current_date - 10)::timestamp + interval '9 hours 30 minutes') at time zone 'America/Sao_Paulo') where id = any (opp[1:6]);
  update public.opportunities set created_at = (((current_date - 10)::timestamp + interval '20 hours') at time zone 'America/Sao_Paulo') where id = any (opp[7:10]);
  -- contato realizado: 1 e 2 em 1 dia; 3, 4, 7 e 8 em 3 dias
  update public.opportunities set first_response_at = created_at + interval '1 day' where id = any (array[opp[1], opp[2]]);
  update public.opportunities set first_response_at = created_at + interval '3 days' where id = any (array[opp[3], opp[4], opp[7], opp[8]]);
  -- agendados 1, 2, 3 e 7 (4 dias depois da chegada); compareceram 1 e 7
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, opportunity_id, period, status)
    select v_org, ua, prof, person[k], svc, opp[k], tstzrange(now() - make_interval(days => 1, hours => k), now() - make_interval(days => 1, hours => k) + interval '45 minutes'), case when k in (1, 7) then 'attended' else 'scheduled' end from unnest(array[1, 2, 3, 7]) k;
  update public.appointments a set created_at = (select o.created_at + interval '4 days' from public.opportunities o where o.id = a.opportunity_id) where a.opportunity_id = any (opp);
  -- vendas 1 e 7 (R$ 1.000 cada) e recebimento: pessoa 1 pagou 1.000 e teve estorno de 200 (líquido 800); pessoa 7 ainda não pagou
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  for i in select unnest(array[1, 7]) loop
    sale := public.sale_create(person[i], ua, opp[i], ('[{"product_id":"' || prod || '","qty":1}]')::jsonb, 0, 1, current_date, null, 'n07-s' || i); perform public.sale_confirm(sale);
    if i = 1 then s1 := sale; end if;
  end loop; reset role;
  select id into rec from public.receivables where sale_id = s1 and installment_no = 1;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key) values (v_org, ua, rec, 'payment', 100000, now(), 'n07-p1') returning id into pay1;
  insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key, refund_of) values (v_org, ua, rec, 'refund', 20000, now(), 'n07-r1', pay1);
  -- perdas: 9 e 10 (o banco exige motivo ao perder)
  insert into public.loss_reasons (org_id, name) values (v_org, 'Sem orçamento (N07)') returning id into lr; insert into public.loss_reasons (org_id, name) values (v_org, 'Preço (N07)') returning id into lr2;
  update public.opportunities set status = 'lost', closed_at = now(), lost_reason_id = lr where id = opp[9];
  update public.opportunities set status = 'lost', closed_at = now(), lost_reason_id = lr2 where id = opp[10];
  -- regiões: 1–3 Zona Sul · 4–5 Zona Norte · 6 e 7 Campinas (grafias diferentes) · 8–10 sem localização
  update public.people set zone = 'sul' where id = any (person[1:3]);
  update public.people set zone = 'norte' where id = any (person[4:5]);
  update public.people set city = 'Campinas', state_uf = 'SP' where id = person[6];
  update public.people set city = '  campinas ', state_uf = 'SP' where id = person[7];

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  -- ============ estrutura e base
  an := public.mkt_analytics(v_today - 29, v_today, f_all);
  rep := rep || pg_temp.chk((an ->> 'leads')::int = 10 and an ->> 'currency' = 'BRL' and an ->> 'basis' like 'Grupo de leads:%', 'o grupo tem 10 leads (pessoas distintas captadas no período) e a base é declarada');

  -- ============ tempo até cada etapa
  rep := rep || pg_temp.chk((an -> 'timing' -> 'overall' -> 'contacted' ->> 'n')::int = 6 and (an -> 'timing' -> 'overall' -> 'contacted' ->> 'median_days')::numeric = 3.0, 'contato: 6 leads, mediana 3,0 dias (1, 1, 3, 3, 3, 3)');
  rep := rep || pg_temp.chk((an -> 'timing' -> 'overall' -> 'scheduled' ->> 'n')::int = 4 and (an -> 'timing' -> 'overall' -> 'scheduled' ->> 'median_days')::numeric = 4.0, 'agendamento: 4 leads, mediana 4,0 dias');
  rep := rep || pg_temp.chk((an -> 'timing' -> 'overall' -> 'attended' ->> 'n')::int = 2 and (an -> 'timing' -> 'overall' -> 'attended' ->> 'median_days')::numeric between 7 and 10, 'comparecimento: 2 leads, mediana entre 7 e 10 dias');
  rep := rep || pg_temp.chk((an -> 'timing' -> 'overall' -> 'sold' ->> 'n')::int = 2 and (an -> 'timing' -> 'overall' -> 'sold' ->> 'median_days')::numeric between 9 and 12, 'venda: 2 leads, mediana de cerca de 10 dias');
  d := (select x from jsonb_array_elements(an -> 'timing' -> 'by_campaign') x where x ->> 'campaign_id' = camp_m::text);
  rep := rep || pg_temp.chk((d ->> 'leads')::int = 6 and (d -> 'stages' -> 'contacted' ->> 'n')::int = 4 and (d -> 'stages' -> 'contacted' ->> 'median_days')::numeric = 2.0 and (d -> 'stages' -> 'scheduled' ->> 'n')::int = 3,
      'por campanha (Meta): 6 leads, contato em 4 (mediana 2,0 dias), 3 agendamentos');
  d := (select x from jsonb_array_elements(an -> 'timing' -> 'by_campaign') x where x ->> 'campaign_id' = camp_g::text);
  rep := rep || pg_temp.chk((d ->> 'leads')::int = 4 and (d -> 'stages' -> 'contacted' ->> 'n')::int = 2 and (d -> 'stages' -> 'contacted' ->> 'median_days')::numeric = 3.0 and (d -> 'stages' -> 'attended' ->> 'n')::int = 1, 'por campanha (Google): contato em 2 (mediana 3,0 dias) e 1 comparecimento');

  -- ============ onde os leads se perdem
  d := an -> 'dropoff' -> 'overall';
  rep := rep || pg_temp.chk((d ->> 'leads')::int = 10 and (d ->> 'contacted')::int = 6 and (d ->> 'scheduled')::int = 4 and (d ->> 'attended')::int = 2 and (d ->> 'sold')::int = 2, 'funil do grupo: 10 leads → 6 contatos → 4 agendados → 2 compareceram → 2 vendas (igual ao funil por coorte do painel)');
  d := (select x from jsonb_array_elements(an -> 'dropoff' -> 'by_campaign') x where x ->> 'campaign_id' = camp_m::text);
  rep := rep || pg_temp.chk((d ->> 'leads')::int = 6 and (d ->> 'contacted')::int = 4 and (d ->> 'scheduled')::int = 3 and (d ->> 'attended')::int = 1 and (d ->> 'sold')::int = 1, 'por campanha (Meta): 6 → 4 → 3 → 1 → 1');
  rep := rep || pg_temp.chk((an -> 'dropoff' ->> 'lost_total')::int = 2 and (select (x ->> 'n')::int from jsonb_array_elements(an -> 'dropoff' -> 'lost_reasons') x where x ->> 'reason' = 'Sem orçamento (N07)') = 1
      and (select (x ->> 'n')::int from jsonb_array_elements(an -> 'dropoff' -> 'lost_reasons') x where x ->> 'reason' = 'Preço (N07)') = 1, 'perdas: 2 no total, um motivo cada');

  -- ============ qualidade por campanha
  d := (select x from jsonb_array_elements(an -> 'quality') x where x ->> 'campaign_id' = camp_m::text);
  rep := rep || pg_temp.chk((d ->> 'spend')::numeric = 500 and (d ->> 'leads')::int = 6 and (d ->> 'sold')::int = 1 and (d ->> 'revenue')::numeric = 1000 and (d ->> 'attended')::int = 1, 'qualidade (Meta): gasto 500, 6 leads, 1 venda, receita 1.000');
  d := (select x from jsonb_array_elements(an -> 'quality') x where x ->> 'campaign_id' = camp_g::text);
  rep := rep || pg_temp.chk((d ->> 'spend')::numeric = 250 and (d ->> 'leads')::int = 4 and (d ->> 'sold')::int = 1 and (d ->> 'revenue')::numeric = 1000, 'qualidade (Google): gasto 250, 4 leads, 1 venda, receita 1.000');

  -- ============ região
  d := (select x from jsonb_array_elements(an -> 'regions') x where x ->> 'label' = 'Zona Sul');
  rep := rep || pg_temp.chk((d ->> 'leads')::int = 3 and (d ->> 'scheduled')::int = 3 and (d ->> 'attended')::int = 1 and (d ->> 'sold')::int = 1 and (d ->> 'revenue')::numeric = 1000 and d ->> 'kind' = 'zone', 'Zona Sul: 3 leads, 3 agendados, 1 compareceu, 1 venda, R$ 1.000');
  d := (select x from jsonb_array_elements(an -> 'regions') x where x ->> 'label' = 'Zona Norte');
  rep := rep || pg_temp.chk((d ->> 'leads')::int = 2 and (d ->> 'scheduled')::int = 0 and (d ->> 'sold')::int = 0, 'Zona Norte: 2 leads sem agendamento nem venda (mostra zero real, não some)');
  d := (select x from jsonb_array_elements(an -> 'regions') x where x ->> 'key' like 'city:campinas%');
  rep := rep || pg_temp.chk((d ->> 'leads')::int = 2 and (d ->> 'sold')::int = 1 and d ->> 'label' = 'Campinas / SP' and d ->> 'kind' = 'city', 'cidades com grafias diferentes ("Campinas" e "  campinas ") entram no mesmo grupo, com o nome limpo');
  d := (select x from jsonb_array_elements(an -> 'regions') x where x ->> 'kind' = 'none');
  rep := rep || pg_temp.chk((d ->> 'leads')::int = 3 and d ->> 'label' = 'Sem localização', 'leads sem zona nem cidade ficam em "Sem localização" (3)');
  rep := rep || pg_temp.chk((select sum((x ->> 'leads')::int) from jsonb_array_elements(an -> 'regions') x) = 10, 'as regiões somam os 10 leads (nenhum lead fora do quadro)');

  -- ============ dia da semana e horário
  rep := rep || pg_temp.chk((select sum((x ->> 'n')::int) from jsonb_array_elements(an -> 'hours' -> 'heat') x) = 10
      and (select (x ->> 'n')::int from jsonb_array_elements(an -> 'hours' -> 'heat') x where (x ->> 'band')::int = 2) = 6 and (select (x ->> 'n')::int from jsonb_array_elements(an -> 'hours' -> 'heat') x where (x ->> 'band')::int = 5) = 4
      and (select count(distinct (x ->> 'dow')::int) from jsonb_array_elements(an -> 'hours' -> 'heat') x) = 1 and (select (x ->> 'dow')::int from jsonb_array_elements(an -> 'hours' -> 'heat') x limit 1) = extract(dow from v_today - 10)::int,
      'chegadas: 6 na faixa 08–12h e 4 na faixa 20–24h, todas no dia da semana certo (horário de Brasília)');
  rep := rep || pg_temp.chk((select (x ->> 'median_min')::numeric from jsonb_array_elements(an -> 'hours' -> 'first_response') x where (x ->> 'band')::int = 2) = 2880 and (select (x ->> 'n')::int from jsonb_array_elements(an -> 'hours' -> 'first_response') x where (x ->> 'band')::int = 2) = 4
      and (select (x ->> 'median_min')::numeric from jsonb_array_elements(an -> 'hours' -> 'first_response') x where (x ->> 'band')::int = 5) = 4320, 'primeira resposta por faixa: 2.880 min (4 leads da manhã) e 4.320 min (2 da noite)');

  -- ============ curva acumulada e totais do grupo
  rep := rep || pg_temp.chk((select (x ->> 'n')::int from jsonb_array_elements(an -> 'timing' -> 'curve' -> 'contacted') x where (x ->> 'day')::numeric = 0.25) = 0
      and (select (x ->> 'n')::int from jsonb_array_elements(an -> 'timing' -> 'curve' -> 'contacted') x where (x ->> 'day')::numeric = 1) = 2
      and (select (x ->> 'n')::int from jsonb_array_elements(an -> 'timing' -> 'curve' -> 'contacted') x where (x ->> 'day')::numeric = 3) = 6, 'curva do contato: 0 em 6 h, 2 em até 1 dia, 6 em até 3 dias');
  rep := rep || pg_temp.chk((select (x ->> 'base')::int from jsonb_array_elements(an -> 'timing' -> 'curve' -> 'sold') x where (x ->> 'day')::numeric = 7) = 10
      and (select (x ->> 'n')::int from jsonb_array_elements(an -> 'timing' -> 'curve' -> 'sold') x where (x ->> 'day')::numeric = 7) = 0
      and (select (x ->> 'base')::int from jsonb_array_elements(an -> 'timing' -> 'curve' -> 'sold') x where (x ->> 'day')::numeric = 30) = 0, 'curva: cada ponto só usa leads com tempo de vida suficiente (10 leads com 7 dias de vida; nenhum com 30)');
  rep := rep || pg_temp.chk((an -> 'totals' ->> 'spend')::numeric = 750 and (an -> 'totals' ->> 'revenue')::numeric = 2000 and (an -> 'totals' ->> 'received')::numeric = 800 and (an -> 'totals' ->> 'sales')::int = 2,
      'totais do grupo: investimento 750, vendido 2.000, recebido líquido 800, 2 vendas');

  -- ============ retorno por mês de captação
  rep := rep || pg_temp.chk((select sum((x ->> 'leads')::int) from jsonb_array_elements(an -> 'monthly' -> 'rows') x) = 10 and (select sum((x ->> 'sold')::int) from jsonb_array_elements(an -> 'monthly' -> 'rows') x) = 2
      and (select sum((x ->> 'spend')::numeric) from jsonb_array_elements(an -> 'monthly' -> 'rows') x) = 750, 'meses somam 10 leads, 2 vendas e R$ 750 de gasto');
  rep := rep || pg_temp.chk((select sum((x -> 'cum' ->> (jsonb_array_length(x -> 'cum') - 1))::numeric) from jsonb_array_elements(an -> 'monthly' -> 'rows') x where jsonb_array_length(x -> 'cum') > 0) = 800
      and (select bool_and(pg_temp.mono(x -> 'cum')) from jsonb_array_elements(an -> 'monthly' -> 'rows') x),
      'recebido acumulado do grupo fecha em R$ 800 (1.000 pagos − 200 de estorno) e a curva nunca desce');

  -- ============ filtros: uma campanha só
  an := public.mkt_analytics(v_today - 29, v_today, jsonb_build_object('scope', 'all', 'campaign', camp_g::text));
  rep := rep || pg_temp.chk((an ->> 'leads')::int = 4 and jsonb_array_length(an -> 'quality') = 1 and (an -> 'dropoff' -> 'overall' ->> 'sold')::int = 1 and (select sum((x ->> 'leads')::int) from jsonb_array_elements(an -> 'regions') x) = 4, 'com a campanha do Google no filtro: 4 leads, 1 campanha, 1 venda');
  an := public.mkt_analytics(v_today + 1, v_today + 2, f_all);
  rep := rep || pg_temp.chk((an ->> 'leads')::int = 0 and an -> 'timing' -> 'overall' = '{}'::jsonb and an -> 'regions' = '[]'::jsonb and an -> 'quality' = '[]'::jsonb and an -> 'totals' -> 'spend' = 'null'::jsonb and (an -> 'totals' ->> 'sales')::int = 0, 'período sem leads: tudo vazio e gasto nulo (a tela mostra "sem base"), nada inventado');
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_analytics(current_date, current_date - 1)') like '%período inválido%' and pg_temp.err('select public.mkt_analytics(current_date - 800, current_date)') like '%período inválido%', 'período invertido ou maior que 2 anos é recusado');

  -- ============ permissões e isolamento
  perform pg_temp.as_user(u_sb); an := public.mkt_analytics(v_today - 29, v_today, f_all);
  rep := rep || pg_temp.chk((an ->> 'leads')::int = 0 and an -> 'quality' = '[]'::jsonb, 'comercial de outra unidade não vê nada da unidade A');
  perform pg_temp.as_user(u_mgr2); an := public.mkt_analytics(v_today - 29, v_today, f_all);
  rep := rep || pg_temp.chk((an ->> 'leads')::int = 0 and an -> 'regions' = '[]'::jsonb, 'outra organização não vê nada');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select public.mkt_analytics(current_date - 1, current_date)') like '42501%', 'anônimo não acessa as análises');
  reset role;
  raise exception 'RELATORIO_N07%', rep;
end $$;
