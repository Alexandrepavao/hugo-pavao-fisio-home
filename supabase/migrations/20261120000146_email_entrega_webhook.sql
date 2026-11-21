-- HP Group Hub — 146 Entrega do e-mail confirmada pelo provedor (Dev; white label).
-- A chave de ENVIO do Resend não consulta o estado de entrega (HTTP 401). A entrega é confirmada pelo webhook do Resend (função resend-webhook, assinatura verificada) ou por uma chave de
-- leitura opcional. Este RPC grava o estado de entrega no evento pelo id do provedor, sem nunca rebaixar uma entrega já confirmada.
create or replace function public.email_event_delivery_by_provider(p_provider_id text, p_delivery text, p_at timestamptz default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
  rank_new int := case p_delivery when 'sent' then 1 when 'delivery_delayed' then 2 when 'delivered' then 3 when 'opened' then 4 when 'clicked' then 5 else 9 end;   -- bounced/complained/failed (9) sempre prevalecem
begin
  if p_provider_id is null or length(p_provider_id) not between 8 and 80 or p_delivery not in ('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'opened', 'clicked') then return 0; end if;
  update private.email_events e set delivery = p_delivery, delivery_at = coalesce(p_at, now()), delivery_checked_at = now()
   where e.provider_id = p_provider_id and e.state = 'accepted'
     and (e.delivery is null or rank_new = 9 or rank_new >= case e.delivery when 'sent' then 1 when 'delivery_delayed' then 2 when 'delivered' then 3 when 'opened' then 4 when 'clicked' then 5 else 9 end);
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.email_event_delivery_by_provider(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.email_event_delivery_by_provider(text, text, timestamptz) to service_role;
