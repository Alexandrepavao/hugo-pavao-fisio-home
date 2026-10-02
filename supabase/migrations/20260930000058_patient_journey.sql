-- HP Group Hub — 058 Jornada de acompanhamento do paciente (objetivos, plano de sessões, evolução, vídeos privados, reavaliação, renovação).
-- Privacidade: dados clínicos (objetivos, plano, avaliações, reavaliações, vídeos) só para (a) o PRÓPRIO paciente, por funções que omitem o que for restrito,
-- e (b) o profissional com VÍNCULO assistencial ativo (private.has_care_relationship). Papel administrativo (gestor, comercial, financeiro) NÃO lê nada disso.
-- As tabelas não têm GRANT de escrita: toda escrita passa por funções que validam permissão. Avaliações são imutáveis (correção = nova avaliação).
-- Nada aqui cobra, consome sessão ou promete resultado: consumo de sessão NÃO é medida de melhora clínica (as sessões aparecem só como contagem).

-- ---------------------------------------------------------------- configuração (modelo de 10 sessões é apenas o padrão inicial)
create table public.journey_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  default_sessions int not null default 10 check (default_sessions between 1 and 200),
  bunny_library_id text check (bunny_library_id is null or bunny_library_id ~ '^[0-9]{1,12}$'),      -- ID da biblioteca Bunny Stream (não é segredo)
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- tabelas clínicas
create table public.patient_goals (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 200), details text check (details is null or length(details) <= 1000), target_date date,
  status text not null default 'active' check (status in ('active','achieved','dropped')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz
);
create index patient_goals_person_idx on public.patient_goals (person_id, created_at desc);

create table public.patient_plans (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade,
  client_package_id uuid references public.client_packages(id) on delete set null,
  planned_sessions int not null check (planned_sessions between 1 and 200), started_on date not null default current_date,
  status text not null default 'active' check (status in ('active','completed','cancelled')), maintenance boolean not null default false,
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz
);
create unique index patient_plans_active_uq on public.patient_plans (person_id) where status = 'active';

create table public.patient_assessments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade, plan_id uuid references public.patient_plans(id) on delete set null,
  kind text not null check (kind in ('dor','funcionalidade','bem_estar')),       -- dor: 0 = sem dor, 10 = pior; funcionalidade/bem-estar: 0 = pior, 10 = melhor (escalas de autorrelato 0–10)
  score numeric(3,1) not null check (score between 0 and 10), note text check (note is null or length(note) <= 500),
  assessed_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null, recorded_by_role text not null check (recorded_by_role in ('patient','professional')),
  created_at timestamptz not null default now()
);
create index patient_assessments_person_idx on public.patient_assessments (person_id, assessed_at);

create table public.patient_reassessments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade, plan_id uuid references public.patient_plans(id) on delete set null,
  decision text not null check (decision in ('continuidade','manutencao','alta')), extra_sessions int check (extra_sessions is null or extra_sessions between 1 and 200),
  patient_message text check (patient_message is null or length(patient_message) <= 1000),      -- visível ao paciente
  clinical_note text check (clinical_note is null or length(clinical_note) <= 4000),             -- RESTRITA ao profissional vinculado
  decided_at timestamptz not null default now(), decided_by uuid references auth.users(id) on delete set null
);
create index patient_reassessments_person_idx on public.patient_reassessments (person_id, decided_at desc);

create table public.renewal_requests (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade, plan_id uuid references public.patient_plans(id) on delete set null,
  kind text not null check (kind in ('renovacao','contato')), message text check (message is null or length(message) <= 1000),
  status text not null default 'open' check (status in ('open','contacted','closed')),
  created_at timestamptz not null default now(), handled_by uuid references auth.users(id) on delete set null, handled_at timestamptz
);
create unique index renewal_requests_open_uq on public.renewal_requests (person_id) where status = 'open';     -- clique repetido não duplica o pedido

-- Vídeos PRIVADOS (Bunny Stream). Guardamos só os identificadores; a reprodução exige autorização do backend (Edge Function bunny-playback) e token assinado de curta duração.
create table public.patient_videos (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 160), description text check (description is null or length(description) <= 500),
  bunny_library_id text not null check (bunny_library_id ~ '^[0-9]{1,12}$'), bunny_video_id text not null check (bunny_video_id ~ '^[0-9a-fA-F-]{8,64}$'),
  assigned_by uuid references auth.users(id) on delete set null, assigned_at timestamptz not null default now(), revoked_at timestamptz, expires_at timestamptz
);
create index patient_videos_person_idx on public.patient_videos (person_id, assigned_at desc);
create table public.video_access_log (
  id bigint generated always as identity primary key, org_id uuid not null, person_id uuid not null, video_id uuid not null,
  accessed_by uuid, accessed_by_role text not null check (accessed_by_role in ('patient','professional')), accessed_at timestamptz not null default now()
);

alter table public.journey_settings enable row level security; alter table public.patient_goals enable row level security; alter table public.patient_plans enable row level security;
alter table public.patient_assessments enable row level security; alter table public.patient_reassessments enable row level security; alter table public.renewal_requests enable row level security;
alter table public.patient_videos enable row level security; alter table public.video_access_log enable row level security;
grant select on public.journey_settings, public.patient_goals, public.patient_plans, public.patient_assessments, public.patient_reassessments, public.renewal_requests, public.patient_videos, public.video_access_log to authenticated;
-- leitura direta: só o profissional vinculado (o paciente lê por my_journey(), que omite o restrito; administrativo não lê dado clínico)
create policy jrn_settings_read on public.journey_settings for select to authenticated using (org_id = private.current_org() and private.is_staff());
create policy goals_read on public.patient_goals for select to authenticated using (private.in_org(org_id) and private.has_care_relationship(person_id));
create policy plans_read on public.patient_plans for select to authenticated using (private.in_org(org_id) and private.has_care_relationship(person_id));
create policy assess_read on public.patient_assessments for select to authenticated using (private.in_org(org_id) and private.has_care_relationship(person_id));
create policy reassess_read on public.patient_reassessments for select to authenticated using (private.in_org(org_id) and private.has_care_relationship(person_id));
create policy videos_read on public.patient_videos for select to authenticated using (private.in_org(org_id) and private.has_care_relationship(person_id));
create policy vlog_read on public.video_access_log for select to authenticated using (private.in_org(org_id) and private.has_care_relationship(person_id));
-- pedidos de renovação são administrativos (sem dado clínico): equipe comercial/gestão da unidade e o profissional vinculado
create policy renewal_read on public.renewal_requests for select to authenticated
  using (private.in_org(org_id) and (private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id) or private.has_care_relationship(person_id)));

create trigger audit_patient_goals after insert or update on public.patient_goals for each row execute function private.audit_row('title','status','target_date');
create trigger audit_patient_plans after insert or update on public.patient_plans for each row execute function private.audit_row('planned_sessions','status','maintenance');
create trigger audit_patient_reassessments after insert on public.patient_reassessments for each row execute function private.audit_row('decision','extra_sessions');
create trigger audit_patient_videos after insert or update on public.patient_videos for each row execute function private.audit_row('title','revoked_at','expires_at');

-- ---------------------------------------------------------------- utilitários
create or replace function private.journey_default_sessions() returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select default_sessions from public.journey_settings where org_id = private.current_org()), 10)
$$;
-- unidade do vínculo do profissional atual com o paciente (a unidade em que o acompanhamento acontece)
create or replace function private.care_unit(p_person uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.unit_id from public.care_relationships r where r.person_id = p_person and r.professional_user_id = (select auth.uid()) and r.revoked_at is null
    and r.valid_from <= now() and (r.valid_until is null or r.valid_until > now()) order by r.created_at desc limit 1
$$;
create or replace function private.require_care(p_person uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_unit uuid;
begin
  if private.current_org() is null or not exists (select 1 from public.people where id = p_person and org_id = private.current_org()) or not private.has_care_relationship(p_person) then
    raise exception 'sem permissão' using errcode = '42501'; end if;
  v_unit := private.care_unit(p_person);
  if v_unit is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return v_unit;
end $$;

-- ---------------------------------------------------------------- configuração (gestor)
create or replace function public.journey_settings_get() returns table (default_sessions int, bunny_library_id text)
language sql stable security definer set search_path = '' as $$
  select coalesce(s.default_sessions, 10), s.bunny_library_id from (select 1) x left join public.journey_settings s on s.org_id = private.current_org() where private.is_staff()
$$;
create or replace function public.journey_settings_set(p_default_sessions int, p_bunny_library_id text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_default_sessions is null or p_default_sessions not between 1 and 200 then raise exception 'quantidade de sessões do modelo deve estar entre 1 e 200'; end if;
  insert into public.journey_settings (org_id, default_sessions, bunny_library_id, updated_by, updated_at)
    values (private.current_org(), p_default_sessions, nullif(btrim(coalesce(p_bunny_library_id, '')), ''), (select auth.uid()), now())
    on conflict (org_id) do update set default_sessions = excluded.default_sessions, bunny_library_id = excluded.bunny_library_id, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ---------------------------------------------------------------- profissional: objetivos, plano, avaliações, reavaliação, vídeos
create or replace function public.patient_goal_save(p_person uuid, p_id uuid, p_title text, p_details text default null, p_target_date date default null, p_status text default 'active') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid := private.require_care(p_person); v_id uuid;
begin
  if p_status not in ('active','achieved','dropped') then raise exception 'situação inválida'; end if;
  if p_id is null then
    insert into public.patient_goals (org_id, unit_id, person_id, title, details, target_date, status, created_by, closed_at)
      values (private.current_org(), v_unit, p_person, btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), p_target_date, p_status, (select auth.uid()), case when p_status <> 'active' then now() end) returning id into v_id;
  else
    update public.patient_goals set title = btrim(p_title), details = nullif(btrim(coalesce(p_details, '')), ''), target_date = p_target_date, status = p_status,
           closed_at = case when p_status <> 'active' then coalesce(closed_at, now()) end, updated_at = now()
     where id = p_id and person_id = p_person and org_id = private.current_org() returning id into v_id;
    if v_id is null then raise exception 'objetivo não encontrado'; end if;
  end if;
  return v_id;
end $$;

-- Um plano ativo por paciente. p_planned_sessions nulo = modelo padrão da organização (10 por padrão, configurável). A quantidade final é decisão clínica.
create or replace function public.patient_plan_save(p_person uuid, p_planned_sessions int default null, p_client_package uuid default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid := private.require_care(p_person); v_id uuid; v_n int := coalesce(p_planned_sessions, private.journey_default_sessions());
begin
  if v_n not between 1 and 200 then raise exception 'quantidade de sessões inválida (1 a 200)'; end if;
  if p_client_package is not null and not exists (select 1 from public.client_packages where id = p_client_package and person_id = p_person and org_id = private.current_org()) then raise exception 'pacote inválido para este paciente'; end if;
  select id into v_id from public.patient_plans where person_id = p_person and status = 'active' for update;
  if v_id is null then
    insert into public.patient_plans (org_id, unit_id, person_id, client_package_id, planned_sessions, notes, created_by)
      values (private.current_org(), v_unit, p_person, p_client_package, v_n, nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid())) returning id into v_id;
  else
    update public.patient_plans set planned_sessions = v_n, client_package_id = coalesce(p_client_package, client_package_id), notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.professional_assessment_add(p_person uuid, p_kind text, p_score numeric, p_note text default null, p_assessed_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid := private.require_care(p_person); v_id uuid;
begin
  if p_assessed_at is not null and p_assessed_at > now() + interval '5 minutes' then raise exception 'a data da avaliação não pode estar no futuro'; end if;
  insert into public.patient_assessments (org_id, unit_id, person_id, plan_id, kind, score, note, assessed_at, recorded_by, recorded_by_role)
    values (private.current_org(), v_unit, p_person, (select id from public.patient_plans where person_id = p_person and status = 'active'), p_kind, p_score, nullif(btrim(coalesce(p_note, '')), ''),
            coalesce(p_assessed_at, now()), (select auth.uid()), 'professional') returning id into v_id;
  return v_id;
end $$;

-- Reavaliação: continuidade (soma sessões ao plano), manutenção (marca o plano como de manutenção) ou alta (encerra o plano). Nunca gera cobrança nem consumo.
create or replace function public.patient_reassess(p_person uuid, p_decision text, p_extra_sessions int default null, p_patient_message text default null, p_clinical_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid := private.require_care(p_person); v_plan public.patient_plans; v_id uuid;
begin
  if p_decision not in ('continuidade','manutencao','alta') then raise exception 'decisão inválida'; end if;
  select * into v_plan from public.patient_plans where person_id = p_person and status = 'active' for update;
  if not found then raise exception 'não há plano ativo para reavaliar'; end if;
  if p_decision = 'continuidade' and coalesce(p_extra_sessions, 0) < 1 then raise exception 'informe quantas sessões adicionais o plano de continuidade prevê'; end if;
  insert into public.patient_reassessments (org_id, unit_id, person_id, plan_id, decision, extra_sessions, patient_message, clinical_note, decided_by)
    values (private.current_org(), v_unit, p_person, v_plan.id, p_decision, p_extra_sessions, nullif(btrim(coalesce(p_patient_message, '')), ''), nullif(btrim(coalesce(p_clinical_note, '')), ''), (select auth.uid())) returning id into v_id;
  if p_decision = 'alta' then update public.patient_plans set status = 'completed', closed_at = now(), updated_at = now() where id = v_plan.id;
  elsif p_decision = 'continuidade' then update public.patient_plans set planned_sessions = least(planned_sessions + p_extra_sessions, 200), updated_at = now() where id = v_plan.id;
  else update public.patient_plans set maintenance = true, planned_sessions = case when p_extra_sessions is not null then least(planned_sessions + p_extra_sessions, 200) else planned_sessions end, updated_at = now() where id = v_plan.id; end if;
  return v_id;
end $$;

create or replace function public.patient_video_assign(p_person uuid, p_title text, p_description text default null, p_library_id text default null, p_video_id text default null, p_expires_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid := private.require_care(p_person); v_lib text := coalesce(nullif(btrim(coalesce(p_library_id, '')), ''), (select bunny_library_id from public.journey_settings where org_id = private.current_org())); v_id uuid;
begin
  if v_lib is null then raise exception 'informe o ID da biblioteca Bunny (ou cadastre o padrão em Configurações)'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'a validade precisa ser futura'; end if;
  insert into public.patient_videos (org_id, unit_id, person_id, title, description, bunny_library_id, bunny_video_id, assigned_by, expires_at)
    values (private.current_org(), v_unit, p_person, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), v_lib, btrim(coalesce(p_video_id, '')), (select auth.uid()), p_expires_at) returning id into v_id;
  return v_id;
end $$;
create or replace function public.patient_video_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.patient_videos;
begin
  select * into v from public.patient_videos where id = p_id and org_id = private.current_org();
  if not found then raise exception 'vídeo não encontrado'; end if;
  perform private.require_care(v.person_id);
  update public.patient_videos set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end $$;

-- ---------------------------------------------------------------- paciente: autoavaliação, pedido de renovação/contato
create or replace function public.my_assessment_add(p_kind text, p_score numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_unit uuid; v_id uuid;
begin
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select unit_id into v_unit from public.people where id = v_person and org_id = private.current_org();
  if v_unit is null then raise exception 'cadastro sem unidade: fale com a recepção'; end if;
  insert into public.patient_assessments (org_id, unit_id, person_id, plan_id, kind, score, note, recorded_by, recorded_by_role)
    values (private.current_org(), v_unit, v_person, (select id from public.patient_plans where person_id = v_person and status = 'active'), p_kind, p_score, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()), 'patient') returning id into v_id;
  return v_id;
end $$;

-- Pedido de renovação/contato: só registra o PEDIDO e cria uma tarefa para a equipe. Nenhuma cobrança, venda ou consumo é criado. Clique repetido reaproveita o pedido aberto.
create or replace function public.my_renewal_request(p_kind text default 'contato', p_message text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_unit uuid; v_id uuid;
begin
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_kind not in ('renovacao','contato') then raise exception 'tipo de pedido inválido'; end if;
  select id into v_id from public.renewal_requests where person_id = v_person and status = 'open';
  if v_id is not null then return v_id; end if;
  select unit_id into v_unit from public.people where id = v_person and org_id = private.current_org();
  if v_unit is null then raise exception 'cadastro sem unidade: fale com a recepção'; end if;
  insert into public.renewal_requests (org_id, unit_id, person_id, plan_id, kind, message)
    values (private.current_org(), v_unit, v_person, (select id from public.patient_plans where person_id = v_person and status = 'active'), p_kind, nullif(btrim(coalesce(p_message, '')), '')) returning id into v_id;
  insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
    values (private.current_org(), v_unit, v_person, private.pick_owner(private.current_org(), v_unit), 'follow_up',
            case p_kind when 'renovacao' then 'Paciente pediu para renovar o acompanhamento — entrar em contato' else 'Paciente pediu contato da equipe' end, 'renewal:' || v_id) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.renewal_request_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.renewal_requests;
begin
  if p_status not in ('contacted','closed') then raise exception 'situação inválida'; end if;
  select * into r from public.renewal_requests where id = p_id and org_id = private.current_org();
  if not found or not (private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], r.unit_id) or private.has_care_relationship(r.person_id)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.renewal_requests set status = p_status, handled_by = (select auth.uid()), handled_at = now() where id = p_id;
end $$;

-- Fila para a equipe (administrativa, sem dado clínico): pedidos em aberto nas unidades do usuário.
create or replace function public.renewal_requests_open() returns table (id uuid, person_id uuid, person_name text, unit_name text, kind text, message text, created_at timestamptz, status text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.person_id, p.full_name, u.name, r.kind, r.message, r.created_at, r.status
    from public.renewal_requests r join public.people p on p.id = r.person_id join public.units u on u.id = r.unit_id
   where r.org_id = private.current_org() and r.status = 'open' and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], r.unit_id)
   order by r.created_at
$$;

-- ---------------------------------------------------------------- autorização de reprodução (chamada pela Edge Function bunny-playback com o JWT do usuário)
-- Devolve os identificadores do Bunny SÓ depois de autorizar: paciente dono do vídeo ou profissional vinculado; vídeo não revogado e não vencido. Registra o acesso.
create or replace function public.video_playback_authorize(p_video uuid) returns table (library_id text, bunny_video_id text)
language plpgsql security definer set search_path = '' as $$
declare v public.patient_videos; v_role text;
begin
  select * into v from public.patient_videos where id = p_video and org_id = private.current_org();
  if not found or v.revoked_at is not null or (v.expires_at is not null and v.expires_at <= now()) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v.person_id = private.current_person() then v_role := 'patient';
  elsif private.has_care_relationship(v.person_id) then v_role := 'professional';
  else raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into public.video_access_log (org_id, person_id, video_id, accessed_by, accessed_by_role) values (v.org_id, v.person_id, v.id, (select auth.uid()), v_role);
  return query select v.bunny_library_id, v.bunny_video_id;
end $$;

-- ---------------------------------------------------------------- leitura consolidada
-- Estrutura comum; p_clinical = true só para o profissional vinculado (inclui nota clínica restrita, vídeos revogados e contagem de acessos).
create or replace function private.journey_payload(p_person uuid, p_clinical boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); pl public.patient_plans; v_plan jsonb := null;
begin
  select * into pl from public.patient_plans where person_id = p_person and org_id = v_org and status = 'active';
  if not found then select * into pl from public.patient_plans where person_id = p_person and org_id = v_org order by created_at desc limit 1; end if;
  if pl.id is not null then
    v_plan := jsonb_build_object('id', pl.id, 'planned_sessions', pl.planned_sessions, 'started_on', pl.started_on, 'status', pl.status, 'maintenance', pl.maintenance, 'notes', pl.notes,
      'attended', (select count(*) from public.appointments a where a.person_id = p_person and a.status = 'attended' and lower(a.period)::date >= pl.started_on and (pl.closed_at is null or lower(a.period) <= pl.closed_at)),
      'patient_no_show', (select count(*) from public.appointments a where a.person_id = p_person and a.status = 'no_show' and lower(a.period)::date >= pl.started_on and (pl.closed_at is null or lower(a.period) <= pl.closed_at)),
      'professional_no_show', (select count(*) from public.appointments a where a.person_id = p_person and a.status = 'professional_no_show' and lower(a.period)::date >= pl.started_on and (pl.closed_at is null or lower(a.period) <= pl.closed_at)),
      'cancelled', (select count(*) from public.appointments a where a.person_id = p_person and a.status in ('cancelled_by_patient','cancelled_by_clinic') and lower(a.period)::date >= pl.started_on and (pl.closed_at is null or lower(a.period) <= pl.closed_at)));
  end if;
  return jsonb_build_object(
    'goals', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'details', g.details, 'target_date', g.target_date, 'status', g.status, 'created_at', g.created_at) order by (g.status = 'active') desc, g.created_at desc)
                         from public.patient_goals g where g.person_id = p_person and g.org_id = v_org), '[]'::jsonb),
    'plan', v_plan,
    'default_sessions', private.journey_default_sessions(),
    'package_balance', (select coalesce(sum(private.package_balance(c.id)), 0) from public.client_packages c where c.person_id = p_person and c.org_id = v_org and c.status = 'active'),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', lower(a.period), 'status', a.status, 'service', s.name, 'professional', pr.display_name) order by lower(a.period))
                            from (select * from public.appointments where person_id = p_person and org_id = v_org and status in ('scheduled','confirmed') and lower(period) > now() order by lower(period) limit 5) a
                            join public.services s on s.id = a.service_id join public.professionals pr on pr.id = a.professional_id), '[]'::jsonb),
    'assessments', coalesce((select jsonb_agg(x order by (x ->> 'assessed_at')) from (
        select jsonb_build_object('id', t.id, 'kind', t.kind, 'score', t.score, 'note', t.note, 'assessed_at', t.assessed_at, 'by_role', t.recorded_by_role,
               'author', case when t.recorded_by_role = 'patient' then 'Paciente' else coalesce((select ua.display_name from public.user_accounts ua where ua.user_id = t.recorded_by), 'Profissional') end, 'source', 'avaliacao') x
          from public.patient_assessments t where t.person_id = p_person and t.org_id = v_org
        union all
        select jsonb_build_object('id', ca.id, 'kind', 'dor', 'score', ca.pain_scale, 'note', ca.note, 'assessed_at', ca.done_at, 'by_role', 'patient', 'author', 'Paciente', 'source', 'atividade')
          from public.care_activity ca where ca.person_id = p_person and ca.org_id = v_org and ca.pain_scale is not null) u), '[]'::jsonb),
    'reassessments', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'decision', r.decision, 'extra_sessions', r.extra_sessions, 'patient_message', r.patient_message, 'decided_at', r.decided_at,
                                 'author', coalesce((select ua.display_name from public.user_accounts ua where ua.user_id = r.decided_by), 'Profissional'))
                                 || case when p_clinical then jsonb_build_object('clinical_note', r.clinical_note) else '{}'::jsonb end order by r.decided_at desc)
                                from public.patient_reassessments r where r.person_id = p_person and r.org_id = v_org), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'description', v.description, 'assigned_at', v.assigned_at, 'expires_at', v.expires_at, 'revoked_at', v.revoked_at)
                                 || case when p_clinical then jsonb_build_object('views', (select count(*) from public.video_access_log l where l.video_id = v.id and l.accessed_by_role = 'patient')) else '{}'::jsonb end order by v.assigned_at desc)
                          from public.patient_videos v where v.person_id = p_person and v.org_id = v_org and (p_clinical or (v.revoked_at is null and (v.expires_at is null or v.expires_at > now())))), '[]'::jsonb),
    'renewal', (select jsonb_build_object('id', q.id, 'kind', q.kind, 'created_at', q.created_at, 'status', q.status) from public.renewal_requests q where q.person_id = p_person and q.org_id = v_org and q.status = 'open')
  );
end $$;

create or replace function public.my_journey() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid := private.current_person();
begin
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return private.journey_payload(v_person, false);
end $$;
create or replace function public.professional_journey(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_care(p_person);
  return private.journey_payload(p_person, true);
end $$;

-- ---------------------------------------------------------------- privilégios
revoke all on function public.journey_settings_get(), public.journey_settings_set(int, text), public.patient_goal_save(uuid, uuid, text, text, date, text), public.patient_plan_save(uuid, int, uuid, text),
  public.professional_assessment_add(uuid, text, numeric, text, timestamptz), public.patient_reassess(uuid, text, int, text, text), public.patient_video_assign(uuid, text, text, text, text, timestamptz),
  public.patient_video_revoke(uuid), public.my_assessment_add(text, numeric, text), public.my_renewal_request(text, text), public.renewal_request_set_status(uuid, text), public.renewal_requests_open(),
  public.video_playback_authorize(uuid), public.my_journey(), public.professional_journey(uuid) from public, anon;
grant execute on function public.journey_settings_get(), public.journey_settings_set(int, text), public.patient_goal_save(uuid, uuid, text, text, date, text), public.patient_plan_save(uuid, int, uuid, text),
  public.professional_assessment_add(uuid, text, numeric, text, timestamptz), public.patient_reassess(uuid, text, int, text, text), public.patient_video_assign(uuid, text, text, text, text, timestamptz),
  public.patient_video_revoke(uuid), public.my_assessment_add(text, numeric, text), public.my_renewal_request(text, text), public.renewal_request_set_status(uuid, text), public.renewal_requests_open(),
  public.video_playback_authorize(uuid), public.my_journey(), public.professional_journey(uuid) to authenticated;

-- Auxiliares internos: journey_payload devolve dado clínico e require_care é a checagem de vínculo — só as funções públicas (security definer) os chamam.
revoke all on function private.journey_default_sessions(), private.care_unit(uuid), private.require_care(uuid), private.journey_payload(uuid, boolean) from public, anon, authenticated;
