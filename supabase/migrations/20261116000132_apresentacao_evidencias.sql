-- HP Group Hub — 132 Apresentação personalizada da avaliação: áreas, biblioteca de evidências revisada, captura progressiva, versões publicadas e prévia real do portal.
-- Privacidade (mesma regra da jornada, 058): o conteúdo clínico da apresentação só é lido/escrito pela fisioterapeuta com VÍNCULO ASSISTENCIAL ativo (o vínculo pendente cria esse acesso)
-- e, depois de PUBLICADO, pelo próprio paciente. Gestão, comercial e financeiro NÃO leem (nem por SQL). Anotações internas nunca entram na publicação.
-- Biblioteca de evidências: NASCE VAZIA (nada é inventado); só fichas APROVADAS por revisão clínica (gestão) aparecem ao paciente; artigo sem DOI/URL não existe; sem PDFs nem figuras copiados.
-- Escrita e leitura só por função (tabelas sem GRANT). Reaproveita a jornada existente: metas (patient_goals), plano (patient_plans), medidas (patient_measurements), educação (patient_education).

-- ---------------------------------------------------------------- 1. áreas da fisioterapia (categorias de organização; uma área NÃO é diagnóstico nem gera tratamento/sessões)
create table public.physio_areas (key text primary key, label text not null, sort int not null);
insert into public.physio_areas (key, label, sort) values
  ('acupuntura', 'Acupuntura', 1), ('aquatica', 'Aquática / Hidroterapia', 2), ('cardiovascular', 'Cardiovascular', 3), ('dermatofuncional', 'Dermatofuncional', 4),
  ('esportiva', 'Esportiva', 5), ('gerontologia', 'Gerontologia', 6), ('trabalho', 'Trabalho', 7), ('neurofuncional', 'Neurofuncional', 8), ('oncologia', 'Oncologia', 9),
  ('reumatologia', 'Reumatologia', 10), ('respiratoria', 'Respiratória', 11), ('traumato_ortopedica', 'Traumato-Ortopédica', 12), ('osteopatia', 'Osteopatia', 13),
  ('quiropraxia', 'Quiropraxia', 14), ('saude_mulher', 'Saúde da Mulher', 15), ('terapia_intensiva', 'Terapia Intensiva', 16);
alter table public.physio_areas enable row level security; revoke all on public.physio_areas from public, anon, authenticated;
create policy physio_areas_read on public.physio_areas for select to authenticated using (true); grant select on public.physio_areas to authenticated;

-- ---------------------------------------------------------------- 2. biblioteca de evidências (revisão clínica; sem conteúdo inventado)
create table public.evidence_references (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete restrict,
  title text not null check (length(btrim(title)) between 5 and 400), authors text check (authors is null or length(authors) <= 600), journal text check (journal is null or length(journal) <= 300),
  year int check (year is null or year between 1900 and 2100),
  doi text check (doi is null or doi ~* '^10\.[0-9]{4,9}/\S+$'), url text check (url is null or url ~* '^https?://\S+$'),
  study_design text check (study_design is null or length(study_design) <= 200),
  population text check (population is null or length(population) <= 800), comparison text check (comparison is null or length(comparison) <= 800),
  benefits text check (benefits is null or length(benefits) <= 1500), duration_text text check (duration_text is null or length(duration_text) <= 300),
  follow_up_text text check (follow_up_text is null or length(follow_up_text) <= 300), limitations text check (limitations is null or length(limitations) <= 1500),
  area_keys text[] not null default '{}', conditions text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  version int not null default 1, license_note text check (license_note is null or length(license_note) <= 400),
  proposed_by uuid references auth.users(id) on delete set null,
  source_verified_at timestamptz, reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz, review_note text check (review_note is null or length(review_note) <= 800),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (doi is not null or url is not null),                                             -- sempre uma fonte original verificável
  check (status <> 'approved' or (reviewed_by is not null and reviewed_at is not null and source_verified_at is not null))
);
create unique index evidence_doi_uq on public.evidence_references (org_id, lower(doi)) where doi is not null;
create index evidence_status_idx on public.evidence_references (org_id, status);
alter table public.evidence_references enable row level security; revoke all on public.evidence_references from public, anon, authenticated;
create trigger audit_evidence_references after insert or update on public.evidence_references
  for each row execute function private.audit_row('status', 'version', 'reviewed_by', 'doi', 'url');

-- ---------------------------------------------------------------- 3. apresentação da avaliação (uma por vínculo), evidências escolhidas e versões publicadas
create table public.evaluation_presentations (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  enrollment_id uuid not null unique references public.patient_enrollments(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete set null,
  area_keys text[] not null default '{}',
  -- RELATADO PELO PACIENTE
  complaint text check (complaint is null or length(complaint) <= 2000), symptom_duration text check (symptom_duration is null or length(symptom_duration) <= 200),
  limitations text check (limitations is null or length(limitations) <= 2000), activities text check (activities is null or length(activities) <= 1000),
  -- AVALIADO / VALIDADO PELO PROFISSIONAL (condição avaliada e hipótese são coisas diferentes)
  condition_kind text check (condition_kind is null or condition_kind in ('assessed', 'hypothesis')), condition_text text check (condition_text is null or length(condition_text) <= 500),
  goal_title text check (goal_title is null or length(goal_title) <= 200), goal_target_date date,
  freq_per_week smallint check (freq_per_week is null or freq_per_week between 1 and 14), duration_weeks smallint check (duration_weeks is null or duration_weeks between 1 and 104),
  routine_text text check (routine_text is null or length(routine_text) <= 2000), reassessment_on date, reassessment_criteria text check (reassessment_criteria is null or length(reassessment_criteria) <= 1000),
  internal_notes text check (internal_notes is null or length(internal_notes) <= 4000),   -- NUNCA publicado
  rev int not null default 1,                                                              -- concorrência otimista (duas abas/pessoas não sobrescrevem em silêncio)
  status text not null default 'draft' check (status in ('draft', 'published')), published_version int not null default 0, published_at timestamptz, published_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);
create table public.presentation_evidence (
  presentation_id uuid not null references public.evaluation_presentations(id) on delete cascade, evidence_id uuid not null references public.evidence_references(id) on delete restrict,
  rationale text not null check (length(btrim(rationale)) between 5 and 800),               -- por que serve a ESTE caso (visível ao paciente: escreva em linguagem simples)
  differences text check (differences is null or length(differences) <= 800), position int not null default 1,
  picked_by uuid references auth.users(id) on delete set null, picked_at timestamptz not null default now(), primary key (presentation_id, evidence_id)
);
create table public.presentation_versions (
  id uuid primary key default gen_random_uuid(), presentation_id uuid not null references public.evaluation_presentations(id) on delete cascade, version int not null,
  payload jsonb not null, published_by uuid references auth.users(id) on delete set null, published_at timestamptz not null default now(), unique (presentation_id, version)
);
alter table public.evaluation_presentations enable row level security; alter table public.presentation_evidence enable row level security; alter table public.presentation_versions enable row level security;
revoke all on public.evaluation_presentations, public.presentation_evidence, public.presentation_versions from public, anon, authenticated;
create trigger audit_evaluation_presentations after insert or update on public.evaluation_presentations
  for each row execute function private.audit_row('status', 'published_version', 'area_keys', 'professional_id');

-- ---------------------------------------------------------------- 4. auxiliares
create or replace function private.presentation_can_edit(p_enrollment uuid) returns public.patient_enrollments
language plpgsql stable security definer set search_path = '' as $$
declare e public.patient_enrollments;
begin
  select * into e from public.patient_enrollments where id = p_enrollment and org_id = private.current_org();
  if not found then raise exception 'vínculo não encontrado' using errcode = '42501'; end if;
  if e.status = 'ended' then raise exception 'o vínculo foi encerrado' using errcode = '42501'; end if;
  if not private.has_care_relationship(e.person_id) then raise exception 'sem permissão' using errcode = '42501'; end if;      -- só a fisioterapeuta com vínculo assistencial
  return e;
end $$;

create or replace function private.evidence_json(r public.evidence_references) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'title', r.title, 'authors', r.authors, 'journal', r.journal, 'year', r.year, 'doi', r.doi, 'url', r.url, 'design', r.study_design,
    'population', r.population, 'comparison', r.comparison, 'benefits', r.benefits, 'duration', r.duration_text, 'follow_up', r.follow_up_text, 'limitations', r.limitations,
    'area_keys', to_jsonb(r.area_keys), 'conditions', to_jsonb(r.conditions), 'status', r.status, 'version', r.version, 'reviewed_at', r.reviewed_at, 'source_verified_at', r.source_verified_at)
$$;

-- o que o PACIENTE verá (conteúdo da publicação). Sem anotações internas; evidência só se APROVADA no momento da publicação.
create or replace function private.presentation_patient_payload(p public.evaluation_presentations) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'areas', coalesce((select jsonb_agg(jsonb_build_object('key', a.key, 'label', a.label) order by a.sort) from public.physio_areas a where a.key = any (p.area_keys)), '[]'::jsonb),
    'reported', jsonb_build_object('complaint', p.complaint, 'symptom_duration', p.symptom_duration, 'limitations', p.limitations, 'activities', p.activities),
    'assessed', jsonb_build_object('condition_kind', p.condition_kind, 'condition_text', p.condition_text),
    'goal', case when p.goal_title is not null then jsonb_build_object('title', p.goal_title, 'target_date', p.goal_target_date) end,
    'plan', jsonb_build_object('freq_per_week', p.freq_per_week, 'duration_weeks', p.duration_weeks, 'routine', p.routine_text, 'reassessment_on', p.reassessment_on, 'reassessment_criteria', p.reassessment_criteria),
    'evidence', coalesce((select jsonb_agg(private.evidence_json(r) || jsonb_build_object('relation', pe.rationale, 'differences', pe.differences) order by pe.position, pe.picked_at)
                            from public.presentation_evidence pe join public.evidence_references r on r.id = pe.evidence_id where pe.presentation_id = p.id and r.status = 'approved'), '[]'::jsonb));
end $$;

-- visão da profissional (inclui anotação interna, evidências escolhidas, o que falta para publicar e se há alteração não publicada)
create or replace function private.presentation_staff_json(p public.evaluation_presentations) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_payload jsonb := private.presentation_patient_payload(p); v_last jsonb; v_missing text[] := '{}';
begin
  select payload into v_last from public.presentation_versions where presentation_id = p.id order by version desc limit 1;
  if coalesce(array_length(p.area_keys, 1), 0) = 0 then v_missing := array_append(v_missing, 'Escolha ao menos uma área da fisioterapia'::text); end if;
  if coalesce(btrim(p.complaint), '') = '' then v_missing := array_append(v_missing, 'Registre a queixa principal (relatada pelo paciente)'::text); end if;
  if coalesce(btrim(p.goal_title), '') = '' then v_missing := array_append(v_missing, 'Defina o objetivo do paciente'::text); end if;
  return jsonb_build_object('id', p.id, 'enrollment_id', p.enrollment_id, 'person_id', p.person_id, 'rev', p.rev, 'status', p.status, 'published_version', p.published_version,
    'published_at', p.published_at, 'updated_at', p.updated_at, 'area_keys', to_jsonb(p.area_keys),
    'complaint', p.complaint, 'symptom_duration', p.symptom_duration, 'limitations', p.limitations, 'activities', p.activities,
    'condition_kind', p.condition_kind, 'condition_text', p.condition_text, 'goal_title', p.goal_title, 'goal_target_date', p.goal_target_date,
    'freq_per_week', p.freq_per_week, 'duration_weeks', p.duration_weeks, 'routine_text', p.routine_text, 'reassessment_on', p.reassessment_on, 'reassessment_criteria', p.reassessment_criteria,
    'internal_notes', p.internal_notes,
    'patient_payload', v_payload, 'missing', to_jsonb(v_missing), 'can_publish', coalesce(array_length(v_missing, 1), 0) = 0,
    'unpublished_changes', v_last is distinct from v_payload,
    'evidence_picked', coalesce((select jsonb_agg(jsonb_build_object('evidence', private.evidence_json(r), 'rationale', pe.rationale, 'differences', pe.differences, 'position', pe.position) order by pe.position, pe.picked_at)
                                   from public.presentation_evidence pe join public.evidence_references r on r.id = pe.evidence_id where pe.presentation_id = p.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- 5. entrada sem lead prévio (a fisioterapeuta inicia a avaliação de quem ela mesma cadastrou ou já atende)
create or replace function public.enrollment_start_evaluation(p_person uuid, p_unit uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_prof public.professionals; v_unit uuid; v_id uuid; v_person public.people;
begin
  if v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into v_prof from public.professionals where user_id = (select auth.uid()) and org_id = v_org and active;
  if not found then raise exception 'apenas profissionais com agenda iniciam uma avaliação' using errcode = '42501'; end if;
  select * into v_person from public.people where id = p_person and org_id = v_org and merged_into_id is null;
  if not found then raise exception 'pessoa não encontrada no cadastro central'; end if;
  v_unit := coalesce(p_unit, v_person.unit_id, (select pu.unit_id from public.professional_units pu where pu.professional_id = v_prof.id limit 1));
  if v_unit is null or not private.has_unit_role(array['physio']::public.app_role[], v_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  -- só quem ela mesma cadastrou (fluxo existente de cadastro e deduplicação) ou já atende: nunca qualquer pessoa da organização
  if v_person.created_by is distinct from (select auth.uid()) and not exists (select 1 from public.appointments a where a.person_id = p_person and a.professional_id = v_prof.id) then
    raise exception 'só é possível iniciar a avaliação de uma pessoa cadastrada por você ou que você já atende' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('enrollment:' || v_org::text || ':' || p_person::text, 0));
  select id into v_id from public.patient_enrollments where org_id = v_org and person_id = p_person and status in ('pending', 'active');
  if v_id is not null then return v_id; end if;                                         -- idempotente; paciente ativo preservado
  if private.person_is_active_patient(v_org, p_person) then raise exception 'esta pessoa já é paciente ativa' ; end if;
  insert into public.patient_enrollments (org_id, unit_id, person_id, professional_id, source, created_by)
    values (v_org, v_unit, p_person, v_prof.id, 'professional_evaluation', (select auth.uid())) returning id into v_id;
  perform private.enrollment_link_care(v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------- 6. biblioteca: propor, revisar, listar
create or replace function public.evidence_save(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); r public.evidence_references; v_doi text := nullif(btrim(p ->> 'doi'), ''); v_url text := nullif(btrim(p ->> 'url'), ''); v_areas text[]; v_id uuid;
begin
  if v_org is null or not (private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) or exists (select 1 from public.role_assignments ra where ra.user_id = (select auth.uid()) and ra.role = 'physio' and ra.revoked_at is null)) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if v_doi is not null then v_doi := regexp_replace(v_doi, '^(https?://(dx\.)?doi\.org/|doi:)', '', 'i'); end if;
  if v_doi is null and v_url is null then raise exception 'informe o DOI ou o link da fonte original'; end if;
  if length(btrim(coalesce(p ->> 'title', ''))) < 5 then raise exception 'informe o título'; end if;
  select coalesce(array_agg(x), '{}') into v_areas from jsonb_array_elements_text(coalesce(p -> 'area_keys', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_areas) k where not exists (select 1 from public.physio_areas a where a.key = k)) then raise exception 'área inválida'; end if;
  if p_id is null then
    insert into public.evidence_references (org_id, title, authors, journal, year, doi, url, study_design, population, comparison, benefits, duration_text, follow_up_text, limitations, area_keys, conditions, license_note, proposed_by)
      values (v_org, btrim(p ->> 'title'), nullif(btrim(p ->> 'authors'), ''), nullif(btrim(p ->> 'journal'), ''), nullif(p ->> 'year', '')::int, v_doi, v_url, nullif(btrim(p ->> 'study_design'), ''),
              nullif(btrim(p ->> 'population'), ''), nullif(btrim(p ->> 'comparison'), ''), nullif(btrim(p ->> 'benefits'), ''), nullif(btrim(p ->> 'duration'), ''), nullif(btrim(p ->> 'follow_up'), ''),
              nullif(btrim(p ->> 'limitations'), ''), v_areas, coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(coalesce(p -> 'conditions', '[]'::jsonb)) x where btrim(x) <> ''), '{}'),
              nullif(btrim(p ->> 'license_note'), ''), (select auth.uid())) returning id into v_id;
    return v_id;
  end if;
  select * into r from public.evidence_references where id = p_id and org_id = v_org for update;
  if not found then raise exception 'referência não encontrada'; end if;
  if r.status = 'retired' then raise exception 'referência aposentada não pode ser editada'; end if;
  if r.proposed_by is distinct from (select auth.uid()) and not private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.evidence_references set title = btrim(p ->> 'title'), authors = nullif(btrim(p ->> 'authors'), ''), journal = nullif(btrim(p ->> 'journal'), ''), year = nullif(p ->> 'year', '')::int,
      doi = v_doi, url = v_url, study_design = nullif(btrim(p ->> 'study_design'), ''), population = nullif(btrim(p ->> 'population'), ''), comparison = nullif(btrim(p ->> 'comparison'), ''),
      benefits = nullif(btrim(p ->> 'benefits'), ''), duration_text = nullif(btrim(p ->> 'duration'), ''), follow_up_text = nullif(btrim(p ->> 'follow_up'), ''), limitations = nullif(btrim(p ->> 'limitations'), ''),
      area_keys = v_areas, conditions = coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(coalesce(p -> 'conditions', '[]'::jsonb)) x where btrim(x) <> ''), '{}'),
      license_note = nullif(btrim(p ->> 'license_note'), ''), updated_at = now(),
      -- editar uma ficha aprovada a devolve para revisão (nova versão); o paciente deixa de vê-la até nova aprovação
      status = case when r.status = 'approved' then 'draft' else r.status end, version = case when r.status = 'approved' then r.version + 1 else r.version end,
      reviewed_by = case when r.status = 'approved' then null else r.reviewed_by end, reviewed_at = case when r.status = 'approved' then null else r.reviewed_at end,
      source_verified_at = case when r.status = 'approved' then null else r.source_verified_at end
    where id = p_id;
  return p_id;
end $$;

-- revisão clínica: só a gestão (responsável clínico). Aprovar exige atestar que a FONTE ORIGINAL foi conferida.
create or replace function public.evidence_review(p_id uuid, p_decision text, p_source_checked boolean default false, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); r public.evidence_references;
begin
  if v_org is null or not private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into r from public.evidence_references where id = p_id and org_id = v_org for update;
  if not found then raise exception 'referência não encontrada'; end if;
  if p_decision = 'approve' then
    if not coalesce(p_source_checked, false) then raise exception 'para aprovar, confirme que a fonte original (DOI/link) foi conferida'; end if;
    update public.evidence_references set status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now(), source_verified_at = now(), review_note = nullif(btrim(p_note), ''), updated_at = now() where id = p_id;
  elsif p_decision = 'retire' then
    update public.evidence_references set status = 'retired', reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(btrim(p_note), ''), updated_at = now() where id = p_id;
  elsif p_decision = 'reject' then
    update public.evidence_references set status = 'draft', reviewed_by = null, reviewed_at = null, source_verified_at = null, review_note = nullif(btrim(p_note), ''), updated_at = now() where id = p_id;
  else raise exception 'decisão inválida'; end if;
end $$;

create or replace function public.evidence_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_mgr boolean := private.has_org_role(array['manager', 'ops_admin']::public.app_role[]);
begin
  if v_org is null or not (v_mgr or exists (select 1 from public.role_assignments ra where ra.user_id = (select auth.uid()) and ra.role = 'physio' and ra.revoked_at is null)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(private.evidence_json(r) || jsonb_build_object('proposed_by_me', r.proposed_by = (select auth.uid()), 'review_note', case when v_mgr or r.proposed_by = (select auth.uid()) then r.review_note end) order by r.created_at desc)
                     from public.evidence_references r
                    where r.org_id = v_org and (p_status is null or r.status = p_status)
                      and (v_mgr or r.status = 'approved' or r.proposed_by = (select auth.uid()))), '[]'::jsonb);   -- fisioterapeuta: aprovadas + as próprias propostas
end $$;

-- sugestões para ESTE caso (só aprovadas), com o motivo de cada uma; a profissional confirma a pertinência. Nenhum dado do paciente sai do banco.
create or replace function public.evidence_suggest(p_presentation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.evaluation_presentations; v_cond text;
begin
  select * into p from public.evaluation_presentations where id = p_presentation and org_id = private.current_org();
  if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  perform private.presentation_can_edit(p.enrollment_id);
  v_cond := lower(coalesce(p.condition_text, '') || ' ' || coalesce(p.complaint, ''));
  return coalesce((
    select jsonb_agg(x.j order by x.score desc, x.title) from (
      select r.title, (select count(*) from unnest(r.area_keys) k where k = any (p.area_keys)) * 3
                    + (select count(*) from unnest(r.conditions) c where length(btrim(c)) >= 3 and v_cond like '%' || lower(btrim(c)) || '%') * 5 as score,
             private.evidence_json(r) || jsonb_build_object(
               'why', to_jsonb(array_remove(array[
                  case when exists (select 1 from unnest(r.area_keys) k where k = any (p.area_keys)) then 'Mesma área: ' || (select string_agg(a.label, ', ') from public.physio_areas a where a.key = any (r.area_keys) and a.key = any (p.area_keys)) end,
                  case when exists (select 1 from unnest(r.conditions) c where length(btrim(c)) >= 3 and v_cond like '%' || lower(btrim(c)) || '%') then 'Condição citada na ficha aparece na avaliação: ' || (select string_agg(btrim(c), ', ') from unnest(r.conditions) c where length(btrim(c)) >= 3 and v_cond like '%' || lower(btrim(c)) || '%') end,
                  case when r.population is not null then 'Confira a população estudada: ' || r.population end], null)),
               'picked', exists (select 1 from public.presentation_evidence pe where pe.presentation_id = p.id and pe.evidence_id = r.id)) as j
        from public.evidence_references r where r.org_id = p.org_id and r.status = 'approved'
    ) x where x.score > 0 or (select coalesce(array_length(p.area_keys, 1), 0)) = 0), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 7. apresentação: abrir, salvar progressivamente, escolher evidências, publicar
create or replace function public.presentation_open(p_enrollment uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.patient_enrollments; p public.evaluation_presentations;
begin
  e := private.presentation_can_edit(p_enrollment);
  perform pg_advisory_xact_lock(hashtextextended('presentation:' || e.id::text, 0));
  select * into p from public.evaluation_presentations where enrollment_id = e.id;
  if not found then
    insert into public.evaluation_presentations (org_id, unit_id, enrollment_id, person_id, professional_id, created_by, updated_by)
      values (e.org_id, e.unit_id, e.id, e.person_id, e.professional_id, (select auth.uid()), (select auth.uid())) returning * into p;
  end if;
  perform private.log_clinical_access(e.person_id, 'professional', 'apresentacao');
  return private.presentation_staff_json(p) || jsonb_build_object('person_name', (select coalesce(nullif(btrim(preferred_name), ''), full_name) from public.people where id = e.person_id),
    'enrollment_status', e.status, 'professional', (select display_name from public.professionals where id = e.professional_id),
    'evaluation_at', (select lower(period) from public.appointments where id = e.evaluation_appointment_id));
end $$;

create or replace function public.presentation_save(p_id uuid, p_rev int, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.evaluation_presentations; k text; v_areas text[];
  v_allowed text[] := array['area_keys', 'complaint', 'symptom_duration', 'limitations', 'activities', 'condition_kind', 'condition_text', 'goal_title', 'goal_target_date', 'freq_per_week', 'duration_weeks', 'routine_text', 'reassessment_on', 'reassessment_criteria', 'internal_notes'];
begin
  select * into p from public.evaluation_presentations where id = p_id and org_id = private.current_org() for update;
  if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  perform private.presentation_can_edit(p.enrollment_id);
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'conteúdo inválido'; end if;
  for k in select jsonb_object_keys(p_patch) loop if not (k = any (v_allowed)) then raise exception 'campo não permitido: %', k; end if; end loop;
  if p.rev <> p_rev then raise exception 'EDICAO_CONFLITO: a apresentação foi alterada em outra tela (revisão % ≠ %)', p.rev, p_rev using errcode = 'P0010'; end if;
  if p_patch ? 'area_keys' then
    select coalesce(array_agg(x), '{}') into v_areas from jsonb_array_elements_text(p_patch -> 'area_keys') x;
    if exists (select 1 from unnest(v_areas) a where not exists (select 1 from public.physio_areas pa where pa.key = a)) then raise exception 'área inválida'; end if;
    p.area_keys := v_areas;
  end if;
  if p_patch ? 'complaint' then p.complaint := nullif(btrim(p_patch ->> 'complaint'), ''); end if;
  if p_patch ? 'symptom_duration' then p.symptom_duration := nullif(btrim(p_patch ->> 'symptom_duration'), ''); end if;
  if p_patch ? 'limitations' then p.limitations := nullif(btrim(p_patch ->> 'limitations'), ''); end if;
  if p_patch ? 'activities' then p.activities := nullif(btrim(p_patch ->> 'activities'), ''); end if;
  if p_patch ? 'condition_kind' then p.condition_kind := nullif(p_patch ->> 'condition_kind', ''); end if;
  if p_patch ? 'condition_text' then p.condition_text := nullif(btrim(p_patch ->> 'condition_text'), ''); end if;
  if p_patch ? 'goal_title' then p.goal_title := nullif(btrim(p_patch ->> 'goal_title'), ''); end if;
  if p_patch ? 'goal_target_date' then p.goal_target_date := nullif(p_patch ->> 'goal_target_date', '')::date; end if;
  if p_patch ? 'freq_per_week' then p.freq_per_week := nullif(p_patch ->> 'freq_per_week', '')::smallint; end if;
  if p_patch ? 'duration_weeks' then p.duration_weeks := nullif(p_patch ->> 'duration_weeks', '')::smallint; end if;
  if p_patch ? 'routine_text' then p.routine_text := nullif(btrim(p_patch ->> 'routine_text'), ''); end if;
  if p_patch ? 'reassessment_on' then p.reassessment_on := nullif(p_patch ->> 'reassessment_on', '')::date; end if;
  if p_patch ? 'reassessment_criteria' then p.reassessment_criteria := nullif(btrim(p_patch ->> 'reassessment_criteria'), ''); end if;
  if p_patch ? 'internal_notes' then p.internal_notes := nullif(btrim(p_patch ->> 'internal_notes'), ''); end if;
  if p.condition_text is not null and p.condition_kind is null then raise exception 'diga se a condição foi avaliada ou é uma hipótese'; end if;
  update public.evaluation_presentations set area_keys = p.area_keys, complaint = p.complaint, symptom_duration = p.symptom_duration, limitations = p.limitations, activities = p.activities,
      condition_kind = p.condition_kind, condition_text = p.condition_text, goal_title = p.goal_title, goal_target_date = p.goal_target_date, freq_per_week = p.freq_per_week, duration_weeks = p.duration_weeks,
      routine_text = p.routine_text, reassessment_on = p.reassessment_on, reassessment_criteria = p.reassessment_criteria, internal_notes = p.internal_notes,
      rev = p.rev + 1, updated_at = now(), updated_by = (select auth.uid()) where id = p_id returning * into p;
  return jsonb_build_object('rev', p.rev, 'saved_at', p.updated_at);
end $$;

create or replace function public.presentation_evidence_pick(p_id uuid, p_evidence uuid, p_rationale text, p_differences text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.evaluation_presentations; r public.evidence_references;
begin
  select * into p from public.evaluation_presentations where id = p_id and org_id = private.current_org() for update;
  if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  perform private.presentation_can_edit(p.enrollment_id);
  select * into r from public.evidence_references where id = p_evidence and org_id = p.org_id;
  if not found or r.status <> 'approved' then raise exception 'só fichas científicas APROVADAS podem ser usadas com o paciente'; end if;
  if length(btrim(coalesce(p_rationale, ''))) < 5 then raise exception 'explique, em linguagem simples, por que esta ficha se relaciona com o caso'; end if;
  if (select count(*) from public.presentation_evidence where presentation_id = p_id and evidence_id <> p_evidence) >= 3 then raise exception 'use de um a três estudos'; end if;
  insert into public.presentation_evidence (presentation_id, evidence_id, rationale, differences, position, picked_by)
    values (p_id, p_evidence, btrim(p_rationale), nullif(btrim(p_differences), ''), (select coalesce(max(position), 0) + 1 from public.presentation_evidence where presentation_id = p_id), (select auth.uid()))
    on conflict (presentation_id, evidence_id) do update set rationale = excluded.rationale, differences = excluded.differences, picked_by = excluded.picked_by, picked_at = now();
  update public.evaluation_presentations set rev = rev + 1, updated_at = now(), updated_by = (select auth.uid()) where id = p_id returning * into p;
  return private.presentation_staff_json(p);
end $$;

create or replace function public.presentation_evidence_unpick(p_id uuid, p_evidence uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.evaluation_presentations;
begin
  select * into p from public.evaluation_presentations where id = p_id and org_id = private.current_org() for update;
  if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  perform private.presentation_can_edit(p.enrollment_id);
  delete from public.presentation_evidence where presentation_id = p_id and evidence_id = p_evidence;
  update public.evaluation_presentations set rev = rev + 1, updated_at = now(), updated_by = (select auth.uid()) where id = p_id returning * into p;
  return private.presentation_staff_json(p);
end $$;

-- publicar: cria uma VERSÃO com o que o paciente poderá ver (sem anotações internas); repetir sem mudanças não cria versão nova; não sobrescreve plano/meta ativos
create or replace function public.presentation_publish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.evaluation_presentations; e public.patient_enrollments; v_payload jsonb; v_last jsonb; v_ver int; v_staff jsonb; v_goal_created boolean := false;
begin
  select * into p from public.evaluation_presentations where id = p_id and org_id = private.current_org() for update;
  if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  e := private.presentation_can_edit(p.enrollment_id);
  v_staff := private.presentation_staff_json(p);
  if not (v_staff ->> 'can_publish')::boolean then raise exception 'falta preencher: %', (select string_agg(x, '; ') from jsonb_array_elements_text(v_staff -> 'missing') x); end if;
  v_payload := private.presentation_patient_payload(p);
  select version, payload into v_ver, v_last from public.presentation_versions where presentation_id = p.id order by version desc limit 1;
  if v_last is not distinct from v_payload then
    return jsonb_build_object('version', v_ver, 'created', false, 'goal_created', false);        -- nada mudou: não cria versão, convite, meta nem plano
  end if;
  v_ver := coalesce(v_ver, 0) + 1;
  insert into public.presentation_versions (presentation_id, version, payload, published_by) values (p.id, v_ver, v_payload, (select auth.uid()));
  update public.evaluation_presentations set status = 'published', published_version = v_ver, published_at = now(), published_by = (select auth.uid()) where id = p.id;
  -- o objetivo vira a meta do paciente SÓ se ele ainda não tem meta ativa (a apresentação nova nunca sobrescreve em silêncio)
  if p.goal_title is not null and not exists (select 1 from public.patient_goals g where g.person_id = p.person_id and g.status = 'active') then
    perform public.patient_goal_save(p.person_id, null, p.goal_title, null, p.goal_target_date, 'active'); v_goal_created := true;
  end if;
  return jsonb_build_object('version', v_ver, 'created', true, 'goal_created', v_goal_created);
end $$;

-- ---------------------------------------------------------------- 8. prévia real do portal (leitura, gêmeos "prof_*" das chamadas do portal) e versão do paciente
create or replace function public.presentation_preview_home(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_j jsonb; v_p record; v_pain_first numeric; v_pain_last numeric; v_pain_n int; v_goal jsonb; v_last_dec text; e public.patient_enrollments; p public.evaluation_presentations;
begin
  if v_org is null or not private.has_care_relationship(p_person) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into e from public.patient_enrollments where org_id = v_org and person_id = p_person and status in ('pending', 'active') limit 1;
  select * into p from public.evaluation_presentations where person_id = p_person and org_id = v_org limit 1;
  v_j := private.journey_payload(p_person, false);
  select pe.full_name, pe.preferred_name, pe.birth_date into v_p from public.people pe where pe.id = p_person;
  select (array_agg((x ->> 'score')::numeric order by (x ->> 'assessed_at')))[1], (array_agg((x ->> 'score')::numeric order by (x ->> 'assessed_at') desc))[1], count(*)
    into v_pain_first, v_pain_last, v_pain_n from jsonb_array_elements(v_j -> 'assessments') x where x ->> 'kind' = 'dor';
  select g into v_goal from jsonb_array_elements(v_j -> 'goals') g where g ->> 'status' = 'active' limit 1;
  -- sem meta ativa ainda: a prévia mostra o objetivo QUE SERÁ publicado (rascunho), identificado como tal pelo front
  if v_goal is null and p.goal_title is not null then v_goal := jsonb_build_object('id', p.id, 'title', p.goal_title, 'target_date', p.goal_target_date, 'status', 'active', 'draft', true); end if;
  select d ->> 'decision' into v_last_dec from jsonb_array_elements(v_j -> 'reassessments') d order by (d ->> 'decided_at') desc limit 1;
  return jsonb_build_object(
    'person', jsonb_build_object('id', p_person, 'name', coalesce(nullif(btrim(v_p.preferred_name), ''), v_p.full_name), 'birth_date', v_p.birth_date, 'age', private.age_years(v_p.birth_date)),
    'needs_birth_date', false, 'next_appointment', (v_j -> 'upcoming') -> 0, 'plan', v_j -> 'plan', 'package_balance', case when exists (select 1 from public.client_packages cp where cp.person_id = p_person and cp.status = 'active') then v_j -> 'package_balance' end,   -- sem pacote contratado não há saldo (nunca zero inventado)
    'pain', case when v_pain_n > 0 then jsonb_build_object('first', v_pain_first, 'last', v_pain_last, 'count', v_pain_n) end, 'goal', v_goal, 'last_decision', v_last_dec,
    'renewal_open', false, 'videos_count', jsonb_array_length(v_j -> 'videos'), 'unread_msgs', 0, 'training', private.training_summary(p_person), 'checkin_due', false, 'offers', '[]'::jsonb,
    'enrollment', jsonb_build_object('status', coalesce(e.status, 'none'), 'payment', private.enrollment_payment_state(v_org, p_person)));
end $$;

create or replace function public.presentation_preview_appointments(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_org() is null or not private.has_care_relationship(p_person) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', lower(a.period), 'status', a.status, 'service_name', s.name, 'professional_name', pr.display_name,
                  'patient_confirmed_at', a.patient_confirmed_at, 'can_confirm', false) order by lower(a.period))
                    from public.appointments a join public.services s on s.id = a.service_id join public.professionals pr on pr.id = a.professional_id
                   where a.person_id = p_person and a.org_id = private.current_org()), '[]'::jsonb);
end $$;

-- a versão LIBERADA, vista pelo próprio paciente (vínculo pendente ou ativo). Nada de anotações internas, nada de rascunho.
create or replace function public.my_presentation() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_org uuid := private.current_org(); e public.patient_enrollments; p public.evaluation_presentations; v jsonb; v_ver int; v_at timestamptz;
begin
  if v_person is null or v_org is null then return jsonb_build_object('available', false); end if;
  select * into e from public.patient_enrollments where org_id = v_org and person_id = v_person and status in ('pending', 'active') limit 1;
  if not found then return jsonb_build_object('available', false); end if;
  select * into p from public.evaluation_presentations where enrollment_id = e.id;
  if not found or p.published_version = 0 then return jsonb_build_object('available', false, 'status', e.status); end if;
  select payload, version, published_at into v, v_ver, v_at from public.presentation_versions where presentation_id = p.id and version = p.published_version;
  return jsonb_build_object('available', true, 'version', v_ver, 'published_at', v_at, 'enrollment_status', e.status, 'payment', private.enrollment_payment_state(v_org, v_person), 'content', v,
    'person_name', (select coalesce(nullif(btrim(preferred_name), ''), full_name) from public.people where id = v_person),
    'professional', (select display_name from public.professionals where id = e.professional_id));
end $$;

-- ---------------------------------------------------------------- 9. privilégios
revoke all on function private.presentation_can_edit(uuid), private.evidence_json(public.evidence_references), private.presentation_patient_payload(public.evaluation_presentations), private.presentation_staff_json(public.evaluation_presentations) from public, anon, authenticated;
revoke all on function public.enrollment_start_evaluation(uuid, uuid), public.evidence_save(uuid, jsonb), public.evidence_review(uuid, text, boolean, text), public.evidence_list(text), public.evidence_suggest(uuid),
  public.presentation_open(uuid), public.presentation_save(uuid, int, jsonb), public.presentation_evidence_pick(uuid, uuid, text, text), public.presentation_evidence_unpick(uuid, uuid), public.presentation_publish(uuid),
  public.presentation_preview_home(uuid), public.presentation_preview_appointments(uuid), public.my_presentation() from public, anon;
grant execute on function public.enrollment_start_evaluation(uuid, uuid), public.evidence_save(uuid, jsonb), public.evidence_review(uuid, text, boolean, text), public.evidence_list(text), public.evidence_suggest(uuid),
  public.presentation_open(uuid), public.presentation_save(uuid, int, jsonb), public.presentation_evidence_pick(uuid, uuid, text, text), public.presentation_evidence_unpick(uuid, uuid), public.presentation_publish(uuid),
  public.presentation_preview_home(uuid), public.presentation_preview_appointments(uuid), public.my_presentation() to authenticated;
