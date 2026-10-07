-- HP Group Hub — 055 Release v1:
--   (1) paciente cancela o PRÓPRIO atendimento pelo portal, respeitando prazo e política de consumo do produto;
--   (2) agendar/remarcar para horário PASSADO deixa de ser possível (servidor);
--   (3) "Meu dia": agenda de outros profissionais só por permissão.

-- ---------------------------------------------------------------- (2) horário passado
-- book_appointment dispensava a checagem quando p_rescheduled_from vinha preenchido — qualquer gestor podia, chamando a função
-- direto, criar atendimento no passado. A remarcação sempre leva a um horário FUTURO, então a exceção não tem uso legítimo.
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
  if p_start <= now() then raise exception 'horário no passado'; end if;
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
  if p_new_start is null or p_new_start <= now() then raise exception 'não é possível remarcar para um horário passado'; end if;
  update public.appointments set status = 'rescheduled' where id = p_id;      -- libera o horário; se o novo falhar, tudo é desfeito
  v_new := public.book_appointment(a.person_id, a.unit_id, a.professional_id, a.service_id, p_new_start, a.client_package_id, a.opportunity_id, a.notes, p_id);
  return v_new;
end $$;

-- ---------------------------------------------------------------- (1) cancelamento pelo paciente
-- Mesma regra de consumo que já vale quando a equipe cancela "pelo paciente": o handler h_appt_cancelled_patient consome 1 sessão
-- se faltar menos de late_cancel_hours (do produto do pacote) para o início. Aqui só o PRÓPRIO paciente, só antes do início.
create or replace function public.my_appointment_cancel(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_consumed boolean;
begin
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or a.person_id is distinct from private.current_person() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if a.status = 'cancelled_by_patient' then return jsonb_build_object('status', a.status, 'session_consumed',
      exists (select 1 from public.session_ledger l where l.appointment_id = a.id and l.reason = 'consume')); end if;   -- idempotente
  if a.status not in ('scheduled','confirmed') then raise exception 'este agendamento não pode mais ser cancelado pelo portal'; end if;
  if lower(a.period) <= now() then raise exception 'o atendimento já começou: fale com a equipe'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'motivo muito longo (máximo 500 caracteres)'; end if;
  update public.appointments set status = 'cancelled_by_patient', cancel_reason = coalesce(v_reason, 'Cancelado pelo paciente no portal') where id = p_id;
  perform private.emit_event(a.org_id, 'appointment.cancelled_by_patient', 'appointment', p_id, jsonb_build_object('at', now(), 'via', 'portal'), 'appt.cancelled_by_patient:' || p_id);
  select exists (select 1 from public.session_ledger l where l.appointment_id = p_id and l.reason = 'consume') into v_consumed;
  return jsonb_build_object('status', 'cancelled_by_patient', 'session_consumed', v_consumed);
end $$;

-- my_appointments: + pode cancelar, vai consumir sessão se cancelar agora, e o prazo do produto (muda o retorno: recria)
drop function public.my_appointments();
create function public.my_appointments() returns table (
  id uuid, starts_at timestamptz, ends_at timestamptz, status text, service_name text, professional_name text, unit_name text, timezone text, survey_answered boolean,
  patient_confirmed_at timestamptz, professional_confirmed_at timestamptz, can_confirm boolean, uses_package boolean, session_consumed boolean,
  can_cancel boolean, cancel_consumes boolean, late_cancel_hours int)
language sql stable security definer set search_path = '' as $$
  select a.id, lower(a.period), upper(a.period), a.status, s.name, pr.display_name, u.name, u.timezone,
         exists (select 1 from public.survey_responses sr where sr.appointment_id = a.id),
         a.patient_confirmed_at, a.professional_confirmed_at,
         (a.status in ('scheduled','confirmed') and lower(a.period) > now() and a.patient_confirmed_at is null),
         a.client_package_id is not null,
         exists (select 1 from public.session_ledger l where l.appointment_id = a.id and l.reason = 'consume')
           and not exists (select 1 from public.session_ledger l where l.appointment_id = a.id and l.reason = 'refund'),
         (a.status in ('scheduled','confirmed') and lower(a.period) > now()),
         (a.client_package_id is not null and lp.late_cancel_hours is not null and lower(a.period) - now() < make_interval(hours => lp.late_cancel_hours)),
         lp.late_cancel_hours
  from public.appointments a join public.services s on s.id = a.service_id join public.professionals pr on pr.id = a.professional_id join public.units u on u.id = a.unit_id
  left join lateral (select p.late_cancel_hours from public.client_packages c join public.products p on p.id = c.product_id where c.id = a.client_package_id) lp on true
  where a.person_id = private.current_person() order by lower(a.period) desc limit 100
$$;

-- ---------------------------------------------------------------- (3) agendas de outros profissionais, só por permissão
-- Quem pode ver a agenda de OUTRO profissional: gestor e administrador operacional (toda a organização) e gestor de unidade (só as unidades dele).
-- Fisioterapeuta, comercial, financeiro etc. só enxergam a própria agenda (a do fisioterapeuta continua em my_day).
create or replace function private.can_view_prof_agenda(p_professional uuid, p_unit uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.professionals pr where pr.id = p_professional and pr.org_id = private.current_org() and pr.user_id = (select auth.uid()))
      or exists (select 1 from public.professionals pr join public.professional_units pu on pu.professional_id = pr.id
                  where pr.id = p_professional and pr.org_id = private.current_org() and (p_unit is null or pu.unit_id = p_unit)
                    and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], pu.unit_id))
$$;

-- Lista quem aparece no seletor de "Meu dia": a própria agenda (se for profissional) + as que a pessoa tem permissão de ver.
create or replace function public.my_agenda_professionals() returns table (id uuid, display_name text, is_self boolean)
language sql stable security definer set search_path = '' as $$
  select pr.id, pr.display_name, (pr.user_id = (select auth.uid())) as is_self
  from public.professionals pr
  where pr.org_id = private.current_org() and pr.active and private.can_view_prof_agenda(pr.id)
  order by (pr.user_id = (select auth.uid())) desc, pr.display_name
$$;

-- Agenda de um dia de um profissional. Em agenda alheia, só as unidades em que a pessoa tem papel de gestão, e nunca com ação de confirmar
-- (a confirmação do profissional é só dele).
create or replace function public.professional_day(p_professional uuid, p_date date default current_date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_self boolean;
begin
  if not private.can_view_prof_agenda(p_professional) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select exists (select 1 from public.professionals pr where pr.id = p_professional and pr.user_id = (select auth.uid())) into v_self;
  return jsonb_build_object('is_self', v_self, 'appointments', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', lower(a.period), 'ends_at', upper(a.period), 'status', a.status, 'person', p.full_name, 'service', s.name,
        'unit', u.name, 'patient_confirmed_at', a.patient_confirmed_at, 'professional_confirmed_at', a.professional_confirmed_at,
        'can_confirm', (v_self and a.status in ('scheduled','confirmed') and lower(a.period) > now() and a.professional_confirmed_at is null)) order by lower(a.period))
    from public.appointments a join public.people p on p.id = a.person_id join public.services s on s.id = a.service_id join public.units u on u.id = a.unit_id
    where a.professional_id = p_professional and a.org_id = private.current_org()
      and a.status in ('scheduled','confirmed','attended','no_show','professional_no_show') and lower(a.period)::date = p_date
      and (v_self or private.can_view_prof_agenda(p_professional, a.unit_id))), '[]'));
end $$;

-- ---------------------------------------------------------------- privilégios
revoke all on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid), public.reschedule_appointment(uuid, timestamptz),
  public.my_appointment_cancel(uuid, text), public.my_appointments(), public.my_agenda_professionals(), public.professional_day(uuid, date) from public, anon;
grant execute on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid), public.reschedule_appointment(uuid, timestamptz),
  public.my_appointment_cancel(uuid, text), public.my_appointments(), public.my_agenda_professionals(), public.professional_day(uuid, date) to authenticated;
