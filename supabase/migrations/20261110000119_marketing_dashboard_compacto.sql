-- HP Group Hub — 119 Marketing: dashboard compacto (cartões e gráficos).
--  · evento 'contacted' (contato realizado = primeiro contato humano registrado na oportunidade) para o funil por coorte
--  · etapa de funil 'Contato realizado' + 3 funis padrão por coorte (Pacientes, Academy, Geral)
--  · mkt_series passa a devolver impressões, cliques e valor vendido por dia/semana (gráfico com seleção de métrica)
--  · mkt_overview: comparação por canal (Meta × Google) calculada no banco, pelos totais — sem somar taxas nem alcance
-- Só acrescenta; nenhuma tabela ou dado existente é alterado.

-- ---------------------------------------------------------------- 1) evento 'contacted' (primeiro contato humano)
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
  select 'contacted', x.opp_id, x.person_id, x.opp_id, o.first_response_at, null::bigint, pe.full_name, 'Contato realizado · ' || coalesce(cm.name, '—'), null::text, x.campaign_id
    from ofx x join o on o.opp_id = x.opp_id join pe on pe.id = x.person_id left join cm on cm.id = x.campaign_id
   where (p_kind is null or p_kind = 'contacted') and o.first_response_at is not null
     and case when p_view = 'cohort' then x.opp_id in (select opp_id from cohort) else private.mkt_day(o.first_response_at) between p_from and p_to end
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
-- ---------------------------------------------------------------- 2) detalhamento do indicador reconhece 'contacted'
create or replace function public.mkt_indicator_detail(p_kind text, p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; v_org uuid := private.mkt_require_reader(); items jsonb; total bigint; lbl text; basis text; route text := '/admin/marketing'; cur text; v_sum numeric := null; f jsonb; st public.mkt_settings;
  ev_kinds text[] := array['lead','contacted','opportunity','qualified','scheduled','attended','sold','received','won','lost','eval_scheduled','eval_done','appt_attended','appt_no_show','appt_cancel_patient','appt_cancel_clinic','sale','new_buyer','repeat_buyer',
                           'expansion_buyer','enrollment','payment','partner_approved','partner_active'];
begin
  u := private.mkt_units_scope(p_filters); select * into st from public.mkt_settings where org_id = v_org; cur := coalesce(st.reporting_currency, 'BRL');
  if p_kind = any (ev_kinds) then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', x.rec_id::text, 'title', x.title, 'subtitle', x.subtitle, 'amount_cents', case when x.cents > 0 then x.cents end, 'date', x.ev_at, 'tag', x.tag) order by x.ev_at desc nulls last) filter (where x.rn <= 200), '[]')
      into total, items from (select e.*, row_number() over (order by e.ev_at desc nulls last) rn from private.mkt_events(p_kind, p_from, p_to, p_filters, p_view, u) e) x;
    lbl := (select label from (values ('lead','Leads únicos'),('contacted','Leads com contato realizado'),('opportunity','Oportunidades criadas'),('qualified','Leads qualificados'),('scheduled','Oportunidades com agendamento'),('attended','Oportunidades com comparecimento'),('sold','Oportunidades com venda'),
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
-- ---------------------------------------------------------------- 3) etapa 'Contato realizado' e funis padrão por coorte
update public.mkt_funnel_step_types set position = position + 1 where position >= 4 and key <> 'contacted';
insert into public.mkt_funnel_step_types (key, label, source, description, position)
  values ('contacted', 'Contato realizado', 'hub', 'Oportunidades com o primeiro contato humano registrado (resposta da equipe ao lead).', 4)
  on conflict (key) do nothing;

create or replace function private.mkt_seed_cohort_funnels(p_org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mkt_funnels (org_id, name, steps, position)
  select p_org, v.name, v.steps::jsonb, (select coalesce(max(position), 0) from public.mkt_funnels where org_id = p_org) + v.ord
    from (values
      ('Pacientes: lead até protocolo (coorte)', '[{"kind":"lead"},{"kind":"contacted"},{"kind":"scheduled"},{"kind":"attended"},{"kind":"sold"}]', 1),
      ('Academy: lead até matrícula (coorte)', '[{"kind":"lead"},{"kind":"contacted"},{"kind":"qualified"},{"kind":"enrollment"}]', 2),
      ('Geral: lead até venda (coorte)', '[{"kind":"lead"},{"kind":"contacted"},{"kind":"qualified"},{"kind":"sold"}]', 3)) v(name, steps, ord)
   where not exists (select 1 from public.mkt_funnels f where f.org_id = p_org and f.name = v.name) and (select count(*) from public.mkt_funnels where org_id = p_org and active) < 12;
end $$;
revoke all on function private.mkt_seed_cohort_funnels(uuid) from public, anon, authenticated;
select private.mkt_seed_cohort_funnels(id) from public.organizations;

create or replace function public.mkt_funnels_list() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader();
begin
  perform private.mkt_seed_defaults(v_org); perform private.mkt_seed_cohort_funnels(v_org);
  return jsonb_build_object('funnels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'steps', steps, 'position', position) order by position, name), '[]') from public.mkt_funnels where org_id = v_org and active),
    'step_types', (select coalesce(jsonb_agg(to_jsonb(t) - 'position' order by t.position), '[]') from public.mkt_funnel_step_types t));
end $$;

-- ---------------------------------------------------------------- 4) série diária/semanal com impressões, cliques e valor vendido
create or replace function public.mkt_series(p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; v_week boolean := (p_to - p_from) > 92; res jsonb; cur text;
begin
  u := private.mkt_units_scope(p_filters); select coalesce((select reporting_currency from public.mkt_settings where org_id = private.current_org()), 'BRL') into cur;
  with d as (select date_trunc(case when v_week then 'week' else 'day' end, x)::date b from generate_series(p_from, p_to, '1 day') x group by 1),
  sp as (select date_trunc(case when v_week then 'week' else 'day' end, sd.day)::date b, sum(sd.spend) s, sum(sd.impressions) i, sum(sd.link_clicks) c from public.mkt_spend_daily sd join private.mkt_scope_campaigns(p_filters, u) sc on sc.campaign_id = sd.campaign_id
          where sd.resolution = 'active' and sd.currency = cur and sd.day between p_from and p_to group by 1),
  ev as (select date_trunc(case when v_week then 'week' else 'day' end, private.mkt_day(e.ev_at))::date b, e.kind, count(*) n, coalesce(sum(e.cents), 0) c from private.mkt_events(null, p_from, p_to, p_filters, p_view, u) e
          where e.kind in ('lead','qualified','sale','payment') and e.ev_at is not null group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object('day', d.b, 'spend', sp.s, 'impressions', sp.i, 'clicks', sp.c, 'leads', coalesce((select n from ev where ev.b = d.b and ev.kind = 'lead'), 0), 'qualified', coalesce((select n from ev where ev.b = d.b and ev.kind = 'qualified'), 0),
      'sales', coalesce((select n from ev where ev.b = d.b and ev.kind = 'sale'), 0), 'sold', coalesce((select c from ev where ev.b = d.b and ev.kind = 'sale'), 0) / 100.0, 'received', coalesce((select c from ev where ev.b = d.b and ev.kind = 'payment'), 0) / 100.0) order by d.b), '[]') into res
    from d left join sp on sp.b = d.b;
  return jsonb_build_object('granularity', case when v_week then 'week' else 'day' end, 'currency', cur, 'points', res,
    'note', 'Dias sem gasto aparecem em branco (sem dado), não como zero, quando não há cobertura.');
end $$;
-- ---------------------------------------------------------------- 5) visão por canal (Meta × Google) — pelos totais
-- Investimento/impressões/cliques: gasto efetivo (campanha × dia). Leads: pessoas distintas atribuídas a campanhas do canal. Vendas e valor: vendas confirmadas atribuídas a campanhas do canal.
-- CPL e ROAS são recalculados pelos totais do canal; sem gasto ou sem leads/vendas o campo vem nulo (a tela mostra “Sem base”).
create or replace function public.mkt_overview(p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_reader(); u uuid[]; cur text; res jsonb; v_sales bigint; v_sold numeric;
begin
  if p_view not in ('event','cohort') then raise exception 'visão inválida'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then raise exception 'período inválido'; end if;
  u := private.mkt_units_scope(p_filters); cur := coalesce((select reporting_currency from public.mkt_settings where org_id = v_org), 'BRL');
  select count(*), coalesce(sum(cents), 0) / 100.0 into v_sales, v_sold from private.mkt_events('sale', p_from, p_to, p_filters, p_view, u);
  with sc as materialized (select * from private.mkt_scope_campaigns(p_filters, u)),
  sp as (select sc.platform, sum(sd.spend) s, sum(sd.impressions) i, sum(sd.link_clicks) c, sum(sd.reported_results) r, count(*) n
           from public.mkt_spend_daily sd join sc on sc.campaign_id = sd.campaign_id where sd.resolution = 'active' and sd.currency = cur and sd.day between p_from and p_to group by sc.platform),
  ev as (select e.kind, e.person_id, e.cents, sc.platform from private.mkt_events(null, p_from, p_to, p_filters, p_view, u) e join sc on sc.campaign_id = e.campaign_id where e.kind in ('lead', 'sale')),
  ch as (select platform, count(distinct person_id) filter (where kind = 'lead') leads, count(*) filter (where kind = 'sale') sales, coalesce(sum(cents) filter (where kind = 'sale'), 0) / 100.0 sold from ev group by platform),
  pl as (select p platform from unnest(array['meta', 'google']) p)
  select jsonb_agg(jsonb_build_object('platform', pl.platform, 'has_campaigns', exists (select 1 from sc where sc.platform = pl.platform), 'spend', sp.s, 'impressions', sp.i, 'clicks', sp.c, 'reported_results', sp.r,
      'leads', coalesce(ch.leads, 0), 'sales', coalesce(ch.sales, 0), 'sold', coalesce(ch.sold, 0),
      'cpl', case when sp.s is not null and coalesce(ch.leads, 0) > 0 then round(sp.s / ch.leads, 2) end,
      'cpa', case when sp.s is not null and coalesce(ch.sales, 0) > 0 then round(sp.s / ch.sales, 2) end,
      'roas', case when sp.s > 0 then round(coalesce(ch.sold, 0) / sp.s, 2) end) order by pl.platform desc)
    into res from pl left join sp on sp.platform = pl.platform left join ch on ch.platform = pl.platform;
  return jsonb_build_object('currency', cur, 'view', p_view, 'period', jsonb_build_object('from', p_from, 'to', p_to), 'channels', res, 'sales_total', v_sales, 'sold_total', v_sold,
    'basis', 'Gasto efetivo por canal (campanha × dia); leads = pessoas distintas atribuídas a campanhas do canal; vendas e valor = vendas confirmadas atribuídas. CPL e ROAS recalculados pelos totais do canal.');
end $$;
revoke all on function public.mkt_overview(date, date, jsonb, text) from public, anon;
grant execute on function public.mkt_overview(date, date, jsonb, text) to authenticated;
-- ---------------------------------------------------------------- 6) campanhas devolvem todos os eventos por campanha (resultado principal configurado pelo administrador)
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
      'front', (select label from public.mkt_fronts where id = sc.front_id), 'purpose', (select label from public.mkt_purposes where id = sc.purpose_id), 'primary_result', coalesce(cl.primary_result, (select default_result from public.mkt_purposes where id = sc.purpose_id)),
      'spend', sp.s, 'impressions', sp.i, 'clicks', sp.c, 'reported_results', sp.r, 'other_currency', sp.other_cur,
      'ctr', case when sp.i > 0 and sp.c is not null then round(100.0 * sp.c / sp.i, 2) end, 'cpc', case when sp.c > 0 then round(sp.s / sp.c, 2) end,
      'leads', coalesce((select n from ev where ev.campaign_id = c.id and ev.kind = 'lead'), 0), 'qualified', coalesce((select n from ev where ev.campaign_id = c.id and ev.kind = 'qualified'), 0),
      'events', coalesce((select jsonb_object_agg(ev.kind, ev.n) from ev where ev.campaign_id = c.id), '{}'::jsonb), 'sales', coalesce((select n from ev where ev.campaign_id = c.id and ev.kind = 'sale'), 0), 'sold', coalesce((select cents from ev where ev.campaign_id = c.id and ev.kind = 'sale'), 0) / 100.0,
      'received', coalesce((select cents from ev where ev.campaign_id = c.id and ev.kind = 'payment'), 0) / 100.0,
      'cpl', case when coalesce((select n from ev where ev.campaign_id = c.id and ev.kind = 'lead'), 0) > 0 and sp.s is not null then round(sp.s / (select n from ev where ev.campaign_id = c.id and ev.kind = 'lead'), 2) end,
      'roas', case when sp.s > 0 then round(coalesce((select cents from ev where ev.campaign_id = c.id and ev.kind = 'sale'), 0) / 100.0 / sp.s, 2) end) order by sp.s desc nulls last, c.name), '[]') into res
    from sc join public.mkt_campaigns c on c.id = sc.campaign_id join public.mkt_ad_accounts a on a.id = c.account_id join public.mkt_campaign_class cl on cl.campaign_id = c.id left join sp on sp.campaign_id = c.id;
  return jsonb_build_object('currency', cur, 'view', p_view, 'rows', res);
end $$;

-- objetivo “Reconhecimento” (alcance/impressões): o administrador pode usá-lo ao classificar uma campanha; o cartão passa a priorizar impressões, CPM e cliques
insert into public.mkt_event_types (key, label, description, position)
  values ('awareness', 'Reconhecimento de marca', 'Campanha de alcance/impressões: o resultado principal é a exibição do anúncio, não um evento do Hub.', 11) on conflict (key) do nothing;
