-- RELEASE v1 — S25: onboarding de fisioterapeuta (link único) e de paciente (rota aberta) + "Primeiro acesso" só para cadastrados (migration 086). Transação sempre desfeita. Somente Dev/teste.
--  · links: só gestor cria/cancela; token guardado só como hash; uso único, validade, e-mail do convite travado
--  · fisioterapeuta: PF e PJ (CNPJ cria empresa + representante), profissional ativo na unidade, convite de acesso, dados bancários só para a própria pessoa/gestor; CPF alheio nunca vira vínculo
--  · paciente: cadastro novo; e-mail que já existe NÃO é alterado até o dono confirmar o acesso (aí só preenche vazios); CPF repetido não vincula; saúde exige consentimento
--  · primeiro acesso: not_found / registered_no_access / invited / has_account; limites por IP; anônimo sem leitura nas tabelas novas
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.as_anon(n int) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', '10.25.0.' || n)::text, true); end $$;
create or replace function pg_temp.fisio(over jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object(
  'full_name','Fernanda Lima Teste S25','preferred_name','Fe','birth_date','1990-05-10','cpf','529.982.247-25','rg','12.345.678-9','email','fisio.s25@s25.local','phone','(11) 98888-7777',
  'cep','09015-000','street','Rua Teste','street_number','100','neighborhood','Centro','city','Santo André','state_uf','SP','council_number','123456-F','council_uf','SP',
  'specialties', jsonb_build_array('Ortopedia','Geriatria'),'education','UFSCar','bio','Atendimento domiciliar','service_regions','ABC','work_as','pf','pix_key_type','cpf','pix_key','52998224725','bank_name','Banco Teste') || over $$;
create or replace function pg_temp.pac(over jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object(
  'full_name','Paulo Souza Teste S25','preferred_name','Paulo','birth_date','1950-03-02','cpf','111.444.777-35','email','paciente.s25@s25.local','phone','(11) 97777-6666',
  'cep','09015-000','street','Rua do Paciente','street_number','50','neighborhood','Jardim','city','Santo André','state_uf','SP','address_reference','portão azul',
  'emergency_name','Marta Souza','emergency_phone','(11) 96666-5555','emergency_relation','Filha','main_complaint','','how_found','indicação') || over $$;
do $$
declare
  v_org uuid; ua uuid; u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_new uuid := gen_random_uuid(); u_new2 uuid := gen_random_uuid(); u_exist uuid := gen_random_uuid();
  rep text := ''; t text; n bigint; r jsonb; tk1 text; tk2 text; tk3 text; tk4 text; lid uuid; per uuid; per2 uuid; prof uuid; sub record; s text; i int;
  p_lead uuid; p_other uuid; o_city text; lid1 uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade S25', 'teste-s25') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s25.local'),(u_sales,'authenticated','authenticated','s@s25.local'),(u_phy,'authenticated','authenticated','p@s25.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor S25'),(u_sales, v_org, null, 'Comercial S25'),(u_phy, v_org, null, 'Fisio S25');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', ua),(v_org, u_phy, 'physio', ua);
  rep := rep || pg_temp.chk(private.is_valid_cpf('52998224725') and private.is_valid_cpf('11144477735') and private.is_valid_cnpj('11222333000181'), 'documentos de teste são válidos');

  -- ============ 1) links: quem cria, token, leitura
  set local role authenticated; perform pg_temp.as_user(u_sales);
  t := pg_temp.err(format('select public.onboarding_link_create(%L, %L, %L)', 'fisio.s25@s25.local', 'Fernanda', ua)); rep := rep || pg_temp.chk(t like '42501%', 'comercial NÃO cria link de onboarding (42501)');
  perform pg_temp.as_user(u_mgr);
  r := public.onboarding_link_create('fisio.s25@s25.local', 'Fernanda', ua, 14); tk1 := r ->> 'token';
  rep := rep || pg_temp.chk(length(tk1) = 48 and (r ->> 'path') = '/onboarding-fisio?convite=' || tk1, 'gestor cria link: token de 48 caracteres e caminho /onboarding-fisio?convite=…');
  t := pg_temp.err(format('select token_hash from public.onboarding_links limit 1')); rep := rep || pg_temp.chk(t like '42501%', 'ninguém lê a coluna token_hash (nem o gestor, pela API)');
  select count(*) into n from public.onboarding_links; rep := rep || pg_temp.chk(n = 1, 'gestor lista os links (sem o token)');
  t := pg_temp.err(format('select public.onboarding_link_create(%L, null, %L, 0)', 'x@s25.local', ua)); rep := rep || pg_temp.chk(t like '%1 a 60 dias%', 'validade fora de 1–60 dias é recusada');
  t := pg_temp.err(format('select public.onboarding_link_create(%L, null, %L)', 'sem-arroba', ua)); rep := rep || pg_temp.chk(t like '%e-mail inválido%', 'e-mail inválido no link é recusado');
  perform pg_temp.as_user(u_sales); select count(*) into n from public.onboarding_links; rep := rep || pg_temp.chk(n = 0, 'comercial não vê links');
  reset role;
  select count(*) into n from public.onboarding_links where token_hash = tk1; rep := rep || pg_temp.chk(n = 0, 'o token em si não está guardado (só o hash)');
  select id into lid1 from public.onboarding_links where token_hash = encode(sha256(convert_to(tk1, 'UTF8')), 'hex'); rep := rep || pg_temp.chk(lid1 is not null, 'o hash do token encontra o link');

  -- ============ 2) consulta do link (anônimo)
  set local role anon; perform pg_temp.as_anon(1);
  r := public.onboarding_link_info(tk1); rep := rep || pg_temp.chk((r ->> 'valid')::boolean and r ->> 'email' = 'fisio.s25@s25.local' and r ->> 'unit' = 'Unidade S25', 'link válido devolve e-mail travado e nome da unidade');
  r := public.onboarding_link_info('token-inexistente'); rep := rep || pg_temp.chk(not (r ->> 'valid')::boolean and r ->> 'reason' = 'not_found', 'token inexistente = not_found');
  reset role;
  update public.onboarding_links set expires_at = now() - interval '1 minute' where id = lid1;
  set local role anon; perform pg_temp.as_anon(1); r := public.onboarding_link_info(tk1); reset role; rep := rep || pg_temp.chk(r ->> 'reason' = 'expired', 'link vencido = expired');
  update public.onboarding_links set expires_at = now() + interval '5 days' where id = lid1;
  reset role;

  -- ============ 3) fisioterapeuta PF
  set local role authenticated; perform pg_temp.as_user(u_mgr);
  r := public.onboarding_link_create(null, null, ua, 14); tk2 := r ->> 'token';
  r := public.onboarding_link_create('pj.s25@s25.local', null, ua, 14); tk3 := r ->> 'token';
  r := public.onboarding_link_create('cancelado.s25@s25.local', null, ua, 14); tk4 := r ->> 'token';
  reset role; select id into lid from public.onboarding_links where token_hash = encode(sha256(convert_to(tk4, 'UTF8')), 'hex');
  set local role authenticated; perform pg_temp.as_user(u_mgr); perform public.onboarding_link_revoke(lid);
  t := pg_temp.err(format('select public.onboarding_link_revoke(%L)', lid)); rep := rep || pg_temp.chk(t like '%já cancelado%' or t like '%não encontrado%', 'cancelar de novo é recusado');
  reset role;

  set local role anon; perform pg_temp.as_anon(2);
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk4, pg_temp.fisio()::text)); rep := rep || pg_temp.chk(t like '%inválido, já foi usado ou expirou%', 'link cancelado não aceita cadastro');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', 'abc', pg_temp.fisio()::text)); rep := rep || pg_temp.chk(t like '%inválido, já foi usado ou expirou%', 'sem link válido nada é gravado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, '''')', tk1, pg_temp.fisio()::text)); rep := rep || pg_temp.chk(t like '%termo de tratamento%', 'sem aceite do termo é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk1, pg_temp.fisio('{"cpf":"111.111.111-11"}')::text)); rep := rep || pg_temp.chk(t like '%CPF inválido%', 'CPF inválido é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk1, pg_temp.fisio('{"birth_date":"2015-01-01"}')::text)); rep := rep || pg_temp.chk(t like '%inválida para um profissional%', 'menor de idade é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk1, pg_temp.fisio('{"email":"outro@s25.local"}')::text)); rep := rep || pg_temp.chk(t like '%e-mail deste convite é fisio.s25@s25.local%', 'e-mail diferente do convite é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk1, pg_temp.fisio('{"pix_key":""}')::text)); rep := rep || pg_temp.chk(t like '%chave PIX%', 'sem chave PIX é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk1, pg_temp.fisio('{"specialties":[]}')::text)); rep := rep || pg_temp.chk(t like '%especialidade%', 'sem especialidade é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk1, pg_temp.fisio('{"cep":"123"}')::text)); rep := rep || pg_temp.chk(t like '%CEP inválido%', 'CEP inválido é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk1, pg_temp.fisio('{"full_name":"Fernanda"}')::text)); rep := rep || pg_temp.chk(t like '%nome completo%', 'nome sem sobrenome é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'', ''spam'')', tk1, pg_temp.fisio()::text)); reset role;
  select count(*) into n from public.people where full_name = 'Fernanda Lima Teste S25'; rep := rep || pg_temp.chk(t is null and n = 0, 'isca anti-robô: parece sucesso mas não grava nada');
  rep := rep || pg_temp.chk((select used_at from public.onboarding_links where id = lid1) is null, 'tentativas recusadas não gastam o link');

  -- cadastro correto (PF)
  set local role anon; perform pg_temp.as_anon(3);
  r := public.onboarding_submit_physio(tk1, pg_temp.fisio(), 'v1'); reset role;
  rep := rep || pg_temp.chk(r ->> 'status' = 'created' and r ->> 'doc_kind' = 'pf', 'cadastro de fisioterapeuta PF concluído');
  select id into per from public.people where org_id = v_org and document_number = '52998224725';
  rep := rep || pg_temp.chk(per is not null and (select unit_id from public.people where id = per) = ua and (select rg from public.people where id = per) = '12.345.678-9' and (select state_uf from public.people where id = per) = 'SP', 'pessoa criada em Pessoas com CPF só em dígitos, RG, endereço e unidade do convite');
  rep := rep || pg_temp.chk((select count(*) from public.person_kinds where person_id = per and kind = 'staff') = 1 and (select count(*) from public.person_contacts where person_id = per and is_primary) = 2, 'tipo "equipe" e dois contatos principais (e-mail e telefone)');
  select * into sub from public.onboarding_submissions where person_id = per;
  rep := rep || pg_temp.chk(sub.doc_kind = 'pf' and sub.legal_entity_id is null and sub.status = 'applied' and sub.consent_version = 'v1' and sub.ip_hash is not null, 'registro do envio: PF, sem empresa, com versão do termo e IP em hash');
  select id into prof from public.professionals where person_id = per;
  rep := rep || pg_temp.chk(prof is not null and (select active from public.professionals where id = prof) and (select council_registration from public.professionals where id = prof) = 'CREFITO-SP 123456-F' and (select display_name from public.professionals where id = prof) = 'Fe'
     and (select count(*) from public.professional_units where professional_id = prof and unit_id = ua) = 1, 'profissional ativo, com CREFITO e unidade do convite');
  rep := rep || pg_temp.chk((select specialties from public.professional_profiles where person_id = per) = array['Geriatria','Ortopedia'] and (select work_as from public.professional_profiles where person_id = per) = 'pf', 'perfil profissional com as especialidades');
  rep := rep || pg_temp.chk((select pix_key from public.person_bank_info where person_id = per) = '52998224725', 'dados de pagamento guardados à parte');
  rep := rep || pg_temp.chk((select count(*) from public.invitations where email = 'fisio.s25@s25.local' and role = 'physio' and unit_id = ua and professional_id = prof and person_id = per and accepted_at is null) = 1, 'convite de acesso (papel physio) criado e ligado ao profissional e à pessoa');
  rep := rep || pg_temp.chk((select used_at is not null and submission_id = sub.id from public.onboarding_links where id = (select link_id from public.onboarding_submissions where id = sub.id)), 'o link foi marcado como usado');
  set local role anon; perform pg_temp.as_anon(3); t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk1, pg_temp.fisio()::text)); reset role;
  rep := rep || pg_temp.chk(t like '%inválido, já foi usado ou expirou%', 'o mesmo link não serve duas vezes');

  -- depois de confirmar o e-mail: papel, conta ↔ pessoa ↔ profissional
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u_new, 'authenticated', 'authenticated', 'fisio.s25@s25.local', now());
  rep := rep || pg_temp.chk((select person_id from public.user_accounts where user_id = u_new) = per and (select count(*) from public.role_assignments where user_id = u_new and role = 'physio' and unit_id = ua) = 1, 'ao confirmar o e-mail: conta ligada à pessoa e papel de fisioterapeuta na unidade');
  rep := rep || pg_temp.chk((select user_id from public.professionals where id = prof) = u_new, 'e o profissional passa a ser dono da conta');
  rep := rep || pg_temp.chk((select display_name from public.user_accounts where user_id = u_new) = 'Fe', 'o nome mostrado é o do cadastro (preferência "Fe") — migration 085');

  -- dados sensíveis: a própria pessoa e o gestor leem; outro fisioterapeuta e o comercial não
  set local role authenticated; perform pg_temp.as_user(u_new); select count(*) into n from public.person_bank_info; rep := rep || pg_temp.chk(n = 1, 'a própria fisioterapeuta lê os seus dados de pagamento');
  perform pg_temp.as_user(u_phy); select count(*) into n from public.person_bank_info; rep := rep || pg_temp.chk(n = 0, 'outro fisioterapeuta NÃO lê dados de pagamento alheios');
  select count(*) into n from public.professional_profiles; rep := rep || pg_temp.chk(n = 0, 'nem o perfil profissional alheio');
  perform pg_temp.as_user(u_sales); select count(*) into n from public.person_bank_info; rep := rep || pg_temp.chk(n = 0, 'comercial NÃO lê dados de pagamento');
  select count(*) into n from public.onboarding_submissions; rep := rep || pg_temp.chk(n = 0, 'comercial não lê os envios de onboarding');
  perform pg_temp.as_user(u_mgr); select count(*) into n from public.person_bank_info; rep := rep || pg_temp.chk(n >= 1, 'gestor lê os dados de pagamento');
  select count(*) into n from public.onboarding_submissions; rep := rep || pg_temp.chk(n >= 1, 'gestor lê os envios de onboarding');
  reset role;

  -- ============ 4) fisioterapeuta PJ (CNPJ) por link sem e-mail travado
  set local role anon; perform pg_temp.as_anon(4);
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk3, pg_temp.fisio('{"email":"pj.s25@s25.local","cpf":"390.533.447-05","work_as":"pj","cnpj":"11.222.333/0001-80","legal_name":"Fisio PJ Ltda"}')::text)); rep := rep || pg_temp.chk(t like '%CNPJ inválido%', 'CNPJ inválido é recusado');
  r := public.onboarding_submit_physio(tk3, pg_temp.fisio('{"email":"pj.s25@s25.local","full_name":"Rafael Gomes Teste S25","cpf":"390.533.447-05","work_as":"pj","cnpj":"11.222.333/0001-81","legal_name":"Gomes Fisioterapia Ltda","trade_name":"Gomes Fisio","pix_key_type":"cnpj","pix_key":"11222333000181"}'), 'v1'); reset role;
  rep := rep || pg_temp.chk(r ->> 'doc_kind' = 'pj', 'com CNPJ o sistema classifica como pessoa jurídica');
  select id into per2 from public.people where document_number = '39053344705';
  rep := rep || pg_temp.chk((select count(*) from public.legal_entities where cnpj = '11222333000181' and legal_name = 'Gomes Fisioterapia Ltda') = 1 and (select count(*) from public.legal_entity_units where legal_entity_id = (select id from public.legal_entities where cnpj = '11222333000181') and unit_id = ua) = 1, 'empresa criada (CNPJ só em dígitos) e ligada à unidade');
  rep := rep || pg_temp.chk((select count(*) from public.legal_entity_representatives where legal_entity_id = (select id from public.legal_entities where cnpj = '11222333000181') and person_id = per2 and representation_type = 'legal_representative' and is_primary) = 1, 'a pessoa é o representante legal principal da empresa');
  rep := rep || pg_temp.chk((select work_as from public.professional_profiles where person_id = per2) = 'pj', 'perfil marcado como PJ');

  -- ============ 5) CPF alheio e e-mail já cadastrado (fisioterapeuta)
  set local role authenticated; perform pg_temp.as_user(u_mgr); r := public.onboarding_link_create('novo.s25@s25.local', null, ua, 14); tk4 := r ->> 'token'; reset role;
  set local role anon; perform pg_temp.as_anon(5);
  t := pg_temp.err(format('select public.onboarding_submit_physio(%L, %L::jsonb, ''v1'')', tk4, pg_temp.fisio('{"email":"novo.s25@s25.local","full_name":"Outra Pessoa Teste S25"}')::text)); reset role;
  rep := rep || pg_temp.chk(t like '%CPF já consta em outro cadastro%', 'CPF que já é de outra pessoa (outro e-mail) NUNCA vira vínculo automático');
  select count(*) into n from public.people where full_name = 'Outra Pessoa Teste S25'; rep := rep || pg_temp.chk(n = 0, '…e nada foi criado');
  -- gestor já tinha cadastrado a pessoa (com o e-mail): reaproveita e só preenche vazios
  insert into public.people (org_id, unit_id, full_name, city) values (v_org, ua, 'Beatriz Alves Teste S25', 'Cidade Original') returning id into p_other;
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, p_other, 'email', 'bia.s25@s25.local', true);
  set local role authenticated; perform pg_temp.as_user(u_mgr); r := public.onboarding_link_create('bia.s25@s25.local', null, ua, 14); tk4 := r ->> 'token'; reset role;
  set local role anon; perform pg_temp.as_anon(6);
  r := public.onboarding_submit_physio(tk4, pg_temp.fisio('{"email":"bia.s25@s25.local","full_name":"Beatriz Alves Teste S25","cpf":"123.456.789-09"}'), 'v1'); reset role;
  rep := rep || pg_temp.chk((select count(*) from public.people where full_name = 'Beatriz Alves Teste S25') = 1, 'cadastro existente com o mesmo e-mail é reaproveitado (sem duplicar)');
  rep := rep || pg_temp.chk(r ->> 'status' = 'created' and (select city from public.people where id = p_other) = 'Cidade Original' and (select count(*) from public.professionals where person_id = p_other) = 1, 'campo que já estava preenchido não é sobrescrito, e o profissional é criado');
  -- conta já confirmada para o e-mail
  reset role; insert into auth.users (id, aud, role, email, email_confirmed_at) values (u_exist, 'authenticated', 'authenticated', 'conta.existente.s25@s25.local', now());
  set local role authenticated; perform pg_temp.as_user(u_mgr); t := pg_temp.err(format('select public.onboarding_link_create(%L, null, %L)', 'conta.existente.s25@s25.local', ua)); reset role;
  rep := rep || pg_temp.chk(t like '%já tem conta no sistema%', 'não emite link de onboarding para e-mail que já tem conta');

  -- ============ 6) paciente: cadastro novo
  set local role anon; perform pg_temp.as_anon(10);
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac('{"main_complaint":"dor no joelho"}')::text)); rep := rep || pg_temp.chk(t like '%dados de saúde%', 'informar o motivo do atendimento sem autorizar dados de saúde é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, '''')', pg_temp.pac()::text)); rep := rep || pg_temp.chk(t like '%termo de tratamento%', 'sem aceite do termo é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac('{"emergency_phone":"123"}')::text)); rep := rep || pg_temp.chk(t like '%emergência inválido%', 'telefone de emergência inválido é recusado');
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac('{"emergency_name":""}')::text)); rep := rep || pg_temp.chk(t like '%contato de emergência%', 'contato de emergência é obrigatório');
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac('{"birth_date":"2999-01-01"}')::text)); rep := rep || pg_temp.chk(t like '%nascimento válida%', 'data de nascimento no futuro é recusada');
  r := public.onboarding_submit_patient(pg_temp.pac('{"main_complaint":"dor no joelho ao subir escadas"}'), 'v1', true); reset role;
  rep := rep || pg_temp.chk(r ->> 'status' = 'created', 'cadastro de paciente concluído');
  select id into per from public.people where document_number = '11144477735';
  rep := rep || pg_temp.chk(per is not null and (select count(*) from public.person_kinds where person_id = per and kind = 'patient') = 1 and (select origin from public.people where id = per) = 'onboarding_paciente' and (select registration_status from public.people where id = per) = 'ativo', 'paciente criado em Pessoas (tipo paciente, origem onboarding)');
  rep := rep || pg_temp.chk((select emergency_name from public.person_intake where person_id = per) = 'Marta Souza' and (select health_consent_at from public.person_intake where person_id = per) is not null and (select address_reference from public.person_intake where person_id = per) = 'portão azul', 'ficha: emergência, referência do endereço e consentimento de saúde registrados');
  rep := rep || pg_temp.chk((select count(*) from public.invitations where email = 'paciente.s25@s25.local' and role = 'member' and person_id = per and accepted_at is null) = 1, 'convite de acesso (paciente) ligado à pessoa');
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (u_new2, 'authenticated', 'authenticated', 'paciente.s25@s25.local', now());
  rep := rep || pg_temp.chk((select person_id from public.user_accounts where user_id = u_new2) = per and (select count(*) from public.role_assignments where user_id = u_new2 and role = 'member') = 1 and (select display_name from public.user_accounts where user_id = u_new2) = 'Paulo', 'ao confirmar: conta do paciente ligada ao cadastro (nome do cadastro no cabeçalho)');
  set local role authenticated; perform pg_temp.as_user(u_new2); select count(*) into n from public.person_intake; rep := rep || pg_temp.chk(n = 1, 'o paciente lê a própria ficha'); select count(*) into n from public.person_bank_info; rep := rep || pg_temp.chk(n = 0, 'e não vê dados bancários de ninguém');
  perform pg_temp.as_user(u_phy); select count(*) into n from public.person_intake; rep := rep || pg_temp.chk(n = 0, 'um fisioterapeuta NÃO lê a ficha de saúde de um paciente que não é dele pela API'); reset role;

  -- ============ 7) paciente com e-mail JÁ cadastrado: nada muda até confirmar
  insert into public.people (org_id, unit_id, full_name, city) values (v_org, ua, 'Lead Antigo Teste S25', 'Cidade do Lead') returning id into p_lead;
  insert into public.person_kinds (person_id, kind) values (p_lead, 'lead');
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, p_lead, 'email', 'lead.s25@s25.local', true);
  set local role anon; perform pg_temp.as_anon(11);
  r := public.onboarding_submit_patient(pg_temp.pac('{"email":"lead.s25@s25.local","full_name":"Lead Antigo Teste S25","cpf":"390.533.447-05","city":"Cidade Nova"}'), 'v1'); reset role;
  rep := rep || pg_temp.chk((select document_number from public.people where id = p_lead) is null and (select city from public.people where id = p_lead) = 'Cidade do Lead' and not exists (select 1 from public.person_intake where person_id = p_lead), 'cadastro que já existia NÃO é alterado no envio (ninguém confirmou o e-mail ainda)');
  rep := rep || pg_temp.chk((select status from public.onboarding_submissions where person_id = p_lead) = 'awaiting_confirmation' and (select payload from public.onboarding_submissions where person_id = p_lead) is not null, 'os dados ficam retidos aguardando a confirmação do e-mail');
  rep := rep || pg_temp.chk((select person_id from public.invitations where email = 'lead.s25@s25.local' and role = 'member' and accepted_at is null) = p_lead, 'o convite aponta para o cadastro existente');
  insert into auth.users (id, aud, role, email, email_confirmed_at) values (gen_random_uuid(), 'authenticated', 'authenticated', 'lead.s25@s25.local', now());
  select city into o_city from public.people where id = p_lead;
  rep := rep || pg_temp.chk((select document_number from public.people where id = p_lead) is null, 'CPF que já pertence a OUTRA pessoa não é aplicado ao cadastro existente');
  rep := rep || pg_temp.chk((select city from public.people where id = p_lead) = 'Cidade do Lead' and (select birth_date from public.people where id = p_lead) = date '1950-03-02' and (select preferred_name from public.people where id = p_lead) = 'Paulo', 'cidade existente mantida; data de nascimento e preferência de nome vazias foram preenchidas');
  rep := rep || pg_temp.chk((select count(*) from public.person_kinds where person_id = p_lead and kind = 'patient') = 1 and (select count(*) from public.person_kinds where person_id = p_lead and kind = 'lead') = 1 and exists (select 1 from public.person_intake where person_id = p_lead and emergency_name = 'Marta Souza'), 'passa a ser também paciente (continua lead) e a ficha é criada');
  rep := rep || pg_temp.chk((select status from public.onboarding_submissions where person_id = p_lead) = 'applied' and (select payload from public.onboarding_submissions where person_id = p_lead) is null, 'envio marcado como aplicado e os dados retidos são apagados');
  -- CPF de outra pessoa (outro e-mail): cadastro novo pendente, sem CPF e sem vínculo
  set local role anon; perform pg_temp.as_anon(12);
  r := public.onboarding_submit_patient(pg_temp.pac('{"email":"clone.s25@s25.local","full_name":"Clone Do Paulo Teste S25","cpf":"111.444.777-35"}'), 'v1'); reset role;
  select id into per2 from public.people where full_name = 'Clone Do Paulo Teste S25';
  rep := rep || pg_temp.chk(per2 is not null and per2 <> per and (select document_number from public.people where id = per2) is null and (select registration_status from public.people where id = per2) = 'pendente' and (select notes from public.people where id = per2) like '%possível duplicidade%', 'CPF já usado por outra pessoa: cadastro novo PENDENTE, sem CPF e com aviso de duplicidade (nada de vínculo)');
  -- e-mail que já tem conta
  set local role anon; perform pg_temp.as_anon(13);
  t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac('{"email":"paciente.s25@s25.local","cpf":"529.982.247-25","full_name":"Paulo De Novo Teste S25"}')::text)); rep := rep || pg_temp.chk(t like '%já tem acesso ao sistema%', 'e-mail que já tem conta é orientado a entrar / recuperar a senha');
  -- isca anti-robô
  r := public.onboarding_submit_patient(pg_temp.pac('{"email":"robo.s25@s25.local","full_name":"Robo Teste S25","cpf":"529.982.247-25"}'), 'v1', false, 'spam'); reset role;
  rep := rep || pg_temp.chk(not exists (select 1 from public.people where full_name = 'Robo Teste S25'), 'isca anti-robô no paciente: nada é gravado');
  -- limite por IP: as 6 primeiras tentativas (que terminam normalmente) passam e a 7ª é barrada
  set local role anon; perform pg_temp.as_anon(99); s := null;
  for i in 1..7 loop
    t := pg_temp.err(format('select public.onboarding_submit_patient(%L::jsonb, ''v1'')', pg_temp.pac(jsonb_build_object('email', 'lim' || i || '@s25.local', 'cpf', '529.982.247-25', 'full_name', 'Limite Teste S25'))::text));
    if t like 'P0429%' then s := 'limitou na tentativa ' || i; exit; end if;
  end loop;
  reset role; rep := rep || pg_temp.chk(s = 'limitou na tentativa 7', 'limite por IP: a 7ª tentativa em 10 minutos é barrada (' || coalesce(s, 'sem limite') || ')');

  -- ============ 8) primeiro acesso: só quem tem cadastro
  insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'So Cadastro Teste S25') returning id into per2;
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, per2, 'email', 'so.cadastro.s25@s25.local', true);
  insert into public.invitations (org_id, email, role, unit_id, invited_by) values (v_org, 'convidado.s25@s25.local', 'physio', ua, u_mgr);
  set local role anon; perform pg_temp.as_anon(20);
  rep := rep || pg_temp.chk(public.first_access_email_status('nao.existe.s25@s25.local') = 'not_found', 'e-mail que não está no cadastro = not_found');
  rep := rep || pg_temp.chk(public.first_access_email_status(' So.Cadastro.S25@s25.local ') = 'registered_no_access', 'cadastrado mas sem acesso liberado = registered_no_access (ignora maiúsculas e espaços)');
  rep := rep || pg_temp.chk(public.first_access_email_status('convidado.s25@s25.local') = 'invited', 'com convite aberto = invited');
  rep := rep || pg_temp.chk(public.first_access_email_status('conta.existente.s25@s25.local') = 'has_account', 'conta já confirmada = has_account');
  t := pg_temp.err('select public.first_access_email_status(''sem-arroba'')'); rep := rep || pg_temp.chk(t like '%E-mail inválido%', 'e-mail inválido é recusado');
  s := null; perform pg_temp.as_anon(98);
  for i in 1..21 loop
    t := pg_temp.err('select public.first_access_email_status(''nao.existe.s25@s25.local'')'); if t like 'P0429%' then s := 'limitou na tentativa ' || i; exit; end if;
  end loop;
  reset role; rep := rep || pg_temp.chk(s = 'limitou na tentativa 21', 'limite por IP: a 21ª consulta em 10 minutos é barrada (' || coalesce(s, 'sem limite') || ')');

  -- ============ 9) anônimo não lê nada das tabelas novas
  set local role anon; perform pg_temp.as_anon(30);
  t := pg_temp.err('select count(*) from public.person_intake'); rep := rep || pg_temp.chk(t like '42501%', 'anônimo não lê a ficha do paciente');
  t := pg_temp.err('select count(*) from public.person_bank_info'); rep := rep || pg_temp.chk(t like '42501%', 'anônimo não lê dados bancários');
  t := pg_temp.err('select count(*) from public.onboarding_links'); rep := rep || pg_temp.chk(t like '42501%', 'anônimo não lê os links');
  t := pg_temp.err('select count(*) from public.onboarding_submissions'); rep := rep || pg_temp.chk(t like '42501%', 'anônimo não lê os envios');
  t := pg_temp.err(format('select public.onboarding_link_create(%L, null, %L)', 'x@s25.local', ua)); rep := rep || pg_temp.chk(t like '42501%', 'anônimo não cria links');
  reset role;

  raise exception E'RELATORIO_S25_ONBOARDING (transação desfeita):%', rep;
end $$;
