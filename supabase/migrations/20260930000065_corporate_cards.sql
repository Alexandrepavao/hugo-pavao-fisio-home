-- HP Group Hub — 065 Cartões corporativos (aditiva).
-- Princípios:
--  • NUNCA número completo, CVV ou dado de autenticação: só apelido, emissor, bandeira e (opcional) os 4 últimos dígitos.
--  • Uma compra no cartão É uma despesa em public.payables (fonte única do livro financeiro): aparece UMA vez em DRE, relatórios, fluxo de caixa e linha de negócio.
--    A competência é o mês da compra; o vencimento é o da fatura; fica "em aberto" até a fatura ser paga.
--  • A fatura agrupa as compras de um ciclo (fechamento/vencimento do cartão) e é paga de uma vez: paga as despesas do ciclo (nunca cria despesa nova).
--  • A conciliação continua só APONTANDO lançamentos que já existem (regra da 021): a linha agregada do extrato é ligada à FATURA (já paga), sem criar nem alterar
--    despesa e sem alterar o extrato original. Compra individual de cartão não é conciliada nem paga isoladamente (as funções existentes passam a recusar).
-- Escopo: organização/unidade (private.can_finance). Escrita só por função; leitura por RLS; auditoria por gatilho (private.audit_row) e por registro explícito.

create table public.corporate_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  nickname text not null check (length(btrim(nickname)) between 2 and 60),
  issuer text not null check (length(btrim(issuer)) between 2 and 60),
  brand text not null check (brand in ('visa','mastercard','elo','amex','hipercard','outra')),
  last4 text check (last4 ~ '^[0-9]{4}$'),
  holder_name text check (holder_name is null or length(btrim(holder_name)) between 2 and 80),
  credit_limit_cents bigint not null check (credit_limit_cents > 0),
  closing_day int not null check (closing_day between 1 and 28),
  due_day int not null check (due_day between 1 and 28),
  financial_account_id uuid references public.financial_accounts(id) on delete set null,
  status text not null default 'active' check (status in ('active','blocked')),
  block_reason text, blocked_at timestamptz, blocked_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, nickname)
);
create table public.card_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  card_id uuid not null references public.corporate_cards(id) on delete restrict,
  cycle_start date not null, closing_date date not null, due_date date not null,
  status text not null default 'open' check (status in ('open','paid')),
  paid_at timestamptz, paid_account_id uuid references public.financial_accounts(id) on delete restrict,
  paid_by uuid references auth.users(id) on delete set null, paid_total_cents bigint,
  created_at timestamptz not null default now(),
  unique (card_id, closing_date),
  check ((status = 'paid') = (paid_at is not null))
);
create table public.card_purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  card_id uuid not null references public.corporate_cards(id) on delete restrict,
  invoice_id uuid not null references public.card_invoices(id) on delete restrict,
  payable_id uuid not null unique references public.payables(id) on delete restrict,      -- a compra É esta despesa; nunca duas
  purchase_date date not null,
  merchant text, note text,
  cancelled_at timestamptz, cancelled_by uuid references auth.users(id) on delete set null, cancel_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index card_purchases_card_idx on public.card_purchases (card_id, purchase_date desc);
create index card_purchases_invoice_idx on public.card_purchases (invoice_id);

alter table public.corporate_cards enable row level security;
alter table public.card_invoices enable row level security;
alter table public.card_purchases enable row level security;
grant select on public.corporate_cards, public.card_invoices, public.card_purchases to authenticated;
create policy cards_read on public.corporate_cards for select to authenticated using (private.in_org(org_id) and private.can_finance(unit_id));
create policy card_invoices_read on public.card_invoices for select to authenticated using (private.in_org(org_id) and private.can_finance(unit_id));
create policy card_purchases_read on public.card_purchases for select to authenticated using (private.in_org(org_id) and private.can_finance(unit_id));

create trigger audit_corporate_cards after insert or update on public.corporate_cards for each row execute function private.audit_row('nickname','issuer','brand','credit_limit_cents','closing_day','due_day','status','block_reason');
create trigger audit_card_invoices after insert or update on public.card_invoices for each row execute function private.audit_row('status','paid_at','paid_total_cents','paid_account_id');
create trigger audit_card_purchases after insert or update on public.card_purchases for each row execute function private.audit_row('payable_id','invoice_id','cancelled_at','cancel_reason');

-- vínculo da linha do extrato com a FATURA (só aponta; nunca cria nem altera lançamento)
alter table public.bank_statement_lines add column matched_invoice_id uuid references public.card_invoices(id) on delete restrict;
create unique index bsl_invoice_uq on public.bank_statement_lines (matched_invoice_id) where matched_invoice_id is not null;       -- uma fatura não é conciliada 2x
alter table public.bank_statement_lines drop constraint bank_statement_lines_check;
alter table public.bank_statement_lines drop constraint bank_statement_lines_check1;
alter table public.bank_statement_lines add constraint bank_statement_lines_check check ((status = 'matched') = (matched_payment_id is not null or matched_payable_id is not null or matched_invoice_id is not null));
alter table public.bank_statement_lines add constraint bank_statement_lines_check1 check (num_nonnulls(matched_payment_id, matched_payable_id, matched_invoice_id) <= 1);
alter table public.bank_statement_lines add constraint bank_statement_lines_check4 check (matched_invoice_id is null or amount_cents < 0);   -- fatura paga = saída

-- ---------------------------------------------------------------- ciclo
-- Compra no dia do fechamento ainda entra na fatura que fecha nesse dia; no dia seguinte, na próxima. Vencimento: no mês do fechamento se o dia de vencimento for depois do fechamento; senão, no mês seguinte.
create or replace function private.card_cycle(p_closing int, p_due int, p_date date) returns table (cycle_start date, closing_date date, due_date date)
language sql immutable set search_path = '' as $$
  with c as (select case when extract(day from p_date)::int <= p_closing then make_date(extract(year from p_date)::int, extract(month from p_date)::int, p_closing)
                         else (make_date(extract(year from p_date)::int, extract(month from p_date)::int, p_closing) + interval '1 month')::date end as closing)
  select ((c.closing - interval '1 month')::date + 1), c.closing,
         case when p_due > p_closing then make_date(extract(year from c.closing)::int, extract(month from c.closing)::int, p_due)
              else (make_date(extract(year from c.closing)::int, extract(month from c.closing)::int, p_due) + interval '1 month')::date end
  from c
$$;
create or replace function private.card_today() returns date language sql stable set search_path = '' as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function private.card_invoice_total(p_invoice uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(b.amount_cents), 0)::bigint from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.invoice_id = p_invoice and cp.cancelled_at is null and b.status <> 'cancelled'
$$;

-- ---------------------------------------------------------------- cadastro e bloqueio
create or replace function public.card_create(p_unit uuid, p_nickname text, p_issuer text, p_brand text, p_limit_cents bigint, p_closing_day int, p_due_day int,
  p_last4 text default null, p_holder text default null, p_account uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid;
begin
  if not exists (select 1 from public.units where id = p_unit and org_id = v_org) or not private.can_finance(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_nickname, ''))) < 2 then raise exception 'informe o apelido do cartão'; end if;
  if length(btrim(coalesce(p_issuer, ''))) < 2 then raise exception 'informe o emissor'; end if;
  if lower(coalesce(p_brand, '')) not in ('visa','mastercard','elo','amex','hipercard','outra') then raise exception 'bandeira inválida'; end if;
  if p_limit_cents is null or p_limit_cents <= 0 then raise exception 'o limite precisa ser maior que zero'; end if;
  if p_closing_day not between 1 and 28 or p_due_day not between 1 and 28 then raise exception 'fechamento e vencimento precisam estar entre os dias 1 e 28'; end if;
  if p_last4 is not null and p_last4 !~ '^[0-9]{4}$' then raise exception 'informe somente os 4 últimos dígitos (nunca o número completo)'; end if;
  if p_account is not null and not exists (select 1 from public.financial_accounts where id = p_account and org_id = v_org) then raise exception 'conta financeira inválida'; end if;
  insert into public.corporate_cards (org_id, unit_id, nickname, issuer, brand, last4, holder_name, credit_limit_cents, closing_day, due_day, financial_account_id, created_by)
    values (v_org, p_unit, btrim(p_nickname), btrim(p_issuer), lower(p_brand), p_last4, nullif(btrim(coalesce(p_holder, '')), ''), p_limit_cents, p_closing_day, p_due_day, p_account, (select auth.uid()))
    returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'já existe um cartão com este apelido';
end $$;

create or replace function public.card_set_status(p_card uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.corporate_cards;
begin
  select * into c from public.corporate_cards where id = p_card and org_id = private.current_org() for update;
  if not found or not private.can_finance(c.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_status not in ('active','blocked') then raise exception 'situação inválida'; end if;
  if p_status = 'blocked' and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo do bloqueio'; end if;
  if c.status = p_status then return; end if;
  update public.corporate_cards set status = p_status, block_reason = case when p_status = 'blocked' then btrim(p_reason) end,
    blocked_at = case when p_status = 'blocked' then now() end, blocked_by = case when p_status = 'blocked' then (select auth.uid()) end where id = p_card;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id, changed_columns, old_values, new_values)
    values (c.org_id, (select auth.uid()), 'update', 'corporate_cards', p_card::text, c.unit_id, array['status'], jsonb_build_object('status', c.status), jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------- compras (cada uma é UMA despesa em payables)
create or replace function public.card_purchase_create(p_card uuid, p_date date, p_amount_cents bigint, p_description text, p_merchant text default null, p_category uuid default null,
  p_line text default 'unclassified', p_allocations jsonb default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.corporate_cards; cyc record; inv public.card_invoices; v_unpaid bigint; v_pay uuid; v_id uuid; v_today date := private.card_today();
begin
  select * into c from public.corporate_cards where id = p_card and org_id = private.current_org() for update;
  if not found or not private.can_finance(c.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if c.status <> 'active' then raise exception 'o cartão % está bloqueado: desbloqueie para registrar compras', c.nickname; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'valor da compra inválido'; end if;
  if length(btrim(coalesce(p_description, ''))) < 2 then raise exception 'descreva a compra'; end if;
  if p_date is null or p_date > v_today + 1 or p_date < v_today - 400 then raise exception 'data da compra inválida'; end if;
  if p_line not in ('physio','academy','shared','unclassified') then raise exception 'linha de negócio inválida'; end if;
  if p_category is not null and not exists (select 1 from public.finance_categories where id = p_category and org_id = c.org_id and kind = 'expense' and active) then raise exception 'categoria de despesa inválida'; end if;
  select coalesce(sum(b.amount_cents), 0) into v_unpaid from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.card_id = c.id and cp.cancelled_at is null and b.status = 'open';
  if v_unpaid + p_amount_cents > c.credit_limit_cents then
    raise exception 'limite insuficiente: disponível R$ %', replace(round((c.credit_limit_cents - v_unpaid) / 100.0, 2)::text, '.', ',');
  end if;
  select * into cyc from private.card_cycle(c.closing_day, c.due_day, p_date);
  insert into public.card_invoices (org_id, unit_id, card_id, cycle_start, closing_date, due_date) values (c.org_id, c.unit_id, c.id, cyc.cycle_start, cyc.closing_date, cyc.due_date) on conflict (card_id, closing_date) do nothing;
  select * into inv from public.card_invoices where card_id = c.id and closing_date = cyc.closing_date for update;
  if inv.status <> 'open' then raise exception 'a fatura deste ciclo (fecha em %) já foi paga', to_char(inv.closing_date, 'DD/MM/YYYY'); end if;
  insert into public.payables (org_id, unit_id, category_id, description, supplier, amount_cents, due_date, competence_month, status, business_line, created_by)
    values (c.org_id, c.unit_id, p_category, btrim(p_description), nullif(btrim(coalesce(p_merchant, '')), ''), p_amount_cents, inv.due_date, date_trunc('month', p_date)::date, 'open', p_line, (select auth.uid()))
    returning id into v_pay;
  insert into public.card_purchases (org_id, unit_id, card_id, invoice_id, payable_id, purchase_date, merchant, note, created_by)
    values (c.org_id, c.unit_id, c.id, inv.id, v_pay, p_date, nullif(btrim(coalesce(p_merchant, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())) returning id into v_id;
  if p_allocations is not null then perform public.payable_set_line(v_pay, p_line, p_allocations); end if;
  return v_id;
end $$;

create or replace function public.card_purchase_cancel(p_purchase uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare cp public.card_purchases; b public.payables;
begin
  select * into cp from public.card_purchases where id = p_purchase and org_id = private.current_org() for update;
  if not found or not private.can_finance(cp.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if cp.cancelled_at is not null then return; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo do cancelamento'; end if;
  select * into b from public.payables where id = cp.payable_id for update;
  if b.status <> 'open' then raise exception 'a compra já está em fatura paga e não pode ser cancelada'; end if;
  update public.payables set status = 'cancelled' where id = b.id;
  update public.card_purchases set cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = btrim(p_reason) where id = p_purchase;
end $$;

-- ---------------------------------------------------------------- fatura: pagar (paga as despesas do ciclo; nunca cria despesa)
create or replace function public.card_invoice_pay(p_invoice uuid, p_account uuid, p_paid_at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.card_invoices; v_total bigint; v_n int; v_at timestamptz := coalesce(p_paid_at, now());
begin
  select * into inv from public.card_invoices where id = p_invoice and org_id = private.current_org() for update;
  if not found or not private.can_finance(inv.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if inv.status = 'paid' then raise exception 'a fatura já foi paga'; end if;
  if inv.closing_date > private.card_today() then raise exception 'a fatura ainda está aberta (fecha em %)', to_char(inv.closing_date, 'DD/MM/YYYY'); end if;
  if not exists (select 1 from public.financial_accounts where id = p_account and org_id = inv.org_id and active and (unit_id is null or unit_id = inv.unit_id)) then raise exception 'conta financeira inválida para esta unidade'; end if;
  select count(*), coalesce(sum(b.amount_cents), 0) into v_n, v_total from public.card_purchases cp join public.payables b on b.id = cp.payable_id
    where cp.invoice_id = inv.id and cp.cancelled_at is null and b.status = 'open';
  if v_n = 0 then raise exception 'a fatura não tem compras a pagar'; end if;
  update public.payables set status = 'paid', paid_at = v_at, financial_account_id = p_account
    where id in (select cp.payable_id from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.invoice_id = inv.id and cp.cancelled_at is null and b.status = 'open');
  update public.card_invoices set status = 'paid', paid_at = v_at, paid_account_id = p_account, paid_by = (select auth.uid()), paid_total_cents = v_total where id = inv.id;
end $$;

-- ---------------------------------------------------------------- leitura (dados reais; nada fictício)
create or replace function public.card_summary(p_unit uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row order by nickname), '[]'::jsonb) from (
    select c.nickname, jsonb_build_object(
      'id', c.id, 'unit_id', c.unit_id, 'unit_name', u.name, 'nickname', c.nickname, 'issuer', c.issuer, 'brand', c.brand, 'last4', c.last4, 'holder_name', c.holder_name, 'status', c.status, 'block_reason', c.block_reason,
      'credit_limit_cents', c.credit_limit_cents, 'closing_day', c.closing_day, 'due_day', c.due_day, 'financial_account_id', c.financial_account_id,
      'cycle_start', cy.cycle_start, 'closing_date', cy.closing_date, 'due_date', cy.due_date,
      'spent_cycle_cents', coalesce((select sum(b.amount_cents) from public.card_purchases cp join public.payables b on b.id = cp.payable_id join public.card_invoices i on i.id = cp.invoice_id
                                      where cp.card_id = c.id and cp.cancelled_at is null and b.status <> 'cancelled' and i.closing_date = cy.closing_date), 0),
      'unpaid_cents', coalesce((select sum(b.amount_cents) from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.card_id = c.id and cp.cancelled_at is null and b.status = 'open'), 0),
      'available_cents', c.credit_limit_cents - coalesce((select sum(b.amount_cents) from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.card_id = c.id and cp.cancelled_at is null and b.status = 'open'), 0),
      'closed_unpaid_invoices', (select count(*) from public.card_invoices i where i.card_id = c.id and i.status = 'open' and i.closing_date < private.card_today() and private.card_invoice_total(i.id) > 0)
    ) as row
    from public.corporate_cards c join public.units u on u.id = c.unit_id
    cross join lateral private.card_cycle(c.closing_day, c.due_day, private.card_today()) cy
    where c.org_id = private.current_org() and private.can_finance(c.unit_id) and (p_unit is null or c.unit_id = p_unit)
  ) x
$$;

create or replace function public.card_invoices_list(p_card uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'cycle_start', i.cycle_start, 'closing_date', i.closing_date, 'due_date', i.due_date, 'status', i.status,
    'state', case when i.status = 'paid' then 'paga' when i.closing_date < private.card_today() then 'fechada' else 'aberta' end,
    'total_cents', private.card_invoice_total(i.id), 'purchases', (select count(*) from public.card_purchases cp where cp.invoice_id = i.id and cp.cancelled_at is null),
    'paid_at', i.paid_at, 'paid_total_cents', i.paid_total_cents, 'paid_account_id', i.paid_account_id,
    'bank_line', (select jsonb_build_object('id', l.id, 'txn_date', l.txn_date, 'description', l.description) from public.bank_statement_lines l where l.matched_invoice_id = i.id)
  ) order by i.closing_date desc), '[]'::jsonb)
  from public.card_invoices i where i.card_id = p_card and i.org_id = private.current_org() and private.can_finance(i.unit_id)
$$;

create or replace function public.card_purchases_list(p_card uuid, p_invoice uuid default null, p_limit int default 200) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cp.id, 'purchase_date', cp.purchase_date, 'merchant', cp.merchant, 'description', b.description, 'amount_cents', b.amount_cents, 'category', fc.name,
    'business_line', b.business_line, 'unit_name', u.name, 'invoice_id', cp.invoice_id, 'closing_date', i.closing_date, 'cancelled', cp.cancelled_at is not null, 'cancel_reason', cp.cancel_reason,
    'payable_status', b.status, 'note', cp.note
  ) order by cp.purchase_date desc, cp.created_at desc), '[]'::jsonb)
  from (select * from public.card_purchases x where x.card_id = p_card and x.org_id = private.current_org() and private.can_finance(x.unit_id) and (p_invoice is null or x.invoice_id = p_invoice)
        order by x.purchase_date desc, x.created_at desc limit least(greatest(p_limit, 1), 500)) cp
  join public.payables b on b.id = cp.payable_id join public.card_invoices i on i.id = cp.invoice_id join public.units u on u.id = cp.unit_id left join public.finance_categories fc on fc.id = b.category_id
$$;

-- ---------------------------------------------------------------- conciliação da fatura (só aponta)
create or replace function public.card_invoice_suggestions(p_line uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l public.bank_statement_lines; v_acc uuid;
begin
  select * into l from public.bank_statement_lines where id = p_line;
  if not found or not private.can_finance(l.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.amount_cents >= 0 or l.status <> 'unmatched' then return '[]'::jsonb; end if;
  select account_id into v_acc from public.bank_statement_imports where id = l.import_id;
  return coalesce((select jsonb_agg(jsonb_build_object('invoice_id', i.id, 'card', c.nickname, 'closing_date', i.closing_date, 'due_date', i.due_date, 'amount_cents', i.paid_total_cents, 'paid_at', i.paid_at)
                          order by abs(i.paid_at::date - l.txn_date))
    from public.card_invoices i join public.corporate_cards c on c.id = i.card_id
    where i.unit_id = l.unit_id and i.status = 'paid' and i.paid_total_cents = -l.amount_cents and i.paid_account_id = v_acc and abs(i.paid_at::date - l.txn_date) <= 5
      and not exists (select 1 from public.bank_statement_lines x where x.matched_invoice_id = i.id)), '[]'::jsonb);
end $$;

create or replace function public.card_invoice_reconcile(p_line uuid, p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines; inv public.card_invoices; v_acc uuid;
begin
  select * into l from public.bank_statement_lines where id = p_line for update;
  if not found or not private.can_finance(l.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.status <> 'unmatched' then raise exception 'linha já conciliada ou ignorada'; end if;
  if l.amount_cents >= 0 then raise exception 'linha de entrada não pode ser conciliada com uma fatura de cartão'; end if;
  select * into inv from public.card_invoices where id = p_invoice and org_id = l.org_id and unit_id = l.unit_id;
  if not found then raise exception 'fatura não encontrada nesta unidade'; end if;
  if inv.status <> 'paid' then raise exception 'registre o pagamento da fatura antes de conciliar'; end if;
  if inv.paid_total_cents <> -l.amount_cents then raise exception 'o valor da fatura (R$ %) não corresponde à linha do extrato', replace(round(inv.paid_total_cents / 100.0, 2)::text, '.', ','); end if;
  select account_id into v_acc from public.bank_statement_imports where id = l.import_id;
  if v_acc is distinct from inv.paid_account_id then raise exception 'a linha é de outra conta bancária: a fatura foi paga por outra conta'; end if;
  update public.bank_statement_lines set status = 'matched', matched_invoice_id = p_invoice, matched_by = (select auth.uid()), matched_at = now() where id = p_line;
exception when unique_violation then raise exception 'esta fatura já foi conciliada com outra linha do extrato';
end $$;

-- ---------------------------------------------------------------- ajustes nas funções existentes (a regra de ouro continua: conciliação só aponta; compra de cartão só se paga pela fatura)
create or replace function public.payable_pay(p_id uuid, p_account uuid, p_paid_at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payables;
begin
  select * into p from public.payables where id = p_id and org_id = private.current_org() for update;
  if not found or not private.can_finance(p.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p.status = 'paid' then return; end if;
  if p.status <> 'open' then raise exception 'conta não está em aberto'; end if;
  if exists (select 1 from public.card_purchases where payable_id = p_id) then raise exception 'esta despesa é compra de cartão: pague a fatura do cartão'; end if;
  update public.payables set status = 'paid', paid_at = coalesce(p_paid_at, now()), financial_account_id = p_account where id = p_id;
end $$;

create or replace function public.bank_reconcile_confirm(p_line uuid, p_payment_id uuid default null, p_payable_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines;
begin
  if (p_payment_id is null) = (p_payable_id is null) then raise exception 'informe exatamente um: pagamento OU conta a pagar'; end if;
  select * into l from public.bank_statement_lines where id = p_line for update;
  if not found or not private.can_finance(l.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.status <> 'unmatched' then raise exception 'linha já conciliada ou ignorada'; end if;
  if p_payment_id is not null then
    if l.amount_cents <= 0 then raise exception 'linha de saída não pode ser conciliada com um recebimento'; end if;
    if not exists (select 1 from public.payments where id = p_payment_id and unit_id = l.unit_id and kind = 'payment' and amount_cents = l.amount_cents) then raise exception 'pagamento não corresponde ao valor da linha'; end if;
  else
    if l.amount_cents >= 0 then raise exception 'linha de entrada não pode ser conciliada com uma conta a pagar'; end if;
    if exists (select 1 from public.card_purchases where payable_id = p_payable_id) then raise exception 'esta despesa é compra de cartão: concilie a fatura do cartão, não a compra'; end if;
    if not exists (select 1 from public.payables where id = p_payable_id and unit_id = l.unit_id and status = 'paid' and amount_cents = -l.amount_cents) then raise exception 'conta a pagar não corresponde ao valor da linha'; end if;
  end if;
  update public.bank_statement_lines set status = 'matched', matched_payment_id = p_payment_id, matched_payable_id = p_payable_id, matched_by = (select auth.uid()), matched_at = now() where id = p_line;
exception when unique_violation then raise exception 'este lançamento já foi conciliado com outra linha do extrato';
end $$;

create or replace function public.bank_reconcile_suggestions(p_line uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l public.bank_statement_lines;
begin
  select * into l from public.bank_statement_lines where id = p_line;
  if not found or not private.can_finance(l.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.amount_cents > 0 then
    return coalesce((select jsonb_agg(jsonb_build_object('payment_id', p.id, 'amount_cents', p.amount_cents, 'paid_at', p.paid_at, 'method', p.method, 'person', pe.full_name) order by abs(extract(epoch from p.paid_at - l.txn_date::timestamptz)))
      from public.payments p join public.receivables r on r.id = p.receivable_id join public.people pe on pe.id = r.person_id
      where p.unit_id = l.unit_id and p.kind = 'payment' and p.amount_cents = l.amount_cents and abs(p.paid_at::date - l.txn_date) <= 3
        and not exists (select 1 from public.bank_statement_lines x where x.matched_payment_id = p.id)), '[]');
  else
    return coalesce((select jsonb_agg(jsonb_build_object('payable_id', b.id, 'amount_cents', -b.amount_cents, 'paid_at', b.paid_at, 'description', b.description) order by abs(extract(epoch from b.paid_at - l.txn_date::timestamptz)))
      from public.payables b where b.unit_id = l.unit_id and b.status = 'paid' and b.amount_cents = -l.amount_cents and abs(b.paid_at::date - l.txn_date) <= 3
        and not exists (select 1 from public.bank_statement_lines x where x.matched_payable_id = b.id)
        and not exists (select 1 from public.card_purchases cp where cp.payable_id = b.id)), '[]');
  end if;
end $$;

create or replace function public.bank_reconcile_undo(p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines;
begin
  select * into l from public.bank_statement_lines where id = p_line for update;
  if not found or not private.can_finance(l.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.status = 'unmatched' then return; end if;
  update public.bank_statement_lines set status = 'unmatched', matched_payment_id = null, matched_payable_id = null, matched_invoice_id = null, matched_by = null, matched_at = null, ignored_reason = null where id = p_line;
end $$;

-- divisão por linha de negócio de uma linha do extrato conciliada com FATURA: soma da divisão de cada compra (as mesmas regras da despesa)
create or replace function private.bank_line_split(p_line uuid) returns table (bucket text, cents bigint, origin text)
language sql stable security definer set search_path = '' as $$
  with l as (select * from public.bank_statement_lines where id = p_line),
  a as (select line, basis_points bp from public.bank_line_allocations where statement_line_id = p_line),
  raw as (select a.line, floor(abs(l.amount_cents)::numeric * a.bp / 10000) fl, (abs(l.amount_cents)::numeric * a.bp) - floor(abs(l.amount_cents)::numeric * a.bp / 10000) * 10000 rem from a cross join l),
  ranked as (select r.line, r.fl, (select abs(amount_cents) from l)::numeric - sum(r.fl) over () leftover, row_number() over (order by r.rem desc, r.line) rn from raw r)
  -- conciliado com recebimento: mesma divisão da venda que originou o pagamento
  select x.line, x.cents, 'recebimento'::text from l join public.payments py on py.id = l.matched_payment_id join public.receivables r on r.id = py.receivable_id
    cross join lateral private.split_sale_amount(r.sale_id, l.amount_cents) x
  union all
  -- conciliado com conta paga: saída; a divisão é feita no valor positivo e o sinal volta depois
  select x.bucket, -x.cents, 'conta_a_pagar'::text from l cross join lateral private.split_payable(l.matched_payable_id, -l.amount_cents) x where l.matched_payable_id is not null
  union all
  -- conciliado com fatura de cartão: cada compra da fatura divide como a própria despesa
  select s.bucket, -sum(s.cents)::bigint, 'fatura_cartao'::text
    from l join public.card_purchases cp on cp.invoice_id = l.matched_invoice_id and cp.cancelled_at is null
    join public.payables b on b.id = cp.payable_id and b.status <> 'cancelled'
    cross join lateral private.split_payable(b.id, b.amount_cents) s where l.matched_invoice_id is not null group by s.bucket
  union all
  -- pendente/ignorado com alocação manual
  select r.line, ((case when (select amount_cents from l) < 0 then -1 else 1 end) * (r.fl + case when r.rn <= r.leftover then 1 else 0 end))::bigint, 'alocacao_manual'::text
    from ranked r where (select status from l) <> 'matched'
  union all
  -- sem nada: não classificado
  select 'unclassified'::text, l.amount_cents, 'sem_alocacao'::text from l where l.status <> 'matched' and not exists (select 1 from a)
$$;

-- ---------------------------------------------------------------- permissões
revoke all on function public.card_create(uuid, text, text, text, bigint, int, int, text, text, uuid), public.card_set_status(uuid, text, text),
  public.card_purchase_create(uuid, date, bigint, text, text, uuid, text, jsonb, text), public.card_purchase_cancel(uuid, text), public.card_invoice_pay(uuid, uuid, timestamptz),
  public.card_summary(uuid), public.card_invoices_list(uuid), public.card_purchases_list(uuid, uuid, int), public.card_invoice_suggestions(uuid), public.card_invoice_reconcile(uuid, uuid),
  public.payable_pay(uuid, uuid, timestamptz), public.bank_reconcile_confirm(uuid, uuid, uuid), public.bank_reconcile_suggestions(uuid), public.bank_reconcile_undo(uuid) from public, anon;
grant execute on function public.card_create(uuid, text, text, text, bigint, int, int, text, text, uuid), public.card_set_status(uuid, text, text),
  public.card_purchase_create(uuid, date, bigint, text, text, uuid, text, jsonb, text), public.card_purchase_cancel(uuid, text), public.card_invoice_pay(uuid, uuid, timestamptz),
  public.card_summary(uuid), public.card_invoices_list(uuid), public.card_purchases_list(uuid, uuid, int), public.card_invoice_suggestions(uuid), public.card_invoice_reconcile(uuid, uuid),
  public.payable_pay(uuid, uuid, timestamptz), public.bank_reconcile_confirm(uuid, uuid, uuid), public.bank_reconcile_suggestions(uuid), public.bank_reconcile_undo(uuid) to authenticated;
revoke all on function private.card_cycle(int, int, date), private.card_today(), private.card_invoice_total(uuid), private.bank_line_split(uuid) from public, anon, authenticated;
