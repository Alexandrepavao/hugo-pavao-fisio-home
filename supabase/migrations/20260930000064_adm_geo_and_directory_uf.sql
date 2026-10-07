-- HP Group Hub — 064: mapa do Brasil do Administrativo. (1) adm_geo: distribuição do cadastro central (PF + PJ) por estado, no MESMO escopo e regras do
-- painel (adm_dashboard); (2) adm_directory (definição da 047, com as colunas opcionais e a permissão de campo) e adm_export ganham o filtro por estado
-- (p_uf), para o clique no mapa abrir a lista correspondente; (3) a listagem passa a usar o escopo de unidades do painel (adm_scope_units): gestor/administrador
-- da organização vê tudo; gestor de unidade/comercial só as próprias unidades — antes, sem filtro de unidade, a listagem não restringia por unidade.
-- Só leitura; nada é gravado. Nenhuma tabela nova. As assinaturas antigas são removidas (senão a chamada com argumentos padrão ficaria ambígua).

drop function if exists public.adm_export(text, text, public.person_kind, uuid, text, boolean, text[]);
drop function if exists public.adm_export(text, text, public.person_kind, uuid, text, boolean, text[], text);
drop function if exists public.adm_directory(text, text, public.person_kind, uuid, text, boolean, text, text, int, int);
drop function if exists public.adm_directory(text, text, public.person_kind, uuid, text, boolean, text, text, int, int, text);

create or replace function public.adm_directory(
  p_search text default null, p_type text default null, p_kind public.person_kind default null,
  p_unit uuid default null, p_status text default null, p_incomplete_only boolean default false,
  p_sort text default 'created_at', p_dir text default 'desc', p_page int default 0, p_page_size int default 25,
  p_uf text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); u uuid[]; v_full boolean := private.can_adm_sensitive(); v_all boolean; v_uf text := nullif(upper(btrim(coalesce(p_uf, ''))), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), ''); v_rows jsonb; v_total bigint;
  v_sort text; v_dir text := case when lower(coalesce(p_dir,'desc')) = 'asc' then 'asc' else 'desc' end;
  v_page_size int := least(greatest(coalesce(p_page_size, 25), 1), 100); v_page int := greatest(coalesce(p_page, 0), 0);
begin
  if not private.can_adm(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  u := private.adm_scope_units(p_unit);
  v_all := (p_unit is null and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
  v_sort := case when p_sort in ('name','created_at','city') then p_sort else 'created_at' end;

  with base as (
    (
      select p.id, 'pf'::text as type, p.full_name as name, p.document_number as doc,
        (select c.value from public.person_contacts c where c.person_id = p.id and c.type = 'email' order by c.is_primary desc limit 1) as email,
        (select c.value from public.person_contacts c where c.person_id = p.id and c.type in ('phone','whatsapp') order by c.is_primary desc limit 1) as phone,
        p.city, p.state_uf as uf, p.registration_status as status, p.created_at,
        (select array_agg(distinct un.name) from public.units un where un.id = p.unit_id or un.id in (select unit_id from public.person_units pu where pu.person_id = p.id)) as unit_names,
        private.person_is_complete(p.id) as complete,
        coalesce((select array_agg(k.kind::text) from public.person_kinds k where k.person_id = p.id), '{}') as kinds,
        null::text as trade_name, p.origin, null::text as tax_regime, null::text as state_registration, null::text as email_finance
      from public.people p
      where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
        and (v_all or p.unit_id = any(u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any(u)))
        and (v_uf is null or p.state_uf = v_uf)
        and (p_status is null or p.registration_status = p_status)
        and (p_kind is null or exists (select 1 from public.person_kinds k where k.person_id = p.id and k.kind = p_kind))
        and (v_search is null or p.full_name ilike '%' || v_search || '%'
             or (regexp_replace(v_search, '\D', '', 'g') <> '' and p.document_number like '%' || regexp_replace(v_search, '\D', '', 'g') || '%')
             or exists (select 1 from public.person_contacts c where c.person_id = p.id and (c.value ilike '%' || v_search || '%' or c.normalized ilike '%' || v_search || '%')))
    )
    union all
    (
      select e.id, 'pj'::text as type, e.legal_name as name, e.cnpj as doc,
        e.email_general as email, coalesce(e.whatsapp, e.phone) as phone,
        e.city, e.state_uf as uf, e.registration_status as status, e.created_at,
        (select array_agg(distinct un.name) from public.units un where un.id in (select unit_id from public.legal_entity_units leu where leu.legal_entity_id = e.id)) as unit_names,
        (e.cnpj is not null and e.city is not null and e.state_uf is not null and (e.email_general is not null or e.phone is not null)) as complete,
        '{}'::text[] as kinds,
        e.trade_name, e.origin, e.tax_regime, e.state_registration, e.email_finance
      from public.legal_entities e
      where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
        and (v_all or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any(u)))
        and (v_uf is null or e.state_uf = v_uf)
        and (p_status is null or e.registration_status = p_status)
        and (v_search is null or e.legal_name ilike '%' || v_search || '%' or e.trade_name ilike '%' || v_search || '%'
             or (regexp_replace(v_search, '\D', '', 'g') <> '' and e.cnpj like '%' || regexp_replace(v_search, '\D', '', 'g') || '%')
             or e.email_general ilike '%' || v_search || '%')
    )
  ), filtered as (
    select * from base where (p_type is null or type = p_type) and (not p_incomplete_only or not complete)
  ), counted as (
    select *, count(*) over() as total_count from filtered
    order by
      case when v_sort = 'name' and v_dir = 'asc' then name end asc,
      case when v_sort = 'name' and v_dir = 'desc' then name end desc,
      case when v_sort = 'city' and v_dir = 'asc' then city end asc,
      case when v_sort = 'city' and v_dir = 'desc' then city end desc,
      case when v_sort = 'created_at' and v_dir = 'asc' then created_at end asc,
      case when v_sort = 'created_at' and v_dir = 'desc' then created_at end desc,
      id
    limit v_page_size offset (v_page * v_page_size)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'type', type, 'name', name,
      'document', case when v_full then doc else private.mask_document(doc) end,
      'document_full_available', v_full,
      'email', email, 'phone', phone, 'city', city, 'uf', uf, 'status', status, 'created_at', created_at,
      'units', coalesce(unit_names, '{}'), 'complete', complete, 'kinds', kinds,
      'trade_name', trade_name, 'origin', origin,
      'tax_regime', case when v_full then tax_regime end,
      'state_registration', case when v_full then state_registration end,
      'email_finance', case when v_full then email_finance end
    )), '[]'), coalesce(max(total_count), 0)
    into v_rows, v_total from counted;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_page_size);
end $$;

create or replace function public.adm_export(
  p_search text default null, p_type text default null, p_kind public.person_kind default null,
  p_unit uuid default null, p_status text default null, p_incomplete_only boolean default false,
  p_columns text[] default null, p_uf text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_full boolean := private.can_adm_sensitive(); v_cols text[]; v_acc jsonb := '[]'::jsonb; v_page int := 0; v_res jsonb; v_total bigint;
begin
  if not private.can_adm(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(array_agg(t.k order by t.ord), '{}') into v_cols
    from unnest(coalesce(p_columns, (select array_agg(key order by pos) from private.adm_column_catalog() where default_visible))) with ordinality t(k, ord)
    join private.adm_column_catalog() c on c.key = t.k and ((not c.sensitive) or v_full);
  loop
    v_res := public.adm_directory(p_search, p_type, p_kind, p_unit, p_status, p_incomplete_only, 'name', 'asc', v_page, 100, p_uf);
    v_total := (v_res->>'total')::bigint;
    v_acc := v_acc || (select coalesce(jsonb_agg((select jsonb_object_agg(e.key, e.value) from jsonb_each(r) e where e.key = any (v_cols))), '[]')
                         from jsonb_array_elements(v_res->'rows') r);
    v_page := v_page + 1;
    exit when v_page * 100 >= v_total or v_page >= 50;      -- teto de 5.000 linhas por exportação
  end loop;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id, new_values)
    values (private.current_org(), (select auth.uid()), 'adm_export', 'adm_directory', null, p_unit,
            jsonb_build_object('rows', jsonb_array_length(v_acc), 'total_matching', v_total, 'columns', to_jsonb(v_cols), 'masked_document', not v_full));
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_acc, 'total', v_total, 'truncated', v_total > 5000, 'masked_document', not v_full);
end $$;

create or replace function public.adm_geo(p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); u uuid[] := private.adm_scope_units(p_unit);
  v_all boolean := (p_unit is null and private.has_org_role(array['manager','ops_admin']::public.app_role[])); res jsonb;
begin
  with pf as (
    select p.state_uf uf from public.people p
     where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
       and (v_all or p.unit_id = any (u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any (u)))),
  pj as (
    select e.state_uf uf from public.legal_entities e
     where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
       and (v_all or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any (u)))),
  st as (
    select uf, sum(pf_n)::int pf, sum(pj_n)::int pj from (
      select uf, 1 pf_n, 0 pj_n from pf where uf is not null union all select uf, 0, 1 from pj where uf is not null) x group by uf),
  tot as (select (select count(*) from pf) + (select count(*) from pj) as n, (select count(*) from pf where uf is null) + (select count(*) from pj where uf is null) as sem)
  select jsonb_build_object(
    'total', (select n from tot), 'sem_localizacao', (select sem from tot),
    'by_state', coalesce((select jsonb_agg(jsonb_build_object('uf', uf, 'count', pf + pj, 'pf', pf, 'pj', pj, 'pct', round((pf + pj) * 100.0 / nullif((select n from tot), 0), 1)) order by pf + pj desc, uf) from st), '[]'::jsonb),
    'basis', 'cadastros (PF + PJ) não arquivados e não mesclados, por estado (UF) do cadastro; quem não tem UF informada aparece em “sem localização”. Mesmo escopo de unidade do painel.')
    into res;
  return res;
end $$;

revoke all on function public.adm_directory(text, text, public.person_kind, uuid, text, boolean, text, text, int, int, text), public.adm_export(text, text, public.person_kind, uuid, text, boolean, text[], text), public.adm_geo(uuid) from public, anon;
grant execute on function public.adm_directory(text, text, public.person_kind, uuid, text, boolean, text, text, int, int, text), public.adm_export(text, text, public.person_kind, uuid, text, boolean, text[], text), public.adm_geo(uuid) to authenticated;
