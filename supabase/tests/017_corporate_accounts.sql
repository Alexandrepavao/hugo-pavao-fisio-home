-- Contas corporativas: empresa cliente do HP (nunca organização nova), contatos com um único responsável
-- financeiro, contratos + itens (produto/condição), pessoas atendidas ligadas sem duplicar cadastro,
-- relatório de utilização/valores com o mesmo piso de k-anonimato (5+) já usado em corporate_indicators,
-- permissões (sales não lê contas corporativas, só finance/gestão). Transação sempre desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_unit uuid; rep text := '';
  u_mgr uuid; u_sales uuid; v_account uuid; v_contact1 uuid; v_contract uuid; v_product uuid;
  people_before int; people_after int; ok boolean; n int; rpt jsonb;
  pids uuid[] := '{}';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_unit from public.units where org_id = v_org and slug = 'sao-paulo';
  select id into v_product from public.products limit 1;

  u_mgr := gen_random_uuid();
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'ca.mgr@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_mgr, v_org, 'CA Gestora');
  insert into public.role_assignments (org_id, user_id, role) values (v_org, u_mgr, 'manager');

  u_sales := gen_random_uuid();
  insert into auth.users (id, aud, role, email) values (u_sales, 'authenticated', 'authenticated', 'ca.sales@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_sales, v_org, 'CA Comercial');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_sales, 'sales', v_unit);

  -- ---------- criar conta corporativa
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.corporate_accounts (org_id, unit_id, name, document) values (v_org, v_unit, 'CA Empresa Teste', '00.000.000/0001-00') returning id into v_account;
  reset role;
  rep := rep || format(E'\n[%s] conta corporativa criada', case when v_account is not null then 'OK' else 'FALHA' end);

  -- ---------- papel comercial (sales) não lê contas corporativas
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.corporate_accounts where id = v_account;
  reset role;
  rep := rep || format(E'\n[%s] papel comercial (sales) não enxerga a conta corporativa (RLS)', case when n = 0 then 'OK' else 'FALHA' end);

  -- ---------- contato responsável financeiro: só um por conta
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.corporate_contacts (account_id, name, role, email, is_billing) values (v_account, 'Contato Financeiro 1', 'Financeiro', 'fin1@empresa.test', true) returning id into v_contact1;
  begin insert into public.corporate_contacts (account_id, name, is_billing) values (v_account, 'Contato Financeiro 2', true); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] segundo contato marcado como responsável financeiro é rejeitado (só um por conta)', case when not ok then 'OK' else 'FALHA' end);

  -- ---------- contrato + item (produto/condição)
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.corporate_contracts (account_id, title, created_by) values (v_account, 'Contrato Anual 2026', u_mgr) returning id into v_contract;
  insert into public.corporate_contract_items (contract_id, product_id, condition_notes) values (v_contract, v_product, '15% de desconto, faturamento mensal');
  reset role;
  rep := rep || format(E'\n[%s] contrato corporativo e item (produto + condição negociada) criados', case when exists (select 1 from public.corporate_contract_items where contract_id = v_contract) then 'OK' else 'FALHA' end);

  -- ---------- ligar pessoa já cadastrada NUNCA duplica o cadastro dela
  select count(*) into people_before from public.people where org_id = v_org;
  declare pid uuid; begin
    insert into public.people (org_id, unit_id, full_name) values (v_org, v_unit, 'CA Pessoa Atendida 1') returning id into pid;
    pids := pids || pid;
  end;
  select count(*) into people_after from public.people where org_id = v_org;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.corporate_members (account_id, person_id) values (v_account, pids[1]);
  reset role;
  select count(*) into n from public.people where org_id = v_org;
  rep := rep || format(E'\n[%s] vincular pessoa à conta corporativa não cria nem duplica cadastro (%s pessoas antes de vincular, %s depois)', case when n = people_after then 'OK' else 'FALHA' end, people_after, n);

  -- ---------- relatório de utilização: k-anonimato (< 5 vínculos = indisponível)
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.corporate_account_report(v_account, null, null) into rpt;
  reset role;
  rep := rep || format(E'\n[%s] com 1 pessoa vinculada, relatório fica indisponível (k-anonimato)', case when (rpt->>'available')::boolean = false and (rpt->>'members')::int = 1 then 'OK' else 'FALHA' end);

  -- ---------- mais 4 pessoas (total 5): relatório libera
  for n in 2..5 loop
    declare pid uuid; begin
      insert into public.people (org_id, unit_id, full_name) values (v_org, v_unit, 'CA Pessoa Atendida ' || n) returning id into pid;
      pids := pids || pid;
    end;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.corporate_members (account_id, person_id) select v_account, unnest(pids[2:5]);
  select public.corporate_account_report(v_account, null, null) into rpt;
  reset role;
  rep := rep || format(E'\n[%s] com 5 pessoas vinculadas, relatório libera (members=%s, available=%s)', case when (rpt->>'available')::boolean = true and (rpt->>'members')::int = 5 then 'OK' else 'FALHA' end, rpt->>'members', rpt->>'available');

  -- ---------- papel comercial não lê o relatório
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.corporate_account_report(v_account, null, null); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] papel comercial (sales) não acessa o relatório de utilização', case when not ok then 'OK' else 'FALHA' end);

  raise exception E'RELATORIO_CORPORATE_ACCOUNTS (transação desfeita):%', rep;
end $$;
