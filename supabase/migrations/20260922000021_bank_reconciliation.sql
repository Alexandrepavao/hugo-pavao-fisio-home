-- HP Group Hub — 021 Conciliação bancária: importa o extrato e CASA com lançamentos já existentes.
-- Nunca cria um pagamento/conta a paga novo a partir da conciliação (isso já existe via payment_record/payable_pay);
-- a conciliação só aponta bank_statement_lines.matched_payment_id/matched_payable_id, nunca duplica lançamento.
-- Formato de importação: já compatível com o extrato (data, descrição, valor em centavos, referência opcional) —
-- nenhuma integração bancária real é assumida; o CSV é enviado pelo usuário, exatamente como pedido.

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  filename text,
  row_count int not null default 0,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now()
);
create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  unit_id uuid not null,
  import_id uuid not null references public.bank_statement_imports(id) on delete cascade,
  txn_date date not null,
  description text not null,
  amount_cents bigint not null check (amount_cents <> 0),      -- positivo = entrada (crédito), negativo = saída (débito)
  external_ref text,
  status text not null default 'unmatched' check (status in ('unmatched','matched','ignored')),
  matched_payment_id uuid references public.payments(id) on delete restrict,
  matched_payable_id uuid references public.payables(id) on delete restrict,
  matched_by uuid references auth.users(id) on delete set null,
  matched_at timestamptz,
  ignored_reason text,
  created_at timestamptz not null default now(),
  check ((status = 'matched') = (matched_payment_id is not null or matched_payable_id is not null)),
  check (not (matched_payment_id is not null and matched_payable_id is not null)),
  check (matched_payment_id is null or amount_cents > 0),       -- pagamento recebido = entrada
  check (matched_payable_id is null or amount_cents < 0)        -- conta paga = saída
);
create index bsl_import_idx on public.bank_statement_lines (import_id);
create index bsl_status_idx on public.bank_statement_lines (unit_id, status);
create unique index bsl_payment_uq on public.bank_statement_lines (matched_payment_id) where matched_payment_id is not null;   -- um pagamento não pode ser conciliado 2x
create unique index bsl_payable_uq on public.bank_statement_lines (matched_payable_id) where matched_payable_id is not null;   -- idem conta a pagar

alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_lines enable row level security;
grant select, insert on public.bank_statement_imports to authenticated;
grant select on public.bank_statement_lines to authenticated;

create policy bsi_read on public.bank_statement_imports for select to authenticated using (private.in_org(org_id) and private.can_finance(unit_id));
create policy bsi_write on public.bank_statement_imports for insert to authenticated with check (private.in_org(org_id) and private.can_finance(unit_id) and imported_by = (select auth.uid()));
create policy bsl_read on public.bank_statement_lines for select to authenticated using (private.in_org(org_id) and private.can_finance(unit_id));

-- Importa um lote de linhas de extrato já lido e validado no cliente (CSV → JSON). Nunca lê arquivo do servidor.
create or replace function public.bank_statement_import(p_account uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_unit uuid; v_import uuid; ln jsonb; v_amount bigint; v_n int := 0;
begin
  select unit_id into v_unit from public.financial_accounts where id = p_account and org_id = v_org;
  if v_unit is null or not private.can_finance(v_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'inclua ao menos uma linha do extrato'; end if;
  if jsonb_array_length(p_lines) > 2000 then raise exception 'no máximo 2000 linhas por importação'; end if;
  insert into public.bank_statement_imports (org_id, unit_id, account_id, imported_by) values (v_org, v_unit, p_account, (select auth.uid())) returning id into v_import;
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_amount := (ln ->> 'amount_cents')::bigint;
    if v_amount = 0 or (ln ->> 'date') is null or coalesce(btrim(ln ->> 'description'), '') = '' then continue; end if;   -- linha inválida: pula, não derruba o lote
    insert into public.bank_statement_lines (org_id, unit_id, import_id, txn_date, description, amount_cents, external_ref)
      values (v_org, v_unit, v_import, (ln ->> 'date')::date, btrim(ln ->> 'description'), v_amount, ln ->> 'ref');
    v_n := v_n + 1;
  end loop;
  update public.bank_statement_imports set row_count = v_n where id = v_import;
  return v_import;
end $$;

-- Sugestões de casamento: mesmo valor (em módulo) e data dentro de ±3 dias, ainda não conciliado.
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
        and not exists (select 1 from public.bank_statement_lines x where x.matched_payable_id = b.id)), '[]');
  end if;
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
    if not exists (select 1 from public.payables where id = p_payable_id and unit_id = l.unit_id and status = 'paid' and amount_cents = -l.amount_cents) then raise exception 'conta a pagar não corresponde ao valor da linha'; end if;
  end if;
  update public.bank_statement_lines set status = 'matched', matched_payment_id = p_payment_id, matched_payable_id = p_payable_id, matched_by = (select auth.uid()), matched_at = now() where id = p_line;
exception when unique_violation then raise exception 'este lançamento já foi conciliado com outra linha do extrato';
end $$;

create or replace function public.bank_reconcile_ignore(p_line uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines;
begin
  select * into l from public.bank_statement_lines where id = p_line for update;
  if not found or not private.can_finance(l.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.status <> 'unmatched' then raise exception 'linha já conciliada ou ignorada'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'informe o motivo'; end if;
  update public.bank_statement_lines set status = 'ignored', ignored_reason = p_reason, matched_by = (select auth.uid()), matched_at = now() where id = p_line;
end $$;

create or replace function public.bank_reconcile_undo(p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines;
begin
  select * into l from public.bank_statement_lines where id = p_line for update;
  if not found or not private.can_finance(l.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.status = 'unmatched' then return; end if;
  update public.bank_statement_lines set status = 'unmatched', matched_payment_id = null, matched_payable_id = null, matched_by = null, matched_at = null, ignored_reason = null where id = p_line;
end $$;

create trigger audit_bank_lines after update on public.bank_statement_lines for each row execute function private.audit_row('status','matched_payment_id','matched_payable_id');

grant execute on function public.bank_statement_import(uuid, jsonb), public.bank_reconcile_suggestions(uuid), public.bank_reconcile_confirm(uuid, uuid, uuid),
  public.bank_reconcile_ignore(uuid, text), public.bank_reconcile_undo(uuid) to authenticated;
