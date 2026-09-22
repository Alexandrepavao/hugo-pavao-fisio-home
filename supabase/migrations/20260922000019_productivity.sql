-- HP Group Hub — 019 Produtividade pessoal (Meu dia / foco), integrada à agenda clínica e ao CRM já existentes
-- Não é uma segunda fonte de compromissos: "Meu dia" combina esta tabela com appointments e crm_tasks por leitura,
-- e permite ligar uma tarefa pessoal a uma oportunidade/pessoa existente (never duplica o registro de origem).
-- Referência de padrão de UX: FocusSphere (tabela "tasks", Eisenhower, timeline diária) — não importa diário
-- emocional nem prontuário de pacientes (fora de escopo). Ver docs/reference-audit.md.

create table public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,       -- só para o filtro de "equipe"; não restringe o dono
  title text not null check (length(btrim(title)) between 1 and 200),
  notes text,
  task_date date not null default current_date,
  end_date date,                                                     -- tarefa/rotina de vários dias
  start_time time,
  duration_minutes int check (duration_minutes between 5 and 480),
  category text not null default 'trabalho' check (category in ('trabalho','pessoal','estudo')),
  urgency text not null default 'nao_urgente' check (urgency in ('urgente','nao_urgente')),
  importance text not null default 'importante' check (importance in ('importante','nao_importante')),
  visibility text not null default 'private' check (visibility in ('private','team')),  -- privado por padrão; visível à equipe só se marcado
  completed_at timestamptz,
  -- vínculo explícito com o que já existe (nunca um novo compromisso paralelo)
  opportunity_id uuid references public.opportunities(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  crm_task_id uuid references public.crm_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= task_date)
);
create index staff_tasks_owner_date_idx on public.staff_tasks (owner_user_id, task_date);
create index staff_tasks_unit_team_idx on public.staff_tasks (unit_id, task_date) where visibility = 'team';
create trigger staff_tasks_touch before update on public.staff_tasks for each row execute function private.touch_updated_at();

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.staff_tasks(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_minutes int not null default 25 check (planned_minutes between 1 and 180)
);
create unique index focus_sessions_one_open_uq on public.focus_sessions (owner_user_id) where ended_at is null;  -- uma sessão de foco ativa por vez

-- ---------------------------------------------------------------- permissões
alter table public.staff_tasks enable row level security;
alter table public.focus_sessions enable row level security;

grant select, insert, update, delete on public.staff_tasks to authenticated;
grant select, insert, update on public.focus_sessions to authenticated;

-- Dono sempre lê/edita as próprias. Tarefas "team" ficam visíveis a quem tem papel de equipe na mesma unidade — nunca automático para todo conteúdo privado.
create policy staff_tasks_read on public.staff_tasks for select to authenticated
  using (owner_user_id = (select auth.uid()) or (visibility = 'team' and private.has_unit_role(array['manager','ops_admin','unit_manager','sales','finance','physio','teacher']::public.app_role[], unit_id)));
create policy staff_tasks_insert on public.staff_tasks for insert to authenticated
  with check (org_id = private.current_org() and owner_user_id = (select auth.uid()));
create policy staff_tasks_update on public.staff_tasks for update to authenticated
  using (owner_user_id = (select auth.uid())) with check (org_id = private.current_org() and owner_user_id = (select auth.uid()));
create policy staff_tasks_delete on public.staff_tasks for delete to authenticated using (owner_user_id = (select auth.uid()));

create policy focus_read on public.focus_sessions for select to authenticated using (owner_user_id = (select auth.uid()));
create policy focus_insert on public.focus_sessions for insert to authenticated with check (org_id = private.current_org() and owner_user_id = (select auth.uid()));
create policy focus_update on public.focus_sessions for update to authenticated using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));

create trigger audit_staff_tasks after insert or update or delete on public.staff_tasks for each row execute function private.audit_row('title','visibility','completed_at');

-- ---------------------------------------------------------------- "Meu dia": combina, sem duplicar, o que já existe
-- Tarefas pessoais do dia + tarefas de CRM atribuídas ao usuário + atendimentos em que ele é o profissional.
create or replace function public.my_day(p_date date default current_date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_prof uuid;
begin
  select id into v_prof from public.professionals where user_id = v_uid;
  return jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'start_time', t.start_time, 'duration_minutes', t.duration_minutes,
        'category', t.category, 'urgency', t.urgency, 'importance', t.importance, 'completed', t.completed_at is not null,
        'person', p.full_name, 'opportunity_title', o.title) order by t.start_time nulls last, t.created_at)
      from public.staff_tasks t left join public.people p on p.id = t.person_id left join public.opportunities o on o.id = t.opportunity_id
      where t.owner_user_id = v_uid and t.task_date <= p_date and coalesce(t.end_date, t.task_date) >= p_date), '[]'),
    'crm_tasks', coalesce((select jsonb_agg(jsonb_build_object('id', ct.id, 'title', ct.title, 'due_at', ct.due_at, 'kind', ct.kind, 'person', p.full_name) order by ct.due_at)
      from public.crm_tasks ct left join public.people p on p.id = ct.person_id
      where ct.assignee_user_id = v_uid and ct.done_at is null and ct.due_at::date <= p_date), '[]'),
    'appointments', case when v_prof is null then '[]' else coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', lower(a.period), 'ends_at', upper(a.period), 'status', a.status, 'person', p.full_name, 'service', s.name) order by lower(a.period))
      from public.appointments a join public.people p on p.id = a.person_id join public.services s on s.id = a.service_id
      where a.professional_id = v_prof and a.status in ('scheduled','confirmed','attended') and lower(a.period)::date = p_date), '[]') end
  );
end $$;

create or replace function public.team_day(p_date date default current_date, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_units uuid[] := private.dash_units(p_unit);  -- reaproveita a mesma verificação de escopo do dashboard
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'owner', coalesce(ua.display_name, ua.email::text), 'start_time', t.start_time, 'category', t.category) order by t.start_time nulls last)
    from public.staff_tasks t join public.user_accounts ua on ua.user_id = t.owner_user_id
    where t.visibility = 'team' and t.unit_id = any (v_units) and t.task_date <= p_date and coalesce(t.end_date, t.task_date) >= p_date), '[]');
end $$;

create or replace function public.staff_task_toggle(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.staff_tasks set completed_at = case when completed_at is null then now() else null end
   where id = p_id and owner_user_id = (select auth.uid());
end $$;

create or replace function public.focus_start(p_task uuid default null, p_minutes int default 25) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.focus_sessions set ended_at = now() where owner_user_id = (select auth.uid()) and ended_at is null;  -- encerra sessão esquecida
  insert into public.focus_sessions (org_id, owner_user_id, task_id, planned_minutes) values (private.current_org(), (select auth.uid()), p_task, coalesce(p_minutes, 25)) returning id into v_id;
  return v_id;
end $$;
create or replace function public.focus_stop(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.focus_sessions set ended_at = now() where id = p_id and owner_user_id = (select auth.uid()) and ended_at is null;
end $$;

grant execute on function public.my_day(date), public.team_day(date, uuid), public.staff_task_toggle(uuid), public.focus_start(uuid, int), public.focus_stop(uuid) to authenticated;
