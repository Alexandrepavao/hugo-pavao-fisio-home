-- book_appointment: serializa reservas concorrentes do mesmo profissional/pessoa (advisory lock transacional) para evitar deadlock entre as exclusion constraints.
-- Só acrescenta os dois locks antes do INSERT; todo o resto é idêntico à definição da migration 055 (mesma assinatura, mesmos privilégios).
-- Efeito observável: quem perde a corrida espera o vencedor concluir (milissegundos) e recebe P0409 imediatamente, em vez de entrar em deadlock.

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
  -- Serializa as reservas concorrentes do mesmo profissional e da mesma pessoa. Sem isso, dois INSERTs simultâneos no mesmo período entram em deadlock
  -- pelas exclusion constraints (cada um espera o outro); o Postgres aborta um com 40P01 e o PostgREST REEXECUTA a chamada, o que pode virar um laço de
  -- deadlocks até o statement_timeout (57014) — ver docs/diagnosticos/04-agenda-concurrency. Ordem fixa (profissional, depois pessoa) para não criar ciclo entre locks.
  perform pg_advisory_xact_lock(hashtextextended('appt:prof:' || p_professional::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('appt:person:' || p_person::text, 0));
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

revoke all on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid) to authenticated;
