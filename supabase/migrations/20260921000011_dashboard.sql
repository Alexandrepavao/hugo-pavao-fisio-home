-- HP Group Hub — 011 Dashboard do gestor: indicadores e alertas sobre dados persistidos
-- Cada indicador informa {value, available, basis}. available=false => "indisponível" (nunca 0 fictício).
-- Definições completas em docs/metrics.md.

create or replace function private.dash_units(p_unit uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v uuid[];
begin
  if v_org is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  if private.has_org_role(array['manager','ops_admin']::public.app_role[]) then
    select array_agg(id) into v from public.units where org_id = v_org and (p_unit is null or id = p_unit);
  else
    select array_agg(distinct ra.unit_id) into v from public.role_assignments ra
     where ra.user_id = (select auth.uid()) and ra.role = 'unit_manager' and ra.unit_id is not null and ra.revoked_at is null
       and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()) and (p_unit is null or ra.unit_id = p_unit);
  end if;
  if v is null then raise exception 'sem permissão para o painel' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function private.metric(p_value numeric, p_available boolean, p_basis text, p_extra jsonb default '{}') returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('value', case when p_available then p_value end, 'available', p_available, 'basis', p_basis) || coalesce(p_extra, '{}')
$$;

create or replace function public.dashboard_metrics(p_from timestamptz, p_to timestamptz, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid[] := private.dash_units(p_unit);
  v_visits bigint; v_leads bigint; v_opps bigint; v_won bigint; v_lost bigint; v_first numeric; v_ticket numeric; v_sales bigint;
  v_sched bigint; v_att bigint; v_ns bigint; v_avail_min numeric; v_booked_min numeric; v_granted bigint; v_used bigint;
  v_in bigint; v_out bigint; v_exp bigint; v_overdue bigint; v_overdue_n bigint; v_open_due bigint; v_pay_due bigint; v_sub bigint;
  v_students bigint; v_cert bigint; v_ent_total bigint; v_resp bigint; v_prom bigint; v_det bigint; v_avg numeric; v_refs bigint;
  v_sources jsonb; v_losses jsonb; v_any_visits boolean; v_any_pay boolean; v_any_exp boolean; v_any_appt boolean;
begin
  select count(distinct v.session_id) into v_visits from public.page_visits v join public.pages p on p.id = v.page_id where p.unit_id = any (u) and v.visited_at >= p_from and v.visited_at < p_to;
  v_any_visits := exists (select 1 from public.page_visits v join public.pages p on p.id = v.page_id where p.unit_id = any (u));
  select count(*) into v_leads from public.form_submissions s join public.pages p on p.id = s.page_id where p.unit_id = any (u) and s.created_at >= p_from and s.created_at < p_to;
  select count(*) into v_opps from public.opportunities where unit_id = any (u) and created_at >= p_from and created_at < p_to;
  select count(*) filter (where status = 'won'), count(*) filter (where status = 'lost') into v_won, v_lost from public.opportunities where unit_id = any (u) and closed_at >= p_from and closed_at < p_to;
  select avg(extract(epoch from (first_response_at - created_at)) / 60) into v_first from public.opportunities where unit_id = any (u) and created_at >= p_from and created_at < p_to and first_response_at is not null;
  select coalesce(jsonb_object_agg(src, n), '{}') into v_sources from (select coalesce(source, 'sem origem') src, count(*) n from public.opportunities where unit_id = any (u) and created_at >= p_from and created_at < p_to group by 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('reason', r.name, 'count', n) order by n desc), '[]') into v_losses
    from (select lost_reason_id, count(*) n from public.opportunities where unit_id = any (u) and status = 'lost' and closed_at >= p_from and closed_at < p_to group by 1) x join public.loss_reasons r on r.id = x.lost_reason_id;
  select avg(total_cents), count(*) into v_ticket, v_sales from public.sales where unit_id = any (u) and status = 'confirmed' and sold_at >= p_from and sold_at < p_to;

  select count(*) into v_sched from public.appointments where unit_id = any (u) and created_at >= p_from and created_at < p_to and opportunity_id is not null;
  select count(*) filter (where status = 'attended'), count(*) filter (where status = 'no_show') into v_att, v_ns from public.appointments where unit_id = any (u) and lower(period) >= p_from and lower(period) < p_to;
  v_any_appt := exists (select 1 from public.appointments where unit_id = any (u));
  select coalesce(sum(extract(epoch from (a.end_time - a.start_time)) / 60), 0) into v_avail_min
    from generate_series(p_from::date, (p_to - interval '1 second')::date, interval '1 day') d
    join public.availability_rules a on a.unit_id = any (u) and a.weekday = extract(dow from d) and (a.valid_from is null or a.valid_from <= d) and (a.valid_until is null or a.valid_until >= d);
  select coalesce(sum(extract(epoch from (upper(period) - lower(period))) / 60), 0) into v_booked_min from public.appointments where unit_id = any (u) and status in ('scheduled','confirmed','attended') and lower(period) >= p_from and lower(period) < p_to;
  select coalesce(sum(delta) filter (where reason = 'grant' and l.created_at >= p_from and l.created_at < p_to), 0), coalesce(-sum(delta) filter (where reason = 'consume' and l.created_at >= p_from and l.created_at < p_to), 0)
    into v_granted, v_used from public.session_ledger l join public.client_packages c on c.id = l.client_package_id where c.unit_id = any (u);

  select coalesce(sum(case kind when 'payment' then amount_cents else -amount_cents end), 0) into v_in from public.payments where unit_id = any (u) and paid_at >= p_from and paid_at < p_to;
  v_any_pay := exists (select 1 from public.payments where unit_id = any (u));
  select coalesce(sum(amount_cents), 0) into v_out from public.payables where unit_id = any (u) and status = 'paid' and paid_at >= p_from and paid_at < p_to;
  v_any_exp := exists (select 1 from public.payables where unit_id = any (u));
  select coalesce(sum(r.amount_cents - private.receivable_net(r.id)), 0), count(*) into v_overdue, v_overdue_n from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date < current_date;
  select coalesce(sum(r.amount_cents - private.receivable_net(r.id)), 0) into v_open_due from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date >= current_date and r.due_date < current_date + 30;
  select coalesce(sum(amount_cents), 0) into v_pay_due from public.payables where unit_id = any (u) and status = 'open' and due_date < current_date + 30;
  select coalesce(sum(f.projected_amount_cents), 0) into v_sub from public.subscription_forecast((date_trunc('month', current_date) + interval '1 month')::date, null) f where f.person_id in (select person_id from public.receivables where unit_id = any (u));

  select count(distinct e.person_id) into v_students from public.entitlements e where e.org_id = private.current_org() and e.revoked_at is null and e.valid_from <= now() and (e.valid_until is null or e.valid_until > now());
  select count(*) into v_cert from public.certificates where org_id = private.current_org() and issued_at >= p_from and issued_at < p_to;
  select count(distinct (person_id, course_id)) into v_ent_total from public.entitlements where org_id = private.current_org();
  select count(*), count(*) filter (where score >= 9), count(*) filter (where score <= 6), avg(score) into v_resp, v_prom, v_det, v_avg from public.survey_responses where org_id = private.current_org() and created_at >= p_from and created_at < p_to;
  select count(*) into v_refs from public.referrals where unit_id = any (u) and created_at >= p_from and created_at < p_to;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'visits', private.metric(v_visits, v_any_visits, 'sessões únicas por visita (data da visita)'),
    'leads', private.metric(v_leads, v_any_visits, 'formulários enviados (data do envio)'),
    'page_conversion', private.metric(case when v_visits > 0 then round(v_leads * 100.0 / v_visits, 1) end, v_visits > 0, 'leads ÷ visitas no período (%)'),
    'opportunities_created', private.metric(v_opps, true, 'oportunidades criadas (data de criação)', jsonb_build_object('by_source', v_sources)),
    'first_response_minutes', private.metric(round(v_first, 0), v_first is not null, 'média entre criação e primeiro contato registrado (oportunidades criadas no período)'),
    'win_rate', private.metric(case when v_won + v_lost > 0 then round(v_won * 100.0 / (v_won + v_lost), 1) end, v_won + v_lost > 0, 'ganhas ÷ (ganhas+perdidas) fechadas no período (%)', jsonb_build_object('won', v_won, 'lost', v_lost)),
    'average_ticket_cents', private.metric(round(v_ticket, 0), v_sales > 0, 'média do total das vendas confirmadas (data da venda)', jsonb_build_object('sales', v_sales)),
    'loss_reasons', jsonb_build_object('items', v_losses, 'basis', 'perdas fechadas no período (data do fechamento)'),
    'evaluations_scheduled', private.metric(v_sched, v_any_appt, 'agendamentos originados de oportunidades (data da criação do agendamento)'),
    'attended', private.metric(v_att, v_any_appt, 'atendimentos realizados (data do atendimento)'),
    'no_shows', private.metric(v_ns, v_any_appt, 'faltas (data do atendimento)'),
    'attendance_rate', private.metric(case when v_att + v_ns > 0 then round(v_att * 100.0 / (v_att + v_ns), 1) end, v_att + v_ns > 0, 'comparecimento ÷ (comparecimento+faltas) (%)'),
    'occupancy', private.metric(case when v_avail_min > 0 then round(v_booked_min * 100.0 / v_avail_min, 1) end, v_avail_min > 0, 'minutos agendados ÷ minutos de disponibilidade cadastrada (%)'),
    'sessions_contracted', private.metric(v_granted, v_any_appt or v_granted > 0, 'sessões concedidas por pacotes (data do lançamento)'),
    'sessions_used', private.metric(v_used, v_any_appt or v_used > 0, 'sessões consumidas (data do lançamento)'),
    'receipts_cents', private.metric(v_in, v_any_pay, 'recebimentos efetivos líquidos de estornos (data do pagamento)'),
    'expenses_cents', private.metric(v_out, v_any_exp, 'despesas pagas (data do pagamento)'),
    'cash_result_cents', private.metric(v_in - v_out, v_any_pay or v_any_exp, 'recebimentos − despesas pagas (regime de caixa)'),
    'overdue_cents', private.metric(v_overdue, true, 'saldo de parcelas vencidas e não pagas (hoje)', jsonb_build_object('installments', v_overdue_n)),
    'forecast_receivables_30d_cents', private.metric(v_open_due, true, 'parcelas contratadas a vencer em 30 dias (CONTA A RECEBER)'),
    'forecast_payables_30d_cents', private.metric(v_pay_due, true, 'contas a pagar em aberto até 30 dias'),
    'forecast_subscriptions_next_month_cents', private.metric(v_sub, true, 'PROJEÇÃO de mensalidades do mês seguinte (não é conta a receber contratada)'),
    'active_students', private.metric(v_students, true, 'pessoas com acesso ativo a algum curso/mentoria (hoje)'),
    'certificates_issued', private.metric(v_cert, true, 'certificados emitidos (data de emissão)'),
    'completion_rate', private.metric(case when v_ent_total > 0 then round(( select count(*) from public.certificates where org_id = private.current_org() ) * 100.0 / v_ent_total, 1) end, v_ent_total > 0, 'certificados ÷ matrículas já concedidas (%)'),
    'nps', private.metric(case when v_resp >= 5 then round((v_prom - v_det) * 100.0 / v_resp, 0) end, v_resp >= 5, 'promotores(9-10) − detratores(0-6) em % (mínimo de 5 respostas)', jsonb_build_object('responses', v_resp)),
    'satisfaction_avg', private.metric(round(v_avg, 1), v_resp >= 5, 'nota média (mínimo de 5 respostas)'),
    'referrals', private.metric(v_refs, true, 'indicações registradas (data)'),
    'acquisition_cost', jsonb_build_object('value', null, 'available', false, 'basis', 'indisponível: não há dados de investimento em mídia no sistema')
  );
end $$;

-- alertas acionáveis
create or replace function public.dashboard_alerts(p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit);
begin
  return jsonb_build_array(
    jsonb_build_object('kind', 'leads_sem_retorno', 'label', 'Leads sem retorno há mais de 48h', 'link', '/admin/crm?filtro=sem-retorno',
      'count', (select count(*) from public.opportunities where unit_id = any (u) and status = 'open' and coalesce(last_contact_at, created_at) < now() - interval '48 hours')),
    jsonb_build_object('kind', 'cobrancas_vencidas', 'label', 'Parcelas vencidas', 'link', '/admin/financeiro',
      'count', (select count(*) from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and r.due_date < current_date)),
    jsonb_build_object('kind', 'pacotes_fim', 'label', 'Pacotes ativos com 2 sessões ou menos', 'link', '/admin/agenda',
      'count', (select count(*) from public.client_packages c where c.unit_id = any (u) and c.status = 'active' and private.package_balance(c.id) <= 2)),
    jsonb_build_object('kind', 'tarefas_atrasadas', 'label', 'Tarefas atrasadas', 'link', '/admin/crm',
      'count', (select count(*) from public.crm_tasks where unit_id = any (u) and done_at is null and due_at < now())),
    jsonb_build_object('kind', 'duplicidades', 'label', 'Possíveis duplicidades para revisar', 'link', '/admin/crm',
      'count', (select count(*) from public.crm_tasks where unit_id = any (u) and done_at is null and kind = 'dedupe_review')),
    jsonb_build_object('kind', 'eventos_falhos', 'label', 'Automações com falha', 'link', '/admin/auditoria',
      'count', (select count(*) from public.domain_events where org_id = private.current_org() and status in ('failed','dead')))
  );
end $$;

-- fluxo de caixa mensal: realizado x previsto (contratado). A projeção de mensalidades fica separada.
create or replace function public.cash_flow_monthly(p_from date, p_to date, p_unit uuid default null)
returns table (month date, realized_in_cents bigint, realized_out_cents bigint, forecast_in_cents bigint, forecast_out_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit);
begin
  return query
  select m::date,
    coalesce((select sum(case kind when 'payment' then amount_cents else -amount_cents end) from public.payments p where p.unit_id = any (u) and date_trunc('month', p.paid_at) = m), 0)::bigint,
    coalesce((select sum(amount_cents) from public.payables b where b.unit_id = any (u) and b.status = 'paid' and date_trunc('month', b.paid_at) = m), 0)::bigint,
    coalesce((select sum(r.amount_cents - private.receivable_net(r.id)) from public.receivables r where r.unit_id = any (u) and r.status in ('open','partial') and date_trunc('month', r.due_date) = m), 0)::bigint,
    coalesce((select sum(amount_cents) from public.payables b where b.unit_id = any (u) and b.status = 'open' and date_trunc('month', b.due_date) = m), 0)::bigint
  from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m;
end $$;

-- Resultados por produto (venda contratada × recebido × serviço realizado × receita reconhecida — regra gerencial PROPOSTA, a validar)
create or replace function public.results_by_product(p_from timestamptz, p_to timestamptz, p_unit uuid default null)
returns table (product_id uuid, product_name text, contracted_cents bigint, received_cents bigint, delivered_sessions bigint, recognized_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[] := private.dash_units(p_unit);
begin
  return query
  select p.id, p.name,
    coalesce((select sum(si.qty * si.unit_price_cents - si.discount_cents) from public.sale_items si join public.sales s on s.id = si.sale_id where si.product_id = p.id and s.unit_id = any (u) and s.status = 'confirmed' and s.sold_at >= p_from and s.sold_at < p_to), 0)::bigint,
    coalesce((select sum(case py.kind when 'payment' then py.amount_cents else -py.amount_cents end) from public.payments py join public.receivables r on r.id = py.receivable_id where r.product_id = p.id and py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to), 0)::bigint,
    coalesce((select count(*) from public.appointments a join public.client_packages c on c.id = a.client_package_id where c.product_id = p.id and a.unit_id = any (u) and a.status = 'attended' and lower(a.period) >= p_from and lower(a.period) < p_to), 0)::bigint,
    case when p.kind = 'package' and p.sessions_count is not null then
      coalesce((select count(*) from public.appointments a join public.client_packages c on c.id = a.client_package_id where c.product_id = p.id and a.unit_id = any (u) and a.status = 'attended' and lower(a.period) >= p_from and lower(a.period) < p_to), 0)::bigint * (p.price_cents / p.sessions_count)
    else coalesce((select sum(case py.kind when 'payment' then py.amount_cents else -py.amount_cents end) from public.payments py join public.receivables r on r.id = py.receivable_id where r.product_id = p.id and py.unit_id = any (u) and py.paid_at >= p_from and py.paid_at < p_to), 0)::bigint end
  from public.products p where p.org_id = private.current_org();
end $$;

grant execute on function public.dashboard_metrics(timestamptz, timestamptz, uuid), public.dashboard_alerts(uuid), public.cash_flow_monthly(date, date, uuid), public.results_by_product(timestamptz, timestamptz, uuid) to authenticated;
