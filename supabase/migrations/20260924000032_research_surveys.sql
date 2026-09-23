-- HP Group Hub — 032 Pesquisas: criar/editar/publicar/encerrar, perguntas com opções, público-alvo
-- (pacientes/parceiros/alunos), identificada OU anônima, respostas, dashboard com participação/resultados
-- filtrável por período/unidade, permissões de administrar/responder. Distinta do `public.surveys` existente
-- (NPS fixo pós-atendimento) — este é um sistema geral de pesquisas com perguntas livres.
--
-- Versionamento imutável: `research_questions` é a cópia de trabalho (editável a qualquer momento pelo
-- administrador); ao publicar — e a cada edição feita DEPOIS de publicada — o conjunto de perguntas é
-- congelado em `research_survey_versions.snapshot` (jsonb). Toda resposta grava o `version_id` vigente no
-- momento do envio; a leitura de uma resposta antiga sempre usa o snapshot da sua própria versão, nunca a
-- tabela viva — editar a pesquisa depois não muda o significado de respostas já registradas. Perguntas nunca
-- são apagadas de verdade (soft delete via `archived_at`): o id permanece estável, então o vínculo de
-- `research_answers.question_id` nunca quebra, mesmo depois de arquivada.
--
-- Anonimato real, não só escondido na tela: pesquisa anônima nunca grava `person_id` na resposta — não é
-- "ocultado no relatório", é estruturalmente ausente do dado, então não há como relacionar uma resposta ao
-- participante em nenhum relatório administrativo. Como consequência honesta, pesquisa anônima não impede
-- reenvio da mesma pessoa (não há identificador para checar duplicidade sem quebrar o anonimato).
--
-- k-anonimato no dashboard: a quebra por pergunta/opção só aparece com 5+ respostas no filtro aplicado —
-- mesma regra já usada em `corporate_indicators` — para nunca expor resposta (inclusive de saúde) que possa
-- reidentificar alguém num recorte pequeno. A lista de respostas individuais (só existe para pesquisa
-- identificada) é uma tela separada, nunca misturada aos indicadores agregados.

create table public.research_surveys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete set null,        -- null = pesquisa org-wide (todas as unidades)
  title text not null check (length(btrim(title)) > 1),
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  audience public.person_kind[] not null check (audience <@ array['patient', 'partner', 'student']::public.person_kind[] and array_length(audience, 1) > 0),
  is_anonymous boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  closed_at timestamptz
);

create table public.research_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  survey_id uuid not null references public.research_surveys(id) on delete cascade,
  prompt text not null check (length(btrim(prompt)) > 1),
  kind text not null check (kind in ('single_choice', 'multi_choice', 'text')),
  options text[],
  required boolean not null default true,
  position int not null default 0,
  archived_at timestamptz,
  check ((kind = 'text') = (options is null)),
  check (kind = 'text' or array_length(options, 1) >= 2)
);
create index research_questions_survey_idx on public.research_questions (survey_id, position) where archived_at is null;

create table public.research_survey_versions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.research_surveys(id) on delete cascade,
  version_no int not null,
  snapshot jsonb not null,     -- [{id,prompt,kind,options,required,position}], congelado no momento
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (survey_id, version_no)
);
alter table public.research_surveys add column current_version_id uuid references public.research_survey_versions(id) on delete set null;

create table public.research_responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  survey_id uuid not null references public.research_surveys(id) on delete restrict,
  version_id uuid not null references public.research_survey_versions(id) on delete restrict,
  person_id uuid references public.people(id) on delete restrict,     -- nulo quando is_anonymous
  unit_id uuid references public.units(id) on delete set null,        -- unidade da pessoa no momento do envio
  submitted_at timestamptz not null default now()
);
create unique index research_responses_person_uq on public.research_responses (survey_id, person_id) where person_id is not null;
create index research_responses_survey_idx on public.research_responses (survey_id, submitted_at);

create table public.research_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.research_responses(id) on delete cascade,
  question_id uuid not null references public.research_questions(id) on delete restrict,
  answer_options text[],
  answer_text text,
  check (answer_options is not null or answer_text is not null)
);
create index research_answers_response_idx on public.research_answers (response_id);
create index research_answers_question_idx on public.research_answers (question_id);

-- ---------------------------------------------------------------- permissões
create or replace function private.can_manage_research() returns boolean
language sql stable set search_path = '' as $$ select private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) $$;

-- pessoa qualifica para o público-alvo se algum dos seus person_kinds está no array de audience da pesquisa
create or replace function private.in_research_audience(p_audience public.person_kind[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.person_kinds pk where pk.person_id = private.current_person() and pk.kind = any(p_audience))
$$;

-- ---------------------------------------------------------------- snapshot / versionamento
create or replace function private.research_snapshot(p_survey uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'prompt', prompt, 'kind', kind, 'options', options, 'required', required, 'position', position) order by position), '[]')
  from public.research_questions where survey_id = p_survey and archived_at is null
$$;

-- Congela o estado atual das perguntas como uma nova versão e aponta current_version_id pra ela.
-- Chamado na publicação e, depois disso, a cada edição de pergunta/opção (nunca muda o passado).
create or replace function private.research_bump_version(p_survey uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_no int; v_id uuid;
begin
  select coalesce(max(version_no), 0) + 1 into v_no from public.research_survey_versions where survey_id = p_survey;
  insert into public.research_survey_versions (survey_id, version_no, snapshot, created_by)
    values (p_survey, v_no, private.research_snapshot(p_survey), (select auth.uid())) returning id into v_id;
  update public.research_surveys set current_version_id = v_id where id = p_survey;
  return v_id;
end $$;

-- ---------------------------------------------------------------- CRUD do administrador
create or replace function public.research_survey_create(p_title text, p_description text, p_audience public.person_kind[], p_is_anonymous boolean, p_unit uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.can_manage_research() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_audience is null or array_length(p_audience, 1) is null then raise exception 'selecione ao menos um público-alvo'; end if;
  insert into public.research_surveys (org_id, unit_id, title, description, audience, is_anonymous, created_by)
    values (private.current_org(), p_unit, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_audience, coalesce(p_is_anonymous, false), (select auth.uid()))
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.research_survey_update_meta(p_id uuid, p_title text, p_description text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_research() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.research_surveys where id = p_id and org_id = private.current_org() and status <> 'closed') then raise exception 'pesquisa não encontrada ou encerrada'; end if;
  update public.research_surveys set title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), '') where id = p_id;
end $$;

-- Insere (p_id nulo) ou atualiza (p_id informado) uma pergunta. Se a pesquisa já está publicada, congela uma
-- nova versão logo depois — respostas já registradas continuam lendo a versão antiga, nunca esta mudança.
create or replace function public.research_question_upsert(p_survey uuid, p_id uuid, p_prompt text, p_kind text, p_options text[], p_required boolean, p_position int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.research_surveys; v_id uuid;
begin
  select * into s from public.research_surveys where id = p_survey and org_id = private.current_org();
  if not found or not private.can_manage_research() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status = 'closed' then raise exception 'pesquisa encerrada — não é possível editar perguntas'; end if;
  if p_kind not in ('single_choice', 'multi_choice', 'text') then raise exception 'tipo de pergunta inválido'; end if;
  if p_kind = 'text' and p_options is not null then raise exception 'pergunta de texto livre não tem opções'; end if;
  if p_kind <> 'text' and (p_options is null or array_length(p_options, 1) < 2) then raise exception 'informe ao menos 2 opções'; end if;
  if p_id is null then
    insert into public.research_questions (org_id, survey_id, prompt, kind, options, required, position)
      values (s.org_id, p_survey, btrim(p_prompt), p_kind, p_options, coalesce(p_required, true), coalesce(p_position, 0)) returning id into v_id;
  else
    update public.research_questions set prompt = btrim(p_prompt), kind = p_kind, options = p_options, required = coalesce(p_required, true), position = coalesce(p_position, position)
      where id = p_id and survey_id = p_survey and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'pergunta não encontrada'; end if;
  end if;
  if s.status = 'published' then perform private.research_bump_version(p_survey); end if;
  return v_id;
end $$;

create or replace function public.research_question_archive(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.research_questions; s public.research_surveys;
begin
  select * into q from public.research_questions where id = p_id;
  if not found then raise exception 'pergunta não encontrada'; end if;
  select * into s from public.research_surveys where id = q.survey_id and org_id = private.current_org();
  if not found or not private.can_manage_research() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status = 'closed' then raise exception 'pesquisa encerrada — não é possível editar perguntas'; end if;
  update public.research_questions set archived_at = now() where id = p_id;
  if s.status = 'published' then perform private.research_bump_version(s.id); end if;
end $$;

create or replace function public.research_survey_publish(p_survey uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.research_surveys; v_n int;
begin
  select * into s from public.research_surveys where id = p_survey and org_id = private.current_org();
  if not found or not private.can_manage_research() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status <> 'draft' then raise exception 'só é possível publicar uma pesquisa em rascunho'; end if;
  select count(*) into v_n from public.research_questions where survey_id = p_survey and archived_at is null;
  if v_n = 0 then raise exception 'adicione ao menos uma pergunta antes de publicar'; end if;
  update public.research_surveys set status = 'published', published_at = now() where id = p_survey;
  perform private.research_bump_version(p_survey);
end $$;

create or replace function public.research_survey_close(p_survey uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_research() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.research_surveys where id = p_survey and org_id = private.current_org() and status = 'published') then raise exception 'só é possível encerrar uma pesquisa publicada'; end if;
  update public.research_surveys set status = 'closed', closed_at = now() where id = p_survey;
end $$;

-- ---------------------------------------------------------------- resposta (portal)
-- Perguntas vivas (não o snapshot) — é o formulário que a pessoa preenche agora.
create or replace function public.research_survey_for_response(p_survey uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.research_surveys;
begin
  select * into s from public.research_surveys where id = p_survey and org_id = private.current_org() and status = 'published';
  if not found or not private.in_research_audience(s.audience) then raise exception 'pesquisa indisponível' using errcode = '42501'; end if;
  if not s.is_anonymous and exists (select 1 from public.research_responses where survey_id = p_survey and person_id = private.current_person()) then
    raise exception 'você já respondeu esta pesquisa';
  end if;
  return jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description, 'is_anonymous', s.is_anonymous,
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'prompt', prompt, 'kind', kind, 'options', options, 'required', required) order by position), '[]')
                  from public.research_questions where survey_id = p_survey and archived_at is null));
end $$;

-- Pesquisas publicadas, no público da pessoa, ainda não respondidas por ela (pesquisas anônimas sempre aparecem).
create or replace function public.research_available_surveys() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid := private.current_person();
begin
  if v_person is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description) order by s.published_at desc)
    from public.research_surveys s
    where s.org_id = private.current_org() and s.status = 'published' and private.in_research_audience(s.audience)
      and (s.is_anonymous or not exists (select 1 from public.research_responses r where r.survey_id = s.id and r.person_id = v_person))), '[]');
end $$;

create or replace function public.research_response_submit(p_survey uuid, p_answers jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.research_surveys; v_person uuid := private.current_person(); v_unit uuid; v_resp uuid; q record; a jsonb; v_answered uuid[] := '{}';
begin
  select * into s from public.research_surveys where id = p_survey and org_id = private.current_org() and status = 'published';
  if not found or v_person is null or not private.in_research_audience(s.audience) then raise exception 'pesquisa indisponível' using errcode = '42501'; end if;
  if not s.is_anonymous and exists (select 1 from public.research_responses where survey_id = p_survey and person_id = v_person) then raise exception 'você já respondeu esta pesquisa'; end if;
  if jsonb_typeof(p_answers) <> 'array' then raise exception 'respostas inválidas'; end if;
  select unit_id into v_unit from public.people where id = v_person;
  insert into public.research_responses (org_id, survey_id, version_id, person_id, unit_id)
    values (s.org_id, p_survey, s.current_version_id, case when s.is_anonymous then null else v_person end, v_unit) returning id into v_resp;
  for a in select * from jsonb_array_elements(p_answers) loop
    select * into q from public.research_questions where id = (a ->> 'question_id')::uuid and survey_id = p_survey and archived_at is null;
    if not found then raise exception 'pergunta inválida'; end if;
    v_answered := v_answered || q.id;
    if q.kind = 'text' then
      if coalesce(btrim(a ->> 'text'), '') = '' then if q.required then raise exception 'resposta obrigatória em branco: %', q.prompt; else continue; end if; end if;
      insert into public.research_answers (response_id, question_id, answer_text) values (v_resp, q.id, btrim(a ->> 'text'));
    else
      if not (a ? 'options') or jsonb_array_length(a -> 'options') = 0 then
        if q.required then raise exception 'resposta obrigatória em branco: %', q.prompt; else continue; end if;
      end if;
      if q.kind = 'single_choice' and jsonb_array_length(a -> 'options') > 1 then raise exception 'pergunta de escolha única recebeu mais de uma opção: %', q.prompt; end if;
      if exists (select 1 from jsonb_array_elements_text(a -> 'options') o where not (o = any (q.options))) then raise exception 'opção inválida em: %', q.prompt; end if;
      insert into public.research_answers (response_id, question_id, answer_options) values (v_resp, q.id, (select array_agg(o) from jsonb_array_elements_text(a -> 'options') o));
    end if;
  end loop;
  if exists (select 1 from public.research_questions where survey_id = p_survey and archived_at is null and required and not (id = any (v_answered))) then
    raise exception 'preencha todas as perguntas obrigatórias';
  end if;
  return v_resp;
end $$;

-- ---------------------------------------------------------------- dashboard e respostas individuais (administrador)
-- k-anonimato: com menos de 5 respostas no recorte, a quebra por pergunta/opção fica indisponível — só a
-- contagem total de participação aparece (nunca 0 quando na verdade não pode ser calculado).
create or replace function public.research_dashboard(p_survey uuid, p_from timestamptz default null, p_to timestamptz default null, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.research_surveys; v_total int; v_breakdown jsonb;
begin
  select * into s from public.research_surveys where id = p_survey and org_id = private.current_org();
  if not found or not private.can_manage_research() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select count(*) into v_total from public.research_responses r
    where r.survey_id = p_survey and (p_from is null or r.submitted_at >= p_from) and (p_to is null or r.submitted_at < p_to) and (p_unit is null or r.unit_id = p_unit);
  if v_total < 5 then
    return jsonb_build_object('total', v_total, 'breakdown_available', false, 'breakdown', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('question_id', q.id, 'prompt', q.prompt, 'kind', q.kind, 'options', q.options, 'counts', t.counts, 'text_count', t.text_count) order by q.position), '[]') into v_breakdown
  from public.research_questions q
  left join lateral (
    select (select coalesce(jsonb_object_agg(opt, n), '{}') from (
              select opt, count(*) n from public.research_answers an join public.research_responses r on r.id = an.response_id, unnest(an.answer_options) opt
              where an.question_id = q.id and r.survey_id = p_survey and (p_from is null or r.submitted_at >= p_from) and (p_to is null or r.submitted_at < p_to) and (p_unit is null or r.unit_id = p_unit)
              group by opt) x) as counts,
           (select count(*) from public.research_answers an join public.research_responses r on r.id = an.response_id
              where an.question_id = q.id and an.answer_text is not null and r.survey_id = p_survey and (p_from is null or r.submitted_at >= p_from) and (p_to is null or r.submitted_at < p_to) and (p_unit is null or r.unit_id = p_unit)) as text_count
  ) t on true
  where q.survey_id = p_survey and q.archived_at is null;
  return jsonb_build_object('total', v_total, 'breakdown_available', true, 'breakdown', v_breakdown);
end $$;

-- Só existe (e só é chamável) para pesquisa identificada — lista separada, nunca misturada ao dashboard agregado.
create or replace function public.research_responses_list(p_survey uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.research_surveys;
begin
  select * into s from public.research_surveys where id = p_survey and org_id = private.current_org();
  if not found or not private.can_manage_research() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.is_anonymous then raise exception 'pesquisa anônima não tem lista de respostas individuais'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('response_id', r.id, 'person_name', p.full_name, 'submitted_at', r.submitted_at,
      'answers', (select coalesce(jsonb_agg(jsonb_build_object('question_id', an.question_id, 'answer_options', an.answer_options, 'answer_text', an.answer_text)), '[]') from public.research_answers an where an.response_id = r.id))
    order by r.submitted_at desc) from public.research_responses r join public.people p on p.id = r.person_id where r.survey_id = p_survey), '[]');
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.research_surveys enable row level security;
alter table public.research_questions enable row level security;
alter table public.research_survey_versions enable row level security;
alter table public.research_responses enable row level security;
alter table public.research_answers enable row level security;

grant select, insert, update on public.research_surveys to authenticated;
grant select on public.research_questions, public.research_survey_versions, public.research_responses, public.research_answers to authenticated;

create policy rs_read on public.research_surveys for select to authenticated using (private.in_org(org_id) and private.can_manage_research());
create policy rs_write on public.research_surveys for insert to authenticated with check (private.in_org(org_id) and private.can_manage_research());
create policy rs_update on public.research_surveys for update to authenticated using (private.in_org(org_id) and private.can_manage_research()) with check (private.in_org(org_id));
create policy rq_read on public.research_questions for select to authenticated using (exists (select 1 from public.research_surveys s where s.id = survey_id and private.in_org(s.org_id) and private.can_manage_research()));
create policy rv_read on public.research_survey_versions for select to authenticated using (exists (select 1 from public.research_surveys s where s.id = survey_id and private.in_org(s.org_id) and private.can_manage_research()));
create policy rr_read on public.research_responses for select to authenticated using (private.in_org(org_id) and private.can_manage_research());
create policy ra_read on public.research_answers for select to authenticated using (exists (select 1 from public.research_responses r where r.id = response_id and private.in_org(r.org_id) and private.can_manage_research()));

grant execute on function
  public.research_survey_create(text, text, public.person_kind[], boolean, uuid),
  public.research_survey_update_meta(uuid, text, text),
  public.research_question_upsert(uuid, uuid, text, text, text[], boolean, int),
  public.research_question_archive(uuid),
  public.research_survey_publish(uuid),
  public.research_survey_close(uuid),
  public.research_survey_for_response(uuid),
  public.research_available_surveys(),
  public.research_response_submit(uuid, jsonb),
  public.research_dashboard(uuid, timestamptz, timestamptz, uuid),
  public.research_responses_list(uuid)
  to authenticated;
