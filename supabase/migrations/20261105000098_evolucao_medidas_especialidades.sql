-- HP Group Hub — 098 Portais F3: evolução do paciente (medidas por especialidade, linha do tempo por consulta, registro rápido pós-sessão).
-- Privacidade: igual à jornada (058) — o PRÓPRIO paciente (ou quem o representa com escopo "evolution"), o fisio com vínculo e o admin (gestor) pelo caminho REGISTRADO (097).
-- Registros são IMUTÁVEIS (corrigir = novo registro). Nenhum instrumento licenciado entra aqui sem conferência de fonte/licença: só medidas por teste ou procedimento e escalas numéricas de uso livre.

create table public.specialties (key text primary key, label text not null, sort int not null default 100);
insert into public.specialties (key, label, sort) values
  ('ortopedica', 'Fisioterapia Ortopédica', 1), ('neurofuncional', 'Fisioterapia Neurofuncional', 2), ('geriatrica', 'Fisioterapia Geriátrica', 3),
  ('respiratoria', 'Fisioterapia Respiratória', 4), ('pediatrica', 'Fisioterapia Pediátrica', 5), ('desportiva', 'Fisioterapia Desportiva', 6);
alter table public.patient_plans add column specialty text references public.specialties(key) on delete restrict;

create table public.assessment_instruments (
  key text primary key, label text not null, unit text, min_value numeric not null, max_value numeric not null check (max_value > min_value),
  better text not null check (better in ('higher','lower','none')),                         -- higher/lower = qual direção é melhora; none = a medida só descreve (ex.: graus de um movimento)
  needs_side boolean not null default false, needs_label boolean not null default false,    -- lado D/E; nome do movimento/atividade
  applied_by text not null check (applied_by in ('professional','patient','both')),
  specialties text[] not null default '{}', source text not null, active boolean not null default true, sort int not null default 100
);
insert into public.assessment_instruments (key, label, unit, min_value, max_value, better, needs_side, needs_label, applied_by, specialties, source, sort) values
  ('nprs', 'Dor (0 a 10)', 'pts', 0, 10, 'lower', false, false, 'both', '{ortopedica,neurofuncional,geriatrica,respiratoria,pediatrica,desportiva}', 'Escala numérica de dor, uso livre', 1),
  ('psfs', 'Atividade que quero voltar a fazer (0 a 10)', 'pts', 0, 10, 'higher', false, true, 'both', '{ortopedica,neurofuncional,geriatrica,respiratoria,pediatrica,desportiva}', 'Escala funcional específica do paciente: ele nomeia a atividade e dá a nota', 2),
  ('goniometria', 'Amplitude de movimento', 'graus', 0, 360, 'none', true, true, 'professional', '{ortopedica,desportiva,geriatrica}', 'Goniometria: medida em graus (procedimento clínico, sem licença)', 10),
  ('forca_manual', 'Força muscular (grau 0 a 5)', 'grau', 0, 5, 'higher', true, true, 'professional', '{ortopedica,neurofuncional,geriatrica,desportiva,pediatrica}', 'Graduação manual 0 a 5 (procedimento clínico)', 11),
  ('dinamometria', 'Força por dinamômetro', 'kgf', 0, 500, 'higher', true, true, 'professional', '{ortopedica,desportiva,geriatrica}', 'Medida por dinamômetro (sem licença)', 12),
  ('perimetria', 'Perimetria / edema', 'cm', 0, 200, 'none', true, true, 'professional', '{ortopedica,desportiva}', 'Medida por fita métrica (sem licença)', 13),
  ('tug', 'Timed Up and Go', 's', 0, 300, 'lower', false, false, 'professional', '{neurofuncional,geriatrica,ortopedica}', 'Teste de desempenho por cronometria (sem licença)', 20),
  ('marcha_10m', 'Velocidade de marcha (10 m)', 's', 0, 300, 'lower', false, false, 'professional', '{neurofuncional,geriatrica}', 'Teste de desempenho por cronometria (sem licença)', 21),
  ('sentar_levantar_30s', 'Sentar e levantar em 30 s', 'repetições', 0, 100, 'higher', false, false, 'professional', '{geriatrica,ortopedica}', 'Teste de desempenho por contagem (sem licença)', 22),
  ('preensao', 'Força de preensão manual', 'kgf', 0, 150, 'higher', true, false, 'professional', '{geriatrica,neurofuncional}', 'Medida por dinamômetro de mão (sem licença)', 23),
  ('unipodal', 'Equilíbrio em apoio unipodal', 's', 0, 120, 'higher', true, false, 'professional', '{geriatrica,neurofuncional,desportiva}', 'Teste de desempenho por cronometria (sem licença)', 24),
  ('caminhada_6min', 'Teste de caminhada de 6 minutos', 'm', 0, 1000, 'higher', false, false, 'professional', '{respiratoria,geriatrica}', 'Teste de desempenho por distância (sem licença)', 30),
  ('spo2', 'Saturação de oxigênio (SpO₂)', '%', 50, 100, 'higher', false, false, 'professional', '{respiratoria}', 'Oximetria (medida, sem licença)', 31),
  ('freq_resp', 'Frequência respiratória', 'irpm', 0, 80, 'none', false, false, 'professional', '{respiratoria,pediatrica}', 'Contagem (medida, sem licença)', 32),
  ('freq_card', 'Frequência cardíaca', 'bpm', 20, 250, 'none', false, false, 'professional', '{respiratoria,geriatrica,desportiva}', 'Contagem (medida, sem licença)', 33),
  ('dispneia', 'Falta de ar (0 a 10)', 'pts', 0, 10, 'lower', false, false, 'both', '{respiratoria}', 'Escala numérica 0 a 10 de uso livre; escalas licenciadas (Borg, mMRC, CAT) só após conferir a licença', 34),
  ('pico_fluxo', 'Pico de fluxo expiratório', 'L/min', 0, 1000, 'higher', false, false, 'professional', '{respiratoria}', 'Medida por peak flow (sem licença)', 35),
  ('salto_unipodal', 'Salto horizontal unipodal', 'cm', 0, 400, 'higher', true, false, 'professional', '{desportiva}', 'Teste de desempenho por distância (sem licença)', 40),
  ('y_balance', 'Y-Balance (alcance)', 'cm', 0, 200, 'higher', true, true, 'professional', '{desportiva}', 'Teste de desempenho por distância (sem licença)', 41),
  ('tarefa_motora', 'Tarefa motora (tempo)', 's', 0, 600, 'lower', false, true, 'professional', '{pediatrica}', 'Tempo de uma tarefa observada pelo fisioterapeuta (sem licença)', 50);

create table public.patient_measurements (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade, plan_id uuid references public.patient_plans(id) on delete set null,
  instrument_key text not null references public.assessment_instruments(key) on delete restrict, label text check (label is null or length(btrim(label)) between 2 and 80),
  side text check (side is null or side in ('D','E','bilateral')), value numeric not null, phase text not null default 'assessment' check (phase in ('before','after','assessment')),
  appointment_id uuid references public.appointments(id) on delete set null, note text check (note is null or length(note) <= 500),
  measured_at timestamptz not null default clock_timestamp(), recorded_by uuid references auth.users(id) on delete set null, recorded_by_role text not null check (recorded_by_role in ('patient','professional')),
  idem_key text, created_at timestamptz not null default now()
);
create index patient_measurements_person_idx on public.patient_measurements (person_id, measured_at);
create unique index patient_measurements_idem_uq on public.patient_measurements (recorded_by, idem_key) where idem_key is not null;

create table public.session_notes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade, appointment_id uuid not null references public.appointments(id) on delete cascade,
  summary_patient text check (summary_patient is null or length(summary_patient) <= 1000),            -- visível ao paciente
  next_step text check (next_step is null or length(next_step) <= 500),                                -- visível ao paciente
  clinical_note text check (clinical_note is null or length(clinical_note) <= 4000),                    -- RESTRITA: fisio vinculado e admin (leitura registrada); nunca o paciente
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default clock_timestamp(), idem_key text
);
create index session_notes_appt_idx on public.session_notes (appointment_id, created_at desc);
create unique index session_notes_idem_uq on public.session_notes (created_by, idem_key) where idem_key is not null;

alter table public.specialties enable row level security; alter table public.assessment_instruments enable row level security;
alter table public.patient_measurements enable row level security; alter table public.session_notes enable row level security;
grant select on public.specialties, public.assessment_instruments, public.patient_measurements, public.session_notes to authenticated;
create policy specialties_read on public.specialties for select to authenticated using (true);
create policy instruments_read on public.assessment_instruments for select to authenticated using (active);
create policy measurements_read on public.patient_measurements for select to authenticated using (private.in_org(org_id) and private.has_care_relationship(person_id));
create policy session_notes_read on public.session_notes for select to authenticated using (private.in_org(org_id) and private.has_care_relationship(person_id));
create trigger audit_patient_measurements after insert on public.patient_measurements for each row execute function private.audit_row('instrument_key','value');

-- ---------------------------------------------------------------- leitura consolidada (séries por medida + linha do tempo por consulta)
create or replace function private.evolution_payload(p_person uuid, p_clinical boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); pl public.patient_plans; v_series jsonb; v_timeline jsonb; v_att int := 0;
begin
  select * into pl from public.patient_plans where person_id = p_person and org_id = v_org and status = 'active';
  if not found then select * into pl from public.patient_plans where person_id = p_person and org_id = v_org order by created_at desc limit 1; end if;
  if pl.id is not null then
    select count(*) into v_att from public.appointments a where a.person_id = p_person and a.org_id = v_org and a.status = 'attended' and lower(a.period)::date >= pl.started_on and (pl.closed_at is null or lower(a.period) <= pl.closed_at);
  end if;

  with raw as (
    select m.id, m.instrument_key::text ik, m.label::text, m.side::text, m.value, m.measured_at at, m.phase::text, m.appointment_id, m.recorded_by_role::text by_role,
           coalesce(nullif(btrim(ua.display_name), ''), case m.recorded_by_role when 'patient' then 'Paciente' else 'Profissional' end)::text author
      from public.patient_measurements m left join public.user_accounts ua on ua.user_id = m.recorded_by where m.person_id = p_person and m.org_id = v_org
    union all   -- a dor registrada na jornada (058) entra na mesma série
    select a.id, 'nprs', null::text, null::text, a.score::numeric, a.assessed_at, 'assessment', null::uuid, a.recorded_by_role::text,
           (case when a.recorded_by_role = 'patient' then 'Paciente' else coalesce((select u2.display_name from public.user_accounts u2 where u2.user_id = a.recorded_by), 'Profissional') end)::text
      from public.patient_assessments a where a.person_id = p_person and a.org_id = v_org and a.kind = 'dor'
    union all
    select ca.id, 'nprs', null::text, null::text, ca.pain_scale::numeric, ca.done_at, 'assessment', null::uuid, 'patient', 'Paciente'::text
      from public.care_activity ca where ca.person_id = p_person and ca.org_id = v_org and ca.pain_scale is not null
  ), grp as (
    select r.ik, r.label, r.side, i.label ilabel, i.unit, i.better, i.sort,
           jsonb_agg(jsonb_build_object('id', r.id, 'at', r.at, 'value', r.value, 'by', r.by_role, 'author', r.author, 'phase', r.phase, 'appointment_id', r.appointment_id) order by r.at) pts,
           (array_agg(r.value order by r.at))[1] first_v, (array_agg(r.value order by r.at desc))[1] last_v, count(*) n
      from raw r join public.assessment_instruments i on i.key = r.ik group by r.ik, r.label, r.side, i.label, i.unit, i.better, i.sort
  )
  select coalesce(jsonb_agg(jsonb_build_object('instrument', ik, 'name', ilabel, 'label', label, 'side', side, 'unit', unit, 'better', better, 'points', pts, 'first', first_v, 'last', last_v, 'count', n)
                           order by sort, ilabel, label nulls first, side nulls first), '[]'::jsonb) into v_series from grp;

  select coalesce(jsonb_agg(t order by (t ->> 'at') desc), '[]'::jsonb) into v_timeline from (
    select jsonb_build_object('appointment_id', a.id, 'at', lower(a.period), 'status', a.status, 'service', s.name, 'professional', pr.display_name,
        'session_no', case when a.status = 'attended' then count(*) filter (where a.status = 'attended') over (order by lower(a.period) rows between unbounded preceding and current row) end,
        'pain_before', (select m.value from public.patient_measurements m where m.appointment_id = a.id and m.instrument_key = 'nprs' and m.phase = 'before' order by m.measured_at desc limit 1),
        'pain_after', (select m.value from public.patient_measurements m where m.appointment_id = a.id and m.instrument_key = 'nprs' and m.phase = 'after' order by m.measured_at desc limit 1),
        'summary', n.summary_patient, 'next_step', n.next_step)
        || case when p_clinical then jsonb_build_object('clinical_note', n.clinical_note) else '{}'::jsonb end t
      from public.appointments a join public.services s on s.id = a.service_id join public.professionals pr on pr.id = a.professional_id
      left join lateral (select x.summary_patient, x.next_step, x.clinical_note from public.session_notes x where x.appointment_id = a.id order by x.created_at desc limit 1) n on true
     where a.person_id = p_person and a.org_id = v_org and a.status in ('attended','no_show','professional_no_show','cancelled_by_patient','cancelled_by_clinic') and lower(a.period) <= now()
       and (pl.id is null or lower(a.period)::date >= pl.started_on)
     order by lower(a.period) desc limit 60) q;

  return jsonb_build_object('specialty', pl.specialty, 'specialty_label', (select sp.label from public.specialties sp where sp.key = pl.specialty),
    'plan', case when pl.id is null then null else jsonb_build_object('planned_sessions', pl.planned_sessions, 'attended', v_att, 'status', pl.status, 'started_on', pl.started_on) end,
    'series', v_series, 'timeline', v_timeline);
end $$;

-- ---------------------------------------------------------------- paciente / fisio / admin
create or replace function public.my_evolution() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid;
begin
  perform private.require_scope('evolution'); v_person := private.current_person();
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return private.evolution_payload(v_person, false);
end $$;
create or replace function public.prof_patient_evolution(p_person uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_care(p_person); perform private.log_clinical_access(p_person, 'professional', 'evolution');
  -- "recordable": atendimentos MEUS com este paciente, dos últimos 21 dias até 2 h à frente, para o registro rápido (has_note = já tem registro)
  return private.evolution_payload(p_person, true) || jsonb_build_object('recordable', coalesce((
    select jsonb_agg(jsonb_build_object('appointment_id', a.id, 'at', lower(a.period), 'status', a.status, 'service', sv.name, 'has_note', exists (select 1 from public.session_notes n where n.appointment_id = a.id)) order by lower(a.period) desc)
      from public.appointments a join public.professionals pr on pr.id = a.professional_id join public.services sv on sv.id = a.service_id
     where a.person_id = p_person and a.org_id = private.current_org() and pr.user_id = (select auth.uid()) and a.status not in ('cancelled_by_patient','cancelled_by_clinic','rescheduled')
       and lower(a.period) between now() - interval '21 days' and now() + interval '2 hours'), '[]'::jsonb));
end $$;
create or replace function public.admin_patient_evolution(p_person uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if private.current_org() is null or not private.has_org_role(array['manager']::public.app_role[]) or not exists (select 1 from public.people where id = p_person and org_id = private.current_org()) then
    raise exception 'sem permissão' using errcode = '42501'; end if;
  perform private.log_clinical_access(p_person, 'admin', 'evolution');
  return private.evolution_payload(p_person, true);
end $$;
create or replace function public.instruments_list() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'unit', i.unit, 'min', i.min_value, 'max', i.max_value, 'better', i.better, 'needs_side', i.needs_side, 'needs_label', i.needs_label,
    'applied_by', i.applied_by, 'specialties', i.specialties, 'source', i.source) order by i.sort), '[]'::jsonb) from public.assessment_instruments i where i.active and (select auth.uid()) is not null
$$;

-- valida e grava UMA medida (usado pelas três portas de entrada)
create or replace function private.measurement_insert(p_person uuid, p_unit uuid, p_instrument text, p_label text, p_side text, p_value numeric, p_phase text, p_appointment uuid, p_note text,
  p_measured_at timestamptz, p_role text, p_key text) returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.assessment_instruments; v_id uuid; v_plan uuid;
begin
  select * into i from public.assessment_instruments where key = p_instrument and active;
  if not found then raise exception 'instrumento de medida inexistente'; end if;
  if p_role = 'patient' and i.applied_by = 'professional' then raise exception 'esta medida é registrada pelo fisioterapeuta'; end if;
  if p_role = 'professional' and i.applied_by = 'patient' then raise exception 'esta medida é registrada pelo paciente'; end if;
  if p_value is null or p_value < i.min_value or p_value > i.max_value then raise exception 'valor fora da faixa de % (% a % %)', i.label, i.min_value, i.max_value, coalesce(i.unit, ''); end if;
  if i.needs_label and length(btrim(coalesce(p_label, ''))) < 2 then raise exception 'informe o nome do movimento/atividade'; end if;
  if i.needs_side and coalesce(p_side, '') not in ('D','E','bilateral') then raise exception 'informe o lado (D, E ou bilateral)'; end if;
  if p_measured_at is not null and p_measured_at > now() + interval '5 minutes' then raise exception 'a data da medida não pode estar no futuro'; end if;
  if p_key is not null then select id into v_id from public.patient_measurements where recorded_by = (select auth.uid()) and idem_key = p_key; if v_id is not null then return v_id; end if; end if;
  select id into v_plan from public.patient_plans where person_id = p_person and status = 'active';
  insert into public.patient_measurements (org_id, unit_id, person_id, plan_id, instrument_key, label, side, value, phase, appointment_id, note, measured_at, recorded_by, recorded_by_role, idem_key)
    values (private.current_org(), p_unit, p_person, v_plan, p_instrument, case when i.needs_label then btrim(p_label) end, case when i.needs_side then p_side end, p_value, coalesce(p_phase, 'assessment'), p_appointment,
            nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_measured_at, clock_timestamp()), (select auth.uid()), p_role, p_key) returning id into v_id;
  return v_id;
end $$;

create or replace function public.prof_measurement_add(p_person uuid, p_instrument text, p_label text, p_side text, p_value numeric, p_note text default null, p_measured_at timestamptz default null, p_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid := private.require_care(p_person);
begin return private.measurement_insert(p_person, v_unit, p_instrument, p_label, p_side, p_value, 'assessment', null, p_note, p_measured_at, 'professional', p_key); end $$;

create or replace function public.my_measurement_add(p_instrument text, p_label text, p_value numeric, p_note text default null, p_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid; v_unit uuid;
begin
  perform private.require_scope('train'); v_person := private.current_person();
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select unit_id into v_unit from public.people where id = v_person and org_id = private.current_org();
  if v_unit is null then raise exception 'cadastro sem unidade: peça à equipe para completar'; end if;
  return private.measurement_insert(v_person, v_unit, p_instrument, p_label, null, p_value, 'assessment', null, p_note, null, 'patient', p_key);
end $$;

-- REGISTRO RÁPIDO pós-sessão (cerca de 30 s): resumo ao paciente, próxima conduta, nota clínica restrita e medidas do dia. Idempotente pela chave.
create or replace function public.prof_session_record(p_person uuid, p_appointment uuid, p_summary text default null, p_next_step text default null, p_clinical_note text default null,
  p_measures jsonb default '[]'::jsonb, p_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid := private.require_care(p_person); v_id uuid; a public.appointments; x jsonb;
begin
  select ap.* into a from public.appointments ap join public.professionals pr on pr.id = ap.professional_id
   where ap.id = p_appointment and ap.person_id = p_person and ap.org_id = private.current_org() and pr.user_id = (select auth.uid());
  if a.id is null then raise exception 'atendimento não encontrado entre os seus atendimentos com este paciente'; end if;
  if a.status in ('cancelled_by_patient','cancelled_by_clinic','rescheduled') then raise exception 'atendimento cancelado/remarcado não recebe registro'; end if;
  if lower(a.period) > now() + interval '2 hours' then raise exception 'o registro só pode ser feito perto ou depois do horário do atendimento'; end if;
  if length(btrim(coalesce(p_summary, ''))) = 0 and length(btrim(coalesce(p_next_step, ''))) = 0 and length(btrim(coalesce(p_clinical_note, ''))) = 0 and jsonb_array_length(coalesce(p_measures, '[]'::jsonb)) = 0 then
    raise exception 'registre ao menos um resumo, uma conduta ou uma medida'; end if;
  if p_key is not null then select id into v_id from public.session_notes where created_by = (select auth.uid()) and idem_key = p_key; if v_id is not null then return v_id; end if; end if;
  insert into public.session_notes (org_id, unit_id, person_id, appointment_id, summary_patient, next_step, clinical_note, created_by, idem_key)
    values (private.current_org(), v_unit, p_person, p_appointment, nullif(btrim(coalesce(p_summary, '')), ''), nullif(btrim(coalesce(p_next_step, '')), ''), nullif(btrim(coalesce(p_clinical_note, '')), ''), (select auth.uid()), p_key) returning id into v_id;
  for x in select * from jsonb_array_elements(coalesce(p_measures, '[]'::jsonb)) loop
    -- a medida pertence ao DIA DO ATENDIMENTO (antes = início, depois = fim), para a série ficar na ordem certa mesmo se o registro for feito depois
    perform private.measurement_insert(p_person, v_unit, x ->> 'instrument', x ->> 'label', x ->> 'side', (x ->> 'value')::numeric, coalesce(x ->> 'phase', 'assessment'), p_appointment, x ->> 'note',
      least(case when x ->> 'phase' = 'after' then upper(a.period) else lower(a.period) end, clock_timestamp()), 'professional', null);
  end loop;
  return v_id;
end $$;

create or replace function public.patient_plan_specialty_set(p_person uuid, p_specialty text) returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_care(p_person);
  if p_specialty is not null and not exists (select 1 from public.specialties where key = p_specialty) then raise exception 'especialidade inválida'; end if;
  select id into v_id from public.patient_plans where person_id = p_person and org_id = private.current_org() order by (status = 'active') desc, created_at desc limit 1;
  if v_id is null then raise exception 'defina primeiro o plano de sessões do paciente'; end if;
  update public.patient_plans set specialty = p_specialty, updated_at = now() where id = v_id;
end $$;

revoke all on function public.my_evolution(), public.prof_patient_evolution(uuid), public.admin_patient_evolution(uuid), public.instruments_list(),
  public.prof_measurement_add(uuid, text, text, text, numeric, text, timestamptz, text), public.my_measurement_add(text, text, numeric, text, text),
  public.prof_session_record(uuid, uuid, text, text, text, jsonb, text), public.patient_plan_specialty_set(uuid, text) from public, anon;
grant execute on function public.my_evolution(), public.prof_patient_evolution(uuid), public.admin_patient_evolution(uuid), public.instruments_list(),
  public.prof_measurement_add(uuid, text, text, text, numeric, text, timestamptz, text), public.my_measurement_add(text, text, numeric, text, text),
  public.prof_session_record(uuid, uuid, text, text, text, jsonb, text), public.patient_plan_specialty_set(uuid, text) to authenticated;
revoke all on function private.evolution_payload(uuid, boolean), private.measurement_insert(uuid, uuid, text, text, text, numeric, text, uuid, text, timestamptz, text, text) from public, anon, authenticated;
