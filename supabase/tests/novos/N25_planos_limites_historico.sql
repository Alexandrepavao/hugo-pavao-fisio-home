-- NOVO — N25: planos, assinatura por organização, limites (não configurado × ilimitado × zero), imposição só de NOVAS criações, histórico antes/depois e separação do financeiro da clínica (migration 147).
-- Plano QA (qa_...), organização criada pelo questionário. Transação sempre desfeita. Nenhum preço é inventado e nenhuma cobrança é gerada. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid, org uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('app.active_org', coalesce(org::text, ''), true);
end $$;
create or replace function pg_temp.st(o uuid, metric text) returns text language sql as $$ select e ->> 'state' from jsonb_array_elements(private.org_limits_status(o) -> 'limits') e where e ->> 'metric' = metric $$;
do $$
declare
  rep text := ''; pa uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_other uuid := gen_random_uuid(); o uuid; j jsonb; h jsonb; n int; v_unit uuid; v_before int;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (pa, 'authenticated', 'authenticated', 'plataforma@n25.local', now()), (u_mgr, 'authenticated', 'authenticated', 'gestor@n25.local', now()), (u_other, 'authenticated', 'authenticated', 'outro@n25.local', now());
  insert into public.platform_admins (user_id) values (pa);
  set local role authenticated; perform pg_temp.as_user(pa);
  j := public.provisioning_draft_save('n25-org-0001', jsonb_build_object(
    'company', jsonb_build_object('name', 'Clínica Limites N25', 'segment', 'fisioterapia', 'responsible', jsonb_build_object('name', 'Resp N25', 'email', 'resp@n25.local'), 'city', 'Recife', 'state', 'PE', 'units', jsonb_build_array(jsonb_build_object('name', 'Sede N25'))),
    'operation', jsonb_build_object('services', jsonb_build_array('Avaliação'), 'modes', jsonb_build_array('in_clinic'), 'flow', 'x', 'sales_models', jsonb_build_array('single')),
    'team', jsonb_build_object('users_count', 2, 'roles', jsonb_build_array(jsonb_build_object('role', 'manager', 'count', 1))),
    'customers', jsonb_build_object('crm', true, 'capture', false, 'forms', false, 'proposals', false, 'portal', true, 'import', jsonb_build_object('needed', false)), 'modules', '[]'::jsonb,
    'brand', jsonb_build_object('app_name', 'Limites N25', 'color_primary', '#123456', 'color_accent', '#ff8800', 'subdomain', 'limites-n25'), 'integrations', '[]'::jsonb,
    'plan', jsonb_build_object('plan_key', 'essencial', 'implementation', 'standard', 'import_assisted', false, 'training', false)));
  j := public.provisioning_submit('n25-org-0001'); o := (j ->> 'org_id')::uuid; reset role;
  insert into public.org_memberships (user_id, org_id, status) values (u_mgr, o, 'active'); insert into public.role_assignments (org_id, user_id, role) values (o, u_mgr, 'manager');
  select id into v_unit from public.units where org_id = o limit 1;

  -- 1. criar plano QA (nenhum preço inventado) e validar limites
  set local role authenticated; perform pg_temp.as_user(u_other);
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.platform_plan_save('qa_limites', '{"name":"Plano QA"}')$q$) like '42501%', 'quem não é administrador da plataforma não cria plano');
  perform pg_temp.as_user(pa);
  j := public.platform_plan_save('qa_limites', jsonb_build_object('name', 'Plano QA (limites)', 'description', 'Plano de teste: sem preço, só limites', 'included_modules', jsonb_build_array('crm', 'agenda'), 'limits', jsonb_build_object('max_units', 1, 'max_professionals', 0)));
  rep := rep || pg_temp.chk(j ->> 'status' = 'draft' and j ->> 'monthly_fee_cents' is null and j ->> 'implementation_fee_cents' is null and (j -> 'limits' ->> 'max_units') = '1', 'plano QA nasce em rascunho, SEM preço (a plataforma não inventa valores)');
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.platform_plan_save('qa_limites', '{"limits":{"max_units":-1}}')$q$) like '%limites inválidos%', 'limite negativo é recusado');
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.platform_plan_save('qa_limites', '{"limits":{"max_units":1.5}}')$q$) like '%limites inválidos%', 'limite fracionário é recusado');
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.platform_plan_save('qa_limites', '{"limits":{"max_units":"muitos"}}')$q$) like '%limites inválidos%', 'limite em texto é recusado');
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.platform_plan_save('qa_limites', '{"limits":{"max_foguetes":3}}')$q$) like '%limites inválidos%', 'limite desconhecido é recusado');
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.platform_plan_save('qa_limites', '{"included_modules":["modulo_que_nao_existe"]}')$q$) like '%módulo incluído desconhecido%', 'módulo inexistente no plano é recusado');
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.platform_plan_save('qa_limites', '{"status":"voando"}')$q$) like '%estado de plano inválido%', 'estado de plano inválido é recusado');

  -- 2. associar a organização ao plano (assinatura) — qualquer um que não seja administrador da plataforma é recusado
  perform pg_temp.as_user(u_mgr, o); rep := rep || pg_temp.chk(pg_temp.err(format('select public.platform_subscription_set(%L, %L)', o, '{"plan_key":"qa_limites"}')) like '42501%', 'gestor da clínica não troca o plano da própria organização');
  perform pg_temp.as_user(pa);
  j := public.platform_subscription_set(o, '{"plan_key":"qa_limites","notes":"associada ao plano QA"}');
  rep := rep || pg_temp.chk(j ->> 'plan_key' = 'qa_limites' and j ->> 'enforcement' = 'warn', 'organização associada ao plano; imposição padrão = só avisar');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.platform_subscription_set(%L, %L)', o, '{"plan_key":"plano_que_nao_existe"}')) like '%plano não encontrado%', 'plano inexistente é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.platform_subscription_set(%L, %L)', o, '{"enforcement":"cobrar"}')) like '%imposição inválida%', 'imposição inválida é recusada');
  reset role;

  -- 3. estados: nao_configurado × ilimitado × zero × acima/ok
  rep := rep || pg_temp.chk(pg_temp.st(o, 'max_active_patients') is null and pg_temp.st(o, 'active_patients') = 'nao_configurado', 'limite NÃO configurado (chave ausente) aparece como "nao_configurado"');
  rep := rep || pg_temp.chk(pg_temp.st(o, 'professionals') = 'zero', 'limite 0 (e uso 0) aparece como "zero"');
  rep := rep || pg_temp.chk(pg_temp.st(o, 'units') = 'perto' or pg_temp.st(o, 'units') = 'ok', 'unidades: 1 de 1 → perto do limite (100%)');
  set local role authenticated; perform pg_temp.as_user(pa);
  perform public.platform_subscription_set(o, '{"limits_override":{"max_units":null}}'); reset role;
  rep := rep || pg_temp.chk(pg_temp.st(o, 'units') = 'ilimitado', 'nulo explícito na exceção da organização = "ilimitado" (sobrepõe o plano)');
  set local role authenticated; perform pg_temp.as_user(pa); perform public.platform_subscription_set(o, '{"limits_override":{}}'); reset role;
  rep := rep || pg_temp.chk(pg_temp.st(o, 'units') in ('perto', 'ok', 'acima'), 'sem exceção, volta o limite do plano');

  -- 4. imposição: só NOVAS criações, só com block_new; histórico e leitura continuam
  select count(*) into v_before from public.units where org_id = o;
  insert into public.units (org_id, name, slug) values (o, 'Unidade extra (aviso)', 'extra-aviso-n25');
  rep := rep || pg_temp.chk((select count(*) from public.units where org_id = o) = v_before + 1, 'com imposição "warn" (padrão) a criação acima do limite passa (só avisa)');
  delete from public.units where slug = 'extra-aviso-n25' and org_id = o;
  set local role authenticated; perform pg_temp.as_user(pa); perform public.platform_subscription_set(o, '{"enforcement":"block_new"}'); reset role;
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.units (org_id, name, slug) values (%L, %L, %L)', o, 'Unidade extra (bloqueio)', 'extra-bloqueio-n25')) like 'P0011%', 'com "block_new" e limite 1 atingido, nova unidade é BLOQUEADA (P0011)');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.professionals (org_id, display_name, active) values (%L, %L, true)', o, 'Profissional bloqueado')) like 'P0011%', 'limite ZERO bloqueia qualquer profissional novo');
  rep := rep || pg_temp.chk((select count(*) from public.units where org_id = o) = v_before, 'o bloqueio não apagou nem alterou dados existentes');
  set local role authenticated; perform pg_temp.as_user(u_mgr, o);
  rep := rep || pg_temp.chk((select count(*) from public.units) = v_before and pg_temp.err('select * from public.org_usage()') is null, 'gestor continua lendo dados e consumo com o limite atingido (histórico e consulta não são bloqueados)');
  perform pg_temp.as_user(pa); perform public.platform_subscription_set(o, '{"limits_override":{"max_units":null,"max_professionals":null}}'); reset role;
  insert into public.units (org_id, name, slug) values (o, 'Unidade extra (ilimitado)', 'extra-ilim-n25'); insert into public.professionals (org_id, display_name, active) values (o, 'Profissional liberado', true);
  rep := rep || pg_temp.chk((select count(*) from public.units where org_id = o) = v_before + 1 and (select count(*) from public.professionals where org_id = o and display_name = 'Profissional liberado') = 1, 'ilimitado libera novas criações mesmo com imposição ligada');
  -- 5. o plano não mexe nos módulos da organização (módulos continuam sendo escolhidos pela plataforma) nem no financeiro da clínica
  rep := rep || pg_temp.chk((select count(*) from public.org_modules where org_id = o and module_key in ('crm', 'agenda')) >= 1 and (select count(*) from public.sales where org_id = o) = 0, 'associar plano não cria nem remove módulo e não gera venda/recebível da clínica (faturamento da plataforma ≠ financeiro da clínica)');

  -- 6. histórico antes/depois
  set local role authenticated; perform pg_temp.as_user(pa);
  perform public.platform_plan_save('qa_limites', '{"limits":{"max_units":3,"max_professionals":2},"included_modules":["crm","agenda","financeiro"]}');
  h := public.platform_history('plan', 'qa_limites');
  rep := rep || pg_temp.chk(jsonb_array_length(h) = 2 and (h -> 0 -> 'before' -> 'limits' ->> 'max_units') = '1' and (h -> 0 -> 'after' -> 'limits' ->> 'max_units') = '3' and (h -> 1 -> 'before') = 'null'::jsonb, 'histórico do plano: criação e alteração, com valor anterior e novo');
  h := public.platform_history('subscription', o::text);
  rep := rep || pg_temp.chk(jsonb_array_length(h) >= 5 and (h -> 0 -> 'after' ->> 'enforcement') = 'block_new' and (h -> 0 -> 'before' ->> 'enforcement') = 'block_new' is not null, 'histórico da assinatura registra cada mudança de plano, imposição e exceção');
  perform pg_temp.as_user(u_mgr, o); rep := rep || pg_temp.chk(pg_temp.err($q$select public.platform_history('plan', 'qa_limites')$q$) like '42501%', 'histórico só para a plataforma');
  reset role;
  raise exception 'RELATORIO_N25%', rep;
end $$;
