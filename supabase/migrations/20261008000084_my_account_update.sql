-- HP Group Hub — 084 Configurações da conta: cada usuário edita o PRÓPRIO nome de exibição.
-- Até aqui só gestores alteravam user_accounts.display_name (política accounts_update). A função abaixo toca somente a linha de quem chama
-- e somente esse campo; papéis, e-mail, status e vínculo com pessoa continuam fora do alcance. Auditoria registrada.
create or replace function public.my_account_update(p_display_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
  v_old text; v_org uuid;
begin
  if v_uid is null then raise exception 'sessão inválida' using errcode = '42501'; end if;
  if length(v_name) < 2 then raise exception 'informe um nome com ao menos 2 caracteres'; end if;
  if length(v_name) > 80 then raise exception 'nome muito longo (máximo 80 caracteres)'; end if;
  if v_name ~ '[[:cntrl:]]' then raise exception 'o nome contém caracteres inválidos'; end if;
  select display_name, org_id into v_old, v_org from public.user_accounts where user_id = v_uid and status = 'active' for update;
  if not found then raise exception 'conta não encontrada ou inativa' using errcode = '42501'; end if;
  if v_old is not distinct from v_name then return; end if;
  update public.user_accounts set display_name = v_name where user_id = v_uid;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns, old_values, new_values)
  values (v_org, v_uid, 'update', 'user_accounts', v_uid::text, array['display_name'], jsonb_build_object('display_name', v_old), jsonb_build_object('display_name', v_name));
end $$;
revoke all on function public.my_account_update(text) from public, anon;
grant execute on function public.my_account_update(text) to authenticated;
