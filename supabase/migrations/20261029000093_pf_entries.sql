-- HP Group Hub — 093 Finanças pessoais: lançamentos, recorrências, parcelamentos, liquidações, faturas e transferências (regras financeiras).
-- Convenções (documentadas em docs/financas-pessoais.md):
--  · "fixo × variável" (comportamento do valor) é independente de "avulso × recorrente × parcelado" (repetição).
--  · recorrência = regra (pf_series); ocorrências futuras são CALCULADAS (virtuais) e só viram lançamento quando tocadas; nunca se gera lançamento infinito.
--  · vencimento 29/30/31 em mês menor = último dia do mês (regra explícita `short_month_rule = last_day`).
--  · compra no cartão = UMA despesa (competência = data da compra) + a obrigação da fatura; pagar a fatura liquida a obrigação, nunca cria nova despesa.
--  · transferências entre contas próprias, aportes em reserva/metas e investimentos NÃO são receita nem custo de vida.
--  · reexecutar uma operação com a mesma chave de idempotência nunca duplica lançamento, parcela, recorrência, liquidação, pagamento de fatura ou transferência.

-- ---------------------------------------------------------------- utilidades de data e ciclo de fatura
create or replace function private.pf_add_months(p_date date, p_n int) returns date
language sql immutable set search_path = '' as $$
  select private.pf_clamp_day(extract(year from (date_trunc('month', p_date) + make_interval(months => p_n)))::int, extract(month from (date_trunc('month', p_date) + make_interval(months => p_n)))::int, extract(day from p_date)::int)
$$;

create or replace function private.pf_card_cycle(p_closing int, p_due int, p_date date) returns table (cycle_start date, closing_date date, due_date date)
language sql immutable set search_path = '' as $$
  with c as (select case when extract(day from p_date)::int <= p_closing then make_date(extract(year from p_date)::int, extract(month from p_date)::int, p_closing)
                         else (make_date(extract(year from p_date)::int, extract(month from p_date)::int, p_closing) + interval '1 month')::date end as closing)
  select ((c.closing - interval '1 month')::date + 1), c.closing,
         case when p_due > p_closing then make_date(extract(year from c.closing)::int, extract(month from c.closing)::int, p_due)
              else (make_date(extract(year from c.closing)::int, extract(month from c.closing)::int, p_due) + interval '1 month')::date end
  from c
$$;

-- fatura do ciclo que contém a data (cria se ainda não existir; idempotente)
create or replace function private.pf_invoice_for(p_card uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare k public.pf_cards; cy record; v_id uuid;
begin
  select * into k from public.pf_cards where id = p_card; if not found then raise exception 'cartão não encontrado'; end if;
  select * into cy from private.pf_card_cycle(k.closing_day, k.due_day, p_date);
  insert into public.pf_invoices (org_id, owner_user_id, card_id, cycle_start, closing_date, due_date) values (k.org_id, k.owner_user_id, k.id, cy.cycle_start, cy.closing_date, cy.due_date)
    on conflict (card_id, cycle_start) do nothing;
  select id into v_id from public.pf_invoices where card_id = p_card and cycle_start = cy.cycle_start;
  return v_id;
end $$;
revoke all on function private.pf_invoice_for(uuid, date) from public, anon, authenticated;

create or replace function private.pf_invoice_total(p_invoice uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.pf_entries where invoice_id = p_invoice and status <> 'cancelled'
$$;
create or replace function private.pf_invoice_paid(p_invoice uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.pf_invoice_payments where invoice_id = p_invoice and voided_at is null
$$;

-- a situação das compras do cartão acompanha a fatura: "aberta" até a fatura ser paga por inteiro
create or replace function private.pf_recalc_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_total bigint := private.pf_invoice_total(p_invoice); v_paid bigint := private.pf_invoice_paid(p_invoice); v_on date;
begin
  select max(paid_on) into v_on from public.pf_invoice_payments where invoice_id = p_invoice and voided_at is null;
  if v_total > 0 and v_paid >= v_total then
    update public.pf_entries set status = 'settled', settled_cents = amount_cents, settled_on = v_on where invoice_id = p_invoice and status <> 'cancelled';
  else
    update public.pf_entries set status = case when is_estimate then 'planned' else 'open' end, settled_cents = 0, settled_on = null where invoice_id = p_invoice and status <> 'cancelled';
  end if;
end $$;
revoke all on function private.pf_recalc_invoice(uuid) from public, anon, authenticated;

create or replace function private.pf_recalc_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.pf_entries; v_sum bigint; v_on date;
begin
  select * into e from public.pf_entries where id = p_entry; if not found or e.status = 'cancelled' then return; end if;
  if e.card_id is not null then perform private.pf_recalc_invoice(e.invoice_id); return; end if;
  select coalesce(sum(amount_cents), 0), max(settled_on) into v_sum, v_on from public.pf_settlements where entry_id = p_entry and voided_at is null;
  update public.pf_entries set settled_cents = v_sum, settled_on = v_on,
         status = case when v_sum >= amount_cents then 'settled' when v_sum > 0 then 'partial' when is_estimate then 'planned' else 'open' end
   where id = p_entry;
end $$;
revoke all on function private.pf_recalc_entry(uuid) from public, anon, authenticated;

create or replace function private.pf_event(p_user uuid, p_entry uuid, p_series uuid, p_kind text, p_detail jsonb) returns void
language sql security definer set search_path = '' as $$ insert into public.pf_entry_events (owner_user_id, entry_id, series_id, kind, detail) values (p_user, p_entry, p_series, p_kind, coalesce(p_detail, '{}'::jsonb)) $$;
revoke all on function private.pf_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- ocorrências de uma série (cálculo, nada é gravado)
create or replace function private.pf_occurrences(p_series uuid, p_from date, p_to date) returns table (occ_no int, occ_date date)
language plpgsql stable security definer set search_path = '' as $$
declare s public.pf_series; k int := 0; n int := 0; lim date; step int; dd int; dd2 int; cands date[]; c date; base date; iter int := 0;
begin
  select * into s from public.pf_series where id = p_series; if not found then return; end if;
  lim := p_to;
  if s.end_mode = 'date' then lim := least(lim, s.end_date); end if;
  if s.ended_on is not null then lim := least(lim, s.ended_on - 1); end if;
  if lim < s.start_date then return; end if;
  step := case s.frequency when 'monthly' then 1 when 'quarterly' then 3 when 'semiannual' then 6 when 'annual' then 12 else 1 end;
  dd := coalesce(s.due_day, extract(day from s.start_date)::int); dd2 := s.due_day2;
  loop
    iter := iter + 1; exit when iter > 6000;
    base := date_trunc('month', s.start_date)::date;
    if s.frequency = 'weekly' then cands := array[s.start_date + 7 * k];
    elsif s.frequency = 'biweekly' then cands := array[s.start_date + 14 * k];
    elsif s.frequency = 'semimonthly' then
      cands := array[private.pf_clamp_day(extract(year from (base + make_interval(months => k)))::int, extract(month from (base + make_interval(months => k)))::int, least(dd, dd2)),
                     private.pf_clamp_day(extract(year from (base + make_interval(months => k)))::int, extract(month from (base + make_interval(months => k)))::int, greatest(dd, dd2))];
    else
      cands := array[private.pf_clamp_day(extract(year from (base + make_interval(months => k * step)))::int, extract(month from (base + make_interval(months => k * step)))::int, dd)];
    end if;
    foreach c in array cands loop
      continue when c < s.start_date;
      if c > lim then return; end if;
      continue when exists (select 1 from public.pf_series_pauses ps where ps.series_id = s.id and ps.from_date <= c and (ps.to_date is null or c < ps.to_date));
      n := n + 1;
      if s.end_mode = 'count' and n > s.end_count then return; end if;
      if c >= p_from and c <= p_to then occ_no := n; occ_date := c; return next; end if;
    end loop;
    k := k + 1;
  end loop;
end $$;
revoke all on function private.pf_occurrences(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- validações de referências
create or replace function private.pf_check_refs(p_user uuid, p_kind text, p_category uuid, p_account uuid, p_card uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('income','expense') then raise exception 'tipo inválido (receita ou despesa)'; end if;
  if p_category is not null and not exists (select 1 from public.pf_categories where id = p_category and owner_user_id = p_user and kind = p_kind and active) then raise exception 'categoria inválida para este tipo'; end if;
  if p_account is not null and not exists (select 1 from public.pf_accounts where id = p_account and owner_user_id = p_user and active) then raise exception 'conta inválida'; end if;
  if p_card is not null and not exists (select 1 from public.pf_cards where id = p_card and owner_user_id = p_user and status = 'active') then raise exception 'cartão inválido ou bloqueado'; end if;
  if p_card is not null and p_account is not null then raise exception 'informe a conta OU o cartão, não os dois'; end if;
  if p_card is not null and p_kind <> 'expense' then raise exception 'só despesas podem ser lançadas no cartão'; end if;
end $$;
revoke all on function private.pf_check_refs(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- criação: avulso, recorrente ou parcelado
create or replace function public.pf_entry_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); v_today date := private.pf_today();
  v_kind text := p ->> 'kind'; v_desc text := btrim(coalesce(p ->> 'description', '')); v_cat uuid := nullif(p ->> 'category_id', '')::uuid;
  v_acc uuid := nullif(p ->> 'account_id', '')::uuid; v_card uuid := nullif(p ->> 'card_id', '')::uuid;
  v_nature text := coalesce(nullif(p ->> 'nature', ''), 'fixed'); v_rep text := coalesce(nullif(p ->> 'repetition', ''), 'single');
  v_amount bigint := nullif(p ->> 'amount_cents', '')::bigint; v_est boolean := coalesce((p ->> 'is_estimate')::boolean, false);
  v_ess boolean := coalesce((p ->> 'essential')::boolean, false); v_notes text := nullif(btrim(coalesce(p ->> 'notes', '')), '');
  v_key text := nullif(btrim(coalesce(p ->> 'idempotency_key', '')), '');
  v_due date := nullif(p ->> 'due_date', '')::date; v_comp date := nullif(p ->> 'competence_date', '')::date; v_buy date := nullif(p ->> 'purchase_date', '')::date;
  r jsonb := coalesce(p -> 'recurrence', '{}'::jsonb); i jsonb := coalesce(p -> 'installments', '{}'::jsonb);
  v_id uuid; v_inv uuid; v_dd date; v_freq text; v_n int; v_total bigint; v_parts bigint[]; v_grp uuid; v_k int; v_dk date; v_ids uuid[] := '{}'; v_ex uuid; v_status text;
  v_endm text; v_ed date; v_ec int; v_d1 int; v_d2 int; v_start date;
begin
  if length(v_desc) < 2 then raise exception 'informe a descrição'; end if;
  if v_nature not in ('fixed','variable') then raise exception 'comportamento do valor inválido (fixo ou variável)'; end if;
  if v_rep not in ('single','recurring','installment') then raise exception 'repetição inválida (avulso, recorrente ou parcelado)'; end if;
  perform private.pf_check_refs(v_user, v_kind, v_cat, v_acc, v_card);
  v_status := case when v_est then 'planned' else 'open' end;

  if v_rep = 'single' then
    if v_amount is null or v_amount <= 0 then raise exception 'informe um valor maior que zero'; end if;
    if v_key is not null then select id into v_ex from public.pf_entries where owner_user_id = v_user and idempotency_key = v_key; if v_ex is not null then return jsonb_build_object('kind', 'entry', 'id', v_ex, 'duplicate', true); end if; end if;
    if v_card is not null then
      v_buy := coalesce(v_buy, v_comp, v_due); if v_buy is null then raise exception 'informe a data da compra'; end if;
      v_inv := private.pf_invoice_for(v_card, v_buy); select due_date into v_dd from public.pf_invoices where id = v_inv;
      insert into public.pf_entries (org_id, owner_user_id, kind, description, category_id, card_id, invoice_id, competence_date, due_date, original_due_date, amount_cents, is_estimate, nature, repetition, status, essential, notes, idempotency_key)
        values (v_org, v_user, v_kind, v_desc, v_cat, v_card, v_inv, v_buy, v_dd, v_dd, v_amount, v_est, v_nature, 'single', v_status, v_ess, v_notes, v_key) returning id into v_id;
      perform private.pf_recalc_invoice(v_inv);
    else
      if v_due is null then raise exception 'informe a data de vencimento'; end if;
      insert into public.pf_entries (org_id, owner_user_id, kind, description, category_id, account_id, competence_date, due_date, original_due_date, amount_cents, is_estimate, nature, repetition, status, essential, notes, idempotency_key)
        values (v_org, v_user, v_kind, v_desc, v_cat, v_acc, coalesce(v_comp, v_due), v_due, v_due, v_amount, v_est, v_nature, 'single', v_status, v_ess, v_notes, v_key) returning id into v_id;
    end if;
    perform private.pf_event(v_user, v_id, null, 'created', jsonb_build_object('repetition', 'single'));
    return jsonb_build_object('kind', 'entry', 'id', v_id);

  elsif v_rep = 'installment' then
    v_n := nullif(i ->> 'count', '')::int; v_total := coalesce(nullif(i ->> 'total_cents', '')::bigint, v_amount);
    if v_n is null or v_n < 2 or v_n > 360 then raise exception 'informe a quantidade de parcelas (de 2 a 360)'; end if;
    if v_total is null or v_total < v_n then raise exception 'o valor total precisa ter ao menos 1 centavo por parcela'; end if;
    v_dd := coalesce(nullif(i ->> 'first_date', '')::date, v_buy, v_due);
    if v_dd is null then raise exception 'informe a data da primeira parcela'; end if;
    v_grp := case when v_key is not null then private.pf_uuid_from(v_user::text || '|' || v_key) else gen_random_uuid() end;
    if exists (select 1 from public.pf_entries where installment_group = v_grp) then
      return jsonb_build_object('kind', 'installments', 'group', v_grp, 'duplicate', true, 'ids', (select jsonb_agg(id order by installment_no) from public.pf_entries where installment_group = v_grp));
    end if;
    v_parts := private.split_cents(v_total, v_n);
    for v_k in 1..v_n loop
      v_dk := private.pf_add_months(v_dd, v_k - 1);
      if v_card is not null then
        v_inv := private.pf_invoice_for(v_card, v_dk);
        insert into public.pf_entries (org_id, owner_user_id, kind, description, category_id, card_id, invoice_id, competence_date, due_date, original_due_date, amount_cents, is_estimate, nature, repetition, installment_group, installment_no, installment_total, status, essential, notes)
          values (v_org, v_user, v_kind, v_desc, v_cat, v_card, v_inv, v_dk, (select due_date from public.pf_invoices where id = v_inv), (select due_date from public.pf_invoices where id = v_inv), v_parts[v_k], false, v_nature, 'installment', v_grp, v_k, v_n, 'open', v_ess, v_notes)
          returning id into v_id;
        perform private.pf_recalc_invoice(v_inv);
      else
        insert into public.pf_entries (org_id, owner_user_id, kind, description, category_id, account_id, competence_date, due_date, original_due_date, amount_cents, is_estimate, nature, repetition, installment_group, installment_no, installment_total, status, essential, notes)
          values (v_org, v_user, v_kind, v_desc, v_cat, v_acc, v_dk, v_dk, v_dk, v_parts[v_k], false, v_nature, 'installment', v_grp, v_k, v_n, 'open', v_ess, v_notes) returning id into v_id;
      end if;
      v_ids := v_ids || v_id;
    end loop;
    perform private.pf_event(v_user, v_ids[1], null, 'created', jsonb_build_object('repetition', 'installment', 'count', v_n, 'total_cents', v_total));
    return jsonb_build_object('kind', 'installments', 'group', v_grp, 'ids', to_jsonb(v_ids), 'amounts', to_jsonb(v_parts));

  else  -- recorrente: grava só a regra
    v_freq := r ->> 'frequency'; v_start := nullif(r ->> 'start_date', '')::date; v_endm := coalesce(nullif(r ->> 'end_mode', ''), 'none');
    if v_freq not in ('weekly','biweekly','semimonthly','monthly','quarterly','semiannual','annual') then raise exception 'frequência inválida'; end if;
    if v_start is null then raise exception 'informe a data inicial da recorrência'; end if;
    v_d1 := nullif(r ->> 'due_day', '')::int; v_d2 := nullif(r ->> 'due_day2', '')::int;
    if v_freq = 'semimonthly' and (v_d1 is null or v_d2 is null or v_d1 = v_d2) then raise exception 'informe os dois dias do mês (diferentes) para "duas vezes por mês"'; end if;
    if v_freq in ('weekly','biweekly') then v_d1 := null; v_d2 := null; end if;
    if v_freq in ('monthly','quarterly','semiannual','annual') then v_d1 := coalesce(v_d1, extract(day from v_start)::int); v_d2 := null; end if;
    if v_endm = 'date' then v_ed := nullif(r ->> 'end_date', '')::date; if v_ed is null or v_ed < v_start then raise exception 'a data final precisa ser igual ou posterior à inicial'; end if; end if;
    if v_endm = 'count' then v_ec := nullif(r ->> 'end_count', '')::int; if v_ec is null or v_ec < 1 then raise exception 'informe a quantidade de ocorrências'; end if; end if;
    if v_endm not in ('none','date','count') then raise exception 'término inválido'; end if;
    if v_nature = 'fixed' and (v_amount is null or v_amount <= 0) then raise exception 'informe o valor da recorrência'; end if;
    if v_amount is not null and v_amount <= 0 then raise exception 'o valor precisa ser maior que zero'; end if;
    if v_key is not null then select id into v_ex from public.pf_series where owner_user_id = v_user and idempotency_key = v_key; if v_ex is not null then return jsonb_build_object('kind', 'series', 'id', v_ex, 'duplicate', true); end if; end if;
    v_id := gen_random_uuid();
    insert into public.pf_series (id, org_id, owner_user_id, root_id, kind, description, category_id, account_id, card_id, nature, essential, frequency, start_date, due_day, due_day2, end_mode, end_date, end_count, amount_cents, is_estimate, notes, idempotency_key)
      values (v_id, v_org, v_user, v_id, v_kind, v_desc, v_cat, v_acc, v_card, v_nature, v_ess, v_freq, v_start, v_d1, v_d2, v_endm, v_ed, v_ec, v_amount, (v_nature = 'variable' and v_amount is not null) or v_est, v_notes, v_key);
    perform private.pf_event(v_user, null, v_id, 'created', jsonb_build_object('frequency', v_freq));
    return jsonb_build_object('kind', 'series', 'id', v_id, 'first', (select to_jsonb(o) from private.pf_occurrences(v_id, v_start, v_start + 400) o limit 1));
  end if;
end $$;
revoke all on function public.pf_entry_create(jsonb) from public, anon;
grant execute on function public.pf_entry_create(jsonb) to authenticated;

-- ---------------------------------------------------------------- ocorrência virtual → lançamento (só quando tocada; idempotente)
create or replace function private.pf_materialize(p_user uuid, p_series uuid, p_date date, p_amount bigint default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.pf_series; o record; v_id uuid; v_amt bigint; v_inv uuid; v_due date; v_est boolean;
begin
  select * into s from public.pf_series where id = p_series and owner_user_id = p_user; if not found then raise exception 'recorrência não encontrada'; end if;
  select id into v_id from public.pf_entries where series_root_id = s.root_id and occurrence_date = p_date; if v_id is not null then return v_id; end if;
  select * into o from private.pf_occurrences(s.id, p_date, p_date); if not found then raise exception 'essa data não é uma ocorrência desta recorrência'; end if;
  v_amt := coalesce(p_amount, s.amount_cents); if v_amt is null or v_amt <= 0 then raise exception 'informe o valor desta ocorrência'; end if;
  v_est := s.is_estimate and p_amount is null;
  v_due := p_date;
  if s.card_id is not null then v_inv := private.pf_invoice_for(s.card_id, p_date); select due_date into v_due from public.pf_invoices where id = v_inv; end if;
  insert into public.pf_entries (org_id, owner_user_id, kind, description, category_id, account_id, card_id, invoice_id, competence_date, due_date, original_due_date, amount_cents, estimated_cents, is_estimate, nature, repetition, series_id, series_root_id, occurrence_date, occurrence_no, status, essential, notes)
    values (s.org_id, s.owner_user_id, s.kind, s.description, s.category_id, s.account_id, s.card_id, v_inv, p_date, v_due, v_due, v_amt, case when p_amount is not null and s.is_estimate then s.amount_cents end, v_est, s.nature, 'recurring', s.id, s.root_id, p_date, o.occ_no, case when v_est then 'planned' else 'open' end, s.essential, s.notes)
    returning id into v_id;
  if v_inv is not null then perform private.pf_recalc_invoice(v_inv); end if;
  perform private.pf_event(p_user, v_id, s.id, 'materialized', jsonb_build_object('occurrence_date', p_date));
  return v_id;
end $$;
revoke all on function private.pf_materialize(uuid, uuid, date, bigint) from public, anon, authenticated;

-- referência a um lançamento: {entry_id} ou {series_id, occurrence_date}
create or replace function private.pf_resolve(p_user uuid, p_ref jsonb, p_amount bigint default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_ref ? 'entry_id' then
    select id into v_id from public.pf_entries where id = (p_ref ->> 'entry_id')::uuid and owner_user_id = p_user; if v_id is null then raise exception 'lançamento não encontrado'; end if; return v_id;
  elsif p_ref ? 'series_id' and p_ref ? 'occurrence_date' then
    return private.pf_materialize(p_user, (p_ref ->> 'series_id')::uuid, (p_ref ->> 'occurrence_date')::date, p_amount);
  end if;
  raise exception 'referência inválida';
end $$;
revoke all on function private.pf_resolve(uuid, jsonb, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- liquidação (recebimento/pagamento), parcial ou total; variável: o valor real substitui a previsão
create or replace function public.pf_entry_settle(p_ref jsonb, p_amount_cents bigint, p_date date, p_account uuid, p_final boolean default false, p_key text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_today date := private.pf_today(); e public.pf_entries; v_id uuid; v_ex uuid; a public.pf_accounts; v_total bigint; v_nat text; v_key text := nullif(btrim(coalesce(p_key, '')), '');
begin
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'informe um valor maior que zero'; end if;
  if p_date is null or p_date > v_today then raise exception 'a data da liquidação não pode estar no futuro'; end if;
  if v_key is not null then select id into v_ex from public.pf_settlements where owner_user_id = v_user and idempotency_key = v_key; if v_ex is not null then return jsonb_build_object('settlement_id', v_ex, 'duplicate', true); end if; end if;
  select * into a from public.pf_accounts where id = p_account and owner_user_id = v_user and active; if not found then raise exception 'escolha a conta'; end if;
  if p_date < a.opening_date then raise exception 'data anterior ao saldo inicial da conta'; end if;
  if p_ref ? 'series_id' then select nature into v_nat from public.pf_series where id = (p_ref ->> 'series_id')::uuid and owner_user_id = v_user; end if;
  v_id := private.pf_resolve(v_user, p_ref, case when v_nat = 'variable' and p_final then p_amount_cents end);
  select * into e from public.pf_entries where id = v_id for update;
  if e.status = 'cancelled' then raise exception 'lançamento cancelado'; end if;
  if e.card_id is not null then raise exception 'compra no cartão: pague a fatura (a despesa já foi registrada)'; end if;
  v_total := e.settled_cents + p_amount_cents;
  if v_total > e.amount_cents and not (e.nature = 'variable' and p_final) then raise exception 'o valor passa do previsto; para conta variável marque como valor final'; end if;
  insert into public.pf_settlements (org_id, owner_user_id, entry_id, account_id, amount_cents, settled_on, idempotency_key) values (e.org_id, v_user, e.id, p_account, p_amount_cents, p_date, v_key) returning id into v_ex;
  if e.nature = 'variable' and p_final then
    update public.pf_entries set estimated_cents = coalesce(estimated_cents, case when is_estimate then amount_cents end), amount_cents = v_total, is_estimate = false, account_id = coalesce(account_id, p_account) where id = e.id;
  else
    update public.pf_entries set account_id = coalesce(account_id, p_account) where id = e.id;
  end if;
  perform private.pf_recalc_entry(e.id);
  perform private.pf_event(v_user, e.id, e.series_id, 'settled', jsonb_build_object('amount_cents', p_amount_cents, 'on', p_date, 'final', p_final));
  return jsonb_build_object('settlement_id', v_ex, 'entry_id', e.id, 'status', (select status from public.pf_entries where id = e.id), 'settled_cents', (select settled_cents from public.pf_entries where id = e.id));
end $$;
revoke all on function public.pf_entry_settle(jsonb, bigint, date, uuid, boolean, text) from public, anon;
grant execute on function public.pf_entry_settle(jsonb, bigint, date, uuid, boolean, text) to authenticated;

create or replace function public.pf_settlement_void(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); s public.pf_settlements;
begin
  update public.pf_settlements set voided_at = now() where id = p_id and owner_user_id = v_user and voided_at is null returning * into s;
  if not found then raise exception 'liquidação não encontrada'; end if;
  perform private.pf_recalc_entry(s.entry_id);
  perform private.pf_event(v_user, s.entry_id, null, 'settlement_voided', jsonb_build_object('amount_cents', s.amount_cents));
end $$;
revoke all on function public.pf_settlement_void(uuid) from public, anon;
grant execute on function public.pf_settlement_void(uuid) to authenticated;

-- ---------------------------------------------------------------- edição: somente esta · esta e as próximas · toda a série
create or replace function public.pf_entry_update(p_ref jsonb, p_scope text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.pf_require(); v_id uuid; e public.pf_entries; s public.pf_series; v_amt bigint := nullif(p_patch ->> 'amount_cents', '')::bigint;
  v_desc text := nullif(btrim(coalesce(p_patch ->> 'description', '')), ''); v_cat uuid; v_due date := nullif(p_patch ->> 'due_date', '')::date;
  v_occ date; v_before int; v_rule boolean; v_newid uuid; v_card uuid; v_acc uuid; v_inv uuid; v_nf text; v_nd1 int; v_nd2 int; v_ns date;
begin
  if p_scope not in ('this','following','all') then raise exception 'escolha o alcance: somente esta, esta e as próximas, ou toda a série'; end if;
  if p_patch ? 'category_id' then v_cat := nullif(p_patch ->> 'category_id', '')::uuid; end if;
  if v_amt is not null and v_amt <= 0 then raise exception 'o valor precisa ser maior que zero'; end if;

  if p_scope = 'this' then
    v_id := private.pf_resolve(v_user, p_ref);
    select * into e from public.pf_entries where id = v_id for update;
    if e.status = 'cancelled' then raise exception 'lançamento cancelado'; end if;
    if e.settled_cents > 0 and (v_amt is not null or v_due is not null) then raise exception 'lançamento já liquidado: não altere valor nem data (estorne a liquidação antes)'; end if;
    if e.card_id is not null and v_due is not null then raise exception 'compra no cartão: o vencimento é o da fatura'; end if;
    if v_amt is not null and v_amt < e.settled_cents then raise exception 'o valor não pode ficar abaixo do já liquidado'; end if;
    if p_patch ? 'category_id' then perform private.pf_check_refs(v_user, e.kind, v_cat, null, null); end if;
    update public.pf_entries set
        description = coalesce(v_desc, description),
        category_id = case when p_patch ? 'category_id' then v_cat else category_id end,
        amount_cents = coalesce(v_amt, amount_cents),
        estimated_cents = case when v_amt is not null and is_estimate then coalesce(estimated_cents, amount_cents) else estimated_cents end,
        is_estimate = coalesce((p_patch ->> 'is_estimate')::boolean, is_estimate),
        due_date = coalesce(v_due, due_date),
        notes = case when p_patch ? 'notes' then nullif(btrim(coalesce(p_patch ->> 'notes', '')), '') else notes end,
        essential = coalesce((p_patch ->> 'essential')::boolean, essential),
        nature = coalesce(nullif(p_patch ->> 'nature', ''), nature),
        overridden = overridden or series_id is not null
      where id = v_id;
    if v_due is not null and v_due <> e.due_date then perform private.pf_event(v_user, v_id, e.series_id, 'rescheduled', jsonb_build_object('from', e.due_date, 'to', v_due, 'original', e.original_due_date)); end if;
    perform private.pf_event(v_user, v_id, e.series_id, 'edited', p_patch);
    if e.invoice_id is not null then perform private.pf_recalc_invoice(e.invoice_id); else perform private.pf_recalc_entry(v_id); end if;
    return jsonb_build_object('entry_id', v_id);
  end if;

  -- séries: localizar a série e a data da ocorrência
  if p_ref ? 'entry_id' then
    select * into e from public.pf_entries where id = (p_ref ->> 'entry_id')::uuid and owner_user_id = v_user; if not found then raise exception 'lançamento não encontrado'; end if;
    if e.installment_group is not null then raise exception 'parcelas: edite uma de cada vez (somente esta)'; end if;
    if e.series_id is null then raise exception 'este lançamento não faz parte de uma recorrência'; end if;
    select * into s from public.pf_series where id = e.series_id; v_occ := e.occurrence_date;
  else
    select * into s from public.pf_series where id = (p_ref ->> 'series_id')::uuid and owner_user_id = v_user; if not found then raise exception 'recorrência não encontrada'; end if;
    v_occ := (p_ref ->> 'occurrence_date')::date;
  end if;

  if p_scope = 'all' then
    if p_patch ?| array['frequency','due_day','due_day2','start_date','end_mode','end_date','end_count','card_id','account_id'] then
      raise exception 'para mudar frequência, vencimento, término, conta ou cartão use "esta e as próximas" (assim o passado liquidado fica intacto)';
    end if;
    if p_patch ? 'category_id' then perform private.pf_check_refs(v_user, s.kind, v_cat, null, null); end if;
    update public.pf_series set description = coalesce(v_desc, description), category_id = case when p_patch ? 'category_id' then v_cat else category_id end,
           amount_cents = coalesce(v_amt, amount_cents), nature = coalesce(nullif(p_patch ->> 'nature', ''), nature), essential = coalesce((p_patch ->> 'essential')::boolean, essential),
           is_estimate = coalesce((p_patch ->> 'is_estimate')::boolean, is_estimate), notes = case when p_patch ? 'notes' then nullif(btrim(coalesce(p_patch ->> 'notes', '')), '') else notes end
     where root_id = s.root_id and owner_user_id = v_user;
    update public.pf_entries set description = coalesce(v_desc, description), category_id = case when p_patch ? 'category_id' then v_cat else category_id end,
           amount_cents = coalesce(v_amt, amount_cents), essential = coalesce((p_patch ->> 'essential')::boolean, essential), nature = coalesce(nullif(p_patch ->> 'nature', ''), nature),
           notes = case when p_patch ? 'notes' then nullif(btrim(coalesce(p_patch ->> 'notes', '')), '') else notes end
     where series_root_id = s.root_id and owner_user_id = v_user and settled_cents = 0 and status in ('planned','open') and not overridden;
    for v_inv in select distinct invoice_id from public.pf_entries where series_root_id = s.root_id and invoice_id is not null loop perform private.pf_recalc_invoice(v_inv); end loop;
    perform private.pf_event(v_user, null, s.id, 'series_edited', p_patch);
    return jsonb_build_object('series_id', s.id);
  end if;

  -- 'following': divide a série na data da ocorrência
  if v_occ is null then raise exception 'ocorrência inválida'; end if;
  v_rule := p_patch ?| array['frequency','due_day','due_day2','start_date'];
  select count(*) into v_before from private.pf_occurrences(s.id, s.start_date, v_occ - 1);
  v_card := case when p_patch ? 'card_id' then nullif(p_patch ->> 'card_id', '')::uuid else s.card_id end;
  v_acc := case when p_patch ? 'account_id' then nullif(p_patch ->> 'account_id', '')::uuid else s.account_id end;
  perform private.pf_check_refs(v_user, s.kind, case when p_patch ? 'category_id' then v_cat else s.category_id end, v_acc, v_card);
  if s.end_mode = 'count' and s.end_count - v_before < 1 then raise exception 'não há ocorrências restantes para dividir'; end if;
  v_nf := coalesce(nullif(p_patch ->> 'frequency', ''), s.frequency);
  v_nd1 := case when v_nf in ('weekly','biweekly') then null when p_patch ? 'due_day' then nullif(p_patch ->> 'due_day', '')::int else s.due_day end;
  v_nd2 := case when v_nf = 'semimonthly' then (case when p_patch ? 'due_day2' then nullif(p_patch ->> 'due_day2', '')::int else s.due_day2 end) end;
  if v_nf = 'semimonthly' and (v_nd1 is null or v_nd2 is null or v_nd1 = v_nd2) then raise exception 'informe os dois dias do mês (diferentes) para "duas vezes por mês"'; end if;
  v_ns := greatest(coalesce(nullif(p_patch ->> 'start_date', '')::date, v_occ), v_occ);
  v_newid := gen_random_uuid();
  insert into public.pf_series (id, org_id, owner_user_id, root_id, parent_series_id, kind, description, category_id, account_id, card_id, nature, essential, frequency, start_date, due_day, due_day2, end_mode, end_date, end_count, amount_cents, is_estimate, notes, status)
    values (v_newid, s.org_id, v_user, s.root_id, s.id, s.kind, coalesce(v_desc, s.description), case when p_patch ? 'category_id' then v_cat else s.category_id end, v_acc, v_card,
            coalesce(nullif(p_patch ->> 'nature', ''), s.nature), coalesce((p_patch ->> 'essential')::boolean, s.essential), v_nf, v_ns, v_nd1, v_nd2,
            s.end_mode, s.end_date, case when s.end_mode = 'count' then s.end_count - v_before end, coalesce(v_amt, s.amount_cents),
            coalesce((p_patch ->> 'is_estimate')::boolean, s.is_estimate), case when p_patch ? 'notes' then nullif(btrim(coalesce(p_patch ->> 'notes', '')), '') else s.notes end, case when s.status = 'paused' then 'paused' else 'active' end);
  insert into public.pf_series_pauses (series_id, owner_user_id, from_date, to_date) select v_newid, v_user, greatest(from_date, v_ns), to_date from public.pf_series_pauses where series_id = s.id and (to_date is null or to_date > v_ns);
  update public.pf_series set ended_on = v_ns, status = 'ended' where id = s.id;
  if v_rule then
    update public.pf_entries set status = 'cancelled', notes = coalesce(notes || ' · ', '') || 'substituída por alteração da recorrência'
     where series_id = s.id and occurrence_date >= v_occ and settled_cents = 0 and status in ('planned','open');
  else
    update public.pf_entries set series_id = v_newid, description = coalesce(v_desc, description), category_id = case when p_patch ? 'category_id' then v_cat else category_id end,
           amount_cents = coalesce(v_amt, amount_cents), essential = coalesce((p_patch ->> 'essential')::boolean, essential), nature = coalesce(nullif(p_patch ->> 'nature', ''), nature), overridden = false
     where series_id = s.id and occurrence_date >= v_occ and settled_cents = 0 and status in ('planned','open');
  end if;
  for v_inv in select distinct invoice_id from public.pf_entries where series_root_id = s.root_id and invoice_id is not null loop perform private.pf_recalc_invoice(v_inv); end loop;
  perform private.pf_event(v_user, null, v_newid, 'series_split', jsonb_build_object('from_series', s.id, 'at', v_occ, 'patch', p_patch));
  return jsonb_build_object('series_id', v_newid, 'previous_series_id', s.id);
end $$;
revoke all on function public.pf_entry_update(jsonb, text, jsonb) from public, anon;
grant execute on function public.pf_entry_update(jsonb, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- cancelamento (nunca apaga o passado nem o que já foi liquidado)
create or replace function public.pf_entry_cancel(p_ref jsonb, p_scope text default 'this') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_id uuid; e public.pf_entries; s public.pf_series; v_occ date; v_n int; v_inv uuid; v_series uuid;
begin
  if p_scope not in ('this','following') then raise exception 'escolha o alcance: somente esta ou esta e as próximas'; end if;
  if p_ref ? 'series_id' then
    select * into s from public.pf_series where id = (p_ref ->> 'series_id')::uuid and owner_user_id = v_user; if not found then raise exception 'recorrência não encontrada'; end if;
    v_occ := (p_ref ->> 'occurrence_date')::date;
    if p_scope = 'this' then
      select id into v_id from public.pf_entries where series_root_id = s.root_id and occurrence_date = v_occ;
      if v_id is null then v_id := private.pf_materialize(v_user, s.id, v_occ, coalesce(s.amount_cents, 1)); end if;
    end if;
  else
    select * into e from public.pf_entries where id = (p_ref ->> 'entry_id')::uuid and owner_user_id = v_user; if not found then raise exception 'lançamento não encontrado'; end if;
    v_id := e.id; v_occ := e.occurrence_date; v_series := e.series_id;
    if e.series_id is not null then select * into s from public.pf_series where id = e.series_id; end if;
  end if;

  if p_scope = 'this' then
    select * into e from public.pf_entries where id = v_id for update;
    if e.settled_cents > 0 then raise exception 'lançamento já tem pagamento/recebimento: estorne antes de cancelar'; end if;
    update public.pf_entries set status = 'cancelled' where id = v_id;
    if e.invoice_id is not null then perform private.pf_recalc_invoice(e.invoice_id); end if;
    perform private.pf_event(v_user, v_id, e.series_id, 'cancelled', '{}'::jsonb);
    return jsonb_build_object('cancelled', 1);
  end if;

  if s.id is not null then       -- recorrência: encerra a partir da ocorrência; o passado e o liquidado ficam
    update public.pf_series set ended_on = v_occ, status = 'ended' where id = s.id;
    with c as (update public.pf_entries set status = 'cancelled' where series_root_id = s.root_id and occurrence_date >= v_occ and settled_cents = 0 and status in ('planned','open') returning invoice_id)
      select count(*) into v_n from c;
    for v_inv in select distinct invoice_id from public.pf_entries where series_root_id = s.root_id and invoice_id is not null loop perform private.pf_recalc_invoice(v_inv); end loop;
    perform private.pf_event(v_user, null, s.id, 'series_ended', jsonb_build_object('from', v_occ));
    return jsonb_build_object('series_ended_on', v_occ, 'cancelled', v_n);
  elsif e.installment_group is not null then   -- parcelado: cancela esta e as próximas parcelas ainda sem pagamento
    with c as (update public.pf_entries set status = 'cancelled' where installment_group = e.installment_group and installment_no >= e.installment_no and settled_cents = 0 and status in ('planned','open') returning 1)
      select count(*) into v_n from c;
    for v_inv in select distinct invoice_id from public.pf_entries where installment_group = e.installment_group and invoice_id is not null loop perform private.pf_recalc_invoice(v_inv); end loop;
    return jsonb_build_object('cancelled', v_n);
  end if;
  raise exception 'este lançamento não tem próximas ocorrências';
end $$;
revoke all on function public.pf_entry_cancel(jsonb, text) from public, anon;
grant execute on function public.pf_entry_cancel(jsonb, text) to authenticated;

-- ---------------------------------------------------------------- pausar, retomar e encerrar recorrência
create or replace function public.pf_series_action(p_series uuid, p_action text, p_date date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); s public.pf_series; v_d date := coalesce(p_date, private.pf_today()); v_n int; v_inv uuid;
begin
  select * into s from public.pf_series where id = p_series and owner_user_id = v_user for update; if not found then raise exception 'recorrência não encontrada'; end if;
  if s.status = 'ended' and p_action <> 'noop' then raise exception 'recorrência já encerrada'; end if;
  if p_action = 'pause' then
    if exists (select 1 from public.pf_series_pauses where series_id = s.id and to_date is null) then raise exception 'recorrência já está pausada'; end if;
    insert into public.pf_series_pauses (series_id, owner_user_id, from_date) values (s.id, v_user, v_d); update public.pf_series set status = 'paused' where id = s.id;
  elsif p_action = 'resume' then
    if not exists (select 1 from public.pf_series_pauses where series_id = s.id and to_date is null) then raise exception 'recorrência não está pausada'; end if;
    delete from public.pf_series_pauses where series_id = s.id and to_date is null and from_date >= v_d;
    update public.pf_series_pauses set to_date = v_d where series_id = s.id and to_date is null;
    update public.pf_series set status = 'active' where id = s.id;
  elsif p_action = 'end' then
    update public.pf_series set ended_on = v_d, status = 'ended' where id = s.id;
    with c as (update public.pf_entries set status = 'cancelled' where series_id = s.id and occurrence_date >= v_d and settled_cents = 0 and status in ('planned','open') returning 1) select count(*) into v_n from c;
    for v_inv in select distinct invoice_id from public.pf_entries where series_id = s.id and invoice_id is not null loop perform private.pf_recalc_invoice(v_inv); end loop;
  else raise exception 'ação inválida'; end if;
  perform private.pf_event(v_user, null, s.id, 'series_' || p_action, jsonb_build_object('date', v_d));
  return jsonb_build_object('status', (select status from public.pf_series where id = s.id));
end $$;
revoke all on function public.pf_series_action(uuid, text, date) from public, anon;
grant execute on function public.pf_series_action(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------- fatura do cartão
create or replace function public.pf_invoice_pay(p_invoice uuid, p_account uuid, p_amount_cents bigint, p_paid_on date, p_key text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_today date := private.pf_today(); inv public.pf_invoices; a public.pf_accounts; v_total bigint; v_paid bigint; v_ex uuid; v_key text := nullif(btrim(coalesce(p_key, '')), '');
begin
  if v_key is not null then select id into v_ex from public.pf_invoice_payments where owner_user_id = v_user and idempotency_key = v_key; if v_ex is not null then return jsonb_build_object('payment_id', v_ex, 'duplicate', true); end if; end if;
  select * into inv from public.pf_invoices where id = p_invoice and owner_user_id = v_user for update; if not found then raise exception 'fatura não encontrada'; end if;
  select * into a from public.pf_accounts where id = p_account and owner_user_id = v_user and active; if not found then raise exception 'escolha a conta de pagamento'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'informe um valor maior que zero'; end if;
  if p_paid_on is null or p_paid_on > v_today then raise exception 'a data do pagamento não pode estar no futuro'; end if;
  if p_paid_on < a.opening_date then raise exception 'data anterior ao saldo inicial da conta'; end if;
  v_total := private.pf_invoice_total(inv.id); v_paid := private.pf_invoice_paid(inv.id);
  if p_amount_cents > v_total - v_paid then raise exception 'o valor passa do que falta pagar na fatura'; end if;
  insert into public.pf_invoice_payments (org_id, owner_user_id, invoice_id, account_id, amount_cents, paid_on, idempotency_key) values (inv.org_id, v_user, inv.id, p_account, p_amount_cents, p_paid_on, v_key) returning id into v_ex;
  perform private.pf_recalc_invoice(inv.id);
  return jsonb_build_object('payment_id', v_ex, 'remaining_cents', v_total - v_paid - p_amount_cents);
end $$;
revoke all on function public.pf_invoice_pay(uuid, uuid, bigint, date, text) from public, anon;
grant execute on function public.pf_invoice_pay(uuid, uuid, bigint, date, text) to authenticated;

create or replace function public.pf_invoice_payment_void(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); x public.pf_invoice_payments;
begin
  update public.pf_invoice_payments set voided_at = now() where id = p_id and owner_user_id = v_user and voided_at is null returning * into x;
  if not found then raise exception 'pagamento não encontrado'; end if;
  perform private.pf_recalc_invoice(x.invoice_id);
end $$;
revoke all on function public.pf_invoice_payment_void(uuid) from public, anon;
grant execute on function public.pf_invoice_payment_void(uuid) to authenticated;

-- ---------------------------------------------------------------- transferências, aportes em reserva/metas e investimentos (patrimônio, não consumo)
create or replace function public.pf_transfer_create(p_from uuid, p_to uuid, p_amount_cents bigint, p_date date, p_kind text default 'transfer', p_goal uuid default null, p_note text default null, p_key text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require(); v_org uuid := private.pf_org(); v_today date := private.pf_today(); fa public.pf_accounts; ta public.pf_accounts; v_ex uuid; v_key text := nullif(btrim(coalesce(p_key, '')), '');
begin
  if v_key is not null then select id into v_ex from public.pf_transfers where owner_user_id = v_user and idempotency_key = v_key; if v_ex is not null then return jsonb_build_object('transfer_id', v_ex, 'duplicate', true); end if; end if;
  if p_kind not in ('transfer','reserve','goal','investment') then raise exception 'tipo de movimentação inválido'; end if;
  if p_from = p_to then raise exception 'origem e destino precisam ser contas diferentes'; end if;
  select * into fa from public.pf_accounts where id = p_from and owner_user_id = v_user and active; if not found then raise exception 'conta de origem inválida'; end if;
  select * into ta from public.pf_accounts where id = p_to and owner_user_id = v_user and active; if not found then raise exception 'conta de destino inválida'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'informe um valor maior que zero'; end if;
  if p_date is null or p_date > v_today then raise exception 'a data não pode estar no futuro'; end if;
  if p_date < fa.opening_date or p_date < ta.opening_date then raise exception 'data anterior ao saldo inicial de uma das contas'; end if;
  if p_kind = 'reserve' and not ta.counts_for_reserve then raise exception 'a conta de destino não compõe a reserva'; end if;
  if p_kind = 'goal' and (p_goal is null or not exists (select 1 from public.pf_goals where id = p_goal and owner_user_id = v_user)) then raise exception 'escolha a meta'; end if;
  insert into public.pf_transfers (org_id, owner_user_id, from_account_id, to_account_id, amount_cents, on_date, kind, goal_id, note, idempotency_key)
    values (v_org, v_user, p_from, p_to, p_amount_cents, p_date, p_kind, case when p_kind = 'goal' then p_goal end, nullif(btrim(coalesce(p_note, '')), ''), v_key) returning id into v_ex;
  return jsonb_build_object('transfer_id', v_ex);
end $$;
revoke all on function public.pf_transfer_create(uuid, uuid, bigint, date, text, uuid, text, text) from public, anon;
grant execute on function public.pf_transfer_create(uuid, uuid, bigint, date, text, uuid, text, text) to authenticated;

create or replace function public.pf_transfer_void(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.pf_require();
begin
  update public.pf_transfers set voided_at = now() where id = p_id and owner_user_id = v_user and voided_at is null;
  if not found then raise exception 'movimentação não encontrada'; end if;
end $$;
revoke all on function public.pf_transfer_void(uuid) from public, anon;
grant execute on function public.pf_transfer_void(uuid) to authenticated;
