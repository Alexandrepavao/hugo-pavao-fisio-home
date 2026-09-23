-- HP Group Hub — 002 Correção de is_staff + funções de pessoas (duplicidade e criação atômica)

-- Papel ativo em QUALQUER escopo (org ou qualquer unidade). Usado para "é da equipe?".
create or replace function private.has_any_role(p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.role_assignments ra
    join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
    where ra.user_id = (select auth.uid())
      and ra.role = any (p_roles)
      and ra.revoked_at is null
      and ra.valid_from <= now()
      and (ra.valid_until is null or ra.valid_until > now())
  )
$$;

create or replace function private.is_staff() returns boolean
language sql stable set search_path = '' as $$
  select private.has_any_role(array['manager','ops_admin','unit_manager','sales','finance','physio','teacher']::public.app_role[])
$$;

create or replace function private.norm_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p is null or regexp_replace(p, '\D', '', 'g') = '' then null
    when length(regexp_replace(p, '\D', '', 'g')) in (10, 11) then '55' || regexp_replace(p, '\D', '', 'g')
    else regexp_replace(p, '\D', '', 'g') end
$$;

-- Candidatos a duplicidade: contato igual (pode ser compartilhado) ou nome semelhante (possível homônimo).
-- Retorna o nome só quando o chamador pode ler a pessoa; caso contrário visible=false.
create or replace function public.find_person_duplicates(p_full_name text, p_emails text[], p_phones text[])
returns table (person_id uuid, full_name text, match_reason text, visible boolean)
language sql stable security definer set search_path = '' as $$
  with me as (
    select private.current_org() as org
    where private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[])
  ),
  by_contact as (
    select distinct p.id, 'contato_igual'::text as reason
    from me
    join public.person_contacts c on c.org_id = me.org
    join public.people p on p.id = c.person_id and p.merged_into_id is null
    where (c.type = 'email' and c.normalized = any (select lower(btrim(x)) from unnest(coalesce(p_emails, '{}')) x where x is not null and btrim(x) <> ''))
       or (c.type in ('phone','whatsapp') and c.normalized = any (select private.norm_phone(x) from unnest(coalesce(p_phones, '{}')) x where private.norm_phone(x) is not null))
  ),
  by_name as (
    select p.id, 'nome_semelhante'::text as reason
    from me
    join public.people p on p.org_id = me.org and p.merged_into_id is null
    where extensions.similarity(lower(p.full_name), lower(p_full_name)) >= 0.6
  ),
  merged as (
    select id, string_agg(distinct reason, '+') as reason from (select * from by_contact union all select * from by_name) u group by id
  )
  select m.id, case when private.can_read_person(m.id) then p.full_name end, m.reason, private.can_read_person(m.id)
  from merged m join public.people p on p.id = m.id
  limit 10
$$;

-- Cria pessoa + tipos + contatos numa única transação (SECURITY INVOKER: RLS se aplica).
-- Sem p_force, havendo candidatos, devolve status 'duplicates' e NÃO cria (decisão explícita do usuário).
create or replace function public.create_person(
  p_full_name text, p_unit_id uuid, p_kinds public.person_kind[],
  p_email text default null, p_phone text default null, p_notes text default null, p_force boolean default false
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid := private.current_org();
  v_id uuid;
  v_dups jsonb;
  v_contact_dup boolean;
begin
  if v_org is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  select jsonb_agg(to_jsonb(d)), coalesce(bool_or(d.match_reason like '%contato_igual%'), false)
    into v_dups, v_contact_dup
    from public.find_person_duplicates(p_full_name, array[p_email], array[p_phone]) d;
  if v_dups is not null and not p_force then
    return jsonb_build_object('status', 'duplicates', 'candidates', v_dups);
  end if;

  insert into public.people (org_id, unit_id, full_name, notes, created_by)
    values (v_org, p_unit_id, btrim(p_full_name), nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid()))
    returning id into v_id;
  insert into public.person_kinds (person_id, kind)
    select v_id, k from unnest(coalesce(p_kinds, array['lead']::public.person_kind[])) k;
  if nullif(btrim(coalesce(p_email, '')), '') is not null then
    insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared)
      values (v_org, v_id, 'email', btrim(p_email), true, v_contact_dup);
  end if;
  if nullif(btrim(coalesce(p_phone, '')), '') is not null then
    insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared)
      values (v_org, v_id, 'phone', btrim(p_phone), true, v_contact_dup);
  end if;
  return jsonb_build_object('status', 'created', 'id', v_id);
end $$;

-- Funções expostas na API: apenas usuários autenticados.
revoke all on function public.find_person_duplicates(text, text[], text[]) from public, anon;
revoke all on function public.create_person(text, uuid, public.person_kind[], text, text, text, boolean) from public, anon;
grant execute on function public.find_person_duplicates(text, text[], text[]) to authenticated;
grant execute on function public.create_person(text, uuid, public.person_kind[], text, text, text, boolean) to authenticated;
