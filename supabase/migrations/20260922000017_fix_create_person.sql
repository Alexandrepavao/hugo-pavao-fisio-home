-- HP Group Hub — 017 Correção de public.create_person
-- Bug: INSERT ... RETURNING reavalia a política de SELECT (private.can_read_person consulta public.people),
-- que não enxerga a linha recém-inserida => "new row violates row-level security policy". Solução: gerar o id antes e não usar RETURNING.
create or replace function public.create_person(
  p_full_name text, p_unit_id uuid, p_kinds public.person_kind[],
  p_email text default null, p_phone text default null, p_notes text default null, p_force boolean default false
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid := private.current_org();
  v_id uuid := gen_random_uuid();
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

  insert into public.people (id, org_id, unit_id, full_name, notes, created_by)
    values (v_id, v_org, p_unit_id, btrim(p_full_name), nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid()));
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
