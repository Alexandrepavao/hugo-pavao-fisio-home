-- HP Group Hub — 018 Validação de contatos em public.create_person (usada por cadastro manual e importação)
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
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_org is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_full_name, ''))) < 2 then raise exception 'Nome inválido'; end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
  if v_phone is not null and length(regexp_replace(v_phone, '\D', '', 'g')) not between 10 and 13 then raise exception 'Telefone inválido'; end if;
  if v_email is null and v_phone is null then raise exception 'Informe e-mail ou telefone'; end if;
  select jsonb_agg(to_jsonb(d)), coalesce(bool_or(d.match_reason like '%contato_igual%'), false)
    into v_dups, v_contact_dup
    from public.find_person_duplicates(p_full_name, array[v_email], array[v_phone]) d;
  if v_dups is not null and not p_force then
    return jsonb_build_object('status', 'duplicates', 'candidates', v_dups);
  end if;

  insert into public.people (id, org_id, unit_id, full_name, notes, created_by)
    values (v_id, v_org, p_unit_id, btrim(p_full_name), nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid()));
  insert into public.person_kinds (person_id, kind)
    select v_id, k from unnest(coalesce(p_kinds, array['lead']::public.person_kind[])) k;
  if v_email is not null then
    insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (v_org, v_id, 'email', v_email, true, v_contact_dup);
  end if;
  if v_phone is not null then
    insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (v_org, v_id, 'phone', v_phone, true, v_contact_dup);
  end if;
  return jsonb_build_object('status', 'created', 'id', v_id);
end $$;
