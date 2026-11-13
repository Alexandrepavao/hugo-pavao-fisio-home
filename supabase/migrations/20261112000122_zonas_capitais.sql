-- HP Group Hub — 122 Zonas e bairros nas CAPITAIS (Rio de Janeiro primeiro): generaliza o que a migration 118 fez só para São Paulo.
--  · tabela geo_zones: a divisão OFICIAL de cada capital liberada (zonas, com o nome local). Capital fora da tabela continua perguntando só a cidade; cidade que não é capital nunca pergunta zona.
--  · ids de zona únicos: São Paulo mantém os antigos (sul, norte, leste, oeste, centro); as demais usam prefixo (rj-sul, rj-norte, rj-oeste, rj-centro).
--  · quiz, onboarding (paciente e fisioterapeuta) e o cadastro da pessoa validam a zona da CIDADE informada (uma zona de outra cidade é recusada).
--  · CRM: lista de contatos de uma capital com a zona que cada um cadastrou (crm_capital_contacts).
-- As regras de cada função são as da 118, trocando só “é São Paulo?” por “é capital com zonas liberadas?”. Nenhum dado existente é alterado.

create table if not exists public.geo_zones (
  city_key text not null, uf text not null check (uf ~ '^[A-Z]{2}$'), zone_id text not null unique check (zone_id ~ '^[a-z][a-z-]*$'), label text not null, position int not null default 0,
  primary key (city_key, uf, zone_id)
);
alter table public.geo_zones enable row level security;
-- dado de referência (não é dado de pessoa): leitura para todos, escrita só pela migration
create policy geo_zones_read on public.geo_zones for select to anon, authenticated using (true);
grant select on public.geo_zones to anon, authenticated;
insert into public.geo_zones (city_key, uf, zone_id, label, position) values
  ('saopaulo', 'SP', 'sul', 'Zona Sul', 1), ('saopaulo', 'SP', 'norte', 'Zona Norte', 2), ('saopaulo', 'SP', 'leste', 'Zona Leste', 3), ('saopaulo', 'SP', 'oeste', 'Zona Oeste', 4), ('saopaulo', 'SP', 'centro', 'Centro', 5),
  ('riodejaneiro', 'RJ', 'rj-sul', 'Zona Sul', 1), ('riodejaneiro', 'RJ', 'rj-norte', 'Zona Norte', 2), ('riodejaneiro', 'RJ', 'rj-oeste', 'Zona Oeste', 3), ('riodejaneiro', 'RJ', 'rj-centro', 'Centro', 4)
on conflict do nothing;

create or replace function private.zone_city_ok(p_city text, p_uf text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.geo_zones z where z.city_key = private.geo_city_key(p_city) and z.uf = upper(btrim(coalesce(p_uf, '')))) $$;
create or replace function private.zone_valid_for(p_city text, p_uf text, p_zone text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.geo_zones z where z.city_key = private.geo_city_key(p_city) and z.uf = upper(btrim(coalesce(p_uf, ''))) and z.zone_id = p_zone) $$;
create or replace function private.zone_valid_any(p_zone text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.geo_zones z where z.zone_id = p_zone) $$;
revoke all on function private.zone_city_ok(text, text), private.zone_valid_for(text, text, text), private.zone_valid_any(text) from public, anon, authenticated;

create or replace function private.zones_all_valid(p_zones text[]) returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from unnest(coalesce(p_zones, '{}'::text[])) z where not exists (select 1 from public.geo_zones g where g.zone_id = z)) $$;
revoke all on function private.zones_all_valid(text[]) from public, anon, authenticated;

-- os checks antigos só aceitavam as 5 zonas de São Paulo; passam a aceitar qualquer zona cadastrada em geo_zones
alter table public.people drop constraint if exists people_zone_check;
alter table public.people add constraint people_zone_check check (zone is null or private.zone_valid_any(zone));
alter table public.quiz_leads drop constraint if exists quiz_leads_zone_check;
alter table public.quiz_leads add constraint quiz_leads_zone_check check (zone is null or private.zone_valid_any(zone));
alter table public.professional_profiles drop constraint if exists professional_profiles_service_zones_check;
alter table public.professional_profiles add constraint professional_profiles_service_zones_check check (private.zones_all_valid(service_zones));

-- ---------------------------------------------------------------- quiz: bairro e zona nas capitais liberadas
create or replace function public.quiz_save_progress(p_id uuid, p_step int, p_answers jsonb, p_city text default null, p_uf text default null, p_neighborhood text default null, p_zone text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.quiz_leads; k text; val jsonb; v_merged jsonb; v_uf text := nullif(upper(btrim(coalesce(p_uf, ''))), ''); v_zone text := nullif(lower(btrim(coalesce(p_zone, ''))), ''); v_neigh text := nullif(btrim(coalesce(p_neighborhood, '')), ''); v_sp boolean; v_city text;
begin
  select * into v from public.quiz_leads where id = p_id;
  if not found then raise exception 'submissão não encontrada' using errcode = '42501'; end if;
  if v.status = 'completed' then
    return jsonb_build_object('id', v.id, 'status', v.status, 'step_reached', v.step_reached);
  end if;
  perform private.rate_limit('quiz_progress:' || v.id, interval '1 minute', 40);
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then raise exception 'dados inválidos'; end if;
  if v_uf is not null and v_uf <> all (array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) then
    raise exception 'estado inválido';
  end if;
  if length(coalesce(v_neigh, '')) > 100 then raise exception 'bairro muito longo (até 100 caracteres)'; end if;
  v_city := coalesce(nullif(btrim(coalesce(p_city, '')), ''), v.city);
  v_sp := private.zone_city_ok(v_city, coalesce(v_uf, v.state_uf));   -- capital com zonas liberadas (São Paulo, Rio de Janeiro…)
  if v_zone is not null and v_sp and not private.zone_valid_for(v_city, coalesce(v_uf, v.state_uf), v_zone) then raise exception 'zona inválida'; end if;
  v_merged := v.answers;
  for k in select jsonb_object_keys(p_answers) loop
    val := p_answers -> k;
    if v.journey = 'atendimento' and k in ('dor_intensidade','motivacao_melhora','impacto_qualidade_vida') and v.health_consent_at is null then
      raise exception 'autorização de dados de saúde pendente' using errcode = '42501';
    end if;
    if not private.quiz_validate_answer(v.journey, k, val) then raise exception 'resposta inválida: %', k; end if;
    v_merged := jsonb_set(v_merged, array[k], val, true);
  end loop;
  update public.quiz_leads set
      answers = v_merged,
      step_reached = greatest(step_reached, coalesce(p_step, step_reached)),
      status = case when status = 'started' then 'partial' else status end,
      city = coalesce(nullif(btrim(coalesce(p_city, '')), ''), city),
      state_uf = coalesce(v_uf, state_uf),
      neighborhood = case when v_sp then coalesce(v_neigh, neighborhood) else null end,
      zone = case when v_sp then coalesce(v_zone, zone) else null end,
      last_activity_at = now()
    where id = p_id returning * into v;
  return jsonb_build_object('id', v.id, 'status', v.status, 'step_reached', v.step_reached);
end $$;
revoke all on function public.quiz_save_progress(uuid, int, jsonb, text, text, text, text) from public;
grant execute on function public.quiz_save_progress(uuid, int, jsonb, text, text, text, text) to anon, authenticated;

-- bairro/zona do quiz → cadastro da pessoa (só preenche o que está vazio e só em capital liberada; nunca troca dado já cadastrado)
create or replace function private.quiz_sync_person_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.person_id is not null and nullif(btrim(coalesce(new.city, '')), '') is not null and new.state_uf is not null then
    update public.people set city = btrim(new.city), state_uf = new.state_uf
     where id = new.person_id and nullif(btrim(coalesce(city, '')), '') is null and state_uf is null;
    if (new.zone is not null or new.neighborhood is not null) and private.zone_city_ok(new.city, new.state_uf) then
      update public.people set zone = coalesce(zone, new.zone), neighborhood = coalesce(nullif(btrim(coalesce(neighborhood, '')), ''), new.neighborhood)
       where id = new.person_id and private.zone_city_ok(city, state_uf) and (zone is null or nullif(btrim(coalesce(neighborhood, '')), '') is null);
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- onboarding
create or replace function private.onb_address(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare cep text := nullif(regexp_replace(coalesce(p ->> 'cep', ''), '\D', '', 'g'), ''); uf text := nullif(upper(btrim(coalesce(p ->> 'state_uf', ''))), '');
begin
  if cep is null or length(cep) <> 8 then raise exception 'CEP inválido (8 números)'; end if;
  if private.onb_str(p, 'street', 160) is null then raise exception 'Informe a rua'; end if;
  if private.onb_str(p, 'street_number', 20) is null then raise exception 'Informe o número do endereço (ou S/N)'; end if;
  if private.onb_str(p, 'neighborhood', 100) is null then raise exception 'Informe o bairro'; end if;
  if private.onb_str(p, 'city', 100) is null then raise exception 'Informe a cidade'; end if;
  if uf is null or uf !~ '^[A-Z]{2}$' then raise exception 'Informe a UF'; end if;
  if private.zone_city_ok(private.onb_str(p, 'city', 100), uf) then
    if not private.zone_valid_for(private.onb_str(p, 'city', 100), uf, lower(btrim(coalesce(p ->> 'zone', '')))) then raise exception 'Informe a zona da cidade (escolha uma das opções)'; end if;
  end if;
  return jsonb_build_object('cep', cep, 'street', private.onb_str(p, 'street', 160), 'street_number', private.onb_str(p, 'street_number', 20), 'complement', private.onb_str(p, 'complement', 100),
    'neighborhood', private.onb_str(p, 'neighborhood', 100), 'city', private.onb_str(p, 'city', 100), 'state_uf', uf,
    'zone', case when private.zone_city_ok(private.onb_str(p, 'city', 100), uf) then lower(btrim(p ->> 'zone')) end);
end $$;

create or replace function public.onboarding_submit_physio(p_token text, p_data jsonb, p_consent_version text, p_honeypot text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.onboarding_links; v_ip text := private.client_ip_hash(); v_addr jsonb;
  v_name text; v_pref text; v_birth date; v_cpf text; v_rg text; v_email text; v_phone text; v_phone_digits text;
  v_council text; v_council_uf text; v_specs text[]; v_pj boolean; v_cnpj text; v_legal text; v_trade text;
  v_zones text[]; v_pix_type text; v_pix text; v_person uuid; v_entity uuid; v_prof uuid; v_sub uuid; v_docs text; v_age int; v_text text;
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
  select coalesce(array_agg(x order by x), '{}') into v_zones from (select distinct lower(btrim(e)) x from jsonb_array_elements_text(coalesce(p_data -> 'service_zones', '[]'::jsonb)) e where btrim(e) <> '') s;
  if exists (select 1 from unnest(v_zones) z where not private.zone_valid_any(z)) then raise exception 'Zona de atendimento inválida'; end if;
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
  insert into public.professional_profiles (person_id, org_id, professional_id, work_as, council_uf, specialties, education, bio, service_regions, service_zones)
  values (v_person, l.org_id, v_prof, case when v_pj then 'pj' else 'pf' end, v_council_uf, v_specs, private.onb_str(p_data, 'education', 400), private.onb_str(p_data, 'bio', 600), private.onb_str(p_data, 'service_regions', 300), v_zones)
  on conflict (person_id) do update set professional_id = excluded.professional_id, work_as = excluded.work_as, council_uf = excluded.council_uf, specialties = excluded.specialties,
    education = excluded.education, bio = excluded.bio, service_regions = excluded.service_regions, service_zones = excluded.service_zones, updated_at = now();
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

-- ---------------------------------------------------------------- CRM: contatos de uma capital, com a zona e o bairro que cada um cadastrou
create or replace function private.crm_city_base(p_city_key text, p_uf text, p_kind text, p_unit uuid) returns table (person_id uuid, name text, phone text, email text, neighborhood text, zone text, kinds text[])
language plpgsql stable security definer set search_path = '' as $$
declare u uuid[];
begin
  u := private.crm_units(p_unit);
  return query
  select pe.id, pe.full_name,
         (select c.value from public.person_contacts c where c.person_id = pe.id and c.type in ('phone', 'whatsapp') order by c.is_primary desc, c.value limit 1),
         (select c.value from public.person_contacts c where c.person_id = pe.id and c.type = 'email' order by c.is_primary desc, c.value limit 1),
         nullif(btrim(coalesce(pe.neighborhood, '')), ''), pe.zone, array_agg(distinct pl.kind order by pl.kind)
    from public.opportunities op
    join public.pipelines pl on pl.id = op.pipeline_id and pl.kind <> 'companies'
    join public.people pe on pe.id = op.person_id
   where op.org_id = private.current_org() and op.unit_id = any (u) and (p_kind is null or pl.kind = p_kind)
     and pe.archived_at is null and pe.merged_into_id is null and private.geo_city_key(pe.city) = p_city_key and upper(btrim(coalesce(pe.state_uf, ''))) = upper(btrim(p_uf))
   group by pe.id, pe.full_name, pe.neighborhood, pe.zone;
end $$;
revoke all on function private.crm_city_base(text, text, text, uuid) from public, anon, authenticated;

create or replace function public.crm_capital_contacts(p_city_key text, p_uf text, p_kind text default null, p_unit uuid default null) returns table (
  person_id uuid, full_name text, phone text, email text, neighborhood text, zone text, kinds text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales','finance']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_city_key, '')), '') is null or nullif(btrim(coalesce(p_uf, '')), '') is null then raise exception 'informe a cidade e o estado'; end if;
  return query
  select b.person_id, b.name, b.phone, b.email, b.neighborhood, b.zone, b.kinds from private.crm_city_base(p_city_key, p_uf, p_kind, p_unit) b order by b.name limit 1000;
end $$;
revoke all on function public.crm_capital_contacts(text, text, text, uuid) from public, anon;
grant execute on function public.crm_capital_contacts(text, text, text, uuid) to authenticated;
