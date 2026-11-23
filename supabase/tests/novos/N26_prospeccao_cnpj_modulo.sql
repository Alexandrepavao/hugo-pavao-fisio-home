-- NOVO — N26: Prospecção B2B Fase 0.5/1 — CNPJ alfanumérico no banco (migration 150) e módulo no catálogo (migration 151).
-- Transação sempre desfeita. Somente Dev/teste. Sem dados de cliente fora da transação.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid, org uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('app.active_org', coalesce(org::text, ''), true);
end $$;
do $$
declare
  rep text := ''; v_org uuid; v_mgr uuid; v_id uuid; v_cnpj text; v_rows int; m record; j jsonb;
begin
  -- 1. normalização
  rep := rep || pg_temp.chk(private.normalize_cnpj(' 12.abc.345/01de-35 ') = '12ABC34501DE35', 'normalização: maiúsculas e só [0-9A-Z]');
  rep := rep || pg_temp.chk(private.normalize_cnpj(null) = '' and private.normalize_cnpj('') = '', 'normalização: nulo e vazio viram texto vazio');

  -- 2. validação (exemplo publicado pela Receita + numérico antigo + recusas)
  rep := rep || pg_temp.chk(private.is_valid_cnpj('12.ABC.345/01DE-35') and private.is_valid_cnpj('12abc34501de35'), 'exemplo oficial da Receita (12.ABC.345/01DE-35) é válido, com máscara e em minúsculas');
  rep := rep || pg_temp.chk(private.is_valid_cnpj('11.222.333/0001-81') and private.is_valid_cnpj('11222333000181'), 'CNPJ numérico antigo continua válido');
  rep := rep || pg_temp.chk(not private.is_valid_cnpj('12ABC34501DE36') and not private.is_valid_cnpj('11222333000182'), 'dígito verificador errado é recusado (alfanumérico e numérico)');
  rep := rep || pg_temp.chk(not private.is_valid_cnpj('12ABC34501DEA5') and not private.is_valid_cnpj('12ABC34501DE3') and not private.is_valid_cnpj('12ABC34501DE355') and not private.is_valid_cnpj('') and not private.is_valid_cnpj(null),
    'letra nos 2 últimos caracteres, tamanho errado, vazio e nulo são recusados');
  rep := rep || pg_temp.chk(not private.is_valid_cnpj('00000000000000') and not private.is_valid_cnpj('AAAAAAAAAAAA00'), 'repetições são recusadas');

  -- 3. gravação pela rotina real do cadastro (legal_entity_upsert), como gestor da organização HP; tudo é desfeito no fim
  select ra.org_id, ra.user_id into v_org, v_mgr from public.role_assignments ra join public.organizations o on o.id = ra.org_id
   where o.slug = 'hp' and ra.role = 'manager' and ra.revoked_at is null and ra.unit_id is null limit 1;
  if v_org is null then select ra.org_id, ra.user_id into v_org, v_mgr from public.role_assignments ra where ra.role = 'manager' and ra.revoked_at is null and ra.unit_id is null order by ra.org_id limit 1; end if;
  rep := rep || pg_temp.chk(v_org is not null and v_mgr is not null, 'há um gestor para o teste de gravação');
  set local role authenticated; perform pg_temp.as_user(v_mgr, v_org);
  j := public.legal_entity_upsert(null, jsonb_build_object('legal_name', 'Empresa Alfanumérica N26 LTDA', 'cnpj', '12.abc.345/01de-35'));
  v_id := coalesce((j ->> 'id')::uuid, null);
  reset role;
  select cnpj into v_cnpj from public.legal_entities where org_id = v_org and legal_name = 'Empresa Alfanumérica N26 LTDA';
  rep := rep || pg_temp.chk(v_cnpj = '12ABC34501DE35', 'cadastro grava o CNPJ alfanumérico normalizado (12ABC34501DE35), sem perder as letras');
  set local role authenticated; perform pg_temp.as_user(v_mgr, v_org);
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.legal_entity_upsert(null, '{"legal_name":"Duplicada N26","cnpj":"12.ABC.345/01DE-35"}'::jsonb)$q$) is not null, 'o mesmo CNPJ alfanumérico não duplica na mesma organização');
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.legal_entity_upsert(null, '{"legal_name":"Invalida N26","cnpj":"12.ABC.345/01DE-36"}'::jsonb)$q$) like '%CNPJ%', 'CNPJ alfanumérico com dígito verificador errado é recusado pela rotina do cadastro');
  j := public.crm_company_create('Empresa CRM N26', null, '12abc34501de35', null, null, null, null, null, null, null, false);
  rep := rep || pg_temp.chk((j ->> 'status') = 'existing', 'crm_company_create reconhece o CNPJ alfanumérico já cadastrado (devolve a existente, não duplica)');
  -- busca por parte do CNPJ alfanumérico (planilha administrativa)
  select count(*) into v_rows from jsonb_array_elements((public.adm_directory('abc345', 'pj', null, null, null, false, 'name', 'asc', 0, 20, null) ->> 'rows')::jsonb) r;
  rep := rep || pg_temp.chk(v_rows >= 1, 'a busca da planilha administrativa encontra a empresa por parte do CNPJ alfanumérico');
  reset role;

  -- 3b. permissões preservadas após recriar as funções (o gatilho hp_guard_new_public_functions retira `anon` de toda função pública recriada)
  rep := rep || pg_temp.chk(has_function_privilege('anon', 'public.onboarding_submit_physio(text, jsonb, text, text)', 'execute'), 'onboarding da fisioterapeuta continua executável por anon (link público)');
  rep := rep || pg_temp.chk(not has_function_privilege('anon', 'public.legal_entity_upsert(uuid, jsonb)', 'execute') and not has_function_privilege('anon', 'public.crm_company_create(text, text, text, text, text, text, text, uuid, uuid, text, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.legal_entity_upsert(uuid, jsonb)', 'execute') and has_function_privilege('authenticated', 'public.crm_company_create(text, text, text, text, text, text, text, uuid, uuid, text, boolean)', 'execute'),
    'cadastro de empresas: anônimo NÃO executa; usuário autenticado executa');

  -- 4. módulo no catálogo
  select * into m from public.platform_modules where key = 'prospeccao_b2b';
  rep := rep || pg_temp.chk(m.key is not null and m.status = 'experimental' and not m.core and m.routes = '{/admin/prospeccao}' and m.permissions = '{manager,sales}', 'módulo prospeccao_b2b está no catálogo como experimental, não-core, rota /admin/prospeccao, papéis gestor e comercial');
  rep := rep || pg_temp.chk(exists (select 1 from public.platform_module_deps where module_key = 'prospeccao_b2b' and requires = 'crm'), 'depende do CRM');
  rep := rep || pg_temp.chk(not exists (select 1 from information_schema.tables where table_schema = 'public' and (table_name like 'b2b\_%' or table_name like 'core\_wallet%')), 'a Fase 1 NÃO criou tabelas de prospecção nem de carteira (isso é das fases seguintes)');
  raise exception 'RELATORIO_N26%', rep;
end $$;
