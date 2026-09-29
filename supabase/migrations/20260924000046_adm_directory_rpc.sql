-- HP Group Hub — 046 RPCs da planilha administrativa: listagem unificada PF+PJ (paginada, filtrada, ordenada
-- no servidor), indicadores e criação/edição de PJ. Documento mascarado por padrão — completo só pra quem
-- pode private.can_adm_sensitive(). Nunca duas fontes de verdade: lê direto de people/legal_entities.

create or replace function private.mask_document(p_doc text) returns text
language sql immutable set search_path = '' as $$
  select case when p_doc is null or length(regexp_replace(p_doc, '\D', '', 'g')) < 4 then null
    else repeat('•', length(regexp_replace(p_doc, '\D', '', 'g')) - 2) || right(regexp_replace(p_doc, '\D', '', 'g'), 2) end
$$;

-- completude de PF: nome + (email ou telefone) + cidade/UF + documento
create or replace function private.person_is_complete(p_person_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select p.document_number is not null and p.city is not null and p.state_uf is not null
    and exists (select 1 from public.person_contacts c where c.person_id = p.id)
  from public.people p where p.id = p_person_id
$$;

create or replace function public.adm_directory(
  p_search text default null, p_type text default null, p_kind public.person_kind default null,
  p_unit uuid default null, p_status text default null, p_incomplete_only boolean default false,
  p_sort text default 'created_at', p_dir text default 'desc', p_page int default 0, p_page_size int default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); u uuid[]; v_full boolean := private.can_adm_sensitive();
  v_search text := nullif(btrim(coalesce(p_search, '')), ''); v_rows jsonb; v_total bigint;
  v_sort text; v_dir text := case when lower(coalesce(p_dir,'desc')) = 'asc' then 'asc' else 'desc' end;
  v_page_size int := least(greatest(coalesce(p_page_size, 25), 1), 100); v_page int := greatest(coalesce(p_page, 0), 0);
begin
  if not private.can_adm(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  u := case when private.has_org_role(array['manager','ops_admin']::public.app_role[]) then
         (select array_agg(id) from public.units where org_id = v_org and (p_unit is null or id = p_unit))
       else (select array_agg(distinct ra.unit_id) from public.role_assignments ra
               where ra.user_id = (select auth.uid()) and ra.role = any (array['unit_manager','sales']::public.app_role[]) and ra.unit_id is not null and ra.revoked_at is null
                 and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()) and (p_unit is null or ra.unit_id = p_unit)) end;
  v_sort := case when p_sort in ('name','created_at','city') then p_sort else 'created_at' end;

  with base as (
    (
      select p.id, 'pf'::text as type, p.full_name as name, p.document_number as doc,
        (select c.value from public.person_contacts c where c.person_id = p.id and c.type = 'email' order by c.is_primary desc limit 1) as email,
        (select c.value from public.person_contacts c where c.person_id = p.id and c.type in ('phone','whatsapp') order by c.is_primary desc limit 1) as phone,
        p.city, p.state_uf as uf, p.registration_status as status, p.created_at,
        (select array_agg(distinct un.name) from public.units un where un.id = p.unit_id or un.id in (select unit_id from public.person_units pu where pu.person_id = p.id)) as unit_names,
        private.person_is_complete(p.id) as complete,
        coalesce((select array_agg(k.kind::text) from public.person_kinds k where k.person_id = p.id), '{}') as kinds
      from public.people p
      where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
        and (p_unit is null or p.unit_id = any(u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any(u)))
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
        '{}'::text[] as kinds
      from public.legal_entities e
      where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
        and (p_unit is null or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any(u)))
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
      case when v_sort = 'created_at' and v_dir = 'desc' then created_at end desc
    limit v_page_size offset (v_page * v_page_size)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'type', type, 'name', name,
      'document', case when v_full then doc else private.mask_document(doc) end,
      'document_full_available', v_full,
      'email', email, 'phone', phone, 'city', city, 'uf', uf, 'status', status, 'created_at', created_at,
      'units', coalesce(unit_names, '{}'), 'complete', complete, 'kinds', kinds
    )), '[]'), coalesce(max(total_count), 0)
    into v_rows, v_total from counted;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_page_size);
end $$;

create or replace function public.adm_directory_indicators(p_from timestamptz default null, p_to timestamptz default null, p_unit uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); u uuid[];
  v_total bigint; v_pf bigint; v_pj bigint; v_new bigint; v_incomplete bigint;
begin
  if not private.can_adm(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  u := case when private.has_org_role(array['manager','ops_admin']::public.app_role[]) then
         (select array_agg(id) from public.units where org_id = v_org and (p_unit is null or id = p_unit))
       else (select array_agg(distinct ra.unit_id) from public.role_assignments ra
               where ra.user_id = (select auth.uid()) and ra.role = any (array['unit_manager','sales']::public.app_role[]) and ra.unit_id is not null and ra.revoked_at is null
                 and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()) and (p_unit is null or ra.unit_id = p_unit)) end;

  select count(*) into v_pf from public.people p where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
    and (p_unit is null or p.unit_id = any(u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any(u)));
  select count(*) into v_pj from public.legal_entities e where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
    and (p_unit is null or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any(u)));
  v_total := v_pf + v_pj;

  select count(*) into v_new from (
    select p.id from public.people p where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
      and (p_unit is null or p.unit_id = any(u)) and (p_from is null or p.created_at >= p_from) and (p_to is null or p.created_at < p_to)
    union all
    select e.id from public.legal_entities e where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
      and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
  ) x;

  select count(*) into v_incomplete from (
    select p.id from public.people p where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
      and (p_unit is null or p.unit_id = any(u)) and not private.person_is_complete(p.id)
    union all
    select e.id from public.legal_entities e where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
      and not (e.cnpj is not null and e.city is not null and e.state_uf is not null and (e.email_general is not null or e.phone is not null))
  ) x;

  return jsonb_build_object(
    'total', private.metric(v_total, true, 'total de cadastros (pessoas físicas + jurídicas) na unidade/organização'),
    'pf', private.metric(v_pf, true, 'pessoas físicas cadastradas'),
    'pj', private.metric(v_pj, true, 'pessoas jurídicas (empresas) cadastradas'),
    'new_in_period', private.metric(v_new, true, 'cadastros (PF+PJ) criados no período'),
    'incomplete', private.metric(v_incomplete, true, 'cadastros sem os dados mínimos (documento, endereço e um contato)')
  );
end $$;

-- ---------------------------------------------------------------- criação/edição de pessoa jurídica
create or replace function public.legal_entity_upsert(p_id uuid, p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid; v_cnpj text := nullif(regexp_replace(coalesce(p_data->>'cnpj', ''), '\D', '', 'g'), '');
begin
  if not private.can_adm_sensitive() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_data->>'legal_name', ''))) < 2 then raise exception 'Razão social é obrigatória'; end if;
  if v_cnpj is not null and not private.is_valid_cnpj(v_cnpj) then raise exception 'CNPJ com formato inválido'; end if;
  if v_cnpj is not null and exists (select 1 from public.legal_entities where org_id = v_org and cnpj = v_cnpj and merged_into_id is null and id is distinct from p_id) then
    raise exception 'Já existe uma empresa cadastrada com este CNPJ';
  end if;

  if p_id is null then
    insert into public.legal_entities (org_id, cnpj, legal_name, trade_name, state_registration, state_registration_exempt,
        municipal_registration, legal_nature, cnae_main, cnae_secondary, tax_regime, founded_on,
        email_general, email_finance, email_billing, phone, whatsapp, cep, street, street_number, complement, neighborhood,
        city, state_uf, country, registration_status, origin, notes, created_by)
      values (v_org, v_cnpj, btrim(p_data->>'legal_name'), nullif(p_data->>'trade_name',''), nullif(p_data->>'state_registration',''),
        coalesce((p_data->>'state_registration_exempt')::boolean, false), nullif(p_data->>'municipal_registration',''),
        nullif(p_data->>'legal_nature',''), nullif(p_data->>'cnae_main',''),
        coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_data->'cnae_secondary','[]')) x), '{}'),
        nullif(p_data->>'tax_regime',''), nullif(p_data->>'founded_on','')::date,
        nullif(p_data->>'email_general',''), nullif(p_data->>'email_finance',''), nullif(p_data->>'email_billing',''),
        nullif(p_data->>'phone',''), nullif(p_data->>'whatsapp',''), nullif(p_data->>'cep',''), nullif(p_data->>'street',''),
        nullif(p_data->>'street_number',''), nullif(p_data->>'complement',''), nullif(p_data->>'neighborhood',''),
        nullif(p_data->>'city',''), nullif(p_data->>'state_uf',''), coalesce(nullif(p_data->>'country',''), 'BR'),
        coalesce(nullif(p_data->>'registration_status',''), 'ativo'), nullif(p_data->>'origin',''), nullif(p_data->>'notes',''), (select auth.uid()))
      returning id into v_id;
  else
    update public.legal_entities set
      cnpj = v_cnpj, legal_name = btrim(p_data->>'legal_name'), trade_name = nullif(p_data->>'trade_name',''),
      state_registration = nullif(p_data->>'state_registration',''), state_registration_exempt = coalesce((p_data->>'state_registration_exempt')::boolean, false),
      municipal_registration = nullif(p_data->>'municipal_registration',''), legal_nature = nullif(p_data->>'legal_nature',''),
      cnae_main = nullif(p_data->>'cnae_main',''), cnae_secondary = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_data->'cnae_secondary','[]')) x), '{}'),
      tax_regime = nullif(p_data->>'tax_regime',''), founded_on = nullif(p_data->>'founded_on','')::date,
      email_general = nullif(p_data->>'email_general',''), email_finance = nullif(p_data->>'email_finance',''), email_billing = nullif(p_data->>'email_billing',''),
      phone = nullif(p_data->>'phone',''), whatsapp = nullif(p_data->>'whatsapp',''), cep = nullif(p_data->>'cep',''),
      street = nullif(p_data->>'street',''), street_number = nullif(p_data->>'street_number',''), complement = nullif(p_data->>'complement',''),
      neighborhood = nullif(p_data->>'neighborhood',''), city = nullif(p_data->>'city',''), state_uf = nullif(p_data->>'state_uf',''),
      country = coalesce(nullif(p_data->>'country',''), 'BR'), registration_status = coalesce(nullif(p_data->>'registration_status',''), 'ativo'),
      origin = nullif(p_data->>'origin',''), notes = nullif(p_data->>'notes','')
    where id = p_id and org_id = v_org
    returning id into v_id;
    if v_id is null then raise exception 'empresa não encontrada'; end if;
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

grant execute on function public.adm_directory(text, text, public.person_kind, uuid, text, boolean, text, text, int, int) to authenticated;
grant execute on function public.adm_directory_indicators(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.legal_entity_upsert(uuid, jsonb) to authenticated;
grant execute on function private.mask_document(text), private.person_is_complete(uuid) to authenticated;
