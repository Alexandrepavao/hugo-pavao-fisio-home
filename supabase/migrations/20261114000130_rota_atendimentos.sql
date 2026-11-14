-- 130 — Rota de atendimentos (logística de atendimentos presenciais/domiciliares).
-- Aditiva. Reaproveita `appointments`, `book_appointment`/`reschedule_appointment` e as permissões existentes; NÃO cria agenda paralela.
-- Princípios: (1) simular nunca grava; (2) aplicar = remarcação pelo fluxo existente, com antes/depois, auditoria e revalidação;
-- (3) coordenadas só saem por RPC com permissão; (4) nada de nome/diagnóstico/telefone vai a provedor de rotas (a função de backend só envia coordenadas);
-- (5) auditoria registra NOMES de campos, nunca coordenadas.
-- Ver docs/mapas-e-rotas.md.

-- ---------------------------------------------------------------- locais (ponto geográfico) de unidade, paciente e profissional
create table public.route_places (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  owner_kind text not null check (owner_kind in ('unit','person','professional')),
  owner_id uuid not null,
  lat double precision not null check (lat between -34.0 and 5.6),     -- caixa do Brasil: pega latitude/longitude trocadas
  lng double precision not null check (lng between -74.5 and -28.0),
  precision text not null check (precision in ('exact','street','cep')),
  source text not null check (source in ('manual_pin','cep_approx','geocoder')),
  access_notes text check (access_notes is null or char_length(access_notes) <= 300),   -- só orientação de acesso (portaria, referência); nunca conteúdo clínico
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (owner_kind, owner_id),
  check ((source = 'cep_approx') = (precision = 'cep'))
);
alter table public.route_places enable row level security;    -- sem política: só as RPCs abaixo (security definer) leem/gravam
revoke all on public.route_places from public, anon, authenticated;

-- ---------------------------------------------------------------- preferências de rota do profissional (nada de endereço residencial obrigatório)
create table public.professional_route_prefs (
  professional_id uuid primary key references public.professionals(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete restrict,
  travel_profile text not null default 'driving-car' check (travel_profile in ('driving-car','foot-walking','cycling-regular')),
  min_buffer_min int not null default 10 check (min_buffer_min between 0 and 120),
  start_mode text not null default 'unit' check (start_mode in ('unit','own_point')),
  updated_at timestamptz not null default now()
);
alter table public.professional_route_prefs enable row level security;
revoke all on public.professional_route_prefs from public, anon, authenticated;

-- ---------------------------------------------------------------- logística no atendimento (snapshot do local no momento da marcação)
alter table public.appointments
  add column service_mode text not null default 'in_clinic' check (service_mode in ('in_clinic','home_visit','remote')),
  add column visit_lat double precision,
  add column visit_lng double precision,
  add column visit_precision text check (visit_precision is null or visit_precision in ('exact','street','cep')),
  add column route_fixed boolean not null default false,
  add constraint appt_visit_coords_pair check ((visit_lat is null) = (visit_lng is null));

-- Remarcação cria um NOVO atendimento (rescheduled_from): o local e o formato são herdados do anterior (nada se perde por remarcar).
create or replace function private.appt_inherit_logistics() returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.appointments;
begin
  if new.rescheduled_from is not null and new.service_mode = 'in_clinic' and new.visit_lat is null and not new.route_fixed then
    select * into o from public.appointments where id = new.rescheduled_from;
    if found then
      new.service_mode := o.service_mode; new.visit_lat := o.visit_lat; new.visit_lng := o.visit_lng; new.visit_precision := o.visit_precision; new.route_fixed := o.route_fixed;
    end if;
  end if;
  return new;
end $$;
create trigger appointments_inherit_logistics before insert on public.appointments for each row execute function private.appt_inherit_logistics();

-- ---------------------------------------------------------------- cache de trechos, contador de uso e registro das aplicações
create table public.route_leg_cache (
  cache_key text primary key,                     -- perfil|lat1|lng1|lat2|lng2 (coordenadas arredondadas a 3 casas)
  org_id uuid not null references public.organizations(id) on delete cascade,
  profile text not null,
  duration_s int not null check (duration_s >= 0),
  distance_m int,
  provider text not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index route_leg_cache_exp_idx on public.route_leg_cache (expires_at);
alter table public.route_leg_cache enable row level security;
revoke all on public.route_leg_cache from public, anon, authenticated;

create table public.route_usage (
  org_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('matrix','directions','geocode')),
  calls int not null default 0,
  primary key (org_id, day, kind)
);
alter table public.route_usage enable row level security;
revoke all on public.route_usage from public, anon, authenticated;

create table public.route_apply_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  plan_date date not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  changes jsonb not null,                          -- [{id,old_start,new_start}] — sem nomes, sem endereços
  note text,
  created_at timestamptz not null default now()
);
alter table public.route_apply_log enable row level security;
create policy route_apply_log_read on public.route_apply_log for select to authenticated using (org_id = private.current_org() and private.can_view_prof_agenda(professional_id));
revoke all on public.route_apply_log from public, anon; grant select on public.route_apply_log to authenticated;

-- Incrementa o contador de forma atômica e SÓ se couber no teto; devolve se pode chamar o provedor. Somente a Edge Function (service_role).
create or replace function public.route_usage_hit(p_org uuid, p_kind text, p_n int, p_cap int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  if p_n < 1 or p_n > p_cap then return false; end if;
  insert into public.route_usage (org_id, day, kind, calls) values (p_org, (now() at time zone 'America/Sao_Paulo')::date, p_kind, p_n)
    on conflict (org_id, day, kind) do update set calls = public.route_usage.calls + p_n where public.route_usage.calls + p_n <= p_cap
    returning calls into v;
  return v is not null;
end $$;
revoke all on function public.route_usage_hit(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.route_usage_hit(uuid, text, int, int) to service_role;

-- ---------------------------------------------------------------- permissões
create or replace function private.can_route_person(p_person uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.people p where p.id = p_person and p.org_id = private.current_org()
    and (private.can_schedule(p.unit_id)
         or exists (select 1 from public.appointments a join public.professionals pr on pr.id = a.professional_id
                     where a.person_id = p.id and a.org_id = p.org_id and pr.user_id = (select auth.uid()))))
$$;
create or replace function private.can_route_prof_set(p_professional uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.professionals pr where pr.id = p_professional and pr.org_id = private.current_org()
    and (pr.user_id = (select auth.uid())
         or exists (select 1 from public.professional_units pu where pu.professional_id = pr.id and private.can_schedule(pu.unit_id, pr.id))))
$$;

-- ---------------------------------------------------------------- locais: ler / gravar / limpar
create or replace function public.route_place_get(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); r public.route_places; ok boolean;
begin
  if p_kind = 'unit' then ok := exists (select 1 from public.units u where u.id = p_id and u.org_id = v_org) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales','physio']::public.app_role[], p_id);
  elsif p_kind = 'person' then ok := private.can_route_person(p_id);
  elsif p_kind = 'professional' then ok := private.can_view_prof_agenda(p_id);
  else raise exception 'tipo de local inválido'; end if;
  if not coalesce(ok, false) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into r from public.route_places where owner_kind = p_kind and owner_id = p_id and org_id = v_org;
  if not found then return null; end if;
  return jsonb_build_object('lat', r.lat, 'lng', r.lng, 'precision', r.precision, 'source', r.source, 'access_notes', r.access_notes, 'updated_at', r.updated_at);
end $$;

create or replace function public.route_place_set(p_kind text, p_id uuid, p_lat double precision, p_lng double precision, p_precision text, p_source text, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); ok boolean; v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_kind = 'unit' then ok := exists (select 1 from public.units u where u.id = p_id and u.org_id = v_org) and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], p_id);
  elsif p_kind = 'person' then ok := private.can_route_person(p_id);
  elsif p_kind = 'professional' then ok := private.can_route_prof_set(p_id);
  else raise exception 'tipo de local inválido'; end if;
  if not coalesce(ok, false) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_lat is null or p_lng is null or p_lat not between -34.0 and 5.6 or p_lng not between -74.5 and -28.0 then raise exception 'coordenadas fora do Brasil: confira latitude e longitude'; end if;
  if p_precision not in ('exact','street','cep') or p_source not in ('manual_pin','cep_approx','geocoder') then raise exception 'precisão ou fonte inválida'; end if;
  if (p_source = 'cep_approx') <> (p_precision = 'cep') then raise exception 'localização por CEP é sempre aproximada'; end if;
  if v_notes is not null and char_length(v_notes) > 300 then raise exception 'orientação de acesso muito longa (máximo 300 caracteres)'; end if;
  insert into public.route_places (org_id, owner_kind, owner_id, lat, lng, precision, source, access_notes, updated_by, updated_at)
    values (v_org, p_kind, p_id, p_lat, p_lng, p_precision, p_source, v_notes, (select auth.uid()), now())
    on conflict (owner_kind, owner_id) do update set lat = excluded.lat, lng = excluded.lng, precision = excluded.precision, source = excluded.source,
      access_notes = excluded.access_notes, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns)
    values (v_org, (select auth.uid()), 'route.place_set', 'route_place', p_kind || ':' || p_id::text, array['lat','lng','precision','source']);   -- sem valores
  return jsonb_build_object('ok', true, 'precision', p_precision);
end $$;

create or replace function public.route_place_clear(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); ok boolean;
begin
  if p_kind = 'unit' then ok := private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], p_id);
  elsif p_kind = 'person' then ok := private.can_route_person(p_id);
  elsif p_kind = 'professional' then ok := private.can_route_prof_set(p_id);
  else raise exception 'tipo de local inválido'; end if;
  if not coalesce(ok, false) then raise exception 'sem permissão' using errcode = '42501'; end if;
  delete from public.route_places where owner_kind = p_kind and owner_id = p_id and org_id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id) values (v_org, (select auth.uid()), 'route.place_clear', 'route_place', p_kind || ':' || p_id::text);
end $$;

-- ---------------------------------------------------------------- preferências do profissional
create or replace function public.route_prefs_set(p_professional uuid, p_profile text, p_buffer int, p_start_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if not private.can_route_prof_set(p_professional) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_profile not in ('driving-car','foot-walking','cycling-regular') or p_start_mode not in ('unit','own_point') or p_buffer is null or p_buffer not between 0 and 120 then raise exception 'preferência inválida'; end if;
  insert into public.professional_route_prefs (professional_id, org_id, travel_profile, min_buffer_min, start_mode, updated_at) values (p_professional, v_org, p_profile, p_buffer, p_start_mode, now())
    on conflict (professional_id) do update set travel_profile = excluded.travel_profile, min_buffer_min = excluded.min_buffer_min, start_mode = excluded.start_mode, updated_at = now();
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id) values (v_org, (select auth.uid()), 'route.prefs_set', 'professional', p_professional::text);
end $$;

-- ---------------------------------------------------------------- formato do atendimento (clínica / domiciliar / remoto) + horário fixo
-- Domiciliar copia (snapshot) o local ATUAL do paciente para o atendimento: editar o cadastro depois NÃO muda atendimentos já marcados.
-- Atendimento confirmado: só com ciência explícita (p_ack_confirmed) — nada é alterado em silêncio e nenhuma mensagem é enviada por aqui.
create or replace function public.appointment_set_mode(p_id uuid, p_mode text, p_fixed boolean default null, p_ack_confirmed boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; pl public.route_places; v_org uuid := private.current_org();
begin
  select * into a from public.appointments where id = p_id and org_id = v_org for update;
  if not found or not private.can_schedule(a.unit_id, a.professional_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_mode not in ('in_clinic','home_visit','remote') then raise exception 'formato inválido'; end if;
  if a.status not in ('scheduled','confirmed') then raise exception 'apenas agendamentos ativos'; end if;
  if a.status = 'confirmed' and p_mode <> a.service_mode and not coalesce(p_ack_confirmed, false) then
    raise exception 'atendimento confirmado: mudar o formato exige ciência explícita (o paciente não é avisado por aqui)'; end if;
  if p_mode = 'home_visit' then
    select * into pl from public.route_places where owner_kind = 'person' and owner_id = a.person_id and org_id = v_org;
    update public.appointments set service_mode = 'home_visit', visit_lat = pl.lat, visit_lng = pl.lng, visit_precision = pl.precision where id = p_id;
  else
    update public.appointments set service_mode = p_mode, visit_lat = null, visit_lng = null, visit_precision = null where id = p_id;
  end if;
  if p_fixed is not null then update public.appointments set route_fixed = p_fixed where id = p_id; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id, changed_columns)
    values (v_org, (select auth.uid()), 'route.mode_set', 'appointment', p_id::text, a.unit_id, array['service_mode','visit_place','route_fixed']);
  return jsonb_build_object('mode', p_mode, 'has_place', p_mode <> 'home_visit' or pl.id is not null);
end $$;

-- ---------------------------------------------------------------- o dia para a rota (somente leitura)
create or replace function public.route_day(p_professional uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_self boolean; v_pref public.professional_route_prefs; v_tz text; v_unit uuid; v_start jsonb := null; pp public.route_places; up public.route_places;
begin
  if not private.can_view_prof_agenda(p_professional) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select (pr.user_id = (select auth.uid())) into v_self from public.professionals pr where pr.id = p_professional and pr.org_id = v_org;
  select * into v_pref from public.professional_route_prefs where professional_id = p_professional;
  -- unidade de referência: a do primeiro atendimento do dia; senão a primeira unidade do profissional
  select a.unit_id into v_unit from public.appointments a join public.units u on u.id = a.unit_id
    where a.professional_id = p_professional and a.org_id = v_org and a.status in ('scheduled','confirmed','attended','no_show') and (lower(a.period) at time zone u.timezone)::date = p_date
    order by lower(a.period) limit 1;
  if v_unit is null then select pu.unit_id into v_unit from public.professional_units pu where pu.professional_id = p_professional order by pu.unit_id limit 1; end if;
  select timezone into v_tz from public.units where id = v_unit;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  if coalesce(v_pref.start_mode, 'unit') = 'own_point' then
    select * into pp from public.route_places where owner_kind = 'professional' and owner_id = p_professional and org_id = v_org;
    if found then v_start := jsonb_build_object('kind', 'own_point', 'label', 'Ponto de partida', 'lat', pp.lat, 'lng', pp.lng, 'precision', pp.precision); end if;
  else
    select * into up from public.route_places where owner_kind = 'unit' and owner_id = v_unit and org_id = v_org;
    if found then v_start := jsonb_build_object('kind', 'unit', 'label', (select name from public.units where id = v_unit), 'lat', up.lat, 'lng', up.lng, 'precision', up.precision); end if;
  end if;
  return jsonb_build_object(
    'is_self', coalesce(v_self, false), 'timezone', v_tz, 'date', p_date, 'unit_id', v_unit,
    'prefs', jsonb_build_object('profile', coalesce(v_pref.travel_profile, 'driving-car'), 'buffer_min', coalesce(v_pref.min_buffer_min, 10), 'start_mode', coalesce(v_pref.start_mode, 'unit')),
    'start', v_start,
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', a.id, 'starts_at', lower(a.period), 'ends_at', upper(a.period), 'status', a.status, 'person_id', a.person_id, 'person', p.full_name, 'service', s.name,
          'unit_id', a.unit_id, 'unit', u.name, 'mode', a.service_mode, 'fixed', a.route_fixed,
          'lat', case a.service_mode when 'home_visit' then a.visit_lat when 'in_clinic' then upl.lat end,
          'lng', case a.service_mode when 'home_visit' then a.visit_lng when 'in_clinic' then upl.lng end,
          'precision', case a.service_mode when 'home_visit' then a.visit_precision when 'in_clinic' then upl.precision end,
          'patient_confirmed_at', a.patient_confirmed_at) order by lower(a.period))
      from public.appointments a join public.people p on p.id = a.person_id join public.services s on s.id = a.service_id join public.units u on u.id = a.unit_id
        left join public.route_places upl on upl.owner_kind = 'unit' and upl.owner_id = a.unit_id and upl.org_id = a.org_id
      where a.professional_id = p_professional and a.org_id = v_org and a.status in ('scheduled','confirmed','attended','no_show')
        and (lower(a.period) at time zone u.timezone)::date = p_date
        and (coalesce(v_self, false) or private.can_view_prof_agenda(p_professional, a.unit_id))), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- aplicar uma sugestão (somente por ação explícita)
-- p_changes = [{id, expected_start, new_start}]. Revalida TUDO no servidor: permissão, desatualização (o atendimento mudou desde a simulação),
-- status (só "agendado"; confirmado/fixo nunca é movido aqui), mesmo dia local, futuro, disponibilidade e bloqueios do profissional (as MESMAS regras do
-- book_appointment) e conflitos. A duração é preservada por construção (nunca encurta). O MESMO atendimento muda de horário (mesmo id, mesmo paciente, mesmo
-- pacote; o evento do Google é atualizado, não duplicado). Trocas e ciclos (A↔B) funcionam: cada atendimento é estacionado num período único e distante e
-- depois recebe o horário final, tudo na mesma transação — nada intermediário é visível. Tudo ou nada. Registra antes/depois e auditoria.
create or replace function public.route_apply(p_professional uuid, p_date date, p_changes jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); n int; i int; v_log uuid; v_changes jsonb := '[]'::jsonb; v_tz text; v_end timestamptz; v_ls timestamp; v_le timestamp; v_new timestamptz;
  ids uuid[] := '{}'; olds timestamptz[] := '{}'; news timestamptz[] := '{}'; durs interval[] := '{}'; v_p uuid; a public.appointments;
begin
  if v_org is null or not private.can_view_prof_agenda(p_professional) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 30 then raise exception 'ROTA_ENTRADA: lista de mudanças inválida'; end if;
  n := jsonb_array_length(p_changes);
  -- mesma serialização do book_appointment: profissional primeiro; depois as pessoas em ordem fixa (sem ciclo de locks)
  perform pg_advisory_xact_lock(hashtextextended('appt:prof:' || p_professional::text, 0));
  for v_p in select distinct a2.person_id from jsonb_array_elements(p_changes) c join public.appointments a2 on a2.id = (c ->> 'id')::uuid and a2.org_id = v_org order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('appt:person:' || v_p::text, 0));
  end loop;
  for i in 0 .. n - 1 loop
    select * into a from public.appointments where id = (p_changes->i->>'id')::uuid and org_id = v_org and professional_id = p_professional for update;
    if not found then raise exception 'ROTA_DESATUALIZADA: atendimento não encontrado'; end if;
    if a.id = any(ids) then raise exception 'ROTA_ENTRADA: atendimento repetido'; end if;
    if not private.can_schedule(a.unit_id, a.professional_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
    if lower(a.period) is distinct from (p_changes->i->>'expected_start')::timestamptz then raise exception 'ROTA_DESATUALIZADA: a agenda mudou depois da simulação; simule de novo'; end if;
    if a.status <> 'scheduled' then raise exception 'ROTA_STATUS: só atendimentos agendados e ainda não confirmados podem ser movidos por aqui'; end if;
    if a.route_fixed then raise exception 'ROTA_FIXO: horário marcado como fixo'; end if;
    select timezone into v_tz from public.units where id = a.unit_id;
    v_new := (p_changes->i->>'new_start')::timestamptz; v_end := v_new + (upper(a.period) - lower(a.period));
    v_ls := v_new at time zone v_tz; v_le := v_end at time zone v_tz;
    if v_ls::date <> p_date or v_le::date <> p_date then raise exception 'ROTA_DIA: a mudança sai do dia da rota'; end if;
    if v_new <= now() then raise exception 'ROTA_PASSADO: horário no passado'; end if;
    if not exists (select 1 from public.availability_rules r where r.professional_id = p_professional and r.unit_id = a.unit_id and r.weekday = extract(dow from v_ls)
        and r.start_time <= v_ls::time and r.end_time >= v_le::time and (r.valid_from is null or r.valid_from <= v_ls::date) and (r.valid_until is null or r.valid_until >= v_ls::date)) then
      raise exception 'ROTA_DISPONIBILIDADE: fora da disponibilidade do profissional'; end if;
    if exists (select 1 from public.time_blocks b where b.professional_id = p_professional and b.period && tstzrange(v_new, v_end)) then raise exception 'ROTA_BLOQUEIO: horário bloqueado'; end if;
    ids := ids || a.id; olds := olds || lower(a.period); news := news || v_new; durs := durs || (upper(a.period) - lower(a.period));
  end loop;
  begin
    -- fase 1: estaciona quem realmente muda (período único e distante) — assim troca/ciclo não colide no meio do caminho
    for i in 1 .. n loop
      continue when news[i] = olds[i];
      update public.appointments set period = tstzrange(timestamptz '2999-01-01 00:00+00' + make_interval(hours => i), timestamptz '2999-01-01 00:00+00' + make_interval(hours => i) + durs[i]) where id = ids[i];
    end loop;
    -- fase 2: horário final (as restrições de não-sobreposição do profissional e do paciente continuam valendo)
    for i in 1 .. n loop
      continue when news[i] = olds[i];
      update public.appointments set period = tstzrange(news[i], news[i] + durs[i]) where id = ids[i];
    end loop;
  exception when exclusion_violation then
    raise exception 'ROTA_CONFLITO: o horário de destino já está ocupado por outro atendimento; nada foi alterado';
  end;
  for i in 1 .. n loop v_changes := v_changes || jsonb_build_object('id', ids[i], 'old_start', olds[i], 'new_start', news[i]); end loop;
  insert into public.route_apply_log (org_id, professional_id, plan_date, actor_user_id, changes, note)
    values (v_org, p_professional, p_date, (select auth.uid()), v_changes, nullif(left(btrim(coalesce(p_note, '')), 300), '')) returning id into v_log;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, new_values)
    values (v_org, (select auth.uid()), 'route.apply', 'route_apply', v_log::text, jsonb_build_object('count', n, 'plan_date', p_date));
  return jsonb_build_object('log_id', v_log, 'applied', v_changes);
end $$;

-- ---------------------------------------------------------------- privilégios
revoke all on function public.route_place_get(text, uuid), public.route_place_set(text, uuid, double precision, double precision, text, text, text), public.route_place_clear(text, uuid),
  public.route_prefs_set(uuid, text, int, text), public.appointment_set_mode(uuid, text, boolean, boolean), public.route_day(uuid, date), public.route_apply(uuid, date, jsonb, text) from public, anon;
grant execute on function public.route_place_get(text, uuid), public.route_place_set(text, uuid, double precision, double precision, text, text, text), public.route_place_clear(text, uuid),
  public.route_prefs_set(uuid, text, int, text), public.appointment_set_mode(uuid, text, boolean, boolean), public.route_day(uuid, date), public.route_apply(uuid, date, jsonb, text) to authenticated;
revoke all on function private.can_route_person(uuid), private.can_route_prof_set(uuid), private.appt_inherit_logistics() from public, anon;
