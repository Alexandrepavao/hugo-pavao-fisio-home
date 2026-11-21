-- HP Group Hub — 134 Fundação multiempresa (white label): plataforma × organização × unidade × usuário × vínculo (membership), contexto de organização ativa e guarda contra vínculos entre organizações.
-- Reaproveita o identificador organizacional JÁ existente (`org_id` / `organizations`): não cria `tenant_id` concorrente.
-- Decisões:
--   · PLATAFORMA = `platform_admins` (administra o produto; NÃO tem papel nem acesso a dados de nenhuma organização).
--   · ORGANIZAÇÃO = `organizations` (cliente do white label). UNIDADE = `units` (filial). USUÁRIO = auth.users. VÍNCULO = `org_memberships` (usuário × organização × pessoa × estado).
--   · Papéis seguem em `role_assignments` (já tinha org_id) — agora SEMPRE avaliados no contexto da organização ativa.
--   · Organização ativa: `private.current_org()` devolve a organização do vínculo escolhido. O front manda o cabeçalho `x-org`, mas o banco REVALIDA o vínculo do usuário autenticado (nunca confia no valor);
--     sem cabeçalho vale o vínculo padrão. Domínio/tema nunca autorizam nada.
--   · `user_accounts` continua existindo (1 linha por usuário = vínculo PRIMÁRIO) e é espelhada em `org_memberships`; quem tem vários vínculos usa `org_memberships`.
-- Compatível: com um único vínculo por usuário (todos os dados atuais) o comportamento é idêntico ao anterior.

-- ---------------------------------------------------------------- 1. plataforma e vínculos
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null, granted_at timestamptz not null default now(), revoked_at timestamptz
);
alter table public.platform_admins enable row level security; revoke all on public.platform_admins from public, anon, authenticated;
create or replace function private.is_platform_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()) and revoked_at is null)
$$;

create table public.org_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create unique index org_memberships_person_uq on public.org_memberships (org_id, person_id) where person_id is not null;
create index org_memberships_org_idx on public.org_memberships (org_id) where status = 'active';
alter table public.org_memberships enable row level security; revoke all on public.org_memberships from public, anon, authenticated;
insert into public.org_memberships (user_id, org_id, person_id, status, is_default, created_at)
  select ua.user_id, ua.org_id, ua.person_id, case when ua.status = 'active' then 'active' else 'suspended' end, true, ua.created_at from public.user_accounts ua
   where exists (select 1 from auth.users u where u.id = ua.user_id)          -- ignora contas órfãs de testes antigos (usuário de Auth já apagado); elas não são apagadas aqui
  on conflict (user_id, org_id) do nothing;

-- espelho: toda escrita legada em user_accounts mantém o vínculo coerente
create or replace function private.user_accounts_mirror() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.org_memberships set status = 'removed' where user_id = old.user_id and org_id = old.org_id; return old;
  end if;
  insert into public.org_memberships (user_id, org_id, person_id, status, is_default, created_at)
    values (new.user_id, new.org_id, new.person_id, case when new.status = 'active' then 'active' else 'suspended' end,
            not exists (select 1 from public.org_memberships x where x.user_id = new.user_id and x.is_default), new.created_at)
    on conflict (user_id, org_id) do update set person_id = excluded.person_id, status = excluded.status;
  return new;
end $$;
create trigger user_accounts_mirror after insert or update or delete on public.user_accounts for each row execute function private.user_accounts_mirror();

-- ---------------------------------------------------------------- 2. organização ativa e funções de contexto (todas passam a respeitar a organização do papel)
create or replace function private.current_org() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_set text; v_org uuid;
begin
  if v_uid is null then return null; end if;
  v_set := nullif(current_setting('app.active_org', true), '');
  if v_set is not null then
    begin
      select m.org_id into v_org from public.org_memberships m where m.user_id = v_uid and m.org_id = v_set::uuid and m.status = 'active';
    exception when others then v_org := null; end;
    return v_org;                                                  -- vínculo escolhido inválido → NENHUMA organização (nunca cai em outra)
  end if;
  select m.org_id into v_org from public.org_memberships m where m.user_id = v_uid and m.status = 'active' order by m.is_default desc, m.created_at limit 1;
  return v_org;
end $$;

create or replace function private.real_person() returns uuid language sql stable security definer set search_path = '' as $$
  select m.person_id from public.org_memberships m where m.user_id = (select auth.uid()) and m.org_id = (select private.current_org()) and m.status = 'active'
$$;

create or replace function private.has_org_role(p_roles public.app_role[]) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_assignments ra
    join public.org_memberships m on m.user_id = ra.user_id and m.org_id = ra.org_id and m.status = 'active'
    where ra.user_id = (select auth.uid()) and ra.org_id = (select private.current_org())
      and ra.role = any (p_roles) and ra.unit_id is null
      and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
  )
$$;

create or replace function private.has_unit_role(p_roles public.app_role[], p_unit uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_assignments ra
    join public.org_memberships m on m.user_id = ra.user_id and m.org_id = ra.org_id and m.status = 'active'
    where ra.user_id = (select auth.uid()) and ra.org_id = (select private.current_org())
      and ra.role = any (p_roles)
      and (ra.unit_id is null or (p_unit is not null and ra.unit_id = p_unit))
      and (p_unit is null or exists (select 1 from public.units u where u.id = p_unit and u.org_id = ra.org_id))      -- a unidade precisa ser da organização ativa
      and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
  )
$$;

create or replace function private.has_any_role(p_roles public.app_role[]) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_assignments ra
    join public.org_memberships m on m.user_id = ra.user_id and m.org_id = ra.org_id and m.status = 'active'
    where ra.user_id = (select auth.uid()) and ra.org_id = (select private.current_org()) and ra.role = any (p_roles)
      and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
  )
$$;
create or replace function private.has_role_any(p_roles public.app_role[]) returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_any_role(p_roles)
$$;

-- ---------------------------------------------------------------- 3. pré-request: valida o cabeçalho x-org (e mantém o "ver como" exatamente como era)
create or replace function public.hp_pre_request() returns void language plpgsql security definer set search_path = '' as $$
declare h text; ho text; v_claims jsonb; v_real uuid; s public.view_as_sessions; v_id uuid;
begin
  begin h := nullif(btrim(current_setting('request.headers', true)::json ->> 'x-view-as'), ''); exception when others then h := null; end;
  if h is not null then
    begin
      v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
      v_real := nullif(v_claims ->> 'sub', '')::uuid; v_id := h::uuid;
      select * into s from public.view_as_sessions where id = v_id;
    exception when others then raise exception 'ver como inválido' using errcode = '42501'; end;
    if v_real is null or s.id is null or s.viewer_user_id <> v_real or s.ended_at is not null or s.expires_at <= now() or v_claims ? 'view_as_by' then
      raise exception 'ver como inválido ou expirado' using errcode = '42501';
    end if;
    if not exists (select 1 from public.role_assignments ra join public.org_memberships m on m.user_id = ra.user_id and m.org_id = ra.org_id and m.status = 'active'
                    where ra.user_id = v_real and ra.role = 'manager' and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())) then
      raise exception 'ver como inválido ou expirado' using errcode = '42501';
    end if;
    if private.view_as_target_kind(s.target_user_id) is distinct from s.target_kind then raise exception 'ver como inválido ou expirado' using errcode = '42501'; end if;
    v_claims := (v_claims - 'email' - 'phone') || jsonb_build_object('sub', s.target_user_id::text, 'view_as_by', v_real::text);
    perform set_config('request.jwt.claims', v_claims::text, true);
    perform set_config('request.jwt.claim.sub', s.target_user_id::text, true);
    perform set_config('app.view_as_session', s.id::text, true);
    perform set_config('transaction_read_only', 'on', true);
  end if;

  -- organização ativa: o valor do cabeçalho é só uma ESCOLHA; o vínculo do usuário (já com o "ver como" aplicado) é revalidado aqui
  begin ho := nullif(btrim(current_setting('request.headers', true)::json ->> 'x-org'), ''); exception when others then ho := null; end;
  if ho is not null and (select auth.uid()) is not null then
    begin
      if not exists (select 1 from public.org_memberships m where m.user_id = (select auth.uid()) and m.org_id = ho::uuid and m.status = 'active') then
        raise exception 'organização inválida para este usuário' using errcode = '42501';
      end if;
    exception when invalid_text_representation then raise exception 'organização inválida' using errcode = '42501'; end;
    perform set_config('app.active_org', ho, true);
  end if;
end $$;

-- ---------------------------------------------------------------- 4. unicidades que impediam atuar em DUAS organizações
drop index if exists public.role_assignments_active_uq;
create unique index role_assignments_active_uq on public.role_assignments (org_id, user_id, role, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
drop index if exists public.acc_grants_active_uq;
create unique index acc_grants_active_uq on public.acc_grants (org_id, user_id, permission, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
alter table public.professionals drop constraint if exists professionals_user_id_key;
create unique index professionals_org_user_uq on public.professionals (org_id, user_id) where user_id is not null;

-- convite aceito na confirmação do e-mail: a regra "uma conta por usuário" passa a ser "um vínculo por usuário e organização"
create or replace function private.on_auth_user_confirmed() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inv record; v_boot record;
begin
  if new.email_confirmed_at is null or new.email is null then return new; end if;
  select * into v_boot from private.manager_bootstrap_emails b where b.consumed_at is null and b.email = new.email::extensions.citext for update skip locked limit 1;
  if found then
    insert into public.user_accounts (user_id, org_id) values (new.id, v_boot.org_id) on conflict (user_id) do nothing;
    insert into public.org_memberships (user_id, org_id, status, is_default) values (new.id, v_boot.org_id, 'active', not exists (select 1 from public.org_memberships x where x.user_id = new.id and x.is_default))
      on conflict (user_id, org_id) do update set status = 'active';
    insert into public.role_assignments (org_id, user_id, role, granted_by) values (v_boot.org_id, new.id, 'manager', null) on conflict do nothing;
    update private.manager_bootstrap_emails set consumed_at = now(), consumed_by = new.id where org_id = v_boot.org_id and email = v_boot.email;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns) values (v_boot.org_id, new.id, 'bootstrap_manager', 'user', new.id::text, array['role']);
    return new;
  end if;
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

-- ---------------------------------------------------------------- 5. guarda: nenhum vínculo entre linhas de organizações diferentes
create table private.org_fk_map (child_table text not null, child_col text not null, parent_table text not null, primary key (child_table, child_col));
create or replace function private.org_fk_map_refresh() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  truncate private.org_fk_map;
  insert into private.org_fk_map (child_table, child_col, parent_table)
    select cl.relname, a.attname, pl.relname
      from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_class pl on pl.oid = c.confrelid
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
     where c.contype = 'f' and cl.relnamespace = 'public'::regnamespace and pl.relnamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1 and pa.attname = 'id' and a.attname <> 'org_id'
       and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = cl.relname and k.column_name = 'org_id')
       and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = pl.relname and k.column_name = 'org_id')
     on conflict do nothing;
  get diagnostics n = row_count; return n;
end $$;

create or replace function private.org_fk_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare m record; v_val uuid; v_org uuid; v_new jsonb := to_jsonb(new); v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  if new.org_id is null then return new; end if;
  for m in select child_col, parent_table from private.org_fk_map where child_table = tg_table_name loop
    v_val := nullif(v_new ->> m.child_col, '')::uuid;
    if v_val is null then continue; end if;
    if v_old is not null and (v_old ->> m.child_col) is not distinct from (v_new ->> m.child_col) and (v_old ->> 'org_id') is not distinct from (v_new ->> 'org_id') then continue; end if;
    execute format('select org_id from public.%I where id = $1', m.parent_table) into v_org using v_val;
    if v_org is not null and v_org <> new.org_id then
      raise exception 'vínculo entre organizações diferentes (%.% → %)', tg_table_name, m.child_col, m.parent_table using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

create or replace function private.org_fk_guard_attach() returns int language plpgsql security definer set search_path = '' as $$
declare t text; n int := 0;
begin
  for t in select distinct child_table from private.org_fk_map loop
    if not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t)::regclass and g.tgname = 'zz_org_fk_guard') then
      execute format('create trigger zz_org_fk_guard before insert or update on public.%I for each row execute function private.org_fk_guard()', t); n := n + 1;
    end if;
  end loop;
  return n;
end $$;
select private.org_fk_map_refresh();
select private.org_fk_guard_attach();

-- ---------------------------------------------------------------- 6. contexto para o front: meus vínculos e a organização ativa
create or replace function public.my_memberships() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object('active', private.current_org(), 'platform_admin', private.is_platform_admin(),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('org_id', o.id, 'name', o.name, 'slug', o.slug, 'is_default', m.is_default) order by m.is_default desc, o.name)
                               from public.org_memberships m join public.organizations o on o.id = m.org_id where m.user_id = v_uid and m.status = 'active'), '[]'::jsonb));
end $$;

revoke all on function private.is_platform_admin(), private.user_accounts_mirror(), private.org_fk_map_refresh(), private.org_fk_guard(), private.org_fk_guard_attach() from public, anon, authenticated;
revoke all on function public.my_memberships() from public, anon; grant execute on function public.my_memberships() to authenticated;
