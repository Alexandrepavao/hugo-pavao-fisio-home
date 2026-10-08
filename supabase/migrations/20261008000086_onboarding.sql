-- HP Group Hub — 086 Onboarding de fisioterapeutas (link único por convite) e de pacientes (rota aberta) + "Primeiro acesso" só para quem tem cadastro.
-- Fluxo: a pessoa preenche o formulário → o cadastro entra em Pessoas (PF; PJ quando informa CNPJ) → nasce um CONVITE de acesso (papel physio ou member) →
-- o front cria a conta (senha) e o e-mail é confirmado → o gatilho de convites existente concede o papel e liga conta ↔ pessoa (↔ profissional).
-- Segurança:
--  · fisioterapeuta: só com um link emitido pelo gestor (token aleatório, guardado só como hash, uso único, 14 dias); sem link nada é gravado
--  · paciente (rota aberta): limites por IP e globais, isca anti-robô, e se o e-mail JÁ existe no cadastro NADA é escrito antes de o dono do e-mail confirmá-lo
--    (os dados ficam retidos e só preenchem campos vazios depois da confirmação; CPF repetido em outro cadastro nunca vira vínculo automático)
--  · tabelas novas: sem acesso anônimo; dados bancários, de saúde e do convite só para a própria pessoa ou gestor/administrativo

alter table public.people add column if not exists rg text;

-- ---------------------------------------------------------------- tabelas
create table public.onboarding_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('physio')),
  token_hash text not null unique,
  email extensions.citext,
  full_name text,
  unit_id uuid not null references public.units(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz, submission_id uuid,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('physio','patient')),
  person_id uuid references public.people(id) on delete set null,
  legal_entity_id uuid references public.legal_entities(id) on delete set null,
  professional_id uuid references public.professionals(id) on delete set null,
  link_id uuid references public.onboarding_links(id) on delete set null,
  doc_kind text not null check (doc_kind in ('pf','pj')),
  email extensions.citext not null,
  status text not null default 'applied' check (status in ('applied','awaiting_confirmation')),
  payload jsonb,                       -- só enquanto aguarda a confirmação do e-mail (pessoa que já existia); apagado ao aplicar
  consent_version text not null, consent_at timestamptz not null default now(), health_consent boolean not null default false,
  ip_hash text, created_at timestamptz not null default now()
);
create index onboarding_submissions_person_idx on public.onboarding_submissions (person_id) where status = 'awaiting_confirmation';
create table public.professional_profiles (
  person_id uuid primary key references public.people(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete set null,
  work_as text not null default 'pf' check (work_as in ('pf','pj')),
  council_uf text check (council_uf ~ '^[A-Z]{2}$'),
  specialties text[] not null default '{}', education text, bio text, service_regions text,
  updated_at timestamptz not null default now()
);
create table public.person_bank_info (
  person_id uuid primary key references public.people(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  pix_key_type text check (pix_key_type in ('cpf','cnpj','email','phone','random')), pix_key text,
  bank_name text, bank_agency text, bank_account text,
  updated_at timestamptz not null default now()
);
create table public.person_intake (
  person_id uuid primary key references public.people(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  emergency_name text, emergency_phone text, emergency_relation text, address_reference text,
  main_complaint text, how_found text, health_consent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.onboarding_links enable row level security;
alter table public.onboarding_submissions enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.person_bank_info enable row level security;
alter table public.person_intake enable row level security;
revoke all on public.onboarding_links, public.onboarding_submissions, public.professional_profiles, public.person_bank_info, public.person_intake from public, anon, authenticated;
create policy onboarding_links_read on public.onboarding_links for select to authenticated
  using (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy onboarding_submissions_read on public.onboarding_submissions for select to authenticated
  using (org_id = private.current_org() and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy professional_profiles_read on public.professional_profiles for select to authenticated
  using (org_id = private.current_org() and (person_id = private.current_person() or private.has_org_role(array['manager','ops_admin']::public.app_role[])));
create policy person_bank_info_read on public.person_bank_info for select to authenticated
  using (org_id = private.current_org() and (person_id = private.current_person() or private.has_org_role(array['manager','ops_admin']::public.app_role[])));
create policy person_intake_read on public.person_intake for select to authenticated
  using (org_id = private.current_org() and (person_id = private.current_person() or private.has_org_role(array['manager','ops_admin']::public.app_role[])));
-- o token nunca sai da tabela (só o hash existe, e mesmo ele não é exposto)
grant select (id, org_id, kind, email, full_name, unit_id, expires_at, used_at, revoked_at, created_by, created_at) on public.onboarding_links to authenticated;
grant select on public.onboarding_submissions, public.professional_profiles, public.person_bank_info, public.person_intake to authenticated;

-- ---------------------------------------------------------------- auxiliares internos
create or replace function private.onb_str(p jsonb, k text, p_max int default 200) returns text
language sql immutable set search_path = '' as $$ select nullif(left(btrim(regexp_replace(coalesce(p ->> k, ''), '\s+', ' ', 'g')), p_max), '') $$;
revoke all on function private.onb_str(jsonb, text, int) from public, anon, authenticated;

create or replace function private.onb_date(p jsonb, k text, p_label text) returns date
language plpgsql immutable set search_path = '' as $$
declare s text := nullif(btrim(coalesce(p ->> k, '')), '');
begin
  if s is null then return null; end if;
  if s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '% inválida', p_label; end if;
  begin return s::date; exception when others then raise exception '% inválida', p_label; end;
end $$;
revoke all on function private.onb_date(jsonb, text, text) from public, anon, authenticated;

-- endereço comum (validação) -> jsonb limpo
create or replace function private.onb_address(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare cep text := nullif(regexp_replace(coalesce(p ->> 'cep', ''), '\D', '', 'g'), ''); uf text := nullif(upper(btrim(coalesce(p ->> 'state_uf', ''))), '');
begin
  if cep is null or length(cep) <> 8 then raise exception 'CEP inválido (8 números)'; end if;
  if private.onb_str(p, 'street', 160) is null then raise exception 'Informe a rua'; end if;
  if private.onb_str(p, 'street_number', 20) is null then raise exception 'Informe o número do endereço (ou S/N)'; end if;
  if private.onb_str(p, 'neighborhood', 100) is null then raise exception 'Informe o bairro'; end if;
  if private.onb_str(p, 'city', 100) is null then raise exception 'Informe a cidade'; end if;
  if uf is null or uf !~ '^[A-Z]{2}$' then raise exception 'Informe a UF'; end if;
  return jsonb_build_object('cep', cep, 'street', private.onb_str(p, 'street', 160), 'street_number', private.onb_str(p, 'street_number', 20), 'complement', private.onb_str(p, 'complement', 100),
    'neighborhood', private.onb_str(p, 'neighborhood', 100), 'city', private.onb_str(p, 'city', 100), 'state_uf', uf);
end $$;
revoke all on function private.onb_address(jsonb) from public, anon, authenticated;

-- cria a pessoa (PF) com tipo, contatos e endereço
create or replace function private.onb_create_person(p_org uuid, p_unit uuid, p_name text, p_pref text, p_birth date, p_cpf text, p_rg text, p_email text, p_phone text,
  p_addr jsonb, p_origin text, p_kind public.person_kind, p_pending boolean default false, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.people (org_id, unit_id, full_name, preferred_name, birth_date, document_number, rg, cep, street, street_number, complement, neighborhood, city, state_uf, country, origin, registration_status, notes)
  values (p_org, p_unit, p_name, p_pref, p_birth, p_cpf, p_rg, p_addr ->> 'cep', p_addr ->> 'street', p_addr ->> 'street_number', p_addr ->> 'complement', p_addr ->> 'neighborhood', p_addr ->> 'city', p_addr ->> 'state_uf', 'BR',
          p_origin, case when p_pending then 'pendente' else 'ativo' end, p_note)
  returning id into v_id;
  insert into public.person_kinds (person_id, kind) values (v_id, p_kind);
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (p_org, v_id, 'email', p_email, true);
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (p_org, v_id, 'phone', p_phone, true);
  return v_id;
end $$;
revoke all on function private.onb_create_person(uuid, uuid, text, text, date, text, text, text, text, jsonb, text, public.person_kind, boolean, text) from public, anon, authenticated;

-- preenche SÓ o que está vazio no cadastro existente (nunca sobrescreve)
create or replace function private.onb_fill_person(p_person uuid, p_pref text, p_birth date, p_cpf text, p_rg text, p_phone text, p_addr jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.people where id = p_person;
  update public.people set preferred_name = coalesce(preferred_name, p_pref), birth_date = coalesce(birth_date, p_birth), rg = coalesce(rg, p_rg),
    document_number = case when document_number is null and p_cpf is not null and not exists (select 1 from public.people x where x.org_id = v_org and x.document_number = p_cpf and x.id <> p_person and x.merged_into_id is null) then p_cpf else document_number end,
    cep = coalesce(cep, p_addr ->> 'cep'), street = coalesce(street, p_addr ->> 'street'), street_number = coalesce(street_number, p_addr ->> 'street_number'), complement = coalesce(complement, p_addr ->> 'complement'),
    neighborhood = coalesce(neighborhood, p_addr ->> 'neighborhood'), city = coalesce(city, p_addr ->> 'city'), state_uf = coalesce(state_uf, p_addr ->> 'state_uf')
   where id = p_person;
  if p_phone is not null and not exists (select 1 from public.person_contacts where person_id = p_person and type = 'phone') then
    insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, p_person, 'phone', p_phone, true);
  end if;
end $$;
revoke all on function private.onb_fill_person(uuid, text, date, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 1) links de convite (gestor)
create or replace function public.onboarding_link_create(p_email text, p_full_name text, p_unit uuid, p_days int default 14) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_email text := nullif(lower(btrim(coalesce(p_email, ''))), ''); v_token text; v_id uuid; v_exp timestamptz;
begin
  if v_org is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.units where id = p_unit and org_id = v_org and active) then raise exception 'escolha uma unidade ativa'; end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
  if p_days is null or p_days not between 1 and 60 then raise exception 'a validade do link deve ser de 1 a 60 dias'; end if;
  if v_email is not null and exists (select 1 from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null) then
    raise exception 'este e-mail já tem conta no sistema: use Profissionais > Liberar acesso, não o onboarding';
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex'); v_exp := now() + make_interval(days => p_days);
  insert into public.onboarding_links (org_id, kind, token_hash, email, full_name, unit_id, expires_at, created_by)
  values (v_org, 'physio', encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_email, nullif(btrim(coalesce(p_full_name, '')), ''), p_unit, v_exp, (select auth.uid())) returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id) values (v_org, (select auth.uid()), 'onboarding_link_created', 'onboarding_link', v_id::text, p_unit);
  return jsonb_build_object('id', v_id, 'token', v_token, 'path', '/onboarding-fisio?convite=' || v_token, 'expires_at', v_exp);
end $$;
revoke all on function public.onboarding_link_create(text, text, uuid, int) from public, anon;
grant execute on function public.onboarding_link_create(text, text, uuid, int) to authenticated;

create or replace function public.onboarding_link_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if v_org is null or not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.onboarding_links set revoked_at = now() where id = p_id and org_id = v_org and used_at is null and revoked_at is null;
  if not found then raise exception 'link não encontrado, já usado ou já cancelado'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id) values (v_org, (select auth.uid()), 'onboarding_link_revoked', 'onboarding_link', p_id::text);
end $$;
revoke all on function public.onboarding_link_revoke(uuid) from public, anon;
grant execute on function public.onboarding_link_revoke(uuid) to authenticated;

-- ---------------------------------------------------------------- 2) o formulário consulta o link (anônimo)
create or replace function public.onboarding_link_info(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.onboarding_links; v_unit text;
begin
  perform private.rate_limit('onb_info:' || private.client_ip_hash(), interval '10 minutes', 40);
  select * into l from public.onboarding_links where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  if l.revoked_at is not null then return jsonb_build_object('valid', false, 'reason', 'revoked'); end if;
  if l.used_at is not null then return jsonb_build_object('valid', false, 'reason', 'used'); end if;
  if l.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  select name into v_unit from public.units where id = l.unit_id;
  return jsonb_build_object('valid', true, 'kind', l.kind, 'email', l.email, 'full_name', l.full_name, 'unit', v_unit);
end $$;
revoke all on function public.onboarding_link_info(text) from public, anon;
grant execute on function public.onboarding_link_info(text) to anon, authenticated;

-- ---------------------------------------------------------------- 3) cadastro do fisioterapeuta (anônimo, exige link válido)
create or replace function public.onboarding_submit_physio(p_token text, p_data jsonb, p_consent_version text, p_honeypot text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.onboarding_links; v_ip text := private.client_ip_hash(); v_addr jsonb;
  v_name text; v_pref text; v_birth date; v_cpf text; v_rg text; v_email text; v_phone text; v_phone_digits text;
  v_council text; v_council_uf text; v_specs text[]; v_pj boolean; v_cnpj text; v_legal text; v_trade text;
  v_pix_type text; v_pix text; v_person uuid; v_entity uuid; v_prof uuid; v_sub uuid; v_docs text; v_age int; v_text text;
begin
  if p_honeypot is not null and btrim(p_honeypot) <> '' then return jsonb_build_object('status', 'created'); end if;
  perform private.rate_limit('onb_physio:' || v_ip, interval '10 minutes', 10);
  perform private.rate_limit('onb_physiog', interval '1 hour', 200);
  select * into l from public.onboarding_links where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') for update;
  if not found or l.revoked_at is not null or l.used_at is not null or l.expires_at <= now() then
    raise exception 'Este link é inválido, já foi usado ou expirou. Peça um novo convite à HP.';
  end if;
  if p_consent_version is null or btrim(p_consent_version) = '' then raise exception 'É preciso aceitar o termo de tratamento de dados pessoais.'; end if;

  v_name := private.onb_str(p_data, 'full_name', 160);
  if v_name is null or v_name !~ '^\S{2,}(\s+\S+)+$' then raise exception 'Informe o nome completo (nome e sobrenome)'; end if;
  v_pref := private.onb_str(p_data, 'preferred_name', 80);
  v_birth := private.onb_date(p_data, 'birth_date', 'Data de nascimento');
  if v_birth is null then raise exception 'Informe a data de nascimento'; end if;
  v_age := extract(year from age(current_date, v_birth));
  if v_age < 18 or v_age > 100 then raise exception 'Data de nascimento inválida para um profissional'; end if;
  v_cpf := nullif(regexp_replace(coalesce(p_data ->> 'cpf', ''), '\D', '', 'g'), '');
  if v_cpf is null or not private.is_valid_cpf(v_cpf) then raise exception 'CPF inválido'; end if;
  v_rg := private.onb_str(p_data, 'rg', 30);
  v_email := coalesce(lower(l.email::text), nullif(lower(btrim(coalesce(p_data ->> 'email', ''))), ''));
  if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
  if l.email is not null and lower(btrim(coalesce(p_data ->> 'email', ''))) <> v_email then raise exception 'O e-mail deste convite é %: use exatamente ele', v_email; end if;
  v_phone := private.onb_str(p_data, 'phone', 30); v_phone_digits := regexp_replace(coalesce(v_phone, ''), '\D', '', 'g');
  if length(v_phone_digits) not between 10 and 13 then raise exception 'Telefone/WhatsApp inválido (com DDD)'; end if;
  v_addr := private.onb_address(p_data);
  v_council := regexp_replace(coalesce(p_data ->> 'council_number', ''), '[^0-9A-Za-z-]', '', 'g');
  v_council_uf := nullif(upper(btrim(coalesce(p_data ->> 'council_uf', ''))), '');
  if length(v_council) < 3 then raise exception 'Informe o número do CREFITO'; end if;
  if v_council_uf is null or v_council_uf !~ '^[A-Z]{2}$' then raise exception 'Informe a UF do CREFITO'; end if;
  select coalesce(array_agg(x order by x), '{}') into v_specs from (select distinct left(btrim(e), 60) x from jsonb_array_elements_text(coalesce(p_data -> 'specialties', '[]'::jsonb)) e where btrim(e) <> '' limit 12) s;
  if coalesce(array_length(v_specs, 1), 0) = 0 then raise exception 'Escolha ao menos uma especialidade'; end if;
  v_pj := coalesce((p_data ->> 'work_as'), 'pf') = 'pj';
  if v_pj then
    v_cnpj := nullif(regexp_replace(coalesce(p_data ->> 'cnpj', ''), '\D', '', 'g'), '');
    if v_cnpj is null or not private.is_valid_cnpj(v_cnpj) then raise exception 'CNPJ inválido'; end if;
    v_legal := private.onb_str(p_data, 'legal_name', 160); v_trade := private.onb_str(p_data, 'trade_name', 160);
    if v_legal is null then raise exception 'Informe a razão social'; end if;
  end if;
  v_pix_type := nullif(lower(btrim(coalesce(p_data ->> 'pix_key_type', ''))), ''); v_pix := private.onb_str(p_data, 'pix_key', 120);
  if v_pix is null or v_pix_type is null or v_pix_type not in ('cpf','cnpj','email','phone','random') then raise exception 'Informe a chave PIX para os repasses'; end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null) then
    raise exception 'Este e-mail já tem conta no sistema. Peça à HP para liberar o acesso de fisioterapeuta nela.';
  end if;

  -- pessoa: reaproveita o cadastro que já tem este e-mail (o gestor pode tê-lo criado antes); nunca duplica CPF
  select p.id into v_person from public.people p join public.person_contacts c on c.person_id = p.id
   where p.org_id = l.org_id and p.merged_into_id is null and c.type = 'email' and c.normalized = v_email limit 1;
  if v_person is null then
    if exists (select 1 from public.people x where x.org_id = l.org_id and x.document_number = v_cpf and x.merged_into_id is null) then
      raise exception 'Este CPF já consta em outro cadastro com outro e-mail. Fale com a HP para conferir.';
    end if;
    v_person := private.onb_create_person(l.org_id, l.unit_id, v_name, v_pref, v_birth, v_cpf, v_rg, v_email, v_phone, v_addr, 'onboarding_fisio', 'staff');
  else
    if exists (select 1 from public.professionals where person_id = v_person) then raise exception 'Já existe um profissional cadastrado com este e-mail. Fale com a HP.'; end if;
    perform private.onb_fill_person(v_person, v_pref, v_birth, v_cpf, v_rg, v_phone, v_addr);
    insert into public.person_kinds (person_id, kind) values (v_person, 'staff') on conflict do nothing;
  end if;

  if v_pj then
    select id into v_entity from public.legal_entities where org_id = l.org_id and cnpj = v_cnpj and merged_into_id is null;
    if v_entity is null then
      insert into public.legal_entities (org_id, cnpj, legal_name, trade_name, email_general, phone, cep, street, street_number, complement, neighborhood, city, state_uf, origin, registration_status)
      values (l.org_id, v_cnpj, v_legal, v_trade, v_email, v_phone, v_addr ->> 'cep', v_addr ->> 'street', v_addr ->> 'street_number', v_addr ->> 'complement', v_addr ->> 'neighborhood', v_addr ->> 'city', v_addr ->> 'state_uf', 'onboarding_fisio', 'ativo')
      returning id into v_entity;
      insert into public.legal_entity_units (legal_entity_id, unit_id) values (v_entity, l.unit_id) on conflict do nothing;
    end if;
    insert into public.legal_entity_representatives (legal_entity_id, person_id, role_title, representation_type, is_primary)
    values (v_entity, v_person, 'Fisioterapeuta responsável', 'legal_representative', not exists (select 1 from public.legal_entity_representatives r where r.legal_entity_id = v_entity and r.is_primary))
    on conflict do nothing;
  end if;

  insert into public.professionals (org_id, person_id, display_name, council_registration, active)
  values (l.org_id, v_person, coalesce(v_pref, v_name), format('CREFITO-%s %s', v_council_uf, v_council), true) returning id into v_prof;
  insert into public.professional_units (professional_id, unit_id) values (v_prof, l.unit_id);
  insert into public.professional_profiles (person_id, org_id, professional_id, work_as, council_uf, specialties, education, bio, service_regions)
  values (v_person, l.org_id, v_prof, case when v_pj then 'pj' else 'pf' end, v_council_uf, v_specs, private.onb_str(p_data, 'education', 400), private.onb_str(p_data, 'bio', 600), private.onb_str(p_data, 'service_regions', 300))
  on conflict (person_id) do update set professional_id = excluded.professional_id, work_as = excluded.work_as, council_uf = excluded.council_uf, specialties = excluded.specialties,
    education = excluded.education, bio = excluded.bio, service_regions = excluded.service_regions, updated_at = now();
  insert into public.person_bank_info (person_id, org_id, pix_key_type, pix_key, bank_name, bank_agency, bank_account)
  values (v_person, l.org_id, v_pix_type, v_pix, private.onb_str(p_data, 'bank_name', 80), private.onb_str(p_data, 'bank_agency', 20), private.onb_str(p_data, 'bank_account', 30))
  on conflict (person_id) do update set pix_key_type = excluded.pix_key_type, pix_key = excluded.pix_key, bank_name = excluded.bank_name, bank_agency = excluded.bank_agency, bank_account = excluded.bank_account, updated_at = now();

  -- convite de acesso (a conta nasce com o papel quando o e-mail for confirmado)
  update public.invitations set professional_id = v_prof, person_id = v_person, revoked_at = null
   where email = v_email::extensions.citext and role = 'physio' and unit_id = l.unit_id and accepted_at is null and revoked_at is null and expires_at > now();
  if not found then
    insert into public.invitations (org_id, email, role, unit_id, person_id, professional_id, invited_by) values (l.org_id, v_email, 'physio', l.unit_id, v_person, v_prof, l.created_by);
  end if;

  insert into public.onboarding_submissions (org_id, kind, person_id, legal_entity_id, professional_id, link_id, doc_kind, email, status, consent_version, ip_hash)
  values (l.org_id, 'physio', v_person, v_entity, v_prof, l.id, case when v_pj then 'pj' else 'pf' end, v_email, 'applied', btrim(p_consent_version), v_ip) returning id into v_sub;
  update public.onboarding_links set used_at = now(), submission_id = v_sub where id = l.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id) values (l.org_id, null, 'onboarding_physio_submitted', 'person', v_person::text, l.unit_id);
  return jsonb_build_object('status', 'created', 'email', v_email, 'doc_kind', case when v_pj then 'pj' else 'pf' end);
end $$;
revoke all on function public.onboarding_submit_physio(text, jsonb, text, text) from public, anon;
grant execute on function public.onboarding_submit_physio(text, jsonb, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- 4) cadastro do paciente (rota aberta)
create or replace function public.onboarding_submit_patient(p_data jsonb, p_consent_version text, p_health_consent boolean default false, p_honeypot text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := private.client_ip_hash(); v_org uuid; v_unit uuid; v_addr jsonb; v_name text; v_pref text; v_birth date; v_cpf text; v_email text; v_phone text; v_phone_digits text;
  v_em_name text; v_em_phone text; v_em_rel text; v_complaint text; v_person uuid; v_existing boolean := false; v_note text; v_pending boolean := false; v_sub uuid; v_payload jsonb;
begin
  if p_honeypot is not null and btrim(p_honeypot) <> '' then return jsonb_build_object('status', 'created'); end if;
  perform private.rate_limit('onb_patient:' || v_ip, interval '10 minutes', 6);
  perform private.rate_limit('onb_patientg', interval '1 hour', 300);
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_unit from public.units where org_id = v_org and active order by created_at limit 1;
  if v_org is null or v_unit is null then raise exception 'cadastro indisponível no momento'; end if;
  if p_consent_version is null or btrim(p_consent_version) = '' then raise exception 'É preciso aceitar o termo de tratamento de dados pessoais.'; end if;

  v_name := private.onb_str(p_data, 'full_name', 160);
  if v_name is null or v_name !~ '^\S{2,}(\s+\S+)+$' then raise exception 'Informe o nome completo (nome e sobrenome)'; end if;
  v_pref := private.onb_str(p_data, 'preferred_name', 80);
  v_birth := private.onb_date(p_data, 'birth_date', 'Data de nascimento');
  if v_birth is null or v_birth > current_date or v_birth < current_date - interval '120 years' then raise exception 'Informe uma data de nascimento válida'; end if;
  v_cpf := nullif(regexp_replace(coalesce(p_data ->> 'cpf', ''), '\D', '', 'g'), '');
  if v_cpf is null or not private.is_valid_cpf(v_cpf) then raise exception 'CPF inválido'; end if;
  v_email := nullif(lower(btrim(coalesce(p_data ->> 'email', ''))), '');
  if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
  v_phone := private.onb_str(p_data, 'phone', 30); v_phone_digits := regexp_replace(coalesce(v_phone, ''), '\D', '', 'g');
  if length(v_phone_digits) not between 10 and 13 then raise exception 'Telefone/WhatsApp inválido (com DDD)'; end if;
  v_addr := private.onb_address(p_data);
  v_em_name := private.onb_str(p_data, 'emergency_name', 120); v_em_phone := private.onb_str(p_data, 'emergency_phone', 30); v_em_rel := private.onb_str(p_data, 'emergency_relation', 60);
  if v_em_name is null or v_em_rel is null then raise exception 'Informe o contato de emergência (nome e parentesco)'; end if;
  if length(regexp_replace(coalesce(v_em_phone, ''), '\D', '', 'g')) not between 10 and 13 then raise exception 'Telefone do contato de emergência inválido (com DDD)'; end if;
  v_complaint := private.onb_str(p_data, 'main_complaint', 800);
  if v_complaint is not null and not coalesce(p_health_consent, false) then raise exception 'Para informar o motivo do atendimento é preciso autorizar o uso de dados de saúde.'; end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null) then
    raise exception 'Este e-mail já tem acesso ao sistema. Entre com a sua senha ou use "Esqueci minha senha".';
  end if;

  select p.id into v_person from public.people p join public.person_contacts c on c.person_id = p.id
   where p.org_id = v_org and p.merged_into_id is null and c.type = 'email' and c.normalized = v_email order by p.created_at limit 1;
  v_payload := jsonb_build_object('preferred_name', v_pref, 'birth_date', v_birth, 'cpf', v_cpf, 'phone', v_phone, 'address', v_addr, 'emergency_name', v_em_name, 'emergency_phone', v_em_phone,
    'emergency_relation', v_em_rel, 'address_reference', private.onb_str(p_data, 'address_reference', 160), 'main_complaint', v_complaint, 'how_found', private.onb_str(p_data, 'how_found', 60), 'health_consent', coalesce(p_health_consent, false));
  if v_person is not null then
    -- cadastro já existe com este e-mail: NADA é escrito agora; os dados só preenchem vazios depois que o dono do e-mail confirmar o acesso
    v_existing := true;
  else
    if exists (select 1 from public.people x where x.org_id = v_org and x.document_number = v_cpf and x.merged_into_id is null) then
      v_cpf := null; v_pending := true; v_note := 'Onboarding: o CPF informado já consta em outro cadastro (possível duplicidade). Conferir antes de mesclar.';
    end if;
    v_person := private.onb_create_person(v_org, v_unit, v_name, v_pref, v_birth, v_cpf, null, v_email, v_phone, v_addr, 'onboarding_paciente', 'patient', v_pending, v_note);
    insert into public.person_intake (person_id, org_id, emergency_name, emergency_phone, emergency_relation, address_reference, main_complaint, how_found, health_consent_at)
    values (v_person, v_org, v_em_name, v_em_phone, v_em_rel, v_payload ->> 'address_reference', v_complaint, v_payload ->> 'how_found', case when coalesce(p_health_consent, false) then now() end);
  end if;

  update public.invitations set person_id = v_person
   where email = v_email::extensions.citext and role = 'member' and accepted_at is null and revoked_at is null and expires_at > now() and (person_id is null or person_id = v_person);
  if not found then
    if exists (select 1 from public.invitations where email = v_email::extensions.citext and role = 'member' and accepted_at is null and revoked_at is null and expires_at > now()) then
      raise exception 'Já existe um convite aberto para este e-mail ligado a outro cadastro. Fale com a HP.';
    end if;
    insert into public.invitations (org_id, email, role, unit_id, person_id, invited_by) values (v_org, v_email, 'member', null, v_person, null);
  end if;

  insert into public.onboarding_submissions (org_id, kind, person_id, doc_kind, email, status, payload, consent_version, health_consent, ip_hash)
  values (v_org, 'patient', v_person, 'pf', v_email, case when v_existing then 'awaiting_confirmation' else 'applied' end, case when v_existing then v_payload end, btrim(p_consent_version), coalesce(p_health_consent, false), v_ip)
  returning id into v_sub;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id) values (v_org, null, 'onboarding_patient_submitted', 'person', v_person::text, v_unit);
  return jsonb_build_object('status', 'created', 'email', v_email);
end $$;
revoke all on function public.onboarding_submit_patient(jsonb, text, boolean, text) from public, anon;
grant execute on function public.onboarding_submit_patient(jsonb, text, boolean, text) to anon, authenticated;

-- ---------------------------------------------------------------- 5) aplica os dados retidos quando o dono do e-mail confirma o acesso
create or replace function private.onboarding_apply_pending() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record; pl jsonb;
begin
  for s in select * from public.onboarding_submissions where person_id = new.person_id and status = 'awaiting_confirmation' and kind = 'patient' for update loop
    pl := s.payload;
    perform private.onb_fill_person(new.person_id, pl ->> 'preferred_name', nullif(pl ->> 'birth_date', '')::date, pl ->> 'cpf', null, pl ->> 'phone', coalesce(pl -> 'address', '{}'::jsonb));
    insert into public.person_kinds (person_id, kind) values (new.person_id, 'patient') on conflict do nothing;
    insert into public.person_intake (person_id, org_id, emergency_name, emergency_phone, emergency_relation, address_reference, main_complaint, how_found, health_consent_at)
    values (new.person_id, s.org_id, pl ->> 'emergency_name', pl ->> 'emergency_phone', pl ->> 'emergency_relation', pl ->> 'address_reference', pl ->> 'main_complaint', pl ->> 'how_found',
            case when (pl ->> 'health_consent')::boolean then now() end)
    on conflict (person_id) do update set
      emergency_name = coalesce(public.person_intake.emergency_name, excluded.emergency_name), emergency_phone = coalesce(public.person_intake.emergency_phone, excluded.emergency_phone),
      emergency_relation = coalesce(public.person_intake.emergency_relation, excluded.emergency_relation), address_reference = coalesce(public.person_intake.address_reference, excluded.address_reference),
      main_complaint = coalesce(public.person_intake.main_complaint, excluded.main_complaint), how_found = coalesce(public.person_intake.how_found, excluded.how_found),
      health_consent_at = coalesce(public.person_intake.health_consent_at, excluded.health_consent_at), updated_at = now();
    update public.onboarding_submissions set status = 'applied', payload = null where id = s.id;
  end loop;
  return null;
end $$;
revoke all on function private.onboarding_apply_pending() from public, anon, authenticated;
create trigger user_accounts_onboarding_apply after insert on public.user_accounts
  for each row when (new.person_id is not null) execute function private.onboarding_apply_pending();

-- ---------------------------------------------------------------- 6) "Primeiro acesso" só para quem tem cadastro
-- Responde ao formulário ANTES de criar a senha: not_found | registered_no_access | invited | has_account. (Revela se o e-mail está cadastrado: pedido do negócio; por isso limitado por IP.)
create or replace function public.first_access_email_status(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  perform private.rate_limit('first_access:' || private.client_ip_hash(), interval '10 minutes', 20);
  perform private.rate_limit('first_accessg', interval '1 hour', 600);
  if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null) then return 'has_account'; end if;
  if exists (select 1 from public.invitations i where i.email = v_email::extensions.citext and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
     or exists (select 1 from private.manager_bootstrap_emails b where b.email = v_email::extensions.citext and b.consumed_at is null) then return 'invited'; end if;
  if exists (select 1 from public.person_contacts c join public.people p on p.id = c.person_id where c.type = 'email' and c.normalized = v_email and p.merged_into_id is null) then return 'registered_no_access'; end if;
  return 'not_found';
end $$;
revoke all on function public.first_access_email_status(text) from public, anon;
grant execute on function public.first_access_email_status(text) to anon, authenticated;
