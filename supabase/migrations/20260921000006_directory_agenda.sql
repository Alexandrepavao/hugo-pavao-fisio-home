-- HP Group Hub — 006 Diretório de usuários, agenda, pacotes e livro de sessões

-- ---------------------------------------------------------------- diretório
alter table public.user_accounts add column email extensions.citext, add column display_name text;
update public.user_accounts ua set email = u.email, display_name = split_part(u.email, '@', 1) from auth.users u where u.id = ua.user_id;

create or replace function private.user_accounts_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select u.email::extensions.citext, coalesce(new.display_name, split_part(u.email, '@', 1)) into new.email, new.display_name
    from auth.users u where u.id = new.user_id;
  return new;
end $$;
create trigger user_accounts_fill before insert on public.user_accounts for each row execute function private.user_accounts_fill();

grant update (display_name, status) on public.user_accounts to authenticated;
create policy accounts_update on public.user_accounts for update to authenticated
  using (org_id = private.current_org() and private.is_manager()) with check (org_id = private.current_org());

-- responsáveis atribuíveis (nome + papéis) para a unidade
create or replace function public.list_assignable_users(p_unit uuid default null)
returns table (user_id uuid, name text, roles text[])
language sql stable security definer set search_path = '' as $$
  select ua.user_id, coalesce(ua.display_name, ua.email::text), array_agg(distinct ra.role::text)
  from public.user_accounts ua
  join public.role_assignments ra on ra.user_id = ua.user_id and ra.revoked_at is null and ra.valid_from <= now()
       and (ra.valid_until is null or ra.valid_until > now())
       and (ra.unit_id is null or p_unit is null or ra.unit_id = p_unit)
       and ra.role in ('manager','ops_admin','unit_manager','sales','physio','teacher')
  where ua.status = 'active' and ua.org_id = private.current_org() and private.is_staff()
  group by ua.user_id, ua.display_name, ua.email
$$;
grant execute on function public.list_assignable_users(uuid) to authenticated;

-- ---------------------------------------------------------------- profissionais e disponibilidade
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid unique references auth.users(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  display_name text not null,
  council_registration text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);
create table public.professional_units (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  primary key (professional_id, unit_id)
);
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = domingo
  start_time time not null, end_time time not null,
  valid_from date, valid_until date,
  check (end_time > start_time)
);
create index availability_prof_idx on public.availability_rules (professional_id, weekday);
create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  period tstzrange not null check (not isempty(period)),
  reason text
);
create index time_blocks_gist on public.time_blocks using gist (professional_id, period);

-- ---------------------------------------------------------------- pacotes e livro de sessões
create table public.client_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  sale_id uuid,                                  -- FK na migration financeira
  total_sessions int not null check (total_sessions > 0),
  valid_until date,
  status text not null default 'active' check (status in ('active','exhausted','expired','cancelled')),
  created_at timestamptz not null default now()
);
create index client_packages_person_idx on public.client_packages (person_id);
create unique index client_packages_sale_uq on public.client_packages (sale_id) where sale_id is not null;

-- Saldo = soma do livro. Consumo por atendimento é único (não desconta duas vezes o mesmo agendamento).
create table public.session_ledger (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  client_package_id uuid not null references public.client_packages(id) on delete cascade,
  appointment_id uuid,
  delta int not null check (delta <> 0),
  reason text not null check (reason in ('grant','consume','refund','adjust')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index session_ledger_consume_uq on public.session_ledger (appointment_id) where reason = 'consume';
create index session_ledger_pkg_idx on public.session_ledger (client_package_id);

create or replace function private.package_balance(p_pkg uuid) returns int
language sql stable security definer set search_path = '' as $$ select coalesce(sum(delta), 0)::int from public.session_ledger where client_package_id = p_pkg $$;

-- ---------------------------------------------------------------- agendamentos
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  client_package_id uuid references public.client_packages(id) on delete set null,
  period tstzrange not null check (not isempty(period)),
  status text not null default 'scheduled' check (status in ('scheduled','confirmed','attended','no_show','cancelled_by_patient','cancelled_by_clinic','rescheduled')),
  cancel_reason text,
  rescheduled_from uuid references public.appointments(id) on delete set null,
  notes text,                                    -- administrativo; conteúdo clínico NÃO vai aqui
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Concorrência: o banco impede sobreposição do profissional e do paciente, mesmo em requisições simultâneas.
  constraint appt_no_overlap_professional exclude using gist (professional_id with =, period with &&) where (status in ('scheduled','confirmed','attended')),
  constraint appt_no_overlap_person exclude using gist (person_id with =, period with &&) where (status in ('scheduled','confirmed','attended'))
);
create index appointments_unit_time_idx on public.appointments using gist (unit_id, period);
create index appointments_person_idx on public.appointments (person_id);
create trigger appointments_touch before update on public.appointments for each row execute function private.touch_updated_at();

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  professional_id uuid references public.professionals(id) on delete set null,
  preference text,
  status text not null default 'waiting' check (status in ('waiting','offered','scheduled','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- permissões
create or replace function private.can_schedule(p_unit uuid, p_professional uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], p_unit)
      or (p_professional is not null and private.has_unit_role(array['physio']::public.app_role[], p_unit)
          and exists (select 1 from public.professionals pr where pr.id = p_professional and pr.user_id = (select auth.uid())))
$$;

-- ---------------------------------------------------------------- horários livres
create or replace function public.available_slots(p_professional uuid, p_unit uuid, p_service uuid, p_date date)
returns table (slot_start timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_dur int; r record; t timestamptz;
begin
  if not private.can_schedule(p_unit, p_professional) and not private.has_unit_role(array['physio','finance']::public.app_role[], p_unit) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select timezone into v_tz from public.units where id = p_unit and org_id = private.current_org();
  select duration_min into v_dur from public.services where id = p_service and org_id = private.current_org();
  if v_tz is null or v_dur is null then return; end if;
  for r in select * from public.availability_rules a
            where a.professional_id = p_professional and a.unit_id = p_unit and a.weekday = extract(dow from p_date)
              and (a.valid_from is null or a.valid_from <= p_date) and (a.valid_until is null or a.valid_until >= p_date) loop
    t := (p_date + r.start_time) at time zone v_tz;
    while t + make_interval(mins => v_dur) <= (p_date + r.end_time) at time zone v_tz loop
      if t > now()
         and not exists (select 1 from public.appointments ap where ap.professional_id = p_professional and ap.status in ('scheduled','confirmed','attended')
                         and ap.period && tstzrange(t, t + make_interval(mins => v_dur)))
         and not exists (select 1 from public.time_blocks b where b.professional_id = p_professional and b.period && tstzrange(t, t + make_interval(mins => v_dur))) then
        slot_start := t; return next;
      end if;
      t := t + make_interval(mins => v_dur);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------- agendar / remarcar / mudar status
create or replace function public.book_appointment(
  p_person uuid, p_unit uuid, p_professional uuid, p_service uuid, p_start timestamptz,
  p_package uuid default null, p_opportunity uuid default null, p_notes text default null, p_rescheduled_from uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.current_org(); v_tz text; v_dur int; v_end timestamptz; v_id uuid;
  v_local_start timestamp; v_local_end timestamp; pk public.client_packages;
begin
  if v_org is null or not private.can_schedule(p_unit, p_professional) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select timezone into v_tz from public.units where id = p_unit and org_id = v_org;
  select duration_min into v_dur from public.services where id = p_service and org_id = v_org and active;
  if v_tz is null or v_dur is null then raise exception 'unidade ou serviço inválido'; end if;
  if not exists (select 1 from public.people where id = p_person and org_id = v_org) then raise exception 'pessoa inválida'; end if;
  if not exists (select 1 from public.professional_units pu join public.professionals pr on pr.id = pu.professional_id
                  where pu.professional_id = p_professional and pu.unit_id = p_unit and pr.org_id = v_org and pr.active) then
    raise exception 'profissional não atende nesta unidade'; end if;
  if p_start <= now() and p_rescheduled_from is null then raise exception 'horário no passado'; end if;
  v_end := p_start + make_interval(mins => v_dur);
  v_local_start := p_start at time zone v_tz; v_local_end := v_end at time zone v_tz;
  if not exists (select 1 from public.availability_rules a
      where a.professional_id = p_professional and a.unit_id = p_unit and a.weekday = extract(dow from v_local_start)
        and a.start_time <= v_local_start::time and a.end_time >= v_local_end::time and v_local_start::date = v_local_end::date
        and (a.valid_from is null or a.valid_from <= v_local_start::date) and (a.valid_until is null or a.valid_until >= v_local_start::date)) then
    raise exception 'fora da disponibilidade do profissional'; end if;
  if exists (select 1 from public.time_blocks b where b.professional_id = p_professional and b.period && tstzrange(p_start, v_end)) then
    raise exception 'horário bloqueado'; end if;
  if p_package is not null then
    select * into pk from public.client_packages where id = p_package and person_id = p_person and org_id = v_org;
    if not found or pk.status <> 'active' or (pk.valid_until is not null and pk.valid_until < v_local_start::date) then raise exception 'pacote inválido ou vencido'; end if;
    if private.package_balance(p_package) - (select count(*) from public.appointments where client_package_id = p_package and status in ('scheduled','confirmed')) <= 0 then
      raise exception 'pacote sem saldo disponível'; end if;
  end if;
  begin
    insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, opportunity_id, client_package_id, period, notes, created_by, rescheduled_from)
      values (v_org, p_unit, p_professional, p_person, p_service, p_opportunity, p_package, tstzrange(p_start, v_end), p_notes, (select auth.uid()), p_rescheduled_from)
      returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Horário indisponível: já existe agendamento neste período' using errcode = 'P0409';
  end;
  perform private.emit_event(v_org, 'appointment.scheduled', 'appointment', v_id, jsonb_build_object('opportunity_id', p_opportunity), 'appt.scheduled:' || v_id);
  return v_id;
end $$;

create or replace function public.reschedule_appointment(p_id uuid, p_new_start timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_new uuid;
begin
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or not private.can_schedule(a.unit_id, a.professional_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if a.status not in ('scheduled','confirmed') then raise exception 'apenas agendamentos ativos podem ser remarcados'; end if;
  update public.appointments set status = 'rescheduled' where id = p_id;      -- libera o horário; se o novo falhar, tudo é desfeito
  v_new := public.book_appointment(a.person_id, a.unit_id, a.professional_id, a.service_id, p_new_start, a.client_package_id, a.opportunity_id, a.notes, p_id);
  return v_new;
end $$;

create or replace function public.set_appointment_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or not private.can_schedule(a.unit_id, a.professional_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_status not in ('confirmed','attended','no_show','cancelled_by_patient','cancelled_by_clinic') then raise exception 'status inválido'; end if;
  if a.status = p_status then return; end if;
  if a.status in ('rescheduled','cancelled_by_patient','cancelled_by_clinic') then raise exception 'agendamento encerrado'; end if;
  if a.status in ('attended') and p_status <> 'attended' then raise exception 'atendimento realizado só pode ser ajustado pelo saldo do pacote'; end if;
  if p_status = 'attended' and lower(a.period) > now() then raise exception 'não é possível marcar comparecimento futuro'; end if;
  update public.appointments set status = p_status, cancel_reason = case when p_status like 'cancelled%' then p_reason end where id = p_id;
  if p_status <> 'confirmed' then
    perform private.emit_event(a.org_id, 'appointment.' || p_status, 'appointment', p_id, jsonb_build_object('at', now()), 'appt.' || p_status || ':' || p_id);
  end if;
end $$;

-- ---------------------------------------------------------------- regras de consumo (handlers de evento, idempotentes)
create or replace function private.consume_session(p_appt uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; bal int; pk public.client_packages;
begin
  select * into a from public.appointments where id = p_appt;
  if a.client_package_id is null then return; end if;
  insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason, note)
    values (a.org_id, a.client_package_id, a.id, -1, 'consume', p_note) on conflict do nothing;   -- único por agendamento
  bal := private.package_balance(a.client_package_id);
  select * into pk from public.client_packages where id = a.client_package_id;
  if bal <= 0 then update public.client_packages set status = 'exhausted' where id = pk.id and status = 'active'; end if;
  if bal <= 2 then
    insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (a.org_id, a.unit_id, a.person_id, private.pick_owner(a.org_id, a.unit_id), 'package_end',
              case when bal <= 0 then 'Pacote esgotado: oferecer renovação' else 'Pacote próximo do fim (' || bal || ' sessão(ões)): oferecer renovação' end,
              'package_end:' || pk.id || ':' || bal) on conflict do nothing;
  end if;
end $$;

create or replace function private.h_appt_attended(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; a public.appointments;
begin
  select * into e from public.domain_events where id = p_event;
  select * into a from public.appointments where id = e.aggregate_id;
  perform private.consume_session(a.id, 'Atendimento realizado');
  if a.opportunity_id is not null then
    update public.opportunities o set stage_id = s.id from public.pipeline_stages s
      where o.id = a.opportunity_id and s.pipeline_id = o.pipeline_id and s.name = 'Compareceu' and o.status = 'open'
        and s.position > (select position from public.pipeline_stages where id = o.stage_id);
  end if;
end $$;

create or replace function private.h_appt_no_show(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; a public.appointments; pr public.products;
begin
  select * into e from public.domain_events where id = p_event;
  select * into a from public.appointments where id = e.aggregate_id;
  if a.client_package_id is not null then
    select p.* into pr from public.products p join public.client_packages c on c.product_id = p.id where c.id = a.client_package_id;
    if pr.consume_on_no_show then perform private.consume_session(a.id, 'Falta (regra do produto: consome sessão)'); end if;
  end if;
  insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, dedupe_key)
    values (a.org_id, a.unit_id, a.opportunity_id, a.person_id, coalesce((select owner_user_id from public.opportunities where id = a.opportunity_id), private.pick_owner(a.org_id, a.unit_id)),
            'no_show', 'Falta: contatar paciente para remarcar', 'no_show:' || a.id) on conflict do nothing;
end $$;

create or replace function private.h_appt_cancelled_patient(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; a public.appointments; pr public.products;
begin
  select * into e from public.domain_events where id = p_event;
  select * into a from public.appointments where id = e.aggregate_id;
  if a.client_package_id is not null then
    select p.* into pr from public.products p join public.client_packages c on c.product_id = p.id where c.id = a.client_package_id;
    if lower(a.period) - now() < make_interval(hours => pr.late_cancel_hours) then
      perform private.consume_session(a.id, 'Cancelamento tardio (menos de ' || pr.late_cancel_hours || 'h)');
    end if;
  end if;
end $$;

create or replace function private.h_appt_scheduled(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; a public.appointments;
begin
  select * into e from public.domain_events where id = p_event;
  select * into a from public.appointments where id = e.aggregate_id;
  if a.opportunity_id is not null then
    update public.opportunities o set stage_id = s.id from public.pipeline_stages s
      where o.id = a.opportunity_id and s.pipeline_id = o.pipeline_id and s.name = 'Avaliação agendada' and o.status = 'open'
        and s.position > (select position from public.pipeline_stages where id = o.stage_id);
  end if;
end $$;

insert into private.event_handlers values
  ('appointment.scheduled','h_appt_scheduled'),('appointment.attended','h_appt_attended'),
  ('appointment.no_show','h_appt_no_show'),('appointment.cancelled_by_patient','h_appt_cancelled_patient');

-- ajuste manual de saldo (registrado, com motivo)
create or replace function public.adjust_package(p_pkg uuid, p_delta int, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare pk public.client_packages;
begin
  select * into pk from public.client_packages where id = p_pkg and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager','ops_admin','unit_manager','finance']::public.app_role[], pk.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_delta = 0 or coalesce(btrim(p_note), '') = '' then raise exception 'informe a quantidade e o motivo'; end if;
  insert into public.session_ledger (org_id, client_package_id, delta, reason, note, created_by) values (pk.org_id, p_pkg, p_delta, 'adjust', p_note, (select auth.uid()));
  if private.package_balance(p_pkg) > 0 and pk.status = 'exhausted' then update public.client_packages set status = 'active' where id = p_pkg; end if;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.professionals enable row level security;
alter table public.professional_units enable row level security;
alter table public.availability_rules enable row level security;
alter table public.time_blocks enable row level security;
alter table public.client_packages enable row level security;
alter table public.session_ledger enable row level security;
alter table public.appointments enable row level security;
alter table public.waitlist enable row level security;

grant select, insert, update on public.professionals to authenticated;
grant select, insert, delete on public.professional_units to authenticated;
grant select, insert, update, delete on public.availability_rules, public.time_blocks to authenticated;
grant select on public.client_packages, public.session_ledger, public.appointments to authenticated;
grant select, insert, update on public.waitlist to authenticated;

create policy prof_read on public.professionals for select to authenticated using (private.in_org(org_id) and private.is_staff());
create policy prof_write on public.professionals for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy prof_update on public.professionals for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[])) with check (private.in_org(org_id));
create policy pu_read on public.professional_units for select to authenticated using (exists (select 1 from public.professionals p where p.id = professional_id));
create policy pu_write on public.professional_units for insert to authenticated with check (private.has_org_role(array['manager','ops_admin']::public.app_role[]) and exists (select 1 from public.professionals p where p.id = professional_id));
create policy pu_delete on public.professional_units for delete to authenticated using (private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy av_read on public.availability_rules for select to authenticated using (private.in_org(org_id) and private.is_staff());
create policy av_all on public.availability_rules for all to authenticated
  using (private.in_org(org_id) and private.can_schedule(unit_id, professional_id)) with check (private.in_org(org_id) and private.can_schedule(unit_id, professional_id));
create policy tb_read on public.time_blocks for select to authenticated using (private.in_org(org_id) and private.is_staff());
create policy tb_all on public.time_blocks for all to authenticated
  using (private.in_org(org_id) and exists (select 1 from public.professionals p where p.id = professional_id and (private.has_org_role(array['manager','ops_admin']::public.app_role[]) or p.user_id = (select auth.uid()))))
  with check (private.in_org(org_id) and exists (select 1 from public.professionals p where p.id = professional_id and (private.has_org_role(array['manager','ops_admin']::public.app_role[]) or p.user_id = (select auth.uid()))));

create policy appt_read on public.appointments for select to authenticated
  using (private.in_org(org_id) and (
    private.has_unit_role(array['manager','ops_admin','unit_manager','sales','finance']::public.app_role[], unit_id)
    or person_id = private.current_person()
    or exists (select 1 from public.professionals p where p.id = professional_id and p.user_id = (select auth.uid()))));
create policy pkg_read on public.client_packages for select to authenticated
  using (private.in_org(org_id) and (private.has_unit_role(array['manager','ops_admin','unit_manager','sales','finance']::public.app_role[], unit_id) or person_id = private.current_person()));
create policy ledger_read on public.session_ledger for select to authenticated using (exists (select 1 from public.client_packages c where c.id = client_package_id));
create policy wl_read on public.waitlist for select to authenticated using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));
create policy wl_insert on public.waitlist for insert to authenticated with check (private.in_org(org_id) and created_by = (select auth.uid()) and private.can_schedule(unit_id));
create policy wl_update on public.waitlist for update to authenticated using (private.in_org(org_id) and private.can_schedule(unit_id)) with check (private.in_org(org_id));

create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function private.audit_row('status','professional_id','person_id');
create trigger audit_ledger after insert on public.session_ledger for each row execute function private.audit_row('delta','reason','client_package_id');

grant execute on function public.available_slots(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.reschedule_appointment(uuid, timestamptz) to authenticated;
grant execute on function public.set_appointment_status(uuid, text, text) to authenticated;
grant execute on function public.adjust_package(uuid, int, text) to authenticated;
