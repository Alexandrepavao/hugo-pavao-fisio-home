-- HP Group Hub — 033 Contas corporativas: estende o que já existia (corporate_accounts/corporate_members/
-- corporate_indicators, migration 009) em vez de recriar. Adiciona documento/observações da empresa,
-- contatos (com um responsável financeiro identificado), contratos corporativos e os itens (produtos/serviços
-- e condições) contratados neles. Uma conta corporativa é um CLIENTE do HP dentro da mesma organização — nunca
-- uma organização nova — por isso tudo aqui referencia org_id/unit_id da própria org, igual ao resto do schema.
-- Pessoa atendida x empresa pagadora seguem claramente separadas: corporate_members só LIGA uma pessoa já
-- cadastrada à conta (nunca duplica o cadastro dela), e o relatório abaixo nunca expõe prontuário/conteúdo
-- clínico individual — só contagens agregadas, com o mesmo piso de k-anonimato (5+) já usado em corporate_indicators.

alter table public.corporate_accounts add column document text;
alter table public.corporate_accounts add column notes text;

create table public.corporate_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.corporate_accounts(id) on delete cascade,
  name text not null check (length(btrim(name)) > 1),
  role text,
  email text,
  phone text,
  is_billing boolean not null default false,
  created_at timestamptz not null default now()
);
-- um único contato marcado como responsável financeiro por conta (é o que o pedido chama de "identificação do responsável financeiro")
create unique index corporate_contacts_billing_uq on public.corporate_contacts (account_id) where is_billing;

create table public.corporate_contracts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.corporate_accounts(id) on delete cascade,
  title text not null check (length(btrim(title)) > 1),
  starts_on date not null default current_date,
  ends_on date,
  status text not null default 'active' check (status in ('active', 'ended')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.corporate_contract_items (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.corporate_contracts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  condition_notes text          -- condição negociada em texto livre (desconto, forma de cobrança, etc.) — não recria o motor de preço
);

-- ---------------------------------------------------------------- relatório de utilização e valores (k-anonimato: mesmo piso de 5 já usado em corporate_indicators)
create or replace function public.corporate_account_report(p_account uuid, p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.corporate_accounts; n int; v_attended int; v_billed bigint;
begin
  select * into a from public.corporate_accounts where id = p_account and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager', 'ops_admin', 'unit_manager', 'finance']::public.app_role[], a.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select count(*) into n from public.corporate_members where account_id = p_account;
  if n < 5 then return jsonb_build_object('members', n, 'available', false); end if;
  select count(*) into v_attended from public.appointments ap join public.corporate_members m on m.person_id = ap.person_id and m.account_id = p_account
    where ap.status = 'attended' and (p_from is null or lower(ap.period) >= p_from) and (p_to is null or lower(ap.period) < p_to);
  select coalesce(sum(p.amount_cents), 0) into v_billed from public.payments p join public.receivables r on r.id = p.receivable_id
    join public.corporate_members m on m.person_id = r.person_id and m.account_id = p_account
    where p.kind = 'payment' and (p_from is null or p.paid_at >= p_from) and (p_to is null or p.paid_at < p_to);
  return jsonb_build_object('members', n, 'available', true, 'attended_sessions', v_attended, 'billed_cents', v_billed);
end $$;

-- ---------------------------------------------------------------- RLS (mesmo padrão de papéis já usado em corporate_accounts)
alter table public.corporate_contacts enable row level security;
alter table public.corporate_contracts enable row level security;
alter table public.corporate_contract_items enable row level security;

grant select, insert, update, delete on public.corporate_contacts to authenticated;
grant select, insert, update on public.corporate_contracts to authenticated;
grant select, insert, delete on public.corporate_contract_items to authenticated;

create policy cct_read on public.corporate_contacts for select to authenticated using (exists (select 1 from public.corporate_accounts a where a.id = account_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager', 'finance']::public.app_role[], a.unit_id)));
create policy cct_write on public.corporate_contacts for insert to authenticated with check (exists (select 1 from public.corporate_accounts a where a.id = account_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager']::public.app_role[], a.unit_id)));
create policy cct_update on public.corporate_contacts for update to authenticated using (exists (select 1 from public.corporate_accounts a where a.id = account_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager']::public.app_role[], a.unit_id)));
create policy cct_delete on public.corporate_contacts for delete to authenticated using (exists (select 1 from public.corporate_accounts a where a.id = account_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager']::public.app_role[], a.unit_id)));

create policy ccn_read on public.corporate_contracts for select to authenticated using (exists (select 1 from public.corporate_accounts a where a.id = account_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager', 'finance']::public.app_role[], a.unit_id)));
create policy ccn_write on public.corporate_contracts for insert to authenticated with check (exists (select 1 from public.corporate_accounts a where a.id = account_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager']::public.app_role[], a.unit_id)) and created_by = (select auth.uid()));
create policy ccn_update on public.corporate_contracts for update to authenticated using (exists (select 1 from public.corporate_accounts a where a.id = account_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager']::public.app_role[], a.unit_id)));

create policy cci_read on public.corporate_contract_items for select to authenticated using (exists (select 1 from public.corporate_contracts c join public.corporate_accounts a on a.id = c.account_id where c.id = contract_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager', 'finance']::public.app_role[], a.unit_id)));
create policy cci_write on public.corporate_contract_items for insert to authenticated with check (exists (select 1 from public.corporate_contracts c join public.corporate_accounts a on a.id = c.account_id where c.id = contract_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager']::public.app_role[], a.unit_id)));
create policy cci_delete on public.corporate_contract_items for delete to authenticated using (exists (select 1 from public.corporate_contracts c join public.corporate_accounts a on a.id = c.account_id where c.id = contract_id and private.has_unit_role(array['manager', 'ops_admin', 'unit_manager']::public.app_role[], a.unit_id)));

grant execute on function public.corporate_account_report(uuid, timestamptz, timestamptz) to authenticated;
