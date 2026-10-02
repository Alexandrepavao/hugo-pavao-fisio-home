-- Corrige duas funções (mesma assinatura): conta JÁ confirmada mas sem registro em user_accounts (sem papel) agora é ligada na hora; antes caía no ramo “convite”,
-- que o gatilho do Auth nunca processaria (ele só roda quando a conta é criada/confirmada). Não altera nada além disso.

create or replace function public.professional_grant_access(p_professional uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_email text := lower(btrim(coalesce(p_email, ''))); pr public.professionals; v_user uuid; v_n int := 0; r record;
begin
  if v_org is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
  select * into pr from public.professionals where id = p_professional and org_id = v_org for update;
  if not found then raise exception 'profissional não encontrado'; end if;
  if not pr.active then raise exception 'profissional inativo: reative antes de liberar o acesso'; end if;
  if not exists (select 1 from public.professional_units where professional_id = pr.id) then raise exception 'cadastre ao menos uma unidade antes de liberar o acesso'; end if;
  -- conta já criada e com e-mail confirmado (com ou sem registro em user_accounts: o gatilho de convites só roda na criação/confirmação, então convite novo não seria processado)
  select u.id into v_user from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null
     and not exists (select 1 from public.user_accounts x where x.user_id = u.id and x.org_id <> v_org);
  if v_user is not null then
    insert into public.user_accounts (user_id, org_id, person_id) values (v_user, v_org, pr.person_id) on conflict (user_id) do nothing;
    if pr.user_id is not null and pr.user_id <> v_user then raise exception 'este profissional já está ligado a outra conta'; end if;
    if exists (select 1 from public.professionals where user_id = v_user and id <> pr.id) then raise exception 'esta conta já está ligada a outro profissional'; end if;
    for r in select unit_id from public.professional_units where professional_id = pr.id loop
      insert into public.role_assignments (org_id, user_id, role, unit_id, granted_by) values (v_org, v_user, 'physio', r.unit_id, (select auth.uid())) on conflict do nothing;
    end loop;
    update public.professionals set user_id = v_user where id = pr.id;
    update public.user_accounts set person_id = coalesce(person_id, pr.person_id) where user_id = v_user;
    return jsonb_build_object('status', 'linked');
  end if;
  for r in select unit_id from public.professional_units where professional_id = pr.id loop
    if not exists (select 1 from public.invitations where email = v_email::extensions.citext and role = 'physio' and unit_id = r.unit_id and accepted_at is null and revoked_at is null and expires_at > now()) then
      insert into public.invitations (org_id, email, role, unit_id, person_id, professional_id, invited_by) values (v_org, v_email, 'physio', r.unit_id, pr.person_id, pr.id, (select auth.uid()));
      v_n := v_n + 1;
    else
      update public.invitations set professional_id = pr.id, person_id = coalesce(person_id, pr.person_id)
       where email = v_email::extensions.citext and role = 'physio' and unit_id = r.unit_id and accepted_at is null and revoked_at is null and expires_at > now();
    end if;
  end loop;
  return jsonb_build_object('status', 'invited', 'invitations', v_n);
end $$;

create or replace function public.person_portal_access(p_person uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_email text := lower(btrim(coalesce(p_email, ''))); v_user uuid; v_cur uuid; v_inv public.invitations;
begin
  if v_org is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
  if not exists (select 1 from public.people where id = p_person and org_id = v_org and merged_into_id is null) then raise exception 'pessoa não encontrada no cadastro central'; end if;

  select u.id, ua.person_id into v_user, v_cur from auth.users u left join public.user_accounts ua on ua.user_id = u.id
   where lower(u.email) = v_email and u.email_confirmed_at is not null and (ua.org_id is null or ua.org_id = v_org);
  if v_user is not null then
    if v_cur is not null and v_cur <> p_person then raise exception 'esta conta já está ligada a outra pessoa do cadastro'; end if;
    if exists (select 1 from public.user_accounts where person_id = p_person and user_id <> v_user) then raise exception 'esta pessoa já está ligada a outra conta'; end if;
    if not exists (select 1 from public.person_contacts c where c.person_id = p_person and c.type = 'email' and lower(btrim(c.value)) = v_email) then
      raise exception 'o e-mail da conta precisa ser um dos e-mails cadastrados desta pessoa';
    end if;
    insert into public.user_accounts (user_id, org_id, person_id) values (v_user, v_org, p_person) on conflict (user_id) do update set person_id = excluded.person_id;
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

revoke all on function public.professional_grant_access(uuid, text), public.person_portal_access(uuid, text) from public, anon;
grant execute on function public.professional_grant_access(uuid, text), public.person_portal_access(uuid, text) to authenticated;
