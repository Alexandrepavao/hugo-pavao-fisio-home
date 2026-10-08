-- HP Group Hub — 085 O nome mostrado de um usuário É o nome do cadastro de pessoa dele.
-- user_accounts.display_name alimenta cabeçalho, saudação, responsáveis, históricos e relatórios. Para contas ligadas a uma pessoa ele passa a ser sempre derivado do cadastro:
--   nome de preferência (people.preferred_name), na falta dele o nome completo (people.full_name). Muda sozinho quando o cadastro muda.
-- Contas SEM pessoa ligada continuam com o nome de exibição próprio (ou o prefixo do e-mail).

create or replace function private.person_account_name(p_person uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.full_name), '')) from public.people p where p.id = p_person
$$;
revoke all on function private.person_account_name(uuid) from public, anon, authenticated;

-- conta ligada a pessoa: o nome vem do cadastro (na criação, ao ligar e contra edição direta)
create or replace function private.user_accounts_name_from_person() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if new.person_id is null then return new; end if;
  v := private.person_account_name(new.person_id);
  if v is null then return new; end if;
  if tg_op = 'UPDATE' and new.person_id is not distinct from old.person_id and new.display_name is distinct from old.display_name
     and coalesce(current_setting('hp.sync_name', true), '') <> '1' then
    raise exception 'o nome deste usuário vem do cadastro de pessoa: altere o nome lá (Pessoas ou Configurações da conta)';
  end if;
  new.display_name := v;
  return new;
end $$;
revoke all on function private.user_accounts_name_from_person() from public, anon, authenticated;
create trigger user_accounts_name_from_person before insert or update of person_id, display_name on public.user_accounts
  for each row execute function private.user_accounts_name_from_person();

-- mudou o cadastro: as contas ligadas a ele acompanham
create or replace function private.people_sync_account_name() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text := private.person_account_name(new.id);
begin
  if v is null then return new; end if;
  perform set_config('hp.sync_name', '1', true);
  update public.user_accounts set display_name = v where person_id = new.id and display_name is distinct from v;
  perform set_config('hp.sync_name', '', true);
  return new;
end $$;
revoke all on function private.people_sync_account_name() from public, anon, authenticated;
create trigger people_sync_account_name after update of full_name, preferred_name on public.people
  for each row execute function private.people_sync_account_name();

-- contas que já estavam ligadas passam a mostrar o nome do cadastro
select set_config('hp.sync_name', '1', true);
update public.user_accounts ua set display_name = private.person_account_name(ua.person_id)
 where ua.person_id is not null and private.person_account_name(ua.person_id) is not null and ua.display_name is distinct from private.person_account_name(ua.person_id);
select set_config('hp.sync_name', '', true);

-- Configurações da conta: com pessoa ligada, "o nome" que a pessoa edita é o nome de preferência do cadastro (vazio = nome completo); sem pessoa, o nome de exibição da conta.
create or replace function public.my_account_update(p_display_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
  v_old text; v_org uuid; v_person uuid; v_pref text;
begin
  if v_uid is null then raise exception 'sessão inválida' using errcode = '42501'; end if;
  if length(v_name) > 80 then raise exception 'nome muito longo (máximo 80 caracteres)'; end if;
  if v_name ~ '[[:cntrl:]]' then raise exception 'o nome contém caracteres inválidos'; end if;
  select display_name, org_id, person_id into v_old, v_org, v_person from public.user_accounts where user_id = v_uid and status = 'active' for update;
  if not found then raise exception 'conta não encontrada ou inativa' using errcode = '42501'; end if;

  if v_person is not null then
    if v_name <> '' and length(v_name) < 2 then raise exception 'informe um nome com ao menos 2 caracteres, ou deixe em branco para usar o nome completo'; end if;
    select preferred_name into v_pref from public.people where id = v_person for update;
    if v_pref is not distinct from nullif(v_name, '') then return; end if;
    update public.people set preferred_name = nullif(v_name, '') where id = v_person; -- a auditoria do cadastro registra; o gatilho acerta o nome da conta
    return;
  end if;

  if length(v_name) < 2 then raise exception 'informe um nome com ao menos 2 caracteres'; end if;
  if v_old is not distinct from v_name then return; end if;
  update public.user_accounts set display_name = v_name where user_id = v_uid;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns, old_values, new_values)
  values (v_org, v_uid, 'update', 'user_accounts', v_uid::text, array['display_name'], jsonb_build_object('display_name', v_old), jsonb_build_object('display_name', v_name));
end $$;
revoke all on function public.my_account_update(text) from public, anon;
grant execute on function public.my_account_update(text) to authenticated;
