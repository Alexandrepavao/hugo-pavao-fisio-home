-- HP Group Hub — 008 Academy (profissionais/alunos) e acompanhamento de pacientes (vínculo assistencial)

-- ---------------------------------------------------------------- helpers
create or replace function private.can_manage_courses() returns boolean
language sql stable set search_path = '' as $$ select private.has_any_role(array['manager','ops_admin','teacher']::public.app_role[]) $$;

-- ---------------------------------------------------------------- cursos
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  kind text not null default 'course' check (kind in ('course','mentoring','program')),
  title text not null check (length(btrim(title)) > 1),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  product_id uuid references public.products(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  certificate_min_progress int not null default 100 check (certificate_min_progress between 1 and 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);
create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, course_id uuid not null references public.courses(id) on delete cascade,
  title text not null, position int not null default 0
);
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, course_id uuid not null references public.courses(id) on delete cascade,
  module_id uuid references public.course_modules(id) on delete set null,
  title text not null, position int not null default 0,
  kind text not null default 'text' check (kind in ('video','text','file','live')),
  body text,
  storage_path text check (storage_path is null or storage_path ~ '^[0-9a-f-]{36}/'),   -- caminho no bucket privado academy-private
  external_url text check (external_url is null or external_url ~ '^https://'),
  starts_at timestamptz,                                                                -- aulas ao vivo / encontros de mentoria
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create index lessons_course_idx on public.lessons (course_id, position);
create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, course_id uuid not null references public.courses(id) on delete cascade,
  name text not null, starts_on date, ends_on date, mentor_user_id uuid references auth.users(id) on delete set null
);

-- Acesso: por compra, turma, vínculo ou liberação manual — com validade e revogação. Verificado no servidor (RLS/funções).
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, person_id uuid not null references public.people(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  source text not null check (source in ('purchase','cohort','link','manual')),
  source_ref uuid,
  valid_from timestamptz not null default now(), valid_until timestamptz,
  revoked_at timestamptz, revoked_reason text,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from)
);
create unique index entitlements_active_uq on public.entitlements (person_id, course_id, source, coalesce(source_ref, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
create index entitlements_person_idx on public.entitlements (person_id) where revoked_at is null;
create table public.cohort_members (cohort_id uuid not null references public.cohorts(id) on delete cascade, person_id uuid not null references public.people(id) on delete cascade, primary key (cohort_id, person_id));

create or replace function private.has_course_access(p_course uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.entitlements e join public.courses c on c.id = e.course_id and c.status = 'published'
    where e.course_id = p_course and e.person_id = private.current_person() and e.revoked_at is null
      and e.valid_from <= now() and (e.valid_until is null or e.valid_until > now()))
$$;
create or replace function private.can_read_course(p_course uuid) returns boolean
language sql stable set search_path = '' as $$ select private.can_manage_courses() or private.has_course_access(p_course) $$;

create table public.lesson_progress (
  person_id uuid not null references public.people(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  course_id uuid not null, org_id uuid not null,
  completed_at timestamptz, last_viewed_at timestamptz not null default now(),
  primary key (person_id, lesson_id)
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null, pass_score int not null default 70 check (pass_score between 1 and 100)
);
create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position int not null default 0, prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  correct_index int not null check (correct_index >= 0)
);
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  score int not null, passed boolean not null, answers jsonb, created_at timestamptz not null default now()
);
create table public.certificates (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  person_id uuid not null references public.people(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 12)),
  issued_at timestamptz not null default now(),
  unique (person_id, course_id)
);
create table public.community_posts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  course_id uuid not null references public.courses(id) on delete cascade,
  cohort_id uuid references public.cohorts(id) on delete set null,
  parent_id uuid references public.community_posts(id) on delete cascade,
  author_person_id uuid not null references public.people(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  status text not null default 'visible' check (status in ('visible','hidden')),
  moderated_by uuid, moderation_reason text,
  created_at timestamptz not null default now()
);
create index community_course_idx on public.community_posts (course_id, created_at desc);

-- ---------------------------------------------------------------- funções do aluno
create or replace function public.lesson_complete(p_lesson uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.lessons; v_person uuid := private.current_person();
begin
  select * into l from public.lessons where id = p_lesson and published;
  if not found or v_person is null or not private.has_course_access(l.course_id) then raise exception 'sem acesso' using errcode = '42501'; end if;
  insert into public.lesson_progress (person_id, lesson_id, course_id, org_id, completed_at) values (v_person, p_lesson, l.course_id, l.org_id, now())
    on conflict (person_id, lesson_id) do update set completed_at = coalesce(public.lesson_progress.completed_at, now()), last_viewed_at = now();
  perform private.emit_event(l.org_id, 'lesson.completed', 'lesson', p_lesson, jsonb_build_object('person_id', v_person, 'course_id', l.course_id),
                             'lesson.completed:' || v_person || ':' || p_lesson);
end $$;

create or replace function public.course_progress(p_course uuid) returns table (total int, done int, percent int)
language sql stable security definer set search_path = '' as $$
  select t.n, d.n, case when t.n = 0 then 0 else (d.n * 100 / t.n) end
  from (select count(*)::int n from public.lessons where course_id = p_course and published and kind <> 'live') t,
       (select count(*)::int n from public.lesson_progress lp join public.lessons l on l.id = lp.lesson_id and l.published and l.kind <> 'live'
         where lp.course_id = p_course and lp.person_id = private.current_person() and lp.completed_at is not null) d
  where private.has_course_access(p_course)
$$;

create or replace function public.quiz_for_student(p_quiz uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q public.quizzes;
begin
  select * into q from public.quizzes where id = p_quiz;
  if not found or not private.has_course_access(q.course_id) then raise exception 'sem acesso' using errcode = '42501'; end if;
  return jsonb_build_object('id', q.id, 'title', q.title, 'pass_score', q.pass_score,
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'prompt', x.prompt, 'options', x.options) order by x.position), '[]') from public.quiz_questions x where x.quiz_id = q.id));
end $$;

create or replace function public.quiz_submit(p_quiz uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.quizzes; v_total int; v_ok int := 0; qq record; v_score int; v_pass boolean; v_person uuid := private.current_person();
begin
  select * into q from public.quizzes where id = p_quiz;
  if not found or v_person is null or not private.has_course_access(q.course_id) then raise exception 'sem acesso' using errcode = '42501'; end if;
  select count(*) into v_total from public.quiz_questions where quiz_id = p_quiz;
  if v_total = 0 then raise exception 'avaliação sem questões'; end if;
  for qq in select id, correct_index from public.quiz_questions where quiz_id = p_quiz loop
    if (p_answers ->> qq.id::text) is not null and (p_answers ->> qq.id::text)::int = qq.correct_index then v_ok := v_ok + 1; end if;
  end loop;
  v_score := v_ok * 100 / v_total; v_pass := v_score >= q.pass_score;
  insert into public.quiz_attempts (org_id, quiz_id, person_id, score, passed, answers) values (q.org_id, p_quiz, v_person, v_score, v_pass, p_answers);
  return jsonb_build_object('score', v_score, 'passed', v_pass);             -- não revela o gabarito
end $$;

-- Certificado: acesso ativo + progresso mínimo + todas as avaliações do curso aprovadas
create or replace function public.issue_certificate(p_course uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.courses; v_person uuid := private.current_person(); v_pct int; v_id uuid;
begin
  select * into c from public.courses where id = p_course;
  if not found or v_person is null or not private.has_course_access(p_course) then raise exception 'sem acesso' using errcode = '42501'; end if;
  select id into v_id from public.certificates where person_id = v_person and course_id = p_course;
  if found then return v_id; end if;
  select percent into v_pct from public.course_progress(p_course);
  if coalesce(v_pct, 0) < c.certificate_min_progress then raise exception 'progresso insuficiente (% %%)', coalesce(v_pct, 0); end if;
  if exists (select 1 from public.quizzes z where z.course_id = p_course
             and not exists (select 1 from public.quiz_attempts a where a.quiz_id = z.id and a.person_id = v_person and a.passed)) then
    raise exception 'há avaliações pendentes'; end if;
  insert into public.certificates (org_id, person_id, course_id) values (c.org_id, v_person, p_course) returning id into v_id;
  perform private.emit_event(c.org_id, 'course.completed', 'course', p_course, jsonb_build_object('person_id', v_person), 'course.completed:' || v_person || ':' || p_course);
  return v_id;
end $$;

create or replace function public.community_post(p_course uuid, p_body text, p_parent uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_id uuid; c public.courses;
begin
  select * into c from public.courses where id = p_course;
  if not found or v_person is null or not (private.has_course_access(p_course) or private.can_manage_courses()) then raise exception 'sem acesso' using errcode = '42501'; end if;
  if p_parent is not null and not exists (select 1 from public.community_posts where id = p_parent and course_id = p_course) then raise exception 'comentário inválido'; end if;
  perform private.rate_limit('post:' || v_person, interval '10 minutes', 20);
  insert into public.community_posts (org_id, course_id, parent_id, author_person_id, body) values (c.org_id, p_course, p_parent, v_person, btrim(p_body)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.community_moderate(p_post uuid, p_hide boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_courses() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.community_posts set status = case when p_hide then 'hidden' else 'visible' end, moderated_by = (select auth.uid()), moderation_reason = p_reason
   where id = p_post and org_id = private.current_org();
end $$;

-- ---------------------------------------------------------------- concessão / revogação de acesso
create or replace function public.entitlement_grant_manual(p_person uuid, p_course uuid, p_valid_until timestamptz, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid;
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'informe o motivo da liberação'; end if;
  if not exists (select 1 from public.people where id = p_person and org_id = v_org) or not exists (select 1 from public.courses where id = p_course and org_id = v_org) then raise exception 'pessoa ou curso inválido'; end if;
  insert into public.entitlements (org_id, person_id, course_id, source, valid_until, granted_by) values (v_org, p_person, p_course, 'manual', p_valid_until, (select auth.uid()))
    on conflict do nothing returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns) values (v_org, (select auth.uid()), 'entitlement_grant_manual', 'entitlement', v_id::text, array['reason:' || p_reason]);
  return v_id;
end $$;

create or replace function public.entitlement_revoke(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.entitlements set revoked_at = now(), revoked_reason = coalesce(p_reason, 'revogado') where id = p_id and org_id = private.current_org() and revoked_at is null;
end $$;

create or replace function public.cohort_add_member(p_cohort uuid, p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare co public.cohorts;
begin
  if not private.can_manage_courses() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into co from public.cohorts where id = p_cohort and org_id = private.current_org();
  if not found or not exists (select 1 from public.people where id = p_person and org_id = co.org_id) then raise exception 'turma ou pessoa inválida'; end if;
  insert into public.cohort_members values (p_cohort, p_person) on conflict do nothing;
  insert into public.entitlements (org_id, person_id, course_id, source, source_ref, valid_until, granted_by)
    values (co.org_id, p_person, co.course_id, 'cohort', p_cohort, (co.ends_on + 1)::timestamptz, (select auth.uid())) on conflict do nothing;
end $$;

-- acesso por compra (evento payment.confirmed) conforme regra do produto; revogação por estorno/cancelamento
create or replace function private.h_access_on_payment(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; pay public.payments; s public.sales; it record; v_full boolean;
begin
  select * into e from public.domain_events where id = p_event;
  select * into pay from public.payments where id = e.aggregate_id;
  if pay.kind <> 'payment' then return; end if;
  select s2.* into s from public.sales s2 join public.receivables r on r.sale_id = s2.id where r.id = pay.receivable_id;
  v_full := not exists (select 1 from public.receivables r where r.sale_id = s.id and r.status <> 'paid' and r.status <> 'cancelled');
  for it in select c.id as course_id, p.access_rule, p.validity_days from public.sale_items si join public.products p on p.id = si.product_id join public.courses c on c.product_id = p.id and c.status = 'published' where si.sale_id = s.id loop
    if it.access_rule = 'on_first_payment' or v_full then
      insert into public.entitlements (org_id, person_id, course_id, source, source_ref, valid_until)
        values (s.org_id, s.person_id, it.course_id, 'purchase', s.id, case when it.validity_days is not null then now() + make_interval(days => it.validity_days) end) on conflict do nothing;
    end if;
  end loop;
end $$;

create or replace function private.h_access_revoke(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; v_sale uuid; v_net bigint;
begin
  select * into e from public.domain_events where id = p_event;
  if e.type = 'sale.cancelled' then v_sale := e.aggregate_id;
  else select r.sale_id into v_sale from public.payments p join public.receivables r on r.id = p.receivable_id where p.id = e.aggregate_id; end if;
  select coalesce(sum(private.receivable_net(r.id)), 0) into v_net from public.receivables r where r.sale_id = v_sale;
  if v_net <= 0 then
    update public.entitlements set revoked_at = now(), revoked_reason = 'estorno ou cancelamento da compra' where source = 'purchase' and source_ref = v_sale and revoked_at is null;
  end if;
end $$;
insert into private.event_handlers values ('payment.confirmed','h_access_on_payment'),('payment.refunded','h_access_revoke'),('sale.cancelled','h_access_revoke');

-- ---------------------------------------------------------------- acompanhamento de pacientes (vínculo assistencial)
create table public.care_relationships (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  unit_id uuid not null references public.units(id) on delete restrict,
  professional_user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  valid_from timestamptz not null default now(), valid_until timestamptz, revoked_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create unique index care_rel_active_uq on public.care_relationships (professional_user_id, person_id) where revoked_at is null;

create or replace function private.has_care_relationship(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.care_relationships r
    where r.person_id = p_person and r.professional_user_id = (select auth.uid()) and r.revoked_at is null and r.valid_from <= now() and (r.valid_until is null or r.valid_until > now())
      and private.has_unit_role(array['physio']::public.app_role[], r.unit_id))
$$;

create table public.care_contents (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  unit_id uuid not null references public.units(id) on delete restrict,
  title text not null, kind text not null check (kind in ('guidance','exercise_video','questionnaire','program')),
  body text, storage_path text check (storage_path is null or storage_path ~ '^[0-9a-f-]{36}/'), questions jsonb,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), archived_at timestamptz
);
create table public.care_assignments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  person_id uuid not null references public.people(id) on delete cascade,
  content_id uuid not null references public.care_contents(id) on delete restrict,
  phase text not null default 'program' check (phase in ('before','after','program')),
  note text, released_by uuid not null references auth.users(id) on delete restrict,
  released_at timestamptz not null default now(), valid_until timestamptz, revoked_at timestamptz
);
create index care_assign_person_idx on public.care_assignments (person_id) where revoked_at is null;
create table public.care_activity (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  person_id uuid not null references public.people(id) on delete cascade,
  assignment_id uuid not null references public.care_assignments(id) on delete cascade,
  done_at timestamptz not null default now(), pain_scale smallint check (pain_scale between 0 and 10),
  answers jsonb, note text check (length(note) <= 1000), needs_attention boolean not null default false
);
create table public.care_messages (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  person_id uuid not null references public.people(id) on delete cascade,
  sender text not null check (sender in ('patient','professional')), sender_user_id uuid,
  body text not null check (length(btrim(body)) between 1 and 2000), created_at timestamptz not null default now()
);
create index care_messages_person_idx on public.care_messages (person_id, created_at);

create or replace function private.care_assignment_active(p_content uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.care_assignments a where a.content_id = p_content and a.person_id = private.current_person()
    and a.revoked_at is null and (a.valid_until is null or a.valid_until > now()))
$$;

create or replace function public.care_link(p_person uuid, p_professional uuid, p_unit uuid, p_valid_until timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid;
begin
  if not private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.people where id = p_person and org_id = v_org) then raise exception 'pessoa inválida'; end if;
  if not exists (select 1 from public.role_assignments ra where ra.user_id = p_professional and ra.role = 'physio' and ra.revoked_at is null and (ra.unit_id is null or ra.unit_id = p_unit)) then raise exception 'profissional sem papel assistencial nesta unidade'; end if;
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id, valid_until, granted_by) values (v_org, p_unit, p_professional, p_person, p_valid_until, (select auth.uid()))
    on conflict do nothing returning id into v_id;
  return v_id;
end $$;
create or replace function public.care_unlink(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.care_relationships;
begin
  select * into r from public.care_relationships where id = p_id and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], r.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.care_relationships set revoked_at = now() where id = p_id and revoked_at is null;
  update public.care_assignments set revoked_at = now() where person_id = r.person_id and released_by = r.professional_user_id and revoked_at is null;  -- revogação afeta o acesso sensível
end $$;

create or replace function public.care_assign(p_person uuid, p_content uuid, p_phase text, p_valid_until timestamptz default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.care_contents; v_id uuid;
begin
  select * into c from public.care_contents where id = p_content and org_id = private.current_org() and archived_at is null;
  if not found or not private.has_care_relationship(p_person) then raise exception 'sem vínculo assistencial com este paciente' using errcode = '42501'; end if;
  insert into public.care_assignments (org_id, person_id, content_id, phase, note, released_by, valid_until) values (c.org_id, p_person, p_content, p_phase, p_note, (select auth.uid()), p_valid_until) returning id into v_id;
  return v_id;
end $$;
create or replace function public.care_revoke_assignment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.care_assignments;
begin
  select * into a from public.care_assignments where id = p_id and org_id = private.current_org();
  if not found or not private.has_care_relationship(a.person_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.care_assignments set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

create or replace function public.care_log_activity(p_assignment uuid, p_pain smallint, p_answers jsonb, p_note text, p_needs_attention boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.care_assignments; v_person uuid := private.current_person(); v_id uuid; v_unit uuid;
begin
  select * into a from public.care_assignments where id = p_assignment and person_id = v_person and revoked_at is null and (valid_until is null or valid_until > now());
  if not found then raise exception 'conteúdo não liberado' using errcode = '42501'; end if;
  insert into public.care_activity (org_id, person_id, assignment_id, pain_scale, answers, note, needs_attention) values (a.org_id, v_person, p_assignment, p_pain, p_answers, p_note, coalesce(p_needs_attention, false)) returning id into v_id;
  if coalesce(p_needs_attention, false) then
    select unit_id into v_unit from public.care_contents where id = a.content_id;
    insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (a.org_id, v_unit, v_person, a.released_by, 'follow_up', 'Paciente sinalizou que precisa de atendimento (acompanhamento)', 'care_attention:' || v_id) on conflict do nothing;
  end if;
  return v_id;
end $$;

create or replace function public.care_send_message(p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_id uuid; r record; v_org uuid := private.current_org();
begin
  if v_person is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  perform private.rate_limit('care_msg:' || v_person, interval '10 minutes', 10);
  insert into public.care_messages (org_id, person_id, sender, sender_user_id, body) values (v_org, v_person, 'patient', (select auth.uid()), btrim(p_body)) returning id into v_id;
  for r in select professional_user_id, unit_id from public.care_relationships where person_id = v_person and revoked_at is null and (valid_until is null or valid_until > now()) loop
    insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (v_org, r.unit_id, v_person, r.professional_user_id, 'follow_up', 'Nova dúvida de paciente no canal de acompanhamento', 'care_msg:' || v_person || ':' || r.professional_user_id || ':' || current_date) on conflict do nothing;
  end loop;
  return v_id;
end $$;
create or replace function public.care_reply(p_person uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.has_care_relationship(p_person) then raise exception 'sem vínculo assistencial' using errcode = '42501'; end if;
  insert into public.care_messages (org_id, person_id, sender, sender_user_id, body) values (private.current_org(), p_person, 'professional', (select auth.uid()), btrim(p_body)) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- Storage privado (política por vínculo, não por URL difícil de adivinhar)
insert into storage.buckets (id, name, public) values ('academy-private', 'academy-private', false), ('care-private', 'care-private', false) on conflict (id) do nothing;

create or replace function private.storage_uuid(p_name text) returns uuid
language sql immutable set search_path = '' as $$ select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 1)::uuid end $$;

create policy academy_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'academy-private' and private.can_read_course(private.storage_uuid(name)));
create policy academy_obj_write on storage.objects for insert to authenticated
  with check (bucket_id = 'academy-private' and private.can_manage_courses() and exists (select 1 from public.courses c where c.id = private.storage_uuid(name) and c.org_id = private.current_org()));
create policy academy_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'academy-private' and private.can_manage_courses()) with check (bucket_id = 'academy-private' and private.can_manage_courses());
create policy academy_obj_delete on storage.objects for delete to authenticated using (bucket_id = 'academy-private' and private.can_manage_courses());
create policy care_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'care-private' and (private.care_assignment_active(private.storage_uuid(name))
        or exists (select 1 from public.care_contents c where c.id = private.storage_uuid(name) and private.has_unit_role(array['physio']::public.app_role[], c.unit_id))));
create policy care_obj_write on storage.objects for insert to authenticated
  with check (bucket_id = 'care-private' and exists (select 1 from public.care_contents c where c.id = private.storage_uuid(name) and c.org_id = private.current_org() and private.has_unit_role(array['physio']::public.app_role[], c.unit_id)));
create policy care_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'care-private' and exists (select 1 from public.care_contents c where c.id = private.storage_uuid(name) and private.has_unit_role(array['physio']::public.app_role[], c.unit_id)));

-- ---------------------------------------------------------------- RLS
alter table public.courses enable row level security; alter table public.course_modules enable row level security; alter table public.lessons enable row level security;
alter table public.cohorts enable row level security; alter table public.entitlements enable row level security; alter table public.cohort_members enable row level security;
alter table public.lesson_progress enable row level security; alter table public.quizzes enable row level security; alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security; alter table public.certificates enable row level security; alter table public.community_posts enable row level security;
alter table public.care_relationships enable row level security; alter table public.care_contents enable row level security; alter table public.care_assignments enable row level security;
alter table public.care_activity enable row level security; alter table public.care_messages enable row level security;

grant select, insert, update on public.courses, public.course_modules, public.lessons, public.cohorts, public.quizzes, public.quiz_questions to authenticated;
grant select on public.entitlements, public.cohort_members, public.lesson_progress, public.quiz_attempts, public.certificates, public.community_posts to authenticated;
grant select on public.care_relationships, public.care_assignments, public.care_activity, public.care_messages to authenticated;
grant select, insert, update on public.care_contents to authenticated;

create policy courses_read on public.courses for select to authenticated using (private.in_org(org_id) and (private.can_manage_courses() or (status = 'published' and private.has_course_access(id))));
create policy courses_write on public.courses for insert to authenticated with check (private.in_org(org_id) and private.can_manage_courses() and created_by = (select auth.uid()));
create policy courses_update on public.courses for update to authenticated using (private.in_org(org_id) and private.can_manage_courses()) with check (private.in_org(org_id));
create policy modules_read on public.course_modules for select to authenticated using (private.in_org(org_id) and private.can_read_course(course_id));
create policy modules_write on public.course_modules for insert to authenticated with check (private.in_org(org_id) and private.can_manage_courses());
create policy modules_update on public.course_modules for update to authenticated using (private.in_org(org_id) and private.can_manage_courses()) with check (private.in_org(org_id));
create policy lessons_read on public.lessons for select to authenticated using (private.in_org(org_id) and (private.can_manage_courses() or (published and private.has_course_access(course_id))));
create policy lessons_write on public.lessons for insert to authenticated with check (private.in_org(org_id) and private.can_manage_courses());
create policy lessons_update on public.lessons for update to authenticated using (private.in_org(org_id) and private.can_manage_courses()) with check (private.in_org(org_id));
create policy cohorts_read on public.cohorts for select to authenticated using (private.in_org(org_id) and private.can_manage_courses());
create policy cohorts_write on public.cohorts for insert to authenticated with check (private.in_org(org_id) and private.can_manage_courses());
create policy cohorts_update on public.cohorts for update to authenticated using (private.in_org(org_id) and private.can_manage_courses()) with check (private.in_org(org_id));
create policy cm_read on public.cohort_members for select to authenticated using (private.can_manage_courses() or person_id = private.current_person());
create policy ent_read on public.entitlements for select to authenticated using (private.in_org(org_id) and (person_id = private.current_person() or private.has_org_role(array['manager','ops_admin']::public.app_role[])));
create policy prog_read on public.lesson_progress for select to authenticated using (private.in_org(org_id) and (person_id = private.current_person() or private.can_manage_courses()));
create policy quiz_read on public.quizzes for select to authenticated using (private.in_org(org_id) and private.can_read_course(course_id));
create policy quiz_write on public.quizzes for insert to authenticated with check (private.in_org(org_id) and private.can_manage_courses());
create policy quiz_update on public.quizzes for update to authenticated using (private.in_org(org_id) and private.can_manage_courses()) with check (private.in_org(org_id));
create policy qq_read on public.quiz_questions for select to authenticated using (private.in_org(org_id) and private.can_manage_courses());   -- alunos NÃO leem o gabarito
create policy qq_write on public.quiz_questions for insert to authenticated with check (private.in_org(org_id) and private.can_manage_courses());
create policy qq_update on public.quiz_questions for update to authenticated using (private.in_org(org_id) and private.can_manage_courses()) with check (private.in_org(org_id));
create policy qa_read on public.quiz_attempts for select to authenticated using (private.in_org(org_id) and (person_id = private.current_person() or private.can_manage_courses()));
create policy cert_read on public.certificates for select to authenticated using (private.in_org(org_id) and (person_id = private.current_person() or private.can_manage_courses()));
create policy posts_read on public.community_posts for select to authenticated using (private.in_org(org_id) and private.can_read_course(course_id) and (status = 'visible' or private.can_manage_courses()));

create policy care_rel_read on public.care_relationships for select to authenticated using (private.in_org(org_id) and (professional_user_id = (select auth.uid()) or person_id = private.current_person() or private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], unit_id)));
create policy care_cont_read on public.care_contents for select to authenticated using (private.in_org(org_id) and (private.has_unit_role(array['physio','unit_manager','manager','ops_admin']::public.app_role[], unit_id) or private.care_assignment_active(id)));
create policy care_cont_write on public.care_contents for insert to authenticated with check (private.in_org(org_id) and created_by = (select auth.uid()) and private.has_unit_role(array['physio']::public.app_role[], unit_id));
create policy care_cont_update on public.care_contents for update to authenticated using (private.in_org(org_id) and private.has_unit_role(array['physio']::public.app_role[], unit_id)) with check (private.in_org(org_id));
create policy care_as_read on public.care_assignments for select to authenticated using (private.in_org(org_id) and ((person_id = private.current_person() and revoked_at is null and (valid_until is null or valid_until > now())) or private.has_care_relationship(person_id)));
create policy care_act_read on public.care_activity for select to authenticated using (private.in_org(org_id) and (person_id = private.current_person() or private.has_care_relationship(person_id)));
create policy care_msg_read on public.care_messages for select to authenticated using (private.in_org(org_id) and (person_id = private.current_person() or private.has_care_relationship(person_id)));

create trigger audit_entitlements after insert or update on public.entitlements for each row execute function private.audit_row('source','valid_until','revoked_at','course_id');
create trigger audit_care_rel after insert or update on public.care_relationships for each row execute function private.audit_row('revoked_at','professional_user_id','unit_id');
create trigger audit_care_assign after insert or update on public.care_assignments for each row execute function private.audit_row('content_id','revoked_at','phase');

grant execute on function public.lesson_complete(uuid), public.course_progress(uuid), public.quiz_for_student(uuid), public.quiz_submit(uuid, jsonb), public.issue_certificate(uuid),
  public.community_post(uuid, text, uuid), public.community_moderate(uuid, boolean, text), public.entitlement_grant_manual(uuid, uuid, timestamptz, text), public.entitlement_revoke(uuid, text),
  public.cohort_add_member(uuid, uuid), public.care_link(uuid, uuid, uuid, timestamptz), public.care_unlink(uuid), public.care_assign(uuid, uuid, text, timestamptz, text),
  public.care_revoke_assignment(uuid), public.care_log_activity(uuid, smallint, jsonb, text, boolean), public.care_send_message(text), public.care_reply(uuid, text) to authenticated;
