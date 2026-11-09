-- HP Group Hub — 097 Portais F2: responsável legal / cuidador / representante, consentimentos, leitura clínica do admin COM registro de acesso.
-- Regras (docs/plano-portais-paciente-e-fisio.md §4.6): criança < 12 anos não tem login; adolescente 12–17 só com autorização do responsável; responsável legal vale só enquanto o paciente é menor;
-- vínculo só vale VERIFICADO pelo admin, dentro da validade e sem suspensão; cuidador/delegado nunca consentem e dependem do aceite do paciente; consentir exige senha recente.
-- DECISÃO DO PROPRIETÁRIO (05/11): o admin (papel gestor = dono da clínica) lê dado clínico. Isso muda a regra da 058: a leitura passa por admin_patient_journey(), que REGISTRA cada acesso.
-- A pessoa age em nome de outra pelo cabeçalho HTTP "x-acting-as: <person_id>"; private.current_person() só o honra se existir vínculo ativo (senão 42501 — nunca "cai" para a própria pessoa).

-- ---------------------------------------------------------------- vínculos
create table public.care_representations (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid references public.units(id) on delete restrict,
  patient_person_id uuid not null references public.people(id) on delete cascade,
  representative_person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('responsavel_legal','tutor','curador','procurador','cuidador','delegado')),
  can_agenda boolean not null default false, can_cancel boolean not null default false, can_train boolean not null default false, can_evolution boolean not null default false,
  can_billing boolean not null default false, can_consent boolean not null default false, can_ticket boolean not null default false,
  minor_login_allowed boolean not null default false,                       -- o responsável autoriza o login próprio do adolescente (12–17)
  status text not null default 'pending' check (status in ('pending','verified','revoked')),
  valid_from date not null default current_date, valid_until date,
  patient_accepted_at timestamptz,                                           -- aceite do paciente (obrigatório para cuidador e delegado)
  verified_by uuid references auth.users(id) on delete set null, verified_at timestamptz, checked_in_person boolean not null default false,
  suspended_at timestamptz, suspended_reason text, revoked_at timestamptz, revoked_by uuid references auth.users(id) on delete set null, revoked_reason text,
  note text check (note is null or length(note) <= 1000),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (patient_person_id <> representative_person_id),
  check (kind not in ('cuidador','delegado') or can_consent = false)           -- cuidador/delegado nunca consentem
);
create unique index care_rep_open_uq on public.care_representations (patient_person_id, representative_person_id) where status <> 'revoked';
create index care_rep_rep_idx on public.care_representations (representative_person_id) where status <> 'revoked';

create table public.representation_documents (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, representation_id uuid not null references public.care_representations(id) on delete cascade,
  doc_type text not null check (doc_type in ('doc_foto','certidao_nascimento','termo_tutela_guarda','termo_curatela','procuracao','autorizacao','outro')),
  storage_path text not null check (storage_path ~ '^[0-9a-f-]{36}/'), uploaded_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- consentimentos (append-only; vale o último de cada tipo)
create table public.consent_texts (
  kind text not null check (kind in ('saude','imagem_video','comunicacao_comercial')), version text not null, body text not null, is_draft boolean not null default true, active boolean not null default true,
  primary key (kind, version)
);
insert into public.consent_texts (kind, version, body) values
  ('saude', 'v0-minuta', 'MINUTA — aguardando revisão jurídica. Autorizo a HP Fisioterapia a tratar meus dados de saúde (avaliações, evolução, exercícios e anotações do meu fisioterapeuta) para realizar o meu acompanhamento. Posso revogar este consentimento a qualquer momento.'),
  ('imagem_video', 'v0-minuta', 'MINUTA — aguardando revisão jurídica. Autorizo o uso de fotos e vídeos meus feitos durante o acompanhamento, apenas para fins clínicos e de orientação a mim, sem divulgação pública.'),
  ('comunicacao_comercial', 'v0-minuta', 'MINUTA — aguardando revisão jurídica. Aceito receber, por e-mail e notificações do aplicativo, propostas de programas e serviços da HP Fisioterapia. Isto é opcional e pode ser desativado quando eu quiser.');
create table public.consents (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('saude','imagem_video','comunicacao_comercial')), granted boolean not null, version text not null, text_snapshot text not null,
  given_by_user uuid references auth.users(id) on delete set null, given_by_person uuid references public.people(id) on delete set null, in_name_of boolean not null default false,
  ip text, user_agent text, at timestamptz not null default clock_timestamp()      -- clock_timestamp: dois registros na mesma transação não empatam (vale o último)
);
create index consents_person_kind_idx on public.consents (person_id, kind, at desc);

-- ---------------------------------------------------------------- registro de acesso clínico (admin e fisioterapeuta)
create table public.clinical_access_log (
  id bigint generated always as identity primary key, org_id uuid not null, person_id uuid not null references public.people(id) on delete cascade,
  accessed_by uuid not null, accessed_by_role text not null check (accessed_by_role in ('admin','professional')), scope text not null, at timestamptz not null default now()
);
create index clinical_access_person_idx on public.clinical_access_log (person_id, at desc);
create index clinical_access_dedupe_idx on public.clinical_access_log (accessed_by, person_id, scope, at desc);

alter table public.care_representations enable row level security; alter table public.representation_documents enable row level security;
alter table public.consent_texts enable row level security; alter table public.consents enable row level security; alter table public.clinical_access_log enable row level security;
-- leitura direta: só a gestão (admin) vê vínculos e documentos; consentimentos e acessos só por funções (titular) — nenhuma escrita direta
grant select on public.care_representations, public.representation_documents, public.consent_texts to authenticated;
create policy carerep_admin_read on public.care_representations for select to authenticated using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], unit_id));
create policy repdoc_admin_read on public.representation_documents for select to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy consent_texts_read on public.consent_texts for select to authenticated using (true);
create trigger audit_care_representations after insert or update on public.care_representations for each row execute function private.audit_row('kind','status','valid_until','suspended_at','revoked_at');

-- bucket privado dos documentos do responsável: só o admin lê e anexa
insert into storage.buckets (id, name, public) values ('representation-docs', 'representation-docs', false) on conflict (id) do nothing;
create policy repdocs_obj_read on storage.objects for select to authenticated using (bucket_id = 'representation-docs' and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy repdocs_obj_write on storage.objects for insert to authenticated with check (bucket_id = 'representation-docs' and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy repdocs_obj_delete on storage.objects for delete to authenticated using (bucket_id = 'representation-docs' and private.has_org_role(array['manager','ops_admin']::public.app_role[]));

-- ---------------------------------------------------------------- utilitários
create or replace function private.real_person() returns uuid language sql stable security definer set search_path = '' as $$
  select ua.person_id from public.user_accounts ua where ua.user_id = (select auth.uid()) and ua.status = 'active'
$$;
create or replace function private.age_years(p_birth date) returns int language sql immutable set search_path = '' as $$
  select case when p_birth is null then null else date_part('year', age(current_date, p_birth))::int end
$$;
-- vínculo ATIVO = verificado, sem suspensão/revogação, dentro da validade; responsável legal/tutor só enquanto o paciente é menor; cuidador/delegado só com aceite do paciente
create or replace function private.rep_active(r public.care_representations) returns boolean language sql stable security definer set search_path = '' as $$
  select r.status = 'verified' and r.suspended_at is null and r.revoked_at is null and r.valid_from <= current_date and (r.valid_until is null or r.valid_until >= current_date)
     and (r.kind not in ('responsavel_legal','tutor') or exists (select 1 from public.people p where p.id = r.patient_person_id and p.birth_date is not null and p.birth_date > current_date - interval '18 years'))
     and (r.kind not in ('cuidador','delegado') or r.patient_accepted_at is not null)
$$;
create or replace function private.rep_scope_defaults(p_kind text) returns jsonb language sql immutable set search_path = '' as $$
  select case p_kind
    when 'cuidador' then '{"can_agenda":true,"can_cancel":false,"can_train":true,"can_evolution":false,"can_billing":false,"can_consent":false,"can_ticket":false}'
    when 'delegado' then '{"can_agenda":true,"can_cancel":true,"can_train":true,"can_evolution":true,"can_billing":false,"can_consent":false,"can_ticket":true}'
    else '{"can_agenda":true,"can_cancel":true,"can_train":true,"can_evolution":true,"can_billing":true,"can_consent":true,"can_ticket":true}' end::jsonb
$$;
-- vínculo que o cabeçalho x-acting-as pede; nulo se não há cabeçalho (ou é a própria pessoa); 42501 se o pedido não tem vínculo ativo
create or replace function private.acting_rep() returns public.care_representations language plpgsql stable security definer set search_path = '' as $$
declare v_self uuid := private.real_person(); v_as text; v_target uuid; r public.care_representations;
begin
  begin v_as := nullif(current_setting('request.headers', true)::json ->> 'x-acting-as', ''); exception when others then v_as := null; end;
  if v_as is null or v_self is null then return null; end if;
  begin v_target := v_as::uuid; exception when others then raise exception 'sem permissão' using errcode = '42501'; end;
  if v_target = v_self then return null; end if;
  select x.* into r from public.care_representations x where x.representative_person_id = v_self and x.patient_person_id = v_target and private.rep_active(x) limit 1;
  if r.id is null then raise exception 'sem permissão para agir em nome desta pessoa' using errcode = '42501'; end if;
  return r;
end $$;
-- A PESSOA DO DADO: a própria, ou a de quem o usuário representa (quando o cabeçalho x-acting-as vale). Todas as funções do portal já usam esta.
create or replace function private.current_person() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare r public.care_representations;
begin
  r := private.acting_rep();
  if r.id is not null then return r.patient_person_id; end if;
  return private.real_person();
end $$;
-- escopo da ação: agindo em nome de alguém, o vínculo precisa autorizá-la; agindo por si, menor de idade só com as regras de idade
create or replace function private.require_scope(p_scope text) returns void language plpgsql stable security definer set search_path = '' as $$
declare r public.care_representations; v_self uuid; v_birth date; v_age int; ok boolean;
begin
  r := private.acting_rep();
  if r.id is not null then
    ok := case p_scope when 'agenda' then r.can_agenda when 'cancel' then r.can_cancel when 'train' then r.can_train when 'evolution' then r.can_evolution
                       when 'billing' then r.can_billing when 'consent' then r.can_consent when 'ticket' then r.can_ticket else false end;
    if not ok then raise exception 'sem permissão: este vínculo não autoriza esta ação' using errcode = '42501'; end if;
    return;
  end if;
  v_self := private.real_person(); if v_self is null then return; end if;
  select birth_date into v_birth from public.people where id = v_self; v_age := private.age_years(v_birth);
  if v_age is null or v_age >= 18 then return; end if;
  if v_age < 12 then raise exception 'menor de 12 anos não usa o aplicativo: o responsável legal deve acessar em nome dele' using errcode = '42501'; end if;
  if not exists (select 1 from public.care_representations x where x.patient_person_id = v_self and x.minor_login_allowed and private.rep_active(x)) then
    raise exception 'o acesso do adolescente depende da autorização do responsável legal' using errcode = '42501'; end if;
  if p_scope not in ('agenda','train','evolution') then raise exception 'esta ação é reservada ao responsável legal' using errcode = '42501'; end if;
end $$;
create or replace function private.scope_ok(p_scope text) returns boolean language plpgsql stable security definer set search_path = '' as $$
begin perform private.require_scope(p_scope); return true; end $$;
-- login recente: o JWT guarda o instante de cada autenticação (amr); ações sensíveis exigem senha digitada há pouco
create or replace function private.recent_auth(p_minutes int default 15) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select max((a ->> 'timestamp')::bigint) from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) a), 0) >= extract(epoch from now() - make_interval(mins => p_minutes))::bigint
$$;
create or replace function private.has_consent(p_person uuid, p_kind text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.granted from public.consents c where c.person_id = p_person and c.kind = p_kind order by c.at desc, c.id limit 1), false)
$$;
-- registra o acesso clínico (admin ou fisio); o mesmo usuário/paciente/tela dentro de 10 min conta uma vez
create or replace function private.log_clinical_access(p_person uuid, p_role text, p_scope text) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return; end if;
  if exists (select 1 from public.clinical_access_log l where l.accessed_by = v_uid and l.person_id = p_person and l.scope = p_scope and l.at > now() - interval '10 minutes') then return; end if;
  insert into public.clinical_access_log (org_id, person_id, accessed_by, accessed_by_role, scope) values (private.current_org(), p_person, v_uid, p_role, p_scope);
end $$;

-- ---------------------------------------------------------------- funções do portal que passam a respeitar o escopo do vínculo (definições ATUAIS do Dev + a verificação de escopo)

CREATE OR REPLACE FUNCTION public.care_log_activity(p_assignment uuid, p_pain smallint, p_answers jsonb, p_note text, p_needs_attention boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.care_assignments; v_person uuid := private.current_person(); v_id uuid; v_unit uuid;
begin
  perform private.require_scope('train');
  select * into a from public.care_assignments where id = p_assignment and person_id = v_person and revoked_at is null and (valid_until is null or valid_until > now());
  if not found then raise exception 'conteúdo não liberado' using errcode = '42501'; end if;
  insert into public.care_activity (org_id, person_id, assignment_id, pain_scale, answers, note, needs_attention) values (a.org_id, v_person, p_assignment, p_pain, p_answers, p_note, coalesce(p_needs_attention, false)) returning id into v_id;
  if coalesce(p_needs_attention, false) then
    select unit_id into v_unit from public.care_contents where id = a.content_id;
    insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (a.org_id, v_unit, v_person, a.released_by, 'follow_up', 'Paciente sinalizou que precisa de atendimento (acompanhamento)', 'care_attention:' || v_id) on conflict do nothing;
  end if;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.care_send_message(p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_person uuid := private.current_person(); v_id uuid; r record; v_org uuid := private.current_org();
begin
  perform private.require_scope('ticket');
  if v_person is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  perform private.rate_limit('care_msg:' || v_person, interval '10 minutes', 10);
  insert into public.care_messages (org_id, person_id, sender, sender_user_id, body) values (v_org, v_person, 'patient', (select auth.uid()), btrim(p_body)) returning id into v_id;
  for r in select professional_user_id, unit_id from public.care_relationships where person_id = v_person and revoked_at is null and (valid_until is null or valid_until > now()) loop
    insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (v_org, r.unit_id, v_person, r.professional_user_id, 'follow_up', 'Nova dúvida de paciente no canal de acompanhamento', 'care_msg:' || v_person || ':' || r.professional_user_id || ':' || current_date) on conflict do nothing;
  end loop;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.my_appointment_cancel(p_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.appointments; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_consumed boolean;
begin
  perform private.require_scope('cancel');
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or a.person_id is distinct from private.current_person() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if a.status = 'cancelled_by_patient' then return jsonb_build_object('status', a.status, 'session_consumed',
      exists (select 1 from public.session_ledger l where l.appointment_id = a.id and l.reason = 'consume')); end if;   -- idempotente
  if a.status not in ('scheduled','confirmed') then raise exception 'este agendamento não pode mais ser cancelado pelo portal'; end if;
  if lower(a.period) <= now() then raise exception 'o atendimento já começou: fale com a equipe'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'motivo muito longo (máximo 500 caracteres)'; end if;
  update public.appointments set status = 'cancelled_by_patient', cancel_reason = coalesce(v_reason, 'Cancelado pelo paciente no portal') where id = p_id;
  perform private.emit_event(a.org_id, 'appointment.cancelled_by_patient', 'appointment', p_id, jsonb_build_object('at', now(), 'via', 'portal'), 'appt.cancelled_by_patient:' || p_id);
  select exists (select 1 from public.session_ledger l where l.appointment_id = p_id and l.reason = 'consume') into v_consumed;
  return jsonb_build_object('status', 'cancelled_by_patient', 'session_consumed', v_consumed);
end $function$;

CREATE OR REPLACE FUNCTION public.my_appointment_confirm(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.appointments;
begin
  perform private.require_scope('agenda');
  select * into a from public.appointments where id = p_id and org_id = private.current_org() for update;
  if not found or a.person_id is distinct from private.current_person() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if a.patient_confirmed_at is not null then return; end if;
  perform private.appt_assert_confirmable(a);
  update public.appointments set patient_confirmed_at = now(), patient_confirmed_by = (select auth.uid()), patient_confirmed_via = 'portal' where id = p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.my_appointments()
 RETURNS TABLE(id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, service_name text, professional_name text, unit_name text, timezone text, survey_answered boolean, patient_confirmed_at timestamp with time zone, professional_confirmed_at timestamp with time zone, can_confirm boolean, uses_package boolean, session_consumed boolean, can_cancel boolean, cancel_consumes boolean, late_cancel_hours integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id, lower(a.period), upper(a.period), a.status, s.name, pr.display_name, u.name, u.timezone,
         exists (select 1 from public.survey_responses sr where sr.appointment_id = a.id),
         a.patient_confirmed_at, a.professional_confirmed_at,
         (a.status in ('scheduled','confirmed') and lower(a.period) > now() and a.patient_confirmed_at is null),
         a.client_package_id is not null,
         exists (select 1 from public.session_ledger l where l.appointment_id = a.id and l.reason = 'consume')
           and not exists (select 1 from public.session_ledger l where l.appointment_id = a.id and l.reason = 'refund'),
         (a.status in ('scheduled','confirmed') and lower(a.period) > now()),
         (a.client_package_id is not null and lp.late_cancel_hours is not null and lower(a.period) - now() < make_interval(hours => lp.late_cancel_hours)),
         lp.late_cancel_hours
  from public.appointments a join public.services s on s.id = a.service_id join public.professionals pr on pr.id = a.professional_id join public.units u on u.id = a.unit_id
  left join lateral (select p.late_cancel_hours from public.client_packages c join public.products p on p.id = c.product_id where c.id = a.client_package_id) lp on true
  where a.person_id = private.current_person() and private.scope_ok('agenda') order by lower(a.period) desc limit 100
$function$;

CREATE OR REPLACE FUNCTION public.my_assessment_add(p_kind text, p_score numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_person uuid := private.current_person(); v_unit uuid; v_id uuid;
begin
  perform private.require_scope('train');
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select unit_id into v_unit from public.people where id = v_person and org_id = private.current_org();
  if v_unit is null then raise exception 'cadastro sem unidade: fale com a recepção'; end if;
  insert into public.patient_assessments (org_id, unit_id, person_id, plan_id, kind, score, note, recorded_by, recorded_by_role)
    values (private.current_org(), v_unit, v_person, (select id from public.patient_plans where person_id = v_person and status = 'active'), p_kind, p_score, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()), 'patient') returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.my_journey()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_person uuid := private.current_person();
begin
  perform private.require_scope('evolution');
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return private.journey_payload(v_person, false);
end $function$;

CREATE OR REPLACE FUNCTION public.my_package_breakdown()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(x.row order by x.created desc), '[]'::jsonb) from (
    select cp.created_at as created, jsonb_build_object(
      'id', cp.id, 'product_name', pr.name, 'status', cp.status, 'valid_until', cp.valid_until,
      'contracted', coalesce(sum(l.delta) filter (where l.reason = 'grant'), 0),
      'adjusted', coalesce(sum(l.delta) filter (where l.reason = 'adjust'), 0),
      'attended', count(l.id) filter (where l.reason = 'consume' and a.status = 'attended'),
      'no_show', count(l.id) filter (where l.reason = 'consume' and a.status = 'no_show'),
      'late_cancel', count(l.id) filter (where l.reason = 'consume' and a.status = 'cancelled_by_patient'),
      'consumed_other', count(l.id) filter (where l.reason = 'consume' and (a.status is null or a.status not in ('attended','no_show','cancelled_by_patient'))),
      'refunded', coalesce(sum(l.delta) filter (where l.reason = 'refund'), 0),
      'balance', coalesce(sum(l.delta), 0)) as row
    from public.client_packages cp join public.products pr on pr.id = cp.product_id
    left join public.session_ledger l on l.client_package_id = cp.id left join public.appointments a on a.id = l.appointment_id
    where cp.person_id = private.current_person() and private.scope_ok('billing') and cp.org_id = private.current_org()
    group by cp.id, pr.name
  ) x
$function$;

CREATE OR REPLACE FUNCTION public.my_packages()
 RETURNS TABLE(id uuid, product_name text, balance integer, total_sessions integer, valid_until date, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, p.name, private.package_balance(c.id), c.total_sessions, c.valid_until, c.status
  from public.client_packages c join public.products p on p.id = c.product_id where c.person_id = private.current_person() and private.scope_ok('billing') order by c.created_at desc
$function$;

CREATE OR REPLACE FUNCTION public.my_profile_update(p_preferred_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_state_uf text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_person uuid := private.current_person(); v_phone_digits text; v_uf text := nullif(upper(btrim(coalesce(p_state_uf, ''))), '');
begin
  perform private.require_scope('consent');
  if v_person is null then raise exception 'sua conta não está vinculada a um cadastro de pessoa' using errcode = '42501'; end if;
  if p_preferred_name is not null and length(btrim(p_preferred_name)) > 120 then raise exception 'nome de preferência muito longo'; end if;
  if p_phone is not null and btrim(p_phone) <> '' then
    v_phone_digits := regexp_replace(p_phone, '\D', '', 'g');
    if length(v_phone_digits) not between 10 and 13 then raise exception 'telefone inválido'; end if;
  end if;
  update public.people set
    preferred_name = case when p_preferred_name is not null then nullif(btrim(p_preferred_name), '') else preferred_name end,
    city = case when p_city is not null then nullif(btrim(p_city), '') else city end,
    state_uf = case when p_state_uf is not null then v_uf else state_uf end
  where id = v_person;

  if p_phone is not null and btrim(p_phone) <> '' then
    update public.person_contacts set is_primary = false where person_id = v_person and type = 'phone' and is_primary;
    insert into public.person_contacts (org_id, person_id, type, value, is_primary)
      values (private.current_org(), v_person, 'phone', btrim(p_phone), true)
    on conflict (person_id, type, normalized) do update set value = excluded.value, is_primary = true;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.my_renewal_request(p_kind text DEFAULT 'contato'::text, p_message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_person uuid := private.current_person(); v_unit uuid; v_id uuid; v_last text;
begin
  perform private.require_scope('billing');
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_kind not in ('renovacao','contato') then raise exception 'tipo de pedido inválido'; end if;
  if p_kind = 'renovacao' then
    select decision into v_last from public.patient_reassessments where person_id = v_person order by decided_at desc, id desc limit 1;
    if v_last is null or v_last not in ('continuidade','manutencao') then
      raise exception 'a renovação depende da orientação do seu fisioterapeuta na reavaliação; se quiser, use "falar com a equipe"';
    end if;
  end if;
  select id into v_id from public.renewal_requests where person_id = v_person and status = 'open';
  if v_id is not null then return v_id; end if;
  select unit_id into v_unit from public.people where id = v_person and org_id = private.current_org();
  if v_unit is null then raise exception 'cadastro sem unidade: fale com a recepção'; end if;
  insert into public.renewal_requests (org_id, unit_id, person_id, plan_id, kind, message)
    values (private.current_org(), v_unit, v_person, (select id from public.patient_plans where person_id = v_person and status = 'active'), p_kind, nullif(btrim(coalesce(p_message, '')), '')) returning id into v_id;
  insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
    values (private.current_org(), v_unit, v_person, private.pick_owner(private.current_org(), v_unit), 'follow_up',
            case p_kind when 'renovacao' then 'Paciente pediu para renovar o acompanhamento (indicado pelo fisioterapeuta) — entrar em contato' else 'Paciente pediu contato da equipe' end, 'renewal:' || v_id) on conflict do nothing;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_submit(p_survey uuid, p_appointment uuid, p_score smallint, p_comment text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_person uuid := private.current_person(); sv public.surveys; a public.appointments; v_id uuid;
begin
  perform private.require_scope('agenda');
  select * into sv from public.surveys where id = p_survey and active and org_id = private.current_org();
  if not found or v_person is null then raise exception 'pesquisa indisponível' using errcode = '42501'; end if;
  if p_appointment is not null then
    select * into a from public.appointments where id = p_appointment and person_id = v_person and status = 'attended';
    if not found then raise exception 'atendimento inválido'; end if;
  end if;
  insert into public.survey_responses (org_id, survey_id, person_id, appointment_id, score, comment) values (sv.org_id, p_survey, v_person, p_appointment, p_score, p_comment)
    on conflict do nothing returning id into v_id;
  if v_id is not null and p_score <= 6 then
    insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (sv.org_id, a.unit_id, v_person, coalesce(private.pick_owner(sv.org_id, a.unit_id), null), 'follow_up', 'Resposta de satisfação baixa (nota ' || p_score || '): entrar em contato', 'survey:' || v_id) on conflict do nothing;
  end if;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.professional_journey(p_person uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_care(p_person);
  perform private.log_clinical_access(p_person, 'professional', 'journey');
  return private.journey_payload(p_person, true);
end $function$;

revoke all on function public.care_log_activity(p_assignment uuid, p_pain smallint, p_answers jsonb, p_note text, p_needs_attention boolean), public.care_send_message(p_body text), public.my_appointment_cancel(p_id uuid, p_reason text), public.my_appointment_confirm(p_id uuid), public.my_appointments(), public.my_assessment_add(p_kind text, p_score numeric, p_note text), public.my_journey(), public.my_package_breakdown(), public.my_packages(), public.my_profile_update(p_preferred_name text, p_phone text, p_city text, p_state_uf text), public.my_renewal_request(p_kind text, p_message text), public.survey_submit(p_survey uuid, p_appointment uuid, p_score smallint, p_comment text), public.professional_journey(uuid) from public, anon;
grant execute on function public.care_log_activity(p_assignment uuid, p_pain smallint, p_answers jsonb, p_note text, p_needs_attention boolean), public.care_send_message(p_body text), public.my_appointment_cancel(p_id uuid, p_reason text), public.my_appointment_confirm(p_id uuid), public.my_appointments(), public.my_assessment_add(p_kind text, p_score numeric, p_note text), public.my_journey(), public.my_package_breakdown(), public.my_packages(), public.my_profile_update(p_preferred_name text, p_phone text, p_city text, p_state_uf text), public.my_renewal_request(p_kind text, p_message text), public.survey_submit(p_survey uuid, p_appointment uuid, p_score smallint, p_comment text), public.professional_journey(uuid) to authenticated;

-- Início do paciente (096) agora respeita menor de idade, vínculo e escopo: quem representa só vê o que o vínculo autoriza; a data de nascimento ausente é sinalizada.
create or replace function public.my_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_person uuid; v_org uuid := private.current_org(); v_j jsonb; v_p record; r public.care_representations; v_ev boolean := true; v_bill boolean := true;
  v_pain_first numeric; v_pain_last numeric; v_pain_n int; v_goal jsonb; v_last_dec text;
begin
  perform private.require_scope('agenda');
  v_person := private.current_person();
  if v_person is null or v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  r := private.acting_rep(); if r.id is not null then v_ev := r.can_evolution; v_bill := r.can_billing; end if;
  v_j := private.journey_payload(v_person, false);
  select p.full_name, p.preferred_name, p.birth_date into v_p from public.people p where p.id = v_person;
  select (array_agg((x ->> 'score')::numeric order by (x ->> 'assessed_at')))[1], (array_agg((x ->> 'score')::numeric order by (x ->> 'assessed_at') desc))[1], count(*)
    into v_pain_first, v_pain_last, v_pain_n from jsonb_array_elements(v_j -> 'assessments') x where x ->> 'kind' = 'dor';
  select g into v_goal from jsonb_array_elements(v_j -> 'goals') g where g ->> 'status' = 'active' limit 1;
  select d ->> 'decision' into v_last_dec from jsonb_array_elements(v_j -> 'reassessments') d order by (d ->> 'decided_at') desc limit 1;
  return jsonb_build_object(
    'person', jsonb_build_object('id', v_person, 'name', coalesce(nullif(btrim(v_p.preferred_name), ''), v_p.full_name), 'birth_date', v_p.birth_date, 'age', private.age_years(v_p.birth_date)),
    'acting', case when r.id is not null then jsonb_build_object('kind', r.kind, 'representative', (select pe.full_name from public.people pe where pe.id = private.real_person())) end,
    'needs_birth_date', v_p.birth_date is null,
    'next_appointment', (v_j -> 'upcoming') -> 0,
    'plan', case when v_ev then v_j -> 'plan' end,
    'package_balance', case when v_bill then v_j -> 'package_balance' end,
    'pain', case when v_ev and v_pain_n > 0 then jsonb_build_object('first', v_pain_first, 'last', v_pain_last, 'count', v_pain_n) end,
    'goal', case when v_ev then v_goal end,
    'last_decision', case when v_ev then v_last_dec end,
    'renewal_open', v_bill and (v_j -> 'renewal') is not null and (v_j -> 'renewal') <> 'null'::jsonb,
    'videos_count', jsonb_array_length(v_j -> 'videos'),
    'unread_msgs', (select count(*) from public.care_messages m where m.person_id = v_person and m.sender <> 'patient' and m.created_at > now() - interval '7 days')
  );
end $$;
revoke all on function public.my_home() from public, anon;
grant execute on function public.my_home() to authenticated;


-- ---------------------------------------------------------------- vínculos: criação, verificação, revogação, suspensão, aceite
create or replace function public.representation_save(p_id uuid, p_patient uuid, p_representative uuid, p_kind text, p_scopes jsonb default null, p_valid_until date default null,
  p_minor_login boolean default false, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_unit uuid; v_birth date; v_age int; sc jsonb; v_id uuid; ex public.care_representations;
begin
  select unit_id, birth_date into v_unit, v_birth from public.people where id = p_patient and org_id = v_org and merged_into_id is null; v_age := private.age_years(v_birth);
  if v_unit is null or not private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], v_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_kind not in ('responsavel_legal','tutor','curador','procurador','cuidador','delegado') then raise exception 'tipo de vínculo inválido'; end if;
  if p_patient = p_representative then raise exception 'o paciente não pode ser representante de si mesmo'; end if;
  if not exists (select 1 from public.people where id = p_representative and org_id = v_org and merged_into_id is null) then raise exception 'representante não encontrado no cadastro central'; end if;
  if p_kind in ('responsavel_legal','tutor') and (v_age is null or v_age >= 18) then raise exception 'responsável legal/tutor só para paciente menor de 18 anos, com data de nascimento cadastrada'; end if;
  if p_kind = 'delegado' and v_age is not null and v_age < 18 then raise exception 'a delegação é do próprio paciente maior de idade'; end if;
  if p_kind in ('cuidador','delegado') and (p_valid_until is null or p_valid_until > current_date + 366) then raise exception 'cuidador e delegado exigem validade de no máximo 1 ano'; end if;
  if p_valid_until is not null and p_valid_until < current_date then raise exception 'a validade não pode estar no passado'; end if;
  if p_minor_login and (v_age is null or v_age < 12 or v_age >= 18) then raise exception 'login próprio só para adolescente de 12 a 17 anos'; end if;
  sc := private.rep_scope_defaults(p_kind) || coalesce(p_scopes, '{}'::jsonb);
  if p_kind in ('cuidador','delegado') then sc := sc || '{"can_consent":false}'::jsonb; end if;
  if p_id is null then
    insert into public.care_representations (org_id, unit_id, patient_person_id, representative_person_id, kind, can_agenda, can_cancel, can_train, can_evolution, can_billing, can_consent, can_ticket,
        minor_login_allowed, valid_until, note, created_by)
      values (v_org, v_unit, p_patient, p_representative, p_kind, (sc ->> 'can_agenda')::boolean, (sc ->> 'can_cancel')::boolean, (sc ->> 'can_train')::boolean, (sc ->> 'can_evolution')::boolean,
        (sc ->> 'can_billing')::boolean, (sc ->> 'can_consent')::boolean, (sc ->> 'can_ticket')::boolean, p_minor_login, p_valid_until, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())) returning id into v_id;
  else
    select * into ex from public.care_representations where id = p_id and org_id = v_org for update;
    if not found or ex.patient_person_id <> p_patient or ex.representative_person_id <> p_representative or ex.kind <> p_kind then raise exception 'vínculo não encontrado (paciente, representante e tipo não mudam)'; end if;
    if ex.status = 'revoked' then raise exception 'vínculo revogado não se edita: crie outro'; end if;
    update public.care_representations set can_agenda = (sc ->> 'can_agenda')::boolean, can_cancel = (sc ->> 'can_cancel')::boolean, can_train = (sc ->> 'can_train')::boolean,
        can_evolution = (sc ->> 'can_evolution')::boolean, can_billing = (sc ->> 'can_billing')::boolean, can_consent = (sc ->> 'can_consent')::boolean, can_ticket = (sc ->> 'can_ticket')::boolean,
        minor_login_allowed = p_minor_login, valid_until = p_valid_until, note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function private.rep_admin(p_id uuid) returns public.care_representations language plpgsql stable security definer set search_path = '' as $$
declare r public.care_representations;
begin
  select * into r from public.care_representations where id = p_id and org_id = private.current_org();
  if r.id is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return r;
end $$;
-- só o admin verifica: exige documento anexado OU a conferência do original em mãos
create or replace function public.representation_verify(p_id uuid, p_checked_in_person boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.care_representations := private.rep_admin(p_id);
begin
  if r.status = 'revoked' then raise exception 'vínculo revogado'; end if;
  if r.kind <> 'delegado' and not p_checked_in_person and not exists (select 1 from public.representation_documents d where d.representation_id = p_id) then
    raise exception 'anexe o documento ou confirme a conferência do original antes de verificar'; end if;
  update public.care_representations set status = 'verified', verified_by = (select auth.uid()), verified_at = now(), checked_in_person = p_checked_in_person, updated_at = now() where id = p_id;
end $$;
create or replace function public.representation_suspend(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare r public.care_representations := private.rep_admin(p_id);
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo da suspensão'; end if;
  update public.care_representations set suspended_at = now(), suspended_reason = btrim(p_reason), updated_at = now() where id = p_id and revoked_at is null;
end $$;
create or replace function public.representation_unsuspend(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.care_representations := private.rep_admin(p_id);
begin update public.care_representations set suspended_at = null, suspended_reason = null, updated_at = now() where id = p_id; end $$;
-- disputa (por exemplo, pais em desacordo): suspende TODOS os vínculos do paciente até a decisão do admin
create or replace function public.representation_suspend_patient(p_patient uuid, p_reason text) returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) or not exists (select 1 from public.people where id = p_patient and org_id = private.current_org()) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo da suspensão'; end if;
  update public.care_representations set suspended_at = now(), suspended_reason = btrim(p_reason), updated_at = now() where patient_person_id = p_patient and org_id = private.current_org() and status <> 'revoked' and suspended_at is null;
  get diagnostics n = row_count; return n;
end $$;
-- revogar: o admin sempre; o próprio paciente adulto (que não está agindo em nome de ninguém) só cuidador/delegado, com senha recente
create or replace function public.representation_revoke(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare r public.care_representations; v_admin boolean := private.has_org_role(array['manager','ops_admin']::public.app_role[]); v_self uuid := private.real_person(); v_by_patient boolean;
begin
  select * into r from public.care_representations where id = p_id and org_id = private.current_org();
  if r.id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  v_by_patient := v_self is not null and r.patient_person_id = v_self and r.kind in ('cuidador','delegado') and (private.acting_rep()).id is null;
  if not v_admin and not v_by_patient then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_by_patient and not v_admin and not private.recent_auth(15) then raise exception 'reautenticação necessária: confirme sua senha' using errcode = 'P0001'; end if;
  update public.care_representations set status = 'revoked', revoked_at = now(), revoked_by = (select auth.uid()), revoked_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now() where id = p_id and status <> 'revoked';
end $$;
-- aceite do paciente (adulto) ou de quem o representa legalmente — nunca do próprio cuidador/delegado
create or replace function public.my_representation_accept(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.care_representations; v_pat uuid;
begin
  perform private.require_scope('consent');
  v_pat := private.current_person();
  select * into r from public.care_representations where id = p_id and patient_person_id = v_pat and org_id = private.current_org();
  if r.id is null or r.kind not in ('cuidador','delegado') or r.status = 'revoked' then raise exception 'sem permissão' using errcode = '42501'; end if;
  if r.representative_person_id = private.real_person() then raise exception 'o próprio cuidador não pode dar o aceite' using errcode = '42501'; end if;
  if not private.recent_auth(15) then raise exception 'reautenticação necessária: confirme sua senha' using errcode = 'P0001'; end if;
  update public.care_representations set patient_accepted_at = coalesce(patient_accepted_at, now()), updated_at = now() where id = p_id;
end $$;

-- listas
create or replace function public.my_representations() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_self uuid := private.real_person();
begin
  if v_self is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'patient_person_id', r.patient_person_id, 'patient_name', p.full_name, 'birth_date', p.birth_date, 'kind', r.kind, 'status', r.status,
      'active', private.rep_active(r), 'suspended', r.suspended_at is not null, 'valid_until', r.valid_until,
      'scopes', jsonb_build_object('agenda', r.can_agenda, 'cancel', r.can_cancel, 'train', r.can_train, 'evolution', r.can_evolution, 'billing', r.can_billing, 'consent', r.can_consent, 'ticket', r.can_ticket)) order by p.full_name)
    from public.care_representations r join public.people p on p.id = r.patient_person_id where r.representative_person_id = v_self and r.status <> 'revoked'), '[]'::jsonb);
end $$;
create or replace function public.my_representatives() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid;
begin
  perform private.require_scope('consent'); v_pat := private.current_person();
  if v_pat is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', p.full_name, 'kind', r.kind, 'status', r.status, 'active', private.rep_active(r), 'suspended', r.suspended_at is not null,
      'valid_until', r.valid_until, 'accepted', r.patient_accepted_at is not null, 'can_revoke', r.kind in ('cuidador','delegado')) order by r.created_at)
    from public.care_representations r join public.people p on p.id = r.representative_person_id where r.patient_person_id = v_pat and r.status <> 'revoked'), '[]'::jsonb);
end $$;
create or replace function public.representations_admin_list(p_status text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_org_role(array['manager','ops_admin','unit_manager']::public.app_role[]) and not exists (select 1 from public.role_assignments ra where ra.user_id = (select auth.uid()) and ra.role = 'unit_manager' and ra.revoked_at is null) then
    raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'patient_id', r.patient_person_id, 'patient', pa.full_name, 'birth_date', pa.birth_date, 'representative_id', r.representative_person_id, 'representative', pr.full_name,
      'kind', r.kind, 'status', r.status, 'active', private.rep_active(r), 'suspended_reason', r.suspended_reason, 'valid_until', r.valid_until, 'accepted', r.patient_accepted_at is not null, 'minor_login', r.minor_login_allowed,
      'docs', (select count(*) from public.representation_documents d where d.representation_id = r.id), 'note', r.note, 'created_at', r.created_at,
      'scopes', jsonb_build_object('agenda', r.can_agenda, 'cancel', r.can_cancel, 'train', r.can_train, 'evolution', r.can_evolution, 'billing', r.can_billing, 'consent', r.can_consent, 'ticket', r.can_ticket)) order by r.created_at desc)
    from public.care_representations r join public.people pa on pa.id = r.patient_person_id join public.people pr on pr.id = r.representative_person_id
    where r.org_id = private.current_org() and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], r.unit_id) and (p_status is null or r.status = p_status)), '[]'::jsonb);
end $$;
create or replace function public.representation_document_add(p_representation uuid, p_type text, p_path text) returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.care_representations := private.rep_admin(p_representation); v_id uuid;
begin
  if p_path is null or p_path not like p_representation::text || '/%' then raise exception 'caminho de arquivo inválido'; end if;
  insert into public.representation_documents (org_id, representation_id, doc_type, storage_path, uploaded_by) values (r.org_id, p_representation, p_type, p_path, (select auth.uid())) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- consentimentos
create or replace function public.consent_texts_current() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'version', t.version, 'body', t.body, 'is_draft', t.is_draft) order by t.kind), '[]'::jsonb)
    from public.consent_texts t where t.active and t.version = (select max(x.version) from public.consent_texts x where x.kind = t.kind and x.active)
$$;
create or replace function public.consent_set(p_kind text, p_granted boolean, p_version text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pat uuid; v_text text; v_id uuid; v_h json; v_acting boolean; v_ip text;
begin
  perform private.require_scope('consent'); v_pat := private.current_person();
  if v_pat is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.recent_auth(15) then raise exception 'reautenticação necessária: confirme sua senha' using errcode = 'P0001'; end if;
  select body into v_text from public.consent_texts where kind = p_kind and version = p_version and active;
  if v_text is null then raise exception 'texto de consentimento inexistente ou inativo'; end if;
  v_acting := (private.acting_rep()).id is not null;
  begin v_h := current_setting('request.headers', true)::json; exception when others then v_h := null; end;
  v_ip := coalesce(split_part(v_h ->> 'x-forwarded-for', ',', 1), v_h ->> 'x-real-ip');
  insert into public.consents (org_id, person_id, kind, granted, version, text_snapshot, given_by_user, given_by_person, in_name_of, ip, user_agent)
    values (private.current_org(), v_pat, p_kind, p_granted, p_version, v_text, (select auth.uid()), private.real_person(), v_acting, nullif(btrim(v_ip), ''), left(v_h ->> 'user-agent', 300)) returning id into v_id;
  return v_id;
end $$;
create or replace function public.my_consents() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid;
begin
  perform private.require_scope('consent'); v_pat := private.current_person();
  if v_pat is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'granted', coalesce(c.granted, false), 'version', c.version, 'at', c.at, 'in_name_of', coalesce(c.in_name_of, false)) order by k.kind)
    from (values ('saude'),('imagem_video'),('comunicacao_comercial')) k(kind)
    left join lateral (select x.* from public.consents x where x.person_id = v_pat and x.kind = k.kind order by x.at desc, x.id limit 1) c on true), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- leitura clínica do ADMIN (decisão do proprietário) — sempre registrada
create or replace function public.admin_patient_journey(p_person uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if private.current_org() is null or not private.has_org_role(array['manager']::public.app_role[]) or not exists (select 1 from public.people where id = p_person and org_id = private.current_org()) then
    raise exception 'sem permissão' using errcode = '42501'; end if;
  perform private.log_clinical_access(p_person, 'admin', 'journey');
  return private.journey_payload(p_person, true);
end $$;
-- quem acessou o prontuário: o titular (ou quem o representa com escopo "consent")
create or replace function public.my_access_log() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid;
begin
  perform private.require_scope('consent'); v_pat := private.current_person();
  if v_pat is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'role', l.accessed_by_role, 'scope', l.scope, 'who', coalesce(nullif(btrim(ua.display_name), ''), case l.accessed_by_role when 'admin' then 'Administração' else 'Fisioterapeuta' end)) order by l.at desc)
    from (select * from public.clinical_access_log where person_id = v_pat and org_id = private.current_org() order by at desc limit 100) l left join public.user_accounts ua on ua.user_id = l.accessed_by), '[]'::jsonb);
end $$;
create or replace function public.clinical_access_report(p_person uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_org_role(array['manager']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'role', l.accessed_by_role, 'scope', l.scope, 'who', coalesce(nullif(btrim(ua.display_name), ''), '—')) order by l.at desc)
    from (select * from public.clinical_access_log where person_id = p_person and org_id = private.current_org() order by at desc limit 200) l left join public.user_accounts ua on ua.user_id = l.accessed_by), '[]'::jsonb);
end $$;

-- data de nascimento: o titular informa uma vez (depois, só a equipe corrige) — é ela que define menor/maior
create or replace function public.my_birth_date_set(p_date date) returns void language plpgsql security definer set search_path = '' as $$
declare v_pat uuid;
begin
  perform private.require_scope('consent'); v_pat := private.current_person();
  if v_pat is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_date is null or p_date > current_date or p_date < date '1900-01-01' then raise exception 'data de nascimento inválida'; end if;
  update public.people set birth_date = p_date where id = v_pat and birth_date is null;
  if not found then raise exception 'a data de nascimento já está cadastrada: peça a correção à equipe'; end if;
end $$;

-- ---------------------------------------------------------------- privilégios
revoke all on function public.representation_save(uuid, uuid, uuid, text, jsonb, date, boolean, text), public.representation_verify(uuid, boolean), public.representation_suspend(uuid, text),
  public.representation_unsuspend(uuid), public.representation_suspend_patient(uuid, text), public.representation_revoke(uuid, text), public.my_representation_accept(uuid), public.my_representations(),
  public.my_representatives(), public.representations_admin_list(text), public.representation_document_add(uuid, text, text), public.consent_texts_current(), public.consent_set(text, boolean, text),
  public.my_consents(), public.admin_patient_journey(uuid), public.my_access_log(), public.clinical_access_report(uuid), public.my_birth_date_set(date) from public, anon;
grant execute on function public.representation_save(uuid, uuid, uuid, text, jsonb, date, boolean, text), public.representation_verify(uuid, boolean), public.representation_suspend(uuid, text),
  public.representation_unsuspend(uuid), public.representation_suspend_patient(uuid, text), public.representation_revoke(uuid, text), public.my_representation_accept(uuid), public.my_representations(),
  public.my_representatives(), public.representations_admin_list(text), public.representation_document_add(uuid, text, text), public.consent_texts_current(), public.consent_set(text, boolean, text),
  public.my_consents(), public.admin_patient_journey(uuid), public.my_access_log(), public.clinical_access_report(uuid), public.my_birth_date_set(date) to authenticated;
-- auxiliares internos: só as funções públicas (security definer) os chamam
revoke all on function private.real_person(), private.age_years(date), private.rep_active(public.care_representations), private.rep_scope_defaults(text), private.acting_rep(), private.require_scope(text),
  private.scope_ok(text), private.recent_auth(int), private.has_consent(uuid, text), private.log_clinical_access(uuid, text, text), private.rep_admin(uuid) from public, anon, authenticated;
grant execute on function private.real_person(), private.age_years(date), private.rep_active(public.care_representations), private.acting_rep(), private.require_scope(text), private.scope_ok(text),
  private.recent_auth(int), private.has_consent(uuid, text) to authenticated;
