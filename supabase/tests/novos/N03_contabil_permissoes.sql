-- NOVO (etapa ADM+Contábil, 2026-09-29) — permissões do app Contábil (migrations 048-050).
-- Cobre: quem acessa o app, isolamento entre unidades, RLS de leitura/escrita direta, concessões específicas de fechar/reabrir
-- (papel sozinho não basta; gestor também precisa da concessão), escopo por unidade, revogação do papel, pseudônimo de
-- pacientes para o contador, configuração só para gestão e storage privado. Transação desfeita.
create or replace function pg_temp.res(p_ok boolean, p_msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when p_ok then 'OK' else 'FALHA' end, p_msg) $$;
do $$
declare
  v_org uuid; v_ua uuid; v_ub uuid := gen_random_uuid();
  u_mgr uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_acc uuid := gen_random_uuid(); u_accb uuid := gen_random_uuid();
  u_sales uuid := gen_random_uuid(); u_mem uuid := gen_random_uuid(); u_um uuid := gen_random_uuid();
  rep text := ''; ok boolean; n int; c jsonb; x jsonb; v_person uuid; v_sale uuid; v_rec uuid; v_pay uuid; v_docA uuid; v_pathA text; v_pathB text; st text; ss text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into public.units (id, org_id, name, slug) values (v_ub, v_org, 'Unidade B (teste)', 'unidade-b-teste');
  insert into auth.users (id, aud, role, email) select t.u, 'authenticated', 'authenticated', t.nm || '@t.local'
    from (values (u_mgr,'n03mgr'),(u_fin,'n03fin'),(u_acc,'n03acc'),(u_accb,'n03accb'),(u_sales,'n03sales'),(u_mem,'n03mem'),(u_um,'n03um')) t(u, nm);
  insert into public.user_accounts (user_id, org_id) values (u_mgr,v_org),(u_fin,v_org),(u_acc,v_org),(u_accb,v_org),(u_sales,v_org),(u_mem,v_org),(u_um,v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values
    (v_org,u_mgr,'manager',null),(v_org,u_fin,'finance',v_ua),(v_org,u_acc,'accountant',v_ua),(v_org,u_accb,'accountant',v_ub),
    (v_org,u_sales,'sales',v_ua),(v_org,u_mem,'member',null),(v_org,u_um,'unit_manager',v_ua);
  select id into v_person from public.people where org_id = v_org and full_name is not null limit 1;
  insert into public.sales (org_id, unit_id, person_id) values (v_org, v_ua, v_person) returning id into v_sale;
  insert into public.receivables (org_id, unit_id, sale_id, person_id, installment_no, installments_total, due_date, competence_month, amount_cents, status)
    values (v_org, v_ua, v_sale, v_person, 1, 1, '2019-04-10', '2019-04-01', 25000, 'open') returning id into v_rec;

  -- ---- quem acessa o app
  foreach st in array array['sales','member'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case st when 'sales' then u_sales else u_mem end, 'role','authenticated')::text, true); set local role authenticated;
    ok := false; begin perform public.acc_context(); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || pg_temp.res(ok, st || ' não acessa o app Contábil');
    ok := false; begin perform public.acc_dashboard(v_ua, '2019-04-01'); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || pg_temp.res(ok, st || ' não consulta dashboard contábil (backend nega, não só a interface)');
    reset role;
  end loop;
  foreach st in array array['accountant','finance','unit_manager','manager'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case st when 'accountant' then u_acc when 'finance' then u_fin when 'unit_manager' then u_um else u_mgr end, 'role','authenticated')::text, true); set local role authenticated;
    c := public.acc_context();
    rep := rep || pg_temp.res(jsonb_array_length(c->'units') >= 1 and c->'org'->>'name' is not null, st || ' acessa o app e enxerga a organização e suas unidades');
    reset role;
  end loop;

  -- ---- isolamento por unidade
  perform set_config('request.jwt.claims', json_build_object('sub', u_acc, 'role','authenticated')::text, true); set local role authenticated;
  c := public.acc_context();
  rep := rep || pg_temp.res(jsonb_array_length(c->'units') = 1 and c->'units'->0->>'id' = v_ua::text, 'contador da unidade A vê só a unidade A no seletor');
  ok := false; begin perform public.acc_dashboard(v_ub, '2019-04-01'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'contador da unidade A não consulta a unidade B (dashboard)');
  ok := false; begin perform public.acc_ledger_list(v_ub, '2019-04-01'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'contador da unidade A não consulta lançamentos da unidade B');
  ok := false; begin perform public.acc_export_data(v_ub, '2019-04-01'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'contador da unidade A não exporta a unidade B');
  x := public.acc_ledger_list(v_ua, '2019-04-01', 'competencia');
  rep := rep || pg_temp.res((x->>'total')::int = 1, 'contador da unidade A vê o lançamento da unidade A');
  rep := rep || pg_temp.res(x->'rows'->0->>'counterparty' like 'Paciente %' and not (x->>'names_visible')::boolean, 'contador recebe pseudônimo do paciente (nome real não aparece)');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  x := public.acc_ledger_list(v_ua, '2019-04-01', 'competencia');
  rep := rep || pg_temp.res(x->'rows'->0->>'counterparty' not like 'Paciente %' and (x->>'names_visible')::boolean, 'financeiro da unidade vê o nome do paciente');
  reset role;

  -- ---- RLS: nenhuma escrita direta; leitura só da unidade
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin insert into public.acc_periods (org_id, unit_id, competence_month, status) values (v_org, v_ua, '2019-04-01', 'closed'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'financeiro não cria período fechado por INSERT direto');
  ok := false; begin insert into public.acc_classifications (org_id, unit_id, source_type, source_id, account_id) values (v_org, v_ua, 'receivable', v_rec, gen_random_uuid()); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'financeiro não classifica por INSERT direto');
  ok := false; begin insert into public.acc_grants (org_id, user_id, permission) values (v_org, u_fin, 'close'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'ninguém concede a si mesmo permissão de fechar por INSERT direto');
  ok := false; begin perform public.acc_grant_set(u_fin, 'close', null, true); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'financeiro não concede permissão de fechar a si mesmo pela RPC');
  ok := false; begin perform public.acc_settings_save(false, 0, false, 5); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'financeiro não altera as configurações contábeis');
  ok := false; begin perform public.acc_account_upsert(null, 'X1', 'Conta X', 'expense'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'financeiro não cria classificação (só gestão)');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_accb, 'role','authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.acc_periods where unit_id = v_ua;
  rep := rep || pg_temp.res(n = 0, 'contador da unidade B não lê períodos da unidade A (RLS)');
  reset role;

  -- ---- concessões específicas
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true); set local role authenticated;
  perform public.acc_period_request_review(v_ua, '2019-04-01');
  ok := false; begin perform public.acc_period_close(v_ua, '2019-04-01'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'gestor SEM concessão específica não fecha competência (papel sozinho não basta)');
  ok := false; begin perform public.acc_period_reopen(v_ua, '2019-04-01', 'tentando reabrir sem concessão'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'gestor SEM concessão específica não reabre competência');
  perform public.acc_grant_set(u_fin, 'close', v_ua, true);
  ok := false; begin perform public.acc_grant_set(u_sales, 'close', null, true); exception when others then ok := sqlstate <> '42501'; end;
  rep := rep || pg_temp.res(ok, 'concessão exige papel contábil/financeiro (comercial não recebe)');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  c := public.acc_context();
  rep := rep || pg_temp.res((c->'units'->0->>'can_close')::boolean and not (c->'units'->0->>'can_reopen')::boolean, 'contexto informa: pode fechar, não pode reabrir (concessões são separadas)');
  ok := false; begin perform public.acc_period_reopen(v_ua, '2019-04-01', 'sem concessão de reabrir, deve falhar'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'quem pode fechar não pode reabrir sem a concessão de reabrir');
  reset role;

  -- concessão por unidade não vale em outra unidade
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true); set local role authenticated;
  perform public.acc_grant_set(u_accb, 'close', v_ua, true);      -- concedida para a unidade A, mas o contador B só tem papel na B
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_accb, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.acc_period_close(v_ua, '2019-04-01'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'concessão não vale sem papel na unidade (contador da B não fecha a A)');
  reset role;

  -- revogar o papel derruba o poder na hora
  update public.role_assignments set revoked_at = now() where user_id = u_fin and role = 'finance';
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.acc_period_close(v_ua, '2019-04-01'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'papel revogado: a concessão de fechar deixa de valer imediatamente');
  ok := false; begin perform public.acc_context(); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'papel revogado: sem acesso ao app');
  reset role;

  -- ---- storage privado (mesma regra da tabela)
  v_pathA := v_org || '/' || v_ua || '/2019-04/' || gen_random_uuid() || '-teste.pdf';
  v_pathB := v_org || '/' || v_ub || '/2019-04/' || gen_random_uuid() || '-teste.pdf';
  insert into storage.objects (bucket_id, name) values ('accounting-private', v_pathA), ('accounting-private', v_pathB);
  perform set_config('request.jwt.claims', json_build_object('sub', u_acc, 'role','authenticated')::text, true); set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'accounting-private' and split_part(name, '/', 2) = v_ub::text;
  ok := n = 0 and exists (select 1 from storage.objects where bucket_id = 'accounting-private' and name = v_pathA);
  rep := rep || pg_temp.res(ok, 'contador da A enxerga o arquivo da unidade A e nenhum da unidade B no bucket privado (da B vê ' || n || ')');
  ok := false; begin insert into storage.objects (bucket_id, name) values ('accounting-private', v_org || '/' || v_ub || '/2019-04/' || gen_random_uuid() || '-x.pdf'); exception when others then ok := true; end;
  rep := rep || pg_temp.res(ok, 'contador da A não envia arquivo para a pasta da unidade B');
  ok := false; begin delete from storage.objects where bucket_id = 'accounting-private' and name = v_pathA; get diagnostics n = row_count; ok := n = 0; exception when others then ok := true; end;
  rep := rep || pg_temp.res(ok, 'usuário não apaga arquivo contábil (sem política de DELETE)');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true); set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'accounting-private';
  rep := rep || pg_temp.res(n = 0, 'comercial não enxerga nenhum arquivo contábil');
  reset role;

  -- ---- acesso a documento: autorizado e auditado; de outra unidade, negado
  perform set_config('request.jwt.claims', json_build_object('sub', u_acc, 'role','authenticated')::text, true); set local role authenticated;
  x := public.acc_document_register(v_ua, '2019-04-01', 'period', null, 'extrato', 'Extrato de abril', v_pathA, 'application/pdf', 1234);
  v_docA := (x->>'id')::uuid;
  ok := false; begin perform public.acc_document_register(v_ua, '2019-04-01', 'period', null, 'extrato', 'Arquivo alheio', v_pathB, 'application/pdf', 10); exception when others then ok := true; end;
  rep := rep || pg_temp.res(ok, 'não registra documento apontando para o caminho de outra unidade');
  x := public.acc_documents_access(array[v_docA]);
  rep := rep || pg_temp.res(x->0->>'path' = v_pathA, 'contador autorizado obtém o caminho do documento da própria unidade');
  reset role;
  select count(*) into n from public.audit_log where action = 'acc_document_access' and actor_user_id = u_acc;
  rep := rep || pg_temp.res(n = 1, 'acesso ao documento fica na auditoria');
  perform set_config('request.jwt.claims', json_build_object('sub', u_accb, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.acc_documents_access(array[v_docA]); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.res(ok, 'contador da B não acessa documento da unidade A');
  reset role;

  raise exception E'RELATORIO_N03_CONTABIL_PERMISSOES (transação desfeita):%', rep;
end $$;
