-- NOVO — N22: o pré-request da API precisa ser executável pelos três papéis da API (anon, authenticated, service_role); sem isso toda chamada pública falha.
-- E com x-org/x-view-as enviados por anônimo, a função NÃO dá acesso a nada (sem usuário, nada é validado nem trocado). Transação desfeita. Somente Dev/teste.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
do $$
declare rep text := ''; alfa uuid := gen_random_uuid(); n int;
begin
  rep := rep || pg_temp.chk(has_function_privilege('anon', 'public.hp_pre_request()', 'execute'), 'anon pode executar o pré-request');
  rep := rep || pg_temp.chk(has_function_privilege('authenticated', 'public.hp_pre_request()', 'execute'), 'authenticated pode executar o pré-request');
  rep := rep || pg_temp.chk(has_function_privilege('service_role', 'public.hp_pre_request()', 'execute'), 'service_role pode executar o pré-request');
  set local role anon;
  perform set_config('request.headers', json_build_object('x-org', alfa::text)::text, true);
  perform public.hp_pre_request();                                                    -- não levanta erro e não ativa organização para anônimo
  rep := rep || pg_temp.chk(coalesce(nullif(current_setting('app.active_org', true), ''), '') = '', 'anônimo com x-org forjado não ativa organização');
  perform set_config('request.headers', json_build_object('x-view-as', gen_random_uuid()::text)::text, true);
  rep := rep || pg_temp.chk(pg_temp.err('select public.hp_pre_request()') like '42501%', 'anônimo com x-view-as inventado é recusado (nunca troca de identidade)');
  rep := rep || pg_temp.chk(public.org_brand_for_host('endereco-que-nao-existe.localhost') = jsonb_build_object('found', false), 'marca por endereço desconhecido: não encontrado (anônimo)');
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.org_domains') like '42501%', 'tabela de domínios segue fechada para anônimo');
  reset role;
  raise exception 'RELATORIO_N22%', rep;
end $$;
