-- HP Group Hub — 045 App Administrativo (ADM): planilha PF/PJ sobre o cadastro central.
-- PF = public.people (já existe, estendido aqui). PJ = public.legal_entities (nova — empresa, não reaproveita
-- corporate_accounts porque essa tabela é uma coisa mais estreita: conta corporativa de bem-estar ligada a uma
-- venda específica, com relatório k-anônimo próprio; forçar CNPJ/endereço/representantes ali distorceria seu
-- propósito. corporate_accounts pode opcionalmente referenciar uma legal_entity quando fizer sentido (abaixo).
-- Nunca duas bases paralelas de "pessoa": PJ nunca duplica people, e representantes de PJ são sempre people.

-- ---------------------------------------------------------------- validação de documento (formato, não identidade)
-- Confere o dígito verificador oficial de CPF/CNPJ — não prova identidade nem situação cadastral, só o formato.
create or replace function private.is_valid_cpf(p_doc text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare d text; digs int[]; sum1 int := 0; sum2 int := 0; dv1 int; dv2 int;
begin
  d := regexp_replace(coalesce(p_doc, ''), '\D', '', 'g');
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  digs := array(select substring(d from i for 1)::int from generate_series(1, 11) i);
  for i in 1..9 loop sum1 := sum1 + digs[i] * (11 - i); end loop;
  dv1 := 11 - (sum1 % 11); if dv1 >= 10 then dv1 := 0; end if;
  if dv1 <> digs[10] then return false; end if;
  for i in 1..10 loop sum2 := sum2 + digs[i] * (12 - i); end loop;
  dv2 := 11 - (sum2 % 11); if dv2 >= 10 then dv2 := 0; end if;
  return dv2 = digs[11];
end $$;

create or replace function private.is_valid_cnpj(p_doc text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare d text; digs int[]; w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2]; sum1 int := 0; sum2 int := 0; dv1 int; dv2 int;
begin
  d := regexp_replace(coalesce(p_doc, ''), '\D', '', 'g');
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  digs := array(select substring(d from i for 1)::int from generate_series(1, 14) i);
  for i in 1..12 loop sum1 := sum1 + digs[i] * w1[i]; end loop;
  dv1 := 11 - (sum1 % 11); if dv1 >= 10 then dv1 := 0; end if;
  if dv1 <> digs[13] then return false; end if;
  for i in 1..13 loop sum2 := sum2 + digs[i] * w2[i]; end loop;
  dv2 := 11 - (sum2 % 11); if dv2 >= 10 then dv2 := 0; end if;
  return dv2 = digs[14];
end $$;

-- ---------------------------------------------------------------- permissão do app ADM
-- Consolida a área de Gestão existente: mesmos papéis que já liam Pessoas (manager/ops_admin/unit_manager/sales)
-- veem a planilha; ações sensíveis (documento completo, importação, exportação, ações em lote) exigem manager/ops_admin.
-- private.has_unit_role(roles, null) só bate com atribuição SEM unidade (org-wide) — inútil aqui, já que
-- unit_manager/sales normalmente têm atribuição POR unidade. Mesmo padrão de private.crm_units/is_team_viewer.
create or replace function private.can_adm(p_unit uuid default null) returns boolean
language sql stable set search_path = '' as $$
  select private.has_org_role(array['manager','ops_admin']::public.app_role[])
    or exists (
      select 1 from public.role_assignments ra
      join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
      where ra.user_id = (select auth.uid()) and ra.role = any (array['unit_manager','sales']::public.app_role[])
        and ra.unit_id is not null and (p_unit is null or ra.unit_id = p_unit)
        and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
    )
$$;
create or replace function private.can_adm_sensitive() returns boolean
language sql stable set search_path = '' as $$
  select private.has_org_role(array['manager','ops_admin']::public.app_role[])
$$;

-- ---------------------------------------------------------------- extensão de people (campos administrativos de PF)
alter table public.people
  add column if not exists cep text,
  add column if not exists street text,
  add column if not exists street_number text,
  add column if not exists complement text,
  add column if not exists neighborhood text,
  add column if not exists registration_status text not null default 'ativo' check (registration_status in ('ativo','pendente','inativo')),
  add column if not exists origin text,
  add column if not exists internal_owner_user_id uuid references auth.users(id) on delete set null;

-- pessoa pode estar vinculada a mais de uma unidade além da principal (people.unit_id)
create table if not exists public.person_units (
  person_id uuid not null references public.people(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  primary key (person_id, unit_id)
);
alter table public.person_units enable row level security;
grant select, insert, delete on public.person_units to authenticated;
create policy person_units_read on public.person_units for select to authenticated
  using (exists (select 1 from public.people p where p.id = person_id and private.can_read_person(p.id)));
create policy person_units_write on public.person_units for insert to authenticated
  with check (exists (select 1 from public.units u where u.id = unit_id and private.can_adm_sensitive() and u.org_id = private.current_org()));
create policy person_units_delete on public.person_units for delete to authenticated
  using (exists (select 1 from public.units u where u.id = unit_id and private.can_adm_sensitive() and u.org_id = private.current_org()));

-- adiciona 'supplier' (fornecedor) ao leque de vínculos — patient/partner/student/contact/staff já existem
alter type public.person_kind add value if not exists 'supplier';

-- ---------------------------------------------------------------- pessoa jurídica (empresas)
create table public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  cnpj text,                                    -- normalizado (só dígitos); validado no servidor, nunca a prova de identidade
  legal_name text not null check (length(btrim(legal_name)) > 1),   -- razão social
  trade_name text,                              -- nome fantasia
  state_registration text,
  state_registration_exempt boolean not null default false,
  municipal_registration text,
  legal_nature text,
  cnae_main text,
  cnae_secondary text[] not null default '{}',
  tax_regime text,
  founded_on date,
  email_general text,
  email_finance text,
  email_billing text,
  phone text,
  whatsapp text,
  cep text, street text, street_number text, complement text, neighborhood text,
  city text, state_uf text, country text not null default 'BR',
  registration_status text not null default 'ativo' check (registration_status in ('ativo','pendente','inativo')),
  origin text,
  internal_owner_user_id uuid references auth.users(id) on delete set null,
  notes text,
  corporate_account_id uuid references public.corporate_accounts(id) on delete set null,   -- link opcional, quando esta PJ também é uma conta corporativa de bem-estar
  merged_into_id uuid references public.legal_entities(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (merged_into_id is null or merged_into_id <> id)
);
create unique index legal_entities_cnpj_uq on public.legal_entities (org_id, cnpj) where cnpj is not null and merged_into_id is null;
create index legal_entities_name_trgm_idx on public.legal_entities using gin (lower(legal_name) extensions.gin_trgm_ops);
create trigger legal_entities_touch before update on public.legal_entities for each row execute function private.touch_updated_at();

create table public.legal_entity_units (
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  primary key (legal_entity_id, unit_id)
);

-- representantes/contatos da PJ — SEMPRE uma pessoa física existente (nunca um cadastro paralelo de nome solto)
create table public.legal_entity_representatives (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  role_title text,                              -- cargo
  representation_type text not null default 'contact' check (representation_type in ('legal_representative','contact','billing')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (legal_entity_id, person_id, representation_type)
);
create unique index legal_entity_reps_primary_uq on public.legal_entity_representatives (legal_entity_id) where is_primary;

create table public.legal_entity_documents (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  kind text not null,                           -- 'contrato_social','alteracao','outro'
  title text not null check (length(btrim(title)) > 1),
  storage_path text not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

alter table public.legal_entities enable row level security;
alter table public.legal_entity_units enable row level security;
alter table public.legal_entity_representatives enable row level security;
alter table public.legal_entity_documents enable row level security;
grant select, insert, update on public.legal_entities to authenticated;
grant select, insert, delete on public.legal_entity_units, public.legal_entity_representatives to authenticated;
grant select, insert, delete on public.legal_entity_documents to authenticated;

create policy legal_entities_read on public.legal_entities for select to authenticated using (private.in_org(org_id) and private.can_adm());
create policy legal_entities_write on public.legal_entities for insert to authenticated with check (private.in_org(org_id) and private.can_adm_sensitive());
create policy legal_entities_update on public.legal_entities for update to authenticated using (private.in_org(org_id) and private.can_adm_sensitive()) with check (private.in_org(org_id));
create policy legal_entity_units_read on public.legal_entity_units for select to authenticated using (exists (select 1 from public.legal_entities e where e.id = legal_entity_id and private.can_adm()));
create policy legal_entity_units_write on public.legal_entity_units for insert to authenticated with check (exists (select 1 from public.legal_entities e where e.id = legal_entity_id and private.can_adm_sensitive()));
create policy legal_entity_units_delete on public.legal_entity_units for delete to authenticated using (exists (select 1 from public.legal_entities e where e.id = legal_entity_id and private.can_adm_sensitive()));
create policy legal_entity_reps_read on public.legal_entity_representatives for select to authenticated using (exists (select 1 from public.legal_entities e where e.id = legal_entity_id and private.can_adm()));
create policy legal_entity_reps_write on public.legal_entity_representatives for insert to authenticated with check (exists (select 1 from public.legal_entities e where e.id = legal_entity_id and private.can_adm_sensitive()));
create policy legal_entity_reps_delete on public.legal_entity_representatives for delete to authenticated using (exists (select 1 from public.legal_entities e where e.id = legal_entity_id and private.can_adm_sensitive()));
create policy legal_entity_docs_read on public.legal_entity_documents for select to authenticated using (exists (select 1 from public.legal_entities e where e.id = legal_entity_id and private.can_adm_sensitive()));
create policy legal_entity_docs_write on public.legal_entity_documents for insert to authenticated with check (exists (select 1 from public.legal_entities e where e.id = legal_entity_id and private.can_adm_sensitive()));
create policy legal_entity_docs_delete on public.legal_entity_documents for delete to authenticated using (exists (select 1 from public.legal_entities e where e.id = legal_entity_id and private.can_adm_sensitive()));

-- storage privado para documentos empresariais (mesmo padrão do bucket academy-private)
insert into storage.buckets (id, name, public) values ('legal-documents', 'legal-documents', false) on conflict (id) do nothing;
create policy legal_docs_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'legal-documents' and private.can_adm_sensitive());
create policy legal_docs_storage_write on storage.objects for insert to authenticated
  with check (bucket_id = 'legal-documents' and private.can_adm_sensitive());
create policy legal_docs_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'legal-documents' and private.can_adm_sensitive());

grant execute on function private.is_valid_cpf(text), private.is_valid_cnpj(text) to authenticated;
