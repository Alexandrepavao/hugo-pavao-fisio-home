-- HP Group Hub — 102 Portais F7: retenção, LTV e ofertas decididas pelo ADMIN (check-in semanal, programas, "próximo passo", indicadores de gestão).
-- Regras (plano §4.4): o ADMIN decide tudo — cria o programa, define o preço (produto ligado) e escolhe a quem oferecer; o fisio não indica nem aprova. Só recebe oferta quem deu o consentimento de comunicação
-- comercial (097) e a oferta guarda o critério usado. "Tenho interesse" apenas cria tarefa para a equipe: NENHUMA cobrança, venda ou consumo automáticos. Linguagem descritiva, sem promessa de resultado.

create table public.weekly_checkins (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, person_id uuid not null references public.people(id) on delete cascade, week_start date not null,
  pain smallint not null check (pain between 0 and 10), function_score smallint not null check (function_score between 0 and 10), wellbeing smallint not null check (wellbeing between 0 and 10),
  note text check (note is null or length(note) <= 500), submitted_by uuid references auth.users(id) on delete set null, in_name_of boolean not null default false, created_at timestamptz not null default clock_timestamp(), idem_key text,
  unique (person_id, week_start)
);
create unique index weekly_checkins_idem_uq on public.weekly_checkins (submitted_by, idem_key) where idem_key is not null;

create table public.care_programs (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, title text not null check (length(btrim(title)) between 3 and 120), summary text check (summary is null or length(summary) <= 300),
  details text check (details is null or length(details) <= 3000), product_id uuid references public.products(id) on delete set null,
  criteria jsonb not null default '{}'::jsonb,                      -- filtros SUGERIDOS ao admin: plan_status (completed|maintenance|active), min_attended, max_days_since_last, specialty
  active boolean not null default true, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table public.program_offers (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid not null references public.units(id) on delete restrict, program_id uuid not null references public.care_programs(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade, status text not null default 'offered' check (status in ('offered','interested','accepted','declined','withdrawn')),
  basis jsonb not null default '{}'::jsonb,                          -- o critério/sinais usados pelo admin ao decidir (auditável)
  note text check (note is null or length(note) <= 500), offered_by uuid references auth.users(id) on delete set null, offered_at timestamptz not null default now(), responded_at timestamptz, expires_at timestamptz
);
create unique index program_offers_open_uq on public.program_offers (program_id, person_id) where status in ('offered','interested');
create index program_offers_person_idx on public.program_offers (person_id, status);
alter table public.weekly_checkins enable row level security; alter table public.care_programs enable row level security; alter table public.program_offers enable row level security;     -- sem GRANT: tudo por função
create trigger audit_program_offers after insert or update on public.program_offers for each row execute function private.audit_row('status','program_id');

create or replace function private.offer_admin() returns boolean language sql stable security definer set search_path = '' as $$ select private.has_org_role(array['manager','ops_admin']::public.app_role[]) $$;
-- segunda-feira da semana (fuso de São Paulo)
create or replace function private.week_start_sp() returns date language sql stable set search_path = '' as $$ select date_trunc('week', private.today_sp()::timestamp)::date $$;
create or replace function private.checkin_due(p_person uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select (exists (select 1 from public.patient_plans pl where pl.person_id = p_person and pl.status = 'active' and pl.started_on <= private.today_sp() - 3)
       or exists (select 1 from public.exercise_prescriptions ep where ep.person_id = p_person and ep.status = 'active' and ep.starts_on <= private.today_sp() - 3))
     and not exists (select 1 from public.weekly_checkins c where c.person_id = p_person and c.week_start = private.week_start_sp())
$$;

-- ---------------------------------------------------------------- check-in semanal (paciente ou quem o representa com escopo "train")
create or replace function public.my_checkin_submit(p_pain int, p_function int, p_wellbeing int, p_note text default null, p_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid; v_id uuid; v_unit uuid; v_acting boolean;
begin
  perform private.require_scope('train'); v_person := private.current_person();
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_pain is null or p_function is null or p_wellbeing is null or p_pain not between 0 and 10 or p_function not between 0 and 10 or p_wellbeing not between 0 and 10 then raise exception 'responda as três notas de 0 a 10'; end if;
  if p_key is not null then select id into v_id from public.weekly_checkins where submitted_by = (select auth.uid()) and idem_key = p_key; if v_id is not null then return v_id; end if; end if;
  select id into v_id from public.weekly_checkins where person_id = v_person and week_start = private.week_start_sp(); if v_id is not null then return v_id; end if;
  v_acting := (private.acting_rep()).id is not null; select unit_id into v_unit from public.people where id = v_person;
  insert into public.weekly_checkins (org_id, person_id, week_start, pain, function_score, wellbeing, note, submitted_by, in_name_of, idem_key)
    values (private.current_org(), v_person, private.week_start_sp(), p_pain, p_function, p_wellbeing, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()), v_acting, p_key) returning id into v_id;
  if v_unit is not null then perform private.measurement_insert(v_person, v_unit, 'nprs', null, null, p_pain, 'assessment', null, 'check-in semanal', null, 'patient', null); end if;   -- a dor do check-in entra na mesma série
  return v_id;
end $$;
create or replace function public.my_checkins() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid;
begin
  perform private.require_scope('train'); v_person := private.current_person();
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object('due', private.checkin_due(v_person), 'history', coalesce((select jsonb_agg(jsonb_build_object('week_start', c.week_start, 'pain', c.pain, 'function', c.function_score, 'wellbeing', c.wellbeing, 'note', c.note) order by c.week_start desc)
    from (select * from public.weekly_checkins x where x.person_id = v_person order by x.week_start desc limit 12) c), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- programas e ofertas (admin)
create or replace function public.program_save(p_id uuid, p_title text, p_summary text default null, p_details text default null, p_product uuid default null, p_criteria jsonb default '{}'::jsonb, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if private.current_org() is null or not private.offer_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'dê um nome ao programa'; end if;
  if p_product is not null and not exists (select 1 from public.products where id = p_product and org_id = private.current_org()) then raise exception 'produto inválido'; end if;
  if p_id is null then
    insert into public.care_programs (org_id, title, summary, details, product_id, criteria, active, created_by) values (private.current_org(), btrim(p_title), nullif(btrim(coalesce(p_summary, '')), ''), nullif(btrim(coalesce(p_details, '')), ''), p_product, coalesce(p_criteria, '{}'), coalesce(p_active, true), (select auth.uid())) returning id into v_id;
  else
    update public.care_programs set title = btrim(p_title), summary = nullif(btrim(coalesce(p_summary, '')), ''), details = nullif(btrim(coalesce(p_details, '')), ''), product_id = p_product, criteria = coalesce(p_criteria, '{}'), active = coalesce(p_active, true)
     where id = p_id and org_id = private.current_org() returning id into v_id;
    if v_id is null then raise exception 'programa não encontrado'; end if;
  end if;
  return v_id;
end $$;
create or replace function public.programs_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.offer_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'summary', g.summary, 'details', g.details, 'product_id', g.product_id, 'product', p.name, 'price_cents', p.price_cents, 'criteria', g.criteria, 'active', g.active,
      'offered', (select count(*) from public.program_offers o where o.program_id = g.id), 'interested', (select count(*) from public.program_offers o where o.program_id = g.id and o.status = 'interested'),
      'accepted', (select count(*) from public.program_offers o where o.program_id = g.id and o.status = 'accepted')) order by g.active desc, g.title)
    from public.care_programs g left join public.products p on p.id = g.product_id where g.org_id = private.current_org()), '[]'::jsonb);
end $$;
-- sugestão de a quem oferecer: SÓ o gestor (dono) vê, porque usa sinais clínicos (situação do plano, adesão). A decisão de oferecer continua sendo do admin, uma pessoa por vez.
create or replace function public.program_candidates(p_program uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g public.care_programs; c jsonb;
begin
  if not private.has_org_role(array['manager']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into g from public.care_programs where id = p_program and org_id = private.current_org(); if g.id is null then raise exception 'programa não encontrado'; end if; c := g.criteria;
  return coalesce((select jsonb_agg(x order by (x ->> 'days_since_last')::int nulls last) from (
    select jsonb_build_object('person_id', pe.id, 'name', pe.full_name, 'plan_status', case when pl.maintenance and pl.status = 'active' then 'maintenance' else pl.status end, 'attended', (select count(*) from public.appointments a where a.person_id = pe.id and a.status = 'attended'),
        'days_since_last', (select (private.today_sp() - (max(lower(a.period)) at time zone 'America/Sao_Paulo')::date) from public.appointments a where a.person_id = pe.id and a.status = 'attended'),
        'specialty', pl.specialty, 'week_pct', (private.training_summary(pe.id) ->> 'week_pct')::int, 'has_open_offer', exists (select 1 from public.program_offers o where o.person_id = pe.id and o.program_id = g.id and o.status in ('offered','interested'))) x
      from public.people pe join lateral (select * from public.patient_plans p2 where p2.person_id = pe.id order by (p2.status = 'active') desc, p2.created_at desc limit 1) pl on true
     where pe.org_id = private.current_org() and pe.merged_into_id is null and private.has_consent(pe.id, 'comunicacao_comercial')
       and not exists (select 1 from public.program_offers o where o.person_id = pe.id and o.program_id = g.id and (o.status in ('offered','interested','accepted') or (o.status = 'declined' and o.responded_at > now() - interval '90 days')))
       and (c ->> 'plan_status' is null or (case when pl.maintenance and pl.status = 'active' then 'maintenance' else pl.status end) = c ->> 'plan_status')
       and (c ->> 'specialty' is null or pl.specialty = c ->> 'specialty')
       and (c ->> 'min_attended' is null or (select count(*) from public.appointments a where a.person_id = pe.id and a.status = 'attended') >= (c ->> 'min_attended')::int)
       and (c ->> 'max_days_since_last' is null or coalesce((select (private.today_sp() - (max(lower(a.period)) at time zone 'America/Sao_Paulo')::date) from public.appointments a where a.person_id = pe.id and a.status = 'attended'), 99999) <= (c ->> 'max_days_since_last')::int)
     limit 200) q), '[]'::jsonb);
end $$;
create or replace function public.program_offer_create(p_program uuid, p_person uuid, p_note text default null, p_expires_on date default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare g public.care_programs; v_unit uuid; v_id uuid; v_basis jsonb;
begin
  if private.current_org() is null or not private.offer_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into g from public.care_programs where id = p_program and org_id = private.current_org() and active; if g.id is null then raise exception 'programa inexistente ou inativo'; end if;
  select unit_id into v_unit from public.people where id = p_person and org_id = private.current_org() and merged_into_id is null; if v_unit is null then raise exception 'paciente não encontrado'; end if;
  if not private.has_consent(p_person, 'comunicacao_comercial') then raise exception 'este paciente não deu consentimento para receber propostas'; end if;
  if exists (select 1 from public.program_offers where program_id = p_program and person_id = p_person and status in ('offered','interested')) then raise exception 'já existe uma oferta aberta deste programa para o paciente'; end if;
  if p_expires_on is not null and p_expires_on < private.today_sp() then raise exception 'a validade não pode estar no passado'; end if;
  v_basis := jsonb_build_object('criteria', g.criteria, 'decided_by_role', 'admin', 'plan_status', (select case when pl.maintenance and pl.status = 'active' then 'maintenance' else pl.status end from public.patient_plans pl where pl.person_id = p_person order by (pl.status = 'active') desc, pl.created_at desc limit 1),
    'attended', (select count(*) from public.appointments a where a.person_id = p_person and a.status = 'attended'));
  insert into public.program_offers (org_id, unit_id, program_id, person_id, basis, note, offered_by, expires_at) values (private.current_org(), v_unit, p_program, p_person, v_basis, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()), p_expires_on::timestamptz) returning id into v_id;
  return v_id;
end $$;
create or replace function public.program_offer_set_status(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.offer_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_status not in ('accepted','withdrawn','declined') then raise exception 'situação inválida'; end if;
  update public.program_offers set status = p_status, responded_at = coalesce(responded_at, now()) where id = p_id and org_id = private.current_org();
  if not found then raise exception 'oferta não encontrada'; end if;
end $$;
create or replace function public.offers_admin_list(p_status text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.offer_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'program', g.title, 'person_id', o.person_id, 'patient', pe.full_name, 'status', o.status, 'offered_at', o.offered_at, 'responded_at', o.responded_at, 'note', o.note, 'basis', o.basis) order by o.offered_at desc)
    from (select * from public.program_offers x where x.org_id = private.current_org() and (p_status is null or x.status = p_status) order by x.offered_at desc limit 300) o join public.care_programs g on g.id = o.program_id join public.people pe on pe.id = o.person_id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- paciente: "Próximo passo para você" (só com consentimento comercial; escopo "billing" para quem representa)
create or replace function private.offers_payload(p_person uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.has_consent(p_person, 'comunicacao_comercial') then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', g.title, 'summary', g.summary, 'details', g.details, 'status', o.status, 'price_cents', pr.price_cents, 'expires_at', o.expires_at) order by o.offered_at desc)
    from public.program_offers o join public.care_programs g on g.id = o.program_id left join public.products pr on pr.id = g.product_id
   where o.person_id = p_person and o.org_id = private.current_org() and o.status in ('offered','interested') and g.active and (o.expires_at is null or o.expires_at > now())), '[]'::jsonb) end
$$;
create or replace function public.my_offers() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid;
begin
  perform private.require_scope('billing'); v_person := private.current_person();
  if v_person is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return private.offers_payload(v_person);
end $$;
create or replace function public.my_offer_respond(p_id uuid, p_interested boolean) returns void language plpgsql security definer set search_path = '' as $$
declare v_person uuid; o public.program_offers;
begin
  perform private.require_scope('billing'); v_person := private.current_person();
  select * into o from public.program_offers where id = p_id and person_id = v_person and org_id = private.current_org();
  if o.id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.status not in ('offered','interested') then raise exception 'esta oferta já foi encerrada'; end if;
  update public.program_offers set status = case when p_interested then 'interested' else 'declined' end, responded_at = now() where id = p_id;
  if p_interested then   -- apenas avisa a equipe: sem cobrança, venda ou consumo automáticos
    insert into public.crm_tasks (org_id, unit_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (o.org_id, o.unit_id, o.person_id, private.pick_owner(o.org_id, o.unit_id), 'follow_up', 'Paciente tem interesse no programa “' || (select title from public.care_programs where id = o.program_id) || '” — entrar em contato', 'offer:' || o.id) on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------- indicadores de gestão (agregados; o gestor/adm vê números, não prontuário)
create or replace function public.retention_kpis(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from date := coalesce(p_from, private.today_sp() - 89); v_to date := coalesce(p_to, private.today_sp()); v_org uuid := private.current_org(); v_dec jsonb; v_off jsonb; v_cycle jsonb; v_att jsonb;
begin
  if v_org is null or not private.offer_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select jsonb_build_object('decisions', count(*), 'continuity', count(*) filter (where decision in ('continuidade','manutencao')), 'discharged', count(*) filter (where decision = 'alta'),
      'renewal_rate', case when count(*) = 0 then null else round(100.0 * count(*) filter (where decision in ('continuidade','manutencao')) / count(*), 1) end) into v_dec
    from public.patient_reassessments where org_id = v_org and (decided_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
  select jsonb_build_object('offered', count(*), 'interested', count(*) filter (where status in ('interested','accepted')), 'accepted', count(*) filter (where status = 'accepted'), 'declined', count(*) filter (where status = 'declined'),
      'conversion_rate', case when count(*) = 0 then null else round(100.0 * count(*) filter (where status = 'accepted') / count(*), 1) end) into v_off
    from public.program_offers where org_id = v_org and (offered_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
  -- segundo ciclo: pacientes com 2+ planos; tempo até a recompra: dias entre o fim de um plano e a venda seguinte do mesmo paciente
  select jsonb_build_object('patients_with_2_plus_plans', count(*) filter (where n >= 2), 'patients_with_plans', count(*)) into v_cycle from (select person_id, count(*) n from public.patient_plans where org_id = v_org group by person_id) z;
  select jsonb_build_object('avg_attended_per_patient', case when count(*) = 0 then null else round(avg(n), 1) end, 'patients', count(*)) into v_att
    from (select person_id, count(*) n from public.appointments where org_id = v_org and status = 'attended' and (lower(period) at time zone 'America/Sao_Paulo')::date between v_from and v_to group by person_id) z;
  return jsonb_build_object('from', v_from, 'to', v_to, 'reassessments', v_dec, 'offers', v_off, 'cycles', v_cycle, 'attendance', v_att,
    'at_risk', (select count(*) from public.patient_plans pl where pl.org_id = v_org and pl.status = 'active'
        and not exists (select 1 from public.appointments a where a.person_id = pl.person_id and a.status in ('scheduled','confirmed') and lower(a.period) > now())
        and coalesce((select max(lower(a.period)) from public.appointments a where a.person_id = pl.person_id and a.status = 'attended'), pl.started_on::timestamptz) < now() - interval '21 days'),
    'checkin_rate', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where exists (select 1 from public.weekly_checkins c where c.person_id = z.person_id and c.week_start = private.week_start_sp())) / count(*), 1) end
        from (select distinct pl.person_id from public.patient_plans pl where pl.org_id = v_org and pl.status = 'active' and pl.started_on <= private.today_sp() - 3) z));
end $$;

-- redefinições (definições ATUAIS + check-in e ofertas)
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
    'unread_msgs', (select count(*) from public.care_messages m where m.person_id = v_person and m.sender <> 'patient' and m.created_at > now() - interval '7 days'),
    'training', case when r.id is null or r.can_train then private.training_summary(v_person) end,
    'checkin_due', (r.id is null or r.can_train) and private.checkin_due(v_person),
    'offers', case when (r.id is null and coalesce(private.age_years(v_p.birth_date), 18) >= 18) or r.can_billing then private.offers_payload(v_person) else '[]'::jsonb end
  );
end $$;

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
    union all
    select 'dor_subindo', w.person_id, format('Dor %s/10 durante o treino em %s', max(w.pain_during), to_char(max(w.done_on), 'DD/MM')), 0
      from public.workout_logs w join mine m on m.person_id = w.person_id where w.org_id = v_org and not w.skipped and w.pain_during >= 7 and w.done_on > private.today_sp() - 7 group by w.person_id
    union all
    select 'adesao_baixa', pr.person_id, format('%s de %s treinos nos últimos 7 dias', (select count(distinct l.done_on) from public.workout_logs l where l.prescription_id = pr.id and not l.skipped and l.done_on > private.today_sp() - 7), pr.weekly_target), 2
      from public.exercise_prescriptions pr join mine m on m.person_id = pr.person_id
     where pr.org_id = v_org and pr.professional_user_id = v_uid and pr.status = 'active' and pr.starts_on <= private.today_sp() - 7
       and (select count(distinct l.done_on) from public.workout_logs l where l.prescription_id = pr.id and not l.skipped and l.done_on > private.today_sp() - 7) < pr.weekly_target * 0.5
    union all
    select 'dor_subindo', c.person_id, format('Check-in da semana: dor %s/10, bem-estar %s/10', c.pain, c.wellbeing), 0
      from public.weekly_checkins c join mine m on m.person_id = c.person_id where c.org_id = v_org and c.week_start >= private.week_start_sp() - 7 and (c.pain >= 8 or c.wellbeing <= 3)
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

revoke all on function public.my_checkin_submit(int, int, int, text, text), public.my_checkins(), public.program_save(uuid, text, text, text, uuid, jsonb, boolean), public.programs_list(), public.program_candidates(uuid),
  public.program_offer_create(uuid, uuid, text, date), public.program_offer_set_status(uuid, text), public.offers_admin_list(text), public.my_offers(), public.my_offer_respond(uuid, boolean),
  public.retention_kpis(date, date), public.my_home(), public.prof_home() from public, anon;
grant execute on function public.my_checkin_submit(int, int, int, text, text), public.my_checkins(), public.program_save(uuid, text, text, text, uuid, jsonb, boolean), public.programs_list(), public.program_candidates(uuid),
  public.program_offer_create(uuid, uuid, text, date), public.program_offer_set_status(uuid, text), public.offers_admin_list(text), public.my_offers(), public.my_offer_respond(uuid, boolean),
  public.retention_kpis(date, date), public.my_home(), public.prof_home() to authenticated;
revoke all on function private.offers_payload(uuid), private.offer_admin(), private.week_start_sp(), private.checkin_due(uuid) from public, anon, authenticated;
