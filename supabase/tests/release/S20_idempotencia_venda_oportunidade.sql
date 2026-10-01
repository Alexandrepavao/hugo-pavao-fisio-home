-- RELEASE v1 — S20: duplo clique e retentativa não duplicam a venda nem a oportunidade (migration 078): chave de idempotência em sale_create, uma venda PENDENTE por oportunidade,
-- recusa de segunda oportunidade aberta da mesma pessoa no mesmo funil, e liberação depois que a primeira é confirmada/cancelada/fechada. Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; ua uuid; pipe uuid; st_new uuid; st_lost uuid; prod uuid; p1 uuid; p2 uuid; o1 uuid; o2 uuid; s1 uuid; s1b uuid; s2 uuid; s3 uuid; s4 uuid; n bigint; n2 bigint; t text;
  u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); rep text := '';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S20)', 'teste-a-s20') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s20.local'),(u_sales,'authenticated','authenticated','s@s20.local'),(u_phy,'authenticated','authenticated','ph@s20.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S20'),(u_sales, v_org, null, 'Comercial S20'),(u_phy, v_org, null, 'Fisio S20');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', ua),(v_org, u_phy, 'physio', ua);
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil S20', 'custom') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Novo', 1, 'open') returning id into st_new;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Perdido', 2, 'lost') returning id into st_lost;
  insert into public.loss_reasons (org_id, name) values (v_org, 'Motivo S20') on conflict do nothing;
  insert into public.products (org_id, kind, name, price_cents, active) values (v_org, 'service', 'Produto S20', 25000, true) returning id into prod;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pessoa Um S20') returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pessoa Dois S20') returning id into p2;
  set local role authenticated; perform pg_temp.as_user(u_sales);

  -- ============ 1) oportunidade: não cria outra ABERTA da mesma pessoa no mesmo funil
  o1 := public.crm_create_opportunity(p1, pipe, ua, 'Primeira', null, 0, u_sales, 'teste', null);
  rep := rep || pg_temp.chk(o1 is not null, 'cria a primeira oportunidade');
  t := pg_temp.err(format('select public.crm_create_opportunity(%L, %L, %L, ''Segunda'', null, 0, %L, ''teste'', null)', p1, pipe, ua, u_sales));
  rep := rep || pg_temp.chk(t like '%já existe uma oportunidade aberta%', 'repetir (duplo clique / retentativa) é recusado com mensagem clara');
  select count(*) into n from public.opportunities where person_id = p1 and pipeline_id = pipe; rep := rep || pg_temp.chk(n = 1, 'continua UMA oportunidade');
  o2 := public.crm_create_opportunity(p2, pipe, ua, 'Outra pessoa', null, 0, u_sales, 'teste', null); rep := rep || pg_temp.chk(o2 is not null, 'outra pessoa no mesmo funil pode ter a sua');
  update public.opportunities set stage_id = st_lost, lost_reason_id = (select id from public.loss_reasons where org_id = v_org and name = 'Motivo S20') where id = o1;
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_create_opportunity(%L, %L, %L, ''Depois de perdida'', null, 0, %L, ''teste'', null)', p1, pipe, ua, u_sales)) is null, 'depois que a primeira é fechada (perdida) a pessoa pode ter uma nova oportunidade');
  o1 := (select id from public.opportunities where person_id = p1 and status = 'open');
  rep := rep || pg_temp.chk(o1 is not null, 'a nova está aberta');

  -- ============ 2) venda: a mesma chave devolve a MESMA venda
  s1 := public.sale_create(p1, ua, o1, ('[{"product_id":"' || prod || '","qty":1}]')::jsonb, 0, 1, current_date, null, 'chave-s20-a');
  s1b := public.sale_create(p1, ua, o1, ('[{"product_id":"' || prod || '","qty":1}]')::jsonb, 0, 1, current_date, null, 'chave-s20-a');
  rep := rep || pg_temp.chk(s1 is not null and s1 = s1b, 'repetir a mesma tentativa (mesma chave) devolve a mesma venda');
  select count(*) into n from public.sales where person_id = p1; select count(*) into n2 from public.sale_items where sale_id = s1;
  rep := rep || pg_temp.chk(n = 1 and n2 = 1, 'uma venda e um item (nada duplicado)');
  rep := rep || pg_temp.chk((select total_cents from public.sales where id = s1) = 25000, 'total calculado: R$ 250,00');
  t := pg_temp.err(format('select public.sale_create(%L, %L, null, ''[{"product_id":"%s","qty":1}]''::jsonb, 0, 1, current_date, null, ''chave-s20-a'')', p2, ua, prod));
  rep := rep || pg_temp.chk(t like '%já usada por outra venda%', 'a mesma chave para OUTRA pessoa é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.sale_create(%L, %L, null, ''[{"product_id":"%s","qty":1}]''::jsonb, 0, 1, current_date, null, %L)', p2, ua, prod, repeat('x', 201))) like '%muito longa%', 'chave gigante é recusada');

  -- ============ 3) sem chave: só UMA venda pendente por oportunidade
  t := pg_temp.err(format('select public.sale_create(%L, %L, %L, ''[{"product_id":"%s","qty":1}]''::jsonb, 0, 1, current_date)', p1, ua, o1, prod));
  rep := rep || pg_temp.chk(t like '%já existe uma venda pendente%', 'segunda venda pendente da mesma oportunidade (sem chave) é recusada');
  select count(*) into n from public.sales where opportunity_id = o1; rep := rep || pg_temp.chk(n = 1, 'continua UMA venda da oportunidade');
  perform public.sale_confirm(s1);
  perform public.sale_confirm(s1);
  select count(*) into n from public.receivables where sale_id = s1; select count(*) into n2 from public.contracts where sale_id = s1;
  rep := rep || pg_temp.chk(n = 1 and n2 = 1, 'confirmar duas vezes não duplica parcela nem contrato');
  s2 := public.sale_create(p1, ua, o1, ('[{"product_id":"' || prod || '","qty":2}]')::jsonb, 0, 1, current_date, null, 'chave-s20-b');
  rep := rep || pg_temp.chk(s2 is not null and s2 <> s1, 'depois de confirmada a primeira, uma NOVA venda (nova chave) da mesma oportunidade é permitida');
  s3 := public.sale_create(p1, ua, o1, ('[{"product_id":"' || prod || '","qty":2}]')::jsonb, 0, 1, current_date, null, 'chave-s20-b');
  rep := rep || pg_temp.chk(s3 = s2, 'e repetir esta segunda tentativa devolve a mesma');
  perform public.sale_cancel(s2, 'teste S20');
  s4 := public.sale_create(p1, ua, o1, ('[{"product_id":"' || prod || '","qty":1}]')::jsonb, 0, 1, current_date);
  rep := rep || pg_temp.chk(s4 is not null and s4 not in (s1, s2), 'depois de cancelar a pendente, outra pode ser criada');
  rep := rep || pg_temp.chk((select opportunity_id from public.sales where id = s4) = o1 and (select person_id from public.sales where id = s4) = p1 and (select unit_id from public.sales where id = s4) = ua, 'a venda carrega oportunidade, pessoa e unidade (rastreabilidade)');
  -- venda avulsa (sem oportunidade) continua livre
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.sale_create(%L, %L, null, ''[{"product_id":"%s","qty":1}]''::jsonb, 0, 1, current_date)', p2, ua, prod)) is null
                         and pg_temp.err(format('select public.sale_create(%L, %L, null, ''[{"product_id":"%s","qty":1}]''::jsonb, 0, 1, current_date)', p2, ua, prod)) is null, 'venda avulsa sem oportunidade e sem chave segue livre (a regra vale por oportunidade ou por chave)');

  -- ============ 4) permissões e chaves por organização
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.sale_create(%L, %L, null, ''[{"product_id":"%s","qty":1}]''::jsonb, 0, 1, current_date, null, ''chave-fisio'')', p1, ua, prod)) like '42501%', 'fisioterapeuta NÃO cria venda (42501), nem com chave');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_create_opportunity(%L, %L, %L, ''x'', null, 0, null, ''t'', null)', p2, pipe, ua)) is not null, 'fisioterapeuta NÃO cria oportunidade');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.sale_create(%L, %L, null, ''[]''::jsonb)', p1, ua)) is not null, 'anônimo NÃO executa sale_create');
  reset role;
  select count(*) into n from public.sales where idempotency_key = 'chave-fisio'; rep := rep || pg_temp.chk(n = 0, 'nenhuma venda foi criada pelos acessos negados');

  raise exception E'RELATORIO_S20_IDEMPOTENCIA (transação desfeita):%', rep;
end $$;
