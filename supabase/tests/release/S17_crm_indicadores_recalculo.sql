-- RELEASE v1 — S17: indicadores do CRM conferidos por RECÁLCULO INDEPENDENTE sobre uma massa controlada (crm_analytics, migration 056): tempo por etapa, oportunidades paradas,
-- conversão entre etapas, conversão geral, ganhos/perdas, ciclo, motivos de perda e desempenho por origem e por responsável. Os valores esperados foram calculados à mão (ver comentários).
-- Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; ua uuid; pipe uuid; sA uuid; sB uuid; sC uuid; sW uuid; sL uuid; lr uuid; u_mgr uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  pp uuid[]; o uuid[]; i int; v_pid uuid; v_err text; a jsonb; x jsonb; rep text := ''; t0 timestamptz := now();
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S17)', 'teste-a-s17') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s17.local'),(u1,'authenticated','authenticated','c1@s17.local'),(u2,'authenticated','authenticated','c2@s17.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S17'),(u1, v_org, null, 'Comercial 1 S17'),(u2, v_org, null, 'Comercial 2 S17');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u1, 'sales', ua),(v_org, u2, 'sales', ua);
  insert into public.pipelines (org_id, unit_id, name, kind) values (v_org, ua, 'Funil S17', 'custom') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'A', 1, 'open') returning id into sA;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'B', 2, 'open') returning id into sB;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'C', 3, 'open') returning id into sC;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Ganho', 4, 'won') returning id into sW;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Perdido', 5, 'lost') returning id into sL;
  insert into public.loss_reasons (org_id, name) values (v_org, 'Motivo S17') returning id into lr;
  pp := array[]::uuid[]; o := array[]::uuid[];
  for i in 1..6 loop
    insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Lead S17 ' || i) returning id into v_pid; pp := array_append(pp, v_pid);
  end loop;
  -- O1: criada há 20 d, na etapa A (aberta) · O2: criada há 15 d, A→B há 10 d (aberta em B) · O3: criada há 12 d, A→B há 9 d, B→C há 3 d (aberta em C)
  -- O4: criada há 25 d, A→B há 20 d, B→C há 15 d, ganha há 5 d · O5: criada há 18 d, A→B há 17 d, perdida (a partir de B) há 8 d · O6: criada há 2 d, na etapa A (aberta)
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, source, status, created_at, closed_at, lost_reason_id) values
    (v_org, ua, pp[1], pipe, sA, u1, 'O1', 'Instagram', 'open', t0 - interval '20 days', null, null),
    (v_org, ua, pp[2], pipe, sB, u1, 'O2', 'Instagram', 'open', t0 - interval '15 days', null, null),
    (v_org, ua, pp[3], pipe, sC, u2, 'O3', 'Indicação', 'open', t0 - interval '12 days', null, null),
    (v_org, ua, pp[4], pipe, sW, u2, 'O4', 'Indicação', 'won', t0 - interval '25 days', t0 - interval '5 days', null),
    (v_org, ua, pp[5], pipe, sL, u1, 'O5', 'Instagram', 'lost', t0 - interval '18 days', t0 - interval '8 days', lr),
    (v_org, ua, pp[6], pipe, sA, u2, 'O6', 'Indicação', 'open', t0 - interval '2 days', null, null);
  select array_agg(id order by title) into o from public.opportunities where pipeline_id = pipe;
  delete from public.opportunity_events where opportunity_id = any (o);
  insert into public.opportunity_events (org_id, opportunity_id, kind, to_stage_id, created_at) values
    (v_org, o[1], 'created', sA, t0 - interval '20 days'),
    (v_org, o[2], 'created', sA, t0 - interval '15 days'), (v_org, o[2], 'stage_changed', sB, t0 - interval '10 days'),
    (v_org, o[3], 'created', sA, t0 - interval '12 days'), (v_org, o[3], 'stage_changed', sB, t0 - interval '9 days'), (v_org, o[3], 'stage_changed', sC, t0 - interval '3 days'),
    (v_org, o[4], 'created', sA, t0 - interval '25 days'), (v_org, o[4], 'stage_changed', sB, t0 - interval '20 days'), (v_org, o[4], 'stage_changed', sC, t0 - interval '15 days'), (v_org, o[4], 'stage_changed', sW, t0 - interval '5 days'),
    (v_org, o[5], 'created', sA, t0 - interval '18 days'), (v_org, o[5], 'stage_changed', sB, t0 - interval '17 days'), (v_org, o[5], 'stage_changed', sL, t0 - interval '8 days'),
    (v_org, o[6], 'created', sA, t0 - interval '2 days');

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  a := public.crm_analytics(t0 - interval '30 days', t0 + interval '1 day', ua, null, pipe, 7);

  -- abertas e paradas (foto de agora): abertas = O1, O2, O3, O6 = 4; paradas (>7 dias sem etapa nem contato) = O1 (20 d) e O2 (10 d) = 2
  rep := rep || pg_temp.chk((a -> 'open_total' ->> 'value')::int = 4, 'oportunidades abertas = 4 (O1, O2, O3, O6)');
  rep := rep || pg_temp.chk((a -> 'stalled' ->> 'value')::int = 2, 'paradas há mais de 7 dias = 2 (O1 com 20 d e O2 com 10 d)');
  rep := rep || pg_temp.chk((public.crm_analytics(t0 - interval '30 days', t0 + interval '1 day', ua, null, pipe, 15) -> 'stalled' ->> 'value')::int = 1, 'com o limite em 15 dias só O1 está parada (1)');
  -- tempo na etapa (hoje): A tem O1 (20 d) e O6 (2 d) → média 11,0; B tem O2 (10 d); C tem O3 (3 d)
  select jsonb_object_agg(e ->> 'name', e) into x from jsonb_array_elements(a -> 'stage_now') e;
  rep := rep || pg_temp.chk((x -> 'A' ->> 'n')::int = 2 and (x -> 'A' ->> 'avg_days')::numeric = 11.0 and (x -> 'A' ->> 'max_days')::numeric = 20.0, 'tempo atual na etapa A: 2 oportunidades, média 11,0 d, máximo 20,0 d');
  rep := rep || pg_temp.chk((x -> 'B' ->> 'n')::int = 1 and (x -> 'B' ->> 'avg_days')::numeric = 10.0 and (x -> 'C' ->> 'n')::int = 1 and (x -> 'C' ->> 'avg_days')::numeric = 3.0, 'etapa B: 1 oportunidade há 10,0 d; etapa C: 1 há 3,0 d');
  -- histórico de passagens que já saíram da etapa: A = 5+3+5+1 d (média 3,5, n 4); B = 6+5+9 d (média 6,7, n 3); C = 10 d (n 1)
  select jsonb_object_agg(e ->> 'name', e) into x from jsonb_array_elements(a -> 'stage_history') e;
  rep := rep || pg_temp.chk((x -> 'A' ->> 'n')::int = 4 and (x -> 'A' ->> 'avg_days')::numeric = 3.5, 'tempo médio que as oportunidades FICARAM na etapa A = 3,5 d (4 passagens)');
  rep := rep || pg_temp.chk((x -> 'B' ->> 'n')::int = 3 and (x -> 'B' ->> 'avg_days')::numeric = 6.7, 'etapa B = 6,7 d (3 passagens, inclusive a que terminou em perda)');
  rep := rep || pg_temp.chk((x -> 'C' ->> 'n')::int = 1 and (x -> 'C' ->> 'avg_days')::numeric = 10.0, 'etapa C = 10,0 d (1 passagem; O3 ainda está nela e não conta)');
  -- conversão entre etapas (coorte = 6 criadas no período): chegaram a A=6, B=4 (O2,O3,O4,O5), C=2 (O3,O4)
  rep := rep || pg_temp.chk((a -> 'cohort' ->> 'value')::int = 6, 'coorte do período = 6 oportunidades criadas');
  select jsonb_object_agg(e ->> 'name', e) into x from jsonb_array_elements(a -> 'chain') e;
  rep := rep || pg_temp.chk((x -> 'A' ->> 'reached')::int = 6 and (x -> 'B' ->> 'reached')::int = 4 and (x -> 'C' ->> 'reached')::int = 2, 'chegaram a A=6, B=4, C=2');
  rep := rep || pg_temp.chk((x -> 'B' ->> 'conv_prev_pct')::numeric = 66.7 and (x -> 'C' ->> 'conv_prev_pct')::numeric = 50.0 and (x -> 'C' ->> 'conv_first_pct')::numeric = 33.3, 'conversão entre etapas: A→B 66,7%, B→C 50,0%; C sobre a primeira etapa 33,3%');
  rep := rep || pg_temp.chk((a -> 'won_step' ->> 'won')::int = 1 and (a -> 'won_step' ->> 'conv_prev_pct')::numeric = 50.0, 'última etapa → ganho: 1 ganha de 2 que chegaram a C = 50,0%');
  -- conversão geral e ganhos/perdas
  rep := rep || pg_temp.chk((a -> 'overall_conversion' ->> 'value')::numeric = 16.7, 'conversão geral = 1 ganha ÷ 6 criadas = 16,7%');
  rep := rep || pg_temp.chk((a -> 'win_rate_closed' ->> 'value')::numeric = 50.0 and (a -> 'won_in_period' ->> 'value')::int = 1 and (a -> 'lost_in_period' ->> 'value')::int = 1, 'taxa de ganho entre as fechadas = 50,0% (1 ganha, 1 perdida)');
  rep := rep || pg_temp.chk((a -> 'cycle_avg_days' ->> 'value')::numeric = 20.0, 'ciclo médio das ganhas = 20,0 d (criada há 25 d, ganha há 5 d)');
  rep := rep || pg_temp.chk(jsonb_array_length(a -> 'loss_reasons') = 1 and (a -> 'loss_reasons' -> 0 ->> 'name') = 'Motivo S17' and (a -> 'loss_reasons' -> 0 ->> 'pct')::numeric = 100.0, 'motivo de perda: “Motivo S17” com 100%');
  -- desempenho por origem e por responsável
  select jsonb_object_agg(e ->> 'source', e) into x from jsonb_array_elements(a -> 'by_source') e;
  rep := rep || pg_temp.chk((x -> 'Instagram' ->> 'created')::int = 3 and (x -> 'Instagram' ->> 'won')::int = 0 and (x -> 'Instagram' ->> 'lost')::int = 1 and (x -> 'Instagram' ->> 'open')::int = 2 and (x -> 'Instagram' ->> 'conv_pct')::numeric = 0.0, 'origem Instagram: 3 criadas, 0 ganhas, 1 perdida, 2 abertas, conversão 0,0%');
  rep := rep || pg_temp.chk((x -> 'Indicação' ->> 'created')::int = 3 and (x -> 'Indicação' ->> 'won')::int = 1 and (x -> 'Indicação' ->> 'lost')::int = 0 and (x -> 'Indicação' ->> 'open')::int = 2 and (x -> 'Indicação' ->> 'conv_pct')::numeric = 100.0, 'origem Indicação: 3 criadas, 1 ganha, 0 perdidas, 2 abertas, conversão 100,0%');
  select jsonb_object_agg(e ->> 'name', e) into x from jsonb_array_elements(a -> 'by_owner') e;
  rep := rep || pg_temp.chk((x -> 'Comercial 1 S17' ->> 'created')::int = 3 and (x -> 'Comercial 1 S17' ->> 'lost')::int = 1 and (x -> 'Comercial 1 S17' ->> 'open')::int = 2 and (x -> 'Comercial 2 S17' ->> 'won')::int = 1 and (x -> 'Comercial 2 S17' ->> 'open')::int = 2, 'por responsável: Comercial 1 (3 criadas, 1 perdida, 2 abertas) e Comercial 2 (1 ganha, 2 abertas)');
  -- filtros: um responsável só vê as próprias
  a := public.crm_analytics(t0 - interval '30 days', t0 + interval '1 day', ua, u1, pipe, 7);
  rep := rep || pg_temp.chk((a -> 'open_total' ->> 'value')::int = 2 and (a -> 'cohort' ->> 'value')::int = 3, 'filtrando pelo responsável 1: 2 abertas e coorte de 3');
  -- período mais curto: só O6 (criada há 2 d) entra na coorte
  a := public.crm_analytics(t0 - interval '5 days', t0 + interval '1 day', ua, null, pipe, 7);
  rep := rep || pg_temp.chk((a -> 'cohort' ->> 'value')::int = 1 and (a -> 'won_in_period' ->> 'value')::int = 1 and (a -> 'lost_in_period' ->> 'value')::int = 0, 'últimos 5 dias: coorte 1 (O6) e a ganha de há 5 dias entra no fechamento do período');
  -- vendedor sem acesso à unidade/comercial de outra unidade
  reset role; set local role anon;
  begin perform public.crm_analytics(t0 - interval '30 days', t0, ua, null, pipe, 7); v_err := null; exception when others then v_err := sqlstate; end;
  rep := rep || pg_temp.chk(v_err = '42501', 'anon não executa crm_analytics (42501)');
  reset role;

  raise exception E'RELATORIO_S17_CRM_INDICADORES (transação desfeita):%', rep;
end $$;
