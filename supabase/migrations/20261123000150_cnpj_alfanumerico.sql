-- Fase 0.5 da Prospecção B2B: CNPJ ALFANUMÉRICO (a Receita já emite; jul/2026).
-- Antes: tudo removia o que não fosse dígito (regexp '\D'), então um CNPJ com letras seria mutilado/recusado.
-- Agora: normalização = maiúsculas, só [0-9A-Z]; 12 primeiros caracteres alfanuméricos + 2 dígitos verificadores
-- (valor de cada caractere = código ASCII - 48; pesos 2..9 da direita para a esquerda; módulo 11). CNPJ numérico antigo continua valendo.
-- Mudança de comportamento (intencional): texto livre que antes virava NULL por não ter dígitos (ex.: "N/A") agora é validado e recusado como inválido.

create or replace function private.normalize_cnpj(p_doc text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g'))
$$;

create or replace function private.is_valid_cnpj(p_doc text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  d text := private.normalize_cnpj(p_doc);
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; dv1 int; dv2 int; i int;
begin
  if d !~ '^[0-9A-Z]{12}[0-9]{2}$' then return false; end if;
  if d ~ '^(.)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + (ascii(substr(d, i, 1)) - 48) * w1[i]; end loop;
  r := s % 11; dv1 := case when r < 2 then 0 else 11 - r end;
  if dv1 <> substr(d, 13, 1)::int then return false; end if;
  s := 0; for i in 1..13 loop s := s + (ascii(substr(d, i, 1)) - 48) * w2[i]; end loop;
  r := s % 11; dv2 := case when r < 2 then 0 else 11 - r end;
  return dv2 = substr(d, 14, 1)::int;
end $$;

grant execute on function private.normalize_cnpj(text) to authenticated;




-- crm_company_create: o CNPJ passa por private.normalize_cnpj (alfanumérico)
CREATE OR REPLACE FUNCTION public.crm_company_create(p_legal_name text, p_trade_name text DEFAULT NULL::text, p_cnpj text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_uf text DEFAULT NULL::text, p_unit uuid DEFAULT NULL::uuid, p_contact_person uuid DEFAULT NULL::uuid, p_contact_role text DEFAULT NULL::text, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := private.current_org(); v_roles public.app_role[] := array['manager','ops_admin','unit_manager','sales']::public.app_role[];
  v_cnpj text := nullif(private.normalize_cnpj(coalesce(p_cnpj, '')), ''); v_id uuid; v_exist uuid;
begin
  if v_org is null or not private.has_any_role(v_roles) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_unit is not null and not private.has_unit_role(v_roles, p_unit) then raise exception 'sem permissão nesta unidade' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_legal_name, ''))) < 2 then raise exception 'Informe o nome da empresa'; end if;
  if v_cnpj is not null and not private.is_valid_cnpj(v_cnpj) then raise exception 'CNPJ com formato inválido'; end if;
  if p_contact_person is not null and not private.can_read_person(p_contact_person) then raise exception 'sem permissão sobre o contato' using errcode = '42501'; end if;
  if v_cnpj is not null then
    select id into v_exist from public.legal_entities where org_id = v_org and cnpj = v_cnpj and merged_into_id is null;
    if v_exist is not null then return jsonb_build_object('status', 'existing', 'id', v_exist, 'reason', 'cnpj'); end if;
  end if;
  if not coalesce(p_force, false) then
    select id into v_exist from public.legal_entities where org_id = v_org and merged_into_id is null
       and (lower(btrim(legal_name)) = lower(btrim(p_legal_name)) or lower(btrim(coalesce(trade_name, ''))) = lower(btrim(p_legal_name))) limit 1;
    if v_exist is not null then return jsonb_build_object('status', 'duplicate', 'id', v_exist, 'reason', 'nome'); end if;
  end if;
  insert into public.legal_entities (org_id, legal_name, trade_name, cnpj, email_general, phone, city, state_uf, origin, created_by)
    values (v_org, btrim(p_legal_name), nullif(btrim(coalesce(p_trade_name, '')), ''), v_cnpj, nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
            nullif(btrim(coalesce(p_city, '')), ''), nullif(upper(btrim(coalesce(p_uf, ''))), ''), 'CRM (B2B)', (select auth.uid()))
    returning id into v_id;
  if p_unit is not null then insert into public.legal_entity_units (legal_entity_id, unit_id) values (v_id, p_unit) on conflict do nothing; end if;
  if p_contact_person is not null then
    insert into public.legal_entity_representatives (legal_entity_id, person_id, role_title, representation_type, is_primary)
      values (v_id, p_contact_person, nullif(btrim(coalesce(p_contact_role, '')), ''), 'contact', true) on conflict do nothing;
  end if;
  return jsonb_build_object('status', 'created', 'id', v_id);
end $function$;


-- legal_entity_upsert: o CNPJ passa por private.normalize_cnpj (alfanumérico)
CREATE OR REPLACE FUNCTION public.legal_entity_upsert(p_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_org uuid := private.current_org(); v_id uuid; v_cnpj text := nullif(private.normalize_cnpj(coalesce(p_data->>'cnpj', '')), '');
begin
  if not private.can_adm_sensitive() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_data->>'legal_name', ''))) < 2 then raise exception 'Razão social é obrigatória'; end if;
  if v_cnpj is not null and not private.is_valid_cnpj(v_cnpj) then raise exception 'CNPJ com formato inválido'; end if;
  if v_cnpj is not null and exists (select 1 from public.legal_entities where org_id = v_org and cnpj = v_cnpj and merged_into_id is null and id is distinct from p_id) then
    raise exception 'Já existe uma empresa cadastrada com este CNPJ';
  end if;

  if p_id is null then
    insert into public.legal_entities (org_id, cnpj, legal_name, trade_name, state_registration, state_registration_exempt,
        municipal_registration, legal_nature, cnae_main, cnae_secondary, tax_regime, founded_on,
        email_general, email_finance, email_billing, phone, whatsapp, cep, street, street_number, complement, neighborhood,
        city, state_uf, country, registration_status, origin, notes, created_by)
      values (v_org, v_cnpj, btrim(p_data->>'legal_name'), nullif(p_data->>'trade_name',''), nullif(p_data->>'state_registration',''),
        coalesce((p_data->>'state_registration_exempt')::boolean, false), nullif(p_data->>'municipal_registration',''),
        nullif(p_data->>'legal_nature',''), nullif(p_data->>'cnae_main',''),
        coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_data->'cnae_secondary','[]')) x), '{}'),
        nullif(p_data->>'tax_regime',''), nullif(p_data->>'founded_on','')::date,
        nullif(p_data->>'email_general',''), nullif(p_data->>'email_finance',''), nullif(p_data->>'email_billing',''),
        nullif(p_data->>'phone',''), nullif(p_data->>'whatsapp',''), nullif(p_data->>'cep',''), nullif(p_data->>'street',''),
        nullif(p_data->>'street_number',''), nullif(p_data->>'complement',''), nullif(p_data->>'neighborhood',''),
        nullif(p_data->>'city',''), nullif(p_data->>'state_uf',''), coalesce(nullif(p_data->>'country',''), 'BR'),
        coalesce(nullif(p_data->>'registration_status',''), 'ativo'), nullif(p_data->>'origin',''), nullif(p_data->>'notes',''), (select auth.uid()))
      returning id into v_id;
  else
    update public.legal_entities set
      cnpj = v_cnpj, legal_name = btrim(p_data->>'legal_name'), trade_name = nullif(p_data->>'trade_name',''),
      state_registration = nullif(p_data->>'state_registration',''), state_registration_exempt = coalesce((p_data->>'state_registration_exempt')::boolean, false),
      municipal_registration = nullif(p_data->>'municipal_registration',''), legal_nature = nullif(p_data->>'legal_nature',''),
      cnae_main = nullif(p_data->>'cnae_main',''), cnae_secondary = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_data->'cnae_secondary','[]')) x), '{}'),
      tax_regime = nullif(p_data->>'tax_regime',''), founded_on = nullif(p_data->>'founded_on','')::date,
      email_general = nullif(p_data->>'email_general',''), email_finance = nullif(p_data->>'email_finance',''), email_billing = nullif(p_data->>'email_billing',''),
      phone = nullif(p_data->>'phone',''), whatsapp = nullif(p_data->>'whatsapp',''), cep = nullif(p_data->>'cep',''),
      street = nullif(p_data->>'street',''), street_number = nullif(p_data->>'street_number',''), complement = nullif(p_data->>'complement',''),
      neighborhood = nullif(p_data->>'neighborhood',''), city = nullif(p_data->>'city',''), state_uf = nullif(p_data->>'state_uf',''),
      country = coalesce(nullif(p_data->>'country',''), 'BR'), registration_status = coalesce(nullif(p_data->>'registration_status',''), 'ativo'),
      origin = nullif(p_data->>'origin',''), notes = nullif(p_data->>'notes','')
    where id = p_id and org_id = v_org
    returning id into v_id;
    if v_id is null then raise exception 'empresa não encontrada'; end if;
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $function$;


-- onboarding_submit_physio: o CNPJ passa por private.normalize_cnpj (alfanumérico)
CREATE OR REPLACE FUNCTION public.onboarding_submit_physio(p_token text, p_data jsonb, p_consent_version text, p_honeypot text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    v_cnpj := nullif(private.normalize_cnpj(coalesce(p_data ->> 'cnpj', '')), '');
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
end $function$;


-- pj_import_analyze: o CNPJ passa por private.normalize_cnpj (alfanumérico)
CREATE OR REPLACE FUNCTION private.pj_import_analyze(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_org uuid := private.current_org(); r jsonb; idx int := 0; out jsonb := '[]'::jsonb; seen text[] := '{}';
  v_cnpj text; v_msgs text[]; e public.legal_entities; v_diffs jsonb; f record; v_in text; v_cur text; v_entity jsonb; v_status text;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Formato de linhas inválido'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Limite de 500 linhas por importação'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1; v_msgs := '{}'; v_diffs := '[]'::jsonb; v_status := 'new'; e := null;
    v_cnpj := nullif(private.normalize_cnpj(coalesce(r->>'cnpj', '')), '');
    if v_cnpj is null then v_msgs := array_append(v_msgs, 'CNPJ ausente'::text); end if;
    if v_cnpj is not null and not private.is_valid_cnpj(v_cnpj) then v_msgs := array_append(v_msgs, 'CNPJ com dígito verificador inválido: ' || coalesce(r->>'cnpj', '')); end if;
    if length(coalesce(private.pj_norm('legal_name', r->>'legal_name'), '')) < 2 then v_msgs := array_append(v_msgs, 'Razão social ausente ou muito curta'::text); end if;
    if private.pj_norm('email_general', r->>'email_general') is not null and private.pj_norm('email_general', r->>'email_general') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_msgs := array_append(v_msgs, 'E-mail inválido: ' || (r->>'email_general')); end if;
    if private.pj_norm('state_uf', r->>'state_uf') is not null and private.pj_norm('state_uf', r->>'state_uf') !~ '^[A-Z]{2}$' then v_msgs := array_append(v_msgs, 'UF inválida: ' || (r->>'state_uf')); end if;
    if private.pj_norm('cep', r->>'cep') is not null and length(private.pj_norm('cep', r->>'cep')) <> 8 then v_msgs := array_append(v_msgs, 'CEP inválido: ' || (r->>'cep')); end if;
    if private.pj_norm('phone', r->>'phone') is not null and length(private.pj_norm('phone', r->>'phone')) not between 10 and 13 then v_msgs := array_append(v_msgs, 'Telefone inválido: ' || (r->>'phone')); end if;

    if array_length(v_msgs, 1) is not null then
      v_status := 'invalid';
    elsif v_cnpj = any (seen) then
      v_status := 'duplicate_in_file'; v_msgs := array_append(v_msgs, 'CNPJ repetido no arquivo: só a primeira ocorrência é considerada'::text);
    else
      seen := seen || v_cnpj;
      select * into e from public.legal_entities where org_id = v_org and cnpj = v_cnpj and merged_into_id is null;
      if found then
        if e.archived_at is not null then
          v_status := 'archived'; v_msgs := array_append(v_msgs, 'Cadastro existente está arquivado: restaure-o antes de reimportar'::text);
        else
          v_entity := to_jsonb(e);
          for f in select * from private.pj_import_fields() loop
            v_in := private.pj_norm(f.key, r->>f.key);
            v_cur := private.pj_norm(f.key, v_entity->>f.key);
            if v_in is not null and v_in is distinct from v_cur then
              v_diffs := v_diffs || jsonb_build_object('field', f.key, 'label', f.label, 'current', v_cur, 'incoming', v_in,
                                                       'kind', case when v_cur is null then 'fill' else 'overwrite' end);
            end if;
          end loop;
          v_status := case when jsonb_array_length(v_diffs) = 0 then 'unchanged' else 'conflict' end;
        end if;
      end if;
    end if;
    out := out || jsonb_build_object('idx', idx - 1, 'line', coalesce((r->>'line')::int, idx + 1), 'cnpj', v_cnpj, 'legal_name', r->>'legal_name',
             'status', v_status, 'messages', to_jsonb(v_msgs), 'existing_id', e.id, 'existing_name', e.legal_name, 'diffs', v_diffs);
  end loop;
  return out;
end $function$;


-- adm_directory: o CNPJ passa por private.normalize_cnpj (alfanumérico)
CREATE OR REPLACE FUNCTION public.adm_directory(p_search text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_kind person_kind DEFAULT NULL::person_kind, p_unit uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_incomplete_only boolean DEFAULT false, p_sort text DEFAULT 'created_at'::text, p_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 25, p_uf text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := private.current_org(); u uuid[]; v_full boolean := private.can_adm_sensitive(); v_all boolean; v_uf text := nullif(upper(btrim(coalesce(p_uf, ''))), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), ''); v_rows jsonb; v_total bigint;
  v_sort text; v_dir text := case when lower(coalesce(p_dir,'desc')) = 'asc' then 'asc' else 'desc' end;
  v_page_size int := least(greatest(coalesce(p_page_size, 25), 1), 100); v_page int := greatest(coalesce(p_page, 0), 0);
begin
  if not private.can_adm(p_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  u := private.adm_scope_units(p_unit);
  v_all := (p_unit is null and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
  v_sort := case when p_sort in ('name','created_at','city') then p_sort else 'created_at' end;

  with base as (
    (
      select p.id, 'pf'::text as type, p.full_name as name, p.document_number as doc,
        (select c.value from public.person_contacts c where c.person_id = p.id and c.type = 'email' order by c.is_primary desc limit 1) as email,
        (select c.value from public.person_contacts c where c.person_id = p.id and c.type in ('phone','whatsapp') order by c.is_primary desc limit 1) as phone,
        p.city, p.state_uf as uf, p.registration_status as status, p.created_at,
        (select array_agg(distinct un.name) from public.units un where un.id = p.unit_id or un.id in (select unit_id from public.person_units pu where pu.person_id = p.id)) as unit_names,
        private.person_is_complete(p.id) as complete,
        coalesce((select array_agg(k.kind::text) from public.person_kinds k where k.person_id = p.id), '{}') as kinds,
        null::text as trade_name, p.origin, null::text as tax_regime, null::text as state_registration, null::text as email_finance
      from public.people p
      where p.org_id = v_org and p.archived_at is null and p.merged_into_id is null
        and (v_all or p.unit_id = any(u) or exists (select 1 from public.person_units pu where pu.person_id = p.id and pu.unit_id = any(u)))
        and (v_uf is null or p.state_uf = v_uf)
        and (p_status is null or p.registration_status = p_status)
        and (p_kind is null or exists (select 1 from public.person_kinds k where k.person_id = p.id and k.kind = p_kind))
        and (v_search is null or p.full_name ilike '%' || v_search || '%'
             or (regexp_replace(v_search, '\D', '', 'g') <> '' and p.document_number like '%' || regexp_replace(v_search, '\D', '', 'g') || '%')
             or exists (select 1 from public.person_contacts c where c.person_id = p.id and (c.value ilike '%' || v_search || '%' or c.normalized ilike '%' || v_search || '%')))
    )
    union all
    (
      select e.id, 'pj'::text as type, e.legal_name as name, e.cnpj as doc,
        e.email_general as email, coalesce(e.whatsapp, e.phone) as phone,
        e.city, e.state_uf as uf, e.registration_status as status, e.created_at,
        (select array_agg(distinct un.name) from public.units un where un.id in (select unit_id from public.legal_entity_units leu where leu.legal_entity_id = e.id)) as unit_names,
        (e.cnpj is not null and e.city is not null and e.state_uf is not null and (e.email_general is not null or e.phone is not null)) as complete,
        '{}'::text[] as kinds,
        e.trade_name, e.origin, e.tax_regime, e.state_registration, e.email_finance
      from public.legal_entities e
      where e.org_id = v_org and e.archived_at is null and e.merged_into_id is null
        and (v_all or exists (select 1 from public.legal_entity_units leu where leu.legal_entity_id = e.id and leu.unit_id = any(u)))
        and (v_uf is null or e.state_uf = v_uf)
        and (p_status is null or e.registration_status = p_status)
        and (v_search is null or e.legal_name ilike '%' || v_search || '%' or e.trade_name ilike '%' || v_search || '%'
             or (private.normalize_cnpj(v_search) <> '' and e.cnpj like '%' || private.normalize_cnpj(v_search) || '%')
             or e.email_general ilike '%' || v_search || '%')
    )
  ), filtered as (
    select * from base where (p_type is null or type = p_type) and (not p_incomplete_only or not complete)
  ), counted as (
    select *, count(*) over() as total_count from filtered
    order by
      case when v_sort = 'name' and v_dir = 'asc' then name end asc,
      case when v_sort = 'name' and v_dir = 'desc' then name end desc,
      case when v_sort = 'city' and v_dir = 'asc' then city end asc,
      case when v_sort = 'city' and v_dir = 'desc' then city end desc,
      case when v_sort = 'created_at' and v_dir = 'asc' then created_at end asc,
      case when v_sort = 'created_at' and v_dir = 'desc' then created_at end desc,
      id
    limit v_page_size offset (v_page * v_page_size)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'type', type, 'name', name,
      'document', case when v_full then doc else private.mask_document(doc) end,
      'document_full_available', v_full,
      'email', email, 'phone', phone, 'city', city, 'uf', uf, 'status', status, 'created_at', created_at,
      'units', coalesce(unit_names, '{}'), 'complete', complete, 'kinds', kinds,
      'trade_name', trade_name, 'origin', origin,
      'tax_regime', case when v_full then tax_regime end,
      'state_registration', case when v_full then state_registration end,
      'email_finance', case when v_full then email_finance end
    )), '[]'), coalesce(max(total_count), 0)
    into v_rows, v_total from counted;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_page_size);
end $function$;

-- O gatilho de evento `hp_guard_new_public_functions` retira EXECUTE de `public`/`anon` de TODA função pública (re)criada (exceto get_public_page, track_page_visit e submit_public_form).
-- Por isso o `create or replace` acima removeu o acesso anônimo do onboarding da fisioterapeuta (link público de cadastro). Restaurado exatamente como nas migrations 086/118/122:
revoke all on function public.onboarding_submit_physio(text, jsonb, text, text) from public, anon;
grant execute on function public.onboarding_submit_physio(text, jsonb, text, text) to anon, authenticated;
