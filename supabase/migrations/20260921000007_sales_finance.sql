-- HP Group Hub — 007 Vendas, contratos, recebíveis, recebimentos, comissões, contas a pagar e projeção de mensalidades
-- Dinheiro: bigint em centavos. Percentuais: pontos-base (10000 = 100%). Nada de ponto flutuante.

alter table public.products add column access_rule text not null default 'on_first_payment' check (access_rule in ('on_first_payment','on_full_payment'));

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  name text not null, kind text not null default 'bank' check (kind in ('cash','bank','wallet')),
  active boolean not null default true, unique (org_id, name)
);
create table public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  name text not null, kind text not null check (kind in ('income','expense')), active boolean not null default true, unique (org_id, name, kind)
);
create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  name text not null, active boolean not null default true, unique (org_id, name)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  installments int not null default 1 check (installments between 1 and 60),
  first_due date not null default current_date,
  notes text,
  sold_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (discount_cents <= subtotal_cents or status = 'pending')
);
create index sales_person_idx on public.sales (person_id);
create index sales_unit_sold_idx on public.sales (unit_id, sold_at);
alter table public.client_packages add constraint client_packages_sale_fk foreign key (sale_id) references public.sales(id) on delete restrict;
drop index public.client_packages_sale_uq;
create unique index client_packages_sale_product_uq on public.client_packages (sale_id, product_id) where sale_id is not null;

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  description text not null,
  qty int not null default 1 check (qty > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0 and discount_cents <= qty * unit_price_cents)
);
create index sale_items_sale_idx on public.sale_items (sale_id);

create or replace function private.sale_items_totals() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_sale uuid := coalesce(new.sale_id, old.sale_id);
begin
  if (select status from public.sales where id = v_sale) <> 'pending' then raise exception 'venda já confirmada: itens não podem mudar'; end if;
  update public.sales s set subtotal_cents = coalesce((select sum(qty * unit_price_cents - discount_cents) from public.sale_items where sale_id = v_sale), 0)
   where s.id = v_sale;
  update public.sales set total_cents = greatest(subtotal_cents - discount_cents, 0) where id = v_sale;
  return null;
end $$;
create trigger sale_items_totals after insert or update or delete on public.sale_items for each row execute function private.sale_items_totals();

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sale_id uuid not null unique references public.sales(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  status text not null default 'active' check (status in ('draft','active','ended','cancelled')),
  starts_on date not null default current_date, ends_on date,
  terms text, created_at timestamptz not null default now()
);

create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  unit_id uuid not null references public.units(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  installment_no int not null, installments_total int not null,
  due_date date not null,
  competence_month date not null,                   -- 1º dia do mês de competência
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'open' check (status in ('open','partial','paid','cancelled','refunded')),
  unique (sale_id, installment_no)
);
create index receivables_due_idx on public.receivables (unit_id, due_date) where status in ('open','partial');
create index receivables_person_idx on public.receivables (person_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  unit_id uuid not null,
  receivable_id uuid not null references public.receivables(id) on delete restrict,
  financial_account_id uuid references public.financial_accounts(id) on delete restrict,
  kind text not null default 'payment' check (kind in ('payment','refund')),
  amount_cents bigint not null check (amount_cents > 0),
  paid_at timestamptz not null default now(),
  method text, note text,
  provider text, external_ref text,
  idempotency_key text not null,
  refund_of uuid references public.payments(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
create unique index payments_external_uq on public.payments (org_id, provider, external_ref) where external_ref is not null;
create index payments_receivable_idx on public.payments (receivable_id);
create index payments_paid_idx on public.payments (unit_id, paid_at);

create or replace function private.receivable_net(p_rec uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case kind when 'payment' then amount_cents else -amount_cents end), 0) from public.payments where receivable_id = p_rec
$$;

create or replace function private.recalc_receivable(p_rec uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.receivables; n bigint; refunds bigint;
begin
  select * into r from public.receivables where id = p_rec;
  if r.status = 'cancelled' then return; end if;
  n := private.receivable_net(p_rec);
  select coalesce(sum(amount_cents), 0) into refunds from public.payments where receivable_id = p_rec and kind = 'refund';
  update public.receivables set status = case when n >= r.amount_cents then 'paid' when n > 0 then 'partial' when refunds > 0 then 'refunded' else 'open' end where id = p_rec;
end $$;

create table public.payables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  category_id uuid references public.finance_categories(id) on delete restrict,
  cost_center_id uuid references public.cost_centers(id) on delete restrict,
  financial_account_id uuid references public.financial_accounts(id) on delete restrict,
  description text not null, supplier text,
  amount_cents bigint not null check (amount_cents > 0),
  due_date date not null, competence_month date not null,
  status text not null default 'open' check (status in ('open','paid','cancelled')),
  paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index payables_due_idx on public.payables (unit_id, due_date);

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  product_id uuid references public.products(id) on delete cascade,      -- nulo = todos os produtos
  beneficiary_user_id uuid references auth.users(id) on delete cascade,  -- nulo = responsável da oportunidade
  percent_bp int not null check (percent_bp between 1 and 10000),
  active boolean not null default true
);
create table public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, unit_id uuid not null,
  rule_id uuid not null references public.commission_rules(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  beneficiary_user_id uuid not null references auth.users(id) on delete restrict,
  amount_cents bigint not null,                       -- negativo em estornos
  status text not null default 'pending' check (status in ('pending','authorized','paid','reversed')),
  created_at timestamptz not null default now(),
  unique (payment_id, rule_id)
);

-- ---------------------------------------------------------------- permissões
create or replace function private.can_finance(p_unit uuid) returns boolean
language sql stable set search_path = '' as $$ select private.has_unit_role(array['manager','ops_admin','unit_manager','finance']::public.app_role[], p_unit) $$;
create or replace function private.can_sell(p_unit uuid) returns boolean
language sql stable set search_path = '' as $$ select private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], p_unit) $$;
create or replace function private.can_read_sales(p_unit uuid) returns boolean
language sql stable set search_path = '' as $$ select private.has_unit_role(array['manager','ops_admin','unit_manager','finance','sales']::public.app_role[], p_unit) $$;

-- divisão exata em centavos (o resto vai para as primeiras parcelas)
create or replace function private.split_cents(p_total bigint, p_n int) returns bigint[]
language sql immutable set search_path = '' as $$
  select array_agg((p_total / p_n) + case when i <= (p_total % p_n) then 1 else 0 end order by i) from generate_series(1, p_n) i
$$;

-- ---------------------------------------------------------------- venda
create or replace function public.sale_create(p_person uuid, p_unit uuid, p_opportunity uuid, p_items jsonb,
  p_discount_cents bigint default 0, p_installments int default 1, p_first_due date default current_date, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid; it jsonb; pr public.products; v_price bigint;
begin
  if v_org is null or not private.can_sell(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.people where id = p_person and org_id = v_org) then raise exception 'pessoa inválida'; end if;
  if p_opportunity is not null and not exists (select 1 from public.opportunities where id = p_opportunity and person_id = p_person and org_id = v_org) then raise exception 'oportunidade não pertence à pessoa'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'inclua ao menos um item'; end if;
  insert into public.sales (org_id, unit_id, person_id, opportunity_id, discount_cents, installments, first_due, notes, created_by)
    values (v_org, p_unit, p_person, p_opportunity, greatest(coalesce(p_discount_cents, 0), 0), p_installments, coalesce(p_first_due, current_date), p_notes, (select auth.uid())) returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from public.products where id = (it ->> 'product_id')::uuid and org_id = v_org and active;
    if not found then raise exception 'produto inválido'; end if;
    v_price := coalesce((it ->> 'unit_price_cents')::bigint, pr.price_cents);
    insert into public.sale_items (org_id, sale_id, product_id, description, qty, unit_price_cents, discount_cents)
      values (v_org, v_id, pr.id, pr.name, coalesce((it ->> 'qty')::int, 1), v_price, coalesce((it ->> 'discount_cents')::bigint, 0));
  end loop;
  if (select discount_cents from public.sales where id = v_id) > (select subtotal_cents from public.sales where id = v_id) then raise exception 'desconto maior que o subtotal'; end if;
  update public.sales set total_cents = greatest(subtotal_cents - discount_cents, 0) where id = v_id;
  return v_id;
end $$;

create or replace function public.sale_confirm(p_sale uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale and org_id = private.current_org() for update;
  if not found or not private.can_sell(s.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status = 'confirmed' then return; end if;                                 -- idempotente
  if s.status <> 'pending' then raise exception 'venda não está pendente'; end if;
  if s.total_cents <= 0 then raise exception 'valor total deve ser maior que zero'; end if;
  update public.sales set status = 'confirmed', sold_at = now() where id = p_sale;
  perform private.emit_event(s.org_id, 'sale.confirmed', 'sale', p_sale, '{}', 'sale.confirmed:' || p_sale);
end $$;

create or replace function private.h_sale_confirmed(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; s public.sales; parts bigint[]; i int; it record; v_prod uuid; v_kind text; pk uuid;
begin
  select * into e from public.domain_events where id = p_event;
  select * into s from public.sales where id = e.aggregate_id;
  insert into public.contracts (org_id, sale_id, person_id, starts_on) values (s.org_id, s.id, s.person_id, s.first_due) on conflict (sale_id) do nothing;
  select product_id into v_prod from public.sale_items where sale_id = s.id order by unit_price_cents desc limit 1;
  parts := private.split_cents(s.total_cents, s.installments);
  for i in 1..s.installments loop
    insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents)
      values (s.org_id, s.unit_id, s.id, s.person_id, v_prod, i, s.installments, (s.first_due + make_interval(months => i - 1))::date,
              date_trunc('month', s.first_due + make_interval(months => i - 1))::date, parts[i]) on conflict (sale_id, installment_no) do nothing;
  end loop;
  for it in select si.*, p.kind as pkind, p.sessions_count, p.validity_days from public.sale_items si join public.products p on p.id = si.product_id where si.sale_id = s.id and p.kind = 'package' loop
    insert into public.client_packages (org_id, unit_id, person_id, product_id, sale_id, total_sessions, valid_until)
      values (s.org_id, s.unit_id, s.person_id, it.product_id, s.id, it.sessions_count * it.qty, case when it.validity_days is not null then current_date + it.validity_days end)
      on conflict (sale_id, product_id) where sale_id is not null do nothing returning id into pk;
    if pk is not null then insert into public.session_ledger (org_id, client_package_id, delta, reason, note) values (s.org_id, pk, it.sessions_count * it.qty, 'grant', 'Venda ' || s.id); end if;
    pk := null;
  end loop;
  insert into public.person_kinds (person_id, kind)
    select s.person_id, case when p.kind in ('course','mentoring') then 'student'::public.person_kind else 'patient'::public.person_kind end
      from public.sale_items si join public.products p on p.id = si.product_id where si.sale_id = s.id on conflict do nothing;
  if s.opportunity_id is not null then
    select pl.kind into v_kind from public.opportunities o join public.pipelines pl on pl.id = o.pipeline_id where o.id = s.opportunity_id;
    update public.opportunities o set stage_id = st.id, value_cents = s.total_cents
      from public.pipeline_stages st where o.id = s.opportunity_id and st.pipeline_id = o.pipeline_id and o.status = 'open'
       and ((v_kind = 'education' and st.name = 'Pagamento') or (v_kind <> 'education' and st.kind = 'won'));
  end if;
  insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary) values (s.org_id, s.person_id, s.unit_id, s.opportunity_id, 'system', 'Venda confirmada (' || s.total_cents / 100 || ',' || lpad((s.total_cents % 100)::text, 2, '0') || ')');
end $$;

create or replace function public.sale_cancel(p_sale uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale and org_id = private.current_org() for update;
  if not found or (not private.can_finance(s.unit_id) and not private.can_sell(s.unit_id)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status = 'cancelled' then return; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'informe o motivo'; end if;
  if exists (select 1 from public.receivables r where r.sale_id = p_sale and private.receivable_net(r.id) > 0) then raise exception 'existem recebimentos: estorne antes de cancelar'; end if;
  update public.sales set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_sale;
  update public.receivables set status = 'cancelled' where sale_id = p_sale;
  update public.contracts set status = 'cancelled' where sale_id = p_sale;
  update public.client_packages set status = 'cancelled' where sale_id = p_sale;
  perform private.emit_event(s.org_id, 'sale.cancelled', 'sale', p_sale, jsonb_build_object('reason', p_reason), 'sale.cancelled:' || p_sale);
end $$;

-- ---------------------------------------------------------------- recebimentos
create or replace function public.payment_record(p_receivable uuid, p_amount_cents bigint, p_paid_at timestamptz, p_method text,
  p_account uuid, p_idempotency_key text, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.receivables; v_id uuid; ex public.payments;
begin
  if coalesce(p_idempotency_key, '') = '' then raise exception 'chave de idempotência obrigatória'; end if;
  select * into r from public.receivables where id = p_receivable and org_id = private.current_org() for update;
  if not found or not private.can_finance(r.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into ex from public.payments where org_id = r.org_id and idempotency_key = p_idempotency_key;
  if found then
    if ex.receivable_id <> p_receivable or ex.amount_cents <> p_amount_cents or ex.kind <> 'payment' then raise exception 'chave de idempotência já usada com outros dados'; end if;
    return ex.id;
  end if;
  if r.status in ('cancelled') then raise exception 'parcela cancelada'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'valor inválido'; end if;
  if private.receivable_net(p_receivable) + p_amount_cents > r.amount_cents then raise exception 'valor excede o saldo da parcela'; end if;
  insert into public.payments (org_id, unit_id, receivable_id, financial_account_id, kind, amount_cents, paid_at, method, note, idempotency_key, created_by)
    values (r.org_id, r.unit_id, r.id, p_account, 'payment', p_amount_cents, coalesce(p_paid_at, now()), p_method, p_note, p_idempotency_key, (select auth.uid())) returning id into v_id;
  perform private.recalc_receivable(p_receivable);
  perform private.emit_event(r.org_id, 'payment.confirmed', 'payment', v_id, jsonb_build_object('receivable_id', r.id, 'sale_id', r.sale_id), 'payment:' || v_id);
  return v_id;
end $$;

create or replace function public.payment_refund(p_payment uuid, p_amount_cents bigint, p_reason text, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pay public.payments; r public.receivables; v_id uuid; ex public.payments; v_refunded bigint;
begin
  select * into pay from public.payments where id = p_payment and org_id = private.current_org() and kind = 'payment';
  if not found then raise exception 'recebimento inexistente'; end if;
  select * into r from public.receivables where id = pay.receivable_id for update;
  if not private.can_finance(r.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into ex from public.payments where org_id = r.org_id and idempotency_key = p_idempotency_key;
  if found then
    if ex.refund_of is distinct from p_payment or ex.amount_cents <> p_amount_cents then raise exception 'chave de idempotência já usada com outros dados'; end if;
    return ex.id;
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'informe o motivo do estorno'; end if;
  select coalesce(sum(amount_cents), 0) into v_refunded from public.payments where refund_of = p_payment;
  if p_amount_cents <= 0 or p_amount_cents > pay.amount_cents - v_refunded then raise exception 'valor de estorno inválido'; end if;
  insert into public.payments (org_id, unit_id, receivable_id, financial_account_id, kind, amount_cents, paid_at, note, idempotency_key, refund_of, created_by)
    values (r.org_id, r.unit_id, r.id, pay.financial_account_id, 'refund', p_amount_cents, now(), p_reason, p_idempotency_key, p_payment, (select auth.uid())) returning id into v_id;
  perform private.recalc_receivable(r.id);
  perform private.emit_event(r.org_id, 'payment.refunded', 'payment', v_id, jsonb_build_object('receivable_id', r.id, 'sale_id', r.sale_id), 'payment:' || v_id);
  return v_id;
end $$;

-- comissões: gera na confirmação, reverte proporcionalmente no estorno
create or replace function private.h_payment_commission(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; pay public.payments; s public.sales; ru record; v_ben uuid; v_amt bigint;
begin
  select * into e from public.domain_events where id = p_event;
  select * into pay from public.payments where id = e.aggregate_id;
  select s2.* into s from public.sales s2 join public.receivables r on r.sale_id = s2.id where r.id = pay.receivable_id;
  for ru in select * from public.commission_rules cr where cr.org_id = pay.org_id and cr.active
              and (cr.product_id is null or exists (select 1 from public.sale_items si where si.sale_id = s.id and si.product_id = cr.product_id)) loop
    v_ben := coalesce(ru.beneficiary_user_id, (select owner_user_id from public.opportunities where id = s.opportunity_id));
    if v_ben is null then continue; end if;
    v_amt := (pay.amount_cents * ru.percent_bp + 5000) / 10000;
    if pay.kind = 'payment' then
      insert into public.commission_entries (org_id, unit_id, rule_id, sale_id, payment_id, beneficiary_user_id, amount_cents)
        values (pay.org_id, pay.unit_id, ru.id, s.id, pay.id, v_ben, v_amt) on conflict (payment_id, rule_id) do nothing;
    else
      insert into public.commission_entries (org_id, unit_id, rule_id, sale_id, payment_id, beneficiary_user_id, amount_cents, status)
        values (pay.org_id, pay.unit_id, ru.id, s.id, pay.id, v_ben, -v_amt, 'reversed') on conflict (payment_id, rule_id) do nothing;
    end if;
  end loop;
end $$;

-- oportunidade de mentoria/curso: quando toda a venda está paga, marca como ganha (acesso liberado por regra na migration de Academy)
create or replace function private.h_payment_opportunity(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; pay public.payments; s public.sales; v_kind text;
begin
  select * into e from public.domain_events where id = p_event;
  select * into pay from public.payments where id = e.aggregate_id;
  select s2.* into s from public.sales s2 join public.receivables r on r.sale_id = s2.id where r.id = pay.receivable_id;
  if pay.kind <> 'payment' or s.opportunity_id is null then return; end if;
  select pl.kind into v_kind from public.opportunities o join public.pipelines pl on pl.id = o.pipeline_id where o.id = s.opportunity_id;
  if v_kind = 'education' then
    update public.opportunities o set stage_id = st.id from public.pipeline_stages st
     where o.id = s.opportunity_id and st.pipeline_id = o.pipeline_id and st.kind = 'won' and o.status = 'open';
  end if;
end $$;

insert into private.event_handlers values
  ('sale.confirmed','h_sale_confirmed'),('payment.confirmed','h_payment_commission'),('payment.refunded','h_payment_commission'),
  ('payment.confirmed','h_payment_opportunity');

create or replace function public.commission_set_status(p_entry uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.commission_entries;
begin
  select * into c from public.commission_entries where id = p_entry and org_id = private.current_org();
  if not found or not private.can_finance(c.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_status not in ('authorized','paid') or c.status = 'reversed' then raise exception 'transição inválida'; end if;
  update public.commission_entries set status = p_status where id = p_entry;
end $$;

create or replace function public.payable_pay(p_id uuid, p_account uuid, p_paid_at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payables;
begin
  select * into p from public.payables where id = p_id and org_id = private.current_org() for update;
  if not found or not private.can_finance(p.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p.status = 'paid' then return; end if;
  if p.status <> 'open' then raise exception 'conta não está em aberto'; end if;
  update public.payables set status = 'paid', paid_at = coalesce(p_paid_at, now()), financial_account_id = p_account where id = p_id;
end $$;

-- ---------------------------------------------------------------- projeção de mensalidades (NÃO é conta a receber)
-- Para o mês-alvo T: mensalidades da competência T-1 com pagamento líquido > 0 geram projeção,
-- exceto se já existir recebível contratado para T do mesmo produto (aí já é conta a receber) ou se a venda foi cancelada.
create or replace function public.subscription_forecast(p_month date, p_unit uuid default null)
returns table (person_id uuid, person_name text, product_id uuid, product_name text, projected_amount_cents bigint,
               origin_payment_id uuid, origin_paid_at timestamptz, origin_competence date, projected_competence date)
language sql stable security invoker set search_path = '' as $$
  with target as (select date_trunc('month', p_month)::date as t),
  base as (
    select distinct on (r.person_id, r.product_id)
           r.person_id, r.product_id, r.amount_cents, r.competence_month, r.unit_id,
           (select p2.id from public.payments p2 where p2.receivable_id = r.id and p2.kind = 'payment' order by p2.paid_at limit 1) as pay_id
    from public.receivables r
    join public.products pr on pr.id = r.product_id and pr.recurrence = 'monthly'
    join public.sales s on s.id = r.sale_id and s.status = 'confirmed'
    cross join target
    where r.competence_month = (target.t - interval '1 month')::date
      and r.status in ('paid','partial') and private.receivable_net(r.id) > 0
      and (p_unit is null or r.unit_id = p_unit)
    order by r.person_id, r.product_id, r.due_date
  )
  select b.person_id, pe.full_name, b.product_id, pr.name, b.amount_cents, b.pay_id, py.paid_at, b.competence_month, (select t from target)
  from base b
  join public.people pe on pe.id = b.person_id
  join public.products pr on pr.id = b.product_id
  join public.payments py on py.id = b.pay_id
  where not exists (select 1 from public.receivables r2 join public.sales s2 on s2.id = r2.sale_id and s2.status = 'confirmed'
                     where r2.person_id = b.person_id and r2.product_id = b.product_id and r2.competence_month = (select t from target) and r2.status <> 'cancelled')
$$;

-- categorias iniciais (configuração, não é dado demonstrativo)
insert into public.finance_categories (org_id, name, kind)
select o.id, c.name, c.kind from public.organizations o, (values
  ('Atendimentos','income'),('Cursos e mentorias','income'),('Outras receitas','income'),
  ('Folha e repasses','expense'),('Aluguel e estrutura','expense'),('Marketing','expense'),('Impostos e taxas','expense'),('Outras despesas','expense')) c(name, kind)
where o.slug = 'hp-group' on conflict do nothing;

-- ---------------------------------------------------------------- RLS / grants
alter table public.financial_accounts enable row level security;
alter table public.finance_categories enable row level security;
alter table public.cost_centers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.contracts enable row level security;
alter table public.receivables enable row level security;
alter table public.payments enable row level security;
alter table public.payables enable row level security;
alter table public.commission_rules enable row level security;
alter table public.commission_entries enable row level security;

grant select, insert, update on public.financial_accounts, public.finance_categories, public.cost_centers, public.commission_rules to authenticated;
grant select on public.sales, public.sale_items, public.contracts, public.receivables, public.payments, public.commission_entries to authenticated;
grant select, insert, update on public.payables to authenticated;

create policy fa_read on public.financial_accounts for select to authenticated using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','finance']::public.app_role[]));
create policy fa_write on public.financial_accounts for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin','finance']::public.app_role[]));
create policy fa_update on public.financial_accounts for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin','finance']::public.app_role[])) with check (private.in_org(org_id));
create policy fc_read on public.finance_categories for select to authenticated using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','finance']::public.app_role[]));
create policy fc_write on public.finance_categories for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin','finance']::public.app_role[]));
create policy fc_update on public.finance_categories for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin','finance']::public.app_role[])) with check (private.in_org(org_id));
create policy cc_read on public.cost_centers for select to authenticated using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','finance']::public.app_role[]));
create policy cc_write on public.cost_centers for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin','finance']::public.app_role[]));
create policy cc_update on public.cost_centers for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin','finance']::public.app_role[])) with check (private.in_org(org_id));

create policy sales_read on public.sales for select to authenticated using (private.in_org(org_id) and private.can_read_sales(unit_id));
create policy sale_items_read on public.sale_items for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id));
create policy contracts_read on public.contracts for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id));
create policy rec_read on public.receivables for select to authenticated using (private.in_org(org_id) and (private.can_read_sales(unit_id) or person_id = private.current_person()));
create policy pay_read on public.payments for select to authenticated using (private.in_org(org_id) and private.can_finance(unit_id));
create policy payables_read on public.payables for select to authenticated using (private.in_org(org_id) and private.can_finance(unit_id));
create policy payables_write on public.payables for insert to authenticated with check (private.in_org(org_id) and created_by = (select auth.uid()) and private.can_finance(unit_id));
create policy payables_update on public.payables for update to authenticated using (private.in_org(org_id) and private.can_finance(unit_id) and status = 'open') with check (private.in_org(org_id) and private.can_finance(unit_id) and status in ('open','cancelled'));
create policy cr_read on public.commission_rules for select to authenticated using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','finance']::public.app_role[]));
create policy cr_write on public.commission_rules for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','finance']::public.app_role[]));
create policy cr_update on public.commission_rules for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','finance']::public.app_role[])) with check (private.in_org(org_id));
create policy ce_read on public.commission_entries for select to authenticated using (private.in_org(org_id) and (private.can_finance(unit_id) or beneficiary_user_id = (select auth.uid())));

create trigger audit_sales after insert or update or delete on public.sales for each row execute function private.audit_row('status','total_cents','discount_cents');
create trigger audit_payments after insert on public.payments for each row execute function private.audit_row('kind','amount_cents','receivable_id');
create trigger audit_payables after insert or update on public.payables for each row execute function private.audit_row('status','amount_cents');
create trigger audit_commission_rules after insert or update on public.commission_rules for each row execute function private.audit_row('percent_bp','active');

grant execute on function public.sale_create(uuid, uuid, uuid, jsonb, bigint, int, date, text) to authenticated;
grant execute on function public.sale_confirm(uuid) to authenticated;
grant execute on function public.sale_cancel(uuid, text) to authenticated;
grant execute on function public.payment_record(uuid, bigint, timestamptz, text, uuid, text, text) to authenticated;
grant execute on function public.payment_refund(uuid, bigint, text, text) to authenticated;
grant execute on function public.commission_set_status(uuid, text) to authenticated;
grant execute on function public.payable_pay(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.subscription_forecast(date, uuid) to authenticated;
