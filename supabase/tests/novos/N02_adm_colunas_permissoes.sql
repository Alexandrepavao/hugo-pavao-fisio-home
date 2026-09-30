-- NOVO (etapa ADM+Contábil, 2026-09-29) — personalização da planilha ADM (adm_view_*, adm_columns_catalog, adm_export, migration 047).
-- Cobre: salvar/ordenar/ocultar colunas por usuário, restaurar padrão, isolamento entre usuários, colunas sensíveis barradas no
-- SERVIDOR (salvar, listar e exportar), documento mascarado, auditoria de exportação e acesso negado. Transação desfeita.
do $$
declare
  v_org uuid; v_ua uuid; u_mgr uuid := gen_random_uuid(); u_um uuid := gen_random_uuid(); u_mem uuid := gen_random_uuid();
  ent uuid; c jsonb; d jsonb; x jsonb; ok boolean; n int; rep text := ''; cols text[];
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','n02m@t.local'),(u_um,'authenticated','authenticated','n02u@t.local'),(u_mem,'authenticated','authenticated','n02x@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_mgr, v_org),(u_um, v_org),(u_mem, v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_um, 'unit_manager', v_ua),(v_org, u_mem, 'member', null);
  insert into public.legal_entities (org_id, cnpj, legal_name, trade_name, tax_regime, state_registration, email_finance, city, state_uf, email_general, origin)
    values (v_org, '11222333000181', 'Empresa Teste Colunas N02 Ltda', 'Fantasia N02', 'Lucro Real', 'IE-998877', 'fin@n02.com', 'Santos', 'SP', 'geral@n02.com', 'indicacao') returning id into ent;
  insert into public.legal_entity_units values (ent, v_ua);

  -- ---- gestor
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true); set local role authenticated;
  c := public.adm_columns_catalog();
  rep := rep || format(E'\n[%s] gestor: catálogo com 16 colunas, todas permitidas (inclui as sensíveis)',
    case when jsonb_array_length(c) = 16 and not exists (select 1 from jsonb_array_elements(c) e where (e->>'allowed')::boolean = false) then 'OK' else 'FALHA' end);
  x := public.adm_view_get();
  rep := rep || format(E'\n[%s] sem preferência salva: padrão (is_default) com nome como primeira coluna', case when (x->>'is_default')::boolean and x->'columns'->>0 = 'name' then 'OK' else 'FALHA: ' || x::text end);
  x := public.adm_view_save(array['city','name','tax_regime','coluna_inexistente','city','email']);
  rep := rep || format(E'\n[%s] salvar reordena, remove duplicada e coluna inexistente, mantém sensível (gestor pode)',
    case when x->'columns' = '["city","name","tax_regime","email"]'::jsonb and not (x->>'is_default')::boolean then 'OK' else 'FALHA: ' || x::text end);
  x := public.adm_view_save(array['city','email']);
  rep := rep || format(E'\n[%s] "nome" nunca some (se omitida, volta como primeira coluna)', case when x->'columns'->>0 = 'name' then 'OK' else 'FALHA: ' || x::text end);
  x := public.adm_view_save(array['city','tax_regime','name']);
  x := public.adm_view_get();
  rep := rep || format(E'\n[%s] preferência persiste e volta na ordem salva', case when x->'columns' = '["city","tax_regime","name"]'::jsonb then 'OK' else 'FALHA: ' || x::text end);

  -- listagem (gestor vê tudo)
  d := public.adm_directory('Empresa Teste Colunas N02', null, null, null, null, false, 'name', 'asc', 0, 25);
  rep := rep || format(E'\n[%s] gestor: listagem devolve regime, inscrição estadual e e-mail financeiro e o CNPJ completo',
    case when d->'rows'->0->>'tax_regime' = 'Lucro Real' and d->'rows'->0->>'state_registration' = 'IE-998877' and d->'rows'->0->>'email_finance' = 'fin@n02.com' and d->'rows'->0->>'document' = '11222333000181' then 'OK' else 'FALHA: ' || d::text end);
  x := public.adm_export('Empresa Teste Colunas N02', null, null, null, null, false, array['name','document','tax_regime']);
  rep := rep || format(E'\n[%s] gestor: exportação inclui regime e CNPJ completo', case when x->'rows'->0->>'tax_regime' = 'Lucro Real' and x->'rows'->0->>'document' = '11222333000181' and not (x->>'masked_document')::boolean then 'OK' else 'FALHA: ' || x::text end);
  reset role;

  -- ---- gestor de unidade
  perform set_config('request.jwt.claims', json_build_object('sub', u_um, 'role','authenticated')::text, true); set local role authenticated;
  c := public.adm_columns_catalog();
  select count(*) into n from jsonb_array_elements(c) e where (e->>'sensitive')::boolean and not (e->>'allowed')::boolean;
  rep := rep || format(E'\n[%s] gestor de unidade: 3 colunas sensíveis marcadas como não permitidas', case when n = 3 then 'OK' else 'FALHA' end);
  x := public.adm_view_get();
  rep := rep || format(E'\n[%s] preferência do gestor NÃO vaza para outro usuário (gestor de unidade continua no padrão)', case when (x->>'is_default')::boolean then 'OK' else 'FALHA: ' || x::text end);
  x := public.adm_view_save(array['tax_regime','email','name','state_registration']);
  rep := rep || format(E'\n[%s] servidor descarta colunas sensíveis ao salvar (sem permissão)', case when x->'columns' = '["email","name"]'::jsonb then 'OK' else 'FALHA: ' || x::text end);
  select count(*) into n from public.adm_view_prefs;
  rep := rep || format(E'\n[%s] RLS: usuário lê só a própria preferência (1 linha, não a do gestor)', case when n = 1 then 'OK' else 'FALHA: ' || n end);
  ok := false; begin insert into public.adm_view_prefs (user_id, org_id, view_key, columns) values (u_um, v_org, 'x', array['name']); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] escrita direta na tabela de preferências é negada (só pelas RPCs)', case when ok then 'OK' else 'FALHA' end);

  d := public.adm_directory('Empresa Teste Colunas N02', null, null, null, null, false, 'name', 'asc', 0, 25);
  rep := rep || format(E'\n[%s] gestor de unidade: listagem devolve campos sensíveis como null e documento mascarado',
    case when d->'rows'->0->>'name' is not null and d->'rows'->0->>'tax_regime' is null and d->'rows'->0->>'state_registration' is null and d->'rows'->0->>'email_finance' is null
         and d->'rows'->0->>'document' <> '11222333000181' and d->'rows'->0->>'document' like '%81' then 'OK' else 'FALHA: ' || d::text end);
  x := public.adm_export('Empresa Teste Colunas N02', null, null, null, null, false, array['name','document','tax_regime','state_registration']);
  rep := rep || format(E'\n[%s] gestor de unidade: exportação NÃO contém colunas sensíveis e o documento sai mascarado',
    case when x->'columns' = '["name","document"]'::jsonb and not (x->'rows'->0 ? 'tax_regime') and (x->>'masked_document')::boolean and x->'rows'->0->>'document' <> '11222333000181' then 'OK' else 'FALHA: ' || x::text end);
  x := public.adm_view_reset();
  rep := rep || format(E'\n[%s] restaurar padrão apaga a preferência e volta ao conjunto padrão', case when (x->>'is_default')::boolean then 'OK' else 'FALHA: ' || x::text end);
  select count(*) into n from public.adm_view_prefs;
  rep := rep || format(E'\n[%s] após restaurar, nenhuma linha salva para o usuário', case when n = 0 then 'OK' else 'FALHA' end);
  reset role;

  -- papel rebaixado: preferência antiga com coluna sensível é filtrada na leitura
  insert into public.adm_view_prefs (user_id, org_id, view_key, columns) values (u_um, v_org, 'diretorio', array['tax_regime','name','city']);
  perform set_config('request.jwt.claims', json_build_object('sub', u_um, 'role','authenticated')::text, true); set local role authenticated;
  x := public.adm_view_get();
  rep := rep || format(E'\n[%s] preferência antiga com coluna sensível é filtrada na leitura pela permissão ATUAL', case when x->'columns' = '["name","city"]'::jsonb then 'OK' else 'FALHA: ' || x::text end);
  reset role;

  -- ---- sem acesso ao ADM
  perform set_config('request.jwt.claims', json_build_object('sub', u_mem, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.adm_columns_catalog(); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] paciente/aluno (member) não acessa o catálogo', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.adm_export(null, null, null, null, null, false, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] member não exporta', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.adm_view_save(array['name']); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] member não salva preferências', case when ok then 'OK' else 'FALHA' end);
  reset role;

  select count(*) into n from public.audit_log where action = 'adm_export' and actor_user_id in (u_mgr, u_um);
  rep := rep || format(E'\n[%s] exportações registradas na auditoria (2: gestor e gestor de unidade)', case when n = 2 then 'OK' else 'FALHA: ' || n end);

  raise exception E'RELATORIO_N02_COLUNAS_PERMISSOES (transação desfeita):%', rep;
end $$;
