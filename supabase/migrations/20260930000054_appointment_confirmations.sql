-- HP Group Hub — 054 Release v1: confirmação antecipada independente (paciente e profissional) e falta do profissional.
--
-- Três coisas DISTINTAS, que antes se misturavam no campo `status`:
--   1) CONFIRMAÇÃO ANTECIPADA  — "eu vou / eu atendo". Duas confirmações independentes, cada uma só por quem é parte do atendimento
--      (paciente pelo portal; profissional pelo próprio acesso). Não altera `status`, não consome sessão, não prova presença.
--   2) PRESENÇA EFETIVA        — `status`: attended (compareceu) | no_show (paciente faltou) | professional_no_show (profissional faltou).
--      Só depois do horário de início. Falta do paciente NUNCA vira atendimento realizado.
--   3) CONSUMO DE SESSÃO       — `session_ledger`, decidido só pelos handlers de evento conforme a política do produto
--      (consume_on_no_show / late_cancel_hours). Falta do profissional nunca consome (e devolve se já havia consumido por engano).
-- Confirmar NÃO é pré-requisito de atendimento nem de consumo: paciente que não confirmou e compareceu é atendido normalmente.

-- ---------------------------------------------------------------- colunas de confirmação
alter table public.appointments
  add column patient_confirmed_at timestamptz,
  add column patient_confirmed_by uuid references auth.users(id) on delete set null,
  add column patient_confirmed_via text check (patient_confirmed_via in ('portal','staff')),
  add column professional_confirmed_at timestamptz,
  add column professional_confirmed_by uuid references auth.users(id) on delete set null,
  add constraint appt_patient_confirm_consistent check ((patient_confirmed_at is null) = (patient_confirmed_via is null));

-- ---------------------------------------------------------------- novo estado: falta do profissional
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.appointments'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%rescheduled%';
  if c is not null then execute format('alter table public.appointments drop constraint %I', c); end if;
end $$;
alter table public.appointments add constraint appointments_status_check
  check (status in ('scheduled','confirmed','attended','no_show','professional_no_show','cancelled_by_patient','cancelled_by_clinic','rescheduled'));
-- (as exclusões de sobreposição só valem para scheduled/confirmed/attended: a falta do profissional libera o horário)

-- auditoria: quem confirmou e quando (o ator vem de auth.uid() no trigger genérico)
drop trigger if exists audit_appointments on public.appointments;
create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function private.audit_row('status','professional_id','person_id','patient_confirmed_at','patient_confirmed_via','professional_confirmed_at');

-- ---------------------------------------------------------------- confirmação antecipada
create or replace function private.appt_assert_confirmable(a public.appointments) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if a.status not in ('scheduled','confirmed') then raise exception 'este agendamento não está ativo'; end if;
  if lower(a.period) <= now() then raise exception 'a confirmação antecipada só existe antes do horário do atendimento'; end if;
end $$;

-- Paciente confirma o PRÓPRIO atendimento (portal). Idempotente; nunca confirma pelo profissional.
create or replace function public.my_appointment_confirm(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or a.person_id is distinct from private.current_person() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if a.patient_confirmed_at is not null then return; end if;
  perform private.appt_assert_confirmable(a);
  update public.appointments set patient_confirmed_at = now(), patient_confirmed_by = (select auth.uid()), patient_confirmed_via = 'portal' where id = p_id;
end $$;

-- Profissional confirma o atendimento em que ele mesmo é o profissional. Nem gestor confirma em nome dele (independência).
create or replace function public.professional_appointment_confirm(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or not exists (select 1 from public.professionals pr where pr.id = a.professional_id and pr.user_id = (select auth.uid()) and pr.active) then
    raise exception 'sem permissão' using errcode = '42501'; end if;
  if a.professional_confirmed_at is not null then return; end if;
  perform private.appt_assert_confirmable(a);
  update public.appointments set professional_confirmed_at = now(), professional_confirmed_by = (select auth.uid()) where id = p_id;
end $$;

-- Recepção registra a confirmação que o paciente deu por outro canal (telefone/WhatsApp). Fica marcada como 'staff' e auditada.
-- Só a confirmação do PACIENTE; a do profissional nunca pode ser registrada por terceiros. Fisioterapeuta não usa esta via.
create or replace function public.appointment_confirm_for_patient(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or not private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], a.unit_id) then
    raise exception 'sem permissão' using errcode = '42501'; end if;
  if a.patient_confirmed_at is not null then return; end if;
  perform private.appt_assert_confirmable(a);
  update public.appointments set patient_confirmed_at = now(), patient_confirmed_by = (select auth.uid()), patient_confirmed_via = 'staff' where id = p_id;
end $$;

-- ---------------------------------------------------------------- presença efetiva (status)
create or replace function public.set_appointment_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or not private.can_schedule(a.unit_id, a.professional_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_status not in ('confirmed','attended','no_show','professional_no_show','cancelled_by_patient','cancelled_by_clinic') then raise exception 'status inválido'; end if;
  if a.status = p_status then return; end if;
  if a.status in ('rescheduled','cancelled_by_patient','cancelled_by_clinic','professional_no_show') then raise exception 'agendamento encerrado'; end if;
  if a.status in ('attended') and p_status <> 'attended' then raise exception 'atendimento realizado só pode ser ajustado pelo saldo do pacote'; end if;
  if p_status = 'attended' and lower(a.period) > now() then raise exception 'não é possível marcar comparecimento futuro'; end if;
  if p_status = 'no_show' and lower(a.period) > now() then raise exception 'não é possível marcar falta antes do horário do atendimento'; end if;
  if p_status = 'professional_no_show' and lower(a.period) > now() then raise exception 'não é possível marcar falta do profissional antes do horário do atendimento'; end if;
  update public.appointments set status = p_status, cancel_reason = case when p_status like 'cancelled%' then p_reason end where id = p_id;
  if p_status <> 'confirmed' then
    perform private.emit_event(a.org_id, 'appointment.' || p_status, 'appointment', p_id, jsonb_build_object('at', now()), 'appt.' || p_status || ':' || p_id);
  end if;
end $$;

-- ---------------------------------------------------------------- consumo: a falta do profissional nunca penaliza o paciente
create or replace function private.h_appt_professional_no_show(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; a public.appointments;
begin
  select * into e from public.domain_events where id = p_event;
  select * into a from public.appointments where id = e.aggregate_id;
  -- se a marcação anterior (falta do paciente, por engano) já havia consumido a sessão, devolve; uma única devolução por atendimento
  if a.client_package_id is not null
     and exists (select 1 from public.session_ledger where appointment_id = a.id and reason = 'consume')
     and not exists (select 1 from public.session_ledger where appointment_id = a.id and reason = 'refund') then
    insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason, note)
      values (a.org_id, a.client_package_id, a.id, 1, 'refund', 'Falta do profissional: sessão devolvida ao paciente');
    update public.client_packages set status = 'active' where id = a.client_package_id and status = 'exhausted' and private.package_balance(id) > 0;
  end if;
  -- a tarefa "paciente faltou" (se a marcação foi corrigida) deixa de fazer sentido
  update public.crm_tasks set done_at = now() where dedupe_key = 'no_show:' || a.id and done_at is null;
  insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, dedupe_key)
    values (a.org_id, a.unit_id, a.opportunity_id, a.person_id,
            coalesce((select owner_user_id from public.opportunities where id = a.opportunity_id), private.pick_owner(a.org_id, a.unit_id)),
            'other', 'Falta do profissional: reagendar o paciente sem custo', 'pro_no_show:' || a.id) on conflict do nothing;
end $$;
insert into private.event_handlers values ('appointment.professional_no_show','h_appt_professional_no_show');

-- ---------------------------------------------------------------- leitura: portal do paciente
-- Muda o tipo de retorno (colunas novas): é preciso recriar a função — e repetir os GRANT/REVOKE.
drop function public.my_appointments();
create function public.my_appointments() returns table (
  id uuid, starts_at timestamptz, ends_at timestamptz, status text, service_name text, professional_name text, unit_name text, timezone text, survey_answered boolean,
  patient_confirmed_at timestamptz, professional_confirmed_at timestamptz, can_confirm boolean, uses_package boolean, session_consumed boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, lower(a.period), upper(a.period), a.status, s.name, pr.display_name, u.name, u.timezone,
         exists (select 1 from public.survey_responses sr where sr.appointment_id = a.id),
         a.patient_confirmed_at, a.professional_confirmed_at,
         (a.status in ('scheduled','confirmed') and lower(a.period) > now() and a.patient_confirmed_at is null),
         a.client_package_id is not null,
         exists (select 1 from public.session_ledger l where l.appointment_id = a.id and l.reason = 'consume')
           and not exists (select 1 from public.session_ledger l where l.appointment_id = a.id and l.reason = 'refund')
  from public.appointments a join public.services s on s.id = a.service_id join public.professionals pr on pr.id = a.professional_id join public.units u on u.id = a.unit_id
  where a.person_id = private.current_person() order by lower(a.period) desc limit 100
$$;

-- leitura: "Meu dia" do profissional (agora com confirmações e desfechos)
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
    'appointments', case when v_prof is null then '[]' else coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', lower(a.period), 'ends_at', upper(a.period), 'status', a.status, 'person', p.full_name, 'service', s.name,
        'patient_confirmed_at', a.patient_confirmed_at, 'professional_confirmed_at', a.professional_confirmed_at,
        'can_confirm', (a.status in ('scheduled','confirmed') and lower(a.period) > now() and a.professional_confirmed_at is null)) order by lower(a.period))
      from public.appointments a join public.people p on p.id = a.person_id join public.services s on s.id = a.service_id
      where a.professional_id = v_prof and a.status in ('scheduled','confirmed','attended','no_show','professional_no_show') and lower(a.period)::date = p_date), '[]') end
  );
end $$;

-- ---------------------------------------------------------------- privilégios (nenhuma função nova é executável por anon)
revoke all on function public.my_appointment_confirm(uuid), public.professional_appointment_confirm(uuid), public.appointment_confirm_for_patient(uuid),
  public.my_appointments(), public.my_day(date), public.set_appointment_status(uuid, text, text) from public, anon;
grant execute on function public.my_appointment_confirm(uuid), public.professional_appointment_confirm(uuid), public.appointment_confirm_for_patient(uuid),
  public.my_appointments(), public.my_day(date), public.set_appointment_status(uuid, text, text) to authenticated;
