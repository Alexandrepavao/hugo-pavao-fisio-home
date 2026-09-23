-- HP Group Hub — 003 Bootstrap de gestores (lista restrita, uso único, auditado)
-- O privilégio é concedido SOMENTE pelo banco, quando o Supabase Auth marca o e-mail como confirmado
-- (email_confirmed_at) e o e-mail consta na allowlist abaixo. A allowlist não é acessível pela API
-- (schema private) e só é alterada por migration/SQL administrativo.

-- Configuração base (não é dado demonstrativo): organização e unidade-sede. Idempotente.
insert into public.organizations (name, slug) values ('HP Group', 'hp-group') on conflict (slug) do nothing;
insert into public.units (org_id, name, slug, timezone, city, state)
select id, 'Sede — São Paulo', 'sao-paulo', 'America/Sao_Paulo', 'São Paulo', 'SP' from public.organizations where slug = 'hp-group'
on conflict (org_id, slug) do nothing;

create table private.manager_bootstrap_emails (
  org_id uuid not null references public.organizations(id) on delete cascade,
  email extensions.citext not null,
  consumed_at timestamptz,
  consumed_by uuid,
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);

insert into private.manager_bootstrap_emails (org_id, email, consumed_at)
select org_id, manager_email, consumed_at from private.bootstrap_config;
drop table private.bootstrap_config;

create or replace function private.on_auth_user_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_inv record;
  v_boot record;
begin
  -- Somente identidades com e-mail verificado.
  if new.email_confirmed_at is null or new.email is null then return new; end if;

  -- 1) Bootstrap de gestor: e-mail verificado presente na allowlist, ainda não consumido.
  select * into v_boot from private.manager_bootstrap_emails b
   where b.consumed_at is null and b.email = new.email::extensions.citext
   for update skip locked limit 1;
  if found then
    insert into public.user_accounts (user_id, org_id) values (new.id, v_boot.org_id)
      on conflict (user_id) do nothing;
    insert into public.role_assignments (org_id, user_id, role, granted_by)
      values (v_boot.org_id, new.id, 'manager', null)
      on conflict do nothing;
    update private.manager_bootstrap_emails set consumed_at = now(), consumed_by = new.id
     where org_id = v_boot.org_id and email = v_boot.email;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns)
      values (v_boot.org_id, new.id, 'bootstrap_manager', 'user', new.id::text, array['role']);
    return new;
  end if;

  if exists (select 1 from public.user_accounts where user_id = new.id) then return new; end if;

  -- 2) Convites abertos para este e-mail verificado.
  for v_inv in
    select * from public.invitations
     where email = new.email::extensions.citext and accepted_at is null and revoked_at is null and expires_at > now()
     order by created_at
  loop
    insert into public.user_accounts (user_id, org_id, person_id)
      values (new.id, v_inv.org_id, v_inv.person_id)
      on conflict (user_id) do nothing;
    insert into public.role_assignments (org_id, user_id, role, unit_id, granted_by)
      values (v_inv.org_id, new.id, v_inv.role, v_inv.unit_id, v_inv.invited_by)
      on conflict do nothing;
    update public.invitations set accepted_at = now() where id = v_inv.id;
  end loop;
  return new;
end $$;

-- Gestores principais autorizados (sem senha: o acesso nasce do link de convite/recuperação do Supabase Auth).
insert into private.manager_bootstrap_emails (org_id, email)
select id, e from public.organizations, unnest(array['contato@hpfisioterapia.com.br','jan.darioush@yahoo.com.br']) e
where slug = 'hp-group'
on conflict do nothing;
