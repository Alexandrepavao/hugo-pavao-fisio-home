-- HP Group Hub — 107 Marketing: indicadores, funil, comparativos, reconciliação, qualidade dos dados e detalhamento clicável.
--
-- UMA FONTE DE VERDADE: private.mkt_events() devolve os REGISTROS de cada evento (lead, qualificado, agendado, compareceu, venda, recebimento…). Os números dos cartões são contagens/somas dessas
-- mesmas linhas e o detalhamento (mkt_indicator_detail) lista essas linhas — por isso cartão e detalhe sempre reconciliam.
--
-- DUAS VISÕES (p_view): 'event' = cada evento na SUA data, dentro do período (leads pela criação, agendamentos pela criação do agendamento, comparecimento pela data do atendimento, venda pela data
--   da venda, recebimento pela data do pagamento);  'cohort' = os leads CAPTADOS no período e tudo o que aconteceu com eles depois, até a data de corte (hoje).
-- ATRIBUIÇÃO: modelo "último toque pago elegível" (docs/marketing-campanhas.md). Só oportunidades/vendas atribuídas a campanhas entram nos indicadores de campanha; o resto aparece na reconciliação.
-- FUSO: datas dos eventos do Hub em America/Sao_Paulo; gastos no dia da conta de anúncios.

create or replace function private.mkt_day(p_ts timestamptz) returns date language sql immutable set search_path = '' as $$ select (p_ts at time zone 'America/Sao_Paulo')::date $$;

create or replace function private.mkt_units_scope(p_f jsonb) returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader();
begin return private.crm_units(nullif(p_f ->> 'unit', '')::uuid); end $$;

-- ---------------------------------------------------------------- escopo: campanhas e contas que passam pelos filtros e pela permissão do usuário
create or replace function private.mkt_scope_campaigns(p_f jsonb, p_units uuid[]) returns table (campaign_id uuid, account_id uuid, platform text, name text, state text, include_in_hub boolean,
  include_in_reports boolean, front_id uuid, purpose_id uuid, product_id uuid, pipeline_id uuid, unit_id uuid)
language sql stable security definer set search_path = '' as $$
  select c.id, c.account_id, a.platform, c.name, cl.state, cl.include_in_hub, cl.include_in_reports, cl.front_id, cl.purpose_id, cl.product_id, cl.pipeline_id, coalesce(cl.unit_id, a.unit_id)
    from public.mkt_campaigns c join public.mkt_ad_accounts a on a.id = c.account_id join public.mkt_campaign_class cl on cl.campaign_id = c.id
   where c.org_id = private.current_org() and a.selected
     and ((coalesce(cl.unit_id, a.unit_id) is null and private.mkt_admin() and nullif(p_f ->> 'unit', '') is null) or coalesce(cl.unit_id, a.unit_id) = any (p_units))
     and (nullif(p_f ->> 'platform', '') is null or a.platform = p_f ->> 'platform')
     and (nullif(p_f ->> 'account', '') is null or a.id = (p_f ->> 'account')::uuid)
     and (nullif(p_f ->> 'campaign', '') is null or c.id = (p_f ->> 'campaign')::uuid)
     and (nullif(p_f ->> 'front', '') is null or (p_f ->> 'front' = 'none' and cl.front_id is null) or cl.front_id::text = p_f ->> 'front')
     and (nullif(p_f ->> 'purpose', '') is null or (p_f ->> 'purpose' = 'none' and cl.purpose_id is null) or cl.purpose_id::text = p_f ->> 'purpose')
     and (nullif(p_f ->> 'product', '') is null or cl.product_id::text = p_f ->> 'product')
     and (nullif(p_f ->> 'pipeline', '') is null or cl.pipeline_id::text = p_f ->> 'pipeline')
     and (nullif(p_f ->> 'state', '') is null or cl.state = p_f ->> 'state')
     and case coalesce(p_f ->> 'scope', 'hub') when 'hub' then cl.include_in_hub when 'reports' then cl.include_in_reports else true end
$$;
create or replace function private.mkt_has_class_filter(p_f jsonb) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(nullif(p_f ->> 'front', ''), nullif(p_f ->> 'purpose', ''), nullif(p_f ->> 'product', ''), nullif(p_f ->> 'pipeline', ''), nullif(p_f ->> 'campaign', ''), nullif(p_f ->> 'state', '')) is not null
$$;
create or replace function private.mkt_scope_accounts(p_f jsonb, p_units uuid[]) returns table (account_id uuid, platform text, origin text, name text, currency text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.platform, a.origin, a.name, a.currency from public.mkt_ad_accounts a
   where a.org_id = private.current_org() and a.selected
     and ((a.unit_id is null and private.mkt_admin() and nullif(p_f ->> 'unit', '') is null) or a.unit_id = any (p_units))
     and (nullif(p_f ->> 'platform', '') is null or a.platform = p_f ->> 'platform') and (nullif(p_f ->> 'account', '') is null or a.id = (p_f ->> 'account')::uuid)
     and (not private.mkt_has_class_filter(p_f) or a.id in (select s.account_id from private.mkt_scope_campaigns(p_f, p_units) s))
$$;

-- ---------------------------------------------------------------- linhas-base (oportunidades atribuídas, atendimentos, vendas, pagamentos)
create or replace function private.mkt_opp_rows(p_f jsonb, p_units uuid[]) returns table (opp_id uuid, person_id uuid, unit_id uuid, created_at timestamptz, status text, closed_at timestamptz,
  lost_reason_id uuid, owner_user_id uuid, pipeline_id uuid, campaign_id uuid, platform text, front_id uuid, purpose_id uuid, class_state text, qualified_at timestamptz, first_response_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with sc as (select * from private.mkt_scope_campaigns(p_f, p_units)), q as (select coalesce((select qualified_stage_ids from public.mkt_settings where org_id = private.current_org()), '{}') ids)
  select o.id, o.person_id, o.unit_id, o.created_at, o.status, o.closed_at, o.lost_reason_id, o.owner_user_id, o.pipeline_id, t.campaign_id, sc.platform, sc.front_id, sc.purpose_id, sc.state,
         coalesce((select min(e.created_at) from public.opportunity_events e where e.opportunity_id = o.id and e.to_stage_id = any (q.ids)),
                  case when o.stage_id = any (q.ids) then o.created_at end), o.first_response_at
    from q cross join public.mkt_attributions a join public.opportunities o on o.id = a.opportunity_id join public.mkt_touches t on t.id = a.touch_id join sc on sc.campaign_id = t.campaign_id
   where a.org_id = private.current_org() and a.outcome = 'attributed' and o.unit_id = any (p_units)
     and (nullif(p_f ->> 'owner', '') is null or o.owner_user_id = (p_f ->> 'owner')::uuid)
$$;
-- cada atendimento é ligado a UMA oportunidade: a do vínculo explícito; sem vínculo, a mais recente da pessoa criada até a criação do atendimento
create or replace function private.mkt_appt_rows(p_f jsonb, p_units uuid[]) returns table (ap_id uuid, opp_id uuid, person_id uuid, status text, created_at timestamptz, start_at timestamptz, service_id uuid, is_eval boolean)
language sql stable security definer set search_path = '' as $$
  with o as materialized (select * from private.mkt_opp_rows(p_f, p_units)),
  ev as (select coalesce((select evaluation_service_ids from public.mkt_settings where org_id = private.current_org()), '{}') ids),
  l as (select distinct on (ap.id) ap.id ap_id, o2.id opp_id, ap.person_id, ap.status, ap.created_at, lower(ap.period) start_at, ap.service_id
          from public.appointments ap join public.opportunities o2 on o2.org_id = ap.org_id and o2.person_id = ap.person_id and o2.created_at <= ap.created_at and (ap.opportunity_id is null or o2.id = ap.opportunity_id)
         where ap.org_id = private.current_org() and ap.person_id in (select person_id from o)
         order by ap.id, o2.created_at desc, o2.id desc)
  select l.ap_id, l.opp_id, l.person_id, l.status, l.created_at, l.start_at, l.service_id, l.service_id = any (ev.ids) from l cross join ev where l.opp_id in (select opp_id from o)
$$;
create or replace function private.mkt_sale_rows(p_f jsonb, p_units uuid[]) returns table (sale_id uuid, opp_id uuid, person_id uuid, sold_at timestamptz, total_cents bigint, customer_type text, link_basis text,
  campaign_id uuid, is_enrollment boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, sa.opportunity_id, s.person_id, coalesce(s.sold_at, s.created_at), s.total_cents, sa.customer_type, sa.link_basis, o.campaign_id,
         exists (select 1 from public.sale_items si join public.products pr on pr.id = si.product_id where si.sale_id = s.id and pr.kind in ('course','mentoring'))
    from public.mkt_sale_attributions sa join public.sales s on s.id = sa.sale_id and s.status = 'confirmed'
    join private.mkt_opp_rows(p_f, p_units) o on o.opp_id = sa.opportunity_id
   where sa.org_id = private.current_org() and sa.outcome = 'attributed' and s.unit_id = any (p_units)
$$;
create or replace function private.mkt_pay_rows(p_f jsonb, p_units uuid[]) returns table (payment_id uuid, sale_id uuid, paid_at timestamptz, cents bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, sr.sale_id, p.paid_at, case when p.kind = 'payment' then p.amount_cents else -p.amount_cents end
    from private.mkt_sale_rows(p_f, p_units) sr join public.receivables r on r.sale_id = sr.sale_id join public.payments p on p.receivable_id = r.id
$$;

-- ---------------------------------------------------------------- eventos (registros)
create or replace function private.mkt_events(p_kind text, p_from date, p_to date, p_f jsonb, p_view text, p_units uuid[])
returns table (kind text, rec_id uuid, person_id uuid, opp_id uuid, ev_at timestamptz, cents bigint, title text, subtitle text, tag text, campaign_id uuid)
language sql stable security definer set search_path = '' as $$
  with o as materialized (select * from private.mkt_opp_rows(p_f, p_units)),
  ap as materialized (select * from private.mkt_appt_rows(p_f, p_units)),
  sl as materialized (select * from private.mkt_sale_rows(p_f, p_units)),
  py as materialized (select * from private.mkt_pay_rows(p_f, p_units)),
  cm as (select id, name from public.mkt_campaigns where org_id = private.current_org()),
  pe as (select id, full_name from public.people where org_id = private.current_org() and id in (select person_id from o)),
  cohort as (select opp_id from o where private.mkt_day(created_at) between p_from and p_to),
  ofx as (select o.opp_id, o.person_id, o.created_at, o.campaign_id, o.status, o.closed_at,
            (select min(a.created_at) from ap a where a.opp_id = o.opp_id) first_sched,
            (select min(a.start_at) from ap a where a.opp_id = o.opp_id and a.status = 'attended') first_att,
            (select min(s.sold_at) from sl s where s.opp_id = o.opp_id) first_sale,
            (select min(y.paid_at) from py y join sl s on s.sale_id = y.sale_id where s.opp_id = o.opp_id and y.cents > 0) first_paid,
            (select coalesce(sum(y.cents), 0) from py y join sl s on s.sale_id = y.sale_id where s.opp_id = o.opp_id) net_paid
          from o),
  cur as (select (select partner_active_days from public.mkt_settings where org_id = private.current_org()) pad)
  -- oportunidades e leads (pessoas distintas)
  select 'opportunity', x.opp_id, x.person_id, x.opp_id, x.created_at, null::bigint, pe.full_name, 'Oportunidade · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id where (p_kind is null or p_kind = 'opportunity') and private.mkt_day(x.created_at) between p_from and p_to
  union all
  select 'lead', y.opp_id, y.person_id, y.opp_id, y.created_at, null::bigint, pe.full_name, 'Lead · ' || coalesce(cm.name, '—'), null::text, y.campaign_id
    from (select distinct on (x.person_id) x.* from ofx x where private.mkt_day(x.created_at) between p_from and p_to order by x.person_id, x.created_at) y
    join pe on pe.id = y.person_id left join cm on cm.id = y.campaign_id where (p_kind is null or p_kind = 'lead')
  union all
  select 'qualified', x.opp_id, x.person_id, x.opp_id, o.qualified_at, null::bigint, pe.full_name, 'Qualificado · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join o on o.opp_id = x.opp_id join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id
   where (p_kind is null or p_kind = 'qualified') and o.qualified_at is not null
     and case when p_view = 'cohort' then x.opp_id in (select opp_id from cohort) else private.mkt_day(o.qualified_at) between p_from and p_to end
  union all
  select 'scheduled', x.opp_id, x.person_id, x.opp_id, x.first_sched, null::bigint, pe.full_name, 'Agendamento · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id
   where (p_kind is null or p_kind = 'scheduled') and x.first_sched is not null and case when p_view = 'cohort' then x.opp_id in (select opp_id from cohort) else private.mkt_day(x.first_sched) between p_from and p_to end
  union all
  select 'attended', x.opp_id, x.person_id, x.opp_id, x.first_att, null::bigint, pe.full_name, 'Compareceu · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id
   where (p_kind is null or p_kind = 'attended') and x.first_att is not null and case when p_view = 'cohort' then x.opp_id in (select opp_id from cohort) else private.mkt_day(x.first_att) between p_from and p_to end
  union all
  select 'sold', x.opp_id, x.person_id, x.opp_id, x.first_sale, null::bigint, pe.full_name, 'Com venda · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id
   where (p_kind is null or p_kind = 'sold') and x.first_sale is not null and case when p_view = 'cohort' then x.opp_id in (select opp_id from cohort) else private.mkt_day(x.first_sale) between p_from and p_to end
  union all
  select 'received', x.opp_id, x.person_id, x.opp_id, x.first_paid, x.net_paid, pe.full_name, 'Com recebimento · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id
   where (p_kind is null or p_kind = 'received') and x.first_paid is not null and x.net_paid > 0 and case when p_view = 'cohort' then x.opp_id in (select opp_id from cohort) else private.mkt_day(x.first_paid) between p_from and p_to end
  union all
  select case x.status when 'won' then 'won' else 'lost' end, x.opp_id, x.person_id, x.opp_id, x.closed_at, null::bigint, pe.full_name, case x.status when 'won' then 'Ganha' else 'Perdida' end || ' · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id
   where x.status in ('won','lost') and (p_kind is null or p_kind = case x.status when 'won' then 'won' else 'lost' end)
     and case when p_view = 'cohort' then x.opp_id in (select opp_id from cohort) else private.mkt_day(x.closed_at) between p_from and p_to end
  -- atendimentos (cada um uma vez)
  union all
  select 'eval_scheduled', a.ap_id, a.person_id, a.opp_id, a.created_at, null::bigint, pe.full_name, 'Avaliação agendada · ' || coalesce(cm.name, '—'), a.status, o.campaign_id
    from ap a join o on o.opp_id = a.opp_id join pe on pe.id = a.person_id left join cm on cm.id = o.campaign_id
   where (p_kind is null or p_kind = 'eval_scheduled') and a.is_eval and a.status <> 'rescheduled' and case when p_view = 'cohort' then a.opp_id in (select opp_id from cohort) else private.mkt_day(a.created_at) between p_from and p_to end
  union all
  select 'eval_done', a.ap_id, a.person_id, a.opp_id, a.start_at, null::bigint, pe.full_name, 'Avaliação realizada · ' || coalesce(cm.name, '—'), a.status, o.campaign_id
    from ap a join o on o.opp_id = a.opp_id join pe on pe.id = a.person_id left join cm on cm.id = o.campaign_id
   where (p_kind is null or p_kind = 'eval_done') and a.is_eval and a.status = 'attended' and case when p_view = 'cohort' then a.opp_id in (select opp_id from cohort) else private.mkt_day(a.start_at) between p_from and p_to end
  union all
  select case a.status when 'attended' then 'appt_attended' when 'no_show' then 'appt_no_show' when 'cancelled_by_patient' then 'appt_cancel_patient' else 'appt_cancel_clinic' end,
         a.ap_id, a.person_id, a.opp_id, a.start_at, null::bigint, pe.full_name, 'Atendimento · ' || coalesce(cm.name, '—'), a.status, o.campaign_id
    from ap a join o on o.opp_id = a.opp_id join pe on pe.id = a.person_id left join cm on cm.id = o.campaign_id
   where a.status in ('attended','no_show','cancelled_by_patient','cancelled_by_clinic') and a.start_at <= now()
     and (p_kind is null or p_kind = case a.status when 'attended' then 'appt_attended' when 'no_show' then 'appt_no_show' when 'cancelled_by_patient' then 'appt_cancel_patient' else 'appt_cancel_clinic' end)
     and case when p_view = 'cohort' then a.opp_id in (select opp_id from cohort) else private.mkt_day(a.start_at) between p_from and p_to end
  -- vendas (cada venda uma vez) e tipo de cliente
  union all
  select 'sale', s.sale_id, s.person_id, s.opp_id, s.sold_at, s.total_cents, pe.full_name, 'Venda · ' || coalesce(cm.name, '—'), s.customer_type, s.campaign_id
    from sl s join pe on pe.id = s.person_id left join cm on cm.id = s.campaign_id
   where (p_kind is null or p_kind = 'sale') and case when p_view = 'cohort' then s.opp_id in (select opp_id from cohort) else private.mkt_day(s.sold_at) between p_from and p_to end
  union all
  select case s.customer_type when 'new' then 'new_buyer' when 'repeat' then 'repeat_buyer' else 'expansion_buyer' end, s.sale_id, s.person_id, s.opp_id, s.sold_at, s.total_cents, pe.full_name,
         case s.customer_type when 'new' then 'Cliente novo' when 'repeat' then 'Recompra' else 'Expansão' end || ' · ' || coalesce(cm.name, '—'), s.customer_type, s.campaign_id
    from sl s join pe on pe.id = s.person_id left join cm on cm.id = s.campaign_id
   where (p_kind is null or p_kind = case s.customer_type when 'new' then 'new_buyer' when 'repeat' then 'repeat_buyer' else 'expansion_buyer' end)
     and case when p_view = 'cohort' then s.opp_id in (select opp_id from cohort) else private.mkt_day(s.sold_at) between p_from and p_to end
  union all
  select 'enrollment', s.sale_id, s.person_id, s.opp_id, s.sold_at, s.total_cents, pe.full_name, 'Matrícula/mentoria · ' || coalesce(cm.name, '—'), s.customer_type, s.campaign_id
    from sl s join pe on pe.id = s.person_id left join cm on cm.id = s.campaign_id
   where (p_kind is null or p_kind = 'enrollment') and s.is_enrollment and case when p_view = 'cohort' then s.opp_id in (select opp_id from cohort) else private.mkt_day(s.sold_at) between p_from and p_to end
  -- recebimentos líquidos de estorno (cada pagamento/estorno uma vez)
  union all
  select 'payment', y.payment_id, s.person_id, s.opp_id, y.paid_at, y.cents, pe.full_name, case when y.cents < 0 then 'Estorno' else 'Recebimento' end || ' · ' || coalesce(cm.name, '—'), null::text, s.campaign_id
    from py y join sl s on s.sale_id = y.sale_id join pe on pe.id = s.person_id left join cm on cm.id = s.campaign_id
   where (p_kind is null or p_kind = 'payment') and case when p_view = 'cohort' then s.opp_id in (select opp_id from cohort) else private.mkt_day(y.paid_at) between p_from and p_to end
  -- parceiros
  union all
  select 'partner_approved', x.opp_id, x.person_id, x.opp_id, pp.approved_at, null::bigint, pe.full_name, 'Parceiro aprovado · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id join public.partner_profiles pp on pp.person_id = x.person_id and pp.approved_at is not null and pp.approved_at >= x.created_at
   where (p_kind is null or p_kind = 'partner_approved') and case when p_view = 'cohort' then x.opp_id in (select opp_id from cohort) else private.mkt_day(pp.approved_at) between p_from and p_to end
  union all
  select 'partner_active', x.opp_id, x.person_id, x.opp_id, pp.approved_at, null::bigint, pe.full_name, 'Parceiro ativo (indicou nos últimos ' || (select pad from cur) || ' dias) · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id join public.partner_profiles pp on pp.person_id = x.person_id and pp.approved_at is not null and pp.approved_at >= x.created_at
   where (p_kind is null or p_kind = 'partner_active') and (select pad from cur) is not null
     and exists (select 1 from public.referrals r where r.referrer_person_id = x.person_id and r.created_at >= now() - make_interval(days => (select pad from cur)))
     and case when p_view = 'cohort' then x.opp_id in (select opp_id from cohort) else private.mkt_day(pp.approved_at) between p_from and p_to end
$$;

-- ---------------------------------------------------------------- fatos agregados (gasto, cobertura, contagens, repasses) — base de todos os cartões
create or replace function private.mkt_facts(p_from date, p_to date, p_f jsonb, p_view text, p_units uuid[]) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare st public.mkt_settings; cur text; ev jsonb; sp jsonb; cov jsonb; fr jsonb; po jsonb; v_acc int; v_days int; v_exp int; v_ok int; v_fail int; v_stale int; v_last timestamptz; v_unlinked bigint;
begin
  select * into st from public.mkt_settings where org_id = private.current_org(); cur := coalesce(st.reporting_currency, 'BRL');
  select coalesce(jsonb_object_agg(kind, jsonb_build_object('n', n, 'cents', c)), '{}') into ev
    from (select kind, count(*) n, coalesce(sum(cents), 0) c from private.mkt_events(null, p_from, p_to, p_f, p_view, p_units) group by kind) x;
  -- gasto efetivo (linhas 'active'); moedas diferentes ficam separadas, nunca somadas
  select coalesce(jsonb_object_agg(currency, jsonb_build_object('spend', s, 'impressions', i, 'clicks', c, 'results', r, 'ctr_clicks', cc, 'ctr_impr', ci, 'cpc_spend', cs, 'cpm_spend', ms, 'rows', n)), '{}') into sp
    from (select sd.currency, sum(sd.spend) s, sum(sd.impressions) i, sum(sd.link_clicks) c, sum(sd.reported_results) r,
                 sum(sd.link_clicks) filter (where sd.impressions is not null and sd.link_clicks is not null) cc, sum(sd.impressions) filter (where sd.impressions is not null and sd.link_clicks is not null) ci,
                 sum(sd.spend) filter (where sd.link_clicks is not null) cs, sum(sd.spend) filter (where sd.impressions is not null) ms, count(*) n
            from public.mkt_spend_daily sd join private.mkt_scope_campaigns(p_f, p_units) sc on sc.campaign_id = sd.campaign_id
           where sd.resolution = 'active' and sd.day between p_from and p_to group by sd.currency) x;
  -- cobertura (conta × dia): coletado pela API com sucesso OU lançado manualmente
  select count(*) into v_acc from private.mkt_scope_accounts(p_f, p_units);
  v_days := greatest(0, least(p_to, (now() at time zone 'America/Sao_Paulo')::date) - p_from + 1);
  v_exp := v_acc * v_days;
  select count(*) filter (where cv), count(*) filter (where not cv and failed) into v_ok, v_fail from (
    select a.account_id, d::date dd, (exists (select 1 from public.mkt_day_status s where s.account_id = a.account_id and s.day = d::date and s.status = 'ok')
        or exists (select 1 from public.mkt_spend_daily m where m.account_id = a.account_id and m.day = d::date and m.source = 'manual')) cv,
      exists (select 1 from public.mkt_day_status s where s.account_id = a.account_id and s.day = d::date and s.status = 'failed') failed
    from private.mkt_scope_accounts(p_f, p_units) a, generate_series(p_from, least(p_to, (now() at time zone 'America/Sao_Paulo')::date), '1 day') d) z;
  select count(*), max(l) into v_stale, v_last from (select a.account_id, (select max(s.collected_at) from public.mkt_day_status s where s.account_id = a.account_id and s.status = 'ok') l
    from private.mkt_scope_accounts(p_f, p_units) a where a.origin = 'api') z where l is null or l < now() - make_interval(hours => st.stale_after_hours);
  cov := jsonb_build_object('accounts', v_acc, 'expected_days', v_exp, 'ok_days', coalesce(v_ok, 0), 'failed_days', coalesce(v_fail, 0), 'missing_days', greatest(0, v_exp - coalesce(v_ok, 0) - coalesce(v_fail, 0)),
    'stale_accounts', coalesce(v_stale, 0), 'last_ok_at', (select max(s.collected_at) from public.mkt_day_status s join private.mkt_scope_accounts(p_f, p_units) a on a.account_id = s.account_id where s.status = 'ok'),
    'incomplete', v_acc > 0 and coalesce(v_ok, 0) < v_exp);
  select jsonb_build_object('n', count(*), 'avg_min', round(avg(extract(epoch from (o.first_response_at - o.created_at)) / 60)::numeric, 1),
         'median_min', round((percentile_cont(0.5) within group (order by extract(epoch from (o.first_response_at - o.created_at)) / 60))::numeric, 1)) into fr
    from private.mkt_opp_rows(p_f, p_units) o where o.first_response_at is not null and o.first_response_at >= o.created_at and private.mkt_day(o.created_at) between p_from and p_to;
  -- repasses ligados às vendas desta leitura (pendente = apurado; autorizado = liberado; pago) — nunca misturados
  select jsonb_build_object('pending', coalesce(sum(pp.amount_cents) filter (where pp.status = 'pending'), 0), 'authorized', coalesce(sum(pp.amount_cents) filter (where pp.status = 'authorized'), 0),
         'paid', coalesce(sum(pp.amount_cents) filter (where pp.status = 'paid'), 0), 'rows', count(*)) into po
    from public.physio_payouts pp where pp.org_id = private.current_org() and pp.status <> 'void' and pp.sale_id in (select rec_id from private.mkt_events('sale', p_from, p_to, p_f, p_view, p_units));
  select count(*) into v_unlinked from public.mkt_attributions a join public.mkt_touches t on t.id = a.touch_id
   where a.org_id = private.current_org() and a.outcome = 'attributed' and t.campaign_id is null and private.mkt_day(a.opp_created_at) between p_from and p_to and a.unit_id = any (p_units);
  return jsonb_build_object('events', ev, 'spend', sp, 'coverage', cov, 'first_response', fr, 'payouts', po, 'currency', cur, 'unlinked_paid_leads', v_unlinked,
    'qualified_configured', coalesce(array_length(st.qualified_stage_ids, 1), 0) > 0, 'evaluation_configured', coalesce(array_length(st.evaluation_service_ids, 1), 0) > 0, 'partner_active_configured', st.partner_active_days is not null,
    'window_days', st.attribution_window_days, 'config_version', st.config_version, 'owner_filter', nullif(p_f ->> 'owner', '') is not null);
end $$;

-- ---------------------------------------------------------------- montagem de KPI (fórmula, fonte, granularidade, período, denominador, detalhamento)
create or replace function private.mkt_kpi(p_key text, p_label text, p_value numeric, p_unit text, p_available boolean, p_reason text, p_formula text, p_source text, p_gran text, p_denom text, p_detail text, p_warn text default null) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('key', p_key, 'label', p_label, 'value', case when p_available then p_value end, 'unit', p_unit, 'available', p_available, 'reason', case when not p_available then p_reason end,
    'formula', p_formula, 'source', p_source, 'granularity', p_gran, 'denominator', p_denom, 'detail', p_detail, 'warning', p_warn)
$$;
create or replace function private.mkt_num(p jsonb, p_key text, p_field text default 'n') returns numeric language sql immutable set search_path = '' as $$
  select coalesce((p -> 'events' -> p_key ->> p_field)::numeric, 0)
$$;

create or replace function private.mkt_kpi_list(f jsonb, p_view text) returns jsonb language plpgsql stable set search_path = '' as $$
declare cur text := f ->> 'currency'; s jsonb := f -> 'spend' -> (f ->> 'currency'); cov jsonb := f -> 'coverage'; has_sp boolean; spend numeric; impr numeric; clk numeric; resl numeric; warn text; r_nospend text; owner boolean := (f ->> 'owner_filter')::boolean;
  leads numeric := private.mkt_num(f, 'lead'); opps numeric := private.mkt_num(f, 'opportunity'); qual numeric := private.mkt_num(f, 'qualified'); sold_n numeric := private.mkt_num(f, 'sale'); sold_c numeric := private.mkt_num(f, 'sale', 'cents');
  rec_c numeric := private.mkt_num(f, 'payment', 'cents'); newb numeric := private.mkt_num(f, 'new_buyer'); att numeric := private.mkt_num(f, 'appt_attended'); nos numeric := private.mkt_num(f, 'appt_no_show');
  evs numeric := private.mkt_num(f, 'eval_scheduled'); evd numeric := private.mkt_num(f, 'eval_done'); pa numeric := private.mkt_num(f, 'partner_approved'); pact numeric := private.mkt_num(f, 'partner_active');
  pay jsonb := f -> 'payouts'; k jsonb := '[]'::jsonb; ptxt text := case p_view when 'cohort' then 'leads captados no período e o que aconteceu com eles até hoje' else 'cada evento na sua data, dentro do período' end;
  v_after numeric; v_cs numeric; v_cm numeric; ctr_c numeric; ctr_i numeric;
begin
  has_sp := s is not null and (cov ->> 'accounts')::int > 0;
  spend := (s ->> 'spend')::numeric; impr := (s ->> 'impressions')::numeric; clk := (s ->> 'clicks')::numeric; resl := (s ->> 'results')::numeric;
  warn := case when (cov ->> 'incomplete')::boolean then format('Cobertura parcial: %s de %s dias/conta coletados — o custo pode estar subestimado.', cov ->> 'ok_days', cov ->> 'expected_days') end;
  r_nospend := case when (cov ->> 'accounts')::int = 0 then 'Nenhuma conta de anúncios acompanhada (ou lançamento manual) neste escopo.' when (cov ->> 'ok_days')::int = 0 then 'Sem sincronização nem lançamento cobrindo o período — não é gasto zero.' when owner then 'Custo de mídia não pertence a um responsável.' else 'Sem gasto no escopo/moeda (' || cur || ').' end;
  has_sp := has_sp and (cov ->> 'ok_days')::int > 0 and not owner;
  ctr_c := (s ->> 'ctr_clicks')::numeric; ctr_i := (s ->> 'ctr_impr')::numeric; v_cs := (s ->> 'cpc_spend')::numeric; v_cm := (s ->> 'cpm_spend')::numeric;
  k := k
  -- MÍDIA
  || private.mkt_kpi('spend', 'Investimento', spend, cur, has_sp, r_nospend, 'soma do gasto efetivo (campanha × dia) das campanhas do escopo, na moeda de relatório', 'plataformas (API) e lançamentos manuais; sobreposição resolvida por conta × dia', 'campanha × dia', null, 'spend', warn)
  || private.mkt_kpi('impressions', 'Impressões', impr, 'n', has_sp and impr is not null, coalesce(nullif(r_nospend, ''), 'Sem impressões informadas.'), 'soma das impressões', 'plataformas', 'campanha × dia', null, 'spend', warn)
  || private.mkt_kpi('clicks', 'Cliques no link', clk, 'n', has_sp and clk is not null, coalesce(r_nospend, ''), 'Meta: inline_link_clicks (cliques no link); Google: metrics.clicks. Definição única no Hub', 'plataformas', 'campanha × dia', null, 'spend', warn)
  || private.mkt_kpi('ctr', 'CTR', case when ctr_i > 0 then round(100 * ctr_c / ctr_i, 2) end, '%', ctr_i > 0, 'Sem impressões com cliques informados.', 'cliques no link ÷ impressões × 100 (totais consolidados)', 'plataformas', 'campanha × dia', 'impressões', 'spend', warn)
  || private.mkt_kpi('cpc', 'CPC', case when v_cs > 0 and clk > 0 then round(v_cs / (select sum(x) from (select (s ->> 'clicks')::numeric x) q), 2) end, cur, v_cs is not null and clk > 0 and has_sp, 'Sem cliques informados.', 'gasto das linhas com cliques ÷ cliques no link', 'plataformas', 'campanha × dia', 'cliques', 'spend', warn)
  || private.mkt_kpi('cpm', 'CPM', case when impr > 0 and v_cm is not null then round(1000 * v_cm / impr, 2) end, cur, impr > 0 and has_sp, 'Sem impressões informadas.', 'gasto das linhas com impressões ÷ impressões × 1000', 'plataformas', 'campanha × dia', 'impressões', 'spend', warn)
  || private.mkt_kpi('reported_results', 'Resultados reportados pela plataforma', resl, 'n', has_sp and resl is not null, coalesce(r_nospend, ''), 'soma do “resultado” que Meta/Google informam — NÃO é conversão confirmada no Hub nem pessoas únicas', 'plataformas (reportado)', 'campanha × dia', null, 'spend', warn)
  -- CAPTAÇÃO E CRM
  || private.mkt_kpi('leads', 'Leads únicos', leads, 'n', true, null, 'pessoas distintas com oportunidade atribuída a campanha paga (' || ptxt || ')', 'Hub: captação → CRM', 'pessoa', null, 'lead')
  || private.mkt_kpi('opportunities', 'Oportunidades criadas', opps, 'n', true, null, 'oportunidades atribuídas a campanha paga', 'Hub: CRM', 'oportunidade', null, 'opportunity')
  || private.mkt_kpi('qualified', 'Leads qualificados', qual, 'n', (f ->> 'qualified_configured')::boolean, 'Defina em Configurações quais etapas do funil significam “qualificado”.', 'oportunidades que chegaram a uma etapa marcada como qualificação', 'Hub: CRM (histórico de etapas)', 'oportunidade', null, 'qualified')
  || private.mkt_kpi('cpl', 'Custo por lead (CPL)', case when leads > 0 then round(spend / leads, 2) end, cur, has_sp and leads > 0, case when not has_sp then r_nospend else 'Nenhum lead no período (denominador zero).' end, 'investimento ÷ leads únicos', 'plataformas + Hub', 'período', 'leads', 'lead', warn)
  || private.mkt_kpi('cpql', 'Custo por lead qualificado', case when qual > 0 then round(spend / qual, 2) end, cur, has_sp and qual > 0 and (f ->> 'qualified_configured')::boolean,
        case when not (f ->> 'qualified_configured')::boolean then 'Etapas de qualificação não configuradas.' when not has_sp then r_nospend else 'Nenhum lead qualificado no período (denominador zero).' end, 'investimento ÷ leads qualificados', 'plataformas + Hub', 'período', 'leads qualificados', 'qualified', warn)
  || private.mkt_kpi('first_response_min', 'Tempo até o primeiro contato humano', (f -> 'first_response' ->> 'avg_min')::numeric, 'min', (f -> 'first_response' ->> 'n')::int > 0, 'Nenhuma oportunidade do período com primeiro contato registrado.',
        'média de (primeira resposta registrada − criação) das oportunidades criadas no período; só as que têm registro', 'Hub: CRM', 'oportunidade', 'oportunidades com 1º contato registrado: ' || coalesce(f -> 'first_response' ->> 'n', '0'), 'opportunity')
  || private.mkt_kpi('won', 'Oportunidades ganhas', private.mkt_num(f, 'won'), 'n', true, null, 'oportunidades atribuídas com status ganha', 'Hub: CRM', 'oportunidade', null, 'won')
  || private.mkt_kpi('lost', 'Oportunidades perdidas', private.mkt_num(f, 'lost'), 'n', true, null, 'oportunidades atribuídas com status perdida', 'Hub: CRM', 'oportunidade', null, 'lost')
  -- FISIOTERAPIA
  || private.mkt_kpi('eval_scheduled', 'Avaliações agendadas', evs, 'n', (f ->> 'evaluation_configured')::boolean, 'Defina em Configurações quais serviços são “avaliação”.', 'agendamentos de serviços marcados como avaliação, de pacientes de campanhas', 'Hub: Agenda', 'agendamento', null, 'eval_scheduled')
  || private.mkt_kpi('eval_done', 'Avaliações realizadas', evd, 'n', (f ->> 'evaluation_configured')::boolean, 'Defina em Configurações quais serviços são “avaliação”.', 'atendimentos realizados de serviços marcados como avaliação', 'Hub: Agenda', 'atendimento', null, 'eval_done')
  || private.mkt_kpi('attendance_rate', 'Comparecimento', case when att + nos > 0 then round(100 * att / (att + nos), 1) end, '%', att + nos > 0, 'Nenhum atendimento realizado ou falta no período (denominador zero).', 'realizados ÷ (realizados + faltas). Cancelamentos ficam de fora e aparecem em separado', 'Hub: Agenda', 'atendimento', 'realizados + faltas', 'appt_attended')
  || private.mkt_kpi('no_show', 'Faltas', nos, 'n', true, null, 'atendimentos com status falta (passados)', 'Hub: Agenda', 'atendimento', null, 'appt_no_show')
  || private.mkt_kpi('cancel_patient', 'Cancelamentos pelo paciente', private.mkt_num(f, 'appt_cancel_patient'), 'n', true, null, 'atendimentos cancelados pelo paciente (passados)', 'Hub: Agenda', 'atendimento', null, 'appt_cancel_patient')
  || private.mkt_kpi('cancel_clinic', 'Cancelamentos pela clínica', private.mkt_num(f, 'appt_cancel_clinic'), 'n', true, null, 'atendimentos cancelados pela clínica (passados)', 'Hub: Agenda', 'atendimento', null, 'appt_cancel_clinic')
  || private.mkt_kpi('cost_per_eval', 'Custo por avaliação realizada', case when evd > 0 then round(spend / evd, 2) end, cur, has_sp and evd > 0 and (f ->> 'evaluation_configured')::boolean,
        case when not (f ->> 'evaluation_configured')::boolean then 'Serviços de avaliação não configurados.' when not has_sp then r_nospend else 'Nenhuma avaliação realizada (denominador zero).' end, 'investimento ÷ avaliações realizadas', 'plataformas + Agenda', 'período', 'avaliações realizadas', 'eval_done', warn)
  || private.mkt_kpi('eval_to_protocol', 'Conversão de avaliação em protocolo', null, '%', false, 'Calculado na aba Funil e atribuição (precisa da mesma coorte de avaliações com venda).', 'oportunidades com avaliação realizada e venda ÷ oportunidades com avaliação realizada', 'Hub', 'oportunidade', 'avaliações realizadas', 'eval_done')
  -- PARCEIROS
  || private.mkt_kpi('partner_approved', 'Parceiros aprovados', pa, 'n', true, null, 'parceiros com cadastro aprovado depois da oportunidade', 'Hub: Parceiros', 'pessoa', null, 'partner_approved')
  || private.mkt_kpi('partner_active', 'Parceiros ativos', pact, 'n', (f ->> 'partner_active_configured')::boolean, 'Defina em Configurações o critério de parceiro ativo (indicações nos últimos N dias).', 'aprovados com ao menos uma indicação nos últimos N dias (situação de hoje)', 'Hub: Parceiros', 'pessoa', null, 'partner_active')
  || private.mkt_kpi('cost_per_partner_approved', 'Custo por parceiro aprovado', case when pa > 0 then round(spend / pa, 2) end, cur, has_sp and pa > 0, case when not has_sp then r_nospend else 'Nenhum parceiro aprovado (denominador zero).' end, 'investimento ÷ parceiros aprovados', 'plataformas + Hub', 'período', 'parceiros aprovados', 'partner_approved', warn)
  || private.mkt_kpi('cost_per_partner_active', 'Custo por parceiro ativo', case when pact > 0 then round(spend / pact, 2) end, cur, has_sp and pact > 0 and (f ->> 'partner_active_configured')::boolean,
        case when not (f ->> 'partner_active_configured')::boolean then 'Critério de parceiro ativo não configurado.' when not has_sp then r_nospend else 'Nenhum parceiro ativo (denominador zero).' end, 'investimento ÷ parceiros ativos', 'plataformas + Hub', 'período', 'parceiros ativos', 'partner_active', warn)
  -- ACADEMY / TECH (use o filtro Frente)
  || private.mkt_kpi('enrollments', 'Matrículas / mentorias vendidas', private.mkt_num(f, 'enrollment'), 'n', true, null, 'vendas confirmadas com item de curso ou mentoria', 'Hub: Financeiro', 'venda', null, 'enrollment')
  || private.mkt_kpi('buyers', 'Compradores', sold_n, 'n', true, null, 'vendas confirmadas atribuídas (cada venda uma vez)', 'Hub: Financeiro', 'venda', null, 'sale')
  || private.mkt_kpi('avg_ticket', 'Ticket médio', case when sold_n > 0 then round(sold_c / 100 / sold_n, 2) end, cur, sold_n > 0, 'Nenhuma venda no período (denominador zero).', 'valor vendido ÷ vendas confirmadas', 'Hub: Financeiro', 'venda', 'vendas', 'sale')
  || private.mkt_kpi('recurring_revenue', 'Receita recorrente atribuída', null, cur, false, 'Ainda não implementado: depende de contratos recorrentes com origem em venda atribuída. Parcelamento não é MRR.', 'MRR de contratos recorrentes reais ligados a vendas atribuídas', 'Hub: Recorrência', 'contrato', null, 'sale')
  -- FINANCEIRO
  || private.mkt_kpi('sold', 'Valor vendido', sold_c / 100, cur, true, null, 'soma de vendas confirmadas e atribuídas (cada venda uma vez; canceladas fora)', 'Hub: Financeiro', 'venda', null, 'sale')
  || private.mkt_kpi('received', 'Valor recebido (líquido de estornos)', rec_c / 100, cur, true, null, 'pagamentos − estornos das vendas atribuídas (' || case p_view when 'cohort' then 'até hoje' else 'pela data do pagamento' end || ')', 'Hub: Financeiro', 'pagamento', null, 'payment')
  || private.mkt_kpi('new_buyers', 'Novos compradores', newb, 'n', true, null, 'vendas de cliente novo (primeira compra confirmada da pessoa)', 'Hub: Financeiro', 'venda', null, 'new_buyer')
  || private.mkt_kpi('repeat_buyers', 'Recompras', private.mkt_num(f, 'repeat_buyer'), 'n', true, null, 'vendas de quem já comprou o mesmo produto', 'Hub: Financeiro', 'venda', null, 'repeat_buyer')
  || private.mkt_kpi('expansion_buyers', 'Expansão', private.mkt_num(f, 'expansion_buyer'), 'n', true, null, 'vendas de quem já comprou, com produto novo', 'Hub: Financeiro', 'venda', null, 'expansion_buyer')
  || private.mkt_kpi('media_cost_per_new_customer', 'Custo de mídia por novo cliente', case when newb > 0 then round(spend / newb, 2) end, cur, has_sp and newb > 0, case when not has_sp then r_nospend else 'Nenhum novo comprador (denominador zero).' end,
        'investimento em mídia ÷ novos compradores. NÃO é o CAC completo (não inclui equipe, ferramentas nem comissões)', 'plataformas + Financeiro', 'período', 'novos compradores', 'new_buyer', warn)
  || private.mkt_kpi('roas_sales', 'ROAS sobre vendas', case when spend > 0 then round(sold_c / 100 / spend, 2) end, 'x', has_sp and spend > 0, case when not has_sp then r_nospend else 'Sem investimento no período (denominador zero).' end, 'valor vendido ÷ investimento', 'Financeiro + plataformas', 'período', 'investimento', 'sale', warn)
  || private.mkt_kpi('return_on_receipts', 'Retorno sobre mídia (recebimentos)', case when spend > 0 then round(rec_c / 100 / spend, 2) end, 'x', has_sp and spend > 0, case when not has_sp then r_nospend else 'Sem investimento no período (denominador zero).' end, 'valor recebido líquido ÷ investimento', 'Financeiro + plataformas', 'período', 'investimento', 'payment', warn)
  || private.mkt_kpi('payouts_pending', 'Repasses apurados (a autorizar)', (pay ->> 'pending')::numeric / 100, cur, true, null, 'repasses de fisioterapeutas das vendas atribuídas, ainda não autorizados', 'Hub: Repasses', 'repasse', null, 'sale')
  || private.mkt_kpi('payouts_authorized', 'Repasses autorizados (a pagar)', (pay ->> 'authorized')::numeric / 100, cur, true, null, 'repasses autorizados e ainda não pagos', 'Hub: Repasses', 'repasse', null, 'sale')
  || private.mkt_kpi('payouts_paid', 'Repasses pagos', (pay ->> 'paid')::numeric / 100, cur, true, null, 'repasses já pagos', 'Hub: Repasses', 'repasse', null, 'sale');
  -- resultado após mídia e repasses: só na visão por coorte, com gasto coberto e custos identificados. Não é lucro líquido.
  v_after := rec_c / 100 - coalesce(spend, 0) - ((pay ->> 'authorized')::numeric + (pay ->> 'paid')::numeric) / 100;
  k := k || private.mkt_kpi('result_after_media_payouts', 'Resultado após mídia e repasses', v_after, cur, p_view = 'cohort' and has_sp and not (cov ->> 'incomplete')::boolean,
        case when p_view <> 'cohort' then 'Bases de tempo incompatíveis na visão por data do evento: use a visão por coorte.' when not has_sp then r_nospend else 'Cobertura de gasto incompleta no período.' end,
        'recebido líquido (coorte, até hoje) − investimento do período − repasses autorizados e pagos das vendas da coorte. Exclui repasses apurados ainda não autorizados, equipe, ferramentas e impostos. NÃO é lucro líquido', 'Financeiro + plataformas + Repasses', 'coorte', null, 'payment', warn);
  return k;
end $$;

-- ---------------------------------------------------------------- RPCs públicas
create or replace function public.mkt_kpis(p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; f jsonb; v_prev_from date; v_prev_to date; fp jsonb;
begin
  if p_view not in ('event','cohort') then raise exception 'visão inválida'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then raise exception 'período inválido'; end if;
  u := private.mkt_units_scope(p_filters); f := private.mkt_facts(p_from, p_to, p_filters, p_view, u);
  v_prev_to := p_from - 1; v_prev_from := v_prev_to - (p_to - p_from); fp := private.mkt_facts(v_prev_from, v_prev_to, p_filters, p_view, u);
  return jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to), 'previous_period', jsonb_build_object('from', v_prev_from, 'to', v_prev_to), 'view', p_view,
    'model', jsonb_build_object('name', 'Último toque pago elegível antes da criação da oportunidade', 'window_days', f ->> 'window_days', 'config_version', f ->> 'config_version'),
    'coverage', f -> 'coverage', 'currency', f ->> 'currency', 'other_currencies', (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(f -> 'spend') x(k, v) where k <> f ->> 'currency'),
    'kpis', private.mkt_kpi_list(f, p_view), 'previous_kpis', private.mkt_kpi_list(fp, p_view), 'unlinked_paid_leads', f -> 'unlinked_paid_leads');
end $$;

-- funil: contagem e conversão (consolidada pelos totais) + conversões REPORTADAS pelas plataformas × CONFIRMADAS no Hub, separadas
create or replace function public.mkt_funnel(p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; f jsonb; steps jsonb := '[]'::jsonb; keys text[] := array['lead','qualified','scheduled','attended','sold','received']; labels text[] := array['Lead','Qualificado','Agendamento','Comparecimento','Venda','Recebimento'];
  i int; prev numeric; first numeric; n numeric; av boolean; why text; sp jsonb;
begin
  if p_view not in ('event','cohort') then raise exception 'visão inválida'; end if;
  u := private.mkt_units_scope(p_filters); f := private.mkt_facts(p_from, p_to, p_filters, p_view, u);
  for i in 1..6 loop
    n := private.mkt_num(f, keys[i]); av := case keys[i] when 'qualified' then (f ->> 'qualified_configured')::boolean else true end; why := case when not av then 'Etapas de qualificação não configuradas.' end;
    steps := steps || jsonb_build_object('key', keys[i], 'label', labels[i], 'count', case when av then n end, 'available', av, 'reason', why,
      'rate_from_previous', case when av and prev is not null and prev > 0 then round(100 * n / prev, 1) end, 'rate_from_first', case when av and first is not null and first > 0 then round(100 * n / first, 1) end);
    if av then prev := n; end if; if i = 1 then first := n; end if;
  end loop;
  select coalesce(jsonb_object_agg(currency, jsonb_build_object('reported_results', r)), '{}') into sp from (select sd.currency, sum(sd.reported_results) r from public.mkt_spend_daily sd join private.mkt_scope_campaigns(p_filters, u) sc on sc.campaign_id = sd.campaign_id
    where sd.resolution = 'active' and sd.day between p_from and p_to group by 1) x;
  return jsonb_build_object('view', p_view, 'steps', steps, 'basis', case p_view when 'cohort' then 'Coorte: leads captados no período e tudo o que aconteceu com eles até hoje.' else 'Por data do evento: cada etapa contada na própria data, dentro do período — pode incluir leads captados antes.' end,
    'model', jsonb_build_object('name', 'Último toque pago elegível antes da criação da oportunidade', 'window_days', f ->> 'window_days'),
    'hub_confirmed', jsonb_build_object('leads', private.mkt_num(f, 'lead'), 'sales', private.mkt_num(f, 'sale'), 'new_buyers', private.mkt_num(f, 'new_buyer'), 'sold', private.mkt_num(f, 'sale', 'cents') / 100),
    'provider_reported', jsonb_build_object('by_currency', sp, 'note', 'Resultados reportados pelas plataformas (podem se sobrepor entre Meta e Google e não são pessoas únicas). Não são somados aos confirmados no Hub.'),
    'coverage', f -> 'coverage');
end $$;

-- série temporal (por dia ou semana) do gasto e dos eventos confirmados
create or replace function public.mkt_series(p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; v_week boolean := (p_to - p_from) > 92; res jsonb; cur text;
begin
  u := private.mkt_units_scope(p_filters); select coalesce((select reporting_currency from public.mkt_settings where org_id = private.current_org()), 'BRL') into cur;
  with d as (select date_trunc(case when v_week then 'week' else 'day' end, x)::date b from generate_series(p_from, p_to, '1 day') x group by 1),
  sp as (select date_trunc(case when v_week then 'week' else 'day' end, sd.day)::date b, sum(sd.spend) s from public.mkt_spend_daily sd join private.mkt_scope_campaigns(p_filters, u) sc on sc.campaign_id = sd.campaign_id
          where sd.resolution = 'active' and sd.currency = cur and sd.day between p_from and p_to group by 1),
  ev as (select date_trunc(case when v_week then 'week' else 'day' end, private.mkt_day(e.ev_at))::date b, e.kind, count(*) n, coalesce(sum(e.cents), 0) c from private.mkt_events(null, p_from, p_to, p_filters, p_view, u) e
          where e.kind in ('lead','qualified','sale','payment') and e.ev_at is not null group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object('day', d.b, 'spend', sp.s, 'leads', coalesce((select n from ev where ev.b = d.b and ev.kind = 'lead'), 0), 'qualified', coalesce((select n from ev where ev.b = d.b and ev.kind = 'qualified'), 0),
      'sales', coalesce((select n from ev where ev.b = d.b and ev.kind = 'sale'), 0), 'received', coalesce((select c from ev where ev.b = d.b and ev.kind = 'payment'), 0) / 100.0) order by d.b), '[]') into res
    from d left join sp on sp.b = d.b;
  return jsonb_build_object('granularity', case when v_week then 'week' else 'day' end, 'currency', cur, 'points', res,
    'note', 'Dias sem gasto aparecem em branco (sem dado), não como zero, quando não há cobertura.');
end $$;

-- comparativo de campanhas
create or replace function public.mkt_campaign_table(p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; cur text; res jsonb;
begin
  u := private.mkt_units_scope(p_filters); select coalesce((select reporting_currency from public.mkt_settings where org_id = private.current_org()), 'BRL') into cur;
  with sc as materialized (select * from private.mkt_scope_campaigns(p_filters, u)),
  sp as (select sd.campaign_id, sum(sd.spend) filter (where sd.currency = cur) s, sum(sd.impressions) filter (where sd.currency = cur) i, sum(sd.link_clicks) filter (where sd.currency = cur) c,
                sum(sd.reported_results) filter (where sd.currency = cur) r, count(distinct sd.currency) ncur, min(sd.currency) filter (where sd.currency <> cur) other_cur
           from public.mkt_spend_daily sd where sd.resolution = 'active' and sd.day between p_from and p_to and sd.campaign_id in (select campaign_id from sc) group by 1),
  ev as (select e.campaign_id, e.kind, count(*) n, coalesce(sum(e.cents), 0) cents from private.mkt_events(null, p_from, p_to, p_filters, p_view, u) e where e.campaign_id is not null group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object('campaign_id', c.id, 'name', c.name, 'platform', a.platform, 'account', a.name, 'external_id', c.external_id, 'origin', c.origin,
      'platform_objective', c.platform_objective, 'platform_status', c.platform_status, 'class_state', sc.state, 'include_in_hub', sc.include_in_hub, 'include_in_reports', sc.include_in_reports,
      'front', (select label from public.mkt_fronts where id = sc.front_id), 'purpose', (select label from public.mkt_purposes where id = sc.purpose_id), 'primary_result', cl.primary_result,
      'spend', sp.s, 'impressions', sp.i, 'clicks', sp.c, 'reported_results', sp.r, 'other_currency', sp.other_cur,
      'ctr', case when sp.i > 0 and sp.c is not null then round(100.0 * sp.c / sp.i, 2) end, 'cpc', case when sp.c > 0 then round(sp.s / sp.c, 2) end,
      'leads', coalesce((select n from ev where ev.campaign_id = c.id and ev.kind = 'lead'), 0), 'qualified', coalesce((select n from ev where ev.campaign_id = c.id and ev.kind = 'qualified'), 0),
      'sales', coalesce((select n from ev where ev.campaign_id = c.id and ev.kind = 'sale'), 0), 'sold', coalesce((select cents from ev where ev.campaign_id = c.id and ev.kind = 'sale'), 0) / 100.0,
      'received', coalesce((select cents from ev where ev.campaign_id = c.id and ev.kind = 'payment'), 0) / 100.0,
      'cpl', case when coalesce((select n from ev where ev.campaign_id = c.id and ev.kind = 'lead'), 0) > 0 and sp.s is not null then round(sp.s / (select n from ev where ev.campaign_id = c.id and ev.kind = 'lead'), 2) end,
      'roas', case when sp.s > 0 then round(coalesce((select cents from ev where ev.campaign_id = c.id and ev.kind = 'sale'), 0) / 100.0 / sp.s, 2) end) order by sp.s desc nulls last, c.name), '[]') into res
    from sc join public.mkt_campaigns c on c.id = sc.campaign_id join public.mkt_ad_accounts a on a.id = c.account_id join public.mkt_campaign_class cl on cl.campaign_id = c.id left join sp on sp.campaign_id = c.id;
  return jsonb_build_object('currency', cur, 'view', p_view, 'rows', res);
end $$;

-- comparativo de anúncios/criativos (detalhamento por conjunto/anúncio; nunca somado ao total da campanha)
create or replace function public.mkt_ads_table(p_from date, p_to date, p_filters jsonb default '{}', p_level text default 'ad') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; cur text; res jsonb;
begin
  if p_level not in ('ad','adset') then raise exception 'nível inválido'; end if;
  u := private.mkt_units_scope(p_filters); select coalesce((select reporting_currency from public.mkt_settings where org_id = private.current_org()), 'BRL') into cur;
  with sc as (select * from private.mkt_scope_campaigns(p_filters, u)),
  ed as (select e.adset_id, e.ad_id, e.campaign_id, sum(e.spend) s, sum(e.impressions) i, sum(e.link_clicks) c, sum(e.reported_results) r from public.mkt_entity_daily e
          where e.org_id = private.current_org() and e.level = p_level and e.currency = cur and e.day between p_from and p_to and e.campaign_id in (select campaign_id from sc) group by 1, 2, 3)
  select coalesce(jsonb_agg(jsonb_build_object('id', coalesce(ed.ad_id, ed.adset_id), 'name', coalesce(ad.name, ads.name), 'status', coalesce(ad.platform_status, ads.platform_status), 'creative', ad.creative_name, 'campaign', c.name,
      'spend', ed.s, 'impressions', ed.i, 'clicks', ed.c, 'reported_results', ed.r, 'ctr', case when ed.i > 0 and ed.c is not null then round(100.0 * ed.c / ed.i, 2) end, 'cpc', case when ed.c > 0 then round(ed.s / ed.c, 2) end) order by ed.s desc), '[]') into res
    from ed join public.mkt_campaigns c on c.id = ed.campaign_id left join public.mkt_ads ad on ad.id = ed.ad_id left join public.mkt_adsets ads on ads.id = ed.adset_id;
  return jsonb_build_object('currency', cur, 'level', p_level, 'rows', res,
    'note', 'Anúncios e conjuntos mostram só mídia da plataforma. Leads, vendas e recebimentos do Hub são atribuídos por campanha (a atribuição só alcança o anúncio quando o link traz o id do anúncio — fase futura).',
    'breakdowns', (select coalesce(jsonb_agg(jsonb_build_object('kind', b.kind, 'value', b.value, 'spend', b.s, 'impressions', b.i, 'clicks', b.c) order by b.s desc), '[]')
                     from (select kind, value, sum(spend) s, sum(impressions) i, sum(link_clicks) c from public.mkt_breakdown_daily where org_id = private.current_org() and currency = cur and day between p_from and p_to
                              and campaign_id in (select campaign_id from sc) group by 1, 2) b));
end $$;

-- reconciliação do gasto: partes que fecham no total (inclui "Aguardando classificação" e "Fora do dashboard")
create or replace function public.mkt_reconciliation(p_from date, p_to date, p_filters jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; f jsonb := coalesce(p_filters, '{}') || jsonb_build_object('scope', 'all'); cur text; total numeric; parts jsonb; sum_parts numeric; other jsonb; superseded numeric;
begin
  u := private.mkt_units_scope(f); select coalesce((select reporting_currency from public.mkt_settings where org_id = private.current_org()), 'BRL') into cur;
  select coalesce(sum(sd.spend), 0) into total from public.mkt_spend_daily sd join private.mkt_scope_campaigns(f, u) sc on sc.campaign_id = sd.campaign_id where sd.resolution = 'active' and sd.currency = cur and sd.day between p_from and p_to;
  select coalesce(jsonb_agg(jsonb_build_object('key', g.k, 'label', g.l, 'spend', g.s, 'campaigns', g.n) order by g.o, g.l), '[]'), coalesce(sum(g.s), 0) into parts, sum_parts from (
    select case when not sc.include_in_hub then 'hidden' when sc.state = 'pending' then 'pending' else 'front:' || coalesce(sc.front_id::text, 'none') end k,
           case when not sc.include_in_hub then 'Fora do dashboard (acompanhamento desligado no Hub)' when sc.state = 'pending' then 'Aguardando classificação / Não classificado' else coalesce((select label from public.mkt_fronts where id = sc.front_id), 'Sem frente') end l,
           case when not sc.include_in_hub then 3 when sc.state = 'pending' then 2 else 1 end o, sum(sd.spend) s, count(distinct sc.campaign_id) n
      from public.mkt_spend_daily sd join private.mkt_scope_campaigns(f, u) sc on sc.campaign_id = sd.campaign_id
     where sd.resolution = 'active' and sd.currency = cur and sd.day between p_from and p_to group by 1, 2, 3) g;
  select coalesce(jsonb_object_agg(sd.currency, sd.s), '{}') into other from (select sd.currency, sum(sd.spend) s from public.mkt_spend_daily sd join private.mkt_scope_campaigns(f, u) sc on sc.campaign_id = sd.campaign_id
    where sd.resolution = 'active' and sd.currency <> cur and sd.day between p_from and p_to group by 1) sd;
  select coalesce(sum(sd.spend), 0) into superseded from public.mkt_spend_daily sd join private.mkt_scope_campaigns(f, u) sc on sc.campaign_id = sd.campaign_id where sd.resolution <> 'active' and sd.currency = cur and sd.day between p_from and p_to;
  return jsonb_build_object('currency', cur, 'total', total, 'parts', parts, 'sum_of_parts', sum_parts, 'reconciles', abs(total - sum_parts) < 0.005,
    'other_currencies_not_summed', other, 'excluded_by_overlap', superseded,
    'note', 'O total é o gasto efetivo (campanha × dia) na moeda de relatório. “Excluído por sobreposição” são lançamentos manuais/API substituídos por conta × dia (fora da soma). Moedas diferentes ficam à parte, sem conversão.');
end $$;

-- painel de qualidade dos dados
create or replace function public.mkt_quality(p_from date, p_to date, p_filters jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; v_org uuid := private.mkt_require_reader(); st public.mkt_settings; items jsonb := '[]'::jsonb; n bigint; c numeric;
begin
  u := private.mkt_units_scope(p_filters); select * into st from public.mkt_settings where org_id = v_org;
  select count(*) into n from public.mkt_attributions a where a.org_id = v_org and a.outcome = 'no_touch' and private.mkt_day(a.opp_created_at) between p_from and p_to and a.unit_id = any (u);
  items := items || jsonb_build_object('key', 'leads_no_origin', 'label', 'Leads sem origem registrada', 'count', n, 'severity', case when n > 0 then 'warn' else 'ok' end, 'detail', 'q_leads_no_origin',
     'hint', 'Oportunidades criadas sem nenhum toque rastreado (ex.: cadastro manual no CRM ou formulário sem UTM).');
  select count(*) into n from public.mkt_attributions a where a.org_id = v_org and a.outcome = 'organic' and private.mkt_day(a.opp_created_at) between p_from and p_to and a.unit_id = any (u);
  items := items || jsonb_build_object('key', 'leads_organic', 'label', 'Leads com origem não paga', 'count', n, 'severity', 'info', 'detail', 'q_leads_organic', 'hint', 'Têm toque rastreado, mas nenhum toque pago de Meta/Google dentro da janela de ' || st.attribution_window_days || ' dias.');
  select count(*), coalesce(sum(s.total_cents), 0) into n, c from public.mkt_sale_attributions sa join public.sales s on s.id = sa.sale_id and s.status = 'confirmed'
   where sa.org_id = v_org and sa.outcome <> 'attributed' and private.mkt_day(sa.sold_at) between p_from and p_to and sa.unit_id = any (u);
  items := items || jsonb_build_object('key', 'sales_unattributed', 'label', 'Vendas sem atribuição a campanha', 'count', n, 'amount', c / 100, 'severity', case when n > 0 then 'info' else 'ok' end, 'detail', 'q_sales_unattributed',
     'hint', 'Ficam visíveis como “sem atribuição”; a receita não é distribuída proporcionalmente entre campanhas.');
  select count(*) into n from public.mkt_sale_attributions sa where sa.org_id = v_org and sa.link_basis = 'person_latest_opportunity' and sa.outcome = 'attributed' and private.mkt_day(sa.sold_at) between p_from and p_to and sa.unit_id = any (u);
  items := items || jsonb_build_object('key', 'sales_by_person_link', 'label', 'Vendas ligadas pela oportunidade mais recente da pessoa', 'count', n, 'severity', case when n > 0 then 'info' else 'ok' end, 'detail', 'q_sales_person_link',
     'hint', 'A venda não trazia a oportunidade; foi ligada à mais recente da pessoa até a data da venda (regra documentada). Preencher a oportunidade na venda elimina a suposição.');
  select count(*) into n from public.mkt_touches t where t.org_id = v_org and t.is_paid and t.campaign_id is null and private.mkt_day(t.touched_at) between p_from and p_to;
  items := items || jsonb_build_object('key', 'paid_touch_no_campaign', 'label', 'Toques pagos sem campanha ligada', 'count', n, 'severity', case when n > 0 then 'warn' else 'ok' end, 'detail', 'q_paid_no_campaign',
     'hint', 'Vieram de Meta/Google, mas o id/nome não bate com uma campanha importada de conta autorizada. Use “Religar toques” depois de importar as campanhas.');
  select count(*) into n from public.mkt_touches t where t.org_id = v_org and t.campaign_link_basis = 'name_exact' and private.mkt_day(t.touched_at) between p_from and p_to;
  items := items || jsonb_build_object('key', 'touch_name_link', 'label', 'Toques ligados à campanha só pelo nome', 'count', n, 'severity', case when n > 0 then 'info' else 'ok' end, 'detail', 'q_touch_name_link',
     'hint', 'Ligação por nome exato e único; o ideal é o link trazer o id da campanha (hp_campaign_id).');
  select count(*) into n from public.mkt_campaign_class cl join public.mkt_campaigns c on c.id = cl.campaign_id join public.mkt_ad_accounts a on a.id = c.account_id where cl.org_id = v_org and cl.state = 'pending' and a.selected;
  items := items || jsonb_build_object('key', 'campaigns_pending', 'label', 'Campanhas aguardando classificação', 'count', n, 'severity', case when n > 0 then 'warn' else 'ok' end, 'detail', 'q_campaigns_pending',
     'hint', 'Seguem visíveis como “Não classificado” na reconciliação até o administrador classificar.');
  select count(*) into n from (select a.id from public.mkt_ad_accounts a where a.org_id = v_org and a.selected and exists (select 1 from public.mkt_day_status s where s.account_id = a.id and s.status = 'failed' and s.day >= current_date - 30)) z;
  items := items || jsonb_build_object('key', 'sync_incomplete', 'label', 'Contas com dias sem coleta (últimos 30 dias)', 'count', n, 'severity', case when n > 0 then 'bad' else 'ok' end, 'detail', 'q_sync_incomplete',
     'hint', 'Dias com falha de sincronização NÃO viram gasto zero: ficam sem dado até a próxima coleta bem-sucedida.');
  select count(*) into n from public.mkt_ad_accounts a where a.org_id = v_org and a.selected and a.origin = 'api' and coalesce((select max(s.collected_at) from public.mkt_day_status s where s.account_id = a.id and s.status = 'ok'), 'epoch') < now() - make_interval(hours => st.stale_after_hours);
  items := items || jsonb_build_object('key', 'stale', 'label', 'Contas com dados desatualizados', 'count', n, 'severity', case when n > 0 then 'warn' else 'ok' end, 'detail', 'q_stale',
     'hint', 'Última coleta bem-sucedida há mais de ' || st.stale_after_hours || ' h.');
  select count(*) into n from public.mkt_connections c where c.org_id = v_org and c.enabled and c.status in ('error','reauth_required');
  items := items || jsonb_build_object('key', 'connections_error', 'label', 'Conexões com erro ou que precisam reconectar', 'count', n, 'severity', case when n > 0 then 'bad' else 'ok' end, 'detail', 'q_connections', 'hint', 'Veja Integrações.');
  select count(*) into n from public.mkt_spend_daily sd where sd.org_id = v_org and sd.resolution <> 'active' and sd.day between p_from and p_to;
  items := items || jsonb_build_object('key', 'overlap', 'label', 'Lançamentos substituídos por sobreposição manual × API', 'count', n, 'severity', 'info', 'detail', 'q_overlap', 'hint', 'Fora da soma, para não contar o gasto duas vezes.');
  return jsonb_build_object('items', items, 'period', jsonb_build_object('from', p_from, 'to', p_to));
end $$;

-- opções dos filtros (respeita a permissão do usuário)
create or replace function public.mkt_filters() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); u uuid[] := private.crm_units(null);
begin
  perform private.mkt_seed_defaults(v_org);
  return jsonb_build_object(
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from public.units where id = any (u)),
    'fronts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label) order by position, label), '[]') from public.mkt_fronts where org_id = v_org and active),
    'purposes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label) order by position, label), '[]') from public.mkt_purposes where org_id = v_org and active),
    'platforms', (select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'enabled', enabled, 'status', status) order by platform), '[]') from public.mkt_connections where org_id = v_org),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'platform', platform, 'name', name, 'origin', origin) order by platform, name), '[]') from public.mkt_ad_accounts a where org_id = v_org and selected
                  and ((unit_id is null and private.mkt_admin()) or unit_id = any (u))),
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'account_id', c.account_id, 'state', cl.state) order by c.name), '[]')
                    from public.mkt_campaigns c join public.mkt_ad_accounts a on a.id = c.account_id join public.mkt_campaign_class cl on cl.campaign_id = c.id
                   where c.org_id = v_org and a.selected and ((coalesce(cl.unit_id, a.unit_id) is null and private.mkt_admin()) or coalesce(cl.unit_id, a.unit_id) = any (u))),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from public.products where org_id = v_org and active),
    'pipelines', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from public.pipelines where org_id = v_org and active),
    'owners', (select coalesce(jsonb_agg(jsonb_build_object('id', ua.user_id, 'name', ua.display_name) order by ua.display_name), '[]') from public.user_accounts ua
                where ua.org_id = v_org and ua.status = 'active' and ua.user_id in (select owner_user_id from public.opportunities where org_id = v_org and owner_user_id is not null)),
    'is_admin', private.mkt_admin());
end $$;

-- lista de campanhas para a tela de classificação (admin)
create or replace function public.mkt_campaigns_admin() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'platform', a.platform, 'account', a.name, 'account_id', a.id, 'origin', c.origin, 'external_id', c.external_id,
      'platform_objective', c.platform_objective, 'platform_status', c.platform_status, 'first_seen_at', c.first_seen_at, 'state', cl.state, 'include_in_hub', cl.include_in_hub, 'include_in_reports', cl.include_in_reports,
      'front_id', cl.front_id, 'purpose_id', cl.purpose_id, 'product_id', cl.product_id, 'pipeline_id', cl.pipeline_id, 'unit_id', cl.unit_id, 'primary_result', cl.primary_result,
      'spend_90d', (select sum(spend) from public.mkt_spend_daily sd where sd.campaign_id = c.id and sd.resolution = 'active' and sd.day >= current_date - 90))
      order by (cl.state = 'pending') desc, c.name)
    from public.mkt_campaigns c join public.mkt_ad_accounts a on a.id = c.account_id join public.mkt_campaign_class cl on cl.campaign_id = c.id where c.org_id = v_org and a.selected), '[]'::jsonb);
end $$;

-- detalhamento clicável: MESMAS linhas, filtros e visão dos cartões
create or replace function public.mkt_indicator_detail(p_kind text, p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; v_org uuid := private.mkt_require_reader(); items jsonb; total bigint; lbl text; basis text; route text := '/admin/marketing'; cur text; v_sum numeric := null; f jsonb; st public.mkt_settings;
  ev_kinds text[] := array['lead','opportunity','qualified','scheduled','attended','sold','received','won','lost','eval_scheduled','eval_done','appt_attended','appt_no_show','appt_cancel_patient','appt_cancel_clinic','sale','new_buyer','repeat_buyer',
                           'expansion_buyer','enrollment','payment','partner_approved','partner_active'];
begin
  u := private.mkt_units_scope(p_filters); select * into st from public.mkt_settings where org_id = v_org; cur := coalesce(st.reporting_currency, 'BRL');
  if p_kind = any (ev_kinds) then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', x.rec_id::text, 'title', x.title, 'subtitle', x.subtitle, 'amount_cents', case when x.cents > 0 then x.cents end, 'date', x.ev_at, 'tag', x.tag) order by x.ev_at desc nulls last) filter (where x.rn <= 200), '[]')
      into total, items from (select e.*, row_number() over (order by e.ev_at desc nulls last) rn from private.mkt_events(p_kind, p_from, p_to, p_filters, p_view, u) e) x;
    lbl := (select label from (values ('lead','Leads únicos'),('opportunity','Oportunidades criadas'),('qualified','Leads qualificados'),('scheduled','Oportunidades com agendamento'),('attended','Oportunidades com comparecimento'),('sold','Oportunidades com venda'),
      ('received','Oportunidades com recebimento'),('won','Oportunidades ganhas'),('lost','Oportunidades perdidas'),('eval_scheduled','Avaliações agendadas'),('eval_done','Avaliações realizadas'),('appt_attended','Atendimentos realizados'),
      ('appt_no_show','Faltas'),('appt_cancel_patient','Cancelamentos pelo paciente'),('appt_cancel_clinic','Cancelamentos pela clínica'),('sale','Vendas confirmadas'),('new_buyer','Novos compradores'),('repeat_buyer','Recompras'),
      ('expansion_buyer','Expansão'),('enrollment','Matrículas / mentorias'),('payment','Recebimentos e estornos'),('partner_approved','Parceiros aprovados'),('partner_active','Parceiros ativos')) v(k, label) where k = p_kind);
    basis := case p_view when 'cohort' then 'Coorte: leads captados no período e o que aconteceu com eles até hoje. ' else 'Por data do evento, dentro do período. ' end || 'Modelo: último toque pago elegível (janela ' || st.attribution_window_days || ' dias).';
    if p_kind in ('sale','payment','new_buyer','repeat_buyer','expansion_buyer','enrollment','received') then route := '/admin/financeiro/vendas?aba=vendas'; elsif p_kind in ('eval_scheduled','eval_done','appt_attended','appt_no_show','appt_cancel_patient','appt_cancel_clinic') then route := '/admin/agenda'; else route := '/admin/crm'; end if;
    return jsonb_build_object('kind', p_kind, 'label', lbl, 'value', total, 'basis', basis, 'is_current_snapshot', false, 'items', items, 'total_items', total, 'list_route', route);
  elsif p_kind in ('spend','impressions','clicks') then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', g.campaign_id::text, 'title', g.name, 'subtitle', g.account || ' · ' || g.platform || case when g.state = 'pending' then ' · Aguardando classificação' else '' end,
        'amount_cents', case when p_kind = 'spend' then round(g.s * 100)::bigint end, 'tag', case when p_kind <> 'spend' then to_char(g.n, 'FM999G999G999') end) order by g.s desc), '[]'), coalesce(sum(g.s), 0)
      into total, items, v_sum from (select sc.campaign_id, sc.name, a.name account, sc.platform, sc.state, sum(sd.spend) s, coalesce(sum(case p_kind when 'impressions' then sd.impressions when 'clicks' then sd.link_clicks end), 0) n
        from public.mkt_spend_daily sd join private.mkt_scope_campaigns(p_filters, u) sc on sc.campaign_id = sd.campaign_id join public.mkt_ad_accounts a on a.id = sc.account_id
       where sd.resolution = 'active' and sd.currency = cur and sd.day between p_from and p_to group by 1, 2, 3, 4, 5) g;
    return jsonb_build_object('kind', p_kind, 'label', case p_kind when 'spend' then 'Investimento por campanha' when 'impressions' then 'Impressões por campanha' else 'Cliques por campanha' end, 'value', total,
      'basis', 'Gasto efetivo (campanha × dia) em ' || cur || '. Total: ' || coalesce(to_char(v_sum, 'FM999G999G990D00'), '0') || '. Lançamentos substituídos por sobreposição ficam de fora.', 'is_current_snapshot', false, 'items', items, 'total_items', total, 'list_route', '/admin/marketing/campanhas');
  elsif p_kind = 'q_leads_no_origin' or p_kind = 'q_leads_organic' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', x.id::text, 'title', pe.full_name, 'subtitle', x.title, 'date', x.created_at) order by x.created_at desc) filter (where x.rn <= 200), '[]') into total, items
      from (select a.opportunity_id id, o.title, o.person_id, o.created_at, row_number() over (order by o.created_at desc) rn from public.mkt_attributions a join public.opportunities o on o.id = a.opportunity_id
             where a.org_id = v_org and a.outcome = case p_kind when 'q_leads_no_origin' then 'no_touch' else 'organic' end and private.mkt_day(a.opp_created_at) between p_from and p_to and a.unit_id = any (u)) x join public.people pe on pe.id = x.person_id;
    return jsonb_build_object('kind', p_kind, 'label', case p_kind when 'q_leads_no_origin' then 'Leads sem origem registrada' else 'Leads com origem não paga' end, 'value', total, 'basis', 'Oportunidades criadas no período.', 'is_current_snapshot', false, 'items', items, 'total_items', total, 'list_route', '/admin/crm');
  elsif p_kind in ('q_sales_unattributed','q_sales_person_link') then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', x.sale_id::text, 'title', pe.full_name, 'subtitle', x.sub, 'amount_cents', x.total_cents, 'date', x.sold_at) order by x.sold_at desc) filter (where x.rn <= 200), '[]') into total, items
      from (select sa.sale_id, s.person_id, s.total_cents, sa.sold_at, sa.outcome || ' · ' || sa.link_basis sub, row_number() over (order by sa.sold_at desc) rn from public.mkt_sale_attributions sa join public.sales s on s.id = sa.sale_id and s.status = 'confirmed'
             where sa.org_id = v_org and private.mkt_day(sa.sold_at) between p_from and p_to and sa.unit_id = any (u)
               and case p_kind when 'q_sales_unattributed' then sa.outcome <> 'attributed' else (sa.link_basis = 'person_latest_opportunity' and sa.outcome = 'attributed') end) x join public.people pe on pe.id = x.person_id;
    return jsonb_build_object('kind', p_kind, 'label', case p_kind when 'q_sales_unattributed' then 'Vendas sem atribuição a campanha' else 'Vendas ligadas pela oportunidade mais recente da pessoa' end, 'value', total, 'basis', 'Vendas confirmadas no período.', 'is_current_snapshot', false, 'items', items, 'total_items', total, 'list_route', '/admin/financeiro/vendas?aba=vendas');
  elsif p_kind in ('q_paid_no_campaign','q_touch_name_link') then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', x.id::text, 'title', coalesce(x.utm_campaign, '(sem nome de campanha)'), 'subtitle', x.platform || ' · ' || coalesce(x.source_ref, '') || coalesce(' · id ' || x.ext_campaign_id, ''), 'date', x.touched_at) order by x.touched_at desc) filter (where x.rn <= 200), '[]') into total, items
      from (select t.*, row_number() over (order by t.touched_at desc) rn from public.mkt_touches t where t.org_id = v_org and private.mkt_day(t.touched_at) between p_from and p_to
              and case p_kind when 'q_paid_no_campaign' then t.is_paid and t.campaign_id is null else t.campaign_link_basis = 'name_exact' end) x;
    return jsonb_build_object('kind', p_kind, 'label', case p_kind when 'q_paid_no_campaign' then 'Toques pagos sem campanha ligada' else 'Toques ligados à campanha só pelo nome' end, 'value', total, 'basis', 'Toques de formulário/quiz do período (sem dados pessoais).', 'is_current_snapshot', false, 'items', items, 'total_items', total, 'list_route', '/admin/marketing/funil');
  elsif p_kind = 'q_campaigns_pending' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', c.id::text, 'title', c.name, 'subtitle', a.platform || ' · ' || a.name, 'date', c.first_seen_at) order by c.first_seen_at desc), '[]') into total, items
      from public.mkt_campaign_class cl join public.mkt_campaigns c on c.id = cl.campaign_id join public.mkt_ad_accounts a on a.id = c.account_id where cl.org_id = v_org and cl.state = 'pending' and a.selected;
    return jsonb_build_object('kind', p_kind, 'label', 'Campanhas aguardando classificação', 'value', total, 'basis', 'Situação de hoje.', 'is_current_snapshot', true, 'items', items, 'total_items', total, 'list_route', '/admin/marketing/configuracoes');
  elsif p_kind in ('q_sync_incomplete','q_stale','q_connections','q_overlap') then
    if p_kind = 'q_overlap' then
      select count(*), coalesce(jsonb_agg(jsonb_build_object('id', x.id::text, 'title', c.name, 'subtitle', x.resolution || ' · ' || x.source, 'amount_cents', round(x.spend * 100)::bigint, 'date', x.day::timestamptz) order by x.day desc) filter (where x.rn <= 200), '[]') into total, items
        from (select sd.*, row_number() over (order by sd.day desc) rn from public.mkt_spend_daily sd where sd.org_id = v_org and sd.resolution <> 'active' and sd.day between p_from and p_to) x join public.mkt_campaigns c on c.id = x.campaign_id;
    elsif p_kind = 'q_connections' then
      select count(*), coalesce(jsonb_agg(jsonb_build_object('id', c.id::text, 'title', c.platform, 'subtitle', c.status || coalesce(' · ' || c.last_error, ''), 'date', c.last_error_at)), '[]') into total, items from public.mkt_connections c where c.org_id = v_org and c.enabled and c.status in ('error','reauth_required');
    else
      select count(*), coalesce(jsonb_agg(jsonb_build_object('id', a.id::text, 'title', a.name, 'subtitle', a.platform || ' · última coleta ' || coalesce(to_char((select max(s.collected_at) from public.mkt_day_status s where s.account_id = a.id and s.status = 'ok') at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'nunca'),
          'tag', case when p_kind = 'q_sync_incomplete' then (select count(*)::text || ' dia(s) falho(s)' from public.mkt_day_status s where s.account_id = a.id and s.status = 'failed' and s.day >= current_date - 30) end)), '[]') into total, items
        from public.mkt_ad_accounts a where a.org_id = v_org and a.selected and case p_kind when 'q_sync_incomplete' then exists (select 1 from public.mkt_day_status s where s.account_id = a.id and s.status = 'failed' and s.day >= current_date - 30)
          else a.origin = 'api' and coalesce((select max(s.collected_at) from public.mkt_day_status s where s.account_id = a.id and s.status = 'ok'), 'epoch') < now() - make_interval(hours => st.stale_after_hours) end;
    end if;
    return jsonb_build_object('kind', p_kind, 'label', case p_kind when 'q_sync_incomplete' then 'Contas com dias sem coleta' when 'q_stale' then 'Contas desatualizadas' when 'q_connections' then 'Conexões com erro' else 'Lançamentos substituídos' end,
      'value', total, 'basis', 'Falha de sincronização não vira gasto zero.', 'is_current_snapshot', p_kind <> 'q_overlap', 'items', items, 'total_items', total, 'list_route', '/admin/marketing/integracoes');
  end if;
  raise exception 'indicador desconhecido';
end $$;

do $$ declare f text; begin
  foreach f in array array['mkt_kpis(date,date,jsonb,text)','mkt_funnel(date,date,jsonb,text)','mkt_series(date,date,jsonb,text)','mkt_campaign_table(date,date,jsonb,text)','mkt_ads_table(date,date,jsonb,text)','mkt_reconciliation(date,date,jsonb)',
    'mkt_quality(date,date,jsonb)','mkt_filters()','mkt_campaigns_admin()','mkt_indicator_detail(text,date,date,jsonb,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f); execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function private.mkt_day(timestamptz), private.mkt_units_scope(jsonb), private.mkt_scope_campaigns(jsonb, uuid[]), private.mkt_has_class_filter(jsonb), private.mkt_scope_accounts(jsonb, uuid[]),
  private.mkt_opp_rows(jsonb, uuid[]), private.mkt_appt_rows(jsonb, uuid[]), private.mkt_sale_rows(jsonb, uuid[]), private.mkt_pay_rows(jsonb, uuid[]), private.mkt_events(text, date, date, jsonb, text, uuid[]),
  private.mkt_facts(date, date, jsonb, text, uuid[]), private.mkt_kpi(text, text, numeric, text, boolean, text, text, text, text, text, text, text), private.mkt_num(jsonb, text, text), private.mkt_kpi_list(jsonb, text) from public, anon, authenticated;
