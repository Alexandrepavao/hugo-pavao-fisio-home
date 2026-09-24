-- Teste das novas telas de Configurações (Operação e Comercial/CRM, adicionadas nesta rodada): manager/ops_admin
-- conseguem criar/editar serviços, produtos, funis, etapas e motivos de perda pela mesma policy de RLS que a
-- tela usa; papéis sem permissão (sales, unit_manager) são bloqueados de verdade pelo banco, não só escondidos
-- na interface — a UI podendo ou não exibir o botão não é garantia de segurança. Transação desfeita.
do $$
declare
  v_org uuid; v_ua uuid; u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_um uuid := gen_random_uuid();
  svc uuid; prod uuid; pipe uuid; stage uuid; reason uuid;
  ok boolean; rep text := '';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m-set@t.local'),(u_sales,'authenticated','authenticated','s-set@t.local'),(u_um,'authenticated','authenticated','u-set@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_mgr, v_org),(u_sales, v_org),(u_um, v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', v_ua),(v_org, u_um, 'unit_manager', v_ua);

  -- manager: cria e edita serviço, produto, funil, etapa e motivo de perda — a mesma sequência que a tela de Configurações faz
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.services (org_id, name, duration_min, price_cents) values (v_org, 'Serviço Settings E2E', 60, 20000) returning id into svc;
  update public.services set price_cents = 25000 where id = svc;
  rep := rep || format(E'\n[%s] manager cria e edita serviço (Operação) (%s)', case when (select price_cents from public.services where id = svc) = 25000 then 'OK' else 'FALHA' end, (select price_cents from public.services where id = svc));

  -- pacote exige serviço vinculado (constraint products_check) — a tela nova cobre isso com um seletor de serviço
  insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id) values (v_org, 'package', 'Pacote Settings E2E', 90000, 10, svc) returning id into prod;
  update public.products set active = false where id = prod;
  rep := rep || format(E'\n[%s] manager cria e edita produto/pacote (Operação) (%s)', case when (select active from public.products where id = prod) = false then 'OK' else 'FALHA' end, (select active from public.products where id = prod));

  insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil Settings E2E', 'custom') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Etapa Settings E2E', 1, 'open') returning id into stage;
  insert into public.loss_reasons (org_id, name) values (v_org, 'Motivo Settings E2E') returning id into reason;
  rep := rep || format(E'\n[%s] manager cria funil, etapa e motivo de perda (Comercial e CRM)', case when pipe is not null and stage is not null and reason is not null then 'OK' else 'FALHA' end);
  reset role;

  -- sales: bloqueado de escrever em qualquer uma das cinco tabelas (só leitura)
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.services (org_id, name, duration_min, price_cents) values (v_org, 'Serviço via sales (deve falhar)', 30, 1000); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial (sales) não cria serviço', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin update public.services set price_cents = 1 where id = svc; exception when others then ok := true; end;
  -- update sem match de RLS não levanta exceção por padrão (0 linhas afetadas) — confirmamos que o valor não mudou
  rep := rep || format(E'\n[%s] comercial (sales) não edita serviço existente (preço permanece %s)', case when (select price_cents from public.services where id = svc) = 25000 then 'OK' else 'FALHA' end, (select price_cents from public.services where id = svc));
  ok := false; begin insert into public.products (org_id, kind, name, price_cents) values (v_org, 'service', 'Produto via sales (deve falhar)', 1000); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial (sales) não cria produto', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil via sales (deve falhar)', 'custom'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial (sales) não cria funil', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Etapa via sales (deve falhar)', 2, 'open'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial (sales) não cria etapa', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin insert into public.loss_reasons (org_id, name) values (v_org, 'Motivo via sales (deve falhar)'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] comercial (sales) não cria motivo de perda', case when ok then 'OK' else 'FALHA' end);
  -- mas sales continua lendo o catálogo normalmente (precisa disso pra vender/abrir oportunidade)
  rep := rep || format(E'\n[%s] comercial (sales) continua lendo serviços e funis normalmente', case when (select count(*) from public.services where id = svc) = 1 and (select count(*) from public.pipelines where id = pipe) = 1 then 'OK' else 'FALHA' end);
  reset role;

  -- unit_manager: mesmo bloqueio (só manager/ops_admin escrevem catálogo/funil)
  perform set_config('request.jwt.claims', json_build_object('sub', u_um, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.services (org_id, name, duration_min, price_cents) values (v_org, 'Serviço via unit_manager (deve falhar)', 30, 1000); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] gestor de unidade não cria serviço (só manager/ops_admin)', case when ok then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_SETTINGS_OPERACAO_CRM (transação desfeita):%', rep;
end $$;
