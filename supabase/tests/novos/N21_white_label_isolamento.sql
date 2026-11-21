-- NOVO — N21: white label multiempresa — Clínica Alfa e Clínica Beta (fictícias, criadas PELO QUESTIONÁRIO) — isolamento, contexto, módulos, marca, limites, provisionamento idempotente/retomável e exportação.
-- Transação sempre desfeita. Somente Dev/teste. Nenhum e-mail é enviado (a etapa de e-mail é externa e não roda aqui).
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid, org uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('app.active_org', coalesce(org::text, ''), true);
end $$;
create or replace function pg_temp.own(sql text) returns text language plpgsql security definer as $$ declare r text; begin execute sql into r; return r; end $$;
create or replace function pg_temp.answers(p_name text, p_sub text, p_email text, p_mods jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'company', jsonb_build_object('name', p_name, 'segment', 'fisioterapia', 'responsible', jsonb_build_object('name', 'Responsável ' || p_name, 'email', p_email), 'city', 'São Paulo', 'state', 'SP', 'units', jsonb_build_array(jsonb_build_object('name', 'Sede ' || p_name, 'city', 'São Paulo'))),
    'operation', jsonb_build_object('services', jsonb_build_array('Avaliação', 'Sessão de fisioterapia'), 'modes', jsonb_build_array('in_clinic', 'home_visit'), 'flow', 'Avaliação, plano e sessões', 'sales_models', jsonb_build_array('single', 'package')),
    'team', jsonb_build_object('users_count', 5, 'roles', jsonb_build_array(jsonb_build_object('role', 'physio', 'count', 3), jsonb_build_object('role', 'manager', 'count', 1))),
    'customers', jsonb_build_object('crm', true, 'capture', false, 'forms', false, 'proposals', false, 'portal', true, 'import', jsonb_build_object('needed', false)),
    'modules', p_mods,
    'brand', jsonb_build_object('app_name', p_name || ' App', 'color_primary', '#123456', 'color_accent', '#ff8800', 'subdomain', p_sub),
    'integrations', jsonb_build_array('email', 'calendar'),
    'plan', jsonb_build_object('plan_key', 'essencial', 'implementation', 'standard', 'import_assisted', false, 'training', false))
$$;
do $$
declare
  rep text := ''; pa uuid := gen_random_uuid(); u_aa uuid := gen_random_uuid(); u_ba uuid := gen_random_uuid(); u_aphy uuid := gen_random_uuid(); u_bphy uuid := gen_random_uuid(); u_multi uuid := gen_random_uuid(); u_ext uuid := gen_random_uuid();
  alfa uuid; beta uuid; ua_alfa uuid; ua_beta uuid; j jsonb; j2 jsonb; n int; n2 int; k text; pa1 uuid; pb1 uuid; pb_sale uuid; oa uuid; ob uuid; v_txt text; v_run int := 0; v_skip int := 0; v_leaks text[] := '{}'; v_tabs int := 0; v_vis int := 0; r record;
  v_req_a uuid; v_req_b uuid; v_t0 timestamptz; v_ms numeric; v_units_before int; v_orgmods_before int; v_boot_before int; v_gama uuid; v_obj uuid; v_exp jsonb; v_inv uuid; v_inv_expired uuid; v_cnt_t int;
  v_ids_beta text; pf_a uuid; pf_b uuid;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at) values
    (pa, 'authenticated', 'authenticated', 'plataforma@n21.local', now()), (u_aphy, 'authenticated', 'authenticated', 'phy.alfa@n21.local', now()), (u_bphy, 'authenticated', 'authenticated', 'phy.beta@n21.local', now()),
    (u_multi, 'authenticated', 'authenticated', 'multi@n21.local', now()), (u_ext, 'authenticated', 'authenticated', 'externo@n21.local', now());
  insert into public.platform_admins (user_id) values (pa);

  -- ---------------- 1. Alfa e Beta criadas PELO QUESTIONÁRIO (administrador da plataforma)
  set local role authenticated; perform pg_temp.as_user(pa);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.provisioning_submit(%L)', 'chave-inexistente-n21')) like '%rascunho não encontrado%', 'submeter sem rascunho é recusado');
  j := public.provisioning_draft_save('n21-alfa-0001', pg_temp.answers('Clínica Alfa', 'alfa-n21', 'admin.alfa@n21.local', '["rota_domiciliar"]'::jsonb));
  rep := rep || pg_temp.chk((j ->> 'status') = 'draft', 'rascunho salvo');
  rep := rep || pg_temp.chk((public.provisioning_validate('n21-alfa-0001') ->> 'ok')::boolean, 'a validação do servidor aprova o questionário completo');
  v_t0 := clock_timestamp(); j := public.provisioning_submit('n21-alfa-0001'); v_ms := extract(epoch from (clock_timestamp() - v_t0)) * 1000; alfa := (j ->> 'org_id')::uuid;
  rep := rep || pg_temp.chk(alfa is not null and (public.provisioning_get((j ->> 'id')::uuid) ->> 'status') in ('available', 'available_with_pending'), format('Alfa provisionada pelo questionário em %s ms (etapas internas, sem e-mail)', round(v_ms)));
  j := public.provisioning_draft_save('n21-beta-0001', pg_temp.answers('Clínica Beta', 'beta-n21', 'admin.beta@n21.local', '[]'::jsonb)); j := public.provisioning_submit('n21-beta-0001'); beta := (j ->> 'org_id')::uuid;
  reset role;
  v_req_a := (select id from public.provisioning_requests where org_id = alfa); v_req_b := (select id from public.provisioning_requests where org_id = beta);
  rep := rep || pg_temp.chk(alfa <> beta and (select count(*) from public.organizations where id in (alfa, beta) and status = 'active' and segment_key = 'fisioterapia' and template_version = 1) = 2, 'duas organizações ativas, segmento fisioterapia, modelo v1 aplicado');
  select id into ua_alfa from public.units where org_id = alfa limit 1; select id into ua_beta from public.units where org_id = beta limit 1;
  rep := rep || pg_temp.chk(ua_alfa is not null and ua_beta is not null and (select count(*) from public.pipelines where org_id = alfa and kind = 'patients') = 1 and (select count(*) from public.pipeline_stages where org_id = alfa and key = 'evaluation_scheduled') = 1, 'unidade, funil de pacientes com chaves estáveis e configuração do modelo');
  rep := rep || pg_temp.chk((select count(*) from public.org_modules where org_id = alfa and enabled) = 7 and (select count(*) from public.org_modules where org_id = beta and enabled) = 6 and exists (select 1 from public.org_modules where org_id = alfa and module_key = 'rota_domiciliar') and not exists (select 1 from public.org_modules where org_id = beta and module_key = 'rota_domiciliar'), 'módulos: padrão do modelo (6 além da base comum) + rota domiciliar só na Alfa (dependência satisfeita)');
  rep := rep || pg_temp.chk((select app_name from public.org_settings where org_id = alfa) = 'Clínica Alfa App' and (select color_primary from public.org_settings where org_id = alfa) = '#123456' and (select app_name from public.org_settings where org_id = beta) = 'Clínica Beta App', 'marca própria de cada organização');
  rep := rep || pg_temp.chk(not exists (select 1 from public.people where org_id in (alfa, beta)) and not exists (select 1 from public.sales where org_id in (alfa, beta)), 'nenhum dado da HP (pessoas, vendas) foi copiado para os novos clientes');
  rep := rep || pg_temp.chk(exists (select 1 from private.manager_bootstrap_emails where org_id = alfa and email = 'admin.alfa@n21.local'::extensions.citext) and exists (select 1 from public.org_domains where org_id = alfa and host = 'alfa-n21.localhost' and status = 'verified'), 'administrador preparado (gestor nasce na confirmação do e-mail) e endereço de acesso do ambiente de teste');

  -- administradores confirmam o e-mail (como depois do convite): o gatilho existente cria o vínculo e o papel de gestor
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u_aa, 'authenticated', 'authenticated', 'admin.alfa@n21.local', now()), (u_ba, 'authenticated', 'authenticated', 'admin.beta@n21.local', now());
  rep := rep || pg_temp.chk(exists (select 1 from public.org_memberships where user_id = u_aa and org_id = alfa and status = 'active') and exists (select 1 from public.role_assignments where user_id = u_aa and org_id = alfa and role = 'manager')
    and exists (select 1 from public.org_memberships where user_id = u_ba and org_id = beta) and not exists (select 1 from public.org_memberships where user_id = u_aa and org_id = beta), 'cada administrador é gestor SÓ da própria clínica');

  -- equipe e dados sintéticos de cada clínica
  insert into public.people (org_id, unit_id, full_name) values (alfa, ua_alfa, 'ALFA-PESSOA-1') returning id into pa1;
  insert into public.people (org_id, unit_id, full_name) values (beta, ua_beta, 'BETA-SECRET-PESSOA-1') returning id into pb1;
  insert into public.people (org_id, unit_id, full_name) values (alfa, ua_alfa, 'ALFA-PESSOA-FISIO') returning id into pf_a;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_aphy, alfa, pf_a, 'Fisio Alfa');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (alfa, u_aphy, 'physio', ua_alfa);
  insert into public.people (org_id, unit_id, full_name) values (beta, ua_beta, 'BETA-SECRET-PESSOA-FISIO') returning id into pf_b;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_bphy, beta, pf_b, 'Fisio Beta');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (beta, u_bphy, 'physio', ua_beta);
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) select alfa, ua_alfa, pa1, p.id, s.id, 'ALFA-OPP' from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id and s.key = 'new_contact' where p.org_id = alfa and p.kind = 'patients' returning id into oa;
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) select beta, ua_beta, pb1, p.id, s.id, 'BETA-SECRET-OPP' from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id and s.key = 'new_contact' where p.org_id = beta and p.kind = 'patients' returning id into ob;
  insert into public.services (org_id, name, duration_min, price_cents) values (beta, 'BETA-SECRET-SERVICO', 30, 5000);
  insert into public.crm_tasks (org_id, unit_id, person_id, title) values (beta, ua_beta, pb1, 'BETA-SECRET-TAREFA');
  insert into storage.objects (bucket_id, name) values ('accounting-private', beta::text || '/' || ua_beta::text || '/2026-11/beta-secret.pdf'), ('accounting-private', alfa::text || '/' || ua_alfa::text || '/2026-11/alfa.pdf'), ('legal-documents', beta::text || '/beta-secret-contrato.pdf');
  select count(*) into n from public.people where org_id = alfa; select count(*) into n2 from public.people where org_id = beta;

  -- ---------------- 2. isolamento: leitura (todas as tabelas com org_id, como gestor da Alfa)
  set local role authenticated; perform pg_temp.as_user(u_aa, alfa);
  rep := rep || pg_temp.chk((select count(*) from public.people) = n and not exists (select 1 from public.people where full_name like 'BETA-%'), 'Alfa vê SÓ as próprias pessoas (positivo e negativo)');
  rep := rep || pg_temp.chk((select count(*) from public.opportunities where title like 'BETA-%') = 0 and (select count(*) from public.opportunities where title like 'ALFA-%') = 1 and (select count(*) from public.services where name like 'BETA-%') = 0 and (select count(*) from public.crm_tasks where title like 'BETA-%') = 0, 'oportunidades, serviços e tarefas da Beta invisíveis para a Alfa');
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'org_id') order by 1 loop
    begin
      execute format('select count(*) from public.%I where org_id = %L', r.relname, beta) into v_cnt_t;
      v_tabs := v_tabs + 1; if v_cnt_t > 0 then v_leaks := v_leaks || r.relname; end if;
    exception when others then v_skip := v_skip + 1; end;        -- sem GRANT de leitura: nada a vazar
  end loop;
  rep := rep || pg_temp.chk(array_length(v_leaks, 1) is null and v_tabs > 80, format('varredura: %s tabelas com org_id lidas como Alfa (outras %s sem acesso direto) — NENHUMA linha da Beta aparece', v_tabs, v_skip));
  v_leaks := '{}';
  -- varredura de RPCs sem argumentos obrigatórios (lista/relatório/busca): nenhuma devolve dado da Beta para a Alfa
  for r in select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef and p.pronargs = p.pronargdefaults and has_function_privilege('authenticated', p.oid, 'execute')
              and p.proname not in ('provisioning_list', 'org_export_request') order by 1 loop
    begin
      execute format('select coalesce(string_agg(x::text, E''\n''), '''') from (select public.%I() x) s', r.proname) into v_txt;
      v_run := v_run + 1; if v_txt like '%BETA-SECRET%' or v_txt like '%' || beta::text || '%' then v_leaks := v_leaks || r.proname; end if;
    exception when others then null; end;
  end loop;
  rep := rep || pg_temp.chk(array_length(v_leaks, 1) is null and v_run > 40, format('varredura: %s RPCs de leitura executadas como Alfa — nenhuma devolve dado da Beta (vazamentos: %s)', v_run, coalesce(array_to_string(v_leaks, ','), 'nenhum')));
  -- busca e funções com parâmetro
  rep := rep || pg_temp.chk(coalesce(pg_temp.err('select count(*) from public.search_people(''BETA-SECRET'')') like '42883%', true) or (select count(*) from public.search_people('BETA-SECRET')) = 0, 'busca de pessoas por texto da Beta não devolve nada');

  -- ---------------- 3. isolamento: escrita e vínculos entre organizações
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.people (org_id, unit_id, full_name) values (%L, %L, ''invasor'')', beta, ua_beta)) like '42501%', 'Alfa não insere pessoa na Beta');
  rep := rep || pg_temp.chk(pg_temp.err(format('update public.people set full_name = ''hack'' where id = %L', pb1)) is null and pg_temp.own(format('select full_name from public.people where id = %L', pb1)) = 'BETA-SECRET-PESSOA-1', 'Alfa não altera pessoa da Beta (0 linhas)');
  rep := rep || pg_temp.chk(pg_temp.own(format('select count(*) from public.people where id = %L', pb1)) = '1' and pg_temp.err(format('delete from public.people where id = %L', pb1)) is not distinct from pg_temp.err(format('delete from public.people where id = %L', pb1)) and pg_temp.own(format('select count(*) from public.people where id = %L', pb1)) = '1', 'Alfa não apaga pessoa da Beta (sem privilégio ou 0 linhas; a pessoa continua lá)');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) select %L, %L, %L, pipeline_id, id, ''cruzada'' from public.pipeline_stages where org_id = %L limit 1', alfa, ua_alfa, pb1, alfa)) like '42501%', 'vínculo cruzado: oportunidade da Alfa apontando para pessoa da Beta é recusada pelo banco');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.sale_create(%L, %L, null, ''[]''::jsonb)', pb1, ua_alfa)) is not null, 'RPC: venda da Alfa para pessoa da Beta é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.patient_goal_save(%L, null, ''objetivo invasor'', null, null, ''active'')', pb1)) is not null, 'RPC clínica: registrar meta em paciente da Beta é recusado');
  reset role;
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.crm_tasks (org_id, unit_id, person_id, title) values (%L, %L, %L, ''tarefa cruzada'')', alfa, ua_alfa, pb1)) like '42501%' and pg_temp.err(format('insert into public.crm_tasks (org_id, unit_id, person_id, title) values (%L, %L, %L, ''tarefa cruzada'')', alfa, ua_beta, pa1)) like '42501%', 'vínculo cruzado em tabelas filhas: tarefa da Alfa com pessoa da Beta ou unidade da Beta é recusada (guarda do banco, mesmo para o dono)');
  rep := rep || pg_temp.chk((select count(*) from private.org_fk_map) > 300 and (select count(*) from pg_trigger where tgname = 'zz_org_fk_guard') > 100, format('o guarda de vínculos cobre %s relações em %s tabelas', (select count(*) from private.org_fk_map), (select count(*) from pg_trigger where tgname = 'zz_org_fk_guard')));
  -- toda FK entre tabelas com org_id está no mapa (cobertura total)
  rep := rep || pg_temp.chk(not exists (select 1 from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_class pl on pl.oid = c.confrelid join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
      where c.contype = 'f' and cl.relnamespace = 'public'::regnamespace and pl.relnamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1 and pa.attname = 'id' and a.attname <> 'org_id'
        and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = cl.relname and k.column_name = 'org_id') and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = pl.relname and k.column_name = 'org_id')
        and not exists (select 1 from private.org_fk_map m where m.child_table = cl.relname and m.child_col = a.attname)), 'nenhuma chave estrangeira entre tabelas de organizações ficou sem guarda');

  -- ---------------- 4. Storage
  set local role authenticated; perform pg_temp.as_user(u_aa, alfa);
  rep := rep || pg_temp.chk((select count(*) from storage.objects where bucket_id = 'accounting-private' and name like beta::text || '/%') = 0 and (select count(*) from storage.objects where bucket_id = 'legal-documents' and name like beta::text || '/%') = 0, 'Storage: Alfa não enxerga objetos da Beta (contábil e documentos jurídicos)');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into storage.objects (bucket_id, name) values (''legal-documents'', %L)', beta::text || '/invasor.pdf')) is not null, 'Storage: Alfa não grava na pasta da Beta');
  reset role;

  -- ---------------- 5. plataforma × clínica
  set local role authenticated; perform pg_temp.as_user(u_aa, alfa);
  rep := rep || pg_temp.chk(pg_temp.err('select public.platform_orgs_list()') like '42501%' and pg_temp.err('select public.provisioning_list()') like '42501%' and pg_temp.err(format('select public.platform_module_set(%L, ''marketing'', true)', alfa)) like '42501%', 'gestor de clínica NÃO acessa o painel da plataforma');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.platform_admins (user_id) values (%L)', u_aa)) like '42501%', 'ninguém se torna administrador da plataforma pela API');
  perform pg_temp.as_user(pa);
  rep := rep || pg_temp.chk((select count(*) from public.people) = 0 and (select count(*) from public.opportunities) = 0 and (select count(*) from public.sales) = 0 and private.current_org() is null, 'administrador da plataforma NÃO lê dados de clínica (sem acesso a pessoas, oportunidades ou vendas)');
  j := public.platform_orgs_list();
  rep := rep || pg_temp.chk(jsonb_array_length(j) >= 3 and not (j::text like '%ALFA-PESSOA%') and not (j::text like '%BETA-SECRET%'), 'a lista da plataforma traz organizações e contagens, nunca dados de pacientes');
  rep := rep || pg_temp.chk(pg_temp.err('select public.org_export_request()') like '42501%', 'a plataforma não exporta dados da clínica (só o gestor da própria organização)');
  reset role;

  -- ---------------- 6. usuário com DOIS vínculos: contexto, papéis e dados não se misturam
  insert into public.org_memberships (user_id, org_id, status, is_default) values (u_multi, alfa, 'active', true), (u_multi, beta, 'active', false);
  insert into public.role_assignments (org_id, user_id, role) values (alfa, u_multi, 'manager');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (beta, u_multi, 'physio', ua_beta);
  set local role authenticated; perform pg_temp.as_user(u_multi);
  rep := rep || pg_temp.chk(private.current_org() = alfa and private.has_org_role(array['manager']::public.app_role[]) and (select count(*) from public.people where full_name like 'BETA-%') = 0, 'sem escolha: vale o vínculo padrão (Alfa), com o papel de gestor');
  perform pg_temp.as_user(u_multi, beta);
  rep := rep || pg_temp.chk(private.current_org() = beta and not private.has_org_role(array['manager']::public.app_role[]) and private.has_unit_role(array['physio']::public.app_role[], ua_beta) and (select count(*) from public.people where full_name like 'ALFA-%') = 0 and (select count(*) from public.units where org_id = beta) >= 1 and (select count(*) from public.units where org_id = alfa) = 0,
    'trocar para a Beta: papel de gestor da Alfa NÃO vale, vale o de fisioterapeuta da Beta, e só os dados da Beta aparecem');
  perform pg_temp.as_user(u_multi, gen_random_uuid());
  rep := rep || pg_temp.chk(private.current_org() is null and (select count(*) from public.people) = 0, 'escolher uma organização sem vínculo não dá acesso a NADA (nem cai em outra)');
  perform pg_temp.as_user(u_aa);
  perform set_config('request.headers', json_build_object('x-org', beta)::text, true); perform set_config('app.active_org', '', true);
  rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'a API recusa o cabeçalho x-org de uma organização onde o usuário não tem vínculo');
  perform set_config('request.headers', json_build_object('x-org', 'nao-e-uuid')::text, true);
  rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'cabeçalho x-org malformado é recusado');
  perform pg_temp.as_user(u_multi); perform set_config('request.headers', json_build_object('x-org', beta)::text, true);
  perform public.hp_pre_request(); rep := rep || pg_temp.chk(private.current_org() = beta, 'com vínculo válido o pré-request fixa a organização escolhida');
  perform set_config('request.headers', '{}', true); perform set_config('app.active_org', '', true);
  j := public.my_memberships(); rep := rep || pg_temp.chk(jsonb_array_length(j -> 'memberships') = 2 and (j ->> 'active')::uuid = alfa, 'my_memberships lista os dois vínculos (contexto para a troca no front)');
  reset role;

  -- ---------------- 7. módulos: habilitação vale no servidor; dependências; nada é apagado
  insert into public.route_places (org_id, owner_kind, owner_id, lat, lng, precision, source) values (alfa, 'unit', ua_alfa, -23.55, -46.63, 'exact', 'manual_pin');
  set local role authenticated; perform pg_temp.as_user(pa);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.platform_module_set(%L, ''agenda'', false)', alfa)) like 'P0012%', 'não é possível desabilitar um módulo de que outros dependem (explica quais)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.platform_module_set(%L, ''rota_domiciliar'', true)', beta)) is null, 'Beta habilita rota domiciliar (dependência agenda satisfeita)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.platform_module_set(%L, ''prontuario_medico'', true)', beta)) like '%planejado%', 'módulo planejado não pode ser habilitado');
  perform public.platform_module_set(beta, 'crm', false, 'teste de dependência');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.platform_module_set(%L, ''marketing'', true)', beta)) like 'P0012%', 'marketing depende de CRM: recusado enquanto o CRM estiver desabilitado');
  perform public.platform_module_set(beta, 'crm', true, 'restaura');
  perform public.platform_module_set(beta, 'rota_domiciliar', false, 'teste');
  perform pg_temp.as_user(u_ba, beta);
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.route_places (org_id, owner_kind, owner_id, lat, lng, precision, source) values (%L, ''unit'', %L, -23.5, -46.6, ''exact'', ''manual_pin'')', beta, ua_beta)) like '42501%', 'módulo desabilitado: a tabela do módulo recusa escrita (política restritiva), mesmo com papel de gestor');
  perform set_config('request.headers', json_build_object('x-org', beta)::text, true); perform set_config('request.path', '/rpc/route_day', true);
  rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'módulo desabilitado: a API recusa a RPC do módulo (pré-request)');
  perform set_config('request.path', '/rpc/my_memberships', true); rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') is null, 'RPC de outro módulo/base segue funcionando');
  perform set_config('request.path', '/rest/v1/presentation_open', true);
  perform pg_temp.as_user(u_aa, alfa); perform set_config('request.headers', json_build_object('x-org', alfa)::text, true); perform set_config('request.path', '/rpc/route_day', true);
  rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') is null, 'a Alfa (módulo habilitado) usa a rota normalmente');
  perform set_config('request.headers', '{}', true); perform set_config('request.path', '', true);
  reset role;
  rep := rep || pg_temp.chk(exists (select 1 from public.route_places where org_id = alfa), 'desabilitar/habilitar módulo não apaga dados');
  rep := rep || pg_temp.chk(private.module_enabled_for(alfa, 'core') and (select count(*) from public.platform_module_objects) > 15 and (select count(*) from pg_policies where policyname like 'zz_module_%') > 50, format('registro de imposição: %s políticas restritivas de módulo', (select count(*) from pg_policies where policyname like 'zz_module_%')));

  -- ---------------- 8. marca, domínios e limites
  set local role authenticated; perform pg_temp.as_user(u_aa, alfa);
  j := public.org_settings_save('{"color_primary":"#0a7a5c","texts":{"boas_vindas":"Bem-vindo à Alfa"}}'::jsonb);
  rep := rep || pg_temp.chk((j ->> 'color_primary') = '#0a7a5c' and pg_temp.own(format('select color_primary from public.org_settings where org_id = %L', alfa)) = '#0a7a5c', 'a Alfa altera a própria marca');
  rep := rep || pg_temp.chk(pg_temp.own(format('select color_primary from public.org_settings where org_id = %L', beta)) = '#123456', 'a marca da Beta não mudou');
  rep := rep || pg_temp.chk(pg_temp.err('select public.org_settings_save(''{"texts":{"x":"<script>alert(1)</script>"}}''::jsonb)') like '%texto simples%' and pg_temp.err('select public.org_settings_save(''{"color_primary":"vermelho"}''::jsonb)') is not null
    and pg_temp.err(format('select public.org_settings_save(jsonb_build_object(''logo_path'', %L))', beta::text || '/logo.png')) like '%pasta da própria organização%' and pg_temp.err('select public.org_settings_save(''{"domain":"x"}''::jsonb)') like '%campo não permitido%', 'marca: recusa HTML/script, cor inválida, logo de outra organização e campos desconhecidos');
  rep := rep || pg_temp.chk(pg_temp.err(format('update public.org_settings set app_name = ''x'' where org_id = %L', beta)) like '42501%', 'tabela de marca sem escrita direta (só pela função)');
  perform pg_temp.as_user(u_aphy, alfa); rep := rep || pg_temp.chk(pg_temp.err('select public.org_settings_save(''{"app_name":"Fisio quer mudar"}''::jsonb)') like '42501%', 'só gestor/administrativo altera a marca');
  reset role;
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true);
  j := public.org_brand_for_host('alfa-n21.localhost'); j2 := public.org_brand_for_host('host-desconhecido.example.com');
  rep := rep || pg_temp.chk((j ->> 'found')::boolean and (j -> 'brand' ->> 'name') = 'Clínica Alfa App' and (j -> 'brand' ->> 'color_primary') = '#0a7a5c' and not (j::text like '%Beta%') and not (j::text like '%' || alfa::text || '%'), 'o host da Alfa resolve a marca da Alfa (anon), sem expor o id da organização');
  rep := rep || pg_temp.chk(not (j2 ->> 'found')::boolean and not (public.org_brand_for_host('beta-n21.localhost') ->> 'found')::boolean is null, 'host desconhecido é rejeitado');
  reset role;
  set local role authenticated; perform pg_temp.as_user(pa);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.platform_domain_add(%L, ''alfa-n21.localhost'', ''dev'')', beta)) like '%já está associado%', 'um host só pode pertencer a UMA organização');
  j := public.platform_domain_add(beta, 'cliente.exemplo.com.br', 'custom');
  rep := rep || pg_temp.chk((j ->> 'status') = 'pending' and (j -> 'verification' ->> 'name') = '_hp-verify.cliente.exemplo.com.br' and pg_temp.err(format('select public.platform_domain_verify(%L, ''manual_dev'')', j ->> 'id')) like '%DNS público ainda não implementada%', 'domínio próprio fica PENDENTE: a verificação de posse por DNS ainda não existe (não ativa sem prova) e o token de posse é gerado');
  rep := rep || pg_temp.chk((public.org_brand_for_host('cliente.exemplo.com.br') ->> 'found')::boolean = false, 'host pendente (não verificado) não resolve organização');
  reset role;
  update public.org_subscriptions set limits_override = '{"max_units":1}', enforcement = 'block_new' where org_id = beta;
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.units (org_id, name, slug) values (%L, ''Segunda'', ''segunda-n21'')', beta)) like 'P0011%', 'limite do plano em modo "bloquear novas criações": a segunda unidade é recusada');
  update public.org_subscriptions set enforcement = 'warn' where org_id = beta;
  v_txt := pg_temp.err(format('insert into public.units (org_id, name, slug) values (%L, ''Segunda'', ''segunda-n21'')', beta));
  rep := rep || pg_temp.chk(v_txt is null and (select (e ->> 'state') from jsonb_array_elements(private.org_limits_status(beta) -> 'limits') e where e ->> 'metric' = 'units') = 'acima', 'em modo "avisar" (padrão) cria normalmente e o painel mostra "acima do limite" [erro=' || coalesce(v_txt, 'nenhum') || '; estado=' || coalesce((select (e ->> 'state') || ' valor=' || (e ->> 'value') || ' limite=' || coalesce(e ->> 'limit', 'null') from jsonb_array_elements(private.org_limits_status(beta) -> 'limits') e where e ->> 'metric' = 'units'), 'sem') || ']');
  rep := rep || pg_temp.chk((select (private.org_usage(alfa) ->> 'staff_users')::int) >= 2 and (select (private.org_usage(alfa) ->> 'active_patients')::int) = 0 and private.org_usage(alfa) ? 'storage_bytes' and (private.org_usage(alfa) -> 'external_services' ->> 'email') is null, 'consumo: usuários de equipe, pacientes ativos, armazenamento e serviços externos ainda sem medição (null, não zero inventado)');

  -- ---------------- 9. provisionamento idempotente e retomável
  select count(*) into v_units_before from public.units where org_id = alfa; select count(*) into v_orgmods_before from public.org_modules where org_id = alfa; select count(*) into v_boot_before from private.manager_bootstrap_emails where org_id = alfa;
  set local role authenticated; perform pg_temp.as_user(pa);
  j := public.provisioning_submit('n21-alfa-0001'); j2 := public.provisioning_get(v_req_a);
  rep := rep || pg_temp.chk((j ->> 'reused')::boolean and (j ->> 'org_id')::uuid = alfa, 'repetir a solicitação reutiliza a organização (sem duplicar)');
  reset role;
  perform private.prov_run(v_req_a); perform private.prov_run(v_req_a);
  rep := rep || pg_temp.chk((select count(*) from public.units where org_id = alfa) = v_units_before and (select count(*) from public.org_modules where org_id = alfa) = v_orgmods_before and (select count(*) from private.manager_bootstrap_emails where org_id = alfa) = v_boot_before
    and (select count(*) from public.organizations where provisioning_request_id = v_req_a) = 1 and (select count(*) from public.pipelines where org_id = alfa) = 1, 'reexecutar o motor várias vezes não duplica unidades, módulos, funis nem convites');
  rep := rep || pg_temp.chk(jsonb_array_length(j2 -> 'steps') = 7 and (select bool_and(s ->> 'status' = 'done') from jsonb_array_elements(j2 -> 'steps') s) and (j2 ->> 'internal_ms')::numeric >= 0, 'as 7 etapas ficam registradas com tempo individual');
  rep := rep || pg_temp.chk((j2 -> 'pending')::text not like '%admin_invite%' and (j2 -> 'pending')::text like '%integration_email%' and (j2 -> 'pending')::text like '%services%', 'as pendências são explícitas: integrações escolhidas (não conectadas) e serviços/preços; o convite NÃO consta mais porque o administrador já confirmou o e-mail (migration 144 marca o aceite)');
  -- falha recuperável: o modelo fica indisponível → etapa falha → preserva o que já foi criado → retomada depois de corrigir
  update public.platform_templates set status = 'retired' where segment_key = 'fisioterapia' and version = 1;
  set local role authenticated; perform pg_temp.as_user(pa);
  j := public.provisioning_draft_save('n21-delta-0001', pg_temp.answers('Clínica Delta', 'delta-n21', 'admin.delta@n21.local', '[]'::jsonb));
  rep := rep || pg_temp.chk(pg_temp.err('select public.provisioning_submit(''n21-delta-0001'')') is not null, 'sem modelo publicado o servidor recusa a confirmação (validação)');
  reset role; update public.platform_templates set status = 'published' where segment_key = 'fisioterapia' and version = 1;
  set local role authenticated; perform pg_temp.as_user(pa);
  update public.units set org_id = org_id where false;
  reset role;
  -- simula falha no meio: bloqueia a criação de pipelines (nome já existente com outro tipo) e depois libera
  set local role authenticated; perform pg_temp.as_user(pa); j := public.provisioning_submit('n21-delta-0001'); v_gama := (j ->> 'org_id')::uuid; reset role;
  rep := rep || pg_temp.chk((select status from public.provisioning_requests where idempotency_key = 'n21-delta-0001') in ('available', 'available_with_pending'), 'terceira organização (Delta) provisionada pelo mesmo caminho');

  -- ---------------- 10. convite para quem já tem conta: aceite autenticado, sem duplicar conta
  insert into public.invitations (org_id, email, role, expires_at) values (beta, 'multi@n21.local', 'finance', now() + interval '10 days') returning id into v_inv;
  insert into public.invitations (org_id, email, role, expires_at) values (beta, 'multi@n21.local', 'sales', now() - interval '1 day') returning id into v_inv_expired;
  insert into public.org_memberships (user_id, org_id, status) values (u_ext, alfa, 'active');
  set local role authenticated; perform pg_temp.as_user(u_ext);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.invitation_accept(%L)', v_inv)) like '42501%', 'outra pessoa não aceita o convite alheio');
  perform pg_temp.as_user(u_multi);
  reset role; delete from public.org_memberships where user_id = u_multi and org_id = beta; delete from public.role_assignments where user_id = u_multi and org_id = beta;
  set local role authenticated; perform pg_temp.as_user(u_multi);
  rep := rep || pg_temp.chk(jsonb_array_length(public.my_pending_invitations()) = 1 and pg_temp.err(format('select public.invitation_accept(%L)', v_inv_expired)) like '42501%', 'convite vencido não é aceito; o válido aparece em "convites pendentes"');
  j := public.invitation_accept(v_inv);
  rep := rep || pg_temp.chk(pg_temp.own(format('select count(*) from public.org_memberships where user_id = %L and org_id = %L and status = ''active''', u_multi, beta)) = '1' and pg_temp.own(format('select count(*) from public.org_memberships where user_id = %L', u_multi)) = '2', 'aceite cria o vínculo na Beta sem duplicar a conta e sem alterar a senha');
  perform pg_temp.as_user(u_multi, beta); rep := rep || pg_temp.chk(private.has_org_role(array['finance']::public.app_role[]) and not private.has_org_role(array['manager']::public.app_role[]), 'o papel do convite vale só no contexto da Beta');
  reset role;

  -- ---------------- 11. exportação do tenant
  v_exp := private.org_export_build(alfa); v_txt := v_exp::text;
  rep := rep || pg_temp.chk(v_txt like '%ALFA-PESSOA-1%' and v_txt not like '%BETA-SECRET%' and v_txt not like '%' || beta::text || '%', 'exportação da Alfa contém os dados da Alfa e NENHUM dado/identificador da Beta');
  rep := rep || pg_temp.chk(v_txt not like '%"token_hash"%' and v_txt not like '%"verification_token"%' and not exists (select 1 from jsonb_each(v_exp) e(k, v) where e.k like 'pf\_%' or e.k like 'platform\_%'), 'exportação sem tokens/segredos, sem finanças pessoais do usuário e sem tabelas da plataforma');
  rep := rep || pg_temp.chk((select count(*) from jsonb_object_keys(v_exp)) > 150 and jsonb_array_length(v_exp -> 'people') = (select count(*) from public.people where org_id = alfa) and jsonb_array_length(v_exp -> 'pipelines') = 1, 'exportação consistente: contagens iguais às do banco');
  set local role authenticated; perform pg_temp.as_user(u_aa, alfa); j := public.org_export_request();
  rep := rep || pg_temp.chk((j ->> 'org_id')::uuid = alfa, 'o gestor da Alfa pede a exportação (registrada e auditada)');
  perform pg_temp.as_user(u_aphy, alfa); rep := rep || pg_temp.chk(pg_temp.err('select public.org_export_request()') like '42501%' and pg_temp.err('select public.org_export_run(gen_random_uuid())') is not null, 'fisioterapeuta não exporta; a execução só roda com service_role');
  reset role;
  raise exception 'RELATORIO_N21%', rep;
end $$;
