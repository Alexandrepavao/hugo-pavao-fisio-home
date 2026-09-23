-- HP Group Hub — 028 geo_distribution(): trata cadastro de outro país separado de "sem localização".
-- Antes, alguém com country<>'BR' e state_uf nulo (o campo é uma UF brasileira, não serve para endereço
-- estrangeiro) caía dentro de "sem_localizacao", mesmo tendo localização — só não brasileira. Agora:
-- by_state = só Brasil; by_country_other = agrupado por país, exclui Brasil; sem_localizacao = ninguém
-- (nem cidade nem UF nem país diferente de BR informado).
create or replace function public.geo_distribution(p_kind public.person_kind, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; v_total bigint; v_no_loc bigint; v_by_state jsonb; v_by_city jsonb; v_by_country jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales','finance']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  u := private.dash_units(p_unit);
  select count(*) into v_total from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = p_kind
    where p.org_id = private.current_org() and p.archived_at is null and p.merged_into_id is null and (p.unit_id is null or p.unit_id = any (u));
  select count(*) into v_no_loc from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = p_kind
    where p.org_id = private.current_org() and p.archived_at is null and p.merged_into_id is null and (p.unit_id is null or p.unit_id = any (u))
      and p.state_uf is null and p.city is null and coalesce(p.country, 'BR') = 'BR';
  select coalesce(jsonb_agg(jsonb_build_object('uf', state_uf, 'count', n, 'pct', round(n * 100.0 / nullif(v_total, 0), 1)) order by n desc), '[]') into v_by_state
    from (select state_uf, count(*) n from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = p_kind
            where p.org_id = private.current_org() and p.archived_at is null and p.merged_into_id is null and (p.unit_id is null or p.unit_id = any (u))
              and p.state_uf is not null and coalesce(p.country, 'BR') = 'BR' group by 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'uf', state_uf, 'count', n) order by n desc), '[]') into v_by_city
    from (select city, state_uf, count(*) n from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = p_kind
            where p.org_id = private.current_org() and p.archived_at is null and p.merged_into_id is null and (p.unit_id is null or p.unit_id = any (u))
              and p.city is not null and coalesce(p.country, 'BR') = 'BR' group by 1, 2 order by 3 desc limit 20) x;
  select coalesce(jsonb_agg(jsonb_build_object('country', country, 'count', n) order by n desc), '[]') into v_by_country
    from (select country, count(*) n from public.people p join public.person_kinds k on k.person_id = p.id and k.kind = p_kind
            where p.org_id = private.current_org() and p.archived_at is null and p.merged_into_id is null and (p.unit_id is null or p.unit_id = any (u))
              and coalesce(p.country, 'BR') <> 'BR' group by 1) x;
  return jsonb_build_object('total', v_total, 'sem_localizacao', v_no_loc, 'by_state', v_by_state, 'by_city', v_by_city, 'by_country_other', v_by_country);
end $$;
