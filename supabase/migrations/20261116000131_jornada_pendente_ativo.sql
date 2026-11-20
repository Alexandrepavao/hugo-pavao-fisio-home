-- HP Group Hub — 131 Jornada integrada: avaliação agendada → paciente PENDENTE → pagamento confirmado → paciente ATIVO.
-- SUBSTITUI a regra "Venda feita ativa o paciente": marcar a oportunidade como ganha / confirmar a venda NÃO ativa mais ninguém.
-- A ativação depende do RECEBIMENTO confirmado da contratação de acompanhamento (primeira parcela / entrada da própria venda).
--   · uma única pessoa (people) com UM vínculo aberto por organização (patient_enrollments): pendente → ativo; nunca duplica pessoa/paciente;
--   · reaproveita o motor de eventos com retentativa (payment.confirmed / payment.refunded → handler novo) e o modelo financeiro (sales/receivables/payments);
--   · não existe provedor de pagamento no projeto: o recebimento hoje entra por payment_record (manual, só financeiro). Quando um provedor existir, o
--     webhook chamará a MESMA função de registro (payments.provider / external_ref / idempotency_key já existem) e esta regra continua valendo.
-- Escrita só por função; sem GRANT direto nas tabelas.

-- ---------------------------------------------------------------- 1. identificador estável de etapa (não depender do nome exibido)
alter table public.pipeline_stages add column if not exists key text;
create or replace function private.stage_key_for(p_kind text, p_name text) returns text language sql immutable set search_path = '' as $$
  select case when p_kind = 'patients' then case p_name
    when 'Novo contato' then 'new_contact' when 'Atendimento' then 'service' when 'Avaliação agendada' then 'evaluation_scheduled'
    when 'Compareceu' then 'attended' when 'Proposta' then 'proposal' when 'Contratou' then 'hired' end end
$$;
update public.pipeline_stages st set key = private.stage_key_for(pl.kind, st.name)
  from public.pipelines pl where pl.id = st.pipeline_id and st.key is null and private.stage_key_for(pl.kind, st.name) is not null;
create unique index if not exists pipeline_stages_key_uq on public.pipeline_stages (pipeline_id, key) where key is not null;
create or replace function private.pipeline_stage_key_set() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.key is null then new.key := private.stage_key_for((select kind from public.pipelines where id = new.pipeline_id), new.name); end if;
  return new;
end $$;
drop trigger if exists pipeline_stages_key on public.pipeline_stages;
create trigger pipeline_stages_key before insert on public.pipeline_stages for each row execute function private.pipeline_stage_key_set();

-- o agendamento da avaliação move a oportunidade para "Avaliação agendada": agora pela chave estável (com o nome como reserva para funis sem chave)
create or replace function private.h_appt_scheduled(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; a public.appointments;
begin
  select * into e from public.domain_events where id = p_event;
  select * into a from public.appointments where id = e.aggregate_id;
  if a.opportunity_id is not null then
    update public.opportunities o set stage_id = s.id from public.pipeline_stages s
      where o.id = a.opportunity_id and s.pipeline_id = o.pipeline_id and (s.key = 'evaluation_scheduled' or (s.key is null and s.name = 'Avaliação agendada')) and o.status = 'open'
        and s.position > (select position from public.pipeline_stages where id = o.stage_id);
  end if;
end $$;

-- ---------------------------------------------------------------- 2. vínculo do paciente: pendente → ativo (um por pessoa e organização)
create table public.patient_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  professional_id uuid references public.professionals(id) on delete set null,
  evaluation_appointment_id uuid references public.appointments(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'active', 'ended')),
  source text not null default 'evaluation_scheduled' check (source in ('evaluation_scheduled', 'professional_evaluation', 'sale_payment', 'legacy')),
  pending_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz, ended_at timestamptz,
  end_reason text check (end_reason is null or end_reason in ('opportunity_lost', 'manual')),
  activation_sale_id uuid references public.sales(id) on delete set null,
  activation_receivable_id uuid references public.receivables(id) on delete set null,
  activation_payment_id uuid references public.payments(id) on delete set null,
  review_flag text check (review_flag is null or review_flag in ('refund', 'payment_conflict')),     -- sinal para análise administrativa (nunca apaga nada)
  review_note text, review_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((status = 'active') = (activated_at is not null)),
  check ((status = 'ended') = (ended_at is not null))
);
create unique index patient_enrollments_open_uq on public.patient_enrollments (org_id, person_id) where status in ('pending', 'active');
create index patient_enrollments_opp_idx on public.patient_enrollments (opportunity_id);
create index patient_enrollments_prof_idx on public.patient_enrollments (professional_id) where status in ('pending', 'active');
alter table public.patient_enrollments enable row level security;               -- sem política e sem GRANT: leitura e escrita só por função (security definer)
revoke all on public.patient_enrollments from public, anon, authenticated;
create trigger audit_patient_enrollments after insert or update on public.patient_enrollments
  for each row execute function private.audit_row('status', 'professional_id', 'review_flag', 'activation_sale_id', 'end_reason');

-- o vínculo assistencial (acesso clínico da fisioterapeuta responsável) nasce com o vínculo pendente e é revogado quando ele é encerrado
alter table public.care_relationships add column if not exists enrollment_id uuid references public.patient_enrollments(id) on delete set null;

-- paciente ATIVO legado (já tinha pacote ativo antes desta regra): estado preservado, ganha um vínculo ativo
insert into public.patient_enrollments (org_id, unit_id, person_id, status, source, activated_at)
  select distinct on (cp.org_id, cp.person_id) cp.org_id, cp.unit_id, cp.person_id, 'active', 'legacy', coalesce(cp.created_at, now())
    from public.client_packages cp where cp.status = 'active' and cp.person_id is not null order by cp.org_id, cp.person_id, cp.created_at
  on conflict do nothing;

-- ---------------------------------------------------------------- 3. auxiliares
create or replace function private.person_is_active_patient(p_org uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.patient_enrollments where org_id = p_org and person_id = p_person and status = 'active')
      or exists (select 1 from public.client_packages where org_id = p_org and person_id = p_person and status = 'active')
$$;

-- vínculo assistencial da profissional responsável (idempotente)
create or replace function private.enrollment_link_care(p_enrollment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.patient_enrollments; v_user uuid;
begin
  select * into e from public.patient_enrollments where id = p_enrollment;
  if not found or e.professional_id is null or e.unit_id is null then return; end if;
  select user_id into v_user from public.professionals where id = e.professional_id;
  if v_user is null then return; end if;
  insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id, enrollment_id)
    values (e.org_id, e.unit_id, v_user, e.person_id, e.id)
    on conflict (professional_user_id, person_id) where revoked_at is null do nothing;
end $$;

-- contratação de acompanhamento = venda com item de pacote ou plano (avaliação/consulta avulsa e cursos NÃO contam)
create or replace function private.sale_is_care_contract(p_sale uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sale_items si join public.products p on p.id = si.product_id where si.sale_id = p_sale and p.kind in ('package', 'plan'))
$$;

-- condição financeira: a PRIMEIRA PARCELA (entrada prevista na própria venda) quitada, líquida de estornos. Devolve a parcela quando atendida.
create or replace function private.sale_first_installment_paid(p_sale uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.receivables r
   where r.sale_id = p_sale and r.installment_no = 1 and r.status <> 'cancelled' and r.amount_cents > 0
     and private.receivable_net(r.id) >= r.amount_cents
$$;

-- ---------------------------------------------------------------- 4. entrada: oportunidade do tipo Paciente em "Avaliação agendada" → vínculo pendente (idempotente, com trava por pessoa)
create or replace function private.enrollment_ensure(p_opp uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.opportunities; e public.patient_enrollments; v_appt uuid; v_prof uuid; v_unit uuid; v_id uuid;
begin
  select * into o from public.opportunities where id = p_opp;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('enrollment:' || o.org_id::text || ':' || o.person_id::text, 0));
  select a.id, a.professional_id, a.unit_id into v_appt, v_prof, v_unit from public.appointments a
   where a.opportunity_id = o.id and a.status in ('scheduled', 'confirmed', 'attended') order by lower(a.period) desc limit 1;
  select * into e from public.patient_enrollments where org_id = o.org_id and person_id = o.person_id and status in ('pending', 'active');
  if found then
    if e.status = 'pending' then                                              -- reaproveita o pendente: só completa o que faltava (nada duplica)
      update public.patient_enrollments set
          opportunity_id = case when e.opportunity_id is not null and exists (select 1 from public.opportunities x where x.id = e.opportunity_id and x.status = 'open') then e.opportunity_id else o.id end,
          professional_id = coalesce(e.professional_id, v_prof), evaluation_appointment_id = coalesce(e.evaluation_appointment_id, v_appt),
          unit_id = coalesce(e.unit_id, v_unit, o.unit_id), updated_at = now()
        where id = e.id;
      perform private.enrollment_link_care(e.id);
    end if;
    return e.id;                                                              -- paciente ATIVO: estado preservado
  end if;
  if private.person_is_active_patient(o.org_id, o.person_id) then return null; end if;
  insert into public.patient_enrollments (org_id, unit_id, person_id, opportunity_id, professional_id, evaluation_appointment_id, source)
    values (o.org_id, coalesce(v_unit, o.unit_id), o.person_id, o.id, v_prof, v_appt, 'evaluation_scheduled') returning id into v_id;
  perform private.enrollment_link_care(v_id);
  insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary)
    values (o.org_id, o.person_id, o.unit_id, o.id, 'system', 'Paciente pendente: avaliação agendada (aguarda confirmação do pagamento para ativar o acompanhamento)');
  return v_id;
end $$;

-- saída: oportunidade perdida sem contratação paga encerra o vínculo PENDENTE (nunca o ativo, nunca com outra oportunidade válida, nunca com pagamento confirmado)
create or replace function private.enrollment_on_lost(p_opp uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.opportunities; e public.patient_enrollments; v_other uuid;
begin
  select * into o from public.opportunities where id = p_opp;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('enrollment:' || o.org_id::text || ':' || o.person_id::text, 0));
  select * into e from public.patient_enrollments where org_id = o.org_id and person_id = o.person_id and status = 'pending';
  if not found then return; end if;                                           -- ativo (ou sem vínculo): nada a encerrar
  if e.opportunity_id is not null and e.opportunity_id <> o.id then return; end if;   -- o vínculo pertence a outra oportunidade
  select x.id into v_other from public.opportunities x join public.pipelines pl on pl.id = x.pipeline_id
   where x.org_id = o.org_id and x.person_id = o.person_id and x.id <> o.id and x.status = 'open' and pl.kind = 'patients' limit 1;
  if v_other is not null then                                                 -- há outra oportunidade válida: o vínculo continua, agora nela
    update public.patient_enrollments set opportunity_id = v_other, updated_at = now() where id = e.id; return;
  end if;
  if exists (select 1 from public.sales s join public.receivables r on r.sale_id = s.id
              where s.org_id = o.org_id and s.person_id = o.person_id and s.status = 'confirmed' and private.sale_is_care_contract(s.id) and private.receivable_net(r.id) > 0) then
    update public.patient_enrollments set review_flag = 'payment_conflict', review_at = now(),
        review_note = 'Oportunidade marcada como perdida, mas existe recebimento confirmado da contratação: decisão administrativa necessária.', updated_at = now() where id = e.id;
    return;
  end if;
  update public.patient_enrollments set status = 'ended', ended_at = now(), end_reason = 'opportunity_lost', updated_at = now() where id = e.id;
  update public.care_relationships set revoked_at = now() where enrollment_id = e.id and revoked_at is null;                       -- revoga o acesso clínico criado por este vínculo
  update public.invitations set revoked_at = now() where person_id = e.person_id and accepted_at is null and revoked_at is null;   -- convite antigo não reativa o acesso
  insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary)
    values (o.org_id, o.person_id, o.unit_id, o.id, 'system', 'Vínculo de paciente pendente encerrado: oportunidade perdida sem contratação paga');
end $$;

create or replace function private.opp_enrollment_sync() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_key text;
begin
  select kind into v_kind from public.pipelines where id = new.pipeline_id;
  if v_kind is distinct from 'patients' then return new; end if;               -- só tipo Paciente (parceiros, Academy, empresas ficam de fora)
  if new.status = 'open' then
    select key into v_key from public.pipeline_stages where id = new.stage_id;
    if v_key = 'evaluation_scheduled' then perform private.enrollment_ensure(new.id); end if;
  elsif new.status = 'lost' and (tg_op = 'INSERT' or old.status is distinct from 'lost') then
    perform private.enrollment_on_lost(new.id);
  end if;
  return new;
end $$;
drop trigger if exists opp_enrollment_sync on public.opportunities;
create trigger opp_enrollment_sync after insert or update of stage_id, status on public.opportunities for each row execute function private.opp_enrollment_sync();

-- ---------------------------------------------------------------- 5. ativação por PAGAMENTO confirmado (substitui "Venda feita")
-- Pacote e saldo: só quando a primeira parcela da PRÓPRIA venda está quitada (idempotente por venda+produto).
create or replace function private.sale_packages_release(p_sale uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sales; it record; pk uuid;
begin
  select * into s from public.sales where id = p_sale;
  for it in select si.product_id, si.qty, p.sessions_count, p.validity_days from public.sale_items si join public.products p on p.id = si.product_id
             where si.sale_id = s.id and p.kind = 'package' and p.sessions_count is not null loop
    insert into public.client_packages (org_id, unit_id, person_id, product_id, sale_id, total_sessions, valid_until)
      values (s.org_id, s.unit_id, s.person_id, it.product_id, s.id, it.sessions_count * it.qty, case when it.validity_days is not null then current_date + it.validity_days end)
      on conflict (sale_id, product_id) where sale_id is not null do nothing returning id into pk;
    if pk is not null then insert into public.session_ledger (org_id, client_package_id, delta, reason, note) values (s.org_id, pk, it.sessions_count * it.qty, 'grant', 'Venda ' || s.id); end if;
    pk := null;
  end loop;
end $$;

create or replace function private.enrollment_activate(p_sale uuid, p_receivable uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.sales; e public.patient_enrollments; v_pay uuid; v_id uuid;
begin
  select * into s from public.sales where id = p_sale;
  perform pg_advisory_xact_lock(hashtextextended('enrollment:' || s.org_id::text || ':' || s.person_id::text, 0));
  select id into v_pay from public.payments where receivable_id = p_receivable and kind = 'payment' order by paid_at, created_at limit 1;
  select * into e from public.patient_enrollments where org_id = s.org_id and person_id = s.person_id and status in ('pending', 'active') for update;
  if not found then
    insert into public.patient_enrollments (org_id, unit_id, person_id, opportunity_id, status, source, activated_at, activation_sale_id, activation_receivable_id, activation_payment_id)
      values (s.org_id, s.unit_id, s.person_id, s.opportunity_id, 'active', 'sale_payment', now(), s.id, p_receivable, v_pay) returning id into v_id;
  elsif e.status = 'pending' then
    update public.patient_enrollments set status = 'active', activated_at = now(), activation_sale_id = s.id, activation_receivable_id = p_receivable, activation_payment_id = v_pay,
        review_flag = case when review_flag = 'payment_conflict' then null else review_flag end, updated_at = now() where id = e.id returning id into v_id;
    insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary)
      values (s.org_id, s.person_id, s.unit_id, s.opportunity_id, 'system', 'Acompanhamento ativado: primeira parcela da contratação confirmada');
  else
    v_id := e.id;                                                              -- já ativo: continua (uma nova venda paga só libera o pacote dela)
  end if;
  insert into public.person_kinds (person_id, kind) values (s.person_id, 'patient') on conflict do nothing;
  return v_id;
end $$;

-- reavalia a venda a partir do ESTADO financeiro atual (não do evento): serve a duplicados, fora de ordem, retentativas e reconciliação
create or replace function private.enrollment_evaluate(p_sale uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare s public.sales; v_rec uuid; e public.patient_enrollments;
begin
  select * into s from public.sales where id = p_sale;
  if not found or s.status <> 'confirmed' or not private.sale_is_care_contract(s.id) then return 'ignored'; end if;
  v_rec := private.sale_first_installment_paid(s.id);
  if v_rec is null then
    -- condição deixou de valer (estorno/chargeback): sinaliza para análise; NÃO apaga conta, prontuário nem acompanhamento em curso
    select * into e from public.patient_enrollments where org_id = s.org_id and person_id = s.person_id and status = 'active' and activation_sale_id = s.id;
    if found and e.review_flag is distinct from 'refund' then
      update public.patient_enrollments set review_flag = 'refund', review_at = now(),
          review_note = 'A primeira parcela da contratação deixou de estar quitada (estorno ou ajuste financeiro). Análise administrativa necessária; nada foi apagado.', updated_at = now() where id = e.id;
      insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary)
        values (s.org_id, s.person_id, s.unit_id, s.opportunity_id, 'system', 'Estorno na contratação: sinalizado para análise administrativa (acompanhamento mantido)');
    end if;
    return 'waiting';
  end if;
  perform private.sale_packages_release(s.id);
  perform private.enrollment_activate(s.id, v_rec);
  update public.patient_enrollments set review_flag = null, review_note = null, review_at = null, updated_at = now()   -- pagamento regularizado: limpa o sinal de estorno
   where org_id = s.org_id and person_id = s.person_id and status = 'active' and activation_sale_id = s.id and review_flag = 'refund';
  return 'active';
end $$;

create or replace function private.h_payment_enrollment(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; v_sale uuid;
begin
  select * into e from public.domain_events where id = p_event;
  v_sale := nullif(e.payload ->> 'sale_id', '')::uuid;
  if v_sale is null then return; end if;
  perform private.enrollment_evaluate(v_sale);
end $$;
insert into private.event_handlers values ('payment.confirmed', 'h_payment_enrollment'), ('payment.refunded', 'h_payment_enrollment') on conflict do nothing;

-- "Venda feita" (confirmar a venda / oportunidade ganha) NÃO ativa mais: gera contrato, parcelas e a etapa do CRM; pacote, saldo e o tipo "paciente" esperam o pagamento.
create or replace function private.h_sale_confirmed(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; s public.sales; parts bigint[]; i int; v_prod uuid; v_kind text;
begin
  select * into e from public.domain_events where id = p_event;
  select * into s from public.sales where id = e.aggregate_id;
  insert into public.contracts (org_id, sale_id, person_id, starts_on) values (s.org_id, s.id, s.person_id, s.first_due) on conflict (sale_id) do nothing;
  select product_id into v_prod from public.sale_items where sale_id = s.id order by unit_price_cents desc limit 1;
  parts := private.split_cents(s.total_cents, s.installments);
  for i in 1..s.installments loop
    insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents)
      values (s.org_id, s.unit_id, s.id, s.person_id, v_prod, i, s.installments, (s.first_due + make_interval(months => i - 1))::date,
              date_trunc('month', s.first_due + make_interval(months => i - 1))::date, parts[i]) on conflict (sale_id, installment_no) do nothing;
  end loop;
  -- cursos e mentorias: mantém o registro de "aluno" (acesso segue a regra do produto, migration de Academy)
  insert into public.person_kinds (person_id, kind)
    select s.person_id, 'student'::public.person_kind from public.sale_items si join public.products p on p.id = si.product_id
     where si.sale_id = s.id and p.kind in ('course', 'mentoring') on conflict do nothing;
  -- vendas de consulta/avaliação avulsa (sem pacote/plano): continuam registrando o tipo paciente como antes (não é contratação de acompanhamento)
  insert into public.person_kinds (person_id, kind)
    select s.person_id, 'patient'::public.person_kind from public.sale_items si join public.products p on p.id = si.product_id
     where si.sale_id = s.id and p.kind = 'service' and not private.sale_is_care_contract(s.id) on conflict do nothing;
  if s.opportunity_id is not null then
    select pl.kind into v_kind from public.opportunities o join public.pipelines pl on pl.id = o.pipeline_id where o.id = s.opportunity_id;
    update public.opportunities o set stage_id = st.id, value_cents = s.total_cents
      from public.pipeline_stages st where o.id = s.opportunity_id and st.pipeline_id = o.pipeline_id and o.status = 'open'
       and ((v_kind = 'education' and st.name = 'Pagamento') or (v_kind <> 'education' and st.kind = 'won'));
  end if;
  insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary) values (s.org_id, s.person_id, s.unit_id, s.opportunity_id, 'system', 'Venda confirmada (' || s.total_cents / 100 || ',' || lpad((s.total_cents % 100)::text, 2, '0') || ')');
  perform private.enrollment_evaluate(s.id);                                  -- caso a primeira parcela já esteja quitada (ex.: entrada à vista registrada antes)
end $$;

-- ---------------------------------------------------------------- 6. leitura e reconciliação (funções)
create or replace function private.enrollment_payment_state(p_org uuid, p_person uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare e public.patient_enrollments;
begin
  select * into e from public.patient_enrollments where org_id = p_org and person_id = p_person and status in ('pending', 'active') limit 1;
  if found and e.status = 'active' then return 'confirmed'; end if;
  if exists (select 1 from public.sales s where s.org_id = p_org and s.person_id = p_person and s.status = 'confirmed' and private.sale_is_care_contract(s.id)) then return 'awaiting'; end if;
  return 'no_contract';
end $$;

-- estado do vínculo (sem dado clínico): quem atende, comercial, financeiro e gestão veem; a pessoa vê o próprio em my_enrollment
create or replace function public.enrollment_for_person(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); e public.patient_enrollments; v_prof text;
begin
  if v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into e from public.patient_enrollments where org_id = v_org and person_id = p_person order by (status = 'ended'), created_at desc limit 1;
  if not found then return jsonb_build_object('status', 'none', 'payment', private.enrollment_payment_state(v_org, p_person)); end if;
  if not (private.has_care_relationship(p_person) or private.has_org_role(array['manager', 'ops_admin']::public.app_role[])
          or (e.unit_id is not null and private.has_unit_role(array['unit_manager', 'sales', 'finance']::public.app_role[], e.unit_id))) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select display_name into v_prof from public.professionals where id = e.professional_id;
  return jsonb_build_object('id', e.id, 'status', e.status, 'source', e.source, 'pending_at', e.pending_at, 'activated_at', e.activated_at, 'ended_at', e.ended_at,
    'professional', v_prof, 'professional_id', e.professional_id, 'evaluation_appointment_id', e.evaluation_appointment_id, 'review_flag', e.review_flag, 'review_note', e.review_note,
    'payment', private.enrollment_payment_state(v_org, p_person));
end $$;

-- a própria pessoa: pendente/ativo e se o pagamento está aguardado (sem valores)
create or replace function public.my_enrollment() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_org uuid := private.current_org(); e public.patient_enrollments;
begin
  if v_person is null then return jsonb_build_object('status', 'none'); end if;
  select * into e from public.patient_enrollments where org_id = v_org and person_id = v_person and status in ('pending', 'active') limit 1;
  if not found then return jsonb_build_object('status', 'none'); end if;
  return jsonb_build_object('status', e.status, 'activated_at', e.activated_at, 'payment', private.enrollment_payment_state(v_org, v_person));
end $$;

-- reconciliação: refaz a avaliação de UMA venda (ou de todas as vendas de acompanhamento sem ativação). Idempotente; financeiro/gestão.
create or replace function public.enrollment_reconcile(p_sale uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); s record; n int := 0; v_res text;
begin
  if v_org is null or not (private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) or exists (select 1 from public.units u where u.org_id = v_org and private.can_finance(u.id))) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  for s in select id from public.sales where org_id = v_org and status = 'confirmed' and (p_sale is null or id = p_sale) loop
    v_res := private.enrollment_evaluate(s.id); if v_res = 'active' then n := n + 1; end if;
  end loop;
  return jsonb_build_object('evaluated_active', n);
end $$;

-- ---------------------------------------------------------------- 7. privilégios
revoke all on function private.enrollment_ensure(uuid), private.enrollment_on_lost(uuid), private.enrollment_activate(uuid, uuid), private.enrollment_evaluate(uuid), private.sale_packages_release(uuid),
  private.enrollment_link_care(uuid), private.h_payment_enrollment(uuid), private.opp_enrollment_sync() from public, anon, authenticated;
revoke all on function public.enrollment_for_person(uuid), public.my_enrollment(), public.enrollment_reconcile(uuid) from public, anon;
grant execute on function public.enrollment_for_person(uuid), public.my_enrollment(), public.enrollment_reconcile(uuid) to authenticated;
