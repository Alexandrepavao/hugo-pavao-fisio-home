-- HP Group Hub — 110 Marketing: corrige mkt_ads_table (o detalhamento por posicionamento referenciava um CTE fora do alcance).
create or replace function public.mkt_ads_table(p_from date, p_to date, p_filters jsonb default '{}', p_level text default 'ad') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid[]; cur text; res jsonb; bd jsonb;
begin
  if p_level not in ('ad','adset') then raise exception 'nível inválido'; end if;
  u := private.mkt_units_scope(p_filters); select coalesce((select reporting_currency from public.mkt_settings where org_id = private.current_org()), 'BRL') into cur;
  with sc as (select * from private.mkt_scope_campaigns(p_filters, u)),
  ed as (select e.adset_id, e.ad_id, e.campaign_id, sum(e.spend) s, sum(e.impressions) i, sum(e.link_clicks) c, sum(e.reported_results) r from public.mkt_entity_daily e
          where e.org_id = private.current_org() and e.level = p_level and e.currency = cur and e.day between p_from and p_to and e.campaign_id in (select campaign_id from sc) group by 1, 2, 3)
  select coalesce(jsonb_agg(jsonb_build_object('id', coalesce(ed.ad_id, ed.adset_id), 'name', coalesce(ad.name, ads.name), 'status', coalesce(ad.platform_status, ads.platform_status), 'creative', ad.creative_name, 'campaign', c.name,
      'spend', ed.s, 'impressions', ed.i, 'clicks', ed.c, 'reported_results', ed.r, 'ctr', case when ed.i > 0 and ed.c is not null then round(100.0 * ed.c / ed.i, 2) end, 'cpc', case when ed.c > 0 then round(ed.s / ed.c, 2) end) order by ed.s desc), '[]') into res
    from ed join public.mkt_campaigns c on c.id = ed.campaign_id left join public.mkt_ads ad on ad.id = ed.ad_id left join public.mkt_adsets ads on ads.id = ed.adset_id;
  select coalesce(jsonb_agg(jsonb_build_object('kind', b.kind, 'value', b.value, 'spend', b.s, 'impressions', b.i, 'clicks', b.c) order by b.s desc), '[]') into bd
    from (select kind, value, sum(spend) s, sum(impressions) i, sum(link_clicks) c from public.mkt_breakdown_daily
           where org_id = private.current_org() and currency = cur and day between p_from and p_to and campaign_id in (select campaign_id from private.mkt_scope_campaigns(p_filters, u)) group by 1, 2) b;
  return jsonb_build_object('currency', cur, 'level', p_level, 'rows', res, 'breakdowns', bd,
    'note', 'Anúncios e conjuntos mostram só mídia da plataforma. Leads, vendas e recebimentos do Hub são atribuídos por campanha (a atribuição só alcança o anúncio quando o link traz o id do anúncio — fase futura).');
end $$;
revoke all on function public.mkt_ads_table(date, date, jsonb, text) from public, anon; grant execute on function public.mkt_ads_table(date, date, jsonb, text) to authenticated;
