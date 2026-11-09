-- HP Group Hub — 113 Marketing: mkt_filters deixa de ser STABLE (ela garante os padrões da organização com INSERT; função estável roda em transação somente-leitura no PostgREST e falhava com 405).
create or replace function public.mkt_filters() returns jsonb language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.mkt_filters() from public, anon; grant execute on function public.mkt_filters() to authenticated;
