-- HP Group Hub — 101 Portais F6: treinos em casa (biblioteca de exercícios, prescrição pelo fisio, execução e registro pelo paciente, adesão derivada).
-- O vídeo do Hugo e o Bunny entram DEPOIS: o exercício nasce com texto (instruções, nível, equipamento, contraindicações); o campo video_ref fica reservado e nada aqui depende dele.
-- Privacidade: igual à jornada. Prescrição e registros só para o paciente (ou quem o representa com escopo "train"), o fisio vinculado e o admin (gestor) pelo caminho REGISTRADO.
-- Adesão, sequência e % da semana são DERIVADOS dos registros (nada guardado). Dor ≥ 7 durante o treino vira alerta ao fisio (nunca diagnóstico ao paciente).

create table public.exercise_library (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, title text not null check (length(btrim(title)) between 3 and 120),
  instructions text check (instructions is null or length(instructions) <= 3000), body_region text check (body_region is null or length(body_region) <= 60),
  level text check (level is null or level in ('iniciante','intermediario','avancado')), equipment text check (equipment is null or length(equipment) <= 120),
  contraindications text check (contraindications is null or length(contraindications) <= 1000), specialties text[] not null default '{}',
  video_ref text,                                    -- reservado: identificador do vídeo (Bunny) quando o Hugo gravar; hoje não é usado
  active boolean not null default true, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table public.exercise_prescriptions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade, professional_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 120), weekly_target smallint not null default 3 check (weekly_target between 1 and 7),
  starts_on date not null default private.today_sp(), ends_on date, notes text check (notes is null or length(notes) <= 1000),
  status text not null default 'active' check (status in ('active','finished','cancelled')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index exercise_prescriptions_person_idx on public.exercise_prescriptions (person_id, status);
create table public.prescription_items (
  id uuid primary key default gen_random_uuid(), prescription_id uuid not null references public.exercise_prescriptions(id) on delete cascade,
  workout text not null default 'A' check (workout ~ '^[A-F]$'), position smallint not null default 0, exercise_id uuid not null references public.exercise_library(id) on delete restrict,
  sets smallint not null check (sets between 1 and 20), reps smallint check (reps is null or reps between 1 and 200), duration_s int check (duration_s is null or duration_s between 1 and 3600),
  load_text text check (load_text is null or length(load_text) <= 60), rest_s int check (rest_s is null or rest_s between 0 and 600), notes text check (notes is null or length(notes) <= 300),
  check (reps is not null or duration_s is not null)
);
create index prescription_items_idx on public.prescription_items (prescription_id, workout, position);
create table public.workout_logs (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, person_id uuid not null references public.people(id) on delete cascade,
  prescription_id uuid not null references public.exercise_prescriptions(id) on delete cascade, workout text not null, done_on date not null default private.today_sp(),
  items_done uuid[] not null default '{}', skipped boolean not null default false, effort smallint check (effort is null or effort between 0 and 10), pain_during smallint check (pain_during is null or pain_during between 0 and 10),
  note text check (note is null or length(note) <= 500), logged_by uuid references auth.users(id) on delete set null, in_name_of boolean not null default false,
  created_at timestamptz not null default clock_timestamp(), idem_key text
);
create unique index workout_logs_day_uq on public.workout_logs (prescription_id, workout, done_on) where not skipped;
create unique index workout_logs_idem_uq on public.workout_logs (logged_by, idem_key) where idem_key is not null;
create index workout_logs_person_idx on public.workout_logs (person_id, done_on desc);
alter table public.exercise_library enable row level security; alter table public.exercise_prescriptions enable row level security; alter table public.prescription_items enable row level security; alter table public.workout_logs enable row level security;   -- sem GRANT: tudo por função
create trigger audit_exercise_prescriptions after insert or update on public.exercise_prescriptions for each row execute function private.audit_row('title','status','weekly_target');

-- ---------------------------------------------------------------- derivados
create or replace function private.training_summary(p_person uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pr public.exercise_prescriptions; v_today date := private.today_sp(); v_ws text[]; v_n int; v_done_total int; v_next text; v_streak int := 0; d date; v_days int; v_log public.workout_logs; v_total int;
begin
  select * into pr from public.exercise_prescriptions where person_id = p_person and org_id = private.current_org() and status = 'active' and starts_on <= v_today and (ends_on is null or ends_on >= v_today) order by created_at desc limit 1;
  if pr.id is null then return null; end if;
  select array_agg(distinct workout order by workout) into v_ws from public.prescription_items where prescription_id = pr.id; v_n := coalesce(array_length(v_ws, 1), 0); if v_n = 0 then return null; end if;
  select count(*) into v_done_total from public.workout_logs where prescription_id = pr.id and not skipped;
  select * into v_log from public.workout_logs where prescription_id = pr.id and done_on = v_today and not skipped order by created_at desc limit 1;
  v_next := case when v_log.id is not null then v_log.workout else v_ws[1 + (v_done_total % v_n)] end;
  select count(*) into v_total from public.prescription_items where prescription_id = pr.id and workout = v_next;
  d := case when exists (select 1 from public.workout_logs where person_id = p_person and not skipped and done_on = v_today) then v_today else v_today - 1 end;
  while exists (select 1 from public.workout_logs where person_id = p_person and not skipped and done_on = d) and v_streak < 365 loop v_streak := v_streak + 1; d := d - 1; end loop;
  select count(distinct done_on) into v_days from public.workout_logs where prescription_id = pr.id and not skipped and done_on > v_today - 7;
  return jsonb_build_object('prescription_id', pr.id, 'title', pr.title, 'weekly_target', pr.weekly_target, 'today', jsonb_build_object('workout', v_next, 'total', v_total, 'done', case when v_log.id is not null then coalesce(array_length(v_log.items_done, 1), v_total) else 0 end, 'completed', v_log.id is not null),
    'streak', v_streak, 'week_days', v_days, 'week_pct', least(100, round(100.0 * v_days / pr.weekly_target)));
end $$;

-- ---------------------------------------------------------------- biblioteca (fisio e admin)
create or replace function private.library_role() returns boolean language sql stable security definer set search_path = '' as $$ select private.has_role_any(array['physio','manager','ops_admin']::public.app_role[]) $$;
create or replace function public.exercise_save(p_id uuid, p_title text, p_instructions text default null, p_region text default null, p_level text default null, p_equipment text default null,
  p_contra text default null, p_specialties text[] default '{}') returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if private.current_org() is null or not private.library_role() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'informe o nome do exercício'; end if;
  if exists (select 1 from unnest(coalesce(p_specialties, '{}')) s where s not in (select key from public.specialties)) then raise exception 'especialidade inválida'; end if;
  if p_id is null then
    insert into public.exercise_library (org_id, title, instructions, body_region, level, equipment, contraindications, specialties, created_by)
      values (private.current_org(), btrim(p_title), nullif(btrim(coalesce(p_instructions, '')), ''), nullif(btrim(coalesce(p_region, '')), ''), nullif(p_level, ''), nullif(btrim(coalesce(p_equipment, '')), ''), nullif(btrim(coalesce(p_contra, '')), ''), coalesce(p_specialties, '{}'), (select auth.uid())) returning id into v_id;
  else
    update public.exercise_library set title = btrim(p_title), instructions = nullif(btrim(coalesce(p_instructions, '')), ''), body_region = nullif(btrim(coalesce(p_region, '')), ''), level = nullif(p_level, ''),
      equipment = nullif(btrim(coalesce(p_equipment, '')), ''), contraindications = nullif(btrim(coalesce(p_contra, '')), ''), specialties = coalesce(p_specialties, '{}') where id = p_id and org_id = private.current_org() returning id into v_id;
    if v_id is null then raise exception 'exercício não encontrado'; end if;
  end if;
  return v_id;
end $$;
create or replace function public.exercise_archive(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.library_role() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.exercise_library set active = false where id = p_id and org_id = private.current_org();
end $$;
create or replace function public.exercise_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_org() is null or not private.library_role() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'instructions', e.instructions, 'region', e.body_region, 'level', e.level, 'equipment', e.equipment,
      'contraindications', e.contraindications, 'specialties', e.specialties, 'has_video', e.video_ref is not null) order by e.title) from public.exercise_library e where e.org_id = private.current_org() and e.active), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- prescrição (fisio com vínculo)
create or replace function public.prescription_save(p_person uuid, p_id uuid, p_title text, p_weekly_target int, p_ends_on date, p_notes text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid := private.require_care(p_person); v_id uuid; x jsonb; i int := 0;
begin
  if length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'dê um nome à prescrição'; end if;
  if p_weekly_target is null or p_weekly_target not between 1 and 7 then raise exception 'a meta semanal deve ser de 1 a 7 treinos'; end if;
  if p_ends_on is not null and p_ends_on < private.today_sp() then raise exception 'a data final não pode estar no passado'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 40 then raise exception 'inclua de 1 a 40 exercícios'; end if;
  if p_id is null then
    insert into public.exercise_prescriptions (org_id, unit_id, person_id, professional_user_id, title, weekly_target, ends_on, notes) values (private.current_org(), v_unit, p_person, (select auth.uid()), btrim(p_title), p_weekly_target, p_ends_on, nullif(btrim(coalesce(p_notes, '')), '')) returning id into v_id;
  else
    update public.exercise_prescriptions set title = btrim(p_title), weekly_target = p_weekly_target, ends_on = p_ends_on, notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
     where id = p_id and person_id = p_person and org_id = private.current_org() and professional_user_id = (select auth.uid()) returning id into v_id;
    if v_id is null then raise exception 'prescrição não encontrada entre as suas'; end if;
    delete from public.prescription_items where prescription_id = v_id;
  end if;
  for x in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    if not exists (select 1 from public.exercise_library where id = (x ->> 'exercise_id')::uuid and org_id = private.current_org() and active) then raise exception 'exercício % inexistente ou arquivado', i; end if;
    insert into public.prescription_items (prescription_id, workout, position, exercise_id, sets, reps, duration_s, load_text, rest_s, notes)
      values (v_id, coalesce(nullif(x ->> 'workout', ''), 'A'), coalesce((x ->> 'position')::int, i), (x ->> 'exercise_id')::uuid, (x ->> 'sets')::int, (x ->> 'reps')::int, (x ->> 'duration_s')::int, nullif(x ->> 'load_text', ''), (x ->> 'rest_s')::int, nullif(x ->> 'notes', ''));
  end loop;
  return v_id;
end $$;
create or replace function public.prescription_set_status(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = '' as $$
declare r public.exercise_prescriptions;
begin
  select * into r from public.exercise_prescriptions where id = p_id and org_id = private.current_org() and professional_user_id = (select auth.uid());
  if r.id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  perform private.require_care(r.person_id);
  if p_status not in ('active','finished','cancelled') then raise exception 'situação inválida'; end if;
  update public.exercise_prescriptions set status = p_status, updated_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------- leitura consolidada
create or replace function private.training_payload(p_person uuid, p_clinical boolean) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object('summary', private.training_summary(p_person),
    'prescriptions', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'title', pr.title, 'status', pr.status, 'weekly_target', pr.weekly_target, 'starts_on', pr.starts_on, 'ends_on', pr.ends_on, 'notes', pr.notes,
        'professional', (select coalesce(nullif(btrim(ua.display_name), ''), 'Fisioterapeuta') from public.user_accounts ua where ua.user_id = pr.professional_user_id),
        'items', coalesce((select jsonb_agg(jsonb_build_object('id', it.id, 'workout', it.workout, 'position', it.position, 'exercise_id', it.exercise_id, 'title', e.title, 'instructions', e.instructions, 'level', e.level, 'equipment', e.equipment,
            'sets', it.sets, 'reps', it.reps, 'duration_s', it.duration_s, 'load_text', it.load_text, 'rest_s', it.rest_s, 'notes', it.notes)
            || case when p_clinical then jsonb_build_object('contraindications', e.contraindications) else '{}'::jsonb end order by it.workout, it.position)
          from public.prescription_items it join public.exercise_library e on e.id = it.exercise_id where it.prescription_id = pr.id), '[]'::jsonb)) order by (pr.status = 'active') desc, pr.created_at desc)
      from public.exercise_prescriptions pr where pr.person_id = p_person and pr.org_id = private.current_org() and (p_clinical or pr.status = 'active')), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'done_on', l.done_on, 'workout', l.workout, 'effort', l.effort, 'pain_during', l.pain_during, 'note', l.note, 'skipped', l.skipped, 'in_name_of', l.in_name_of, 'prescription_id', l.prescription_id) order by l.done_on desc, l.created_at desc)
      from (select * from public.workout_logs x where x.person_id = p_person and x.org_id = private.current_org() order by x.done_on desc, x.created_at desc limit 40) l), '[]'::jsonb));
end $$;
create or replace function public.my_training() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid;
begin
  perform private.require_scope('train'); v_person := private.current_person();
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return private.training_payload(v_person, false);
end $$;
create or replace function public.prof_training(p_person uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin perform private.require_care(p_person); perform private.log_clinical_access(p_person, 'professional', 'training'); return private.training_payload(p_person, true); end $$;
create or replace function public.admin_patient_training(p_person uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if private.current_org() is null or not private.has_org_role(array['manager']::public.app_role[]) or not exists (select 1 from public.people where id = p_person and org_id = private.current_org()) then raise exception 'sem permissão' using errcode = '42501'; end if;
  perform private.log_clinical_access(p_person, 'admin', 'training'); return private.training_payload(p_person, true);
end $$;

-- registro do treino pelo paciente (ou por quem o representa com escopo "train"); um por treino por dia; pular também fica registrado (sem contar como feito)
create or replace function public.my_workout_log(p_prescription uuid, p_workout text, p_items_done uuid[] default '{}', p_effort int default null, p_pain int default null, p_note text default null,
  p_skipped boolean default false, p_key text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_person uuid; pr public.exercise_prescriptions; v_id uuid; v_acting boolean;
begin
  perform private.require_scope('train'); v_person := private.current_person();
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into pr from public.exercise_prescriptions where id = p_prescription and person_id = v_person and org_id = private.current_org();
  if pr.id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if pr.status <> 'active' then raise exception 'esta prescrição não está ativa'; end if;
  if not exists (select 1 from public.prescription_items where prescription_id = p_prescription and workout = p_workout) then raise exception 'treino inexistente nesta prescrição'; end if;
  if p_effort is not null and p_effort not between 0 and 10 or p_pain is not null and p_pain not between 0 and 10 then raise exception 'esforço e dor vão de 0 a 10'; end if;
  if exists (select 1 from unnest(coalesce(p_items_done, '{}')) i where i not in (select id from public.prescription_items where prescription_id = p_prescription and workout = p_workout)) then raise exception 'exercício não pertence a este treino'; end if;
  if p_key is not null then select id into v_id from public.workout_logs where logged_by = (select auth.uid()) and idem_key = p_key; if v_id is not null then return v_id; end if; end if;
  if not coalesce(p_skipped, false) then select id into v_id from public.workout_logs where prescription_id = p_prescription and workout = p_workout and done_on = private.today_sp() and not skipped; if v_id is not null then return v_id; end if; end if;
  v_acting := (private.acting_rep()).id is not null;
  insert into public.workout_logs (org_id, person_id, prescription_id, workout, items_done, skipped, effort, pain_during, note, logged_by, in_name_of, idem_key)
    values (pr.org_id, v_person, p_prescription, p_workout, coalesce(p_items_done, '{}'), coalesce(p_skipped, false), p_effort, p_pain, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()), v_acting, p_key) returning id into v_id;
  return v_id;
end $$;

-- redefinições (definições ATUAIS + o que o treino acrescenta)
create or replace function public.my_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_person uuid; v_org uuid := private.current_org(); v_j jsonb; v_p record; r public.care_representations; v_ev boolean := true; v_bill boolean := true;
  v_pain_first numeric; v_pain_last numeric; v_pain_n int; v_goal jsonb; v_last_dec text;
begin
  perform private.require_scope('agenda');
  v_person := private.current_person();
  if v_person is null or v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  r := private.acting_rep(); if r.id is not null then v_ev := r.can_evolution; v_bill := r.can_billing; end if;
  v_j := private.journey_payload(v_person, false);
  select p.full_name, p.preferred_name, p.birth_date into v_p from public.people p where p.id = v_person;
  select (array_agg((x ->> 'score')::numeric order by (x ->> 'assessed_at')))[1], (array_agg((x ->> 'score')::numeric order by (x ->> 'assessed_at') desc))[1], count(*)
    into v_pain_first, v_pain_last, v_pain_n from jsonb_array_elements(v_j -> 'assessments') x where x ->> 'kind' = 'dor';
  select g into v_goal from jsonb_array_elements(v_j -> 'goals') g where g ->> 'status' = 'active' limit 1;
  select d ->> 'decision' into v_last_dec from jsonb_array_elements(v_j -> 'reassessments') d order by (d ->> 'decided_at') desc limit 1;
  return jsonb_build_object(
    'person', jsonb_build_object('id', v_person, 'name', coalesce(nullif(btrim(v_p.preferred_name), ''), v_p.full_name), 'birth_date', v_p.birth_date, 'age', private.age_years(v_p.birth_date)),
    'acting', case when r.id is not null then jsonb_build_object('kind', r.kind, 'representative', (select pe.full_name from public.people pe where pe.id = private.real_person())) end,
    'needs_birth_date', v_p.birth_date is null,
    'next_appointment', (v_j -> 'upcoming') -> 0,
    'plan', case when v_ev then v_j -> 'plan' end,
    'package_balance', case when v_bill then v_j -> 'package_balance' end,
    'pain', case when v_ev and v_pain_n > 0 then jsonb_build_object('first', v_pain_first, 'last', v_pain_last, 'count', v_pain_n) end,
    'goal', case when v_ev then v_goal end,
    'last_decision', case when v_ev then v_last_dec end,
    'renewal_open', v_bill and (v_j -> 'renewal') is not null and (v_j -> 'renewal') <> 'null'::jsonb,
    'videos_count', jsonb_array_length(v_j -> 'videos'),
    'unread_msgs', (select count(*) from public.care_messages m where m.person_id = v_person and m.sender <> 'patient' and m.created_at > now() - interval '7 days'),
    'training', case when r.id is null or r.can_train then private.training_summary(v_person) end
  );
end $$;

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
    union all
    select 'chamado', t.person_id, format('Chamado clínico aberto há %s h, ainda sem resposta', greatest(1, floor(extract(epoch from now() - t.created_at) / 3600)::int)), 0
      from public.support_tickets t join mine m on m.person_id = t.person_id where t.org_id = v_org and t.category = 'clinica' and t.status in ('open','in_progress') and t.first_response_at is null
    union all
    select 'dor_subindo', w.person_id, format('Dor %s/10 durante o treino em %s', max(w.pain_during), to_char(max(w.done_on), 'DD/MM')), 0
      from public.workout_logs w join mine m on m.person_id = w.person_id where w.org_id = v_org and not w.skipped and w.pain_during >= 7 and w.done_on > private.today_sp() - 7 group by w.person_id
    union all
    select 'adesao_baixa', pr.person_id, format('%s de %s treinos nos últimos 7 dias', (select count(distinct l.done_on) from public.workout_logs l where l.prescription_id = pr.id and not l.skipped and l.done_on > private.today_sp() - 7), pr.weekly_target), 2
      from public.exercise_prescriptions pr join mine m on m.person_id = pr.person_id
     where pr.org_id = v_org and pr.professional_user_id = v_uid and pr.status = 'active' and pr.starts_on <= private.today_sp() - 7
       and (select count(distinct l.done_on) from public.workout_logs l where l.prescription_id = pr.id and not l.skipped and l.done_on > private.today_sp() - 7) < pr.weekly_target * 0.5
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

create or replace function public.prof_kpis(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.current_org(); v_prof uuid; v_from date := coalesce(p_from, private.today_sp() - 29); v_to date := coalesce(p_to, private.today_sp()); v_tz text := 'America/Sao_Paulo';
  v_ag jsonb; v_cart jsonb; v_cont jsonb; v_res jsonb; v_qual jsonb; v_rev bigint; v_occ jsonb; v_booked numeric; v_avail numeric; v_adh numeric;
begin
  select id into v_prof from public.professionals where user_id = v_uid and org_id = v_org and active; if v_prof is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select jsonb_build_object('scheduled', count(*) filter (where status in ('scheduled','confirmed')), 'attended', count(*) filter (where status = 'attended'), 'no_show', count(*) filter (where status = 'no_show'),
      'cancelled', count(*) filter (where status in ('cancelled_by_patient','cancelled_by_clinic')),
      'attendance_rate', case when count(*) filter (where status in ('attended','no_show')) = 0 then null else round(100.0 * count(*) filter (where status = 'attended') / count(*) filter (where status in ('attended','no_show')), 1) end)
    into v_ag from public.appointments where professional_id = v_prof and org_id = v_org and (lower(period) at time zone v_tz)::date between v_from and v_to;
  -- ocupação: minutos marcados ÷ minutos de disponibilidade cadastrada no período (nulo se não há disponibilidade)
  select coalesce(sum(extract(epoch from upper(period) - lower(period)) / 60), 0) into v_booked from public.appointments where professional_id = v_prof and org_id = v_org and status in ('scheduled','confirmed','attended') and (lower(period) at time zone v_tz)::date between v_from and v_to;
  select coalesce(sum(extract(epoch from (r.end_time - r.start_time)) / 60 * (select count(*) from generate_series(v_from, v_to, interval '1 day') g(d) where extract(dow from g.d)::int = r.weekday and (r.valid_from is null or g.d::date >= r.valid_from) and (r.valid_until is null or g.d::date <= r.valid_until))), 0) into v_avail
    from public.availability_rules r where r.professional_id = v_prof;
  v_occ := case when v_avail > 0 then jsonb_build_object('booked_min', v_booked, 'available_min', v_avail, 'pct', round(100 * v_booked / v_avail, 1)) else null end;
  with mine as (select r.person_id from public.care_relationships r where r.professional_user_id = v_uid and r.org_id = v_org and r.revoked_at is null and r.valid_from <= now() and (r.valid_until is null or r.valid_until > now()))
  select jsonb_build_object('active', (select count(*) from mine), 'new_in_period', (select count(*) from public.care_relationships r where r.professional_user_id = v_uid and r.org_id = v_org and (r.created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to),
      'plans_active', (select count(*) from public.patient_plans pl join mine on mine.person_id = pl.person_id where pl.status = 'active'),
      'near_end', (select count(*) from public.patient_plans pl join mine on mine.person_id = pl.person_id where pl.status = 'active' and (select count(*) from public.appointments a where a.person_id = pl.person_id and a.status = 'attended' and lower(a.period)::date >= pl.started_on) >= greatest(1, ceil(pl.planned_sessions * 0.8))),
      'with_specialty', (select count(*) from public.patient_plans pl join mine on mine.person_id = pl.person_id where pl.status = 'active' and pl.specialty is not null)) into v_cart;
  select jsonb_build_object('decisions', count(*), 'continuity', count(*) filter (where decision in ('continuidade','manutencao')), 'discharged', count(*) filter (where decision = 'alta'),
      'continuity_rate', case when count(*) = 0 then null else round(100.0 * count(*) filter (where decision in ('continuidade','manutencao')) / count(*), 1) end)
    into v_cont from public.patient_reassessments where decided_by = v_uid and org_id = v_org and (decided_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
  -- resultado clínico DESCRITIVO: variação média de dor (primeira → última) dos meus pacientes com 2+ registros no período; sem ranking, sem interpretação
  with pts as (select m.person_id, (array_agg(m.value order by m.measured_at))[1] f, (array_agg(m.value order by m.measured_at desc))[1] l, count(*) n
      from public.patient_measurements m join public.care_relationships r on r.person_id = m.person_id and r.professional_user_id = v_uid and r.revoked_at is null
     where m.org_id = v_org and m.instrument_key = 'nprs' and (m.measured_at at time zone 'America/Sao_Paulo')::date between v_from and v_to group by m.person_id having count(*) >= 2)
  select jsonb_build_object('patients_with_pain_series', count(*), 'avg_pain_change', case when count(*) = 0 then null else round(avg(l - f), 1) end) into v_res from pts;
  select jsonb_build_object('answers', count(*), 'avg_score', case when count(*) = 0 then null else round(avg(sr.score), 1) end,
      'nps', case when count(*) = 0 then null else round(100.0 * (count(*) filter (where sr.score >= 9) - count(*) filter (where sr.score <= 6)) / count(*), 0) end)
    into v_qual from public.survey_responses sr join public.appointments a on a.id = sr.appointment_id where a.professional_id = v_prof and sr.org_id = v_org and (sr.created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
  -- adesão: média, entre as MINHAS prescrições ativas, de (dias com treino ÷ meta no período), limitada a 100%
  select round(avg(least(100, 100.0 * done / greatest(1, ceil(target * span / 7.0)))), 0) into v_adh from (
    select pr.weekly_target target, (v_to - greatest(v_from, pr.starts_on) + 1) span, (select count(distinct l.done_on) from public.workout_logs l where l.prescription_id = pr.id and not l.skipped and l.done_on between v_from and v_to) done
      from public.exercise_prescriptions pr where pr.professional_user_id = v_uid and pr.org_id = v_org and pr.status = 'active' and pr.starts_on <= v_to and (pr.ends_on is null or pr.ends_on >= v_from)) z where span > 0;
  select coalesce(sum(private.session_value_cents(cp.product_id)), 0) into v_rev from public.physio_payouts x join public.client_packages cp on cp.id = x.client_package_id
   where x.professional_id = v_prof and x.kind = 'session' and x.status <> 'void' and (x.created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
  return jsonb_build_object('from', v_from, 'to', v_to, 'agenda', v_ag, 'occupancy', v_occ, 'portfolio', v_cart, 'continuity', v_cont, 'outcome', v_res, 'quality', v_qual, 'revenue_generated_cents', v_rev,
    'adherence', v_adh, 'adherence_note', case when v_adh is null then 'Indisponível até haver treinos prescritos por você e registrados pelos pacientes.' else 'Treinos feitos ÷ meta semanal dos seus pacientes com prescrição ativa.' end);
end $$;

revoke all on function public.exercise_save(uuid, text, text, text, text, text, text, text[]), public.exercise_archive(uuid), public.exercise_list(), public.prescription_save(uuid, uuid, text, int, date, text, jsonb),
  public.prescription_set_status(uuid, text), public.my_training(), public.prof_training(uuid), public.admin_patient_training(uuid), public.my_workout_log(uuid, text, uuid[], int, int, text, boolean, text),
  public.my_home(), public.prof_home(), public.prof_kpis(date, date) from public, anon;
grant execute on function public.exercise_save(uuid, text, text, text, text, text, text, text[]), public.exercise_archive(uuid), public.exercise_list(), public.prescription_save(uuid, uuid, text, int, date, text, jsonb),
  public.prescription_set_status(uuid, text), public.my_training(), public.prof_training(uuid), public.admin_patient_training(uuid), public.my_workout_log(uuid, text, uuid[], int, int, text, boolean, text),
  public.my_home(), public.prof_home(), public.prof_kpis(date, date) to authenticated;
revoke all on function private.training_summary(uuid), private.library_role(), private.training_payload(uuid, boolean) from public, anon, authenticated;
