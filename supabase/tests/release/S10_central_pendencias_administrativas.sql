-- RELEASE v1 — S10: central de pendências administrativas (Administrativo). Cobre a migration 062. Transação sempre desfeita. Somente Dev/teste.
-- Unidade NOVA (uz) isola os números; uy = outra unidade; uw = unidade vazia (ausência de dados). Datas relativas a hoje (limites de vencimento testados nas pontas).
--   PF (uz): p1 completa · p2 incompleta · p3 paciente completa · p4 paciente incompleta (sem cidade) · p5 completa (contato igual ao de p1) · p6 e p7 incompletas (mesmo nome e nascimento)
--            p8 completa com e-mail de formato inválido → 8 PF, 4 completas. PJ: e1 completa, e2 incompleta → 10 cadastros, 5 completos (50,0%), 5 incompletos.
--   Documentos (mais recente de cada tipo): p1 +10d · p5 +30d · p7 hoje (vencendo) · p6 +31d · p3 renovado +300d (o antigo −100d NÃO conta) (vigentes) · p4 −1d · e1 −5d (vencidos) · p8 sem validade.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
do $$
declare
  v_org uuid; uz uuid; uy uuid; uw uuid;
  u_mgr uuid := gen_random_uuid(); u_umz uuid := gen_random_uuid(); u_umy uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_pac uuid := gen_random_uuid();
  u_susp uuid := gen_random_uuid(); u_exp uuid := gen_random_uuid(); u_pr2 uuid := gen_random_uuid();
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid; p8 uuid; e1 uuid; e2 uuid;
  dt_pf uuid; dt_pj uuid; svc uuid; prod uuid; pkg3 uuid; pkg4 uuid; pkg5 uuid; pr1 uuid; pr2 uuid; pr3 uuid; ctc uuid; req uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; pa uuid; pb uuid; pc uuid; pd uuid; ph jsonb;
  j jsonb; j2 jsonb; d jsonb; n bigint; n2 bigint; ok boolean; rep text := ''; k text; xx jsonb; oldn bigint;
  p_from timestamptz := now() - interval '1 day'; p_to timestamptz := now() + interval '1 day';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Z (teste S10)', 'teste-z-s10') returning id into uz;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Y (teste S10)', 'teste-y-s10') returning id into uy;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade W vazia (teste S10)', 'teste-w-s10') returning id into uw;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s10.local'),(u_umz,'authenticated','authenticated','umz@s10.local'),(u_umy,'authenticated','authenticated','umy@s10.local'),
    (u_phy,'authenticated','authenticated','phy@s10.local'),(u_sales,'authenticated','authenticated','s@s10.local'),(u_pac,'authenticated','authenticated','pac@s10.local'),
    (u_susp,'authenticated','authenticated','susp@s10.local'),(u_exp,'authenticated','authenticated','exp@s10.local'),(u_pr2,'authenticated','authenticated','pr2@s10.local');
  insert into public.user_accounts (user_id, org_id, person_id, status) values (u_mgr, v_org, null, 'active'),(u_umz, v_org, null, 'active'),(u_umy, v_org, null, 'active'),(u_phy, v_org, null, 'active'),
    (u_sales, v_org, null, 'active'),(u_pac, v_org, null, 'active'),(u_susp, v_org, null, 'suspended'),(u_exp, v_org, null, 'active'),(u_pr2, v_org, null, 'active');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_umz, 'unit_manager', uz),(v_org, u_umy, 'unit_manager', uy),(v_org, u_phy, 'physio', uz),
    (v_org, u_sales, 'sales', uz),(v_org, u_pac, 'member', null),(v_org, u_susp, 'physio', uz);
  insert into public.role_assignments (org_id, user_id, role, unit_id, valid_until) values (v_org, u_exp, 'sales', uz, now() + interval '10 days');

  -- ---------------- cadastros
  insert into public.people (org_id, unit_id, full_name, document_number, city, state_uf, internal_owner_user_id) values (v_org, uz, 'Completa A S10', '52998224725', 'São Paulo', 'SP', u_umz) returning id into p1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Incompleta B S10') returning id into p2;
  insert into public.people (org_id, unit_id, full_name, document_number, city, state_uf) values (v_org, uz, 'Paciente C S10', '39053344705', 'São Paulo', 'SP') returning id into p3;
  insert into public.people (org_id, unit_id, full_name, document_number, state_uf) values (v_org, uz, 'Paciente D S10', '15350946056', 'SP') returning id into p4;
  insert into public.people (org_id, unit_id, full_name, document_number, city, state_uf) values (v_org, uz, 'Duplicada de A S10', '11144477735', 'Santos', 'SP') returning id into p5;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, uz, 'Mesmo Nome S10', '1990-01-01') returning id into p6;
  insert into public.people (org_id, unit_id, full_name, birth_date) values (v_org, uz, 'Mesmo Nome S10', '1990-01-01') returning id into p7;
  insert into public.people (org_id, unit_id, full_name, document_number, city, state_uf) values (v_org, uz, 'Formato Invalido S10', '12345678909', 'Campinas', 'SP') returning id into p8;
  insert into public.person_kinds (person_id, kind) values (p3, 'patient'),(p4, 'patient');
  insert into public.person_contacts (org_id, person_id, type, value, normalized) values
    (v_org, p1, 'email', 'a@s10.local', 'a@s10.local'), (v_org, p3, 'phone', '11999998888', '11999998888'), (v_org, p4, 'phone', '11988887777', '11988887777'), (v_org, p5, 'email', 'a@s10.local', 'a@s10.local'), (v_org, p8, 'email', 'invalido-sem-arroba', 'invalido-sem-arroba');
  insert into public.legal_entities (org_id, legal_name, cnpj, city, state_uf, email_general) values (v_org, 'Empresa Completa S10', '11222333000181', 'São Paulo', 'SP', 'contato@empresa-s10.local') returning id into e1;
  insert into public.legal_entities (org_id, legal_name) values (v_org, 'Empresa Incompleta S10') returning id into e2;
  insert into public.legal_entity_units (legal_entity_id, unit_id) values (e1, uz),(e2, uz);

  -- ---------------- tipos de documento e documentos
  insert into public.adm_doc_types (org_id, code, label, applies_to, has_expiry) values (v_org, 'crm_s10', 'Registro teste S10', 'pf', true) returning id into dt_pf;
  insert into public.adm_doc_types (org_id, code, label, applies_to, has_expiry) values (v_org, 'cnd_s10', 'Certidão teste S10', 'pj', true) returning id into dt_pj;
  insert into public.person_documents (org_id, person_id, doc_type_id, title, expires_on) values
    (v_org, p1, dt_pf, 'Doc p1', current_date + 10), (v_org, p5, dt_pf, 'Doc p5', current_date + 30), (v_org, p7, dt_pf, 'Doc p7', current_date), (v_org, p6, dt_pf, 'Doc p6', current_date + 31),
    (v_org, p3, dt_pf, 'Doc p3 antigo', current_date - 100), (v_org, p3, dt_pf, 'Doc p3 renovado', current_date + 300), (v_org, p4, dt_pf, 'Doc p4', current_date - 1), (v_org, p8, dt_pf, 'Doc p8 sem validade', null);
  insert into public.legal_entity_documents (legal_entity_id, kind, title, doc_type_id, expires_on) values (e1, 'cnd_s10', 'Certidão e1', dt_pj, current_date - 5);

  -- ---------------- profissionais, agenda, pacotes, solicitações, convites
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão S10', 50) returning id into svc;
  insert into public.products (org_id, kind, name, sessions_count, service_id) values (v_org, 'package', 'Pacote S10', 4, svc) returning id into prod;
  insert into public.professionals (org_id, user_id, display_name, council_registration) values (v_org, u_phy, 'Fisio Completa S10', 'CREFITO-3/123456') returning id into pr1;
  insert into public.professional_units values (pr1, uz);
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time) values (v_org, pr1, uz, 1, '08:00', '18:00');
  insert into public.professionals (org_id, display_name) values (v_org, 'Fisio Incompleta S10') returning id into pr2;
  insert into public.professional_units values (pr2, uz);
  insert into public.professionals (org_id, display_name, active) values (v_org, 'Fisio Inativa S10', false) returning id into pr3;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, uz, p3, prod, 4) returning id into pkg3;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, uz, p4, prod, 4) returning id into pkg4;
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values (v_org, uz, p5, prod, 4) returning id into pkg5;
  insert into public.session_ledger (org_id, client_package_id, delta, reason) values (v_org, pkg3, 4, 'grant'),(v_org, pkg3, -2, 'adjust'),   -- saldo 2 → próximo do fim, sem atendimento futuro
    (v_org, pkg4, 4, 'grant'),(v_org, pkg4, -3, 'adjust'),                                                                                   -- saldo 1, MAS com atendimento futuro agendado → fora
    (v_org, pkg5, 4, 'grant'),(v_org, pkg5, -1, 'adjust');                                                                                   -- saldo 3 → acima do limite (2) → fora
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status)
    values (v_org, uz, pr1, p4, svc, tstzrange(now() + interval '2 days', now() + interval '2 days 50 minutes'), 'scheduled');
  insert into public.waitlist (org_id, unit_id, person_id, service_id, status, created_at) values
    (v_org, uz, p3, svc, 'waiting', now() - interval '10 days'), (v_org, uz, p4, svc, 'offered', now() - interval '2 days'), (v_org, uz, p1, svc, 'waiting', now() - interval '7 days'),
    (v_org, uz, p5, svc, 'scheduled', now() - interval '30 days'), (v_org, uz, p2, svc, 'cancelled', now() - interval '30 days');
  insert into public.invitations (org_id, email, role, unit_id, expires_at) values (v_org, 'pendente@s10.local', 'physio', uz, now() + interval '5 days'), (v_org, 'expirado@s10.local', 'physio', uz, now() - interval '1 day');
  insert into public.invitations (org_id, email, role, unit_id, expires_at, accepted_at) values (v_org, 'aceito@s10.local', 'physio', uz, now() + interval '5 days', now());
  -- dado clínico que NUNCA pode aparecer no Administrativo
  insert into public.patient_goals (org_id, unit_id, person_id, title) values (v_org, uz, p3, 'OBJETIVO-CLINICO-SIGILOSO-S10');

  -- ============================================================ 1) cartões prioritários e reconciliação com as listas
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j #>> '{cards,incomplete,value}')::int = 5, format('cadastros incompletos = 5 (PF p2,p4,p6,p7 + PJ e2) (obtido %s)', j #>> '{cards,incomplete,value}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,completeness,value}')::numeric = 50.0 and (j #>> '{kpis,completeness,complete}')::int = 5 and (j #>> '{kpis,completeness,total}')::int = 10, format('percentual de cadastros completos = 5/10 = 50,0%% (obtido %s)', j #>> '{kpis,completeness,value}'));
  rep := rep || pg_temp.chk((j #>> '{cards,docs_expiring,value}')::int = 3, format('documentos vencendo em 30 dias = 3: +10d, +30d (limite) e hoje; +31d NÃO entra (obtido %s)', j #>> '{cards,docs_expiring,value}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,documents,expired}')::int = 2 and (j #>> '{kpis,documents,no_expiry_date}')::int = 1, format('vencidos = 2 (ontem e −5d); sem validade informada = 1, contado à parte (obtido %s / %s)', j #>> '{kpis,documents,expired}', j #>> '{kpis,documents,no_expiry_date}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,documents,registered}')::int = 8, format('8 documentos vigentes por cadastro/tipo: o antigo vencido de p3 NÃO conta porque foi renovado (obtido %s)', j #>> '{kpis,documents,registered}'));
  rep := rep || pg_temp.chk((j #>> '{cards,patients_waiting,value}')::int = 3, format('pacientes aguardando agendamento = 3 (solicitações em aberto; as agendada/cancelada e quem só está sem consulta NÃO contam) (obtido %s)', j #>> '{cards,patients_waiting,value}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,waiting,n}')::int = 3 and (j #>> '{kpis,waiting,avg_days}')::numeric = 6.3 and (j #>> '{kpis,waiting,median_days}')::numeric = 7.0 and (j #>> '{kpis,waiting,max_days}')::numeric = 10.0 and (j #>> '{kpis,waiting,over_alert}')::int = 2,
    format('tempo de espera: média 6,3 · mediana 7,0 · máximo 10,0 · acima do alerta de 7 dias = 2 (limite de 7 dias inclusivo) (obtido %s/%s/%s/%s)', j #>> '{kpis,waiting,avg_days}', j #>> '{kpis,waiting,median_days}', j #>> '{kpis,waiting,max_days}', j #>> '{kpis,waiting,over_alert}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,packages,n}')::int = 1, format('pacotes perto do fim sem próximo atendimento = 1 (saldo 2 sem consulta); saldo 1 COM consulta futura e saldo 3 ficam de fora (obtido %s)', j #>> '{kpis,packages,n}'));
  rep := rep || pg_temp.chk((j #>> '{cards,professionals_incomplete,value}')::int = 1 and (j #>> '{kpis,professionals,active}')::int = 2 and (j #>> '{kpis,professionals,ready}')::int = 1 and (j #>> '{kpis,professionals,ready_pct}')::numeric = 50.0,
    format('profissionais: 2 ativos (a inativa não conta), 1 apta, 1 incompleta, 50,0%% aptos (obtido %s/%s/%s)', j #>> '{cards,professionals_incomplete,value}', j #>> '{kpis,professionals,active}', j #>> '{kpis,professionals,ready}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,access,invitations_pending}')::int = 1 and (j #>> '{kpis,access,invitations_expired}')::int = 1 and (j #>> '{kpis,access,review}')::int = 2,
    format('convites: 1 pendente e 1 expirado, separados (o aceito não conta); acessos a revisar = 2 (conta suspensa + papel que expira em 10 dias) (obtido %s/%s/%s)', j #>> '{kpis,access,invitations_pending}', j #>> '{kpis,access,invitations_expired}', j #>> '{kpis,access,review}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,duplicates,groups}')::int = 2 and (j #>> '{kpis,duplicates,people}')::int = 4, format('possíveis duplicidades = 2 grupos (mesmo contato p1/p5; mesmo nome e nascimento p6/p7), 4 cadastros, sem mesclar nada (obtido %s/%s)', j #>> '{kpis,duplicates,groups}', j #>> '{kpis,duplicates,people}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,contacts,total}')::int = 5 and (j #>> '{kpis,contacts,valid_format}')::int = 4 and (j #>> '{kpis,contacts,invalid_format}')::int = 1 and (j #>> '{kpis,contacts,valid_pct}')::numeric = 80.0,
    format('contatos: 5, formato válido 4 (80,0%%), inválido 1 (obtido %s/%s)', j #>> '{kpis,contacts,total}', j #>> '{kpis,contacts,valid_format}'));
  rep := rep || pg_temp.chk(not (j #>> '{kpis,contacts,verified_available}')::boolean and j #> '{kpis,contacts,verified_pct}' = 'null'::jsonb and (j #>> '{kpis,contacts,basis_verified}') like 'indisponível%',
    'contatos VERIFICADOS separados dos válidos: sem nenhuma verificação registrada o indicador é indisponível com o motivo (não vira 0% nem é inferido do formato)');
  rep := rep || pg_temp.chk((j #>> '{kpis,onboarding,available}')::boolean is false and (j #>> '{kpis,onboarding,basis}') like '%não há data histórica%', 'tempo de integração sem medição: indisponível, com o motivo (não inventa data histórica)');
  rep := rep || pg_temp.chk((j #>> '{kpis,resolution,available}')::boolean is false, 'tempo de resolução sem pendências concluídas: indisponível, com o motivo');
  -- cada cartão abre exatamente os registros do seu número
  for k, n in select * from (values ('incomplete', 5), ('docs_expiring', 3), ('patients_waiting', 3), ('professionals_incomplete', 1), ('packages_ending', 1)) v(a, b) loop
    d := public.adm_central_detail(k, null, p_from, p_to, uz);
    rep := rep || pg_temp.chk((d ->> 'total_items')::int = n and jsonb_array_length(d -> 'items') = n, format('lista de "%s" reconcilia com o cartão (total %s, itens %s)', k, d ->> 'total_items', jsonb_array_length(d -> 'items')));
  end loop;
  d := public.adm_central_detail('docs_expired', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 2, 'lista de documentos vencidos = 2');
  d := public.adm_central_detail('docs_no_expiry', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 1, 'lista de documentos sem validade = 1');
  d := public.adm_central_detail('invitations_pending', null, p_from, p_to, uz); n := (d ->> 'total_items')::int; d := public.adm_central_detail('invitations_expired', null, p_from, p_to, uz);
  rep := rep || pg_temp.chk(n = 1 and (d ->> 'total_items')::int = 1, 'listas de convites pendentes (1) e expirados (1) reconciliam');
  d := public.adm_central_detail('access_review', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 2, 'lista de acessos a revisar = 2');
  d := public.adm_central_detail('duplicates', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 2 and jsonb_array_length(d -> 'items') = 4, 'lista de duplicidades: 2 grupos e 4 cadastros para revisar');
  d := public.adm_central_detail('contacts_invalid', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 1 and (d -> 'items' -> 0 ->> 'subtitle') not like '%invalido-sem-arroba%' and (d -> 'items' -> 0 ->> 'subtitle') like '%•%', 'lista de contatos inválidos = 1 e o contato aparece mascarado (nunca inteiro)');
  d := public.adm_central_detail('incomplete_group', 'pf', p_from, p_to, uz); n := (d ->> 'total_items')::int;
  d := public.adm_central_detail('incomplete_group', 'pj', p_from, p_to, uz); n2 := (d ->> 'total_items')::int;
  rep := rep || pg_temp.chk(n = 4 and n2 = 1, format('incompletos por grupo: PF = 4 e PJ = 1 (obtido %s/%s)', n, n2));
  d := public.adm_central_detail('incomplete_group', 'patient', p_from, p_to, uz); n := (d ->> 'total_items')::int;
  select (x ->> 'total')::int, (x ->> 'complete')::int into n2, oldn from jsonb_array_elements(j #> '{kpis,completeness_groups}') x where x ->> 'key' = 'patient';
  rep := rep || pg_temp.chk(n = 1 and n2 = 2 and oldn = 1, format('vínculo paciente: 2 cadastros, 1 completo, 1 incompleto (p4) e a lista traz 1 (obtido %s/%s/%s)', n2, oldn, n));
  d := public.adm_central_detail('incomplete', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d -> 'items' -> 0 ->> 'subtitle') like '%falta:%', 'cada cadastro incompleto diz o que falta');
  ok := false; begin perform public.adm_central_detail('nao_existe', null, p_from, p_to, uz); exception when others then ok := sqlerrm like '%desconhecido%'; end;
  rep := rep || pg_temp.chk(ok, 'indicador desconhecido é recusado');

  -- limites de vencimento configuráveis: com janela de 45 dias, o documento de +31 dias passa a vencer
  perform public.adm_settings_save(45, 2, 7, '{}'::jsonb);
  j2 := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j2 #>> '{cards,docs_expiring,value}')::int = 4 and (j2 #>> '{settings,expiring_days}')::int = 45, format('janela de vencimento configurável: com 45 dias, +31d passa a vencer (4) (obtido %s)', j2 #>> '{cards,docs_expiring,value}'));
  perform public.adm_settings_save(30, 3, 7, '{}'::jsonb);
  j2 := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j2 #>> '{kpis,packages,n}')::int = 2, format('limite de pacote configurável: com saldo ≤ 3 entram o de saldo 2 e o de saldo 3 (2) (obtido %s)', j2 #>> '{kpis,packages,n}'));
  perform public.adm_settings_save(30, 2, 7, '{}'::jsonb);
  ok := false; begin perform public.adm_settings_save(0, 2, 7, '{}'::jsonb); exception when others then ok := sqlerrm like '%fora dos limites%'; end;
  rep := rep || pg_temp.chk(ok, 'configuração fora dos limites é recusada');
  ok := false; begin perform public.adm_settings_save(30, 2, 7, '{"documento": 0}'::jsonb); exception when others then ok := sqlerrm like '%prazo inválido%'; end;
  rep := rep || pg_temp.chk(ok, 'prazo padrão inválido é recusado');

  -- desativar requisito muda a conta
  select (x ->> 'id')::uuid into req from jsonb_array_elements(public.adm_config_get() -> 'requirements') x where x ->> 'applies_to' = 'pf' and x ->> 'check_ref' = 'city' and x ->> 'check_type' = 'field'; perform public.adm_requirement_save(req, 'pf', 'field', 'city', 'Cidade', true, false);
  j2 := public.adm_central(p_from, p_to, uz); rep := rep || pg_temp.chk((j2 #>> '{cards,incomplete,value}')::int = 4, format('requisito desativado (cidade) deixa de pesar: p4 passa a completa, incompletos 5 → 4 (obtido %s)', j2 #>> '{cards,incomplete,value}'));
  perform public.adm_requirement_save(req, 'pf', 'field', 'city', 'Cidade', true, true);
  -- ============================================================ 2) requisitos configuráveis por tipo/vínculo, documentos ausentes
  perform public.adm_requirement_save(null, 'patient', 'document', 'crm_s10', 'Registro teste S10 (paciente)', true, true);
  insert into public.person_kinds (person_id, kind) values (p2, 'patient');
  j2 := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j2 #>> '{kpis,documents,missing}')::int = 1 and (j2 #>> '{kpis,documents,requirements_configured}')::boolean, format('documento exigido por vínculo: p2 (paciente sem o documento) está ausente = 1 (obtido %s)', j2 #>> '{kpis,documents,missing}'));
  select (x ->> 'total')::int, (x ->> 'complete')::int into n2, oldn from jsonb_array_elements(j2 #> '{kpis,completeness_groups}') x where x ->> 'key' = 'patient';
  rep := rep || pg_temp.chk(n2 = 3 and oldn = 1, format('vínculo paciente agora tem 3 cadastros e só p3 completo (p4 tem documento vencido, p2 não tem) (obtido %s/%s)', n2, oldn));
  d := public.adm_central_detail('docs_missing', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 1 and (d -> 'items' -> 0 ->> 'subtitle') like '%Registro teste S10%', 'lista de documentos ausentes reconcilia e diz qual documento falta');
  ok := false; begin perform public.adm_requirement_save(null, 'patient', 'field', 'campo_que_nao_existe', 'x', true, true); exception when others then ok := sqlerrm like '%referência inválida%'; end;
  rep := rep || pg_temp.chk(ok, 'requisito com referência inexistente é recusado');
  ok := false; begin perform public.adm_requirement_save(null, 'patient', 'document', 'crm_s10', 'duplicado', true, true); exception when others then ok := sqlerrm like '%já existe%'; end;
  rep := rep || pg_temp.chk(ok, 'requisito duplicado é recusado');

  -- ============================================================ 3) contratos administrativos (assinatura registrada manualmente)
  c1 := public.adm_contract_create('prestacao_servico', 'Contrato c1 S10', 'person', p1, u_umz, current_date, current_date + 365);
  perform public.adm_contract_send(c1, current_date - 1);                                                                                     -- prazo de assinatura já vencido
  c2 := public.adm_contract_create('parceria', 'Contrato c2 S10', 'legal_entity', e1, u_umz);
  c3 := public.adm_contract_create('termo_uso', 'Contrato c3 S10', 'person', p3, u_umz, current_date - 30, current_date + 10); perform public.adm_contract_send(c3); perform public.adm_contract_sign(c3, current_date - 1);
  c4 := public.adm_contract_create('termo_uso', 'Contrato c4 S10', 'person', p4, u_umz, current_date - 60, current_date - 3); perform public.adm_contract_send(c4); perform public.adm_contract_sign(c4, current_date - 2);
  c5 := public.adm_contract_create('termo_uso', 'Contrato c5 S10', 'person', p5, u_umz, current_date - 1, current_date + 200); perform public.adm_contract_send(c5); perform public.adm_contract_sign(c5, current_date);
  c6 := public.adm_contract_create('outro', 'Contrato c6 S10', 'person', p6, u_umz); perform public.adm_contract_cancel(c6, 'desistência');
  j2 := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j2 #>> '{cards,contracts_awaiting,value}')::int = 1, format('contratos aguardando assinatura = 1 (c1) (obtido %s)', j2 #>> '{cards,contracts_awaiting,value}'));
  rep := rep || pg_temp.chk((j2 #>> '{kpis,contracts,by_status,draft}')::int = 1 and (j2 #>> '{kpis,contracts,by_status,awaiting_signature}')::int = 1 and (j2 #>> '{kpis,contracts,by_status,signed}')::int = 3 and (j2 #>> '{kpis,contracts,by_status,cancelled}')::int = 1,
    'contratos por situação: 1 rascunho · 1 aguardando · 3 assinados · 1 cancelado');
  rep := rep || pg_temp.chk((j2 #>> '{kpis,contracts,ending}')::int = 1 and (j2 #>> '{kpis,contracts,expired}')::int = 1 and (j2 #>> '{kpis,contracts,signed_current}')::int = 1 and (j2 #>> '{kpis,contracts,awaiting_overdue}')::int = 1,
    format('vencimento: 1 a vencer em 10 dias · 1 vencido há 3 dias · 1 vigente · 1 aguardando com prazo de assinatura vencido (obtido %s/%s/%s/%s)', j2 #>> '{kpis,contracts,ending}', j2 #>> '{kpis,contracts,expired}', j2 #>> '{kpis,contracts,signed_current}', j2 #>> '{kpis,contracts,awaiting_overdue}'));
  d := public.adm_central_detail('contracts_awaiting', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 1, 'lista de contratos aguardando assinatura reconcilia');
  d := public.adm_central_detail('contracts_status', 'signed', p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 3, 'lista de contratos assinados = 3');
  d := public.adm_central_detail('contracts_ending', null, p_from, p_to, uz); n := (d ->> 'total_items')::int; d := public.adm_central_detail('contracts_expired', null, p_from, p_to, uz);
  rep := rep || pg_temp.chk(n = 1 and (d ->> 'total_items')::int = 1, 'listas de contratos a vencer (1) e vencidos (1) reconciliam');
  ok := false; begin perform public.adm_contract_sign(c2, current_date); exception when others then ok := sqlerrm like '%aguardando assinatura%'; end;
  rep := rep || pg_temp.chk(ok, 'não se registra assinatura de contrato que não foi enviado para assinatura');
  ok := false; begin perform public.adm_contract_sign(c1, current_date + 1); exception when others then ok := sqlerrm like '%futura%'; end;
  rep := rep || pg_temp.chk(ok, 'data de assinatura futura é recusada');
  ok := false; begin perform public.adm_contract_send(c3); exception when others then ok := sqlerrm like '%rascunho%'; end;
  rep := rep || pg_temp.chk(ok, 'contrato já assinado não pode ser reenviado');
  select count(*) into n from jsonb_array_elements(public.adm_contract_history(c3)) e where e ->> 'action' in ('created','sent','signed');
  rep := rep || pg_temp.chk(n = 3, 'histórico do contrato registra criação, envio e assinatura com o autor');
  -- contrato assinado atende requisito de contrato
  perform public.adm_requirement_save(null, 'patient', 'contract', 'termo_uso', 'Termo de uso assinado', true, true);
  j2 := public.adm_central(p_from, p_to, uz);
  select (x ->> 'complete')::int into oldn from jsonb_array_elements(j2 #> '{kpis,completeness_groups}') x where x ->> 'key' = 'patient';
  rep := rep || pg_temp.chk(oldn = 1, format('requisito de contrato: contrato assinado e vigente atende (p3); vencido (p4) e ausente (p2) não atendem — 1 completo entre os 3 pacientes (obtido %s)', oldn));
  select (x ->> 'id')::uuid into req from jsonb_array_elements(public.adm_config_get() -> 'requirements') x where x ->> 'applies_to' = 'patient' and x ->> 'check_ref' = 'termo_uso' and x ->> 'check_type' = 'contract'; perform public.adm_requirement_delete(req);
  select (x ->> 'id')::uuid into req from jsonb_array_elements(public.adm_config_get() -> 'requirements') x where x ->> 'applies_to' = 'patient' and x ->> 'check_ref' = 'crm_s10' and x ->> 'check_type' = 'document'; perform public.adm_requirement_delete(req);

  -- ============================================================ 4) pendências: criar, atribuir, resolver, reabrir, cancelar; histórico; tempo de resolução
  perform set_config('request.jwt.claims', json_build_object('sub', u_umz, 'role','authenticated')::text, true);
  pa := public.adm_pendency_create('documento', 'Renovar documento de p1', 'pedir a renovação', 'person', p1, null, u_umz, current_date - 1);
  pb := public.adm_pendency_create('cadastro', 'Completar cadastro de p2', null, 'person', p2, null, null, current_date + 5);
  pc := public.adm_pendency_create('outro', 'Pendência avulsa', null, null, null, uz, u_sales, null);
  j := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j #>> '{cards,overdue_pendencies,value}')::int = 1 and (j #>> '{kpis,pendencies,open}')::int = 3, format('pendências: 3 abertas, 1 vencida (prazo de ontem) (obtido %s/%s)', j #>> '{kpis,pendencies,open}', j #>> '{cards,overdue_pendencies,value}'));
  select x into ph from jsonb_array_elements(public.adm_pendency_list(uz, null, null, null, null, 50)) x where (x ->> 'id')::uuid = pc;
  rep := rep || pg_temp.chk((ph ->> 'due_date')::date = current_date + 7 and (ph ->> 'unit_id')::uuid = uz, 'sem prazo informado, vale o prazo padrão configurado (7 dias) e a unidade vem do contexto');
  d := public.adm_central_detail('overdue_pendencies', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 1 and (d -> 'items' -> 0 ->> 'tag') like 'atrasada%', 'lista de pendências vencidas reconcilia com o cartão');
  d := public.adm_central_detail('open_pendencies', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 3, 'lista de pendências abertas = 3');
  perform public.adm_pendency_assign(pb, u_sales);
  select count(*) into n from jsonb_array_elements(public.adm_pendency_history(pb)) e where e ->> 'action' in ('created','assigned');
  rep := rep || pg_temp.chk(n = 2, 'atribuição fica no histórico');
  ok := false; begin perform public.adm_pendency_assign(pb, u_pac); exception when others then ok := sqlerrm like '%responsável inválido%'; end;
  rep := rep || pg_temp.chk(ok, 'responsável que não é da equipe (paciente) é recusado');
  ok := false; begin perform public.adm_pendency_resolve(pa, ' '); exception when others then ok := sqlerrm like '%descreva a resolução%'; end;
  rep := rep || pg_temp.chk(ok, 'resolver exige descrever a resolução');
  ok := false; begin perform public.adm_pendency_reopen(pa, 'x um motivo'); exception when others then ok := sqlerrm like '%concluída%'; end;
  rep := rep || pg_temp.chk(ok, 'só pendência concluída pode ser reaberta');
  perform public.adm_pendency_resolve(pa, 'documento renovado e anexado');
  j := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j #>> '{cards,overdue_pendencies,value}')::int = 0 and (j #>> '{kpis,pendencies,resolved_period}')::int = 1 and (j #>> '{kpis,resolution,available}')::boolean and (j #>> '{kpis,resolution,n}')::int = 1,
    format('resolvida: sai das vencidas, entra nas concluídas do período e o tempo de resolução passa a existir (n=%s)', j #>> '{kpis,resolution,n}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,resolution,median_hours}') is not null and exists (select 1 from jsonb_array_elements(j #> '{kpis,resolution_by_kind}') x where x ->> 'kind' = 'documento' and (x ->> 'n')::int = 1), 'tempo médio e mediano existem e há o recorte por tipo (documento)');
  d := public.adm_central_detail('resolved_pendencies', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 1, 'lista de concluídas no período = 1');
  perform public.adm_pendency_reopen(pa, 'documento anexado estava ilegível');
  select (x ->> 'reopened_count')::int, x ->> 'status' into n, k from jsonb_array_elements(public.adm_pendency_list(uz, null, null, null, null, 200)) x where (x ->> 'id')::uuid = pa;
  j := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk(n = 1 and k = 'open' and (j #>> '{cards,overdue_pendencies,value}')::int = 1, 'reabrir: volta a aberta, conta a reabertura e volta a vencida (o prazo não foi renovado)');
  perform public.adm_pendency_set_due(pa, current_date + 3); perform public.adm_pendency_resolve(pa, 'reanexado corretamente');
  perform public.adm_pendency_cancel(pc, 'registrada por engano');
  select count(*) into n from jsonb_array_elements(public.adm_pendency_history(pa)) e;
  rep := rep || pg_temp.chk(n = 5, format('histórico completo da pendência: criada, resolvida, reaberta, prazo, resolvida (%s eventos)', n));
  ok := false; begin perform public.adm_pendency_resolve(pc, 'já cancelada mesmo assim'); exception when others then ok := sqlerrm like '%não está aberta%'; end;
  rep := rep || pg_temp.chk(ok, 'pendência cancelada não pode ser resolvida');
  -- evolução semanal e distribuições
  j := public.adm_central(p_from, p_to, uz);
  select coalesce(sum((x ->> 'opened')::int), 0), coalesce(sum((x ->> 'resolved')::int), 0) into n, n2 from jsonb_array_elements(j -> 'evolution') x;
  select (x ->> 'open_at_end')::int into oldn from jsonb_array_elements(j -> 'evolution') x order by x ->> 'week' desc limit 1;
  rep := rep || pg_temp.chk(n = 3 and n2 = 2 and oldn = (j #>> '{kpis,pendencies,open}')::int, format('evolução: 3 abertas e 2 concluídas nos eventos; em aberto ao fim da semana = abertas de hoje (%s/%s/%s)', n, n2, oldn));
  rep := rep || pg_temp.chk((j #>> '{kpis,pendencies,open}')::int = 1 and exists (select 1 from jsonb_array_elements(j #> '{kpis,by_owner}') x where x ->> 'name' is not null), 'distribuição por responsável existe (e "sem responsável" aparece como tal)');
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(j #> '{kpis,by_unit}') x where (x ->> 'unit_id')::uuid = uz), 'distribuição por unidade existe');
  j2 := public.adm_central(p_from, p_to, uz, u_sales);
  rep := rep || pg_temp.chk((j2 #>> '{kpis,pendencies,open}')::int = 1 and (j2 #>> '{kpis,pendencies,resolved_period}')::int = 0, 'filtro por responsável: u_sales tem só a pendência pb aberta');
  j2 := public.adm_central(p_from, p_to, uz, null, 'pj');
  rep := rep || pg_temp.chk((j2 #>> '{cards,incomplete,value}')::int = 1 and (j2 #>> '{cards,patients_waiting,value}')::int = 0 and (j2 #>> '{kpis,pendencies,open}')::int = 0, 'filtro PJ: só a PJ incompleta; pacientes e pendências de PF ficam fora');
  j2 := public.adm_central(p_from, p_to, uz, null, null, 'patient');
  rep := rep || pg_temp.chk((j2 #>> '{cards,incomplete,value}')::int = 2 and (j2 #>> '{cards,patients_waiting,value}')::int = 2, format('filtro de vínculo paciente: 2 incompletos (p2 e p4) e 2 com solicitação (p3, p4); PJ excluída (obtido %s/%s)', j2 #>> '{cards,incomplete,value}', j2 #>> '{cards,patients_waiting,value}'));
  j2 := public.adm_central(p_from, p_to, uz, null, null, null, 'resolved');
  rep := rep || pg_temp.chk((j2 #>> '{kpis,pendencies,open}')::int = 0 and (j2 #>> '{kpis,pendencies,resolved_period}')::int = 1, 'filtro de status (concluídas) restringe a seção de pendências');
  ok := false; begin perform public.adm_central(p_from, p_to, uz, null, 'xx'); exception when others then ok := sqlerrm like '%tipo inválido%'; end;
  rep := rep || pg_temp.chk(ok, 'filtro de tipo inválido é recusado');
  select jsonb_array_length(public.adm_pendency_list(uz, null, null, null, 'open', 50)) into n;
  rep := rep || pg_temp.chk(n = 1, 'listagem de pendências (base da exportação) respeita o filtro de status');

  -- ============================================================ 5) documentos e verificação de contato (registro humano)
  perform public.adm_document_register('person', p2, dt_pf, 'Registro de p2', '12345', current_date - 10, current_date + 100, null);
  select count(*) into n from jsonb_array_elements(public.adm_documents_list(uz, 'pf', 'valido', 50)) x where x ->> 'subject_name' = 'Incompleta B S10';
  rep := rep || pg_temp.chk(n = 1, 'documento registrado aparece como vigente');
  ok := false; begin perform public.adm_document_register('person', p2, dt_pj, 'tipo errado', null, null, null, null); exception when others then ok := sqlerrm like '%não se aplica%'; end;
  rep := rep || pg_temp.chk(ok, 'tipo de documento de PJ não se aplica a PF');
  ok := false; begin perform public.adm_document_register('person', p2, dt_pf, 'datas invertidas', null, current_date, current_date - 1, null); exception when others then ok := sqlerrm like '%anterior%'; end;
  rep := rep || pg_temp.chk(ok, 'validade anterior à emissão é recusada');
  reset role; select id into ctc from public.person_contacts where person_id = p1 limit 1; set local role authenticated;
  ok := true; begin update public.person_contacts set verified_at = now() where id = ctc; ok := false; exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'ninguém marca contato como verificado por escrita direta (só pela função)');
  perform public.adm_contact_verify(ctc, 'conversa');
  j := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j #>> '{kpis,contacts,verified}')::int = 1 and (j #>> '{kpis,contacts,verified_available}')::boolean and (j #>> '{kpis,contacts,verified_pct}')::numeric = 20.0, format('após registrar 1 verificação: verificados 1 de 5 = 20,0%% e o indicador passa a existir (obtido %s)', j #>> '{kpis,contacts,verified_pct}'));
  rep := rep || pg_temp.chk((j #>> '{kpis,contacts,valid_format}')::int = 4, 'formato válido continua separado de verificado (4 válidos, 1 verificado)');
  d := public.adm_central_detail('contacts_unverified', null, p_from, p_to, uz); rep := rep || pg_temp.chk((d ->> 'total_items')::int = 4, 'lista de contatos sem verificação = 4');
  ok := false; begin perform public.adm_contact_verify(ctc, 'inventado'); exception when others then ok := sqlerrm like '%método%'; end;
  rep := rep || pg_temp.chk(ok, 'método de verificação inválido é recusado');
  update public.person_contacts set value = 'novo-a@s10.local', normalized = 'novo-a@s10.local' where id = ctc;
  reset role; select verified_at is null into ok from public.person_contacts where id = ctc; set local role authenticated;
  rep := rep || pg_temp.chk(ok, 'mudar o valor do contato invalida a verificação anterior');

  -- ============================================================ 6) sincronização: integração de profissionais, pendências automáticas, idempotência
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  j := public.adm_sync();
  rep := rep || pg_temp.chk((j ->> 'created')::int > 0, format('sincronização cria pendências automáticas dos problemas detectados (%s)', j ->> 'created'));
  reset role; select count(*) into n from public.adm_pendencies where org_id = v_org and origin = 'auto' and status = 'open' and unit_id = uz; set local role authenticated;
  j2 := public.adm_sync(); reset role; select count(*) into n2 from public.adm_pendencies where org_id = v_org and origin = 'auto' and status = 'open' and unit_id = uz; set local role authenticated;
  rep := rep || pg_temp.chk(n2 = n and (j2 ->> 'created')::int = 0, format('idempotente: rodar de novo não duplica (%s → %s, novas %s)', n, n2, j2 ->> 'created'));
  reset role; select count(*) into n from public.adm_pendencies where org_id = v_org and origin = 'auto' and status = 'open' and dedupe_key like 'contract-sign:' || c1 || '%'; set local role authenticated;
  rep := rep || pg_temp.chk(n = 1, 'o contrato aguardando assinatura virou pendência automática (uma só)');
  reset role; select count(*) into n from public.adm_pendencies where org_id = v_org and origin = 'auto' and dedupe_key like 'doc-expired:%' and unit_id = uz and status = 'open'; set local role authenticated;
  rep := rep || pg_temp.chk(n = 2, format('documentos vencidos viram pendência automática, uma por documento (p4 e a certidão de e1, da mesma unidade) (obtido %s)', n));
  reset role; select count(*) into n from public.adm_professional_onboarding where professional_id in (pr1, pr2, pr3); set local role authenticated;
  reset role; select complete_at_first_evaluation into ok from public.adm_professional_onboarding where professional_id = pr1; set local role authenticated;
  rep := rep || pg_temp.chk(n = 2 and ok, 'medição de integração: profissionais ativos registrados (a inativa não); quem já estava completa não ganha data de conclusão inventada');
  j := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j #>> '{kpis,onboarding,available}')::boolean is false, 'sem conclusões medidas, o tempo de integração continua indisponível (pr1 já estava completa)');
  -- pr2 passa a cumprir todos os requisitos depois de medida
  update public.professionals set council_registration = 'CREFITO-3/999', user_id = u_pr2 where id = pr2;
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time) values (v_org, pr2, uz, 2, '08:00', '12:00');
  j2 := public.adm_sync();
  j := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j2 ->> 'professionals_completed_now')::int = 1 and (j #>> '{kpis,onboarding,available}')::boolean and (j #>> '{kpis,onboarding,n}')::int = 1 and (j #>> '{kpis,professionals,ready}')::int = 2 and (j #>> '{cards,professionals_incomplete,value}')::int = 0,
    format('pr2 concluiu DEPOIS de medida: tempo de integração passa a existir (n=1) e ambos os profissionais ativos estão aptos (obtido %s)', j #>> '{kpis,professionals,ready}'));
  reset role; select count(*) into n from public.adm_pendencies where org_id = v_org and origin = 'auto' and status = 'open' and dedupe_key = 'prof-onboarding:' || pr2; set local role authenticated;
  reset role; select count(*) into n2 from public.adm_pendencies where org_id = v_org and origin = 'auto' and status = 'resolved' and dedupe_key = 'prof-onboarding:' || pr2 and resolution_note like 'Regularizado%'; set local role authenticated;
  rep := rep || pg_temp.chk(n = 0 and n2 = 1, 'a pendência automática de integração foi encerrada sozinha ao regularizar (nota "Regularizado — verificado automaticamente"); manuais nunca são tocadas');
  select x ->> 'status' into k from jsonb_array_elements(public.adm_pendency_list(uz, null, null, null, null, 200)) x where (x ->> 'id')::uuid = pb; rep := rep || pg_temp.chk(k = 'open', 'pendência manual aberta não foi tocada pela sincronização');

  -- ============================================================ 7) ausência de dados (unidade vazia): motivo em vez de zero
  j := public.adm_central(p_from, p_to, uw);
  rep := rep || pg_temp.chk((j #>> '{cards,incomplete,value}')::int = 0 and (j #>> '{kpis,completeness,available}')::boolean is false and (j #>> '{kpis,completeness,basis}') like '%sem cadastros%', 'unidade vazia: % de completos indisponível, com o motivo "sem cadastros no filtro"');
  rep := rep || pg_temp.chk((j #>> '{kpis,resolution,available}')::boolean is false and (j #>> '{kpis,waiting,available}')::boolean is false and (j #>> '{kpis,contacts,valid_pct}') is null, 'unidade vazia: tempos e percentuais sem base são indisponíveis (não viram zero)');
  rep := rep || pg_temp.chk((j #>> '{cards,overdue_pendencies,value}')::int = 0 and (j #>> '{cards,docs_expiring,value}')::int = 0 and jsonb_array_length(j -> 'evolution') >= 1, 'contagens reais continuam zero (há base: as tabelas existem) e a evolução tem as semanas do período');

  -- ============================================================ 8) permissões, isolamento por unidade, privacidade
  perform set_config('request.jwt.claims', json_build_object('sub', u_umz, 'role','authenticated')::text, true);
  j := public.adm_central(p_from, p_to, null);
  rep := rep || pg_temp.chk((j #>> '{cards,incomplete,value}')::int >= 5, 'gestor da unidade Z abre o painel e vê os cadastros da própria unidade');
  ok := false; begin perform public.adm_sync(); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'gestor de unidade NÃO roda a sincronização (escopo da organização)');
  ok := false; begin perform public.adm_settings_save(30, 2, 7, '{}'::jsonb); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'gestor de unidade NÃO altera configuração/prazos (só gestor e administrador operacional)');
  ok := false; begin perform public.adm_requirement_save(null, 'pf', 'field', 'cep', 'CEP', true, true); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'gestor de unidade NÃO altera requisitos');
  j := public.adm_config_get(); rep := rep || pg_temp.chk(not (j ->> 'can_edit')::boolean and jsonb_array_length(j -> 'requirements') > 0, 'gestor de unidade LÊ a configuração, sem poder editar');

  perform set_config('request.jwt.claims', json_build_object('sub', u_umy, 'role','authenticated')::text, true);
  ok := false; begin perform public.adm_central(p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'gestor de OUTRA unidade NÃO abre o painel da unidade Z');
  ok := false; begin perform public.adm_central_detail('incomplete', null, p_from, p_to, uz); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'gestor de outra unidade NÃO abre o detalhe da unidade Z');
  j := public.adm_central(p_from, p_to, null);
  rep := rep || pg_temp.chk((j #>> '{cards,incomplete,value}')::int = 0 and (j #>> '{kpis,documents,registered}')::int = 0 and (j #>> '{cards,patients_waiting,value}')::int = 0 and (j #>> '{kpis,contracts,by_status,signed}')::int = 0,
    'sem filtro, o gestor da unidade Y vê só a própria unidade: nada de Z vaza (cadastros, documentos, solicitações, contratos)');
  rep := rep || pg_temp.chk(jsonb_array_length(public.adm_pendency_list(null, null, null, null, null, 200)) = 0 and jsonb_array_length(public.adm_contracts_list(null, null, null, null, 200)) = 0
    and jsonb_array_length(public.adm_documents_list(null, null, null, 200)) = 0, 'listas/exportações (pendências, contratos, documentos) do gestor Y não trazem nada de Z');
  ok := false; begin perform public.adm_pendency_resolve(pb, 'tentativa de outra unidade'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'gestor de outra unidade NÃO resolve pendência da unidade Z');
  ok := false; begin perform public.adm_pendency_create('outro', 'na unidade alheia', null, 'person', p1, null, null, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'gestor de outra unidade NÃO cria pendência sobre cadastro da unidade Z');
  ok := false; begin perform public.adm_contact_verify(ctc, 'conversa'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'gestor de outra unidade NÃO verifica contato de cadastro da unidade Z');
  ok := false; begin perform public.adm_pendency_history(pa); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'gestor de outra unidade NÃO lê o histórico de pendência da unidade Z');
  select count(*) into n from jsonb_array_elements(public.adm_contacts_search('Completa', null));
  rep := rep || pg_temp.chk(n = 0, 'busca de contatos do gestor Y não encontra cadastros da unidade Z');

  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  j := public.adm_central(p_from, p_to, uz);
  rep := rep || pg_temp.chk((j #>> '{cards,incomplete,value}')::int >= 1, 'comercial da unidade LÊ o painel (mesma regra do Administrativo atual)');
  ok := false; begin perform public.adm_pendency_create('outro', 'comercial não escreve', null, null, null, uz, null, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'comercial NÃO cria pendência (leitura apenas)');
  ok := false; begin perform public.adm_document_register('person', p1, dt_pf, 'comercial', null, null, null, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'comercial NÃO registra documento');
  ok := false; begin perform public.adm_contract_create('outro', 'comercial', 'person', p1, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'comercial NÃO cria contrato');

  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  ok := false; begin perform public.adm_central(p_from, p_to, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'fisioterapeuta NÃO abre o painel administrativo');
  ok := false; begin perform public.adm_pendency_list(null, null, null, null, null, 10); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'fisioterapeuta NÃO lista pendências');
  perform set_config('request.jwt.claims', json_build_object('sub', u_pac, 'role','authenticated')::text, true);
  ok := false; begin perform public.adm_central(p_from, p_to, null); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'paciente NÃO abre o painel administrativo');
  -- leitura direta das tabelas novas
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  ok := false; begin perform count(*) from public.adm_pendencies; exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'nem o gestor lê as tabelas novas diretamente (só pelas funções com escopo)');
  ok := false; begin perform count(*) from public.person_documents; exception when others then ok := sqlstate = '42501'; end;
  rep := rep || pg_temp.chk(ok, 'documentos de PF não são legíveis diretamente');

  -- privacidade: nenhuma saída do Administrativo carrega dado clínico
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  j := public.adm_central(p_from, p_to, uz);
  xx := jsonb_build_array(j, public.adm_pendency_list(uz, null, null, null, null, 200), public.adm_documents_list(uz, null, null, 200), public.adm_contracts_list(uz, null, null, null, 200));
  for k in select unnest(array['incomplete','docs_expiring','patients_waiting','packages_ending','duplicates','contacts_unverified','open_pendencies','access_review','professionals_incomplete']) loop
    xx := xx || jsonb_build_array(public.adm_central_detail(k, null, p_from, p_to, uz));
  end loop;
  rep := rep || pg_temp.chk(xx::text not like '%OBJETIVO-CLINICO-SIGILOSO-S10%', 'o Administrativo não expõe objetivos, avaliações nem respostas de saúde (objetivo clínico de p3 não aparece em nenhuma saída)');
  rep := rep || pg_temp.chk(xx::text !~* '(52998224725|39053344705|11144477735|12345678909|11222333000181)', 'nenhuma saída traz número de documento (CPF/CNPJ) de cadastro');

  -- ============================================================ 9) superfície pública
  reset role; set local role anon;
  ok := false; begin perform public.adm_central(p_from, p_to, null); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'anon não executa adm_central');
  ok := false; begin perform public.adm_central_detail('incomplete', null, p_from, p_to, null); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'anon não executa adm_central_detail');
  ok := false; begin perform public.adm_pendency_create('outro', 'anon', null, null, null, null, null, null); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'anon não cria pendência');
  ok := false; begin perform public.adm_sync(); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'anon não executa adm_sync');
  ok := false; begin perform public.adm_contact_verify(ctc, 'conversa'); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'anon não verifica contato');
  ok := false; begin perform private.adm_people(null); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'auxiliares internos do schema private não são executáveis por anon');
  reset role; set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  ok := false; begin perform private.adm_people(null); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'auxiliares internos do schema private não são executáveis por authenticated');
  reset role;

  raise exception E'RELATORIO_S10_CENTRAL_PENDENCIAS_ADMINISTRATIVAS (transação desfeita):%', rep;
end $$;
