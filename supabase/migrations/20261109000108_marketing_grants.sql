-- HP Group Hub — 108 Marketing: privilégio de LEITURA (SELECT) para os papéis autenticados nas tabelas com política de administrador (RLS decide quem lê).
-- Credenciais e estados de OAuth ficam SEM nenhum privilégio (só a service role). Escrita continua só por função.
do $$ declare t text; begin
  foreach t in array array['mkt_settings','mkt_fronts','mkt_purposes','mkt_connections','mkt_ad_accounts','mkt_campaigns','mkt_adsets','mkt_ads','mkt_campaign_class','mkt_campaign_class_history',
    'mkt_spend_daily','mkt_entity_daily','mkt_breakdown_daily','mkt_sync_runs','mkt_day_status','mkt_touches','mkt_person_origin','mkt_attributions','mkt_attribution_log','mkt_sale_attributions','mkt_event_types'] loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
