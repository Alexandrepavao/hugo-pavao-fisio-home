-- HP Group Hub — 059 Calendários: visão semanal/mensal do "Meu dia", assinatura de calendário (somente leitura, link revogável) e conexão com o Google Calendar.
-- Regras: agenda própria por padrão; agenda de outro profissional só por permissão e por unidade (private.can_view_prof_agenda); nenhuma confirmação em nome de outro;
-- tarefas pessoais continuam privadas e NUNCA vão para o calendário externo; credenciais/tokens só no servidor; eventos EXTERNOS nunca viram atendimento, cobrança ou consumo de sessão.

-- ---------------------------------------------------------------- visão por intervalo (semana/mês)
-- p_from/p_to: limites do intervalo (o navegador manda a meia-noite local). Máximo de 62 dias. Sem p_professional = a agenda clínica do próprio usuário.
create or replace function public.my_calendar(p_from timestamptz, p_to timestamptz, p_professional uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.current_org(); v_self_prof uuid; v_prof uuid; v_is_self boolean;
begin
  if v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then raise exception 'intervalo inválido (máximo de 62 dias)'; end if;
  select id into v_self_prof from public.professionals where user_id = v_uid and org_id = v_org;
  v_prof := coalesce(p_professional, v_self_prof);
  if v_prof is not null and not private.can_view_prof_agenda(v_prof) then raise exception 'sem permissão' using errcode = '42501'; end if;
  -- sem NULL: quem não é profissional tem v_self_prof nulo, e (v_prof = nulo) daria NULL — então agenda alheia é decidida sem comparar com nulo
  v_is_self := p_professional is null or (v_self_prof is not null and v_prof = v_self_prof);
  return jsonb_build_object(
    'is_self', v_is_self,
    'appointments', case when v_prof is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', lower(a.period), 'ends_at', upper(a.period), 'status', a.status, 'person', p.full_name, 'service', s.name, 'unit', u.name,
               'patient_confirmed_at', a.patient_confirmed_at, 'professional_confirmed_at', a.professional_confirmed_at,
               'can_confirm', (v_self_prof is not null and v_prof = v_self_prof and a.status in ('scheduled','confirmed') and lower(a.period) > now() and a.professional_confirmed_at is null)) order by lower(a.period))
        from public.appointments a join public.people p on p.id = a.person_id join public.services s on s.id = a.service_id join public.units u on u.id = a.unit_id
       where a.professional_id = v_prof and a.org_id = v_org and a.status in ('scheduled','confirmed','attended','no_show','professional_no_show')
         and lower(a.period) >= p_from and lower(a.period) < p_to and ((v_self_prof is not null and v_prof = v_self_prof) or private.can_view_prof_agenda(v_prof, a.unit_id))), '[]'::jsonb) end,
    -- tarefas, tarefas de CRM e compromissos externos: só do próprio usuário (nunca na agenda de outro)
    'tasks', case when not v_is_self then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'task_date', t.task_date, 'end_date', t.end_date, 'start_time', t.start_time, 'completed', t.completed_at is not null) order by t.task_date, t.start_time nulls last)
        from public.staff_tasks t where t.owner_user_id = v_uid and t.task_date <= p_to::date and coalesce(t.end_date, t.task_date) >= p_from::date), '[]'::jsonb) end,
    'crm_tasks', case when not v_is_self then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'due_at', c.due_at) order by c.due_at)
        from public.crm_tasks c where c.assignee_user_id = v_uid and c.done_at is null and c.due_at >= p_from and c.due_at < p_to), '[]'::jsonb) end,
    'external', case when not v_is_self then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', e.google_event_id, 'summary', e.summary, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'all_day', e.all_day) order by e.starts_at)
        from public.external_calendar_events e where e.user_id = v_uid and e.status <> 'cancelled' and e.starts_at < p_to and e.ends_at > p_from), '[]'::jsonb) end
  );
end $$;

-- ---------------------------------------------------------------- Google Calendar: tabelas (sem acesso do navegador; só o servidor com service_role)
create table public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade, org_id uuid not null,
  google_email text, refresh_token_enc text not null,                   -- refresh token CRIPTOGRAFADO (AES-GCM) pela Edge Function; a chave fica nos Secrets
  scope text, hp_calendar_id text,                                      -- calendário secundário "HP Group Hub" criado pelo app: é o único onde escrevemos
  sync_token text, status text not null default 'active' check (status in ('active','error','revoked')),
  detail text not null default 'minimal' check (detail in ('minimal','names')),
  last_sync_at timestamptz, last_error text, created_at timestamptz not null default now()
);
create table public.calendar_event_links (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  local_type text not null check (local_type in ('appointment')), local_id uuid not null, google_event_id text not null, local_version bigint not null default 0,
  unique (user_id, local_type, local_id), unique (user_id, google_event_id)
);
-- Compromissos EXTERNOS importados do Google (só leitura, só do próprio usuário). Não são atendimentos, não geram cobrança nem consomem sessão.
create table public.external_calendar_events (
  user_id uuid not null references auth.users(id) on delete cascade, org_id uuid not null, google_event_id text not null,
  summary text, starts_at timestamptz not null, ends_at timestamptz not null, all_day boolean not null default false,
  status text not null default 'confirmed' check (status in ('confirmed','tentative','cancelled')), updated_at timestamptz not null default now(),
  primary key (user_id, google_event_id)
);
create index external_calendar_events_range_idx on public.external_calendar_events (user_id, starts_at);
alter table public.google_calendar_connections enable row level security; alter table public.calendar_event_links enable row level security; alter table public.external_calendar_events enable row level security;
grant all on public.google_calendar_connections, public.calendar_event_links, public.external_calendar_events to service_role;
grant select on public.external_calendar_events to authenticated;
create policy external_events_own on public.external_calendar_events for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.google_connection_status() returns table (connected boolean, google_email text, status text, detail text, last_sync_at timestamptz, last_error text)
language sql stable security definer set search_path = '' as $$
  select (c.user_id is not null), c.google_email, c.status, c.detail, c.last_sync_at, c.last_error
    from (select 1) x left join public.google_calendar_connections c on c.user_id = (select auth.uid())
$$;
create or replace function public.google_connection_set_detail(p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_detail not in ('minimal','names') then raise exception 'nível de detalhe inválido'; end if;
  update public.google_calendar_connections set detail = p_detail where user_id = (select auth.uid());
end $$;

-- ---------------------------------------------------------------- assinatura de calendário (.ics, SOMENTE LEITURA)
-- O token vai só para o usuário, UMA vez; no banco fica apenas o hash (sha256). Um link ativo por usuário; gerar outro revoga o anterior.
create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'), detail text not null default 'minimal' check (detail in ('minimal','names')),
  created_at timestamptz not null default now(), revoked_at timestamptz, last_accessed_at timestamptz
);
create unique index calendar_feeds_active_uq on public.calendar_feeds (user_id) where revoked_at is null;
alter table public.calendar_feeds enable row level security;
grant all on public.calendar_feeds to service_role;

create or replace function public.calendar_feed_create(p_detail text default 'minimal') returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if (select auth.uid()) is null or private.current_org() is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_detail not in ('minimal','names') then raise exception 'nível de detalhe inválido'; end if;
  update public.calendar_feeds set revoked_at = now() where user_id = (select auth.uid()) and revoked_at is null;
  insert into public.calendar_feeds (org_id, user_id, token_hash, detail) values (private.current_org(), (select auth.uid()), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_detail);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns, new_values)       -- credencial: fica auditada (sem o token)
    values (private.current_org(), (select auth.uid()), 'create', 'calendar_feeds', (select auth.uid())::text, array['token'], jsonb_build_object('detail', p_detail));
  return v_token;
end $$;
create or replace function public.calendar_feed_revoke() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.calendar_feeds set revoked_at = now() where user_id = (select auth.uid()) and revoked_at is null;
  if found then
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns)
      values (private.current_org(), (select auth.uid()), 'update', 'calendar_feeds', (select auth.uid())::text, array['revoked_at']);
  end if;
end $$;
create or replace function public.calendar_feed_status() returns table (active boolean, detail text, created_at timestamptz, last_accessed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (f.id is not null), f.detail, f.created_at, f.last_accessed_at from (select 1) x left join public.calendar_feeds f on f.user_id = (select auth.uid()) and f.revoked_at is null
$$;

-- Eventos do feed (chamada SÓ pela Edge Function calendar-feed, com service_role). Janela: 30 dias atrás até 180 dias à frente.
-- Conteúdo mínimo por padrão ("Atendimento HP" + unidade); 'names' acrescenta primeiro nome do paciente e serviço — escolha explícita do usuário.
-- Cancelados/remarcados saem como STATUS:CANCELLED com o mesmo UID (o cliente remove/risca, sem duplicar). Tarefas pessoais NUNCA entram.
create or replace function public.calendar_feed_events(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.calendar_feeds; v_prof uuid; v_person uuid;
begin
  select * into f from public.calendar_feeds where token_hash = p_token_hash and revoked_at is null;
  if not found then return null; end if;
  update public.calendar_feeds set last_accessed_at = now() where id = f.id;
  select id into v_prof from public.professionals where user_id = f.user_id and org_id = f.org_id;
  select person_id into v_person from public.user_accounts where user_id = f.user_id and org_id = f.org_id and status = 'active';
  return jsonb_build_object('calname', 'HP Group Hub', 'events', coalesce((
    select jsonb_agg(e order by (e ->> 'starts_at')) from (
      select jsonb_build_object('uid', 'appt-' || a.id::text || '@hp-group-hub', 'starts_at', lower(a.period), 'ends_at', upper(a.period), 'updated_at', a.updated_at,
               'status', case when a.status in ('scheduled','confirmed','attended') then 'CONFIRMED' else 'CANCELLED' end,
               'summary', case when f.detail = 'names' then 'Atendimento: ' || split_part(p.full_name, ' ', 1) || ' — ' || s.name else 'Atendimento HP' end,
               'location', u.name, 'description', 'Evento do HP Group Hub (somente leitura). Alterações feitas neste calendário não voltam para o HP.') e
        from public.appointments a join public.people p on p.id = a.person_id join public.services s on s.id = a.service_id join public.units u on u.id = a.unit_id
       where a.org_id = f.org_id and a.professional_id = v_prof and lower(a.period) >= now() - interval '30 days' and lower(a.period) < now() + interval '180 days'
         and a.status in ('scheduled','confirmed','attended','cancelled_by_patient','cancelled_by_clinic','rescheduled','professional_no_show')
      union all
      select jsonb_build_object('uid', 'appt-' || a.id::text || '@hp-group-hub', 'starts_at', lower(a.period), 'ends_at', upper(a.period), 'updated_at', a.updated_at,
               'status', case when a.status in ('scheduled','confirmed','attended') then 'CONFIRMED' else 'CANCELLED' end,
               'summary', case when f.detail = 'names' then 'Consulta com ' || split_part(pr.display_name, ' ', 1) else 'Consulta HP' end,
               'location', u.name, 'description', 'Evento do HP Group Hub (somente leitura).')
        from public.appointments a join public.professionals pr on pr.id = a.professional_id join public.units u on u.id = a.unit_id
       where v_person is not null and a.org_id = f.org_id and a.person_id = v_person and (v_prof is null or a.professional_id <> v_prof)
         and lower(a.period) >= now() - interval '30 days' and lower(a.period) < now() + interval '180 days'
         and a.status in ('scheduled','confirmed','attended','cancelled_by_patient','cancelled_by_clinic','rescheduled','professional_no_show')
    ) z), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- privilégios
revoke all on function public.my_calendar(timestamptz, timestamptz, uuid), public.google_connection_status(), public.google_connection_set_detail(text),
  public.calendar_feed_create(text), public.calendar_feed_revoke(), public.calendar_feed_status(), public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.my_calendar(timestamptz, timestamptz, uuid), public.google_connection_status(), public.google_connection_set_detail(text),
  public.calendar_feed_create(text), public.calendar_feed_revoke(), public.calendar_feed_status() to authenticated;
grant execute on function public.calendar_feed_events(text) to service_role;      -- só o servidor (Edge Function) lê o feed pelo hash do token
