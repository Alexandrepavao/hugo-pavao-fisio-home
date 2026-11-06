-- HP Group Hub — 096 Portais do Paciente e do Fisio: leituras consolidadas do "Início" (contrato estável de RPC para web e app).
-- Somente leitura; nenhuma tabela nova. Reaproveita private.journey_payload (058) e as regras de vínculo assistencial (care_relationships).
-- Plano: docs/plano-portais-paciente-e-fisio.md (F1).

-- ---------------------------------------------------------------- Paciente: tudo o que o Início mostra, numa chamada
create or replace function public.my_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_person uuid := private.current_person(); v_org uuid := private.current_org(); v_j jsonb; v_p record;
  v_pain_first numeric; v_pain_last numeric; v_pain_n int; v_goal jsonb; v_last_dec text;
begin
  if v_person is null or v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  v_j := private.journey_payload(v_person, false);
  select p.full_name, p.preferred_name, p.birth_date into v_p from public.people p where p.id = v_person;
  -- dor: primeira e última medida (autorrelato ou do profissional), a partir de registros reais
  select (array_agg((x ->> 'score')::numeric order by (x ->> 'assessed_at')))[1], (array_agg((x ->> 'score')::numeric order by (x ->> 'assessed_at') desc))[1], count(*)
    into v_pain_first, v_pain_last, v_pain_n
    from jsonb_array_elements(v_j -> 'assessments') x where x ->> 'kind' = 'dor';
  select g into v_goal from jsonb_array_elements(v_j -> 'goals') g where g ->> 'status' = 'active' limit 1;
  select r ->> 'decision' into v_last_dec from jsonb_array_elements(v_j -> 'reassessments') r order by (r ->> 'decided_at') desc limit 1;
  return jsonb_build_object(
    'person', jsonb_build_object('id', v_person, 'name', coalesce(nullif(btrim(v_p.preferred_name), ''), v_p.full_name), 'birth_date', v_p.birth_date),
    'next_appointment', (v_j -> 'upcoming') -> 0,
    'plan', v_j -> 'plan',
    'package_balance', v_j -> 'package_balance',
    'pain', case when v_pain_n > 0 then jsonb_build_object('first', v_pain_first, 'last', v_pain_last, 'count', v_pain_n) else null end,
    'goal', v_goal,
    'last_decision', v_last_dec,
    'renewal_open', (v_j -> 'renewal') is not null and (v_j -> 'renewal') <> 'null'::jsonb,
    'videos_count', jsonb_array_length(v_j -> 'videos'),
    'unread_msgs', (select count(*) from public.care_messages m where m.person_id = v_person and m.sender <> 'patient' and m.created_at > now() - interval '7 days')
  );
end $$;

-- ---------------------------------------------------------------- Fisio: atendimentos de hoje, carteira e alertas (somente pacientes com vínculo ativo)
create or replace function public.prof_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_org uuid := private.current_org(); v_prof uuid; v_tz text := 'America/Sao_Paulo';
  v_day date := (now() at time zone 'America/Sao_Paulo')::date; v_today jsonb; v_alerts jsonb; v_week jsonb;
begin
  select id into v_prof from public.professionals where user_id = v_uid and org_id = v_org and active;
  if v_prof is null then raise exception 'sem permissão' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', lower(a.period), 'ends_at', upper(a.period), 'status', a.status, 'service', s.name, 'unit', u.name,
           'person_id', a.person_id, 'patient', pe.full_name) order by lower(a.period)), '[]'::jsonb) into v_today
    from public.appointments a join public.services s on s.id = a.service_id join public.units u on u.id = a.unit_id join public.people pe on pe.id = a.person_id
   where a.professional_id = v_prof and a.org_id = v_org and (lower(a.period) at time zone v_tz)::date = v_day and a.status not in ('rescheduled');

  with mine as (select r.person_id from public.care_relationships r where r.professional_user_id = v_uid and r.org_id = v_org and r.revoked_at is null and r.valid_from <= now() and (r.valid_until is null or r.valid_until > now())),
  plans as (select pl.person_id, pl.planned_sessions, pl.started_on,
                   (select count(*) from public.appointments a where a.person_id = pl.person_id and a.status = 'attended' and lower(a.period)::date >= pl.started_on) attended
              from public.patient_plans pl join mine m on m.person_id = pl.person_id where pl.status = 'active' and pl.org_id = v_org),
  last_att as (select a.person_id, max(lower(a.period)) last_at from public.appointments a join mine m on m.person_id = a.person_id where a.status = 'attended' and a.org_id = v_org group by a.person_id),
  nxt as (select a.person_id, min(lower(a.period)) next_at from public.appointments a join mine m on m.person_id = a.person_id where a.status in ('scheduled','confirmed') and lower(a.period) > now() and a.org_id = v_org group by a.person_id),
  items as (
    select 'plano_acabando' kind, pl.person_id, format('%s de %s sessões realizadas', pl.attended, pl.planned_sessions) detail, 1 ord from plans pl where pl.attended >= greatest(1, ceil(pl.planned_sessions * 0.8))
    union all
    select 'sem_retorno', pl.person_id, case when la.last_at is null then 'Sem atendimento realizado ainda e sem consulta marcada' else format('Último atendimento há %s dias e nenhuma consulta marcada', (now()::date - la.last_at::date)) end, 2
      from plans pl left join last_att la on la.person_id = pl.person_id left join nxt n on n.person_id = pl.person_id
     where n.next_at is null and (la.last_at is null or la.last_at < now() - interval '14 days')
    union all
    select 'faltou', a.person_id, format('Faltou em %s', to_char((lower(a.period) at time zone v_tz), 'DD/MM')), 3
      from public.appointments a join mine m on m.person_id = a.person_id where a.status = 'no_show' and a.org_id = v_org and lower(a.period) > now() - interval '14 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'person_id', i.person_id, 'patient', pe.full_name, 'detail', i.detail) order by i.ord, pe.full_name), '[]'::jsonb) into v_alerts
    from items i join public.people pe on pe.id = i.person_id;

  select jsonb_build_object(
    'scheduled', count(*) filter (where a.status in ('scheduled','confirmed') and lower(a.period) >= now()),
    'attended', count(*) filter (where a.status = 'attended'),
    'no_show', count(*) filter (where a.status = 'no_show')) into v_week
    from public.appointments a where a.professional_id = v_prof and a.org_id = v_org and (lower(a.period) at time zone v_tz)::date between v_day - 6 and v_day + 6;

  return jsonb_build_object(
    'professional', (select jsonb_build_object('id', pr.id, 'name', pr.display_name, 'council', pr.council_registration) from public.professionals pr where pr.id = v_prof),
    'today', v_today, 'alerts', v_alerts, 'week', v_week,
    'patients_active', (select count(*) from public.care_relationships r where r.professional_user_id = v_uid and r.org_id = v_org and r.revoked_at is null and r.valid_from <= now() and (r.valid_until is null or r.valid_until > now()))
  );
end $$;

revoke all on function public.my_home(), public.prof_home() from public, anon;
grant execute on function public.my_home(), public.prof_home() to authenticated;
