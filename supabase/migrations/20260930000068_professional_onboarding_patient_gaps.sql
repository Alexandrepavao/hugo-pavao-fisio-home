-- Jornadas Fisioterapeuta e Paciente — fechamento das lacunas encontradas na auditoria do código (docs/jornadas-fisioterapeuta-paciente-crm.md).
-- Aditiva (funções novas, uma coluna, dois gatilhos de auditoria) + 3 funções redefinidas (mesma assinatura): on_auth_user_confirmed, patient_plan_save, my_renewal_request.
--
-- FISIOTERAPEUTA
--  * professional_save: cadastro do profissional reaproveitando a PESSOA do cadastro central (ou criando-a), registro no conselho, unidades (várias) e situação.
--  * professional_availability_save/_remove: disponibilidade semanal editável, sem sobreposição do mesmo profissional.
--  * professional_grant_access: convite (com vínculo pessoa/profissional) ou, se a conta já existe, vínculo imediato — o convite aceito passa a ligar profissionals.user_id.
--  * my_professional_summary: resumo individual (agendados, realizados, cancelamentos, faltas do paciente, faltas do profissional, pacientes atendidos) e repasses autorizados com dados reais.
-- PACIENTE
--  * my_package_breakdown: contratadas, realizadas, consumidas por falta, consumidas por cancelamento tardio, devolvidas, ajustes e saldo — separados, a partir do livro de sessões.
--  * patient_plan_save: a quantidade de sessões passa a ser SEMPRE definida pelo profissional (acaba o “10 por padrão” silencioso).
--  * my_renewal_request: o pedido de RENOVAÇÃO só existe quando o fisioterapeuta orientou continuidade/manutenção na reavaliação; “falar com a equipe” continua livre.

alter table public.invitations add column if not exists professional_id uuid references public.professionals(id) on delete set null;

create trigger audit_professionals after insert or update or delete on public.professionals
  for each row execute function private.audit_row('display_name','council_registration','active','user_id','person_id');
create trigger audit_availability_rules after insert or update or delete on public.availability_rules
  for each row execute function private.audit_row('professional_id','weekday','start_time','end_time','valid_from','valid_until');

-- ---------------------------------------------------------------- convite aceito liga o profissional à conta
create or replace function private.on_auth_user_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_inv record;
  v_boot record;
begin
  -- Somente identidades com e-mail verificado.
  if new.email_confirmed_at is null or new.email is null then return new; end if;

  -- 1) Bootstrap de gestor: e-mail verificado presente na allowlist, ainda não consumido.
  select * into v_boot from private.manager_bootstrap_emails b
   where b.consumed_at is null and b.email = new.email::extensions.citext
   for update skip locked limit 1;
  if found then
    insert into public.user_accounts (user_id, org_id) values (new.id, v_boot.org_id)
      on conflict (user_id) do nothing;
    insert into public.role_assignments (org_id, user_id, role, granted_by)
      values (v_boot.org_id, new.id, 'manager', null)
      on conflict do nothing;
    update private.manager_bootstrap_emails set consumed_at = now(), consumed_by = new.id
     where org_id = v_boot.org_id and email = v_boot.email;
    insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, changed_columns)
      values (v_boot.org_id, new.id, 'bootstrap_manager', 'user', new.id::text, array['role']);
    return new;
  end if;

  if exists (select 1 from public.user_accounts where user_id = new.id) then return new; end if;

  -- 2) Convites abertos para este e-mail verificado.
  for v_inv in
    select * from public.invitations
     where email = new.email::extensions.citext and accepted_at is null and revoked_at is null and expires_at > now()
     order by created_at
  loop
    insert into public.user_accounts (user_id, org_id, person_id)
      values (new.id, v_inv.org_id, v_inv.person_id)
      on conflict (user_id) do nothing;
    insert into public.role_assignments (org_id, user_id, role, unit_id, granted_by)
      values (v_inv.org_id, new.id, v_inv.role, v_inv.unit_id, v_inv.invited_by)
      on conflict do nothing;
    update public.invitations set accepted_at = now() where id = v_inv.id;
    -- convite de profissional: liga o cadastro profissional (já existente) à conta criada
    if v_inv.professional_id is not null then
      update public.professionals set user_id = new.id where id = v_inv.professional_id and user_id is null and not exists (select 1 from public.professionals x where x.user_id = new.id);
    end if;
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------- cadastro do profissional
create or replace function public.professional_save(p_id uuid, p_person uuid, p_name text, p_registration text, p_units uuid[], p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid := p_id; v_person uuid := p_person; v_name text := nullif(btrim(coalesce(p_name, '')), ''); v_reg text := nullif(btrim(coalesce(p_registration, '')), '');
        v_cur public.professionals; v_pname text; r record;
begin
  if v_org is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_units is null or cardinality(p_units) = 0 then raise exception 'informe ao menos uma unidade de atendimento'; end if;
  if exists (select 1 from unnest(p_units) u where not exists (select 1 from public.units where id = u and org_id = v_org and active)) then raise exception 'unidade inválida'; end if;
  if v_reg is not null and length(v_reg) not between 3 and 40 then raise exception 'registro profissional inválido (3 a 40 caracteres, ex.: CREFITO-3 123456-F)'; end if;
  if v_person is not null then
    select full_name into v_pname from public.people where id = v_person and org_id = v_org and merged_into_id is null;
    if not found then raise exception 'pessoa não encontrada no cadastro central'; end if;
    v_name := coalesce(v_name, v_pname);
  end if;
  if v_id is null then
    if v_person is null and v_name is null then raise exception 'escolha uma pessoa já cadastrada ou informe o nome'; end if;
    if length(v_name) < 2 then raise exception 'nome inválido'; end if;
    if v_person is not null and exists (select 1 from public.professionals where person_id = v_person) then raise exception 'esta pessoa já está cadastrada como profissional'; end if;
    if v_person is null then
      insert into public.people (org_id, unit_id, full_name, created_by) values (v_org, p_units[1], v_name, (select auth.uid())) returning id into v_person;
    end if;
    insert into public.person_kinds (person_id, kind) values (v_person, 'staff') on conflict do nothing;
    insert into public.professionals (org_id, person_id, display_name, council_registration, active) values (v_org, v_person, v_name, v_reg, coalesce(p_active, true)) returning id into v_id;
  else
    select * into v_cur from public.professionals where id = v_id and org_id = v_org for update;
    if not found then raise exception 'profissional não encontrado'; end if;
    if v_person is not null and v_cur.person_id is not null and v_cur.person_id <> v_person then raise exception 'este profissional já está ligado a outra pessoa do cadastro'; end if;
    if v_person is not null then insert into public.person_kinds (person_id, kind) values (v_person, 'staff') on conflict do nothing; end if;
    update public.professionals set display_name = coalesce(v_name, display_name), person_id = coalesce(person_id, v_person), council_registration = v_reg, active = coalesce(p_active, active) where id = v_id;
  end if;
  insert into public.professional_units (professional_id, unit_id) select v_id, u from unnest(p_units) u on conflict do nothing;
  for r in select pu.unit_id from public.professional_units pu where pu.professional_id = v_id and not (pu.unit_id = any (p_units)) loop
    if exists (select 1 from public.appointments a where a.professional_id = v_id and a.unit_id = r.unit_id and a.status in ('scheduled','confirmed') and lower(a.period) > now()) then
      raise exception 'há atendimentos futuros nesta unidade: remarque ou cancele antes de retirá-la do profissional';
    end if;
    delete from public.professional_units where professional_id = v_id and unit_id = r.unit_id;
    delete from public.availability_rules where professional_id = v_id and unit_id = r.unit_id;
  end loop;
  return v_id;
end $$;

-- ---------------------------------------------------------------- disponibilidade
create or replace function public.professional_availability_save(p_id uuid, p_professional uuid, p_unit uuid, p_weekday int, p_start time, p_end time, p_valid_from date default null, p_valid_until date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid := p_id;
begin
  if v_org is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.professionals where id = p_professional and org_id = v_org) then raise exception 'profissional não encontrado'; end if;
  if not exists (select 1 from public.professional_units where professional_id = p_professional and unit_id = p_unit) then raise exception 'o profissional não atende nesta unidade'; end if;
  if p_weekday is null or p_weekday not between 0 and 6 then raise exception 'dia da semana inválido'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'o horário final precisa ser depois do inicial'; end if;
  if p_valid_from is not null and p_valid_until is not null and p_valid_until < p_valid_from then raise exception 'a validade final precisa ser depois da inicial'; end if;
  if exists (select 1 from public.availability_rules r where r.professional_id = p_professional and r.weekday = p_weekday and (v_id is null or r.id <> v_id)
               and r.start_time < p_end and r.end_time > p_start
               and coalesce(r.valid_from, date '-infinity') <= coalesce(p_valid_until, date 'infinity') and coalesce(r.valid_until, date 'infinity') >= coalesce(p_valid_from, date '-infinity')) then
    raise exception 'este horário se sobrepõe a outra disponibilidade do mesmo profissional';
  end if;
  if v_id is null then
    insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time, valid_from, valid_until) values (v_org, p_professional, p_unit, p_weekday, p_start, p_end, p_valid_from, p_valid_until) returning id into v_id;
  else
    update public.availability_rules set unit_id = p_unit, weekday = p_weekday, start_time = p_start, end_time = p_end, valid_from = p_valid_from, valid_until = p_valid_until where id = v_id and professional_id = p_professional and org_id = v_org;
    if not found then raise exception 'disponibilidade não encontrada'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.professional_availability_remove(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.current_org() is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  delete from public.availability_rules where id = p_id and org_id = private.current_org();
  if not found then raise exception 'disponibilidade não encontrada'; end if;
end $$;

-- ---------------------------------------------------------------- acesso do profissional (convite ou vínculo imediato)
create or replace function public.professional_grant_access(p_professional uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_email text := lower(btrim(coalesce(p_email, ''))); pr public.professionals; v_user uuid; v_n int := 0; r record;
begin
  if v_org is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
  select * into pr from public.professionals where id = p_professional and org_id = v_org for update;
  if not found then raise exception 'profissional não encontrado'; end if;
  if not pr.active then raise exception 'profissional inativo: reative antes de liberar o acesso'; end if;
  if not exists (select 1 from public.professional_units where professional_id = pr.id) then raise exception 'cadastre ao menos uma unidade antes de liberar o acesso'; end if;
  select u.id into v_user from auth.users u join public.user_accounts ua on ua.user_id = u.id and ua.org_id = v_org
   where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is not null then
    if pr.user_id is not null and pr.user_id <> v_user then raise exception 'este profissional já está ligado a outra conta'; end if;
    if exists (select 1 from public.professionals where user_id = v_user and id <> pr.id) then raise exception 'esta conta já está ligada a outro profissional'; end if;
    for r in select unit_id from public.professional_units where professional_id = pr.id loop
      insert into public.role_assignments (org_id, user_id, role, unit_id, granted_by) values (v_org, v_user, 'physio', r.unit_id, (select auth.uid())) on conflict do nothing;
    end loop;
    update public.professionals set user_id = v_user where id = pr.id;
    update public.user_accounts set person_id = coalesce(person_id, pr.person_id) where user_id = v_user;
    return jsonb_build_object('status', 'linked');
  end if;
  for r in select unit_id from public.professional_units where professional_id = pr.id loop
    if not exists (select 1 from public.invitations where email = v_email::extensions.citext and role = 'physio' and unit_id = r.unit_id and accepted_at is null and revoked_at is null and expires_at > now()) then
      insert into public.invitations (org_id, email, role, unit_id, person_id, professional_id, invited_by) values (v_org, v_email, 'physio', r.unit_id, pr.person_id, pr.id, (select auth.uid()));
      v_n := v_n + 1;
    else
      update public.invitations set professional_id = pr.id, person_id = coalesce(person_id, pr.person_id)
       where email = v_email::extensions.citext and role = 'physio' and unit_id = r.unit_id and accepted_at is null and revoked_at is null and expires_at > now();
    end if;
  end loop;
  return jsonb_build_object('status', 'invited', 'invitations', v_n);
end $$;

-- ---------------------------------------------------------------- resumo individual do profissional
create or replace function public.my_professional_summary(p_from date default null, p_to date default null, p_professional uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.current_org(); pr public.professionals; v_from date := coalesce(p_from, date_trunc('month', now())::date); v_to date := coalesce(p_to, current_date);
        v_counts jsonb; v_self boolean; v_rules int; v_ent jsonb; v_auth bigint := 0; v_paid bigint := 0; v_any boolean := false;
begin
  if v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_to < v_from or v_to - v_from > 731 then raise exception 'período inválido (máximo de 2 anos)'; end if;
  if p_professional is null then select * into pr from public.professionals where user_id = v_uid and org_id = v_org; else select * into pr from public.professionals where id = p_professional and org_id = v_org; end if;
  if not found then raise exception 'perfil profissional não encontrado' using errcode = 'P0002'; end if;
  v_self := pr.user_id = v_uid;
  if not v_self and not private.can_view_prof_agenda(pr.id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select jsonb_build_object(
    'scheduled', count(*) filter (where b.status in ('scheduled','confirmed') and lower(b.period) > now()),
    'awaiting_record', count(*) filter (where b.status in ('scheduled','confirmed') and lower(b.period) <= now()),
    'attended', count(*) filter (where b.status = 'attended'),
    'cancelled_by_patient', count(*) filter (where b.status = 'cancelled_by_patient'),
    'cancelled_by_clinic', count(*) filter (where b.status = 'cancelled_by_clinic'),
    'rescheduled', count(*) filter (where b.status = 'rescheduled'),
    'patient_no_show', count(*) filter (where b.status = 'no_show'),
    'professional_no_show', count(*) filter (where b.status = 'professional_no_show'),
    'patients_attended', count(distinct b.person_id) filter (where b.status = 'attended'),
    'total', count(*)) into v_counts
  from public.appointments b join public.units u on u.id = b.unit_id
  where b.professional_id = pr.id and b.org_id = v_org and (lower(b.period) at time zone u.timezone)::date between v_from and v_to
    and (v_self or private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], b.unit_id));
  if v_self and pr.user_id is not null then
    select count(*) into v_rules from public.commission_rules where org_id = v_org and active and beneficiary_user_id = pr.user_id;
    select coalesce(sum(amount_cents) filter (where status = 'authorized'), 0), coalesce(sum(amount_cents) filter (where status = 'paid'), 0), count(*) > 0 into v_auth, v_paid, v_any
      from public.commission_entries where beneficiary_user_id = pr.user_id and status in ('authorized','paid') and (created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
    select coalesce(jsonb_agg(jsonb_build_object('at', created_at, 'amount_cents', amount_cents, 'status', status) order by created_at desc), '[]') into v_ent
      from (select created_at, amount_cents, status from public.commission_entries where beneficiary_user_id = pr.user_id and status in ('authorized','paid')
              and (created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to order by created_at desc limit 20) x;
  end if;
  return jsonb_build_object('professional_id', pr.id, 'professional_name', pr.display_name, 'is_self', v_self, 'from', v_from, 'to', v_to, 'counts', v_counts,
    'payouts', case when not v_self then jsonb_build_object('visible', false, 'basis', 'repasses só aparecem para o próprio profissional')
                    else jsonb_build_object('visible', true, 'rules', coalesce(v_rules, 0), 'authorized_cents', v_auth, 'paid_cents', v_paid, 'entries', coalesce(v_ent, '[]'::jsonb),
                           'available', (coalesce(v_rules, 0) > 0 or v_any),
                           'basis', case when coalesce(v_rules, 0) = 0 and not v_any then 'nenhuma regra de repasse cadastrada para você e nenhum repasse autorizado ou pago no período'
                                         else 'repasses AUTORIZADOS e PAGOS gerados pelas regras de comissão em seu nome (pendentes de autorização não entram)' end) end);
end $$;

-- ---------------------------------------------------------------- paciente: sessões separadas (contratadas, realizadas, faltas, cancelamentos tardios, devolvidas, saldo)
create or replace function public.my_package_breakdown() returns jsonb
language sql stable security definer set search_path = '' as $$
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
    where cp.person_id = private.current_person() and cp.org_id = private.current_org()
    group by cp.id, pr.name
  ) x
$$;

-- ---------------------------------------------------------------- plano: quantidade definida pelo profissional (sem padrão silencioso)
create or replace function public.patient_plan_save(p_person uuid, p_planned_sessions int default null, p_client_package uuid default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_unit uuid := private.require_care(p_person); v_id uuid; v_n int := p_planned_sessions;
begin
  if v_n is null then raise exception 'informe a quantidade de sessões do plano: ela é definida pelo fisioterapeuta na avaliação (não há quantidade padrão)'; end if;
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

-- ---------------------------------------------------------------- renovação conforme a orientação do fisioterapeuta
create or replace function public.my_renewal_request(p_kind text default 'contato', p_message text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_unit uuid; v_id uuid; v_last text;
begin
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
end $$;

-- ---------------------------------------------------------------- privilégios
revoke all on function public.professional_save(uuid, uuid, text, text, uuid[], boolean), public.professional_availability_save(uuid, uuid, uuid, int, time, time, date, date),
  public.professional_availability_remove(uuid), public.professional_grant_access(uuid, text), public.my_professional_summary(date, date, uuid), public.my_package_breakdown(),
  public.patient_plan_save(uuid, int, uuid, text), public.my_renewal_request(text, text) from public, anon;
grant execute on function public.professional_save(uuid, uuid, text, text, uuid[], boolean), public.professional_availability_save(uuid, uuid, uuid, int, time, time, date, date),
  public.professional_availability_remove(uuid), public.professional_grant_access(uuid, text), public.my_professional_summary(date, date, uuid), public.my_package_breakdown(),
  public.patient_plan_save(uuid, int, uuid, text), public.my_renewal_request(text, text) to authenticated;
