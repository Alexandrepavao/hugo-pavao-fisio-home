-- Repasses (item 4 da validação operacional): (1) cada lançamento de comissão passa a GUARDAR o percentual aplicado (antes, mudar a regra depois tornava o cálculo irreconstituível);
-- (2) o resumo do profissional passa a mostrar pendente, autorizado, pago, estornos e líquido, com o detalhamento (data do recebimento, base, percentual, regra, produtos — nunca o paciente),
-- e o período segue a data do recebimento, como o Financeiro; (3) commission_reconciliation recalcula cada lançamento (base × percentual) e confere o total com a Visão geral (finance_by_line).

alter table public.commission_entries add column if not exists percent_bp int check (percent_bp is null or percent_bp between 1 and 10000);

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
      insert into public.commission_entries (org_id, unit_id, rule_id, sale_id, payment_id, beneficiary_user_id, amount_cents, percent_bp)
        values (pay.org_id, pay.unit_id, ru.id, s.id, pay.id, v_ben, v_amt, ru.percent_bp) on conflict (payment_id, rule_id) do nothing;
    else
      insert into public.commission_entries (org_id, unit_id, rule_id, sale_id, payment_id, beneficiary_user_id, amount_cents, status, percent_bp)
        values (pay.org_id, pay.unit_id, ru.id, s.id, pay.id, v_ben, -v_amt, 'reversed', ru.percent_bp) on conflict (payment_id, rule_id) do nothing;
    end if;
  end loop;
end $$;

create or replace function public.my_professional_summary(p_from date default null, p_to date default null, p_professional uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.current_org(); pr public.professionals; v_from date := coalesce(p_from, date_trunc('month', now())::date); v_to date := coalesce(p_to, current_date);
        v_counts jsonb; v_self boolean; v_rules int; v_ent jsonb; v_auth bigint := 0; v_paid bigint := 0; v_pend bigint := 0; v_rev bigint := 0; v_any boolean := false;
begin
  if v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_to < v_from or v_to - v_from > 731 then raise exception 'período inválido (máximo de 2 anos)'; end if;
  if p_professional is null then select * into pr from public.professionals where user_id = v_uid and org_id = v_org; else select * into pr from public.professionals where id = p_professional and org_id = v_org; end if;
  if not found then raise exception 'perfil profissional não encontrado' using errcode = 'P0002'; end if;
  v_self := pr.user_id = v_uid;
  if not v_self and not private.can_view_prof_agenda(pr.id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select jsonb_build_object(
    'awaiting_record', count(*) filter (where b.status in ('scheduled','confirmed') and lower(b.period) <= now()),
    'attended', count(*) filter (where b.status = 'attended'),
    'cancelled_by_patient', count(*) filter (where b.status = 'cancelled_by_patient'),
    'cancelled_by_clinic', count(*) filter (where b.status = 'cancelled_by_clinic'),
    'rescheduled', count(*) filter (where b.status = 'rescheduled'),
    'patient_no_show', count(*) filter (where b.status = 'no_show'),
    'professional_no_show', count(*) filter (where b.status = 'professional_no_show'),
    'patients_attended', count(distinct b.person_id) filter (where b.status = 'attended'),
    'total', count(*)) into v_counts
  from public.appointments b join public.units u on u.id = b.unit_id
  where b.professional_id = pr.id and b.org_id = v_org and (lower(b.period) at time zone u.timezone)::date between v_from and v_to
    and (v_self or private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], b.unit_id));
  v_counts := v_counts || jsonb_build_object('scheduled', (select count(*) from public.appointments b
      where b.professional_id = pr.id and b.org_id = v_org and b.status in ('scheduled','confirmed') and lower(b.period) > now()
        and (v_self or private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], b.unit_id))));
  if v_self and pr.user_id is not null then
    select count(*) into v_rules from public.commission_rules where org_id = v_org and active and beneficiary_user_id = pr.user_id;
    -- período pela DATA DO RECEBIMENTO (a mesma que o Financeiro usa), para os números fecharem com a Visão geral; sem pagamento ligado, cai na criação do lançamento
    select coalesce(sum(ce.amount_cents) filter (where ce.status = 'pending'), 0), coalesce(sum(ce.amount_cents) filter (where ce.status = 'authorized'), 0),
           coalesce(sum(ce.amount_cents) filter (where ce.status = 'paid'), 0), coalesce(sum(ce.amount_cents) filter (where ce.status = 'reversed'), 0), count(*) > 0
      into v_pend, v_auth, v_paid, v_rev, v_any
      from public.commission_entries ce left join public.payments py on py.id = ce.payment_id
     where ce.beneficiary_user_id = pr.user_id and (coalesce(py.paid_at, ce.created_at) at time zone 'America/Sao_Paulo')::date between v_from and v_to;
    select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'amount_cents', x.amount_cents, 'status', x.status, 'kind', x.kind, 'base_cents', x.base, 'percent_bp', x.pct, 'percent_estimated', x.est, 'rule', x.rule, 'products', x.products) order by x.at desc), '[]') into v_ent
      from (select coalesce(py.paid_at, ce.created_at) at, ce.amount_cents, ce.status, coalesce(py.kind, 'payment') kind, abs(py.amount_cents) base, coalesce(ce.percent_bp, cr.percent_bp) pct, ce.percent_bp is null est, cr.name rule,
                   (select string_agg(distinct si.description, ', ') from public.sale_items si where si.sale_id = ce.sale_id) products
              from public.commission_entries ce left join public.payments py on py.id = ce.payment_id left join public.commission_rules cr on cr.id = ce.rule_id
             where ce.beneficiary_user_id = pr.user_id and (coalesce(py.paid_at, ce.created_at) at time zone 'America/Sao_Paulo')::date between v_from and v_to
             order by coalesce(py.paid_at, ce.created_at) desc limit 50) x;
  end if;
  return jsonb_build_object('professional_id', pr.id, 'professional_name', pr.display_name, 'is_self', v_self, 'from', v_from, 'to', v_to, 'counts', v_counts,
    'payouts', case when not v_self then jsonb_build_object('visible', false, 'basis', 'repasses só aparecem para o próprio profissional')
                    else jsonb_build_object('visible', true, 'rules', coalesce(v_rules, 0), 'pending_cents', v_pend, 'authorized_cents', v_auth, 'paid_cents', v_paid, 'reversed_cents', v_rev,
                           'net_cents', v_pend + v_auth + v_paid + v_rev, 'entries', coalesce(v_ent, '[]'::jsonb), 'available', (coalesce(v_rules, 0) > 0 or v_any),
                           'basis', case when coalesce(v_rules, 0) = 0 and not v_any then 'nenhuma regra de repasse cadastrada para você e nenhum lançamento de comissão no período'
                                         else 'comissões geradas pelas regras em seu nome, pela data do recebimento: autorizado e pago são o que já foi liberado; pendente aguarda autorização; estorno reduz o líquido (percentual × valor estornado)' end) end);
end $$;

revoke all on function public.my_professional_summary(date, date, uuid) from public, anon;
grant execute on function public.my_professional_summary(date, date, uuid) to authenticated;

-- Reconciliação das comissões no período (data do recebimento) — só financeiro/gestão.
create or replace function public.commission_reconciliation(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit); v_fin bigint; r record;
begin
  if private.current_org() is null or not private.has_any_role(array['manager','ops_admin','unit_manager','finance']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  with x as (select ce.id, ce.amount_cents, ce.status, ce.percent_bp is null est,
                    (case when py.kind = 'refund' then -1 else 1 end) * ((abs(py.amount_cents) * coalesce(ce.percent_bp, cr.percent_bp) + 5000) / 10000) expected
               from public.commission_entries ce join public.payments py on py.id = ce.payment_id join public.commission_rules cr on cr.id = ce.rule_id
              where ce.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to)
  select count(*) n, coalesce(sum(amount_cents), 0) total, coalesce(sum(expected), 0) recomputed, count(*) filter (where amount_cents <> expected) bad, count(*) filter (where est) estimated,
         coalesce(sum(amount_cents) filter (where status = 'pending'), 0) pend, coalesce(sum(amount_cents) filter (where status = 'authorized'), 0) auth,
         coalesce(sum(amount_cents) filter (where status = 'paid'), 0) paid, coalesce(sum(amount_cents) filter (where status = 'reversed'), 0) rev,
         coalesce((select jsonb_agg(jsonb_build_object('id', y.id, 'amount_cents', y.amount_cents, 'expected_cents', y.expected)) from (select * from x where amount_cents <> expected limit 20) y), '[]'::jsonb) bad_list
    into r from x;
  v_fin := coalesce((public.finance_by_line(p_from, p_to, p_unit) -> 'total' ->> 'commissions_cents')::bigint, 0);
  return jsonb_build_object('entries', r.n, 'total_cents', r.total, 'recomputed_cents', r.recomputed, 'mismatch_count', r.bad, 'mismatches', r.bad_list, 'estimated_percent_count', r.estimated,
    'pending_cents', r.pend, 'authorized_cents', r.auth, 'paid_cents', r.paid, 'reversed_cents', r.rev,
    'finance_total_cents', v_fin, 'diff_vs_finance_cents', r.total - v_fin, 'ok', (r.bad = 0 and r.total = v_fin and r.total = r.pend + r.auth + r.paid + r.rev));
end $$;
revoke all on function public.commission_reconciliation(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.commission_reconciliation(timestamptz, timestamptz, uuid) to authenticated;
