-- HP Group Hub — 144 Convite do administrador: validade, revogação, reenvio e evidência de entrega (Dev; white label).
-- Auditoria do primeiro acesso encontrou lacunas:
--   · o convite "novo usuário" (manager_bootstrap_emails) não expirava nem podia ser revogado, e só o 1º da lista era consumido na confirmação;
--   · reenviar convite para e-mail ainda NÃO confirmado falhava com "email_exists" sem saída;
--   · nada registrava o que realmente aconteceu com o e-mail (pedido → aceito pelo Resend → entrega → link usado → senha → acesso);
--   · o remetente/brand do e-mail e o link não sabiam em qual organização a pessoa estava entrando.
-- Aqui: validade/revogação em ambos os caminhos, evento de e-mail por tentativa (sem guardar o endereço completo), evidência em 5 níveis só para a plataforma, e marca/link por organização (o slug só vale se o
-- endereço realmente tem ligação com aquela organização — não dá para "vestir" o e-mail de outra empresa em quem não é dela).

-- 1. validade e revogação do convite de administrador novo
alter table private.manager_bootstrap_emails add column if not exists expires_at timestamptz not null default now() + interval '30 days';
alter table private.manager_bootstrap_emails add column if not exists revoked_at timestamptz;

-- 2. eventos de e-mail (somente servidor): um registro por tentativa, com o endereço mascarado e um hash; o id do provedor permite conferir a entrega depois
create table if not exists private.email_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  request_id uuid,
  purpose text not null check (length(purpose) between 3 and 60),
  email_hash text not null,
  email_masked text not null,
  state text not null check (state in ('requested', 'accepted', 'failed', 'suppressed')),
  provider_id text,
  error text,
  delivery text,
  delivery_at timestamptz,
  delivery_checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_events_request_idx on private.email_events (request_id, created_at desc);
create index if not exists email_events_org_idx on private.email_events (org_id, created_at desc);

create or replace function public.email_event_log(p_org uuid, p_request uuid, p_purpose text, p_email text, p_state text, p_provider_id text default null, p_error text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; e text := lower(btrim(coalesce(p_email, '')));
begin
  insert into private.email_events (org_id, request_id, purpose, email_hash, email_masked, state, provider_id, error)
    values (p_org, p_request, left(p_purpose, 60), encode(sha256(convert_to(e, 'UTF8')), 'hex'),
            case when position('@' in e) > 1 then left(e, 1) || '***@' || split_part(e, '@', 2) else '***' end, p_state, left(p_provider_id, 80), left(p_error, 120))
    returning id into v_id;
  return v_id;
end $$;
create or replace function public.email_event_delivery(p_id uuid, p_delivery text, p_at timestamptz default null) returns void
language sql security definer set search_path = '' as $$
  update private.email_events set delivery = left(p_delivery, 40), delivery_at = coalesce(p_at, delivery_at), delivery_checked_at = now() where id = p_id
$$;
create or replace function public.email_events_for_request(p_request uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'purpose', e.purpose, 'state', e.state, 'provider_id', e.provider_id, 'created_at', e.created_at, 'delivery', e.delivery) order by e.created_at desc), '[]'::jsonb)
    from (select ev.* from private.email_events ev join public.provisioning_requests r on r.id = p_request
           where (ev.request_id = r.id or (ev.org_id = r.org_id and ev.email_hash = encode(sha256(convert_to(lower(btrim(r.answers #>> '{company,responsible,email}')), 'UTF8')), 'hex')))
           order by ev.created_at desc limit 10) e
$$;
revoke all on function public.email_event_log(uuid, uuid, text, text, text, text, text), public.email_event_delivery(uuid, text, timestamptz), public.email_events_for_request(uuid) from public, anon, authenticated;
grant execute on function public.email_event_log(uuid, uuid, text, text, text, text, text), public.email_event_delivery(uuid, text, timestamptz), public.email_events_for_request(uuid) to service_role;

-- 3. confirmação do e-mail: consome TODOS os convites de administrador válidos (não vencidos, não revogados) e marca o convite da solicitação como aceito
create or replace function private.on_auth_user_confirmed() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inv record; v_boot record; v_any boolean := false;
begin
  if new.email_confirmed_at is null or new.email is null then return new; end if;
  for v_boot in select * from private.manager_bootstrap_emails b where b.consumed_at is null and b.revoked_at is null and b.expires_at > now() and b.email = new.email::extensions.citext for update skip locked loop
    insert into public.user_accounts (user_id, org_id) values (new.id, v_boot.org_id) on conflict (user_id) do nothing;
    insert into public.org_memberships (user_id, org_id, status, is_default) values (new.id, v_boot.org_id, 'active', not exists (select 1 from public.org_memberships x where x.user_id = new.id and x.is_default))
      on conflict (user_id, org_id) do update set status = 'active';
    insert into public.role_assignments (org_id, user_id, role, granted_by) values (v_boot.org_id, new.id, 'manager', null) on conflict do nothing;
    update private.manager_bootstrap_emails set consumed_at = now(), consumed_by = new.id where org_id = v_boot.org_id and email = v_boot.email;
    update public.provisioning_requests set admin_invite = jsonb_build_object('state', 'accepted', 'at', now()) where org_id = v_boot.org_id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns) values (v_boot.org_id, new.id, 'bootstrap_manager', 'user', new.id::text, array['role']);
    v_any := true;
  end loop;
  if v_any then return new; end if;
  -- convites abertos para este e-mail verificado (de uma ou mais organizações). Quem JÁ tem conta recebe os demais vínculos pelo aceite autenticado (invitation_accept).
  for v_inv in select * from public.invitations where email = new.email::extensions.citext and accepted_at is null and revoked_at is null and expires_at > now() order by created_at loop
    insert into public.user_accounts (user_id, org_id, person_id) values (new.id, v_inv.org_id, v_inv.person_id) on conflict (user_id) do nothing;
    if exists (select 1 from public.user_accounts ua where ua.user_id = new.id and ua.org_id = v_inv.org_id) then
      insert into public.role_assignments (org_id, user_id, role, unit_id, granted_by) values (v_inv.org_id, new.id, v_inv.role, v_inv.unit_id, v_inv.invited_by) on conflict do nothing;
      update public.invitations set accepted_at = now() where id = v_inv.id;
      if v_inv.professional_id is not null then
        update public.professionals set user_id = new.id where id = v_inv.professional_id and user_id is null and not exists (select 1 from public.professionals x where x.user_id = new.id and x.org_id = v_inv.org_id);
      end if;
    end if;
  end loop;
  return new;
end $$;

-- 4. preparar (ou RENOVAR) o convite do administrador: reabre o que venceu/foi revogado e informa se há cadastro antigo NÃO confirmado e sem vínculos (seguro recriar)
create or replace function public.provisioning_invite_prepare(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.provisioning_requests; v_email text; v_brand text; v_slug text; v_existing boolean; v_stale uuid;
begin
  select * into r from public.provisioning_requests where id = p_id; if not found then raise exception 'solicitação não encontrada'; end if;
  if r.status not in ('available', 'available_with_pending') then return jsonb_build_object('status', 'not_ready'); end if;
  if r.admin_invite ->> 'state' = 'accepted' then return jsonb_build_object('status', 'already_accepted'); end if;
  v_email := lower(btrim(r.answers #>> '{company,responsible,email}')); v_brand := coalesce(r.answers #>> '{brand,app_name}', r.answers #>> '{company,name}');
  select slug into v_slug from public.organizations where id = r.org_id;
  v_existing := exists (select 1 from auth.users where lower(email) = v_email and email_confirmed_at is not null);
  if v_existing then
    if not exists (select 1 from public.invitations where org_id = r.org_id and email = v_email::extensions.citext and role = 'manager' and accepted_at is null and revoked_at is null and expires_at > now()) then
      insert into public.invitations (org_id, email, role, invited_by, expires_at) values (r.org_id, v_email, 'manager', r.created_by, now() + interval '30 days');
    end if;
  else
    insert into private.manager_bootstrap_emails (org_id, email) values (r.org_id, v_email::extensions.citext)
      on conflict (org_id, email) do update set expires_at = now() + interval '30 days', revoked_at = null where private.manager_bootstrap_emails.consumed_at is null;
    select u.id into v_stale from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is null
       and not exists (select 1 from public.org_memberships m where m.user_id = u.id) and not exists (select 1 from public.role_assignments ra where ra.user_id = u.id)
       and not exists (select 1 from public.user_accounts ua where ua.user_id = u.id) limit 1;
  end if;
  return jsonb_build_object('status', 'ready', 'email', v_email, 'brand', v_brand, 'org_id', r.org_id, 'slug', v_slug, 'existing_user', v_existing, 'stale_user_id', v_stale, 'subdomain', r.answers #>> '{brand,subdomain}');
end $$;

-- 5. revogar o convite do administrador (plataforma): nada de acesso por convite antigo depois disto; reenviar reabre
create or replace function public.provisioning_invite_revoke(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.provisioning_requests; v_email text; n int := 0; m int := 0;
begin
  perform private.require_platform_admin();
  select * into r from public.provisioning_requests where id = p_id; if not found then raise exception 'solicitação não encontrada'; end if;
  if r.admin_invite ->> 'state' = 'accepted' then raise exception 'convite já aceito: remova o vínculo pelo painel da organização' using errcode = 'P0013'; end if;
  v_email := lower(btrim(r.answers #>> '{company,responsible,email}'));
  update private.manager_bootstrap_emails set revoked_at = now() where org_id = r.org_id and email = v_email::extensions.citext and consumed_at is null and revoked_at is null;
  get diagnostics n = row_count;
  update public.invitations set revoked_at = now() where org_id = r.org_id and email = v_email::extensions.citext and role = 'manager' and accepted_at is null and revoked_at is null;
  get diagnostics m = row_count;
  update public.provisioning_requests set admin_invite = jsonb_build_object('state', 'revoked', 'at', now()), pending = private.prov_pending(id) where id = p_id;
  perform private.platform_audit('provisioning.invite_revoked', r.org_id, 'provisioning', p_id::text, jsonb_build_object('new_user_invites', n, 'existing_user_invites', m));
  return jsonb_build_object('revoked', n + m);
end $$;

-- 6. evidência em 5 níveis (só a plataforma; nunca devolve e-mail completo, link nem senha)
create or replace function public.provisioning_access_evidence(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.provisioning_requests; v_email text; u auth.users; v_new boolean; v_req jsonb; v_acc jsonb; v_fail jsonb; v_del jsonb; v_inv public.invitations; v_boot private.manager_bootstrap_emails; v_hash text;
begin
  perform private.require_platform_admin();
  select * into r from public.provisioning_requests where id = p_id; if not found then raise exception 'solicitação não encontrada'; end if;
  v_email := lower(btrim(r.answers #>> '{company,responsible,email}'));
  select * into u from auth.users where lower(email) = v_email limit 1;
  select * into v_boot from private.manager_bootstrap_emails where org_id = r.org_id and email = v_email::extensions.citext;
  select * into v_inv from public.invitations where org_id = r.org_id and email = v_email::extensions.citext and role = 'manager' order by created_at desc limit 1;
  v_new := v_boot.org_id is not null;
  v_hash := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
  select jsonb_build_object('at', min(created_at), 'count', count(*)) into v_req from private.email_events where request_id = p_id and purpose = 'admin_invite';
  select jsonb_build_object('at', max(created_at), 'count', count(*)) into v_acc from private.email_events where state = 'accepted' and (request_id = p_id or (org_id = r.org_id and email_hash = v_hash));
  select jsonb_build_object('at', e.created_at, 'code', e.error) into v_fail from private.email_events e where e.state in ('failed', 'suppressed') and (e.request_id = p_id or (e.org_id = r.org_id and e.email_hash = v_hash)) order by e.created_at desc limit 1;
  select jsonb_build_object('state', e.delivery, 'checked_at', e.delivery_checked_at, 'event_at', e.delivery_at) into v_del from private.email_events e where e.state = 'accepted' and e.provider_id is not null and (e.request_id = p_id or (e.org_id = r.org_id and e.email_hash = v_hash)) order by e.created_at desc limit 1;
  return jsonb_build_object(
    'mode', case when v_new then 'new_user' else 'existing_user' end,
    'invite_state', r.admin_invite ->> 'state',
    'invite_valid', case when v_new then v_boot.consumed_at is null and v_boot.revoked_at is null and v_boot.expires_at > now() else v_inv.id is not null and v_inv.accepted_at is null and v_inv.revoked_at is null and v_inv.expires_at > now() end,
    '1_requested', coalesce(v_req, jsonb_build_object('count', 0)),
    '2_provider_accepted', coalesce(v_acc, jsonb_build_object('count', 0)),
    'last_failure', v_fail,
    '3_delivery', coalesce(v_del, jsonb_build_object('state', null)),
    '4_link_used', case when v_new then u.id is not null and u.email_confirmed_at is not null else v_inv.accepted_at is not null end,
    '5_password_set', case when v_new then u.id is not null and coalesce(u.encrypted_password, '') <> '' else null end,
    '5_access', jsonb_build_object('membership', exists (select 1 from public.org_memberships m where m.user_id = u.id and m.org_id = r.org_id and m.status = 'active'),
       'manager_role', exists (select 1 from public.role_assignments ra where ra.user_id = u.id and ra.org_id = r.org_id and ra.role = 'manager' and ra.revoked_at is null),
       'signed_in', u.last_sign_in_at is not null));
end $$;
revoke all on function public.provisioning_invite_prepare(uuid), public.provisioning_invite_revoke(uuid), public.provisioning_access_evidence(uuid) from public, anon, authenticated;
grant execute on function public.provisioning_invite_prepare(uuid) to service_role;
grant execute on function public.provisioning_invite_revoke(uuid), public.provisioning_access_evidence(uuid) to authenticated;

-- 7. marca do e-mail por ENDEREÇO + organização do pedido (slug só vale se o endereço tem ligação real com a organização)
drop function if exists public.email_brand_for_address(text);
create or replace function public.email_brand_for_address(p_email text, p_org_slug text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_org uuid; v_want uuid;
begin
  if v_email = '' then return jsonb_build_object('found', false); end if;
  if nullif(btrim(coalesce(p_org_slug, '')), '') is not null then
    select o.id into v_want from public.organizations o where o.slug = lower(btrim(p_org_slug)) and o.status = 'active';
    if v_want is not null and (
         exists (select 1 from public.invitations i where lower(i.email::text) = v_email and i.org_id = v_want and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
      or exists (select 1 from private.manager_bootstrap_emails b where lower(b.email::text) = v_email and b.org_id = v_want and b.consumed_at is null and b.revoked_at is null and b.expires_at > now())
      or exists (select 1 from public.org_memberships m join auth.users u on u.id = m.user_id where lower(u.email) = v_email and m.org_id = v_want and m.status = 'active')) then v_org := v_want; end if;
  end if;
  if v_org is null then select i.org_id into v_org from public.invitations i where lower(i.email::text) = v_email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() order by i.created_at desc limit 1; end if;
  if v_org is null then select b.org_id into v_org from private.manager_bootstrap_emails b where lower(b.email::text) = v_email and b.consumed_at is null and b.revoked_at is null and b.expires_at > now() limit 1; end if;
  if v_org is null then select m.org_id into v_org from public.org_memberships m join auth.users u on u.id = m.user_id join public.organizations o on o.id = m.org_id where lower(u.email) = v_email and m.status = 'active' order by (o.slug = 'hp-group') desc, m.is_default desc, m.created_at limit 1; end if;
  if v_org is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'org_id', v_org, 'slug', (select slug from public.organizations where id = v_org)) || (private.org_brand_json(v_org) - 'org_id' - 'support_phone' - 'support_email' - 'texts' - 'version');
end $$;
revoke all on function public.email_brand_for_address(text, text) from public, anon, authenticated; grant execute on function public.email_brand_for_address(text, text) to service_role;
