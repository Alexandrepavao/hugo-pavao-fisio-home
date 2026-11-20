-- HP Group Hub — 143 Captação pública e acesso por organização (Dev; white label).
-- Até aqui quatro entradas PÚBLICAS tinham a organização HP escrita no código (get_public_page, quiz_start, quiz_whatsapp_number, onboarding_submit_patient) e o formulário
-- público aceitava o id de qualquer organização. Agora toda entrada pública resolve a organização por um SLUG validado no servidor (`private.public_org`):
--   · slug ausente  → HP (as rotas atuais da HP continuam idênticas);
--   · slug presente → só organização ATIVA; inexistente, suspensa, arquivada ou em preparação respondem igual (sem enumeração);
--   · lead, resposta e oportunidade nascem SEMPRE na organização resolvida, nunca na que o payload "diz";
--   · formulário de outra organização é recusado ("formulário indisponível"), com ou sem slug;
--   · captação exige o módulo CRM habilitado na organização (a habilitação vale no servidor);
--   · limites de abuso passam a ser por organização (uma organização não consome a cota da outra).
-- Também: `org_public_by_slug` (anon) devolve só a marca pública para a tela abrir com a marca certa ANTES de qualquer outra coisa.
create or replace function private.public_org(p_slug text) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare s text := lower(btrim(coalesce(p_slug, ''))); v uuid;
begin
  if s = '' then select id into v from public.organizations where slug = 'hp-group'; return v; end if;
  if s !~ '^[a-z0-9-]{1,60}$' then return null; end if;
  select o.id into v from public.organizations o where o.slug = s and o.status = 'active';
  return v;
end $$;
revoke all on function private.public_org(text) from public, anon, authenticated;

create or replace function public.org_public_by_slug(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.public_org(nullif(btrim(coalesce(p_slug, '')), ''));
begin
  if nullif(btrim(coalesce(p_slug, '')), '') is null or v is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'slug', lower(btrim(p_slug)), 'capture', private.module_enabled_for(v, 'crm'),
    'brand', private.org_brand_json(v) - 'org_id' - 'support_phone');
end $$;
revoke all on function public.org_public_by_slug(text) from public;
grant execute on function public.org_public_by_slug(text) to anon, authenticated;


drop function if exists public.get_public_page(text);
CREATE OR REPLACE FUNCTION public.get_public_page(p_slug text, p_org_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.pages; v_forms jsonb;
begin
  select * into p from public.pages where slug = lower(p_slug) and deleted_at is null
    and org_id = private.public_org(p_org_slug);
  if not found or p.status = 'draft' then return jsonb_build_object('status', 'not_found'); end if;
  if private.page_is_live(p) then
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'fields', f.fields, 'success_message', f.success_message)), '[]')
      into v_forms from public.forms f where f.page_id = p.id and f.active and f.id is distinct from p.waitlist_form_id;
    return jsonb_build_object('status', 'published', 'page', jsonb_build_object(
      'id', p.id, 'title', p.published_title, 'description', p.description, 'seo', p.published_seo,
      'content', p.published_content, 'forms', v_forms));
  end if;
  if p.status = 'published' and (p.publish_at is not null and p.publish_at > now()) then return jsonb_build_object('status', 'not_found'); end if;
  if p.disabled_mode = 'redirect' then return jsonb_build_object('status', 'redirect', 'redirect_url', p.redirect_url); end if;
  if p.disabled_mode = 'waitlist' and p.waitlist_form_id is not null then
    select jsonb_build_object('id', f.id, 'name', f.name, 'fields', f.fields, 'success_message', f.success_message) into v_forms from public.forms f where f.id = p.waitlist_form_id;
    return jsonb_build_object('status', 'waitlist', 'page', jsonb_build_object('title', p.published_title, 'forms', jsonb_build_array(v_forms)));
  end if;
  return jsonb_build_object('status', 'closed', 'message', coalesce(p.disabled_message, 'Esta página não está mais disponível.'), 'title', p.published_title);
end $function$;
revoke all on function public.get_public_page(text, text) from public;
grant execute on function public.get_public_page(text, text) to anon, authenticated;

drop function if exists public.quiz_whatsapp_number(text, uuid);
CREATE OR REPLACE FUNCTION public.quiz_whatsapp_number(p_journey text, p_unit uuid DEFAULT NULL::uuid, p_org_slug text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select phone from public.quiz_whatsapp_numbers
   where org_id = private.public_org(p_org_slug)
     and journey = p_journey and active and (unit_id = p_unit or unit_id is null)
   order by unit_id nulls last limit 1
$function$;
revoke all on function public.quiz_whatsapp_number(text, uuid, text) from public;
grant execute on function public.quiz_whatsapp_number(text, uuid, text) to anon, authenticated;

drop function if exists public.quiz_start(text, text, text, text, text, text, text, text, jsonb, text);
CREATE OR REPLACE FUNCTION public.quiz_start(p_journey text, p_name text, p_email text, p_phone text, p_contact_consent_version text, p_origin_path text DEFAULT NULL::text, p_page_slug text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_utm jsonb DEFAULT '{}'::jsonb, p_honeypot text DEFAULT NULL::text, p_org_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid; v_unit uuid; v_name text; v_email text; v_phone text; v_key text; v_ip text;
  v_person uuid; v_sim numeric; v_shared boolean := false; v_review boolean := false;
  v_pipe uuid; v_stage uuid; v_owner uuid; v_opp uuid; v_lead public.quiz_leads;
begin
  if p_honeypot is not null and btrim(p_honeypot) <> '' then
    return jsonb_build_object('id', gen_random_uuid(), 'status', 'started', 'step_reached', 1, 'resumed', false);
  end if;
  if p_journey not in ('atendimento','parceria') then raise exception 'jornada inválida'; end if;
  v_org := private.public_org(p_org_slug);
  if v_org is null or not private.module_enabled_for(v_org, 'crm') then raise exception 'captação indisponível'; end if;
  select id into v_unit from public.units where org_id = v_org order by created_at limit 1;
  v_ip := private.client_ip_hash();
  perform private.rate_limit('quiz_start:' || v_org || ':' || p_journey || ':' || v_ip, interval '10 minutes', 8);
  perform private.rate_limit('quiz_startg:' || v_org || ':' || p_journey, interval '1 hour', 400);

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone := private.norm_phone(p_phone);
  if v_name is null or length(v_name) < 2 then raise exception 'Informe seu nome.'; end if;
  if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  if v_phone is null then raise exception 'WhatsApp inválido.'; end if;
  if p_contact_consent_version is null or btrim(p_contact_consent_version) = '' then raise exception 'Autorização de contato ausente.'; end if;

  v_key := encode(sha256(convert_to(p_journey || '|' || v_email || '|' || v_phone || '|' || current_date::text, 'UTF8')), 'hex');
  select * into v_lead from public.quiz_leads where org_id = v_org and journey = p_journey and dedupe_key = v_key;
  if found then
    return jsonb_build_object('id', v_lead.id, 'status', v_lead.status, 'step_reached', v_lead.step_reached, 'resumed', true);
  end if;

  select p.id, extensions.similarity(lower(p.full_name), lower(v_name)) into v_person, v_sim
    from public.people p join public.person_contacts c on c.person_id = p.id
   where p.org_id = v_org and p.merged_into_id is null
     and ((c.type = 'email' and c.normalized = v_email) or (c.type in ('phone','whatsapp') and c.normalized = v_phone))
   order by extensions.similarity(lower(p.full_name), lower(v_name)) desc limit 1;
  if v_person is not null and v_sim < 0.5 then v_person := null; v_shared := true; v_review := true; end if;
  if v_person is null then
    insert into public.people (org_id, unit_id, full_name) values (v_org, v_unit, v_name) returning id into v_person;
    insert into public.person_kinds (person_id, kind) values (v_person, 'lead');
    insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (v_org, v_person, 'email', v_email, true, v_shared);
    insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (v_org, v_person, 'phone', p_phone, true, v_shared);
    if not v_review and exists (select 1 from public.people p where p.org_id = v_org and p.id <> v_person and p.merged_into_id is null
        and extensions.similarity(lower(p.full_name), lower(v_name)) >= 0.7) then v_review := true; end if;
  else
    insert into public.person_kinds (person_id, kind) values (v_person, 'lead') on conflict do nothing;
  end if;

  select id into v_pipe from public.pipelines where org_id = v_org and kind = (case p_journey when 'atendimento' then 'patients' else 'partners' end) limit 1;
  if v_pipe is null then raise exception 'funil de destino não configurado'; end if;
  select o.id, o.owner_user_id into v_opp, v_owner from public.opportunities o
   where o.person_id = v_person and o.pipeline_id = v_pipe and o.status = 'open' and o.source = 'quiz:' || p_journey limit 1;
  if v_opp is null then
    select id into v_stage from public.pipeline_stages where pipeline_id = v_pipe and kind = 'open' order by position limit 1;
    v_owner := private.pick_owner(v_org, v_unit);
    insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, title, source, campaign, utm)
      values (v_org, v_unit, v_person, v_pipe, v_stage, v_owner,
              case p_journey when 'atendimento' then 'Quiz — potencial paciente' else 'Quiz — candidato a parceiro' end,
              'quiz:' || p_journey, p_utm ->> 'utm_campaign', left(coalesce(p_utm, '{}')::text, 1500)::jsonb)
      returning id into v_opp;
    -- indicação de parceiro: ?ref=<código> no endereço do quiz vira registro em referrals (mesma regra do h_form_referral)
    if coalesce(p_utm ->> 'ref', '') <> '' then
      insert into public.referrals (org_id, unit_id, referrer_person_id, referred_person_id, opportunity_id, code)
        select v_org, v_unit, c.person_id, v_person, v_opp, c.code from public.referral_codes c
         where c.org_id = v_org and c.code = lower(left(p_utm ->> 'ref', 60)) and c.person_id <> v_person
        on conflict do nothing;
    end if;
  end if;

  insert into public.quiz_leads (
    org_id, unit_id, journey, version, status, step_reached, dedupe_key, person_id, opportunity_id, needs_review,
    full_name, email, phone, contact_consent_version, contact_consent_at, origin_path, page_slug, referrer, utm, ip_hash, owner_user_id
  ) values (
    v_org, v_unit, p_journey, p_journey || '-v1', 'started', 1, v_key, v_person, v_opp, v_review,
    v_name, v_email, p_phone, btrim(p_contact_consent_version), now(),
    left(p_origin_path, 300), left(p_page_slug, 120), left(p_referrer, 500), left(coalesce(p_utm, '{}')::text, 1500)::jsonb, v_ip, v_owner
  ) returning * into v_lead;

  insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary)
    values (v_org, v_person, v_unit, v_opp, 'system', 'Quiz iniciado — jornada ' || p_journey);
  if v_review then
    insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (v_org, v_unit, v_opp, v_person, v_owner, 'dedupe_review', 'Revisar possível duplicidade / contato compartilhado', 'dedupe:' || v_person)
      on conflict do nothing;
  end if;

  return jsonb_build_object('id', v_lead.id, 'status', 'started', 'step_reached', 1, 'resumed', false);
end $function$;
revoke all on function public.quiz_start(text, text, text, text, text, text, text, text, jsonb, text, text) from public;
grant execute on function public.quiz_start(text, text, text, text, text, text, text, text, jsonb, text, text) to anon, authenticated;

drop function if exists public.onboarding_submit_patient(jsonb, text, boolean, text);
CREATE OR REPLACE FUNCTION public.onboarding_submit_patient(p_data jsonb, p_consent_version text, p_health_consent boolean DEFAULT false, p_honeypot text DEFAULT NULL::text, p_org_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare

  v_ip text := private.client_ip_hash(); v_org uuid; v_unit uuid; v_addr jsonb; v_name text; v_pref text; v_birth date; v_cpf text; v_email text; v_phone text; v_phone_digits text;

  v_em_name text; v_em_phone text; v_em_rel text; v_complaint text; v_person uuid; v_existing boolean := false; v_note text; v_pending boolean := false; v_sub uuid; v_payload jsonb;

begin

  if p_honeypot is not null and btrim(p_honeypot) <> '' then return jsonb_build_object('status', 'created'); end if;

  perform private.rate_limit('onb_patient:' || v_ip, interval '10 minutes', 6);

  perform private.rate_limit('onb_patientg', interval '1 hour', 300);

  v_org := private.public_org(p_org_slug);
  if v_org is not null and not private.module_enabled_for(v_org, 'crm') then v_org := null; end if;

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

end $function$;
revoke all on function public.onboarding_submit_patient(jsonb, text, boolean, text, text) from public;
grant execute on function public.onboarding_submit_patient(jsonb, text, boolean, text, text) to anon, authenticated;

drop function if exists public.submit_public_form(uuid, jsonb, jsonb, text, text);
CREATE OR REPLACE FUNCTION public.submit_public_form(p_form_id uuid, p_answers jsonb, p_utm jsonb DEFAULT '{}'::jsonb, p_honeypot text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_org_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.forms; pg public.pages; fld jsonb; k text; v text; ans jsonb := '{}';
  v_name text; v_email text; v_phone text; v_key text; v_person uuid; v_sim numeric; v_shared boolean := false;
  v_opp uuid; v_owner uuid; v_sub uuid; v_stage uuid; v_utm jsonb; v_review boolean := false;
begin
  if p_honeypot is not null and btrim(p_honeypot) <> '' then return jsonb_build_object('status', 'ok'); end if;
  select * into f from public.forms where id = p_form_id and active;
  if not found then raise exception 'formulário indisponível'; end if;
  -- a organização do formulário TEM de ser a do endereço (sem slug = HP): id de formulário de outra organização é recusado
  if f.org_id is distinct from private.public_org(p_org_slug) or not private.module_enabled_for(f.org_id, 'crm') then raise exception 'formulário indisponível'; end if;
  select * into pg from public.pages where id = f.page_id;
  if not (private.page_is_live(pg) or (pg.deleted_at is null and pg.status = 'disabled' and pg.disabled_mode = 'waitlist' and pg.waitlist_form_id = f.id)) then
    raise exception 'formulário indisponível';
  end if;
  perform private.rate_limit('form:' || f.id || ':' || private.client_ip_hash(), interval '10 minutes', 5);
  perform private.rate_limit('formg:' || f.id, interval '1 hour', 300);

  if jsonb_typeof(coalesce(p_answers, '{}')) <> 'object' then raise exception 'dados inválidos'; end if;
  for fld in select * from jsonb_array_elements(f.fields) loop
    k := fld ->> 'key'; v := nullif(btrim(coalesce(p_answers ->> k, '')), '');
    if v is null then
      if coalesce((fld ->> 'required')::boolean, false) then raise exception 'Preencha o campo: %', fld ->> 'label'; end if;
      continue;
    end if;
    if length(v) > 2000 then raise exception 'Texto muito longo em: %', fld ->> 'label'; end if;
    if fld ->> 'type' = 'email' and v !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
    if fld ->> 'type' = 'phone' and length(regexp_replace(v, '\D', '', 'g')) not between 10 and 13 then raise exception 'Telefone inválido'; end if;
    ans := ans || jsonb_build_object(k, v);
  end loop;
  v_name := ans ->> 'name'; v_email := lower(ans ->> 'email'); v_phone := private.norm_phone(ans ->> 'phone');
  if v_email is null and v_phone is null then raise exception 'Informe e-mail ou telefone'; end if;
  v_utm := left(coalesce(p_utm, '{}')::text, 1500)::jsonb;

  v_key := encode(sha256(convert_to(f.id::text || '|' || coalesce(v_email, v_phone) || '|' || current_date::text, 'UTF8')), 'hex');
  if exists (select 1 from public.form_submissions where form_id = f.id and dedupe_key = v_key) then
    return jsonb_build_object('status', 'duplicate', 'message', f.success_message);
  end if;

  select p.id, extensions.similarity(lower(p.full_name), lower(v_name)) into v_person, v_sim
    from public.people p join public.person_contacts c on c.person_id = p.id
   where p.org_id = f.org_id and p.merged_into_id is null
     and ((c.type = 'email' and c.normalized = v_email) or (c.type in ('phone','whatsapp') and c.normalized = v_phone))
   order by extensions.similarity(lower(p.full_name), lower(v_name)) desc limit 1;
  if v_person is not null and v_sim < 0.5 then v_person := null; v_shared := true; v_review := true; end if;
  if v_person is null then
    insert into public.people (org_id, unit_id, full_name) values (f.org_id, f.unit_id, v_name) returning id into v_person;
    insert into public.person_kinds (person_id, kind) values (v_person, 'lead');
    if v_email is not null then insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (f.org_id, v_person, 'email', v_email, true, v_shared); end if;
    if v_phone is not null then insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (f.org_id, v_person, 'phone', ans ->> 'phone', true, v_shared); end if;
    if not v_review and exists (select 1 from public.people p where p.org_id = f.org_id and p.id <> v_person and p.merged_into_id is null
        and extensions.similarity(lower(p.full_name), lower(v_name)) >= 0.7) then v_review := true; end if;
  else
    insert into public.person_kinds (person_id, kind) values (v_person, 'lead') on conflict do nothing;
  end if;

  select id into v_opp from public.opportunities where person_id = v_person and pipeline_id = f.pipeline_id and page_id = pg.id and status = 'open' limit 1;
  if v_opp is null then
    select id into v_stage from public.pipeline_stages where pipeline_id = f.pipeline_id and kind = 'open' order by position limit 1;
    if v_stage is null then raise exception 'funil da página sem etapas'; end if;
    v_owner := coalesce(f.owner_user_id, pg.owner_user_id, private.pick_owner(f.org_id, f.unit_id));
    insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, product_id, title, source, campaign, utm, page_id)
      values (f.org_id, f.unit_id, v_person, f.pipeline_id, v_stage, v_owner, coalesce(f.product_id, pg.product_id),
              pg.title || ' — ' || f.name, 'page:' || pg.slug, v_utm ->> 'utm_campaign', v_utm, pg.id)
      returning id into v_opp;
    insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, due_at, dedupe_key)
      values (f.org_id, f.unit_id, v_opp, v_person, v_owner, 'first_contact', 'Primeiro contato com o lead', now() + interval '15 minutes', 'first_contact:' || v_opp)
      on conflict do nothing;
  end if;
  insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary)
    values (f.org_id, v_person, f.unit_id, v_opp, 'system', 'Formulário "' || f.name || '" enviado pela página /' || pg.slug);
  if v_review then
    insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (f.org_id, f.unit_id, v_opp, v_person, v_owner, 'dedupe_review', 'Revisar possível duplicidade / contato compartilhado', 'dedupe:' || v_person)
      on conflict do nothing;
  end if;
  insert into public.form_submissions (org_id, form_id, page_id, person_id, opportunity_id, answers, utm, referrer, dedupe_key)
    values (f.org_id, f.id, pg.id, v_person, v_opp, ans, v_utm, left(p_referrer, 500), v_key) returning id into v_sub;
  perform private.emit_event(f.org_id, 'form.submitted', 'form_submission', v_sub, jsonb_build_object('opportunity_id', v_opp, 'person_id', v_person), 'form_submission:' || v_sub);
  return jsonb_build_object('status', 'created', 'message', f.success_message);
end $function$;
revoke all on function public.submit_public_form(uuid, jsonb, jsonb, text, text, text) from public;
grant execute on function public.submit_public_form(uuid, jsonb, jsonb, text, text, text) to anon, authenticated;
