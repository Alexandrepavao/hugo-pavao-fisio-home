-- HP Group Hub — 129 Área do paciente (jornada visual): etapas da jornada DEFINIDAS PELO FISIOTERAPEUTA e conteúdos educativos aprovados por ele.
-- Regras (pedido do proprietário, 14/11/2026):
--  · as etapas da jornada (ex.: Avaliação, Cuidado inicial, Movimento, Atividades, Reavaliação) e a etapa ATUAL vêm do plano registrado pelo profissional; NADA avança sozinho por número de sessões.
--  · sem etapas definidas, o paciente vê um estado honesto (“seu fisioterapeuta ainda vai definir”), nunca uma etapa inventada.
--  · conteúdos educativos (objetivos, papel da rotina, preparação para reavaliações, autonomia e alta) são escritos/aprovados pelo fisioterapeuta para aquele paciente; o sistema não gera conteúdo, prescrição nem prazo de cura.
-- Privacidade igual à jornada (058/097/098): o PRÓPRIO paciente (ou quem o representa com escopo "evolution"), o fisioterapeuta com vínculo assistencial ativo; gestor/comercial/financeiro não escrevem aqui.
-- Toda tabela nova tem RLS e NENHUM GRANT: tudo passa por função que valida a permissão. Só acrescenta (nada existente é removido).

-- ---------------------------------------------------------------- etapas da jornada no plano
alter table public.patient_plans add column if not exists journey_stages text[] check (journey_stages is null or cardinality(journey_stages) between 3 and 7);
alter table public.patient_plans add column if not exists journey_stage int check (journey_stage is null or journey_stage >= 0);
alter table public.patient_plans add column if not exists journey_stage_at timestamptz;

create table if not exists public.plan_stage_events (
  id bigint generated always as identity primary key, org_id uuid not null, person_id uuid not null references public.people (id) on delete cascade, plan_id uuid references public.patient_plans (id) on delete set null,
  stage_index int not null, stage_name text not null, stages text[] not null, set_by uuid, set_at timestamptz not null default now()
);
create index if not exists plan_stage_events_person_idx on public.plan_stage_events (person_id, set_at desc);
alter table public.plan_stage_events enable row level security;
revoke all on public.plan_stage_events from public, anon, authenticated;

-- o fisioterapeuta (com vínculo) define as etapas e a etapa atual; cada mudança fica no histórico
create or replace function public.plan_journey_set(p_person uuid, p_stages text[], p_current int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid; pl public.patient_plans; s text[]; x text; v_name text;
begin
  v_unit := private.require_care(p_person);
  select * into pl from public.patient_plans where person_id = p_person and status = 'active' and org_id = private.current_org();
  if pl.id is null then raise exception 'Defina primeiro o plano de sessões deste paciente.'; end if;
  if p_stages is null or cardinality(p_stages) not between 3 and 7 then raise exception 'A jornada precisa de 3 a 7 etapas.'; end if;
  s := '{}'; foreach x in array p_stages loop
    x := btrim(coalesce(x, ''));
    if length(x) not between 2 and 40 then raise exception 'Cada etapa precisa ter de 2 a 40 caracteres.'; end if;
    if lower(x) = any (select lower(y) from unnest(s) y) then raise exception 'As etapas não podem se repetir.'; end if;
    s := s || x;
  end loop;
  if p_current is null or p_current < 0 or p_current >= cardinality(s) then raise exception 'Escolha a etapa atual entre as etapas da jornada.'; end if;
  v_name := s[p_current + 1];
  update public.patient_plans set journey_stages = s, journey_stage = p_current, journey_stage_at = clock_timestamp(), updated_at = now() where id = pl.id;
  insert into public.plan_stage_events (org_id, person_id, plan_id, stage_index, stage_name, stages, set_by, set_at) values (pl.org_id, p_person, pl.id, p_current, v_name, s, (select auth.uid()), clock_timestamp());
  return jsonb_build_object('stages', to_jsonb(s), 'current', p_current, 'set_at', clock_timestamp());
end $$;
revoke all on function public.plan_journey_set(uuid, text[], int) from public, anon;
grant execute on function public.plan_journey_set(uuid, text[], int) to authenticated;

-- quem lê a jornada: o paciente (my_) e o fisioterapeuta com vínculo (prof_). Objetivo = a meta ativa mais recente definida com o profissional.
create or replace function private.journey_plan_payload(p_person uuid, p_history boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pl public.patient_plans; g record; v_spec text;
begin
  select * into pl from public.patient_plans where person_id = p_person and status = 'active' and org_id = private.current_org();
  select id, title, details, target_date into g from public.patient_goals where person_id = p_person and status = 'active' and org_id = private.current_org() order by created_at desc limit 1;
  if pl.id is not null and pl.specialty is not null then select label into v_spec from public.specialties where key = pl.specialty; end if;
  return jsonb_build_object(
    'plan', case when pl.id is null then null else jsonb_build_object('planned_sessions', pl.planned_sessions, 'started_on', pl.started_on, 'maintenance', pl.maintenance, 'specialty_label', v_spec) end,
    'stages', case when pl.id is null then null else to_jsonb(pl.journey_stages) end, 'current', case when pl.id is null then null else pl.journey_stage end, 'set_at', case when pl.id is null then null else pl.journey_stage_at end,
    'goal', case when g.id is null then null else jsonb_build_object('id', g.id, 'title', g.title, 'details', g.details, 'target_date', g.target_date) end)
    || case when p_history then jsonb_build_object('history', coalesce((select jsonb_agg(jsonb_build_object('stage_index', e.stage_index, 'stage_name', e.stage_name, 'set_at', e.set_at) order by e.set_at desc)
         from (select * from public.plan_stage_events where person_id = p_person and org_id = private.current_org() order by set_at desc, id desc limit 10) e), '[]'::jsonb)) else '{}'::jsonb end;
end $$;
revoke all on function private.journey_plan_payload(uuid, boolean) from public, anon, authenticated;

create or replace function public.my_journey_plan() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid;
begin
  perform private.require_scope('evolution'); v_person := private.current_person();
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return private.journey_plan_payload(v_person, false);
end $$;
create or replace function public.prof_journey_plan(p_person uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin perform private.require_care(p_person); perform private.log_clinical_access(p_person, 'professional', 'journey'); return private.journey_plan_payload(p_person, true); end $$;
revoke all on function public.my_journey_plan(), public.prof_journey_plan(uuid) from public, anon;
grant execute on function public.my_journey_plan(), public.prof_journey_plan(uuid) to authenticated;

-- ---------------------------------------------------------------- conteúdos educativos aprovados pelo fisioterapeuta
create table if not exists public.patient_education (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units (id) on delete restrict,
  person_id uuid not null references public.people (id) on delete cascade,
  topic text not null check (topic in ('objetivos', 'rotina', 'reavaliacao', 'autonomia')),
  title text not null check (length(btrim(title)) between 2 and 120), body text not null check (length(btrim(body)) between 10 and 2000),
  created_by uuid, created_at timestamptz not null default now(), revoked_at timestamptz
);
create index if not exists patient_education_person_idx on public.patient_education (person_id, created_at desc);
alter table public.patient_education enable row level security;
revoke all on public.patient_education from public, anon, authenticated;

create or replace function public.education_publish(p_person uuid, p_topic text, p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid; v_id uuid;
begin
  v_unit := private.require_care(p_person);
  if p_topic not in ('objetivos', 'rotina', 'reavaliacao', 'autonomia') then raise exception 'Tema inválido.'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 2 and 120 then raise exception 'O título precisa ter de 2 a 120 caracteres.'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 10 and 2000 then raise exception 'O texto precisa ter de 10 a 2000 caracteres.'; end if;
  insert into public.patient_education (org_id, unit_id, person_id, topic, title, body, created_by) values (private.current_org(), v_unit, p_person, p_topic, btrim(p_title), btrim(p_body), (select auth.uid())) returning id into v_id;
  return v_id;
end $$;
create or replace function public.education_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.patient_education;
begin
  select * into e from public.patient_education where id = p_id and org_id = private.current_org();
  if e.id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  perform private.require_care(e.person_id);
  update public.patient_education set revoked_at = now() where id = p_id and revoked_at is null;
end $$;
create or replace function private.education_list(p_person uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'topic', e.topic, 'title', e.title, 'body', e.body, 'created_at', e.created_at) order by e.topic, e.created_at desc), '[]'::jsonb)
    from public.patient_education e where e.person_id = p_person and e.org_id = private.current_org() and e.revoked_at is null
$$;
revoke all on function private.education_list(uuid) from public, anon, authenticated;
create or replace function public.my_education() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid;
begin
  perform private.require_scope('evolution'); v_person := private.current_person();
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return private.education_list(v_person);
end $$;
create or replace function public.prof_education(p_person uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin perform private.require_care(p_person); return private.education_list(p_person); end $$;
revoke all on function public.education_publish(uuid, text, text, text), public.education_revoke(uuid), public.my_education(), public.prof_education(uuid) from public, anon;
grant execute on function public.education_publish(uuid, text, text, text), public.education_revoke(uuid), public.my_education(), public.prof_education(uuid) to authenticated;
