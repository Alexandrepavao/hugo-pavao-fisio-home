-- Distribuição geográfica do CRM: (1) cidades escritas de jeitos diferentes ("São Paulo", "sao paulo", "Saopaulo") passam a contar como UMA só, e
-- (2) crm_geo_contacts lista os contatos (nome, telefone, e-mail) de uma cidade, para abrir ao clicar nela. Só funções; nenhum dado é alterado.

-- chave de comparação da cidade: minúsculas, sem acento, sem espaços e símbolos
create or replace function private.geo_city_key(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z]', '', 'g'), '')
$$;
revoke all on function private.geo_city_key(text) from public, anon, authenticated;

-- contatos do CRM com o local de cada um (mesma regra da distribuição: pessoa, ou a empresa nos funis de empresas); cada contato uma vez
create or replace function private.crm_geo_base(p_kind text, p_unit uuid) returns table (
  k text, person_id uuid, name text, city text, uf text, country text, phone text, email text, kinds text[], is_company boolean)
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[];
begin
  u := private.crm_units(p_unit);
  return query
  select x.k, min(x.person_id::text)::uuid, min(x.name), min(x.city), min(x.uf), min(x.country), min(x.phone), min(x.email), array_agg(distinct x.kind order by x.kind), bool_or(x.is_company)
    from (
      select case when pl.kind = 'companies' and op.legal_entity_id is not null then 'e:' || op.legal_entity_id::text else 'p:' || op.person_id::text end k,
             op.person_id, pl.kind,
             (pl.kind = 'companies' and op.legal_entity_id is not null) is_company,
             case when pl.kind = 'companies' and op.legal_entity_id is not null then coalesce(le.trade_name, le.legal_name) else pe.full_name end name,
             nullif(btrim(coalesce(case when pl.kind = 'companies' and op.legal_entity_id is not null then le.city else pe.city end, '')), '') city,
             case when pl.kind = 'companies' and op.legal_entity_id is not null then le.state_uf else pe.state_uf end uf,
             case when pl.kind = 'companies' and op.legal_entity_id is not null then le.country else coalesce(pe.country, 'BR') end country,
             case when pl.kind = 'companies' and op.legal_entity_id is not null then coalesce(le.phone, le.whatsapp)
                  else (select c.value from public.person_contacts c where c.person_id = pe.id and c.type in ('phone', 'whatsapp') order by c.is_primary desc, c.value limit 1) end phone,
             case when pl.kind = 'companies' and op.legal_entity_id is not null then coalesce(le.email_general, le.email_finance)
                  else (select c.value from public.person_contacts c where c.person_id = pe.id and c.type = 'email' order by c.is_primary desc, c.value limit 1) end email
        from public.opportunities op
        join public.pipelines pl on pl.id = op.pipeline_id
        left join public.people pe on pe.id = op.person_id
        left join public.legal_entities le on le.id = op.legal_entity_id
       where op.org_id = private.current_org() and op.unit_id = any (u) and (p_kind is null or pl.kind = p_kind)
         and (pe.id is null or (pe.archived_at is null and pe.merged_into_id is null))) x
   group by x.k;
end $$;
revoke all on function private.crm_geo_base(text, uuid) from public, anon, authenticated;

create or replace function public.crm_geo_distribution(p_kind text default null, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales','finance']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  with c as (select * from private.crm_geo_base(p_kind, p_unit)),
  st as (select uf, count(*) n from c where uf is not null and coalesce(country, 'BR') = 'BR' group by uf),
  v as (select private.geo_city_key(city) ckey, uf, initcap(city) city, count(*) n from c
         where city is not null and uf is not null and coalesce(country, 'BR') = 'BR' and private.geo_city_key(city) is not null group by 1, 2, 3),
  ct as (select ckey, uf, (array_agg(city order by n desc, (city ~* '[áàâãéêíóôõúç]') desc, city))[1] city, sum(n)::int n from v group by ckey, uf order by sum(n) desc, 3 limit 60),
  co as (select country, count(*) n from c where coalesce(country, 'BR') <> 'BR' group by 1)
  select jsonb_build_object(
    'total', (select count(*) from c),
    'sem_localizacao', (select count(*) from c where uf is null and city is null and coalesce(country, 'BR') = 'BR'),
    'by_state', (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'count', n, 'pct', round(n * 100.0 / nullif((select count(*) from c), 0), 1)) order by n desc, uf), '[]'::jsonb) from st),
    'by_city', (select coalesce(jsonb_agg(jsonb_build_object('city', city, 'uf', uf, 'count', n, 'key', ckey) order by n desc, city), '[]'::jsonb) from ct),
    'by_country_other', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'count', n) order by n desc), '[]'::jsonb) from co))
  into res;
  return res;
end $$;
revoke all on function public.crm_geo_distribution(text, uuid) from public, anon;
grant execute on function public.crm_geo_distribution(text, uuid) to authenticated;

-- contatos de uma cidade (p_city_key = a "key" devolvida em by_city; p_uf obrigatório)
create or replace function public.crm_geo_contacts(p_city_key text, p_uf text, p_kind text default null, p_unit uuid default null) returns table (
  person_id uuid, full_name text, phone text, email text, city text, state_uf text, kinds text[], is_company boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales','finance']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_city_key, '')), '') is null or nullif(btrim(coalesce(p_uf, '')), '') is null then raise exception 'informe a cidade e o estado'; end if;
  return query
  select b.person_id, b.name, b.phone, b.email, initcap(b.city), b.uf, b.kinds, b.is_company
    from private.crm_geo_base(p_kind, p_unit) b
   where private.geo_city_key(b.city) = p_city_key and b.uf = upper(btrim(p_uf)) and coalesce(b.country, 'BR') = 'BR'
   order by b.name
   limit 500;
end $$;
revoke all on function public.crm_geo_contacts(text, text, text, uuid) from public, anon;
grant execute on function public.crm_geo_contacts(text, text, text, uuid) to authenticated;
