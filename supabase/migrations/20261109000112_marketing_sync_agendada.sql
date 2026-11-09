-- HP Group Hub — 112 Marketing: identificação segura para a Edge Function (mkt_whoami) e sincronização HORÁRIA agendada (pg_cron + pg_net + Vault).
-- A função só chama a Edge Function se existir conexão habilitada com conta selecionada; segredo e URL vêm do Vault (nunca do código). Sem eles, nada roda (sem erro).
create or replace function public.mkt_whoami() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', (select auth.uid()), 'org_id', private.current_org(), 'is_admin', coalesce(private.mkt_admin(), false), 'is_reader', coalesce(private.mkt_reader(), false))
$$;
revoke all on function public.mkt_whoami() from public, anon; grant execute on function public.mkt_whoami() to authenticated;

create extension if not exists pg_net with schema extensions;
create or replace function private.mkt_sync_tick() returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.mkt_connections c join public.mkt_ad_accounts a on a.connection_id = c.id where c.enabled and c.status in ('active','error') and a.selected and a.origin = 'api') then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'marketing_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'marketing_sync_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret), body := '{"kind":"scheduled"}'::jsonb, timeout_milliseconds := 5000);
end $$;
revoke all on function private.mkt_sync_tick() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'marketing-sync-hourly') then perform cron.unschedule('marketing-sync-hourly'); end if;
  perform cron.schedule('marketing-sync-hourly', '7 * * * *', 'select private.mkt_sync_tick()');
end $$;
