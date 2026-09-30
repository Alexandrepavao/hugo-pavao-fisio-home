-- HP Group Hub — 063 Sincronização AUTOMÁTICA com o Google Calendar (HP → Google): criação, remarcação e cancelamento chegam ao Google sem ninguém clicar.
-- Dois gatilhos, ambos chamando a Edge Function google-calendar (/sync) com o segredo servidor-a-servidor:
--   (1) na hora: toda mudança de atendimento (criar, horário, status, profissional) de um profissional COM conexão Google chama a sincronização só daquele usuário (assíncrono, depois do commit);
--   (2) de rede de segurança: a cada 5 minutos, para todas as conexões ativas ou com erro (repete o que falhou e lê os compromissos externos do Google).
-- Nada de segredo neste arquivo: a URL da função e o segredo ficam no Vault (nomes `calendar_sync_url` e `calendar_sync_secret`) e no segredo CALENDAR_SYNC_SECRET da Edge Function (o mesmo valor).
-- Sem esses dois itens no Vault, tudo aqui é no-op silencioso. A agenda NUNCA falha por causa do calendário (todo o caminho do gatilho engole erros).
-- O endereço .ics (Apple/iPhone) foi aposentado: a função calendar-feed deixou de ser publicada e a interface só oferece Google. As tabelas/funções da 059 ficam (histórico) e não são servidas por nada.
create extension if not exists pg_net with schema extensions;

create or replace function private.google_sync_call(p_user uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'calendar_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'calendar_sync_secret';
  if v_url is null or v_secret is null then return; end if;                                  -- sem configuração no Vault: não faz nada
  perform net.http_post(url := v_url, headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
                        body := case when p_user is null then '{}'::jsonb else jsonb_build_object('user_id', p_user) end, timeout_milliseconds := 25000);
exception when others then null;
end $$;

-- rede de segurança: só chama se existir alguma conexão que possa sincronizar
create or replace function private.google_sync_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.google_calendar_connections where status in ('active', 'error')) then perform private.google_sync_call(null); end if;
end $$;

-- gatilho de atendimento: sincroniza o profissional do atendimento (e o anterior, se mudou de profissional)
create or replace function private.appointments_google_kick() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_old uuid;
begin
  begin
    select pr.user_id into v_user from public.professionals pr where pr.id = new.professional_id;
    if v_user is not null and exists (select 1 from public.google_calendar_connections c where c.user_id = v_user and c.status in ('active', 'error')) then perform private.google_sync_call(v_user); end if;
    if tg_op = 'UPDATE' and old.professional_id is distinct from new.professional_id then
      select pr.user_id into v_old from public.professionals pr where pr.id = old.professional_id;
      if v_old is not null and v_old is distinct from v_user and exists (select 1 from public.google_calendar_connections c where c.user_id = v_old and c.status in ('active', 'error')) then perform private.google_sync_call(v_old); end if;
    end if;
  exception when others then null;                                                          -- a agenda nunca falha por causa do calendário
  end;
  return null;
end $$;
drop trigger if exists appointments_google_kick on public.appointments;
create trigger appointments_google_kick after insert or update of status, period, professional_id on public.appointments for each row execute function private.appointments_google_kick();

select cron.schedule('google-calendar-sync', '*/5 * * * *', $$select private.google_sync_tick()$$);

revoke all on function private.google_sync_call(uuid), private.google_sync_tick(), private.appointments_google_kick() from public, anon, authenticated;
