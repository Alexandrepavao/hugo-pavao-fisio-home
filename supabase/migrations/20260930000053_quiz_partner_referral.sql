-- HP Group Hub — 053 Release v1: indicação de parceiro também pelo quiz.
-- Achado na jornada de aceite dos portais: o portal do parceiro promete rastrear indicações de "qualquer página" com ?ref=<código>,
-- mas só formulários de páginas geravam o registro (h_form_referral). Quem entrava pelo quiz (/avaliacao?ref=...) nunca aparecia
-- para o parceiro. quiz_start passa a registrar a indicação ao criar a oportunidade (uma vez; repetir o envio não duplica).
create or replace function public.quiz_start(
  p_journey text, p_name text, p_email text, p_phone text, p_contact_consent_version text,
  p_origin_path text default null, p_page_slug text default null, p_referrer text default null,
  p_utm jsonb default '{}', p_honeypot text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_unit uuid; v_name text; v_email text; v_phone text; v_key text; v_ip text;
  v_person uuid; v_sim numeric; v_shared boolean := false; v_review boolean := false;
  v_pipe uuid; v_stage uuid; v_owner uuid; v_opp uuid; v_lead public.quiz_leads;
begin
  if p_honeypot is not null and btrim(p_honeypot) <> '' then
    return jsonb_build_object('id', gen_random_uuid(), 'status', 'started', 'step_reached', 1, 'resumed', false);
  end if;
  if p_journey not in ('atendimento','parceria') then raise exception 'jornada inválida'; end if;
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_unit from public.units where org_id = v_org order by created_at limit 1;
  v_ip := private.client_ip_hash();
  perform private.rate_limit('quiz_start:' || p_journey || ':' || v_ip, interval '10 minutes', 8);
  perform private.rate_limit('quiz_startg:' || p_journey, interval '1 hour', 400);

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
end $$;

-- O CREATE OR REPLACE acima refaz as permissões padrão (anon sem EXECUTE): restaura a exposição pública desta RPC, como na 038.
grant execute on function public.quiz_start(text,text,text,text,text,text,text,text,jsonb,text) to anon, authenticated;
