-- HP Group Hub — 099 Portais F4: chamados internos (suporte) para quem já pagou.
-- Regras (plano §4.5): só abre chamado quem tem pagamento confirmado de sessão/pacote/protocolo (derivado dos recebimentos, nada guardado); chamado CLÍNICO só o paciente/representante,
-- o fisio com vínculo e o admin (gestor, com acesso registrado) leem; chamado administrativo é lido pela equipe (adm. operacional, gestor de unidade, gestor). Fila "Suporte Humanizado da HP":
-- 1ª resposta em até 24 h corridas (clínico) ou 24 h úteis (administrativo; sáb/dom não contam). Sem tabela legível direto: tudo por funções.

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade,                     -- o paciente (titular)
  opened_by uuid references auth.users(id) on delete set null, opened_by_person uuid references public.people(id) on delete set null, in_name_of boolean not null default false,
  category text not null check (category in ('agenda','pagamento','clinica','tecnico','outro')), subject text not null check (length(btrim(subject)) between 3 and 160),
  status text not null default 'open' check (status in ('open','in_progress','waiting_patient','resolved')),
  due_at timestamptz not null, first_response_at timestamptz, resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), idem_key text
);
create index support_tickets_person_idx on public.support_tickets (person_id, created_at desc);
create index support_tickets_queue_idx on public.support_tickets (org_id, status, due_at);
create unique index support_tickets_idem_uq on public.support_tickets (opened_by, idem_key) where idem_key is not null;
create table public.support_messages (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_user uuid references auth.users(id) on delete set null, author_role text not null check (author_role in ('patient','staff','professional')),
  body text not null check (length(btrim(body)) between 1 and 4000), internal boolean not null default false,
  created_at timestamptz not null default clock_timestamp(), idem_key text
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
create unique index support_messages_idem_uq on public.support_messages (author_user, idem_key) where idem_key is not null;
alter table public.support_tickets enable row level security; alter table public.support_messages enable row level security;   -- sem GRANT: só por função
create trigger audit_support_tickets after insert or update on public.support_tickets for each row execute function private.audit_row('category','status');

-- ---------------------------------------------------------------- regras derivadas
-- papel ativo em QUALQUER unidade (a fila e os indicadores filtram depois, linha a linha, pela unidade do chamado)
create or replace function private.has_role_any(p_roles public.app_role[]) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.role_assignments ra join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
    where ra.user_id = (select auth.uid()) and ra.role = any (p_roles) and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()))
$$;
-- pagamento confirmado líquido (pagamentos − estornos) de sessão, pacote ou plano; curso/mentoria não contam
create or replace function private.has_paid(p_person uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end) from public.payments p
    join public.receivables r on r.id = p.receivable_id left join public.products pr on pr.id = r.product_id
   where r.person_id = p_person and r.org_id = private.current_org() and (pr.id is null or pr.kind in ('service','package','plan'))), 0) > 0
$$;
-- prazo da 1ª resposta: clínico = 24 h corridas; administrativo = 24 h úteis (o prazo que cair no sábado/domingo passa para segunda, no fuso de São Paulo)
create or replace function private.sla_due(p_from timestamptz, p_clinical boolean) returns timestamptz language plpgsql immutable set search_path = '' as $$
declare d timestamptz := p_from + interval '24 hours';
begin
  if p_clinical then return d; end if;
  while extract(isodow from (d at time zone 'America/Sao_Paulo')) in (6, 7) loop d := d + interval '1 day'; end loop;
  return d;
end $$;
create or replace function private.sla_state(t public.support_tickets) returns text language sql stable set search_path = '' as $$
  select case
    when t.first_response_at is not null then case when t.first_response_at <= t.due_at then 'met' else 'late' end
    when now() > t.due_at then 'breached'
    when now() > t.due_at - (t.due_at - t.created_at) * 0.25 then 'warning'
    else 'ok' end
$$;
-- quem lê o conteúdo: clínico = gestor ou fisio com vínculo; demais = gestor, adm. operacional e gestor da unidade
create or replace function private.ticket_can_read(t public.support_tickets) returns boolean language sql stable security definer set search_path = '' as $$
  select t.org_id = private.current_org() and case
    when t.category = 'clinica' then private.has_org_role(array['manager']::public.app_role[]) or private.has_care_relationship(t.person_id)
    else private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], t.unit_id) end
$$;
-- quem enxerga que o chamado existe (clínico: a fila vê só os dados administrativos, sem assunto nem mensagens)
create or replace function private.ticket_in_queue(t public.support_tickets) returns boolean language sql stable security definer set search_path = '' as $$
  select t.org_id = private.current_org() and (private.ticket_can_read(t) or private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], t.unit_id))
$$;
create or replace function private.ticket_row(t public.support_tickets, p_full boolean) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'person_id', t.person_id, 'patient', (select pe.full_name from public.people pe where pe.id = t.person_id), 'category', t.category,
    'subject', case when t.category = 'clinica' and not private.ticket_can_read(t) then 'Chamado clínico — encaminhado ao fisioterapeuta' else t.subject end,
    'masked', t.category = 'clinica' and not private.ticket_can_read(t), 'status', t.status, 'created_at', t.created_at, 'due_at', t.due_at, 'first_response_at', t.first_response_at, 'resolved_at', t.resolved_at,
    'sla', private.sla_state(t), 'in_name_of', t.in_name_of,
    'escalated', t.category = 'clinica' and t.first_response_at is null and t.status <> 'resolved' and t.created_at < now() - interval '12 hours')
$$;

-- ---------------------------------------------------------------- paciente / representante
create or replace function public.my_ticket_eligibility() returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid;
begin perform private.require_scope('ticket'); v_pat := private.current_person(); if v_pat is null then raise exception 'sem permissão' using errcode = '42501'; end if; return private.has_paid(v_pat); end $$;

create or replace function public.my_ticket_open(p_category text, p_subject text, p_body text, p_key text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pat uuid; v_unit uuid; v_id uuid; v_acting boolean; v_cat text := p_category; v_due timestamptz;
begin
  perform private.require_scope('ticket'); v_pat := private.current_person();
  if v_pat is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_cat not in ('agenda','pagamento','clinica','tecnico','outro') then raise exception 'categoria inválida'; end if;
  if length(btrim(coalesce(p_subject, ''))) < 3 or length(btrim(coalesce(p_body, ''))) < 3 then raise exception 'descreva o assunto e a mensagem'; end if;
  if p_key is not null then select id into v_id from public.support_tickets where opened_by = (select auth.uid()) and idem_key = p_key; if v_id is not null then return v_id; end if; end if;
  if not private.has_paid(v_pat) then raise exception 'os chamados são para quem já tem um pagamento confirmado de sessão, pacote ou protocolo; fale com a recepção'; end if;
  if (select count(*) from public.support_tickets where person_id = v_pat and status <> 'resolved') >= 5 then raise exception 'há muitos chamados abertos: aguarde a resposta ou encerre algum'; end if;
  select unit_id into v_unit from public.people where id = v_pat and org_id = private.current_org();
  if v_unit is null then raise exception 'cadastro sem unidade: fale com a recepção'; end if;
  v_acting := (private.acting_rep()).id is not null; v_due := private.sla_due(clock_timestamp(), v_cat = 'clinica');
  insert into public.support_tickets (org_id, unit_id, person_id, opened_by, opened_by_person, in_name_of, category, subject, due_at, idem_key)
    values (private.current_org(), v_unit, v_pat, (select auth.uid()), private.real_person(), v_acting, v_cat, btrim(p_subject), v_due, p_key) returning id into v_id;
  insert into public.support_messages (org_id, ticket_id, author_user, author_role, body) values (private.current_org(), v_id, (select auth.uid()), 'patient', btrim(p_body));
  if v_cat <> 'clinica' then   -- administrativo gera tarefa para o responsável (o clínico NÃO vai para o CRM)
    insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (private.current_org(), v_unit, v_pat, private.pick_owner(private.current_org(), v_unit), 'follow_up', 'Chamado de paciente (' || v_cat || ') — responder em até 24 h úteis', 'ticket:' || v_id) on conflict do nothing;
  end if;
  return v_id;
end $$;

create or replace function public.my_tickets() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid;
begin
  perform private.require_scope('ticket'); v_pat := private.current_person();
  if v_pat is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'category', t.category, 'subject', t.subject, 'status', t.status, 'created_at', t.created_at, 'due_at', t.due_at, 'resolved_at', t.resolved_at,
      'last_at', (select max(m.created_at) from public.support_messages m where m.ticket_id = t.id and not m.internal)) order by t.created_at desc)
    from public.support_tickets t where t.person_id = v_pat and t.org_id = private.current_org()), '[]'::jsonb);
end $$;
create or replace function public.my_ticket(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid; t public.support_tickets;
begin
  perform private.require_scope('ticket'); v_pat := private.current_person();
  select * into t from public.support_tickets where id = p_id and person_id = v_pat and org_id = private.current_org();
  if t.id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object('id', t.id, 'category', t.category, 'subject', t.subject, 'status', t.status, 'created_at', t.created_at, 'due_at', t.due_at,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.author_role, 'body', m.body, 'at', m.created_at, 'who', case m.author_role when 'patient' then 'Você' else coalesce((select nullif(btrim(ua.display_name), '') from public.user_accounts ua where ua.user_id = m.author_user), 'Equipe HP') end) order by m.created_at)
       from public.support_messages m where m.ticket_id = t.id and not m.internal), '[]'::jsonb));
end $$;
create or replace function public.my_ticket_reply(p_id uuid, p_body text, p_key text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pat uuid; t public.support_tickets; v_id uuid;
begin
  perform private.require_scope('ticket'); v_pat := private.current_person();
  select * into t from public.support_tickets where id = p_id and person_id = v_pat and org_id = private.current_org() for update;
  if t.id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'escreva a mensagem'; end if;
  if p_key is not null then select id into v_id from public.support_messages where author_user = (select auth.uid()) and idem_key = p_key; if v_id is not null then return v_id; end if; end if;
  if t.status = 'resolved' and t.resolved_at < now() - interval '7 days' then raise exception 'este chamado foi encerrado há mais de 7 dias: abra um novo chamado'; end if;
  if (select count(*) from public.support_messages where ticket_id = p_id and author_role = 'patient' and created_at > now() - interval '1 day') >= 20 then raise exception 'limite de mensagens por dia neste chamado'; end if;
  insert into public.support_messages (org_id, ticket_id, author_user, author_role, body, idem_key) values (t.org_id, p_id, (select auth.uid()), 'patient', btrim(p_body), p_key) returning id into v_id;
  update public.support_tickets set status = case when status in ('resolved','waiting_patient') then 'in_progress' else status end, resolved_at = null, updated_at = clock_timestamp() where id = p_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- equipe, fisio e gestor
create or replace function public.support_queue(p_status text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_org() is null or not private.has_role_any(array['manager','ops_admin','unit_manager','physio']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(private.ticket_row(t, false) order by (t.status = 'resolved'), t.due_at)
    from (select * from public.support_tickets x where x.org_id = private.current_org() and (p_status is null or x.status = p_status) order by x.created_at desc limit 300) t
    where private.ticket_in_queue(t)), '[]'::jsonb);
end $$;
create or replace function public.support_ticket(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_id and org_id = private.current_org();
  if t.id is null or not private.ticket_in_queue(t) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.ticket_can_read(t) then return private.ticket_row(t, false) || jsonb_build_object('messages', '[]'::jsonb); end if;
  if t.category = 'clinica' then perform private.log_clinical_access(t.person_id, case when private.has_org_role(array['manager']::public.app_role[]) then 'admin' else 'professional' end, 'ticket'); end if;
  return private.ticket_row(t, true) || jsonb_build_object('messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.author_role, 'body', m.body, 'internal', m.internal, 'at', m.created_at,
      'who', case m.author_role when 'patient' then (select pe.full_name from public.people pe where pe.id = t.person_id) else coalesce((select nullif(btrim(ua.display_name), '') from public.user_accounts ua where ua.user_id = m.author_user), 'Equipe HP') end) order by m.created_at)
      from public.support_messages m where m.ticket_id = t.id), '[]'::jsonb));
end $$;
create or replace function public.support_reply(p_id uuid, p_body text, p_internal boolean default false, p_key text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets; v_id uuid; v_role text;
begin
  select * into t from public.support_tickets where id = p_id and org_id = private.current_org() for update;
  if t.id is null or not private.ticket_can_read(t) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'escreva a mensagem'; end if;
  if p_key is not null then select id into v_id from public.support_messages where author_user = (select auth.uid()) and idem_key = p_key; if v_id is not null then return v_id; end if; end if;
  v_role := case when t.category = 'clinica' and private.has_care_relationship(t.person_id) then 'professional' else 'staff' end;
  insert into public.support_messages (org_id, ticket_id, author_user, author_role, body, internal, idem_key) values (t.org_id, p_id, (select auth.uid()), v_role, btrim(p_body), coalesce(p_internal, false), p_key) returning id into v_id;
  if not coalesce(p_internal, false) then
    update public.support_tickets set first_response_at = coalesce(first_response_at, clock_timestamp()), status = case when status in ('open','in_progress') then 'waiting_patient' else status end, updated_at = clock_timestamp() where id = p_id;
  end if;
  return v_id;
end $$;
create or replace function public.support_set_status(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_id and org_id = private.current_org() for update;
  if t.id is null or not private.ticket_can_read(t) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_status not in ('in_progress','waiting_patient','resolved') then raise exception 'situação inválida'; end if;
  update public.support_tickets set status = p_status, resolved_at = case when p_status = 'resolved' then clock_timestamp() end, updated_at = clock_timestamp() where id = p_id;
end $$;
-- reclassificar (por exemplo, o paciente marcou "clínica" para uma dúvida de horário). Só quem LÊ o chamado reclassifica.
create or replace function public.support_reclassify(p_id uuid, p_category text) returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_id and org_id = private.current_org() for update;
  if t.id is null or not private.ticket_can_read(t) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_category not in ('agenda','pagamento','clinica','tecnico','outro') then raise exception 'categoria inválida'; end if;
  update public.support_tickets set category = p_category, updated_at = clock_timestamp() where id = p_id;
end $$;
create or replace function public.support_kpis(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := coalesce(p_from, current_date - 30); v_to timestamptz := coalesce(p_to, current_date) + interval '1 day';
begin
  if not private.has_role_any(array['manager','ops_admin','unit_manager']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return (select jsonb_build_object('total', count(*), 'open', count(*) filter (where t.status <> 'resolved'), 'breached', count(*) filter (where private.sla_state(t) = 'breached'),
      'responded', count(*) filter (where t.first_response_at is not null), 'within_sla', count(*) filter (where t.first_response_at is not null and t.first_response_at <= t.due_at),
      'avg_first_response_h', round((avg(extract(epoch from t.first_response_at - t.created_at) / 3600) filter (where t.first_response_at is not null))::numeric, 1),
      'avg_resolution_h', round((avg(extract(epoch from t.resolved_at - t.created_at) / 3600) filter (where t.resolved_at is not null))::numeric, 1),
      'by_category', coalesce((select jsonb_object_agg(c.category, c.n) from (select x.category, count(*) n from public.support_tickets x where x.org_id = private.current_org() and x.created_at >= v_from and x.created_at < v_to
          and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], x.unit_id) group by x.category) c), '{}'::jsonb))
    from public.support_tickets t where t.org_id = private.current_org() and t.created_at >= v_from and t.created_at < v_to and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], t.unit_id));
end $$;

-- Início do fisio passa a mostrar chamados clínicos sem resposta (só de pacientes com vínculo)
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

revoke all on function public.my_ticket_eligibility(), public.my_ticket_open(text, text, text, text), public.my_tickets(), public.my_ticket(uuid), public.my_ticket_reply(uuid, text, text), public.support_queue(text),
  public.support_ticket(uuid), public.support_reply(uuid, text, boolean, text), public.support_set_status(uuid, text), public.support_reclassify(uuid, text), public.support_kpis(date, date), public.prof_home() from public, anon;
grant execute on function public.my_ticket_eligibility(), public.my_ticket_open(text, text, text, text), public.my_tickets(), public.my_ticket(uuid), public.my_ticket_reply(uuid, text, text), public.support_queue(text),
  public.support_ticket(uuid), public.support_reply(uuid, text, boolean, text), public.support_set_status(uuid, text), public.support_reclassify(uuid, text), public.support_kpis(date, date), public.prof_home() to authenticated;
revoke all on function private.has_role_any(public.app_role[]), private.has_paid(uuid), private.sla_due(timestamptz, boolean), private.sla_state(public.support_tickets), private.ticket_can_read(public.support_tickets), private.ticket_in_queue(public.support_tickets),
  private.ticket_row(public.support_tickets, boolean) from public, anon, authenticated;
