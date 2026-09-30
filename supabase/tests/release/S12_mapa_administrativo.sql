-- RELEASE v1 — S12: mapa do Brasil do Administrativo (migration 064): adm_geo (distribuição do cadastro central por estado) e adm_directory com o filtro por estado.
-- Transação sempre desfeita. Unidades NOVAS (ua, ub) isolam os números; o gestor da organização também é testado contra o total da organização.
--   Unidade A: PF em SP ×3 (uma é a principal de uma mesclagem), PF em MG ×1, PF sem UF ×1, PJ em SP ×1 (+ uma PF arquivada e uma mesclada em SP, que NÃO contam) → 6 cadastros: SP 4 (pf 3, pj 1), MG 1, sem localização 1.
--   Unidade B: PF no RJ ×2.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
do $$
declare
  v_org uuid; ua uuid; ub uuid; u_mgr uuid := gen_random_uuid(); u_uma uuid := gen_random_uuid(); u_umb uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid();
  pm uuid; ea uuid; g jsonb; g2 jsonb; d jsonb; n bigint; ok boolean; rep text := ''; s jsonb; sumst bigint; arch uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade A (teste S12)', 'teste-a-s12') returning id into ua;
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste S12)', 'teste-b-s12') returning id into ub;
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@s12.local'),(u_uma,'authenticated','authenticated','uma@s12.local'),(u_umb,'authenticated','authenticated','umb@s12.local'),(u_phy,'authenticated','authenticated','phy@s12.local');
  insert into public.user_accounts (user_id, org_id, person_id, status) values (u_mgr, v_org, null, 'active'),(u_uma, v_org, null, 'active'),(u_umb, v_org, null, 'active'),(u_phy, v_org, null, 'active');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_uma, 'unit_manager', ua),(v_org, u_umb, 'unit_manager', ub),(v_org, u_phy, 'physio', ua);

  insert into public.people (org_id, unit_id, full_name, city, state_uf) values (v_org, ua, 'SP Um S12', 'São Paulo', 'SP'),(v_org, ua, 'SP Dois S12', 'Santos', 'SP'),(v_org, ua, 'MG Um S12', 'Belo Horizonte', 'MG'),(v_org, ua, 'Sem UF S12', null, null);
  insert into public.people (org_id, unit_id, full_name, state_uf, archived_at) values (v_org, ua, 'Arquivada SP S12', 'SP', now());
  insert into public.people (org_id, unit_id, full_name, state_uf) values (v_org, ua, 'Principal SP S12', 'SP') returning id into pm;
  insert into public.people (org_id, unit_id, full_name, state_uf, merged_into_id) values (v_org, ua, 'Mesclada SP S12', 'SP', pm);
  -- a "Principal SP" conta (não está arquivada nem mesclada): ajusto os números esperados abaixo (SP = 4 PF + 1 PJ)
  insert into public.legal_entities (org_id, legal_name, city, state_uf) values (v_org, 'Empresa SP S12', 'São Paulo', 'SP') returning id into ea;
  insert into public.legal_entity_units (legal_entity_id, unit_id) values (ea, ua);
  insert into public.people (org_id, unit_id, full_name, city, state_uf) values (v_org, ub, 'RJ Um S12', 'Niterói', 'RJ'),(v_org, ub, 'RJ Dois S12', 'Rio de Janeiro', 'RJ');

  -- ============ gestor da organização, unidade A
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true); set local role authenticated;
  g := public.adm_geo(ua);
  rep := rep || pg_temp.chk((g ->> 'total')::int = 6 and (g ->> 'sem_localizacao')::int = 1, format('unidade A: 6 cadastros (5 PF ativas — a arquivada e a mesclada ficam de fora — + 1 PJ), 1 sem localização (obtido total %s, sem %s)', g ->> 'total', g ->> 'sem_localizacao'));
  select x into s from jsonb_array_elements(g -> 'by_state') x where x ->> 'uf' = 'SP';
  rep := rep || pg_temp.chk((s ->> 'count')::int = 4 and (s ->> 'pf')::int = 3 and (s ->> 'pj')::int = 1, format('SP: 4 cadastros = 3 PF + 1 PJ (obtido %s)', s));
  rep := rep || pg_temp.chk((s ->> 'pct')::numeric = round(4 * 100.0 / 6, 1), format('percentual de SP = 4 de 6 = %s%% (obtido %s)', round(4 * 100.0 / 6, 1), s ->> 'pct'));
  select x into s from jsonb_array_elements(g -> 'by_state') x where x ->> 'uf' = 'MG';
  rep := rep || pg_temp.chk((s ->> 'count')::int = 1 and (s ->> 'pj')::int = 0, 'MG: 1 cadastro');
  select coalesce(sum((x ->> 'count')::int), 0) into sumst from jsonb_array_elements(g -> 'by_state') x;
  rep := rep || pg_temp.chk(sumst + (g ->> 'sem_localizacao')::int = (g ->> 'total')::int, 'soma por estado + sem localização = total (nenhum cadastro se perde nem se repete)');
  rep := rep || pg_temp.chk(not exists (select 1 from jsonb_array_elements(g -> 'by_state') x where x ->> 'uf' = 'RJ'), 'a unidade B não aparece no recorte da unidade A');
  rep := rep || pg_temp.chk((g ->> 'basis') ilike '%sem localização%', 'a base de cálculo é explicada');

  g2 := public.adm_geo(ub);
  rep := rep || pg_temp.chk((g2 ->> 'total')::int = 2 and ((g2 -> 'by_state' -> 0) ->> 'uf') = 'RJ' and ((g2 -> 'by_state' -> 0) ->> 'count')::int = 2 and ((g2 -> 'by_state' -> 0) ->> 'pct')::numeric = 100.0, 'unidade B: 2 cadastros, todos no RJ (100,0%)');
  g2 := public.adm_geo(null);
  rep := rep || pg_temp.chk((g2 ->> 'total')::int >= 8, 'gestor da organização sem unidade: enxerga a organização inteira (inclui A e B)');
  select x into s from jsonb_array_elements(g2 -> 'by_state') x where x ->> 'uf' = 'RJ';
  rep := rep || pg_temp.chk((s ->> 'count')::int >= 2, 'e o RJ da unidade B está lá');

  -- ============ diretório: filtro por estado
  d := public.adm_directory(null, null, null, ua, null, false, 'name', 'asc', 0, 100, 'SP');
  rep := rep || pg_temp.chk((d ->> 'total')::int = 4 and not exists (select 1 from jsonb_array_elements(d -> 'rows') r where r ->> 'uf' <> 'SP'), format('lista da unidade A filtrada por SP: 4 registros, todos de SP (obtido %s)', d ->> 'total'));
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(d -> 'rows') r where r ->> 'type' = 'pj') and exists (select 1 from jsonb_array_elements(d -> 'rows') r where r ->> 'type' = 'pf'), 'a lista por UF traz pessoa física e jurídica juntas (igual ao mapa)');
  d := public.adm_directory(null, null, null, ua, null, false, 'name', 'asc', 0, 100, 'sp');
  rep := rep || pg_temp.chk((d ->> 'total')::int = 4, 'a UF pode vir em minúsculas');
  d := public.adm_directory(null, null, null, ua, null, false, 'name', 'asc', 0, 100, null);
  rep := rep || pg_temp.chk((d ->> 'total')::int = 6, 'sem UF a lista da unidade A volta a ter os 6');
  d := public.adm_directory(null, null, null, ub, null, false, 'name', 'asc', 0, 100, 'SP');
  rep := rep || pg_temp.chk((d ->> 'total')::int = 0, 'estado sem cadastro na unidade: lista vazia (nunca cadastro de outra unidade)');
  d := public.adm_directory(null, null, null, null, null, false, 'name', 'asc', 0, 100, '  rj ');
  rep := rep || pg_temp.chk((d ->> 'total')::int >= 2, 'UF com espaços/minúsculas é normalizada');

  -- ============ gestor de unidade: só a própria unidade, mesmo sem filtro de unidade
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', u_uma, 'role','authenticated')::text, true); set local role authenticated;
  g := public.adm_geo(null);
  rep := rep || pg_temp.chk((g ->> 'total')::int = 6 and not exists (select 1 from jsonb_array_elements(g -> 'by_state') x where x ->> 'uf' = 'RJ'), format('gestor da unidade A sem filtro de unidade: só os 6 da unidade A (obtido %s), nada da B', g ->> 'total'));
  d := public.adm_directory(null, null, null, null, null, false, 'name', 'asc', 0, 100, null);
  rep := rep || pg_temp.chk((d ->> 'total')::int = 6 and not exists (select 1 from jsonb_array_elements(d -> 'rows') r where r ->> 'name' like 'RJ%'), format('a lista do gestor da unidade A também fica restrita à unidade (obtido %s) — o clique no mapa e o número batem', d ->> 'total'));
  d := public.adm_directory(null, null, null, null, null, false, 'name', 'asc', 0, 100, 'RJ');
  rep := rep || pg_temp.chk((d ->> 'total')::int = 0, 'gestor da unidade A pedindo RJ: vazio (o RJ é da unidade B)');
  ok := false; begin perform public.adm_geo(ub); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'gestor da unidade A NÃO consulta o mapa da unidade B (42501)');

  reset role; perform set_config('request.jwt.claims', json_build_object('sub', u_umb, 'role','authenticated')::text, true); set local role authenticated;
  g := public.adm_geo(null);
  rep := rep || pg_temp.chk((g ->> 'total')::int = 2, 'gestor da unidade B: só os 2 da unidade B');

  -- ============ sem permissão
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.adm_geo(null); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'fisioterapeuta (sem acesso ao Administrativo) não consulta o mapa (42501)');
  ok := false; begin perform public.adm_directory(null, null, null, null, null, false, 'name', 'asc', 0, 25, 'SP'); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'nem a lista por estado (42501)');
  reset role; set local role anon;
  ok := false; begin perform public.adm_geo(null); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'anon não executa adm_geo');
  ok := false; begin perform public.adm_directory(null, null, null, null, null, false, 'name', 'asc', 0, 25, null); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'anon não executa adm_directory');
  reset role;

  -- ============ a assinatura antiga foi substituída (sem função duplicada/ambígua)
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'adm_directory';
  rep := rep || pg_temp.chk(n = 1, format('existe UMA só função adm_directory (sem sobrecarga ambígua) (obtido %s)', n));

  raise exception E'RELATORIO_S12_MAPA_ADMINISTRATIVO (transação desfeita):%', rep;
end $$;
