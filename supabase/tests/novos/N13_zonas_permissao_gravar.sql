-- NOVO — N13: quem grava pessoas pela tela (usuário logado, não security definer) consegue gravar zona; regressão da migration 122 corrigida na 127. Transação sempre desfeita. Somente Dev/teste.
--  · criar e editar pessoa (create_person, update direto) com zona válida de qualquer capital liberada: funciona; zona inválida é recusada pelo check (não por permissão)
--  · quem não é logado continua sem acesso direto às funções de checagem
-- (Os testes N08 gravavam como administrador do banco e por isso não pegaram o problema: este grava com o papel do usuário.)
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
do $$
declare
  rep text := ''; v_org uuid; ua uuid; u_mgr uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); r jsonb; pid uuid; t text;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (N13)', 'n13-a') returning id into ua;
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'm@n13.local'), (u_phy, 'authenticated', 'authenticated', 'f@n13.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_mgr, v_org, null, 'Gestor N13'), (u_phy, v_org, null, 'Fisio N13');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null), (v_org, u_phy, 'physio', ua);

  rep := rep || pg_temp.chk(has_function_privilege('authenticated', 'private.zone_valid_any(text)', 'execute') and has_function_privilege('authenticated', 'private.zones_all_valid(text[])', 'execute'), 'usuário logado pode executar as duas funções de checagem de zona');
  rep := rep || pg_temp.chk(not has_function_privilege('anon', 'private.zone_valid_any(text)', 'execute') and not has_function_privilege('anon', 'private.zones_all_valid(text[])', 'execute'), 'anônimo continua sem acesso direto às funções');

  set local role authenticated; perform pg_temp.as_user(u_mgr);
  -- criar pessoa pelo painel (função NÃO security definer)
  r := public.create_person(p_full_name => 'Pessoa Zona N13', p_unit_id => ua, p_kinds => array['lead']::public.person_kind[], p_email => 'zona.n13@n13.local', p_phone => null, p_notes => null, p_force => true); pid := (r ->> 'id')::uuid;
  rep := rep || pg_temp.chk(pid is not null, 'gestor cria pessoa pelo painel (create_person) sem “permission denied”');
  -- editar com zona válida de cada capital e de São Paulo
  rep := rep || pg_temp.chk(pg_temp.err(format('update public.people set city = ''São Paulo'', state_uf = ''SP'', neighborhood = ''Moema'', zone = ''sul'' where id = %L', pid)) is null, 'editar pessoa com zona de São Paulo');
  rep := rep || pg_temp.chk(pg_temp.err(format('update public.people set city = ''Rio de Janeiro'', state_uf = ''RJ'', neighborhood = ''Copacabana'', zone = ''rj-sul'' where id = %L', pid)) is null, 'editar pessoa com zona do Rio de Janeiro');
  rep := rep || pg_temp.chk(pg_temp.err(format('update public.people set city = ''Belo Horizonte'', state_uf = ''MG'', neighborhood = ''Savassi'', zone = ''bh-centrosul'' where id = %L', pid)) is null, 'editar pessoa com regional de Belo Horizonte');
  rep := rep || pg_temp.chk(pg_temp.err(format('update public.people set zone = null where id = %L', pid)) is null and pg_temp.err(format('update public.people set full_name = ''Pessoa Zona N13 B'' where id = %L', pid)) is null, 'tirar a zona e editar outros campos também funcionam');
  t := pg_temp.err(format('update public.people set zone = ''zona-inventada'' where id = %L', pid));
  rep := rep || pg_temp.chk(t like '23514%', 'zona inventada é recusada pelo check (violação de regra, não de permissão)');
  -- (as zonas de atendimento do fisioterapeuta só são gravadas por funções security definer — o usuário não tem UPDATE direto na tabela —, por isso a permissão do check não as afeta)
  reset role;
  raise exception 'RELATORIO_N13%', rep;
end $$;
