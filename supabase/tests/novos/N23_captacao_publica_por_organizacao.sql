-- NOVO — N23: captação pública por organização (migration 143). Duas organizações fictícias criadas PELO QUESTIONÁRIO; entradas públicas (anon) resolvem a organização pelo SLUG validado no servidor.
-- Prova: lead/resposta/oportunidade só na organização do endereço; formulário de outra organização recusado (com e sem slug); organização inexistente/inativa indistinguíveis; módulo CRM desligado bloqueia no servidor;
-- reenvio não duplica; anônimo não lista nada; HP (sem slug) continua intacta. Transação sempre desfeita. Nenhum e-mail é enviado. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid, org uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('app.active_org', coalesce(org::text, ''), true);
end $$;
create or replace function pg_temp.answers(p_name text, p_sub text, p_email text, p_mods jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'company', jsonb_build_object('name', p_name, 'segment', 'fisioterapia', 'responsible', jsonb_build_object('name', 'Responsável ' || p_name, 'email', p_email), 'city', 'São Paulo', 'state', 'SP', 'units', jsonb_build_array(jsonb_build_object('name', 'Sede ' || p_name, 'city', 'São Paulo'))),
    'operation', jsonb_build_object('services', jsonb_build_array('Avaliação', 'Sessão de fisioterapia'), 'modes', jsonb_build_array('in_clinic', 'home_visit'), 'flow', 'Avaliação, plano e sessões', 'sales_models', jsonb_build_array('single', 'package')),
    'team', jsonb_build_object('users_count', 5, 'roles', jsonb_build_array(jsonb_build_object('role', 'physio', 'count', 3), jsonb_build_object('role', 'manager', 'count', 1))),
    'customers', jsonb_build_object('crm', true, 'capture', true, 'forms', true, 'proposals', false, 'portal', true, 'import', jsonb_build_object('needed', false)),
    'modules', p_mods,
    'brand', jsonb_build_object('app_name', p_name || ' App', 'color_primary', '#123456', 'color_accent', '#ff8800', 'subdomain', p_sub),
    'integrations', jsonb_build_array('email', 'calendar'),
    'plan', jsonb_build_object('plan_key', 'essencial', 'implementation', 'standard', 'import_assisted', false, 'training', false))
$$;
do $$
declare
  rep text := ''; pa uuid := gen_random_uuid(); alfa uuid; beta uuid; j jsonb; n int; n2 int; v_unit_a uuid; v_pipe_a uuid; v_page_a uuid; v_form_a uuid; v_page_b uuid; v_form_b uuid; v_hp uuid; v_lead uuid; v_hp_before int;
  v_mgr_b uuid := gen_random_uuid(); v_ph text;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (pa, 'authenticated', 'authenticated', 'plataforma@n23.local', now()), (v_mgr_b, 'authenticated', 'authenticated', 'gestor.beta@n23.local', now());
  insert into public.platform_admins (user_id) values (pa);
  select id into v_hp from public.organizations where slug = 'hp-group';
  select count(*) into v_hp_before from public.quiz_leads where org_id = v_hp;

  -- 1. duas organizações pelo questionário
  set local role authenticated; perform pg_temp.as_user(pa);
  j := public.provisioning_draft_save('n23-alfa-0001', pg_temp.answers('Clínica Alfa N23', 'alfa-n23', 'admin.alfa@n23.local', '[]'::jsonb)); j := public.provisioning_submit('n23-alfa-0001'); alfa := (j ->> 'org_id')::uuid;
  j := public.provisioning_draft_save('n23-beta-0001', pg_temp.answers('Clínica Beta N23', 'beta-n23', 'admin.beta@n23.local', '[]'::jsonb)); j := public.provisioning_submit('n23-beta-0001'); beta := (j ->> 'org_id')::uuid;
  reset role;
  rep := rep || pg_temp.chk(alfa is not null and beta is not null and alfa <> beta, 'duas organizações criadas pelo questionário');
  rep := rep || pg_temp.chk((select status from public.organizations where id = alfa) = 'active', 'organização provisionada está ativa');
  insert into public.org_memberships (user_id, org_id, status) values (v_mgr_b, beta, 'active');
  insert into public.role_assignments (org_id, user_id, role) values (beta, v_mgr_b, 'manager');
  select id into v_unit_a from public.units where org_id = alfa limit 1; select id into v_pipe_a from public.pipelines where org_id = alfa and kind = 'patients' limit 1;

  -- 2. resolução pública do slug (anônimo): só marca pública; desconhecido/inválido/inativo respondem igual
  set local role anon;
  j := public.org_public_by_slug('alfa-n23');
  rep := rep || pg_temp.chk((j ->> 'found')::boolean and j #>> '{brand,name}' = 'Clínica Alfa N23 App' and (j -> 'brand') ? 'org_id' = false and (j -> 'brand') ? 'support_phone' = false, 'slug resolve só a marca pública (sem org_id, sem telefone)');
  rep := rep || pg_temp.chk((public.org_public_by_slug('slug-que-nao-existe') ->> 'found')::boolean = false, 'slug desconhecido: não encontrado');
  rep := rep || pg_temp.chk((public.org_public_by_slug('alfa-n23''; drop table x;--') ->> 'found')::boolean = false and (public.org_public_by_slug('') ->> 'found')::boolean = false, 'slug malformado/vazio: não encontrado');
  reset role;
  update public.organizations set status = 'suspended' where id = beta;
  set local role anon;
  rep := rep || pg_temp.chk((public.org_public_by_slug('beta-n23') = public.org_public_by_slug('slug-que-nao-existe')), 'organização suspensa responde IGUAL a inexistente (sem enumeração)');
  reset role; update public.organizations set status = 'active' where id = beta;

  -- 3. quiz: o lead nasce SÓ na organização do endereço
  set local role anon;
  j := public.quiz_start('atendimento', 'Paciente Teste Alfa', 'lead.alfa@n23.local', '(11) 98888-0001', 'contact-v1-org', '/empresa/alfa-n23/avaliacao', 'avaliacao', null, '{"utm_campaign":"camp-alfa"}'::jsonb, null, 'alfa-n23');
  v_lead := (j ->> 'id')::uuid;
  reset role;
  rep := rep || pg_temp.chk((select org_id from public.quiz_leads where id = v_lead) = alfa, 'lead do quiz nasce na organização do endereço');
  rep := rep || pg_temp.chk((select count(*) from public.quiz_leads where email = 'lead.alfa@n23.local') = 1 and (select count(*) from public.quiz_leads where org_id in (beta, v_hp) and email = 'lead.alfa@n23.local') = 0, 'o lead NÃO aparece na Beta nem na HP');
  select count(*) into n from public.people p join public.person_contacts c on c.person_id = p.id where c.value = 'lead.alfa@n23.local';
  rep := rep || pg_temp.chk(n = 1 and (select count(*) from public.people p join public.person_contacts c on c.person_id = p.id where c.value = 'lead.alfa@n23.local' and p.org_id = alfa) = 1, 'uma única pessoa (cadastro central) e só na Alfa');
  rep := rep || pg_temp.chk((select count(*) from public.opportunities o join public.quiz_leads q on q.opportunity_id = o.id where q.id = v_lead and o.org_id = alfa and o.campaign = 'camp-alfa' and o.pipeline_id = v_pipe_a) = 1, 'oportunidade no funil da Alfa com a campanha preservada');
  set local role anon;
  j := public.quiz_start('atendimento', 'Paciente Teste Alfa', 'lead.alfa@n23.local', '(11) 98888-0001', 'contact-v1-org', null, null, null, '{}'::jsonb, null, 'alfa-n23');
  reset role;
  rep := rep || pg_temp.chk((j ->> 'resumed')::boolean and (select count(*) from public.quiz_leads where email = 'lead.alfa@n23.local') = 1, 'reenvio do mesmo lead retoma o existente (sem duplicar)');
  set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.quiz_start('atendimento','Fulano Silva','x@n23.local','(11) 98888-0002','contact-v1-org',null,null,null,'{}'::jsonb,null,'slug-que-nao-existe')$q$) like '%captação indisponível%', 'quiz com organização inexistente é recusado (nunca cai na HP)');
  reset role;
  update public.org_modules set enabled = false where org_id = alfa and module_key = 'crm';
  set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err($q$select public.quiz_start('atendimento','Fulano Silva','y@n23.local','(11) 98888-0003','contact-v1-org',null,null,null,'{}'::jsonb,null,'alfa-n23')$q$) like '%captação indisponível%', 'módulo CRM desligado bloqueia a captação no servidor');
  reset role; update public.org_modules set enabled = true where org_id = alfa and module_key = 'crm';
  select count(*) into n from public.quiz_leads where email in ('x@n23.local', 'y@n23.local'); rep := rep || pg_temp.chk(n = 0, 'nenhuma captação recusada deixou rastro');

  -- 4. WhatsApp do quiz por organização (nunca o da HP)
  insert into public.quiz_whatsapp_numbers (org_id, journey, phone, active) values (alfa, 'atendimento', '5511977770001', true);
  set local role anon;
  rep := rep || pg_temp.chk(public.quiz_whatsapp_number('atendimento', null, 'alfa-n23') = '5511977770001', 'WhatsApp da Alfa só para a Alfa');
  rep := rep || pg_temp.chk(public.quiz_whatsapp_number('atendimento', null, 'beta-n23') is null, 'Beta sem número configurado: nada (não usa o da HP nem o da Alfa)');
  reset role;

  -- 5. páginas e formulários vinculados à organização
  insert into public.pages (org_id, unit_id, slug, title, status, published_title, published_content, published_at) values (alfa, v_unit_a, 'promo-n23', 'Promoção Alfa', 'published', 'Promoção Alfa', '[]', now()) returning id into v_page_a;
  insert into public.forms (org_id, page_id, unit_id, pipeline_id, name, fields) values (alfa, v_page_a, v_unit_a, v_pipe_a, 'Contato Alfa', '[{"key":"name","label":"Nome","type":"text","required":true},{"key":"email","label":"E-mail","type":"email","required":true}]') returning id into v_form_a;
  insert into public.pages (org_id, unit_id, slug, title, status, published_title, published_content, published_at)
    values (beta, (select id from public.units where org_id = beta limit 1), 'promo-beta', 'Promoção Beta', 'published', 'Promoção Beta', '[]', now()) returning id into v_page_b;
  insert into public.forms (org_id, page_id, unit_id, pipeline_id, name, fields)
    values (beta, v_page_b, (select id from public.units where org_id = beta limit 1), (select id from public.pipelines where org_id = beta and kind = 'patients' limit 1), 'Contato Beta', '[{"key":"name","label":"Nome","type":"text","required":true},{"key":"email","label":"E-mail","type":"email","required":true}]') returning id into v_form_b;
  set local role anon;
  rep := rep || pg_temp.chk(public.get_public_page('promo-n23', 'alfa-n23') ->> 'status' = 'published', 'página da Alfa publicada no endereço da Alfa');
  rep := rep || pg_temp.chk(public.get_public_page('promo-n23', 'beta-n23') ->> 'status' = 'not_found', 'página da Alfa NÃO aparece no endereço da Beta');
  rep := rep || pg_temp.chk(public.get_public_page('promo-n23') ->> 'status' = 'not_found', 'página da Alfa NÃO aparece no endereço da HP (sem slug)');
  j := public.submit_public_form(v_form_a, '{"name":"Lead Formulario Alfa","email":"form.alfa@n23.local"}'::jsonb, '{"utm_source":"instagram","utm_campaign":"c-form-alfa"}'::jsonb, null, null, 'alfa-n23');
  rep := rep || pg_temp.chk(j ->> 'status' = 'created', 'formulário da Alfa aceito no endereço da Alfa (resposta criada)');
  v_ph := pg_temp.err(format('select public.submit_public_form(%L, %L::jsonb, %L::jsonb, null, null, %L)', v_form_a, '{"name":"Intruso Teste","email":"intruso@n23.local"}', '{}', 'beta-n23'));
  rep := rep || pg_temp.chk(v_ph like '%formulário indisponível%', 'id de formulário da Alfa usado no endereço da Beta: recusado');
  v_ph := pg_temp.err(format('select public.submit_public_form(%L, %L::jsonb, %L::jsonb, null, null)', v_form_a, '{"name":"Intruso Teste","email":"intruso2@n23.local"}', '{}'));
  rep := rep || pg_temp.chk(v_ph like '%formulário indisponível%', 'id de formulário da Alfa usado sem slug (HP): recusado');
  reset role;
  rep := rep || pg_temp.chk((select count(*) from public.form_submissions where answers ->> 'email' in ('intruso@n23.local', 'intruso2@n23.local')) = 0 and (select count(*) from public.people p join public.person_contacts c on c.person_id = p.id where c.value in ('intruso@n23.local', 'intruso2@n23.local')) = 0, 'tentativas cruzadas não deixaram resposta nem pessoa');
  rep := rep || pg_temp.chk((select count(*) from public.form_submissions s where s.org_id = alfa and s.answers ->> 'email' = 'form.alfa@n23.local') = 1
    and (select count(*) from public.opportunities o where o.org_id = alfa and o.campaign = 'c-form-alfa') = 1 and (select count(*) from public.opportunities o where o.org_id in (beta, v_hp) and o.campaign = 'c-form-alfa') = 0, 'resposta e oportunidade só na Alfa, com campanha e origem preservadas');
  set local role anon;
  j := public.submit_public_form(v_form_a, '{"name":"Lead Formulario Alfa","email":"form.alfa@n23.local"}'::jsonb, '{}'::jsonb, null, null, 'alfa-n23');
  reset role;
  rep := rep || pg_temp.chk(j ->> 'status' = 'duplicate' and (select count(*) from public.form_submissions where org_id = alfa and answers ->> 'email' = 'form.alfa@n23.local') = 1, 'reenvio do mesmo formulário não duplica a resposta (status duplicate)');
  -- 6. anônimo não lista nada; gestor da Beta não vê o lead da Alfa
  set local role anon;
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.quiz_leads') like '42501%' and pg_temp.err('select count(*) from public.form_submissions') like '42501%' and pg_temp.err('select count(*) from public.people') like '42501%', 'anônimo não lista leads, respostas nem pessoas');
  reset role;
  set local role authenticated; perform pg_temp.as_user(v_mgr_b, beta);
  select count(*) into n from public.opportunities where campaign in ('camp-alfa', 'c-form-alfa'); select count(*) into n2 from public.people where org_id = alfa;
  rep := rep || pg_temp.chk(n = 0 and n2 = 0, 'gestor da Beta não vê oportunidade nem pessoa da Alfa');
  reset role;
  rep := rep || pg_temp.chk((select count(*) from public.quiz_leads where org_id = v_hp) = v_hp_before, 'a HP não recebeu nenhum lead dos testes');
  -- 7. HP (sem slug) segue funcionando como sempre: slug de HP resolve e a função legada de 4 argumentos não existe mais (sem sobrecarga ambígua)
  set local role anon;
  rep := rep || pg_temp.chk((public.org_public_by_slug('hp-group') ->> 'found')::boolean and (public.org_public_by_slug('hp-group') #>> '{brand,is_default_brand}')::boolean, 'hp-group resolve com marca padrão da HP');
  reset role;
  rep := rep || pg_temp.chk((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('quiz_start', 'get_public_page', 'quiz_whatsapp_number', 'onboarding_submit_patient', 'submit_public_form')) = 5, 'uma única assinatura por função pública (sem sobrecarga ambígua)');
  rep := rep || pg_temp.chk(has_function_privilege('anon', 'public.org_public_by_slug(text)', 'execute') and not has_function_privilege('anon', 'private.public_org(text)', 'execute'), 'anon executa só a resolução pública; a função interna é fechada');
  raise exception 'RELATORIO_N23%', rep;
end $$;
