-- NOVO (etapa ADM+Contábil, 2026-09-29) — importação CSV de PJ (legal_entity_import_check/commit, migration 047).
-- Cobre: validação por linha, CNPJ duplicado no arquivo, reimportação sem duplicar, ausência de sobrescrita silenciosa,
-- atualização só por decisão explícita e só dos campos escolhidos, arquivado, auditoria e permissão. Transação desfeita.
do $$
declare
  v_org uuid; v_ua uuid; u_mgr uuid := gen_random_uuid(); u_um uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid();
  rows_ jsonb; r jsonb; c jsonb; n int; ok boolean; rep text := ''; nm text; ph text; tr text;
  c1 text := '11222333000181'; c2 text := '45723174000110';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','n01m@t.local'),(u_um,'authenticated','authenticated','n01u@t.local'),(u_sales,'authenticated','authenticated','n01s@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_mgr, v_org),(u_um, v_org),(u_sales, v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_um, 'unit_manager', v_ua),(v_org, u_sales, 'sales', v_ua);
  delete from public.legal_entities where org_id = v_org and cnpj in (c1, c2);
  rep := rep || format(E'\n[%s] pré-condição: CNPJs de teste válidos', case when private.is_valid_cnpj(c1) and private.is_valid_cnpj(c2) then 'OK' else 'FALHA' end);

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;

  -- 1) análise: nova, CNPJ inválido, sem razão social, repetido no arquivo
  rows_ := jsonb_build_array(
    jsonb_build_object('line',2,'cnpj','11.222.333/0001-81','legal_name','Clínica Alfa Ltda','email_general','alfa@x.com','phone','(11) 98888-7777','city','São Paulo','state_uf','sp'),
    jsonb_build_object('line',3,'cnpj','11.222.333/0001-82','legal_name','CNPJ Errado'),
    jsonb_build_object('line',4,'cnpj','45.723.174/0001-10','legal_name',''),
    jsonb_build_object('line',5,'cnpj','11222333000181','legal_name','Alfa repetida'));
  c := public.legal_entity_import_check(rows_);
  rep := rep || format(E'\n[%s] linha 2 nova; linha 3 CNPJ inválido; linha 4 sem razão social; linha 5 repetida no arquivo',
    case when c->0->>'status' = 'new' and c->1->>'status' = 'invalid' and c->2->>'status' = 'invalid' and c->3->>'status' = 'duplicate_in_file' then 'OK' else 'FALHA: ' || c::text end);
  rep := rep || format(E'\n[%s] mensagens de erro trazem a causa (dígito verificador / razão social)',
    case when c->1->'messages'->>0 ilike '%verificador%' and c->2->'messages'->>0 ilike '%Razão social%' then 'OK' else 'FALHA' end);
  select count(*) into n from public.legal_entities where cnpj in (c1, c2);
  rep := rep || format(E'\n[%s] a análise não grava nada', case when n = 0 then 'OK' else 'FALHA' end);

  -- 2) primeira importação: cria só a válida; inválidas viram relatório, não somem
  r := public.legal_entity_import_commit(rows_, v_ua, '[]', 'arquivo.csv');
  select count(*) into n from public.legal_entities where cnpj = c1 and legal_name = 'Clínica Alfa Ltda' and state_uf = 'SP' and origin = 'importacao_csv';
  rep := rep || format(E'\n[%s] cria 1 PJ (UF normalizada, origem importacao_csv); 2 inválidas e 1 repetida no relatório',
    case when n = 1 and (r->'totals'->>'created')::int = 1 and (r->'totals'->>'invalid')::int = 2 and (r->'totals'->>'skipped')::int = 1 and jsonb_array_length(r->'report') = 4 then 'OK' else 'FALHA: ' || r::text end);
  select count(*) into n from public.legal_entity_units u join public.legal_entities e on e.id = u.legal_entity_id where e.cnpj = c1 and u.unit_id = v_ua;
  rep := rep || format(E'\n[%s] PJ vinculada à unidade de destino', case when n = 1 then 'OK' else 'FALHA' end);

  -- 3) reimportação idêntica: nada duplica, nada muda
  r := public.legal_entity_import_commit(jsonb_build_array(rows_->0), v_ua, '[]', 'arquivo.csv');
  select count(*) into n from public.legal_entities where cnpj = c1;
  rep := rep || format(E'\n[%s] reimportar o mesmo arquivo não duplica (1 cadastro) e reporta "sem alteração"',
    case when n = 1 and (r->'totals'->>'created')::int = 0 and (r->'totals'->>'unchanged')::int = 1 then 'OK' else 'FALHA: ' || r::text end);

  -- 4) conflito: mesmo CNPJ com razão social diferente e telefone novo em campo já preenchido
  rows_ := jsonb_build_array(jsonb_build_object('line',2,'cnpj',c1,'legal_name','Alfa Renomeada SA','phone','(11) 3333-4444','tax_regime','Simples Nacional'));
  c := public.legal_entity_import_check(rows_);
  rep := rep || format(E'\n[%s] conflito detectado com diffs por campo; regime (vazio antes) marcado como "fill", razão social como "overwrite"',
    case when c->0->>'status' = 'conflict'
      and exists (select 1 from jsonb_array_elements(c->0->'diffs') d where d->>'field' = 'tax_regime' and d->>'kind' = 'fill')
      and exists (select 1 from jsonb_array_elements(c->0->'diffs') d where d->>'field' = 'legal_name' and d->>'kind' = 'overwrite') then 'OK' else 'FALHA: ' || c::text end);
  r := public.legal_entity_import_commit(rows_, v_ua, '[]', 'arquivo2.csv');
  select legal_name, phone into nm, ph from public.legal_entities where cnpj = c1;
  rep := rep || format(E'\n[%s] SEM decisão explícita: cadastro existente permanece intacto (nenhuma sobrescrita silenciosa)',
    case when nm = 'Clínica Alfa Ltda' and ph = '11988887777' and (r->'totals'->>'skipped')::int = 1 and (r->'totals'->>'updated')::int = 0 then 'OK' else 'FALHA: ' || nm || '/' || ph end);
  r := public.legal_entity_import_commit(rows_, v_ua, jsonb_build_array(jsonb_build_object('idx',0,'action','update','fields',jsonb_build_array('tax_regime','phone'))), 'arquivo2.csv');
  select legal_name, phone, tax_regime into nm, ph, tr from public.legal_entities where cnpj = c1;
  rep := rep || format(E'\n[%s] COM decisão: atualiza só os campos escolhidos (telefone e regime); razão social continua a original',
    case when nm = 'Clínica Alfa Ltda' and ph = '1133334444' and tr = 'Simples Nacional' and (r->'totals'->>'updated')::int = 1 then 'OK' else 'FALHA: ' || nm || '/' || ph || '/' || coalesce(tr,'-') end);
  select count(*) into n from public.audit_log where action = 'adm_import_update' and actor_user_id = u_mgr and old_values ? 'phone' and new_values ? 'tax_regime';
  rep := rep || format(E'\n[%s] atualização gravada na auditoria com valores antigos e novos', case when n = 1 then 'OK' else 'FALHA' end);
  -- campo escolhido que NÃO estava em conflito é ignorado (não dá para forçar campo fora da análise)
  r := public.legal_entity_import_commit(jsonb_build_array(jsonb_build_object('line',2,'cnpj',c1,'legal_name','Outro Nome','email_general','novo@x.com')), v_ua,
       jsonb_build_array(jsonb_build_object('idx',0,'action','update','fields',jsonb_build_array('email_general','cnae_main','cnpj'))), 'a3.csv');
  select count(*) into n from public.legal_entities where cnpj = c1 and email_general = 'novo@x.com' and legal_name = 'Clínica Alfa Ltda' and cnae_main is null;
  rep := rep || format(E'\n[%s] decisão só vale para campos que estavam no diff (cnpj/cnae fora do diff foram ignorados)', case when n = 1 then 'OK' else 'FALHA' end);

  -- 5) arquivado
  reset role; update public.legal_entities set archived_at = now() where cnpj = c1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true); set local role authenticated;
  c := public.legal_entity_import_check(jsonb_build_array(jsonb_build_object('line',2,'cnpj',c1,'legal_name','Clínica Alfa Ltda')));
  rep := rep || format(E'\n[%s] cadastro arquivado não é reativado nem duplicado pela importação', case when c->0->>'status' = 'archived' then 'OK' else 'FALHA' end);
  reset role;

  -- 6) permissão: quem não é manager/ops_admin não analisa nem grava
  foreach nm in array array['unit_manager','sales'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case nm when 'sales' then u_sales else u_um end, 'role','authenticated')::text, true);
    set local role authenticated;
    ok := false; begin perform public.legal_entity_import_check('[]'::jsonb); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || format(E'\n[%s] %s não analisa importação de PJ', case when ok then 'OK' else 'FALHA' end, nm);
    ok := false; begin perform public.legal_entity_import_commit(jsonb_build_array(jsonb_build_object('cnpj',c2,'legal_name','Beta Ltda')), v_ua, '[]', null); exception when others then ok := sqlstate = '42501'; end;
    rep := rep || format(E'\n[%s] %s não grava importação de PJ', case when ok then 'OK' else 'FALHA' end, nm);
    reset role;
  end loop;
  select count(*) into n from public.legal_entities where cnpj = c2;
  rep := rep || format(E'\n[%s] nenhum cadastro criado pelos papéis sem permissão', case when n = 0 then 'OK' else 'FALHA' end);

  raise exception E'RELATORIO_N01_IMPORTACAO_PJ (transação desfeita):%', rep;
end $$;
