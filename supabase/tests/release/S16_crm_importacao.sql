-- RELEASE v1 — S16: importação CSV do CRM (migration 069): validação por linha, deduplicação no servidor, reimportação idempotente, conflitos com decisão explícita (nada é sobrescrito sozinho),
-- origem/campanha/unidade/responsável/lista/etapa inicial, permissões. Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; ua uuid; ub uuid; pipe uuid; st_new uuid; st_contact uuid; st_won uuid; st_lost uuid; lst uuid; lst2 uuid;
  u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_sales2 uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  p_maria uuid; p_carlos uuid; rows jsonb; defs jsonb; chk jsonb; res jsonb; r jsonb; dec jsonb; n bigint; n2 bigint; n3 bigint; ok boolean; rep text := ''; snap1 text; snap2 text; x record; imp1 uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S16)', 'teste-a-s16') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S16)', 'teste-b-s16') returning id into ub;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s16.local'),(u_sales,'authenticated','authenticated','s1@s16.local'),(u_sales2,'authenticated','authenticated','s2@s16.local'),(u_phy,'authenticated','authenticated','ph@s16.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S16'),(u_sales, v_org, null, 'Comercial Um S16'),(u_sales2, v_org, null, 'Comercial Dois S16'),(u_phy, v_org, null, 'Fisio S16');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', ua),(v_org, u_sales2, 'sales', ub),(v_org, u_phy, 'physio', ua);
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Funil S16', 'custom') returning id into pipe;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Novo', 1, 'open') returning id into st_new;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Contato feito', 2, 'open') returning id into st_contact;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Ganho', 3, 'won') returning id into st_won;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pipe, 'Perdido', 4, 'lost') returning id into st_lost;
  insert into public.crm_lead_lists (org_id, name) values (v_org, 'Lista S16') returning id into lst;
  insert into public.crm_lead_lists (org_id, name) values (v_org, 'Lista B S16') returning id into lst2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Maria Existente') returning id into p_maria;
  insert into public.person_kinds (person_id, kind) values (p_maria, 'lead');
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, p_maria, 'email', 'maria.s16@example.com', true), (v_org, p_maria, 'phone', '(11) 98888-1111', true);
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Carlos Visível') returning id into p_carlos;
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, p_carlos, 'email', 'carlos.s16@example.com', true);

  defs := jsonb_build_object('unit_id', ua, 'pipeline_id', pipe, 'stage_id', st_new, 'list_id', lst, 'source', 'Planilha de evento', 'campaign', 'Campanha S16');
  rows := jsonb_build_array(
    jsonb_build_object('name', 'Joana Nova', 'email', 'joana.s16@example.com', 'phone', '(11) 97777-2222'),                                                   -- 0 nova
    jsonb_build_object('name', 'Maria Existente', 'email', 'maria.s16@example.com', 'phone', '11988881111'),                                                    -- 1 existente, dados iguais
    jsonb_build_object('name', 'Maria E. Silva', 'email', 'maria.s16@example.com', 'phone', '(11) 95555-3333'),                                                 -- 2 mesmo e-mail, nome e telefone divergentes
    jsonb_build_object('name', 'Maria Existente', 'email', 'outra.maria.s16@example.com', 'phone', '(21) 94444-4444'),                                          -- 3 homônimo (nome igual, contato diferente)
    jsonb_build_object('name', 'Sem Contato S16'),                                                                                                               -- 4 inválida
    jsonb_build_object('name', 'Etapa Errada', 'email', 'etapa.s16@example.com', 'stage', 'Etapa que não existe'),                                              -- 5 inválida
    jsonb_build_object('name', 'Resp Errado', 'email', 'resp.s16@example.com', 'owner', 'ninguem@s16.local'),                                                    -- 6 inválida
    jsonb_build_object('name', 'Linha Completa S16', 'email', 'completa.s16@example.com', 'unit', 'Unidade B (teste S16)', 'stage', 'Contato feito', 'owner', 'S2@s16.local',
                       'list', 'Lista B S16', 'source', 'Indicação', 'campaign', 'Feira 2026', 'value', 'R$ 1.234,56', 'title', 'Plano anual'),                      -- 7 tudo por coluna
    jsonb_build_object('name', 'Lista Errada', 'email', 'lista.s16@example.com', 'list', 'Lista inexistente'),                                                   -- 8 inválida
    jsonb_build_object('name', 'Valor Ruim', 'email', 'valor.s16@example.com', 'value', 'abc'),                                                                  -- 9 inválida
    jsonb_build_object('name', 'Email Ruim', 'email', 'sem-arroba', 'phone', '(11) 96666-5555'),                                                                 -- 10 inválida
    jsonb_build_object('name', 'Etapa Fechada', 'email', 'fechada.s16@example.com', 'stage', 'Ganho'));                                                         -- 11 inválida (etapa não aberta)

  -- ============ 1) permissões
  set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_import_check(%L::jsonb, %L::jsonb)', defs, rows)) like '42501%', 'fisioterapeuta NÃO acessa a importação do CRM (42501)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_import_commit(%L::jsonb, %L::jsonb)', defs, rows)) like '42501%', 'nem grava');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_import_check(%L::jsonb, %L::jsonb)', defs, rows)) like '42501%', 'anon não executa a prévia (42501)');
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.crm_imports') like '42501%', 'anon não lê o histórico de importações');
  reset role; set local role authenticated; perform pg_temp.as_user(u_phy);
  select count(*) into n from public.crm_imports; rep := rep || pg_temp.chk(n = 0, 'fisioterapeuta não enxerga o histórico de importações');

  -- ============ 2) prévia (não grava nada) — gestor
  perform pg_temp.as_user(u_mgr);
  select count(*) into n from public.people; select count(*) into n2 from public.opportunities;
  chk := public.crm_import_check(defs, rows);
  select count(*) into n3 from public.people; rep := rep || pg_temp.chk(n3 = n and (select count(*) from public.opportunities) = n2, 'a prévia NÃO grava pessoa nem oportunidade');
  rep := rep || pg_temp.chk(chk -> 0 ->> 'status' = 'new', 'linha 0: pessoa nova');
  rep := rep || pg_temp.chk(chk -> 1 ->> 'status' = 'existing' and (chk -> 1 ->> 'person_id')::uuid = p_maria, 'linha 1: mesma pessoa e mesmos dados → reaproveita o cadastro (existing), sem conflito');
  rep := rep || pg_temp.chk(chk -> 2 ->> 'status' = 'conflict' and chk -> 2 ->> 'kind' = 'dados_divergentes' and (select count(*) from jsonb_array_elements(chk -> 2 -> 'diffs') d where d ->> 'field' = 'phone') = 1
      and (select count(*) from jsonb_array_elements(chk -> 2 -> 'diffs') d where d ->> 'field' = 'name') = 1, 'linha 2: mesmo e-mail com nome e telefone diferentes → CONFLITO, mostrando o que diverge (nome e telefone)');
  rep := rep || pg_temp.chk(chk -> 3 ->> 'status' = 'conflict' and chk -> 3 ->> 'kind' = 'homonimo_possivel', 'linha 3: nome igual com contato diferente → possível homônimo (decisão do usuário)');
  rep := rep || pg_temp.chk(chk -> 4 ->> 'status' = 'invalid' and chk -> 4 ->> 'errors' like '%informe e-mail ou telefone%', 'linha 4: sem e-mail e sem telefone é inválida');
  rep := rep || pg_temp.chk(chk -> 5 ->> 'status' = 'invalid' and chk -> 5 ->> 'errors' like '%etapa%não existe%', 'linha 5: etapa inexistente é inválida, dizendo qual');
  rep := rep || pg_temp.chk(chk -> 6 ->> 'status' = 'invalid' and chk -> 6 ->> 'errors' like '%responsável%', 'linha 6: responsável desconhecido é inválido');
  rep := rep || pg_temp.chk(chk -> 7 ->> 'status' = 'new' and (chk -> 7 ->> 'unit_id')::uuid = ub and (chk -> 7 ->> 'stage_id')::uuid = st_contact and (chk -> 7 ->> 'owner_user_id')::uuid = u_sales2 and (chk -> 7 ->> 'list_id')::uuid = lst2
      and chk -> 7 ->> 'source' = 'Indicação' and chk -> 7 ->> 'campaign' = 'Feira 2026' and (chk -> 7 ->> 'value_cents')::bigint = 123456 and chk -> 7 ->> 'title' = 'Plano anual', 'linha 7: unidade, etapa, responsável (e-mail sem diferenciar maiúsculas), lista, origem, campanha, valor e título vêm das colunas');
  rep := rep || pg_temp.chk(chk -> 8 ->> 'status' = 'invalid' and chk -> 8 ->> 'errors' like '%lista%não encontrada%', 'linha 8: lista inexistente é inválida');
  rep := rep || pg_temp.chk(chk -> 9 ->> 'status' = 'invalid' and chk -> 9 ->> 'errors' like '%valor inválido%', 'linha 9: valor inválido');
  rep := rep || pg_temp.chk(chk -> 10 ->> 'status' = 'invalid' and chk -> 10 ->> 'errors' like '%e-mail inválido%', 'linha 10: e-mail inválido');
  rep := rep || pg_temp.chk(chk -> 11 ->> 'status' = 'invalid' and chk -> 11 ->> 'errors' like '%etapa%', 'linha 11: etapa “Ganho” (não aberta) não serve de etapa inicial');
  rep := rep || pg_temp.chk(chk -> 0 ->> 'source' = 'Planilha de evento' and chk -> 0 ->> 'campaign' = 'Campanha S16' and (chk -> 0 ->> 'stage_id')::uuid = st_new and (chk -> 0 ->> 'list_id')::uuid = lst, 'sem coluna na linha, valem os padrões do lote (origem, campanha, etapa inicial, lista)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_import_check(%L::jsonb, (select jsonb_agg(jsonb_build_object(''name'', ''x'' || g, ''email'', ''x'' || g || ''@e.com'')) from generate_series(1, 501) g))', defs)) like '%até 500 linhas%', 'mais de 500 linhas é recusado');
  -- comercial da unidade A não importa para a unidade B
  perform pg_temp.as_user(u_sales);
  chk := public.crm_import_check(defs, jsonb_build_array(rows -> 7));
  rep := rep || pg_temp.chk(chk -> 0 ->> 'status' = 'invalid' and chk -> 0 ->> 'errors' like '%sem permissão%', 'comercial da unidade A NÃO importa para a unidade B (linha inválida: sem permissão)');
  perform pg_temp.as_user(u_mgr);

  -- ============ 3) gravação sem decisões: conflitos ficam pendentes; nada existente é sobrescrito
  select string_agg(full_name || '|' || id::text, ';' order by id) into snap1 from public.people where id in (p_maria, p_carlos);
  select string_agg(type || ':' || value, ';' order by type, value) into x from public.person_contacts where person_id = p_maria;
  select string_agg(type || ':' || value, ';' order by type, value) as c into snap2 from public.person_contacts where person_id = p_maria;
  res := public.crm_import_commit(defs, rows, '{}', 'arquivo-s16.csv');
  imp1 := (res ->> 'import_id')::uuid;
  rep := rep || pg_temp.chk((res -> 'summary' ->> 'created')::int = 2 and (res -> 'summary' ->> 'linked')::int = 1 and (res -> 'summary' ->> 'pending')::int = 2 and (res -> 'summary' ->> 'invalid')::int = 7 and (res -> 'summary' ->> 'error')::int = 0,
    'resumo: 2 criadas (0 e 7), 1 vinculada ao cadastro existente (1), 2 pendentes de decisão (2 e 3), 7 inválidas, 0 erros');
  r := res -> 'results' -> 0; rep := rep || pg_temp.chk(r ->> 'status' = 'created' and (r ->> 'opportunity_created')::boolean, 'linha 0 criou pessoa + oportunidade');
  r := res -> 'results' -> 2; rep := rep || pg_temp.chk(r ->> 'status' = 'pending', 'linha 2 (conflito) ficou PENDENTE: nada foi gravado sem decisão');
  select string_agg(type || ':' || value, ';' order by type, value) into snap2 from public.person_contacts where person_id = p_maria;
  select full_name into x from public.people where id = p_maria;
  rep := rep || pg_temp.chk(x.full_name = 'Maria Existente' and snap2 = 'email:maria.s16@example.com;phone:(11) 98888-1111', 'o cadastro da Maria (nome e contatos) NÃO foi alterado automaticamente');
  select count(*) into n from public.people where full_name in ('Maria E. Silva') or id in (select person_id from public.person_contacts where value = '(21) 94444-4444'); rep := rep || pg_temp.chk(n = 0, 'nenhuma pessoa duplicada foi criada pelos conflitos');
  select count(*) into n from public.opportunities where person_id = p_maria and pipeline_id = pipe and status = 'open'; rep := rep || pg_temp.chk(n = 1, 'a pessoa existente ganhou 1 oportunidade aberta no funil');
  select o.stage_id, o.owner_user_id, o.source, o.campaign, o.value_cents, o.title, o.unit_id into x from public.opportunities o join public.people p on p.id = o.person_id where p.full_name = 'Linha Completa S16' and o.pipeline_id = pipe;
  rep := rep || pg_temp.chk(x.stage_id = st_contact and x.owner_user_id = u_sales2 and x.source = 'Indicação' and x.campaign = 'Feira 2026' and x.value_cents = 123456 and x.title = 'Plano anual' and x.unit_id = ub, 'a oportunidade da linha 7 nasceu com etapa, responsável, origem, campanha, valor, título e unidade das colunas');
  select count(*) into n from public.crm_lead_list_members m join public.people p on p.id = m.person_id where m.list_id = lst2 and p.full_name = 'Linha Completa S16'; select count(*) into n2 from public.crm_lead_list_members where list_id = lst;
  rep := rep || pg_temp.chk(n = 1 and n2 = 2, 'listas: a linha 7 entrou na “Lista B” (coluna) e as demais no padrão (Joana + Maria)');
  select count(*) into n from public.opportunity_events e join public.opportunities o on o.id = e.opportunity_id where o.pipeline_id = pipe and e.kind = 'created'; rep := rep || pg_temp.chk(n = 3, 'cada oportunidade registra o evento “criada” (histórico do funil)');
  select count(*) into n from public.person_kinds k join public.people p on p.id = k.person_id where p.full_name = 'Joana Nova' and k.kind = 'lead'; rep := rep || pg_temp.chk(n = 1, 'pessoa nova entra no cadastro central como lead');

  -- ============ 4) reimportar o MESMO arquivo não duplica nada
  select count(*) into n from public.people; select count(*) into n2 from public.opportunities where pipeline_id = pipe; select count(*) into n3 from public.crm_lead_list_members;
  res := public.crm_import_commit(defs, rows, '{}', 'arquivo-s16.csv');
  rep := rep || pg_temp.chk((res -> 'summary' ->> 'created')::int = 0 and (res -> 'summary' ->> 'linked')::int = 0 and (res -> 'summary' ->> 'duplicate')::int = 3 and (res -> 'summary' ->> 'pending')::int = 2,
    'reimportação: 0 criadas, 0 vinculadas, 3 reconhecidas como duplicadas (0, 1 e 7), 2 conflitos ainda pendentes');
  rep := rep || pg_temp.chk((select count(*) from public.people) = n and (select count(*) from public.opportunities where pipeline_id = pipe) = n2 and (select count(*) from public.crm_lead_list_members) = n3, 'reimportar o mesmo arquivo NÃO cria pessoas, oportunidades nem participações de lista');

  -- ============ 5) decisões explícitas
  chk := public.crm_import_check(defs, rows);
  rep := rep || pg_temp.chk(jsonb_array_length(chk -> 2 -> 'candidates') >= 1 and (chk -> 2 -> 'candidates' -> 0 ->> 'visible')::boolean, 'a prévia traz os candidatos (visíveis) para a decisão');
  -- decisões recusadas ou neutras (usam a linha 3 e a 2 ainda em conflito)
  res := public.crm_import_commit(defs, jsonb_build_array(rows -> 2), jsonb_build_object('0', jsonb_build_object('action', 'use_existing', 'person_id', p_carlos)), null);
  rep := rep || pg_temp.chk(res -> 'results' -> 0 ->> 'status' = 'error' and res -> 'results' -> 0 ->> 'message' like '%candidatas%', 'escolher uma pessoa que não é candidata é recusado (não vincula a qualquer um)');
  res := public.crm_import_commit(defs, jsonb_build_array(rows -> 2), jsonb_build_object('0', jsonb_build_object('action', 'apagar_tudo')), null);
  rep := rep || pg_temp.chk(res -> 'results' -> 0 ->> 'status' = 'error' and res -> 'results' -> 0 ->> 'message' like '%decisão inválida%', 'ação desconhecida é recusada');
  res := public.crm_import_commit(defs, jsonb_build_array(rows -> 3), jsonb_build_object('0', jsonb_build_object('action', 'skip')), null);
  rep := rep || pg_temp.chk(res -> 'results' -> 0 ->> 'status' = 'skipped', 'decisão “pular” não grava nada');
  res := public.crm_import_commit(defs, jsonb_build_array(rows -> 3), jsonb_build_object('0', jsonb_build_object('action', 'update_existing', 'fields', jsonb_build_array('name'))), null);
  rep := rep || pg_temp.chk(res -> 'results' -> 0 ->> 'status' = 'error', 'atualizar só vale para conflito de dados divergentes de UMA pessoa (homônimo recusa)');
  res := public.crm_import_commit(defs, jsonb_build_array(rows -> 2), jsonb_build_object('0', jsonb_build_object('action', 'update_existing', 'fields', jsonb_build_array('cpf'))), null);
  rep := rep || pg_temp.chk(res -> 'results' -> 0 ->> 'status' = 'error' and res -> 'results' -> 0 ->> 'message' like '%campo inválido%', 'campo fora de nome/telefone/e-mail é recusado na atualização');
  select string_agg(type || ':' || value, ';' order by type, value) into snap2 from public.person_contacts where person_id = p_maria; select full_name into x from public.people where id = p_maria;
  rep := rep || pg_temp.chk(x.full_name = 'Maria Existente' and snap2 = 'email:maria.s16@example.com;phone:(11) 98888-1111', 'depois de todas as decisões recusadas/puladas, a Maria continua intacta');
  -- decisões válidas
  dec := jsonb_build_object('2', jsonb_build_object('action', 'update_existing', 'fields', jsonb_build_array('phone')), '3', jsonb_build_object('action', 'create_new'));
  res := public.crm_import_commit(defs, rows, dec, 'arquivo-s16.csv');
  rep := rep || pg_temp.chk((res -> 'results' -> 2 ->> 'status') = 'updated' and (res -> 'results' -> 3 ->> 'status') = 'created', 'decisões: linha 2 “atualizar só o telefone” → updated; linha 3 “criar nova pessoa” → created');
  select string_agg(type || ':' || value, ';' order by type, value) into snap2 from public.person_contacts where person_id = p_maria; select full_name into x from public.people where id = p_maria;
  rep := rep || pg_temp.chk(x.full_name = 'Maria Existente' and snap2 like '%(11) 95555-3333%' and snap2 like '%(11) 98888-1111%', 'atualizar só o telefone ACRESCENTA o novo contato, mantém o antigo e NÃO muda o nome (só o que foi escolhido)');
  select count(*) into n from public.opportunities where person_id = p_maria and pipeline_id = pipe and status = 'open'; rep := rep || pg_temp.chk(n = 1, 'a Maria continua com UMA oportunidade aberta (não duplicou)');
  select count(*) into n from public.people where full_name = 'Maria Existente'; rep := rep || pg_temp.chk(n = 2, 'criar nova pessoa na linha 3 gerou o segundo cadastro só porque o usuário decidiu');

  -- ============ 5b) listas do CRM só para papéis do CRM (migration 074): antes qualquer usuário da organização lia, criava e apagava listas pela API
  reset role; set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.crm_lead_lists (org_id, name) values (%L, ''Intruso fisio S16'')', v_org)) like '42501%' or pg_temp.err(format('insert into public.crm_lead_lists (org_id, name) values (%L, ''Intruso fisio S16'')', v_org)) like '%row-level security%', 'fisioterapeuta NÃO cria lista do CRM (RLS)');
  select count(*) into n from public.crm_lead_lists; select count(*) into n2 from public.crm_lead_list_members; rep := rep || pg_temp.chk(n = 0 and n2 = 0, 'fisioterapeuta NÃO enxerga listas nem participantes');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.crm_lead_list_members (list_id, person_id) values (%L, %L)', lst, p_maria)) is not null, 'fisioterapeuta NÃO liga pessoa a lista');
  perform pg_temp.as_user(u_sales);
  select count(*) into n from public.crm_lead_lists where id = lst; rep := rep || pg_temp.chk(n = 1, 'comercial enxerga e usa as listas');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.crm_lead_lists (org_id, name) values (%L, ''Lista comercial S16'')', v_org)) is null, 'comercial cria lista');
  select count(*) into n from public.crm_lead_list_members where list_id = lst; rep := rep || pg_temp.chk(n >= 0, 'comercial lê participantes das pessoas que pode ler');
  perform pg_temp.as_user(u_mgr);

  -- ============ 6) histórico e auditoria
  select count(*) into n from public.crm_imports where filename = 'arquivo-s16.csv'; rep := rep || pg_temp.chk(n = 3, 'cada importação do arquivo fica registrada (arquivo, quem, quando, resumo): 3 execuções');
  select (summary ->> 'created')::int = 2 and row_count = 12 into ok from public.crm_imports where id = imp1; rep := rep || pg_temp.chk(ok, 'o registro guarda o resumo da primeira execução (12 linhas, 2 criadas)');
  perform pg_temp.as_user(u_sales);
  select count(*) into n from public.crm_imports; rep := rep || pg_temp.chk(n >= 1, 'comercial lê o histórico de importações');
  reset role; select count(*) into n from public.audit_log where entity_type = 'crm_imports'; rep := rep || pg_temp.chk(n >= 3, 'as importações foram auditadas');
  select count(*) into n from public.audit_log where entity_type = 'people' and entity_id = p_maria::text and action = 'update'; rep := rep || pg_temp.chk(n = 0, 'o cadastro da Maria não teve nenhuma atualização de nome (auditoria de pessoas limpa)');

  raise exception E'RELATORIO_S16_CRM_IMPORTACAO (transação desfeita):%', rep;
end $$;
