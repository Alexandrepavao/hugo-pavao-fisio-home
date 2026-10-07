-- HP Group Hub — 062 Central de pendências administrativas (Administrativo): indicadores acionáveis + fluxo mínimo de pendências, documentos e contratos.
-- Fontes REAIS reaproveitadas: people / legal_entities / person_kinds / person_contacts (cadastros e vínculos), professionals (+ professional_units, availability_rules, user_accounts),
-- waitlist (solicitação de agendamento — NÃO é "toda pessoa sem consulta"), client_packages + session_ledger + appointments (pacote próximo do fim), invitations, role_assignments,
-- legal_entity_documents (documentos de PJ, estendido). Contratos de venda (`contracts`), de conta corporativa (`corporate_contracts`) e de receita recorrente NÃO servem como contrato
-- administrativo (não têm estado de assinatura; recorrente é receita) — por isso `adm_contracts` é novo e mínimo. Registrar assinatura é um REGISTRO MANUAL, não assinatura eletrônica.
-- Tudo novo: RLS ligada e NENHUM GRANT — toda leitura/escrita passa por função com checagem de permissão e escopo de unidade (private.can_adm / adm_scope_units).
-- Nada clínico: nenhuma função lê avaliações, objetivos ou respostas de saúde. Nada é inventado: sem base → `available:false` com o motivo.

-- ================================================================ configuração (prazos e requisitos, reaproveitáveis no white label)
create table public.adm_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  expiring_days int not null default 30 check (expiring_days between 1 and 365),             -- janela de "vencendo" (documentos, contratos, papéis)
  package_low_sessions int not null default 2 check (package_low_sessions between 1 and 50),  -- pacote "próximo do fim": saldo <= N sessões
  waiting_alert_days int not null default 7 check (waiting_alert_days between 1 and 180),     -- solicitação de agendamento "esperando demais"
  pendency_due_days jsonb not null default '{}'::jsonb,                                       -- prazo padrão por tipo, em dias (ex.: {"documento":7,"integracao_profissional":14}); ausente = 7
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);
insert into public.adm_settings (org_id) select id from public.organizations on conflict do nothing;

create table public.adm_doc_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(btrim(label)) between 2 and 80),
  applies_to text not null check (applies_to in ('pf','pj')),
  has_expiry boolean not null default true,        -- tipo que vence (o documento precisa de data de validade para ser acompanhado)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

-- Requisito por tipo de cadastro/vínculo: applies_to = 'pf' | 'pj' | 'professional' | vínculo (lead, patient, student, partner, staff, contact, supplier).
-- check_type: 'field' (dado do cadastro), 'document' (tipo de documento vigente) ou 'contract' (contrato administrativo assinado e vigente).
create table public.adm_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  applies_to text not null check (applies_to in ('pf','pj','professional','lead','patient','student','partner','staff','contact','supplier')),
  check_type text not null check (check_type in ('field','document','contract')),
  check_ref text not null,
  label text not null check (length(btrim(label)) between 2 and 100),
  required boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, applies_to, check_type, check_ref)
);
-- Padrão = exatamente o critério de "cadastro incompleto" que o Administrativo já usava (documento, cidade, UF, contato) + os pré-requisitos operacionais do profissional.
-- São configuração editável (Administrativo › Requisitos), não dado.
insert into public.adm_requirements (org_id, applies_to, check_type, check_ref, label)
select o.id, v.a, 'field', v.r, v.l from public.organizations o cross join (values
  ('pf','document','Documento (CPF)'), ('pf','city','Cidade'), ('pf','state','UF'), ('pf','contact','Contato'),
  ('pj','document','CNPJ'), ('pj','city','Cidade'), ('pj','state','UF'), ('pj','contact','E-mail geral ou telefone'),
  ('professional','council_registration','Registro no conselho'), ('professional','unit','Vinculado a uma unidade'),
  ('professional','access','Acesso ao sistema ativo'), ('professional','availability','Disponibilidade de agenda cadastrada')) v(a, r, l)
on conflict do nothing;

-- ================================================================ documentos de PF (PJ reaproveita legal_entity_documents)
create table public.person_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  doc_type_id uuid not null references public.adm_doc_types(id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 160),
  reference text,
  issued_on date, expires_on date, notes text,
  registered_by uuid references auth.users(id) on delete set null, registered_at timestamptz not null default now(),
  removed_at timestamptz, removed_by uuid references auth.users(id) on delete set null,
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index person_documents_person_idx on public.person_documents (person_id) where removed_at is null;
alter table public.legal_entity_documents
  add column doc_type_id uuid references public.adm_doc_types(id) on delete restrict, add column reference text, add column issued_on date, add column expires_on date,
  add column notes text, add column removed_at timestamptz, add column removed_by uuid references auth.users(id) on delete set null;
alter table public.legal_entity_documents alter column storage_path drop not null;     -- registro sem arquivo (o arquivo é opcional nesta etapa)

-- ================================================================ contratos administrativos (registro mínimo; assinatura registrada manualmente)
create table public.adm_contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  kind text not null check (kind in ('prestacao_servico','parceria','termo_uso','confidencialidade','outro')),
  title text not null check (length(btrim(title)) between 2 and 160),
  subject_type text not null check (subject_type in ('person','legal_entity')),
  subject_id uuid not null,
  responsible_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','awaiting_signature','signed','cancelled')),
  starts_on date, ends_on date, due_date date,                   -- due_date = prazo para a assinatura
  sent_at timestamptz, sent_by uuid references auth.users(id) on delete set null,
  signed_on date, signed_registered_at timestamptz, signed_registered_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz, cancel_reason text, notes text,
  created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index adm_contracts_subject_idx on public.adm_contracts (subject_type, subject_id);
create table public.adm_contract_events (
  id bigint generated always as identity primary key,
  contract_id uuid not null references public.adm_contracts(id) on delete cascade,
  at timestamptz not null default now(), actor uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created','sent','signed','cancelled','assigned','noted')), note text
);

-- ================================================================ pendências administrativas (registro, responsável, prazo, status, resolução e histórico)
create table public.adm_pendencies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  kind text not null default 'outro' check (kind in ('cadastro','documento','contrato','integracao_profissional','convite','agendamento','pacote','acesso','outro')),
  title text not null check (length(btrim(title)) between 3 and 200),                       -- o motivo
  detail text check (detail is null or length(detail) <= 2000),
  subject_type text check (subject_type in ('person','legal_entity','professional','contract','invitation','waitlist','package','access')),
  subject_id uuid,
  responsible_user_id uuid references auth.users(id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open','resolved','cancelled')),
  origin text not null default 'manual' check (origin in ('manual','auto')),
  dedupe_key text,
  opened_at timestamptz not null default now(), opened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz, reopened_count int not null default 0,                           -- o tempo de resolução conta a partir do último (re)abrir
  resolved_at timestamptz, resolved_by uuid references auth.users(id) on delete set null, resolution_note text,
  check ((status = 'resolved') = (resolved_at is not null) or status = 'cancelled')
);
create unique index adm_pendencies_open_key_uq on public.adm_pendencies (org_id, dedupe_key) where status = 'open' and dedupe_key is not null;
create index adm_pendencies_status_idx on public.adm_pendencies (org_id, status, due_date);
create table public.adm_pendency_events (
  id bigint generated always as identity primary key,
  pendency_id uuid not null references public.adm_pendencies(id) on delete cascade,
  at timestamptz not null default now(), actor uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created','assigned','due_changed','resolved','reopened','cancelled','noted')), note text
);
create index adm_pendency_events_idx on public.adm_pendency_events (pendency_id, at);

-- Integração de profissionais: a MEDIÇÃO começa na primeira avaliação (não há data histórica de conclusão de cada requisito).
create table public.adm_professional_onboarding (
  professional_id uuid primary key references public.professionals(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  started_at timestamptz not null,                                       -- maior entre a criação do profissional e o início da medição
  first_evaluated_at timestamptz not null default now(),
  complete_at_first_evaluation boolean not null,                          -- já estava completo quando passou a ser medido: sem data real de conclusão
  completed_at timestamptz                                               -- primeira vez que foi visto completo DEPOIS de medido
);

-- verificação de contato: registrada por uma pessoa (nunca inferida de formato válido)
alter table public.person_contacts add column verified_at timestamptz, add column verified_by uuid references auth.users(id) on delete set null, add column verification_method text;
create or replace function private.person_contacts_guard_verification() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('hp.adm_verify', true), '') <> 'on' then
    if tg_op = 'INSERT' and (new.verified_at is not null or new.verified_by is not null or new.verification_method is not null) then raise exception 'a verificação de contato só é registrada pela função própria' using errcode = '42501'; end if;
    if tg_op = 'UPDATE' and (new.verified_at is distinct from old.verified_at or new.verified_by is distinct from old.verified_by or new.verification_method is distinct from old.verification_method) then
      raise exception 'a verificação de contato só é registrada pela função própria' using errcode = '42501'; end if;
    -- mudar o valor do contato invalida a verificação anterior
    if tg_op = 'UPDATE' and new.value is distinct from old.value then new.verified_at := null; new.verified_by := null; new.verification_method := null; end if;
  end if;
  return new;
end $$;
create trigger person_contacts_verification_guard before insert or update on public.person_contacts for each row execute function private.person_contacts_guard_verification();

alter table public.adm_settings enable row level security; alter table public.adm_doc_types enable row level security; alter table public.adm_requirements enable row level security;
alter table public.person_documents enable row level security; alter table public.adm_contracts enable row level security; alter table public.adm_contract_events enable row level security;
alter table public.adm_pendencies enable row level security; alter table public.adm_pendency_events enable row level security; alter table public.adm_professional_onboarding enable row level security;
revoke all on public.adm_settings, public.adm_doc_types, public.adm_requirements, public.person_documents, public.adm_contracts, public.adm_contract_events,
  public.adm_pendencies, public.adm_pendency_events, public.adm_professional_onboarding from public, anon, authenticated;

-- ================================================================ auxiliares internos (só as funções públicas abaixo os chamam)
create or replace function private.adm_cfg() returns public.adm_settings
language sql stable security definer set search_path = '' as $$
  select coalesce((select s from public.adm_settings s where s.org_id = private.current_org()),
                  row(private.current_org(), 30, 2, 7, '{}'::jsonb, now(), null)::public.adm_settings)
$$;
create or replace function private.adm_all() returns boolean language sql stable set search_path = '' as $$ select private.has_org_role(array['manager','ops_admin']::public.app_role[]) $$;
-- escrever (criar/alterar pendência, documento, contrato, verificação): gestor, administrador operacional ou gestor DA UNIDADE. O papel "comercial" enxerga o Administrativo (leitura), mas não altera nada aqui.
create or replace function private.adm_manage(p_unit uuid default null) returns boolean language sql stable set search_path = '' as $$
  select private.adm_all() or exists (
    select 1 from public.role_assignments ra join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
     where ra.user_id = (select auth.uid()) and ra.role = 'unit_manager' and ra.unit_id is not null and (p_unit is null or ra.unit_id = p_unit)
       and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now()))
$$;
-- sem unidade = só org-wide; com unidade = quem gerencia aquela unidade
create or replace function private.adm_write_ok(p_unit uuid) returns boolean language sql stable set search_path = '' as $$
  select case when p_unit is null then private.adm_all() else private.adm_manage(p_unit) end
$$;
create or replace function private.adm_contact_valid(p_type text, p_value text) returns boolean language sql immutable set search_path = '' as $$
  select case when p_type = 'email' then p_value ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'
              else length(regexp_replace(coalesce(p_value, ''), '\D', '', 'g')) between 10 and 13 end
$$;
create or replace function private.adm_mask(p_type text, p_value text) returns text language sql immutable set search_path = '' as $$
  select case when p_value is null then null
              when position('@' in p_value) > 1 then left(p_value, 1) || '***' || substr(p_value, position('@' in p_value))
              when length(regexp_replace(p_value, '\D', '', 'g')) >= 8 then regexp_replace(p_value, '\d(?=\d{4})', '•', 'g')
              else left(p_value, 1) || repeat('•', greatest(length(p_value) - 1, 2)) end
$$;
create or replace function private.adm_subject_name(p_type text, p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'person' then (select full_name from public.people where id = p_id)
    when 'legal_entity' then (select legal_name from public.legal_entities where id = p_id)
    when 'professional' then (select display_name from public.professionals where id = p_id)
    when 'contract' then (select title from public.adm_contracts where id = p_id)
    when 'invitation' then (select email::text from public.invitations where id = p_id)
    when 'waitlist' then (select pe.full_name from public.waitlist w join public.people pe on pe.id = w.person_id where w.id = p_id)
    when 'package' then (select pe.full_name || ' — ' || pr.name from public.client_packages cp join public.people pe on pe.id = cp.person_id join public.products pr on pr.id = cp.product_id where cp.id = p_id)
    when 'access' then (select coalesce(ua.display_name, ua.email::text) from public.role_assignments ra join public.user_accounts ua on ua.user_id = ra.user_id where ra.id = p_id)
  end
$$;

-- um requisito está atendido para o sujeito? ('pf' = people.id · 'pj' = legal_entities.id · 'professional' = professionals.id)
create or replace function private.adm_req_ok(r public.adm_requirements, p_stype text, p_subject uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_ok boolean; v_type uuid; v_person uuid;
begin
  if r.check_type = 'field' then
    if p_stype = 'pf' then
      select case r.check_ref
        when 'document' then coalesce(btrim(p.document_number), '') <> ''
        when 'birth_date' then p.birth_date is not null
        when 'city' then coalesce(btrim(p.city), '') <> ''
        when 'state' then coalesce(btrim(p.state_uf), '') <> ''
        when 'cep' then coalesce(btrim(p.cep), '') <> ''
        when 'street' then coalesce(btrim(p.street), '') <> ''
        when 'contact' then exists (select 1 from public.person_contacts c where c.person_id = p.id)
        when 'contact_email' then exists (select 1 from public.person_contacts c where c.person_id = p.id and c.type = 'email')
        when 'contact_phone' then exists (select 1 from public.person_contacts c where c.person_id = p.id and c.type in ('phone','whatsapp'))
        when 'contact_verified' then exists (select 1 from public.person_contacts c where c.person_id = p.id and c.verified_at is not null)
        else false end into v_ok from public.people p where p.id = p_subject;
    elsif p_stype = 'pj' then
      select case r.check_ref
        when 'document' then coalesce(btrim(e.cnpj), '') <> ''
        when 'city' then coalesce(btrim(e.city), '') <> ''
        when 'state' then coalesce(btrim(e.state_uf), '') <> ''
        when 'contact' then (e.email_general is not null or e.phone is not null or e.whatsapp is not null)
        when 'representative' then exists (select 1 from public.legal_entity_representatives x where x.legal_entity_id = e.id)
        else false end into v_ok from public.legal_entities e where e.id = p_subject;
    elsif p_stype = 'professional' then
      select case r.check_ref
        when 'council_registration' then coalesce(btrim(pr.council_registration), '') <> ''
        when 'unit' then exists (select 1 from public.professional_units pu where pu.professional_id = pr.id)
        when 'access' then pr.user_id is not null and exists (select 1 from public.user_accounts ua where ua.user_id = pr.user_id and ua.status = 'active')
        when 'availability' then exists (select 1 from public.availability_rules a where a.professional_id = pr.id)
        else false end into v_ok from public.professionals pr where pr.id = p_subject;
    end if;
    return coalesce(v_ok, false);
  end if;
  if r.check_type = 'document' then
    select id into v_type from public.adm_doc_types where org_id = r.org_id and code = r.check_ref;
    if v_type is null then return false; end if;
    if p_stype = 'pj' then
      return exists (select 1 from public.legal_entity_documents d where d.legal_entity_id = p_subject and d.doc_type_id = v_type and d.removed_at is null and (d.expires_on is null or d.expires_on >= current_date));
    end if;
    v_person := case when p_stype = 'professional' then (select person_id from public.professionals where id = p_subject) else p_subject end;
    return v_person is not null and exists (select 1 from public.person_documents d where d.person_id = v_person and d.doc_type_id = v_type and d.removed_at is null and (d.expires_on is null or d.expires_on >= current_date));
  end if;
  if r.check_type = 'contract' then
    v_person := case when p_stype = 'professional' then (select person_id from public.professionals where id = p_subject) else p_subject end;
    return exists (select 1 from public.adm_contracts c where c.org_id = r.org_id and c.kind = r.check_ref and c.status = 'signed' and (c.ends_on is null or c.ends_on >= current_date)
      and ((p_stype = 'pj' and c.subject_type = 'legal_entity' and c.subject_id = p_subject) or (p_stype <> 'pj' and v_person is not null and c.subject_type = 'person' and c.subject_id = v_person)));
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------- conjuntos de linhas por escopo (a MESMA base dos números e das listas)
-- unmet = requisitos não atendidos no formato 'applies_to|rótulo'
create or replace function private.adm_people(p_unit uuid, p_owner uuid default null, p_kind text default null)
returns table (id uuid, nome text, unit_id uuid, created_at timestamptz, reg_status text, owner uuid, kinds text[], unmet text[])
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all)
  select p.id, p.full_name, p.unit_id, p.created_at, p.registration_status, p.internal_owner_user_id, k.kinds, m.unmet
    from ctx, public.people p
    cross join lateral (select coalesce(array_agg(pk.kind::text order by pk.kind::text), '{}'::text[]) kinds from public.person_kinds pk where pk.person_id = p.id) k
    cross join lateral (select coalesce(array_agg(r.applies_to || '|' || r.label order by r.label) filter (where not private.adm_req_ok(r, 'pf', p.id)), '{}'::text[]) unmet
                          from public.adm_requirements r where r.org_id = ctx.org and r.active and r.required and (r.applies_to = 'pf' or r.applies_to = any (k.kinds))) m
   where p.org_id = ctx.org and p.archived_at is null and p.merged_into_id is null
     and (ctx.v_all or p.unit_id = any (ctx.u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any (ctx.u)))
     and (p_owner is null or p.internal_owner_user_id = p_owner) and (p_kind is null or p_kind = any (k.kinds))
$$;
create or replace function private.adm_entities(p_unit uuid, p_owner uuid default null)
returns table (id uuid, nome text, created_at timestamptz, reg_status text, owner uuid, unmet text[])
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all)
  select e.id, e.legal_name, e.created_at, e.registration_status, e.internal_owner_user_id, m.unmet
    from ctx, public.legal_entities e
    cross join lateral (select coalesce(array_agg(r.applies_to || '|' || r.label order by r.label) filter (where not private.adm_req_ok(r, 'pj', e.id)), '{}'::text[]) unmet
                          from public.adm_requirements r where r.org_id = ctx.org and r.active and r.required and r.applies_to = 'pj') m
   where e.org_id = ctx.org and e.archived_at is null and e.merged_into_id is null
     and (ctx.v_all or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any (ctx.u)))
     and (p_owner is null or e.internal_owner_user_id = p_owner)
$$;
create or replace function private.adm_profs(p_unit uuid)
returns table (id uuid, nome text, person_id uuid, user_id uuid, created_at timestamptz, active boolean, unit_ids uuid[], unmet text[])
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all)
  select pr.id, pr.display_name, pr.person_id, pr.user_id, pr.created_at, pr.active, un.unit_ids, m.unmet
    from ctx, public.professionals pr
    cross join lateral (select coalesce(array_agg(pu.unit_id), '{}'::uuid[]) unit_ids from public.professional_units pu where pu.professional_id = pr.id) un
    cross join lateral (select coalesce(array_agg(r.applies_to || '|' || r.label order by r.label) filter (where not private.adm_req_ok(r, 'professional', pr.id)), '{}'::text[]) unmet
                          from public.adm_requirements r where r.org_id = ctx.org and r.active and r.required and r.applies_to = 'professional') m
   where pr.org_id = ctx.org and (ctx.v_all or un.unit_ids && ctx.u)
$$;

-- documentos registrados (só o mais recente de cada tipo por sujeito conta como vigente; renovar não deixa o antigo "vencido" no painel)
create or replace function private.adm_docs(p_unit uuid, p_type text default null, p_kind text default null)
returns table (doc_id uuid, subject_type text, subject_id uuid, subject_name text, doc_type text, title text, expires_on date, registered_at timestamptz, state text)
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all, private.adm_cfg() cfg),
  raw as (
    select d.id doc_id, 'pf'::text stype, d.person_id sid, p.full_name sname, t.label tlabel, t.has_expiry, t.id tid, d.title, d.expires_on, d.registered_at
      from ctx, public.person_documents d join public.people p on p.id = d.person_id join public.adm_doc_types t on t.id = d.doc_type_id
     where d.org_id = ctx.org and d.removed_at is null and p.archived_at is null and p.merged_into_id is null and p_type is distinct from 'pj'
       and (ctx.v_all or p.unit_id = any (ctx.u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any (ctx.u)))
       and (p_kind is null or exists (select 1 from public.person_kinds pk where pk.person_id = p.id and pk.kind::text = p_kind))
    union all
    select d.id, 'pj', d.legal_entity_id, e.legal_name, coalesce(t.label, d.kind), coalesce(t.has_expiry, false), d.doc_type_id, d.title, d.expires_on, d.uploaded_at
      from ctx, public.legal_entity_documents d join public.legal_entities e on e.id = d.legal_entity_id left join public.adm_doc_types t on t.id = d.doc_type_id
     where e.org_id = ctx.org and d.removed_at is null and e.archived_at is null and e.merged_into_id is null and p_type is distinct from 'pf' and p_kind is null
       and (ctx.v_all or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any (ctx.u)))),
  latest as (select distinct on (stype, sid, coalesce(tid, '00000000-0000-0000-0000-000000000000'::uuid)) * from raw
              order by stype, sid, coalesce(tid, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(expires_on, 'infinity'::date) desc, registered_at desc)
  select l.doc_id, l.stype, l.sid, l.sname, l.tlabel, l.title, l.expires_on, l.registered_at,
         case when l.expires_on is null then (case when l.has_expiry then 'sem_validade' else 'valido' end)
              when l.expires_on < current_date then 'vencido'
              when l.expires_on <= current_date + (select (cfg).expiring_days from ctx) then 'vencendo' else 'valido' end
    from latest l
$$;
-- documentos exigidos (requisito 'document') que não existem para o sujeito
create or replace function private.adm_docs_missing(p_unit uuid, p_type text default null, p_kind text default null)
returns table (subject_type text, subject_id uuid, subject_name text, req_label text)
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org)
  select 'pf'::text, p.id, p.nome, r.label
    from private.adm_people(p_unit, null, p_kind) p cross join ctx join public.adm_requirements r on r.org_id = ctx.org and r.active and r.required and r.check_type = 'document' and (r.applies_to = 'pf' or r.applies_to = any (p.kinds))
   where p_type is distinct from 'pj'
     and not exists (select 1 from public.person_documents d join public.adm_doc_types t on t.id = d.doc_type_id where d.person_id = p.id and t.code = r.check_ref and d.removed_at is null)
  union all
  select 'pj', e.id, e.nome, r.label
    from private.adm_entities(p_unit, null) e cross join ctx join public.adm_requirements r on r.org_id = ctx.org and r.active and r.required and r.check_type = 'document' and r.applies_to = 'pj'
   where p_type is distinct from 'pf' and p_kind is null
     and not exists (select 1 from public.legal_entity_documents d join public.adm_doc_types t on t.id = d.doc_type_id where d.legal_entity_id = e.id and t.code = r.check_ref and d.removed_at is null)
  union all
  select 'professional', pr.id, pr.nome, r.label
    from private.adm_profs(p_unit) pr cross join ctx join public.adm_requirements r on r.org_id = ctx.org and r.active and r.required and r.check_type = 'document' and r.applies_to = 'professional'
   where pr.active and p_type is distinct from 'pj' and (p_kind is null or p_kind = 'professional')
     and not exists (select 1 from public.person_documents d join public.adm_doc_types t on t.id = d.doc_type_id where d.person_id = pr.person_id and t.code = r.check_ref and d.removed_at is null)
$$;

create or replace function private.adm_contracts_rows(p_unit uuid, p_owner uuid default null, p_type text default null)
returns table (id uuid, kind text, title text, subject_type text, subject_id uuid, subject_name text, unit_id uuid, responsible uuid, responsible_name text, status text,
               starts_on date, ends_on date, due_date date, sent_at timestamptz, signed_on date, situation text)
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all, private.adm_cfg() cfg)
  select c.id, c.kind, c.title, c.subject_type, c.subject_id, private.adm_subject_name(c.subject_type, c.subject_id), c.unit_id, c.responsible_user_id,
         (select coalesce(ua.display_name, ua.email::text) from public.user_accounts ua where ua.user_id = c.responsible_user_id),
         c.status, c.starts_on, c.ends_on, c.due_date, c.sent_at, c.signed_on,
         case c.status when 'signed' then (case when c.ends_on < current_date then 'vencido' when c.ends_on <= current_date + (select (cfg).expiring_days from ctx) then 'a_vencer' else 'vigente' end)
                       else c.status end
    from ctx, public.adm_contracts c
   where c.org_id = ctx.org and (ctx.v_all or c.unit_id = any (ctx.u)) and (p_owner is null or c.responsible_user_id = p_owner)
     and (p_type is null or (p_type = 'pf' and c.subject_type = 'person') or (p_type = 'pj' and c.subject_type = 'legal_entity'))
$$;

create or replace function private.adm_wait(p_unit uuid, p_kind text default null, p_type text default null)
returns table (id uuid, person_id uuid, nome text, unit_id uuid, created_at timestamptz, status text, days numeric)
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all)
  select w.id, w.person_id, pe.full_name, w.unit_id, w.created_at, w.status, round(extract(epoch from now() - w.created_at) / 86400, 1)
    from ctx, public.waitlist w join public.people pe on pe.id = w.person_id
   where w.org_id = ctx.org and w.status in ('waiting','offered') and p_type is distinct from 'pj' and (ctx.v_all or w.unit_id = any (ctx.u))
     and (p_kind is null or exists (select 1 from public.person_kinds pk where pk.person_id = pe.id and pk.kind::text = p_kind))
$$;

create or replace function private.adm_pkgs(p_unit uuid, p_kind text default null, p_type text default null)
returns table (id uuid, person_id uuid, nome text, unit_id uuid, product_name text, balance int, valid_until date)
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all, private.adm_cfg() cfg)
  select cp.id, cp.person_id, pe.full_name, cp.unit_id, pr.name, b.bal, cp.valid_until
    from ctx, public.client_packages cp join public.people pe on pe.id = cp.person_id join public.products pr on pr.id = cp.product_id
    cross join lateral (select private.package_balance(cp.id) bal) b
   where cp.org_id = ctx.org and cp.status = 'active' and p_type is distinct from 'pj' and (ctx.v_all or cp.unit_id = any (ctx.u))
     and b.bal <= (select (cfg).package_low_sessions from ctx)
     and (cp.valid_until is null or cp.valid_until >= current_date)
     and not exists (select 1 from public.appointments a where a.person_id = cp.person_id and a.status in ('scheduled','confirmed') and lower(a.period) > now())
     and (p_kind is null or exists (select 1 from public.person_kinds pk where pk.person_id = pe.id and pk.kind::text = p_kind))
$$;

create or replace function private.adm_invites(p_unit uuid)
returns table (id uuid, email text, role text, unit_id uuid, created_at timestamptz, expires_at timestamptz, state text)
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all)
  select i.id, i.email::text, i.role::text, i.unit_id, i.created_at, i.expires_at, case when i.expires_at > now() then 'pendente' else 'expirado' end
    from ctx, public.invitations i
   where i.org_id = ctx.org and i.accepted_at is null and i.revoked_at is null and (ctx.v_all or i.unit_id = any (ctx.u))
$$;

create or replace function private.adm_access_review(p_unit uuid)
returns table (id uuid, user_id uuid, nome text, role text, unit_id uuid, reason text, valid_until timestamptz)
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all, private.adm_cfg() cfg)
  select ra.id, ra.user_id, coalesce(ua.display_name, ua.email::text), ra.role::text, ra.unit_id,
         case when ua.status = 'suspended' then 'conta suspensa com papel ainda ativo' else 'papel expira em até ' || (select (cfg).expiring_days from ctx) || ' dias' end, ra.valid_until
    from ctx, public.role_assignments ra join public.user_accounts ua on ua.user_id = ra.user_id
   where ra.org_id = ctx.org and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
     and (ctx.v_all or ra.unit_id = any (ctx.u))
     and (ua.status = 'suspended' or ra.valid_until <= now() + make_interval(days => (select (cfg).expiring_days from ctx)))
$$;

-- possíveis duplicidades (SÓ para revisão; nada é mesclado). group_key não expõe o dado (hash).
create or replace function private.adm_dups(p_unit uuid)
returns table (group_key text, reason text, person_id uuid, nome text)
language sql stable security definer set search_path = '' as $$
  with base as (select id, nome from private.adm_people(p_unit, null, null)),
  by_contact as (
    select 'contato:' || md5(c.normalized) gk, 'mesmo contato (e-mail/telefone) em cadastros diferentes' why, b.id pid, b.nome
      from base b join public.person_contacts c on c.person_id = b.id and c.normalized is not null
     where c.normalized in (select c2.normalized from public.person_contacts c2 join base b2 on b2.id = c2.person_id where c2.normalized is not null
                             group by c2.normalized having count(distinct c2.person_id) > 1 and bool_and(not c2.is_shared))),
  by_doc as (
    select 'documento:' || md5(regexp_replace(p.document_number, '\D', '', 'g')), 'mesmo documento em cadastros diferentes', b.id, b.nome
      from base b join public.people p on p.id = b.id
     where coalesce(regexp_replace(p.document_number, '\D', '', 'g'), '') <> ''
       and regexp_replace(p.document_number, '\D', '', 'g') in (select regexp_replace(p2.document_number, '\D', '', 'g') from public.people p2 join base b2 on b2.id = p2.id
                             where coalesce(regexp_replace(p2.document_number, '\D', '', 'g'), '') <> '' group by 1 having count(*) > 1)),
  by_name as (
    select 'nome:' || md5(lower(btrim(p.full_name)) || p.birth_date::text), 'mesmo nome e data de nascimento', b.id, b.nome
      from base b join public.people p on p.id = b.id
     where p.birth_date is not null
       and (lower(btrim(p.full_name)), p.birth_date) in (select lower(btrim(p2.full_name)), p2.birth_date from public.people p2 join base b2 on b2.id = p2.id where p2.birth_date is not null group by 1, 2 having count(*) > 1))
  select * from by_contact union select * from by_doc union select * from by_name
$$;

create or replace function private.adm_pends(p_unit uuid, p_owner uuid default null, p_type text default null, p_kind text default null, p_status text default null)
returns table (id uuid, kind text, title text, detail text, subject_type text, subject_id uuid, subject_name text, unit_id uuid, unit_name text, responsible uuid, responsible_name text,
               due_date date, status text, opened_at timestamptz, reopened_at timestamptz, resolved_at timestamptz, reopened_count int, origin text, overdue boolean, overdue_days int, resolution_hours numeric)
language sql stable security definer set search_path = '' as $$
  with ctx as (select private.current_org() org, private.adm_scope_units(p_unit) u, (p_unit is null and private.adm_all()) v_all)
  select x.id, x.kind, x.title, x.detail, x.subject_type, x.subject_id, private.adm_subject_name(x.subject_type, x.subject_id), x.unit_id, (select un.name from public.units un where un.id = x.unit_id),
         x.responsible_user_id, (select coalesce(ua.display_name, ua.email::text) from public.user_accounts ua where ua.user_id = x.responsible_user_id),
         x.due_date, x.status, x.opened_at, x.reopened_at, x.resolved_at, x.reopened_count, x.origin,
         (x.status = 'open' and x.due_date is not null and x.due_date < current_date), case when x.status = 'open' and x.due_date < current_date then current_date - x.due_date end,
         case when x.status = 'resolved' then round(extract(epoch from x.resolved_at - coalesce(x.reopened_at, x.opened_at)) / 3600, 1) end
    from ctx, public.adm_pendencies x
   where x.org_id = ctx.org and (ctx.v_all or x.unit_id = any (ctx.u)) and (p_owner is null or x.responsible_user_id = p_owner)
     and (p_type is null or (p_type = 'pf' and x.subject_type = 'person') or (p_type = 'pj' and x.subject_type = 'legal_entity'))
     and (p_kind is null or (p_kind = 'professional' and x.subject_type = 'professional')
          or (x.subject_type = 'person' and exists (select 1 from public.person_kinds pk where pk.person_id = x.subject_id and pk.kind::text = p_kind)))
     and (p_status is null or (p_status = 'open' and x.status = 'open') or (p_status = 'overdue' and x.status = 'open' and x.due_date < current_date)
          or (p_status = 'resolved' and x.status = 'resolved') or (p_status = 'cancelled' and x.status = 'cancelled'))
$$;

revoke all on function private.adm_cfg(), private.adm_all(), private.adm_manage(uuid), private.adm_write_ok(uuid), private.adm_contact_valid(text, text), private.adm_mask(text, text), private.adm_subject_name(text, uuid),
  private.adm_req_ok(public.adm_requirements, text, uuid), private.adm_people(uuid, uuid, text), private.adm_entities(uuid, uuid), private.adm_profs(uuid),
  private.adm_docs(uuid, text, text), private.adm_docs_missing(uuid, text, text), private.adm_contracts_rows(uuid, uuid, text), private.adm_wait(uuid, text, text),
  private.adm_pkgs(uuid, text, text), private.adm_invites(uuid), private.adm_access_review(uuid), private.adm_dups(uuid), private.adm_pends(uuid, uuid, text, text, text),
  private.person_contacts_guard_verification() from public, anon, authenticated;

-- ================================================================ indicadores da central (situação de HOJE × períodos)
-- Filtros: p_unit (todos) · p_owner (responsável: pendência/contrato/cadastro) · p_type ('pf'|'pj') · p_kind (vínculo; 'professional' inclui profissionais) · p_status (só pendências: open|overdue|resolved).
-- Filtro que não faz sentido para um indicador (ex.: vínculo em PJ) EXCLUI aquele conjunto, e o basis do indicador diz isso — nunca é ignorado em silêncio.
create or replace function public.adm_central(p_from timestamptz, p_to timestamptz, p_unit uuid default null, p_owner uuid default null, p_type text default null, p_kind text default null, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cfg public.adm_settings := private.adm_cfg(); res jsonb; v_org uuid := private.current_org();
begin
  perform private.adm_scope_units(p_unit);
  if p_type is not null and p_type not in ('pf','pj') then raise exception 'tipo inválido'; end if;
  if p_status is not null and p_status not in ('open','overdue','resolved') then raise exception 'status inválido'; end if;
  with
  pf as materialized (select * from private.adm_people(p_unit, p_owner, p_kind) where p_type is distinct from 'pj'),
  pj as materialized (select * from private.adm_entities(p_unit, p_owner) where p_type is distinct from 'pf' and p_kind is null),
  prof as materialized (select * from private.adm_profs(p_unit) where active and p_owner is null and p_type is distinct from 'pj' and (p_kind is null or p_kind = 'professional')),
  docs as materialized (select * from private.adm_docs(p_unit, p_type, p_kind) where p_owner is null),
  dmiss as materialized (select * from private.adm_docs_missing(p_unit, p_type, p_kind) where p_owner is null),
  ctr as materialized (select * from private.adm_contracts_rows(p_unit, p_owner, p_type) where p_kind is null),
  wt as materialized (select * from private.adm_wait(p_unit, p_kind, p_type) where p_owner is null),
  pk as materialized (select * from private.adm_pkgs(p_unit, p_kind, p_type) where p_owner is null),
  inv as materialized (select * from private.adm_invites(p_unit) where p_owner is null and p_type is null and p_kind is null),
  acc as materialized (select * from private.adm_access_review(p_unit) where p_owner is null and p_type is null and p_kind is null),
  dup as materialized (select * from private.adm_dups(p_unit) where p_owner is null and p_type is distinct from 'pj'),
  pe as materialized (select * from private.adm_pends(p_unit, p_owner, p_type, p_kind, null)),
  pe_f as materialized (select * from pe where p_status is null or (p_status = 'open' and status = 'open') or (p_status = 'overdue' and overdue) or (p_status = 'resolved' and status = 'resolved')),
  ct as materialized (
    select c.id, c.verified_at, c.type::text ctype, c.value, private.adm_contact_valid(c.type::text, c.value) ok
      from public.person_contacts c where c.person_id in (select id from pf)),
  onb as materialized (
    select o.*, pr.nome from public.adm_professional_onboarding o join prof pr on pr.id = o.professional_id where o.org_id = v_org),
  grp as (
    select 'pf'::text gkey, 'Pessoas físicas (todas)'::text glabel, count(*) total, count(*) filter (where cardinality(unmet) = 0) done from pf
    union all select 'pj', 'Pessoas jurídicas', count(*), count(*) filter (where cardinality(unmet) = 0) from pj
    union all select 'professional', 'Profissionais (requisitos para atender)', count(*), count(*) filter (where cardinality(unmet) = 0) from prof
    union all select k.kind, 'Vínculo: ' || k.kind, count(*),
           count(*) filter (where not exists (select 1 from unnest(pf.unmet) x where split_part(x, '|', 1) in ('pf', k.kind)))
      from (select distinct unnest(kinds) kind from pf) k join pf on k.kind = any (pf.kinds) group by k.kind),
  res_t as (select kind, count(*) n, avg(resolution_hours) avg_h, percentile_cont(0.5) within group (order by resolution_hours) med_h
              from pe_f where status = 'resolved' and resolved_at >= p_from and resolved_at < p_to group by kind),
  wk as (select g::date ws, (g + interval '7 days')::date we from generate_series(date_trunc('week', p_from)::date, date_trunc('week', p_to)::date, interval '7 days') g limit 60)
  select jsonb_build_object(
    'settings', jsonb_build_object('expiring_days', cfg.expiring_days, 'package_low_sessions', cfg.package_low_sessions, 'waiting_alert_days', cfg.waiting_alert_days),
    'cards', jsonb_build_object(
      'overdue_pendencies', private.metric((select count(*) from pe where overdue), true, 'pendências administrativas ABERTAS com prazo vencido (prazo anterior a hoje). Situação de hoje.'),
      'incomplete', private.metric((select count(*) from pf where cardinality(unmet) > 0) + (select count(*) from pj where cardinality(unmet) > 0), true,
        'cadastros (PF + PJ) que não atendem algum requisito ativo e obrigatório do tipo/vínculo — requisitos em Administrativo › Requisitos. Situação de hoje.'),
      'docs_expiring', private.metric((select count(*) from docs where state = 'vencendo'), true, 'documento vigente mais recente de cada tipo que vence de hoje até ' || cfg.expiring_days || ' dias. Situação de hoje.'),
      'contracts_awaiting', private.metric((select count(*) from ctr where status = 'awaiting_signature'), true, 'contratos administrativos enviados para assinatura e ainda sem assinatura registrada. Situação de hoje.'),
      'patients_waiting', private.metric((select count(distinct person_id) from wt), true, 'pacientes com SOLICITAÇÃO de agendamento em aberto (lista de espera: aguardando ou ofertada) — não é toda pessoa sem consulta. Situação de hoje.'),
      'professionals_incomplete', private.metric((select count(*) from prof where cardinality(unmet) > 0), true, 'profissionais ativos que não atendem algum requisito administrativo para atender. Situação de hoje.')),
    'kpis', jsonb_build_object(
      'completeness', case when (select count(*) from pf) + (select count(*) from pj) = 0 or not exists (select 1 from public.adm_requirements r where r.org_id = v_org and r.active and r.required)
        then private.metric(null, false, case when not exists (select 1 from public.adm_requirements r where r.org_id = v_org and r.active and r.required) then 'nenhum requisito ativo configurado' else 'sem cadastros no filtro selecionado' end)
        else private.metric(round(100.0 * ((select count(*) from pf where cardinality(unmet) = 0) + (select count(*) from pj where cardinality(unmet) = 0)) / ((select count(*) from pf) + (select count(*) from pj)), 1), true,
          'cadastros completos ÷ cadastros (PF + PJ) × 100; completo = atende todos os requisitos ativos e obrigatórios do tipo e dos vínculos da pessoa. Situação de hoje.',
          jsonb_build_object('complete', (select count(*) from pf where cardinality(unmet) = 0) + (select count(*) from pj where cardinality(unmet) = 0), 'total', (select count(*) from pf) + (select count(*) from pj))) end,
      'completeness_groups', (select coalesce(jsonb_agg(jsonb_build_object('key', gkey, 'label', glabel, 'total', total, 'complete', done, 'pct', case when total > 0 then round(100.0 * done / total, 1) end) order by gkey), '[]'::jsonb) from grp),
      'duplicates', jsonb_build_object('groups', (select count(distinct group_key) from dup), 'people', (select count(distinct person_id) from dup),
        'basis', 'grupos de cadastros com o mesmo contato (não marcado como compartilhado), o mesmo documento, ou o mesmo nome e data de nascimento — SÓ para revisão; nada é mesclado automaticamente. Situação de hoje.'),
      'contacts', jsonb_build_object('total', (select count(*) from ct), 'valid_format', (select count(*) from ct where ok), 'invalid_format', (select count(*) from ct where not ok),
        'verified', (select count(*) from ct where verified_at is not null),
        'valid_pct', case when (select count(*) from ct) > 0 then round(100.0 * (select count(*) from ct where ok) / (select count(*) from ct), 1) end,
        'verified_available', exists (select 1 from public.person_contacts where org_id = v_org and verified_at is not null),
        'verified_pct', case when (select count(*) from ct) > 0 and exists (select 1 from public.person_contacts where org_id = v_org and verified_at is not null) then round(100.0 * (select count(*) from ct where verified_at is not null) / (select count(*) from ct), 1) end,
        'basis_valid', 'contatos com formato válido (e-mail com @ e domínio; telefone com 10 a 13 dígitos) ÷ contatos. Formato válido NÃO é contato verificado.',
        'basis_verified', case when exists (select 1 from public.person_contacts where org_id = v_org and verified_at is not null)
          then 'contatos com verificação REGISTRADA por uma pessoa da equipe ÷ contatos. Só conta quem foi verificado de fato.'
          else 'indisponível: nenhuma verificação de contato foi registrada ainda — a verificação é registrada manualmente em Administrativo › Contatos e nunca é inferida do formato.' end),
      'documents', jsonb_build_object('registered', (select count(*) from docs), 'missing', (select count(*) from dmiss), 'expired', (select count(*) from docs where state = 'vencido'),
        'expiring', (select count(*) from docs where state = 'vencendo'), 'no_expiry_date', (select count(*) from docs where state = 'sem_validade'),
        'requirements_configured', exists (select 1 from public.adm_requirements r where r.org_id = v_org and r.active and r.required and r.check_type = 'document'),
        'basis', 'ausentes = documentos exigidos por requisito sem nenhum registro; vencidos/vencendo = o documento mais recente de cada tipo por cadastro; sem validade = tipo que vence registrado sem data de validade (não é tratado como vigente nem como vencido). Situação de hoje.'),
      'contracts', jsonb_build_object('by_status', jsonb_build_object('draft', (select count(*) from ctr where status = 'draft'), 'awaiting_signature', (select count(*) from ctr where status = 'awaiting_signature'),
          'signed', (select count(*) from ctr where status = 'signed'), 'cancelled', (select count(*) from ctr where status = 'cancelled')),
        'signed_current', (select count(*) from ctr where situation = 'vigente'), 'ending', (select count(*) from ctr where situation = 'a_vencer'), 'expired', (select count(*) from ctr where situation = 'vencido'),
        'awaiting_overdue', (select count(*) from ctr where status = 'awaiting_signature' and due_date < current_date),
        'basis', 'contratos ADMINISTRATIVOS (não os de venda nem os de receita recorrente); situação pela data de término dos assinados: vigente, a vencer em ' || cfg.expiring_days || ' dias ou vencido. Situação de hoje.'),
      'resolution', case when (select count(*) from pe_f where status = 'resolved' and resolved_at >= p_from and resolved_at < p_to) = 0
        then private.metric(null, false, 'nenhuma pendência concluída no período — ainda não há base para calcular o tempo de resolução')
        else private.metric((select round(avg(resolution_hours), 1) from pe_f where status = 'resolved' and resolved_at >= p_from and resolved_at < p_to), true,
          'média, em horas, entre abrir (ou reabrir) e concluir, das pendências concluídas no período. Período selecionado.',
          jsonb_build_object('median_hours', (select round(percentile_cont(0.5) within group (order by resolution_hours)::numeric, 1) from pe_f where status = 'resolved' and resolved_at >= p_from and resolved_at < p_to),
                             'n', (select count(*) from pe_f where status = 'resolved' and resolved_at >= p_from and resolved_at < p_to))) end,
      'resolution_by_kind', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'n', n, 'avg_hours', round(avg_h, 1), 'median_hours', round(med_h::numeric, 1)) order by kind), '[]'::jsonb) from res_t),
      'onboarding', case when (select count(*) from onb where completed_at is not null) = 0
        then private.metric(null, false, 'indisponível: a medição começou na primeira avaliação dos requisitos (' || coalesce((select min(first_evaluated_at)::date::text from public.adm_professional_onboarding where org_id = v_org), 'ainda não iniciada') || ') e nenhum profissional concluiu depois disso — não há data histórica de conclusão')
        else private.metric((select round(avg(extract(epoch from completed_at - started_at) / 86400)::numeric, 1) from onb where completed_at is not null), true,
          'média, em dias, entre o início da medição do profissional (criação ou, se anterior, a primeira avaliação) e a primeira vez visto com todos os requisitos. Só profissionais medidos desde o início.',
          jsonb_build_object('median_days', (select round(percentile_cont(0.5) within group (order by extract(epoch from completed_at - started_at) / 86400)::numeric, 1) from onb where completed_at is not null),
                             'n', (select count(*) from onb where completed_at is not null))) end,
      'professionals', jsonb_build_object('active', (select count(*) from prof), 'ready', (select count(*) from prof where cardinality(unmet) = 0),
        'ready_pct', case when (select count(*) from prof) > 0 then round(100.0 * (select count(*) from prof where cardinality(unmet) = 0) / (select count(*) from prof), 1) end,
        'basis', 'profissionais ATIVOS que atendem todos os requisitos administrativos configurados para atender. "Ativo" é o cadastro do profissional — não comprova vínculo contratual vigente. Situação de hoje.'),
      'waiting', case when (select count(*) from wt) = 0 then jsonb_build_object('n', 0, 'available', false, 'basis', 'nenhuma solicitação de agendamento em aberto — sem tempo de espera a calcular')
        else jsonb_build_object('n', (select count(*) from wt), 'available', true, 'avg_days', (select round(avg(days), 1) from wt), 'median_days', (select round(percentile_cont(0.5) within group (order by days)::numeric, 1) from wt),
          'max_days', (select max(days) from wt), 'over_alert', (select count(*) from wt where days >= cfg.waiting_alert_days), 'alert_days', cfg.waiting_alert_days,
          'basis', 'tempo desde o registro da solicitação (lista de espera) até agora, das solicitações ainda não atendidas. Situação de hoje.') end,
      'packages', jsonb_build_object('n', (select count(*) from pk), 'low_sessions', cfg.package_low_sessions,
        'basis', 'pacotes ativos e dentro da validade com saldo de até ' || cfg.package_low_sessions || ' sessões e SEM nenhum atendimento futuro agendado (um atendimento já agendado, inclusive de reavaliação, tira o pacote da lista). Saldo é controle administrativo, não evolução clínica. Situação de hoje.'),
      'access', jsonb_build_object('invitations_pending', (select count(*) from inv where state = 'pendente'), 'invitations_expired', (select count(*) from inv where state = 'expirado'), 'review', (select count(*) from acc),
        'basis', 'convites não aceitos (válidos e expirados, separados) e papéis ativos que pedem revisão: conta suspensa com papel ativo ou papel que expira em até ' || cfg.expiring_days || ' dias. Situação de hoje.'),
      'pendencies', jsonb_build_object('open', (select count(*) from pe_f where status = 'open'), 'overdue', (select count(*) from pe_f where overdue),
        'resolved_period', (select count(*) from pe_f where status = 'resolved' and resolved_at >= p_from and resolved_at < p_to),
        'basis', 'abertas e atrasadas = situação de hoje; concluídas = no período selecionado. O filtro de status restringe esta seção.'),
      'by_owner', (select coalesce(jsonb_agg(jsonb_build_object('user_id', responsible, 'name', coalesce(responsible_name, 'Sem responsável'), 'open', open_n, 'overdue', od, 'resolved', rs) order by open_n desc, od desc), '[]'::jsonb)
                     from (select responsible, max(responsible_name) responsible_name, count(*) filter (where status = 'open') open_n, count(*) filter (where overdue) od,
                                  count(*) filter (where status = 'resolved' and resolved_at >= p_from and resolved_at < p_to) rs from pe_f group by responsible) x),
      'by_unit', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', unit_id, 'name', coalesce(unit_name, 'Sem unidade'), 'open', open_n, 'overdue', od, 'resolved', rs) order by open_n desc), '[]'::jsonb)
                    from (select unit_id, max(unit_name) unit_name, count(*) filter (where status = 'open') open_n, count(*) filter (where overdue) od,
                                 count(*) filter (where status = 'resolved' and resolved_at >= p_from and resolved_at < p_to) rs from pe_f group by unit_id) x)),
    'evolution', (select coalesce(jsonb_agg(jsonb_build_object('week', wk.ws,
        'opened', (select count(*) from public.adm_pendency_events ev where ev.action = 'created' and ev.at >= wk.ws and ev.at < wk.we and ev.pendency_id in (select id from pe)),
        'resolved', (select count(*) from public.adm_pendency_events ev where ev.action = 'resolved' and ev.at >= wk.ws and ev.at < wk.we and ev.pendency_id in (select id from pe)),
        'open_at_end', (select count(*) from (select distinct on (ev.pendency_id) ev.action from public.adm_pendency_events ev where ev.at < wk.we and ev.pendency_id in (select id from pe)
                          and ev.action in ('created','reopened','resolved','cancelled') order by ev.pendency_id, ev.at desc, ev.id desc) z where z.action in ('created','reopened'))) order by wk.ws), '[]'::jsonb) from wk),
    'evolution_basis', 'semanas (segunda a domingo): abertas e concluídas por evento registrado; "em aberto ao fim" = pendências cujo último evento até o fim da semana as deixa abertas. O histórico começa no primeiro registro de pendência — não há dado retroativo.'
  ) into res;
  return res;
end $$;

-- ================================================================ detalhe clicável: os registros que compõem cada número (mesmas funções-base dos cartões)
create or replace function public.adm_central_detail(p_kind text, p_value text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_unit uuid default null, p_owner uuid default null, p_type text default null, p_kind_filter text default null, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cfg public.adm_settings := private.adm_cfg(); v_items jsonb; v_total bigint; v_label text; v_route text; v_snapshot boolean := true; v_basis text;
begin
  perform private.adm_scope_units(p_unit);
  if p_kind not in ('overdue_pendencies','open_pendencies','resolved_pendencies','incomplete','incomplete_group','docs_expiring','docs_expired','docs_missing','docs_no_expiry',
    'contracts_awaiting','contracts_status','contracts_ending','contracts_expired','patients_waiting','professionals_incomplete','professionals_ready','packages_ending',
    'invitations_pending','invitations_expired','access_review','duplicates','contacts_invalid','contacts_unverified') then raise exception 'indicador desconhecido'; end if;
  v_label := case p_kind
    when 'overdue_pendencies' then 'Pendências administrativas vencidas' when 'open_pendencies' then 'Pendências abertas' when 'resolved_pendencies' then 'Pendências concluídas no período'
    when 'incomplete' then 'Cadastros incompletos' when 'incomplete_group' then 'Cadastros incompletos — ' || coalesce(p_value, '')
    when 'docs_expiring' then 'Documentos vencendo em ' || cfg.expiring_days || ' dias' when 'docs_expired' then 'Documentos vencidos' when 'docs_missing' then 'Documentos ausentes'
    when 'docs_no_expiry' then 'Documentos sem data de validade informada' when 'contracts_awaiting' then 'Contratos aguardando assinatura'
    when 'contracts_status' then 'Contratos — ' || coalesce(p_value, '') when 'contracts_ending' then 'Contratos a vencer em ' || cfg.expiring_days || ' dias' when 'contracts_expired' then 'Contratos vencidos'
    when 'patients_waiting' then 'Pacientes aguardando agendamento' when 'professionals_incomplete' then 'Profissionais com integração administrativa incompleta'
    when 'professionals_ready' then 'Profissionais aptos a atender (requisitos concluídos)' when 'packages_ending' then 'Pacotes próximos do fim sem próximo atendimento'
    when 'invitations_pending' then 'Convites pendentes (válidos)' when 'invitations_expired' then 'Convites expirados não aceitos' when 'access_review' then 'Acessos que precisam de revisão'
    when 'duplicates' then 'Possíveis duplicidades para revisão' when 'contacts_invalid' then 'Contatos com formato inválido' else 'Contatos sem verificação registrada' end;
  v_route := case
    when p_kind in ('overdue_pendencies','open_pendencies','resolved_pendencies') then '/admin/adm/pendencias?aba=pendencias&status=' || case p_kind when 'overdue_pendencies' then 'overdue' when 'open_pendencies' then 'open' else 'resolved' end
    when p_kind in ('incomplete','incomplete_group','duplicates','contacts_invalid') then '/admin/adm/diretorio?incompleto=1'
    when p_kind like 'docs_%' then '/admin/adm/pendencias?aba=documentos' when p_kind like 'contracts_%' then '/admin/adm/pendencias?aba=contratos'
    when p_kind = 'contacts_unverified' then '/admin/adm/pendencias?aba=contatos' when p_kind = 'patients_waiting' then '/admin/agenda' when p_kind like 'professionals_%' then '/admin/equipe'
    when p_kind = 'packages_ending' then '/admin/agenda' else '/admin/equipe' end;
  v_basis := 'lista dos registros que compõem o indicador (mesma base do cartão e dos mesmos filtros; até 50 exibidos)';
  if p_kind in ('overdue_pendencies','open_pendencies','resolved_pendencies') then
    v_snapshot := p_kind <> 'resolved_pendencies';
    with s as (select * from private.adm_pends(p_unit, p_owner, p_type, p_kind_filter, null)
                where case p_kind when 'overdue_pendencies' then overdue when 'open_pendencies' then status = 'open' else status = 'resolved' and resolved_at >= p_from and resolved_at < p_to end
                  and (p_status is null or (p_status = 'open' and status = 'open') or (p_status = 'overdue' and overdue) or (p_status = 'resolved' and status = 'resolved')))
    select (select count(*) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'subtitle', coalesce(x.subject_name, 'sem cadastro vinculado') || ' · ' || coalesce(x.responsible_name, 'sem responsável')
        || case when x.due_date is not null then ' · prazo ' || to_char(x.due_date, 'DD/MM/YYYY') else '' end, 'date', x.opened_at, 'tag', case when x.overdue then 'atrasada ' || x.overdue_days || ' d' else x.status end) order by x.due_date nulls last, x.opened_at), '[]'::jsonb)
      into v_total, v_items from (select * from s order by due_date nulls last, opened_at limit 50) x;
  elsif p_kind in ('incomplete','incomplete_group') then
    with s as (
      select a.id, a.nome, 'PF' t, a.created_at, a.unmet, a.reg_status, a.kinds from private.adm_people(p_unit, p_owner, p_kind_filter) a where p_type is distinct from 'pj'
      union all select e.id, e.nome, 'PJ', e.created_at, e.unmet, e.reg_status, '{}'::text[] from private.adm_entities(p_unit, p_owner) e where p_type is distinct from 'pf' and p_kind_filter is null),
    f as (select * from s where cardinality(unmet) > 0 and (p_kind = 'incomplete' or p_value is null or (p_value = 'pf' and t = 'PF') or (p_value = 'pj' and t = 'PJ')
            or (p_value not in ('pf','pj') and p_value = any (kinds) and exists (select 1 from unnest(unmet) x where split_part(x, '|', 1) in ('pf', p_value)))))
    select (select count(*) from f), coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.nome, 'subtitle', x.t || ' · falta: ' || (select string_agg(split_part(u, '|', 2), ', ') from unnest(x.unmet) u), 'date', x.created_at, 'tag', x.reg_status) order by x.created_at desc), '[]'::jsonb)
      into v_total, v_items from (select * from f order by created_at desc limit 50) x;
  elsif p_kind in ('docs_expiring','docs_expired','docs_no_expiry') then
    with s as (select * from private.adm_docs(p_unit, p_type, p_kind_filter) where p_owner is null and state = case p_kind when 'docs_expiring' then 'vencendo' when 'docs_expired' then 'vencido' else 'sem_validade' end)
    select (select count(*) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.doc_id, 'title', x.subject_name, 'subtitle', x.doc_type || ' · ' || x.title, 'date', x.expires_on::timestamptz,
        'tag', case when x.expires_on is null then 'sem validade' when x.expires_on < current_date then 'venceu há ' || (current_date - x.expires_on) || ' d' else 'vence em ' || (x.expires_on - current_date) || ' d' end) order by x.expires_on nulls last), '[]'::jsonb)
      into v_total, v_items from (select * from s order by expires_on nulls last limit 50) x;
  elsif p_kind = 'docs_missing' then
    with s as (select * from private.adm_docs_missing(p_unit, p_type, p_kind_filter) where p_owner is null)
    select (select count(*) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.subject_id, 'title', x.subject_name, 'subtitle', 'falta o documento: ' || x.req_label, 'tag', upper(x.subject_type)) order by x.subject_name), '[]'::jsonb)
      into v_total, v_items from (select * from s order by subject_name limit 50) x;
  elsif p_kind in ('contracts_awaiting','contracts_status','contracts_ending','contracts_expired') then
    with s as (select * from private.adm_contracts_rows(p_unit, p_owner, p_type) where p_kind_filter is null and case p_kind when 'contracts_awaiting' then status = 'awaiting_signature'
                 when 'contracts_status' then (status = p_value or situation = p_value) when 'contracts_ending' then situation = 'a_vencer' else situation = 'vencido' end)
    select (select count(*) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'subtitle', coalesce(x.subject_name, '—') || ' · ' || coalesce(x.responsible_name, 'sem responsável')
        || case when x.due_date is not null and x.status = 'awaiting_signature' then ' · assinar até ' || to_char(x.due_date, 'DD/MM/YYYY') when x.ends_on is not null then ' · termina ' || to_char(x.ends_on, 'DD/MM/YYYY') else '' end,
        'date', coalesce(x.sent_at, x.ends_on::timestamptz), 'tag', x.situation) order by x.due_date nulls last, x.ends_on nulls last), '[]'::jsonb)
      into v_total, v_items from (select * from s order by due_date nulls last, ends_on nulls last limit 50) x;
  elsif p_kind = 'patients_waiting' then
    with s as (select * from private.adm_wait(p_unit, p_kind_filter, p_type) where p_owner is null)
    select (select count(*) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.nome, 'subtitle', 'solicitação ' || case x.status when 'offered' then 'com horário ofertado' else 'aguardando' end || ' há ' || x.days || ' dias', 'date', x.created_at,
        'tag', case when x.days >= cfg.waiting_alert_days then 'acima de ' || cfg.waiting_alert_days || ' d' else 'no prazo' end) order by x.created_at), '[]'::jsonb)
      into v_total, v_items from (select * from s order by created_at limit 50) x;
  elsif p_kind in ('professionals_incomplete','professionals_ready') then
    with s as (select * from private.adm_profs(p_unit) where active and p_owner is null and p_type is distinct from 'pj' and (p_kind_filter is null or p_kind_filter = 'professional')
                 and (case when p_kind = 'professionals_incomplete' then cardinality(unmet) > 0 else cardinality(unmet) = 0 end))
    select (select count(*) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.nome, 'subtitle', case when cardinality(x.unmet) > 0 then 'falta: ' || (select string_agg(split_part(u, '|', 2), ', ') from unnest(x.unmet) u) else 'todos os requisitos atendidos' end,
        'date', x.created_at, 'tag', case when cardinality(x.unmet) > 0 then cardinality(x.unmet) || ' pend.' else 'apto' end) order by x.nome), '[]'::jsonb)
      into v_total, v_items from (select * from s order by nome limit 50) x;
  elsif p_kind = 'packages_ending' then
    with s as (select * from private.adm_pkgs(p_unit, p_kind_filter, p_type) where p_owner is null)
    select (select count(*) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.nome, 'subtitle', x.product_name || ' · saldo ' || x.balance || ' sessão(ões), sem próximo atendimento agendado', 'date', x.valid_until::timestamptz,
        'tag', 'saldo ' || x.balance) order by x.balance, x.nome), '[]'::jsonb) into v_total, v_items from (select * from s order by balance, nome limit 50) x;
  elsif p_kind in ('invitations_pending','invitations_expired') then
    with s as (select * from private.adm_invites(p_unit) where p_owner is null and p_type is null and p_kind_filter is null and state = case p_kind when 'invitations_pending' then 'pendente' else 'expirado' end)
    select (select count(*) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.email, 'subtitle', 'papel ' || x.role || ' · convite enviado em ' || to_char(x.created_at, 'DD/MM/YYYY'), 'date', x.expires_at, 'tag', x.state) order by x.expires_at), '[]'::jsonb)
      into v_total, v_items from (select * from s order by expires_at limit 50) x;
  elsif p_kind = 'access_review' then
    with s as (select * from private.adm_access_review(p_unit) where p_owner is null and p_type is null and p_kind_filter is null)
    select (select count(*) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.nome, 'subtitle', 'papel ' || x.role || ' · ' || x.reason, 'date', x.valid_until, 'tag', 'revisar') order by x.valid_until nulls first), '[]'::jsonb)
      into v_total, v_items from (select * from s order by valid_until nulls first limit 50) x;
  elsif p_kind = 'duplicates' then
    with s as (select d.* from private.adm_dups(p_unit) d where p_owner is null and p_type is distinct from 'pj')
    select (select count(distinct group_key) from s), coalesce(jsonb_agg(jsonb_build_object('id', x.person_id, 'title', x.nome, 'subtitle', x.reason, 'tag', 'grupo ' || substr(x.group_key, length(x.group_key) - 5)) order by x.group_key, x.nome), '[]'::jsonb)
      into v_total, v_items from (select * from s order by group_key, nome limit 50) x;
    v_basis := 'cadastros que aparecem em algum grupo de possível duplicidade (o total conta GRUPOS; os registros são as pessoas). Nada é mesclado automaticamente.';
  else
    with s as (select c.id, pe.nome nome, c.type::text ctype, c.value, c.verified_at, private.adm_contact_valid(c.type::text, c.value) ok
                 from public.person_contacts c join private.adm_people(p_unit, p_owner, p_kind_filter) pe on pe.id = c.person_id where p_type is distinct from 'pj')
    select (select count(*) from s where case p_kind when 'contacts_invalid' then not ok else verified_at is null end),
           coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.nome, 'subtitle', x.ctype || ' · ' || private.adm_mask(x.ctype, x.value),
             'tag', case when not x.ok then 'formato inválido' else 'não verificado' end) order by x.nome), '[]'::jsonb)
      into v_total, v_items from (select * from s where case p_kind when 'contacts_invalid' then not ok else verified_at is null end order by nome limit 50) x;
  end if;
  return private.ind_detail('admc_' || p_kind, v_label, v_total, v_basis, v_snapshot, p_from, p_to, v_items, v_total, v_route);
end $$;

-- ================================================================ pendências: criar, atribuir, prazo, resolver, reabrir, cancelar, listar, histórico
create or replace function private.adm_staff_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is null or exists (
    select 1 from public.user_accounts ua join public.role_assignments ra on ra.user_id = ua.user_id and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())
     where ua.user_id = p_user and ua.org_id = private.current_org() and ua.status = 'active'
       and ra.role in ('manager','ops_admin','unit_manager','sales','finance','physio','teacher'))
$$;
-- o usuário pode atuar sobre o cadastro (PF: unidade principal ou adicionais; PJ: unidades vinculadas)?
create or replace function private.adm_subject_ok(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.adm_all() or case p_type
    when 'person' then exists (select 1 from public.people p where p.id = p_id and p.org_id = private.current_org() and (private.adm_manage(p.unit_id) or exists (select 1 from public.person_units pu where pu.person_id = p.id and private.adm_manage(pu.unit_id))))
    when 'legal_entity' then exists (select 1 from public.legal_entity_units leu join public.legal_entities e on e.id = leu.legal_entity_id where e.id = p_id and e.org_id = private.current_org() and private.adm_manage(leu.unit_id))
    else false end
$$;
create or replace function private.adm_subject_unit(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'person' then (select unit_id from public.people where id = p_id and org_id = private.current_org())
    when 'legal_entity' then (select leu.unit_id from public.legal_entity_units leu join public.legal_entities e on e.id = leu.legal_entity_id where e.id = p_id and e.org_id = private.current_org() order by leu.unit_id limit 1)
    when 'professional' then (select pu.unit_id from public.professional_units pu join public.professionals pr on pr.id = pu.professional_id where pr.id = p_id and pr.org_id = private.current_org() order by pu.unit_id limit 1)
    when 'contract' then (select unit_id from public.adm_contracts where id = p_id and org_id = private.current_org())
    when 'invitation' then (select unit_id from public.invitations where id = p_id and org_id = private.current_org())
    when 'waitlist' then (select unit_id from public.waitlist where id = p_id and org_id = private.current_org())
    when 'package' then (select unit_id from public.client_packages where id = p_id and org_id = private.current_org())
    when 'access' then (select unit_id from public.role_assignments where id = p_id and org_id = private.current_org())
  end
$$;
create or replace function private.adm_subject_exists(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'person' then exists (select 1 from public.people where id = p_id and org_id = private.current_org())
    when 'legal_entity' then exists (select 1 from public.legal_entities where id = p_id and org_id = private.current_org())
    when 'professional' then exists (select 1 from public.professionals where id = p_id and org_id = private.current_org())
    when 'contract' then exists (select 1 from public.adm_contracts where id = p_id and org_id = private.current_org())
    when 'invitation' then exists (select 1 from public.invitations where id = p_id and org_id = private.current_org())
    when 'waitlist' then exists (select 1 from public.waitlist where id = p_id and org_id = private.current_org())
    when 'package' then exists (select 1 from public.client_packages where id = p_id and org_id = private.current_org())
    when 'access' then exists (select 1 from public.role_assignments where id = p_id and org_id = private.current_org())
    else false end
$$;

create or replace function public.adm_pendency_create(p_kind text, p_title text, p_detail text default null, p_subject_type text default null, p_subject uuid default null,
  p_unit uuid default null, p_responsible uuid default null, p_due date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_unit uuid := p_unit; v_id uuid; cfg public.adm_settings := private.adm_cfg();
begin
  if v_org is null or not private.adm_manage(null) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if (p_subject_type is null) <> (p_subject is null) then raise exception 'informe o tipo e o registro vinculado juntos'; end if;
  if p_subject is not null then
    if not private.adm_subject_exists(p_subject_type, p_subject) then raise exception 'registro vinculado não encontrado'; end if;
    v_unit := coalesce(v_unit, private.adm_subject_unit(p_subject_type, p_subject));
  end if;
  if not private.adm_write_ok(v_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.adm_staff_user(p_responsible) then raise exception 'responsável inválido: precisa ser alguém da equipe com acesso ativo'; end if;
  if p_due is not null and p_due < current_date - 365 then raise exception 'prazo inválido'; end if;
  insert into public.adm_pendencies (org_id, unit_id, kind, title, detail, subject_type, subject_id, responsible_user_id, due_date, opened_by)
    values (v_org, v_unit, coalesce(p_kind, 'outro'), btrim(p_title), nullif(btrim(p_detail), ''), p_subject_type, p_subject, p_responsible,
            coalesce(p_due, current_date + coalesce((cfg.pendency_due_days ->> coalesce(p_kind, 'outro'))::int, 7)), (select auth.uid())) returning id into v_id;
  insert into public.adm_pendency_events (pendency_id, actor, action, note) values (v_id, (select auth.uid()), 'created', p_title);
  return v_id;
end $$;

create or replace function private.adm_pend_lock(p_id uuid) returns public.adm_pendencies
language plpgsql security definer set search_path = '' as $$
declare x public.adm_pendencies;
begin
  select * into x from public.adm_pendencies where id = p_id and org_id = private.current_org() for update;
  if not found or not private.adm_write_ok(x.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return x;
end $$;
create or replace function public.adm_pendency_assign(p_id uuid, p_responsible uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.adm_pendencies := private.adm_pend_lock(p_id);
begin
  if x.status <> 'open' then raise exception 'só pendência aberta pode mudar de responsável'; end if;
  if not private.adm_staff_user(p_responsible) then raise exception 'responsável inválido: precisa ser alguém da equipe com acesso ativo'; end if;
  update public.adm_pendencies set responsible_user_id = p_responsible where id = p_id;
  insert into public.adm_pendency_events (pendency_id, actor, action, note) values (p_id, (select auth.uid()), 'assigned',
    coalesce((select coalesce(ua.display_name, ua.email::text) from public.user_accounts ua where ua.user_id = p_responsible), 'sem responsável'));
end $$;
create or replace function public.adm_pendency_set_due(p_id uuid, p_due date) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.adm_pendencies := private.adm_pend_lock(p_id);
begin
  if x.status <> 'open' then raise exception 'só pendência aberta pode mudar de prazo'; end if;
  update public.adm_pendencies set due_date = p_due where id = p_id;
  insert into public.adm_pendency_events (pendency_id, actor, action, note) values (p_id, (select auth.uid()), 'due_changed', coalesce(to_char(p_due, 'DD/MM/YYYY'), 'sem prazo'));
end $$;
create or replace function public.adm_pendency_resolve(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.adm_pendencies := private.adm_pend_lock(p_id);
begin
  if x.status <> 'open' then raise exception 'a pendência não está aberta'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'descreva a resolução'; end if;
  update public.adm_pendencies set status = 'resolved', resolved_at = now(), resolved_by = (select auth.uid()), resolution_note = btrim(p_note) where id = p_id;
  insert into public.adm_pendency_events (pendency_id, actor, action, note) values (p_id, (select auth.uid()), 'resolved', btrim(p_note));
end $$;
create or replace function public.adm_pendency_reopen(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.adm_pendencies := private.adm_pend_lock(p_id);
begin
  if x.status <> 'resolved' then raise exception 'só pendência concluída pode ser reaberta'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo da reabertura'; end if;
  if x.dedupe_key is not null and exists (select 1 from public.adm_pendencies y where y.org_id = x.org_id and y.dedupe_key = x.dedupe_key and y.status = 'open') then raise exception 'já existe uma pendência aberta para o mesmo problema'; end if;
  update public.adm_pendencies set status = 'open', reopened_at = now(), reopened_count = reopened_count + 1, resolved_at = null, resolved_by = null where id = p_id;
  insert into public.adm_pendency_events (pendency_id, actor, action, note) values (p_id, (select auth.uid()), 'reopened', btrim(p_reason));
end $$;
create or replace function public.adm_pendency_cancel(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.adm_pendencies := private.adm_pend_lock(p_id);
begin
  if x.status <> 'open' then raise exception 'só pendência aberta pode ser cancelada'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo do cancelamento'; end if;
  update public.adm_pendencies set status = 'cancelled' where id = p_id;
  insert into public.adm_pendency_events (pendency_id, actor, action, note) values (p_id, (select auth.uid()), 'cancelled', btrim(p_reason));
end $$;
create or replace function public.adm_pendency_list(p_unit uuid default null, p_owner uuid default null, p_type text default null, p_kind text default null, p_status text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.adm_scope_units(p_unit);
  return coalesce((select jsonb_agg(to_jsonb(x) - 'detail' || jsonb_build_object('detail', x.detail) order by (x.status = 'open') desc, x.overdue desc, x.due_date nulls last, x.opened_at)
    from (select * from private.adm_pends(p_unit, p_owner, p_type, p_kind, p_status) order by (status = 'open') desc, overdue desc, due_date nulls last, opened_at limit least(greatest(p_limit, 1), 500)) x), '[]'::jsonb);
end $$;
create or replace function public.adm_pendency_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.adm_scope_units(null);
  if not exists (select 1 from private.adm_pends(null, null, null, null, null) where id = p_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'note', e.note, 'actor', coalesce((select coalesce(ua.display_name, ua.email::text) from public.user_accounts ua where ua.user_id = e.actor), 'Sistema')) order by e.at, e.id)
    from public.adm_pendency_events e where e.pendency_id = p_id), '[]'::jsonb);
end $$;

-- ================================================================ documentos
create or replace function public.adm_document_register(p_subject_type text, p_subject uuid, p_doc_type uuid, p_title text, p_reference text default null,
  p_issued_on date default null, p_expires_on date default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); t public.adm_doc_types; v_id uuid; v_need text;
begin
  if v_org is null or p_subject_type not in ('person','legal_entity') then raise exception 'tipo de cadastro inválido'; end if;
  if not private.adm_subject_exists(p_subject_type, p_subject) or not private.adm_subject_ok(p_subject_type, p_subject) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into t from public.adm_doc_types where id = p_doc_type and org_id = v_org and active;
  if not found then raise exception 'tipo de documento inválido ou inativo'; end if;
  v_need := case p_subject_type when 'person' then 'pf' else 'pj' end;
  if t.applies_to <> v_need then raise exception 'este tipo de documento não se aplica a este cadastro'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'informe o título do documento'; end if;
  if p_expires_on is not null and p_issued_on is not null and p_expires_on < p_issued_on then raise exception 'a validade não pode ser anterior à emissão'; end if;
  if p_subject_type = 'person' then
    insert into public.person_documents (org_id, person_id, doc_type_id, title, reference, issued_on, expires_on, notes, registered_by) values (v_org, p_subject, p_doc_type, btrim(p_title), nullif(btrim(p_reference), ''), p_issued_on, p_expires_on, nullif(btrim(p_notes), ''), (select auth.uid())) returning id into v_id;
  else
    insert into public.legal_entity_documents (legal_entity_id, kind, title, doc_type_id, reference, issued_on, expires_on, notes, uploaded_by) values (p_subject, t.code, btrim(p_title), p_doc_type, nullif(btrim(p_reference), ''), p_issued_on, p_expires_on, nullif(btrim(p_notes), ''), (select auth.uid())) returning id into v_id;
  end if;
  return v_id;
end $$;
create or replace function public.adm_document_remove(p_subject_type text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sub uuid;
begin
  if p_subject_type = 'person' then
    select person_id into v_sub from public.person_documents where id = p_id and org_id = private.current_org() and removed_at is null;
    if v_sub is null or not private.adm_subject_ok('person', v_sub) then raise exception 'sem permissão' using errcode = '42501'; end if;
    update public.person_documents set removed_at = now(), removed_by = (select auth.uid()) where id = p_id;
  elsif p_subject_type = 'legal_entity' then
    select legal_entity_id into v_sub from public.legal_entity_documents where id = p_id and removed_at is null;
    if v_sub is null or not private.adm_subject_ok('legal_entity', v_sub) then raise exception 'sem permissão' using errcode = '42501'; end if;
    update public.legal_entity_documents set removed_at = now(), removed_by = (select auth.uid()) where id = p_id;
  else raise exception 'tipo de cadastro inválido'; end if;
end $$;
-- p_state: vencido | vencendo | valido | sem_validade | ausente (documentos EXIGIDOS sem registro)
create or replace function public.adm_documents_list(p_unit uuid default null, p_type text default null, p_state text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.adm_scope_units(p_unit);
  if p_state = 'ausente' then
    return coalesce((select jsonb_agg(jsonb_build_object('subject_type', x.subject_type, 'subject_id', x.subject_id, 'subject_name', x.subject_name, 'doc_type', x.req_label, 'state', 'ausente') order by x.subject_name)
      from (select * from private.adm_docs_missing(p_unit, p_type, null) order by subject_name limit least(greatest(p_limit, 1), 500)) x), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.expires_on nulls last)
    from (select * from private.adm_docs(p_unit, p_type, null) where p_state is null or state = p_state order by expires_on nulls last limit least(greatest(p_limit, 1), 500)) x), '[]'::jsonb);
end $$;

-- ================================================================ contratos administrativos (a assinatura é REGISTRADA manualmente — não é assinatura eletrônica)
create or replace function public.adm_contract_create(p_kind text, p_title text, p_subject_type text, p_subject uuid, p_responsible uuid default null,
  p_starts_on date default null, p_ends_on date default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_unit uuid; v_id uuid;
begin
  if v_org is null or p_subject_type not in ('person','legal_entity') then raise exception 'tipo de cadastro inválido'; end if;
  if not private.adm_subject_exists(p_subject_type, p_subject) or not private.adm_subject_ok(p_subject_type, p_subject) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.adm_staff_user(p_responsible) then raise exception 'responsável inválido: precisa ser alguém da equipe com acesso ativo'; end if;
  v_unit := private.adm_subject_unit(p_subject_type, p_subject);
  if not private.adm_write_ok(v_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into public.adm_contracts (org_id, unit_id, kind, title, subject_type, subject_id, responsible_user_id, starts_on, ends_on, notes, created_by)
    values (v_org, v_unit, p_kind, btrim(p_title), p_subject_type, p_subject, p_responsible, p_starts_on, p_ends_on, nullif(btrim(p_notes), ''), (select auth.uid())) returning id into v_id;
  insert into public.adm_contract_events (contract_id, actor, action, note) values (v_id, (select auth.uid()), 'created', btrim(p_title));
  return v_id;
end $$;
create or replace function private.adm_contract_lock(p_id uuid) returns public.adm_contracts
language plpgsql security definer set search_path = '' as $$
declare x public.adm_contracts;
begin
  select * into x from public.adm_contracts where id = p_id and org_id = private.current_org() for update;
  if not found or not private.adm_write_ok(x.unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return x;
end $$;
create or replace function public.adm_contract_send(p_id uuid, p_sign_until date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.adm_contracts := private.adm_contract_lock(p_id); cfg public.adm_settings := private.adm_cfg();
begin
  if x.status <> 'draft' then raise exception 'só contrato em rascunho pode ser enviado para assinatura'; end if;
  update public.adm_contracts set status = 'awaiting_signature', sent_at = now(), sent_by = (select auth.uid()), updated_at = now(),
    due_date = coalesce(p_sign_until, current_date + coalesce((cfg.pendency_due_days ->> 'contrato')::int, 7)) where id = p_id;
  insert into public.adm_contract_events (contract_id, actor, action, note) values (p_id, (select auth.uid()), 'sent', null);
end $$;
create or replace function public.adm_contract_sign(p_id uuid, p_signed_on date, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.adm_contracts := private.adm_contract_lock(p_id);
begin
  if x.status <> 'awaiting_signature' then raise exception 'só contrato aguardando assinatura pode ter a assinatura registrada'; end if;
  if p_signed_on is null or p_signed_on > current_date then raise exception 'informe a data em que foi assinado (não pode ser futura)'; end if;
  update public.adm_contracts set status = 'signed', signed_on = p_signed_on, signed_registered_at = now(), signed_registered_by = (select auth.uid()), updated_at = now() where id = p_id;
  insert into public.adm_contract_events (contract_id, actor, action, note) values (p_id, (select auth.uid()), 'signed', coalesce(nullif(btrim(p_note), ''), 'assinatura registrada manualmente'));
end $$;
create or replace function public.adm_contract_cancel(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.adm_contracts := private.adm_contract_lock(p_id);
begin
  if x.status = 'cancelled' then raise exception 'contrato já cancelado'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo'; end if;
  update public.adm_contracts set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now() where id = p_id;
  insert into public.adm_contract_events (contract_id, actor, action, note) values (p_id, (select auth.uid()), 'cancelled', btrim(p_reason));
end $$;
create or replace function public.adm_contract_assign(p_id uuid, p_responsible uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.adm_contracts := private.adm_contract_lock(p_id);
begin
  if not private.adm_staff_user(p_responsible) then raise exception 'responsável inválido: precisa ser alguém da equipe com acesso ativo'; end if;
  update public.adm_contracts set responsible_user_id = p_responsible, updated_at = now() where id = p_id;
  insert into public.adm_contract_events (contract_id, actor, action, note) values (p_id, (select auth.uid()), 'assigned', coalesce((select coalesce(ua.display_name, ua.email::text) from public.user_accounts ua where ua.user_id = p_responsible), 'sem responsável'));
end $$;
create or replace function public.adm_contracts_list(p_unit uuid default null, p_owner uuid default null, p_type text default null, p_status text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.adm_scope_units(p_unit);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.due_date nulls last, x.ends_on nulls last)
    from (select * from private.adm_contracts_rows(p_unit, p_owner, p_type) where p_status is null or status = p_status or situation = p_status
           order by due_date nulls last, ends_on nulls last limit least(greatest(p_limit, 1), 500)) x), '[]'::jsonb);
end $$;
create or replace function public.adm_contract_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.adm_scope_units(null);
  if not exists (select 1 from private.adm_contracts_rows(null, null, null) where id = p_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'note', e.note, 'actor', coalesce((select coalesce(ua.display_name, ua.email::text) from public.user_accounts ua where ua.user_id = e.actor), 'Sistema')) order by e.at, e.id)
    from public.adm_contract_events e where e.contract_id = p_id), '[]'::jsonb);
end $$;

-- ================================================================ verificação de contato (registro humano; formato válido NÃO é verificação)
create or replace function public.adm_contacts_search(p_q text, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.adm_scope_units(p_unit);
  if length(btrim(coalesce(p_q, ''))) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'person_id', pe.id, 'person', pe.nome, 'type', c.type, 'masked', private.adm_mask(c.type::text, c.value),
      'valid_format', private.adm_contact_valid(c.type::text, c.value), 'verified_at', c.verified_at, 'method', c.verification_method) order by pe.nome, c.type)
    from (select id, nome from private.adm_people(p_unit, null, null) where nome ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%' limit 30) pe join public.person_contacts c on c.person_id = pe.id), '[]'::jsonb);
end $$;
create or replace function public.adm_contact_verify(p_contact uuid, p_method text, p_verified boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare v_person uuid;
begin
  select person_id into v_person from public.person_contacts where id = p_contact and org_id = private.current_org();
  if v_person is null or not private.adm_subject_ok('person', v_person) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_verified and p_method not in ('conversa','codigo_enviado','documento','outro') then raise exception 'método de verificação inválido'; end if;
  perform set_config('hp.adm_verify', 'on', true);
  if p_verified then update public.person_contacts set verified_at = now(), verified_by = (select auth.uid()), verification_method = p_method where id = p_contact;
  else update public.person_contacts set verified_at = null, verified_by = null, verification_method = null where id = p_contact; end if;
  perform set_config('hp.adm_verify', 'off', true);
end $$;

-- ================================================================ configuração (leitura: quem administra; escrita: gestor/administrador operacional)
create or replace function public.adm_config_get() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); cfg public.adm_settings := private.adm_cfg();
begin
  perform private.adm_scope_units(null);
  return jsonb_build_object(
    'can_edit', private.adm_all(),
    'settings', jsonb_build_object('expiring_days', cfg.expiring_days, 'package_low_sessions', cfg.package_low_sessions, 'waiting_alert_days', cfg.waiting_alert_days, 'pendency_due_days', cfg.pendency_due_days),
    'doc_types', coalesce((select jsonb_agg(to_jsonb(t) - 'org_id' order by t.applies_to, t.label) from public.adm_doc_types t where t.org_id = v_org), '[]'::jsonb),
    'requirements', coalesce((select jsonb_agg(to_jsonb(r) - 'org_id' order by r.applies_to, r.check_type, r.label) from public.adm_requirements r where r.org_id = v_org), '[]'::jsonb),
    'catalog', jsonb_build_object(
      'field_refs', jsonb_build_object(
        'pf', jsonb_build_array(jsonb_build_object('ref','document','label','Documento (CPF)'), jsonb_build_object('ref','birth_date','label','Data de nascimento'), jsonb_build_object('ref','city','label','Cidade'), jsonb_build_object('ref','state','label','UF'),
          jsonb_build_object('ref','cep','label','CEP'), jsonb_build_object('ref','street','label','Logradouro'), jsonb_build_object('ref','contact','label','Algum contato'), jsonb_build_object('ref','contact_email','label','E-mail'),
          jsonb_build_object('ref','contact_phone','label','Telefone/WhatsApp'), jsonb_build_object('ref','contact_verified','label','Contato verificado')),
        'pj', jsonb_build_array(jsonb_build_object('ref','document','label','CNPJ'), jsonb_build_object('ref','city','label','Cidade'), jsonb_build_object('ref','state','label','UF'), jsonb_build_object('ref','contact','label','E-mail geral ou telefone'), jsonb_build_object('ref','representative','label','Representante cadastrado')),
        'professional', jsonb_build_array(jsonb_build_object('ref','council_registration','label','Registro no conselho'), jsonb_build_object('ref','unit','label','Vinculado a uma unidade'), jsonb_build_object('ref','access','label','Acesso ao sistema ativo'), jsonb_build_object('ref','availability','label','Disponibilidade de agenda'))),
      'contract_kinds', jsonb_build_array(jsonb_build_object('ref','prestacao_servico','label','Prestação de serviço'), jsonb_build_object('ref','parceria','label','Parceria'), jsonb_build_object('ref','termo_uso','label','Termo de uso'),
        jsonb_build_object('ref','confidencialidade','label','Confidencialidade'), jsonb_build_object('ref','outro','label','Outro'))));
end $$;
create or replace function public.adm_settings_save(p_expiring_days int, p_package_low_sessions int, p_waiting_alert_days int, p_due_days jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; v jsonb;
begin
  if not private.adm_all() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_expiring_days not between 1 and 365 or p_package_low_sessions not between 1 and 50 or p_waiting_alert_days not between 1 and 180 then raise exception 'valor fora dos limites'; end if;
  if jsonb_typeof(coalesce(p_due_days, '{}'::jsonb)) <> 'object' then raise exception 'prazos inválidos'; end if;
  for k, v in select * from jsonb_each(coalesce(p_due_days, '{}'::jsonb)) loop
    if k not in ('cadastro','documento','contrato','integracao_profissional','convite','agendamento','pacote','acesso','outro') or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 1 and 365 or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) then raise exception 'prazo inválido para %', k; end if;
  end loop;
  insert into public.adm_settings (org_id, expiring_days, package_low_sessions, waiting_alert_days, pendency_due_days, updated_by) values (private.current_org(), p_expiring_days, p_package_low_sessions, p_waiting_alert_days, coalesce(p_due_days, '{}'::jsonb), (select auth.uid()))
    on conflict (org_id) do update set expiring_days = excluded.expiring_days, package_low_sessions = excluded.package_low_sessions, waiting_alert_days = excluded.waiting_alert_days,
      pendency_due_days = excluded.pendency_due_days, updated_at = now(), updated_by = excluded.updated_by;
end $$;
create or replace function public.adm_doc_type_save(p_id uuid, p_code text, p_label text, p_applies_to text, p_has_expiry boolean, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.adm_all() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.adm_doc_types (org_id, code, label, applies_to, has_expiry, active) values (private.current_org(), p_code, btrim(p_label), p_applies_to, p_has_expiry, coalesce(p_active, true)) returning id into v_id;
  else
    update public.adm_doc_types set label = btrim(p_label), has_expiry = p_has_expiry, active = coalesce(p_active, true) where id = p_id and org_id = private.current_org() returning id into v_id;   -- código e tipo de cadastro não mudam (requisitos apontam para eles)
    if v_id is null then raise exception 'tipo de documento não encontrado'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'já existe um tipo de documento com este código';
end $$;
create or replace function public.adm_requirement_save(p_id uuid, p_applies_to text, p_check_type text, p_check_ref text, p_label text, p_required boolean default true, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ok boolean;
begin
  if not private.adm_all() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_check_type = 'field' then
    v_ok := case when p_applies_to = 'pj' then p_check_ref in ('document','city','state','contact','representative')
                 when p_applies_to = 'professional' then p_check_ref in ('council_registration','unit','access','availability')
                 else p_check_ref in ('document','birth_date','city','state','cep','street','contact','contact_email','contact_phone','contact_verified') end;
  elsif p_check_type = 'document' then
    v_ok := exists (select 1 from public.adm_doc_types t where t.org_id = private.current_org() and t.code = p_check_ref and t.active and t.applies_to = case when p_applies_to = 'pj' then 'pj' else 'pf' end);
  elsif p_check_type = 'contract' then v_ok := p_check_ref in ('prestacao_servico','parceria','termo_uso','confidencialidade','outro');
  else v_ok := false; end if;
  if not v_ok then raise exception 'referência inválida para este requisito'; end if;
  if p_id is null then
    insert into public.adm_requirements (org_id, applies_to, check_type, check_ref, label, required, active) values (private.current_org(), p_applies_to, p_check_type, p_check_ref, btrim(p_label), coalesce(p_required, true), coalesce(p_active, true)) returning id into v_id;
  else
    update public.adm_requirements set label = btrim(p_label), required = coalesce(p_required, true), active = coalesce(p_active, true) where id = p_id and org_id = private.current_org() returning id into v_id;
    if v_id is null then raise exception 'requisito não encontrado'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'este requisito já existe';
end $$;
create or replace function public.adm_requirement_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.adm_all() then raise exception 'sem permissão' using errcode = '42501'; end if;
  delete from public.adm_requirements where id = p_id and org_id = private.current_org();
end $$;

-- ================================================================ sincronização: registra a medição de integração e gera/encerra pendências AUTOMÁTICAS dos problemas detectados
-- Só gestor/administrador operacional (escopo da organização). Idempotente: um problema aberto nunca vira duas pendências (dedupe_key). Pendência automática cuja condição deixou de existir
-- é encerrada com a nota "Regularizado — verificado automaticamente". Pendências manuais nunca são tocadas. Nada de cadastro incompleto em massa: isso se trabalha no Diretório.
create or replace function public.adm_sync() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); cfg public.adm_settings := private.adm_cfg(); v_created int := 0; v_closed int := 0; v_stamped int := 0; v_start timestamptz;
begin
  if v_org is null or not private.adm_all() then raise exception 'sem permissão' using errcode = '42501'; end if;
  -- 1) medição da integração de profissionais (começa na primeira avaliação; quem já estava completo não ganha data inventada)
  select coalesce(min(first_evaluated_at), now()) into v_start from public.adm_professional_onboarding where org_id = v_org;
  insert into public.adm_professional_onboarding (professional_id, org_id, started_at, complete_at_first_evaluation)
    select p.id, v_org, greatest(p.created_at, v_start), cardinality(p.unmet) = 0 from private.adm_profs(null) p
     where p.active and not exists (select 1 from public.adm_professional_onboarding o where o.professional_id = p.id);
  update public.adm_professional_onboarding o set completed_at = now() from private.adm_profs(null) p
   where p.id = o.professional_id and p.active and cardinality(p.unmet) = 0 and o.completed_at is null and not o.complete_at_first_evaluation;
  get diagnostics v_stamped = row_count;
  -- 2) problemas detectados hoje
  drop table if exists pg_temp.adm_want;
  create temporary table adm_want on commit drop as
  select * from (
    select 'doc-expired:' || d.doc_id k, 'documento' kind, 'Documento vencido: ' || d.doc_type || ' (' || d.subject_name || ')' title,
           case d.subject_type when 'pf' then 'person' else 'legal_entity' end st, d.subject_id sid, null::uuid resp,
           current_date + coalesce((cfg.pendency_due_days ->> 'documento')::int, 7) due
      from private.adm_docs(null) d where d.state = 'vencido'
    union all select 'doc-expiring:' || d.doc_id, 'documento', 'Documento vencendo: ' || d.doc_type || ' (' || d.subject_name || ')', case d.subject_type when 'pf' then 'person' else 'legal_entity' end, d.subject_id, null::uuid, d.expires_on
      from private.adm_docs(null) d where d.state = 'vencendo'
    union all select 'contract-sign:' || c.id, 'contrato', 'Contrato aguardando assinatura: ' || c.title, 'contract', c.id, c.responsible, coalesce(c.due_date, current_date + coalesce((cfg.pendency_due_days ->> 'contrato')::int, 7))
      from private.adm_contracts_rows(null) c where c.status = 'awaiting_signature'
    union all select 'prof-onboarding:' || p.id, 'integracao_profissional', 'Integração incompleta de ' || p.nome || ': falta ' || (select string_agg(split_part(u, '|', 2), ', ') from unnest(p.unmet) u), 'professional', p.id, null::uuid,
           current_date + coalesce((cfg.pendency_due_days ->> 'integracao_profissional')::int, 14)
      from private.adm_profs(null) p where p.active and cardinality(p.unmet) > 0
    union all select 'invite:' || i.id, 'convite', 'Convite não aceito (' || i.state || '): ' || i.email, 'invitation', i.id, null::uuid, current_date + coalesce((cfg.pendency_due_days ->> 'convite')::int, 7)
      from private.adm_invites(null) i where i.state = 'expirado'
    union all select 'wait:' || w.id, 'agendamento', 'Solicitação de agendamento há ' || w.days || ' dias: ' || w.nome, 'waitlist', w.id, null::uuid, current_date + coalesce((cfg.pendency_due_days ->> 'agendamento')::int, 3)
      from private.adm_wait(null) w where w.days >= cfg.waiting_alert_days
    union all select 'pkg:' || k.id, 'pacote', 'Pacote perto do fim sem próximo atendimento: ' || k.nome || ' (' || k.product_name || ', saldo ' || k.balance || ')', 'package', k.id, null::uuid, current_date + coalesce((cfg.pendency_due_days ->> 'pacote')::int, 7)
      from private.adm_pkgs(null) k
    union all select 'access:' || a.id, 'acesso', 'Revisar acesso de ' || a.nome || ' (' || a.role || '): ' || a.reason, 'access', a.id, null::uuid, current_date + coalesce((cfg.pendency_due_days ->> 'acesso')::int, 7)
      from private.adm_access_review(null) a) w;
  with ins as (
    insert into public.adm_pendencies (org_id, unit_id, kind, title, subject_type, subject_id, responsible_user_id, due_date, origin, dedupe_key)
      select v_org, private.adm_subject_unit(w.st, w.sid), w.kind, w.title, w.st, w.sid, w.resp, w.due, 'auto', w.k from adm_want w
      on conflict (org_id, dedupe_key) where status = 'open' and dedupe_key is not null do nothing returning id, title)
  insert into public.adm_pendency_events (pendency_id, actor, action, note) select id, null, 'created', 'Detectada automaticamente: ' || title from ins;
  get diagnostics v_created = row_count;
  with cl as (
    update public.adm_pendencies x set status = 'resolved', resolved_at = now(), resolved_by = null, resolution_note = 'Regularizado — verificado automaticamente na sincronização'
     where x.org_id = v_org and x.origin = 'auto' and x.status = 'open' and x.dedupe_key is not null and not exists (select 1 from adm_want w where w.k = x.dedupe_key) returning x.id)
  insert into public.adm_pendency_events (pendency_id, actor, action, note) select id, null, 'resolved', 'Regularizado — verificado automaticamente na sincronização' from cl;
  get diagnostics v_closed = row_count;
  return jsonb_build_object('created', v_created, 'auto_resolved', v_closed, 'professionals_completed_now', v_stamped);
end $$;

-- ================================================================ privilégios
revoke all on function private.adm_staff_user(uuid), private.adm_subject_ok(text, uuid), private.adm_subject_unit(text, uuid), private.adm_subject_exists(text, uuid), private.adm_pend_lock(uuid), private.adm_contract_lock(uuid) from public, anon, authenticated;
revoke all on function public.adm_central(timestamptz, timestamptz, uuid, uuid, text, text, text), public.adm_central_detail(text, text, timestamptz, timestamptz, uuid, uuid, text, text, text),
  public.adm_pendency_create(text, text, text, text, uuid, uuid, uuid, date), public.adm_pendency_assign(uuid, uuid), public.adm_pendency_set_due(uuid, date), public.adm_pendency_resolve(uuid, text),
  public.adm_pendency_reopen(uuid, text), public.adm_pendency_cancel(uuid, text), public.adm_pendency_list(uuid, uuid, text, text, text, int), public.adm_pendency_history(uuid),
  public.adm_document_register(text, uuid, uuid, text, text, date, date, text), public.adm_document_remove(text, uuid), public.adm_documents_list(uuid, text, text, int),
  public.adm_contract_create(text, text, text, uuid, uuid, date, date, text), public.adm_contract_send(uuid, date), public.adm_contract_sign(uuid, date, text), public.adm_contract_cancel(uuid, text),
  public.adm_contract_assign(uuid, uuid), public.adm_contracts_list(uuid, uuid, text, text, int), public.adm_contract_history(uuid), public.adm_contacts_search(text, uuid),
  public.adm_contact_verify(uuid, text, boolean), public.adm_config_get(), public.adm_settings_save(int, int, int, jsonb), public.adm_doc_type_save(uuid, text, text, text, boolean, boolean),
  public.adm_requirement_save(uuid, text, text, text, text, boolean, boolean), public.adm_requirement_delete(uuid), public.adm_sync() from public, anon;
grant execute on function public.adm_central(timestamptz, timestamptz, uuid, uuid, text, text, text), public.adm_central_detail(text, text, timestamptz, timestamptz, uuid, uuid, text, text, text),
  public.adm_pendency_create(text, text, text, text, uuid, uuid, uuid, date), public.adm_pendency_assign(uuid, uuid), public.adm_pendency_set_due(uuid, date), public.adm_pendency_resolve(uuid, text),
  public.adm_pendency_reopen(uuid, text), public.adm_pendency_cancel(uuid, text), public.adm_pendency_list(uuid, uuid, text, text, text, int), public.adm_pendency_history(uuid),
  public.adm_document_register(text, uuid, uuid, text, text, date, date, text), public.adm_document_remove(text, uuid), public.adm_documents_list(uuid, text, text, int),
  public.adm_contract_create(text, text, text, uuid, uuid, date, date, text), public.adm_contract_send(uuid, date), public.adm_contract_sign(uuid, date, text), public.adm_contract_cancel(uuid, text),
  public.adm_contract_assign(uuid, uuid), public.adm_contracts_list(uuid, uuid, text, text, int), public.adm_contract_history(uuid), public.adm_contacts_search(text, uuid),
  public.adm_contact_verify(uuid, text, boolean), public.adm_config_get(), public.adm_settings_save(int, int, int, jsonb), public.adm_doc_type_save(uuid, text, text, text, boolean, boolean),
  public.adm_requirement_save(uuid, text, text, text, text, boolean, boolean), public.adm_requirement_delete(uuid), public.adm_sync() to authenticated;
