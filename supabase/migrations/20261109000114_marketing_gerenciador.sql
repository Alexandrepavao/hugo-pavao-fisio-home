-- HP Group Hub — 114 Marketing: GERENCIADOR de anúncios hierárquico (campanha → conjunto/grupo → anúncio), no estilo de gerenciadores de tráfego:
-- colunas de mídia da plataforma + resultados CONFIRMADOS no Hub (leads, MQL, SAL, vendas, recebido), custo por etapa (CPL, CPMQL, CPSAL, CPA) e janelas 7-3-1.
--  • MQL = lead qualificado (etapas configuradas) · SAL = oportunidade com agendamento · Venda = venda confirmada atribuída (cada venda uma vez).
--  • A atribuição chega ao conjunto/anúncio quando o link do anúncio trouxe os ids (hp_adset_id/hp_ad_id) E o conjunto/anúncio foi importado da mesma campanha.
--    O que não traz id aparece na linha “Sem anúncio identificado” de cada campanha, para que as linhas filhas + essa linha FECHEM com a campanha.
--  • Gasto de conjunto/anúncio é detalhamento da plataforma (não soma ao total da campanha). Janelas 7-3-1 são sempre por data do evento, terminando no fim do período.

alter table public.mkt_touches add column adset_id uuid references public.mkt_adsets(id) on delete set null, add column ad_id uuid references public.mkt_ads(id) on delete set null;
alter table public.mkt_ads add column tags text[] not null default '{}' check (cardinality(tags) <= 12);
create index mkt_touches_ad on public.mkt_touches (ad_id) where ad_id is not null;

-- liga o toque à campanha (como antes) e agora também ao conjunto e ao anúncio importados DESSA campanha (por id; nada por nome)
create or replace function private.mkt_link_touch_campaign(p_touch uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.mkt_touches; v_c uuid; v_basis text;
begin
  select * into t from public.mkt_touches where id = p_touch; if t.id is null or t.platform not in ('meta','google') then return; end if;
  v_c := t.campaign_id; v_basis := t.campaign_link_basis;
  if v_c is null and t.ext_campaign_id is not null then
    select c.id into v_c from public.mkt_campaigns c join public.mkt_ad_accounts a on a.id = c.account_id
     where c.org_id = t.org_id and a.platform = t.platform and a.selected and c.external_id = t.ext_campaign_id limit 1;
    if v_c is not null then v_basis := 'campaign_id'; end if;
  end if;
  if v_c is null and coalesce(t.utm_campaign, '') <> '' then
    select min(c.id::text)::uuid into v_c from public.mkt_campaigns c join public.mkt_ad_accounts a on a.id = c.account_id
     where c.org_id = t.org_id and a.platform = t.platform and a.selected and lower(c.name) = lower(t.utm_campaign) having count(*) = 1;
    if v_c is not null then v_basis := 'name_exact'; end if;
  end if;
  if v_c is not null then
    update public.mkt_touches x set campaign_id = v_c, campaign_link_basis = coalesce(v_basis, x.campaign_link_basis),
      adset_id = coalesce(x.adset_id, (select s.id from public.mkt_adsets s where s.campaign_id = v_c and s.external_id = x.ext_adset_id)),
      ad_id = coalesce(x.ad_id, (select a.id from public.mkt_ads a where a.campaign_id = v_c and a.external_id = x.ext_ad_id)) where x.id = p_touch;
  end if;
end $$;
revoke all on function private.mkt_link_touch_campaign(uuid) from public, anon, authenticated;

-- religar também completa conjunto/anúncio de toques já ligados à campanha
create or replace function public.mkt_touches_relink() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); r record; n int := 0; n_ad bigint;
begin
  for r in select id from public.mkt_touches where org_id = v_org and platform in ('meta','google') and is_paid
            and (campaign_id is null or (ext_adset_id is not null and adset_id is null) or (ext_ad_id is not null and ad_id is null)) loop
    perform private.mkt_link_touch_campaign(r.id);
  end loop;
  select count(*) into n from public.mkt_touches where org_id = v_org and campaign_id is not null and campaign_link_basis is not null;
  select count(*) into n_ad from public.mkt_touches where org_id = v_org and ad_id is not null;
  insert into public.mkt_attribution_log (org_id, run_by, kind, changed, note) values (v_org, (select auth.uid()), 'relink', n, format('toques religados a campanhas importadas (%s com anúncio identificado)', n_ad));
  return jsonb_build_object('linked_total', n, 'with_ad', n_ad);
end $$;
revoke all on function public.mkt_touches_relink() from public, anon; grant execute on function public.mkt_touches_relink() to authenticated;

create or replace function public.mkt_ad_tags_set(p_ad uuid, p_tags text[]) returns text[] language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); v_t text[];
begin
  select coalesce(array_agg(distinct lower(left(btrim(x), 30))) filter (where btrim(x) <> ''), '{}') into v_t from unnest(coalesce(p_tags, '{}')) x;
  if cardinality(v_t) > 12 then raise exception 'no máximo 12 etiquetas'; end if;
  update public.mkt_ads set tags = v_t where id = p_ad and org_id = v_org; if not found then raise exception 'anúncio não encontrado' using errcode = '42501'; end if;
  return v_t;
end $$;
revoke all on function public.mkt_ad_tags_set(uuid, text[]) from public, anon; grant execute on function public.mkt_ad_tags_set(uuid, text[]) to authenticated;

create or replace function public.mkt_manager(p_from date, p_to date, p_filters jsonb default '{}', p_view text default 'event') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; cur text; res jsonb; w7 date := p_to - 6; w3 date := p_to - 2;
begin
  if p_view not in ('event','cohort') then raise exception 'visão inválida'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then raise exception 'período inválido'; end if;
  u := private.mkt_units_scope(p_filters); select coalesce((select reporting_currency from public.mkt_settings where org_id = private.current_org()), 'BRL') into cur;
  with sc as materialized (select * from private.mkt_scope_campaigns(p_filters, u)),
  ev as materialized (
    select e.kind, e.person_id, e.opp_id, e.ev_at, e.cents, e.campaign_id, t.adset_id, t.ad_id from private.mkt_events(null, p_from, p_to, p_filters, p_view, u) e
      left join public.mkt_attributions a on a.opportunity_id = e.opp_id left join public.mkt_touches t on t.id = a.touch_id where e.campaign_id is not null),
  evw as materialized (
    select e.kind, e.ev_at, e.cents, e.campaign_id, t.adset_id, t.ad_id from private.mkt_events(null, w7, p_to, p_filters, 'event', u) e
      left join public.mkt_attributions a on a.opportunity_id = e.opp_id left join public.mkt_touches t on t.id = a.touch_id where e.campaign_id is not null and e.kind in ('lead','qualified','sale')),
  hub as (select 'campaign'::text lvl, campaign_id, null::uuid adset_id, null::uuid ad_id, count(*) filter (where kind = 'lead') leads, count(*) filter (where kind = 'qualified') mql, count(*) filter (where kind = 'sale') sales, coalesce(sum(cents) filter (where kind = 'sale'), 0) sold, count(*) filter (where kind = 'scheduled') sal, count(*) filter (where kind = 'attended') attended, coalesce(sum(cents) filter (where kind = 'payment'), 0) rec, count(*) filter (where kind = 'new_buyer') newb from ev group by campaign_id union all select 'adset', campaign_id, adset_id, null::uuid, count(*) filter (where kind = 'lead') leads, count(*) filter (where kind = 'qualified') mql, count(*) filter (where kind = 'sale') sales, coalesce(sum(cents) filter (where kind = 'sale'), 0) sold, count(*) filter (where kind = 'scheduled') sal, count(*) filter (where kind = 'attended') attended, coalesce(sum(cents) filter (where kind = 'payment'), 0) rec, count(*) filter (where kind = 'new_buyer') newb from ev where adset_id is not null group by campaign_id, adset_id union all select 'ad', campaign_id, null::uuid, ad_id, count(*) filter (where kind = 'lead') leads, count(*) filter (where kind = 'qualified') mql, count(*) filter (where kind = 'sale') sales, coalesce(sum(cents) filter (where kind = 'sale'), 0) sold, count(*) filter (where kind = 'scheduled') sal, count(*) filter (where kind = 'attended') attended, coalesce(sum(cents) filter (where kind = 'payment'), 0) rec, count(*) filter (where kind = 'new_buyer') newb from ev where ad_id is not null group by campaign_id, ad_id union all select 'unidentified', campaign_id, null::uuid, null::uuid, count(*) filter (where kind = 'lead') leads, count(*) filter (where kind = 'qualified') mql, count(*) filter (where kind = 'sale') sales, coalesce(sum(cents) filter (where kind = 'sale'), 0) sold, count(*) filter (where kind = 'scheduled') sal, count(*) filter (where kind = 'attended') attended, coalesce(sum(cents) filter (where kind = 'payment'), 0) rec, count(*) filter (where kind = 'new_buyer') newb from ev where adset_id is null and ad_id is null group by campaign_id),
  hubw as (select 'campaign'::text lvl, campaign_id, null::uuid adset_id, null::uuid ad_id, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= w7) leads7, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= w7) mql7, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w7) sales7, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w7), 0) sold7, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= w3) leads3, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= w3) mql3, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w3) sales3, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w3), 0) sold3, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= p_to) leads1, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= p_to) mql1, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= p_to) sales1, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= p_to), 0) sold1 from evw group by campaign_id union all select 'adset', campaign_id, adset_id, null::uuid, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= w7) leads7, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= w7) mql7, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w7) sales7, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w7), 0) sold7, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= w3) leads3, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= w3) mql3, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w3) sales3, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w3), 0) sold3, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= p_to) leads1, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= p_to) mql1, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= p_to) sales1, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= p_to), 0) sold1 from evw where adset_id is not null group by campaign_id, adset_id union all select 'ad', campaign_id, null::uuid, ad_id, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= w7) leads7, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= w7) mql7, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w7) sales7, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w7), 0) sold7, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= w3) leads3, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= w3) mql3, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w3) sales3, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w3), 0) sold3, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= p_to) leads1, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= p_to) mql1, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= p_to) sales1, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= p_to), 0) sold1 from evw where ad_id is not null group by campaign_id, ad_id union all select 'unidentified', campaign_id, null::uuid, null::uuid, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= w7) leads7, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= w7) mql7, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w7) sales7, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w7), 0) sold7, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= w3) leads3, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= w3) mql3, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w3) sales3, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= w3), 0) sold3, count(*) filter (where kind = 'lead' and private.mkt_day(ev_at) >= p_to) leads1, count(*) filter (where kind = 'qualified' and private.mkt_day(ev_at) >= p_to) mql1, count(*) filter (where kind = 'sale' and private.mkt_day(ev_at) >= p_to) sales1, coalesce(sum(cents) filter (where kind = 'sale' and private.mkt_day(ev_at) >= p_to), 0) sold1 from evw where adset_id is null and ad_id is null group by campaign_id),
  spc as (select sd.campaign_id, sum(sd.spend) filter (where sd.day between p_from and p_to) s, sum(sd.spend) filter (where sd.day >= w7) s7, sum(sd.spend) filter (where sd.day >= w3) s3, sum(sd.spend) filter (where sd.day = p_to) s1,
                 sum(sd.impressions) filter (where sd.day between p_from and p_to) imp, sum(sd.link_clicks) filter (where sd.day between p_from and p_to) clk, sum(sd.reported_results) filter (where sd.day between p_from and p_to) rep
            from public.mkt_spend_daily sd join sc on sc.campaign_id = sd.campaign_id where sd.resolution = 'active' and sd.currency = cur and sd.day between least(p_from, w7) and p_to group by 1),
  spe as (select e.level, e.campaign_id, e.adset_id, e.ad_id, sum(e.spend) filter (where e.day between p_from and p_to) s, sum(e.spend) filter (where e.day >= w7) s7, sum(e.spend) filter (where e.day >= w3) s3, sum(e.spend) filter (where e.day = p_to) s1,
                 sum(e.impressions) filter (where e.day between p_from and p_to) imp, sum(e.link_clicks) filter (where e.day between p_from and p_to) clk, sum(e.reported_results) filter (where e.day between p_from and p_to) rep
            from public.mkt_entity_daily e where e.org_id = private.current_org() and e.currency = cur and e.campaign_id in (select campaign_id from sc) and e.day between least(p_from, w7) and p_to group by 1, 2, 3, 4),
  universe as (
    select 'campaign'::text lvl, sc.campaign_id, null::uuid adset_id, null::uuid ad_id from sc
    union select 'adset', campaign_id, adset_id, null::uuid from (select campaign_id, adset_id from spe where level = 'adset' union select campaign_id, adset_id from hub where lvl = 'adset') x
    union select 'ad', campaign_id, null::uuid, ad_id from (select campaign_id, ad_id from spe where level = 'ad' union select campaign_id, ad_id from hub where lvl = 'ad') y
    union select 'unidentified', campaign_id, null::uuid, null::uuid from hub where lvl = 'unidentified'),
  m as (
    select un.lvl, un.campaign_id, un.adset_id, un.ad_id,
           case un.lvl when 'campaign' then spc.s else spe.s end s, case un.lvl when 'campaign' then spc.s7 else spe.s7 end s7, case un.lvl when 'campaign' then spc.s3 else spe.s3 end s3, case un.lvl when 'campaign' then spc.s1 else spe.s1 end s1,
           case un.lvl when 'campaign' then spc.imp else spe.imp end imp, case un.lvl when 'campaign' then spc.clk else spe.clk end clk, case un.lvl when 'campaign' then spc.rep else spe.rep end rep,
           coalesce(h.leads, 0) leads, coalesce(h.mql, 0) mql, coalesce(h.sal, 0) sal, coalesce(h.attended, 0) attended, coalesce(h.sales, 0) sales, coalesce(h.sold, 0) sold, coalesce(h.rec, 0) rec, coalesce(h.newb, 0) newb,
           coalesce(w.leads7, 0) leads7, coalesce(w.mql7, 0) mql7, coalesce(w.sales7, 0) sales7, coalesce(w.sold7, 0) sold7, coalesce(w.leads3, 0) leads3, coalesce(w.mql3, 0) mql3, coalesce(w.sales3, 0) sales3, coalesce(w.sold3, 0) sold3,
           coalesce(w.leads1, 0) leads1, coalesce(w.mql1, 0) mql1, coalesce(w.sales1, 0) sales1, coalesce(w.sold1, 0) sold1
      from universe un
      left join spc on un.lvl = 'campaign' and spc.campaign_id = un.campaign_id
      left join spe on un.lvl in ('adset','ad') and spe.level = un.lvl and spe.campaign_id = un.campaign_id and spe.adset_id is not distinct from un.adset_id and spe.ad_id is not distinct from un.ad_id
      left join hub h on h.lvl = un.lvl and h.campaign_id = un.campaign_id and h.adset_id is not distinct from un.adset_id and h.ad_id is not distinct from un.ad_id
      left join hubw w on w.lvl = un.lvl and w.campaign_id = un.campaign_id and w.adset_id is not distinct from un.adset_id and w.ad_id is not distinct from un.ad_id)
  select coalesce(jsonb_agg(z.row_j order by z.ck desc nulls last, z.cname, z.lord, z.ord_s desc nulls last), '[]') into res from (
    select jsonb_build_object('level', m.lvl, 'campaign_id', m.campaign_id, 'adset_id', m.adset_id, 'ad_id', m.ad_id,
      'name', case m.lvl when 'campaign' then c.name when 'adset' then ads.name when 'ad' then ad.name else 'Sem anúncio identificado' end,
      'platform', a.platform, 'status', case m.lvl when 'campaign' then c.platform_status when 'adset' then ads.platform_status when 'ad' then ad.platform_status end,
      'objective', case when m.lvl = 'campaign' then c.platform_objective end, 'creative', case when m.lvl = 'ad' then ad.creative_name end, 'tags', case when m.lvl = 'ad' then to_jsonb(ad.tags) end,
      'class_state', sc.state, 'front', (select label from public.mkt_fronts where id = sc.front_id), 'purpose', (select label from public.mkt_purposes where id = sc.purpose_id),
      'spend', m.s, 'impressions', m.imp, 'clicks', m.clk, 'reported_results', m.rep, 'leads', m.leads, 'mql', m.mql, 'sal', m.sal, 'attended', m.attended, 'sales', m.sales, 'sold', m.sold / 100.0, 'received', m.rec / 100.0, 'new_buyers', m.newb,
      'ctr', case when m.imp > 0 and m.clk is not null then round(100.0 * m.clk / m.imp, 2) end, 'cpc', case when m.clk > 0 then round(m.s / m.clk, 2) end,
      'cpl', case when m.leads > 0 and m.s is not null then round(m.s / m.leads, 2) end, 'cpmql', case when m.mql > 0 and m.s is not null then round(m.s / m.mql, 2) end,
      'cpsal', case when m.sal > 0 and m.s is not null then round(m.s / m.sal, 2) end, 'cpa', case when m.sales > 0 and m.s is not null then round(m.s / m.sales, 2) end,
      'roas', case when m.s > 0 then round(m.sold / 100.0 / m.s, 2) end,
      'w', jsonb_build_object('d7', jsonb_build_object('spend', m.s7, 'leads', m.leads7, 'mql', m.mql7, 'sales', m.sales7, 'sold', m.sold7 / 100.0, 'roas', case when m.s7 > 0 then round(m.sold7 / 100.0 / m.s7, 2) end, 'cpl', case when m.leads7 > 0 and m.s7 is not null then round(m.s7 / m.leads7, 2) end, 'cpmql', case when m.mql7 > 0 and m.s7 is not null then round(m.s7 / m.mql7, 2) end), 'd3', jsonb_build_object('spend', m.s3, 'leads', m.leads3, 'mql', m.mql3, 'sales', m.sales3, 'sold', m.sold3 / 100.0, 'roas', case when m.s3 > 0 then round(m.sold3 / 100.0 / m.s3, 2) end, 'cpl', case when m.leads3 > 0 and m.s3 is not null then round(m.s3 / m.leads3, 2) end, 'cpmql', case when m.mql3 > 0 and m.s3 is not null then round(m.s3 / m.mql3, 2) end), 'd1', jsonb_build_object('spend', m.s1, 'leads', m.leads1, 'mql', m.mql1, 'sales', m.sales1, 'sold', m.sold1 / 100.0, 'roas', case when m.s1 > 0 then round(m.sold1 / 100.0 / m.s1, 2) end, 'cpl', case when m.leads1 > 0 and m.s1 is not null then round(m.s1 / m.leads1, 2) end, 'cpmql', case when m.mql1 > 0 and m.s1 is not null then round(m.s1 / m.mql1, 2) end))) row_j,
      (select x.s from spc x where x.campaign_id = m.campaign_id) ck, c.name cname, case m.lvl when 'campaign' then 0 when 'adset' then 1 when 'ad' then 2 else 3 end lord, m.s ord_s
      from m join public.mkt_campaigns c on c.id = m.campaign_id join public.mkt_ad_accounts a on a.id = c.account_id join sc on sc.campaign_id = c.id
      left join public.mkt_adsets ads on ads.id = m.adset_id left join public.mkt_ads ad on ad.id = m.ad_id) z;
  return jsonb_build_object('currency', cur, 'view', p_view, 'period', jsonb_build_object('from', p_from, 'to', p_to), 'windows', jsonb_build_object('d7', jsonb_build_array(w7, p_to), 'd3', jsonb_build_array(w3, p_to), 'd1', jsonb_build_array(p_to, p_to)), 'rows', res,
    'notes', jsonb_build_array('MQL = lead qualificado; SAL = oportunidade com agendamento; Venda = venda confirmada atribuída (cada uma uma vez).',
      'Gasto de conjunto/anúncio é detalhamento da plataforma e não soma ao total da campanha.', 'Janelas 7-3-1: por data do evento, terminando no fim do período.',
      'A atribuição só chega ao anúncio quando o link trouxe os ids; o restante fica em “Sem anúncio identificado”, que fecha com a campanha.'));
end $$;
revoke all on function public.mkt_manager(date, date, jsonb, text) from public, anon; grant execute on function public.mkt_manager(date, date, jsonb, text) to authenticated;
