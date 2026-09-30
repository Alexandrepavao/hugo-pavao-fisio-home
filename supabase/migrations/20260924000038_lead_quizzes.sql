-- HP Group Hub — 038 Quizzes de captação (atendimento/parceria), integração automática ao CRM,
-- visão administrativa de captação de leads e encaminhamento opcional para WhatsApp.
--
-- Reaproveita a infraestrutura já existente em vez de recriar: pessoas/dedup (mesma lógica de
-- submit_public_form), funis "Pacientes"/"Parceiros" já semeados, crm_tasks (idempotência por
-- dedupe_key), interactions (trilha "Quiz iniciado"/"Quiz concluído"), domain_events/emit_event
-- (auditoria), tags/person_tags (segmento "Potencial Academy" sem tocar em matrícula/papel/enum
-- person_kind), rate_limit e honeypot (mesmos limites usados pelos formulários públicos).
--
-- "confirmar" já está reservado (migration 037); adiciona os dois novos slugs fixos dos quizzes.
create or replace function private.is_reserved_slug(s text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(s) = any (array['admin','login','logout','academy','portal','api','redefinir-senha','primeiro-acesso',
    'confirmar','avaliacao','seja-parceiro','trabalhe-conosco','paciente','parceiro','pesquisas','auth','assets','static',
    'favicon.png','robots.txt','sitemap.xml','netlify','supabase','p','preview','hp','hub','sistema'])
$$;

-- ------------------------------------------------------------------ submissões de quiz
-- Identificador público = quiz_leads.id (uuid aleatório, nunca sequencial — as mesmas propriedades
-- de um "token" de sessão). O navegador nunca informa person_id/opportunity_id: só o servidor decide
-- esses vínculos, exatamente como em submit_public_form.
create table public.quiz_leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  journey text not null check (journey in ('atendimento','parceria')),
  version text not null,
  status text not null default 'started' check (status in ('started','partial','completed')),
  step_reached int not null default 1 check (step_reached between 1 and 10),
  dedupe_key text not null,
  person_id uuid references public.people(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  needs_review boolean not null default false,
  full_name text not null check (length(btrim(full_name)) >= 2),
  email text not null,
  phone text not null,
  city text,
  state_uf text check (state_uf is null or state_uf ~ '^[A-Z]{2}$'),
  -- respostas versionadas: cada chave grava {label, value[, detalhe]} — o rótulo exibido ao usuário
  -- fica congelado aqui mesmo que o texto da pergunta mude em versões futuras.
  answers jsonb not null default '{}'::jsonb,
  contact_consent_version text not null,
  contact_consent_at timestamptz not null default now(),
  health_consent_version text,
  health_consent_at timestamptz,
  marketing_consent boolean not null default false,
  marketing_consent_version text,
  marketing_consent_at timestamptz,
  wants_academy boolean not null default false,
  origin_path text,
  page_slug text,
  referrer text,
  utm jsonb not null default '{}'::jsonb,
  ip_hash text,
  owner_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  whatsapp_clicked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Mesmo contato + jornada + dia = a MESMA submissão (idempotência contra duplo clique/reenvio/retentativa).
create unique index quiz_leads_dedupe_uq on public.quiz_leads (org_id, journey, dedupe_key);
create index quiz_leads_org_status_idx on public.quiz_leads (org_id, journey, status, started_at desc);
create index quiz_leads_person_idx on public.quiz_leads (person_id);
create index quiz_leads_unit_idx on public.quiz_leads (unit_id);
create trigger quiz_leads_touch before update on public.quiz_leads for each row execute function private.touch_updated_at();

-- Número de WhatsApp por jornada (e, quando aplicável, por unidade) — configurável pelo gestor, nunca
-- inventado. unit_id nulo = número padrão da organização (hoje há uma única unidade real).
create table public.quiz_whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  journey text not null check (journey in ('atendimento','parceria')),
  unit_id uuid references public.units(id) on delete cascade,
  phone text not null check (phone ~ '^[1-9][0-9]{7,14}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index quiz_whatsapp_numbers_uq on public.quiz_whatsapp_numbers (org_id, journey, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid));
create trigger quiz_whatsapp_numbers_touch before update on public.quiz_whatsapp_numbers for each row execute function private.touch_updated_at();

-- Números já reais e em uso hoje no site (src/lib/contact.ts) — reaproveitados como padrão inicial,
-- nunca inventados. Administrável depois em Gestão → Captação de leads.
insert into public.quiz_whatsapp_numbers (org_id, journey, unit_id, phone)
select id, 'atendimento', null, '5511959075351' from public.organizations where slug = 'hp-group';
insert into public.quiz_whatsapp_numbers (org_id, journey, unit_id, phone)
select id, 'parceria', null, '5511913634424' from public.organizations where slug = 'hp-group';

-- ------------------------------------------------------------------ validação das respostas (fixas, dadas pelo negócio)
-- Espelha exatamente as perguntas/opções especificadas para as duas jornadas (10 perguntas cada,
-- as 3 primeiras — nome/e-mail/whatsapp — já vêm em quiz_start; cidade/UF é a 4ª). Cada resposta
-- chega como {"value": ..., "label": "texto exibido"[, "detalhe": "..."]} — o rótulo não é validado
-- (é conteúdo do cliente, só para exibição/auditoria), o valor é.
create or replace function private.quiz_validate_answer(p_journey text, p_key text, p_value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_num numeric; v_arr jsonb; v_val text;
begin
  if jsonb_typeof(p_value) <> 'object' or not (p_value ? 'value') then return false; end if;
  v_val := p_value ->> 'value';
  if p_journey = 'atendimento' then
    case p_key
      when 'dor_intensidade', 'motivacao_melhora', 'impacto_qualidade_vida' then
        begin v_num := v_val::numeric; exception when others then return false; end;
        return v_num between 0 and 10 and v_num = trunc(v_num);
      when 'atividade_desejada' then
        return v_val = any (array['trabalhar','dormir','esporte','atividades_diarias','outra'])
          and (v_val <> 'outra' or length(coalesce(p_value ->> 'detalhe', '')) <= 200);
      when 'interesse_acompanhamento' then return v_val = any (array['sim','quero_entender','nao_momento']);
      when 'faixa_investimento' then return v_val = any (array['ate_250','250_500','acima_500','entender_proposta']);
      else return false;
    end case;
  elsif p_journey = 'parceria' then
    case p_key
      when 'momento_profissional' then return v_val = any (array['estudante','formado_iniciando','em_atuacao','gestor_proprietario']);
      when 'situacao_registro' then return v_val = any (array['ativo','em_regularizacao','nao_possuo']);
      when 'area_atuacao' then
        return v_val = any (array['ortopedia','esportiva','neurologica','geriatrica','outra'])
          and (v_val <> 'outra' or length(coalesce(p_value ->> 'detalhe', '')) <= 200);
      when 'modelo_atendimento' then
        return v_val = any (array['clinica_propria','clinica_terceiros','domiciliar','nao_atendo','outro'])
          and (v_val <> 'outro' or length(coalesce(p_value ->> 'detalhe', '')) <= 200);
      when 'objetivos_parceria' then
        if jsonb_typeof(p_value -> 'value') <> 'array' or jsonb_array_length(p_value -> 'value') = 0 then return false; end if;
        return not exists (select 1 from jsonb_array_elements_text(p_value -> 'value') x
          where x not in ('encaminhamentos','equipe','conhecer_metodo','desenvolver_negocio'));
      when 'interesses_desenvolvimento' then
        v_arr := p_value -> 'value';
        if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) = 0 then return false; end if;
        if exists (select 1 from jsonb_array_elements_text(v_arr) x where x = 'nenhuma') and jsonb_array_length(v_arr) > 1 then return false; end if;
        return not exists (select 1 from jsonb_array_elements_text(v_arr) x
          where x not in ('precificacao','posicionamento_marca','captacao_pacientes','vendas','gestao','nenhuma'));
      else return false;
    end case;
  end if;
  return false;
end $$;

-- ------------------------------------------------------------------ RPCs públicas (anon)
-- Etapa 1: finalidade + autorização de contato já aceitas no cliente antes de chamar esta função.
-- Cria/reaproveita pessoa (mesma lógica de dedup de submit_public_form) e a oportunidade na jornada
-- correta; nunca move oportunidades já existentes de outro funil. honeypot preenchido = resposta
-- "fantasma" (não revela ao robô que nada foi persistido).
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

-- Autorização específica de dados de saúde — só a jornada de atendimento pede, antes das perguntas 5-7.
create or replace function public.quiz_set_health_consent(p_id uuid, p_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.quiz_leads;
begin
  select * into v from public.quiz_leads where id = p_id;
  if not found or v.status = 'completed' then raise exception 'submissão não encontrada' using errcode = '42501'; end if;
  if v.journey <> 'atendimento' then raise exception 'consentimento de saúde não se aplica a esta jornada'; end if;
  if p_version is null or btrim(p_version) = '' then raise exception 'versão de consentimento ausente'; end if;
  perform private.rate_limit('quiz_consent:' || v.id, interval '1 minute', 10);
  update public.quiz_leads set health_consent_version = btrim(p_version), health_consent_at = now(), last_activity_at = now() where id = p_id;
end $$;

-- Etapas seguintes: grava progresso mesclando respostas (nunca sobrescreve uma submissão já concluída).
-- p_id é o único identificador aceito — nunca person_id/opportunity_id — então o navegador não tem como
-- alterar um cadastro ou oportunidade arbitrários, só a própria submissão (id imprevisível, uuid aleatório).
create or replace function public.quiz_save_progress(p_id uuid, p_step int, p_answers jsonb, p_city text default null, p_uf text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.quiz_leads; k text; val jsonb; v_merged jsonb;
begin
  select * into v from public.quiz_leads where id = p_id;
  if not found then raise exception 'submissão não encontrada' using errcode = '42501'; end if;
  if v.status = 'completed' then
    return jsonb_build_object('id', v.id, 'status', v.status, 'step_reached', v.step_reached);
  end if;
  perform private.rate_limit('quiz_progress:' || v.id, interval '1 minute', 40);
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then raise exception 'dados inválidos'; end if;
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
      state_uf = coalesce(nullif(upper(btrim(coalesce(p_uf, ''))), ''), state_uf),
      last_activity_at = now()
    where id = p_id returning * into v;
  return jsonb_build_object('id', v.id, 'status', v.status, 'step_reached', v.step_reached);
end $$;

-- Conclusão: consentimento de marketing é sempre opcional e separado (nunca inferido do interesse em
-- Academy). Segmento "Potencial Academy" é uma tag reaproveitada (tags/person_tags já existentes) —
-- nunca matrícula, nunca acesso a curso, nunca uma segunda oportunidade.
create or replace function public.quiz_complete(p_id uuid, p_marketing_consent boolean default false, p_marketing_consent_version text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.quiz_leads; v_tag uuid; v_protocol text;
begin
  select * into v from public.quiz_leads where id = p_id;
  if not found then raise exception 'submissão não encontrada' using errcode = '42501'; end if;
  v_protocol := upper(left(replace(v.id::text, '-', ''), 8));
  if v.status = 'completed' then
    return jsonb_build_object('id', v.id, 'status', 'completed', 'protocol', v_protocol, 'first_name', split_part(v.full_name, ' ', 1));
  end if;
  if v.journey = 'atendimento' and not (v.answers ? 'interesse_acompanhamento' and v.answers ? 'faixa_investimento') then
    raise exception 'quiz incompleto';
  end if;
  if v.journey = 'parceria' and not (v.answers ? 'objetivos_parceria' and v.answers ? 'interesses_desenvolvimento') then
    raise exception 'quiz incompleto';
  end if;
  perform private.rate_limit('quiz_complete:' || v.id, interval '1 minute', 10);

  update public.quiz_leads set
      status = 'completed', completed_at = now(), last_activity_at = now(),
      marketing_consent = coalesce(p_marketing_consent, false),
      marketing_consent_version = case when p_marketing_consent then p_marketing_consent_version else null end,
      marketing_consent_at = case when p_marketing_consent then now() else null end,
      wants_academy = (v.journey = 'parceria')
    where id = p_id returning * into v;

  insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary)
    values (v.org_id, v.person_id, v.unit_id, v.opportunity_id, 'system', 'Quiz concluído — aguardando contato');

  insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, due_at, dedupe_key)
    values (v.org_id, v.unit_id, v.opportunity_id, v.person_id, v.owner_user_id, 'first_contact',
            case v.journey when 'atendimento' then 'Contatar lead do quiz de avaliação' else 'Contatar candidato a parceiro (quiz)' end,
            now() + interval '15 minutes', 'quiz_lead:' || v.id)
    on conflict do nothing;

  if v.journey = 'parceria' then
    insert into public.tags (org_id, name) values (v.org_id, 'Potencial Academy') on conflict (org_id, name) do nothing;
    select id into v_tag from public.tags where org_id = v.org_id and name = 'Potencial Academy';
    insert into public.person_tags (person_id, tag_id) values (v.person_id, v_tag) on conflict do nothing;
  end if;

  perform private.emit_event(v.org_id, 'quiz.completed', 'quiz_lead', v.id,
    jsonb_build_object('journey', v.journey, 'opportunity_id', v.opportunity_id, 'person_id', v.person_id), 'quiz_completed:' || v.id);

  return jsonb_build_object('id', v.id, 'status', 'completed', 'protocol', v_protocol, 'first_name', split_part(v.full_name, ' ', 1));
end $$;

-- Clique no botão do WhatsApp — evento separado da conclusão, só depois de gravação confirmada.
create or replace function public.quiz_log_whatsapp_click(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.quiz_leads;
begin
  select * into v from public.quiz_leads where id = p_id and status = 'completed';
  if not found then raise exception 'submissão não encontrada ou incompleta' using errcode = '42501'; end if;
  perform private.rate_limit('quiz_wa:' || v.id, interval '1 minute', 8);
  update public.quiz_leads set whatsapp_clicked_at = now() where id = p_id;
end $$;

-- Número configurado para a jornada (unidade específica tem prioridade sobre o padrão da org). Nulo =
-- nada configurado — o cliente NUNCA inventa um número; a conclusão do quiz continua válida sem ele.
create or replace function public.quiz_whatsapp_number(p_journey text, p_unit uuid default null) returns text
language sql stable security definer set search_path = '' as $$
  select phone from public.quiz_whatsapp_numbers
   where org_id = (select id from public.organizations where slug = 'hp-group')
     and journey = p_journey and active and (unit_id = p_unit or unit_id is null)
   order by unit_id nulls last limit 1
$$;

-- ------------------------------------------------------------------ visão administrativa (authenticated)
-- Lista paginada/filtrável para Gestão → Captação de leads. Nunca devolve respostas de saúde (a tela de
-- detalhe decide isso por permissão). Mesmo escopo por unidade já usado em CRM/Pessoas.
create or replace function public.list_quiz_leads(
  p_journey text default null, p_status text default null, p_needs_review boolean default null,
  p_search text default null, p_limit int default 50, p_offset int default 0
) returns table (
  id uuid, journey text, status text, full_name text, email text, phone text, city text, state_uf text,
  origin_path text, page_slug text, started_at timestamptz, completed_at timestamptz, last_activity_at timestamptz,
  owner_user_id uuid, stage_name text, next_contact_at timestamptz, needs_review boolean, wants_academy boolean,
  whatsapp_clicked_at timestamptz, person_id uuid, opportunity_id uuid, has_health_answers boolean, total_count bigint
)
language sql stable security definer set search_path = '' as $$
  with base as (
    select l.* from public.quiz_leads l
     where private.in_org(l.org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], l.unit_id)
       and (p_journey is null or l.journey = p_journey)
       and (p_status is null or l.status = p_status)
       and (p_needs_review is null or l.needs_review = p_needs_review)
       and (p_search is null or btrim(p_search) = '' or l.full_name ilike '%' || p_search || '%' or l.email ilike '%' || p_search || '%' or l.phone ilike '%' || p_search || '%')
  )
  select b.id, b.journey, b.status, b.full_name, b.email, b.phone, b.city, b.state_uf,
         b.origin_path, b.page_slug, b.started_at, b.completed_at, b.last_activity_at,
         b.owner_user_id, ps.name, o.next_contact_at, b.needs_review, b.wants_academy,
         b.whatsapp_clicked_at, b.person_id, b.opportunity_id,
         (b.answers ?| array['dor_intensidade','motivacao_melhora','impacto_qualidade_vida']),
         count(*) over ()
  from base b
  left join public.opportunities o on o.id = b.opportunity_id
  left join public.pipeline_stages ps on ps.id = o.stage_id
  order by b.started_at desc
  limit least(coalesce(p_limit, 50), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Detalhe de uma submissão. Respostas de saúde só aparecem para quem tem papel de gestão (nunca
-- automaticamente para o papel comercial "sales") — mesmo precedente já usado em contas corporativas.
create or replace function public.get_quiz_lead_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.quiz_leads; v_can_health boolean; v_answers jsonb; v_stage text; v_next timestamptz;
begin
  select * into v from public.quiz_leads l
   where l.id = p_id and private.in_org(l.org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], l.unit_id);
  if not found then raise exception 'não encontrado' using errcode = '42501'; end if;
  v_can_health := private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], v.unit_id);
  v_answers := v.answers;
  if not v_can_health then
    v_answers := v_answers - 'dor_intensidade' - 'motivacao_melhora' - 'impacto_qualidade_vida';
  end if;
  select ps.name, o.next_contact_at into v_stage, v_next from public.opportunities o left join public.pipeline_stages ps on ps.id = o.stage_id where o.id = v.opportunity_id;
  return jsonb_build_object(
    'id', v.id, 'journey', v.journey, 'version', v.version, 'status', v.status, 'step_reached', v.step_reached,
    'full_name', v.full_name, 'email', v.email, 'phone', v.phone, 'city', v.city, 'state_uf', v.state_uf,
    'answers', v_answers, 'health_answers_restricted', not v_can_health,
    'contact_consent_version', v.contact_consent_version, 'contact_consent_at', v.contact_consent_at,
    'health_consent_version', v.health_consent_version, 'health_consent_at', v.health_consent_at,
    'marketing_consent', v.marketing_consent, 'marketing_consent_version', v.marketing_consent_version, 'marketing_consent_at', v.marketing_consent_at,
    'wants_academy', v.wants_academy, 'needs_review', v.needs_review,
    'origin_path', v.origin_path, 'page_slug', v.page_slug, 'referrer', v.referrer, 'utm', v.utm,
    'owner_user_id', v.owner_user_id, 'person_id', v.person_id, 'opportunity_id', v.opportunity_id, 'stage_name', v_stage, 'next_contact_at', v_next,
    'started_at', v.started_at, 'completed_at', v.completed_at, 'last_activity_at', v.last_activity_at, 'whatsapp_clicked_at', v.whatsapp_clicked_at
  );
end $$;

-- Indicadores reais com denominador e período explícitos (nunca confunde clique no WhatsApp com envio
-- real). "Abandono" é calculado aqui, na leitura — nunca escrito de volta na linha — a partir de uma
-- regra de inatividade de 24h sem nenhuma atividade (nem fechamento de aba marca abandono na hora).
create or replace function public.quiz_lead_metrics(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_result jsonb;
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_org := private.current_org();
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'captured_by_journey', (select coalesce(jsonb_object_agg(journey, n), '{}'::jsonb) from (
      select journey, count(*) n from public.quiz_leads where org_id = v_org and started_at >= p_from and started_at < p_to group by journey) x),
    'completion_rate_pct', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where status = 'completed') / count(*), 1) end
      from public.quiz_leads where org_id = v_org and started_at >= p_from and started_at < p_to),
    'abandoned_by_step_24h_inactive', (select coalesce(jsonb_object_agg(step_reached::text, n), '{}'::jsonb) from (
      select step_reached, count(*) n from public.quiz_leads
       where org_id = v_org and status <> 'completed' and started_at >= p_from and started_at < p_to and last_activity_at < now() - interval '24 hours'
       group by step_reached) x),
    'awaiting_contact', (select count(*) from public.quiz_leads l
      where l.org_id = v_org and l.status = 'completed'
        and not exists (select 1 from public.interactions i where i.opportunity_id = l.opportunity_id and i.channel <> 'system' and i.created_at > l.completed_at)),
    'avg_minutes_to_first_contact', (select round(extract(epoch from avg(o.first_response_at - l.completed_at)) / 60.0, 1)
      from public.quiz_leads l join public.opportunities o on o.id = l.opportunity_id
      where l.org_id = v_org and l.status = 'completed' and o.first_response_at is not null and l.started_at >= p_from and l.started_at < p_to),
    'converted_to_scheduled_evaluation', (select count(distinct l.id) from public.quiz_leads l join public.appointments ap on ap.opportunity_id = l.opportunity_id
      where l.org_id = v_org and l.journey = 'atendimento' and l.started_at >= p_from and l.started_at < p_to),
    'converted_to_approved_partner', (select count(distinct l.id) from public.quiz_leads l join public.partner_profiles pp on pp.person_id = l.person_id and pp.status = 'active'
      where l.org_id = v_org and l.journey = 'parceria' and l.started_at >= p_from and l.started_at < p_to),
    'academy_segment_count', (select count(*) from public.quiz_leads where org_id = v_org and journey = 'parceria' and wants_academy and started_at >= p_from and started_at < p_to),
    'academy_theme_interest', (select coalesce(jsonb_object_agg(theme, n), '{}'::jsonb) from (
      select x.theme, count(*) n from public.quiz_leads l, jsonb_array_elements_text(l.answers -> 'interesses_desenvolvimento' -> 'value') x(theme)
       where l.org_id = v_org and l.journey = 'parceria' and l.started_at >= p_from and l.started_at < p_to group by x.theme) y),
    'by_origin', (select coalesce(jsonb_object_agg(coalesce(origin_path, '(desconhecida)'), n), '{}'::jsonb) from (
      select origin_path, count(*) n from public.quiz_leads where org_id = v_org and started_at >= p_from and started_at < p_to group by origin_path) x),
    'by_location_uf', (select coalesce(jsonb_object_agg(coalesce(state_uf, '(não informado)'), n), '{}'::jsonb) from (
      select state_uf, count(*) n from public.quiz_leads where org_id = v_org and started_at >= p_from and started_at < p_to group by state_uf) x),
    'whatsapp_clicks', (select count(*) from public.quiz_leads where org_id = v_org and whatsapp_clicked_at is not null and started_at >= p_from and started_at < p_to)
  ) into v_result;
  return v_result;
end $$;

-- ------------------------------------------------------------------ RLS e privilégios
-- quiz_leads NUNCA é lido/escrito diretamente por anon nem authenticated — só pelas funções acima
-- (SECURITY DEFINER), o que garante o mascaramento de respostas de saúde e o escopo por unidade.
-- RLS habilitado como reforço mesmo sem nenhum GRANT direto na tabela.
alter table public.quiz_leads enable row level security;
alter table public.quiz_whatsapp_numbers enable row level security;

grant select, insert, update on public.quiz_whatsapp_numbers to authenticated;
create policy qwn_read on public.quiz_whatsapp_numbers for select to authenticated using (private.in_org(org_id) and private.is_staff());
create policy qwn_write on public.quiz_whatsapp_numbers for insert to authenticated with check (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[]));
create policy qwn_update on public.quiz_whatsapp_numbers for update to authenticated using (private.in_org(org_id) and private.has_org_role(array['manager','ops_admin']::public.app_role[])) with check (private.in_org(org_id));

grant execute on function public.quiz_start(text,text,text,text,text,text,text,text,jsonb,text) to anon, authenticated;
grant execute on function public.quiz_set_health_consent(uuid,text) to anon, authenticated;
grant execute on function public.quiz_save_progress(uuid,int,jsonb,text,text) to anon, authenticated;
grant execute on function public.quiz_complete(uuid,boolean,text) to anon, authenticated;
grant execute on function public.quiz_log_whatsapp_click(uuid) to anon, authenticated;
grant execute on function public.quiz_whatsapp_number(text,uuid) to anon, authenticated;
grant execute on function public.list_quiz_leads(text,text,boolean,text,int,int) to authenticated;
grant execute on function public.get_quiz_lead_detail(uuid) to authenticated;
grant execute on function public.quiz_lead_metrics(timestamptz,timestamptz) to authenticated;
