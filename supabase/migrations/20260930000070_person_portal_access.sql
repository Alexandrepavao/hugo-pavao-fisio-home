-- Acesso ao portal do paciente/aluno para uma PESSOA do cadastro central: convite (conta ainda não existe) ou vínculo imediato (conta já existe).
-- Lacuna da auditoria: o gatilho de convites só roda quando a conta é CRIADA; quem já tinha conta ficava sem vínculo com o cadastro. Aditiva (1 função nova).
-- Segurança: só gestor/administrador operacional (mesma regra de convite); o vínculo imediato exige que o e-mail da conta seja um dos e-mails CADASTRADOS da pessoa
-- (evita ligar uma conta ao paciente errado) e nunca troca o vínculo de uma conta que já aponta para outra pessoa.

create or replace function public.person_portal_access(p_person uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_email text := lower(btrim(coalesce(p_email, ''))); v_user uuid; v_cur uuid; v_inv public.invitations;
begin
  if v_org is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
  if not exists (select 1 from public.people where id = p_person and org_id = v_org and merged_into_id is null) then raise exception 'pessoa não encontrada no cadastro central'; end if;

  select u.id, ua.person_id into v_user, v_cur from auth.users u join public.user_accounts ua on ua.user_id = u.id and ua.org_id = v_org
   where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is not null then
    if v_cur is not null and v_cur <> p_person then raise exception 'esta conta já está ligada a outra pessoa do cadastro'; end if;
    if exists (select 1 from public.user_accounts where person_id = p_person and user_id <> v_user) then raise exception 'esta pessoa já está ligada a outra conta'; end if;
    if not exists (select 1 from public.person_contacts c where c.person_id = p_person and c.type = 'email' and lower(btrim(c.value)) = v_email) then
      raise exception 'o e-mail da conta precisa ser um dos e-mails cadastrados desta pessoa';
    end if;
    update public.user_accounts set person_id = p_person where user_id = v_user;
    insert into public.role_assignments (org_id, user_id, role, unit_id, granted_by) values (v_org, v_user, 'member', null, (select auth.uid())) on conflict do nothing;
    return jsonb_build_object('status', 'linked');
  end if;

  select * into v_inv from public.invitations where email = v_email::extensions.citext and role = 'member' and accepted_at is null and revoked_at is null and expires_at > now() limit 1;
  if found then
    if v_inv.person_id is not null and v_inv.person_id <> p_person then raise exception 'já existe um convite aberto para este e-mail, ligado a outra pessoa'; end if;
    update public.invitations set person_id = p_person where id = v_inv.id;
    return jsonb_build_object('status', 'invited', 'reused', true);
  end if;
  insert into public.invitations (org_id, email, role, unit_id, person_id, invited_by) values (v_org, v_email, 'member', null, p_person, (select auth.uid()));
  return jsonb_build_object('status', 'invited', 'reused', false);
end $$;

revoke all on function public.person_portal_access(uuid, text) from public, anon;
grant execute on function public.person_portal_access(uuid, text) to authenticated;
