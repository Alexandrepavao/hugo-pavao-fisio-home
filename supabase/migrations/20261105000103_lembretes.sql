-- HP Group Hub — 103 Portais F8: lembretes por E-MAIL e PUSH (fila, preferências, aparelhos). WhatsApp: canal RESERVADO no modelo, NADA é enviado por ele.
-- Honestidade: esta migration cria a FILA e as REGRAS (quem recebe, o quê, quando, com dedupe). O ENVIO real depende da Edge Function notify-dispatch (e-mail via Resend e push via chaves VAPID),
-- que NÃO está publicada nem provada neste ambiente. Sem ela, os itens ficam "queued". Lembrete de consulta/treino/check-in é serviço ao paciente; oferta NÃO é enviada por aqui (só na tela do portal).

create table public.notification_prefs (
  person_id uuid not null references public.people(id) on delete cascade, channel text not null check (channel in ('email','push','whatsapp')),
  kind text not null check (kind in ('appointment','training','checkin')), enabled boolean not null default true, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null,
  primary key (person_id, channel, kind)
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null, auth_key text not null, user_agent text check (user_agent is null or length(user_agent) <= 300), created_at timestamptz not null default now()
);
create table public.notification_queue (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, person_id uuid not null references public.people(id) on delete cascade,        -- o paciente a quem o assunto se refere
  recipient_person_id uuid not null references public.people(id) on delete cascade,                                                            -- quem recebe (responsável, se o paciente for menor)
  channel text not null check (channel in ('email','push','whatsapp')), kind text not null check (kind in ('appointment','training','checkin')),
  title text not null, body text not null, url text not null default '/paciente', run_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')), attempts smallint not null default 0, error text, sent_at timestamptz,
  dedupe_key text not null, created_at timestamptz not null default now(), unique (dedupe_key, channel)
);
create index notification_queue_due_idx on public.notification_queue (status, run_at);
alter table public.notification_prefs enable row level security; alter table public.push_subscriptions enable row level security; alter table public.notification_queue enable row level security;   -- sem GRANT: tudo por função

-- quem recebe: o próprio paciente; se for menor de 18 anos, o responsável legal ativo (nunca o menor de 12)
create or replace function private.notify_recipient(p_person uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select r.representative_person_id from public.care_representations r join public.people pe on pe.id = r.patient_person_id
      where r.patient_person_id = p_person and r.kind in ('responsavel_legal','tutor') and r.can_agenda and private.rep_active(r) and private.age_years(pe.birth_date) < 18 order by r.created_at limit 1), p_person)
$$;
create or replace function private.pref_enabled(p_person uuid, p_channel text, p_kind text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from public.notification_prefs where person_id = p_person and channel = p_channel and kind = p_kind), p_channel = 'email')       -- padrão: e-mail ligado; push só quem ativa
$$;

create or replace function public.my_notification_prefs() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p uuid := private.real_person();
begin
  if v_p is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object('prefs', coalesce((select jsonb_agg(jsonb_build_object('channel', c.channel, 'kind', k.kind, 'enabled', private.pref_enabled(v_p, c.channel, k.kind)) order by c.channel, k.kind)
      from (values ('email'),('push')) c(channel) cross join (values ('appointment'),('training'),('checkin')) k(kind)), '[]'::jsonb),
    'devices', (select count(*) from public.push_subscriptions where user_id = (select auth.uid())), 'whatsapp', 'reservado: nada é enviado por WhatsApp');
end $$;
create or replace function public.my_notification_pref_set(p_channel text, p_kind text, p_enabled boolean) returns void language plpgsql security definer set search_path = '' as $$
declare v_p uuid := private.real_person();
begin
  if v_p is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_channel not in ('email','push') then raise exception 'canal indisponível (WhatsApp está reservado e ainda não envia nada)'; end if;
  if p_kind not in ('appointment','training','checkin') then raise exception 'tipo inválido'; end if;
  insert into public.notification_prefs (person_id, channel, kind, enabled, updated_by) values (v_p, p_channel, p_kind, coalesce(p_enabled, false), (select auth.uid()))
    on conflict (person_id, channel, kind) do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by;
end $$;
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.real_person() is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'aparelho inválido'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent) values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key, user_agent = excluded.user_agent;
end $$;
create or replace function public.push_unsubscribe(p_endpoint text) returns void language plpgsql security definer set search_path = '' as $$
begin delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid()); end $$;

-- GERA os lembretes devidos (idempotente por dedupe_key). Só o servidor (service role / agendador) executa; respeita preferências, canal e menor de idade.
create or replace function public.notifications_enqueue_due() returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; r record; ch text; v_rcp uuid; v_wk text := private.week_start_sp()::text; v_day text := private.today_sp()::text;
begin
  for r in
    select 'appointment' kind, a.org_id, a.person_id, 'appt:' || a.id dk, 'Lembrete da sua consulta' title,
           format('Você tem %s amanhã às %s. Toque para confirmar presença.', s.name, to_char(lower(a.period) at time zone 'America/Sao_Paulo', 'HH24:MI')) body, '/paciente/agenda' url, lower(a.period) - interval '20 hours' run_at
      from public.appointments a join public.services s on s.id = a.service_id where a.status in ('scheduled','confirmed') and lower(a.period) between now() and now() + interval '30 hours'
    union all
    select 'training', pr.org_id, pr.person_id, 'train:' || pr.person_id || ':' || v_day, 'Hora do seu treino em casa', 'Seu treino de hoje está esperando. Leva poucos minutos.', '/paciente/treinos', now()
      from public.exercise_prescriptions pr where pr.status = 'active' and pr.starts_on <= private.today_sp() and (pr.ends_on is null or pr.ends_on >= private.today_sp())
       and not exists (select 1 from public.workout_logs l where l.person_id = pr.person_id and not l.skipped and l.done_on >= private.today_sp() - 1)
    union all
    select 'checkin', pe.org_id, pe.id, 'checkin:' || pe.id || ':' || v_wk, 'Check-in da semana', 'Conte como você está: 20 segundos ajudam seu fisioterapeuta a ajustar o tratamento.', '/paciente/evolucao', now()
      from public.people pe where private.checkin_due(pe.id) and pe.org_id is not null
  loop
    v_rcp := private.notify_recipient(r.person_id);
    for ch in select unnest(array['email','push']) loop
      if not private.pref_enabled(v_rcp, ch, r.kind) then continue; end if;
      if ch = 'push' and not exists (select 1 from public.push_subscriptions ps join public.user_accounts ua on ua.user_id = ps.user_id where ua.person_id = v_rcp) then continue; end if;
      insert into public.notification_queue (org_id, person_id, recipient_person_id, channel, kind, title, body, url, run_at, dedupe_key) values (r.org_id, r.person_id, v_rcp, ch, r.kind, r.title, r.body, r.url, r.run_at, r.dk)
        on conflict (dedupe_key, channel) do nothing;
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $$;
-- usado pela Edge Function de envio (service role): itens devidos com e-mail do destinatário e aparelhos; marca resultado
create or replace function public.notifications_pending(p_limit int default 50) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'channel', q.channel, 'kind', q.kind, 'title', q.title, 'body', q.body, 'url', q.url,
      'email', (select c.value from public.person_contacts c where c.person_id = q.recipient_person_id and c.type = 'email' order by c.is_primary desc limit 1),
      'devices', coalesce((select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth_key)) from public.push_subscriptions ps join public.user_accounts ua on ua.user_id = ps.user_id where ua.person_id = q.recipient_person_id), '[]'::jsonb)) order by q.run_at), '[]'::jsonb)
    from (select * from public.notification_queue where status = 'queued' and run_at <= now() and channel in ('email','push') order by run_at limit greatest(1, least(p_limit, 200))) q
$$;
create or replace function public.notification_mark(p_id uuid, p_status text, p_error text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('sent','failed','skipped') then raise exception 'situação inválida'; end if;
  update public.notification_queue set status = p_status, attempts = attempts + 1, error = left(p_error, 500), sent_at = case when p_status = 'sent' then now() end where id = p_id;
end $$;

revoke all on function public.my_notification_prefs(), public.my_notification_pref_set(text, text, boolean), public.push_subscribe(text, text, text, text), public.push_unsubscribe(text),
  public.notifications_enqueue_due(), public.notifications_pending(int), public.notification_mark(uuid, text, text) from public, anon, authenticated;
grant execute on function public.my_notification_prefs(), public.my_notification_pref_set(text, text, boolean), public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) to authenticated;
-- as três últimas só o servidor (service role) executa
grant execute on function public.notifications_enqueue_due(), public.notifications_pending(int), public.notification_mark(uuid, text, text) to service_role;
revoke all on function private.notify_recipient(uuid), private.pref_enabled(uuid, text, text) from public, anon, authenticated;
