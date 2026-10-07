-- RELEASE v1 — S22: tipos de lead, listas com tipo, empresas (B2B) e um lead com várias oportunidades (migration 083). Transação sempre desfeita. Somente Dev/teste.
--  · lista: o tipo é obrigatório e restrito (paciente, fisioterapeuta-equipe, fisioterapeuta-Academy, empresa); empresas só entram em listas do tipo "companies"
--  · empresa pelo CRM: comercial cria sem acesso ao cadastro completo; CNPJ inválido/duplicado e nome repetido; contato vira representante principal; sem permissão = 42501
--  · uma pessoa com oportunidades em funis DIFERENTES (cada uma anda sozinha); empresa só no funil de empresas e uma aberta por empresa e funil
--  · crm_pipeline_overview e o quiz de parceria (interesse no programa de clínica própria abre oportunidade na Academy, uma vez; sem interesse, não)
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  v_org uuid; ua uuid; ub uuid; u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); rep text := '';
  pp uuid; pe uuid; pc uuid; pcust uuid; stp uuid; ste uuid; stc uuid; stp2 uuid; ste2 uuid;
  per uuid; contact1 uuid; contact2 uuid; lp uuid; lc uuid; co1 uuid; co2 uuid; r jsonb; t text; n bigint;
  o_pac uuid; o_par uuid; o_edu uuid; o_emp uuid; o_emp2 uuid; ov record; lead uuid; res jsonb; opp_n bigint; ed_src text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S22)', 'teste-a-s22') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S22)', 'teste-b-s22') returning id into ub;
  insert into auth.users (id, aud, role, email) values (u_sales,'authenticated','authenticated','s@s22.local'),(u_phy,'authenticated','authenticated','p@s22.local'),(u_mgr,'authenticated','authenticated','m@s22.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_sales, v_org, null, 'Comercial S22'),(u_phy, v_org, null, 'Fisio S22'),(u_mgr, v_org, null, 'Gestor S22');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_sales, 'sales', ua),(v_org, u_phy, 'physio', ua),(v_org, u_mgr, 'manager', null);
  -- funis de teste (um por tipo) com 3 etapas abertas e ganho
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Pacientes S22', 'patients') returning id into pp;
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Equipe S22', 'partners') returning id into pe;
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Academy S22', 'education') returning id into pc;
  insert into public.pipelines (org_id, name, kind) values (v_org, 'Empresas S22', 'companies') returning id into pcust;
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pp, 'Novo', 1, 'open'),(v_org, pp, 'Avaliação', 2, 'open');
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pe, 'Novo', 1, 'open'),(v_org, pe, 'Entrevista', 2, 'open');
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pc, 'Novo', 1, 'open'),(v_org, pc, 'Conversa', 2, 'open');
  insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (v_org, pcust, 'Novo', 1, 'open'),(v_org, pcust, 'Proposta', 2, 'open');
  select id into stp2 from public.pipeline_stages where pipeline_id = pp and position = 2; select id into ste2 from public.pipeline_stages where pipeline_id = pe and position = 2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Junior Santos S22') returning id into per;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Contato Um S22') returning id into contact1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Contato Dois S22') returning id into contact2;
  set local role authenticated; perform pg_temp.as_user(u_sales);

  -- ============ 1) listas: tipo obrigatório e restrito
  t := pg_temp.err(format('insert into public.crm_lead_lists (org_id, name) values (%L, ''Lista sem tipo S22'')', v_org));
  rep := rep || pg_temp.chk(t like '23514%', 'lista NOVA sem tipo é recusada');
  t := pg_temp.err(format('insert into public.crm_lead_lists (org_id, name, kind) values (%L, ''Lista tipo inválido S22'', ''outro'')', v_org));
  rep := rep || pg_temp.chk(t like '23514%', 'tipo fora da lista é recusado');
  insert into public.crm_lead_lists (org_id, name, kind) values (v_org, 'Lista pacientes S22', 'patients') returning id into lp;
  insert into public.crm_lead_lists (org_id, name, kind) values (v_org, 'Lista empresas S22', 'companies') returning id into lc;
  rep := rep || pg_temp.chk(lp is not null and lc is not null, 'comercial cria listas de paciente e de empresa (tipo escolhido)');
  insert into public.crm_lead_list_members (list_id, person_id) values (lp, per); rep := rep || pg_temp.chk(true, 'pessoa entra na lista de pacientes');

  -- ============ 2) empresa pelo CRM
  t := pg_temp.err(format('select public.crm_company_create(''X'')'));
  rep := rep || pg_temp.chk(t like 'P0001%', 'nome com 1 letra é recusado');
  t := pg_temp.err(format('select public.crm_company_create(''Empresa CNPJ ruim S22'', null, ''11.111.111/1111-11'')'));
  rep := rep || pg_temp.chk(t like '%CNPJ%', 'CNPJ inválido é recusado');
  r := public.crm_company_create('Clínica Aurora S22', 'Aurora S22', '11.222.333/0001-81', 'contato@aurora.s22.local', '1130000000', 'São Paulo', 'sp', ua, contact1, 'Gerente comercial');
  rep := rep || pg_temp.chk(r ->> 'status' = 'created', 'comercial registra a empresa (status created)');
  co1 := (r ->> 'id')::uuid;
  rep := rep || pg_temp.chk((select count(*) from public.legal_entity_representatives where legal_entity_id = co1 and person_id = contact1 and is_primary and role_title = 'Gerente comercial') = 1, 'o contato vira representante principal, com o cargo');
  rep := rep || pg_temp.chk((select count(*) from public.legal_entity_units where legal_entity_id = co1 and unit_id = ua) = 1, 'a empresa fica ligada à unidade');
  rep := rep || pg_temp.chk((select origin from public.legal_entities where id = co1) = 'CRM (B2B)' and (select state_uf from public.legal_entities where id = co1) = 'SP', 'origem "CRM (B2B)" e UF normalizada');
  r := public.crm_company_create('Outro nome S22', null, '11.222.333/0001-81');
  rep := rep || pg_temp.chk(r ->> 'status' = 'existing' and (r ->> 'id')::uuid = co1, 'mesmo CNPJ devolve a empresa existente (não duplica)');
  r := public.crm_company_create('clínica aurora s22');
  rep := rep || pg_temp.chk(r ->> 'status' = 'duplicate' and (r ->> 'id')::uuid = co1, 'mesmo nome (sem diferenciar maiúsculas) devolve duplicidade para decisão');
  r := public.crm_company_create('Clínica Aurora S22', p_force => true);
  rep := rep || pg_temp.chk(r ->> 'status' = 'created', 'com decisão explícita (force) cria mesmo assim');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_company_create(''Empresa unidade B S22'', null, null, null, null, null, null, %L)', ub)) like '42501%', 'comercial da unidade A NÃO cria empresa na unidade B');
  perform public.crm_company_link_contact(co1, contact2, 'Compras');
  rep := rep || pg_temp.chk((select count(*) from public.legal_entity_representatives where legal_entity_id = co1) = 2 and (select count(*) from public.legal_entity_representatives where legal_entity_id = co1 and is_primary) = 1, 'segundo contato é vinculado e só um fica como principal');
  insert into public.crm_lead_list_companies (list_id, legal_entity_id) values (lc, co1); rep := rep || pg_temp.chk(true, 'empresa entra na lista do tipo "empresas"');
  t := pg_temp.err(format('insert into public.crm_lead_list_companies (list_id, legal_entity_id) values (%L, %L)', lp, co1));
  rep := rep || pg_temp.chk(t like '42501%', 'empresa NÃO entra em lista de pacientes');
  rep := rep || pg_temp.chk((select count(*) from public.crm_lead_list_companies where list_id = lc) = 1, 'a lista de empresas tem 1 empresa');

  -- ============ 3) um lead, várias oportunidades (Junior Santos): paciente? não — equipe + Academy; cada uma anda sozinha
  o_par := public.crm_create_opportunity(per, pe, ua, 'Junior — quer trabalhar conosco', null, 0, u_sales, 'teste', null);
  o_edu := public.crm_create_opportunity(per, pc, ua, 'Junior — quer a HP Academy', null, 0, u_sales, 'teste', null);
  rep := rep || pg_temp.chk(o_par is not null and o_edu is not null, 'a mesma pessoa tem oportunidade na equipe e na Academy ao mesmo tempo');
  select count(*) into n from public.opportunities where person_id = per and status = 'open'; rep := rep || pg_temp.chk(n = 2, 'duas oportunidades abertas da mesma pessoa, em funis diferentes');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_create_opportunity(%L, %L, %L, ''repetida'', null, 0, null, ''t'', null)', per, pe, ua)) like 'P0001%', 'segunda oportunidade ABERTA no MESMO funil continua recusada');
  update public.opportunities set stage_id = ste2 where id = o_par;
  rep := rep || pg_temp.chk((select stage_id from public.opportunities where id = o_par) = ste2 and (select position from public.pipeline_stages s join public.opportunities o on o.stage_id = s.id where o.id = o_edu) = 1, 'avançar a de equipe NÃO move a da Academy (continua na 1ª etapa)');
  o_pac := public.crm_create_opportunity(per, pp, ua, 'Junior também quer atendimento', null, 0, u_sales, 'teste', null);
  select count(distinct pipeline_id) into n from public.opportunities where person_id = per and status = 'open'; rep := rep || pg_temp.chk(n = 3, 'e uma terceira, de paciente, em outro funil (3 funis, 3 oportunidades)');

  -- ============ 4) empresa na oportunidade B2B
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_create_opportunity(%L, %L, %L, ''x'', null, 0, null, ''t'', null, %L)', contact1, pp, ua, co1)) like 'P0001%', 'empresa só se aplica a funil de empresas');
  o_emp := public.crm_create_opportunity(contact1, pcust, ua, 'B2B — Clínica Aurora', null, 0, u_sales, 'teste', null, co1);
  rep := rep || pg_temp.chk((select legal_entity_id from public.opportunities where id = o_emp) = co1, 'oportunidade B2B guarda a empresa (e o contato como pessoa)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_create_opportunity(%L, %L, %L, ''outro contato'', null, 0, null, ''t'', null, %L)', contact2, pcust, ua, co1)) like 'P0001%', 'segunda oportunidade aberta da MESMA empresa no funil de empresas é recusada (mesmo com outro contato)');

  -- ============ 5) visão geral por funil
  select * into ov from public.crm_pipeline_overview() where pipeline_id = pe;
  rep := rep || pg_temp.chk(ov.open_count = 1 and ov.kind = 'partners' and ov.people_count = 1, 'visão por funil: equipe com 1 aberta, 1 pessoa');
  select * into ov from public.crm_pipeline_overview() where pipeline_id = pp; rep := rep || pg_temp.chk(ov.open_count = 1, 'visão por funil: pacientes com 1 aberta');
  select * into ov from public.crm_pipeline_overview() where pipeline_id = pcust; rep := rep || pg_temp.chk(ov.open_count = 1 and ov.kind = 'companies', 'visão por funil: empresas com 1 aberta');

  -- ============ 6) permissões
  perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_company_create(''Empresa do fisio S22'')')) like '42501%', 'fisioterapeuta NÃO cria empresa pelo CRM');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_company_link_contact(%L, %L)', co1, contact1)) like '42501%', 'fisioterapeuta NÃO vincula contato');
  select count(*) into n from public.crm_lead_list_companies; rep := rep || pg_temp.chk(n = 0, 'fisioterapeuta NÃO lê empresas das listas');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.crm_lead_lists (org_id, name, kind) values (%L, ''Lista do fisio S22'', ''patients'')', v_org)) is not null, 'fisioterapeuta NÃO cria lista');
  reset role; set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select * from public.crm_pipeline_overview()') is not null, 'anônimo NÃO vê a visão por funil');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.crm_company_create(''Empresa anon S22'')')) is not null, 'anônimo NÃO cria empresa');
  reset role;

  -- ============ 7) quiz de parceria: interesse no programa abre oportunidade na Academy (uma vez); sem interesse, não
  -- (o quiz usa os funis reais do tipo partners/education da organização; os de teste acima têm o mesmo tipo, então o teste usa o primeiro de cada tipo)
  set local role anon;
  res := public.quiz_start('parceria', 'Fisio Interessado S22', 'fisio.interessado.s22@example.com', '(11) 98888-1111', 'contact-v1', '/trabalhe-conosco', 'trabalhe-conosco', null, '{}'::jsonb, null);
  lead := (res ->> 'id')::uuid;
  perform public.quiz_save_progress(lead, 5, jsonb_build_object('momento_profissional', jsonb_build_object('value','em_atuacao','label','x'), 'situacao_registro', jsonb_build_object('value','ativo','label','x'),
    'area_atuacao', jsonb_build_object('value','ortopedia','label','x'), 'modelo_atendimento', jsonb_build_object('value','domiciliar','label','x'),
    'objetivos_parceria', jsonb_build_object('value', jsonb_build_array('desenvolver_negocio'), 'label','x'), 'interesses_desenvolvimento', jsonb_build_object('value', jsonb_build_array('gestao'), 'label','x')), 'Campinas', 'SP');
  perform public.quiz_save_progress(lead, 11, jsonb_build_object('interesse_programa_clinica', jsonb_build_object('value','sim','label','Sim, teria interesse'), 'prazo_programa_clinica', jsonb_build_object('value','tres_meses','label','Nos próximos 3 meses')));
  perform public.quiz_complete(lead, false, null);
  perform public.quiz_complete(lead, false, null);        -- repetir não duplica
  reset role;
  select person_id into per from public.quiz_leads where id = lead;
  select count(*), min(o.source) into opp_n, ed_src from public.opportunities o join public.pipelines p on p.id = o.pipeline_id where o.person_id = per and p.kind = 'education' and o.status = 'open';
  rep := rep || pg_temp.chk(opp_n = 1 and ed_src = 'quiz:academy', 'interesse no programa: UMA oportunidade aberta no funil da Academy (origem quiz:academy), mesmo concluindo duas vezes');
  select count(*) into n from public.opportunities o join public.pipelines p on p.id = o.pipeline_id where o.person_id = per and p.kind = 'partners' and o.status = 'open'; rep := rep || pg_temp.chk(n = 1, 'a oportunidade de parceria (equipe) continua existindo, separada');
  select count(*) into n from public.interactions where person_id = per and summary like 'Interesse no programa de clínica própria%'; rep := rep || pg_temp.chk(n = 1, 'o interesse fica registrado no histórico da oportunidade da Academy');
  set local role anon;
  res := public.quiz_start('parceria', 'Fisio Sem Interesse S22', 'fisio.sem.s22@example.com', '(11) 98888-2222', 'contact-v1', '/trabalhe-conosco', 'trabalhe-conosco', null, '{}'::jsonb, null);
  lead := (res ->> 'id')::uuid;
  perform public.quiz_save_progress(lead, 5, jsonb_build_object('momento_profissional', jsonb_build_object('value','estudante','label','x'), 'situacao_registro', jsonb_build_object('value','nao_possuo','label','x'),
    'area_atuacao', jsonb_build_object('value','geriatrica','label','x'), 'modelo_atendimento', jsonb_build_object('value','nao_atendo','label','x'),
    'objetivos_parceria', jsonb_build_object('value', jsonb_build_array('equipe'), 'label','x'), 'interesses_desenvolvimento', jsonb_build_object('value', jsonb_build_array('nenhuma'), 'label','x')), 'Santos', 'SP');
  perform public.quiz_save_progress(lead, 11, jsonb_build_object('interesse_programa_clinica', jsonb_build_object('value','nao_momento','label','Não neste momento')));
  perform public.quiz_complete(lead, false, null);
  reset role;
  select person_id into per from public.quiz_leads where id = lead;
  select count(*) into n from public.opportunities o join public.pipelines p on p.id = o.pipeline_id where o.person_id = per and p.kind = 'education'; rep := rep || pg_temp.chk(n = 0, 'sem interesse no programa: nenhuma oportunidade na Academy');

  raise exception E'RELATORIO_S22_TIPOS_DE_LEAD (transação desfeita):%', rep;
end $$;
