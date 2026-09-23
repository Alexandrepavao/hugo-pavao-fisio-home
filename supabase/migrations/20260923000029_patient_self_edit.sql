-- HP Group Hub — 029 Paciente edita os próprios dados básicos: lista explícita de campos permitidos, validação
-- no servidor, auditoria. Nunca papel/permissões, unidade de vínculo, identificadores internos, dados clínicos,
-- contratos ou pagamentos — a função só toca people.preferred_name/city/state_uf/country e o telefone principal
-- em person_contacts. E-mail de autenticação segue o fluxo próprio do Supabase Auth (nunca uma coluna de perfil).
create or replace function public.my_profile_update(p_preferred_name text default null, p_phone text default null,
  p_city text default null, p_state_uf text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_phone_digits text; v_uf text := nullif(upper(btrim(coalesce(p_state_uf, ''))), '');
begin
  if v_person is null then raise exception 'sua conta não está vinculada a um cadastro de pessoa' using errcode = '42501'; end if;
  if p_preferred_name is not null and length(btrim(p_preferred_name)) > 120 then raise exception 'nome de preferência muito longo'; end if;
  if p_phone is not null and btrim(p_phone) <> '' then
    v_phone_digits := regexp_replace(p_phone, '\D', '', 'g');
    if length(v_phone_digits) not between 10 and 13 then raise exception 'telefone inválido'; end if;
  end if;
  -- update on people já dispara os triggers de auditoria (audit_people + audit_people_self_edit); a checagem de
  -- formato de UF continua sendo o CHECK da coluna (state_uf ~ '^[A-Z]{2}$'), nunca duplicada aqui.
  update public.people set
    preferred_name = case when p_preferred_name is not null then nullif(btrim(p_preferred_name), '') else preferred_name end,
    city = case when p_city is not null then nullif(btrim(p_city), '') else city end,
    state_uf = case when p_state_uf is not null then v_uf else state_uf end
  where id = v_person;

  if p_phone is not null and btrim(p_phone) <> '' then
    -- demove o(s) telefone(s) principal(is) atual(is) ANTES de inserir o novo como principal — inserir direto
    -- com is_primary=true enquanto outro já é principal violaria o índice único parcial (person_id, type) where is_primary.
    update public.person_contacts set is_primary = false where person_id = v_person and type = 'phone' and is_primary;
    insert into public.person_contacts (org_id, person_id, type, value, is_primary)
      values (private.current_org(), v_person, 'phone', btrim(p_phone), true)
    on conflict (person_id, type, normalized) do update set value = excluded.value, is_primary = true;
  end if;
end $$;

-- auditoria dos campos de autoatendimento com o valor de fato (a audit_people original só guarda full_name/unit_id/merged_into_id/archived_at)
create trigger audit_people_self_edit after update on public.people
  for each row execute function private.audit_row('preferred_name','city','state_uf');

grant execute on function public.my_profile_update(text, text, text, text) to authenticated;
