-- HP Group Hub — 133 Primeiro acesso do paciente pendente: convite seguro, estado do acesso e registro do envio (Resend via Send Email Hook do Auth).
--  · reaproveita person_portal_access (070/072): agora com um NÚCLEO sem checagem de papel (para a Edge Function de convite) e o wrapper público;
--    a fisioterapeuta COM VÍNCULO assistencial também pode convidar — mas só para um e-mail JÁ cadastrado da própria pessoa (nunca um e-mail digitado);
--  · conta que já existe: reutiliza identidade e login, não redefine senha, e só liga se o e-mail da conta for um e-mail cadastrado da pessoa (comprovado pelo Auth: e-mail confirmado);
--  · sem e-mail: "Acesso pendente — cadastrar e-mail"; a avaliação e a prévia continuam;
--  · registro do envio SEM e-mail completo (mascarado) e sem dado clínico: distingue ENVIO ACEITO pelo serviço de e-mail × primeiro acesso concluído (entrega confirmada NÃO é rastreada).

-- ---------------------------------------------------------------- 1. núcleo do acesso (mesma lógica de 072; parâmetros explícitos em vez de auth.uid())
create or replace function private.person_portal_access_core(p_org uuid, p_person uuid, p_email text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_user uuid; v_cur uuid; v_inv public.invitations;
begin
  if p_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
  if not exists (select 1 from public.people where id = p_person and org_id = p_org and merged_into_id is null) then raise exception 'pessoa não encontrada no cadastro central'; end if;

  select u.id, ua.person_id into v_user, v_cur from auth.users u left join public.user_accounts ua on ua.user_id = u.id
   where lower(u.email) = v_email and u.email_confirmed_at is not null and (ua.org_id is null or ua.org_id = p_org);
  if v_user is not null then
    if v_cur is not null and v_cur <> p_person then raise exception 'esta conta já está ligada a outra pessoa do cadastro'; end if;
    if exists (select 1 from public.user_accounts where person_id = p_person and user_id <> v_user) then raise exception 'esta pessoa já está ligada a outra conta'; end if;
    if not exists (select 1 from public.person_contacts c where c.person_id = p_person and c.type = 'email' and lower(btrim(c.value)) = v_email) then
      raise exception 'o e-mail da conta precisa ser um dos e-mails cadastrados desta pessoa';
    end if;
    insert into public.user_accounts (user_id, org_id, person_id) values (v_user, p_org, p_person) on conflict (user_id) do update set person_id = excluded.person_id;
    insert into public.role_assignments (org_id, user_id, role, unit_id, granted_by) values (p_org, v_user, 'member', null, p_actor) on conflict do nothing;
    return jsonb_build_object('status', 'linked');
  end if;

  select * into v_inv from public.invitations where email = v_email::extensions.citext and role = 'member' and accepted_at is null and revoked_at is null and expires_at > now() limit 1;
  if found then
    if v_inv.person_id is not null and v_inv.person_id <> p_person then raise exception 'já existe um convite aberto para este e-mail, ligado a outra pessoa'; end if;
    update public.invitations set person_id = p_person where id = v_inv.id;
    return jsonb_build_object('status', 'invited', 'reused', true);
  end if;
  insert into public.invitations (org_id, email, role, unit_id, person_id, invited_by) values (p_org, v_email, 'member', null, p_person, p_actor);
  return jsonb_build_object('status', 'invited', 'reused', false);
end $$;

create or replace function public.person_portal_access(p_person uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_staff boolean := private.has_org_role(array['manager', 'ops_admin']::public.app_role[]);
begin
  if v_org is null or not (v_staff or private.has_care_relationship(p_person)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  -- quem não é da gestão (fisioterapeuta com vínculo) só convida um e-mail JÁ cadastrado da pessoa: nunca um endereço digitado na hora
  if not v_staff and not exists (select 1 from public.person_contacts c where c.person_id = p_person and c.type = 'email' and lower(btrim(c.value)) = lower(btrim(coalesce(p_email, '')))) then
    raise exception 'use um e-mail já cadastrado desta pessoa';
  end if;
  return private.person_portal_access_core(v_org, p_person, p_email, (select auth.uid()));
end $$;

-- ---------------------------------------------------------------- 2. registro dos envios (sem e-mail completo)
create table public.portal_invites (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade, email_masked text not null,
  kind text not null check (kind in ('invite', 'link')), requested_by uuid references auth.users(id) on delete set null, requested_at timestamptz not null default now(),
  outcome text not null default 'pending' check (outcome in ('pending', 'accepted', 'failed', 'throttled')), error_code text check (error_code is null or length(error_code) <= 80), settled_at timestamptz
);
create index portal_invites_person_idx on public.portal_invites (person_id, requested_at desc);
alter table public.portal_invites enable row level security; revoke all on public.portal_invites from public, anon, authenticated;

create or replace function private.mask_email(p_email text) returns text language sql immutable set search_path = '' as $$
  select substr(split_part(p_email, '@', 1), 1, 1) || '***@' || substr(split_part(p_email, '@', 2), 1, 1) || '***' || substr(split_part(p_email, '@', 2), position('.' in split_part(p_email, '@', 2)))
$$;
create or replace function private.person_email(p_person uuid) returns text language sql stable security definer set search_path = '' as $$
  select lower(btrim(c.value)) from public.person_contacts c where c.person_id = p_person and c.type = 'email' and btrim(c.value) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' order by c.is_primary desc, c.created_at limit 1
$$;

-- ---------------------------------------------------------------- 3. estado do acesso (usado pela tela e para AUTORIZAR a função de convite). Nunca devolve o e-mail completo.
create or replace function public.portal_access_state(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_email text; v_linked boolean; v_open record; v_last record; v_first timestamptz;
begin
  if v_org is null or not (private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) or private.has_care_relationship(p_person)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  v_email := private.person_email(p_person);
  v_linked := exists (select 1 from public.user_accounts where person_id = p_person and status = 'active');
  select i.expires_at into v_open from public.invitations i where i.person_id = p_person and i.role = 'member' and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() order by i.created_at desc limit 1;
  select outcome, requested_at, error_code into v_last from public.portal_invites where person_id = p_person order by requested_at desc limit 1;
  select max(i.accepted_at) into v_first from public.invitations i where i.person_id = p_person and i.role = 'member' and i.accepted_at is not null;
  return jsonb_build_object('has_email', v_email is not null, 'email_masked', case when v_email is not null then private.mask_email(v_email) end,
    'account', case when v_linked then 'linked' when v_open.expires_at is not null then 'invite_open' else 'none' end, 'invite_expires_at', v_open.expires_at,
    'last_send', case when v_last.requested_at is not null then jsonb_build_object('at', v_last.requested_at, 'outcome', v_last.outcome, 'error_code', v_last.error_code) end,
    'first_access_at', v_first, 'delivery_tracked', false);
end $$;

-- ---------------------------------------------------------------- 4. execução do convite (SOMENTE service_role: chamada pela Edge Function, depois de autorizar via portal_access_state)
create or replace function public.portal_invite_run(p_person uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_email text; v_res jsonb; v_id uuid; e public.patient_enrollments;
begin
  select org_id into v_org from public.people where id = p_person and merged_into_id is null;
  if v_org is null then raise exception 'pessoa não encontrada'; end if;
  select * into e from public.patient_enrollments where org_id = v_org and person_id = p_person and status in ('pending', 'active') limit 1;
  if not found then return jsonb_build_object('status', 'no_enrollment'); end if;                     -- vínculo encerrado/inexistente: convite antigo não reativa
  v_email := private.person_email(p_person);
  if v_email is null then return jsonb_build_object('status', 'no_email'); end if;                    -- "Acesso pendente — cadastrar e-mail" (nada é desfeito)
  perform pg_advisory_xact_lock(hashtextextended('portal-invite:' || p_person::text, 0));
  if exists (select 1 from public.portal_invites where person_id = p_person and outcome = 'accepted' and requested_at > now() - interval '10 minutes') then
    return jsonb_build_object('status', 'throttled');                                                  -- reenvio só depois de 10 min (sem spam e sem custo repetido)
  end if;
  v_res := private.person_portal_access_core(v_org, p_person, v_email, p_actor);                       -- 'linked' (conta existente reutilizada) ou 'invited'
  insert into public.portal_invites (org_id, person_id, email_masked, kind, requested_by, outcome, settled_at)
    values (v_org, p_person, private.mask_email(v_email), case when v_res ->> 'status' = 'linked' then 'link' else 'invite' end, p_actor, case when v_res ->> 'status' = 'linked' then 'accepted' else 'pending' end,
            case when v_res ->> 'status' = 'linked' then now() end) returning id into v_id;
  return v_res || jsonb_build_object('invite_id', v_id, 'email', case when v_res ->> 'status' = 'invited' then v_email end);   -- o e-mail completo só vai à função (para enviar), nunca ao navegador
end $$;

create or replace function public.portal_invite_result(p_invite uuid, p_outcome text, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome not in ('accepted', 'failed') then raise exception 'resultado inválido'; end if;
  update public.portal_invites set outcome = p_outcome, error_code = left(p_error, 80), settled_at = now() where id = p_invite and outcome = 'pending';
end $$;

revoke all on function private.person_portal_access_core(uuid, uuid, text, uuid), private.mask_email(text), private.person_email(uuid) from public, anon, authenticated;
revoke all on function public.person_portal_access(uuid, text), public.portal_access_state(uuid), public.portal_invite_run(uuid, uuid), public.portal_invite_result(uuid, text, text) from public, anon, authenticated;
grant execute on function public.person_portal_access(uuid, text), public.portal_access_state(uuid) to authenticated;
grant execute on function public.portal_invite_run(uuid, uuid), public.portal_invite_result(uuid, text, text) to service_role;
