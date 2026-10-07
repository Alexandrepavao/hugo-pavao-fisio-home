-- Edição de cartões corporativos: limite, dia de fechamento e dia de vencimento (com auditoria e motivo).
-- Regra central: FATURAS JÁ EXISTENTES NUNCA MUDAM. Cada fatura guarda o próprio ciclo, fechamento e vencimento (card_invoices) e as despesas das compras já
-- carregam o vencimento da fatura; mudar os dias do cartão só vale para faturas que ainda não existem (compras cuja data não cai em nenhuma fatura já criada).
-- Aditiva: 1 função privada nova, 1 função pública nova (card_update) e redefinição de card_purchase_create / card_summary (mesma assinatura) para respeitar a regra.

-- ---------------------------------------------------------------- ciclo de uma data, respeitando as faturas existentes
-- 1) se a data cai no ciclo de uma fatura já criada (aberta, fechada ou paga), vale o ciclo dessa fatura (datas preservadas);
-- 2) senão, calcula pelos dias ATUAIS do cartão e ajusta o início para não sobrepor o fechamento da fatura anterior;
-- overlaps = true quando o ciclo calculado ainda assim invade uma fatura existente (só acontece para compra retroativa depois de mudar os dias).
create or replace function private.card_cycle_for(p_card uuid, p_date date)
returns table (cycle_start date, closing_date date, due_date date, invoice_id uuid, overlaps boolean)
language plpgsql stable security definer set search_path = '' as $$
declare inv public.card_invoices; c public.corporate_cards; cyc record; v_prev date; v_start date;
begin
  select * into inv from public.card_invoices i where i.card_id = p_card and p_date between i.cycle_start and i.closing_date order by i.closing_date limit 1;
  if found then
    return query select inv.cycle_start, inv.closing_date, inv.due_date, inv.id, false; return;
  end if;
  select * into c from public.corporate_cards where id = p_card;
  select * into cyc from private.card_cycle(c.closing_day, c.due_day, p_date);
  select max(i.closing_date) into v_prev from public.card_invoices i where i.card_id = p_card and i.closing_date < cyc.closing_date;
  v_start := greatest(cyc.cycle_start, coalesce(v_prev + 1, cyc.cycle_start));
  return query select v_start, cyc.closing_date, cyc.due_date, null::uuid,
    exists (select 1 from public.card_invoices i where i.card_id = p_card and i.closing_date >= v_start and i.cycle_start <= cyc.closing_date and i.closing_date <> cyc.closing_date);
end $$;
revoke all on function private.card_cycle_for(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- compra: usa o ciclo existente quando houver
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
  select * into cyc from private.card_cycle_for(c.id, p_date);
  if cyc.overlaps then
    raise exception 'esta data cai em um período já coberto por faturas criadas com os dias anteriores do cartão (fechamento/vencimento foram alterados): use uma data posterior ao último fechamento';
  end if;
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

-- ---------------------------------------------------------------- resumo: o ciclo "atual" também respeita a fatura existente
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
    cross join lateral private.card_cycle_for(c.id, private.card_today()) cy
    where c.org_id = private.current_org() and private.can_finance(c.unit_id) and (p_unit is null or c.unit_id = p_unit)
  ) x
$$;

-- ---------------------------------------------------------------- edição (limite, fechamento, vencimento)
-- Sempre com motivo. Regras: o novo limite não pode ficar abaixo do que já está em aberto no cartão (compras de faturas abertas e fechadas sem pagamento);
-- fechamento/vencimento entre 1 e 28; ao menos um campo precisa mudar. Não mexe em nenhuma fatura, compra ou despesa existente.
-- Retorna o que mudou e a partir de quando os novos dias valem (primeira data depois do último fechamento já faturado).
create or replace function public.card_update(p_card uuid, p_limit_cents bigint, p_closing_day int, p_due_day int, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.corporate_cards; v_unpaid bigint; v_last date; v_old jsonb := '{}'::jsonb; v_new jsonb := '{}'::jsonb; v_cols text[] := '{}'; v_from date;
begin
  select * into c from public.corporate_cards where id = p_card and org_id = private.current_org() for update;
  if not found or not private.can_finance(c.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo da alteração'; end if;
  if p_limit_cents is null or p_limit_cents <= 0 then raise exception 'o limite precisa ser maior que zero'; end if;
  if p_closing_day is null or p_due_day is null or p_closing_day not between 1 and 28 or p_due_day not between 1 and 28 then raise exception 'fechamento e vencimento precisam estar entre os dias 1 e 28'; end if;
  if p_limit_cents = c.credit_limit_cents and p_closing_day = c.closing_day and p_due_day = c.due_day then raise exception 'nenhuma alteração: os valores informados são os atuais'; end if;
  select coalesce(sum(b.amount_cents), 0) into v_unpaid from public.card_purchases cp join public.payables b on b.id = cp.payable_id where cp.card_id = c.id and cp.cancelled_at is null and b.status = 'open';
  if p_limit_cents < v_unpaid then
    raise exception 'o limite não pode ficar abaixo do que já está em aberto no cartão (R$ %)', replace(round(v_unpaid / 100.0, 2)::text, '.', ',');
  end if;
  if p_limit_cents <> c.credit_limit_cents then v_cols := array_append(v_cols, 'credit_limit_cents'); v_old := v_old || jsonb_build_object('credit_limit_cents', c.credit_limit_cents); v_new := v_new || jsonb_build_object('credit_limit_cents', p_limit_cents); end if;
  if p_closing_day <> c.closing_day then v_cols := array_append(v_cols, 'closing_day'); v_old := v_old || jsonb_build_object('closing_day', c.closing_day); v_new := v_new || jsonb_build_object('closing_day', p_closing_day); end if;
  if p_due_day <> c.due_day then v_cols := array_append(v_cols, 'due_day'); v_old := v_old || jsonb_build_object('due_day', c.due_day); v_new := v_new || jsonb_build_object('due_day', p_due_day); end if;
  update public.corporate_cards set credit_limit_cents = p_limit_cents, closing_day = p_closing_day, due_day = p_due_day where id = c.id;
  select max(closing_date) into v_last from public.card_invoices where card_id = c.id;
  v_from := case when v_last is null then null else v_last + 1 end;
  -- o gatilho audit_corporate_cards já registra a diferença; este registro acrescenta o MOTIVO e o alcance da mudança
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id, changed_columns, old_values, new_values)
    values (c.org_id, (select auth.uid()), 'update', 'corporate_cards', c.id::text, c.unit_id, v_cols, v_old,
            v_new || jsonb_build_object('reason', btrim(p_reason), 'applies_from', v_from, 'existing_invoices_kept', true));
  return jsonb_build_object('changed', to_jsonb(v_cols), 'applies_from', v_from, 'existing_invoices_kept', true);
end $$;

revoke all on function public.card_update(uuid, bigint, int, int, text), public.card_purchase_create(uuid, date, bigint, text, text, uuid, text, jsonb, text), public.card_summary(uuid) from public, anon;
grant execute on function public.card_update(uuid, bigint, int, int, text), public.card_purchase_create(uuid, date, bigint, text, text, uuid, text, jsonb, text), public.card_summary(uuid) to authenticated;
