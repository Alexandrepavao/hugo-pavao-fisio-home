-- HP Group Hub — 001 Fundação
-- Organização, unidades, pessoas (separadas da conta de login), papéis por unidade,
-- convites, auditoria, tags e histórico de relacionamento. RLS em todas as tabelas.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role; -- funções usadas dentro de policies

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------- enums
create type public.app_role as enum (
  'manager',        -- Gestor (org inteira, sem acesso clínico individual)
  'ops_admin',      -- Administrador operacional (org inteira)
  'unit_manager',   -- Gestor de unidade
  'sales',          -- Comercial
  'finance',        -- Financeiro
  'physio',         -- Fisioterapeuta
  'teacher',        -- Professor / mentor
  'partner',        -- Parceiro
  'member'          -- Paciente ou aluno (acesso apenas ao próprio cadastro)
);

create type public.person_kind as enum ('lead','patient','student','partner','staff','contact');
create type public.contact_type as enum ('email','phone','whatsapp');

-- ---------------------------------------------------------------- utilitários
create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- organização e unidades
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  created_at timestamptz not null default now()
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  timezone text not null default 'America/Sao_Paulo',
  city text,
  state text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug),
  unique (id, org_id)
);
create trigger units_touch before update on public.units
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- pessoas (cadastro central)
create table public.people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,   -- unidade principal (pode ser nula)
  full_name text not null check (length(btrim(full_name)) > 1),
  preferred_name text,
  birth_date date,
  document_number text,          -- CPF etc. Sensível: só papéis administrativos leem (RLS)
  notes text,
  merged_into_id uuid references public.people(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, org_id),
  check (merged_into_id is null or merged_into_id <> id)
);
create index people_org_name_idx on public.people (org_id, lower(full_name));
create index people_name_trgm_idx on public.people using gin (lower(full_name) extensions.gin_trgm_ops);
create index people_unit_idx on public.people (unit_id);
-- documento único por organização (quando informado e pessoa não mesclada)
create unique index people_document_uq on public.people (org_id, document_number)
  where document_number is not null and merged_into_id is null;
create trigger people_touch before update on public.people
  for each row execute function private.touch_updated_at();

-- uma pessoa pode ser lead, paciente, aluno e parceiro ao mesmo tempo
create table public.person_kinds (
  person_id uuid not null references public.people(id) on delete cascade,
  kind public.person_kind not null,
  since timestamptz not null default now(),
  primary key (person_id, kind)
);

-- contatos: NÃO únicos (contatos compartilhados entre familiares são legítimos).
create table public.person_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade,
  type public.contact_type not null,
  value text not null,
  normalized text not null,      -- e-mail minúsculo / telefone só dígitos com DDI
  is_primary boolean not null default false,
  is_shared boolean not null default false, -- marcado quando o contato é de outra pessoa/familiar
  created_at timestamptz not null default now(),
  unique (person_id, type, normalized)
);
create index person_contacts_lookup_idx on public.person_contacts (org_id, type, normalized);
create unique index person_contacts_one_primary_uq on public.person_contacts (person_id, type) where is_primary;

create or replace function private.normalize_contact() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.type = 'email' then
    new.normalized := lower(btrim(new.value));
  else
    new.normalized := regexp_replace(new.value, '\D', '', 'g');
    -- números brasileiros sem DDI (10/11 dígitos) recebem 55
    if length(new.normalized) in (10, 11) then new.normalized := '55' || new.normalized; end if;
  end if;
  if new.normalized = '' then raise exception 'contato inválido'; end if;
  return new;
end $$;
create trigger person_contacts_normalize before insert or update of value, type on public.person_contacts
  for each row execute function private.normalize_contact();

-- ---------------------------------------------------------------- contas de login e papéis
-- A conta de autenticação (auth.users) é separada da pessoa. person_id pode ser nulo.
create table public.user_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete restrict,
  person_id uuid unique references public.people(id) on delete set null,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unit_id uuid references public.units(id) on delete cascade,   -- nulo = todas as unidades da organização
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (role not in ('manager','ops_admin','member','partner') or unit_id is null),
  check (valid_until is null or valid_until > valid_from)
);
create unique index role_assignments_active_uq
  on public.role_assignments (user_id, role, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;
create index role_assignments_user_idx on public.role_assignments (user_id) where revoked_at is null;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  email extensions.citext not null,
  role public.app_role not null,
  unit_id uuid references public.units(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (role not in ('manager','ops_admin','member','partner') or unit_id is null)
);
create index invitations_email_idx on public.invitations (email) where accepted_at is null and revoked_at is null;

-- E-mail que receberá o papel de gestor no primeiro acesso (uma única vez, enquanto não houver gestor).
create table private.bootstrap_config (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  manager_email extensions.citext not null,
  consumed_at timestamptz
);

-- ---------------------------------------------------------------- funções de autorização
-- SECURITY DEFINER + search_path vazio. Autoridade vem SEMPRE de tabelas, nunca de metadados do JWT.
create or replace function private.current_org() returns uuid
language sql stable security definer set search_path = '' as $$
  select ua.org_id from public.user_accounts ua
  where ua.user_id = (select auth.uid()) and ua.status = 'active'
$$;

create or replace function private.current_person() returns uuid
language sql stable security definer set search_path = '' as $$
  select ua.person_id from public.user_accounts ua
  where ua.user_id = (select auth.uid()) and ua.status = 'active'
$$;

-- Papel ativo (não revogado, dentro da validade) em toda a organização.
create or replace function private.has_org_role(p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.role_assignments ra
    join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
    where ra.user_id = (select auth.uid())
      and ra.role = any (p_roles)
      and ra.unit_id is null
      and ra.revoked_at is null
      and ra.valid_from <= now()
      and (ra.valid_until is null or ra.valid_until > now())
  )
$$;

-- Papel ativo na unidade informada (atribuição da unidade OU atribuição org-wide).
create or replace function private.has_unit_role(p_roles public.app_role[], p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.role_assignments ra
    join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
    where ra.user_id = (select auth.uid())
      and ra.role = any (p_roles)
      and (ra.unit_id is null or (p_unit is not null and ra.unit_id = p_unit))
      and ra.revoked_at is null
      and ra.valid_from <= now()
      and (ra.valid_until is null or ra.valid_until > now())
  )
$$;

create or replace function private.is_manager() returns boolean
language sql stable set search_path = '' as $$ select private.has_org_role(array['manager']::public.app_role[]) $$;

create or replace function private.is_staff() returns boolean
language sql stable set search_path = '' as $$
  select private.has_unit_role(array['manager','ops_admin','unit_manager','sales','finance','physio','teacher']::public.app_role[], null)
$$;

-- Leitura administrativa de uma pessoa: gestor/operacional (org) ou papéis de unidade na unidade dela; ou a própria pessoa.
create or replace function private.can_read_person(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people p
    where p.id = p_person
      and p.org_id = private.current_org()
      and (
        p.id = private.current_person()
        or private.has_org_role(array['manager','ops_admin']::public.app_role[])
        or private.has_unit_role(array['unit_manager','sales','finance']::public.app_role[], p.unit_id)
      )
  )
$$;

create or replace function private.can_write_person(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people p
    where p.id = p_person
      and p.org_id = private.current_org()
      and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], p.unit_id)
  )
$$;

-- ---------------------------------------------------------------- criação de conta a partir de convite / bootstrap
create or replace function private.on_auth_user_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_inv record;
  v_boot record;
  v_org uuid;
begin
  if new.email_confirmed_at is null or new.email is null then return new; end if;
  if exists (select 1 from public.user_accounts where user_id = new.id) then return new; end if;

  -- 1) primeiro gestor (uma única vez, apenas para o e-mail configurado)
  select * into v_boot from private.bootstrap_config
   where consumed_at is null and manager_email = new.email::extensions.citext
     and not exists (select 1 from public.role_assignments ra
                     where ra.org_id = bootstrap_config.org_id and ra.role = 'manager' and ra.revoked_at is null)
   limit 1;
  if found then
    insert into public.user_accounts (user_id, org_id) values (new.id, v_boot.org_id);
    insert into public.role_assignments (org_id, user_id, role, granted_by) values (v_boot.org_id, new.id, 'manager', new.id);
    update private.bootstrap_config set consumed_at = now() where org_id = v_boot.org_id;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id)
      values (v_boot.org_id, new.id, 'bootstrap_manager', 'user', new.id::text);
    return new;
  end if;

  -- 2) convites abertos para este e-mail
  for v_inv in
    select * from public.invitations
     where email = new.email::extensions.citext and accepted_at is null and revoked_at is null and expires_at > now()
     order by created_at
  loop
    v_org := v_inv.org_id;
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

create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function private.on_auth_user_confirmed();

-- ---------------------------------------------------------------- auditoria
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid,
  action text not null,                 -- insert | update | delete | ação nomeada
  entity_type text not null,
  entity_id text,
  unit_id uuid,
  changed_columns text[],               -- só NOMES das colunas; valores só de colunas listadas no trigger
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);
create index audit_log_org_time_idx on public.audit_log (org_id, created_at desc);

-- Trigger genérico. TG_ARGV = colunas cujos valores antigos/novos podem ser registrados (não sensíveis).
create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_keep text[] := tg_argv;
  v_ov jsonb := '{}'; v_nv jsonb := '{}'; k text;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key), '{}') into v_changed
      from jsonb_each(v_new) n where v_old -> n.key is distinct from n.value and n.key <> 'updated_at';
    if v_changed = '{}' then return new; end if;
  end if;
  foreach k in array coalesce(v_keep, '{}') loop
    if v_old ? k then v_ov := v_ov || jsonb_build_object(k, v_old -> k); end if;
    if v_new ? k then v_nv := v_nv || jsonb_build_object(k, v_new -> k); end if;
  end loop;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id, changed_columns, old_values, new_values)
  values (nullif(v_row ->> 'org_id','')::uuid, (select auth.uid()), lower(tg_op), tg_table_name, v_row ->> 'id',
          nullif(v_row ->> 'unit_id','')::uuid, v_changed, nullif(v_ov,'{}'), nullif(v_nv,'{}'));
  return coalesce(new, old);
end $$;

create trigger audit_people after insert or update or delete on public.people
  for each row execute function private.audit_row('full_name','unit_id','merged_into_id','archived_at');
create trigger audit_units after insert or update or delete on public.units
  for each row execute function private.audit_row('name','slug','timezone','active');
create trigger audit_role_assignments after insert or update or delete on public.role_assignments
  for each row execute function private.audit_row('role','unit_id','user_id','valid_until','revoked_at');
create trigger audit_invitations after insert or update or delete on public.invitations
  for each row execute function private.audit_row('email','role','unit_id','accepted_at','revoked_at');

-- ---------------------------------------------------------------- tags e histórico de relacionamento
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table public.person_tags (
  person_id uuid not null references public.people(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (person_id, tag_id)
);

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  channel text not null default 'note' check (channel in ('note','call','whatsapp','email','meeting','system')),
  summary text not null check (length(btrim(summary)) > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index interactions_person_idx on public.interactions (person_id, created_at desc);

-- ---------------------------------------------------------------- RLS
alter table public.organizations enable row level security;
alter table public.units enable row level security;
alter table public.people enable row level security;
alter table public.person_kinds enable row level security;
alter table public.person_contacts enable row level security;
alter table public.user_accounts enable row level security;
alter table public.role_assignments enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;
alter table public.tags enable row level security;
alter table public.person_tags enable row level security;
alter table public.interactions enable row level security;

-- privilégios explícitos: nada para anon; authenticated apenas o que as policies permitem
revoke all on all tables in schema public from anon, authenticated;
grant select on public.organizations, public.units, public.user_accounts, public.role_assignments, public.audit_log to authenticated;
grant select, insert, update on public.people, public.person_contacts, public.person_kinds, public.interactions to authenticated;
grant delete on public.person_contacts, public.person_kinds to authenticated;
grant select, insert, update, delete on public.tags, public.person_tags to authenticated;
grant select, insert, update on public.invitations to authenticated;
grant insert, update on public.units to authenticated;
grant insert, update on public.role_assignments to authenticated;

create policy org_read on public.organizations for select to authenticated
  using (id = private.current_org());

create policy units_read on public.units for select to authenticated
  using (org_id = private.current_org() and (private.is_staff() or private.has_org_role(array['member','partner']::public.app_role[])));
create policy units_write on public.units for insert to authenticated
  with check (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy units_update on public.units for update to authenticated
  using (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin']::public.app_role[]))
  with check (org_id = private.current_org());

create policy people_read on public.people for select to authenticated
  using (private.can_read_person(id));
create policy people_insert on public.people for insert to authenticated
  with check (org_id = private.current_org() and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id)
              and created_by = (select auth.uid()));
create policy people_update on public.people for update to authenticated
  using (private.can_write_person(id))
  with check (org_id = private.current_org() and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));

create policy kinds_read on public.person_kinds for select to authenticated using (private.can_read_person(person_id));
create policy kinds_write on public.person_kinds for insert to authenticated with check (private.can_write_person(person_id));
create policy kinds_delete on public.person_kinds for delete to authenticated using (private.can_write_person(person_id));

create policy contacts_read on public.person_contacts for select to authenticated using (private.can_read_person(person_id));
create policy contacts_insert on public.person_contacts for insert to authenticated
  with check (org_id = private.current_org() and private.can_write_person(person_id));
create policy contacts_update on public.person_contacts for update to authenticated
  using (private.can_write_person(person_id)) with check (org_id = private.current_org() and private.can_write_person(person_id));
create policy contacts_delete on public.person_contacts for delete to authenticated using (private.can_write_person(person_id));

create policy accounts_read on public.user_accounts for select to authenticated
  using (user_id = (select auth.uid()) or (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin']::public.app_role[])));

create policy roles_read on public.role_assignments for select to authenticated
  using (user_id = (select auth.uid()) or (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin']::public.app_role[])));
-- Atribuir papéis: só o gestor; ops_admin não concede papel de gestor/ops_admin (evita escalada de privilégio).
create policy roles_insert on public.role_assignments for insert to authenticated
  with check (org_id = private.current_org() and (
    private.is_manager()
    or (private.has_org_role(array['ops_admin']::public.app_role[]) and role not in ('manager','ops_admin'))));
create policy roles_update on public.role_assignments for update to authenticated
  using (org_id = private.current_org() and (
    private.is_manager()
    or (private.has_org_role(array['ops_admin']::public.app_role[]) and role not in ('manager','ops_admin'))))
  with check (org_id = private.current_org());

create policy invitations_read on public.invitations for select to authenticated
  using (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (org_id = private.current_org() and invited_by = (select auth.uid()) and (
    private.is_manager()
    or (private.has_org_role(array['ops_admin']::public.app_role[]) and role not in ('manager','ops_admin'))));
create policy invitations_update on public.invitations for update to authenticated
  using (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin']::public.app_role[]))
  with check (org_id = private.current_org());

create policy audit_read on public.audit_log for select to authenticated
  using (org_id = private.current_org() and private.is_manager());

create policy tags_read on public.tags for select to authenticated using (org_id = private.current_org() and private.is_staff());
create policy tags_write on public.tags for all to authenticated
  using (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin','sales']::public.app_role[]))
  with check (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin','sales']::public.app_role[]));
create policy person_tags_read on public.person_tags for select to authenticated using (private.can_read_person(person_id));
create policy person_tags_write on public.person_tags for all to authenticated
  using (private.can_write_person(person_id)) with check (private.can_write_person(person_id));

create policy interactions_read on public.interactions for select to authenticated
  using (private.can_read_person(person_id) and person_id is distinct from private.current_person());
create policy interactions_insert on public.interactions for insert to authenticated
  with check (org_id = private.current_org() and created_by = (select auth.uid()) and private.can_write_person(person_id));
