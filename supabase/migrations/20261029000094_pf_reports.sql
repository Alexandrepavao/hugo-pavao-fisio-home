-- HP Group Hub — 094 Finanças pessoais: agenda/calendário, saldos, cartões, KPIs com detalhamento, custo de vida, caixa projetado, orçamento, reserva, metas e lembretes.
-- Tudo calculado no banco a partir dos MESMOS itens (private.pf_items / private.pf_kpi_rows / private.pf_cost_rows): cartão, gráfico, calendário e lista reconciliam por construção.
-- Regras de leitura (documentadas em docs/financas-pessoais.md):
--  · Despesa realizada = pagamentos efetivos (por data de pagamento) + compras no cartão até hoje (por data da compra); o pagamento da FATURA é caixa, nunca despesa.
--  · Despesa prevista = saldo ainda não pago com vencimento no período + ocorrências futuras calculadas + compras/parcelas do cartão com data futura.
--  · Receita recebida/prevista, idem. Transferências, aportes em reserva/metas e investimentos ficam fora de receita e de custo de vida.

-- ---------------------------------------------------------------- saldos
create or replace function private.pf_balance(p_account uuid, p_asof date) returns bigint
language sql stable security definer set search_path = '' as $$
  select a.opening_balance_cents
    + coalesce((select sum(case e.kind when 'income' then s.amount_cents else -s.amount_cents end) from public.pf_settlements s join public.pf_entries e on e.id = s.entry_id
                 where s.account_id = a.id and s.voided_at is null and s.settled_on between a.opening_date and p_asof), 0)
    + coalesce((select sum(t.amount_cents) from public.pf_transfers t where t.to_account_id = a.id and t.voided_at is null and t.on_date between a.opening_date and p_asof), 0)
    - coalesce((select sum(t.amount_cents) from public.pf_transfers t where t.from_account_id = a.id and t.voided_at is null and t.on_date between a.opening_date and p_asof), 0)
    - coalesce((select sum(p.amount_cents) from public.pf_invoice_payments p where p.account_id = a.id and p.voided_at is null and p.paid_on between a.opening_date and p_asof), 0)
  from public.pf_accounts a where a.id = p_account
$$;
revoke all on function private.pf_balance(uuid, date) from public, anon, authenticated;

-- sugestão para variável sem estimativa: média dos últimos valores reais (até 6) da linhagem da recorrência
create or replace function private.pf_series_suggest(p_root uuid) returns table (cents bigint, n int)
language sql stable security definer set search_path = '' as $$
  select round(avg(amount_cents))::bigint, count(*)::int from (select amount_cents from public.pf_entries where series_root_id = p_root and status = 'settled' and not is_estimate order by occurrence_date desc limit 6) x having count(*) > 0
$$;
revoke all on function private.pf_series_suggest(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- itens (lançamentos + ocorrências calculadas + faturas), base de agenda, lembretes e fluxo de caixa
create or replace function private.pf_items(p_user uuid, p_from date, p_to date) returns table (
  key text, source text, entry_id uuid, series_id uuid, occurrence_date date, invoice_id uuid, kind text, description text, category_id uuid, category_name text,
  account_id uuid, card_id uuid, cal_date date, due_date date, cash_date date, competence_date date, amount_cents bigint, settled_cents bigint, remaining_cents bigint,
  status text, nature text, repetition text, is_estimate boolean, installment text, essential boolean, cash_in bigint, cash_out bigint, is_card boolean, no_estimate boolean, overdue boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.pf_today();
begin
  return query
  select ('e:' || e.id)::text, 'entry'::text, e.id, e.series_id, e.occurrence_date, e.invoice_id, e.kind, e.description, e.category_id, c.name, e.account_id, e.card_id,
         (case when e.card_id is not null then e.competence_date else e.due_date end), e.due_date, (case when e.card_id is null then e.due_date end), e.competence_date,
         e.amount_cents, e.settled_cents, (case when e.status in ('cancelled','settled') then 0 else greatest(e.amount_cents - e.settled_cents, 0) end)::bigint,
         e.status, e.nature, e.repetition, e.is_estimate, (case when e.installment_no is not null then e.installment_no || '/' || e.installment_total end), e.essential,
         (case when e.card_id is null and e.kind = 'income' and e.status in ('planned','open','partial') then greatest(e.amount_cents - e.settled_cents, 0) else 0 end)::bigint,
         (case when e.card_id is null and e.kind = 'expense' and e.status in ('planned','open','partial') then greatest(e.amount_cents - e.settled_cents, 0) else 0 end)::bigint,
         (e.card_id is not null), false, (e.card_id is null and e.status in ('planned','open','partial') and e.due_date < v_today)
    from public.pf_entries e left join public.pf_categories c on c.id = e.category_id
   where e.owner_user_id = p_user and e.status <> 'cancelled'
     and ((e.card_id is null and e.due_date between p_from and p_to) or (e.card_id is not null and e.competence_date between p_from and p_to))
  union all
  select ('s:' || s.id || ':' || o.occ_date)::text, 'virtual'::text, null::uuid, s.id, o.occ_date, null::uuid, s.kind, s.description, s.category_id, c.name, s.account_id, s.card_id,
         o.occ_date, (case when s.card_id is not null then cy.due_date else o.occ_date end), (case when s.card_id is not null then cy.due_date else o.occ_date end), o.occ_date,
         coalesce(s.amount_cents, sg.cents, 0)::bigint, 0::bigint, coalesce(s.amount_cents, sg.cents, 0)::bigint,
         'planned'::text, s.nature, 'recurring'::text, (s.is_estimate or s.amount_cents is null), null::text, s.essential,
         (case when s.kind = 'income' then coalesce(s.amount_cents, sg.cents, 0) else 0 end)::bigint, (case when s.kind = 'expense' then coalesce(s.amount_cents, sg.cents, 0) else 0 end)::bigint,
         false, (s.amount_cents is null and sg.cents is null), (o.occ_date < v_today)
    from public.pf_series s
    cross join lateral private.pf_occurrences(s.id, p_from, p_to) o
    left join public.pf_categories c on c.id = s.category_id
    left join public.pf_cards k on k.id = s.card_id
    left join lateral private.pf_card_cycle(k.closing_day, k.due_day, o.occ_date) cy on k.id is not null
    left join lateral private.pf_series_suggest(s.root_id) sg on s.amount_cents is null
   where s.owner_user_id = p_user
     and not exists (select 1 from public.pf_entries x where x.series_root_id = s.root_id and x.occurrence_date = o.occ_date)
  union all
  select ('i:' || i.id)::text, 'invoice'::text, null::uuid, null::uuid, null::date, i.id, 'expense'::text, ('Fatura ' || k.nickname)::text, null::uuid, 'Fatura do cartão'::text, k.pay_account_id, k.id,
         i.due_date, i.due_date, i.due_date, i.closing_date, t.tot, t.paid, greatest(t.tot - t.paid, 0)::bigint,
         (case when t.paid >= t.tot then 'settled' when t.paid > 0 then 'partial' else 'open' end)::text, 'fixed'::text, 'single'::text, false, null::text, false,
         0::bigint, greatest(t.tot - t.paid, 0)::bigint, false, false, (t.paid < t.tot and i.due_date < v_today)
    from public.pf_invoices i join public.pf_cards k on k.id = i.card_id
    cross join lateral (select private.pf_invoice_total(i.id) tot, private.pf_invoice_paid(i.id) paid) t
   where i.owner_user_id = p_user and i.due_date between p_from and p_to and t.tot > 0;
end $$;
revoke all on function private.pf_items(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- agenda / lista / calendário (com filtros)
create or replace function public.pf_agenda(p_from date, p_to date, p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); f jsonb := coalesce(p_filters, '{}'::jsonb); v_items jsonb; v_total int;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'período inválido'; end if;
  if p_to - p_from > 800 then raise exception 'período muito longo (máximo de cerca de 26 meses)'; end if;
  with it as (
    select * from private.pf_items(v_user, p_from, p_to) i
     where (not (f ? 'kind') or i.kind = f ->> 'kind')
       and (not (f ? 'status') or i.status = f ->> 'status')
       and (not (f ? 'category_id') or i.category_id = (f ->> 'category_id')::uuid)
       and (not (f ? 'account_id') or i.account_id = (f ->> 'account_id')::uuid)
       and (not (f ? 'card_id') or i.card_id = (f ->> 'card_id')::uuid)
       and (not (f ? 'nature') or i.nature = f ->> 'nature')
       and (not (f ? 'repetition') or i.repetition = f ->> 'repetition')
       and (not (f ? 'source') or i.source = f ->> 'source')
       and (not (f ? 'essential') or i.essential = (f ->> 'essential')::boolean)
       and (not (f ? 'overdue') or i.overdue = (f ->> 'overdue')::boolean)
       and (not (f ? 'q') or i.description ilike '%' || replace(replace(f ->> 'q', '%', ''), '_', '') || '%'))
  select count(*), coalesce(jsonb_agg(to_jsonb(x) order by x.cal_date, x.description) filter (where x.rn <= 1500), '[]'::jsonb) into v_total, v_items
    from (select it.*, row_number() over (order by it.cal_date, it.description) rn from it) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'from', p_from, 'to', p_to, 'today', private.pf_today());
end $$;
revoke all on function public.pf_agenda(date, date, jsonb) from public, anon;
grant execute on function public.pf_agenda(date, date, jsonb) to authenticated;

-- ---------------------------------------------------------------- contas e cartões (saldos, limites, faturas)
create or replace function public.pf_accounts_overview(p_asof date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_asof date := coalesce(p_asof, private.pf_today()); v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'opening_balance_cents', a.opening_balance_cents, 'opening_date', a.opening_date,
            'counts_for_reserve', a.counts_for_reserve, 'active', a.active, 'balance_cents', private.pf_balance(a.id, v_asof)) order by a.name), '[]'::jsonb) into v_rows
    from public.pf_accounts a where a.owner_user_id = v_user;
  return jsonb_build_object('asof', v_asof, 'accounts', v_rows, 'total_cents', coalesce((select sum((x ->> 'balance_cents')::bigint) from jsonb_array_elements(v_rows) x where (x ->> 'active')::boolean), 0));
end $$;
revoke all on function public.pf_accounts_overview(date) from public, anon;
grant execute on function public.pf_accounts_overview(date) to authenticated;

create or replace function public.pf_cards_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_today date := private.pf_today(); v_rows jsonb;
begin
  select coalesce(jsonb_agg(c order by c ->> 'nickname'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', k.id, 'nickname', k.nickname, 'issuer', k.issuer, 'brand', k.brand, 'last4', k.last4, 'status', k.status, 'limit_cents', k.limit_cents,
        'closing_day', k.closing_day, 'due_day', k.due_day, 'pay_account_id', k.pay_account_id,
        'used_cents', coalesce(u.used, 0), 'available_cents', k.limit_cents - coalesce(u.used, 0),
        'current_invoice', (select jsonb_build_object('id', i.id, 'closing_date', i.closing_date, 'due_date', i.due_date, 'total_cents', private.pf_invoice_total(i.id), 'paid_cents', private.pf_invoice_paid(i.id))
                              from private.pf_card_cycle(k.closing_day, k.due_day, v_today) cy join public.pf_invoices i on i.card_id = k.id and i.cycle_start = cy.cycle_start),
        'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'cycle_start', i.cycle_start, 'closing_date', i.closing_date, 'due_date', i.due_date, 'total_cents', t.tot, 'paid_cents', t.paid,
                              'state', case when t.paid >= t.tot then 'paga' when i.closing_date >= v_today then 'aberta' else 'fechada' end) order by i.due_date)
                              from public.pf_invoices i cross join lateral (select private.pf_invoice_total(i.id) tot, private.pf_invoice_paid(i.id) paid) t
                              where i.card_id = k.id and t.tot > 0 and (t.paid < t.tot or i.due_date >= v_today - 60)), '[]'::jsonb),
        'future_purchases_cents', coalesce((select sum(e.amount_cents) from public.pf_entries e where e.card_id = k.id and e.status <> 'cancelled' and e.competence_date > v_today), 0),
        'due_next_30_cents', coalesce((select sum(t.tot - t.paid) from public.pf_invoices i cross join lateral (select private.pf_invoice_total(i.id) tot, private.pf_invoice_paid(i.id) paid) t
                                       where i.card_id = k.id and i.due_date between v_today and v_today + 30 and t.tot > t.paid), 0)) c
    from public.pf_cards k
    left join lateral (select sum(t.tot - t.paid) used from public.pf_invoices i cross join lateral (select private.pf_invoice_total(i.id) tot, private.pf_invoice_paid(i.id) paid) t where i.card_id = k.id and t.tot > t.paid) u on true
    where k.owner_user_id = v_user) q;
  return jsonb_build_object('cards', v_rows, 'today', v_today);
end $$;
revoke all on function public.pf_cards_overview() from public, anon;
grant execute on function public.pf_cards_overview() to authenticated;

-- ---------------------------------------------------------------- linhas atômicas dos KPIs (cartão e detalhamento usam as MESMAS linhas)
create or replace function private.pf_kpi_rows(p_user uuid, p_kind text, p_from date, p_to date) returns table (
  row_date date, description text, category_name text, amount_cents bigint, kind text, status text, nature text, essential boolean, ref jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.pf_today();
begin
  if p_kind = 'income_received' then
    return query select s.settled_on, e.description, c.name, s.amount_cents, e.kind, 'settled'::text, e.nature, e.essential, jsonb_build_object('entry_id', e.id)
      from public.pf_settlements s join public.pf_entries e on e.id = s.entry_id left join public.pf_categories c on c.id = e.category_id
     where s.owner_user_id = p_user and s.voided_at is null and e.kind = 'income' and s.settled_on between p_from and p_to;
  elsif p_kind = 'expense_realized' then
    return query select s.settled_on, e.description, c.name, s.amount_cents, e.kind, 'settled'::text, e.nature, e.essential, jsonb_build_object('entry_id', e.id)
      from public.pf_settlements s join public.pf_entries e on e.id = s.entry_id left join public.pf_categories c on c.id = e.category_id
     where s.owner_user_id = p_user and s.voided_at is null and e.kind = 'expense' and e.card_id is null and s.settled_on between p_from and p_to
    union all
    select e.competence_date, e.description, c.name, e.amount_cents, e.kind, e.status, e.nature, e.essential, jsonb_build_object('entry_id', e.id)
      from public.pf_entries e left join public.pf_categories c on c.id = e.category_id
     where e.owner_user_id = p_user and e.kind = 'expense' and e.card_id is not null and e.status <> 'cancelled' and e.competence_date between p_from and least(p_to, v_today);
  elsif p_kind = 'income_expected' then
    return query select i.cal_date, i.description, i.category_name, i.cash_in, i.kind, i.status, i.nature, i.essential, jsonb_build_object('entry_id', i.entry_id, 'series_id', i.series_id, 'occurrence_date', i.occurrence_date)
      from private.pf_items(p_user, p_from, p_to) i where i.kind = 'income' and i.cash_in > 0 and i.source in ('entry','virtual');
  elsif p_kind = 'expense_expected' then
    return query select i.cal_date, i.description, i.category_name, (case when i.is_card then i.amount_cents else i.cash_out end), i.kind, i.status, i.nature, i.essential,
                        jsonb_build_object('entry_id', i.entry_id, 'series_id', i.series_id, 'occurrence_date', i.occurrence_date)
      from private.pf_items(p_user, p_from, p_to) i
     where i.kind = 'expense' and i.source in ('entry','virtual')
       and ((i.is_card and i.source = 'entry' and i.competence_date > v_today) or (not i.is_card and i.cash_out > 0) or (i.source = 'virtual' and i.cash_out > 0));
  elsif p_kind = 'overdue' then
    return query select i.due_date, i.description, i.category_name, i.cash_out, i.kind, i.status, i.nature, i.essential, jsonb_build_object('entry_id', i.entry_id, 'series_id', i.series_id, 'occurrence_date', i.occurrence_date, 'invoice_id', i.invoice_id)
      from private.pf_items(p_user, date '1900-01-01', v_today - 1) i where i.kind = 'expense' and i.overdue and i.cash_out > 0 and i.source in ('entry','virtual','invoice') and not i.is_card;
  elsif p_kind in ('due7','due30') then
    return query select i.cash_date, i.description, i.category_name, i.cash_out, i.kind, i.status, i.nature, i.essential, jsonb_build_object('entry_id', i.entry_id, 'series_id', i.series_id, 'occurrence_date', i.occurrence_date, 'invoice_id', i.invoice_id)
      from private.pf_items(p_user, v_today - 45, v_today + (case when p_kind = 'due7' then 7 else 30 end)) i
     where i.kind = 'expense' and i.cash_out > 0 and i.cash_date between v_today and v_today + (case when p_kind = 'due7' then 7 else 30 end);
  elsif p_kind = 'invoices_next' then
    return query select i.due_date, i.description, i.category_name, i.cash_out, i.kind, i.status, i.nature, i.essential, jsonb_build_object('invoice_id', i.invoice_id)
      from private.pf_items(p_user, date '1900-01-01', v_today + 1000) i where i.source = 'invoice' and i.cash_out > 0;
  else
    raise exception 'indicador desconhecido';
  end if;
end $$;
revoke all on function private.pf_kpi_rows(uuid, text, date, date) from public, anon, authenticated;

create or replace function public.pf_kpi_detail(p_kind text, p_from date, p_to date, p_nature text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_rows jsonb; v_total bigint; v_kinds text[];
begin
  v_kinds := case p_kind when 'fixed' then array['expense_realized','expense_expected'] when 'variable' then array['expense_realized','expense_expected'] else array[p_kind] end;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.row_date, r.description), '[]'::jsonb), coalesce(sum(r.amount_cents), 0) into v_rows, v_total
    from (select k.* from unnest(v_kinds) kk cross join lateral private.pf_kpi_rows(v_user, kk, p_from, p_to) k
           where p_kind not in ('fixed','variable') or k.nature = p_kind) r;
  return jsonb_build_object('kind', p_kind, 'total_cents', v_total, 'rows', v_rows, 'count', jsonb_array_length(v_rows));
end $$;
revoke all on function public.pf_kpi_detail(text, date, date, text) from public, anon;
grant execute on function public.pf_kpi_detail(text, date, date, text) to authenticated;

-- ---------------------------------------------------------------- linhas de custo (despesa) por mês: realizado · compromisso · variável (base do custo de vida)
create or replace function private.pf_cost_rows(p_user uuid, p_from date, p_to date) returns table (
  month date, bucket text, category_id uuid, parent_id uuid, essential boolean, nature text, amount_cents bigint, row_date date, description text, no_estimate boolean, ref jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.pf_today();
begin
  return query
  -- realizado: pagamentos efetivos (conta) e compras do cartão até hoje
  select date_trunc('month', s.settled_on)::date, 'realized'::text, e.category_id, c.parent_id, e.essential, e.nature, s.amount_cents, s.settled_on, e.description, false, jsonb_build_object('entry_id', e.id)
    from public.pf_settlements s join public.pf_entries e on e.id = s.entry_id left join public.pf_categories c on c.id = e.category_id
   where s.owner_user_id = p_user and s.voided_at is null and e.kind = 'expense' and e.card_id is null and s.settled_on between p_from and p_to
  union all
  select date_trunc('month', e.competence_date)::date, 'realized'::text, e.category_id, c.parent_id, e.essential, e.nature, e.amount_cents, e.competence_date, e.description, false, jsonb_build_object('entry_id', e.id)
    from public.pf_entries e left join public.pf_categories c on c.id = e.category_id
   where e.owner_user_id = p_user and e.kind = 'expense' and e.card_id is not null and e.status <> 'cancelled' and e.competence_date between p_from and least(p_to, v_today)
  union all
  -- compromisso/variável em aberto: saldo a pagar de lançamentos (conta) e compras/parcelas futuras do cartão
  select date_trunc('month', e.due_date)::date, (case when e.is_estimate then 'variable' else 'committed' end)::text, e.category_id, c.parent_id, e.essential, e.nature, greatest(e.amount_cents - e.settled_cents, 0)::bigint, e.due_date, e.description, false, jsonb_build_object('entry_id', e.id)
    from public.pf_entries e left join public.pf_categories c on c.id = e.category_id
   where e.owner_user_id = p_user and e.kind = 'expense' and e.card_id is null and e.status in ('planned','open','partial') and e.due_date between p_from and p_to and e.amount_cents > e.settled_cents
  union all
  select date_trunc('month', e.competence_date)::date, (case when e.is_estimate then 'variable' else 'committed' end)::text, e.category_id, c.parent_id, e.essential, e.nature, e.amount_cents, e.competence_date, e.description, false, jsonb_build_object('entry_id', e.id)
    from public.pf_entries e left join public.pf_categories c on c.id = e.category_id
   where e.owner_user_id = p_user and e.kind = 'expense' and e.card_id is not null and e.status <> 'cancelled' and e.competence_date > v_today and e.competence_date between p_from and p_to
  union all
  -- ocorrências calculadas (ainda sem lançamento)
  select date_trunc('month', i.cal_date)::date, (case when i.nature = 'variable' then 'variable' else 'committed' end)::text, i.category_id, c.parent_id, i.essential, i.nature, i.amount_cents, i.cal_date, i.description, i.no_estimate,
         jsonb_build_object('series_id', i.series_id, 'occurrence_date', i.occurrence_date)
    from private.pf_items(p_user, p_from, p_to) i left join public.pf_categories c on c.id = i.category_id
   where i.source = 'virtual' and i.kind = 'expense';
end $$;
revoke all on function private.pf_cost_rows(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- custo de vida (ano-calendário ou próximos 12 meses)
create or replace function private.pf_living_cost(p_user uuid, p_mode text, p_ref date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.pf_today(); v_from date; v_to date; v_cur date := date_trunc('month', private.pf_today())::date; v_months jsonb; v_n int; v_real bigint; v_com bigint; v_var bigint; v_top bigint;
  v_no_est int; v_budgets int; v_dest bigint; v_inc bigint; v_sug jsonb; v_ess bigint; v_total bigint; v_incomplete jsonb := '[]'::jsonb; v_hasvar boolean;
begin
  if p_mode = 'calendar' then v_from := make_date(extract(year from coalesce(p_ref, v_today))::int, 1, 1); v_to := make_date(extract(year from coalesce(p_ref, v_today))::int, 12, 31);
  elsif p_mode = 'next12' then v_from := v_cur; v_to := (v_cur + interval '12 months - 1 day')::date;
  else raise exception 'modo inválido (calendar ou next12)'; end if;
  v_n := 12;
  -- tudo em uma consulta (sem tabelas temporárias): linhas de custo, sobra do orçamento por categoria (só mês atual e futuros) e agregação por mês
  with cr as (select * from private.pf_cost_rows(p_user, v_from, v_to)),
  tops as (select b.month, greatest(b.amount_cents - coalesce((select sum(r.amount_cents) from cr r where r.month = b.month and (r.category_id = b.category_id or r.parent_id = b.category_id)), 0), 0) amt
             from public.pf_budgets b where b.owner_user_id = p_user and b.month between v_from and v_to and b.month >= v_cur),
  mm as (select g::date m from generate_series(v_from, v_to, interval '1 month') g),
  agg as (select mm.m, coalesce(sum(cr.amount_cents) filter (where cr.bucket = 'realized'), 0) real, coalesce(sum(cr.amount_cents) filter (where cr.bucket = 'committed'), 0) com,
                 coalesce(sum(cr.amount_cents) filter (where cr.bucket = 'variable'), 0) var from mm left join cr on cr.month = mm.m group by mm.m),
  tp as (select month, sum(amt) top from tops group by month)
  select (select jsonb_agg(jsonb_build_object('month', a.m, 'realized_cents', a.real, 'committed_cents', a.com, 'variable_cents', a.var + coalesce(t.top, 0), 'budget_topup_cents', coalesce(t.top, 0),
             'total_cents', a.real + a.com + a.var + coalesce(t.top, 0)) order by a.m) from agg a left join tp t on t.month = a.m),
         (select coalesce(sum(amount_cents), 0) from cr where essential), exists (select 1 from cr where bucket = 'variable')
    into v_months, v_ess, v_hasvar;
  select coalesce(sum((x ->> 'realized_cents')::bigint), 0), coalesce(sum((x ->> 'committed_cents')::bigint), 0), coalesce(sum((x ->> 'variable_cents')::bigint), 0), coalesce(sum((x ->> 'budget_topup_cents')::bigint), 0), coalesce(sum((x ->> 'total_cents')::bigint), 0)
    into v_real, v_com, v_var, v_top, v_total from jsonb_array_elements(v_months) x;
  select count(*) into v_no_est from public.pf_series s where s.owner_user_id = p_user and s.kind = 'expense' and s.nature = 'variable' and s.status <> 'ended' and s.amount_cents is null and not exists (select 1 from private.pf_series_suggest(s.root_id));
  select count(*) into v_budgets from public.pf_budgets b where b.owner_user_id = p_user and b.month between v_from and v_to and b.amount_cents > 0;
  select coalesce(jsonb_agg(jsonb_build_object('series_id', s.id, 'description', s.description, 'suggested_cents', sg.cents, 'based_on', sg.n)), '[]'::jsonb) into v_sug
    from public.pf_series s cross join lateral private.pf_series_suggest(s.root_id) sg where s.owner_user_id = p_user and s.kind = 'expense' and s.nature = 'variable' and s.status <> 'ended' and s.amount_cents is null;
  if v_no_est > 0 then v_incomplete := v_incomplete || to_jsonb(format('%s recorrência(s) variável(eis) sem estimativa e sem histórico: o valor delas ainda não entra na projeção', v_no_est)); end if;
  if v_budgets = 0 and not v_hasvar then v_incomplete := v_incomplete || to_jsonb('Sem base para projetar gastos variáveis: cadastre o orçamento por categoria ou estimativas nas recorrências variáveis'::text); end if;
  select coalesce(sum(g.monthly_contribution_cents), 0) into v_dest from public.pf_goals g where g.owner_user_id = p_user and g.active;
  select coalesce(sum(k.amount_cents), 0) into v_inc from private.pf_kpi_rows(p_user, 'income_received', v_from, least(v_to, v_today)) k;
  select v_inc + coalesce(sum(k.amount_cents), 0) into v_inc from private.pf_kpi_rows(p_user, 'income_expected', greatest(v_from, v_today), v_to) k;
  return jsonb_build_object('mode', p_mode, 'from', v_from, 'to', v_to, 'months', v_months, 'realized_cents', v_real, 'committed_cents', v_com, 'variable_cents', v_var, 'budget_topup_cents', v_top,
    'projected_total_cents', v_total, 'months_count', v_n, 'monthly_average_cents', round(v_total::numeric / v_n)::bigint, 'essential_cents', v_ess,
    'destinations_monthly_cents', v_dest, 'cash_need_total_cents', v_total + v_dest * v_n, 'monthly_cash_need_cents', round(v_total::numeric / v_n)::bigint + v_dest,
    'income_total_cents', v_inc, 'income_monthly_average_cents', round(v_inc::numeric / v_n)::bigint, 'incomplete', jsonb_array_length(v_incomplete) > 0, 'incomplete_reasons', v_incomplete, 'suggestions', v_sug,
    'sources', jsonb_build_object('realized', 'pagamentos efetivos e compras no cartão até hoje', 'committed', 'saldo a pagar de lançamentos, parcelas futuras e recorrências fixas calculadas', 'variable', 'estimativas (manuais ou média dos últimos valores reais) e sobra do orçamento por categoria'));
end $$;
revoke all on function private.pf_living_cost(uuid, text, date) from public, anon, authenticated;

create or replace function public.pf_living_cost(p_mode text default 'next12', p_ref date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require();
begin return private.pf_living_cost(v_user, p_mode, p_ref); end $$;
revoke all on function public.pf_living_cost(text, date) from public, anon;
grant execute on function public.pf_living_cost(text, date) to authenticated;

-- ---------------------------------------------------------------- visão geral: KPIs com fórmula, base e disponibilidade
create or replace function private.pf_monthly_equiv(p_freq text, p_cents bigint) returns numeric
language sql immutable set search_path = '' as $$
  select p_cents * case p_freq when 'weekly' then 52.0 / 12 when 'biweekly' then 26.0 / 12 when 'semimonthly' then 2 when 'monthly' then 1 when 'quarterly' then 1.0 / 3 when 'semiannual' then 1.0 / 6 when 'annual' then 1.0 / 12 end
$$;

create or replace function public.pf_overview(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := private.pf_require(); v_today date := private.pf_today(); v_cur date := date_trunc('month', private.pf_today())::date; v_mfrom date := date_trunc('month', coalesce(p_to, private.pf_today()))::date; v_mto date;
  v_rec bigint; v_inc_exp bigint; v_exp_real bigint; v_exp_exp bigint; v_bal bigint; v_over bigint; v_d7 bigint; v_d30 bigint; v_inv bigint; v_fix bigint; v_var bigint; v_hor date; v_proj bigint; v_in_h bigint; v_out_h bigint;
  v_rc numeric; v_rn int; v_rno int; v_lc jsonb; v_lcy jsonb; v_bud bigint; v_spent bigint; v_incref bigint; v_fixm bigint; v_reserve bigint; v_avg bigint; v_goal jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'período inválido'; end if;
  v_mto := (v_mfrom + interval '1 month - 1 day')::date;
  select coalesce(sum(amount_cents), 0) into v_rec from private.pf_kpi_rows(v_user, 'income_received', p_from, p_to);
  select coalesce(sum(amount_cents), 0) into v_inc_exp from private.pf_kpi_rows(v_user, 'income_expected', p_from, p_to);
  select coalesce(sum(amount_cents), 0) into v_exp_real from private.pf_kpi_rows(v_user, 'expense_realized', p_from, p_to);
  select coalesce(sum(amount_cents), 0) into v_exp_exp from private.pf_kpi_rows(v_user, 'expense_expected', p_from, p_to);
  select coalesce(sum(private.pf_balance(a.id, v_today)), 0) into v_bal from public.pf_accounts a where a.owner_user_id = v_user and a.active;
  select coalesce(sum(amount_cents), 0) into v_over from private.pf_kpi_rows(v_user, 'overdue', p_from, p_to);
  select coalesce(sum(amount_cents), 0) into v_d7 from private.pf_kpi_rows(v_user, 'due7', p_from, p_to);
  select coalesce(sum(amount_cents), 0) into v_d30 from private.pf_kpi_rows(v_user, 'due30', p_from, p_to);
  select coalesce(sum(amount_cents), 0) into v_inv from private.pf_kpi_rows(v_user, 'invoices_next', p_from, p_to);
  select coalesce(sum(k.amount_cents) filter (where k.nature = 'fixed'), 0), coalesce(sum(k.amount_cents) filter (where k.nature = 'variable'), 0)
    into v_fix, v_var from (select * from private.pf_kpi_rows(v_user, 'expense_realized', p_from, p_to) union all select * from private.pf_kpi_rows(v_user, 'expense_expected', p_from, p_to)) k;
  -- saldo projetado: saldo de hoje + entradas previstas − saídas comprometidas (inclui vencidas e faturas) até o fim do período (ou +30 dias)
  v_hor := greatest(p_to, v_today + 30);
  select coalesce(sum(i.cash_in), 0), coalesce(sum(i.cash_out), 0) into v_in_h, v_out_h from private.pf_items(v_user, date '1900-01-01', v_hor) i where i.cash_date <= v_hor and (i.cash_in > 0 or i.cash_out > 0);
  v_proj := v_bal + v_in_h - v_out_h;
  -- recorrências (equivalente mensal)
  select coalesce(sum(private.pf_monthly_equiv(s.frequency, s.amount_cents)), 0), count(*) filter (where s.amount_cents is not null), count(*) filter (where s.amount_cents is null)
    into v_rc, v_rn, v_rno from public.pf_series s where s.owner_user_id = v_user and s.kind = 'expense' and s.status = 'active';
  v_lc := private.pf_living_cost(v_user, 'next12', null); v_lcy := private.pf_living_cost(v_user, 'calendar', p_to);
  -- orçamento do mês de referência (mês de p_to)
  select coalesce(sum(b.amount_cents), 0) into v_bud from public.pf_budgets b where b.owner_user_id = v_user and b.month = v_mfrom and b.amount_cents > 0;
  select coalesce(sum(r.amount_cents), 0) into v_spent from private.pf_cost_rows(v_user, v_mfrom, v_mto) r where r.bucket in ('realized','committed')
     and exists (select 1 from public.pf_budgets b where b.owner_user_id = v_user and b.month = v_mfrom and b.amount_cents > 0 and (b.category_id = r.category_id or b.category_id = r.parent_id));
  -- comprometimento da renda: despesas fixas do mês ÷ renda de referência (recebida no mês; se zero, prevista)
  select coalesce(sum(k.amount_cents), 0) into v_fixm from (select * from private.pf_kpi_rows(v_user, 'expense_realized', v_mfrom, v_mto) union all select * from private.pf_kpi_rows(v_user, 'expense_expected', v_mfrom, v_mto)) k where k.nature = 'fixed';
  select coalesce(sum(amount_cents), 0) into v_incref from private.pf_kpi_rows(v_user, 'income_received', v_mfrom, v_mto);
  if v_incref = 0 then select coalesce(sum(amount_cents), 0) into v_incref from private.pf_kpi_rows(v_user, 'income_expected', v_mfrom, v_mto); end if;
  select coalesce(sum(greatest(private.pf_balance(a.id, v_today), 0)), 0) into v_reserve from public.pf_accounts a where a.owner_user_id = v_user and a.active and a.counts_for_reserve;
  v_avg := (v_lc ->> 'monthly_average_cents')::bigint;
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'target_cents', g.target_cents, 'progress_cents', case when g.account_id is not null then greatest(private.pf_balance(g.account_id, v_today), 0)
         else coalesce((select sum(t.amount_cents) from public.pf_transfers t where t.goal_id = g.id and t.voided_at is null), 0) end)), '[]'::jsonb) into v_goal from public.pf_goals g where g.owner_user_id = v_user and g.active;

  return jsonb_build_object('from', p_from, 'to', p_to, 'today', v_today, 'reference_month', v_mfrom,
    'income_received', jsonb_build_object('value', v_rec, 'available', true, 'formula', 'soma dos recebimentos efetivos com data no período', 'detail', 'income_received'),
    'income_expected', jsonb_build_object('value', v_inc_exp, 'available', true, 'formula', 'saldo a receber com vencimento no período + ocorrências futuras calculadas', 'detail', 'income_expected'),
    'expense_realized', jsonb_build_object('value', v_exp_real, 'available', true, 'formula', 'pagamentos efetivos no período + compras no cartão (por data da compra, até hoje); o pagamento da fatura não conta', 'detail', 'expense_realized'),
    'expense_expected', jsonb_build_object('value', v_exp_exp, 'available', true, 'formula', 'saldo a pagar com vencimento no período + ocorrências futuras + compras/parcelas do cartão com data futura', 'detail', 'expense_expected'),
    'result_realized', jsonb_build_object('value', v_rec - v_exp_real, 'available', true, 'formula', 'receitas recebidas − despesas realizadas', 'detail', null),
    'account_balance', jsonb_build_object('value', v_bal, 'available', exists (select 1 from public.pf_accounts where owner_user_id = v_user and active), 'basis', 'cadastre uma conta para ver o saldo', 'formula', 'saldo inicial + recebimentos − pagamentos ± transferências − faturas pagas, de cada conta ativa (limite de cartão nunca entra)', 'detail', null),
    'projected_balance', jsonb_build_object('value', v_proj, 'available', true, 'horizon', v_hor, 'formula', 'saldo das contas hoje + entradas previstas − saídas comprometidas (inclui vencidas, faturas e ocorrências calculadas) até a data-limite', 'detail', null),
    'overdue', jsonb_build_object('value', v_over, 'available', true, 'formula', 'saldo a pagar de contas e faturas com vencimento anterior a hoje', 'detail', 'overdue'),
    'due7', jsonb_build_object('value', v_d7, 'available', true, 'formula', 'saídas (contas, faturas, ocorrências) com vencimento de hoje até 7 dias', 'detail', 'due7'),
    'due30', jsonb_build_object('value', v_d30, 'available', true, 'formula', 'saídas com vencimento de hoje até 30 dias', 'detail', 'due30'),
    'invoices_next', jsonb_build_object('value', v_inv, 'available', true, 'formula', 'saldo em aberto de todas as faturas de cartão (atual e próximas)', 'detail', 'invoices_next'),
    'fixed_expense', jsonb_build_object('value', v_fix, 'available', true, 'formula', 'despesas realizadas + previstas do período com comportamento FIXO', 'detail', 'fixed'),
    'variable_expense', jsonb_build_object('value', v_var, 'available', true, 'formula', 'despesas realizadas + previstas do período com comportamento VARIÁVEL', 'detail', 'variable'),
    'recurring_commitments', jsonb_build_object('value', round(v_rc)::bigint, 'available', v_rn > 0, 'count', v_rn, 'without_value', v_rno, 'basis', 'nenhuma recorrência de despesa ativa', 'formula', 'soma do equivalente mensal das recorrências de despesa ativas (semanal×52/12, quinzenal×26/12, duas vezes por mês×2, trimestral÷3, semestral÷6, anual÷12)', 'detail', null),
    'living_cost_monthly', jsonb_build_object('value', v_avg, 'available', (v_lc ->> 'projected_total_cents')::bigint > 0, 'incomplete', v_lc -> 'incomplete', 'basis', 'Sem base para cálculo', 'formula', 'média mensal do custo de vida projetado dos próximos 12 meses (realizado + compromissos + variáveis)', 'detail', null),
    'living_cost_year', jsonb_build_object('value', (v_lcy ->> 'projected_total_cents')::bigint, 'available', (v_lcy ->> 'projected_total_cents')::bigint > 0, 'incomplete', v_lcy -> 'incomplete', 'basis', 'Sem base para cálculo', 'formula', 'realizado + compromissos + variáveis projetados de janeiro a dezembro do ano do período', 'detail', null),
    'budget_used_pct', jsonb_build_object('value', case when v_bud > 0 then round(v_spent * 100.0 / v_bud, 1) end, 'available', v_bud > 0, 'budget_cents', v_bud, 'spent_cents', v_spent, 'basis', 'Sem base para cálculo (defina o orçamento do mês)', 'formula', '(realizado + compromissos nas categorias com orçamento) ÷ total orçado do mês de referência', 'detail', null),
    'income_commitment_pct', jsonb_build_object('value', case when v_incref > 0 then round(v_fixm * 100.0 / v_incref, 1) end, 'available', v_incref > 0, 'fixed_cents', v_fixm, 'income_cents', v_incref, 'basis', 'Sem base para cálculo (sem renda no mês)', 'formula', 'despesas FIXAS do mês de referência ÷ renda do mês (recebida; se ainda não houve, a prevista)', 'detail', null),
    'reserve', jsonb_build_object('value', v_reserve, 'available', exists (select 1 from public.pf_accounts where owner_user_id = v_user and active and counts_for_reserve), 'basis', 'Marque as contas que compõem a reserva', 'formula', 'soma dos saldos das contas marcadas como reserva (limite de crédito e renda prevista não entram)', 'detail', null),
    'reserve_coverage_months', jsonb_build_object('value', case when v_avg > 0 then round(v_reserve::numeric / v_avg, 1) end, 'available', v_avg > 0 and exists (select 1 from public.pf_accounts where owner_user_id = v_user and active and counts_for_reserve), 'basis', 'Sem base para cálculo', 'formula', 'reserva disponível ÷ custo de vida mensal projetado', 'detail', null),
    'goals', jsonb_build_object('items', v_goal, 'available', jsonb_array_length(v_goal) > 0, 'formula', 'progresso = saldo da conta da meta (se houver) ou soma dos aportes à meta; % = progresso ÷ valor-alvo'));
end $$;
revoke all on function public.pf_overview(date, date) from public, anon;
grant execute on function public.pf_overview(date, date) to authenticated;

-- ---------------------------------------------------------------- fluxo de caixa projetado (por mês) e gráficos
create or replace function public.pf_cashflow(p_months int default 12) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_today date := private.pf_today(); v_cur date := date_trunc('month', private.pf_today())::date; v_n int := least(greatest(coalesce(p_months, 12), 1), 24); v_bal bigint; v_run bigint; v_out jsonb := '[]'::jsonb; m date; i int;
        v_in bigint; v_ou bigint; v_to date;
begin
  select coalesce(sum(private.pf_balance(a.id, v_today)), 0) into v_bal from public.pf_accounts a where a.owner_user_id = v_user and a.active; v_run := v_bal;
  -- vencidas (já passaram da data) entram no primeiro mês
  for i in 0..v_n - 1 loop
    m := (v_cur + make_interval(months => i))::date; v_to := (m + interval '1 month - 1 day')::date;
    select coalesce(sum(x.cash_in), 0), coalesce(sum(x.cash_out), 0) into v_in, v_ou from private.pf_items(v_user, case when i = 0 then date '1900-01-01' else m end, v_to) x
      where x.cash_date <= v_to and x.cash_date >= (case when i = 0 then date '1900-01-01' else m end) and (x.cash_in > 0 or x.cash_out > 0);
    v_run := v_run + v_in - v_ou;
    v_out := v_out || jsonb_build_object('month', m, 'inflow_cents', v_in, 'outflow_cents', v_ou, 'balance_cents', v_run);
  end loop;
  return jsonb_build_object('start_balance_cents', v_bal, 'months', v_out, 'note', 'saídas incluem faturas de cartão e ocorrências calculadas; compras no cartão não são saída de caixa (a saída é a fatura)');
end $$;
revoke all on function public.pf_cashflow(int) from public, anon;
grant execute on function public.pf_cashflow(int) to authenticated;

create or replace function public.pf_charts(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_today date := private.pf_today(); v_months jsonb; v_cat jsonb; v_nat jsonb; v_bud jsonb; v_res jsonb; v_growth jsonb; v_len int := (p_to - p_from + 1); v_pf date; v_pt date; v_mfrom date := date_trunc('month', p_to)::date;
begin
  if p_to < p_from then raise exception 'período inválido'; end if;
  -- receitas × despesas realizadas, por mês, nos 12 meses até o fim do período
  select jsonb_agg(jsonb_build_object('month', mm, 'income_cents', coalesce((select sum(k.amount_cents) from private.pf_kpi_rows(v_user, 'income_received', mm, (mm + interval '1 month - 1 day')::date) k), 0),
                    'expense_cents', coalesce((select sum(k.amount_cents) from private.pf_kpi_rows(v_user, 'expense_realized', mm, (mm + interval '1 month - 1 day')::date) k), 0)) order by mm)
    into v_months from generate_series((date_trunc('month', p_to) - interval '11 months')::date, date_trunc('month', p_to)::date, interval '1 month') g(mm0), lateral (select mm0::date mm) q;
  -- gastos por categoria (realizados no período)
  select coalesce(jsonb_agg(x order by (x ->> 'cents')::bigint desc), '[]'::jsonb) into v_cat from (
    select jsonb_build_object('category', coalesce(k.category_name, 'Sem categoria'), 'cents', sum(k.amount_cents)) x from private.pf_kpi_rows(v_user, 'expense_realized', p_from, p_to) k group by coalesce(k.category_name, 'Sem categoria')) q;
  select jsonb_build_object('fixed_cents', coalesce(sum(k.amount_cents) filter (where k.nature = 'fixed'), 0), 'variable_cents', coalesce(sum(k.amount_cents) filter (where k.nature = 'variable'), 0))
    into v_nat from (select * from private.pf_kpi_rows(v_user, 'expense_realized', p_from, p_to) union all select * from private.pf_kpi_rows(v_user, 'expense_expected', p_from, p_to)) k;
  -- orçado × realizado (mês do fim do período)
  select coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'budget_cents', b.amount_cents,
           'realized_cents', coalesce((select sum(r.amount_cents) from private.pf_cost_rows(v_user, v_mfrom, (v_mfrom + interval '1 month - 1 day')::date) r where r.bucket = 'realized' and (r.category_id = b.category_id or r.parent_id = b.category_id)), 0)) order by c.name), '[]'::jsonb)
    into v_bud from public.pf_budgets b join public.pf_categories c on c.id = b.category_id where b.owner_user_id = v_user and b.month = v_mfrom;
  -- evolução da reserva (saldo das contas de reserva no fim de cada um dos 12 meses)
  select jsonb_agg(jsonb_build_object('month', mm, 'reserve_cents', coalesce((select sum(private.pf_balance(a.id, least((mm + interval '1 month - 1 day')::date, v_today))) from public.pf_accounts a where a.owner_user_id = v_user and a.counts_for_reserve), 0)) order by mm)
    into v_res from generate_series((date_trunc('month', p_to) - interval '11 months')::date, date_trunc('month', p_to)::date, interval '1 month') g(mm0), lateral (select mm0::date mm) q;
  -- categorias que mais aumentaram: período × período anterior de mesmo tamanho (só com base válida: anterior > 0)
  v_pt := p_from - 1; v_pf := p_from - v_len;
  select coalesce(jsonb_agg(x order by (x ->> 'delta_cents')::bigint desc), '[]'::jsonb) into v_growth from (
    select jsonb_build_object('category', cur.cat, 'current_cents', cur.cents, 'previous_cents', prev.cents, 'delta_cents', cur.cents - prev.cents, 'delta_pct', round((cur.cents - prev.cents) * 100.0 / prev.cents, 1)) x
      from (select coalesce(k.category_name, 'Sem categoria') cat, sum(k.amount_cents) cents from private.pf_kpi_rows(v_user, 'expense_realized', p_from, p_to) k group by 1) cur
      join (select coalesce(k.category_name, 'Sem categoria') cat, sum(k.amount_cents) cents from private.pf_kpi_rows(v_user, 'expense_realized', v_pf, v_pt) k group by 1) prev on prev.cat = cur.cat
     where prev.cents > 0 and cur.cents > prev.cents) q;
  return jsonb_build_object('by_month', coalesce(v_months, '[]'::jsonb), 'by_category', v_cat, 'fixed_vs_variable', v_nat, 'budget_vs_actual', v_bud, 'reserve_evolution', coalesce(v_res, '[]'::jsonb), 'category_growth', v_growth,
    'projected_12', (private.pf_living_cost(v_user, 'next12', null) -> 'months'), 'growth_note', 'compara o período com o anterior de mesmo tamanho; só categorias com valor no período anterior');
end $$;
revoke all on function public.pf_charts(date, date) from public, anon;
grant execute on function public.pf_charts(date, date) to authenticated;

-- ---------------------------------------------------------------- recorrências (lista para gerenciar)
create or replace function public.pf_series_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_today date := private.pf_today();
begin
  return jsonb_build_object('series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'root_id', s.root_id, 'kind', s.kind, 'description', s.description, 'category_id', s.category_id, 'account_id', s.account_id, 'card_id', s.card_id,
      'nature', s.nature, 'frequency', s.frequency, 'start_date', s.start_date, 'due_day', s.due_day, 'due_day2', s.due_day2, 'end_mode', s.end_mode, 'end_date', s.end_date, 'end_count', s.end_count, 'amount_cents', s.amount_cents,
      'is_estimate', s.is_estimate, 'status', s.status, 'ended_on', s.ended_on, 'essential', s.essential,
      'monthly_equivalent_cents', case when s.amount_cents is not null then round(private.pf_monthly_equiv(s.frequency, s.amount_cents))::bigint end,
      'next_dates', (select coalesce(jsonb_agg(o.occ_date order by o.occ_date), '[]'::jsonb) from (select occ_date from private.pf_occurrences(s.id, v_today, v_today + 800) order by occ_date limit 3) o),
      'remaining', case when s.end_mode = 'count' then (select count(*) from private.pf_occurrences(s.id, v_today, v_today + 36500)) end) order by s.status, s.description)
    from public.pf_series s where s.owner_user_id = v_user and (s.status <> 'ended' or s.ended_on >= v_today - 365)), '[]'::jsonb));
end $$;
revoke all on function public.pf_series_list() from public, anon;
grant execute on function public.pf_series_list() to authenticated;

-- ---------------------------------------------------------------- orçamento, planejamento do próximo mês, reserva e metas
create or replace function public.pf_budget_set(p_month date, p_category uuid, p_amount_cents bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); v_m date := date_trunc('month', p_month)::date;
begin
  if not exists (select 1 from public.pf_categories where id = p_category and owner_user_id = v_user and kind = 'expense') then raise exception 'categoria de despesa inválida'; end if;
  if p_amount_cents is null then delete from public.pf_budgets where owner_user_id = v_user and month = v_m and category_id = p_category; return; end if;
  if p_amount_cents < 0 then raise exception 'o orçamento não pode ser negativo'; end if;
  insert into public.pf_budgets (org_id, owner_user_id, month, category_id, amount_cents) values (v_org, v_user, v_m, p_category, p_amount_cents)
    on conflict (owner_user_id, month, category_id) do update set amount_cents = excluded.amount_cents;
end $$;
revoke all on function public.pf_budget_set(date, uuid, bigint) from public, anon;
grant execute on function public.pf_budget_set(date, uuid, bigint) to authenticated;

create or replace function public.pf_budget_list(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_m date := date_trunc('month', p_month)::date; v_e date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  return jsonb_build_object('month', v_m, 'rows', coalesce((select jsonb_agg(jsonb_build_object('category_id', c.id, 'name', c.name, 'parent_id', c.parent_id, 'budget_cents', b.amount_cents,
        'realized_cents', coalesce((select sum(r.amount_cents) from private.pf_cost_rows(v_user, v_m, v_e) r where r.bucket = 'realized' and (r.category_id = c.id or r.parent_id = c.id)), 0),
        'committed_cents', coalesce((select sum(r.amount_cents) from private.pf_cost_rows(v_user, v_m, v_e) r where r.bucket = 'committed' and (r.category_id = c.id or r.parent_id = c.id)), 0),
        'variable_cents', coalesce((select sum(r.amount_cents) from private.pf_cost_rows(v_user, v_m, v_e) r where r.bucket = 'variable' and (r.category_id = c.id or r.parent_id = c.id)), 0)) order by c.name)
      from public.pf_categories c left join public.pf_budgets b on b.category_id = c.id and b.month = v_m and b.owner_user_id = v_user
      where c.owner_user_id = v_user and c.kind = 'expense' and c.parent_id is null and c.active), '[]'::jsonb));
end $$;
revoke all on function public.pf_budget_list(date) from public, anon;
grant execute on function public.pf_budget_list(date) to authenticated;

-- "Planejar o próximo mês com a renda recebida neste mês": renda de referência ≠ saldo disponível
create or replace function public.pf_plan_month(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_today date := private.pf_today(); v_t date := date_trunc('month', p_month)::date; v_te date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_pf date := (date_trunc('month', p_month) - interval '1 month')::date; v_pe date := (date_trunc('month', p_month) - interval '1 day')::date; v_flag boolean; v_ref bigint; v_refmode text; v_com bigint; v_var bigint; v_contrib bigint; v_bud bigint; v_liquid bigint;
begin
  select plan_next_month_with_income into v_flag from public.pf_settings where owner_user_id = v_user; v_flag := coalesce(v_flag, false);
  if v_flag then
    select coalesce(sum(amount_cents), 0) into v_ref from private.pf_kpi_rows(v_user, 'income_received', v_pf, v_pe); v_refmode := 'renda recebida no mês anterior (' || to_char(v_pf, 'MM/YYYY') || ')';
  else
    select coalesce(sum(amount_cents), 0) into v_ref from (select amount_cents from private.pf_kpi_rows(v_user, 'income_received', v_t, v_te) union all select amount_cents from private.pf_kpi_rows(v_user, 'income_expected', greatest(v_t, v_today), v_te)) k;
    v_refmode := 'renda recebida e prevista no próprio mês (' || to_char(v_t, 'MM/YYYY') || ')';
  end if;
  select coalesce(sum(amount_cents) filter (where bucket in ('realized','committed')), 0), coalesce(sum(amount_cents) filter (where bucket = 'variable'), 0) into v_com, v_var from private.pf_cost_rows(v_user, v_t, v_te);
  select coalesce(sum(monthly_contribution_cents), 0) into v_contrib from public.pf_goals where owner_user_id = v_user and active;
  select coalesce(sum(amount_cents), 0) into v_bud from public.pf_budgets where owner_user_id = v_user and month = v_t;
  select coalesce(sum(private.pf_balance(a.id, v_today)), 0) into v_liquid from public.pf_accounts a where a.owner_user_id = v_user and a.active and not a.counts_for_reserve and a.kind <> 'investment';
  return jsonb_build_object('month', v_t, 'plan_with_previous_month_income', v_flag, 'reference_income_cents', v_ref, 'reference_basis', v_refmode,
    'existing_commitments_cents', v_com, 'variable_estimates_cents', v_var, 'planned_contributions_cents', v_contrib, 'budget_total_cents', v_bud,
    'available_to_allocate_cents', v_ref - v_com - v_var - v_contrib, 'liquid_balance_now_cents', v_liquid,
    'note', 'a renda de referência orienta o orçamento; o saldo disponível é o dinheiro que já está nas contas (sem reserva). Não são a mesma coisa.');
end $$;
revoke all on function public.pf_plan_month(date) from public, anon;
grant execute on function public.pf_plan_month(date) to authenticated;

create or replace function public.pf_goal_contribute(p_goal uuid, p_from uuid, p_to uuid, p_amount_cents bigint, p_date date, p_key text default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.pf_transfer_create(p_from, p_to, p_amount_cents, p_date, 'goal', p_goal, null, p_key) $$;
revoke all on function public.pf_goal_contribute(uuid, uuid, uuid, bigint, date, text) from public, anon;
grant execute on function public.pf_goal_contribute(uuid, uuid, uuid, bigint, date, text) to authenticated;

-- movimentações (transferências e aportes) para listar
create or replace function public.pf_transfers_list(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require();
begin
  return jsonb_build_object('transfers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'on_date', t.on_date, 'amount_cents', t.amount_cents, 'kind', t.kind, 'from', fa.name, 'to', ta.name, 'goal_id', t.goal_id, 'note', t.note, 'voided', t.voided_at is not null) order by t.on_date desc)
    from public.pf_transfers t join public.pf_accounts fa on fa.id = t.from_account_id join public.pf_accounts ta on ta.id = t.to_account_id where t.owner_user_id = v_user and t.on_date between p_from and p_to), '[]'::jsonb));
end $$;
revoke all on function public.pf_transfers_list(date, date) from public, anon;
grant execute on function public.pf_transfers_list(date, date) to authenticated;

-- ---------------------------------------------------------------- lembretes privados (sem repetir para a mesma ocorrência)
create or replace function public.pf_reminders_due() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_today date := private.pf_today(); v_days int; v_rows jsonb;
begin
  select coalesce((select reminder_days_before from public.pf_settings where owner_user_id = v_user), 3) into v_days;
  select coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'description', i.description, 'kind', i.kind, 'due_date', i.cash_date, 'amount_cents', greatest(i.cash_in, i.cash_out), 'source', i.source, 'days_left', i.cash_date - v_today,
           'entry_id', i.entry_id, 'series_id', i.series_id, 'occurrence_date', i.occurrence_date, 'invoice_id', i.invoice_id) order by i.cash_date), '[]'::jsonb) into v_rows
    from private.pf_items(v_user, v_today - 45, v_today + v_days) i
   where i.cash_date between v_today and v_today + v_days and (i.cash_in > 0 or i.cash_out > 0) and not exists (select 1 from public.pf_reminder_acks a where a.owner_user_id = v_user and a.occurrence_key = i.key);
  return jsonb_build_object('days_before', v_days, 'reminders', v_rows);
end $$;
revoke all on function public.pf_reminders_due() from public, anon;
grant execute on function public.pf_reminders_due() to authenticated;

create or replace function public.pf_reminder_ack(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require();
begin
  if length(coalesce(p_key, '')) < 3 then raise exception 'lembrete inválido'; end if;
  insert into public.pf_reminder_acks (owner_user_id, occurrence_key) values (v_user, p_key) on conflict do nothing;
end $$;
revoke all on function public.pf_reminder_ack(text) from public, anon;
grant execute on function public.pf_reminder_ack(text) to authenticated;
