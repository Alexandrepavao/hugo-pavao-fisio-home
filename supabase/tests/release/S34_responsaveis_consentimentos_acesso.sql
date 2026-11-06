-- RELEASE v1 — S34: responsável legal / cuidador / delegado, menor de idade, consentimentos e leitura clínica do admin COM registro (migration 097).
-- Transação sempre desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
-- usuário logado; p_recent = senha digitada há pouco (amr recente); p_act = cabeçalho x-acting-as
create or replace function pg_temp.as_user(u uuid, p_recent boolean default true, p_act uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now() - case when p_recent then interval '1 minute' else interval '2 hours' end)::bigint)))::text, true);
  perform set_config('request.headers', case when p_act is null then '{}' else json_build_object('x-acting-as', p_act)::text end, true);
end $$;
do $$
declare
  v_org uuid; ua uuid; svc uuid; pr uuid; rep text := ''; j jsonb; n int; e text;
  u_mgr uuid := gen_random_uuid(); u_ops uuid := gen_random_uuid(); u_um uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  u_mae uuid := gen_random_uuid(); u_pai uuid := gen_random_uuid(); u_teen uuid := gen_random_uuid(); u_old uuid := gen_random_uuid(); u_cg uuid := gen_random_uuid(); u_out uuid := gen_random_uuid(); u_kid uuid := gen_random_uuid();
  p_phy uuid; p_mae uuid; p_pai uuid; p_kid uuid; p_teen uuid; p_old uuid; p_cg uuid; p_out uuid;
  r_mae uuid; r_pai uuid; r_cg uuid; r_del uuid; r_teen uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade teste S34', 'teste-s34') returning id into ua;
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@s34.local' from unnest(array[u_mgr,u_ops,u_um,u_sales,u_phy,u_mae,u_pai,u_teen,u_old,u_cg,u_out,u_kid]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Fisio S34') returning id into p_phy;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Mãe S34') returning id into p_mae;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Pai S34') returning id into p_pai;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Criança S34', current_date - interval '8 years') returning id into p_kid;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Adolescente S34', current_date - interval '14 years') returning id into p_teen;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, ua, 'Idoso S34', date '1950-01-01') returning id into p_old;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Cuidadora S34') returning id into p_cg;
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Estranho S34') returning id into p_out;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S34'),(u_ops, v_org, null, 'Adm S34'),(u_um, v_org, null, 'Gestor Unidade S34'),(u_sales, v_org, null, 'Comercial S34'),
    (u_phy, v_org, p_phy, 'Fisio S34'),(u_mae, v_org, p_mae, 'Mãe S34'),(u_pai, v_org, p_pai, 'Pai S34'),(u_teen, v_org, p_teen, 'Adolescente S34'),(u_old, v_org, p_old, 'Idoso S34'),(u_cg, v_org, p_cg, 'Cuidadora S34'),
    (u_out, v_org, p_out, 'Estranho S34'),(u_kid, v_org, p_kid, 'Criança S34');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org,u_mgr,'manager',null),(v_org,u_ops,'ops_admin',null),(v_org,u_um,'unit_manager',ua),(v_org,u_sales,'sales',ua),(v_org,u_phy,'physio',ua),
    (v_org,u_mae,'member',null),(v_org,u_pai,'member',null),(v_org,u_teen,'member',null),(v_org,u_old,'member',null),(v_org,u_cg,'member',null),(v_org,u_out,'member',null),(v_org,u_kid,'member',null);
  insert into public.services (org_id, name, duration_min) values (v_org, 'Serviço S34', 30) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, p_phy, 'Fisio S34') returning id into pr;
  insert into public.professional_units (professional_id, unit_id) values (pr, ua);
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id) values (v_org, ua, u_phy, p_kid),(v_org, ua, u_phy, p_old);
  insert into public.patient_goals (org_id, unit_id, person_id, title) values (v_org, ua, p_kid, 'Meta da criança S34');
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values
    (v_org, ua, pr, p_kid, svc, tstzrange(now() + interval '3 days', now() + interval '3 days' + interval '30 minutes'), 'scheduled'),
    (v_org, ua, pr, p_old, svc, tstzrange(now() + interval '4 days', now() + interval '4 days' + interval '30 minutes'), 'scheduled');

  set local role authenticated;
  -- ============ 1) quem cria vínculo e validações
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_save(null, %L, %L, ''responsavel_legal'')', p_kid, p_mae)) like '42501%', 'comercial NÃO cria vínculo (42501)');
  perform pg_temp.as_user(u_um);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_save(null, %L, %L, ''responsavel_legal'')', p_old, p_mae)) like '%menor de 18 anos%', 'responsável legal para paciente adulto é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_save(null, %L, %L, ''delegado'', null, current_date + 30)', p_kid, p_mae)) like '%maior de idade%', 'delegação para menor é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_save(null, %L, %L, ''cuidador'')', p_old, p_cg)) like '%validade%', 'cuidador sem validade é recusado');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_save(null, %L, %L, ''cuidador'', null, current_date + 800)', p_old, p_cg)) like '%validade%', 'validade acima de 1 ano é recusada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_save(null, %L, %L, ''responsavel_legal'')', p_kid, p_kid)) like '%si mesmo%', 'paciente não representa a si mesmo');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_save(null, %L, %L, ''responsavel_legal'', null, null, true)', p_kid, p_mae)) like '%12 a 17%', 'login próprio de criança de 8 anos é recusado');
  r_mae := public.representation_save(null, p_kid, p_mae, 'responsavel_legal', null, null, false, 'mãe');
  r_pai := public.representation_save(null, p_kid, p_pai, 'responsavel_legal');
  r_teen := public.representation_save(null, p_teen, p_mae, 'responsavel_legal', null, null, true);
  r_cg := public.representation_save(null, p_old, p_cg, 'cuidador', null, current_date + 90);
  r_del := public.representation_save(null, p_old, p_mae, 'delegado', null, current_date + 90);
  select count(*) into n from public.care_representations where id = r_cg and can_consent = false and can_agenda and can_train and not can_cancel and not can_billing; rep := rep || pg_temp.chk(n = 1, 'cuidador nasce sem consentir, sem cancelar e sem cobrança (padrões do tipo)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_save(null, %L, %L, ''cuidador'', ''{"can_consent": true}'', current_date + 30)', p_old, p_out)) is null
      and not exists (select 1 from public.care_representations where representative_person_id = p_out and can_consent), 'pedir consentimento para cuidador é ignorado: cuidador nunca consente');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_save(null, %L, %L, ''responsavel_legal'')', p_kid, p_mae)) like '23505%', 'o mesmo vínculo aberto não duplica');

  -- ============ 2) vínculo pendente não dá acesso
  perform pg_temp.as_user(u_mae, true, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'vínculo PENDENTE (não verificado) não abre o paciente (42501)');
  perform pg_temp.as_user(u_um);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_verify(%L, true)', r_mae)) like '42501%', 'gestor de unidade NÃO verifica vínculo (só o admin)');
  perform pg_temp.as_user(u_ops);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_verify(%L)', r_mae)) like '%anexe o documento%', 'verificar sem documento e sem conferir o original é recusado');
  perform public.representation_document_add(r_mae, 'doc_foto', r_mae::text || '/doc.png');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_document_add(%L, ''doc_foto'', ''outro-caminho/x.png'')', r_mae)) like '%caminho%', 'documento só no caminho do próprio vínculo');
  perform public.representation_verify(r_mae);
  perform public.representation_verify(r_pai, true);
  perform public.representation_verify(r_teen, true);
  perform public.representation_verify(r_cg, true);
  perform public.representation_verify(r_del, true);

  -- ============ 3) vínculo verificado: a mãe age pela criança; ninguém mais
  perform pg_temp.as_user(u_mae, true, p_kid);
  j := public.my_home();
  rep := rep || pg_temp.chk(j -> 'person' ->> 'name' = 'Criança S34' and j -> 'acting' ->> 'kind' = 'responsavel_legal', 'mãe com vínculo verificado vê o Início da criança, marcado como “em nome de”');
  rep := rep || pg_temp.chk((select count(*) from public.my_appointments()) = 1, 'mãe vê os atendimentos da criança');
  rep := rep || pg_temp.chk(jsonb_array_length(public.my_journey() -> 'goals') = 1, 'mãe vê a jornada (objetivos) da criança');
  perform pg_temp.as_user(u_mae);
  j := public.my_home(); rep := rep || pg_temp.chk(j -> 'person' ->> 'name' = 'Mãe S34' and j -> 'acting' is null or j -> 'acting' = 'null'::jsonb, 'sem cabeçalho a mãe vê só os próprios dados');
  perform pg_temp.as_user(u_out, true, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'estranho tentando agir pela criança: 42501');
  perform pg_temp.as_user(u_mae, true, p_out);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'mãe tentando agir por quem não representa: 42501');
  perform set_config('request.headers', '{"x-acting-as":"lixo"}', true);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'cabeçalho inválido nunca “cai” para a própria pessoa: 42501');
  perform pg_temp.as_user(u_pai, true, p_kid);
  rep := rep || pg_temp.chk(public.my_home() -> 'person' ->> 'name' = 'Criança S34', 'o pai também age pela criança (dois responsáveis)');
  perform pg_temp.as_user(u_mae);
  j := public.my_representations();
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 3 and exists (select 1 from jsonb_array_elements(j) x where x ->> 'patient_name' = 'Criança S34' and (x ->> 'active')::boolean), 'my_representations lista quem a mãe representa (3 vínculos) com o estado ativo');

  -- ============ 4) escopos: cuidador e delegado
  perform pg_temp.as_user(u_cg, true, p_old);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'cuidador SEM o aceite do idoso não age (vínculo inativo)');
  perform pg_temp.as_user(u_cg, true);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_representation_accept(%L)', r_cg)) like '42501%', 'o próprio cuidador não dá o aceite');
  perform pg_temp.as_user(u_old, false);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_representation_accept(%L)', r_cg)) like 'P0001%reautentica%', 'aceite sem senha recente exige reautenticação');
  perform pg_temp.as_user(u_old, true);
  perform public.my_representation_accept(r_cg); perform public.my_representation_accept(r_del);
  perform pg_temp.as_user(u_cg, true, p_old);
  rep := rep || pg_temp.chk(public.my_home() -> 'person' ->> 'name' = 'Idoso S34', 'depois do aceite o cuidador vê o Início do idoso (agenda)');
  rep := rep || pg_temp.chk(public.my_home() -> 'plan' is null or public.my_home() -> 'plan' = 'null'::jsonb, 'cuidador sem escopo de evolução não vê plano nem dor');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_journey()') like '42501%', 'cuidador não abre a jornada (evolução) — 42501');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_renewal_request(''contato'', null)') like '42501%', 'cuidador não pede renovação (cobrança) — 42501');
  rep := rep || pg_temp.chk(pg_temp.err('select public.consent_set(''saude'', true, ''v0-minuta'')') like '42501%', 'cuidador não consente — 42501');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.my_appointment_cancel(%L, null)', (select id from public.appointments where person_id = p_old limit 1))) like '42501%', 'cuidador sem escopo não cancela atendimento — 42501');
  perform pg_temp.as_user(u_mae, true, p_old);   -- a mãe é "delegado" do idoso (evolução, cancelar, treino, chamado; sem cobrança nem consentimento)
  rep := rep || pg_temp.chk(jsonb_array_length(public.my_journey() -> 'goals') >= 0, 'delegado com escopo de evolução abre a jornada do idoso');
  rep := rep || pg_temp.chk(pg_temp.err('select public.consent_set(''saude'', true, ''v0-minuta'')') like '42501%', 'delegado também não consente — 42501');
  perform pg_temp.as_user(u_old, true);
  j := public.my_representatives();
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 3 and not exists (select 1 from jsonb_array_elements(j) x where not (x ->> 'can_revoke')::boolean), 'o idoso lista quem tem acesso aos dados dele (cuidadora, delegada e a pessoa criada no teste) e pode revogar');
  perform pg_temp.as_user(u_old, false);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_revoke(%L, ''teste'')', r_cg)) like 'P0001%reautentica%', 'o idoso revoga delegação só com senha recente');
  perform pg_temp.as_user(u_old, true);
  perform public.representation_revoke(r_cg, 'não preciso mais');
  perform pg_temp.as_user(u_cg, true, p_old);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'revogado: o cuidador perde o acesso na hora');
  perform pg_temp.as_user(u_old, true);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_revoke(%L, ''x'')', r_pai)) like '42501%', 'quem não é admin nem titular do vínculo não revoga (42501)');
  perform pg_temp.as_user(u_pai, true);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.representation_revoke(%L, ''x'')', r_mae)) like '42501%', 'um responsável não revoga o outro (só o admin)');

  -- ============ 5) menor de idade
  perform pg_temp.as_user(u_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'criança de 8 anos com login: bloqueada (o responsável deve acessar)');
  perform pg_temp.as_user(u_teen);
  rep := rep || pg_temp.chk(public.my_home() -> 'person' ->> 'name' = 'Adolescente S34', 'adolescente de 14 com autorização do responsável usa o Início');
  rep := rep || pg_temp.chk(pg_temp.err('select public.consent_set(''saude'', true, ''v0-minuta'')') like '42501%reservada%', 'adolescente não consente (reservado ao responsável)');
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_renewal_request(''contato'', null)') like '42501%reservada%', 'adolescente não faz pedido de renovação/cobrança');
  perform pg_temp.as_user(u_um);
  perform public.representation_save(r_teen, p_teen, p_mae, 'responsavel_legal', null, null, false);   -- o responsável retira a autorização do login
  perform pg_temp.as_user(u_teen);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%autoriza%', 'sem a autorização do responsável o adolescente é bloqueado');
  -- maioridade: aos 18 anos o vínculo de responsável legal deixa de valer sozinho (derivado da data de nascimento)
  perform pg_temp.as_user(u_mae, true, p_teen);
  rep := rep || pg_temp.chk(public.my_home() -> 'person' ->> 'name' = 'Adolescente S34', 'antes dos 18 a mãe age pelo adolescente');
  reset role; update public.people set birth_date = current_date - interval '18 years' where id = p_teen; set local role authenticated;
  perform pg_temp.as_user(u_mae, true, p_teen);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'aos 18 anos o acesso do responsável legal cessa sozinho (sem ação de ninguém)');
  perform pg_temp.as_user(u_teen);
  rep := rep || pg_temp.chk(public.my_home() -> 'person' ->> 'name' = 'Adolescente S34', 'aos 18 anos a pessoa passa a agir por si');

  -- ============ 6) suspensão (disputa)
  perform pg_temp.as_user(u_ops);
  rep := rep || pg_temp.chk(public.representation_suspend_patient(p_kid, 'pais em desacordo — aguardando decisão') = 2, 'disputa suspende todos os vínculos ativos do paciente (2)');
  perform pg_temp.as_user(u_mae, true, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'suspenso: a mãe não age pela criança');
  perform pg_temp.as_user(u_pai, true, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'suspenso: o pai também não');
  perform pg_temp.as_user(u_ops);
  perform public.representation_unsuspend(r_mae);
  perform pg_temp.as_user(u_mae, true, p_kid);
  rep := rep || pg_temp.chk(public.my_home() -> 'person' ->> 'name' = 'Criança S34', 'admin reativa só quem decidiu (a mãe volta)');
  perform pg_temp.as_user(u_pai, true, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_home()') like '42501%', 'o pai segue suspenso');

  -- ============ 7) consentimentos
  perform pg_temp.as_user(u_mae, false, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.consent_set(''comunicacao_comercial'', true, ''v0-minuta'')') like 'P0001%reautentica%', 'consentir sem senha recente exige reautenticação');
  perform pg_temp.as_user(u_mae, true, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.consent_set(''saude'', true, ''versao-que-nao-existe'')') like '%texto de consentimento inexistente%', 'versão de texto inexistente é recusada');
  perform public.consent_set('saude', true, 'v0-minuta');
  reset role; select count(*) into n from public.consents where person_id = p_kid and kind = 'saude' and granted and in_name_of and given_by_person = p_mae and text_snapshot like 'MINUTA%'; rep := rep || pg_temp.chk(n = 1, 'consentimento da criança fica registrado “em nome de”, por quem, com a versão e o texto'); set local role authenticated;
  j := public.my_consents();
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(j) x where x ->> 'kind' = 'saude' and (x ->> 'granted')::boolean) and exists (select 1 from jsonb_array_elements(j) x where x ->> 'kind' = 'comunicacao_comercial' and not (x ->> 'granted')::boolean), 'saúde concedido; comercial segue não concedido');
  reset role; rep := rep || pg_temp.chk(not private.has_consent(p_kid, 'comunicacao_comercial') and private.has_consent(p_kid, 'saude'), 'has_consent: sem consentimento comercial não há oferta'); set local role authenticated;
  perform pg_temp.as_user(u_mae, true, p_kid); perform public.consent_set('saude', false, 'v0-minuta');
  reset role; rep := rep || pg_temp.chk(not private.has_consent(p_kid, 'saude'), 'revogar vale: o último registro decide'); set local role authenticated;
  perform pg_temp.as_user(u_out, true, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_consents()') like '42501%', 'estranho não lê os consentimentos da criança');

  -- ============ 8) leitura clínica do admin: só o gestor, sempre registrada
  perform pg_temp.as_user(u_mgr);
  j := public.admin_patient_journey(p_kid);
  rep := rep || pg_temp.chk(jsonb_array_length(j -> 'goals') = 1, 'gestor (dono) lê a jornada clínica pelo caminho registrado');
  perform public.admin_patient_journey(p_kid);
  reset role; select count(*) into n from public.clinical_access_log where person_id = p_kid and accessed_by = u_mgr and accessed_by_role = 'admin'; rep := rep || pg_temp.chk(n = 1, 'acesso do admin registrado (duas leituras em 10 min contam uma)'); set local role authenticated;
  rep := rep || pg_temp.chk((select count(*) from public.patient_goals where person_id = p_kid) = 0, 'o gestor continua sem ler as TABELAS clínicas diretamente (só pela função registrada)');
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.clinical_access_log') like '42501%', 'ninguém lê o registro de acesso direto na tabela');
  foreach e in array array['ops','um','sales'] loop
    perform pg_temp.as_user(case e when 'ops' then u_ops when 'um' then u_um else u_sales end);
    rep := rep || pg_temp.chk(pg_temp.err(format('select public.admin_patient_journey(%L)', p_kid)) like '42501%', format('%s NÃO lê dado clínico (42501)', e));
  end loop;
  perform pg_temp.as_user(u_phy);
  perform public.professional_journey(p_kid);
  reset role; select count(*) into n from public.clinical_access_log where person_id = p_kid and accessed_by = u_phy and accessed_by_role = 'professional'; rep := rep || pg_temp.chk(n = 1, 'a leitura do fisioterapeuta vinculado também é registrada'); set local role authenticated;
  perform pg_temp.as_user(u_mae, true, p_kid);
  j := public.my_access_log();
  rep := rep || pg_temp.chk(jsonb_array_length(j) = 2 and exists (select 1 from jsonb_array_elements(j) x where x ->> 'role' = 'admin') and exists (select 1 from jsonb_array_elements(j) x where x ->> 'role' = 'professional'), 'a mãe vê “quem acessou o prontuário” da criança (admin e fisio)');
  perform pg_temp.as_user(u_out, true, p_kid);
  rep := rep || pg_temp.chk(pg_temp.err('select public.my_access_log()') like '42501%', 'estranho não vê o registro de acessos');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk(jsonb_array_length(public.clinical_access_report(p_kid)) = 2, 'o gestor tem o relatório de acessos do paciente');

  -- ============ 9) lista do admin e anônimo
  perform pg_temp.as_user(u_um);
  rep := rep || pg_temp.chk(jsonb_array_length(public.representations_admin_list()) >= 5, 'gestor de unidade lista os vínculos da unidade');
  perform pg_temp.as_user(u_sales);
  rep := rep || pg_temp.chk(pg_temp.err('select public.representations_admin_list()') like '42501%', 'comercial não lista vínculos');
  set local role anon;
  foreach e in array array['my_home()','my_representations()','my_consents()','my_access_log()','consent_texts_current()'] loop
    rep := rep || pg_temp.chk(pg_temp.err('select public.' || e) like '42501%', format('anônimo não executa %s', e));
  end loop;
  raise exception 'RELATORIO_S34%', rep;
end $$;
