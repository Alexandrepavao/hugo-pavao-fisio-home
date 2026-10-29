-- HP Group Hub — 092 Finanças pessoais: base (acesso restrito ao proprietário, contas, cartões, categorias, lançamentos, séries, liquidações, faturas, transferências).
-- Os dados pessoais ficam em tabelas próprias (pf_*), SEPARADAS do financeiro empresarial: nenhuma política, relatório, DRE, caixa, exportação ou busca da empresa as lê.
-- Autoridade = a tabela pf_access (concedida só pela ferramenta de operação, nunca pelo app) + o recurso ligado na organização (organizations.features). Papel de gestor NÃO dá acesso.
-- Dinheiro: bigint em centavos. Datas financeiras: `date` (sem fuso). Escrita só por função; leitura por RLS (somente o dono). Sem auditoria compartilhada (audit_log é visível à gestão).

-- ---------------------------------------------------------------- 1) recurso por organização e acesso individual
alter table public.organizations add column if not exists features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object');

create table public.pf_access (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(), granted_note text, revoked_at timestamptz,
  primary key (org_id, user_id)
);
alter table public.pf_access enable row level security;                       -- sem política: nenhum papel lê/grava pela API
revoke all on public.pf_access from anon, authenticated;

-- o usuário autorizado (ou nulo): acesso concedido e não revogado + recurso ligado na organização + conta ativa na mesma organização
create or replace function private.pf_user() returns uuid
language sql stable security definer set search_path = '' as $$
  select a.user_id from public.pf_access a
    join public.organizations o on o.id = a.org_id
    join public.user_accounts ua on ua.user_id = a.user_id and ua.org_id = a.org_id and ua.status = 'active'
   where a.user_id = (select auth.uid()) and a.revoked_at is null and coalesce((o.features ->> 'personal_finance')::boolean, false)
   limit 1
$$;
create or replace function private.pf_org() returns uuid
language sql stable security definer set search_path = '' as $$
  select a.org_id from public.pf_access a
    join public.organizations o on o.id = a.org_id
    join public.user_accounts ua on ua.user_id = a.user_id and ua.org_id = a.org_id and ua.status = 'active'
   where a.user_id = (select auth.uid()) and a.revoked_at is null and coalesce((o.features ->> 'personal_finance')::boolean, false)
   limit 1
$$;
revoke all on function private.pf_user(), private.pf_org() from public, anon;
grant execute on function private.pf_user(), private.pf_org() to authenticated;      -- usadas pelas políticas de RLS (que rodam com o papel do usuário)
-- exige o acesso; devolve o dono (nunca confia em parâmetro vindo do cliente)
create or replace function private.pf_require() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.pf_user();
begin if v is null then raise exception 'sem acesso às finanças pessoais' using errcode = '42501'; end if; return v; end $$;
revoke all on function private.pf_require() from public, anon;

create or replace function public.pf_my_access() returns jsonb
language sql stable security definer set search_path = '' as $$ select jsonb_build_object('enabled', private.pf_user() is not null) $$;
revoke all on function public.pf_my_access() from public, anon;
grant execute on function public.pf_my_access() to authenticated;

-- data de hoje no fuso de São Paulo (datas financeiras locais)
create or replace function private.pf_today() returns date language sql stable set search_path = '' as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function private.pf_clamp_day(p_year int, p_month int, p_day int) returns date
language sql immutable set search_path = '' as $$
  select make_date(p_year, p_month, least(greatest(p_day, 1), extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::int))
$$;
-- uuid determinístico a partir de um texto (idempotência de grupos de parcelas)
create or replace function private.pf_uuid_from(p text) returns uuid language sql immutable set search_path = '' as $$ select md5(p)::uuid $$;

-- ---------------------------------------------------------------- 2) tabelas
create table public.pf_settings (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  reminder_days_before int not null default 3 check (reminder_days_before between 0 and 30),
  plan_next_month_with_income boolean not null default false,
  reserve_target_months numeric(4,1) not null default 6 check (reserve_target_months between 0 and 60),
  created_at timestamptz not null default now()
);

create table public.pf_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  kind text not null default 'checking' check (kind in ('checking','savings','cash','wallet','investment')),
  opening_balance_cents bigint not null default 0,
  opening_date date not null default current_date,
  counts_for_reserve boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (owner_user_id, name)
);

create table public.pf_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (length(btrim(nickname)) between 2 and 60),
  issuer text not null check (length(btrim(issuer)) between 2 and 60),
  brand text not null default 'outra' check (brand in ('visa','mastercard','elo','amex','hipercard','outra')),
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),                                  -- nunca o número completo, CVV ou credenciais
  limit_cents bigint not null check (limit_cents > 0),
  closing_day int not null check (closing_day between 1 and 28),
  due_day int not null check (due_day between 1 and 28),
  pay_account_id uuid references public.pf_accounts(id) on delete set null,
  status text not null default 'active' check (status in ('active','blocked','closed')),
  created_at timestamptz not null default now(),
  unique (owner_user_id, nickname)
);

create table public.pf_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.pf_cards(id) on delete cascade,
  cycle_start date not null, closing_date date not null, due_date date not null,
  created_at timestamptz not null default now(),
  unique (card_id, cycle_start)
);

create table public.pf_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 60),
  kind text not null check (kind in ('income','expense')),
  parent_id uuid references public.pf_categories(id) on delete restrict,
  essential boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index pf_categories_unique on public.pf_categories (owner_user_id, kind, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- recorrências: a série guarda a REGRA; as ocorrências futuras são calculadas (virtuais) e só viram lançamento quando tocadas (liquidar, editar, cancelar)
create table public.pf_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  root_id uuid not null,                                                                     -- linhagem (uma série dividida em "esta e as próximas" mantém a raiz)
  parent_series_id uuid references public.pf_series(id) on delete set null,
  kind text not null check (kind in ('income','expense')),
  description text not null check (length(btrim(description)) between 2 and 140),
  category_id uuid references public.pf_categories(id) on delete restrict,
  account_id uuid references public.pf_accounts(id) on delete restrict,
  card_id uuid references public.pf_cards(id) on delete restrict,
  nature text not null default 'fixed' check (nature in ('fixed','variable')),
  essential boolean not null default false,
  frequency text not null check (frequency in ('weekly','biweekly','semimonthly','monthly','quarterly','semiannual','annual')),
  start_date date not null,
  due_day int check (due_day between 1 and 31),                                              -- mensal e maiores: dia do vencimento (31 em mês menor = último dia: regra explícita abaixo)
  due_day2 int check (due_day2 between 1 and 31),                                            -- só "duas vezes por mês"
  short_month_rule text not null default 'last_day' check (short_month_rule in ('last_day')),
  end_mode text not null default 'none' check (end_mode in ('none','date','count')),
  end_date date, end_count int check (end_count between 1 and 1200),
  amount_cents bigint check (amount_cents > 0),                                              -- valor fixo ou ESTIMATIVA (variável); nulo = sem estimativa
  is_estimate boolean not null default false,
  status text not null default 'active' check (status in ('active','paused','ended')),
  ended_on date,                                                                             -- nenhuma ocorrência nesta data ou depois
  notes text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  check (not (card_id is not null and account_id is not null)),
  check ((frequency = 'semimonthly') = (due_day2 is not null)),
  check ((end_mode = 'date') = (end_date is not null)),
  check ((end_mode = 'count') = (end_count is not null))
);
create unique index pf_series_key on public.pf_series (owner_user_id, idempotency_key) where idempotency_key is not null;
create table public.pf_series_pauses (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.pf_series(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  from_date date not null, to_date date,                                                     -- pausa em [from_date, to_date); to_date nulo = em aberto
  check (to_date is null or to_date > from_date)
);

create table public.pf_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income','expense')),
  description text not null check (length(btrim(description)) between 2 and 140),
  category_id uuid references public.pf_categories(id) on delete restrict,
  account_id uuid references public.pf_accounts(id) on delete restrict,
  card_id uuid references public.pf_cards(id) on delete restrict,
  invoice_id uuid references public.pf_invoices(id) on delete restrict,
  competence_date date not null,
  due_date date not null,
  original_due_date date not null,                                                           -- preservada em reagendamentos
  amount_cents bigint not null check (amount_cents > 0),
  estimated_cents bigint,                                                                    -- a estimativa original, quando o valor real a substituiu
  is_estimate boolean not null default false,
  nature text not null default 'fixed' check (nature in ('fixed','variable')),
  repetition text not null default 'single' check (repetition in ('single','recurring','installment')),
  series_id uuid references public.pf_series(id) on delete restrict,
  series_root_id uuid,
  occurrence_date date, occurrence_no int,
  installment_group uuid, installment_no int, installment_total int,
  status text not null default 'open' check (status in ('planned','open','partial','settled','cancelled')),
  settled_cents bigint not null default 0 check (settled_cents >= 0),
  settled_on date,
  essential boolean not null default false,
  overridden boolean not null default false,                                                 -- editada só nesta ocorrência (a série não a altera mais)
  notes text,
  receipt_path text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  check (not (card_id is not null and account_id is not null)),
  check ((repetition = 'recurring') = (series_id is not null)),
  check ((repetition = 'installment') = (installment_group is not null))
);
create unique index pf_entries_occurrence on public.pf_entries (series_root_id, occurrence_date) where series_root_id is not null and occurrence_date is not null;
create unique index pf_entries_installment on public.pf_entries (installment_group, installment_no) where installment_group is not null;
create unique index pf_entries_key on public.pf_entries (owner_user_id, idempotency_key) where idempotency_key is not null;
create index pf_entries_due on public.pf_entries (owner_user_id, due_date);
create index pf_entries_comp on public.pf_entries (owner_user_id, competence_date);
create index pf_entries_invoice on public.pf_entries (invoice_id) where invoice_id is not null;

create table public.pf_entry_events (                                                        -- histórico privado (nada vai para o audit_log da empresa)
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid references public.pf_entries(id) on delete cascade,
  series_id uuid references public.pf_series(id) on delete cascade,
  kind text not null, detail jsonb not null default '{}'::jsonb, at timestamptz not null default now()
);

create table public.pf_settlements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.pf_entries(id) on delete restrict,
  account_id uuid not null references public.pf_accounts(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  settled_on date not null,
  note text, source text not null default 'manual' check (source in ('manual','import')),
  import_line_id uuid,
  idempotency_key text, voided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index pf_settlements_key on public.pf_settlements (owner_user_id, idempotency_key) where idempotency_key is not null;
create index pf_settlements_entry on public.pf_settlements (entry_id);

create table public.pf_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.pf_invoices(id) on delete restrict,
  account_id uuid not null references public.pf_accounts(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  idempotency_key text, voided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index pf_invoice_payments_key on public.pf_invoice_payments (owner_user_id, idempotency_key) where idempotency_key is not null;

create table public.pf_goals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  kind text not null default 'objective' check (kind in ('savings','emergency','objective')),
  target_cents bigint not null check (target_cents > 0),
  target_date date,
  monthly_contribution_cents bigint not null default 0 check (monthly_contribution_cents >= 0),
  account_id uuid references public.pf_accounts(id) on delete set null,                      -- se informada, o progresso é o saldo dessa conta
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pf_transfers (                                                           -- movimentação patrimonial: não é receita nem custo de vida
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  from_account_id uuid not null references public.pf_accounts(id) on delete restrict,
  to_account_id uuid not null references public.pf_accounts(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  on_date date not null,
  kind text not null default 'transfer' check (kind in ('transfer','reserve','goal','investment')),
  goal_id uuid references public.pf_goals(id) on delete set null,
  note text, idempotency_key text, voided_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create unique index pf_transfers_key on public.pf_transfers (owner_user_id, idempotency_key) where idempotency_key is not null;

create table public.pf_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_id uuid not null references public.pf_categories(id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  unique (owner_user_id, month, category_id)
);

create table public.pf_reminder_acks (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_key text not null, acked_at timestamptz not null default now(),
  primary key (owner_user_id, occurrence_key)
);

-- ---------------------------------------------------------------- 3) RLS: SOMENTE o dono autorizado lê; nenhuma política de gestão/empresa; escrita só por função
do $$
declare t text;
begin
  foreach t in array array['pf_settings','pf_accounts','pf_cards','pf_invoices','pf_categories','pf_series','pf_series_pauses','pf_entries','pf_entry_events','pf_settlements',
                           'pf_invoice_payments','pf_goals','pf_transfers','pf_budgets','pf_reminder_acks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_user_id = (select private.pf_user()))', t || '_owner_read', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 4) preparação do primeiro uso (idempotente): configurações e categorias padrão
create or replace function public.pf_bootstrap() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); c record; p uuid; n int := 0;
begin
  insert into public.pf_settings (owner_user_id, org_id) values (v_user, v_org) on conflict do nothing;
  if not exists (select 1 from public.pf_categories where owner_user_id = v_user) then
    for c in select * from (values
      ('income','Salário e pró-labore',false),('income','Retirada da empresa',false),('income','Rendimentos',false),('income','Outras receitas',false),
      ('expense','Moradia',true),('expense','Alimentação',true),('expense','Transporte',true),('expense','Saúde',true),('expense','Educação',true),
      ('expense','Lazer',false),('expense','Assinaturas',false),('expense','Impostos e taxas',true),('expense','Cartão de crédito',false),('expense','Outras despesas',false)) v(k, nm, es) loop
      insert into public.pf_categories (org_id, owner_user_id, name, kind, essential) values (v_org, v_user, c.nm, c.k, c.es); n := n + 1;
    end loop;
    select id into p from public.pf_categories where owner_user_id = v_user and name = 'Moradia';
    insert into public.pf_categories (org_id, owner_user_id, name, kind, parent_id, essential) values
      (v_org, v_user, 'Aluguel e condomínio', 'expense', p, true), (v_org, v_user, 'Energia e água', 'expense', p, true), (v_org, v_user, 'Internet e telefone', 'expense', p, true);
  end if;
  return jsonb_build_object('categories', n);
end $$;
revoke all on function public.pf_bootstrap() from public, anon;
grant execute on function public.pf_bootstrap() to authenticated;

-- ---------------------------------------------------------------- 5) contas, cartões, categorias, metas (cadastros)
create or replace function public.pf_account_save(p_id uuid, p_name text, p_kind text, p_opening_cents bigint, p_opening_date date, p_reserve boolean, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); v_id uuid;
begin
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'informe o nome da conta'; end if;
  if p_kind not in ('checking','savings','cash','wallet','investment') then raise exception 'tipo de conta inválido'; end if;
  if p_opening_date is null then raise exception 'informe a data do saldo inicial'; end if;
  if p_id is null then
    insert into public.pf_accounts (org_id, owner_user_id, name, kind, opening_balance_cents, opening_date, counts_for_reserve, active)
      values (v_org, v_user, btrim(p_name), p_kind, coalesce(p_opening_cents, 0), p_opening_date, coalesce(p_reserve, false), coalesce(p_active, true)) returning id into v_id;
  else
    update public.pf_accounts set name = btrim(p_name), kind = p_kind, opening_balance_cents = coalesce(p_opening_cents, 0), opening_date = p_opening_date,
           counts_for_reserve = coalesce(p_reserve, false), active = coalesce(p_active, true)
     where id = p_id and owner_user_id = v_user returning id into v_id;
    if v_id is null then raise exception 'conta não encontrada'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.pf_account_save(uuid, text, text, bigint, date, boolean, boolean) from public, anon;
grant execute on function public.pf_account_save(uuid, text, text, bigint, date, boolean, boolean) to authenticated;

create or replace function public.pf_card_save(p_id uuid, p_nickname text, p_issuer text, p_brand text, p_limit_cents bigint, p_closing_day int, p_due_day int, p_last4 text default null,
  p_pay_account uuid default null, p_status text default 'active') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); v_id uuid;
begin
  if length(btrim(coalesce(p_nickname, ''))) < 2 then raise exception 'informe o apelido do cartão'; end if;
  if length(btrim(coalesce(p_issuer, ''))) < 2 then raise exception 'informe o emissor'; end if;
  if lower(coalesce(p_brand, '')) not in ('visa','mastercard','elo','amex','hipercard','outra') then raise exception 'bandeira inválida'; end if;
  if p_limit_cents is null or p_limit_cents <= 0 then raise exception 'o limite precisa ser maior que zero'; end if;
  if p_closing_day not between 1 and 28 or p_due_day not between 1 and 28 then raise exception 'fechamento e vencimento precisam estar entre os dias 1 e 28'; end if;
  if p_last4 is not null and p_last4 !~ '^[0-9]{4}$' then raise exception 'informe somente os 4 últimos dígitos (nunca o número completo)'; end if;
  if p_status not in ('active','blocked','closed') then raise exception 'situação inválida'; end if;
  if p_pay_account is not null and not exists (select 1 from public.pf_accounts where id = p_pay_account and owner_user_id = v_user) then raise exception 'conta de pagamento inválida'; end if;
  if p_id is null then
    insert into public.pf_cards (org_id, owner_user_id, nickname, issuer, brand, last4, limit_cents, closing_day, due_day, pay_account_id, status)
      values (v_org, v_user, btrim(p_nickname), btrim(p_issuer), lower(p_brand), p_last4, p_limit_cents, p_closing_day, p_due_day, p_pay_account, p_status) returning id into v_id;
  else
    update public.pf_cards set nickname = btrim(p_nickname), issuer = btrim(p_issuer), brand = lower(p_brand), last4 = p_last4, limit_cents = p_limit_cents,
           closing_day = p_closing_day, due_day = p_due_day, pay_account_id = p_pay_account, status = p_status
     where id = p_id and owner_user_id = v_user returning id into v_id;
    if v_id is null then raise exception 'cartão não encontrado'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.pf_card_save(uuid, text, text, text, bigint, int, int, text, uuid, text) from public, anon;
grant execute on function public.pf_card_save(uuid, text, text, text, bigint, int, int, text, uuid, text) to authenticated;

create or replace function public.pf_category_save(p_id uuid, p_name text, p_kind text, p_parent uuid, p_essential boolean, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); v_id uuid; v_pk text; v_pp uuid;
begin
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'informe o nome da categoria'; end if;
  if p_kind not in ('income','expense') then raise exception 'tipo inválido'; end if;
  if p_parent is not null then
    select kind, parent_id into v_pk, v_pp from public.pf_categories where id = p_parent and owner_user_id = v_user;
    if not found then raise exception 'categoria principal inválida'; end if;
    if v_pk <> p_kind or v_pp is not null then raise exception 'a subcategoria precisa ser do mesmo tipo e de uma categoria principal'; end if;
  end if;
  if p_id is null then
    insert into public.pf_categories (org_id, owner_user_id, name, kind, parent_id, essential, active) values (v_org, v_user, btrim(p_name), p_kind, p_parent, coalesce(p_essential, false), coalesce(p_active, true)) returning id into v_id;
  else
    update public.pf_categories set name = btrim(p_name), kind = p_kind, parent_id = p_parent, essential = coalesce(p_essential, false), active = coalesce(p_active, true)
     where id = p_id and owner_user_id = v_user returning id into v_id;
    if v_id is null then raise exception 'categoria não encontrada'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.pf_category_save(uuid, text, text, uuid, boolean, boolean) from public, anon;
grant execute on function public.pf_category_save(uuid, text, text, uuid, boolean, boolean) to authenticated;

create or replace function public.pf_goal_save(p_id uuid, p_name text, p_kind text, p_target_cents bigint, p_target_date date, p_monthly_cents bigint, p_account uuid, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); v_id uuid;
begin
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'informe o nome da meta'; end if;
  if p_kind not in ('savings','emergency','objective') then raise exception 'tipo de meta inválido'; end if;
  if p_target_cents is null or p_target_cents <= 0 then raise exception 'o valor-alvo precisa ser maior que zero'; end if;
  if coalesce(p_monthly_cents, 0) < 0 then raise exception 'o aporte mensal não pode ser negativo'; end if;
  if p_account is not null and not exists (select 1 from public.pf_accounts where id = p_account and owner_user_id = v_user) then raise exception 'conta inválida'; end if;
  if p_id is null then
    insert into public.pf_goals (org_id, owner_user_id, name, kind, target_cents, target_date, monthly_contribution_cents, account_id, active)
      values (v_org, v_user, btrim(p_name), p_kind, p_target_cents, p_target_date, coalesce(p_monthly_cents, 0), p_account, coalesce(p_active, true)) returning id into v_id;
  else
    update public.pf_goals set name = btrim(p_name), kind = p_kind, target_cents = p_target_cents, target_date = p_target_date, monthly_contribution_cents = coalesce(p_monthly_cents, 0),
           account_id = p_account, active = coalesce(p_active, true) where id = p_id and owner_user_id = v_user returning id into v_id;
    if v_id is null then raise exception 'meta não encontrada'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.pf_goal_save(uuid, text, text, bigint, date, bigint, uuid, boolean) from public, anon;
grant execute on function public.pf_goal_save(uuid, text, text, bigint, date, bigint, uuid, boolean) to authenticated;

create or replace function public.pf_settings_save(p_reminder_days int, p_plan_next_month boolean, p_reserve_months numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_org uuid := private.pf_org();
begin
  if p_reminder_days not between 0 and 30 then raise exception 'a antecedência do lembrete vai de 0 a 30 dias'; end if;
  if p_reserve_months not between 0 and 60 then raise exception 'a meta de cobertura vai de 0 a 60 meses'; end if;
  insert into public.pf_settings (owner_user_id, org_id, reminder_days_before, plan_next_month_with_income, reserve_target_months) values (v_user, v_org, p_reminder_days, coalesce(p_plan_next_month, false), p_reserve_months)
  on conflict (owner_user_id) do update set reminder_days_before = excluded.reminder_days_before, plan_next_month_with_income = excluded.plan_next_month_with_income, reserve_target_months = excluded.reserve_target_months;
end $$;
revoke all on function public.pf_settings_save(int, boolean, numeric) from public, anon;
grant execute on function public.pf_settings_save(int, boolean, numeric) to authenticated;
