-- HP Group Hub — 009 Endurecimento de EXECUTE + parceiros, indicações, repasses, pesquisas e contratos corporativos

-- ---------------------------------------------------------------- endurecimento: anon só executa as RPCs públicas
revoke execute on all functions in schema public from public, anon;
grant execute on function public.get_public_page(text), public.track_page_visit(uuid, text, jsonb, text), public.submit_public_form(uuid, jsonb, jsonb, text, text) to anon;

-- ---------------------------------------------------------------- evento de oportunidade ganha
create or replace function private.opportunity_won_emit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.emit_event(new.org_id, 'opportunity.won', 'opportunity', new.id, jsonb_build_object('person_id', new.person_id), 'opportunity.won:' || new.id);
  return null;
end $$;
create trigger opportunity_won after update on public.opportunities
  for each row when (new.status = 'won' and old.status is distinct from 'won') execute function private.opportunity_won_emit();

-- ---------------------------------------------------------------- parceiros
create table public.partner_profiles (
  person_id uuid primary key references public.people(id) on delete cascade,
  org_id uuid not null, unit_id uuid references public.units(id) on delete set null,
  specialty text, council_registration text, bio text,
  status text not null default 'onboarding' check (status in ('onboarding','active','inactive')),
  onboarding jsonb not null default '{"contrato":false,"formacao":false,"integracao":false}',
  approved_at timestamptz, created_at timestamptz not null default now()
);

-- Aprovação (etapa final do funil de parceiros): perfil ativo + tipo "parceiro" + convite de acesso ao portal (por e-mail verificado)
create or replace function private.h_opp_won_partner(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; o public.opportunities; v_kind text; v_email text;
begin
  select * into e from public.domain_events where id = p_event;
  select * into o from public.opportunities where id = e.aggregate_id;
  select kind into v_kind from public.pipelines where id = o.pipeline_id;
  if v_kind <> 'partners' then return; end if;
  insert into public.partner_profiles (person_id, org_id, unit_id, status, approved_at) values (o.person_id, o.org_id, o.unit_id, 'active', now())
    on conflict (person_id) do update set status = 'active', approved_at = coalesce(public.partner_profiles.approved_at, now());
  insert into public.person_kinds (person_id, kind) values (o.person_id, 'partner') on conflict do nothing;
  select value into v_email from public.person_contacts where person_id = o.person_id and type = 'email' order by is_primary desc limit 1;
  if v_email is not null and not exists (select 1 from public.user_accounts where person_id = o.person_id) then
    insert into public.invitations (org_id, email, role, person_id) select o.org_id, v_email, 'partner', o.person_id
      where not exists (select 1 from public.invitations i where i.person_id = o.person_id and i.role = 'partner' and i.accepted_at is null and i.revoked_at is null);
  end if;
end $$;
insert into private.event_handlers values ('opportunity.won','h_opp_won_partner');

create table public.referral_codes (
  person_id uuid primary key references public.people(id) on delete cascade,
  org_id uuid not null, code text not null unique, created_at timestamptz not null default now()
);
create table public.referrals (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid,
  referrer_person_id uuid not null references public.people(id) on delete cascade,
  referred_person_id uuid not null references public.people(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  direction text not null default 'inbound' check (direction in ('inbound','outbound')),
  code text, created_at timestamptz not null default now(),
  check (referrer_person_id <> referred_person_id),
  unique (referrer_person_id, referred_person_id, opportunity_id)
);

create or replace function public.referral_code_get() returns text
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_code text;
begin
  if v_person is null then raise exception 'sem cadastro de pessoa' using errcode = '42501'; end if;
  select code into v_code from public.referral_codes where person_id = v_person;
  if v_code is null then
    insert into public.referral_codes (person_id, org_id, code) values (v_person, private.current_org(), lower(substr(md5(gen_random_uuid()::text), 1, 8))) returning code into v_code;
  end if;
  return v_code;
end $$;

-- Indicação rastreável: landing page aberta com ?ref=CODIGO; ao enviar o formulário, o evento vincula quem indicou.
create or replace function private.h_form_referral(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; s public.form_submissions; c public.referral_codes; o public.opportunities;
begin
  select * into e from public.domain_events where id = p_event;
  select * into s from public.form_submissions where id = e.aggregate_id;
  if coalesce(s.utm ->> 'ref', '') = '' then return; end if;
  select * into c from public.referral_codes where code = lower(s.utm ->> 'ref') and org_id = s.org_id;
  if not found or c.person_id = s.person_id then return; end if;
  select * into o from public.opportunities where id = s.opportunity_id;
  insert into public.referrals (org_id, unit_id, referrer_person_id, referred_person_id, opportunity_id, code) values (s.org_id, o.unit_id, c.person_id, s.person_id, s.opportunity_id, c.code)
    on conflict do nothing;
end $$;
insert into private.event_handlers values ('form.submitted','h_form_referral');

-- O parceiro vê apenas etapa e primeiro nome (sem dados de contato ou clínicos)
create or replace function public.partner_my_referrals() returns table (referral_id uuid, created_at timestamptz, first_name text, stage_name text, status text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.created_at, split_part(p.full_name, ' ', 1), s.name, o.status
  from public.referrals r join public.people p on p.id = r.referred_person_id
  left join public.opportunities o on o.id = r.opportunity_id left join public.pipeline_stages s on s.id = o.stage_id
  where r.referrer_person_id = private.current_person()
  order by r.created_at desc
$$;

create table public.partner_payouts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  unit_id uuid not null references public.units(id) on delete restrict,
  partner_person_id uuid not null references public.people(id) on delete restrict,
  description text not null, amount_cents bigint not null check (amount_cents > 0),
  reference_month date not null default date_trunc('month', current_date)::date,
  status text not null default 'pending' check (status in ('pending','authorized','paid','cancelled')),
  created_by uuid references auth.users(id) on delete set null, authorized_by uuid, paid_at timestamptz,
  created_at timestamptz not null default now()
);
create or replace function public.payout_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.partner_payouts;
begin
  select * into p from public.partner_payouts where id = p_id and org_id = private.current_org() for update;
  if not found or not private.can_finance(p.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_status = 'authorized' and p.status = 'pending' then update public.partner_payouts set status = 'authorized', authorized_by = (select auth.uid()) where id = p_id;
  elsif p_status = 'paid' and p.status = 'authorized' then update public.partner_payouts set status = 'paid', paid_at = now() where id = p_id;
  elsif p_status = 'cancelled' and p.status in ('pending','authorized') then update public.partner_payouts set status = 'cancelled' where id = p_id;
  else raise exception 'transição inválida (% -> %)', p.status, p_status; end if;
end $$;

-- ---------------------------------------------------------------- pesquisas de satisfação
create table public.surveys (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, kind text not null default 'nps' check (kind in ('nps','csat')), active boolean not null default true
);
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  survey_id uuid not null references public.surveys(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  score smallint not null check (score between 0 and 10), comment text check (length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (survey_id, person_id, appointment_id)
);
insert into public.surveys (org_id, name, kind) select id, 'Satisfação após atendimento', 'nps' from public.organizations where slug = 'hp-group';

create or replace function public.survey_submit(p_survey uuid, p_appointment uuid, p_score smallint, p_comment text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); sv public.surveys; a public.appointments; v_id uuid;
begin
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
end $$;

-- ---------------------------------------------------------------- contratos corporativos (indicadores só agregados)
create table public.corporate_accounts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  name text not null, sale_id uuid references public.sales(id) on delete set null, active boolean not null default true
);
create table public.corporate_members (
  account_id uuid not null references public.corporate_accounts(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade, primary key (account_id, person_id)
);
-- k-anonimato: com menos de 5 participantes nada é devolvido; nunca há dado individual nem clínico.
create or replace function public.corporate_indicators(p_account uuid) returns table (members int, attended_sessions int, avg_score numeric)
language plpgsql stable security definer set search_path = '' as $$
declare a public.corporate_accounts; n int;
begin
  select * into a from public.corporate_accounts where id = p_account and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager','ops_admin','unit_manager','finance']::public.app_role[], a.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select count(*) into n from public.corporate_members where account_id = p_account;
  if n < 5 then return query select null::int, null::int, null::numeric; return; end if;
  return query select n,
    (select count(*)::int from public.appointments ap join public.corporate_members m on m.person_id = ap.person_id and m.account_id = p_account where ap.status = 'attended'),
    (select round(avg(sr.score), 1) from public.survey_responses sr join public.corporate_members m on m.person_id = sr.person_id and m.account_id = p_account);
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.partner_profiles enable row level security; alter table public.referral_codes enable row level security; alter table public.referrals enable row level security;
alter table public.partner_payouts enable row level security; alter table public.surveys enable row level security; alter table public.survey_responses enable row level security;
alter table public.corporate_accounts enable row level security; alter table public.corporate_members enable row level security;

grant select, update on public.partner_profiles to authenticated;
grant select on public.referral_codes, public.referrals, public.survey_responses to authenticated;
grant select, insert on public.partner_payouts to authenticated;
grant select, insert, update on public.surveys, public.corporate_accounts to authenticated;
grant select, insert, delete on public.corporate_members to authenticated;

create policy pp_read on public.partner_profiles for select to authenticated using (private.in_org(org_id) and (person_id = private.current_person() or private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[])));
create policy pp_update on public.partner_profiles for update to authenticated using (private.in_org(org_id) and (person_id = private.current_person() or private.has_org_role(array['manager','ops_admin']::public.app_role[]))) with check (private.in_org(org_id));
create policy rc_read on public.referral_codes for select to authenticated using (person_id = private.current_person() or private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy ref_read on public.referrals for select to authenticated using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));
create policy payouts_read on public.partner_payouts for select to authenticated using (private.in_org(org_id) and (private.can_finance(unit_id) or (partner_person_id = private.current_person() and status in ('authorized','paid'))));
create policy payouts_insert on public.partner_payouts for insert to authenticated with check (private.in_org(org_id) and created_by = (select auth.uid()) and private.can_finance(unit_id) and status = 'pending');
create policy surveys_read on public.surveys for select to authenticated using (private.in_org(org_id));
create policy surveys_write on public.surveys for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy surveys_update on public.surveys for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[])) with check (private.in_org(org_id));
create policy sr_read on public.survey_responses for select to authenticated using (private.in_org(org_id) and (person_id = private.current_person() or private.has_org_role(array['manager','ops_admin']::public.app_role[]) or exists (select 1 from public.people p where p.id = person_id and private.has_unit_role(array['unit_manager']::public.app_role[], p.unit_id))));
create policy ca_read on public.corporate_accounts for select to authenticated using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','finance']::public.app_role[], unit_id));
create policy ca_write on public.corporate_accounts for insert to authenticated with check (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], unit_id));
create policy ca_update on public.corporate_accounts for update to authenticated using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], unit_id)) with check (private.in_org(org_id));
create policy cmb_read on public.corporate_members for select to authenticated using (exists (select 1 from public.corporate_accounts a where a.id = account_id));
create policy cmb_write on public.corporate_members for insert to authenticated with check (exists (select 1 from public.corporate_accounts a where a.id = account_id and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], a.unit_id)));
create policy cmb_delete on public.corporate_members for delete to authenticated using (exists (select 1 from public.corporate_accounts a where a.id = account_id and private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], a.unit_id)));

grant execute on function public.referral_code_get(), public.partner_my_referrals(), public.payout_set_status(uuid, text), public.survey_submit(uuid, uuid, smallint, text), public.corporate_indicators(uuid) to authenticated;
