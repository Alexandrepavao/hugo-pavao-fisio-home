-- HP Group Hub — 004 Catálogo, CRM e infraestrutura de eventos/automações

-- Privilégios padrão: novas tabelas/funções em public NÃO são acessíveis a anon/authenticated sem GRANT explícito.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ------------------------------------------------------------------ helpers
create or replace function private.in_org(p_org uuid) returns boolean
language sql stable set search_path = '' as $$ select p_org is not null and p_org = private.current_org() $$;

-- ------------------------------------------------------------------ catálogo
create type public.product_kind as enum ('service','course','mentoring','package','plan');

create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(btrim(name)) > 1),
  duration_min int not null default 50 check (duration_min between 5 and 480),
  price_cents bigint not null default 0 check (price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);
create trigger services_touch before update on public.services for each row execute function private.touch_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  kind public.product_kind not null,
  name text not null check (length(btrim(name)) > 1),
  description text,
  price_cents bigint not null default 0 check (price_cents >= 0),
  recurrence text check (recurrence in ('monthly')),          -- produtos mensais entram no forecast
  sessions_count int check (sessions_count > 0),               -- pacotes
  validity_days int check (validity_days > 0),
  consume_on_no_show boolean not null default true,            -- regra explícita de consumo em falta
  late_cancel_hours int not null default 24 check (late_cancel_hours >= 0),  -- cancelamento tardio consome sessão
  service_id uuid references public.services(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id),
  check (kind <> 'package' or (sessions_count is not null and service_id is not null))
);
create trigger products_touch before update on public.products for each row execute function private.touch_updated_at();

-- ------------------------------------------------------------------ CRM
create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  name text not null,
  kind text not null default 'custom' check (kind in ('patients','education','partners','companies','custom')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  position int not null,
  kind text not null default 'open' check (kind in ('open','won','lost')),
  unique (pipeline_id, name)
);
create index pipeline_stages_pipe_idx on public.pipeline_stages (pipeline_id, position);
create table public.loss_reasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique (org_id, name)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  pipeline_id uuid not null references public.pipelines(id) on delete restrict,
  stage_id uuid not null references public.pipeline_stages(id) on delete restrict,
  owner_user_id uuid references auth.users(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  title text not null,
  value_cents bigint not null default 0 check (value_cents >= 0),
  status text not null default 'open' check (status in ('open','won','lost')),
  lost_reason_id uuid references public.loss_reasons(id) on delete set null,
  lost_note text,
  source text,
  campaign text,
  utm jsonb,
  page_id uuid,                       -- FK adicionada na migration de páginas
  next_contact_at timestamptz,
  last_contact_at timestamptz,
  first_response_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check (status <> 'lost' or lost_reason_id is not null)
);
create index opp_org_pipe_stage_idx on public.opportunities (org_id, pipeline_id, stage_id);
create index opp_person_idx on public.opportunities (person_id);
create index opp_owner_idx on public.opportunities (owner_user_id) where status = 'open';
create index opp_next_contact_idx on public.opportunities (next_contact_at) where status = 'open';
create trigger opportunities_touch before update on public.opportunities for each row execute function private.touch_updated_at();

create table public.opportunity_events (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  kind text not null,                 -- created | stage_changed | owner_changed | status_changed
  from_stage_id uuid, to_stage_id uuid,
  actor_user_id uuid,
  data jsonb,
  created_at timestamptz not null default now()
);
create index opp_events_idx on public.opportunity_events (opportunity_id, created_at desc);

alter table public.interactions add column opportunity_id uuid references public.opportunities(id) on delete cascade;
create index interactions_opp_idx on public.interactions (opportunity_id, created_at desc);

create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  assignee_user_id uuid references auth.users(id) on delete set null,
  kind text not null default 'follow_up' check (kind in ('follow_up','reminder','first_contact','no_show','package_end','dedupe_review','payment','other')),
  title text not null,
  due_at timestamptz not null default now(),
  done_at timestamptz,
  dedupe_key text,                     -- idempotência de tarefas automáticas
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index crm_tasks_dedupe_uq on public.crm_tasks (org_id, dedupe_key) where dedupe_key is not null;
create index crm_tasks_assignee_idx on public.crm_tasks (assignee_user_id, due_at) where done_at is null;

-- pick_owner: distribuição por menor carga de oportunidades abertas entre comerciais ativos da unidade
create or replace function private.pick_owner(p_org uuid, p_unit uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select ra.user_id
  from public.role_assignments ra
  join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active' and ua.org_id = p_org
  where ra.role = 'sales' and ra.revoked_at is null and ra.valid_from <= now()
    and (ra.valid_until is null or ra.valid_until > now())
    and (ra.unit_id is null or ra.unit_id = p_unit)
  group by ra.user_id
  order by (select count(*) from public.opportunities o where o.owner_user_id = ra.user_id and o.status = 'open'), ra.user_id
  limit 1
$$;

-- regras de status/fechamento e trilha de movimentações
create or replace function private.opportunity_before() returns trigger
language plpgsql set search_path = '' as $$
declare v_kind text; v_pipe uuid;
begin
  select kind, pipeline_id into v_kind, v_pipe from public.pipeline_stages where id = new.stage_id;
  if v_pipe is distinct from new.pipeline_id then raise exception 'etapa não pertence ao funil'; end if;
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.status := case v_kind when 'won' then 'won' when 'lost' then 'lost' else 'open' end;
  end if;
  if new.status = 'lost' and new.lost_reason_id is null then raise exception 'informe o motivo da perda'; end if;
  if new.status = 'open' then new.closed_at := null; new.lost_reason_id := null;
  elsif new.closed_at is null then new.closed_at := now(); end if;
  return new;
end $$;
create trigger opportunities_before before insert or update on public.opportunities
  for each row execute function private.opportunity_before();

create or replace function private.opportunity_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.opportunity_events (org_id, opportunity_id, kind, to_stage_id, actor_user_id)
      values (new.org_id, new.id, 'created', new.stage_id, (select auth.uid()));
  else
    if new.stage_id is distinct from old.stage_id then
      insert into public.opportunity_events (org_id, opportunity_id, kind, from_stage_id, to_stage_id, actor_user_id, data)
        values (new.org_id, new.id, 'stage_changed', old.stage_id, new.stage_id, (select auth.uid()),
                jsonb_build_object('status', new.status, 'lost_reason_id', new.lost_reason_id));
    end if;
    if new.owner_user_id is distinct from old.owner_user_id then
      insert into public.opportunity_events (org_id, opportunity_id, kind, actor_user_id, data)
        values (new.org_id, new.id, 'owner_changed', (select auth.uid()),
                jsonb_build_object('from', old.owner_user_id, 'to', new.owner_user_id));
    end if;
  end if;
  return null;
end $$;
create trigger opportunities_after after insert or update on public.opportunities
  for each row execute function private.opportunity_after();

-- primeira resposta e último contato a partir do histórico (interações não-sistema)
create or replace function private.interaction_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.opportunity_id is not null and new.channel <> 'system' then
    update public.opportunities
       set last_contact_at = new.created_at, first_response_at = coalesce(first_response_at, new.created_at)
     where id = new.opportunity_id;
  end if;
  return null;
end $$;
create trigger interactions_after after insert on public.interactions
  for each row execute function private.interaction_after();

-- criar oportunidade (distribui responsável quando não informado); SECURITY INVOKER: RLS se aplica
create or replace function public.crm_create_opportunity(
  p_person_id uuid, p_pipeline_id uuid, p_unit_id uuid, p_title text,
  p_product_id uuid default null, p_value_cents bigint default 0, p_owner uuid default null,
  p_source text default null, p_campaign text default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid := private.current_org(); v_stage uuid; v_id uuid; v_owner uuid;
begin
  if v_org is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  select id into v_stage from public.pipeline_stages where pipeline_id = p_pipeline_id and kind = 'open' order by position limit 1;
  if v_stage is null then raise exception 'funil sem etapas'; end if;
  v_owner := coalesce(p_owner, private.pick_owner(v_org, p_unit_id), (select auth.uid()));
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, product_id, title, value_cents, source, campaign, created_by)
  values (v_org, p_unit_id, p_person_id, p_pipeline_id, v_stage, v_owner, p_product_id, p_title, coalesce(p_value_cents, 0), p_source, p_campaign, (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------------ eventos e automações
create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null default '{}',
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending','processed','failed','dead')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (org_id, idempotency_key)
);
create index domain_events_status_idx on public.domain_events (status, created_at) where status in ('pending','failed');

create table public.automation_runs (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.domain_events(id) on delete cascade,
  handler text not null,
  status text not null check (status in ('ok','error')),
  error text,
  ran_at timestamptz not null default now(),
  unique (event_id, handler)
);

-- registro de handlers: cada módulo registra suas funções private.<handler>(event_id uuid)
create table private.event_handlers (event_type text not null, handler text not null, primary key (event_type, handler));

create or replace function private.dispatch_event(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ev public.domain_events; h record; v_failed boolean := false;
begin
  select * into ev from public.domain_events where id = p_event for update;
  if not found or ev.status in ('processed','dead') then return; end if;
  for h in select handler from private.event_handlers where event_type = ev.type loop
    if exists (select 1 from public.automation_runs r where r.event_id = ev.id and r.handler = h.handler and r.status = 'ok') then continue; end if;
    begin
      execute format('select private.%I($1)', h.handler) using ev.id;
      insert into public.automation_runs (event_id, handler, status) values (ev.id, h.handler, 'ok')
        on conflict (event_id, handler) do update set status = 'ok', error = null, ran_at = now();
    exception when others then
      v_failed := true;
      insert into public.automation_runs (event_id, handler, status, error) values (ev.id, h.handler, 'error', sqlerrm)
        on conflict (event_id, handler) do update set status = 'error', error = excluded.error, ran_at = now();
    end;
  end loop;
  update public.domain_events
     set attempts = attempts + 1,
         status = case when not v_failed then 'processed' when attempts + 1 >= 5 then 'dead' else 'failed' end,
         processed_at = case when not v_failed then now() end,
         last_error = case when v_failed then 'ver automation_runs' end
   where id = ev.id;
end $$;

-- emissão idempotente: mesma chave = mesmo evento (não reprocessa). Retorna o id do evento (novo ou existente).
create or replace function private.emit_event(p_org uuid, p_type text, p_agg_type text, p_agg_id uuid, p_payload jsonb, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.domain_events (org_id, type, aggregate_type, aggregate_id, payload, idempotency_key)
    values (p_org, p_type, p_agg_type, p_agg_id, coalesce(p_payload, '{}'), p_key)
    on conflict (org_id, idempotency_key) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.domain_events where org_id = p_org and idempotency_key = p_key;
    return v_id;                     -- já existia: não redespacha
  end if;
  perform private.dispatch_event(v_id);
  return v_id;
end $$;

-- retentativa controlada (chamada por agendador ou manualmente pelo gestor)
create or replace function public.retry_failed_events() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not private.is_manager() then raise exception 'apenas gestor' using errcode = '42501'; end if;
  for r in select id from public.domain_events where status in ('pending','failed') and org_id = private.current_org() order by created_at limit 100 loop
    perform private.dispatch_event(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------ modelos iniciais de funil
create or replace function private.seed_default_pipelines(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pipe uuid; t record; s text; i int;
begin
  for t in select * from (values
    ('Pacientes','patients', array['Novo contato','Atendimento','Avaliação agendada','Compareceu','Proposta','Contratou'], 'Contratou', null),
    ('Mentorias e cursos','education', array['Interesse','Qualificação','Reunião','Proposta','Pagamento','Acesso liberado'], 'Acesso liberado', null),
    ('Parceiros','partners', array['Inscrição','Análise','Conversa','Aprovação','Integração','Ativo'], 'Ativo', null),
    ('Empresas','companies', array['Prospecção','Reunião','Diagnóstico','Proposta','Contrato','Implantação'], 'Implantação', null)
  ) as x(name, kind, stages, won, u) loop
    insert into public.pipelines (org_id, name, kind) values (p_org, t.name, t.kind)
      on conflict (org_id, name) do nothing returning id into v_pipe;
    if v_pipe is not null then
      i := 0;
      foreach s in array t.stages loop
        i := i + 1;
        insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind)
          values (p_org, v_pipe, s, i, case when s = t.won then 'won' else 'open' end);
      end loop;
      insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (p_org, v_pipe, 'Perdido', i + 1, 'lost');
    end if;
    v_pipe := null;
  end loop;
  insert into public.loss_reasons (org_id, name)
    select p_org, r from unnest(array['Sem resposta','Preço','Escolheu concorrente','Sem interesse no momento','Fora da região de atendimento','Outro']) r
    on conflict do nothing;
end $$;
select private.seed_default_pipelines(id) from public.organizations where slug = 'hp-group';

-- ------------------------------------------------------------------ RLS
alter table public.services enable row level security;
alter table public.products enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.loss_reasons enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_events enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.domain_events enable row level security;
alter table public.automation_runs enable row level security;

grant select, insert, update on public.services, public.products, public.pipelines, public.pipeline_stages, public.loss_reasons to authenticated;
grant select, insert, update on public.opportunities, public.crm_tasks to authenticated;
grant select on public.opportunity_events, public.domain_events, public.automation_runs to authenticated;

create policy services_read on public.services for select to authenticated using (private.in_org(org_id) and private.is_staff());
create policy services_write on public.services for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy services_update on public.services for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[])) with check (private.in_org(org_id));
create policy products_read on public.products for select to authenticated using (private.in_org(org_id) and private.is_staff());
create policy products_write on public.products for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy products_update on public.products for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[])) with check (private.in_org(org_id));

create policy pipelines_read on public.pipelines for select to authenticated using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]));
create policy pipelines_write on public.pipelines for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy pipelines_update on public.pipelines for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[])) with check (private.in_org(org_id));
create policy stages_read on public.pipeline_stages for select to authenticated using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]));
create policy stages_write on public.pipeline_stages for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy stages_update on public.pipeline_stages for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[])) with check (private.in_org(org_id));
create policy loss_read on public.loss_reasons for select to authenticated using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]));
create policy loss_write on public.loss_reasons for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy loss_update on public.loss_reasons for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[])) with check (private.in_org(org_id));

create policy opp_read on public.opportunities for select to authenticated
  using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));
create policy opp_insert on public.opportunities for insert to authenticated
  with check (private.in_org(org_id) and created_by = (select auth.uid()) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));
create policy opp_update on public.opportunities for update to authenticated
  using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id))
  with check (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));
create policy opp_events_read on public.opportunity_events for select to authenticated
  using (exists (select 1 from public.opportunities o where o.id = opportunity_id));

create policy tasks_read on public.crm_tasks for select to authenticated
  using (private.in_org(org_id) and (assignee_user_id = (select auth.uid()) or private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id)));
create policy tasks_insert on public.crm_tasks for insert to authenticated
  with check (private.in_org(org_id) and created_by = (select auth.uid()) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));
create policy tasks_update on public.crm_tasks for update to authenticated
  using (private.in_org(org_id) and (assignee_user_id = (select auth.uid()) or private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id)))
  with check (private.in_org(org_id));

create policy events_read on public.domain_events for select to authenticated using (private.in_org(org_id) and private.is_manager());
create policy runs_read on public.automation_runs for select to authenticated
  using (exists (select 1 from public.domain_events e where e.id = event_id and private.in_org(e.org_id) and private.is_manager()));

-- interações passam a poder ser lidas também por quem acessa a oportunidade (mesma regra de pessoa já cobre o essencial)
create trigger audit_opportunities after insert or update or delete on public.opportunities
  for each row execute function private.audit_row('status','stage_id','owner_user_id','value_cents','lost_reason_id');
create trigger audit_products after insert or update or delete on public.products
  for each row execute function private.audit_row('name','price_cents','active','kind');

revoke all on function public.crm_create_opportunity(uuid, uuid, uuid, text, uuid, bigint, uuid, text, text) from public, anon;
grant execute on function public.crm_create_opportunity(uuid, uuid, uuid, text, uuid, bigint, uuid, text, text) to authenticated;
revoke all on function public.retry_failed_events() from public, anon;
grant execute on function public.retry_failed_events() to authenticated;
